// scripts/ui-capture.mjs — SP3b 캡처·눈확인 도구(스펙 D48·§3.4, 계획 판정 Q2~Q5·Q8·Q33). 로컬 레인 B 전용
// (api 54421 · db 54422 · 앱 3201, 기준 서버 3202). 하위 명령: seed · shoot · diff · axe (UI-1 이 checks·sheet 를 더한다).
// 순수 함수는 export 해 tests/scripts/ui-capture.test.ts 가 import 한다 — 최상위에서 파일·네트워크·env 를 건드리지 않는다(isMain 가드).
// Playwright 는 package.json 에 없다: `npx --yes -p playwright@1.58.2 node scripts/ui-capture.mjs …` 로 부르고 PATH 에서 찾는다.
// 주석에 설정 표·설정 RPC 이름을 따옴표로 적지 않는다(settings-writes 게이트가 원문을 센다).
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { assertNotForbidden, classifySupabaseUrl } from './lib/targets.mjs'
import { e2eBaseUrl } from './lib/e2e.mjs'

export const DEFAULT_SIZES = Object.freeze([[1440, 900], [1280, 720], [768, 1024], [390, 844]])
export const GRADES = Object.freeze(['public', 'member', 'wsAdmin', 'platformAdmin', 'duo'])
export const SINCE = Object.freeze(['b4283c0', 'UI-1', 'UI-2a', 'UI-2b', 'UI-3', 'C'])
export const TEMPLATE_VARS = Object.freeze(['pid', 'minuteId', 'topicId', 'inviteToken', 'shareToken', 'wsSlug'])
export const DIFF_THRESHOLD = 16
export const SAME_RATIO = 0.002
export const KEY_RE = /^[a-z0-9][a-z0-9-]*$/

export const fail = (m) => { console.error(`✗ ${m}`); process.exit(1) }

/**
 * 레인 B 대상 판정 — 셋 모두 로컬이고 db 54422·api 54421(같은 스택)·앱 ≠ 3000. 하나라도 어긋나면 throw.
 * resolveTarget('local') 은 LOCAL_DB_URL 이 없으면 54322(레인 A)로 넘어가므로 쓰지 않는다(스펙 §3.2).
 * @param {{ localDbUrl: string | undefined, supabaseUrl: string | undefined, appUrl: string | undefined }} input
 * @param {{ db: string, api: string }} [expect]
 */
export function laneTarget({ localDbUrl, supabaseUrl, appUrl }, expect = { db: '54422', api: '54421' }) {
  if (!localDbUrl?.trim()) throw new Error('LOCAL_DB_URL 이 없다 — 래퍼(lane-b-run.sh)로 부른다')
  for (const v of [localDbUrl, supabaseUrl, appUrl]) assertNotForbidden(v)
  let db
  try { db = new URL(localDbUrl.trim()) } catch { throw new Error('LOCAL_DB_URL 이 URL 이 아니다') }
  if (!['127.0.0.1', 'localhost'].includes(db.hostname)) throw new Error(`LOCAL_DB_URL 이 로컬이 아니다(${db.hostname})`)
  if (db.port !== expect.db) throw new Error(`LOCAL_DB_URL 포트가 ${db.port} — 레인 B DB 는 ${expect.db}`)
  if (classifySupabaseUrl(supabaseUrl, {}) !== 'local') throw new Error(`Supabase URL 이 로컬이 아니다(${JSON.stringify(supabaseUrl)})`)
  const api = new URL(String(supabaseUrl))
  if (api.port !== expect.api) throw new Error(`Supabase URL 포트가 ${api.port} — 레인 B api 는 ${expect.api}(db 와 같은 스택)`)
  const app = e2eBaseUrl(appUrl)
  return { dbUrl: localDbUrl.trim(), supabaseUrl: String(supabaseUrl).replace(/\/+$/, ''), appUrl: app }
}

/**
 * 두 RGBA 버퍼의 차이율 — 네 채널 가운데 하나라도 |차| > threshold 인 픽셀 비율. 크기가 다르면 null.
 * diff 가 이 함수의 원문을 브라우저로 보내 그 안에서 돌린다 — 바깥 식별자를 참조하지 않는다(기본값도 리터럴).
 * @param {{ width: number, height: number, data: ArrayLike<number> }} a
 * @param {{ width: number, height: number, data: ArrayLike<number> }} b
 */
export function pixelDiffRatio(a, b, threshold = 16) {
  if (a.width !== b.width || a.height !== b.height) return null
  const n = a.width * a.height
  if (a.data.length !== n * 4 || b.data.length !== n * 4) throw new Error('RGBA 길이가 크기와 맞지 않다')
  let diff = 0
  for (let i = 0; i < n * 4; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > threshold || Math.abs(a.data[i + 1] - b.data[i + 1]) > threshold
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > threshold || Math.abs(a.data[i + 3] - b.data[i + 3]) > threshold) diff++
  }
  return n === 0 ? 0 : diff / n
}

/** 가릴 선택자 → 스크린샷 style 문자열(제품 코드 무수정 — 스펙 §3.4). 선택자에 { } < 가 있으면 CSS 주입이라 거부 */
export function maskStyle(selectors) {
  const list = [...new Set(selectors)].filter(Boolean)
  for (const s of list) if (/[{}<]/.test(s)) throw new Error(`가림 선택자에 { } < 금지: ${s}`)
  return list.length ? `${list.join(', ')} { visibility: hidden !important; }` : ''
}

/** Pretendard 판정(판정 Q3) — 등록 ≥1 ∧ 로드 ≥1 ∧ 로딩 0 이면 'ok', 아니면 'fallback'(그 장은 비교하지 않는다) */
export function fontVerdict({ registered, loaded, loading }) {
  return registered >= 1 && loaded >= 1 && loading === 0 ? 'ok' : 'fallback'
}

/** @param {{ key: string, width: number, height: number, theme: string }} s */
export function shotFileName({ key, width, height, theme }) {
  if (!KEY_RE.test(key)) throw new Error(`라우트 키 형식 밖: ${key}`)
  if (!['light', 'dark'].includes(theme)) throw new Error(`테마 형식 밖: ${theme}`)
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error('크기는 정수')
  return `${key}-${width}x${height}-${theme}.png`
}

export function parseSize(s) {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(s))
  if (!m) throw new Error(`크기 형식은 WxH: ${s}`)
  return [Number(m[1]), Number(m[2])]
}

/** 하위 명령 뒤 argv → 옵션. 모르는 인자·값 밖은 throw @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ label: string | null, theme: string[], sizes: number[][], routes: string[] | null, since: string[], base: string | null, positional: string[] }} */
  const out = { label: null, theme: ['light'], sizes: DEFAULT_SIZES.map((s) => [...s]), routes: null, since: ['b4283c0'], base: null, positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} 뒤에 값이 없다`); return v }
    if (a === '--label') out.label = next()
    else if (a === '--theme') out.theme = next().split(',')
    else if (a === '--sizes') out.sizes = next().split(',').map(parseSize)
    else if (a === '--routes') out.routes = next().split(',')
    else if (a === '--since') out.since = next().split(',')
    else if (a === '--base') out.base = next()
    else if (a.startsWith('--')) throw new Error(`알 수 없는 인자: ${a}`)
    else out.positional.push(a)
  }
  for (const t of out.theme) if (!['light', 'dark'].includes(t)) throw new Error(`--theme 은 light|dark: ${t}`)
  for (const s of out.since) if (!SINCE.includes(s)) throw new Error(`--since 값 밖: ${s}`)
  if (out.label !== null && !KEY_RE.test(out.label)) throw new Error(`--label 형식 밖: ${out.label}`)
  return out
}

/** 경로 템플릿 채우기 — 알려진 변수만, 값은 URL 인코딩 */
export function fillPath(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, v) => {
    if (!TEMPLATE_VARS.includes(v)) throw new Error(`알 수 없는 경로 변수: {${v}}`)
    const x = values[v]
    if (!x) throw new Error(`경로 변수 {${v}} 의 값이 없다(시드를 먼저)`)
    return encodeURIComponent(x)
  })
}

/**
 * routes.json 형식 검사 → 문제 목록(빈 배열이면 통과). pageFiles = src/app 아래 page.tsx 의 상대 경로.
 * 규칙: 모든 page.tsx 는 어떤 행의 file 이다 / 기준선 행(since b4283c0, until 없음)의 file 은 존재한다 / 값은 닫힌 집합 /
 * 선택 필드(판정 Q35) pair = 다른 행의 키, expect·focusTargets = 비지 않은 선택자 배열, focusStart = 선택자.
 * 뒤 Phase 가 페이지를 옮기면 옛 행에 until 을, 새 행에 since 를 적는다(보충 행은 supplement: true).
 * @param {any} doc @param {string[]} pageFiles
 */
export function validateRoutes(doc, pageFiles) {
  const p = []
  if (doc?.version !== 1) p.push('version 은 1')
  const seen = new Set()
  for (const r of doc?.routes ?? []) {
    const id = r?.key ?? '(키 없음)'
    if (!KEY_RE.test(r?.key ?? '')) p.push(`${id}: 키 형식`)
    if (seen.has(r?.key)) p.push(`${id}: 키 중복`)
    seen.add(r?.key)
    if (typeof r?.path !== 'string' || !r.path.startsWith('/')) p.push(`${id}: path 는 / 로 시작`)
    for (const [, v] of String(r?.path ?? '').matchAll(/\{(\w+)\}/g)) if (!TEMPLATE_VARS.includes(v)) p.push(`${id}: 경로 변수 {${v}}`)
    if (!GRADES.includes(r?.grade)) p.push(`${id}: grade 값 밖(${r?.grade})`)
    if (!SINCE.includes(r?.since)) p.push(`${id}: since 값 밖(${r?.since})`)
    if (r?.until !== undefined && !SINCE.includes(r.until)) p.push(`${id}: until 값 밖(${r.until})`)
    if (r?.since === 'b4283c0' && !r?.until && !pageFiles.includes(r?.file)) p.push(`${id}: 없는 페이지 파일 ${r?.file}`)
    for (const s of r?.mask ?? []) if (/[{}<]/.test(s)) p.push(`${id}: 가림 선택자 ${s}`)
    if (r?.init !== undefined && (typeof r.init !== 'object' || Object.values(r.init).some((v) => typeof v !== 'string'))) p.push(`${id}: init 은 문자열 값 객체`)
    if (r?.click !== undefined && (typeof r.click !== 'string' || /[{}<]/.test(r.click))) p.push(`${id}: click 선택자`)
    // 선택 필드(판정 Q35): pair = 짝 행(옛·새 경로 — UI-2a 가 diff --pair 로 쓴다), expect = 그려져야 할 선택자, focus* = 과제 23 Tab 순회
    if (r?.pair !== undefined && (r.pair === r.key || !(doc?.routes ?? []).some((x) => x?.key === r.pair))) p.push(`${id}: pair 대상 없음(${r.pair})`)
    for (const f of ['expect', 'focusTargets']) {
      if (r?.[f] !== undefined && (!Array.isArray(r[f]) || r[f].length === 0 || r[f].some((s) => typeof s !== 'string' || /[{}<]/.test(s)))) p.push(`${id}: ${f} 선택자`)
    }
    if (r?.focusStart !== undefined && (typeof r.focusStart !== 'string' || /[{}<]/.test(r.focusStart))) p.push(`${id}: focusStart 선택자`)
  }
  for (const s of doc?.commonMask ?? []) if (/[{}<]/.test(s)) p.push(`commonMask: ${s}`)
  const listed = new Set((doc?.routes ?? []).map((r) => r?.file).filter(Boolean))
  for (const f of pageFiles) if (!listed.has(f)) p.push(`라우트 목록에 없는 페이지: ${f}`)
  return p
}

/** 문자열 → 결정적 UUID 모양(perf-baseline.mjs 의 같은 이름 함수를 복사 — 그 파일은 레인 A 과제 27 소유라 import 하지 않는다) */
export function deterministicId(seed) {
  const h = createHash('sha256').update(seed).digest('hex').slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** 'YYYY-MM-DD' + n 일 */
export function plusDays(base, n) {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** KST 오늘 'YYYY-MM-DD' — 시드의 상대 날짜와 캡처 메타의 기준 */
export function kstToday(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** @type {Record<string, (opts: ReturnType<typeof parseArgs>) => Promise<void>>} */
export const COMMANDS = {}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  const run = COMMANDS[cmd ?? '']
  if (!run) fail(`하위 명령: ${Object.keys(COMMANDS).join('|') || '(없음)'}`)
  try { await run(parseArgs(rest)) } catch (e) { fail(e instanceof Error ? e.message : String(e)) }
}
