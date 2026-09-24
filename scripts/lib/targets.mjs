// scripts/lib/targets.mjs
// DB 대상 좌표의 단일 출처. D-Flow 는 원본 리포의 사본이라 원본 DB 좌표가 곳곳에 남아 있었다 —
// 여기 금지 목록으로만 남기고, 어떤 경로로 들어온 값이든 금지 ref 를 담으면 멈춘다.
// 순수 모듈(부작용 없음) — vitest 로 검증한다.

/**
 * 이 모듈이 읽는 env 는 문자열 키 몇 개(LOCAL_DB_URL·STAGING_REF·PROD_REF)뿐이라 이 타입으로 좁힌다.
 * 기본값 `= process.env` 만 보고 매개변수 타입을 추론하면 전역 `NodeJS.ProcessEnv`(Next.js 가
 * `NODE_ENV` 를 필수로 더한다, node_modules/next/types/global.d.ts)로 넓어져 테스트가 넘기는
 * `{}`·`{ PROD_REF: '...' }` 같은 최소 객체가 전부 타입 오류가 된다(tsc --noEmit, 2026-09-24 Task 8b).
 * @typedef {Record<string, string | undefined>} EnvBag
 */

export const FORBIDDEN_REFS = Object.freeze([
  'rglfgrwwwwdqejohdnty', // 원본 리포 운영 DB
  'abtyahghvvkcriawffty', // 원본 리포 스테이징 DB
])

export const LOCAL_DSN = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// 공백·제어·서식 문자(TAB·NBSP·U+FEFF·soft hyphen·ZWSP·U+2028 …). URL 파서는 이 중 일부를 조용히 지우므로
// 값 안에 끼면 사람이 읽은 호스트와 실제로 접속하는 호스트가 달라진다.
const INVISIBLE = /[\s\p{Cc}\p{Cf}]/u
const INVISIBLE_ALL = new RegExp(INVISIBLE.source, 'gu')
const forbiddenHit = (value) => {
  const text = String(value ?? '')
  const squeezed = text.replace(INVISIBLE_ALL, '')
  return FORBIDDEN_REFS.find((r) => text.includes(r) || squeezed.includes(r))
}

/** 금지 ref 를 담은 값이면 throw — 보이지 않는 문자로 쪼갠 ref 도. 예외는 기준선 덤프의 읽기 전용 접속 하나뿐이다(SP0 스펙 2절). */
export function assertNotForbidden(value, { allowForbidden } = {}) {
  if (allowForbidden === 'readonly-baseline') return
  const hit = forbiddenHit(value)
  if (hit) throw new Error(`금지된 원본 DB 좌표(${hit}) — D-Flow 는 원본 DB 에 접속하지 않는다`)
}

/** @param {EnvBag} [env] */
export function resolveTarget(name, env = process.env) {
  if (name === 'local') {
    const dsn = env.LOCAL_DB_URL?.trim() || LOCAL_DSN
    assertNotForbidden(dsn)
    return { name, kind: 'local', dsn, ref: null }
  }
  if (name === 'staging' || name === 'prod') {
    const key = name === 'staging' ? 'STAGING_REF' : 'PROD_REF'
    const ref = env[key]?.trim()
    if (!ref) throw new Error(`${key} 미설정 — 원격 ${name} 은 아직 없다(로컬 우선 개발, SP0 스펙 1.2)`)
    assertNotForbidden(ref)
    return { name, kind: 'remote', dsn: null, ref }
  }
  throw new Error(`대상은 local|staging|prod 중 하나 (현재: ${name})`)
}

/**
 * Supabase URL 값 하나의 대상. 로컬은 엄격하다 — 값 전체에 공백·제어·서식 문자가 없고, new URL 로 파싱해
 * http(s)·userinfo 없음·호스트가 정확히 127.0.0.1 또는 localhost. 금지 ref 는 원문·압축본·파싱된 호스트 어디서든.
 * @param {EnvBag} [env]
 */
export function classifySupabaseUrl(url, env = process.env) {
  const text = String(url ?? '')
  if (!text) return 'unknown'
  let parsed = null
  try { parsed = new URL(text) } catch { /* URL 이 아니면 로컬도 아니다 */ }
  if (forbiddenHit(text) || forbiddenHit(parsed?.hostname)) return 'forbidden'
  if (INVISIBLE.test(text)) return 'unknown'
  if (parsed && ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password &&
    ['127.0.0.1', 'localhost'].includes(parsed.hostname)) return 'local'
  const prod = env.PROD_REF?.trim()
  const stg = env.STAGING_REF?.trim()
  if (prod && text.includes(prod)) return 'prod'
  if (stg && text.includes(stg)) return 'staging'
  return 'unknown'
}

/** @param {EnvBag} [env] */
export function detectEnvTarget(envText, env = process.env) {
  // [ \t]* — \s* 는 개행을 넘어 다음 줄 값을 URL 로 오인한다(원본 리포 회귀 테스트 보존).
  const url = envText.match(/^[ \t]*NEXT_PUBLIC_SUPABASE_URL[ \t]*=[ \t]*(\S*)/m)?.[1] ?? ''
  return classifySupabaseUrl(url, env)
}

/** KEY=VALUE 줄 단위 병합 — 주석·다른 키(GEMINI 등)는 그대로 둔다. */
export function mergeEnv(existing, updates) {
  const seen = new Set()
  const lines = existing.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const out = lines.map((line) => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1]
    if (key && key in updates) { seen.add(key); return `${key}=${updates[key]}` }
    return line
  })
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) out.push(`${k}=${v}`)
  return out.join('\n') + '\n'
}

export function localEnvFromStatus(statusText) {
  const kv = {}
  for (const line of statusText.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m) kv[m[1]] = m[2]
  }
  for (const k of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']) {
    if (!kv[k]) throw new Error(`supabase status 출력에 ${k} 가 없다 — supabase start 가 끝났는지 확인`)
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: kv.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: kv.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: kv.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  }
}

// dotenv(@next/env)가 키로 읽는 줄 모양 — 들여쓰기·export·`KEY: 값` 까지. 이 셋은 Next 는 읽지만 사람이 놓치기 쉬운 비정규형이다.
// 공백은 dotenv 와 같이 \s(NBSP·U+FEFF 포함)이고, 줄 끝도 dotenv 의 m 플래그처럼 외톨이 CR·U+2028·U+2029 까지 본다.
const ENV_LINE = /^(\s*)(export\s+)?([\w.-]+)(\s*=|:\s)(.*)$/
const ENV_LINE_END = /\r\n|[\n\r\u2028\u2029]/

/**
 * .env 텍스트를 한 번만 파싱한다 — 가드가 본 값과 실제로 쓰이는 값이 갈라지지 않게.
 * values: 끝 줄 우선(Next 와 같다). \r·짝 맞는 따옴표·따옴표 밖 `#` 주석을 벗긴다.
 * duplicates: 두 번 이상 나온 키(비정규형 줄 포함). problems: 비정규형 줄 { line, key, kind: indented|export|colon }.
 * @returns {{ values: EnvBag, duplicates: string[], problems: { line: number, key: string, kind: string }[] }}
 */
export function parseEnvFile(text) {
  const values = {}
  const seen = new Set()
  const duplicates = []
  const problems = []
  text.split(ENV_LINE_END).forEach((raw, i) => {
    const m = raw.match(ENV_LINE)
    if (!m) return
    const [, indent, exported, key, sep, rest] = m
    const kind = indent ? 'indented' : exported ? 'export' : sep.startsWith(':') ? 'colon' : null
    if (kind) problems.push({ line: i + 1, key, kind })
    if (seen.has(key) && !duplicates.includes(key)) duplicates.push(key)
    seen.add(key)
    const v = rest.trim()
    const quoted = v.match(/^(['"`])(.*)\1\s*(?:#.*)?$/)
    values[key] = quoted ? quoted[2] : v.replace(/#.*$/, '').trim()
  })
  return { values, duplicates, problems }
}

const ADMIN_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
// kind 는 원인 — 호출자가 원인별 처방을 낸다(forbidden·duplicate·noncanonical·missing·not-local).
const envError = (kind, message) => Object.assign(new Error(message), { kind })

/**
 * dev-bootstrap 이 createClient 에 넘길 값 — 로컬 판정을 바로 이 값에 건다. 어긋나면 kind 를 단 Error 를 throw(fail-closed).
 * 파일 전체에 금지 ref 가 없어야 하고, 두 키는 정규형으로 정확히 한 번, 비지 않아야 하며, URL 은 classifySupabaseUrl 로 local.
 */
export function localAdminEnv(text) {
  try { assertNotForbidden(text) } catch (e) { throw envError('forbidden', e.message) }
  const { values, duplicates, problems } = parseEnvFile(text)
  for (const key of ADMIN_KEYS) {
    if (duplicates.includes(key)) throw envError('duplicate', `${key} 가 두 번 이상 있다 — 어느 값이 쓰일지 모호하다`)
    const p = problems.find((x) => x.key === key)
    if (p) throw envError('noncanonical', `${key} 가 ${p.line}행에서 비정규형이다(${p.kind})`)
    if (!values[key]) throw envError('missing', `${key} 가 없다`)
  }
  const url = values.NEXT_PUBLIC_SUPABASE_URL
  if (classifySupabaseUrl(url, {}) !== 'local') throw envError('not-local', `NEXT_PUBLIC_SUPABASE_URL 이 로컬이 아니다(${JSON.stringify(url)})`)
  return { url, serviceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY }
}

/**
 * predev 판정(순수). files: Next 로더(loadEnvConfig)가 읽은 파일 [{ path, contents }], shellUrl: 로더 전 셸 값,
 * url: 로더 뒤 Next 가 실제로 쓸 값. → { verdict: forbidden|ambiguous|local|staging|prod|unknown, source }.
 * 금지 ref 는 쓰이지 않는 줄·주석이라도 읽힌 파일 어디에든 있으면 멈춘다. 한 파일에 URL 키가 둘 이상이어도 멈춘다.
 * 첫 인자를 구조분해로 받아 `@param` 이름이 그 패턴과 안 맞으면(예 bare `[env]` 만 적기) TS 가 이후 매개변수
 * 타입을 엉뚱하게 추론한다(2026-09-24 Task 8b 실측 — files 가 string 으로 잘못 좁혀짐) — 그래서 첫 인자도
 * 구조와 정확히 같은 모양으로 명시한다.
 * @param {{ files: { path: string, contents: string }[], shellUrl: string | undefined, url: string | undefined }} args
 * @param {EnvBag} [env]
 */
export function devEnvVerdict({ files, shellUrl, url }, env = process.env) {
  for (const f of files) if (forbiddenHit(f.contents)) return { verdict: 'forbidden', source: f.path }
  if (forbiddenHit(shellUrl)) return { verdict: 'forbidden', source: '셸 환경변수' }
  for (const f of files) {
    if (parseEnvFile(f.contents).duplicates.includes('NEXT_PUBLIC_SUPABASE_URL')) return { verdict: 'ambiguous', source: f.path }
  }
  // 로더는 셸 값을 덮지 않고, 파일은 읽은 순서(.env.development.local → .env.local → …)의 첫 값이 이긴다.
  const from = shellUrl !== undefined ? '셸 환경변수'
    : files.find((f) => parseEnvFile(f.contents).values.NEXT_PUBLIC_SUPABASE_URL !== undefined)?.path ?? '(없음)'
  return { verdict: classifySupabaseUrl(url, env), source: from }
}
