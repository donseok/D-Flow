// scripts/baseline-diff.mjs — 로컬 db reset 결과가 운영 기준선과 같은지 본다. 운영에 접속하지 않는다(CI db 잡에서도 돈다).
//   사전 확인  적용된 마이그레이션이 정확히 기준선(0000·0001)인지 — 아니면 대조하지 않고 멈춘다
//   카탈로그   로컬 CATALOG_SQL ↔ docs/baseline/prod-catalog.json — 정책·함수·트리거·버킷·RLS·발행, 확장은 diffExtensions 규칙
//   덤프 왕복  로컬 pg_dump ↔ 커밋된 0000_baseline.sql — 권한(ACL)·컬럼·본문. 가공 규칙이 만든 잔차만 줄 단위로 허용
//   --raw <dir>   로컬 pg_dump ↔ <dir>/dump.sql(운영 원본, 이 PC 에만 있다) — 차이 0
//   --snapshot    docs/baseline/2026-09-23-live-catalog.md 만 prod-catalog.json 에서 다시 쓴다(docker·DB 없이)
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DIFF_USAGE, DUMP_ARGS, UsageError, catalogArgs, execFailureMessage, parseDiffArgs } from './lib/baseline-cli.mjs'
import {
  CATALOG_SQL, EXTENSION_DEPS_SQL, LOCAL_PREFLIGHT_SQL, auditOutputs, baselineExtensions, baselineMigrationProblem, checkRoundTrip,
  diffCatalog, diffDumps, diffExtensions, renderLiveCatalogSnapshot, roundTripResidue,
} from './lib/baseline.mjs'

const DB_CONTAINER = 'supabase_db_d-flow'
// 멈춘 DB 가 CI 잡을 붙잡지 않게. SIGKILL 은 docker 클라이언트만 끊는다 — 컨테이너 안의 psql·pg_dump 는 끝날 때까지 남을 수
// 있다(로컬 전용 DB 라 해는 없다).
const DOCKER_TIMEOUT_MS = 180_000
const SNAPSHOT = 'docs/baseline/2026-09-23-live-catalog.md'
const DUMP_COMPLETE = /^-- PostgreSQL database dump complete$/m
const repo = (p) => new URL(`../${p}`, import.meta.url)
const readRepo = (p) => readFileSync(repo(p), 'utf8')

// process.exit 는 부르지 않는다 — 파이프(CI 로그·tee)로 나가는 큰 보고가 다 쓰이기 전에 잘린다. exitCode 를 두고 자연 종료한다.
class Fail extends Error {}

function docker(what, argv) {
  try {
    return execFileSync('docker', argv, {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: DOCKER_TIMEOUT_MS, killSignal: 'SIGKILL',
    })
  } catch (e) {
    throw new Fail(execFailureMessage(`로컬 ${what}(${DB_CONTAINER})`, e, { timeoutMs: DOCKER_TIMEOUT_MS }))
  }
}
function dbJson(what, sql) {
  const out = docker(what, ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', ...catalogArgs(sql)]).trim()
  try { return JSON.parse(out) } catch { throw new Fail(`로컬 ${what} 출력이 JSON 이 아니다(${out.length}자)`) }
}

function writeSnapshot() {
  const md = renderLiveCatalogSnapshot(JSON.parse(readRepo('docs/baseline/prod-catalog.json')))
  const audit = auditOutputs({ [SNAPSHOT]: md })
  if (audit.problems.length) throw new Fail(`스냅샷을 쓰지 않았다:\n  ${audit.problems.join('\n  ')}`)
  writeFileSync(repo(SNAPSHOT), md)
  console.log(`✓ ${SNAPSHOT}`)
  return 0
}

function compare(rawDir) {
  const image = docker('이미지 확인', ['container', 'inspect', '--format', '{{.Config.Image}}', DB_CONTAINER]).trim()
  const pre = dbJson('사전 확인', LOCAL_PREFLIGHT_SQL)
  console.log(`로컬 DB  ${pre.server} · 이미지 ${image} · 마이그레이션 ${pre.migrations.join(', ') || '없음'}`)
  const blocked = baselineMigrationProblem(pre.migrations)
  if (blocked) throw new Fail(blocked)

  const expected = JSON.parse(readRepo('docs/baseline/prod-catalog.json'))
  const baselineSql = readRepo('supabase/migrations/0000_baseline.sql')
  const actual = dbJson('카탈로그', CATALOG_SQL)
  const depends = dbJson('확장 의존', EXTENSION_DEPS_SQL)
  const dump = docker('pg_dump', ['exec', DB_CONTAINER, 'pg_dump', '-U', 'postgres', ...DUMP_ARGS, 'postgres'])
  if (!DUMP_COMPLETE.test(dump)) throw new Fail('로컬 pg_dump 출력이 완결되지 않았다(끝 표식 없음)')

  const catalog = diffCatalog(expected, actual)
  for (const [k, v] of Object.entries(catalog.counts)) console.log(`${k.padEnd(18)} 운영 ${v.expected} · 로컬 ${v.actual}`)
  const declared = baselineExtensions(baselineSql)
  const ext = diffExtensions({ declared, depends, expected: expected.extensions, actual: actual.extensions })
  console.log(`${'extensions'.padEnd(18)} 비교 ${ext.compared.join(', ')} · 운영 전용(비교 안 함) ${ext.skipped.join(', ') || '없음'}`)

  const residue = roundTripResidue(declared)
  const roundTrip = checkRoundTrip(diffDumps(baselineSql, dump), residue)
  console.log(`${'roundtrip 0000'.padEnd(18)} 허용 잔차 ${residue.reduce((n, r) => n + r.lines.length, 0)}줄 · 그 밖 차이 ${roundTrip.length}`)

  let raw = []
  if (rawDir) {
    let rawDump
    try { rawDump = readFileSync(join(rawDir, 'dump.sql'), 'utf8') } catch (e) { throw new Fail(`--raw 원본을 읽지 못했다: ${e.message}`) }
    raw = checkRoundTrip(diffDumps(rawDump, dump), [], ['운영 원본', '로컬']).map((p) => `원본 대조 ${p}`)
    console.log(`${'roundtrip raw'.padEnd(18)} 차이 ${raw.length}`)
  }

  const problems = [...catalog.problems, ...ext.problems, ...roundTrip, ...raw]
  if (problems.length) {
    console.error(`✗ 불일치 ${problems.length}건\n  ${problems.join('\n  ')}`)
    return 1
  }
  console.log('✓ 불일치 0')
  return 0
}

try {
  const args = parseDiffArgs(process.argv.slice(2))
  process.exitCode = args.snapshot ? writeSnapshot() : compare(args.rawDir)
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`✗ ${e.message}\n${DIFF_USAGE}`)
    process.exitCode = 2
  } else if (e instanceof Fail) {
    console.error(`✗ ${e.message}`)
    process.exitCode = 1
  } else {
    throw e
  }
}
