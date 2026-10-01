// 0012 ⑧-2 생성·복사 RPC(개정 §2.11 ⑤) — 프로젝트와 필수 설정이 한 트랜잭션이다. 전부 begin…rollback.
// 픽스처 프로젝트 A(…c1)는 프로젝트 전용 팀 ERP·MES, 영역 RLSA(weekly_section), 영역-팀 RLSA→ERP 를 갖는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const RPC = 'select public.create_project_with_settings($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) as r'
const CMD = (n: number) => `00000000-0000-4000-8000-0000000013${String(n).padStart(2, '0')}`
const VALUES = { 'core.level_labels': ['단계', '작업'], 'modules.enabled': ['kanban', 'issues'], 'core.milestone_keywords': ['release'] }
type Args = { ws?: string; name?: string; values?: unknown; copyFrom?: string | null; actor?: string | null; cmd: string; ver?: number | null }
const argsOf = (a: Args) => [a.ws ?? F.ws, a.name ?? 'Acme 새 프로젝트', '2026-10-01', '2026-12-31', '설명',
  JSON.stringify(a.values ?? VALUES), a.copyFrom ?? null, a.actor === undefined ? F.users.wsAdmin : a.actor, a.cmd, a.ver === undefined ? 1 : a.ver]
const create = async (c: PoolClient, a: Args) =>
  (await c.query(RPC, argsOf(a))).rows[0].r as { status: string; project_id: string; revision: number }
const named = async (c: PoolClient, name: string) =>
  (await c.query('select 1 from public.projects where name = $1', [name])).rowCount

describe('0012 ⑧-2 create_project_with_settings', () => {
  it('프로젝트·설정 문서·키별 이력(create)을 한 번에 만든다 — revision 1, 행위자, 요약', async () => {
    await asService(pool, async (c) => {
      const r = await create(c, { cmd: CMD(70) })
      expect(r).toEqual({ status: 'applied', project_id: expect.stringMatching(/^[0-9a-f-]{36}$/), revision: 1 })
      expect((await c.query('select name, start_date::text, end_date::text, description, workspace_id, is_private from public.projects where id = $1',
        [r.project_id])).rows).toEqual([{ name: 'Acme 새 프로젝트', start_date: '2026-10-01', end_date: '2026-12-31', description: '설명',
        workspace_id: F.ws, is_private: false }])
      expect((await c.query('select "values" as v, revision::text, schema_version, updated_by from public.project_settings where project_id = $1',
        [r.project_id])).rows).toEqual([{ v: VALUES, revision: '1', schema_version: 1, updated_by: F.users.wsAdmin }])
      const { rows } = await c.query(
        `select key, old_value, new_value, revision::text, source, copied_from, changed_by, command_id::text, command_digest is not null as digest
           from public.project_settings_history where project_id = $1 order by key`, [r.project_id])
      expect(rows).toEqual(Object.keys(VALUES).sort().map((key) => ({
        key, old_value: null, new_value: VALUES[key as keyof typeof VALUES], revision: '1', source: 'create', copied_from: null,
        changed_by: F.users.wsAdmin, command_id: CMD(70), digest: true })))
    })
  })

  it('필수 키(core.level_labels·modules.enabled)가 없으면 거부하고 프로젝트 행이 남지 않는다', async () => {
    await asService(pool, async (c) => {
      for (const missing of ['core.level_labels', 'modules.enabled'] as const) {
        const values: Record<string, unknown> = { ...VALUES }
        delete values[missing]
        expect(await pgError(c, RPC, argsOf({ name: 'Acme 누락', values, cmd: CMD(71) })), missing)
          .toMatchObject({ code: '22023', message: `CONFIG_INVALID:${missing}` })
      }
      expect(await pgError(c, RPC, argsOf({ name: 'Acme 누락', values: [], cmd: CMD(71) })))
        .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:p_values' })
      expect(await named(c, 'Acme 누락')).toBe(0)
    })
  })

  it('설정 기록이 실패하면 방금 넣은 프로젝트 행도 사라진다(한 트랜잭션) — 세대가 null 인 호출로 설정 update 를 실패시킨다', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, RPC, argsOf({ name: 'Acme 반쪽', cmd: CMD(72), ver: null }))).toMatchObject({ code: '23502' })
      expect(await named(c, 'Acme 반쪽')).toBe(0)
      expect((await c.query('select 1 from public.project_settings_history where command_id = $1', [CMD(72)])).rowCount).toBe(0)
    })
  })

  it('같은 명령 id 의 재전송은 같은 프로젝트를 돌려주고 새로 만들지 않는다. 이름이 다르면 COMMAND_REUSED', async () => {
    await asService(pool, async (c) => {
      const first = await create(c, { cmd: CMD(73) })
      expect(await create(c, { cmd: CMD(73) })).toEqual({ status: 'duplicate', project_id: first.project_id, revision: 1 })
      expect(await named(c, 'Acme 새 프로젝트')).toBe(1)
      expect(await pgError(c, RPC, argsOf({ name: 'Acme 다른 이름', cmd: CMD(73) }))).toMatchObject({ code: '23505', message: 'COMMAND_REUSED' })
      expect(await pgError(c, RPC, argsOf({ values: { ...VALUES, 'core.extra_axis_label': 'x' }, cmd: CMD(73) })))
        .toMatchObject({ code: '23505', message: 'COMMAND_REUSED' })
      expect(await named(c, 'Acme 다른 이름')).toBe(0)
    })
  })

  it('다른 워크스페이스·다른 행위자가 쓴 같은 명령 id 는 서로 보이지 않는다 — 각자 새 프로젝트다', async () => {
    await asService(pool, async (c) => {
      const a = await create(c, { cmd: CMD(74), actor: F.users.platform })
      const b = await create(c, { cmd: CMD(74), actor: F.users.platform, ws: F.wsB })
      const other = await create(c, { cmd: CMD(74), actor: F.users.wsAdmin })
      expect([a.status, b.status, other.status]).toEqual(['applied', 'applied', 'applied'])
      expect(new Set([a.project_id, b.project_id, other.project_id]).size).toBe(3)
    })
  })

  it('복사 — 이력은 copy·copied_from 이고, 프로젝트 전용 팀·영역·영역-팀이 새 id 로 복사돼 복사본끼리 이어진다. 멤버는 복사하지 않는다', async () => {
    await asService(pool, async (c) => {
      // 공용 팀(SHR, project_id null)에 묶인 영역-팀도 하나 둔다 — 공용 팀은 복사하지 않고 같은 팀에 잇는다
      await c.query(`insert into public.area_teams (area_id, team_id, kind) values ('00000000-0000-0000-7e57-00000000110c', $1, 'support')`,
        [F.teams.aShared])
      const r = await create(c, { cmd: CMD(75), copyFrom: F.projects.a })
      const history = (await c.query('select distinct source, copied_from from public.project_settings_history where project_id = $1', [r.project_id])).rows
      expect(history).toEqual([{ source: 'copy', copied_from: F.projects.a }])
      const teams = (await c.query<{ id: string; code: string; workspace_id: string }>(
        'select id, code, workspace_id from public.teams where project_id = $1 order by code', [r.project_id])).rows
      expect(teams.map((t) => t.code)).toEqual(['ERP', 'MES'])
      expect(teams.every((t) => t.workspace_id === F.ws && t.id !== F.teams.erp && t.id !== F.teams.mes)).toBe(true)
      const links = (await c.query<{ area: string; kind: string; team_id: string; link: string }>(
        `select a.code as area, a.kind, x.team_id, x.kind as link from public.project_areas a
           join public.area_teams x on x.area_id = a.id where a.project_id = $1 order by x.kind`, [r.project_id])).rows
      expect(links).toEqual([
        { area: 'RLSA', kind: 'weekly_section', team_id: teams.find((t) => t.code === 'ERP')!.id, link: 'primary' },
        { area: 'RLSA', kind: 'weekly_section', team_id: F.teams.aShared, link: 'support' },
      ])
      expect((await c.query('select 1 from public.project_members where project_id = $1', [r.project_id])).rowCount).toBe(0)
      // 원본은 그대로다
      expect((await c.query('select count(*)::int as n from public.teams where project_id = $1', [F.projects.a])).rows[0].n).toBe(2)
    })
  })

  it('A1 이월(Z3) — 갈라진 원본(같은 code 의 공용·전용 팀을 함께 가리키는 영역)도 복사한다: 영역 팀은 대상의 같은 code 전용 팀으로 잇고, 같은 팀으로 겹친 링크는 하나(주관 우선)다', async () => {
    await asService(pool, async (c) => {
      // 갈라진 상태 — 영역이 공용 DIV 를 먼저 가리킨 뒤 같은 code 의 전용 DIV 가 생겼다(복사 버튼 꼴). 트리거는 새 공용 참조만 막는다
      const shared = (await c.query<{ id: string }>(
        `insert into public.teams (workspace_id, project_id, code, name) values ($1, null, 'DIV', '분기') returning id`, [F.ws])).rows[0].id
      await c.query(`insert into public.area_teams (area_id, team_id, kind) values ('00000000-0000-0000-7e57-00000000110c', $1, 'support')`, [shared])
      const own = (await c.query<{ id: string }>(
        `insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'DIV', '분기') returning id`, [F.ws, F.projects.a])).rows[0].id
      await c.query(`insert into public.area_teams (area_id, team_id, kind) values ('00000000-0000-0000-7e57-00000000110c', $1, 'primary')`, [own])
      const r = await create(c, { cmd: CMD(82), copyFrom: F.projects.a, name: 'Acme 갈라진 원본 복사' })
      expect(r.status).toBe('applied')
      const div = (await c.query<{ id: string }>(`select id from public.teams where project_id = $1 and code = 'DIV'`, [r.project_id])).rows
      expect(div).toHaveLength(1)
      const links = (await c.query<{ team_id: string; kind: string; common: boolean }>(
        `select x.team_id, x.kind, t.project_id is null as common from public.project_areas a
           join public.area_teams x on x.area_id = a.id join public.teams t on t.id = x.team_id
          where a.project_id = $1 and t.code = 'DIV'`, [r.project_id])).rows
      expect(links).toEqual([{ team_id: div[0].id, kind: 'primary', common: false }])   // 공용 DIV 참조를 옮기지 않는다(분열을 복사하지 않는다)
    })
  })

  it('다른 워크스페이스의 프로젝트는 복사 원본이 될 수 없다 — COPY_SOURCE_FORBIDDEN, 아무것도 만들지 않는다', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, RPC, argsOf({ name: 'Acme 남의 원본', cmd: CMD(76), ws: F.wsB, copyFrom: F.projects.a })))
        .toMatchObject({ code: '42501', message: 'COPY_SOURCE_FORBIDDEN' })
      expect(await pgError(c, RPC, argsOf({ name: 'Acme 남의 원본', cmd: CMD(77), copyFrom: '00000000-0000-0000-7e57-0000000013ff' })))
        .toMatchObject({ code: '42501', message: 'COPY_SOURCE_FORBIDDEN' })
      expect(await named(c, 'Acme 남의 원본')).toBe(0)
    })
  })

  it('copy_project_config 는 비어 있지 않은 대상에 복사하지 않는다 — COPY_TARGET_NOT_EMPTY', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, 'select public.copy_project_config($1, $2)', [F.projects.a, F.projects.b]))   // B 에는 팀 QA·QA2 가 있다
        .toMatchObject({ code: '23514', message: 'COPY_TARGET_NOT_EMPTY' })
      expect(await pgError(c, 'select public.copy_project_config($1, $1)', [F.projects.a]))
        .toMatchObject({ code: '42501', message: 'COPY_SOURCE_FORBIDDEN' })
    })
  })

  it('copy_project_config 를 생성 RPC 밖에서 부르면 COPY_SOURCE_FORBIDDEN — 같은 워크스페이스의 빈 프로젝트에도 이력 없이 덧붙이지 않는다', async () => {
    await asService(pool, async (c) => {
      // A private(…c3)는 A 와 같은 워크스페이스이고 팀·영역이 없다 — 복사 생성 이력만 없다
      const count = async () => (await c.query<{ n: number }>(
        `select (select count(*) from public.teams where project_id = $1) + (select count(*) from public.project_areas where project_id = $1) as n`,
        [F.projects.aPrivate])).rows[0].n
      expect(Number(await count())).toBe(0)
      await c.query('set local role service_role')
      expect(await pgError(c, 'select public.copy_project_config($1, $2)', [F.projects.a, F.projects.aPrivate]))
        .toMatchObject({ code: '42501', message: 'COPY_SOURCE_FORBIDDEN' })
      await c.query('reset role')
      expect(Number(await count())).toBe(0)
      // 복사로 만든 프로젝트라도 원본이 다르면 거절한다(copied_from 이 맞아야 한다). 빈 원본(…c3)이라 대상은 비어 있다
      const r = await create(c, { cmd: CMD(81), copyFrom: F.projects.aPrivate, name: 'Acme 빈 복사본' })
      expect(await pgError(c, 'select public.copy_project_config($1, $2)', [F.projects.a, r.project_id]))
        .toMatchObject({ code: '42501', message: 'COPY_SOURCE_FORBIDDEN' })
    })
  })

  it('행위자 없는 생성은 SETTINGS_ACTOR_REQUIRED, 명령 id 없는 생성은 COMMAND_ID_REQUIRED — 프로젝트 행이 남지 않는다', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, RPC, argsOf({ name: 'Acme 익명', cmd: CMD(78), actor: null })))
        .toMatchObject({ code: '22023', message: 'SETTINGS_ACTOR_REQUIRED' })
      const noCommand: unknown[] = argsOf({ name: 'Acme 익명', cmd: CMD(78) })
      noCommand[8] = null
      expect(await pgError(c, RPC, noCommand)).toMatchObject({ code: '22023', message: 'COMMAND_ID_REQUIRED' })
      expect(await named(c, 'Acme 익명')).toBe(0)
    })
  })

  it('격리 수준 — repeatable read·serializable·read uncommitted 는 SETTINGS_ISOLATION, read committed 는 통과', async () => {
    const REFUSED = ['repeatable read', 'serializable', 'read uncommitted']
    const results: Record<string, unknown> = {}
    for (const level of [...REFUSED, 'read committed']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        results[level] = await pgError(c, RPC, argsOf({ cmd: CMD(79) }))
      } finally {
        await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
      }
    }
    for (const level of REFUSED) expect(results[level], level).toMatchObject({ code: '25001', message: 'SETTINGS_ISOLATION' })
    expect(results['read committed']).toBeNull()
  })

  it('실행 권한 — 세션은 관리자여도 두 RPC 를 부르지 못하고 service_role 은 부른다', async () => {
    const DENIED = { code: '42501', message: expect.stringContaining('permission denied for function') }
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, RPC, argsOf({ cmd: CMD(80) }))).toMatchObject(DENIED)
      expect(await pgError(c, 'select public.copy_project_config($1, $2)', [F.projects.a, F.projects.aPrivate])).toMatchObject(DENIED)
    })
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      expect((await create(c, { cmd: CMD(80) })).status).toBe('applied')
    })
  })
})
