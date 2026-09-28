// 0012 ⑩ 권한 변경 이력 — 권한을 담는 표 셋(platform_admins·workspace_members·project_members)의 변경을 DB 트리거가 남긴다.
// 케이스는 begin…rollback 이다. 각 케이스는 시작할 때의 마지막 id(mark) 뒤에 생긴 행만 본다 — 픽스처 적재와 다른 테스트가 남긴 행에 기대지 않는다.
// 픽스처 A 행(7057001)은 overriding system value 로 넣어 시퀀스보다 크다 — mark·since 는 그 행을 빼고 센다(preflight B4).
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const INSERT_AUTH_USER = `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  aud, role, instance_id, created_at, updated_at) values ($1, $2, '', now(), '{}', '{}', 'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000', now(), now())`
const U = '00000000-0000-0000-7e57-000000001303'
const PERSON = '00000000-0000-0000-7e57-000000001304'
const W = '00000000-0000-0000-7e57-00000000aa32'
const P = '00000000-0000-0000-7e57-000000001325'
const IMMUTABLE = { code: '55000', message: 'HISTORY_IMMUTABLE' }
const DENIED = { code: '42501', message: expect.stringContaining('permission denied') }

type Ev = { kind: string; cause: string; workspace_id: string | null; project_id: string | null; target_user_id: string | null
  target_person_id: string | null; before: unknown; after: unknown; actor_user_id: string | null; command_id: string | null }
const mark = async (c: PoolClient) =>
  (await c.query<{ m: string }>('select coalesce(max(id), 0)::text as m from public.authz_events where id <> 7057001')).rows[0].m
const since = async (c: PoolClient, m: string) =>
  (await c.query<Ev>(`select kind, cause, workspace_id, project_id, target_user_id, target_person_id, before, after, actor_user_id, command_id::text
     from public.authz_events where id > $1::bigint and id <> 7057001 order by id`, [m])).rows
/** 같은 트랜잭션에서 세션 사용자로 바꾼다(asUser 와 같은 설정) — 끝나면 toServer 로 돌아온다 */
async function toSession(c: PoolClient, userId: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
}
async function toServer(c: PoolClient) {
  await c.query('reset role')
  await c.query(`select set_config('request.jwt.claims', '', true)`)
}
/** 계정 U — A 워크스페이스 멤버, 인물 PERSON, 프로젝트 A 의 명단 member */
async function tempAccount(c: PoolClient) {
  await c.query(INSERT_AUTH_USER, [U, 'rls-sp3a-acct@example.com'])
  await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.ws, U])
  await c.query(`insert into public.people (id, workspace_id, display_name, email, user_id) values ($1, $2, 'acct', 'rls-sp3a-acct@example.com', $3)`,
    [PERSON, F.ws, U])
  await c.query(`insert into public.project_members (project_id, person_id, access_role) values ($1, $2, 'member')`, [F.projects.a, PERSON])
}

describe('0012 ⑩-1 기록 — 세 종류의 변경마다 1행', () => {
  it('플랫폼 관리자 지정·해제 — 범위 id 는 둘 다 null, after 에 도장(granted_by)', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      await c.query('insert into public.platform_admins (user_id, granted_by) values ($1, $2)', [F.users.aLoose, F.users.platform])
      await c.query('delete from public.platform_admins where user_id = $1', [F.users.aLoose])
      expect(await since(c, m)).toEqual([
        { kind: 'platform_admin', cause: 'direct', workspace_id: null, project_id: null, target_user_id: F.users.aLoose, target_person_id: null,
          before: null, after: { granted: true, granted_by: F.users.platform }, actor_user_id: null, command_id: null },
        { kind: 'platform_admin', cause: 'direct', workspace_id: null, project_id: null, target_user_id: F.users.aLoose, target_person_id: null,
          before: { granted: true }, after: null, actor_user_id: null, command_id: null },
      ])
    })
  })

  it('워크스페이스 등급 — 가입·등급 변경·탈퇴. 같은 등급으로의 update 는 기록하지 않는다', async () => {
    await asService(pool, async (c) => {
      await c.query(INSERT_AUTH_USER, [U, 'rls-sp3a-acct@example.com'])
      const m = await mark(c)
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role, invited_by) values ($1, $2, 'member', $3)`,
        [F.ws, U, F.users.wsAdmin])
      await c.query(`update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`, [F.ws, U])
      await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.ws, U])
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, U])
      expect((await since(c, m)).map((e) => [e.kind, e.cause, e.workspace_id, e.target_user_id, e.before, e.after])).toEqual([
        ['workspace_role', 'direct', F.ws, U, null, { role: 'member', invited_by: F.users.wsAdmin }],
        ['workspace_role', 'direct', F.ws, U, { role: 'member' }, { role: 'admin' }],
        ['workspace_role', 'direct', F.ws, U, { role: 'admin' }, null],
      ])
    })
  })

  it('명단 권한 — 부여·변경·회수·삭제. 권한 없는 명단 행(access_role null)과 권한 밖 열의 변경은 기록하지 않는다', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      await tempAccount(c)
      const row = [F.projects.a, PERSON]
      await c.query(`update public.project_members set title = 'PM' where project_id = $1 and person_id = $2`, row)
      await c.query(`update public.project_members set access_role = 'admin' where project_id = $1 and person_id = $2`, row)
      await c.query('update public.project_members set access_role = null where project_id = $1 and person_id = $2', row)
      await c.query('delete from public.project_members where project_id = $1 and person_id = $2', row)   // access_role null — 기록 없음
      const got = (await since(c, m)).filter((e) => e.kind === 'project_access')
      expect(got.map((e) => [e.cause, e.workspace_id, e.project_id, e.target_user_id, e.target_person_id, e.before, e.after])).toEqual([
        ['direct', F.ws, F.projects.a, U, PERSON, null, { access_role: 'member', access_granted_by: null }],
        ['direct', F.ws, F.projects.a, U, PERSON, { access_role: 'member' }, { access_role: 'admin' }],
        ['direct', F.ws, F.projects.a, U, PERSON, { access_role: 'admin' }, { access_role: null }],
      ])
    })
  })
})

describe('0012 ⑩-1 행위자와 원인', () => {
  it('세션의 변경은 그 세션 사용자가 행위자다 — 등급 변경·삭제, 그리고 삭제가 일으킨 명단 권한 회수(cascade)', async () => {
    await asService(pool, async (c) => {
      await tempAccount(c)
      const m = await mark(c)
      await toSession(c, F.users.wsAdmin)
      await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.ws, U])
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, U])
      await toServer(c)
      expect((await since(c, m)).map((e) => [e.kind, e.cause, e.before, e.after, e.actor_user_id])).toEqual([
        ['workspace_role', 'direct', { role: 'member' }, { role: 'admin' }, F.users.wsAdmin],
        ['workspace_role', 'direct', { role: 'admin' }, null, F.users.wsAdmin],
        ['project_access', 'cascade', { access_role: 'member' }, { access_role: null }, F.users.wsAdmin],
      ])
    })
  })

  it('행위자 설정 없는 서버 경로의 변경은 행위자가 null 이다 — 저장된 도장(초대한 사람)을 행위자로 읽지 않는다', async () => {
    await asService(pool, async (c) => {
      await c.query(INSERT_AUTH_USER, [U, 'rls-sp3a-acct@example.com'])
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role, invited_by) values ($1, $2, 'member', $3)`,
        [F.ws, U, F.users.wsAdmin])
      const m = await mark(c)
      await c.query('set local role service_role')
      await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.ws, U])
      await c.query('reset role')
      expect((await since(c, m)).map((e) => [e.before, e.after, e.actor_user_id])).toEqual([[{ role: 'member' }, { role: 'admin' }, null]])
    })
  })

  it('권한 RPC 가 넘긴 행위자·명령 id 는 트랜잭션 설정으로 읽는다. 세션 사용자가 있으면 설정을 읽지 않는다(행위자는 세션 사용자, 명령 id 는 null)', async () => {
    const CMD = '00000000-0000-4000-8000-000000001390'
    await asService(pool, async (c) => {
      await c.query(INSERT_AUTH_USER, [U, 'rls-sp3a-acct@example.com'])
      const m = await mark(c)
      await c.query(`select set_config('app.authz_actor', $1, true), set_config('app.command_id', $2, true), set_config('app.command_digest', 'd1', true)`,
        [F.users.platform, CMD])
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.ws, U])
      await toSession(c, F.users.wsAdmin)
      await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.ws, U])
      await toServer(c)
      // 세션 사용자가 있는 변경은 설정을 하나도 읽지 않는다 — 명령 id 가 켜져 있어도 남기지 않는다.
      // 빈 문자열은 없음이다 — RPC 가 끝에서 설정을 비운다
      await c.query(`select set_config('app.authz_actor', '', true), set_config('app.command_id', '', true), set_config('app.command_digest', '', true)`)
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, U])
      expect((await since(c, m)).map((e) => [e.after, e.actor_user_id, e.command_id])).toEqual([
        [{ role: 'member', invited_by: null }, F.users.platform, CMD],
        [{ role: 'admin' }, F.users.wsAdmin, null],
        [null, null, null],
      ])
    })
  })

  it('프로젝트를 지우면 명단 권한의 회수가 parent_deleted 로 남고, 그 워크스페이스 관리자가 읽는다', async () => {
    await asService(pool, async (c) => {
      await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'Acme 지울 프로젝트', F.ws])
      await c.query(`insert into public.project_members (project_id, person_id, access_role) values ($1, $2, 'member')`, [P, F.people.dualA])
      const m = await mark(c)
      expect(await pgError(c, 'delete from public.projects where id = $1', [P])).toBeNull()
      expect((await since(c, m)).map((e) => [e.kind, e.cause, e.workspace_id, e.project_id, e.target_user_id, e.target_person_id, e.before, e.after]))
        .toEqual([['project_access', 'parent_deleted', F.ws, P, F.users.dual, F.people.dualA, { access_role: 'member' }, null]])
      await toSession(c, F.users.wsAdmin)
      expect((await c.query('select 1 from public.authz_events where project_id = $1', [P])).rowCount).toBe(2)   // 부여 + 회수
      await toServer(c)
    })
  })

  it('계정을 지울 수 있고, 소속의 소멸이 parent_deleted 로 남는다. 명단 권한 회수는 cascade 다', async () => {
    await asService(pool, async (c) => {
      await tempAccount(c)
      await c.query('insert into public.platform_admins (user_id) values ($1)', [U])
      const m = await mark(c)
      expect(await pgError(c, 'delete from auth.users where id = $1', [U])).toBeNull()
      const got = await since(c, m)
      expect(got.filter((e) => e.kind !== 'project_access').map((e) => [e.kind, e.cause, e.target_user_id, e.before, e.after]).sort()).toEqual([
        ['platform_admin', 'parent_deleted', U, { granted: true }, null],
        ['workspace_role', 'parent_deleted', U, { role: 'member' }, null],
      ])
      // 계정이 지워질 때 people.user_id 가 먼저 null 이 된다 — 명단의 회수 기록은 대상 계정이 비고 인물 id 로 남는다
      expect(got.filter((e) => e.kind === 'project_access').map((e) => [e.cause, e.target_person_id, e.before, e.after]))
        .toEqual([['cascade', PERSON, { access_role: 'member' }, { access_role: null }]])
    })
  })

  it('기록 범위의 기본값은 전부(all)다 — 스펙 §9 #3 의 한 곳', async () => {
    const { rows } = await pool.query<{ src: string }>(`select prosrc as src from pg_proc where oid = 'public.record_authz_event()'::regprocedure`)
    expect(rows[0].src).toMatch(/c_scope constant text := 'all';/)
  })
})

describe('0012 ⑩-1 보관 — 고칠 수 없고, 워크스페이스가 사라진 뒤에만 정리한다', () => {
  it('세션·anon 은 직접 쓰지 못하고(42501), service_role 도 update·delete 하지 못한다(HISTORY_IMMUTABLE)', async () => {
    await asUser(pool, F.users.platform, async (c) => {
      for (const sql of [
        `insert into public.authz_events (kind, cause, target_user_id) values ('platform_admin', 'direct', $1)`,
        `update public.authz_events set cause = 'direct' where target_user_id = $1`,
        `delete from public.authz_events where target_user_id = $1`,
      ]) expect(await pgError(c, sql, [F.users.aLoose]), sql.slice(0, 6)).toMatchObject(DENIED)
    })
    await asService(pool, async (c) => {
      await c.query('set local role anon')
      expect(await pgError(c, 'select 1 from public.authz_events limit 1')).toMatchObject(DENIED)
      await c.query('reset role')
      await c.query('set local role service_role')
      expect(await pgError(c, `update public.authz_events set actor_user_id = null where id = 7057001`)).toMatchObject(IMMUTABLE)
      expect(await pgError(c, 'delete from public.authz_events where id = 7057001')).toMatchObject(IMMUTABLE)
      expect(await pgError(c, 'truncate public.authz_events')).toMatchObject(IMMUTABLE)
      expect(await pgError(c, `select set_config('app.authz_purge', 'on', true)`)).toBeNull()
      expect(await pgError(c, 'delete from public.authz_events where id = 7057001'), '워크스페이스가 있으면 스위치만으로는 못 지운다')
        .toMatchObject(IMMUTABLE)
    })
  })

  it('소속 행이 있는 워크스페이스를 지우면 그 워크스페이스의 권한 기록이 0행이 된다. 다른 워크스페이스의 행과 플랫폼 행은 남는다', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp3a-authz', 'Acme Authz')`, [W])
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')`,
        [W, F.users.aLoose, F.users.bMember])
      await c.query('insert into public.platform_admins (user_id) values ($1)', [F.users.aLoose])   // 플랫폼 행 하나
      const count = async () => (await c.query<{ w: number; a: number; platform: number }>(
        `select count(*) filter (where workspace_id = $1)::int as w, count(*) filter (where workspace_id = $2)::int as a,
                count(*) filter (where kind = 'platform_admin')::int as platform from public.authz_events`, [W, F.ws])).rows[0]
      const before = await count()
      expect(before.w).toBe(2)
      expect(before.a).toBeGreaterThan(0)
      expect(before.platform).toBeGreaterThan(0)
      expect(await pgError(c, 'select public.purge_authz_events($1)', [W]), '워크스페이스가 있는 동안은 정리할 수 없다').toMatchObject(IMMUTABLE)
      expect(await pgError(c, 'delete from public.workspaces where id = $1', [W])).toBeNull()
      // 삭제의 연쇄(소속 2행 소멸)는 기록하지 않고, 정리 트리거가 그 워크스페이스의 기록을 지운다
      expect(await count()).toEqual({ w: 0, a: before.a, platform: before.platform })
      expect((await c.query<{ v: string }>(`select current_setting('app.authz_purge', true) as v`)).rows[0].v, '스위치가 켜진 채 남지 않는다').toBe('')
    })
  })

  it('워크스페이스가 사라진 뒤에도 직접 삭제는 못 한다 — 지우는 길은 purge_authz_events 하나다', async () => {
    await asService(pool, async (c) => {
      // 정리 트리거를 끈 채 워크스페이스를 지워, 부모 없는 기록이 남은 상태를 만든다(트리거가 없던 DB 에서 온 행을 흉내 낸다)
      await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp3a-authz', 'Acme Authz')`, [W])
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')`, [W, F.users.aLoose])
      await c.query('alter table public.workspaces disable trigger workspaces_purge_authz_events')
      await c.query('delete from public.workspaces where id = $1', [W])
      await c.query('alter table public.workspaces enable trigger workspaces_purge_authz_events')
      const left = async () => (await c.query('select 1 from public.authz_events where workspace_id = $1', [W])).rowCount
      expect(await left()).toBe(1)
      await c.query('set local role service_role')
      expect(await pgError(c, 'delete from public.authz_events where workspace_id = $1', [W]), '직접 삭제').toMatchObject(IMMUTABLE)
      expect((await c.query<{ n: number }>('select public.purge_authz_events($1) as n', [W])).rows[0].n).toBe(1)
      await c.query('reset role')
      expect(await left()).toBe(0)
      expect(await pgError(c, 'select public.purge_authz_events(null)')).toMatchObject({ code: '22023', message: 'AUTHZ_PURGE_WORKSPACE_REQUIRED' })
    })
  })

  it('세션이 부를 수 있는 함수 가운데 트랜잭션 설정을 켜는 것은 없다 — 세션은 app.authz_*·app.command_* 를 위조할 길이 없다', async () => {
    // 세션이 DB 에 닿는 길은 PostgREST 의 public 함수뿐이다(set_config 는 pg_catalog). 본문에 set_config·set local 이 든 함수가
    // anon·authenticated 에 열리면 그 함수가 설정을 켜는 길이 된다
    const { rows } = await pool.query<{ fn: string }>(
      `select format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) as fn from pg_proc p
        where p.pronamespace in ('public'::regnamespace, 'graphql_public'::regnamespace)
          and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
          and p.prosrc ~* '(set_config|set\\s+local)' order by 1`)
    expect(rows.map((r) => r.fn)).toEqual([])
  })

  it('정리 함수는 세션이 부르지 못한다', async () => {
    await asUser(pool, F.users.platform, async (c) =>
      expect(await pgError(c, 'select public.purge_authz_events($1)', [F.ws]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function') }))
  })
})

describe('0012 ⑩ 명령 원장 authz_commands·권한 표 TRUNCATE', () => {
  it('세션·anon 은 명령 원장을 읽지도 쓰지도 못하고, service_role 도 고치거나 지우거나 비우지 못한다', async () => {
    await asUser(pool, F.users.platform, async (c) => {
      for (const sql of [
        'select 1 from public.authz_commands where actor_user_id = $1 or workspace_id = $2 limit 1',
        `insert into public.authz_commands (actor_user_id, kind, scope_id, command_id, workspace_id, command_digest, result)
           values ($1, 'workspace_role', $2, gen_random_uuid(), $2, 'x', '{}')`,
        `delete from public.authz_commands where actor_user_id = $1 or workspace_id = $2`,
      ]) expect(await pgError(c, sql, [F.users.platform, F.ws]), sql.slice(0, 12)).toMatchObject(DENIED)
    })
    await asService(pool, async (c) => {
      await c.query('set local role anon')
      expect(await pgError(c, 'select 1 from public.authz_commands limit 1')).toMatchObject(DENIED)
      await c.query('reset role')
      await c.query('set local role service_role')
      const probe = `workspace_id = '${F.ws}' and command_id = '00000000-0000-0000-7e57-000000001312'`
      expect((await c.query(`select 1 from public.authz_commands where ${probe}`)).rowCount, '픽스처 A 행').toBe(1)
      expect(await pgError(c, `update public.authz_commands set result = '{}' where ${probe}`)).toMatchObject(IMMUTABLE)
      expect(await pgError(c, `delete from public.authz_commands where ${probe}`)).toMatchObject(IMMUTABLE)
      expect(await pgError(c, 'truncate public.authz_commands')).toMatchObject(IMMUTABLE)
    })
  })

  it('워크스페이스를 지우면 그 워크스페이스의 명령 원장도 지워진다 — 플랫폼 명령은 남는다', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp3a-authz', 'Acme Authz')`, [W])
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')`,
        [W, F.users.aLoose, F.users.bMember])
      await c.query('select public.set_workspace_role($1, $2, $3, $4, $5)', [F.users.platform, W, F.users.bMember, 'admin', '00000000-0000-4000-8000-0000000013e8'])
      await c.query('select public.set_platform_admin($1, $2, $3, $4)', [F.users.platform, F.users.aLoose, true, '00000000-0000-4000-8000-0000000013e9'])
      const count = async () => (await c.query<{ w: number; platform: number }>(
        `select count(*) filter (where workspace_id = $1)::int as w, count(*) filter (where kind = 'platform_admin')::int as platform
           from public.authz_commands`, [W])).rows[0]
      const before = await count()
      expect(before.w).toBe(1)
      expect(before.platform).toBeGreaterThan(0)
      expect(await pgError(c, 'delete from public.workspaces where id = $1', [W])).toBeNull()
      expect(await count()).toEqual({ w: 0, platform: before.platform })
    })
  })

  it('service_role 도 권한 세 표를 TRUNCATE 하지 못한다 — 기록 트리거와 마지막 관리자 가드를 건너뛰는 길이다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      // cascade 로 — project_members 는 참조하는 표가 있어 cascade 없는 TRUNCATE 는 트리거 전에 0A000 으로 끝난다(그것도 거부다)
      for (const t of ['platform_admins', 'workspace_members', 'project_members']) {
        expect(await pgError(c, `truncate public.${t} cascade`), t).toMatchObject({ code: '55000', message: 'AUTHZ_TRUNCATE_FORBIDDEN' })
      }
    })
  })
})

describe('0012 ⑩-1 읽기와 초대자 도장', () => {
  it('워크스페이스 관리자는 자기 워크스페이스의 기록만, 플랫폼 관리자는 전부, 멤버는 0행. B 관리자는 A 의 기록을 읽지 못한다', async () => {
    const seen = async (uid: string) => asUser(pool, uid, async (c) =>
      (await c.query<{ a: number; platform: number }>(
        `select count(*) filter (where workspace_id = $1)::int as a, count(*) filter (where kind = 'platform_admin')::int as platform
           from public.authz_events`, [F.ws])).rows[0])
    const admin = await seen(F.users.wsAdmin)
    expect(admin.a).toBeGreaterThan(0)
    expect(admin.platform).toBe(0)
    expect((await seen(F.users.platform)).a).toBe(admin.a)
    expect(await seen(F.users.aLoose)).toEqual({ a: 0, platform: 0 })
    expect(await seen(F.users.bAdmin)).toEqual({ a: 0, platform: 0 })
  })

  it('세션이 넣은 invited_by 는 세션 사용자로 덮인다(위조 불가). 서버 경로는 넘어온 값을 둔다', async () => {
    await asService(pool, async (c) => {
      await c.query(INSERT_AUTH_USER, [U, 'rls-sp3a-acct@example.com'])
      await toSession(c, F.users.wsAdmin)
      const { rows } = await c.query(
        `insert into public.workspace_members (workspace_id, user_id, role, invited_by) values ($1, $2, 'member', $3) returning invited_by`,
        [F.ws, U, F.users.platform])
      expect(rows).toEqual([{ invited_by: F.users.wsAdmin }])
      await toServer(c)
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, U])
      const kept = await c.query(
        `insert into public.workspace_members (workspace_id, user_id, role, invited_by) values ($1, $2, 'member', $3) returning invited_by`,
        [F.ws, U, F.users.platform])
      expect(kept.rows).toEqual([{ invited_by: F.users.platform }])
    })
  })
})

describe('0012 ⑩-2 권한 RPC', () => {
  const CMD = (n: number) => `00000000-0000-4000-8000-0000000013${n.toString(16).padStart(2, '0')}`
  const WS_ROLE = 'select public.set_workspace_role($1, $2, $3, $4, $5) as r'
  const PLATFORM = 'select public.set_platform_admin($1, $2, $3, $4) as r'
  const ROSTER = 'select public.upsert_project_member_cmd($1, $2, $3::jsonb, $4::jsonb, $5::uuid[], $6) as r'
  const REUSED = { code: '23505', message: 'COMMAND_REUSED' }
  const call = async (c: PoolClient, sql: string, params: unknown[]) => (await c.query(sql, params)).rows[0].r as Record<string, unknown>
  const cy = JSON.stringify({ id: F.people.aLoose })
  const PLATFORM_SCOPE = '00000000-0000-0000-0000-000000000000'
  /** 명령 원장(authz_commands)의 한 행 — 결과와 보관 규칙의 워크스페이스 */
  const commandOf = async (c: PoolClient, actor: string, kind: string, scope: string, cmd: string) =>
    (await c.query<{ result: unknown; ws: string | null }>(`select result, workspace_id as ws from public.authz_commands
       where actor_user_id = $1 and kind = $2 and scope_id = $3 and command_id = $4`, [actor, kind, scope, cmd])).rows[0]

  it('워크스페이스 등급 — 변경 1행(전·후·행위자·명령 id), 재전송은 duplicate·1행, 같은 id 로 다른 대상은 COMMAND_REUSED', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      expect(await call(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'admin', CMD(0xa0)])).toEqual({ status: 'applied', matched: 1 })
      expect(await call(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'admin', CMD(0xa0)])).toEqual({ status: 'duplicate', matched: 1 })
      expect(await pgError(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.member, 'admin', CMD(0xa0)])).toMatchObject(REUSED)
      expect(await pgError(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'member', CMD(0xa0)])).toMatchObject(REUSED)
      expect((await since(c, m)).map((e) => [e.kind, e.cause, e.workspace_id, e.target_user_id, e.before, e.after, e.actor_user_id, e.command_id]))
        .toEqual([['workspace_role', 'direct', F.ws, F.users.aLoose, { role: 'member' }, { role: 'admin' }, F.users.wsAdmin, CMD(0xa0)]])
      // 설정은 RPC 가 끝나면 비어 있다 — 같은 트랜잭션의 뒤 변경에 옛 행위자가 묻지 않는다
      expect((await c.query(`select current_setting('app.authz_actor', true) as a, current_setting('app.command_id', true) as c`)).rows)
        .toEqual([{ a: '', c: '' }])
    })
  })

  it('워크스페이스 등급 — 등급 없는 행위자는 AUTHZ_FORBIDDEN, 대상이 소속이 아니면 matched 0, 마지막 관리자의 강등은 DB 토큰 그대로', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      for (const actor of [F.users.member, F.users.aLoose, F.users.bAdmin]) {   // A 의 멤버·명단 admin, B 의 관리자 — A 관리자가 아니다
        expect(await pgError(c, WS_ROLE, [actor, F.ws, F.users.aLoose, 'admin', CMD(0xa1)]), actor)
          .toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      }
      expect(await call(c, WS_ROLE, [F.users.platform, F.ws, F.users.aLoose, 'admin', CMD(0xa2)]), '플랫폼 관리자는 모든 워크스페이스에서')
        .toEqual({ status: 'applied', matched: 1 })
      expect(await call(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.bAdmin, 'admin', CMD(0xa3)])).toEqual({ status: 'applied', matched: 0 })
      await c.query(`update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`, [F.ws, F.users.aLoose])
      expect(await pgError(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.wsAdmin, 'member', CMD(0xa4)]))
        .toMatchObject({ code: '23514', message: 'WORKSPACE_LAST_ADMIN' })
      expect(await pgError(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'owner', CMD(0xa5)]))
        .toMatchObject({ code: '22023', message: 'AUTHZ_INVALID_INPUT' })
      expect((await since(c, m)).filter((e) => e.command_id !== null).map((e) => e.command_id)).toEqual([CMD(0xa2)])
    })
  })

  it('같은 등급으로의 변경은 기록(authz_events)이 없지만 명령 원장에는 남는다 — 그 재전송은 저장한 결과의 duplicate 다', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      expect(await call(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'member', CMD(0xa6)])).toEqual({ status: 'applied', matched: 1 })
      expect(await call(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'member', CMD(0xa6)])).toEqual({ status: 'duplicate', matched: 1 })
      expect(await since(c, m)).toEqual([])
      expect(await commandOf(c, F.users.wsAdmin, 'workspace_role', F.ws, CMD(0xa6))).toEqual({ result: { status: 'applied', matched: 1 }, ws: F.ws })
    })
  })

  it('바뀐 것 없는 명령의 재전송은 그사이 다른 관리자가 한 변경을 되돌리지 않는다 — 플랫폼 관리자(리뷰 I1 의 재현)', async () => {
    await asService(pool, async (c) => {
      await c.query('insert into public.platform_admins (user_id, granted_by) values ($1, $2), ($3, $2)',
        [F.users.aLoose, F.users.platform, F.users.wsAdmin])
      // X: 이미 관리자인 aLoose 를 다시 지정(바뀐 것 없음) → Y: 다른 관리자가 해제 → X 의 재전송
      expect(await call(c, PLATFORM, [F.users.platform, F.users.aLoose, true, CMD(0xb5)])).toEqual({ status: 'applied', matched: 0 })
      expect(await call(c, PLATFORM, [F.users.wsAdmin, F.users.aLoose, false, CMD(0xb6)])).toEqual({ status: 'applied', matched: 1 })
      const m = await mark(c)
      expect(await call(c, PLATFORM, [F.users.platform, F.users.aLoose, true, CMD(0xb5)])).toEqual({ status: 'duplicate', matched: 0 })
      expect((await c.query('select 1 from public.platform_admins where user_id = $1', [F.users.aLoose])).rowCount, '다시 지정되지 않는다').toBe(0)
      expect(await since(c, m)).toEqual([])
    })
  })

  it('바뀐 것 없는 명령의 재전송은 그사이 다른 관리자가 한 변경을 되돌리지 않는다 — 워크스페이스 등급(리뷰 I1 의 재현)', async () => {
    await asService(pool, async (c) => {
      // X: 이미 member 인 aLoose 를 member 로(바뀐 것 없음) → Y: 플랫폼 관리자가 admin 으로 → X 의 재전송
      expect(await call(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'member', CMD(0xa7)])).toEqual({ status: 'applied', matched: 1 })
      expect(await call(c, WS_ROLE, [F.users.platform, F.ws, F.users.aLoose, 'admin', CMD(0xa8)])).toEqual({ status: 'applied', matched: 1 })
      const m = await mark(c)
      expect(await call(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'member', CMD(0xa7)])).toEqual({ status: 'duplicate', matched: 1 })
      expect((await c.query('select role from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.aLoose])).rows,
        '강등되지 않는다').toEqual([{ role: 'admin' }])
      expect(await since(c, m)).toEqual([])
    })
  })

  it('바뀐 것 없는 명령의 재전송은 그사이 다른 관리자가 한 변경을 되돌리지 않는다 — 명단 권한(리뷰 I1 의 재현)', async () => {
    await asService(pool, async (c) => {
      const member = JSON.stringify({ access_role: 'member' })
      await call(c, ROSTER, [F.users.member, F.projects.a, cy, member, null, CMD(0xc5)])
      // X: 이미 member 인 aLoose 를 member 로(바뀐 것 없음) → Y: 워크스페이스 관리자가 admin 으로 → X 의 재전송
      const x = await call(c, ROSTER, [F.users.member, F.projects.a, cy, member, null, CMD(0xc6)])
      expect(x).toEqual({ status: 'applied', member_id: expect.stringMatching(/^[0-9a-f-]{36}$/) })
      expect(await call(c, ROSTER, [F.users.wsAdmin, F.projects.a, cy, JSON.stringify({ access_role: 'admin' }), null, CMD(0xc7)]))
        .toEqual({ status: 'applied', member_id: x.member_id })
      const m = await mark(c)
      expect(await call(c, ROSTER, [F.users.member, F.projects.a, cy, member, null, CMD(0xc6)])).toEqual({ status: 'duplicate', member_id: x.member_id })
      expect((await c.query('select access_role from public.project_members where project_id = $1 and person_id = $2', [F.projects.a, F.people.aLoose])).rows,
        '강등되지 않는다').toEqual([{ access_role: 'admin' }])
      expect(await since(c, m)).toEqual([])
    })
  })

  it('이미 관리자인 계정의 지정은 matched 0 이다(해제할 관리자가 없는 해제와 같다)', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      expect(await call(c, PLATFORM, [F.users.platform, F.users.platform, true, CMD(0xb7)])).toEqual({ status: 'applied', matched: 0 })
      expect(await since(c, m)).toEqual([])
      expect(await commandOf(c, F.users.platform, 'platform_admin', PLATFORM_SCOPE, CMD(0xb7)))
        .toEqual({ result: { status: 'applied', matched: 0 }, ws: null })
    })
  })

  it('플랫폼 관리자 — 지정·해제가 각 1행, 재전송은 duplicate, 슈퍼유저가 아닌 계정의 해제는 matched 0, 마지막 한 명은 DB 토큰 그대로', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      expect(await call(c, PLATFORM, [F.users.platform, F.users.aLoose, true, CMD(0xb0)])).toEqual({ status: 'applied', matched: 1 })
      expect(await call(c, PLATFORM, [F.users.platform, F.users.aLoose, true, CMD(0xb0)])).toEqual({ status: 'duplicate', matched: 1 })
      expect(await pgError(c, PLATFORM, [F.users.platform, F.users.aLoose, false, CMD(0xb0)])).toMatchObject(REUSED)
      expect(await call(c, PLATFORM, [F.users.platform, F.users.aLoose, false, CMD(0xb1)])).toEqual({ status: 'applied', matched: 1 })
      expect(await call(c, PLATFORM, [F.users.platform, F.users.aLoose, false, CMD(0xb2)])).toEqual({ status: 'applied', matched: 0 })
      expect(await pgError(c, PLATFORM, [F.users.wsAdmin, F.users.aLoose, true, CMD(0xb3)])).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      expect((await since(c, m)).map((e) => [e.kind, e.target_user_id, e.before, e.after, e.actor_user_id, e.command_id])).toEqual([
        ['platform_admin', F.users.aLoose, null, { granted: true, granted_by: F.users.platform }, F.users.platform, CMD(0xb0)],
        ['platform_admin', F.users.aLoose, { granted: true }, null, F.users.platform, CMD(0xb1)],
      ])
      await c.query('delete from public.platform_admins where user_id <> $1', [F.users.platform])
      expect(await pgError(c, PLATFORM, [F.users.platform, F.users.platform, false, CMD(0xb4)]))
        .toMatchObject({ code: '23514', message: 'PLATFORM_LAST_ADMIN' })
    })
  })

  it('명단 권한 — 부여 1행과 명단 행 id, 재전송은 같은 id 의 duplicate, 같은 id 로 다른 인물은 COMMAND_REUSED', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      const first = await call(c, ROSTER, [F.users.member, F.projects.a, cy, JSON.stringify({ access_role: 'member' }), null, CMD(0xc0)])
      expect(first).toEqual({ status: 'applied', member_id: expect.stringMatching(/^[0-9a-f-]{36}$/) })
      expect(await call(c, ROSTER, [F.users.member, F.projects.a, cy, JSON.stringify({ access_role: 'member' }), null, CMD(0xc0)]))
        .toEqual({ status: 'duplicate', member_id: first.member_id })
      expect(await pgError(c, ROSTER, [F.users.member, F.projects.a, JSON.stringify({ id: F.people.dualA }), JSON.stringify({ access_role: 'admin' }), null, CMD(0xc0)]))
        .toMatchObject(REUSED)
      expect((await since(c, m)).map((e) => [e.kind, e.cause, e.workspace_id, e.project_id, e.target_user_id, e.target_person_id, e.before, e.after,
        e.actor_user_id, e.command_id])).toEqual([['project_access', 'direct', F.ws, F.projects.a, F.users.aLoose, F.people.aLoose, null,
        { access_role: 'member', access_granted_by: F.users.member }, F.users.member, CMD(0xc0)]])
      expect((await c.query('select id from public.project_members where project_id = $1 and person_id = $2', [F.projects.a, F.people.aLoose])).rows)
        .toEqual([{ id: first.member_id }])
    })
  })

  it('명단 권한 — 권한이 바뀌지 않는 upsert(직함만)는 기록이 없고 재전송은 저장한 결과의 duplicate 다. 등급 없는 행위자는 PROJECT_MEMBER_FORBIDDEN', async () => {
    await asService(pool, async (c) => {
      await call(c, ROSTER, [F.users.member, F.projects.a, cy, JSON.stringify({ access_role: 'member' }), null, CMD(0xc1)])
      const m = await mark(c)
      const titled = await call(c, ROSTER, [F.users.member, F.projects.a, cy, JSON.stringify({ title: 'PM' }), null, CMD(0xc2)])
      expect(titled.status).toBe('applied')
      expect(await call(c, ROSTER, [F.users.member, F.projects.a, cy, JSON.stringify({ title: 'PM' }), null, CMD(0xc2)]))
        .toEqual({ status: 'duplicate', member_id: titled.member_id })
      expect(await since(c, m)).toEqual([])
      expect((await commandOf(c, F.users.member, 'project_access', F.projects.a, CMD(0xc2)))?.ws).toBe(F.ws)
      expect((await c.query('select access_role, title from public.project_members where project_id = $1 and person_id = $2',
        [F.projects.a, F.people.aLoose])).rows).toEqual([{ access_role: 'member', title: 'PM' }])
      expect(await pgError(c, ROSTER, [F.users.aLoose, F.projects.a, cy, JSON.stringify({ access_role: 'admin' }), null, CMD(0xc3)]))
        .toMatchObject({ code: '42501', message: 'PROJECT_MEMBER_FORBIDDEN' })
      expect(await pgError(c, ROSTER, [F.users.member, '00000000-0000-0000-7e57-0000000013ff', cy, '{}', null, CMD(0xc4)]))
        .toMatchObject({ code: 'P0002', message: 'PROJECT_NOT_FOUND' })
    })
  })

  it('행위자·명령 id 없는 호출은 세 RPC 모두 COMMAND_ID_REQUIRED — 아무것도 쓰지 않는다', async () => {
    const REQUIRED = { code: '22023', message: 'COMMAND_ID_REQUIRED' }
    await asService(pool, async (c) => {
      const m = await mark(c)
      for (const [actor, cmd] of [[null, CMD(0xf0)], [F.users.platform, null]] as const) {
        expect(await pgError(c, WS_ROLE, [actor, F.ws, F.users.aLoose, 'admin', cmd])).toMatchObject(REQUIRED)
        expect(await pgError(c, PLATFORM, [actor, F.users.aLoose, true, cmd])).toMatchObject(REQUIRED)
        expect(await pgError(c, ROSTER, [actor, F.projects.a, cy, JSON.stringify({ access_role: 'member' }), null, cmd])).toMatchObject(REQUIRED)
      }
      expect(await since(c, m)).toEqual([])
    })
  })

  it('격리 수준 — 세 RPC 모두 repeatable read·serializable·read uncommitted 는 AUTHZ_EVENT_ISOLATION, read committed 는 통과', async () => {
    const ISOLATION = { code: '25001', message: 'AUTHZ_EVENT_ISOLATION' }
    const REFUSED = ['repeatable read', 'serializable', 'read uncommitted']
    const calls: Array<[string, string, unknown[]]> = [
      ['ws', WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'admin', CMD(0xd0)]],
      ['platform', PLATFORM, [F.users.platform, F.users.aLoose, true, CMD(0xd1)]],
      ['roster', ROSTER, [F.users.member, F.projects.a, cy, JSON.stringify({ access_role: 'member' }), null, CMD(0xd2)]],
    ]
    const results: Record<string, unknown> = {}
    for (const level of [...REFUSED, 'read committed']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        for (const [name, sql, params] of calls) results[`${name} ${level}`] = await pgError(c, sql, params)
      } finally {
        await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
      }
    }
    for (const [name] of calls) {
      for (const level of REFUSED) expect(results[`${name} ${level}`], `${name} ${level}`).toMatchObject(ISOLATION)
      expect(results[`${name} read committed`], name).toBeNull()
    }
  })

  it('실행 권한 — 세션은 관리자여도 부르지 못하고 service_role 은 부른다. 기존 5인자 upsert_project_member 는 그대로 있다', async () => {
    const DENIED_FN = { code: '42501', message: expect.stringContaining('permission denied for function') }
    await asUser(pool, F.users.platform, async (c) => {
      expect(await pgError(c, WS_ROLE, [F.users.platform, F.ws, F.users.aLoose, 'admin', CMD(0xe0)])).toMatchObject(DENIED_FN)
      expect(await pgError(c, PLATFORM, [F.users.platform, F.users.aLoose, true, CMD(0xe1)])).toMatchObject(DENIED_FN)
      expect(await pgError(c, ROSTER, [F.users.platform, F.projects.a, cy, '{}', null, CMD(0xe2)])).toMatchObject(DENIED_FN)
    })
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      expect(await call(c, WS_ROLE, [F.users.wsAdmin, F.ws, F.users.aLoose, 'admin', CMD(0xe0)])).toEqual({ status: 'applied', matched: 1 })
      await c.query('reset role')
      const { rows } = await c.query<{ n: number }>(
        `select count(*)::int as n from pg_proc where oid = 'public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[])'::regprocedure`)
      expect(rows[0].n).toBe(1)
    })
  })
})

describe('0012 ⑩-2 권한 RPC — 두 연결', () => {
  // 커밋이 필요하다 — 임시 워크스페이스를 만들고 finally 에서 지운다(정리 트리거가 그 워크스페이스의 기록·명령 원장을 지운다)
  const W2 = '00000000-0000-0000-7e57-00000000aa33'
  const CMD_X = '00000000-0000-4000-8000-0000000013ea'
  const RPC = 'select public.set_workspace_role($1, $2, $3, $4, $5) as r'
  const left = async () => (await pool.query<{ e: number; c: number; m: number }>(
    `select (select count(*) from public.authz_events where workspace_id = $1)::int as e,
            (select count(*) from public.authz_commands where workspace_id = $1)::int as c,
            (select count(*) from public.workspace_members where workspace_id = $1)::int as m`, [W2])).rows[0]
  const cleanup = () => pool.query('delete from public.workspaces where id = $1', [W2])

  it('앞 연결이 커밋한 명령을 advisory 잠금에서 기다린 뒤 연결은 저장한 결과의 duplicate 로 받는다 — 기록·원장은 1행씩', async () => {
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await cleanup()
      await pool.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp3a-authz-2', 'Acme Authz 2')`, [W2])
      await pool.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')`,
        [W2, F.users.aLoose, F.users.bMember])
      s1 = await pool.connect()
      s2 = await pool.connect()
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s2.query('begin')
      const args = [F.users.platform, W2, F.users.bMember, 'admin', CMD_X]
      expect((await s1.query(RPC, args)).rows[0].r).toEqual({ status: 'applied', matched: 1 })
      let settled = false
      const second = s2.query(RPC, args).then(
        (res) => res.rows[0].r as unknown, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      let blocked = false
      for (let i = 0; i < 250 && !settled && !blocked; i++) {
        blocked = (await s1.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [s2Pid])).rows[0].n > 0
        if (!blocked) await new Promise((r) => setTimeout(r, 20))
      }
      expect(blocked, '뒤 연결이 같은 명령의 advisory 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await second).toEqual({ status: 'duplicate', matched: 1 })
      await s2.query('commit')
      const { rows } = await s1.query(
        `select (select count(*) from public.authz_events where workspace_id = $1 and command_id = $2)::int as events,
                (select count(*) from public.authz_commands where workspace_id = $1 and command_id = $2)::int as commands`, [W2, CMD_X])
      expect(rows).toEqual([{ events: 1, commands: 1 }])
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    expect(await left()).toEqual({ e: 0, c: 0, m: 0 })
  })
})
