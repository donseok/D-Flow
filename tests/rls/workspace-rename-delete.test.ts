// 워크스페이스 이름 변경·빈 워크스페이스 삭제(*_workspace_rename_delete — 0055).
// ① rename_workspace — service_role 전용, 워크스페이스 관리자(또는 플랫폼 관리자) 재판정, slug 불변, 이름 규칙은 생성 폼과 같다.
// ② delete_empty_workspace — service_role 전용, 플랫폼 관리자 재판정, 사람이 적은 slug 대조, "비어 있음"은 workspaces 를 참조하는 FK 표 전부를
//    훑어 판정한다(모르는 새 표도 행이 있으면 거부). 함께 지워지는 것은 닫힌 목록의 부속 행과 실행자 본인의 소속·인물 행뿐이다.
// 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const U = F.users
const ID = (nn: string) => `00000000-0000-4000-8000-0000000055${nn}`
const SLUG = 'rls-0055-empty'
const RENAME = 'select public.rename_workspace($1, $2, $3) as r'
const DELETE = 'select public.delete_empty_workspace($1, $2, $3) as r'
const CREATE = 'select public.create_workspace_with_admin($1, $2, $3, $4, $5::jsonb, $6, $7) as r'
const FNS = ['public.rename_workspace(uuid, uuid, text)', 'public.delete_empty_workspace(uuid, uuid, text)']

type Deleted = { status: string; slug: string; name: string; removed?: Record<string, number>; remaining?: Record<string, number> }
const wsRow = async (c: PoolClient, id: string) =>
  (await c.query<{ slug: string; name: string }>('select slug, name from public.workspaces where id = $1', [id])).rows[0] ?? null
/** 워크스페이스에 딸린 행 수 — 삭제가 건드리는(또는 건드리면 안 되는) 표 */
const tally = async (c: PoolClient, ws: string) =>
  (await c.query<Record<string, number>>(
    `select (select count(*)::int from public.workspaces where id = $1) as workspaces,
            (select count(*)::int from public.workspace_members where workspace_id = $1) as members,
            (select count(*)::int from public.people where workspace_id = $1) as people,
            (select count(*)::int from public.workspace_settings where workspace_id = $1) as settings,
            (select count(*)::int from public.workspace_settings_history where workspace_id = $1) as history,
            (select count(*)::int from public.projects where workspace_id = $1) as projects,
            (select count(*)::int from public.teams where workspace_id = $1) as teams,
            (select count(*)::int from public.authz_events where workspace_id = $1) as authz`, [ws])).rows[0]
/** 빈 워크스페이스 하나 — 첫 관리자를 정해 만든다(0054 의 생성 RPC 그대로) */
async function createEmpty(c: PoolClient, admin: string, slug = SLUG): Promise<string> {
  const { rows: [{ r }] } = await c.query<{ r: { workspace_id: string } }>(
    CREATE, [U.platform, slug, '빈 조직', admin, JSON.stringify({ 'modules.allowed': [] }), ID('c1'), 1])
  return r.workspace_id
}
const del = async (c: PoolClient, actor: string, ws: string, slug: string) =>
  (await c.query<{ r: Deleted }>(DELETE, [actor, ws, slug])).rows[0].r

describe('실행권 — 두 RPC 는 service_role 전용', () => {
  it('anon·authenticated 에 EXECUTE 가 없고 service_role 에만 있다', async () => {
    for (const fn of FNS) {
      const { rows } = await pool.query<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon, has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as svc`, [fn])
      expect(rows, fn).toEqual([{ anon: false, auth: false, svc: true }])
    }
  })

  it('JWT 세션은 실행하지 못한다(42501) — 플랫폼 관리자·워크스페이스 관리자여도', async () => {
    await asUser(pool, U.platform, async (c) => {
      expect(await pgError(c, DELETE, [U.platform, F.ws, 'x']))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function delete_empty_workspace') })
    })
    await asUser(pool, U.wsAdmin, async (c) => {
      expect(await pgError(c, RENAME, [U.wsAdmin, F.ws, '새 이름']))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function rename_workspace') })
    })
  })

  it('세션은 workspaces 를 직접 고치거나 지우지 못한다 — 길은 RPC 뿐이다', async () => {
    await asUser(pool, U.wsAdmin, async (c) => {
      expect(await pgError(c, `update public.workspaces set name = 'x' where id = $1`, [F.ws])).toMatchObject({ code: '42501' })
      expect(await pgError(c, 'delete from public.workspaces where id = $1', [F.ws])).toMatchObject({ code: '42501' })
    })
  })
})

describe('① rename_workspace', () => {
  it('그 워크스페이스의 관리자·플랫폼 관리자는 바꾼다 — 이름은 다듬어 저장하고 slug 는 그대로다', async () => {
    await asService(pool, async (c) => {
      const before = await wsRow(c, F.ws)
      await c.query('set local role service_role')
      const { rows: [{ r }] } = await c.query<{ r: Record<string, string> }>(RENAME, [U.wsAdmin, F.ws, '  새 이름  '])
      expect(r).toEqual({ status: 'applied', name: '새 이름', previous: before!.name })
      const again = (await c.query<{ r: Record<string, string> }>(RENAME, [U.platform, F.ws, '플랫폼이 바꾼 이름'])).rows[0].r
      expect(again).toEqual({ status: 'applied', name: '플랫폼이 바꾼 이름', previous: '새 이름' })
      await c.query('reset role')
      expect(await wsRow(c, F.ws)).toEqual({ slug: before!.slug, name: '플랫폼이 바꾼 이름' })
    })
  })

  it('같은 이름이면 쓰지 않는다(unchanged)', async () => {
    await asService(pool, async (c) => {
      const before = await wsRow(c, F.ws)
      const { rows: [{ r }] } = await c.query<{ r: Record<string, string> }>(RENAME, [U.wsAdmin, F.ws, ` ${before!.name} `])
      expect(r).toEqual({ status: 'unchanged', name: before!.name })
    })
  })

  it('관리자가 아니면 AUTHZ_FORBIDDEN — 평멤버·다른 워크스페이스의 관리자. 없는 워크스페이스도 같은 거부다(존재를 알려 주지 않는다)', async () => {
    await asService(pool, async (c) => {
      const before = await wsRow(c, F.ws)
      for (const actor of [U.aLoose, U.bAdmin, U.bMember]) {
        expect(await pgError(c, RENAME, [actor, F.ws, '탈취']), actor).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      }
      expect(await pgError(c, RENAME, [U.wsAdmin, ID('ff'), '없는 곳'])).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      expect(await pgError(c, RENAME, [U.platform, ID('ff'), '없는 곳'])).toMatchObject({ code: 'P0002', message: 'WORKSPACE_NOT_FOUND' })
      expect(await wsRow(c, F.ws)).toEqual(before)
    })
  })

  it('이름 규칙 — 비었거나 80자를 넘거나 줄바꿈·탭이 있으면 22023 WORKSPACE_NAME_INVALID. 80자는 통과', async () => {
    await asService(pool, async (c) => {
      const before = await wsRow(c, F.ws)
      for (const name of ['', '   ', 'a'.repeat(81), 'a\nb', 'a\tb', 'a\rb', null]) {
        expect(await pgError(c, RENAME, [U.wsAdmin, F.ws, name]), JSON.stringify(name)).toMatchObject({ code: '22023', message: 'WORKSPACE_NAME_INVALID' })
      }
      expect(await pgError(c, RENAME, [null, F.ws, '이름'])).toMatchObject({ code: '22023', message: 'WORKSPACE_RENAME_INVALID' })
      expect(await pgError(c, RENAME, [U.wsAdmin, null, '이름'])).toMatchObject({ code: '22023', message: 'WORKSPACE_RENAME_INVALID' })
      expect(await wsRow(c, F.ws)).toEqual(before)
      expect(await pgError(c, RENAME, [U.wsAdmin, F.ws, '가'.repeat(80)])).toBeNull()
    })
  })
})

describe('② delete_empty_workspace — 등급과 인자', () => {
  it('플랫폼 관리자가 아니면 AUTHZ_FORBIDDEN — 그 워크스페이스의 관리자도. 아무것도 지워지지 않는다', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.aLoose)
      const before = await tally(c, ws)
      for (const actor of [U.aLoose, U.wsAdmin, U.bAdmin]) {
        expect(await pgError(c, DELETE, [actor, ws, SLUG]), actor).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      }
      expect(await tally(c, ws)).toEqual(before)
    })
  })

  it('인자가 없으면 22023, 없는 워크스페이스는 P0002, 적은 slug 가 다르면 WORKSPACE_SLUG_MISMATCH — 지우지 않는다', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.platform)
      const before = await tally(c, ws)
      for (const args of [[null, ws, SLUG], [U.platform, null, SLUG], [U.platform, ws, null]]) {
        expect(await pgError(c, DELETE, args)).toMatchObject({ code: '22023', message: 'WORKSPACE_DELETE_INVALID' })
      }
      expect(await pgError(c, DELETE, [U.platform, ID('ff'), SLUG])).toMatchObject({ code: 'P0002', message: 'WORKSPACE_NOT_FOUND' })
      for (const slug of ['rls-0055-other', SLUG.toUpperCase(), `${SLUG} `, '']) {
        expect(await pgError(c, DELETE, [U.platform, ws, slug]), slug).toMatchObject({ code: '22023', message: 'WORKSPACE_SLUG_MISMATCH' })
      }
      expect(await tally(c, ws)).toEqual(before)
    })
  })
})

describe('② delete_empty_workspace — 빈 워크스페이스만 지운다', () => {
  it('실행자만 남은 빈 워크스페이스 — 행·본인 소속·본인 인물·설정·설정 이력·권한 이력이 함께 사라지고 다른 워크스페이스는 그대로다', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.platform)
      expect(await tally(c, ws)).toMatchObject({ workspaces: 1, members: 1, people: 1, settings: 1, history: 1, projects: 0 })
      const [otherA, otherB] = [await tally(c, F.ws), await tally(c, F.wsB)]
      await c.query('set local role service_role')
      const r = await del(c, U.platform, ws, SLUG)
      await c.query('reset role')
      expect(r).toEqual({ status: 'deleted', slug: SLUG, name: '빈 조직', removed: { workspace_settings: 1, workspace_settings_history: 1 } })
      expect(await tally(c, ws)).toEqual({ workspaces: 0, members: 0, people: 0, settings: 0, history: 0, projects: 0, teams: 0, authz: 0 })
      expect((await c.query('select count(*)::int as n from public.authz_commands where workspace_id = $1', [ws])).rows[0].n).toBe(0)
      expect(await tally(c, F.ws)).toEqual(otherA)
      expect(await tally(c, F.wsB)).toEqual(otherB)
      // 같은 slug 를 다시 쓸 수 있다
      expect(await pgError(c, CREATE, [U.platform, SLUG, '다시', U.platform, JSON.stringify({ 'modules.allowed': [] }), ID('c2'), 1])).toBeNull()
    })
  })

  it('멤버가 0명이어도 지운다 — 부속 행(개인 화면 설정·사용 기록)은 함께 지워지고 건수를 돌려준다', async () => {
    await asService(pool, async (c) => {
      const { rows: [{ id: ws }] } = await c.query<{ id: string }>(`insert into public.workspaces (slug, name) values ($1, '멤버 없음') returning id`, [SLUG])
      await c.query(`insert into public.user_preferences (user_id, workspace_id, prefs) values ($1, $2, '{}'::jsonb)`, [U.aLoose, ws])
      await c.query(`insert into public.usage_events (user_id, menu_key, path, workspace_id) values ($1, 'home', '/', $2), ($1, 'home', '/', $2)`, [U.aLoose, ws])
      const r = await del(c, U.platform, ws, SLUG)
      expect(r).toMatchObject({ status: 'deleted', removed: { workspace_settings: 1, user_preferences: 1, usage_events: 2 } })
      expect(await wsRow(c, ws)).toBeNull()
      expect((await c.query('select count(*)::int as n from public.usage_events where workspace_id = $1', [ws])).rows[0].n).toBe(0)
    })
  })

  it('자료가 있는 워크스페이스는 거부한다 — 표별 남은 건수를 돌려주고 한 행도 지우지 않는다', async () => {
    await asService(pool, async (c) => {
      const before = await tally(c, F.ws)
      const { slug } = (await wsRow(c, F.ws))!
      const r = await del(c, U.platform, F.ws, slug)
      expect(r.status).toBe('blocked')
      expect(r.remaining).toMatchObject({ projects: before.projects, teams: before.teams })
      // 실행자 본인(플랫폼 관리자)의 소속·인물 행은 남은 것으로 세지 않는다 — 다른 사람 것만
      const others = (await c.query<{ m: number; p: number }>(
        `select (select count(*)::int from public.workspace_members where workspace_id = $1 and user_id <> $2) as m,
                (select count(*)::int from public.people where workspace_id = $1 and user_id is distinct from $2) as p`, [F.ws, U.platform])).rows[0]
      expect(r.remaining!.workspace_members).toBe(others.m)
      expect(r.remaining!.people).toBe(others.p)
      // 부속 표는 남은 것으로 세지 않는다
      for (const key of ['workspace_settings', 'workspace_settings_history', 'user_preferences', 'usage_events']) expect(r.remaining, key).not.toHaveProperty(key)
      expect(await tally(c, F.ws)).toEqual(before)
    })
  })

  it('남은 멤버가 실행자 본인이 아니면 거부한다 — 다른 사람의 소속·인물 행은 부속이 아니다', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.aLoose)
      const before = await tally(c, ws)
      expect(await del(c, U.platform, ws, SLUG)).toMatchObject({ status: 'blocked', remaining: { workspace_members: 1, people: 1 } })
      expect(await tally(c, ws)).toEqual(before)
    })
  })

  it('계정 없는 외부 인물 한 명·공용 팀 하나·초대 하나만 남아도 거부한다', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.platform)
      await c.query(`insert into public.people (workspace_id, email, display_name) values ($1, 'ext-0055@example.com', '외부 인력')`, [ws])
      expect(await del(c, U.platform, ws, SLUG)).toMatchObject({ status: 'blocked', remaining: { people: 1 } })
      await c.query(`delete from public.people where workspace_id = $1 and user_id is null`, [ws])
      await c.query(`insert into public.teams (workspace_id, code, name) values ($1, 'T55', '공용 팀')`, [ws])
      const r = await del(c, U.platform, ws, SLUG)
      expect(r.status).toBe('blocked')
      expect(r.remaining).toMatchObject({ teams: 1 })
      expect(await wsRow(c, ws)).not.toBeNull()
    })
  })

  it('모르는 새 참조 표 — workspaces 를 캐스케이드로 참조하는 표가 새로 생겨도 행이 있으면 거부한다(조용히 따라 지워지지 않는다)', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.platform)
      await c.query(`create table public.zz_future_ref (id bigint generated always as identity primary key,
                       ws uuid not null references public.workspaces(id) on delete cascade)`)
      // 빈 새 표는 막지 않는다
      await c.query('savepoint before_rows')
      expect((await del(c, U.platform, ws, SLUG)).status).toBe('deleted')
      await c.query('rollback to savepoint before_rows')
      await c.query('insert into public.zz_future_ref (ws) values ($1), ($1), ($1)', [ws])
      expect(await del(c, U.platform, ws, SLUG)).toMatchObject({ status: 'blocked', remaining: { zz_future_ref: 3 } })
      expect((await c.query('select count(*)::int as n from public.zz_future_ref')).rows[0].n).toBe(3)
      expect(await wsRow(c, ws)).not.toBeNull()
    })
  })

  it('셀 줄 모르는 참조(여러 열 FK)가 있으면 지우지 않는다 — 0A000 WORKSPACE_DELETE_UNKNOWN_REFERENCE', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.platform)
      await c.query('alter table public.workspaces add constraint zz_ws_id_slug unique (id, slug)')
      await c.query(`create table public.zz_pair_ref (ws uuid not null, slug text not null,
                       foreign key (ws, slug) references public.workspaces(id, slug) on delete cascade)`)
      expect(await pgError(c, DELETE, [U.platform, ws, SLUG])).toMatchObject({ code: '0A000', message: 'WORKSPACE_DELETE_UNKNOWN_REFERENCE' })
      expect(await wsRow(c, ws)).not.toBeNull()
    })
  })

  it('저장소에 그 워크스페이스의 파일(로고)이 남아 있으면 거부한다 — 다른 워크스페이스의 파일은 세지 않는다', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.platform)
      await c.query(`insert into storage.objects (bucket_id, name) values ('branding', $1)`, [`ws/${F.ws}/branding/full-0123456789abcdef.png`])
      await c.query('savepoint other_only')
      expect((await del(c, U.platform, ws, SLUG)).status).toBe('deleted')
      await c.query('rollback to savepoint other_only')
      await c.query(`insert into storage.objects (bucket_id, name) values ('branding', $1)`, [`ws/${ws}/branding/full-0123456789abcdef.png`])
      expect(await del(c, U.platform, ws, SLUG)).toMatchObject({ status: 'blocked', remaining: { 'storage.objects': 1 } })
      expect(await wsRow(c, ws)).not.toBeNull()
    })
  })

  it('부속 행을 다른 곳이 붙들고 있으면(본인 인물 행을 가리키는 명단) 23503 WORKSPACE_DELETE_REFERENCED — 전부 없던 일이다', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.platform)
      const before = await tally(c, ws)
      const { rows: [{ id: person }] } = await c.query<{ id: string }>('select id from public.people where workspace_id = $1 and user_id = $2', [ws, U.platform])
      // 다른 워크스페이스의 프로젝트 명단이 이 인물 행을 가리키는 어긋난 자료 — 보호 트리거를 끄고 만든다(정상 경로로는 생기지 않는다)
      await c.query(`set local session_replication_role = 'replica'`)
      await c.query('insert into public.project_members (project_id, person_id) values ($1, $2)', [F.projects.a, person])
      await c.query(`set local session_replication_role = 'origin'`)
      expect(await pgError(c, DELETE, [U.platform, ws, SLUG])).toMatchObject({ code: '23503', message: 'WORKSPACE_DELETE_REFERENCED' })
      expect(await tally(c, ws)).toEqual(before)
    })
  })
})
