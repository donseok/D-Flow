// H2-e(AUTH-09a) — 세션은 access_granted_by·access_granted_at 을 직접 쓰지 못한다(열 권한). 세션에서 역할이 바뀌면 부여자는 그 세션
// 사용자로 찍히고(회수·소속 삭제 사슬 포함), 역할이 그대로면 찍지 않는다. service_role 경로(RPC)는 호출부가 준 p_actor 를 그대로 두고,
// 발급자 계정 삭제의 SET NULL 은 막지 않는다. 세션 사용자 자신의 계정이 지워지는 캐스케이드에서는 그 계정을 찍지 않는다(FK 23503).
// 자기 명단 행의 부여자가 자기 자신이어도 계정 삭제는 막히지 않는다(계정 없는 인물 검사는 역할을 주거나 옮기는 문장에서만).
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

describe('H2-e access_granted_*', () => {
  it('세션은 access_granted_by·access_granted_at 을 UPDATE·INSERT 로 쓰지 못한다(42501)', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, 'update public.project_members set access_granted_by = $2 where id = $1', [F.members.danaA, F.users.wsAdmin]))
        .toMatchObject({ code: '42501' })
      expect(await pgError(c, 'update public.project_members set access_granted_at = now() where id = $1', [F.members.danaA]))
        .toMatchObject({ code: '42501' })
      expect(await pgError(c, `insert into public.project_members (project_id, person_id, access_role, access_granted_by) values ($1, $2, 'member', $3)`,
        [F.projects.b, F.people.aLoose, F.users.member])).toMatchObject({ code: '42501' })
    })
  })

  it('세션에서 역할이 바뀌면 부여자 = 세션 사용자(INSERT·UPDATE), 역할이 그대로면 찍지 않는다', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      const up = await c.query<{ by: string }>(`update public.project_members set access_role = 'admin' where id = $1 returning access_granted_by as by`,
        [F.members.danaA])
      expect(up.rows).toEqual([{ by: F.users.wsAdmin }])
      const ins = await c.query<{ by: string }>(
        `insert into public.project_members (project_id, person_id, access_role) values ($1, $2, 'member') returning access_granted_by as by`,
        [F.projects.b, F.people.aLoose])
      expect(ins.rows).toEqual([{ by: F.users.wsAdmin }])
      const same = await c.query<{ by: string | null }>(`update public.project_members set title = 'rls' where id = $1 returning access_granted_by as by`,
        [F.members.bobA])
      expect(same.rows).toEqual([{ by: null }])
    })
  })

  it('service_role 경로(RPC)는 p_actor 를 부여자로 둔다 — 가드가 덮지 않는다', async () => {
    await asService(pool, async (c) => {
      const { rows: [r] } = await c.query<{ id: string }>('select public.upsert_project_member($1, $2, $3::jsonb, $4::jsonb, null) as id', [
        F.users.wsAdmin, F.projects.a, JSON.stringify({ id: F.people.aLoose }), JSON.stringify({ access_role: 'member' }),
      ])
      expect((await c.query('select access_granted_by as by from public.project_members where id = $1', [r.id])).rows[0].by).toBe(F.users.wsAdmin)
    })
  })

  it('발급자 계정 삭제의 SET NULL 은 막지 않는다', async () => {
    await asService(pool, async (c) => {
      const G = '00000000-0000-0000-7e57-000000001230'
      await c.query(`insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role,
        instance_id, created_at, updated_at) values ($1, 'rls-h2-g2@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())`, [G])
      await c.query('update public.project_members set access_granted_by = $2 where id = $1', [F.members.danaA, G])
      expect(await pgError(c, 'delete from auth.users where id = $1', [G])).toBeNull()
      expect((await c.query('select access_granted_by as by from public.project_members where id = $1', [F.members.danaA])).rows[0].by).toBeNull()
    })
  })

  it('세션이 역할을 회수(null)해도 부여자 = 회수한 세션 사용자', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      const r = await c.query<{ r: string | null; by: string }>(
        'update public.project_members set access_role = null where id = $1 returning access_role as r, access_granted_by as by', [F.members.danaA])
      expect(r.rows).toEqual([{ r: null, by: F.users.wsAdmin }])
    })
  })

  // 0054 — 세션은 소속을 직접 지우지 못한다(권한·정책 회수). 소속 삭제의 정식 길은 remove_workspace_member(0053, service_role)다
  it('세션의 소속 직접 삭제는 42501 — 명단 권한·부여자는 그대로다', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      const before = await c.query('select access_role as r, access_granted_by as by from public.project_members where id = $1', [F.members.danaA])
      expect(await pgError(c, 'delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.dual]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for table workspace_members') })
      const after = await c.query('select access_role as r, access_granted_by as by from public.project_members where id = $1', [F.members.danaA])
      expect(after.rows).toEqual(before.rows)
      expect(after.rows[0].r).not.toBeNull()
    })
  })

  it('제거 RPC 가 소속을 지우면(④ 트리거가 명단 권한 회수) 권한이 null 이 된다 — service 경로라 부여자 도장은 세션 사용자로 바뀌지 않는다', async () => {
    await asService(pool, async (c) => {
      const before = await c.query<{ by: string | null }>('select access_granted_by as by from public.project_members where id = $1', [F.members.danaA])
      expect(await pgError(c, 'select public.remove_workspace_member($1, $2, $3, $4)',
        [F.users.wsAdmin, F.ws, F.users.dual, '00000000-0000-4000-8000-000000005471'])).toBeNull()
      const r = await c.query<{ r: string | null; by: string | null }>('select access_role as r, access_granted_by as by from public.project_members where id = $1', [F.members.danaA])
      expect(r.rows).toEqual([{ r: null, by: before.rows[0].by }])
    })
  })

  it('본인 claims 인 채 그 계정(auth.users)을 지워도 캐스케이드가 막히지 않는다 — 사라지는 계정을 부여자로 찍지 않는다', async () => {
    await asUser(pool, F.users.dual, async (c) => {
      await c.query('reset role')   // authenticated 는 auth.users 를 지울 수 없다 — postgres 로, claims 는 dana 그대로
      expect(await pgError(c, 'delete from auth.users where id = $1', [F.users.dual])).toBeNull()
      const r = await c.query('select access_role as r, access_granted_by as by from public.project_members where id = $1', [F.members.danaA])
      expect(r.rows).toEqual([{ r: null, by: null }])
    })
  })

  it('자기 명단 행을 자기가 부여한 계정(워크스페이스 관리자가 자기를 명단에 올린 경우)도 지워진다 — claims 없이·본인 claims 로', async () => {
    // 캐스케이드 순서: people.user_id SET NULL(계정 없는 인물이 됨) → access_granted_by SET NULL(역할은 그대로인 UPDATE) → 끝에
    // people_unlink_revokes_access 가 역할을 null 로. 둘째 단계에서 가드가 '계정 없는 인물의 역할'로 거부하면 계정 삭제가 통째로 실패한다.
    for (const claims of [false, true]) {
      const run = async (c: PoolClient) => {
        await c.query('reset role')
        await c.query('update public.project_members set access_granted_by = $2 where id = $1', [F.members.danaA, F.users.dual])
        expect(await pgError(c, 'delete from auth.users where id = $1', [F.users.dual]), `claims=${claims}`).toBeNull()
        const r = await c.query('select access_role as r, access_granted_by as by from public.project_members where id = $1', [F.members.danaA])
        expect(r.rows, `claims=${claims}`).toEqual([{ r: null, by: null }])
      }
      if (claims) await asUser(pool, F.users.dual, run)
      else await asService(pool, run)
    }
  })

  it('계정 없는 인물의 역할은 주는 문장(INSERT·역할 변경)에서 여전히 PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT — 인물 변경은 그보다 먼저 PROJECT_MEMBER_PERSON_IMMUTABLE', async () => {
    const NO_ACCOUNT = { code: '23514', message: 'PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT' }
    await asService(pool, async (c) => {
      expect(await pgError(c, `insert into public.project_members (project_id, person_id, access_role) values ($1, $2, 'member')`,
        [F.projects.b, F.people.external]), 'insert').toMatchObject(NO_ACCOUNT)
      expect(await pgError(c, `update public.project_members set access_role = 'member' where id = $1`, [F.members.bobA]), 'role')
        .toMatchObject(NO_ACCOUNT)
      // SP4 _authz_carry ②′ — 명단 행의 person_id 는 바꿀 수 없다(project_id 불변 검사 바로 뒤라 계정 검사보다 먼저 멈춘다)
      expect(await pgError(c, 'update public.project_members set person_id = $2 where id = $1', [F.members.danaA, F.people.external]), 'person')
        .toMatchObject({ code: '23514', message: 'PROJECT_MEMBER_PERSON_IMMUTABLE' })
    })
  })
})
