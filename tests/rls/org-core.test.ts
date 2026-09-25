// 조직 코어(0003_org_core) RLS·트리거·컬럼 권한 케이스 — SP1 done_when 의 "통과/거부" 를 손 실측 대신 테스트로 남긴다.
// 로컬 DB 필요: npm run db:start 뒤 npm run test:rls. 각 케이스는 begin…rollback 안에서 돈다(harness.ts).
import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool

beforeAll(async () => {
  pool = openPool()
  await loadFixture(pool)
})

afterAll(async () => {
  await pool?.end()
})

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// 케이스 ⑦ 에서만 트랜잭션 안에 만드는 계정(롤백으로 사라진다) — fixture.sql 과 같은 id 체계
const CAROL = { id: '00000000-0000-0000-7e57-0000000000a4', email: 'rls-carol@example.com' }
const DAN = { id: '00000000-0000-0000-7e57-0000000000a5', email: 'rls-dan@example.com' }
const INSERT_AUTH_USER = `
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  values ($1, $2, '', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated',
          '00000000-0000-0000-0000-000000000000', now(), now())`

describe('조직 코어 RLS (0003_org_core)', () => {
  it('① alice 는 A 의 ERP 리프 실적을 고칠 수 있고, B 의 QA2 리프는 0행', async () => {
    await asUser(pool, F.users.member, async (c) => {
      const upd = 'update public.wbs_items set actual_pct = 10 where id = $1'
      // A: alice 는 프로젝트 관리자(admin_write_items)
      expect((await c.query(upd, [F.leaf.aErp])).rowCount).toBe(1)
      // B: alice 는 멤버, 리프 담당 QA2 ∉ alice 의 B 팀(QA) → member_update_actual 의 using 에 걸려 0행
      expect((await c.query(upd, [F.leaf.bQa])).rowCount).toBe(0)
      // 대조: 같은 B 에서 담당이 alice 의 팀(QA)인 리프는 멤버 경로로 통과 — 위 0행이 "B 전체 차단" 이 아님을 보인다
      expect((await c.query(upd, [F.leaf.bOwnTeam])).rowCount).toBe(1)
    })
  })

  it('② can_attach 도 같은 짝', async () => {
    await asUser(pool, F.users.member, async (c) => {
      const attach = async (item: string) =>
        (await c.query<{ ok: boolean }>('select public.can_attach($1) as ok', [item])).rows[0].ok
      expect(await attach(F.leaf.aErp)).toBe(true)
      expect(await attach(F.leaf.bQa)).toBe(false)
      expect(await attach(F.leaf.bOwnTeam)).toBe(true)
    })
  })

  it('③ 워크스페이스 관리자는 명단 행 없이 is_project_admin(A)=true', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      const { rows } = await c.query<{ admin: boolean; on_roster: boolean }>(
        `select public.is_project_admin($1) as admin,
                exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                         where pm.project_id = $1 and pe.user_id = $2) as on_roster`,
        [F.projects.a, F.users.wsAdmin],
      )
      expect(rows[0]).toEqual({ admin: true, on_roster: false })
    })
    // 대조: 명단상 B 멤버인 alice 는 B 관리자가 아니다 — 함수가 아무에게나 true 를 주지 않는다
    await asUser(pool, F.users.member, async (c) => {
      const { rows } = await c.query<{ admin: boolean }>('select public.is_project_admin($1) as admin', [F.projects.b])
      expect(rows[0].admin).toBe(false)
    })
  })

  it('④ 계정 없는 인물에게 access_role → 23514', async () => {
    await asService(pool, async (c) => {
      const err = await pgError(
        c,
        `update public.project_members set access_role = 'member' where person_id = $1 and project_id = $2`,
        [F.people.external, F.projects.a],
      )
      expect(err).toMatchObject({ code: '23514', message: 'PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT' })
    })
  })

  it('⑤ 본인 access_role 회수: 세션은 0행, RPC 는 42501, 워크스페이스 관리자는 통과', async () => {
    const demote = 'update public.project_members set access_role = null where id = $1'
    // 세션(alice, A 관리자): 본인 행은 admin 이라 admin_write_member_rows 의 using 에서 가려진다 → 오류가 아니라 0행
    await asUser(pool, F.users.member, async (c) => {
      expect((await c.query(demote, [F.members.aliceA])).rowCount).toBe(0)
      const { rows } = await c.query<{ access_role: string | null }>(
        'select access_role from public.project_members where id = $1', [F.members.aliceA])
      expect(rows[0].access_role).toBe('admin')
    })
    // service_role 경로(서버 액션이 부르는 RPC): 본문 판정이 SELF_DEMOTE 로 거부
    await asService(pool, async (c) => {
      const err = await pgError(c, 'select public.upsert_project_member($1, $2, $3::jsonb, $4::jsonb, null)', [
        F.users.member, F.projects.a, JSON.stringify({ id: F.people.member }), JSON.stringify({ access_role: null }),
      ])
      expect(err).toMatchObject({ code: '42501', message: 'PROJECT_MEMBER_SELF_DEMOTE' })
    })
    // 세션(워크스페이스 관리자): wsadmin_write_admin_rows 로 보이고, 본인 행이 아니므로 트리거도 통과
    await asUser(pool, F.users.wsAdmin, async (c) => {
      const r = await c.query<{ access_role: string | null }>(`${demote} returning access_role`, [F.members.aliceA])
      expect(r.rowCount).toBe(1)
      expect(r.rows[0].access_role).toBeNull()
    })
  })

  it('⑥ 마지막 워크스페이스 관리자 강등 거부', async () => {
    await asService(pool, async (c) => {
      const err = await pgError(
        c,
        `update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`,
        [F.ws, F.users.wsAdmin],
      )
      expect(err).toMatchObject({ code: '23514', message: 'WORKSPACE_LAST_ADMIN' })
    })
  })

  it('⑦ consume_project_invite 는 다섯 쓰기를 한 트랜잭션으로, 재사용은 0행', async () => {
    await asService(pool, async (c) => {
      const invite = `
        insert into public.project_invites (workspace_id, project_id, email, access_role, team_ids, token_hash, created_by, expires_at)
        values ($1, $2, $3, 'member', $4::uuid[], $5, $6, now() + interval '1 day')`
      const consume = 'select * from public.consume_project_invite($1, $2, $3)'

      // 정상 수락: 초대 소비 + profiles·people·workspace_members·project_members·project_member_teams
      const hash = sha256('tok')
      await c.query(INSERT_AUTH_USER, [CAROL.id, CAROL.email])
      await c.query(invite, [F.ws, F.projects.a, CAROL.email, [F.teams.erp], hash, F.users.member])
      const first = await c.query(consume, [hash, CAROL.email, CAROL.id])
      expect(first.rows).toEqual([{ workspace_id: F.ws, project_id: F.projects.a, member_id: expect.any(String) }])
      const memberId: string = first.rows[0].member_id
      expect((await c.query(consume, [hash, CAROL.email, CAROL.id])).rowCount).toBe(0)
      const { rows: [n] } = await c.query(
        `select
           (select count(*)::int from public.profiles where user_id = $1) as profiles,
           (select count(*)::int from public.people where user_id = $1 and workspace_id = $2) as people,
           (select count(*)::int from public.workspace_members where user_id = $1 and workspace_id = $2 and role = 'member') as ws_members,
           (select count(*)::int from public.project_members pm join public.people pe on pe.id = pm.person_id
             where pe.user_id = $1 and pm.project_id = $3 and pm.id = $4 and pm.access_role = 'member') as project_members,
           (select count(*)::int from public.project_member_teams where member_id = $4 and team_id = $5 and is_primary) as teams,
           (select count(*)::int from public.project_invites where token_hash = $6 and redeemed_by = $1 and redeemed_at is not null) as redeemed`,
        [CAROL.id, F.ws, F.projects.a, memberId, F.teams.erp, hash],
      )
      expect(n).toEqual({ profiles: 1, people: 1, ws_members: 1, project_members: 1, teams: 1, redeemed: 1 })

      // 한 트랜잭션: 중간(인물 연결 단계)에서 실패하면 그 앞의 초대 소비도 남지 않는다 — "소비된 초대 + 소속 없음" 이 생기지 않는다.
      // dan 이 이미 alice 계정에 연결된 인물의 이메일로 온 초대를 수락 → PROJECT_INVITE_PERSON_LINKED.
      // (dan 의 프로필을 미리 둔다 — 없으면 profiles.email 유일 위반이 먼저 나서 인물 단계까지 가지 못한다)
      const linkedHash = sha256('tok-linked')
      await c.query(INSERT_AUTH_USER, [DAN.id, DAN.email])
      await c.query('insert into public.profiles (user_id, email, display_name) values ($1, $2, $3)', [DAN.id, DAN.email, 'dan'])
      await c.query(invite, [F.ws, F.projects.b, 'rls-alice@example.com', null, linkedHash, F.users.wsAdmin])
      const err = await pgError(c, consume, [linkedHash, 'rls-alice@example.com', DAN.id])
      expect(err).toMatchObject({ code: '23505', message: 'PROJECT_INVITE_PERSON_LINKED' })
      const { rows: [after] } = await c.query(
        `select (select redeemed_at is null and redeemed_by is null from public.project_invites where token_hash = $1) as unconsumed,
                not exists (select 1 from public.workspace_members where user_id = $2) as no_ws_member`,
        [linkedHash, DAN.id],
      )
      expect(after).toEqual({ unconsumed: true, no_ws_member: true })
    })
  })

  it('⑧ 세션은 people 의 user_id·active 를 쓰지 못한다(컬럼 권한 42501)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      const denied = { code: '42501', message: expect.stringMatching(/^permission denied for table people/) }
      expect(await pgError(c, 'update public.people set user_id = $1 where id = $2', [F.users.platform, F.people.external]))
        .toMatchObject(denied)
      expect(await pgError(c, 'update public.people set active = false where id = $1', [F.people.external]))
        .toMatchObject(denied)
      expect(await pgError(c, 'insert into public.people (workspace_id, display_name, user_id) values ($1, $2, $3)', [
        F.ws, 'mallory', F.users.platform,
      ])).toMatchObject(denied)
      // 대조: 같은 세션이 같은 행의 허용 컬럼(display_name)은 고친다 — 위 거부가 RLS·표 권한이 아니라 컬럼 권한 때문이다
      expect((await c.query('update public.people set display_name = $1 where id = $2', ['bob k', F.people.external])).rowCount)
        .toBe(1)
    })
  })

  it('⑨ 프로젝트의 워크스페이스는 세션·service 모두 못 바꾼다(projects_guard 23514)', async () => {
    const move = 'update public.projects set workspace_id = $1 where id = $2'
    const immutable = { code: '23514', message: 'PROJECT_WORKSPACE_IMMUTABLE' }
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, move, [F.otherWs, F.projects.a])).toMatchObject(immutable)
      // 대조: A 관리자인 alice 는 다른 컬럼은 고친다(admin_update_projects) — 거부가 RLS 가 아니라 트리거 때문이다
      expect((await c.query('update public.projects set name = $1 where id = $2', ['RLS A2', F.projects.a])).rowCount).toBe(1)
    })
    await asService(pool, async (c) => {
      expect(await pgError(c, move, [F.otherWs, F.projects.a])).toMatchObject(immutable)
    })
  })

  it('⑩ upsert_project_member 이메일 분기는 기존 인물의 이름을 덮지 않는다(0004) — 새 이메일이면 입력 이름으로 만든다', async () => {
    const upsert = 'select public.upsert_project_member($1, $2, $3::jsonb, $4::jsonb, null) as id'
    const memberOf = `select pm.project_id, pm.person_id, pe.display_name
                        from public.project_members pm join public.people pe on pe.id = pm.person_id where pm.id = $1`
    // 트랜잭션 안에서만 있는 B 명단 인물 erin(외부 인력) — A 명단에는 없다
    const ERIN = { id: '00000000-0000-0000-7e57-0000000000b5', email: 'rls-erin@example.com' }
    await asService(pool, async (c) => {
      await c.query('insert into public.people (id, workspace_id, display_name, email) values ($1, $2, $3, $4)', [
        ERIN.id, F.ws, 'erin', ERIN.email,
      ])
      await c.query('insert into public.project_members (project_id, person_id) values ($1, $2)', [F.projects.b, ERIN.id])

      // A 관리자 alice 가 erin 의 이메일 + 다른 이름으로 A 에 추가 → A 명단 행은 생기고 erin 의 이름은 그대로
      const added = (await c.query<{ id: string }>(upsert, [
        F.users.member, F.projects.a, JSON.stringify({ display_name: 'mallory', email: ERIN.email }), '{}',
      ])).rows[0].id
      expect((await c.query(memberOf, [added])).rows[0])
        .toEqual({ project_id: F.projects.a, person_id: ERIN.id, display_name: 'erin' })

      // 새 이메일 → 입력 이름으로 인물을 만든다
      const created = (await c.query<{ id: string }>(upsert, [
        F.users.member, F.projects.a, JSON.stringify({ display_name: 'frank', email: 'rls-frank@example.com' }), '{}',
      ])).rows[0].id
      expect((await c.query(memberOf, [created])).rows[0])
        .toMatchObject({ project_id: F.projects.a, display_name: 'frank' })

      // 대조: id 로 행을 지목한 편집은 여전히 개명한다(bob 은 A 명단)
      await c.query(upsert, [
        F.users.member, F.projects.a, JSON.stringify({ id: F.people.external, display_name: 'bob k' }), '{}',
      ])
      expect((await c.query('select display_name from public.people where id = $1', [F.people.external])).rows[0])
        .toEqual({ display_name: 'bob k' })
    })
  })

  it('⑪ id 분기 개명은 people_update 와 같은 선 — 명단 밖 인물은 명단에만 넣고 이름은 둔다(0004)', async () => {
    const upsert = 'select public.upsert_project_member($1, $2, $3::jsonb, $4::jsonb, null) as id'
    const nameOf = async (c: PoolClient, id: string) =>
      (await c.query<{ display_name: string }>('select display_name from public.people where id = $1', [id])).rows[0]
        .display_name
    // B 명단에만 있는 외부 인력 erin — alice 는 B 관리자가 아니다(B 멤버)
    const ERIN = '00000000-0000-0000-7e57-0000000000b5'
    const seedErin = async (c: PoolClient) => {
      await c.query('insert into public.people (id, workspace_id, display_name) values ($1, $2, $3)', [ERIN, F.ws, 'erin'])
      await c.query('insert into public.project_members (project_id, person_id) values ($1, $2)', [F.projects.b, ERIN])
    }

    await asService(pool, async (c) => {
      await seedErin(c)
      // A 관리자 alice 가 B 전용 인물 id + 새 이름으로 A 에 추가 → A 명단 행은 생기고 이름은 그대로(오류 없음)
      const added = (await c.query<{ id: string }>(upsert, [
        F.users.member, F.projects.a, JSON.stringify({ id: ERIN, display_name: 'mallory' }), '{}',
      ])).rows[0].id
      expect((await c.query('select project_id, person_id from public.project_members where id = $1', [added])).rows[0])
        .toEqual({ project_id: F.projects.a, person_id: ERIN })
      expect(await nameOf(c, ERIN)).toBe('erin')

      // A 명단에 이미 있는 인물(bob) id + 새 이름 → 개명
      await c.query(upsert, [
        F.users.member, F.projects.a, JSON.stringify({ id: F.people.external, display_name: 'bob k' }), '{}',
      ])
      expect(await nameOf(c, F.people.external)).toBe('bob k')
    })

    // 워크스페이스 관리자는 명단 밖 인물도 개명한다
    await asService(pool, async (c) => {
      await seedErin(c)
      await c.query(upsert, [F.users.wsAdmin, F.projects.a, JSON.stringify({ id: ERIN, display_name: 'erin k' }), '{}'])
      expect(await nameOf(c, ERIN)).toBe('erin k')
    })
  })

  it('⑫ 세션은 자기 profiles 의 email·user_id 를 쓰지 못하고 display_name 은 고친다(0005 컬럼 권한)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      const denied = { code: '42501', message: expect.stringMatching(/^permission denied for table profiles/) }
      expect(await pgError(c, 'update public.profiles set email = $1 where user_id = $2', [
        'rls-newhire@example.com', F.users.member,
      ])).toMatchObject(denied)
      expect(await pgError(c, 'update public.profiles set user_id = $1 where user_id = $2', [F.users.platform, F.users.member]))
        .toMatchObject(denied)
      // 대조: 같은 세션이 같은 행의 허용 컬럼은 고친다 — 위 거부가 RLS 가 아니라 컬럼 권한 때문이다
      expect((await c.query('update public.profiles set display_name = $1, updated_at = now() where user_id = $2', [
        'alice k', F.users.member,
      ])).rowCount).toBe(1)
      const { rows } = await c.query<{ email: string; display_name: string }>(
        'select email, display_name from public.profiles where user_id = $1', [F.users.member],
      )
      expect(rows[0]).toEqual({ email: 'rls-alice@example.com', display_name: 'alice k' })
    })
  })
})
