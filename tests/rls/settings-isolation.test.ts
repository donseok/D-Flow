// 0012 P1-AC4 의 DB 층 — 한 프로젝트의 설정 쓰기가 다른 프로젝트의 문서·revision·이력을 건드리지 않는다(번갈아·동시에).
// 워크스페이스 B 계정은 A 의 설정과 이력을 읽지 못한다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const RPC = 'select public.apply_project_settings($1, $2, $3, $4::jsonb, null, $5, 1, $6) as r'
const CMD = (n: number) => `00000000-0000-4000-8000-0000000013${String(n).padStart(2, '0')}`
const snapshot = async (c: PoolClient | Pool, projectId: string) =>
  (await c.query(
    `select s.revision::text, s."values" as v, s.updated_at::text as at, s.updated_by as by,
            (select count(*)::int from public.project_settings_history h where h.project_id = s.project_id) as history
       from public.project_settings s where s.project_id = $1`, [projectId])).rows[0]

describe('0012 설정 격리(P1-AC4)', () => {
  it('A·B 를 번갈아 써도 서로의 문서·revision·이력이 그대로다', async () => {
    await asService(pool, async (c) => {
      const b0 = await snapshot(c, F.projects.b)
      await c.query(RPC, [F.projects.a, 1, CMD(60), JSON.stringify({ 'core.milestone_keywords': ['a1'] }), F.users.member, 'edit'])
      expect(await snapshot(c, F.projects.b)).toEqual(b0)
      await c.query(RPC, [F.projects.b, 1, CMD(61), JSON.stringify({ 'core.milestone_keywords': ['b1'] }), F.users.member, 'edit'])
      const a1 = await snapshot(c, F.projects.a)
      await c.query(RPC, [F.projects.b, 2, CMD(62), JSON.stringify({ 'core.extra_axis_label': 'b2' }), F.users.member, 'edit'])
      expect(await snapshot(c, F.projects.a)).toEqual(a1)
      expect((a1.v as Record<string, unknown>)['core.milestone_keywords']).toEqual(['a1'])
      expect(((await snapshot(c, F.projects.b)).v as Record<string, unknown>)['core.milestone_keywords']).toEqual(['b1'])
      // 같은 명령 id 를 다른 프로젝트에 쓰면 새 명령이다 — 범위가 다르면 서로 보이지 않는다
      expect((await c.query(RPC, [F.projects.b, 3, CMD(60), JSON.stringify({ 'core.milestone_keywords': ['b3'] }), F.users.member, 'edit'])).rows[0].r)
        .toEqual({ status: 'applied', revision: 4 })
    })
  })

  it('두 연결이 서로 다른 프로젝트를 동시에 써도 기다리지 않고, 각자 자기 변경만 갖는다', async () => {
    const [P1, P2] = ['00000000-0000-0000-7e57-000000001322', '00000000-0000-0000-7e57-000000001323']
    const cleanup = () => pool.query('delete from public.projects where id = any($1::uuid[])', [[P1, P2]])
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await cleanup()
      for (const p of [P1, P2]) {
        await pool.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [p, 'RLS 설정 격리', F.ws])
        await pool.query(`insert into public.project_settings (project_id, "values", revision) values ($1, $2::jsonb, 1)
          on conflict (project_id) do update set "values" = excluded."values", revision = 1`,
          [p, JSON.stringify({ 'core.level_labels': ['A'], 'modules.enabled': [] })])
      }
      s1 = await pool.connect()
      s2 = await pool.connect()
      await s1.query('begin')
      await s1.query(RPC, [P1, 1, CMD(63), JSON.stringify({ 'core.extra_axis_label': 'one' }), F.users.member, 'edit'])
      // s1 이 커밋하기 전에 s2 가 다른 프로젝트를 쓴다 — 잠금이 프로젝트 행 단위라 바로 끝난다
      await s2.query(`set lock_timeout = '2s'`)
      expect((await s2.query(RPC, [P2, 1, CMD(64), JSON.stringify({ 'core.extra_axis_label': 'two' }), F.users.member, 'edit'])).rows[0].r)
        .toEqual({ status: 'applied', revision: 2 })
      await s2.query('reset lock_timeout')
      await s1.query('commit')
      expect((await snapshot(s1, P1))).toMatchObject({ revision: '2', history: 1, v: { 'core.extra_axis_label': 'one' } })
      expect((await snapshot(s1, P2))).toMatchObject({ revision: '2', history: 1, v: { 'core.extra_axis_label': 'two' } })
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('reset lock_timeout').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    expect((await pool.query('select 1 from public.project_settings where project_id = any($1::uuid[])', [[P1, P2]])).rowCount).toBe(0)
  })

  it('워크스페이스 B 계정은 A 의 설정·이력을 0건 읽는다(프로젝트·워크스페이스 네 표)', async () => {
    for (const uid of [F.users.bAdmin, F.users.bMember]) {
      await asUser(pool, uid, async (c) => {
        for (const [table, key, id] of [
          ['project_settings', 'project_id', F.projects.a], ['project_settings_history', 'project_id', F.projects.a],
          ['workspace_settings', 'workspace_id', F.ws], ['workspace_settings_history', 'workspace_id', F.ws],
        ] as const) {
          expect((await c.query(`select 1 from public.${table} where ${key} = $1`, [id])).rowCount, `${uid} ${table}`).toBe(0)
        }
        // 대조: 자기 워크스페이스의 프로젝트 설정은 읽는다
        expect((await c.query('select 1 from public.project_settings where project_id = $1', [F.projects.bWs])).rowCount).toBe(1)
      })
    }
  })
})
