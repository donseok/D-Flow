// scripts/baseline-dump.mjs — SP0 기준선. 원본 운영 DB 스키마를 읽기 전용으로 1회 덤프한다(데이터 제외).
// 이 리포에서 원본 DB 에 접속하는 유일한 스크립트다. 재실행은 기준선을 바꾸는 행위이므로 커밋 이력으로 남긴다.
//
// 운영에 보내는 것은 딱 두 가지다 — 카탈로그 SELECT 1건(psql)과 pg_dump --schema-only 1회. 그 외 SQL 은 없다.
// 읽기 전용은 세 겹으로 건다.
//   1) 자격증명: 키체인의 읽기 롤. postgres·service_role·supabase_* 롤이면 접속 전에 멈춘다.
//   2) 세션: PGOPTIONS 로 default_transaction_read_only=on (+ 짧은 statement/lock timeout).
//      Supavisor 가 startup 옵션을 거절할 때만 옵션 없이 재시도한다 — 그때도 3) 이 남는다.
//   3) 트랜잭션: 카탈로그는 psql 한 세션 안에서 `begin … read only` → SELECT → `rollback` 으로 감싼다
//      (psql 의 여러 -c 는 같은 연결에서 순서대로 실행되므로 BEGIN 이 뒤 문장까지 유효하다. -1 은 끝에
//      COMMIT 을 붙이므로 쓰지 않는다). pg_dump 는 스스로 REPEATABLE READ, READ ONLY 트랜잭션을 연다.
//
// 비밀(DSN)은 명령행 인자에 싣지 않는다. host/user/password 로 쪼개 libpq 표준 환경변수(PGHOST·PGPASSWORD…)
// 로 docker CLI 에 넘기고, docker 에는 `-e 이름`(값 없음)만 준다 — 호스트·컨테이너 어느 ps 에도 값이 안 보인다.
// 단 dockerd 는 값을 컨테이너 Config.Env 에 담으므로, 컨테이너가 지워질 때까지(끝나면 종료 상태를 확인한 뒤 이
// 스크립트가 rm -f 하고 제거를 확인한다) 같은 사용자의 `docker inspect` 로는 보인다 — docker 소켓이 이 사용자 전용이라
// 수용한 위험이다. 그 사이 병렬 세션에서 `docker inspect` 를 돌리지 않는다.
// 출력은 가린 DSN 만, stderr 는 비밀이 든 줄을 걸러서 보인다.
// PGREQUIREAUTH 로 평문 비밀번호 인증 요청은 거절한다(가짜 풀러가 비밀번호를 받아 가지 못하게).
//
// 운영 호출이 하나 성공할 때마다 원본을 .superpowers/baseline-raw/<UTC>/ (gitignore, 0700/0600)에 즉시 저장한다.
// 가공 규칙(scripts/lib/baseline.mjs)을 고친 뒤에는 --from-raw 로 운영 재접속 없이 다시 만든다.
//
// 실행 창 동안 운영 DDL(db:apply --target prod·대시보드 스키마 편집)을 멈춘다 — pg_dump 가 public 전 테이블에
// ACCESS SHARE 락을 잡고 있어 그 뒤의 ALTER 가, 다시 그 뒤의 앱 쿼리가 줄을 선다.
//
// 사용법은 scripts/lib/baseline-cli.mjs 의 USAGE. 인자 없이·모르는 인자로 실행하면 접속하지 않고 종료(2)한다.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNotForbidden, FORBIDDEN_REFS } from './lib/targets.mjs'
import { parseDsnRef } from './lib/staging-core.mjs'
import { CATALOG_SQL, auditOutputs, buildStorageRealtimeSql, postprocessDump } from './lib/baseline.mjs'
import {
  DUMP_ARGS, PGOPTIONS, USAGE, UsageError, catalogArgs, checkRawSource, checkReaderRole, createContainer, ensureRemoved,
  parseArgs, parseDsn, runContainer, stopContainer, validateOutDir, validateRehearseHost, waitProcessGone,
} from './lib/baseline-cli.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const IMAGE = 'postgres:17'
const KEYCHAIN = 'DFlow Prod Reader'
const CUTOFF = 'wbs-web@77cf6785'
const REHEARSAL_NETWORK = 'dflow-rehearsal'
const WANTED_EXTENSIONS = new Set(['vector', 'pg_trgm', 'pgcrypto', 'uuid-ossp', 'unaccent', 'citext'])
const PATHS = {
  baseline: 'supabase/migrations/0000_baseline.sql',
  storage: 'supabase/migrations/0001_storage_realtime.sql',
  storageRollback: 'supabase/rollbacks/0001_storage_realtime_rollback.sql',
  catalog: 'docs/baseline/prod-catalog.json',
}

// 운영에 오래 머물지 않게 — 세션 옵션·psql 트랜잭션 로컬 설정(PGOPTIONS·catalogArgs, baseline-cli.mjs),
// pg_dump 락 대기, 벽시계, 신호 처리 다섯 곳. pg_dump 는 서버측 timeout 을 모두 0 으로 되돌리므로 벽시계와 신호 처리가
// pg_dump 의 상한이다.
const CATALOG_WALL_MS = 3 * 60_000
const DUMP_WALL_MS = 3 * 60_000 // 스키마만이라 수 초면 끝난다. 길게 두면 락을 쥔 채 멈춘 덤프가 오래 남는다.

let secrets = [] // 걸러낼 문자열(비밀번호·원문 DSN). 읽은 뒤에 채운다.
let rawHint = null // 원본을 저장한 뒤의 실패에는 저장 위치와 재가공 명령을 함께 보인다.
const die = (m) => {
  console.error(`✗ ${m}`)
  if (rawHint) console.error(rawHint)
  process.exit(1)
}
const fatal = (e) => die(`예기치 못한 오류: ${scrub(e?.stack ?? String(e))}`)
process.on('uncaughtException', fatal)
process.on('unhandledRejection', fatal)
// 벽시계는 이 프로세스 안에 있다 — 밖에서 node 가 신호를 받아 끝나면 컨테이너(=원본 세션, Config.Env 의 비밀번호)가
// 남는다. 처리기 순서: aborting 을 먼저 세운다(이후 어떤 원본 호출도 시작하지 않는다) → docker CLI 자식이 있으면 SIGKILL
// 하고 끝나길 기다린다(죽은 CLI 는 컨테이너를 시작할 수 없다) → 이름으로 SIGINT(원본에 취소 요청) → 잠시 뒤 rm -f,
// 남지 않았는지 확인 → 0 이 아닌 코드로 끝낸다. 동기 코드(spawnSync) 중에 온 신호는 다음 await 에서 처리되므로
// prodCall 은 컨테이너를 만들기 전·시작하기 전에 한 번씩 이벤트 루프를 돌려 쥐고 있던 신호를 먼저 받는다.
// SIGKILL 은 잡을 수 없다 — 그래서 실제 실행은 백그라운드로 돌린다(도구 timeout 이 node 를 죽이지 않게). 그래도 SIGKILL
// 로 죽었다면 끝난 컨테이너가 Config.Env 와 함께 남는다(--rm 을 쓰지 않는다 — runContainer): docker ps -a 로 보고 rm -f.
let aborting = false
let currentContainer = null
let currentChild = null
// 제거를 확인하지 못한 컨테이너(docker 가 답하지 않거나 아직 남음) — 크게 알리고 손으로 치울 명령을 준다.
const cleanupWarning = (name, left) => `⚠⚠ 컨테이너 ${name} 제거를 확인하지 못했다(${left === 'unknown' ? 'docker 가 답하지 않는다 — 남았는지 모른다' : '아직 남아 있다'}).\n` +
  `     원본 세션과 Config.Env 의 비밀번호가 남았을 수 있다. docker 가 돌아오면 직접: docker rm -f ${name}`
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }
for (const sig of Object.keys(SIGNAL_EXIT)) {
  process.on(sig, () => {
    if (aborting) return
    aborting = true
    console.error(`✗ ${sig} 수신 — ${currentContainer ? `컨테이너 ${currentContainer} 에 취소를 시도하고 제거한다` : '실행 중인 컨테이너 없음 — 원본 호출을 시작하지 않는다'}`)
    if (currentChild && currentChild.exitCode === null && currentChild.signalCode === null) {
      try { currentChild.kill('SIGKILL') } catch { /* 이미 끝났다 */ }
      waitProcessGone(currentChild.pid)
    }
    if (currentContainer) {
      stopContainer(currentContainer)
      const left = ensureRemoved(currentContainer)
      if (left !== 'absent') console.error(`  ${cleanupWarning(currentContainer, left)}`)
      console.error(`  취소가 원본에 닿았는지는 모른다 — 확인: select pid, state, xact_start from pg_stat_activity where usename = '<읽기 롤>';`)
    }
    if (rawHint) console.error(rawHint)
    process.exit(SIGNAL_EXIT[sig])
  })
}
const yieldForSignals = () => new Promise((r) => setImmediate(r))
const scrub = (text) => (text ?? '').split('\n')
  .filter((line) => !secrets.some((s) => s && line.includes(s)))
  .map((line) => line.replace(/(postgres(?:ql)?:\/\/[^:@/\s]+:)[^@\s]*@/g, '$1***@'))
  .join('\n').trim()
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { ok: !r.error && r.status === 0, stdout: r.stdout ?? '', stderr: scrub(r.stderr), error: r.error }
}

let opts
try {
  opts = parseArgs(process.argv.slice(2))
} catch (e) {
  if (!(e instanceof UsageError)) throw e
  console.error(`✗ ${e.message}\n\n${USAGE}`)
  process.exit(2)
}

// ── 오프라인 가공: 원본(raw) → 4개 파일. 운영·키체인·docker·네트워크를 쓰지 않는다 ─────────────
// 덤프 전에도 같은 파서로 부른다(when: 실패 메시지 꼬리) — 카탈로그가 깨졌으면 두 번째 원본 호출을 하지 않는다.
function extractCatalog(text, when = '') {
  const lines = text.split('\n').filter((l) => l.startsWith('{'))
  if (lines.length !== 1) die(`카탈로그 출력에서 JSON 행을 1개 기대했으나 ${lines.length}개${when}`)
  try { return JSON.parse(lines[0]) } catch (e) { return die(`카탈로그 JSON 파싱 실패: ${e.message}${when}`) }
}

function buildFromRaw(rawDir, outRoot, meta) {
  const read = (name) => {
    try { return readFileSync(join(rawDir, name), 'utf8') } catch (e) { return die(`원본 ${name} 읽기 실패: ${e.message}`) }
  }
  // 출처가 없으면 없다고 적는다(JSON.stringify 는 undefined 키를 지운다). prod 가 아니면 전부 '운영 아님'.
  const source = typeof meta?.source === 'string' && meta.source ? meta.source : 'unknown'
  const catalog = extractCatalog(read('catalog.txt'))
  const raw = read('dump.sql')
  if (!/^-- PostgreSQL database dump complete$/m.test(raw)) die('pg_dump 출력이 완결되지 않았다(끝 표식 없음) — 중단')

  const extensions = catalog.extensions.filter((e) => WANTED_EXTENSIONS.has(e.name))
  const skipped = catalog.extensions.filter((e) => !WANTED_EXTENSIONS.has(e.name))
  console.log(`카탈로그: 정책 ${catalog.policies.length} · 함수 ${catalog.functions.length} · 트리거 ${catalog.triggers.length} · ` +
    `버킷 ${catalog.buckets.length} · realtime 발행 ${catalog.publication_tables?.length ?? '(키 없음)'} · ` +
    `확장 ${extensions.map((e) => `${e.name}@${e.schema}`).join(',')}`)
  if (skipped.length) console.log(`기준선에서 뺀 확장(허용 목록 밖) ${skipped.length}개: ${skipped.map((e) => `${e.name}@${e.schema}`).join(', ')}`)

  let sql, droppedGrants, forward, rollback
  try {
    ({ sql, droppedGrants } = postprocessDump(raw, extensions))
    ;({ forward, rollback } = buildStorageRealtimeSql(catalog))
  } catch (e) {
    die(e.message)
  }
  if (droppedGrants.length) console.log(`표준 롤 밖 GRANT/REVOKE·FOR ROLE supabase_admin 기본 권한 ${droppedGrants.length}건 제거:\n  ${droppedGrants.join('\n  ')}`)

  const outputs = {
    [PATHS.baseline]:
      `-- 0000_baseline — wbs-web ${source === 'prod' ? '운영' : '운영 아님'} public 스키마(pg_dump ${meta.pgDumpVersion} --schema-only), ` +
      `출처 ${source}, 컷오프 ${meta.cutoff}, 덤프 ${meta.capturedAt}.\n` +
      `-- 생성: scripts/baseline-dump.mjs. 손으로 고치지 않는다 — 고칠 것은 scripts/lib/baseline.mjs 규칙으로.\n\n${sql}`,
    [PATHS.storage]: forward,
    [PATHS.storageRollback]: rollback,
    [PATHS.catalog]: JSON.stringify({ capturedAt: meta.capturedAt, cutoff: meta.cutoff, source, ...catalog }, null, 2) + '\n',
  }
  // postprocessDump 는 원본 덤프만 본다 — 카탈로그에서 나온 나머지까지 네 파일 모두 금지 ref·자격증명이 없어야 들인다.
  // 이 검사가 먼저다: 걸리면 이메일 보고 없이(emails.txt 도 쓰지 않고) 걸린 위치만 보이고 멈춘다(auditOutputs).
  const { problems, emails } = auditOutputs(outputs)
  if (problems.length) die(`출력 검사 ${problems.length}건 — 아무 파일도 쓰지 않았다(이메일 보고도 건너뛴다):\n  ${problems.join('\n  ')}`)

  // 이메일은 막지 않고 보고만 한다(로컬 부분 가림) — 경고 블록 + 원본 디렉터리의 emails.txt(0600). 판단은 감사 뒤에.
  const emailsPath = join(rawDir, 'emails.txt')
  writeFileSync(emailsPath, `# 기준선 출력의 이메일 주소 ${emails.length}건(로컬 부분 가림). 막지 않는 보고.\n${emails.join('\n')}${emails.length ? '\n' : ''}`, { mode: 0o600 })
  chmodSync(emailsPath, 0o600)
  if (emails.length) console.warn(`⚠ 이메일 주소 ${emails.length}건(쓰기는 막지 않는다 — 감사 대상, ${emailsPath}):\n  ${emails.join('\n  ')}`)

  for (const [path, text] of Object.entries(outputs)) {
    mkdirSync(dirname(join(outRoot, path)), { recursive: true })
    writeFileSync(join(outRoot, path), text)
  }
  console.log(`✓ ${outRoot === ROOT ? '' : `${outRoot}/ 에 `}0000_baseline.sql · 0001_storage_realtime.sql(+rollback) · docs/baseline/prod-catalog.json`)
}

if (opts.mode === 'from-raw') {
  const rawDir = resolve(opts.rawDir)
  rawHint = `  원본(raw): ${rawDir}`
  let outRoot = ROOT
  if (opts.outDir) { try { outRoot = validateOutDir(opts.outDir, ROOT) } catch (e) { die(e.message) } }
  let meta = null
  try { meta = JSON.parse(readFileSync(join(rawDir, 'meta.json'), 'utf8')) } catch (e) { die(`원본 meta.json 을 읽을 수 없다: ${e.message}`) }
  try {
    checkRawSource(meta, { intoRepo: !opts.outDir })
  } catch (e) {
    console.error(`✗ ${e.message}\n${rawHint}`)
    process.exit(2)
  }
  console.log(`재가공: ${rawDir}(출처 ${meta?.source ?? 'unknown'}) → ${outRoot} (운영 접속 없음)`)
  buildFromRaw(rawDir, outRoot, meta)
  process.exit(0)
}

// ── 1. 로컬 선행조건 (접속 없음) ───────────────────────────────────────────────
const rehearse = opts.mode === 'rehearse'
let outRoot = ROOT
if (rehearse) { try { outRoot = validateOutDir(opts.outDir, ROOT) } catch (e) { die(e.message) } }
if (!sh('docker', ['info']).ok) die('docker 에 접근할 수 없다 — colima start 후 다시')
if (!sh('docker', ['image', 'inspect', IMAGE]).ok) die(`${IMAGE} 이미지가 없다 — docker pull ${IMAGE} 후 다시(운영 접속 전 준비)`)
const verOut = sh('docker', ['run', '--rm', '--network', 'none', IMAGE, 'pg_dump', '--version'])
const ver = verOut.stdout.match(/(\d+)\./)?.[1]
if (!verOut.ok || !ver) die(`pg_dump 버전 확인 실패: ${verOut.stderr || verOut.error?.message}`)
if (Number(ver) < 17) die(`pg_dump ${ver} < 17`)
if (rehearse) {
  // 외부 경로가 없는 internal 네트워크에서만 — 실수로 운영 호스트를 넣어도 닿지 못한다.
  const net = sh('docker', ['network', 'inspect', REHEARSAL_NETWORK, '--format', '{{.Internal}}'])
  if (!net.ok) die(`리허설 네트워크 ${REHEARSAL_NETWORK} 가 없다 — docker network create --internal ${REHEARSAL_NETWORK}`)
  if (net.stdout.trim() !== 'true') die(`리허설 네트워크 ${REHEARSAL_NETWORK} 가 internal 이 아니다(Internal=${net.stdout.trim()}) — 중단`)
  console.log(`선행조건: docker ✓ · ${IMAGE} ✓ · pg_dump ${ver} ✓ · 네트워크 ${REHEARSAL_NETWORK}(internal) ✓`)
} else {
  // -w 없이 — 항목 존재만 확인하고 비밀은 읽지 않는다. 속성 출력(stdout)은 버린다.
  if (!sh('security', ['find-generic-password', '-s', KEYCHAIN]).ok) die(`키체인 항목 "${KEYCHAIN}" 이 없다`)
  console.log(`선행조건: docker ✓ · ${IMAGE} ✓ · pg_dump ${ver} ✓ · 키체인 "${KEYCHAIN}" ✓`)
}

// ── 2. 실행할 명령 (비밀은 인자에 없다 — 아래 argv 가 그대로 실행된다) ──────────
const PG_ENV_NAMES = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE', 'PGREQUIREAUTH', 'PGCONNECT_TIMEOUT', 'PGAPPNAME']
let attempt = 0
const containerName = (label) => `dflow-baseline-${process.pid}-${label}-${++attempt}`
// docker create 인자. --init: tini 가 PID 1 이 되어 신호를 psql/pg_dump 에 넘긴다(psql 이 PID 1 이면 SIGTERM 이 무시된다 —
// 핸들러가 없다). --rm 은 쓰지 않는다: 끝난 뒤 컨테이너 자신의 종료 상태를 확인하고 나서 runContainer 가 지운다.
const createArgs = (name, withOptions, bin, args) => [
  '--init', '--name', name,
  ...(rehearse ? ['--network', REHEARSAL_NETWORK] : []),
  ...[...PG_ENV_NAMES, ...(withOptions ? ['PGOPTIONS'] : [])].flatMap((n) => ['-e', n]),
  IMAGE, bin, ...args,
]
const CATALOG_ARGS = catalogArgs(CATALOG_SQL)

if (opts.mode === 'dry-run') {
  const show = (label, bin, args, wall) => {
    const name = `dflow-baseline-<pid>-${label}-1`
    const argv = createArgs(name, true, bin, args)
      .map((a) => (a.includes('\n') ? `'<CATALOG_SQL ${a.length}자>'` : /[\s'"<>]/.test(a) ? `'${a}'` : a))
    console.log(`\n[${label}] (벽시계 ${wall / 1000}s → docker kill -s INT → 10s 뒤 docker rm -f)\n` +
      `  docker create ${argv.join(' ')}\n  docker start -a '${name}'   (CLI 는 자기 프로세스 그룹 — 그룹 신호가 psql 로 넘어가지 않게)\n` +
      `  끝나면: docker container inspect 로 컨테이너 자신이 exited 0 인지 확인(CLI 종료 코드만 믿지 않는다) → rm -f → 제거 확인`)
  }
  console.log('\n[dry-run] 접속하지 않는다. --execute 시 아래 명령을 이 순서로 돌린다.')
  console.log('  환경: PGHOST/PGPORT/PGUSER/PGDATABASE ← 키체인 DSN · PGPASSWORD=*** · PGSSLMODE=require · PGREQUIREAUTH=scram-sha-256,md5')
  console.log('        PGCONNECT_TIMEOUT=15 · PGAPPNAME=dflow-baseline-dump')
  console.log(`        PGOPTIONS='${PGOPTIONS}'`)
  console.log(`  접속 전 검사: ref == ${FORBIDDEN_REFS[0].slice(0, 4)}…(운영) · 롤이 postgres/service_role/supabase_* 아님 · 쿼리 파라미터는 sslmode=require 만`)
  show('catalog', 'psql', CATALOG_ARGS, CATALOG_WALL_MS)
  show('dump', 'pg_dump', DUMP_ARGS, DUMP_WALL_MS)
  console.log('\n  startup 옵션 거절 시에만: 같은 명령에서 -e PGOPTIONS 를 빼고 1회 재시도(경고 출력).')
  console.log('  카탈로그 출력이 JSON 1행으로 읽히지 않으면 덤프를 시작하지 않는다(두 번째 원본 호출 없음).')
  console.log('  SIGINT/SIGTERM/SIGHUP 수신 시: 새 원본 호출 금지 → CLI SIGKILL·대기 → 컨테이너에 kill -s INT → 최대 5s 대기 → rm -f 확인 → 비정상 종료.')
  console.log('  docker 가 답하지 않아 컨테이너 제거를 확인하지 못하면: docker rm -f <이름> 과 pg_stat_activity 확인을 안내하고 비정상 종료.')
  console.log('  가공 뒤 금지 ref·자격증명 검사가 먼저 — 걸리면 이메일 보고 없이 중단. 통과하면 이메일 주소는 막지 않고 보고(emails.txt, 로컬 부분 가림).')
  console.log('  원본은 호출마다 즉시 저장: .superpowers/baseline-raw/<UTC>/{meta.json,catalog.txt,dump.sql} (0700/0600)')
  console.log('  가공 뒤 네 출력 모두 금지 ref·자격증명 패턴(JWT·Bearer·sk_/sbp_·URL userinfo 등) 검사 — 하나라도 있으면 아무것도 쓰지 않는다.')
  console.log(`  가공 성공 후에만 기록: ${Object.values(PATHS).join(' · ')}`)
  console.log('  실행 창 동안 운영 DDL(db:apply --target prod·대시보드 스키마 편집) 금지.')
  console.log('\n✓ dry-run 끝 — 운영 접속 없음')
  process.exit(0)
}

// ── 3. 자격증명 검사 (여기서 처음 비밀을 읽는다) ────────────────────────────────
let dsn
if (rehearse) {
  dsn = process.env.BASELINE_REHEARSE_DSN?.trim()
  if (!dsn) die('BASELINE_REHEARSE_DSN 이 없다')
} else {
  const kc = spawnSync('security', ['find-generic-password', '-s', KEYCHAIN, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (kc.error || kc.status !== 0) die(`키체인 "${KEYCHAIN}" 읽기 실패`)
  dsn = kc.stdout.trim()
}
let conn
try { conn = parseDsn(dsn) } catch (e) { die(e.message) }
secrets = [dsn, conn.password, conn.rawPassword]
try {
  checkReaderRole(conn.user)
  if (rehearse) {
    assertNotForbidden(dsn)
    validateRehearseHost(conn.host)
  } else {
    if (parseDsnRef(dsn) !== FORBIDDEN_REFS[0]) throw new Error(`키체인 "${KEYCHAIN}" 가 운영 ref 를 가리키지 않는다`)
    assertNotForbidden(dsn, { allowForbidden: 'readonly-baseline' })
  }
} catch (e) {
  die(e.message)
}
console.log(`읽기 원본: ${conn.display} (${rehearse ? '리허설 · ' : ''}읽기 롤 · 읽기 전용 트랜잭션)`)

// 부모 셸의 PG* 가 섞이지 않게 비우고 우리 값만 넣는다. 비밀이 든 pgEnv 는 docker create 에만 준다(start 는 baseEnv).
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && k !== 'BASELINE_REHEARSE_DSN'))
const pgEnv = {
  ...baseEnv,
  PGHOST: conn.host,
  PGPORT: conn.port,
  PGUSER: conn.user,
  PGPASSWORD: conn.password,
  PGDATABASE: conn.database,
  PGSSLMODE: conn.sslmode,
  // 평문(password) 요청은 거절. 풀러가 다른 방식을 쓰면 접속이 실패한다(fail-closed).
  PGREQUIREAUTH: 'scram-sha-256,md5',
  PGCONNECT_TIMEOUT: '15',
  PGAPPNAME: 'dflow-baseline-dump',
  PGOPTIONS,
}

// ── 4. 원본 저장 위치 (운영 호출이 성공할 때마다 즉시 쓴다) ─────────────────────
const capturedAt = new Date().toISOString()
const rawDir = rehearse
  ? join(outRoot, 'raw')
  : join(ROOT, '.superpowers', 'baseline-raw', capturedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'))
const meta = { capturedAt, cutoff: CUTOFF, pgDumpVersion: ver, source: rehearse ? 'rehearsal' : 'prod', sessionOptions: null }
function saveRaw(name, text) {
  const path = join(rawDir, name)
  writeFileSync(path, text, { mode: 0o600 })
  chmodSync(path, 0o600)
}
function openRawDir() {
  mkdirSync(rawDir, { recursive: true, mode: 0o700 })
  chmodSync(rawDir, 0o700)
  if (!rehearse) chmodSync(dirname(rawDir), 0o700)
  rawHint = `  원본(raw) 보관: ${rawDir}`
  console.log(`원본 저장 위치: ${rawDir}`)
}

// Supavisor 가 startup 옵션을 거절한 경우의 메시지만 재시도 사유로 인정한다. 그 밖의 실패는 전부 중단(fail-closed).
const OPTION_REJECTED = /invalid command-line argument|unrecognized configuration parameter|(unsupported|unknown|invalid|not supported|not allowed)[^\n]*(startup|options?\b)|(startup param\w*|\boptions?\b)[^\n]*(unsupported|not supported|not allowed|rejected)/i
let withOptions = true
const readerCheck = () => `  select pid, state, xact_start from pg_stat_activity where usename = '${conn.user.split('.')[0]}';`
// rawName: 성공한 출력은 제거 확인보다 먼저 원본에 저장한다 — 뒤에서 멈춰도 다시 운영에 붙지 않게.
async function prodCall(label, bin, args, wallMs, rawName) {
  for (;;) {
    // 동기 구간(preflight·키체인·이전 호출 정리) 동안 쥐고 있던 신호를 여기서 받는다 — 받았으면 만들지도 않는다.
    await yieldForSignals()
    if (aborting) die(`${label}: 신호를 받아 원본 호출을 시작하지 않는다`)
    const name = containerName(label)
    currentContainer = name
    const created = createContainer(createArgs(name, withOptions, bin, args), { env: pgEnv })
    if (!created.ok) {
      const left = ensureRemoved(name)
      die(`${label}: docker create 실패 — 중단\n${scrub(created.stderr) || created.error?.message || '(stderr 없음)'}` +
        (left === 'absent' ? '' : `\n  ${cleanupWarning(name, left)}`))
    }
    // 만든 뒤, 시작하기 전 — create 중에 온 신호면 처리기가 이름으로 지우고 끝낸다(시작되지 않는다).
    await yieldForSignals()
    if (aborting) die(`${label}: 신호를 받아 원본 호출을 시작하지 않는다`)
    const r = await runContainer(name, { env: baseEnv, wallMs, onChild: (child) => { currentChild = child } })
    currentChild = null
    currentContainer = null
    const stderr = scrub(r.stderr)
    if (r.ok) saveRaw(rawName, r.stdout)
    // docker 가 답하지 않아 제거를 확인하지 못했으면 성공이어도 여기서 멈춘다 — 다음 원본 호출(재시도·덤프)을 하지 않는다.
    if (r.removed !== 'absent') die(`${label}: ${cleanupWarning(name, r.removed)}\n  세션이 남았는지 확인:\n${readerCheck()}`)
    if (r.ok) {
      if (stderr) console.error(`  (${label} stderr)\n${stderr}`)
      return r.stdout
    }
    if (r.timedOut) {
      die(`${label}: ${wallMs / 1000}s 초과 — SIGINT 로 취소를 시도하고 컨테이너를 제거했다(취소가 원본에 닿았는지는 모른다). 세션이 남았는지 확인:\n` +
        readerCheck())
    }
    if (withOptions && OPTION_REJECTED.test(stderr)) {
      console.warn(`⚠ ${label}: 풀러가 startup 옵션(PGOPTIONS)을 거절했다 — 옵션 없이 1회 재시도한다.\n` +
        '  읽기 전용은 읽기 롤 + 트랜잭션(psql begin…read only / pg_dump READ ONLY)으로 유지된다.\n' +
        `  거절 메시지: ${stderr.split('\n').find((l) => OPTION_REJECTED.test(l))}`)
      withOptions = false
      continue
    }
    // CLI 가 0 이어도 컨테이너가 exited 0 이 아니면 여기로 온다(start -a 에 직접 온 SIGTERM/SIGINT 등).
    const state = r.state ? `${r.state.status} ${r.state.exitCode}` : '확인 불가'
    die(`${label} 실패 — 중단 (CLI 종료 ${r.code ?? r.error?.code ?? '없음'} · 컨테이너 ${state})\n${stderr || r.error?.message || '(stderr 없음)'}`)
  }
}

// ── 5. 원본 읽기 (카탈로그 1건 → 스키마 덤프 1회) ──────────────────────────────
mkdirSync(dirname(rawDir), { recursive: true, mode: 0o700 })
openRawDir()
const catalogText = await prodCall('catalog', 'psql', CATALOG_ARGS, CATALOG_WALL_MS, 'catalog.txt')
saveRaw('meta.json', JSON.stringify({ ...meta, sessionOptions: withOptions }, null, 2) + '\n')
// 덤프 전에 가공 때와 같은 파서로 — 성공처럼 보여도 출력이 비었거나 잘렸으면 운영에 두 번째로 붙지 않는다.
extractCatalog(catalogText, ' — 덤프를 시작하지 않는다(두 번째 원본 호출 없음)')
await prodCall('dump', 'pg_dump', DUMP_ARGS, DUMP_WALL_MS, 'dump.sql')
saveRaw('meta.json', JSON.stringify({ ...meta, sessionOptions: withOptions }, null, 2) + '\n')
rawHint += `\n  재가공(운영 재접속 없음): node scripts/baseline-dump.mjs --from-raw ${rawDir}${rehearse ? ` --out ${outRoot}` : ''}`
secrets = [] // 원본 호출 끝. 이후로는 비밀이 필요 없다.
console.log(`원본 저장: ${rawDir}/{meta.json,catalog.txt,dump.sql}${withOptions ? '' : ' (PGOPTIONS 없이 — 세션 read_only 미적용)'}`)

// ── 6. 가공 → 검사 → 기록 (여기까지 전부 성공해야 파일을 쓴다) ────────────────────
buildFromRaw(rawDir, outRoot, { ...meta, sessionOptions: withOptions })
