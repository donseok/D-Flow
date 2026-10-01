// NNNN_command_receipts(스펙 §3.3·§3.5) — 명령 영수증 표와 가져오기 명령 RPC import_wbs_cmd(같은 명령 2회 = 1벌). 케이스는 begin…rollback 이고
// 두 연결 케이스만 전용 워크스페이스(…aa42)를 커밋했다가 finally 에서 프로젝트 → 워크스페이스 순으로 지운다(projects_workspace_id_fkey 가
// RESTRICT). 부트스트랩 계정·표 전체 행 수에 기대지 않는다(H2 규칙 ⑤). 잠금 대기 상한(lock_timeout 15s)은 기다리지 않고 함수 속성으로 본다.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const ID = (nn: string) => `00000000-0000-0000-7e57-0000000018${nn}`
const PA = ID('40')                 // 롤백 케이스의 프로젝트(A 워크스페이스)
const PB = ID('41')                 // 같은 명령 id 를 다른 프로젝트에 쓰는 케이스
const MISSING = ID('48')            // 만들지 않는 프로젝트
const P_DELETE = ID('4a')           // 삭제 케이스의 프로젝트(워크스페이스 …aa45)
const [CMD1, CMD2, CMD3, CMD4] = [ID('42'), ID('43'), ID('44'), ID('45')]
const FIXTURE_CMD = ID('f1')        // fixture-ws.sql 의 A 영수증(행위자 alice, 프로젝트 A)
const W_DELETE = '00000000-0000-0000-7e57-00000000aa45'
const RPC = 'select public.import_wbs_cmd($1, $2, $3, $4::jsonb, $5::jsonb, $6) as r'
const RECEIPT_INSERT = `insert into public.command_receipts (actor, command_id, kind, workspace_id, project_id, command_digest, result)
  values ($1, $2, 'wbs_import', $3, $4, 'd', '{}')`
const DENIED = { code: '42501', message: expect.stringContaining('permission denied') }
const IMMUTABLE = { code: '55000', message: 'HISTORY_IMMUTABLE' }
const REUSED = { code: '23505', message: 'COMMAND_REUSED' }

/** 이름마다 담당 없는 최상위 항목 하나. tempId 는 파서(parseWithProfile)처럼 결정적이다 — 같은 입력이면 같은 요약 */
const items = (...names: string[]) =>
  JSON.stringify(names.map((name, i) => ({ tempId: `t${i}`, code: String(i + 1), name, sortOrder: i })))
const call = async (c: PoolClient, args: unknown[]) => (await c.query<{ r: Record<string, unknown> }>(RPC, args)).rows[0].r
const namesIn = async (c: PoolClient, projectId: string) =>
  (await c.query<{ name: string }>('select name from public.wbs_items where project_id = $1', [projectId])).rows.map((r) => r.name).sort()
async function newProject(c: PoolClient, id: string, ws: string = F.ws) {
  await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [id, `RLS 영수증 ${id.slice(-2)}`, ws])
}
/** 같은 트랜잭션에서 세션 사용자로 바꾼다(asUser 와 같은 설정) — 끝나면 toServer 로 돌아온다 */
async function toSession(c: PoolClient, userId: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
}
async function toServer(c: PoolClient) {
  await c.query('reset role')
  await c.query(`select set_config('request.jwt.claims', '', true)`)
}

describe('command_receipts — 읽기는 본인 것만, 쓰기는 누구도', () => {
  it('그 워크스페이스 멤버가 아닌 플랫폼 관리자도 자기 영수증을 세션으로 읽는다 — is_ws_member 가 is_superuser 를 품는다(A1-3 리뷰 M3)', async () => {
    const CMD_PLATFORM = ID('46')
    await asService(pool, async (c) => {
      expect((await c.query('select 1 from public.workspace_members where workspace_id = $1 and user_id = $2', [F.wsB, F.users.platform])).rowCount,
        '전제 — 플랫폼 관리자는 B 의 멤버가 아니다').toBe(0)
      await c.query(RECEIPT_INSERT, [F.users.platform, CMD_PLATFORM, F.wsB, F.projects.bWs])
      await toSession(c, F.users.platform)
      expect((await c.query('select actor from public.command_receipts where command_id = $1', [CMD_PLATFORM])).rows)
        .toEqual([{ actor: F.users.platform }])
      await toServer(c)
      // 대조 — 같은 행을 B 관리자(본인 아님)는 읽지 못한다
      await toSession(c, F.users.bAdmin)
      expect((await c.query('select 1 from public.command_receipts where command_id = $1', [CMD_PLATFORM])).rowCount).toBe(0)
      await toServer(c)
    })
  })

  it('본인은 자기 영수증을 읽는다 — 다른 계정(플랫폼 관리자 포함)·B 계정·워크스페이스에서 빠진 본인은 0행', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect((await c.query('select actor from public.command_receipts where command_id = $1', [FIXTURE_CMD])).rows)
        .toEqual([{ actor: F.users.member }])
      expect((await c.query('select 1 from public.command_receipts where actor <> auth.uid()')).rowCount).toBe(0)
    })
    for (const user of [F.users.wsAdmin, F.users.platform, F.users.bAdmin]) {
      await asUser(pool, user, async (c) => {
        expect((await c.query('select 1 from public.command_receipts where command_id = $1', [FIXTURE_CMD])).rowCount, user).toBe(0)
      })
    }
    await asService(pool, async (c) => {
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.member])
      await toSession(c, F.users.member)
      expect((await c.query('select 1 from public.command_receipts where command_id = $1', [FIXTURE_CMD])).rowCount).toBe(0)
      await toServer(c)
    })
  })

  it('세션은 insert·update·delete 를 못 하고(42501), anon 은 읽지도 못한다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, RECEIPT_INSERT, [F.users.member, CMD1, F.ws, F.projects.a])).toMatchObject(DENIED)
      expect(await pgError(c, `update public.command_receipts set result = '{}' where command_id = $1`, [FIXTURE_CMD])).toMatchObject(DENIED)
      expect(await pgError(c, 'delete from public.command_receipts where command_id = $1', [FIXTURE_CMD])).toMatchObject(DENIED)
    })
    await asService(pool, async (c) => {
      await c.query('set local role anon')
      expect(await pgError(c, 'select 1 from public.command_receipts limit 1')).toMatchObject(DENIED)
    })
  })

  it('service_role 은 읽지만 고치거나 지우거나 비우지 못한다(HISTORY_IMMUTABLE)', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      expect((await c.query('select actor from public.command_receipts where command_id = $1', [FIXTURE_CMD])).rows)
        .toEqual([{ actor: F.users.member }])
      expect(await pgError(c, `update public.command_receipts set result = '{}' where command_id = $1`, [FIXTURE_CMD])).toMatchObject(IMMUTABLE)
      expect(await pgError(c, 'delete from public.command_receipts where command_id = $1', [FIXTURE_CMD])).toMatchObject(IMMUTABLE)
      expect(await pgError(c, 'truncate public.command_receipts')).toMatchObject(IMMUTABLE)
    })
  })

  it('프로젝트를 지우면 그 영수증이 캐스케이드로 지워지고, 그 뒤 워크스페이스도 지워진다', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp4-receipts-del', 'Acme 영수증 삭제')`, [W_DELETE])
      await newProject(c, P_DELETE, W_DELETE)
      await c.query(RECEIPT_INSERT, [F.users.platform, CMD1, W_DELETE, P_DELETE])
      expect(await pgError(c, 'delete from public.projects where id = $1', [P_DELETE])).toBeNull()
      expect((await c.query('select 1 from public.command_receipts where workspace_id = $1', [W_DELETE])).rowCount).toBe(0)
      expect(await pgError(c, 'delete from public.workspaces where id = $1', [W_DELETE])).toBeNull()
    })
  })

  it('워크스페이스는 프로젝트의 것이다(WORKSPACE_SCOPE_MISMATCH·비면 채운다), wbs_import 영수증은 프로젝트가 있어야 한다(check)', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, RECEIPT_INSERT, [F.users.platform, CMD1, F.wsB, F.projects.a]))
        .toMatchObject({ code: '23514', message: 'WORKSPACE_SCOPE_MISMATCH' })
      expect(await pgError(c, RECEIPT_INSERT, [F.users.platform, CMD2, F.ws, null]))
        .toMatchObject({ code: '23514', constraint: 'command_receipts_project_required' })
      await c.query(RECEIPT_INSERT, [F.users.platform, CMD3, null, F.projects.a])
      expect((await c.query('select workspace_id from public.command_receipts where command_id = $1', [CMD3])).rows)
        .toEqual([{ workspace_id: F.ws }])
    })
  })
})

describe('import_wbs_cmd — 가져오기 명령(같은 명령 2회 = 1벌)', () => {
  it('세션은 관리자여도 실행하지 못하고(42501) service_role 은 실행한다', async () => {
    await asUser(pool, F.users.platform, async (c) => {
      expect(await pgError(c, RPC, [F.users.platform, F.projects.a, 'append', items('RLS 세션'), null, CMD1]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function import_wbs_cmd') })
    })
    await asService(pool, async (c) => {
      await newProject(c, PA)
      await c.query('set local role service_role')
      expect(await call(c, [F.users.platform, PA, 'append', items('RLS 서비스'), null, CMD1]))
        .toEqual({ status: 'applied', mode: 'append', count: 1, command_id: CMD1 })
    })
  })

  it('행위자나 명령 id 가 없으면 COMMAND_ID_REQUIRED — 아무것도 쓰지 않는다', async () => {
    await asService(pool, async (c) => {
      await newProject(c, PA)
      for (const [actor, cmd] of [[null, CMD1], [F.users.platform, null]] as const) {
        expect(await pgError(c, RPC, [actor, PA, 'append', items('RLS 없음'), null, cmd]), String(actor))
          .toMatchObject({ code: '22023', message: 'COMMAND_ID_REQUIRED' })
      }
      expect(await namesIn(c, PA)).toEqual([])
      expect((await c.query('select 1 from public.command_receipts where project_id = $1', [PA])).rowCount).toBe(0)
    })
  })

  it('입력 모양이 틀리면 IMPORT_INVALID_INPUT — 모드·항목 배열·휴일 배열·프로젝트', async () => {
    const INVALID = { code: '22023', message: 'IMPORT_INVALID_INPUT' }
    await asService(pool, async (c) => {
      await newProject(c, PA)
      expect(await pgError(c, RPC, [F.users.platform, PA, 'merge', items('a'), null, CMD1]), 'mode').toMatchObject(INVALID)
      expect(await pgError(c, RPC, [F.users.platform, PA, null, items('a'), null, CMD1]), 'mode null').toMatchObject(INVALID)
      expect(await pgError(c, RPC, [F.users.platform, PA, 'append', '{}', null, CMD1]), 'items object').toMatchObject(INVALID)
      expect(await pgError(c, RPC, [F.users.platform, PA, 'append', null, null, CMD1]), 'items null').toMatchObject(INVALID)
      expect(await pgError(c, RPC, [F.users.platform, PA, 'append', items('a'), '"2026-10-01"', CMD1]), 'holidays').toMatchObject(INVALID)
      expect(await pgError(c, RPC, [F.users.platform, null, 'append', items('a'), null, CMD1]), 'project').toMatchObject(INVALID)
    })
  })

  it('없는 프로젝트는 PROJECT_NOT_FOUND, 그 프로젝트의 관리자가 아니면 IMPORT_FORBIDDEN(명단 없는 멤버·다른 워크스페이스 관리자)', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, RPC, [F.users.platform, MISSING, 'append', items('a'), null, CMD1]))
        .toMatchObject({ code: 'P0002', message: 'PROJECT_NOT_FOUND' })
      expect(await pgError(c, RPC, [F.users.aLoose, F.projects.a, 'append', items('a'), null, CMD2]))
        .toMatchObject({ code: '42501', message: 'IMPORT_FORBIDDEN' })
      expect(await pgError(c, RPC, [F.users.bAdmin, F.projects.a, 'append', items('a'), null, CMD3]))
        .toMatchObject({ code: '42501', message: 'IMPORT_FORBIDDEN' })
    })
  })

  it('같은 명령 두 번 = 항목 한 벌, 두 번째는 저장한 결과의 duplicate — 영수증 한 행, 행위자 본인이 읽는다', async () => {
    await asService(pool, async (c) => {
      const args = [F.users.member, F.projects.a, 'append', items('RLS 영수증 1'), null, CMD1]   // alice — A 명단 관리자
      const first = await call(c, args)
      expect(first).toEqual({ status: 'applied', mode: 'append', count: 1, command_id: CMD1 })
      expect(await call(c, args)).toEqual({ ...first, status: 'duplicate' })
      expect((await c.query(`select 1 from public.wbs_items where project_id = $1 and name = 'RLS 영수증 1'`, [F.projects.a])).rowCount).toBe(1)
      expect((await c.query('select kind, workspace_id, project_id, result from public.command_receipts where actor = $1 and command_id = $2',
        [F.users.member, CMD1])).rows).toEqual([{ kind: 'wbs_import', workspace_id: F.ws, project_id: F.projects.a, result: first }])
      await toSession(c, F.users.member)
      expect((await c.query('select 1 from public.command_receipts where command_id = $1', [CMD1])).rowCount).toBe(1)
      await toServer(c)
    })
  })

  it('같은 id 에 다른 내용·다른 모드·다른 프로젝트는 COMMAND_REUSED, 휴일 null 과 [] 는 같은 요약, 다른 행위자의 같은 id 는 새 명령', async () => {
    await asService(pool, async (c) => {
      await newProject(c, PA)
      await newProject(c, PB)
      const same = items('RLS 재사용')
      expect(await call(c, [F.users.platform, PA, 'append', same, null, CMD1])).toMatchObject({ status: 'applied' })
      expect(await pgError(c, RPC, [F.users.platform, PA, 'append', items('RLS 다른 내용'), null, CMD1]), 'items').toMatchObject(REUSED)
      expect(await pgError(c, RPC, [F.users.platform, PA, 'replace', same, null, CMD1]), 'mode').toMatchObject(REUSED)
      expect(await pgError(c, RPC, [F.users.platform, PB, 'append', same, null, CMD1]), 'project').toMatchObject(REUSED)
      expect(await call(c, [F.users.platform, PA, 'append', same, '[]', CMD1])).toMatchObject({ status: 'duplicate' })
      // A 워크스페이스 관리자가 같은 id·같은 내용을 보내면 자기 명령이다 — 한 벌 더
      expect(await call(c, [F.users.wsAdmin, PA, 'append', same, null, CMD1])).toEqual({ status: 'applied', mode: 'append', count: 1, command_id: CMD1 })
      expect(await namesIn(c, PA)).toEqual(['RLS 재사용', 'RLS 재사용'])
      expect(await namesIn(c, PB)).toEqual([])
    })
  })

  it('replace 의 재전송은 다시 지우지 않는다 — 그사이 생긴 항목이 남는다', async () => {
    await asService(pool, async (c) => {
      await newProject(c, PA)
      await call(c, [F.users.platform, PA, 'append', items('RLS 옛 항목'), null, CMD1])
      expect(await call(c, [F.users.platform, PA, 'replace', items('RLS 새 항목'), null, CMD2]))
        .toEqual({ status: 'applied', mode: 'replace', count: 1, command_id: CMD2 })
      expect(await namesIn(c, PA)).toEqual(['RLS 새 항목'])
      await c.query(`insert into public.wbs_items (project_id, code, name) values ($1, '9', 'RLS 그사이')`, [PA])
      expect(await call(c, [F.users.platform, PA, 'replace', items('RLS 새 항목'), null, CMD2]))
        .toEqual({ status: 'duplicate', mode: 'replace', count: 1, command_id: CMD2 })
      expect(await namesIn(c, PA)).toEqual(['RLS 그사이', 'RLS 새 항목'])
    })
  })

  it('read committed 가 아니면 25001 IMPORT_RECEIPT_ISOLATION(세 수준) — read committed 는 통과', async () => {
    const REFUSED = ['repeatable read', 'serializable', 'read uncommitted']
    const results: Record<string, unknown> = {}
    for (const level of [...REFUSED, 'read committed']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        results[level] = await pgError(c, RPC, [F.users.member, F.projects.a, 'append', items('RLS 격리'), null, CMD4])
      } finally {
        await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
      }
    }
    for (const level of REFUSED) expect(results[level], level).toMatchObject({ code: '25001', message: 'IMPORT_RECEIPT_ISOLATION' })
    expect(results['read committed']).toBeNull()
  })

  it('옛 import_wbs 의 세션 실행은 그대로다(ⓚ) — 두 옛 함수는 INVOKER·search_path 미지정·authenticated 실행권 유지', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect((await c.query<{ n: number }>('select public.import_wbs($1, $2::jsonb, null) as n', [F.projects.a, items('RLS 옛 경로')])).rows[0].n)
        .toBe(1)
    })
    const { rows } = await pool.query(
      `select p.proname as name, has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok, p.prosecdef as secdef, p.proconfig as config
         from pg_proc p
        where p.oid in ('public.import_wbs(uuid, jsonb, jsonb)'::regprocedure, 'public.replace_wbs(uuid, jsonb, jsonb)'::regprocedure)
        order by p.proname`)
    expect(rows).toEqual([
      { name: 'import_wbs', ok: true, secdef: false, config: null },
      { name: 'replace_wbs', ok: true, secdef: false, config: null },
    ])
  })

  it('잠금 대기 상한은 함수 속성이다 — lock_timeout=15s(15초를 기다리는 케이스는 두지 않는다)', async () => {
    const { rows } = await pool.query<{ config: string[] }>(
      `select proconfig as config from pg_proc where oid = 'public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid)'::regprocedure`)
    expect(rows[0].config).toEqual(expect.arrayContaining(['lock_timeout=15s']))
  })
})

describe('import_wbs_cmd — 두 연결(커밋)', () => {
  const W = '00000000-0000-0000-7e57-00000000aa42'
  const P = ID('50')
  const cleanup = async () => {
    await pool.query('delete from public.projects where workspace_id = $1', [W])
    await pool.query('delete from public.workspaces where id = $1', [W])
  }
  /** 전용 워크스페이스·프로젝트를 커밋하고 두 연결을 연다. 끝나면(실패해도) 지우고 남은 행 0 을 단언한다. 하네스 풀은 연결 2개다 —
   *  fn 안에서 pool.query 를 부르지 않는다(선례 settings-cas.test.ts) */
  async function twoConnections(fn: (s1: PoolClient, s2: PoolClient, s2Pid: number) => Promise<void>) {
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await cleanup()
      await pool.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp4-receipts', 'Acme 영수증')`, [W])
      await pool.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 영수증 두 연결', W])
      s1 = await pool.connect()
      s2 = await pool.connect()
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await fn(s1, s2, s2Pid)
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    const { rows } = await pool.query(
      `select (select count(*) from public.projects where workspace_id = $1)::int as projects,
              (select count(*) from public.command_receipts where workspace_id = $1)::int as receipts,
              (select count(*) from public.workspaces where id = $1)::int as workspaces`, [W])
    expect(rows[0]).toEqual({ projects: 0, receipts: 0, workspaces: 0 })
  }
  /** s2 에서 RPC 를 띄우고, s1 이 쥔 잠금을 기다리는지 pg_blocking_pids 로 본다 */
  async function blockedCall(s1: PoolClient, s2: PoolClient, s2Pid: number, args: unknown[]) {
    let settled = false
    const pending = s2.query<{ r: unknown }>(RPC, args).then(
      (res) => res.rows[0].r, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
    ).finally(() => { settled = true })
    let blocked = false
    for (let i = 0; i < 250 && !settled && !blocked; i++) {
      blocked = (await s1.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [s2Pid])).rows[0].n > 0
      if (!blocked) await new Promise((r) => setTimeout(r, 20))
    }
    return { pending, blocked }
  }

  it('같은 명령의 동시 재전송 — 한쪽 applied·한쪽 duplicate, 항목 한 벌·영수증 한 행', async () => {
    await twoConnections(async (s1, s2, s2Pid) => {
      const args = [F.users.platform, P, 'append', items('RLS 동시'), null, ID('51')]
      await s1.query('begin')
      await s2.query('begin')
      expect((await s1.query<{ r: unknown }>(RPC, args)).rows[0].r).toEqual({ status: 'applied', mode: 'append', count: 1, command_id: ID('51') })
      const { pending, blocked } = await blockedCall(s1, s2, s2Pid, args)
      expect(blocked, '둘째 연결이 명령 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await pending).toEqual({ status: 'duplicate', mode: 'append', count: 1, command_id: ID('51') })
      await s2.query('commit')
      expect((await s1.query('select 1 from public.wbs_items where project_id = $1', [P])).rowCount).toBe(1)
      expect((await s1.query('select 1 from public.command_receipts where project_id = $1', [P])).rowCount).toBe(1)
    })
  })

  it('같은 프로젝트의 replace 둘은 프로젝트 잠금으로 줄 선다 — 트리는 나중 것 한 벌', async () => {
    await twoConnections(async (s1, s2, s2Pid) => {
      await s1.query('begin')
      await s2.query('begin')
      await s1.query(RPC, [F.users.platform, P, 'replace', items('RLS 첫 트리 1', 'RLS 첫 트리 2'), null, ID('52')])
      const { pending, blocked } = await blockedCall(s1, s2, s2Pid, [F.users.platform, P, 'replace', items('RLS 둘째 트리'), null, ID('53')])
      expect(blocked, '둘째 replace 가 프로젝트 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await pending).toEqual({ status: 'applied', mode: 'replace', count: 1, command_id: ID('53') })
      await s2.query('commit')
      expect((await s1.query<{ name: string }>('select name from public.wbs_items where project_id = $1', [P])).rows)
        .toEqual([{ name: 'RLS 둘째 트리' }])
    })
  })
})

describe('⑦ 사후검사 — 마이그레이션의 블록을 그대로 돌린다(민감도)', () => {
  // 번호를 쓰지 않는다 — 접미로 찾는다. 블록은 읽기만 하므로 적용 뒤에 다시 돌려도 된다
  const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
  const files = readdirSync(dir).filter((f) => f.endsWith('_command_receipts.sql'))
  const blocks = () => (readFileSync(dir + files[0], 'utf8').match(/^do \$\$\n[\s\S]*?^end \$\$;$/gm) ?? [])
    .filter((b) => b.includes('COMMAND_RECEIPTS_POSTCHECK'))
  const POSTCHECK = { message: expect.stringContaining('COMMAND_RECEIPTS_POSTCHECK') }
  /** 롤백하는 트랜잭션에서 mutate 뒤 블록을 돌려 오류를 돌려준다(통과하면 null) */
  const runAfter = (mutate: string[]) => asService(pool, async (c) => {
    for (const m of mutate) await c.query(m)
    return pgError(c, blocks()[0])
  })

  it('파일 하나·블록 하나 — 지금 카탈로그에서는 통과한다', async () => {
    expect(files).toHaveLength(1)
    expect(blocks()).toHaveLength(1)
    expect(await runAfter([])).toBeNull()
  })

  it('트리거를 끄거나(D)·복제 전용(R)으로, 세션에 쓰기·실행 권한을 주면, 잠금 상한을 지우면 멈춘다', async () => {
    expect(await runAfter(['alter table public.command_receipts disable trigger command_receipts_worm'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter table public.command_receipts enable replica trigger command_receipts_no_truncate'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['grant insert on public.command_receipts to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['grant execute on function public.convert_inherited_teams(uuid, uuid) to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter function public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid) reset lock_timeout'])).toMatchObject(POSTCHECK)
  })

  it('공용 팀 참조 거부(⑤′ — A1-3 리뷰 M1)의 트리거를 끄거나 지우거나, 함수를 INVOKER 로 바꾸면 멈춘다', async () => {
    expect(await runAfter(['alter table public.area_teams disable trigger area_teams_owned_scope'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['drop trigger project_invites_owned_scope on public.project_invites'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter function public.team_ref_owned_scope() security invoker'])).toMatchObject(POSTCHECK)
  })
})
