// 계정 수명주기(*_account_lifecycle — 0053): 워크스페이스에서 멤버를 빼는 RPC 와 관리자가 한 비밀번호 재설정의 기록.
// 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다. 각 케이스는 시작할 때의 마지막 id(mark) 뒤에 생긴 이력만 본다.
// 본다: 실행권(JWT 직접 실행 42501)·RPC 안의 등급 재판정·자기 자신·등급 경계·마지막 관리자(기존 트리거)·권한 회수가 그 워크스페이스뿐인지·
// 초대·토큰 회수 범위·이력 기록(행위자·명령 id)·기록 종류의 제약과 읽기 정책.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const ID = (nn: string) => `00000000-0000-0000-7e57-0000000053${nn}`
const CMD = ID('c1')
const REMOVE = 'select public.remove_workspace_member($1, $2, $3, $4) as r'
const RECORD = 'select public.record_password_reset($1, $2, $3, $4) as r'
const FORBIDDEN = { code: '42501', message: 'AUTHZ_FORBIDDEN' }
const U = F.users

type Ev = { kind: string; cause: string; workspace_id: string | null; project_id: string | null; target_user_id: string | null
  target_person_id: string | null; before: unknown; after: unknown; actor_user_id: string | null; command_id: string | null }
const mark = async (c: PoolClient) =>
  (await c.query<{ m: string }>('select coalesce(max(id), 0)::text as m from public.authz_events where id <> 7057001')).rows[0].m
const since = async (c: PoolClient, m: string) =>
  (await c.query<Ev>(`select kind, cause, workspace_id, project_id, target_user_id, target_person_id, before, after, actor_user_id, command_id::text
     from public.authz_events where id > $1::bigint and id <> 7057001 order by id`, [m])).rows
const membership = async (c: PoolClient, ws: string, user: string) =>
  (await c.query<{ role: string }>('select role from public.workspace_members where workspace_id = $1 and user_id = $2', [ws, user])).rows[0]?.role ?? null
const access = async (c: PoolClient, memberId: string) =>
  (await c.query<{ access_role: string | null; active: boolean }>('select access_role, active from public.project_members where id = $1', [memberId])).rows[0]
const insertInvite = async (c: PoolClient, v: { id: string; project: string; ws: string; email: string; redeemed?: boolean }) => {
  await c.query(
    `insert into public.project_invites (id, project_id, workspace_id, email, access_role, created_by, expires_at, token_hash, redeemed_at)
     values ($1, $2, $3, $4, 'member', $5, now() + interval '7 days', $6, $7)`,
    [v.id, v.project, v.ws, v.email, v.ws === F.ws ? U.wsAdmin : U.bAdmin, `h-${v.id}`, v.redeemed ? new Date().toISOString() : null])
}
const insertToken = async (c: PoolClient, v: { id: string; ws: string; kind: 'agent_runner' | 'minutes_api'; owner: string | null; n: string }) => {
  await c.query(
    `insert into public.integration_credentials (id, workspace_id, kind, name, token_prefix, token_hash, scopes, owner_user_id, created_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '30 days')`,
    [v.id, v.ws, v.kind, `rls-53-${v.n}`, `rls53token${v.n}`.padEnd(12, '0').slice(0, 12), v.n.repeat(64).slice(0, 64),
      v.kind === 'agent_runner' ? ['work:read'] : [], v.owner, v.owner ?? U.wsAdmin])
}
async function toSession(c: PoolClient, userId: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
}
async function toServer(c: PoolClient) {
  await c.query('reset role')
  await c.query(`select set_config('request.jwt.claims', '', true)`)
}

describe('실행권 — service_role 전용', () => {
  it('JWT 세션은 두 RPC 를 실행하지 못한다(42501) — 플랫폼 관리자·워크스페이스 관리자여도', async () => {
    for (const actor of [U.platform, U.wsAdmin]) {
      await asUser(pool, actor, async (c) => {
        expect(await pgError(c, REMOVE, [actor, F.ws, U.aLoose, CMD]))
          .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function remove_workspace_member') })
        expect(await pgError(c, RECORD, [actor, F.ws, U.aLoose, CMD]))
          .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function record_password_reset') })
        expect(await membership(c, F.ws, U.aLoose)).toBe('member')
      })
    }
  })
  it('anon·authenticated 에 EXECUTE 가 없고 service_role 에만 있다', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ fn: string; anon: boolean; auth: boolean; svc: boolean }>(
        `select f as fn, has_function_privilege('anon', f, 'EXECUTE') as anon, has_function_privilege('authenticated', f, 'EXECUTE') as auth,
                has_function_privilege('service_role', f, 'EXECUTE') as svc
           from unnest(array['public.remove_workspace_member(uuid, uuid, uuid, uuid)', 'public.record_password_reset(uuid, uuid, uuid, uuid)']) as f`)
      expect(rows.map((r) => [r.anon, r.auth, r.svc])).toEqual([[false, false, true], [false, false, true]])
    })
  })
})

describe('remove_workspace_member — 정상 경로', () => {
  it('소속 행이 사라지고 그 워크스페이스 명단 권한이 전부 null — 명단 행 자체는 남는다. 이력에 소속 제거 1 + 권한 회수(연쇄) 3', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      // alice: A 워크스페이스 멤버, 프로젝트 a(admin)·b(member)·aPrivate(member) 명단
      expect((await c.query(REMOVE, [U.wsAdmin, F.ws, U.member, CMD])).rows[0].r).toEqual({
        status: 'applied', matched: 1, revoked_projects: 3, revoked_invites: 0, revoked_credentials: 0,
      })
      expect(await membership(c, F.ws, U.member)).toBeNull()
      for (const id of [F.members.aliceA, F.members.aliceB, F.members.alicePrivate]) {
        expect(await access(c, id)).toEqual({ access_role: null, active: true })
      }
      // 인물의 계정 연결·담당 팀 배정은 그대로다(과거 담당·작성 기록의 이름)
      expect((await c.query('select user_id, active from public.people where id = $1', [F.people.member])).rows[0])
        .toEqual({ user_id: U.member, active: true })
      expect((await c.query('select count(*)::int as n from public.project_member_teams where member_id = $1', [F.members.aliceA])).rows[0].n).toBe(2)
      const ev = await since(c, m)
      expect(ev.filter((e) => e.kind === 'workspace_role')).toEqual([
        { kind: 'workspace_role', cause: 'direct', workspace_id: F.ws, project_id: null, target_user_id: U.member, target_person_id: null,
          before: { role: 'member' }, after: null, actor_user_id: U.wsAdmin, command_id: CMD },
      ])
      const revoked = ev.filter((e) => e.kind === 'project_access')
      expect(revoked.map((e) => e.project_id).sort()).toEqual([F.projects.a, F.projects.b, F.projects.aPrivate].sort())
      for (const e of revoked) {
        expect(e).toMatchObject({ cause: 'cascade', workspace_id: F.ws, target_user_id: U.member, target_person_id: F.people.member,
          actor_user_id: U.wsAdmin, command_id: CMD })
        expect((e.after as { access_role: unknown }).access_role).toBeNull()
      }
      expect(ev).toHaveLength(4)
      // 행위자·명령 id 설정은 RPC 가 끝나며 비운다 — 같은 트랜잭션의 뒤 문장에 남의 도장이 찍히지 않는다
      expect((await c.query(`select current_setting('app.authz_actor', true) as a, current_setting('app.command_id', true) as k`)).rows[0])
        .toEqual({ a: '', k: '' })
    })
  })

  it('권한 회수는 그 워크스페이스뿐이다 — 다른 워크스페이스의 소속·명단 권한·인물은 그대로', async () => {
    await asService(pool, async (c) => {
      // dana: A·B 둘 다 멤버, A 프로젝트 a 와 B 프로젝트 bWs 의 명단 member
      expect((await c.query(REMOVE, [U.wsAdmin, F.ws, U.dual, CMD])).rows[0].r).toMatchObject({ matched: 1, revoked_projects: 1 })
      expect(await membership(c, F.ws, U.dual)).toBeNull()
      expect(await membership(c, F.wsB, U.dual)).toBe('member')
      expect((await access(c, F.members.danaA)).access_role).toBeNull()
      expect((await access(c, F.members.danaB)).access_role).toBe('member')
      // 계정은 그대로다(로그인·프로필)
      expect((await c.query('select count(*)::int as n from auth.users where id = $1', [U.dual])).rows[0].n).toBe(1)
      expect((await c.query('select count(*)::int as n from public.profiles where user_id = $1', [U.dual])).rows[0].n).toBe(1)
    })
  })

  it('수락 전 초대는 그 워크스페이스·그 사람 주소의 것만 회수한다 — 수락된 초대·다른 사람·다른 워크스페이스는 그대로', async () => {
    await asService(pool, async (c) => {
      await insertInvite(c, { id: ID('01'), project: F.projects.b, ws: F.ws, email: 'rls-dana@example.com' })                  // 회수 대상
      await insertInvite(c, { id: ID('02'), project: F.projects.aPrivate, ws: F.ws, email: 'rls-dana@example.com', redeemed: true })
      await insertInvite(c, { id: ID('03'), project: F.projects.b, ws: F.ws, email: 'rls-cy@example.com' })                    // 다른 사람
      await insertInvite(c, { id: ID('04'), project: F.projects.bWs, ws: F.wsB, email: 'rls-dana@example.com' })               // 다른 워크스페이스
      expect((await c.query(REMOVE, [U.wsAdmin, F.ws, U.dual, CMD])).rows[0].r).toMatchObject({ matched: 1, revoked_invites: 1 })
      const { rows } = await c.query<{ id: string; revoked: boolean }>(
        'select id, revoked_at is not null as revoked from public.project_invites where id = any($1::uuid[]) order by id',
        [[ID('01'), ID('02'), ID('03'), ID('04')]])
      expect(rows.map((r) => r.revoked)).toEqual([true, false, false, false])
    })
  })

  it('그 사람 소유의 그 워크스페이스 토큰만 닫는다(지우지 않는다) — 워크스페이스 공용 자격증명·다른 워크스페이스의 토큰은 그대로', async () => {
    await asService(pool, async (c) => {
      await insertToken(c, { id: ID('11'), ws: F.ws, kind: 'agent_runner', owner: U.dual, n: 'a' })     // 닫힌다
      await insertToken(c, { id: ID('12'), ws: F.wsB, kind: 'agent_runner', owner: U.dual, n: 'b' })    // 다른 워크스페이스
      await insertToken(c, { id: ID('13'), ws: F.ws, kind: 'agent_runner', owner: U.aLoose, n: 'c' })   // 다른 사람
      await insertToken(c, { id: ID('14'), ws: F.ws, kind: 'minutes_api', owner: null, n: 'd' })        // 공용(소유자 없음)
      expect((await c.query(REMOVE, [U.wsAdmin, F.ws, U.dual, CMD])).rows[0].r).toMatchObject({ matched: 1, revoked_credentials: 1 })
      const { rows } = await c.query<{ id: string; enabled: boolean; revoked: boolean }>(
        'select id, enabled, revoked_at is not null as revoked from public.integration_credentials where id = any($1::uuid[]) order by id',
        [[ID('11'), ID('12'), ID('13'), ID('14')]])
      expect(rows.map((r) => [r.enabled, r.revoked])).toEqual([[false, true], [true, false], [true, false], [true, false]])
    })
  })

  it('소속이 아닌 대상은 0행 — 아무것도 바꾸지 않고 이력도 남기지 않는다(초대도 건드리지 않는다)', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      await insertInvite(c, { id: ID('05'), project: F.projects.b, ws: F.ws, email: 'rls-ben@example.com' })
      expect((await c.query(REMOVE, [U.wsAdmin, F.ws, U.bMember, CMD])).rows[0].r).toEqual({ status: 'applied', matched: 0 })
      expect(await since(c, m)).toEqual([])
      expect((await c.query('select revoked_at from public.project_invites where id = $1', [ID('05')])).rows[0].revoked_at).toBeNull()
      expect(await membership(c, F.wsB, U.bMember)).toBe('member')
    })
  })
})

describe('remove_workspace_member — 거부', () => {
  it('등급 재판정: 그 워크스페이스의 관리자가 아니면 AUTHZ_FORBIDDEN — 멤버·명단 관리자·다른 워크스페이스 관리자', async () => {
    await asService(pool, async (c) => {
      for (const actor of [U.member, U.aLoose, U.bAdmin, ID('ee')]) {
        expect(await pgError(c, REMOVE, [actor, F.ws, U.aLoose, CMD])).toMatchObject(FORBIDDEN)
      }
      expect(await membership(c, F.ws, U.aLoose)).toBe('member')
    })
  })
  it('자기 자신은 못 뺀다(WORKSPACE_MEMBER_SELF_REMOVE) — 플랫폼 관리자도', async () => {
    await asService(pool, async (c) => {
      const SELF = { code: '23514', message: 'WORKSPACE_MEMBER_SELF_REMOVE' }
      expect(await pgError(c, REMOVE, [U.wsAdmin, F.ws, U.wsAdmin, CMD])).toMatchObject(SELF)
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.ws, U.platform])
      expect(await pgError(c, REMOVE, [U.platform, F.ws, U.platform, CMD])).toMatchObject(SELF)
      expect(await membership(c, F.ws, U.wsAdmin)).toBe('admin')
    })
  })
  it('등급 경계: 다른 관리자는 플랫폼 관리자만 뺀다 — 워크스페이스 관리자는 WORKSPACE_MEMBER_ADMIN_FORBIDDEN, 강등한 뒤에는 뺄 수 있다', async () => {
    await asService(pool, async (c) => {
      await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.ws, U.aLoose])
      expect(await pgError(c, REMOVE, [U.wsAdmin, F.ws, U.aLoose, CMD]))
        .toMatchObject({ code: '42501', message: 'WORKSPACE_MEMBER_ADMIN_FORBIDDEN' })
      expect(await membership(c, F.ws, U.aLoose)).toBe('admin')
      // 플랫폼 관리자는 관리자도 뺀다(남는 관리자가 있을 때)
      expect((await c.query(REMOVE, [U.platform, F.ws, U.aLoose, CMD])).rows[0].r).toMatchObject({ matched: 1 })
      expect(await membership(c, F.ws, U.aLoose)).toBeNull()
    })
    await asService(pool, async (c) => {
      await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.ws, U.aLoose])
      await c.query('select public.set_workspace_role($1, $2, $3, $4, $5)', [U.wsAdmin, F.ws, U.aLoose, 'member', ID('c2')])
      expect((await c.query(REMOVE, [U.wsAdmin, F.ws, U.aLoose, CMD])).rows[0].r).toMatchObject({ matched: 1 })
    })
  })
  it('마지막 관리자는 누구도 못 뺀다(WORKSPACE_LAST_ADMIN — 기존 트리거) — 초대·토큰 회수도 함께 되돌려진다', async () => {
    await asService(pool, async (c) => {
      await insertToken(c, { id: ID('15'), ws: F.ws, kind: 'agent_runner', owner: U.wsAdmin, n: 'e' })
      expect(await pgError(c, REMOVE, [U.platform, F.ws, U.wsAdmin, CMD])).toMatchObject({ code: '23514', message: 'WORKSPACE_LAST_ADMIN' })
      expect(await membership(c, F.ws, U.wsAdmin)).toBe('admin')
      expect((await c.query('select enabled from public.integration_credentials where id = $1', [ID('15')])).rows[0].enabled).toBe(true)
    })
  })
  it('입력 검증 — 행위자·명령 id 없음은 COMMAND_ID_REQUIRED, 워크스페이스·대상 없음은 AUTHZ_INVALID_INPUT', async () => {
    await asService(pool, async (c) => {
      const REQ = { code: '22023', message: 'COMMAND_ID_REQUIRED' }
      const INV = { code: '22023', message: 'AUTHZ_INVALID_INPUT' }
      expect(await pgError(c, REMOVE, [null, F.ws, U.aLoose, CMD])).toMatchObject(REQ)
      expect(await pgError(c, REMOVE, [U.wsAdmin, F.ws, U.aLoose, null])).toMatchObject(REQ)
      expect(await pgError(c, REMOVE, [U.wsAdmin, null, U.aLoose, CMD])).toMatchObject(INV)
      expect(await pgError(c, REMOVE, [U.wsAdmin, F.ws, null, CMD])).toMatchObject(INV)
      expect(await pgError(c, RECORD, [null, F.ws, U.aLoose, CMD])).toMatchObject(REQ)
      expect(await pgError(c, RECORD, [U.wsAdmin, F.ws, null, CMD])).toMatchObject(INV)
    })
  })
})

describe('record_password_reset — 경계 재판정과 기록', () => {
  it('워크스페이스 관리자 → 자기 워크스페이스에만 속한 일반 멤버: 기록 1행(누가·누구를·어느 워크스페이스에서)', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      expect((await c.query(RECORD, [U.wsAdmin, F.ws, U.aLoose, CMD])).rows[0].r).toEqual({ status: 'applied', matched: 1 })
      expect(await since(c, m)).toEqual([
        { kind: 'password_reset', cause: 'direct', workspace_id: F.ws, project_id: null, target_user_id: U.aLoose, target_person_id: null,
          before: null, after: { reset: true }, actor_user_id: U.wsAdmin, command_id: CMD },
      ])
    })
  })
  it('프로젝트 관리자(명단 admin)인 멤버도 대상이다 — 워크스페이스 관리자가 그 등급을 승계한다', async () => {
    await asService(pool, async (c) => {
      expect((await c.query(RECORD, [U.wsAdmin, F.ws, U.member, CMD])).rows[0].r).toMatchObject({ status: 'applied' })
    })
  })
  it('워크스페이스 관리자는 못 한다: 다른 워크스페이스에도 속한 계정·플랫폼 관리자·관리자·소속 아닌 계정·자기 자신 — 기록도 없다', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      expect(await pgError(c, RECORD, [U.wsAdmin, F.ws, U.dual, CMD])).toMatchObject(FORBIDDEN)        // A·B 둘 다 소속
      expect(await pgError(c, RECORD, [U.wsAdmin, F.ws, U.bMember, CMD])).toMatchObject(FORBIDDEN)     // A 소속 아님
      expect(await pgError(c, RECORD, [U.wsAdmin, F.ws, U.platform, CMD])).toMatchObject(FORBIDDEN)    // 플랫폼 관리자(A 소속 아님)
      expect(await pgError(c, RECORD, [U.wsAdmin, F.ws, U.wsAdmin, CMD])).toMatchObject(FORBIDDEN)     // 자기 자신
      await c.query('insert into public.platform_admins (user_id, granted_by) values ($1, $2)', [U.aLoose, U.platform])
      expect(await pgError(c, RECORD, [U.wsAdmin, F.ws, U.aLoose, CMD])).toMatchObject(FORBIDDEN)      // A 멤버이지만 플랫폼 관리자
      await c.query('delete from public.platform_admins where user_id = $1', [U.aLoose])
      await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.ws, U.aLoose])
      expect(await pgError(c, RECORD, [U.wsAdmin, F.ws, U.aLoose, CMD])).toMatchObject(FORBIDDEN)      // 같은 워크스페이스의 관리자
      expect((await since(c, m)).filter((e) => e.kind === 'password_reset')).toEqual([])
    })
  })
  it('행위자가 관리자인 워크스페이스들 안에만 속한 계정이면 된다 — 한쪽이라도 멤버일 뿐이면 안 된다', async () => {
    await asService(pool, async (c) => {
      // wsAdmin 이 B 의 멤버일 뿐일 때: dana(A·B) 는 여전히 거부
      await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [F.wsB, U.wsAdmin])
      expect(await pgError(c, RECORD, [U.wsAdmin, F.ws, U.dual, CMD])).toMatchObject(FORBIDDEN)
      // B 에서도 관리자가 되면 열린다
      await c.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [F.wsB, U.wsAdmin])
      expect((await c.query(RECORD, [U.wsAdmin, F.ws, U.dual, CMD])).rows[0].r).toMatchObject({ status: 'applied' })
    })
  })
  it('그 워크스페이스의 관리자가 아닌 행위자는 거부 — 멤버·다른 워크스페이스 관리자', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, RECORD, [U.member, F.ws, U.aLoose, CMD])).toMatchObject(FORBIDDEN)
      expect(await pgError(c, RECORD, [U.bAdmin, F.ws, U.aLoose, CMD])).toMatchObject(FORBIDDEN)
      expect(await pgError(c, RECORD, [U.bAdmin, F.wsB, U.dual, CMD])).toMatchObject(FORBIDDEN)       // B 관리자 → A 에도 속한 계정
    })
  })
  it('플랫폼 관리자는 자기 자신 말고 누구든 — 관리자·여러 워크스페이스 소속 계정', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      expect((await c.query(RECORD, [U.platform, F.ws, U.wsAdmin, ID('c3')])).rows[0].r).toMatchObject({ status: 'applied' })
      expect((await c.query(RECORD, [U.platform, F.ws, U.dual, ID('c4')])).rows[0].r).toMatchObject({ status: 'applied' })
      expect(await pgError(c, RECORD, [U.platform, F.ws, U.platform, CMD])).toMatchObject(FORBIDDEN)
      expect((await since(c, m)).map((e) => [e.kind, e.target_user_id, e.actor_user_id]))
        .toEqual([['password_reset', U.wsAdmin, U.platform], ['password_reset', U.dual, U.platform]])
    })
  })
  it('없는 워크스페이스·없는 계정은 PASSWORD_RESET_TARGET_NOT_FOUND — 정리되지 않을 기록을 남기지 않는다', async () => {
    await asService(pool, async (c) => {
      const MISSING = { code: 'P0002', message: 'PASSWORD_RESET_TARGET_NOT_FOUND' }
      expect(await pgError(c, RECORD, [U.platform, ID('ee'), U.aLoose, CMD])).toMatchObject(MISSING)
      expect(await pgError(c, RECORD, [U.platform, F.ws, ID('ee'), CMD])).toMatchObject(MISSING)
    })
  })
})

describe('기록 종류 password_reset — 제약·불변·읽기 정책', () => {
  it('범위 check: 워크스페이스와 대상 계정이 있어야 하고 프로젝트는 없어야 한다. 기존 세 종류의 규칙은 그대로다', async () => {
    await asService(pool, async (c) => {
      const INSERT = `insert into public.authz_events (kind, workspace_id, project_id, target_user_id, after, cause) values ($1, $2, $3, $4, '{"reset": true}', 'direct')`
      const SCOPE = { code: '23514', constraint: 'authz_events_scope_check' }
      expect(await pgError(c, INSERT, ['password_reset', null, null, U.aLoose])).toMatchObject(SCOPE)
      expect(await pgError(c, INSERT, ['password_reset', F.ws, F.projects.a, U.aLoose])).toMatchObject(SCOPE)
      expect(await pgError(c, INSERT, ['password_reset', F.ws, null, null])).toMatchObject(SCOPE)
      expect(await pgError(c, INSERT, ['platform_admin', F.ws, null, U.aLoose])).toMatchObject(SCOPE)
      expect(await pgError(c, INSERT, ['account_deleted', F.ws, null, U.aLoose])).toMatchObject({ code: '23514', constraint: 'authz_events_kind_check' })
      expect(await pgError(c, INSERT, ['password_reset', F.ws, null, U.aLoose])).toBeNull()
    })
  })
  it('남긴 기록은 고치거나 지울 수 없다(HISTORY_IMMUTABLE)', async () => {
    await asService(pool, async (c) => {
      await c.query(RECORD, [U.wsAdmin, F.ws, U.aLoose, CMD])
      const IMMUTABLE = { code: '55000', message: 'HISTORY_IMMUTABLE' }
      expect(await pgError(c, `update public.authz_events set after = '{}' where command_id = $1`, [CMD])).toMatchObject(IMMUTABLE)
      expect(await pgError(c, 'delete from public.authz_events where command_id = $1', [CMD])).toMatchObject(IMMUTABLE)
    })
  })
  it('읽기: 그 워크스페이스의 관리자와 플랫폼 관리자만 — 멤버·다른 워크스페이스 관리자·당사자에게는 보이지 않는다', async () => {
    await asService(pool, async (c) => {
      await c.query(RECORD, [U.wsAdmin, F.ws, U.aLoose, CMD])
      const seen = async (user: string) => {
        await toSession(c, user)
        const n = (await c.query<{ n: number }>(`select count(*)::int as n from public.authz_events where command_id = $1`, [CMD])).rows[0].n
        await toServer(c)
        return n
      }
      expect(await seen(U.wsAdmin)).toBe(1)
      expect(await seen(U.platform)).toBe(1)
      expect(await seen(U.member)).toBe(0)
      expect(await seen(U.bAdmin)).toBe(0)
      expect(await seen(U.aLoose)).toBe(0)
      // 세션은 이 표에 쓰지 못한다(쓰기 길은 RPC·트리거뿐)
      await toSession(c, U.wsAdmin)
      expect(await pgError(c, `insert into public.authz_events (kind, workspace_id, target_user_id, after, cause) values ('password_reset', $1, $2, '{"reset": true}', 'direct')`,
        [F.ws, U.aLoose])).toMatchObject({ code: '42501' })
      await toServer(c)
    })
  })
})
