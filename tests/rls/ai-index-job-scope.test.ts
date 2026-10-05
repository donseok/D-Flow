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
