// H2-a(AUTH-04) — 마지막 슈퍼유저 보호. 세션은 platform_admins 를 쓰지 못하고(정책 drop + 권한 회수), 직접 DELETE·user_id 를 바꾸는
// UPDATE 로 마지막 1명을 없애면 PLATFORM_LAST_ADMIN(세션·service_role 모두). 같은 계정 행 UPDATE(granted_by SET NULL 캐스케이드)와
// auth.users 삭제의 캐스케이드(dev-bootstrap 실패 롤백, 스펙 §8.2 ④)는 통과한다. 두 연결의 동시 해제는 advisory 잠금이 직렬화한다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const LAST = { code: '23514', message: 'PLATFORM_LAST_ADMIN' }
const INSERT_AUTH_USER = `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  aud, role, instance_id, created_at, updated_at) values ($1, $2, '', now(), '{}', '{}', 'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000', now(), now())`
/** 같은 트랜잭션에서 keep 만 남기고 나머지 슈퍼유저 행을 지운다(keep 이 남으므로 가드를 통과한다). */
async function onlyAdmins(c: PoolClient, keep: string[]) {
  await c.query('insert into public.platform_admins (user_id) select unnest($1::uuid[]) on conflict do nothing', [keep])
  await c.query('delete from public.platform_admins where not (user_id = any($1::uuid[]))', [keep])
}

describe('H2-a platform_admins — 마지막 1명', () => {
  it('세션은 슈퍼유저여도 platform_admins 에 쓰지 못한다(권한 42501) — 읽기는 그대로, 쓰기 정책은 없다', async () => {
    await asUser(pool, F.users.platform, async (c) => {
      expect((await c.query('select 1 from public.platform_admins where user_id = $1', [F.users.platform])).rowCount).toBe(1)
      for (const sql of [
        'insert into public.platform_admins (user_id) values ($1)',
        'delete from public.platform_admins where user_id = $1',
        'update public.platform_admins set granted_at = now() where user_id = $1',
      ]) {
        expect(await pgError(c, sql, [F.users.aLoose]), sql).toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') })
      }
    })
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'platform_admins' and cmd <> 'SELECT'`)
    expect(rows[0].n).toBe(0)
  })

  it('마지막 1명의 DELETE·user_id 변경 UPDATE 는 PLATFORM_LAST_ADMIN(service_role 도), 같은 계정 행 UPDATE 는 통과', async () => {
    await asService(pool, async (c) => {
      await onlyAdmins(c, [F.users.platform])
      expect(await pgError(c, 'delete from public.platform_admins where user_id = $1', [F.users.platform])).toMatchObject(LAST)
      expect(await pgError(c, 'update public.platform_admins set user_id = $2 where user_id = $1', [F.users.platform, F.users.aLoose]))
        .toMatchObject(LAST)
      expect(await pgError(c, 'update public.platform_admins set granted_by = null, granted_at = now() where user_id = $1', [F.users.platform]))
        .toBeNull()
      await c.query('insert into public.platform_admins (user_id) values ($1)', [F.users.aLoose])
      expect(await pgError(c, 'delete from public.platform_admins where user_id = $1', [F.users.platform])).toBeNull()
      expect(await pgError(c, 'delete from public.platform_admins where user_id = $1', [F.users.aLoose])).toMatchObject(LAST)
    })
  })

  it('실제 service_role 롤도 마지막 1명을 지우면 PLATFORM_LAST_ADMIN — 함수는 SECURITY DEFINER 다', async () => {
    // service_role 은 auth.users 를 읽지 못한다(권한 없음). 가드의 캐스케이드 판정(auth.users 조회)은 함수가 SECURITY DEFINER 라서만
    // 돈다 — INVOKER 로 바뀌면 앱의 setPlatformAdmin 삭제가 PLATFORM_LAST_ADMIN 대신 42501 로 끝난다. asService 는 postgres(슈퍼유저)라
    // 이것을 보지 못하므로 롤을 실제로 바꿔 확인한다.
    const { rows: [f] } = await pool.query<{ secdef: boolean }>(
      `select prosecdef as secdef from pg_proc where oid = 'public.platform_admins_keep_last()'::regprocedure`)
    expect(f.secdef).toBe(true)
    await asService(pool, async (c) => {
      await onlyAdmins(c, [F.users.platform])
      await c.query('set local role service_role')
      expect((await c.query<{ r: string }>('select current_user::text as r')).rows[0].r).toBe('service_role')
      expect(await pgError(c, 'delete from public.platform_admins where user_id = $1', [F.users.platform])).toMatchObject(LAST)
    })
  })

  it('read committed 가 아닌 트랜잭션의 가드 경로는 PLATFORM_ADMIN_ISOLATION(마지막이 아니어도) — repeatable read·serializable·read uncommitted. read committed 는 통과', async () => {
    // 가드는 advisory 잠금 뒤에 남은 행을 읽어 판정한다. repeatable read·serializable 은 트랜잭션 스냅샷 하나로 읽어 앞 연결이 커밋한 해제를
    // 못 본다. serializable 의 SSI 는 상대도 serializable 일 때만 한쪽을 중단하는데 상대(서버 경로)는 read committed 다 — 격리 수준 자체를
    // 거절한다(fail-closed, 0011 ①·⑧·⑨·⑩ 공통 규칙). 이름으로 판정하므로 read uncommitted 도 거절된다.
    const ISOLATION = { code: '25001', message: 'PLATFORM_ADMIN_ISOLATION' }
    const REFUSED = ['repeatable read', 'serializable', 'read uncommitted']
    const results: Record<string, unknown> = {}
    for (const level of [...REFUSED, 'read committed']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        await c.query('insert into public.platform_admins (user_id) values ($1), ($2) on conflict do nothing', [F.users.platform, F.users.aLoose])
        results[level] = await pgError(c, 'delete from public.platform_admins where user_id = $1', [F.users.aLoose])
      } finally {
        await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
      }
    }
    for (const level of REFUSED) expect(results[level], level).toMatchObject(ISOLATION)
    expect(results['read committed']).toBeNull()
  })

  it('격리 수준 검사보다 앞에서 끝나는 경로 — auth.users 삭제의 캐스케이드와 같은 계정 행 UPDATE 는 repeatable read·serializable 에서도 통과', async () => {
    // GoTrue deleteUser·부트스트랩 실패 롤백이 어떤 격리 수준의 트랜잭션에서 돌아도 슈퍼유저 행만 남은 반쪽 상태로 끝나지 않는다
    const U = '00000000-0000-0000-7e57-000000001203'
    for (const level of ['repeatable read', 'serializable', 'read uncommitted']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        await c.query(INSERT_AUTH_USER, [U, 'rls-h2-boot-level@example.com'])
        await c.query('insert into public.platform_admins (user_id) values ($1)', [U])
        expect(await pgError(c, 'update public.platform_admins set granted_at = now() where user_id = $1', [U]), level).toBeNull()
        expect(await pgError(c, 'delete from auth.users where id = $1', [U]), level).toBeNull()
        expect((await c.query('select 1 from public.platform_admins where user_id = $1', [U])).rowCount, level).toBe(0)
      } finally {
        await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
      }
    }
  })

  it('auth.users 삭제의 캐스케이드는 면제된다 — 부트스트랩 실패 롤백(방금 만든 유일 슈퍼유저 계정 삭제)이 반쪽으로 끝나지 않는다', async () => {
    await asService(pool, async (c) => {
      const U = '00000000-0000-0000-7e57-000000001201'
      await c.query(INSERT_AUTH_USER, [U, 'rls-h2-boot@example.com'])
      await onlyAdmins(c, [U])
      expect(await pgError(c, 'delete from auth.users where id = $1', [U])).toBeNull()
      expect((await c.query<{ n: number }>('select count(*)::int as n from public.platform_admins')).rows[0].n).toBe(0)
    })
  })

  it('granted_by 의 SET NULL 캐스케이드(발급자 계정 삭제)는 같은 계정 행 UPDATE 라 통과한다', async () => {
    await asService(pool, async (c) => {
      const G = '00000000-0000-0000-7e57-000000001202'
      await c.query(INSERT_AUTH_USER, [G, 'rls-h2-granter@example.com'])
      await onlyAdmins(c, [F.users.platform])
      await c.query('update public.platform_admins set granted_by = $2 where user_id = $1', [F.users.platform, G])
      expect(await pgError(c, 'delete from auth.users where id = $1', [G])).toBeNull()
      expect((await c.query('select granted_by from public.platform_admins where user_id = $1', [F.users.platform])).rows[0].granted_by).toBeNull()
    })
  })

  it('가드는 advisory 잠금으로 직렬화하고 남은 행을 for update 로 잠그지 않는다(두 연결이 서로를 해제할 때 40P01 교착 방지)', async () => {
    const { rows: [r] } = await pool.query<{ def: string }>(
      `select pg_get_functiondef('public.platform_admins_keep_last()'::regprocedure) as def`)
    expect(r.def).toMatch(/pg_advisory_xact_lock/)
    expect(r.def).not.toMatch(/for\s+update/i)
  })

  it('두 연결이 남은 두 슈퍼유저를 서로 해제해도 1명이 남는다 — 뒤 연결이 앞 연결의 커밋을 기다렸다가 PLATFORM_LAST_ADMIN', async () => {
    // 주의: 이 케이스가 도중에 강제 종료되면(프로세스 kill 등 finally 가 돌지 못한 경우) X·Y 만 슈퍼유저로 남고 dev:bootstrap 계정이
    // platform_admins 행을 잃을 수 있다. 그때는 npm run db:reset 뒤 npm run dev:bootstrap 으로 되살린다.
    // 다른 연결이 봐야 하므로 커밋된 상태가 필요하다. 기존 슈퍼유저 행(픽스처·dev:bootstrap 계정)을 저장하고 finally 에서 되돌린다.
    // 되돌리기가 실패하거나 행이 처음과 다르면 이 케이스가 실패한다 — 뒤 파일·dev 계정이 슈퍼유저를 잃은 채 조용히 넘어가지 않게.
    // 저장 전에 X·Y 를 지운다 — 죽은 앞 실행이 남긴 X·Y 를 '원래 있던 행'으로 저장해 되살리지 않게(픽스처 행이 남아 가드를 통과한다).
    // 저장·복원은 행 JSON 문자열로 한다 — JS Date 를 거치면 granted_at 의 마이크로초가 잘리고, 열 이름을 나열하면 뒤에 생길 열을 놓친다.
    const [X, Y] = [F.users.aLoose, F.users.bMember]
    await pool.query('delete from public.platform_admins where user_id = any($1::uuid[])', [[X, Y]])
    const SNAPSHOT = `select coalesce(json_agg(a order by a.user_id), '[]')::text as j from public.platform_admins a`
    const saved = (await pool.query<{ j: string }>(SNAPSHOT)).rows[0].j
    const savedIds = (JSON.parse(saved) as Array<{ user_id: string }>).map((r) => r.user_id)
    const s1 = await pool.connect()
    const s2 = await pool.connect()
    let s2Result: Promise<DatabaseError | null> | undefined
    try {
      await s1.query('begin'); await onlyAdmins(s1, [X, Y]); await s1.query('commit')
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s1.query('delete from public.platform_admins where user_id = $1', [X])
      let settled = false
      s2Result = s2.query('delete from public.platform_admins where user_id = $1', [Y]).then(
        () => null,
        (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      let blocked = false
      for (let i = 0; i < 250 && !settled && !blocked; i++) {
        blocked = (await s1.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [s2Pid])).rows[0].n > 0
        if (!blocked) await new Promise((r) => setTimeout(r, 20))
      }
      expect(blocked).toBe(true)
      await s1.query('commit')
      expect(await s2Result).toMatchObject(LAST)
      const { rows } = await s1.query<{ user_id: string }>('select user_id from public.platform_admins')
      expect(rows).toEqual([{ user_id: Y }])
    } finally {
      try {
        await s1.query('rollback').catch(() => undefined)
        // s1 이 끝나야 s2 가 풀린다 — s2 의 결과를 기다린 뒤 되돌린다(아직 대기 중인 삭제가 되돌리기와 섞이지 않게)
        await s2Result?.catch(() => undefined)
        // 저장한 행을 먼저 넣고(남은 수가 늘어 가드를 통과한다) 이 케이스가 넣은 X·Y 를 지운다
        await s1.query(`insert into public.platform_admins
          select * from json_populate_recordset(null::public.platform_admins, $1::json) on conflict do nothing`, [saved])
        await s1.query('delete from public.platform_admins where user_id = any($1::uuid[]) and not (user_id = any($2::uuid[]))',
          [[X, Y], savedIds])
        expect((await s1.query<{ j: string }>(SNAPSHOT)).rows[0].j, '슈퍼유저 행이 처음과 같다(값까지)').toBe(saved)
      } finally {
        s1.release()
        s2.release()
      }
    }
  })
})
