import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { F, asService, loadFixture, openPool, pgError } from './harness'
let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })
const area = '00000000-0000-0000-7e57-00000000110c'
async function setup(c: PoolClient) {
  await c.query(`update public.project_settings set "values" = "values" || '{"weekly.columns":[{"id":"delivery","label":"산출물","carryOver":true},{"id":"release","label":"배포","carryOver":false}]}'::jsonb where project_id=$1`, [F.projects.a])
  const seed = [{ area_id: area, this_content: '', this_issue: '', next_content: '', next_issue: '', cells: { this_delivery: '설계서', next_release: '배포' } }]
  const { rows } = await c.query(`select public.create_weekly_report($1,$2,'2026-11-02',$3::jsonb) r`, [F.users.member, F.projects.a, JSON.stringify(seed)])
  const row = await c.query('select id, cells from public.weekly_report_rows where report_id=$1 and area_id=$2', [rows[0].r.report_id, area])
  return row.rows[0]
}
async function login(c: PoolClient, user: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: user, role: 'authenticated' })])
}
describe('project weekly item storage and permissions', () => {
  it('seeds values in the same report transaction and lets a project member edit them', async () => {
    await asService(pool, async c => {
      const row = await setup(c)
      expect(row.cells).toEqual({ this_delivery: '설계서', next_release: '배포' })
      await login(c, F.users.dual)
      const updated = await c.query(`update public.weekly_report_rows set cells=cells || '{"this_release":"완료"}'::jsonb where id=$1 returning cells`, [row.id])
      expect(updated.rows[0].cells.this_release).toBe('완료')
    })
  })
  it.each([
    [{ this_ghost: 'x' }, 'WEEKLY_COLUMN_UNKNOWN'],
    [{ this_delivery: 7 }, 'WEEKLY_CELL_INVALID'],
    [{ this_delivery: 'x'.repeat(20001) }, 'WEEKLY_CELL_INVALID'],
    [{ this_content: 'shadow' }, 'WEEKLY_CELL_INVALID'],
  ])('rejects invalid values (%j) at the DB boundary', async (cells, message) => {
    await asService(pool, async c => {
      const row = await setup(c)
      await login(c, F.users.dual)
      expect(await pgError(c, 'update public.weekly_report_rows set cells=$1::jsonb where id=$2', [JSON.stringify(cells), row.id])).toMatchObject({ code: '23514', message })
    })
  })
  it('blocks another project member from updating the row', async () => {
    await asService(pool, async c => {
      const row = await setup(c)
      await login(c, F.users.bMember)
      const result = await c.query(`update public.weekly_report_rows set cells='{}'::jsonb where id=$1`, [row.id])
      expect(result.rowCount).toBe(0)
    })
  })
  it('rejects stale writes to a removed default slot', async () => {
    await asService(pool, async c => {
      const row = await setup(c)
      await login(c, F.users.dual)
      expect(await pgError(c, `update public.weekly_report_rows set this_content='stale' where id=$1`, [row.id])).toMatchObject({ code: '23514', message: 'WEEKLY_COLUMN_UNKNOWN' })
    })
  })
})
