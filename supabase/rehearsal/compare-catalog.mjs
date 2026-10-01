// supabase/rehearsal/compare-catalog.mjs — 로컬 DB 의 두 시점(캡처 두 번)을 카탈로그·스키마 덤프로 맞대 불일치 수를 낸다.
// 롤백 리허설용: "N 적용 → 롤백" 뒤의 DB 가 "N-1 적용 직후" 와 같은지 본다. scripts/baseline-diff.mjs 는 기준선(0000·0001)만
// 대조하고 그 뒤 마이그레이션이 적용돼 있으면 멈추므로, 같은 판정 도구(CATALOG_SQL·DUMP_ARGS·diffCatalog·diffDumps·
// checkRoundTrip, 허용 잔차 0)를 임의의 두 시점에 쓰려고 둔다. CLI 가 적용하지 않는 폴더(supabase/rehearsal/)에 있다.
//
// 사용:
//   node supabase/rehearsal/compare-catalog.mjs capture <prefix>      → <prefix>.catalog.json, <prefix>.dump.sql
//   node supabase/rehearsal/compare-catalog.mjs diff <prefixA> <prefixB> → 불일치 0 이면 exit 0, 아니면 목록 + exit 1
//
// 예 — 0003 롤백 리허설(D 는 리포 밖 임시 폴더, 전용 스택이면 SUPABASE_DB_CONTAINER·LOCAL_DB_URL 을 함께 준다):
//   D=$(mktemp -d)
//   supabase db reset --version 0002 && node supabase/rehearsal/compare-catalog.mjs capture "$D/ref"
//   npm run db:reset
//   docker exec -i "$SUPABASE_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/0003_org_core_rollback.sql
//   node supabase/rehearsal/compare-catalog.mjs capture "$D/rolledback"
//   node supabase/rehearsal/compare-catalog.mjs diff "$D/ref" "$D/rolledback"     # ✓ 불일치 0
//
// 대상: 로컬만. resolveTarget('local')(LOCAL_DB_URL 또는 기본 127.0.0.1:54322)의 DSN 이 금지 ref 를 담지 않고 호스트가
// 127.0.0.1·localhost 여야 한다. 이 PC 에는 psql·pg_dump 가 없을 수 있어 그 DSN 의 DB 를 가진 로컬 컨테이너 안에서 돌린다 — DSN 의
// 사용자·DB 이름을 그대로 쓴다. 컨테이너는 dbContainer() 가 고른다: SUPABASE_DB_CONTAINER 가 있으면 그것, 없으면 DSN 이 메인
// 스택(54322)일 때만 메인 컨테이너다. 전용 스택 DSN 에 메인 컨테이너를 짝지으면 사용자 DB 의 카탈로그를 뜨므로 멈춘다(SP4 D42·K2).
// 비교가 보는 것: 정책(본문)·함수(이름·인자·secdef)·트리거 정의·RLS 표·버킷·발행 표·확장(카탈로그) + public 스키마 덤프
// (표·컬럼 순서·제약·인덱스·함수 본문·search_path·ACL). 못 보는 것: 주석(--no-comments)·소유자(--no-owner)·public 밖 객체
// (정책은 storage·realtime 까지 본다)·지운 컬럼의 pg_attribute 흔적·supabase_migrations 기록.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { CATALOG_SQL, checkRoundTrip, diffCatalog, diffDumps } from '../../scripts/lib/baseline.mjs'
import { DUMP_ARGS, catalogArgs } from '../../scripts/lib/baseline-cli.mjs'
import { assertNotForbidden, resolveTarget } from '../../scripts/lib/targets.mjs'

/** 메인 스택(사용자 데이터)의 config.toml project_id — 컨테이너 이름은 supabase_db_<project_id> 다 */
const MAIN_PROJECT_ID = 'd-flow'
/** 메인 스택 — 컨테이너 env 없이는 DSN 포트가 이것일 때만 이 컨테이너를 쓴다 */
export const MAIN_STACK = Object.freeze({ container: `supabase_db_${MAIN_PROJECT_ID}`, dbPort: '54322' })
const CONTAINER_RE = /^supabase_db_[A-Za-z0-9_.-]+$/
const USAGE = 'usage: compare-catalog.mjs capture <prefix> | diff <prefixA> <prefixB>'
const DUMP_COMPLETE = /^-- PostgreSQL database dump complete$/m

function localTarget() {
  const { dsn } = resolveTarget('local', process.env)
  assertNotForbidden(dsn)
  let url
  try { url = new URL(dsn) } catch { throw new Error(`로컬 DSN 이 URL 이 아니다: ${JSON.stringify(dsn)}`) }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`로컬 DSN 만 허용한다(127.0.0.1·localhost): ${url.protocol}//${url.hostname}`)
  }
  return { user: decodeURIComponent(url.username || 'postgres'), db: decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres') }
}

/**
 * 카탈로그를 뜰 DB 컨테이너(SP4 계획 P10). SUPABASE_DB_CONTAINER 가 비어 있지 않으면 그것(supabase_db_<project_id> 꼴만), 없으면 로컬
 * DSN(LOCAL_DB_URL, 없으면 기본 54322)이 메인 스택일 때만 메인 컨테이너. 그 밖은 throw — 전용 스택 DSN 에 메인 컨테이너를 짝짓지 않는다.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function dbContainer(env = process.env) {
  const named = env.SUPABASE_DB_CONTAINER
  if (named !== undefined && named !== '') {
    if (!CONTAINER_RE.test(named)) throw new Error(`SUPABASE_DB_CONTAINER 가 supabase_db_<project_id> 꼴이 아니다: ${JSON.stringify(named)}`)
    return named
  }
  const { dsn } = resolveTarget('local', env)
  assertNotForbidden(dsn)
  let url
  try { url = new URL(dsn) } catch { throw new Error(`로컬 DSN 이 URL 이 아니다: ${JSON.stringify(dsn)}`) }
  if (url.port === MAIN_STACK.dbPort) return MAIN_STACK.container
  throw new Error(`컨테이너를 정하지 못했다 — LOCAL_DB_URL 이 메인 스택(${MAIN_STACK.dbPort})이 아니다(포트 ${url.port || '없음'}). ` +
    '전용 스택이면 SUPABASE_DB_CONTAINER 를 준다')
}

const docker = (container, argv) => execFileSync('docker', ['exec', container, ...argv], {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
})

function capture(prefix) {
  const { user, db } = localTarget()
  const container = dbContainer()
  const catalog = JSON.parse(docker(container, ['psql', '-U', user, '-d', db, ...catalogArgs(CATALOG_SQL)]).trim())
  const dump = docker(container, ['pg_dump', '-U', user, ...DUMP_ARGS, db])
  if (!DUMP_COMPLETE.test(dump)) throw new Error('pg_dump 출력이 완결되지 않았다(끝 표식 없음)')
  writeFileSync(`${prefix}.catalog.json`, JSON.stringify(catalog, null, 1))
  writeFileSync(`${prefix}.dump.sql`, dump)
  const n = (k) => catalog[k].length
  console.log(`captured ${prefix} (${container}) — policies ${n('policies')} · functions ${n('functions')} · triggers ${n('triggers')} · ` +
    `rls_tables ${n('rls_tables')} · dump ${dump.split('\n').length} lines`)
  return 0
}

function diff(a, b) {
  const readCatalog = (p) => JSON.parse(readFileSync(`${p}.catalog.json`, 'utf8'))
  const A = readCatalog(a)
  const B = readCatalog(b)
  const cat = diffCatalog(A, B)
  for (const [k, v] of Object.entries(cat.counts)) console.log(`${k.padEnd(18)} A ${v.expected} · B ${v.actual}`)
  const ext = JSON.stringify(A.extensions) === JSON.stringify(B.extensions)
  console.log(`${'extensions'.padEnd(18)} ${ext ? '같음' : '다름'}`)
  const dump = checkRoundTrip(diffDumps(readFileSync(`${a}.dump.sql`, 'utf8'), readFileSync(`${b}.dump.sql`, 'utf8')), [], ['A', 'B'])
  console.log(`${'dump(public)'.padEnd(18)} 차이 ${dump.length}`)
  const problems = [...cat.problems, ...(ext ? [] : ['extensions 다름']), ...dump]
  if (problems.length) {
    console.error(`✗ 불일치 ${problems.length}건\n  ${problems.join('\n  ')}`)
    return 1
  }
  console.log('✓ 불일치 0')
  return 0
}

// import 될 때(테스트)는 돌지 않는다 — node 로 직접 실행할 때만(scripts/wiki-health.mjs 의 isMain 과 같은 판정, 경로는 URL 로 바꿔 비교)
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [mode, ...rest] = process.argv.slice(2)
  try {
    if (mode === 'capture' && rest.length === 1) process.exitCode = capture(rest[0])
    else if (mode === 'diff' && rest.length === 2) process.exitCode = diff(rest[0], rest[1])
    else { console.error(USAGE); process.exitCode = 2 }
  } catch (e) {
    console.error(`✗ ${e.message}`)
    process.exitCode = 1
  }
}
