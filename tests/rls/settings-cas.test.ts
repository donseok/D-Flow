// 0012 ⑧-1 revision CAS — 두 관리자가 같은 base revision 으로 서로 다른 값을 저장하면 정확히 한쪽만 성공한다.
// 두 연결 사이의 커밋이 필요해 데이터를 커밋한다 — 전용 프로젝트를 만들고 finally 에서 지운다. 정리 실패는 실패다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, loadFixture, openPool } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const RPC = 'select public.apply_project_settings($1, $2, $3, $4::jsonb, $5::text[], $6, 1, $7) as r'
const P = '00000000-0000-0000-7e57-000000001320'
const [CMD_A, CMD_B] = ['00000000-0000-4000-8000-000000001350', '00000000-0000-4000-8000-000000001351']
const cleanup = () => pool.query('delete from public.projects where id = $1', [P])

describe('0012 ⑧-1 revision CAS(두 연결)', () => {
  it('A 가 저장하고 커밋하기 전에 B 가 같은 expectedRevision 으로 저장하면 B 는 기다렸다가 SETTINGS_REVISION_CONFLICT — revision 은 1만 오른다', async () => {
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await cleanup()
      await pool.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 설정 CAS', F.ws])
      await pool.query(`insert into public.project_settings (project_id, "values", revision) values ($1, $2::jsonb, 1)
        on conflict (project_id) do update set "values" = excluded."values", revision = 1`,
        [P, JSON.stringify({ 'core.level_labels': ['A'], 'modules.enabled': [] })])
      s1 = await pool.connect()
      s2 = await pool.connect()
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s2.query('begin')
      expect((await s1.query(RPC, [P, 1, CMD_A, JSON.stringify({ 'core.extra_axis_label': 'A 의 값' }), null, F.users.wsAdmin, 'edit'])).rows[0].r)
        .toEqual({ status: 'applied', revision: 2 })
      let settled = false
      const second = s2.query(RPC, [P, 1, CMD_B, JSON.stringify({ 'core.extra_axis_label': 'B 의 값' }), null, F.users.member, 'edit']).then(
        (res) => res.rows[0].r as unknown, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      let blocked = false
      for (let i = 0; i < 250 && !settled && !blocked; i++) {
        blocked = (await s1.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [s2Pid])).rows[0].n > 0
        if (!blocked) await new Promise((r) => setTimeout(r, 20))
      }
      expect(blocked, 'B 가 설정 행 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await second).toMatchObject({ code: 'P0001', message: 'SETTINGS_REVISION_CONFLICT', detail: '2' })
      await s2.query('rollback')
      const { rows } = await s1.query(
        `select s.revision::text, s."values" ->> 'core.extra_axis_label' as v, s.updated_by as by,
                (select array_agg(h.command_id::text order by h.id) from public.project_settings_history h where h.project_id = s.project_id) as cmds
           from public.project_settings s where s.project_id = $1`, [P])
      expect(rows).toEqual([{ revision: '2', v: 'A 의 값', by: F.users.wsAdmin, cmds: [CMD_A] }])
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    expect((await pool.query('select 1 from public.project_settings where project_id = $1', [P])).rowCount).toBe(0)
  })
})
