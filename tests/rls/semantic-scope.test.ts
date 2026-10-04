import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

// SP5 B3 과제11(0022, 스펙 §9 ⑦) — 의미검색 RPC 의 범위 인자. 두 워크스페이스 소속자(dana)에게 RLS 는 양쪽을 다 보여 주므로,
// 범위 인자가 SQL 안에서 거른 뒤 top-k 를 매겨야 회수율이 산다. 새 인자는 좁히기만 하고 RLS 를 넓히지 않는다.
let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const MA = '00000000-0000-0000-7e57-000000003201' // A, 프로젝트 a
const MA0 = '00000000-0000-0000-7e57-000000003202' // A, 무프로젝트
const MB = '00000000-0000-0000-7e57-000000003203' // B, 무프로젝트
const DIM = 768
const vec = (...head: number[]) => `[${[...head, ...Array(DIM - head.length).fill(0)].join(',')}]`
const Q = vec(1)
const NEAR = vec(1)
const MID = vec(0.8, 0.6)
const FAR = vec(0.6, 0.8)

/** 트리거(팀·폴더 메아리 등)는 이 RPC 의 관심 밖이라 service 경로에서 끄고 넣는다 — 롤백되는 트랜잭션 안이다. */
async function seedMinutes(c: PoolClient) {
  await c.query('reset role')
  await c.query(`set local session_replication_role = replica`)
  for (const [id, ws, project] of [[MA, F.ws, F.projects.a], [MA0, F.ws, null], [MB, F.wsB, null]] as const) {
    await c.query(`insert into public.minutes (id, workspace_id, project_id, minute_date, team_code, title, body_md, created_by)
      values ($1, $2, $3, '2026-10-04', 'ERP', $1, '# x', $4)`, [id, ws, project, F.users.dual])
  }
  // B 회의록이 가장 가깝다 — 범위 인자 없이 top-1 이면 A 화면에서 B 가 이긴다(회수율 문제)
  for (const [id, v] of [[MB, NEAR], [MA, MID], [MA0, FAR]] as const) {
    await c.query(`insert into public.minute_embeddings (minute_id, chunk_index, content, embedding) values ($1, 0, $1, $2::public.vector)`, [id, v])
  }
  await c.query(`set local session_replication_role = origin`)
  await c.query('set local role authenticated')
}
const minuteIds = async (c: PoolClient, args: string, params: unknown[] = []) =>
  (await c.query(`select minute_id from public.match_minute_documents($1::public.vector, 10${args}) order by similarity desc`, [Q, ...params]))
    .rows.map(r => r.minute_id as string).filter(id => [MA, MA0, MB].includes(id))

describe('match_minute_documents — 워크스페이스·제외 프로젝트', () => {
  it('인자 없으면 RLS 가 보여 준 그대로(두 워크스페이스), p_workspace_id 면 그 워크스페이스만', async () => {
    await asUser(pool, F.users.dual, async c => {
      await seedMinutes(c)
      expect(await minuteIds(c, '')).toEqual([MB, MA, MA0])
      expect(await minuteIds(c, ', p_workspace_id => $2', [F.ws])).toEqual([MA, MA0])
    })
  })
  it('top-k 회수율 — match_count 1 에서도 A 범위면 A 회의록이 나온다', async () => {
    await asUser(pool, F.users.dual, async c => {
      await seedMinutes(c)
      const top = async (extra: string, params: unknown[]) =>
        (await c.query(`select minute_id from public.match_minute_documents($1::public.vector, 1${extra})`, [Q, ...params])).rows.map(r => r.minute_id)
      expect(await top('', [])).toEqual([MB])
      expect(await top(', p_workspace_id => $2', [F.ws])).toEqual([MA])
    })
  })
  it('제외 목록은 그 프로젝트 회의록만 뺀다 — 무프로젝트는 남고, 빈 목록은 아무것도 빼지 않는다', async () => {
    await asUser(pool, F.users.dual, async c => {
      await seedMinutes(c)
      expect(await minuteIds(c, ', p_workspace_id => $2, p_exclude_project_ids => $3', [F.ws, [F.projects.a]])).toEqual([MA0])
      expect(await minuteIds(c, ', p_workspace_id => $2, p_exclude_project_ids => $3', [F.ws, []])).toEqual([MA, MA0])
    })
  })
  it('범위 인자로 RLS 를 넓히지 못한다 — 소속 아닌 워크스페이스를 넘기면 0건', async () => {
    // cy(aLoose)는 A 만 소속 — B 를 넘겨도 RLS 가 먼저라 0건
    await asUser(pool, F.users.aLoose, async c => {
      await seedMinutes(c)
      expect(await minuteIds(c, ', p_workspace_id => $2', [F.wsB])).toEqual([])
    })
  })
})

describe('match_wbs_documents — 허용 프로젝트 목록', () => {
  async function seedWbs(c: PoolClient) {
    await c.query('reset role')
    for (const [p, v] of [[F.projects.a, MID], [F.projects.bWs, NEAR], [F.projects.b, FAR]] as const) {
      await c.query(`insert into public.wbs_embeddings (project_id, kind, ref_id, content, embedding) values ($1, 'project', null, $1, $2::public.vector)`, [p, v])
    }
    await c.query('set local role authenticated')
  }
  const projects = async (c: PoolClient, count: number, extra = '', params: unknown[] = []) =>
    (await c.query(`select project_id from public.match_wbs_documents($1::public.vector, ${count}${extra})`, [Q, ...params])).rows.map(r => r.project_id as string)
      .filter(p => ([F.projects.a, F.projects.b, F.projects.bWs] as string[]).includes(p))

  it('목록 안에서 top-k — 다른 워크스페이스 청크가 더 가까워도 목록 프로젝트가 나온다', async () => {
    await asUser(pool, F.users.dual, async c => {
      await seedWbs(c)
      expect(await projects(c, 1, ', p_project_ids => $2', [[F.projects.a, F.projects.b]])).toEqual([F.projects.a])
      expect((await projects(c, 10)).sort()).toEqual([F.projects.a, F.projects.b, F.projects.bWs].sort())
    })
  })
  it('빈 목록은 0건(허용 프로젝트 없음), null 은 제한 없음', async () => {
    await asUser(pool, F.users.dual, async c => {
      await seedWbs(c)
      expect(await projects(c, 10, ', p_project_ids => $2', [[]])).toEqual([])
      expect((await projects(c, 10, ', p_project_ids => null')).length).toBe(3)
    })
  })
  it('목록으로 RLS 를 넓히지 못한다 — 볼 수 없는 프로젝트를 넘기면 0건', async () => {
    await asUser(pool, F.users.aLoose, async c => {
      await seedWbs(c)
      expect(await projects(c, 10, ', p_project_ids => $2', [[F.projects.bWs]])).toEqual([])
    })
  })
})

describe('시그니처·실행권(0022 사후검증과 같은 판정)', () => {
  it('옛 overload 는 없고, INVOKER 이며, anon 은 실행 못 하고 authenticated 는 한다', async () => {
    await asService(pool, async c => {
      const { rows } = await c.query(`select proname, pg_get_function_identity_arguments(oid) as args, prosecdef from pg_proc
        where pronamespace = 'public'::regnamespace and proname in ('match_minute_documents', 'match_wbs_documents') order by proname`)
      expect(rows.map(r => r.proname)).toEqual(['match_minute_documents', 'match_wbs_documents'])
      expect(rows.every(r => r.prosecdef === false)).toBe(true)
      expect(rows[0].args).toContain('p_exclude_project_ids uuid[]')
      expect(rows[1].args).toContain('p_project_ids uuid[]')
      const priv = await c.query(`select
        has_function_privilege('anon', 'public.match_minute_documents(public.vector, integer, text, date, date, uuid[], uuid, uuid[])', 'EXECUTE') as a1,
        has_function_privilege('anon', 'public.match_wbs_documents(public.vector, integer, uuid, text[], uuid[])', 'EXECUTE') as a2,
        has_function_privilege('authenticated', 'public.match_minute_documents(public.vector, integer, text, date, date, uuid[], uuid, uuid[])', 'EXECUTE') as u1,
        has_function_privilege('authenticated', 'public.match_wbs_documents(public.vector, integer, uuid, text[], uuid[])', 'EXECUTE') as u2`)
      expect(priv.rows[0]).toEqual({ a1: false, a2: false, u1: true, u2: true })
    })
  })
  it('옛 위치 인자 호출(4·6 인자)도 그대로 돈다 — 기본값이 끝에 붙었다', async () => {
    await asUser(pool, F.users.dual, async c => {
      expect(await pgError(c, `select * from public.match_wbs_documents($1::public.vector, 3, null, null)`, [Q])).toBeNull()
      expect(await pgError(c, `select * from public.match_minute_documents($1::public.vector, 3, null, null, null, null)`, [Q])).toBeNull()
    })
  })
})
