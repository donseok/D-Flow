// H2-d(AUTH-01b) — 워크스페이스에서 빠지면 그 워크스페이스 명단 행의 access_role 이 null 이 된다(행은 남는다). 재초대는 재초대한
// 프로젝트만 되살린다. 계정 삭제 캐스케이드·본인 세션(claims)에서의 소속 삭제가 새 사슬(트리거 → 명단 가드 → no_self_demote)에
// 막히지 않는다. upsert_project_member 는 소속 없는 명단 admin 을 호출자로 받지 않는다. 세션은 workspace_members 의 role 만 고친다.
import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const roleOf = async (c: PoolClient, memberId: string) =>
  (await c.query<{ r: string | null }>('select access_role as r from public.project_members where id = $1', [memberId])).rows[0]?.r
const DANA_B = '00000000-0000-0000-7e57-000000001220'   // dana 의 A 워크스페이스 프로젝트 b(c2) 명단 행
const INSERT_AUTH_USER = `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  aud, role, instance_id, created_at, updated_at) values ($1, $2, '', now(), '{}', '{}', 'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000', now(), now())`

describe('H2-d 소속 회수 = 권한 소멸', () => {
  it('워크스페이스에서 빠지면 그 워크스페이스 명단 행은 남고 access_role 만 null — 다른 워크스페이스 명단은 그대로', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.project_members (id, project_id, person_id, access_role) values ($1, $2, $3, 'member')`,
        [DANA_B, F.projects.b, F.people.dualA])
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.dual])
      expect(await roleOf(c, F.members.danaA)).toBeNull()
      expect(await roleOf(c, DANA_B)).toBeNull()
      expect(await roleOf(c, F.members.danaB)).toBe('member')
      expect((await c.query<{ n: number }>('select count(*)::int as n from public.project_members where id = any($1::uuid[])',
        [[F.members.danaA, DANA_B]])).rows[0].n).toBe(2)
    })
  })

  it('재가입(done_when): 빠졌다 member 로 재초대되면 재초대한 프로젝트만 member, 같은 워크스페이스 다른 프로젝트는 null — 옛 admin 이 되살아나지 않는다', async () => {
    await asService(pool, async (c) => {
      // alice: A 의 프로젝트 a 관리자, b·c3 멤버. A 에서 빠진 뒤 a 에 member 로 재초대
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.member])
      const hash = sha256('rls-h2-rejoin')
      await c.query(`insert into public.project_invites (workspace_id, project_id, email, access_role, token_hash, created_by, expires_at)
        values ($1, $2, 'rls-alice@example.com', 'member', $3, $4, now() + interval '1 day')`, [F.ws, F.projects.a, hash, F.users.wsAdmin])
      const r = await c.query('select * from public.consume_project_invite($1, $2, $3)', [hash, 'rls-alice@example.com', F.users.member])
      expect(r.rows).toEqual([{ workspace_id: F.ws, project_id: F.projects.a, member_id: F.members.aliceA }])
      expect(await roleOf(c, F.members.aliceA)).toBe('member')
      expect(await roleOf(c, F.members.aliceB)).toBeNull()
      expect(await roleOf(c, F.members.alicePrivate)).toBeNull()
    })
  })

  it('소속의 user_id·workspace_id 를 바꾸는 UPDATE(service 경로)도 옛 워크스페이스 권한을 지운다', async () => {
    await asService(pool, async (c) => {
      await c.query('update public.workspace_members set workspace_id = $3 where workspace_id = $1 and user_id = $2',
        [F.ws, F.users.member, F.wsB])
      expect(await roleOf(c, F.members.aliceA)).toBeNull()
      expect(await roleOf(c, F.members.aliceB)).toBeNull()
    })
  })

  it('Review Focus 3 — 계정 삭제(auth.users) 캐스케이드가 새 사슬에 막히지 않는다(계정 생성 보상 롤백 경로)', async () => {
    await asService(pool, async (c) => {
      const U = '00000000-0000-0000-7e57-000000001221', PE = '00000000-0000-0000-7e57-000000001222', PM = '00000000-0000-0000-7e57-000000001223'
      await c.query(INSERT_AUTH_USER, [U, 'rls-h2-gone@example.com'])
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.ws, U])
      await c.query(`insert into public.people (id, workspace_id, display_name, email, user_id) values ($1, $2, 'gone', 'rls-h2-gone@example.com', $3)`,
        [PE, F.ws, U])
      await c.query(`insert into public.project_members (id, project_id, person_id, access_role) values ($1, $2, $3, 'member')`, [PM, F.projects.a, PE])
      expect(await pgError(c, 'delete from auth.users where id = $1', [U])).toBeNull()
      expect(await roleOf(c, PM)).toBeNull()
    })
  })

  it('본인 claims 인 채 소속이 지워져도(0009 ⓐ 와 같은 순서) no_self_demote 가 막지 않는다', async () => {
    await asUser(pool, F.users.dual, async (c) => {
      await c.query('reset role')
      expect(await pgError(c, 'delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.dual])).toBeNull()
      expect(await roleOf(c, F.members.danaA)).toBeNull()
    })
  })

  it('소속이 있는 본인의 강등은 여전히 PROJECT_MEMBER_SELF_DEMOTE', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')   // postgres 로 RLS 를 건너 트리거만 본다(claims = alice)
      expect(await pgError(c, 'update public.project_members set access_role = null where id = $1', [F.members.aliceA]))
        .toMatchObject({ code: '42501', message: 'PROJECT_MEMBER_SELF_DEMOTE' })
    })
  })

  it('upsert_project_member: 소속 없는 명단 admin(사전 검사가 막는 잔존 상태를 강제로 만든 것)은 호출자가 될 수 없다', async () => {
    await asService(pool, async (c) => {
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.member])
      await c.query('set local session_replication_role = replica')   // 트리거를 끄고 잔존 admin 을 되살린다
      await c.query(`update public.project_members set access_role = 'admin' where id = $1`, [F.members.aliceA])
      await c.query('set local session_replication_role = origin')
      expect(await pgError(c, 'select public.upsert_project_member($1, $2, $3::jsonb, $4::jsonb, null)', [
        F.users.member, F.projects.a, JSON.stringify({ id: F.people.external }), JSON.stringify({ role_label: 'x' }),
      ])).toMatchObject({ code: '42501', message: 'PROJECT_MEMBER_FORBIDDEN' })
    })
  })

  it('세션은 workspace_members 의 role 만 고친다 — user_id·workspace_id·invited_by 는 42501', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, `update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`,
        [F.ws, F.users.aLoose])).toBeNull()
      for (const col of ['user_id', 'workspace_id', 'invited_by']) {
        expect(await pgError(c, `update public.workspace_members set ${col} = ${col} where workspace_id = $1 and user_id = $2`,
          [F.ws, F.users.aLoose]), col).toMatchObject({ code: '42501' })
      }
    })
  })

  it('role 열의 UPDATE 도 정책이 가른다 — B 관리자(bea)·A 평멤버 본인(cy)은 A 소속 행(cy)의 role 을 올리지 못한다(값 그대로)', async () => {
    // 0011 뒤 authenticated 에 남은 UPDATE 는 role 열뿐이라 격리 스캔의 `set workspace_id = workspace_id` 탐침은 열 권한(42501)에서 멈추고
    // 정책(workspace_members_update — 0054 가 FOR ALL 을 나눴다)까지 가지 않는다 — 정책을 태우는 쓰기는 role 뿐이므로 여기서 본다. WHERE 가 있는 UPDATE 는 읽기 정책도
    // 거쳐 bea 에게는 A 행이 가려져 UPDATE 정책과 무관하게 0행이다 — WHERE 없는 UPDATE 로 UPDATE 정책만 태우고 A 의 cy 행을 postgres 로 본다
    for (const uid of [F.users.bAdmin, F.users.aLoose]) {
      await asUser(pool, uid, async (c) => {
        await c.query(`update public.workspace_members set role = 'admin'`)
        await c.query('reset role')
        expect((await c.query<{ role: string }>('select role from public.workspace_members where workspace_id = $1 and user_id = $2',
          [F.ws, F.users.aLoose])).rows, uid).toEqual([{ role: 'member' }])
      })
    }
  })
})
