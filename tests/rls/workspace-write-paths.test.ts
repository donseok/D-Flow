// 워크스페이스 소속·생성의 쓰기 길(*_workspace_write_paths — 0054).
// ① 세션은 workspace_members 를 직접 지우지 못한다(권한·정책 회수) — 지우는 길은 제거 RPC(0053) 하나. INSERT·UPDATE(role)의 판정은 그대로다.
// ② create_workspace_with_admin — service_role 전용, 플랫폼 관리자 재판정, 행·첫 관리자·인물·설정이 한 트랜잭션(중간 실패는 전부 없던 일),
//    설정 값은 설정 RPC 가 쓴다(이력·revision), 같은 명령의 재전송은 새로 만들지 않는다.
// 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const U = F.users
const ID = (nn: string) => `00000000-0000-4000-8000-0000000054${nn}`
const CMD = ID('c1')
const SLUG = 'rls-0054-new'
const FN = 'public.create_workspace_with_admin(uuid, text, text, uuid, jsonb, uuid, int)'
const CREATE = 'select public.create_workspace_with_admin($1, $2, $3, $4, $5::jsonb, $6, $7) as r'
const VALUES = JSON.stringify({ 'modules.allowed': ['kanban', 'wiki'], 'calendar.timezone': 'Asia/Tokyo' })
const DELETE_MEMBER = 'delete from public.workspace_members where workspace_id = $1 and user_id = $2'
const DENIED_TABLE = { code: '42501', message: expect.stringContaining('permission denied for table workspace_members') }

const membership = async (c: PoolClient, ws: string, user: string) =>
  (await c.query<{ role: string }>('select role from public.workspace_members where workspace_id = $1 and user_id = $2', [ws, user])).rows[0]?.role ?? null
const wsBySlug = async (c: PoolClient, slug: string) =>
  (await c.query<{ id: string; name: string; created_by: string | null }>('select id, name, created_by from public.workspaces where slug = $1', [slug])).rows
const counts = async (c: PoolClient) =>
  (await c.query<{ w: number; m: number; p: number; h: number; e: number }>(
    `select (select count(*)::int from public.workspaces) as w, (select count(*)::int from public.workspace_members) as m,
            (select count(*)::int from public.people) as p, (select count(*)::int from public.workspace_settings_history) as h,
            (select count(*)::int from public.authz_events) as e`)).rows[0]
async function toSession(c: PoolClient, userId: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
}

describe('① workspace_members — 세션의 직접 삭제는 닫혔다', () => {
  it('워크스페이스 관리자·플랫폼 관리자·본인 누구의 세션이든 DELETE 는 42501(권한) — 소속은 그대로다', async () => {
    for (const [actor, target] of [[U.wsAdmin, U.aLoose], [U.platform, U.aLoose], [U.aLoose, U.aLoose]] as const) {
      await asUser(pool, actor, async (c) => {
        expect(await pgError(c, DELETE_MEMBER, [F.ws, target]), actor).toMatchObject(DENIED_TABLE)
        expect(await pgError(c, 'delete from public.workspace_members'), actor).toMatchObject(DENIED_TABLE)
        await c.query('reset role')
        expect(await membership(c, F.ws, target)).toBe('member')
      })
    }
  })

  it('카탈로그 — authenticated·anon 에 DELETE 권한이 없고, 삭제를 덮는 정책(FOR DELETE·FOR ALL)이 없다', async () => {
    await asService(pool, async (c) => {
      const { rows: [priv] } = await c.query<{ auth: boolean; anon: boolean; svc: boolean }>(
        `select has_table_privilege('authenticated', 'public.workspace_members', 'DELETE') as auth,
                has_table_privilege('anon', 'public.workspace_members', 'DELETE') as anon,
                has_table_privilege('service_role', 'public.workspace_members', 'DELETE') as svc`)
      expect(priv).toEqual({ auth: false, anon: false, svc: true })
      const { rows } = await c.query<{ name: string; cmd: string }>(
        `select polname::text as name, polcmd::text as cmd from pg_policy where polrelid = 'public.workspace_members'::regclass order by 1`)
      expect(rows).toEqual([
        { name: 'workspace_members_insert', cmd: 'a' }, { name: 'workspace_members_read', cmd: 'r' }, { name: 'workspace_members_update', cmd: 'w' },
      ])
    })
  })

  it('민감도 — 권한만 다시 열려도 정책이 없어 세션의 삭제는 0행이다(두 겹)', async () => {
    await asService(pool, async (c) => {
      await c.query('grant delete on public.workspace_members to authenticated')
      await toSession(c, U.wsAdmin)
      expect((await c.query(DELETE_MEMBER, [F.ws, U.aLoose])).rowCount).toBe(0)
      await c.query('reset role')
      expect(await membership(c, F.ws, U.aLoose)).toBe('member')
    })
  })

  it('정식 길은 통과한다 — 제거 RPC(service_role)는 같은 소속을 지운다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      const { rows: [{ r }] } = await c.query<{ r: { status: string; matched: number } }>(
        'select public.remove_workspace_member($1, $2, $3, $4) as r', [U.wsAdmin, F.ws, U.aLoose, CMD])
      expect(r).toMatchObject({ status: 'applied', matched: 1 })
      await c.query('reset role')
      expect(await membership(c, F.ws, U.aLoose)).toBeNull()
    })
  })

  it('INSERT·UPDATE(role)의 판정은 그대로다 — 그 워크스페이스 관리자는 통과, 다른 워크스페이스 관리자의 INSERT 는 RLS 거부', async () => {
    await asUser(pool, U.wsAdmin, async (c) => {
      expect(await pgError(c, `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.ws, U.bMember])).toBeNull()
      expect((await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.ws, U.bMember])).rowCount).toBe(1)
    })
    await asUser(pool, U.bAdmin, async (c) => {
      expect(await pgError(c, `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.ws, U.bMember]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('row-level security') })
    })
    // 평멤버의 UPDATE 는 정책이 0행으로 만든다(값 그대로)
    await asUser(pool, U.aLoose, async (c) => {
      expect((await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.ws, U.aLoose])).rowCount).toBe(0)
    })
  })
})

describe('② create_workspace_with_admin — 실행권과 등급', () => {
  it('JWT 세션은 실행하지 못한다(42501) — 플랫폼 관리자여도', async () => {
    await asUser(pool, U.platform, async (c) => {
      expect(await pgError(c, CREATE, [U.platform, SLUG, '새 조직', U.platform, VALUES, CMD, 1]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function create_workspace_with_admin') })
    })
  })

  it('anon·authenticated 에 EXECUTE 가 없고 service_role 에만 있다', async () => {
    const { rows } = await pool.query<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon, has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`, [FN])
    expect(rows).toEqual([{ anon: false, auth: false, svc: true }])
  })

  it('플랫폼 관리자가 아니면 AUTHZ_FORBIDDEN — 워크스페이스 관리자도. 아무것도 생기지 않는다', async () => {
    await asService(pool, async (c) => {
      const before = await counts(c)
      for (const actor of [U.wsAdmin, U.bAdmin, U.aLoose]) {
        expect(await pgError(c, CREATE, [actor, SLUG, '새 조직', actor, VALUES, CMD, 1]), actor)
          .toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      }
      expect(await counts(c)).toEqual(before)
    })
  })

  it('인자 검사 — 행위자·명령 id·slug·이름·첫 관리자가 없거나 값이 객체가 아니거나 허용 모듈이 빠지면 22023', async () => {
    await asService(pool, async (c) => {
      const before = await counts(c)
      const bad: [unknown[], string][] = [
        [[null, SLUG, '새 조직', U.platform, VALUES, CMD, 1], 'COMMAND_ID_REQUIRED'],
        [[U.platform, SLUG, '새 조직', U.platform, VALUES, null, 1], 'COMMAND_ID_REQUIRED'],
        [[U.platform, null, '새 조직', U.platform, VALUES, CMD, 1], 'WORKSPACE_CREATE_INVALID'],
        [[U.platform, SLUG, null, U.platform, VALUES, CMD, 1], 'WORKSPACE_CREATE_INVALID'],
        [[U.platform, SLUG, '새 조직', null, VALUES, CMD, 1], 'WORKSPACE_CREATE_INVALID'],
        [[U.platform, SLUG, '새 조직', U.platform, '[]', CMD, 1], 'CONFIG_INVALID:p_values'],
        [[U.platform, SLUG, '새 조직', U.platform, '{}', CMD, 1], 'CONFIG_INVALID:modules.allowed'],
        [[U.platform, SLUG, '새 조직', U.platform, null, CMD, 1], 'CONFIG_INVALID:modules.allowed'],
      ]
      for (const [args, message] of bad) {
        expect(await pgError(c, CREATE, args), message).toMatchObject({ code: '22023', message })
      }
      expect(await counts(c)).toEqual(before)
    })
  })
})

describe('② create_workspace_with_admin — 정상 경로', () => {
  it('service_role 로 실행 — 워크스페이스·첫 관리자 멤버십·인물·설정이 함께 생기고, 설정 이력과 권한 이력에 행위자·명령 id 가 남는다', async () => {
    await asService(pool, async (c) => {
      // 픽스처의 고정 id 행(7057001)은 순번보다 크다 — 다른 이력 테스트처럼 빼고 본다
      const mark = (await c.query<{ m: string }>('select coalesce(max(id), 0)::text as m from public.authz_events where id <> 7057001')).rows[0].m
      await c.query('set local role service_role')
      const { rows: [{ r }] } = await c.query<{ r: { status: string; workspace_id: string; revision: number } }>(
        CREATE, [U.platform, SLUG, '새 조직', U.aLoose, VALUES, CMD, 1])
      await c.query('reset role')
      expect(r).toMatchObject({ status: 'applied', revision: 1 })
      const ws = r.workspace_id
      expect(await wsBySlug(c, SLUG)).toEqual([{ id: ws, name: '새 조직', created_by: U.platform }])
      // 첫 관리자는 지정한 계정(만든 사람이 아니다) — 만든 사람은 소속이 생기지 않는다
      expect((await c.query('select user_id, role, invited_by from public.workspace_members where workspace_id = $1', [ws])).rows)
        .toEqual([{ user_id: U.aLoose, role: 'admin', invited_by: U.platform }])
      // 인물 행은 그 계정의 프로필에서 — 이름은 앞뒤 공백 없이
      const { rows: [profile] } = await c.query<{ email: string; display_name: string }>('select email, display_name from public.profiles where user_id = $1', [U.aLoose])
      expect((await c.query('select email, display_name, user_id, active from public.people where workspace_id = $1', [ws])).rows)
        .toEqual([{ email: profile.email, display_name: profile.display_name.trim(), user_id: U.aLoose, active: true }])
      // 설정 — 값은 준 그대로, revision 0 → 1, 이력은 키마다 1행(source internal — 설정 RPC 가 썼다)
      expect((await c.query('select "values", revision::int as revision, schema_version, updated_by from public.workspace_settings where workspace_id = $1', [ws])).rows)
        .toEqual([{ values: JSON.parse(VALUES), revision: 1, schema_version: 1, updated_by: U.platform }])
      expect((await c.query(
        `select key, old_value, new_value, source, command_id::text, changed_by, revision::int as revision
           from public.workspace_settings_history where workspace_id = $1 order by key`, [ws])).rows).toEqual([
        { key: 'calendar.timezone', old_value: null, new_value: 'Asia/Tokyo', source: 'internal', command_id: CMD, changed_by: U.platform, revision: 1 },
        { key: 'modules.allowed', old_value: null, new_value: ['kanban', 'wiki'], source: 'internal', command_id: CMD, changed_by: U.platform, revision: 1 },
      ])
      // 권한 이력 — 첫 관리자 가입 1행, 행위자는 p_actor
      expect((await c.query(
        `select kind, cause, workspace_id, target_user_id, before, after, actor_user_id, command_id::text
           from public.authz_events where id > $1::bigint and id <> 7057001 order by id`, [mark])).rows).toEqual([
        { kind: 'workspace_role', cause: 'direct', workspace_id: ws, target_user_id: U.aLoose, before: null,
          after: { role: 'admin', invited_by: U.platform }, actor_user_id: U.platform, command_id: CMD },
      ])
      // 행위자·명령 id 설정은 RPC 가 끝나며 비운다
      expect((await c.query(`select current_setting('app.authz_actor', true) as a, current_setting('app.command_id', true) as k`)).rows[0])
        .toEqual({ a: '', k: '' })
    })
  })

  it('허용 모듈을 빈 배열로 줘도(core 만) 명시 값으로 남는다', async () => {
    await asService(pool, async (c) => {
      const { rows: [{ r }] } = await c.query<{ r: { workspace_id: string } }>(
        CREATE, [U.platform, SLUG, '새 조직', U.platform, JSON.stringify({ 'modules.allowed': [] }), CMD, 1])
      expect((await c.query('select "values" from public.workspace_settings where workspace_id = $1', [r.workspace_id])).rows)
        .toEqual([{ values: { 'modules.allowed': [] } }])
      expect((await c.query('select count(*)::int as n from public.workspace_settings_history where workspace_id = $1', [r.workspace_id])).rows[0].n).toBe(1)
    })
  })
})

describe('② create_workspace_with_admin — 거부와 원자성', () => {
  it('slug 중복은 23505 WORKSPACE_SLUG_TAKEN — 기존 워크스페이스는 그대로, 새 행 없음', async () => {
    await asService(pool, async (c) => {
      const { rows: [{ slug }] } = await c.query<{ slug: string }>('select slug from public.workspaces where id = $1', [F.ws])
      const before = await counts(c)
      expect(await pgError(c, CREATE, [U.platform, slug, '겹침', U.platform, VALUES, CMD, 1]))
        .toMatchObject({ code: '23505', message: 'WORKSPACE_SLUG_TAKEN' })
      expect(await counts(c)).toEqual(before)
    })
  })

  it('첫 관리자 계정이 없으면 P0002 WORKSPACE_ADMIN_NOT_FOUND — 워크스페이스를 만들지 않는다', async () => {
    await asService(pool, async (c) => {
      const before = await counts(c)
      expect(await pgError(c, CREATE, [U.platform, SLUG, '새 조직', ID('ff'), VALUES, CMD, 1]))
        .toMatchObject({ code: 'P0002', message: 'WORKSPACE_ADMIN_NOT_FOUND' })
      expect(await counts(c)).toEqual(before)
    })
  })

  it('slug·이름이 표의 제약을 어기면 23514 — 아무것도 남지 않는다', async () => {
    await asService(pool, async (c) => {
      const before = await counts(c)
      expect(await pgError(c, CREATE, [U.platform, 'Bad Slug', '새 조직', U.platform, VALUES, CMD, 1])).toMatchObject({ code: '23514' })
      expect(await pgError(c, CREATE, [U.platform, SLUG, '   ', U.platform, VALUES, CMD, 1])).toMatchObject({ code: '23514' })
      expect(await counts(c)).toEqual(before)
    })
  })

  it('원자성 — 마지막 단계(설정)가 실패하면 앞서 만든 워크스페이스·멤버십·인물·이력이 함께 사라진다', async () => {
    await asService(pool, async (c) => {
      const before = await counts(c)
      // 세대 값이 없으면 설정 RPC 가 거절한다 — 그 시점에는 워크스페이스·멤버십·인물 행이 이미 들어가 있다
      expect(await pgError(c, CREATE, [U.platform, SLUG, '새 조직', U.platform, VALUES, CMD, null]))
        .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:p_schema_version' })
      expect(await wsBySlug(c, SLUG)).toEqual([])
      expect(await counts(c)).toEqual(before)
      // 같은 slug·명령 id 로 다시 하면 처음 만드는 것처럼 통과한다(남은 찌꺼기가 없다)
      const { rows: [{ r }] } = await c.query<{ r: { status: string } }>(CREATE, [U.platform, SLUG, '새 조직', U.platform, VALUES, CMD, 1])
      expect(r.status).toBe('applied')
    })
  })

  it('원자성 — 인물 단계가 실패해도(같은 계정의 인물을 막는 트리거를 임시로 걸어 재현) 워크스페이스·멤버십이 남지 않는다', async () => {
    await asService(pool, async (c) => {
      await c.query(`create function public.rls_0054_block_people() returns trigger language plpgsql as $f$
        begin raise exception using errcode = 'P0001', message = 'RLS_0054_PEOPLE_BLOCKED'; end $f$`)
      await c.query('create trigger rls_0054_block_people before insert on public.people for each row execute function public.rls_0054_block_people()')
      const before = await counts(c)
      expect(await pgError(c, CREATE, [U.platform, SLUG, '새 조직', U.platform, VALUES, CMD, 1]))
        .toMatchObject({ code: 'P0001', message: 'RLS_0054_PEOPLE_BLOCKED' })
      expect(await wsBySlug(c, SLUG)).toEqual([])
      expect(await counts(c)).toEqual(before)
    })
  })
})

describe('② create_workspace_with_admin — 멱등', () => {
  it('같은 행위자·명령 id·slug 의 재전송은 새로 만들지 않고 그때의 워크스페이스를 돌려준다', async () => {
    await asService(pool, async (c) => {
      const { rows: [{ r: first }] } = await c.query<{ r: { status: string; workspace_id: string } }>(
        CREATE, [U.platform, SLUG, '새 조직', U.aLoose, VALUES, CMD, 1])
      const after = await counts(c)
      const { rows: [{ r: again }] } = await c.query<{ r: { status: string; workspace_id: string } }>(
        CREATE, [U.platform, SLUG, '새 조직', U.aLoose, VALUES, CMD, 1])
      expect(again).toEqual({ status: 'duplicate', workspace_id: first.workspace_id })
      expect(await counts(c)).toEqual(after)
    })
  })

  it('같은 명령 id 를 다른 slug 로 다시 쓰면 23505 COMMAND_REUSED, 다른 명령 id 의 같은 slug 는 WORKSPACE_SLUG_TAKEN', async () => {
    await asService(pool, async (c) => {
      await c.query(CREATE, [U.platform, SLUG, '새 조직', U.platform, VALUES, CMD, 1])
      const after = await counts(c)
      expect(await pgError(c, CREATE, [U.platform, `${SLUG}-2`, '다른 조직', U.platform, VALUES, CMD, 1]))
        .toMatchObject({ code: '23505', message: 'COMMAND_REUSED' })
      expect(await pgError(c, CREATE, [U.platform, SLUG, '새 조직', U.platform, VALUES, ID('c2'), 1]))
        .toMatchObject({ code: '23505', message: 'WORKSPACE_SLUG_TAKEN' })
      expect(await counts(c)).toEqual(after)
    })
  })
})
