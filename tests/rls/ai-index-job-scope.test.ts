import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'
let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })
const job = (extra: Record<string, unknown> = {}) => ({
  job_key: 'release-scope-test', operation: 'upsert', project_id: F.projects.a,
  domain: 'issues', entity_type: 'issue', entity_id: F.leaf.aErp, payload: {}, ...extra,
})
const sql = 'select public.upsert_ai_index_jobs($1::jsonb) n'
const call = async (c: PoolClient, jobs: unknown[]) => (await c.query(sql, [JSON.stringify(jobs)])).rows[0].n

it('프로젝트에서 workspace를 확정하고 재등록은 같은 범위에서 generation을 올린다', async () => {
  await asService(pool, async c => {
    expect(await call(c, [job()])).toBe(1)
    const first = (await c.query('select workspace_id, generation from public.ai_index_jobs where job_key=$1', ['release-scope-test'])).rows[0]
    const ws = (await c.query('select workspace_id from public.projects where id=$1', [F.projects.a])).rows[0].workspace_id
    expect(first.workspace_id).toBe(ws)
    expect(await call(c, [job({ operation: 'delete' })])).toBe(1)
    const second = (await c.query('select generation from public.ai_index_jobs where job_key=$1', ['release-scope-test'])).rows[0]
    expect(Number(second.generation)).toBe(Number(first.generation) + 1)
  })
})
it('프로젝트와 workspace 불일치 또는 다른 프로젝트의 job_key 재사용은 전체 배치를 되돌린다', async () => {
  await asService(pool, async c => {
    expect((await pgError(c, sql, [JSON.stringify([job({ workspace_id: F.wsB })])]))?.message).toContain('AI_INDEX_JOB_SCOPE_INVALID')
    await call(c, [job()])
    expect((await pgError(c, sql, [JSON.stringify([job({ job_key: 'release-new' }), job({ project_id: F.projects.bWs })])]))?.message).toContain('AI_INDEX_JOB_SCOPE_CONFLICT')
    expect((await c.query("select 1 from public.ai_index_jobs where job_key='release-new'")).rowCount).toBe(0)
  })
})
it('전역 작업은 명시적 workspace가 필요하고 서비스 역할만 등록한다', async () => {
  await asService(pool, async c => {
    expect((await pgError(c, sql, [JSON.stringify([job({ project_id: null })])]))?.message).toContain('AI_INDEX_JOB_SCOPE_REQUIRED')
    expect(await call(c, [job({ project_id: null, workspace_id: F.wsB })])).toBe(1)
  })
  await asUser(pool, F.users.wsAdmin, async c => {
    expect((await pgError(c, sql, [JSON.stringify([job()])]))?.code).toBe('42501')
  })
})

// 0044 — 회의록 범위 변경 큐잉이 workspace_id(NOT NULL)를 채운다. 예전엔 채우지 않아 회의록 메타 변경·보관이 23502 로 실패했다
const scopeSql = 'select public.queue_minute_ai_index_scope_change($1::uuid, $2::uuid, $3) id'
const MIN_A = '00000000-0000-0000-7e57-0000004400a1'
const MIN_GLOBAL = '00000000-0000-0000-7e57-0000004400a2'
const wsOf = async (c: PoolClient, minuteId: string, project: string | null) => (await c.query(
  'select workspace_id from public.ai_index_jobs where job_key=$1', [`v1:${project ?? 'global'}:minutes:minute:${minuteId}`])).rows[0]?.workspace_id
it('회의록 범위 변경 큐잉은 프로젝트의 workspace 를, 프로젝트가 없으면 회의록의 workspace 를 싣는다', async () => {
  await asService(pool, async c => {
    await c.query(`insert into public.minutes (id, project_id, workspace_id, minute_date, team_code, title, body_md, created_by) values
      ($1, $2, $3, '2026-10-09', 'ERP', '범위 a', '# a', $5), ($4, null, $6, '2026-10-09', 'ERP', '범위 global', '# g', $5)`,
      [MIN_A, F.projects.a, F.ws, MIN_GLOBAL, F.users.wsAdmin, F.wsB])
    await c.query(scopeSql, [F.projects.a, MIN_A, 'upsert'])
    expect(await wsOf(c, MIN_A, F.projects.a)).toBe(F.ws)
    await c.query(scopeSql, [null, MIN_GLOBAL, 'delete'])
    expect(await wsOf(c, MIN_GLOBAL, null)).toBe(F.wsB)
    // 다시 넣으면 같은 행의 generation 이 오른다(기존 계약 그대로)
    await c.query(scopeSql, [null, MIN_GLOBAL, 'upsert'])
    const row = (await c.query('select generation, operation from public.ai_index_jobs where job_key=$1', [`v1:global:minutes:minute:${MIN_GLOBAL}`])).rows[0]
    expect(Number(row.generation)).toBe(1)
    expect(row.operation).toBe('upsert')
  })
})
it('워크스페이스를 구할 수 없으면 짐작하지 않고 거부한다', async () => {
  await asService(pool, async c => {
    expect((await pgError(c, scopeSql, [null, '00000000-0000-0000-7e57-0000004400ff', 'upsert']))?.message).toContain('AI_INDEX_JOB_SCOPE_REQUIRED')
  })
})

// 0046 — 선점은 워크스페이스끼리 번갈아 집는다. 한 워크스페이스의 깊은 줄이 다른 워크스페이스의 잡을 굶기지 않는다
it('선점은 워크스페이스마다 첫 잡부터 번갈아 집고, 워크스페이스 안의 순서는 지킨다', async () => {
  await asService(pool, async c => {
    // 이 케이스의 잡만 남긴다(트랜잭션 안 — 끝나면 되돌아간다)
    await c.query('delete from public.ai_index_jobs')
    const put = (key: string, ws: string, project: string | null, at: string) => c.query(
      `insert into public.ai_index_jobs (job_key, operation, project_id, workspace_id, domain, entity_type, entity_id, payload, status, attempts, run_after, generation, updated_at)
       values ($1, 'upsert', $2, $3, 'issues', 'issue', $1, '{}', 'pending', 0, $4::timestamptz, 0, now())`, [key, project, ws, at])
    for (let i = 1; i <= 4; i += 1) await put(`fair-a${i}`, F.ws, F.projects.a, `2000-01-01T00:00:0${i}Z`)
    await put('fair-b1', F.wsB, F.projects.bWs, '2000-01-02T00:00:00Z')
    const first = (await c.query('select job_key from public.claim_ai_index_jobs(2, 300)')).rows.map(r => r.job_key).sort()
    expect(first).toEqual(['fair-a1', 'fair-b1'])
    // 남은 것은 한 워크스페이스뿐 — 예전과 같은 run_after 순
    const rest = (await c.query('select job_key from public.claim_ai_index_jobs(2, 300)')).rows.map(r => r.job_key).sort()
    expect(rest).toEqual(['fair-a2', 'fair-a3'])
  })
})

// 0045 — 회의에 연결되지 않은 회의록(meeting_occurrence_date null)도 재구성 단계로 선점된다. 예전엔 정렬 키가 null 이라 23514 로 실패했다
it('프로젝트 Wiki 재구성 선점은 회의 일자가 없는 회의록을 회의록 일자로 정렬해 집는다', async () => {
  await asService(pool, async c => {
    const M = '00000000-0000-0000-7e57-0000004500a1' // 일자를 가장 이르게 둬 픽스처의 다른 회의록보다 먼저 집힌다
    await c.query(`insert into public.minutes (id, project_id, workspace_id, minute_date, team_code, title, body_md, created_by)
      values ($1, $2, $3, '2000-01-01', 'ERP', '재구성 정렬', '# r', $4)`, [M, F.projects.a, F.ws, F.users.wsAdmin])
    await c.query(`insert into public.minute_versions (minute_id, version_no, body_md, body_hash, title, minute_date, team_code)
      select $1, coalesce(max(version_no), 0) + 1, '# r', 'hash-0045', '재구성 정렬', '2000-01-01', 'ERP' from public.minute_versions where minute_id = $1`, [M])
    await c.query(`insert into public.wiki_project_rebuild_jobs (project_id) values ($1)
      on conflict (project_id) do update set status = 'pending', run_after = now(), locked_at = null, cursor_observed_sort = null, cursor_minute_id = null`, [F.projects.a])
    const row = (await c.query('select minute_id, observed_sort, finished from public.claim_wiki_project_rebuild_step($1, $2, 900)', [F.projects.a, 'rls-0045'])).rows[0]
    expect(row.finished).toBe(false)
    expect(row.minute_id).toBe(M)
    expect(row.observed_sort).not.toBeNull()
  })
})
