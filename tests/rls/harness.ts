// tests/rls 하네스 — 로컬 Postgres 에 직접 붙어 PostgREST 가 하는 세션 설정(set local role authenticated +
// request.jwt.claims)을 흉내 낸다. RLS 정책·트리거·컬럼 권한이 앱과 같은 조건에서 평가된다.
// 모든 케이스는 begin…rollback 안에서 돈다 — 픽스처(loadFixture) 외에는 DB 에 아무것도 남기지 않는다.
// 접속 대상은 127.0.0.1/localhost 뿐이다(원본 DB 금지 — scripts/lib/targets.mjs).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseError, Pool, type PoolClient } from 'pg'
import { LOCAL_DSN, assertNotForbidden, detectEnvTarget } from '../../scripts/lib/targets.mjs'

const ENV_LOCAL = fileURLToPath(new URL('../../.env.local', import.meta.url))
const FIXTURE_SQL = fileURLToPath(new URL('./fixture.sql', import.meta.url))
const FIXTURE_WS_SQL = fileURLToPath(new URL('./fixture-ws.sql', import.meta.url))
const SUPABASE_CONFIG = fileURLToPath(new URL('../../supabase/config.toml', import.meta.url))
/** 사용자 데이터가 든 DB 에 붙이는 표식 — `comment on database postgres is 'dflow:protected'`(docs/runbook-user-db-apply.md). db reset 은 지운다 */
export const PROTECTED_DB_MARK = 'dflow:protected'
const LOCAL_HOSTS = ['127.0.0.1', 'localhost']
// targets.mjs 의 INVISIBLE 과 같은 집합 — URL 파서가 조용히 지우는 문자가 끼면 읽은 호스트와 접속 호스트가 갈라진다
const INVISIBLE = /[\s\p{Cc}\p{Cf}]/u

type EnvBag = Record<string, string | undefined>

/**
 * Postgres DSN 이 로컬인지 검사하고 파싱 결과를 돌려준다. 통과 조건: 금지 ref 없음, 보이지 않는 문자 없음,
 * postgres(ql): 스킴, 호스트가 정확히 127.0.0.1 또는 localhost, 쿼리 문자열 없음(pg 는 ?host=·?hostaddr= 로
 * 접속 호스트를 바꾼다). classifySupabaseUrl 은 http(s) 만 로컬로 보므로 같은 규칙을 pg 스킴에 맞춰 옮겼다.
 */
function parseLocalDsn(dsn: string): URL {
  assertNotForbidden(dsn)
  if (INVISIBLE.test(dsn)) throw new Error('RLS 하네스: DSN 에 공백·제어 문자가 있다')
  let url: URL
  try {
    url = new URL(dsn)
  } catch {
    throw new Error('RLS 하네스: DSN 이 URL 형식이 아니다')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`RLS 하네스: postgres DSN 이 아니다(${url.protocol})`)
  if (!LOCAL_HOSTS.includes(url.hostname)) throw new Error(`RLS 하네스: 로컬 DB 만 허용한다(호스트 ${url.hostname})`)
  if (url.search || url.hash) throw new Error('RLS 하네스: DSN 에 쿼리 문자열을 두지 않는다(접속 호스트를 바꿀 수 있다)')
  return url
}

/**
 * 하네스가 붙을 DSN. RLS_DATABASE_URL(CI)이 있으면 그것, 없으면 .env.local 이 로컬을 가리킬 때만 LOCAL_DSN.
 * 어느 쪽이든 127.0.0.1/localhost 가 아니면 throw — fail-closed.
 */
export function localDsn(env: EnvBag = process.env): string {
  const override = env.RLS_DATABASE_URL
  if (override) {
    parseLocalDsn(override)
    return override
  }
  let text: string
  try {
    text = readFileSync(ENV_LOCAL, 'utf8')
  } catch {
    throw new Error('RLS 하네스: .env.local 이 없다 — npm run env:local 을 먼저 돌리거나 RLS_DATABASE_URL 을 준다')
  }
  assertNotForbidden(text)
  const target = detectEnvTarget(text, {})
  if (target !== 'local') throw new Error(`RLS 하네스: .env.local 이 로컬을 가리키지 않는다(${target})`)
  const dsn = configDsn()
  parseLocalDsn(dsn)
  return dsn
}

/**
 * 이 체크아웃의 supabase/config.toml [db] port 로 만든 DSN. 워크트리마다 포트를 달리 둔 전용 스택이 있으면 그쪽에 붙는다 —
 * 예전엔 LOCAL_DSN(54322) 고정이라 전용 스택을 띄운 워크트리의 `npm run test:rls` 가 메인 스택(사용자 데이터)에 픽스처를 커밋했다.
 * 설정 파일이 없거나 포트를 못 읽으면 LOCAL_DSN.
 */
export function configDsn(text?: string): string {
  let toml = text
  if (toml === undefined) {
    try { toml = readFileSync(SUPABASE_CONFIG, 'utf8') } catch { return LOCAL_DSN }
  }
  const lines = toml.split('\n')
  const start = lines.findIndex((l) => l.trim() === '[db]')
  if (start < 0) return LOCAL_DSN
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('['))
  const section = (end < 0 ? rest : rest.slice(0, end)).join('\n')
  const port = /^port\s*=\s*(\d{2,5})\s*$/m.exec(section)?.[1]
  if (!port) return LOCAL_DSN
  const url = new URL(LOCAL_DSN)
  url.port = port
  return url.toString()
}

/** 보호 표식이 붙은 DB 면 멈춘다 — 픽스처를 커밋하기 전에 부른다(fail-closed: 표식을 못 읽어도 멈춘다) */
export async function assertNotProtected(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ mark: string | null }>(
    `select shobj_description(oid, 'pg_database') as mark from pg_database where datname = current_database()`)
  if (rows.length !== 1) throw new Error('RLS 하네스: DB 표식을 읽지 못했다')
  if (rows[0].mark?.includes(PROTECTED_DB_MARK)) {
    throw new Error(`RLS 하네스: 이 DB 는 보호 표식(${PROTECTED_DB_MARK})이 있다 — 사용자 데이터 DB 에는 테스트 픽스처를 넣지 않는다. 전용 스택을 띄우거나 RLS_DATABASE_URL 을 준다`)
  }
}

/** 검사를 통과한 좌표를 필드로 풀어 넘긴다 — pg 가 DSN 을 다시 해석해 검사와 다른 곳에 붙는 일이 없게. */
export function openPool(): Pool {
  const url = parseLocalDsn(localDsn())
  const pool = new Pool({
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 5_000,
  })
  // 유휴 연결의 오류가 처리되지 않은 이벤트로 프로세스를 죽이지 않게 한다. 쿼리 중 오류는 각 호출이 받는다.
  pool.on('error', (e) => console.error('[rls harness] idle client error:', e.message))
  return pool
}

export async function withPool<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = openPool()
  try {
    return await fn(pool)
  } finally {
    await pool.end()
  }
}

/** begin → prepare → fn → 늘 rollback. rollback 이 실패한 연결(끊김 등)은 풀에 돌려보내지 않고 버린다. */
async function rolledBack<T>(
  pool: Pool,
  prepare: (c: PoolClient) => Promise<void>,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect()
  let result: T
  try {
    await c.query('begin')
    await prepare(c)
    result = await fn(c)
  } catch (e) {
    await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
    throw e
  }
  try {
    await c.query('rollback')
  } catch (re) {
    c.release(re as Error)
    throw re
  }
  c.release()
  return result
}

/**
 * 세션 경로: PostgREST 처럼 authenticated 롤 + JWT sub 로 RLS·컬럼 권한·RPC 실행 권한을 실제로 태운다.
 * 설정이 먹었는지(auth.uid()·current_user) 먼저 확인한다 — 흉내가 빗나가면 케이스가 엉뚱한 이유로 통과할 수 있다.
 */
export function asUser<T>(pool: Pool, userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return rolledBack(pool, async (c) => {
    await c.query('set local role authenticated')
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ])
    const { rows } = await c.query<{ uid: string | null; role: string }>(
      'select auth.uid()::text as uid, current_user::text as role',
    )
    if (rows[0]?.uid !== userId || rows[0]?.role !== 'authenticated') {
      throw new Error(`RLS 하네스: 세션 흉내 실패(auth.uid()=${rows[0]?.uid}, current_user=${rows[0]?.role})`)
    }
  }, fn)
}

/**
 * service_role 경로: postgres 롤 그대로(RLS·실행 권한 우회), auth.uid() 는 null — 트리거들이 "service_role 경로" 로 판정하는 조건.
 * 롤 권한 부여(grant ... to service_role) 자체는 이 경로로 검증되지 않는다(postgres 는 슈퍼유저).
 */
export function asService<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return rolledBack(pool, async (c) => {
    const { rows } = await c.query<{ uid: string | null }>('select auth.uid()::text as uid')
    if (rows[0]?.uid !== null) throw new Error(`RLS 하네스: service 경로인데 auth.uid()=${rows[0]?.uid}`)
  }, fn)
}

/**
 * 문장 하나를 savepoint 안에서 돌려 DB 오류를 돌려준다(성공하면 null). 같은 트랜잭션에서 다음 문장을 이어 갈 수 있다.
 * DB 오류가 아닌 예외(연결 끊김 등)는 그대로 던진다.
 */
export async function pgError(c: PoolClient, sql: string, params: unknown[] = []): Promise<DatabaseError | null> {
  await c.query('savepoint rls_expect')
  try {
    await c.query(sql, params)
  } catch (e) {
    if (!(e instanceof DatabaseError)) throw e
    await c.query('rollback to savepoint rls_expect')
    return e
  }
  await c.query('release savepoint rls_expect')
  return null
}

/** fixture.sql·fixture-ws.sql 의 고정 id. 한쪽을 바꾸면 다른 쪽도 바꾼다. */
export const F = {
  ws: '00000000-0000-0000-7e57-00000000aa01',
  /** 케이스 ⑨ 의 이동 대상 워크스페이스 */
  otherWs: '00000000-0000-0000-7e57-00000000aa02',
  /** 워크스페이스 B — F.otherWs 와 같은 행. SP2 교차 테스트는 이 이름으로 쓴다 */
  wsB: '00000000-0000-0000-7e57-00000000aa02',
  users: {
    platform: '00000000-0000-0000-7e57-0000000000a1',
    wsAdmin: '00000000-0000-0000-7e57-0000000000a2',
    /** alice — A 관리자(팀 ERP 대표·MES), B 멤버(팀 QA 대표) */
    member: '00000000-0000-0000-7e57-0000000000a3',
    /** bea — B 워크스페이스 관리자(명단 없음) */ bAdmin: '00000000-0000-0000-7e57-0000000000a6',
    /** ben — B 멤버, B 프로젝트 명단 member */ bMember: '00000000-0000-0000-7e57-0000000000a7',
    /** cy — A 워크스페이스 멤버, 명단 없음 */ aLoose: '00000000-0000-0000-7e57-0000000000a8',
    /** dana — A·B 둘 다 멤버(A 먼저 가입), 양쪽 명단 member */ dual: '00000000-0000-0000-7e57-0000000000a9',
  },
  projects: {
    a: '00000000-0000-0000-7e57-0000000000c1', b: '00000000-0000-0000-7e57-0000000000c2',
    aPrivate: '00000000-0000-0000-7e57-0000000000c3', bWs: '00000000-0000-0000-7e57-0000000000c4',
  },
  teams: {
    /** A 워크스페이스 공용 팀(project_id null, 코드 SHR) — 전수 교차의 teams 첫 행(가장 작은 id)이라 wsadmin_* 분기를 탄다 */
    aShared: '00000000-0000-0000-7e57-0000000000d0',
    erp: '00000000-0000-0000-7e57-0000000000d1',
    mes: '00000000-0000-0000-7e57-0000000000d2',
    qa: '00000000-0000-0000-7e57-0000000000d3',
    qa2: '00000000-0000-0000-7e57-0000000000d4',
    ops: '00000000-0000-0000-7e57-0000000000d5',
  },
  leaf: {
    /** A 리프, 담당 ERP(alice 의 A 팀) */
    aErp: '00000000-0000-0000-7e57-0000000000f1',
    /** B 리프, 담당 QA2 — alice 의 B 팀(QA)이 아니다(이름은 브리프 인터페이스를 따른다) */
    bQa: '00000000-0000-0000-7e57-0000000000f2',
    /** B 리프, 담당 QA — alice 의 B 팀. 멤버 경로(member_update_actual)의 양성 대조 */
    bOwnTeam: '00000000-0000-0000-7e57-0000000000f3',
    bWs: '00000000-0000-0000-7e57-0000000000f4', aDep1: '00000000-0000-0000-7e57-0000000000f5', aDep2: '00000000-0000-0000-7e57-0000000000f6',
  },
  people: {
    platform: '00000000-0000-0000-7e57-0000000000b1',
    wsAdmin: '00000000-0000-0000-7e57-0000000000b2',
    member: '00000000-0000-0000-7e57-0000000000b3',
    /** bob — 계정 없는 외부 인력 */
    external: '00000000-0000-0000-7e57-0000000000b4',
    bAdmin: '00000000-0000-0000-7e57-0000000000b6', bMember: '00000000-0000-0000-7e57-0000000000b7',
    aLoose: '00000000-0000-0000-7e57-0000000000b8', dualA: '00000000-0000-0000-7e57-0000000000b9',
    dualB: '00000000-0000-0000-7e57-0000000000ba',
  },
  members: {
    aliceA: '00000000-0000-0000-7e57-0000000000e1',
    aliceB: '00000000-0000-0000-7e57-0000000000e2',
    bobA: '00000000-0000-0000-7e57-0000000000e3',
    benB: '00000000-0000-0000-7e57-0000000000e4', danaA: '00000000-0000-0000-7e57-0000000000e5',
    danaB: '00000000-0000-0000-7e57-0000000000e6', alicePrivate: '00000000-0000-0000-7e57-0000000000e7',
  },
  rows: {
    meeting: '00000000-0000-0000-7e57-000000001101', issue: '00000000-0000-0000-7e57-000000001102',
    minute: '00000000-0000-0000-7e57-000000001103', minuteVersion: '00000000-0000-0000-7e57-000000001104',
    wikiTopic: '00000000-0000-0000-7e57-000000001105', wikiItem: '00000000-0000-0000-7e57-000000001106',
    wikiItem2: '00000000-0000-0000-7e57-000000001107', weeklyReport: '00000000-0000-0000-7e57-000000001108',
    globalEvent: '00000000-0000-0000-7e57-000000001109', folder: '00000000-0000-0000-7e57-00000000110d',
    attendance: '00000000-0000-0000-7e57-000000001114', minuteFile: '00000000-0000-0000-7e57-000000001118',
    /** 프로젝트 없는 회의록·폴더(A, 작성자 alice) — workspace_id 로만 스코프 */
    nullMinute: '00000000-0000-0000-7e57-00000000112b', nullFolder: '00000000-0000-0000-7e57-00000000112c',
  },
} as const

/**
 * fixture.sql → fixture-ws.sql 을 postgres 롤로 한 트랜잭션에 적용한다(멱등). 그 뒤 케이스가 기대는 전제를 확인한다 —
 * on conflict do nothing 은 같은 id 의 다른 행을 조용히 남기므로, 어긋난 픽스처가 정책 회귀처럼 보이지 않게 여기서 멈춘다.
 */
export async function loadFixture(pool: Pool): Promise<void> {
  await assertNotProtected(pool)
  const sql = readFileSync(FIXTURE_SQL, 'utf8')
  const wsSql = readFileSync(FIXTURE_WS_SQL, 'utf8')
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(sql)
    await c.query(wsSql)
    await c.query('commit')
  } catch (e) {
    await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
    throw e
  }
  c.release()

  const { rows } = await pool.query<{ ok: boolean }>(
    `select
       (select access_role from public.project_members where id = $1 and project_id = $4 and person_id = $7) = 'admin'
       and (select access_role from public.project_members where id = $2 and project_id = $5 and person_id = $7) = 'member'
       and (select access_role is null from public.project_members where id = $3 and project_id = $4 and person_id = $8)
       and (select user_id is null from public.people where id = $8)
       and (select array_agg(user_id) from public.workspace_members where workspace_id = $6 and role = 'admin') = array[$9::uuid]
       and (select array_agg(user_id) from public.workspace_members where workspace_id = $10 and role = 'admin') = array[$11::uuid]
       as ok`,
    [F.members.aliceA, F.members.aliceB, F.members.bobA, F.projects.a, F.projects.b, F.ws, F.people.member,
      F.people.external, F.users.wsAdmin, F.wsB, F.users.bAdmin],
  )
  if (!rows[0]?.ok) throw new Error('RLS 하네스: DB 의 픽스처 행이 fixture.sql·fixture-ws.sql 과 어긋난다 — 수동으로 바꾼 행이 있는지 확인')
}
