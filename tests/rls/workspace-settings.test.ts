// 0008 워크스페이스 설정 + 초대 수락·이월 가드 — workspace_settings RLS, consume_project_invite 의 비활성 거부,
// project_invites.created_by 불변, 마지막 워크스페이스 관리자 잠금(두 연결 동시성).
// 동시성 케이스(⑤)만 커밋된 행이 필요해 임시 워크스페이스 W 를 만들고 finally 에서 지운다 — 나머지는 begin…rollback.
import { createHash } from 'node:crypto'
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
// 트랜잭션 안에서만 만드는 계정(롤백으로 사라진다) — org-core.test.ts 의 carol 과 같은 id 체계
const CAROL = { id: '00000000-0000-0000-7e57-0000000000a4', email: 'rls-carol@example.com' }
const INSERT_AUTH_USER = `
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  values ($1, $2, '', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated',
          '00000000-0000-0000-0000-000000000000', now(), now())`
const INVITE = `
  insert into public.project_invites (workspace_id, project_id, email, access_role, token_hash, created_by, expires_at)
  values ($1, $2, $3, 'member', $4, $5, now() + interval '1 day')`
const CONSUME = 'select * from public.consume_project_invite($1, $2, $3)'
const unconsumed = async (c: PoolClient, hash: string) =>
  (await c.query<{ ok: boolean }>(
    'select redeemed_at is null and redeemed_by is null as ok from public.project_invites where token_hash = $1', [hash],
  )).rows[0]?.ok

describe('workspace_settings RLS (0008 → 0012)', () => {
  it('① A 멤버는 자기 워크스페이스 설정을 읽고, B 계정은 0행이다. 멤버·B 관리자의 insert 는 42501', async () => {
    const domains = `select s."values" -> 'invites.allowed_domains' as d, s."values" ? 'modules.allowed' as m
                       from public.workspace_settings s where s.workspace_id = $1`
    await asUser(pool, F.users.aLoose, async (c) => {
      expect((await c.query(domains, [F.ws])).rows).toEqual([{ d: ['example.com'], m: true }])
      expect(await pgError(c, `insert into public.workspace_settings (workspace_id, "values") values ($1, '{}')`, [F.wsB]))
        .toMatchObject({ code: '42501' })
    })
    await asUser(pool, F.users.bAdmin, async (c) => {
      expect((await c.query('select 1 from public.workspace_settings where workspace_id = $1', [F.ws])).rowCount).toBe(0)
      expect(await pgError(c, `insert into public.workspace_settings (workspace_id, "values") values ($1, '{}')
        on conflict (workspace_id) do update set "values" = excluded."values"`, [F.ws])).toMatchObject({ code: '42501' })
    })
  })

  it('①′ 관리자의 직접 upsert 는 42501 이고, 쓰기는 apply_workspace_settings(service_role) 한 길이다. B 계정은 그 뒤에도 0행', async () => {
    const DENIED = { code: '42501', message: expect.stringContaining('permission denied') }
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, `insert into public.workspace_settings (workspace_id, "values") values ($1, '{}')
        on conflict (workspace_id) do update set "values" = excluded."values"`, [F.ws])).toMatchObject(DENIED)
      expect(await pgError(c, `update public.workspace_settings set "values" = '{"invites.allowed_domains": ["evil.test"]}'::jsonb
        where workspace_id = $1`, [F.ws])).toMatchObject(DENIED)
      expect(await pgError(c, `select public.apply_workspace_settings($1, 1, gen_random_uuid(), '{}'::jsonb, null, $2, 1, 'edit')`,
        [F.ws, F.users.wsAdmin])).toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function') })
    })
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      const r = (await c.query(`select public.apply_workspace_settings($1, 1, gen_random_uuid(),
        '{"invites.allowed_domains": ["acme.test", "example.com"]}'::jsonb, null, $2, 1, 'edit') as r`, [F.ws, F.users.wsAdmin])).rows[0].r
      expect(r).toEqual({ status: 'applied', revision: 2 })
      await c.query('reset role')
      await c.query('set local role authenticated')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: F.users.aLoose, role: 'authenticated' })])
      expect((await c.query(`select "values" -> 'invites.allowed_domains' as d from public.workspace_settings where workspace_id = $1`, [F.ws])).rows)
        .toEqual([{ d: ['acme.test', 'example.com'] }])
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: F.users.bAdmin, role: 'authenticated' })])
      expect((await c.query('select 1 from public.workspace_settings where workspace_id = $1', [F.ws])).rowCount).toBe(0)
    })
  })
})

describe('consume_project_invite — 비활성 인원은 되살리지 않는다(0008)', () => {
  it('② 비활성 인물의 이메일로 온 초대는 23514 INVITE_INACTIVE, 초대는 미소비·인물은 그대로 비활성', async () => {
    await asService(pool, async (c) => {
      const hash = sha256('t14-inactive-person')
      await c.query(INSERT_AUTH_USER, [CAROL.id, CAROL.email])
      const { rows: [pe] } = await c.query<{ id: string }>(
        `insert into public.people (workspace_id, display_name, email, active) values ($1, 'carol', $2, false) returning id`,
        [F.ws, CAROL.email])
      await c.query(INVITE, [F.ws, F.projects.a, CAROL.email, hash, F.users.wsAdmin])
      expect(await pgError(c, CONSUME, [hash, CAROL.email, CAROL.id])).toMatchObject({ code: '23514', message: 'INVITE_INACTIVE' })
      expect(await unconsumed(c, hash)).toBe(true)
      const { rows: [after] } = await c.query(
        `select (select active from public.people where id = $1) as active,
                (select user_id from public.people where id = $1) as user_id,
                exists (select 1 from public.workspace_members where user_id = $2) as ws_member`, [pe.id, CAROL.id])
      expect(after).toEqual({ active: false, user_id: null, ws_member: false })
    })
  })

  it('③ 활성 인물이라도 그 프로젝트의 명단 행이 비활성이면 같은 거부, 명단 행은 그대로 비활성', async () => {
    await asService(pool, async (c) => {
      const hash = sha256('t14-inactive-roster')
      await c.query(INSERT_AUTH_USER, [CAROL.id, CAROL.email])
      const { rows: [pe] } = await c.query<{ id: string }>(
        `insert into public.people (workspace_id, display_name, email) values ($1, 'carol', $2) returning id`, [F.ws, CAROL.email])
      const { rows: [pm] } = await c.query<{ id: string }>(
        `insert into public.project_members (project_id, person_id, access_role, active) values ($1, $2, null, false) returning id`,
        [F.projects.a, pe.id])
      await c.query(INVITE, [F.ws, F.projects.a, CAROL.email, hash, F.users.wsAdmin])
      expect(await pgError(c, CONSUME, [hash, CAROL.email, CAROL.id])).toMatchObject({ code: '23514', message: 'INVITE_INACTIVE' })
      expect(await unconsumed(c, hash)).toBe(true)
      const { rows: [row] } = await c.query('select active, access_role from public.project_members where id = $1', [pm.id])
      expect(row).toEqual({ active: false, access_role: null })
    })
  })

  it('④ 정상 수락은 workspace_members 에 member 행 — 이미 관리자면 admin 그대로', async () => {
    await asService(pool, async (c) => {
      const hash = sha256('t14-ok')
      await c.query(INSERT_AUTH_USER, [CAROL.id, CAROL.email])
      await c.query(INVITE, [F.ws, F.projects.a, CAROL.email, hash, F.users.wsAdmin])
      expect((await c.query(CONSUME, [hash, CAROL.email, CAROL.id])).rowCount).toBe(1)
      const role = async (u: string) => (await c.query<{ role: string }>(
        'select role from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, u])).rows.map((r) => r.role)
      expect(await role(CAROL.id)).toEqual(['member'])

      // A 워크스페이스 관리자(명단 없음)가 A 프로젝트 초대를 수락 — 소속 역할은 깎이지 않는다
      const adminHash = sha256('t14-ok-admin')
      await c.query(INVITE, [F.ws, F.projects.a, 'rls-wsadmin@example.com', adminHash, F.users.member])
      expect((await c.query(CONSUME, [adminHash, 'rls-wsadmin@example.com', F.users.wsAdmin])).rowCount).toBe(1)
      expect(await role(F.users.wsAdmin)).toEqual(['admin'])
    })
  })
})

describe('project_invites_guard — created_by 불변(0008)', () => {
  it('⑤ created_by 를 바꾸면 23514, 발급자 계정 삭제의 FK set null 은 통과', async () => {
    await asService(pool, async (c) => {
      const hash = sha256('t14-created-by')
      await c.query(INVITE, [F.ws, F.projects.a, 'rls-new@example.com', hash, F.users.member])
      expect(await pgError(c, 'update public.project_invites set created_by = $2 where token_hash = $1', [hash, F.users.wsAdmin]))
        .toMatchObject({ code: '23514', message: 'PROJECT_INVITE_CREATED_BY_IMMUTABLE' })
      expect(await pgError(c, 'update public.project_invites set created_by = null where token_hash = $1', [hash]))
        .toMatchObject({ code: '23514', message: 'PROJECT_INVITE_CREATED_BY_IMMUTABLE' })
      // 대조: 같은 행의 다른 컬럼은 고쳐진다(가드가 행 전체를 막지 않는다)
      expect((await c.query('update public.project_invites set revoked_at = now() where token_hash = $1', [hash])).rowCount).toBe(1)

      // 발급자 계정이 지워지면 FK(on delete set null)가 created_by 를 비운다 — 이 경로까지 막으면 계정을 지울 수 없다
      const carolHash = sha256('t14-created-by-carol')
      await c.query(INSERT_AUTH_USER, [CAROL.id, CAROL.email])
      await c.query(INVITE, [F.ws, F.projects.a, 'rls-new2@example.com', carolHash, CAROL.id])
      expect(await pgError(c, 'delete from auth.users where id = $1', [CAROL.id])).toBeNull()
      const { rows: [r] } = await c.query('select created_by from public.project_invites where token_hash = $1', [carolHash])
      expect(r).toEqual({ created_by: null })
    })
  })
})

describe('createAccount 보상 롤백의 전제 — 계정 삭제가 이은 인물의 연결을 푼다', () => {
  // createAccount 는 기존 인물(외부 인력)에 새 계정을 이은 뒤 명단 행 검사 등에서 실패하면 계정만 지운다(src/app/actions/accounts.ts).
  // 그 인물의 user_id 를 되돌리는 것은 people.user_id 의 FK(on delete set null)다 — 이 전제가 깨지면 인물이 지워진 계정 id 를
  // 붙든 채 남는다. 트리거(people_unlink_revokes_access)도 이 경로에서 막지 않는지 함께 본다.
  it('⑨ 외부 인력에 이은 계정을 지우면 people.user_id 가 null 로 돌아온다', async () => {
    await asService(pool, async (c) => {
      await c.query(INSERT_AUTH_USER, [CAROL.id, CAROL.email])
      expect((await c.query('update public.people set user_id = $1 where id = $2 and user_id is null', [CAROL.id, F.people.external])).rowCount)
        .toBe(1)
      expect(await pgError(c, 'delete from auth.users where id = $1', [CAROL.id])).toBeNull()
      const { rows } = await c.query('select user_id, active from public.people where id = $1', [F.people.external])
      expect(rows).toEqual([{ user_id: null, active: true }])
    })
  })
})

describe('workspace_members_keep_last_admin — 잠금(0008)', () => {
  it('⑥ 한 트랜잭션에서 두 관리자를 차례로 강등하면 두 번째가 WORKSPACE_LAST_ADMIN', async () => {
    await asService(pool, async (c) => {
      const setRole = 'update public.workspace_members set role = $3 where workspace_id = $1 and user_id = $2'
      await c.query(setRole, [F.ws, F.users.aLoose, 'admin'])
      expect(await pgError(c, setRole, [F.ws, F.users.wsAdmin, 'member'])).toBeNull()
      expect(await pgError(c, setRole, [F.ws, F.users.aLoose, 'member'])).toMatchObject({ code: '23514', message: 'WORKSPACE_LAST_ADMIN' })
    })
  })

  it('⑦ 함수 정의가 같은 워크스페이스 관리자 행을 for update 로 잠근다', async () => {
    const { rows: [r] } = await pool.query<{ def: string }>(
      `select pg_get_functiondef('public.workspace_members_keep_last_admin()'::regprocedure) as def`)
    expect(r.def).toMatch(/perform 1 from public\.workspace_members m\s+where m\.workspace_id = old\.workspace_id and m\.role = 'admin'\s+for update;/)
  })

  // 두 연결로 "남은 두 관리자가 서로를 동시에 강등·제거" 를 재현한다. 결정적으로 만들려고 순서를 강제한다:
  // S1 이 begin 후 자기 쪽 강등을 끝내고(커밋 전) → S2 가 다른 관리자를 강등·삭제 → S2 가 행 잠금을 기다리는지(pg_blocking_pids)
  // 또는 이미 끝났는지 관찰 → S1 커밋 → S2 결과. 잠금이 없는 정의에서는 S2 의 트리거가 S1 의 미커밋 강등을 못 봐 둘 다 성공하고
  // 관리자가 0명이 된다(이 케이스가 실패). 잠금이 있으면 S1 의 트리거가 두 관리자 행을 잡고 있어 S2 가 기다렸다가, S1 커밋 뒤
  // 새 스냅샷으로 "남은 관리자 없음" 을 보고 23514 로 끝난다.
  const W = '00000000-0000-0000-7e57-00000000aa14'
  const [ADMIN_1, ADMIN_2] = [F.users.aLoose, F.users.bMember]
  const dropW = (c: Pool | PoolClient) => c.query('delete from public.workspaces where id = $1', [W])

  it.each([
    ['강등', `update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`],
    ['제거', 'delete from public.workspace_members where workspace_id = $1 and user_id = $2'],
  ])('⑧ 두 세션 동시: S1 강등 + S2 %s — 정확히 하나만 성공하고 관리자 1명이 남는다', async (_label, s2Sql) => {
    await dropW(pool)
    await pool.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-t14-lock', 'RLS 잠금')`, [W])
    await pool.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'admin')`,
      [W, ADMIN_1, ADMIN_2])
    const s1 = await pool.connect()
    const s2 = await pool.connect()
    try {
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s1.query(`update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`, [W, ADMIN_1])

      let settled = false
      const s2Result = s2.query(s2Sql, [W, ADMIN_2]).then(
        () => null,
        (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })

      // S2 가 끝났거나(잠금 없음) S1 의 잠금을 기다리기 시작할 때까지(잠금 있음) — 둘 다 아니면 5초 뒤 실패
      let blocked = false
      for (let i = 0; i < 250 && !settled && !blocked; i++) {
        blocked = (await s1.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [s2Pid])).rows[0].n > 0
        if (!blocked) await new Promise((r) => setTimeout(r, 20))
      }
      expect(settled || blocked).toBe(true)

      await s1.query('commit')
      const s2Err = await s2Result
      // 풀은 연결 2개(harness) — 둘 다 쥐고 있으니 결과 확인도 s1 으로
      const { rows } = await s1.query<{ user_id: string }>(
        `select user_id from public.workspace_members where workspace_id = $1 and role = 'admin'`, [W])
      // S1 은 커밋됐다 — S2 는 거부돼야 하고, 남은 관리자는 ADMIN_2 하나
      expect(s2Err).toMatchObject({ code: '23514', message: 'WORKSPACE_LAST_ADMIN' })
      expect(rows).toEqual([{ user_id: ADMIN_2 }])
      expect(blocked).toBe(true)
    } finally {
      await s1.query('rollback').catch(() => undefined)
      await dropW(s1)
      s1.release()
      s2.release()
    }
  })
})
