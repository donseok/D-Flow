// 워크스페이스 보관·복원(*_workspace_archive — 0056). 보관 = 숨김 + 동결, 자료는 그대로.
// ① archive_workspace·restore_workspace — service_role 전용, 플랫폼 관리자 재판정, 사람이 적은 slug 대조, 멱등.
// ② 뿌리 함수 다섯(my_workspace_ids·is_ws_member·is_ws_admin·is_project_admin·can_read_project)이 보관된 워크스페이스를 빼므로 세션의 읽기·쓰기가
//    정책을 고치지 않고 닫힌다 — 멤버·관리자뿐 아니라 플랫폼 관리자의 세션도. 다른 워크스페이스는 그대로, 복원하면 원상.
// ③ RPC 안 재판정(actor_is_workspace_admin·actor_is_project_admin)이 거짓 — 그 재판정을 거치는 쓰기 RPC 가 닫힌다. 삭제(0055)는 그대로 열려 있다.
// ④ 큐 선점 셋·읽은 알림 정리가 보관된 워크스페이스의 행을 건드리지 않고, 복원하면 이어서 집는다(잃는 잡이 없다).
// 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다. 한 트랜잭션 안에서 service_role(보관·복원)과 세션(판정)을 오간다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const U = F.users
const ID = (nn: string) => `00000000-0000-4000-8000-0000000056${nn}`
const ARCHIVE = 'select public.archive_workspace($1, $2, $3, $4) as r'
const RESTORE = 'select public.restore_workspace($1, $2) as r'
const FNS = ['public.archive_workspace(uuid, uuid, text, text)', 'public.restore_workspace(uuid, uuid)', 'public.workspace_archived(uuid)']

type Row = Record<string, unknown>
const slugOf = async (c: PoolClient, ws: string) => (await c.query<{ slug: string }>('select slug from public.workspaces where id = $1', [ws])).rows[0].slug
const wsRow = async (c: PoolClient, ws: string) =>
  (await c.query<Row>('select archived_at, archived_by, archive_reason, restored_at, restored_by from public.workspaces where id = $1', [ws])).rows[0]
/** service 경로(postgres) 그대로 보관·복원 — asService 안에서 부른다 */
const archive = async (c: PoolClient, ws: string, reason: string | null = null, actor = U.platform) =>
  (await c.query<{ r: Row }>(ARCHIVE, [actor, ws, await slugOf(c, ws), reason])).rows[0].r
const restore = async (c: PoolClient, ws: string, actor = U.platform) => (await c.query<{ r: Row }>(RESTORE, [actor, ws])).rows[0].r

/** 같은 트랜잭션에서 세션으로 갈아탄다(PostgREST 의 authenticated + JWT sub) — fn 뒤에 service 경로로 돌아온다 */
async function asSession<T>(c: PoolClient, userId: string, fn: () => Promise<T>): Promise<T> {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  const { rows } = await c.query<{ uid: string | null; role: string }>('select auth.uid()::text as uid, current_user::text as role')
  if (rows[0]?.uid !== userId || rows[0]?.role !== 'authenticated') throw new Error('세션 흉내 실패')
  try {
    return await fn()
  } finally {
    await c.query('reset role')
    await c.query(`select set_config('request.jwt.claims', '', true)`)
  }
}

/** 그 세션이 보는 것 — 워크스페이스 A·B 의 대표 표 행 수와 판정 함수들 */
const VIEW = `
  select (select count(*)::int from public.workspaces where id = $1) as ws,
         (select count(*)::int from public.workspace_members where workspace_id = $1) as members,
         (select count(*)::int from public.workspace_settings where workspace_id = $1) as ws_settings,
         (select count(*)::int from public.people where workspace_id = $1) as people,
         (select count(*)::int from public.teams where workspace_id = $1) as teams,
         (select count(*)::int from public.projects where workspace_id = $1) as projects,
         (select count(*)::int from public.wbs_items where project_id = $2) as wbs,
         (select count(*)::int from public.project_settings where project_id = $2) as project_settings,
         (select count(*)::int from public.project_members where project_id = $2) as roster,
         (select count(*)::int from public.minutes where workspace_id = $1) as minutes,
         (select count(*)::int from public.issues where project_id = $2) as issues,
         (select count(*)::int from public.notification_events where workspace_id = $1) as events,
         public.is_ws_member($1) as is_member, public.is_ws_admin($1) as is_admin,
         ($1 in (select public.my_workspace_ids())) as in_mine,
         public.is_project_admin($2) as p_admin, public.is_project_member($2) as p_member, public.can_read_project($2) as p_read,
         ($2 in (select public.accessible_project_ids())) as p_accessible,
         public.has_project_role_in_ws($1) as has_role, public.is_project_admin_anywhere_in_ws($1) as admin_anywhere,
         (public.my_member_id($2) is not null) as has_member_id,
         (select count(*)::int from public.my_team_ids($2)) as my_teams`
const view = async (c: PoolClient, user: string, ws: string, project: string) =>
  asSession(c, user, async () => (await c.query<Row>(VIEW, [ws, project])).rows[0])
const CLOSED = {
  ws: 0, members: 0, ws_settings: 0, people: 0, teams: 0, projects: 0, wbs: 0, project_settings: 0, roster: 0, minutes: 0, issues: 0, events: 0,
  is_member: false, is_admin: false, in_mine: false, p_admin: false, p_member: false, p_read: false, p_accessible: false,
  has_role: false, admin_anywhere: false, has_member_id: false, my_teams: 0,
}

describe('실행권 — 보관·복원·판정은 service_role 전용', () => {
  it('anon·authenticated 에 EXECUTE 가 없고 service_role 에만 있다', async () => {
    for (const fn of FNS) {
      const { rows } = await pool.query<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon, has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as svc`, [fn])
      expect(rows, fn).toEqual([{ anon: false, auth: false, svc: true }])
    }
  })

  it('JWT 세션은 실행하지 못한다(42501) — 플랫폼 관리자여도', async () => {
    await asUser(pool, U.platform, async (c) => {
      expect(await pgError(c, ARCHIVE, [U.platform, F.ws, 'x', null]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function archive_workspace') })
      expect(await pgError(c, RESTORE, [U.platform, F.ws]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function restore_workspace') })
      expect(await pgError(c, 'select public.workspace_archived($1)', [F.ws])).toMatchObject({ code: '42501' })
    })
  })

  it('세션은 보관 열을 직접 고치지 못한다 — 길은 RPC 뿐이다', async () => {
    await asUser(pool, U.wsAdmin, async (c) => {
      expect(await pgError(c, 'update public.workspaces set archived_at = now() where id = $1', [F.ws])).toMatchObject({ code: '42501' })
    })
    await asUser(pool, U.platform, async (c) => {
      expect(await pgError(c, 'update public.workspaces set archived_at = null where id = $1', [F.ws])).toMatchObject({ code: '42501' })
    })
  })

  it('다시 정의한 함수의 실행권은 그대로다 — 뿌리 다섯은 authenticated, 재판정·선점·정리는 service_role 만', async () => {
    const q = `select has_function_privilege('anon', $1, 'EXECUTE') as anon, has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                      has_function_privilege('service_role', $1, 'EXECUTE') as svc`
    for (const fn of ['public.my_workspace_ids()', 'public.is_ws_member(uuid)', 'public.is_ws_admin(uuid)', 'public.is_project_admin(uuid)', 'public.can_read_project(uuid)']) {
      expect((await pool.query(q, [fn])).rows, fn).toEqual([{ anon: false, auth: true, svc: true }])
    }
    for (const fn of ['public.actor_is_workspace_admin(uuid, uuid)', 'public.actor_is_project_admin(uuid, uuid)', 'public.claim_ai_index_jobs(integer, integer)',
      'public.claim_wiki_processing_job(bigint, text, integer)', 'public.claim_wiki_project_rebuild_step(uuid, text, integer)', 'public.purge_read_notifications(integer)']) {
      expect((await pool.query(q, [fn])).rows, fn).toEqual([{ anon: false, auth: false, svc: true }])
    }
  })
})

describe('기본값 — 적용만으로 기존 행의 의미가 바뀌지 않는다', () => {
  it('픽스처의 워크스페이스는 전부 보관 아님이고, 멤버·관리자·플랫폼 관리자의 판정이 종전과 같다', async () => {
    const { rows } = await pool.query('select count(*)::int as n from public.workspaces where archived_at is not null or archived_by is not null or archive_reason is not null')
    expect(rows[0].n).toBe(0)
    await asService(pool, async (c) => {
      expect(await view(c, U.wsAdmin, F.ws, F.projects.a)).toMatchObject({ ws: 1, is_member: true, is_admin: true, in_mine: true, p_admin: true, p_member: true, p_read: true, p_accessible: true })
      expect(await view(c, U.aLoose, F.ws, F.projects.a)).toMatchObject({ ws: 1, is_member: true, is_admin: false, p_admin: false, p_member: false, p_read: true })
      expect(await view(c, U.platform, F.wsB, F.projects.bWs)).toMatchObject({ ws: 1, is_member: true, is_admin: true, p_admin: true, p_read: true, p_accessible: true })
      // 그 워크스페이스 소속이 아닌 사람은 원래 닫혀 있다 — 보관된 워크스페이스가 이 꼴과 같아진다
      expect(await view(c, U.bAdmin, F.ws, F.projects.a)).toEqual(CLOSED)
    })
  })

  it('보관 기록의 모양 — 보관이 아니면 실행자·사유를 둘 수 없고, 사유는 다듬은 1~500자다', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, `update public.workspaces set archive_reason = '사유만' where id = $1`, [F.ws]))
        .toMatchObject({ code: '23514', message: expect.stringContaining('workspaces_archive_shape_check') })
      expect(await pgError(c, 'update public.workspaces set archived_by = $2 where id = $1', [F.ws, U.platform]))
        .toMatchObject({ code: '23514', message: expect.stringContaining('workspaces_archive_shape_check') })
      for (const bad of ['', ' 앞 공백', 'x'.repeat(501)]) {
        expect(await pgError(c, 'update public.workspaces set archived_at = now(), archive_reason = $2 where id = $1', [F.ws, bad]), JSON.stringify(bad.slice(0, 8)))
          .toMatchObject({ code: '23514', message: expect.stringContaining('workspaces_archive_reason_check') })
      }
    })
  })
})

describe('① archive_workspace·restore_workspace', () => {
  it('플랫폼 관리자가 보관한다 — 시각·실행자·다듬은 사유를 적고, 다른 워크스페이스는 그대로다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      const { rows: [{ r }] } = await c.query<{ r: Row }>(ARCHIVE, [U.platform, F.ws, await slugOf(c, F.ws), '  계약 종료  '])
      await c.query('reset role')
      expect(r).toMatchObject({ status: 'archived', archived_by: U.platform, reason: '계약 종료' })
      expect(typeof r.archived_at).toBe('string')
      expect(await wsRow(c, F.ws)).toMatchObject({ archived_by: U.platform, archive_reason: '계약 종료', restored_at: null, restored_by: null })
      expect((await wsRow(c, F.ws)).archived_at).not.toBeNull()
      expect(await wsRow(c, F.wsB)).toEqual({ archived_at: null, archived_by: null, archive_reason: null, restored_at: null, restored_by: null })
    })
  })

  it('사유는 선택이다 — 비우거나 공백뿐이면 null', async () => {
    await asService(pool, async (c) => {
      expect(await archive(c, F.ws, '   ')).toMatchObject({ status: 'archived', reason: null })
      expect((await wsRow(c, F.ws)).archive_reason).toBeNull()
    })
  })

  it('멱등 — 이미 보관이면 쓰지 않고 처음 기록(시각·실행자·사유)을 그대로 돌려준다', async () => {
    await asService(pool, async (c) => {
      const first = await archive(c, F.ws, '처음')
      const again = await archive(c, F.ws, '다시')
      expect(again).toEqual({ ...first, status: 'unchanged' })
      expect((await wsRow(c, F.ws)).archive_reason).toBe('처음')
    })
  })

  it('복원 — 보관 기록을 비우고 복원 시각·실행자를 적는다. 지운 기록은 응답으로 돌려준다. 이미 활성이면 unchanged', async () => {
    await asService(pool, async (c) => {
      expect(await restore(c, F.ws)).toMatchObject({ status: 'unchanged' })
      expect((await wsRow(c, F.ws)).restored_at).toBeNull()                 // 쓰지 않았다
      const archived = await archive(c, F.ws, '잠시')
      const restored = await restore(c, F.ws)
      expect(restored).toMatchObject({ status: 'restored', previous: { archived_at: archived.archived_at, archived_by: U.platform, reason: '잠시' } })
      const row = await wsRow(c, F.ws)
      expect(row).toMatchObject({ archived_at: null, archived_by: null, archive_reason: null, restored_by: U.platform })
      expect(row.restored_at).not.toBeNull()
      // 다시 보관해도 마지막 복원 기록은 남는다
      await archive(c, F.ws)
      expect((await wsRow(c, F.ws)).restored_by).toBe(U.platform)
    })
  })

  it('플랫폼 관리자가 아니면 거부(AUTHZ_FORBIDDEN) — 그 워크스페이스의 관리자·없는 계정도', async () => {
    await asService(pool, async (c) => {
      const slug = await slugOf(c, F.ws)
      for (const actor of [U.wsAdmin, U.member, U.bAdmin, ID('ff')]) {
        expect(await pgError(c, ARCHIVE, [actor, F.ws, slug, null]), actor).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
        expect(await pgError(c, RESTORE, [actor, F.ws]), actor).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      }
      expect((await wsRow(c, F.ws)).archived_at).toBeNull()
    })
  })

  it('적은 주소가 다르면 보관하지 않는다 — 대소문자·공백을 맞춰 주지 않고, 이미 보관된 행이어도 같은 거부다', async () => {
    await asService(pool, async (c) => {
      const slug = await slugOf(c, F.ws)
      for (const typed of [await slugOf(c, F.wsB), slug.toUpperCase(), `${slug} `, '']) {
        expect(await pgError(c, ARCHIVE, [U.platform, F.ws, typed, null]), typed).toMatchObject({ code: '22023', message: 'WORKSPACE_SLUG_MISMATCH' })
      }
      expect((await wsRow(c, F.ws)).archived_at).toBeNull()
      await archive(c, F.ws)
      expect(await pgError(c, ARCHIVE, [U.platform, F.ws, 'other-slug', null])).toMatchObject({ code: '22023', message: 'WORKSPACE_SLUG_MISMATCH' })
    })
  })

  it('없는 워크스페이스·빠진 인자·너무 긴 사유', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, ARCHIVE, [U.platform, ID('00'), 'nope', null])).toMatchObject({ code: 'P0002', message: 'WORKSPACE_NOT_FOUND' })
      expect(await pgError(c, RESTORE, [U.platform, ID('00')])).toMatchObject({ code: 'P0002', message: 'WORKSPACE_NOT_FOUND' })
      expect(await pgError(c, ARCHIVE, [null, F.ws, 'x', null])).toMatchObject({ code: '22023', message: 'WORKSPACE_ARCHIVE_INVALID' })
      expect(await pgError(c, ARCHIVE, [U.platform, F.ws, null, null])).toMatchObject({ code: '22023', message: 'WORKSPACE_ARCHIVE_INVALID' })
      expect(await pgError(c, RESTORE, [U.platform, null])).toMatchObject({ code: '22023', message: 'WORKSPACE_RESTORE_INVALID' })
      const slug = await slugOf(c, F.ws)
      expect(await pgError(c, ARCHIVE, [U.platform, F.ws, slug, '가'.repeat(501)])).toMatchObject({ code: '22023', message: 'WORKSPACE_ARCHIVE_REASON_INVALID' })
      expect(await archive(c, F.ws, '가'.repeat(500))).toMatchObject({ status: 'archived' })
    })
  })
})

describe('② 숨김 — 보관된 워크스페이스는 세션에게 없는 것이다', () => {
  it('관리자·멤버·명단 멤버·플랫폼 관리자 모두 0행·판정 거짓이고, 복원하면 보관 전과 같다', async () => {
    await asService(pool, async (c) => {
      const users = [U.wsAdmin, U.member, U.aLoose, U.dual, U.platform]
      const before = new Map<string, Row>()
      for (const u of users) before.set(u, await view(c, u, F.ws, F.projects.a))
      expect(before.get(U.wsAdmin)).toMatchObject({ ws: 1, projects: expect.any(Number), is_admin: true, p_admin: true })
      expect(Number(before.get(U.wsAdmin)!.wbs)).toBeGreaterThan(0)
      expect(Number(before.get(U.wsAdmin)!.minutes)).toBeGreaterThan(0)

      await archive(c, F.ws, '숨김 확인')
      for (const u of users) expect(await view(c, u, F.ws, F.projects.a), u).toEqual(CLOSED)

      await restore(c, F.ws)
      for (const u of users) expect(await view(c, u, F.ws, F.projects.a), u).toEqual(before.get(u))
    })
  })

  it('다른 워크스페이스는 그대로다 — 두 워크스페이스에 다 속한 사람은 남은 쪽만 본다', async () => {
    await asService(pool, async (c) => {
      const users = [U.bAdmin, U.bMember, U.dual, U.member, U.platform]
      const before = new Map<string, Row>()
      for (const u of users) before.set(u, await view(c, u, F.wsB, F.projects.bWs))
      const mine = async (u: string) => asSession(c, u, async () =>
        (await c.query<{ id: string }>('select id from public.my_workspace_ids() as id order by 1')).rows.map((r) => r.id))
      expect(await mine(U.dual)).toEqual([F.ws, F.wsB].sort())

      await archive(c, F.ws)
      for (const u of users) expect(await view(c, u, F.wsB, F.projects.bWs), u).toEqual(before.get(u))
      expect(await mine(U.dual)).toEqual([F.wsB])
      expect(await mine(U.wsAdmin)).toEqual([])                             // 유일한 소속이 보관됐다 — 소속 0
      expect(await mine(U.platform)).not.toContain(F.ws)                    // 플랫폼 관리자의 "전부"에서도 빠진다
      expect(await mine(U.platform)).toContain(F.wsB)
    })
  })

  it('프로젝트 없는 판정은 그대로다 — is_project_admin(null) 은 플랫폼 관리자에게 참', async () => {
    await asService(pool, async (c) => {
      await archive(c, F.ws)
      const nul = async (u: string) => asSession(c, u, async () => (await c.query<{ v: boolean }>('select public.is_project_admin(null) as v')).rows[0].v)
      expect(await nul(U.platform)).toBe(true)
      expect(await nul(U.wsAdmin)).toBe(false)
    })
  })

  it('저장소 읽기 판정도 닫힌다 — can_attach·can_edit_issue·can_manage_minute', async () => {
    await asService(pool, async (c) => {
      const q = 'select public.can_attach($1) as attach, public.can_edit_issue($2) as issue, public.can_manage_minute($3) as minute'
      const args = [F.leaf.aErp, F.rows.issue, F.rows.minute]
      const of = async (u: string) => asSession(c, u, async () => (await c.query<Row>(q, args)).rows[0])
      const before = await of(U.wsAdmin)
      expect(before).toEqual({ attach: true, issue: true, minute: true })
      await archive(c, F.ws)
      for (const u of [U.wsAdmin, U.member, U.platform]) expect(await of(u), u).toEqual({ attach: false, issue: false, minute: false })
      await restore(c, F.ws)
      expect(await of(U.wsAdmin)).toEqual(before)
    })
  })
})

describe('② 동결 — 세션의 쓰기가 거부된다', () => {
  it('UPDATE 는 0행(RLS 가 대상 행을 가린다), INSERT·projects DELETE 는 42501 — 관리자·플랫폼 관리자 모두', async () => {
    await asService(pool, async (c) => {
      const name = async () => (await c.query<{ name: string }>('select name from public.projects where id = $1', [F.projects.a])).rows[0].name
      const before = await name()
      // 대조 — 보관 전에는 같은 문장이 관리자에게 된다(아래 거부가 열 권한·문장 오류 때문이 아님을 고정한다). savepoint 로 되돌린다
      await c.query('savepoint control')
      await asSession(c, U.wsAdmin, async () => {
        expect((await c.query(`update public.projects set name = '대조' where id = $1`, [F.projects.a])).rowCount).toBe(1)
        expect((await c.query(`update public.people set display_name = '대조' where id = $1`, [F.people.external])).rowCount).toBe(1)
        expect(await pgError(c, `insert into public.people (workspace_id, display_name) values ($1, '새 인물')`, [F.ws])).toBeNull()
        expect(await pgError(c, `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.ws, U.bMember])).toBeNull()
        expect(await pgError(c, `insert into public.issues (project_id, title, created_by) values ($1, '새 이슈', $2)`, [F.projects.a, U.wsAdmin])).toBeNull()
      })
      await c.query('rollback to savepoint control')
      await archive(c, F.ws)
      for (const u of [U.wsAdmin, U.member, U.platform]) {
        await asSession(c, u, async () => {
          expect((await c.query(`update public.projects set name = '바뀜' where id = $1`, [F.projects.a])).rowCount, u).toBe(0)
          expect((await c.query('update public.wbs_items set actual_pct = 55 where id = $1', [F.leaf.aErp])).rowCount, u).toBe(0)
          expect((await c.query(`update public.people set display_name = '바뀜' where workspace_id = $1`, [F.ws])).rowCount, u).toBe(0)
          expect((await c.query(`update public.workspace_members set role = 'member' where workspace_id = $1`, [F.ws])).rowCount, u).toBe(0)
          // 세션의 projects DELETE 는 0058(*_project_delete)이 권한째 거뒀다 — 보관과 무관하게 42501(지우는 길은 delete_project RPC 하나)
          expect(await pgError(c, 'delete from public.projects where id = $1', [F.projects.a]), u).toMatchObject({ code: '42501' })
          expect(await pgError(c, `insert into public.people (workspace_id, display_name) values ($1, '새 인물')`, [F.ws]), u).toMatchObject({ code: '42501' })
          expect(await pgError(c, `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.ws, U.bMember]), u)
            .toMatchObject({ code: '42501' })
          expect(await pgError(c, `insert into public.issues (project_id, title, created_by) values ($1, '새 이슈', $2)`, [F.projects.a, u]), u)
            .toMatchObject({ code: '42501' })
        })
      }
      expect(await name()).toBe(before)
    })
  })

  it('복원 뒤에는 관리자의 쓰기가 다시 된다', async () => {
    await asService(pool, async (c) => {
      await archive(c, F.ws)
      await restore(c, F.ws)
      await asSession(c, U.wsAdmin, async () => {
        expect((await c.query(`update public.projects set name = '복원 뒤' where id = $1`, [F.projects.a])).rowCount).toBe(1)
      })
    })
  })

  it('세션이 실행하는 DEFINER RPC(위키 문서)도 닫힌다 — 안에서 is_project_member 를 다시 본다', async () => {
    await asService(pool, async (c) => {
      const create = (title: string) => asSession(c, U.wsAdmin, () =>
        pgError(c, `select public.create_wiki_document($1, $2, '# x', 'reference', null)`, [F.projects.a, title]))
      const count = async (title: string) => (await c.query('select count(*)::int as n from public.wiki_topics where title = $1', [title])).rows[0].n
      expect(await create('보관 전 문서')).toBeNull()                         // 대조 — 보관 전에는 같은 호출이 된다
      expect(await count('보관 전 문서')).toBe(1)
      await archive(c, F.ws)
      expect(await create('보관 중 문서')).toMatchObject({ code: '42501' })
      expect(await count('보관 중 문서')).toBe(0)
    })
  })
})

describe('③ RPC 안 재판정', () => {
  it('actor_is_workspace_admin·actor_is_project_admin 이 거짓 — 플랫폼 관리자도. 다른 워크스페이스·복원 뒤는 그대로', async () => {
    await asService(pool, async (c) => {
      const q = `select public.actor_is_workspace_admin($1, $2) as ws, public.actor_is_project_admin($1, $3) as project`
      const of = async (actor: string, ws: string, project: string) => (await c.query<Row>(q, [actor, ws, project])).rows[0]
      const a = [U.wsAdmin, U.platform].map((u): [string, string, string] => [u, F.ws, F.projects.a])
      const b = [U.bAdmin, U.platform].map((u): [string, string, string] => [u, F.wsB, F.projects.bWs])
      for (const args of [...a, ...b]) expect(await of(...args), args[0]).toEqual({ ws: true, project: true })
      await archive(c, F.ws)
      for (const args of a) expect(await of(...args), args[0]).toEqual({ ws: false, project: false })
      for (const args of b) expect(await of(...args), args[0]).toEqual({ ws: true, project: true })
      // 명단 admin(워크스페이스 관리자는 아님)의 프로젝트 재판정도 닫힌다
      expect((await c.query<{ v: boolean }>('select public.actor_is_project_admin($1, $2) as v', [U.member, F.projects.a])).rows[0].v).toBe(false)
      await restore(c, F.ws)
      for (const args of a) expect(await of(...args), args[0]).toEqual({ ws: true, project: true })
    })
  })

  it('그 재판정을 거치는 쓰기 RPC 는 보관된 워크스페이스에서 AUTHZ_FORBIDDEN 이다 — 이름 변경·공용 팀 생성', async () => {
    await asService(pool, async (c) => {
      await archive(c, F.ws)
      for (const actor of [U.wsAdmin, U.platform]) {
        expect(await pgError(c, 'select public.rename_workspace($1, $2, $3)', [actor, F.ws, '새 이름']), actor).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
        expect(await pgError(c, 'select public.create_team($1, $2, $3, $4, $5, $6)', [actor, F.ws, 'ARC', '보관 중 팀', null, 0]), actor)
          .toMatchObject({ code: '42501' })
      }
      // 다른 워크스페이스에서는 그대로 된다
      expect(await pgError(c, 'select public.rename_workspace($1, $2, $3)', [U.bAdmin, F.wsB, '새 이름 B'])).toBeNull()
    })
  })

  it('삭제(0055)는 그대로다 — 보관된 워크스페이스도 비어 있으면 지울 수 있고, 비어 있지 않으면 거부된다', async () => {
    await asService(pool, async (c) => {
      const { rows: [{ r }] } = await c.query<{ r: { workspace_id: string } }>(
        'select public.create_workspace_with_admin($1, $2, $3, $4, $5::jsonb, $6, $7) as r',
        [U.platform, 'rls-0056-empty', '빈 조직', U.platform, JSON.stringify({ 'modules.allowed': [] }), ID('c1'), 1])
      await archive(c, r.workspace_id, '곧 삭제')
      const del = async (ws: string, slug: string) =>
        (await c.query<{ r: Row }>('select public.delete_empty_workspace($1, $2, $3) as r', [U.platform, ws, slug])).rows[0].r
      expect(await del(r.workspace_id, 'rls-0056-empty')).toMatchObject({ status: 'deleted' })
      await archive(c, F.ws)
      expect(await del(F.ws, await slugOf(c, F.ws))).toMatchObject({ status: 'blocked' })
    })
  })
})

describe('④ 큐·정리 — 보관 중에는 건드리지 않고, 복원하면 이어진다', () => {
  const putIndexJob = (c: PoolClient, key: string, ws: string, project: string) => c.query(
    `insert into public.ai_index_jobs (job_key, operation, project_id, workspace_id, domain, entity_type, entity_id, payload, status, attempts, run_after, generation, updated_at)
     values ($1, 'upsert', $2, $3, 'issues', 'issue', $1, '{}', 'pending', 2, '2000-01-01T00:00:00Z', 0, '2000-01-01T00:00:00Z')`, [key, project, ws])
  const indexJob = async (c: PoolClient, key: string) =>
    (await c.query<Row>('select status, attempts, locked_at, updated_at::text as updated_at from public.ai_index_jobs where job_key = $1', [key])).rows[0]
  const claimKeys = async (c: PoolClient) =>
    (await c.query<{ job_key: string }>('select job_key from public.claim_ai_index_jobs(50, 300)')).rows.map((r) => r.job_key).filter((k) => k.startsWith('arc-')).sort()

  it('색인 큐 선점 — 보관된 워크스페이스의 잡은 집지 않고 행도 그대로다(대기·lease 만료 둘 다). 복원하면 집는다', async () => {
    await asService(pool, async (c) => {
      await c.query(`update public.ai_index_jobs set status = 'done'`)        // 픽스처·다른 케이스의 잡이 끼어들지 않게(이 트랜잭션 안에서만)
      await putIndexJob(c, 'arc-a-pending', F.ws, F.projects.a)
      await putIndexJob(c, 'arc-a-expired', F.ws, F.projects.a)
      await c.query(`update public.ai_index_jobs set status = 'running', locked_at = '2000-01-01T00:00:00Z' where job_key = 'arc-a-expired'`)
      await putIndexJob(c, 'arc-b-pending', F.wsB, F.projects.bWs)
      const before = { pending: await indexJob(c, 'arc-a-pending'), expired: await indexJob(c, 'arc-a-expired') }

      await archive(c, F.ws)
      expect(await claimKeys(c)).toEqual(['arc-b-pending'])
      expect(await claimKeys(c)).toEqual([])                                 // 다시 불러도 보관된 쪽은 안 나온다
      expect(await indexJob(c, 'arc-a-pending')).toEqual(before.pending)     // 상태·시도 횟수·시각 그대로 — 잃지 않았다
      expect(await indexJob(c, 'arc-a-expired')).toEqual(before.expired)

      await restore(c, F.ws)
      expect(await claimKeys(c)).toEqual(['arc-a-expired', 'arc-a-pending'])
      expect(await indexJob(c, 'arc-a-pending')).toMatchObject({ status: 'running', attempts: 2 })
    })
  })

  it('색인 큐 — 서비스 역할(service_role)로 실행해도 같다(선점 함수는 INVOKER 다)', async () => {
    await asService(pool, async (c) => {
      await c.query(`update public.ai_index_jobs set status = 'done'`)
      await putIndexJob(c, 'arc-svc', F.ws, F.projects.a)
      await archive(c, F.ws)
      await c.query('set local role service_role')
      expect(await claimKeys(c)).toEqual([])
      await c.query('reset role')
      await restore(c, F.ws)
      await c.query('set local role service_role')
      expect(await claimKeys(c)).toEqual(['arc-svc'])
      await c.query('reset role')
    })
  })

  it('위키 회의록 잡 선점 — 보관 중에는 0행이고 잡은 그대로(시도 횟수도 늘지 않는다). 복원하면 집는다', async () => {
    await asService(pool, async (c) => {
      const JOB = 7057001   // 픽스처: 프로젝트 A 의 회의록 잡
      await c.query(`update public.wiki_processing_jobs set status = 'pending', attempts = 1, run_after = '2000-01-01T00:00:00Z', locked_at = null, locked_by = null where id = $1`, [JOB])
      const job = async () => (await c.query<Row>('select status, attempts, locked_by from public.wiki_processing_jobs where id = $1', [JOB])).rows[0]
      const claim = async () => (await c.query('select id from public.claim_wiki_processing_job($1, $2, 900)', [JOB, 'rls-0056'])).rowCount
      await archive(c, F.ws)
      expect(await claim()).toBe(0)
      expect(await job()).toEqual({ status: 'pending', attempts: 1, locked_by: null })
      await restore(c, F.ws)
      expect(await claim()).toBe(1)
      expect(await job()).toEqual({ status: 'running', attempts: 2, locked_by: 'rls-0056' })
    })
  })

  it('위키 프로젝트 재구성 선점 — 보관 중에는 그 프로젝트를 지정해도, 전역으로 불러도 집지 않는다. 복원하면 집는다', async () => {
    await asService(pool, async (c) => {
      await c.query(`update public.wiki_project_rebuild_jobs set status = 'done'`)
      await c.query(`insert into public.wiki_project_rebuild_jobs (project_id) values ($1)
        on conflict (project_id) do update set status = 'pending', run_after = '2000-01-01T00:00:00Z', locked_at = null, locked_by = null,
          cursor_observed_sort = null, cursor_minute_id = null, attempts = 0`, [F.projects.a])
      const rebuild = async () =>
        (await c.query<Row>('select status, attempts, locked_by, reset_generation from public.wiki_project_rebuild_jobs where project_id = $1', [F.projects.a])).rows[0]
      const before = await rebuild()
      const claim = async (project: string | null) =>
        (await c.query<{ claimed_project_id: string }>('select claimed_project_id from public.claim_wiki_project_rebuild_step($1, $2, 900)', [project, 'rls-0056'])).rows
      await archive(c, F.ws)
      expect(await claim(F.projects.a)).toEqual([])
      expect(await claim(null)).toEqual([])
      expect(await rebuild()).toEqual(before)                                // soft-reset 도 일어나지 않았다(지식이 지워지지 않는다)
      await restore(c, F.ws)
      expect(await claim(F.projects.a)).toEqual([{ claimed_project_id: F.projects.a }])
    })
  })

  it('읽은 알림 정리 — 보관된 워크스페이스의 수신 행·이벤트는 기한이 지나도 지우지 않는다. 복원하면 지운다', async () => {
    await asService(pool, async (c) => {
      const put = async (event: string, recipient: string, project: string) => {
        await c.query(`insert into public.notification_events (id, type, category, audience, project_id, payload, created_at)
          values ($1, 'rls_test', 'system', 'direct', $2, '{}', now() - interval '200 days')`, [event, project])
        await c.query(`insert into public.notification_recipients (id, event_id, user_id, read_at) values ($1, $2, $3, now() - interval '100 days')`, [recipient, event, U.member])
      }
      await put(ID('e1'), ID('a1'), F.projects.a)
      await put(ID('e2'), ID('a2'), F.projects.bWs)
      const left = async () => ({
        recipients: (await c.query<{ id: string }>('select id from public.notification_recipients where id = any($1) order by 1', [[ID('a1'), ID('a2')]])).rows.map((r) => r.id),
        events: (await c.query<{ id: string }>('select id from public.notification_events where id = any($1) order by 1', [[ID('e1'), ID('e2')]])).rows.map((r) => r.id),
      })
      await archive(c, F.ws)
      await c.query('select * from public.purge_read_notifications(90)')
      expect(await left()).toEqual({ recipients: [ID('a1')], events: [ID('e1')] })   // B 의 것만 지워졌다
      await restore(c, F.ws)
      await c.query('select * from public.purge_read_notifications(90)')
      expect(await left()).toEqual({ recipients: [], events: [] })
    })
  })
})
