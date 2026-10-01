// 0012 ⑧-1 설정 RPC 의 일생(개정 §2.11 ① 의 DB 층) — 멱등·내용이 다른 재전송·값 불변·세대·넘침·격리 수준.
// 한 연결 케이스는 begin…rollback 이고 픽스처 프로젝트 A·워크스페이스 A 를 쓴다(픽스처의 revision 은 1). 두 연결 케이스만 데이터를
// 커밋한다 — 전용 프로젝트를 만들고 finally 에서 지운다. 정리 실패는 실패다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const P_RPC = 'select public.apply_project_settings($1, $2, $3, $4::jsonb, $5::text[], $6, $7, $8) as r'
const W_RPC = 'select public.apply_workspace_settings($1, $2, $3, $4::jsonb, $5::text[], $6, $7, $8) as r'
const CMD = (n: number) => `00000000-0000-4000-8000-0000000013${String(n).padStart(2, '0')}`
type Args = { rev: number | string; cmd: string; set?: unknown; unset?: string[] | null; actor?: string | null; ver?: number; source?: string }
const argsOf = (id: string, a: Args) => [id, a.rev, a.cmd, a.set === undefined ? null : JSON.stringify(a.set), a.unset ?? null,
  a.actor === undefined ? F.users.member : a.actor, a.ver ?? 1, a.source ?? 'edit']
const applyP = async (c: PoolClient, a: Args, id: string = F.projects.a) => (await c.query(P_RPC, argsOf(id, a))).rows[0].r as Record<string, unknown>
const applyW = async (c: PoolClient, a: Args, id: string = F.ws) => (await c.query(W_RPC, argsOf(id, a))).rows[0].r as Record<string, unknown>
const errP = (c: PoolClient, a: Args, id: string = F.projects.a) => pgError(c, P_RPC, argsOf(id, a))
const historyOf = async (c: PoolClient, cmd: string) =>
  (await c.query<{ key: string; revision: string; source: string }>(
    'select key, revision::text, source from public.project_settings_history where project_id = $1 and command_id = $2 order by key, revision',
    [F.projects.a, cmd])).rows
const docOf = async (c: PoolClient) =>
  (await c.query<{ revision: string; v: Record<string, unknown>; by: string | null }>(
    'select revision::text, "values" as v, updated_by as by from public.project_settings where project_id = $1', [F.projects.a])).rows[0]

describe('0012 ⑧-1 apply_project_settings — 한 연결', () => {
  it('값을 바꾸면 revision 이 1 오르고, 바뀐 키마다 이력 1행(전·후·출처·행위자)이 남는다', async () => {
    await asService(pool, async (c) => {
      expect(await applyP(c, { rev: 1, cmd: CMD(1), set: { 'core.milestone_keywords': ['milestone'], 'core.extra_axis_label': 'Track' } }))
        .toEqual({ status: 'applied', revision: 2 })
      expect(await docOf(c)).toMatchObject({ revision: '2', by: F.users.member,
        v: { 'core.milestone_keywords': ['milestone'], 'core.extra_axis_label': 'Track', 'core.level_labels': ['Phase', 'Task', 'Activity'] } })
      const { rows } = await c.query(
        `select key, old_value, new_value, source, changed_by, command_digest is not null as digest
           from public.project_settings_history where project_id = $1 and command_id = $2 order by key`, [F.projects.a, CMD(1)])
      expect(rows).toEqual([
        { key: 'core.extra_axis_label', old_value: null, new_value: 'Track', source: 'edit', changed_by: F.users.member, digest: true },
        { key: 'core.milestone_keywords', old_value: [], new_value: ['milestone'], source: 'edit', changed_by: F.users.member, digest: true },
      ])
    })
  })

  it('같은 명령 id 의 재전송은 duplicate 이고 그 명령이 만든 revision 을 돌려준다 — 이력은 한 벌', async () => {
    await asService(pool, async (c) => {
      const cmd = { rev: 1, cmd: CMD(2), set: { 'core.milestone_keywords': ['a'] } }
      expect(await applyP(c, cmd)).toEqual({ status: 'applied', revision: 2 })
      await applyP(c, { rev: 2, cmd: CMD(3), set: { 'core.extra_axis_label': 'x' } })           // 그사이 다른 명령
      expect(await applyP(c, cmd)).toEqual({ status: 'duplicate', revision: 2 })                 // expectedRevision 이 낡았어도 충돌이 아니다
      expect(await applyP(c, { ...cmd, rev: 3 })).toEqual({ status: 'duplicate', revision: 2 })  // 재기준한 재전송도 같은 명령이다
      expect(await historyOf(c, CMD(2))).toEqual([{ key: 'core.milestone_keywords', revision: '2', source: 'edit' }])
      expect((await docOf(c)).revision).toBe('3')
    })
  })

  it('같은 명령 id 로 다른 내용을 보내면 COMMAND_REUSED — 키를 더한 재전송, 값을 바꾼 재전송, unset 을 더한 재전송', async () => {
    const REUSED = { code: '23505', message: 'COMMAND_REUSED' }
    await asService(pool, async (c) => {
      await applyP(c, { rev: 1, cmd: CMD(4), set: { 'core.milestone_keywords': ['a'] } })
      expect(await errP(c, { rev: 1, cmd: CMD(4), set: { 'core.milestone_keywords': ['a'], 'core.extra_axis_label': 'x' } })).toMatchObject(REUSED)
      expect(await errP(c, { rev: 1, cmd: CMD(4), set: { 'core.milestone_keywords': ['b'] } })).toMatchObject(REUSED)
      expect(await errP(c, { rev: 1, cmd: CMD(4), set: { 'core.milestone_keywords': ['a'] }, unset: ['wbs.excel_profile'] })).toMatchObject(REUSED)
      expect((await docOf(c)).revision).toBe('2')
    })
  })

  it('unset 의 순서와 중복은 내용이 아니다 — 같은 명령으로 본다', async () => {
    await asService(pool, async (c) => {
      await applyP(c, { rev: 1, cmd: CMD(5), set: { 'core.extra_axis_label': 'x' } })
      expect(await applyP(c, { rev: 2, cmd: CMD(6), unset: ['core.milestone_keywords', 'core.extra_axis_label'] }))
        .toEqual({ status: 'applied', revision: 3 })
      expect(await applyP(c, { rev: 2, cmd: CMD(6), set: {}, unset: ['core.extra_axis_label', 'core.milestone_keywords', 'core.milestone_keywords'] }))
        .toEqual({ status: 'duplicate', revision: 3 })
    })
  })

  it('다른 행위자가 쓴 같은 명령 id 는 새 명령이다 — 남의 명령이 내 재전송으로 보이지 않는다', async () => {
    await asService(pool, async (c) => {
      expect(await applyP(c, { rev: 1, cmd: CMD(7), set: { 'core.extra_axis_label': 'alice' } })).toEqual({ status: 'applied', revision: 2 })
      expect(await applyP(c, { rev: 2, cmd: CMD(7), set: { 'core.extra_axis_label': 'cy' }, actor: F.users.aLoose }))
        .toEqual({ status: 'applied', revision: 3 })
      expect((await historyOf(c, CMD(7))).map((h) => h.revision)).toEqual(['2', '3'])
    })
  })

  it('값을 하나도 바꾸지 않는 명령은 applied·changed 0 — revision·이력·updated_by 가 그대로이고, 낡은 expectedRevision 이어도 충돌이 아니다', async () => {
    await asService(pool, async (c) => {
      const before = await docOf(c)
      const same = { rev: 999, cmd: CMD(8), set: { 'core.level_labels': ['Phase', 'Task', 'Activity'] }, unset: ['wbs.excel_profile'] }
      expect(await applyP(c, same)).toEqual({ status: 'applied', revision: 1, changed: 0 })
      expect(await applyP(c, same)).toEqual({ status: 'applied', revision: 1, changed: 0 })   // 재전송해도 같은 결과
      expect(await docOf(c)).toEqual(before)
      expect(await historyOf(c, CMD(8))).toEqual([])
    })
  })

  it('set 안의 JSON null 은 명시 값이고(키가 남는다) 키를 없애는 것은 unset 이다', async () => {
    await asService(pool, async (c) => {
      await applyP(c, { rev: 1, cmd: CMD(9), set: { 'core.extra_axis_label': null } })
      const has = async () => (await c.query<{ has: boolean; t: string | null }>(
        `select "values" ? 'core.extra_axis_label' as has, jsonb_typeof("values" -> 'core.extra_axis_label') as t
           from public.project_settings where project_id = $1`, [F.projects.a])).rows[0]
      expect(await has()).toEqual({ has: true, t: 'null' })
      await applyP(c, { rev: 2, cmd: CMD(10), unset: ['core.extra_axis_label'] })
      expect(await has()).toEqual({ has: false, t: null })
      const { rows } = await c.query(
        `select old_value is null as old_sql_null, jsonb_typeof(old_value) as old_t, new_value is null as new_sql_null, jsonb_typeof(new_value) as new_t
           from public.project_settings_history where project_id = $1 and key = 'core.extra_axis_label' order by revision`, [F.projects.a])
      expect(rows).toEqual([
        { old_sql_null: true, old_t: null, new_sql_null: false, new_t: 'null' },   // 미설정 → 명시 null
        { old_sql_null: false, old_t: 'null', new_sql_null: true, new_t: null },   // 명시 null → 설정 해제
      ])
    })
  })

  it('revision 이 다르면 SETTINGS_REVISION_CONFLICT 이고 detail 이 현재 revision 이다. 아무것도 쓰지 않는다', async () => {
    await asService(pool, async (c) => {
      const e = await errP(c, { rev: 0, cmd: CMD(11), set: { 'core.extra_axis_label': 'x' } })
      expect(e).toMatchObject({ code: 'P0001', message: 'SETTINGS_REVISION_CONFLICT', detail: '1' })
      expect((await docOf(c)).revision).toBe('1')
      expect(await historyOf(c, CMD(11))).toEqual([])
    })
  })

  it('저장본의 세대가 호출자보다 새면 SETTINGS_SCHEMA_AHEAD — 같거나 옛 세대는 쓰고 호출자의 세대를 남긴다', async () => {
    await asService(pool, async (c) => {
      await c.query('update public.project_settings set schema_version = 2 where project_id = $1', [F.projects.a])
      expect(await errP(c, { rev: 1, cmd: CMD(12), set: { 'core.extra_axis_label': 'x' }, ver: 1 }))
        .toMatchObject({ code: 'P0001', message: 'SETTINGS_SCHEMA_AHEAD' })
      expect(await applyP(c, { rev: 1, cmd: CMD(13), set: { 'core.extra_axis_label': 'x' }, ver: 3 })).toEqual({ status: 'applied', revision: 2 })
      expect((await c.query('select schema_version from public.project_settings where project_id = $1', [F.projects.a])).rows)
        .toEqual([{ schema_version: 3 }])
    })
  })

  it('revision 이 JS 정수 한계에 닿으면 SETTINGS_REVISION_OVERFLOW — 정밀도를 잃는 revision 을 만들지 않는다', async () => {
    await asService(pool, async (c) => {
      await c.query('update public.project_settings set revision = 9007199254740991 where project_id = $1', [F.projects.a])
      expect(await errP(c, { rev: '9007199254740991', cmd: CMD(14), set: { 'core.extra_axis_label': 'x' } }))
        .toMatchObject({ code: 'P0001', message: 'SETTINGS_REVISION_OVERFLOW' })
    })
  })

  it('행위자 없는 명령은 migration·internal 출처만 — edit·create·copy 는 SETTINGS_ACTOR_REQUIRED', async () => {
    await asService(pool, async (c) => {
      for (const source of ['edit', 'create', 'copy']) {
        expect(await errP(c, { rev: 1, cmd: CMD(15), set: { 'core.extra_axis_label': 'x' }, actor: null, source }), source)
          .toMatchObject({ code: '22023', message: 'SETTINGS_ACTOR_REQUIRED' })
      }
      expect(await applyP(c, { rev: 1, cmd: CMD(15), set: { 'core.extra_axis_label': 'x' }, actor: null, source: 'internal' }))
        .toEqual({ status: 'applied', revision: 2 })
      expect((await docOf(c)).by).toBeNull()
    })
  })

  it('명령 id 없는 명령은 COMMAND_ID_REQUIRED — 멱등을 잃은 채 쓰지 않는다(프로젝트·워크스페이스)', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, P_RPC, [F.projects.a, 1, null, JSON.stringify({ 'core.extra_axis_label': 'x' }), null, F.users.member, 1, 'edit']))
        .toMatchObject({ code: '22023', message: 'COMMAND_ID_REQUIRED' })
      expect(await pgError(c, W_RPC, [F.ws, 1, null, JSON.stringify({ 'ai.enabled': false }), null, F.users.member, 1, 'edit']))
        .toMatchObject({ code: '22023', message: 'COMMAND_ID_REQUIRED' })
      expect((await docOf(c)).revision).toBe('1')
    })
  })

  it('설정 행이 없는 프로젝트는 SETTINGS_ROW_MISSING, 객체가 아닌 p_set 은 CONFIG_INVALID:p_set', async () => {
    await asService(pool, async (c) => {
      expect(await errP(c, { rev: 0, cmd: CMD(16), set: { 'core.extra_axis_label': 'x' } }, '00000000-0000-0000-7e57-0000000013ff'))
        .toMatchObject({ code: 'P0001', message: 'SETTINGS_ROW_MISSING' })
      expect(await errP(c, { rev: 1, cmd: CMD(17), set: ['core.extra_axis_label'] }))
        .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:p_set' })
    })
  })

  it('격리 수준 — repeatable read·serializable·read uncommitted 는 SETTINGS_ISOLATION, read committed 는 통과(프로젝트·워크스페이스)', async () => {
    // RPC 는 행 잠금 뒤에 이력(같은 명령 id)을 읽어 판정한다. 트랜잭션 스냅샷 하나로 읽는 수준은 잠금을 기다리는 사이 커밋된 이력을 못 본다
    const ISOLATION = { code: '25001', message: 'SETTINGS_ISOLATION' }
    const REFUSED = ['repeatable read', 'serializable', 'read uncommitted']
    const results: Record<string, unknown> = {}
    for (const level of [...REFUSED, 'read committed']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        results[`p ${level}`] = await pgError(c, P_RPC, argsOf(F.projects.a, { rev: 1, cmd: CMD(18), set: { 'core.extra_axis_label': 'x' } }))
        results[`w ${level}`] = await pgError(c, W_RPC, argsOf(F.ws, { rev: 1, cmd: CMD(19), set: { 'ai.enabled': false } }))
      } finally {
        await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
      }
    }
    for (const level of REFUSED) {
      expect(results[`p ${level}`], level).toMatchObject(ISOLATION)
      expect(results[`w ${level}`], level).toMatchObject(ISOLATION)
    }
    expect(results['p read committed']).toBeNull()
    expect(results['w read committed']).toBeNull()
  })

  it('출처는 edit·internal·migration 뿐이다 — create·copy·모르는 값·null 은 CONFIG_INVALID:p_source(프로젝트·워크스페이스)', async () => {
    const INVALID = { code: '22023', message: 'CONFIG_INVALID:p_source' }
    await asService(pool, async (c) => {
      for (const source of ['create', 'copy', 'bogus']) {
        expect(await errP(c, { rev: 1, cmd: CMD(22), set: { 'core.extra_axis_label': 'x' }, source }), source).toMatchObject(INVALID)
        expect(await pgError(c, W_RPC, argsOf(F.ws, { rev: 1, cmd: CMD(22), set: { 'ai.enabled': false }, source })), source).toMatchObject(INVALID)
      }
      expect(await pgError(c, P_RPC, [F.projects.a, 1, CMD(22), JSON.stringify({ 'core.extra_axis_label': 'x' }), null, F.users.member, 1, null]))
        .toMatchObject(INVALID)
      expect((await docOf(c)).revision).toBe('1')
      expect(await historyOf(c, CMD(22))).toEqual([])
    })
  })

  it('세대가 null 이면 CONFIG_INVALID:p_schema_version — 세대 비교를 건너뛴 채 쓰지 않는다(프로젝트·워크스페이스)', async () => {
    const INVALID = { code: '22023', message: 'CONFIG_INVALID:p_schema_version' }
    await asService(pool, async (c) => {
      expect(await pgError(c, P_RPC, [F.projects.a, 1, CMD(23), JSON.stringify({ 'core.extra_axis_label': 'x' }), null, F.users.member, null, 'edit']))
        .toMatchObject(INVALID)
      expect(await pgError(c, W_RPC, [F.ws, 1, CMD(23), JSON.stringify({ 'ai.enabled': false }), null, F.users.member, null, 'edit']))
        .toMatchObject(INVALID)
      expect((await docOf(c)).revision).toBe('1')
    })
  })

  it("unset ['a,b'] 와 ['a','b'] 는 다른 내용이다 — 같은 명령 id 로 바꿔 보내면 COMMAND_REUSED(프로젝트·워크스페이스)", async () => {
    const REUSED = { code: '23505', message: 'COMMAND_REUSED' }
    await asService(pool, async (c) => {
      expect(await applyP(c, { rev: 1, cmd: CMD(24), set: { 'core.extra_axis_label': 'x' }, unset: ['core.milestone_keywords,wbs.excel_profile'] }))
        .toEqual({ status: 'applied', revision: 2 })
      expect(await errP(c, { rev: 1, cmd: CMD(24), set: { 'core.extra_axis_label': 'x' }, unset: ['core.milestone_keywords', 'wbs.excel_profile'] }))
        .toMatchObject(REUSED)
      expect(await applyW(c, { rev: 1, cmd: CMD(25), set: { 'ai.enabled': false }, unset: ['a', 'b'] })).toEqual({ status: 'applied', revision: 2 })
      expect(await pgError(c, W_RPC, argsOf(F.ws, { rev: 1, cmd: CMD(25), set: { 'ai.enabled': false }, unset: ['a,b'] }))).toMatchObject(REUSED)
    })
  })

  it('실행 권한 — 세션(authenticated)은 관리자여도 설정 RPC 둘과 디스패처를 부르지 못하고, service_role 은 설정 RPC 둘을 부른다', async () => {
    const DENIED = { code: '42501', message: expect.stringContaining('permission denied for function') }
    await asUser(pool, F.users.platform, async (c) => {
      expect(await errP(c, { rev: 1, cmd: CMD(20), set: { 'core.extra_axis_label': 'x' } })).toMatchObject(DENIED)
      expect(await pgError(c, W_RPC, argsOf(F.ws, { rev: 1, cmd: CMD(21), set: { 'ai.enabled': false } }))).toMatchObject(DENIED)
      expect(await pgError(c, `select public.settings_ref_check($1, 'core.level_labels', null, null)`, [F.projects.a])).toMatchObject(DENIED)
    })
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      expect(await applyP(c, { rev: 1, cmd: CMD(20), set: { 'core.extra_axis_label': 'x' } })).toEqual({ status: 'applied', revision: 2 })
      expect(await applyW(c, { rev: 1, cmd: CMD(21), set: { 'ai.enabled': false } })).toEqual({ status: 'applied', revision: 2 })
    })
  })
})

describe('0012 ⑧-1 apply_workspace_settings', () => {
  it('프로젝트 RPC 와 같은 계약 — 적용·중복·내용이 다른 재전송·값 불변·충돌', async () => {
    await asService(pool, async (c) => {
      const cmd = { rev: 1, cmd: CMD(30), set: { 'invites.allowed_domains': ['acme.test', 'example.com'] } }
      expect(await applyW(c, cmd)).toEqual({ status: 'applied', revision: 2 })
      expect(await applyW(c, cmd)).toEqual({ status: 'duplicate', revision: 2 })
      expect(await pgError(c, W_RPC, argsOf(F.ws, { ...cmd, set: { 'invites.allowed_domains': ['evil.test'] } })))
        .toMatchObject({ code: '23505', message: 'COMMAND_REUSED' })
      expect(await applyW(c, { rev: 0, cmd: CMD(31), set: { 'invites.allowed_domains': ['acme.test', 'example.com'] } }))
        .toEqual({ status: 'applied', revision: 2, changed: 0 })
      expect(await pgError(c, W_RPC, argsOf(F.ws, { rev: 1, cmd: CMD(32), unset: ['invites.allowed_domains'] })))
        .toMatchObject({ code: 'P0001', message: 'SETTINGS_REVISION_CONFLICT', detail: '2' })
      const { rows } = await c.query(
        `select key, old_value, new_value, source, changed_by from public.workspace_settings_history
          where workspace_id = $1 and command_id = $2`, [F.ws, CMD(30)])
      expect(rows).toEqual([{ key: 'invites.allowed_domains', old_value: ['example.com'], new_value: ['acme.test', 'example.com'],
        source: 'edit', changed_by: F.users.member }])
      expect((await c.query('select updated_by from public.workspace_settings where workspace_id = $1', [F.ws])).rows)
        .toEqual([{ updated_by: F.users.member }])
    })
  })
})

describe('0012 ⑧-1 같은 명령의 동시 재전송(두 연결)', () => {
  const P = '00000000-0000-0000-7e57-000000001321'
  const cleanup = () => pool.query('delete from public.projects where id = $1', [P])

  it('둘 다 같은 명령을 보내면 한쪽은 applied, 다른 쪽은 기다렸다가 duplicate — 충돌 0, 이력 한 벌', async () => {
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await cleanup()
      await pool.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 설정 동시 재전송', F.ws])
      // 행 생성 트리거가 있든 없든 같은 출발점(revision 1)이 되게 한다
      await pool.query(`insert into public.project_settings (project_id, "values", revision) values ($1, $2::jsonb, 1)
        on conflict (project_id) do update set "values" = excluded."values", revision = 1`,
        [P, JSON.stringify({ 'core.level_labels': ['A'], 'modules.enabled': [] })])
      s1 = await pool.connect()
      s2 = await pool.connect()
      const args = argsOf(P, { rev: 1, cmd: CMD(40), set: { 'core.milestone_keywords': ['x'] } })
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      expect((await s1.query(P_RPC, args)).rows[0].r).toEqual({ status: 'applied', revision: 2 })
      let settled = false
      const second = s2.query(P_RPC, args).then(
        (res) => res.rows[0].r as unknown, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      let blocked = false
      for (let i = 0; i < 250 && !settled && !blocked; i++) {
        blocked = (await s1.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [s2Pid])).rows[0].n > 0
        if (!blocked) await new Promise((r) => setTimeout(r, 20))
      }
      expect(blocked, '둘째 연결이 설정 행 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await second).toEqual({ status: 'duplicate', revision: 2 })
      const { rows } = await s1.query(
        'select revision::text, (select count(*)::int from public.project_settings_history h where h.project_id = s.project_id and h.command_id = $2) as n from public.project_settings s where s.project_id = $1',
        [P, CMD(40)])
      expect(rows).toEqual([{ revision: '2', n: 1 }])
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

describe('0012 ⑨-2 설정 이력은 고치거나 지울 수 없다', () => {
  const IMMUTABLE = { code: '55000', message: 'HISTORY_IMMUTABLE' }
  it('service_role 도 이력 행을 update·delete·truncate 하지 못한다 — 프로젝트·워크스페이스 이력 둘 다', async () => {
    await asService(pool, async (c) => {
      await applyP(c, { rev: 1, cmd: CMD(50), set: { 'core.extra_axis_label': 'x' } })
      await applyW(c, { rev: 1, cmd: CMD(51), set: { 'ai.enabled': false } })
      await c.query('set local role service_role')
      for (const [table, key, id] of [
        ['project_settings_history', 'project_id', F.projects.a], ['workspace_settings_history', 'workspace_id', F.ws],
      ] as const) {
        expect(await pgError(c, `update public.${table} set new_value = '"고친 값"'::jsonb where ${key} = $1`, [id]), table).toMatchObject(IMMUTABLE)
        expect(await pgError(c, `update public.${table} set changed_by = null where ${key} = $1`, [id]), table).toMatchObject(IMMUTABLE)
        expect(await pgError(c, `delete from public.${table} where ${key} = $1`, [id]), table).toMatchObject(IMMUTABLE)
        expect(await pgError(c, `truncate public.${table}`), `${table} truncate`).toMatchObject(IMMUTABLE)
      }
    })
  })

  it('설정을 바꾼 계정을 지워도 이력의 changed_by 는 그 id 로 남는다(FK 없음 — 계정 삭제가 막히지 않는다)', async () => {
    const U = '00000000-0000-0000-7e57-000000001302'
    await asService(pool, async (c) => {
      await c.query(`insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        aud, role, instance_id, created_at, updated_at) values ($1, 'rls-sp3a-gone@example.com', '', now(), '{}', '{}', 'authenticated',
        'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())`, [U])
      await applyP(c, { rev: 1, cmd: CMD(52), set: { 'core.extra_axis_label': 'x' }, actor: U })
      expect(await pgError(c, 'delete from auth.users where id = $1', [U])).toBeNull()
      expect((await c.query('select changed_by from public.project_settings_history where command_id = $1', [CMD(52)])).rows)
        .toEqual([{ changed_by: U }])
      expect((await docOf(c)).by).toBeNull()
    })
  })
})
