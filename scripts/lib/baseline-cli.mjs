// scripts/lib/baseline-cli.mjs — baseline-dump.mjs·baseline-diff.mjs 의 인자·자격증명·대상 검사(순수)와 컨테이너 실행기.
// 검사 함수는 부작용이 없어 vitest 로 고정한다. runContainer 만 프로세스를 띄운다.
import { spawn, spawnSync } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { assertNotForbidden } from './targets.mjs'

export class UsageError extends Error {}

// 원본 DB 에 오래 머물지 않게 — 세션 옵션(수락될 때)과 psql 트랜잭션 로컬 설정에 같은 값을 건다.
// idle_in_transaction: 클라이언트가 네트워크 블랙홀로 사라져도 원본이 스냅샷(xmin)·락을 쥔 채 남지 않게 끊는다.
// pg_dump 는 접속 직후 statement_timeout·lock_timeout·idle_in_transaction_session_timeout·transaction_timeout 을
// 모두 0 으로 되돌리므로 PGOPTIONS 의 timeout 들은 사실상 psql 에만 먹는다(pg_dump 의 상한은 벽시계·신호 처리).
export const STATEMENT_TIMEOUT_MS = 120_000
export const LOCK_TIMEOUT_MS = 5_000
export const IDLE_IN_TX_TIMEOUT_MS = 15_000
export const PGOPTIONS = [
  '-c default_transaction_read_only=on',
  `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  `-c lock_timeout=${LOCK_TIMEOUT_MS}`,
  `-c idle_in_transaction_session_timeout=${IDLE_IN_TX_TIMEOUT_MS}`,
].join(' ')

/**
 * 카탈로그 psql 인자. 여러 -c 는 한 연결에서 순서대로 실행되므로 BEGIN … READ ONLY 가 뒤 문장까지 유효하다.
 * -1 은 끝에 COMMIT 을 붙이므로 쓰지 않고 명시적으로 rollback 한다.
 */
export const catalogArgs = (sql) => ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  '-c', 'begin transaction isolation level repeatable read read only',
  '-c', `set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`,
  '-c', `set local lock_timeout = ${LOCK_TIMEOUT_MS}`,
  '-c', `set local idle_in_transaction_session_timeout = ${IDLE_IN_TX_TIMEOUT_MS}`,
  '-c', sql,
  '-c', 'rollback']

// --schema-only: 데이터 행은 한 줄도 나오지 않는다. --lock-wait-timeout: ACCESS SHARE 락을 원본 DDL 뒤에서
// 기다리며 줄 세우지 않고 5초 만에 포기한다.
export const DUMP_ARGS = ['--schema-only', '--schema=public', '--no-owner', '--no-comments', `--lock-wait-timeout=${LOCK_TIMEOUT_MS}`]

export const USAGE = `사용: node scripts/baseline-dump.mjs <모드>
  --dry-run                     로컬 선행조건만 확인하고 실행할 명령을 출력(비밀 미열람·접속 없음)
  --execute                     원본 운영 DB 에 읽기 전용 1회 접속(카탈로그 1건 + pg_dump --schema-only)
  --from-raw <dir> [--out <d>]  저장된 원본(raw)만으로 재가공(키체인·docker·네트워크 없음)
  --rehearse --out <dir>        BASELINE_REHEARSE_DSN 의 가짜 서버로 전 과정 리허설(내부 전용 docker 네트워크)`

/** 모드는 정확히 하나. 모르는 인자·남는 인자·오타는 전부 사용법 오류 — 어떤 경우에도 기본값으로 접속하지 않는다. */
export function parseArgs(argv) {
  const [first, ...rest] = argv
  const takeOut = (args) => {
    if (args.length === 0) return {}
    if (args.length === 2 && args[0] === '--out' && args[1] && !args[1].startsWith('--')) return { outDir: args[1] }
    throw new UsageError(`알 수 없는 인자: ${args.join(' ')}`)
  }
  if (first === '--dry-run' && rest.length === 0) return { mode: 'dry-run' }
  if (first === '--execute' && rest.length === 0) return { mode: 'execute' }
  if (first === '--from-raw') {
    const [dir, ...more] = rest
    if (!dir || dir.startsWith('--')) throw new UsageError('--from-raw 에 원본 디렉터리가 없다')
    return { mode: 'from-raw', rawDir: dir, ...takeOut(more) }
  }
  if (first === '--rehearse') {
    const out = takeOut(rest)
    if (!out.outDir) throw new UsageError('--rehearse 는 --out <dir> 이 필요하다')
    return { mode: 'rehearse', ...out }
  }
  throw new UsageError(argv.length ? `알 수 없는 인자: ${argv.join(' ')}` : '모드를 지정하지 않았다')
}

export const DIFF_USAGE = `사용: node scripts/baseline-diff.mjs [--raw <dir>] | --snapshot
  (인자 없음)      로컬 재생본을 커밋된 기준선(prod-catalog.json·0000_baseline.sql)과 대조 — 운영 접속 없음
  --raw <dir>      <dir>/dump.sql(운영 원본, 이 PC 에만 있다)과도 대조 — 차이 0 이어야 한다
  --snapshot       docs/baseline/2026-09-23-live-catalog.md 만 prod-catalog.json 에서 다시 쓴다(docker·DB 불필요, 대조 안 함)`

/** baseline-diff 인자. 모르는 인자·값 없는 --raw·중복·--snapshot 과 --raw 동시는 사용법 오류 — 검사를 조용히 건너뛰지 않는다. */
export function parseDiffArgs(argv) {
  const out = { snapshot: false, rawDir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--snapshot' && !out.snapshot) out.snapshot = true
    else if (a === '--raw' && out.rawDir === null && argv[i + 1] && !argv[i + 1].startsWith('--')) out.rawDir = argv[++i]
    else throw new UsageError(`알 수 없는 인자: ${argv.slice(i).join(' ')}`)
  }
  if (out.snapshot && out.rawDir !== null) throw new UsageError('--snapshot 은 DB 없이 스냅샷만 쓰는 모드라 --raw 와 함께 쓰지 않는다')
  return out
}

/**
 * execFileSync 실패 → 원인별 한 덩어리 메시지. error.message 는 쓰지 않는다 — 명령 인자(카탈로그 SQL 전문)가 실린다.
 * 종료 코드·신호와 stderr·stdout 의 첫 줄 몇 개(다듬고 길이 제한)만 싣는다.
 */
export function execFailureMessage(what, error, { timeoutMs, lines = 5, width = 160 }) {
  const head = error.code === 'ETIMEDOUT'
    ? `${what}: ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않아 docker 클라이언트를 ${error.signal ?? 'SIGKILL'} 로 끊었다`
    : error.code === 'ENOENT'
      ? `${what}: docker 를 찾지 못했다 — Docker 런타임(Docker Desktop 또는 colima)을 설치·실행한다`
      : `${what}: exit ${error.status ?? '?'}${error.signal ? ` (신호 ${error.signal})` : ''}`
  const excerpt = (label, out) => String(out ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, lines)
    .map((l) => `  ${label}| ${l.length > width ? `${l.slice(0, width)}…` : l}`)
  const body = [...excerpt('stderr', error.stderr), ...excerpt('stdout', error.stdout)]
  const hint = error.code === 'ENOENT' ? [] : ['  npm run db:start && npm run db:reset 뒤 다시 실행한다']
  return [head, ...body, ...hint].join('\n')
}

/**
 * DSN → libpq 접속값. 비밀번호는 userinfo 자리에만 허용한다(표시·걸러내기 경로가 그것만 다룬다).
 * 오류 메시지에는 DSN 을 싣지 않는다.
 */
export function parseDsn(dsn) {
  let url
  try { url = new URL(dsn) } catch { throw new Error('DSN 이 postgresql:// URL 이 아니다') }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('DSN 이 postgresql:// URL 이 아니다')
  for (const key of url.searchParams.keys()) {
    if (key === 'password') throw new Error('DSN 쿼리에 password= 가 있다 — 비밀번호는 user:비밀번호@ 자리에만 둔다')
    if (key !== 'sslmode') throw new Error(`DSN 쿼리 파라미터 ${key} 는 다루지 않는다 — 버리고 진행하지 않고 중단`)
  }
  const sslmode = url.searchParams.get('sslmode') ?? 'require'
  // verify-* 는 컨테이너에 루트 CA 가 없어 어차피 실패한다. 암호화 없는 접속은 허용하지 않는다.
  if (sslmode !== 'require') throw new Error(`sslmode=${sslmode} — require 만 허용한다`)
  const user = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  if (!user) throw new Error('DSN 에 사용자가 없다')
  if (!password) throw new Error('DSN 에 비밀번호가 없다')
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres'
  const port = url.port || '5432'
  return {
    host: url.hostname, port, user, password, rawPassword: url.password, database, sslmode,
    display: `${url.protocol}//${user}:***@${url.hostname}:${port}/${database}`,
  }
}

/** 쓰기 가능한 관리 롤이면 throw. 읽기 롤 이름은 `<롤>` 또는 풀러 형식 `<롤>.<ref>`. */
export function checkReaderRole(user) {
  const role = String(user ?? '').split('.')[0]
  if (!role || role === 'postgres' || /service_role|supabase_admin/.test(user) || role.startsWith('supabase_')) {
    throw new Error(`읽기 전용 롤이 아니다(${role || '(없음)'}) — 중단`)
  }
}

/** 리허설 호스트는 docker 컨테이너 이름만 — 점·IP·localhost·숫자 주소를 막아 외부로 해석될 여지를 없앤다. */
export function validateRehearseHost(host) {
  const h = String(host ?? '')
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(h) || /^localhost$/i.test(h) || /^(\d+|0x[0-9a-f]+)$/i.test(h)) {
    throw new Error(`리허설 호스트는 docker 컨테이너 이름이어야 한다(점·IP·localhost 불가): ${h || '(없음)'}`)
  }
  assertNotForbidden(h)
}

/**
 * 리허설·재가공 출력 위치 — 리포 밖 절대경로 또는 리포 .superpowers/ 하위. 리포 기준선 자리는 건드리지 않는다.
 * 경로 문자열이 아니라 파일 정체(dev·ino)로 비교한다. 대소문자 변형(APFS 는 대소문자 무시), 리포를 가리키는 심링크,
 * macOS firmlink(/System/Volumes/Data/Users/… 는 realpath 로 풀리지 않지만 같은 inode)가 모두 같은 파일로 잡힌다.
 * 대상(없는 부분은 존재하는 조상까지 realpath)에서 위로 올라가며, 리포 루트와 같은 파일을 만나기 전에
 * <root>/.superpowers 와 같은 파일을 (대상 자신이 아닌 조상으로) 지났을 때만 리포 안을 허용한다.
 * 돌려주는 값은 실경로 — 검사한 곳과 쓰는 곳이 같아야 한다.
 */
export function validateOutDir(out, root) {
  if (!out || !isAbsolute(out)) throw new Error(`--out 은 절대경로여야 한다: ${out}`)
  const target = realpathOfNearest(resolve(out))
  const rootId = fileId(resolve(root))
  if (!rootId) throw new Error(`리포 루트를 stat 할 수 없다: ${root}`)
  const allowId = fileId(join(resolve(root), '.superpowers'))
  const same = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino
  let passedAllowed = false
  for (let p = target; ; p = dirname(p)) {
    const id = fileId(p)
    if (same(id, rootId)) {
      if (!passedAllowed) throw new Error(`--out 은 리포 밖이거나 .superpowers/ 하위여야 한다: ${out} (실경로 ${target})`)
      break
    }
    if (p !== target && same(id, allowId)) passedAllowed = true
    if (dirname(p) === p) break
  }
  return target
}

function fileId(p) {
  try { const st = statSync(p); return { dev: st.dev, ino: st.ino } } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null
    throw e
  }
}

/** 존재하는 가장 가까운 조상까지 올라가 realpath 로 풀고, 아직 없는 나머지 경로를 다시 붙인다. */
function realpathOfNearest(p) {
  const rest = []
  let probe = p
  for (;;) {
    try { return join(realpathSync.native(probe), ...rest) } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    const parent = dirname(probe)
    if (parent === probe) throw new Error(`경로를 풀 수 없다: ${p}`)
    rest.unshift(basename(probe))
    probe = parent
  }
}

/** --from-raw 가 리포 기준선 자리에 쓰는 것은 운영에서 뜬 원본(meta.source === 'prod')뿐이다. */
export function checkRawSource(meta, { intoRepo }) {
  if (intoRepo && meta?.source !== 'prod') {
    throw new UsageError(`원본 출처가 '${meta?.source ?? '(없음)'}' 이다 — 운영(prod) 원본만 리포에 쓴다. 리허설 원본은 --out <dir> 로 리포 밖에`)
  }
}

/**
 * `docker ps -q -f name=…` 결과 → 'present' | 'absent' | 'unknown'. docker 가 실패하면(죽은 소켓·시간 초과·실행 불가)
 * 빈 출력이 "없다"가 아니다 — 모른다. 컨테이너(원본 세션·Config.Env 의 비밀번호)가 남았다고 보고 경고해야 한다.
 */
export function presenceOf(r) {
  if (r.error || r.signal || r.status !== 0 || typeof r.stdout !== 'string') return 'unknown'
  return r.stdout.trim() === '' ? 'absent' : 'present'
}

/** `docker container inspect -f '{{.State.Status}} {{.State.ExitCode}}'` 결과 → { status, exitCode } | null(확인 불가). */
export function containerStateOf(r) {
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null
  const m = /^([a-z]+) (-?\d+)$/.exec(r.stdout.trim())
  return m ? { status: m[1], exitCode: Number(m[2]) } : null
}

/**
 * 운영 호출 성공 판정. CLI 종료 코드만 믿지 않는다 — `docker start -a` 는 자기에게 온 SIGTERM/SIGINT 에 컨테이너보다
 * 먼저 0 으로 끝난다(CLI 29.3 실측). 컨테이너 자신이 exited·0 이어야 한다. 상태를 모르면(null) 실패.
 */
export function runSucceeded({ code, error, timedOut, state }) {
  return !error && !timedOut && code === 0 && state?.status === 'exited' && state.exitCode === 0
}

const DOCKER_CALL_TIMEOUT_MS = 10_000 // 데몬이 멎어도 이벤트 루프(벽시계)를 막지 않게.
const dockerRead = (args) => spawnSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: DOCKER_CALL_TIMEOUT_MS })
const removeContainer = (name) => spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: DOCKER_CALL_TIMEOUT_MS })
const containerRunning = (name) => presenceOf(dockerRead(['ps', '-q', '-f', `name=^${name}$`]))

/**
 * 컨테이너에 SIGINT(psql·pg_dump 모두 원본에 취소 요청을 보낸 뒤 종료) → graceMs 동안 끝나길 기다린 뒤 rm -f.
 * docker 가 답하지 않으면(unknown) 끝났다고 보지 않고 graceMs 를 다 기다린다. graceMs=0 이면 신호만 보낸다.
 * 동기 함수 — 신호 처리기에서도 쓴다. 제거 확인은 ensureRemoved 몫.
 */
export function stopContainer(name, { graceMs = 5_000 } = {}) {
  spawnSync('docker', ['kill', '-s', 'INT', name], { stdio: 'ignore', timeout: DOCKER_CALL_TIMEOUT_MS })
  if (graceMs <= 0) return
  const until = Date.now() + graceMs
  const nap = new Int32Array(new SharedArrayBuffer(4))
  while (Date.now() < until && containerRunning(name) !== 'absent') Atomics.wait(nap, 0, 0, 250)
  removeContainer(name)
}

/**
 * 컨테이너를 이름으로 먼저 만든다(동기). 이 호출이 돌아온 뒤에는 어떤 신호 처리기도 이름으로 확실히 치울 수 있다 —
 * `docker run` 은 CLI 를 띄운 뒤 데몬이 컨테이너를 만들기 전 틈에 신호가 오면 처리기의 kill/rm 이 헛돌았다.
 * --rm 은 넘기지 않는다: 끝난 뒤 컨테이너 자신의 종료 상태를 물어야 한다(runContainer). 제거는 runContainer 의 끝·신호
 * 처리기가 늘 한다.
 */
export function createContainer(args, { env }) {
  const r = spawnSync('docker', ['create', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3 * DOCKER_CALL_TIMEOUT_MS })
  return { ok: !r.error && r.status === 0, stderr: r.stderr ?? '', error: r.error }
}

/**
 * 만들어 둔 컨테이너를 `docker start -a` 로 붙어 실행하고 벽시계로 끊는다. 결과 { ok, code, timedOut, error, state, removed, stdout, stderr }.
 * - psql 은 SIGTERM 핸들러가 없어(컨테이너 PID 1 이면 커널이 SIGTERM 을 무시. SIGINT 는 psql 이 직접 처리한다)
 *   spawnSync 의 timeout(SIGTERM)으로는 멈추지 않았다. 시간이 되면 `docker kill -s INT`(취소 요청 후 종료, --init 의
 *   tini 가 넘긴다) → graceMs 뒤에도 살아 있으면 `docker rm -f` + CLI SIGKILL.
 * - `start -a` 는 받은 신호를 컨테이너로 넘긴다(--sig-proxy 옵션이 없다 — CLI 29.x). 그래서 CLI 를 자기 프로세스
 *   그룹(detached)으로 띄운다: 프로세스 그룹 전체에 온 SIGTERM/SIGHUP 이 우리 SIGINT 취소보다 먼저 psql 을 죽이지 않게.
 * - 성공은 CLI 0 만으로 정하지 않는다: 지우기 전에 `docker container inspect` 로 컨테이너 자신이 exited·0 인지 본다
 *   (runSucceeded). `start -a` 는 CLI 에 직접 온 SIGTERM/SIGINT 에 0 으로 먼저 끝나 원본 호출이 끝난 것처럼 보였다.
 *   --rm 이면 정상 종료 직후 이미 지워져 물을 수 없고, `docker wait` 은 조건 옵션이 없어 만든 직후(Created)엔 바로 0 을
 *   돌려주므로 시작 전에 걸어 둘 수 없다 — 그래서 --rm 을 빼고 아래 제거에 맡긴다.
 * - 끝날 때는 어떤 경우든(정상·CLI 비정상 사망·벽시계) stopContainer — 살아 있으면 취소부터, 그다음 제거 — 후
 *   ensureRemoved 로 제거를 확인한다. removed 가 'absent' 가 아니면 호출자가 경고하고 멈춘다.
 * - onChild 로 CLI 자식을 넘긴다(신호 처리기가 SIGKILL 하고 끝나길 기다린 뒤 이름으로 치운다).
 */
export function runContainer(name, { env, wallMs, graceMs = 10_000, onChild }) {
  return new Promise((done) => {
    const out = []
    const err = []
    let timedOut = false
    let grace
    const child = spawn('docker', ['start', '-a', name], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    onChild?.(child)
    child.stdout.on('data', (c) => out.push(c))
    child.stderr.on('data', (c) => err.push(c))
    const wall = setTimeout(() => {
      timedOut = true
      stopContainer(name, { graceMs: 0 })
      grace = setTimeout(() => {
        removeContainer(name)
        child.kill('SIGKILL')
      }, graceMs)
    }, wallMs)
    let settled = false
    const finish = (code, error) => {
      if (settled) return
      settled = true
      clearTimeout(wall)
      clearTimeout(grace)
      const state = containerStateOf(dockerRead(['container', 'inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name]))
      stopContainer(name)
      const removed = ensureRemoved(name)
      done({
        ok: runSucceeded({ code, error, timedOut, state }), code, timedOut, error, state, removed,
        stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'),
      })
    }
    child.on('error', (e) => finish(null, e))
    child.on('close', (code) => finish(code, null))
  })
}

/** 프로세스가 끝났는지(없거나 좀비) — 신호 처리기에서 동기로 기다린다. */
export function waitProcessGone(pid, { timeoutMs = 3_000 } = {}) {
  const until = Date.now() + timeoutMs
  const nap = new Int32Array(new SharedArrayBuffer(4))
  for (;;) {
    const st = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', timeout: 2_000 }).stdout?.trim() ?? ''
    if (st === '' || st.startsWith('Z')) return true
    if (Date.now() >= until) return false
    Atomics.wait(nap, 0, 0, 50)
  }
}

/**
 * 이름의 컨테이너가 (어떤 상태로든) 남아 있지 않을 때까지 rm -f — 제한 시간 안에서.
 * 'absent'(제거 확인) | 'present'(아직 있음) | 'unknown'(docker 실패 — 없어졌다고 읽지 않는다)를 돌려준다.
 */
export function ensureRemoved(name, { timeoutMs = 10_000 } = {}) {
  const until = Date.now() + timeoutMs
  const nap = new Int32Array(new SharedArrayBuffer(4))
  for (;;) {
    removeContainer(name)
    const left = presenceOf(dockerRead(['ps', '-a', '-q', '-f', `name=^${name}$`]))
    if (left === 'absent' || Date.now() >= until) return left
    Atomics.wait(nap, 0, 0, 250)
  }
}
