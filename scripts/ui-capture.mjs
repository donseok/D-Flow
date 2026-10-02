// scripts/ui-capture.mjs — SP3b 캡처·눈확인 도구(스펙 D48·§3.4, 계획 판정 Q2~Q5·Q8·Q33). 로컬 레인 B 전용
// (api 54421 · db 54422 · 앱 3201, 기준 서버 3202·3203 — C-port). 하위 명령: seed · shoot · diff · axe · checks · sheet(뒤 둘은 UI-1 이 이어 고침 — 판정 Q28).
// 순수 함수는 export 해 tests/scripts/ui-capture.test.ts 가 import 한다 — 최상위에서 파일·네트워크·env 를 건드리지 않는다(isMain 가드).
// Playwright 는 package.json 에 없다: `npx --yes -p playwright@1.58.2 node scripts/ui-capture.mjs …` 로 부르고 PATH 에서 찾는다.
// 주석에 설정 표·설정 RPC 이름을 따옴표로 적지 않는다(settings-writes 게이트가 원문을 센다).
// DB·세션 클라이언트와 앱 주소는 laneEnv 한 곳에서만 만든다(UI-0 안전 리뷰 P2-2) — 원문 검사 테스트가 그 밖의 생성을 막는다.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { assertNotForbidden, classifySupabaseUrl, localAdminEnv, parseEnvFile } from './lib/targets.mjs'
import { localAppUrl, localClientEnv, pageProblems, redactInviteTokens } from './lib/e2e.mjs'
import { PROJECT_TOGGLE_IDS, SCRIPT_SCHEMA_VERSION } from './lib/settings-consts.mjs'
import { BOOTSTRAP_MODULE_IDS } from './lib/bootstrap-modules.mjs'

export const DEFAULT_SIZES = Object.freeze([[1440, 900], [1280, 720], [768, 1024], [390, 844]])
export const GRADES = Object.freeze(['public', 'member', 'wsAdmin', 'platformAdmin', 'duo'])
export const SINCE = Object.freeze(['b4283c0', 'UI-1', 'UI-2a', 'UI-2b', 'UI-3', 'C'])
export const TEMPLATE_VARS = Object.freeze(['pid', 'minuteId', 'topicId', 'inviteToken', 'shareToken', 'wsSlug'])
export const DIFF_THRESHOLD = 16
/** 행의 prefs 로 덮을 수 있는 계정 키 — 서버값이 이겨서 화면 조작·init 으로 못 만드는 상태만(과제 37) */
export const ROW_PREF_KEYS = Object.freeze(['sidebarCollapsed'])
export const SAME_RATIO = 0.002
export const KEY_RE = /^[a-z0-9][a-z0-9-]*$/

export const fail = (m) => { console.error(`✗ ${m}`); process.exit(1) }

/** 레인 B 앱 포트(C-port) — 머리 3201, 기준 서버 3202·3203. 3000(사용자·Codex)·3001(Next 자동)·3101·3102(레인 A)는 목록 밖이다 */
export const LANE_APP_PORTS = Object.freeze(['3201', '3202', '3203'])

/**
 * 앱 주소 판정(순수, UI-0 안전 리뷰 P2-1) — 로컬(127.0.0.1·localhost) ∧ 포트 ∈ LANE_APP_PORTS ∧ 경로·검색어 없음. 끝 슬래시는 뗀다.
 * 로컬 스택들은 같은 서명 키를 써서 레인 B 세션이 다른 레인의 앱 서버 인증도 통과한다 — 포트가 유일한 분리선이다.
 * @param {string | null | undefined} value
 */
export function laneAppUrl(value) {
  const url = localAppUrl(value)
  const u = new URL(url)
  if (!LANE_APP_PORTS.includes(u.port)) throw new Error(`앱 포트 ${u.port || '(없음)'} — 레인 B 앱 포트는 ${LANE_APP_PORTS.join('·')} 뿐이다(C-port)`)
  if (u.pathname !== '/' || u.search || u.hash) throw new Error(`앱 주소에 경로·검색어를 붙이지 않는다: ${url}`)
  return url
}

/**
 * 레인 B 대상 판정 — 셋 모두 로컬이고 db 54422·api 54421(같은 스택)·앱 포트 허용 목록. 하나라도 어긋나면 throw.
 * targets.mjs 의 로컬 기본 대상 해석은 LOCAL_DB_URL 이 없으면 54322(레인 A)로 넘어가므로 쓰지 않는다(스펙 §3.2).
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
  const app = laneAppUrl(appUrl)
  return { dbUrl: localDbUrl.trim(), supabaseUrl: String(supabaseUrl).replace(/\/+$/, ''), appUrl: app }
}

/** --base 판정(순수, C-port) — 없으면 그 실행의 앱 주소(머리 3201), 있으면 laneAppUrl 과 같은 허용 목록을 거친다.
 *  @param {string | null | undefined} base @param {{ appUrl: string }} target */
export function resolveBase(base, target) {
  return base === null || base === undefined ? target.appUrl : laneAppUrl(base)
}

/**
 * 두 RGBA 버퍼의 차이(D1) — 네 채널 가운데 하나라도 |차| > threshold 인 픽셀의 비율·수·영역(bbox). 크기가 다르면 null.
 * diff 가 이 함수의 원문을 브라우저로 보내 그 안에서 돌린다 — 바깥 식별자를 참조하지 않는다(기본값도 리터럴).
 * @param {{ width: number, height: number, data: ArrayLike<number> }} a
 * @param {{ width: number, height: number, data: ArrayLike<number> }} b
 * @returns {{ ratio: number, diffPixels: number, bbox: { x: number, y: number, w: number, h: number } | null } | null}
 */
export function pixelDiffStats(a, b, threshold = 16) {
  if (a.width !== b.width || a.height !== b.height) return null
  const w = a.width
  const n = a.width * a.height
  if (a.data.length !== n * 4 || b.data.length !== n * 4) throw new Error('RGBA 길이가 크기와 맞지 않다')
  let diff = 0
  let x0 = w
  let y0 = a.height
  let x1 = -1
  let y1 = -1
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (Math.abs(a.data[i] - b.data[i]) > threshold || Math.abs(a.data[i + 1] - b.data[i + 1]) > threshold
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > threshold || Math.abs(a.data[i + 3] - b.data[i + 3]) > threshold) {
      diff++
      const x = p % w
      const y = (p - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return { ratio: n === 0 ? 0 : diff / n, diffPixels: diff, bbox: diff ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null }
}

/** 차이율만(옛 계약 — 과제 1 테스트·이웃 도구). 브라우저로는 pixelDiffStats 를 보낸다 */
export function pixelDiffRatio(a, b, threshold = 16) {
  return pixelDiffStats(a, b, threshold)?.ratio ?? null
}

/** 선택자 목록 → 선택자마다 규칙 하나(D8). 한 목록 규칙은 무효 선택자 하나에 규칙 전체가 버려져(CSS 규정) 그 행의 가림이 다 꺼졌다.
 *  선택자에 { } < 가 있으면 CSS 주입이라 거부 @param {string[]} selectors @param {string} decl @param {string} what */
function perSelectorRules(selectors, decl, what) {
  const list = [...new Set(selectors)].filter(Boolean)
  for (const s of list) if (/[{}<]/.test(s)) throw new Error(`${what} 선택자에 { } < 금지: ${s}`)
  return list.map((s) => `${s} { ${decl} }`).join('\n')
}

/** 가릴 선택자 → 스크린샷 style 문자열(제품 코드 무수정 — 스펙 §3.4). 자리를 남기는 visibility:hidden, 선택자마다 규칙 하나 */
export function maskStyle(selectors) {
  return perSelectorRules(selectors, 'visibility: hidden !important;', '가림')
}

/** 숨길 선택자 → display:none, 선택자마다 규칙 하나. 폭이 실행마다 바뀌어 이웃을 미는 표시(오른쪽 정렬 줄 끝의 갱신 시각처럼)는
 *  visibility 가림으로는 밀림이 남는다 — 레이아웃에서 뺀다(제품 코드 무수정, C-hide) */
export function hideStyle(selectors) {
  return perSelectorRules(selectors, 'display: none !important;', '숨김')
}

/** 한 장의 가림·숨김 선택자(순수, D8) — 공통 가림·행 가림·행 숨김 순, 종류 안에서 중복 제거(행 가림에 공통 가림과 같은 것은 뺀다)
 *  @param {{ commonMask?: string[] }} doc @param {{ mask?: string[], hide?: string[] }} r @returns {{ sel: string, kind: 'common' | 'mask' | 'hide' }[]} */
export function shotSelectors(doc, r) {
  const common = [...new Set(doc.commonMask ?? [])]
  const mask = [...new Set(r.mask ?? [])].filter((s) => !common.includes(s))
  const hide = [...new Set(r.hide ?? [])]
  return [...common.map((sel) => ({ sel, kind: 'common' })), ...mask.map((sel) => ({ sel, kind: 'mask' })), ...hide.map((sel) => ({ sel, kind: 'hide' }))]
}

/** 한 장의 스크린샷 style(순수 조립, D15) — 공통·행 가림은 visibility, 행 숨김은 display, 규칙은 선택자마다 */
export function shotStyle(doc, r) {
  const sels = shotSelectors(doc, r)
  return [maskStyle(sels.filter((s) => s.kind !== 'hide').map((s) => s.sel)), hideStyle(sels.filter((s) => s.kind === 'hide').map((s) => s.sel))].filter(Boolean).join('\n')
}

/** 선택자별 일치 수 → 기록·경고(순수, D8). 행 가림·숨김이 0 이면 경고(낡은 선택자 — C-hide 대로 실패는 아니다), 무효(-1)면 문제,
 *  공통 가림 0 은 기록만(그 장치가 없는 화면이 있다) @param {{ sel: string, kind: string }[]} sels @param {number[]} counts */
export function maskReport(sels, counts) {
  if (sels.length !== counts.length) throw new Error('가림 선택자 수와 일치 수 목록의 수가 다르다')
  return {
    counts: Object.fromEntries(sels.map((s, i) => [s.sel, counts[i]])),
    zero: sels.filter((s, i) => s.kind !== 'common' && counts[i] === 0).map((s) => s.sel),
    invalid: sels.filter((s, i) => counts[i] < 0).map((s) => s.sel),
  }
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
  /** @type {{ label: string | null, theme: string[], sizes: number[][], routes: string[] | null, since: string[], base: string | null, serverCommit: string | null, allowCross: boolean, pair: boolean, scroll: number, javaScript: boolean, positional: string[] }} */
  const out = { label: null, theme: ['light'], sizes: DEFAULT_SIZES.map((s) => [...s]), routes: null, since: ['b4283c0'], base: null, serverCommit: null, allowCross: false, pair: false, scroll: 0, javaScript: true, positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} 뒤에 값이 없다`); return v }
    if (a === '--label') out.label = next()
    else if (a === '--theme') out.theme = next().split(',')
    else if (a === '--sizes') out.sizes = next().split(',').map(parseSize)
    else if (a === '--routes') out.routes = next().split(',')
    else if (a === '--since') out.since = next().split(',')
    else if (a === '--base') out.base = next()
    else if (a === '--server-commit') out.serverCommit = next()     // --base 서버를 띄운 트리(D3)
    else if (a === '--pair') out.pair = true                       // diff — 머리 라벨의 pair 행을 기준 라벨의 짝 행과 비교(옛 경로 ↔ 새 경로)
    else if (a === '--allow-cross') out.allowCross = true           // diff — 판·시드가 다른 라벨의 참고 대조(D3)
    else if (a === '--scroll') {                                    // shoot — main 을 그만큼 스크롤한 뒤 찍는다(고정 요소 확인, D54)
      const v = next()
      if (!/^\d+$/.test(v)) throw new Error(`--scroll 은 0 이상의 정수(px): ${v}`)
      out.scroll = Number(v)
    } else if (a === '--js') {                                      // shoot — off 면 JS 를 끈 컨텍스트(첫 페인트 — D55)
      const v = next()
      if (v !== 'on' && v !== 'off') throw new Error(`--js 는 on|off: ${v}`)
      out.javaScript = v === 'on'
    }
    else if (a.startsWith('--')) throw new Error(`알 수 없는 인자: ${a}`)
    else out.positional.push(a)
  }
  for (const t of out.theme) if (!['light', 'dark'].includes(t)) throw new Error(`--theme 은 light|dark: ${t}`)
  for (const s of out.since) if (!SINCE.includes(s)) throw new Error(`--since 값 밖: ${s}`)
  if (out.label !== null && !KEY_RE.test(out.label)) throw new Error(`--label 형식 밖: ${out.label}`)
  // 위치 인자는 라벨이다(diff 의 기준·대상, UI-1 sheet 의 추가 라벨) — 산출 폴더 아래 경로가 되므로 같은 형식만(UI-0 안전 리뷰 P3-2)
  for (const p of out.positional) if (!KEY_RE.test(p)) throw new Error(`위치 인자(라벨) 형식 밖: ${p}`)
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

/** 행의 클릭 단계 — clicks(여러 단계, 컨트롤러 보충 1)가 있으면 그 순서, 없으면 click 하나(하위 호환) */
export function clickSteps(r) {
  if (Array.isArray(r?.clicks)) return [...r.clicks]
  return typeof r?.click === 'string' && r.click ? [r.click] : []
}

/**
 * routes.json 형식 검사 → 문제 목록(빈 배열이면 통과). pageFiles = src/app 아래 page.tsx 의 상대 경로.
 * 규칙: 모든 page.tsx 는 어떤 행의 file 이다 / 기준선 행(since b4283c0, until 없음)의 file 은 존재한다 / 값은 닫힌 집합 /
 * 선택 필드(판정 Q35) pair = 다른 행의 키, expect·focusTargets = 비지 않은 선택자 배열, focusStart = 선택자.
 * baseFinal(UI-2a) = 기준 서버(--base, 옛 경로가 아직 페이지인 착수점)에서 그 행이 기대하는 최종 경로 — expectFinal 은 머리(스텁을 거친 새 경로)의 값이다.
 * hide(과제 5) = 비지 않은 선택자 배열 — 폭이 실행마다 바뀌는 표시를 레이아웃에서 뺀다(mask 는 자리를 남기고 가린다).
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
    if (r?.baseFinal !== undefined && (typeof r.baseFinal !== 'string' || !r.baseFinal.startsWith('/') || /[<]/.test(r.baseFinal))) p.push(`${id}: baseFinal 경로`)
    if (r?.click !== undefined && (typeof r.click !== 'string' || /[{}<]/.test(r.click))) p.push(`${id}: click 선택자`)
    if (r?.clicks !== undefined && (!Array.isArray(r.clicks) || r.clicks.length === 0 || r.clicks.some((s) => typeof s !== 'string' || !s || /[{}<]/.test(s)))) p.push(`${id}: clicks 선택자`)
    if (r?.clicks !== undefined && r?.click !== undefined) p.push(`${id}: click 과 clicks 를 같이 쓰지 않는다`)
    if (r?.prefs !== undefined && (typeof r.prefs !== 'object' || r.prefs === null || Array.isArray(r.prefs) || Object.entries(r.prefs).some(([k, v]) => !ROW_PREF_KEYS.includes(k) || typeof v !== 'boolean'))) p.push(`${id}: prefs 는 ${ROW_PREF_KEYS.join('·')} 의 불리언 객체`)
    // 선택 필드(판정 Q35): pair = 짝 행(옛·새 경로 — UI-2a 가 diff --pair 로 쓴다), expect = 그려져야 할 선택자, focus* = 과제 23 Tab 순회
    if (r?.pair !== undefined && (r.pair === r.key || !(doc?.routes ?? []).some((x) => x?.key === r.pair))) p.push(`${id}: pair 대상 없음(${r.pair})`)
    for (const f of ['expect', 'focusTargets', 'hide']) {
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

export const SEED_ACCOUNTS = Object.freeze({
  platformAdmin: 'ui-platform@example.com', wsAdmin: 'ui-wsadmin@example.com', member: 'ui-member@example.com', duo: 'ui-duo@example.com',
})
export const SEED_PROJECT = 'UI-CAPTURE'
export const SEED_WS_B = Object.freeze({ slug: 'ui-capture-b', name: '캡처 B 워크스페이스' })
/** 시드 초대(seedPlan 의 invite.email)의 도메인 — 워크스페이스 A 의 초대 허용 도메인에 있어야 초대 화면이 수락 가능한 카드다(과제 5b) */
export const SEED_INVITE_DOMAIN = 'example.com'
export const LEVEL_LABELS_4 = Object.freeze(['단계', '작업', '활동', '세부'])
const TEAM_DEFS = [['PLN', '기획', '#4f46e5'], ['DSG', '설계', '#0276a8'], ['DEV', '개발', '#7c3aed'], ['QAS', '품질', '#a65b00'], ['OPS', '운영', '#0f766e']]
const FENCE = '`'.repeat(3)
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

/** shoot·seed 가 같은 값을 계산한다 — pid 로 유도되는 로컬 합성 값 — 산출물에는 가린다(redactTokens, UI-0 안전 리뷰 P3-1) */
export function seedIds(projectId) {
  return {
    minuteId: deterministicId(`ui-capture:${projectId}:minute:1`),
    minute2Id: deterministicId(`ui-capture:${projectId}:minute:2`),
    topicId: deterministicId(`ui-capture:${projectId}:wiki:1`),
    inviteToken: deterministicId(`ui-capture:${projectId}:invite`),
    shareToken: deterministicId(`ui-capture:${projectId}:share`),
  }
}

/**
 * 1단계 잎의 일정 [시작 오프셋, 끝 오프셋, 실적%](오늘 = 0) — 간트 첫 화면 표본(UI-0 충실도 리뷰 P2-2). 첫 화면은 1~14행이고 날짜 창은
 * 1440 오늘 ±15일·1280 −12~+11·768 −7~+6·390 −3~+3 이다(ui0 PNG 실측) — 가장 좁은 390 창에 완료(1.1.2·1.2.5)·지연(1.1.3·1.2.4)·
 * 진행(1.1.4·1.2.3)·오늘 마감(1.2.1) 막대가 함께 든다. 진행 표본은 어느 요일에 시드해도 실적 ≥ 계획(영업일 계획%)이다(1.1.4 계획 ≤ 40%,
 * 1.2.3 ≤ 20%). 2·3단계는 아래 일반식 그대로다(주 경로·좌석·오늘 마감 2.1.3 등).
 */
const PHASE1_SCHEDULE = Object.freeze({
  '1.1.1.1': [-24, -20, 100], '1.1.1.2': [-21, -17, 100], '1.1.1.3': [-18, -14, 100],   // 접힌 분리 부모의 세부(첫 화면 밖)
  '1.1.2': [-8, -1, 100], '1.1.3': [-10, -2, 40], '1.1.4': [-1, 5, 60], '1.1.5': [-6, -6, 100],
  '1.2.1': [-3, 0, 60], '1.2.2': [1, 6, 0], '1.2.3': [0, 6, 30], '1.2.4': [-6, -1, 40], '1.2.5': [-7, -2, 100],
  '1.3.1': [2, 7, 0], '1.3.2': [4, 9, 0], '1.3.3': [6, 11, 0], '1.3.4': [8, 13, 0], '1.3.5': [-12, -6, 40], '1.3.6': [-2, -2, 0],
})
/**
 * 이정표 잎의 산출물 — 앱은 wbs_items.milestone 이 아니라 '이름 키워드 ∨ 단일일 + 산출물'(milestoneTimeline)로 이정표를 그린다(UI-0 충실도
 * 리뷰 P2-1: 플래그만 둔 시드는 감지 0건이었다). 이름은 바꾸지 않는다 — 다른 화면 글자가 그대로다. 완료(1.1.5)·기한 지남(1.3.6)·예정(2.3.5)
 */
const MILESTONE_DELIVERABLES = Object.freeze({ '1.1.5': '착수 보고서', '1.3.6': '중간 점검표', '2.3.5': '설계 승인서' })
/** 3×3×5 뒤에 더한 잎 — 담당 팀 순환(잎 순서 i % 5)에서 빼서 뒤 잎의 팀이 밀리지 않게 한다 */
const EXTRA_LEAVES = Object.freeze(['1.3.6'])

/**
 * 결정적 시드 행(순수) — 같은 ctx 면 같은 행. 날짜는 ctx.today(KST) 상대값이라 캡처 쌍은 같은 KST 날짜 안에 찍는다.
 * WBS: 3단계 × 3작업 × 5활동 + 1.3 의 이정표 잎 1.3.6 + 1.1.1 아래 세부 3 = 61행(깊이 4). 모든 행 is_owner_split=false 인데
 * 세부 1.1.1.3 하나만 true(분리 부모 접힘 표본). 1단계 일정은 PHASE1_SCHEDULE, 이정표는 MILESTONE_DELIVERABLES.
 * 에이전트 좌석 1(판정 Q34): 잎 2.2.5 만 tags ['agent'] + 점유·막힘 주문 하나 — 좌석 상태 BLOCKED 는 경과 시간과 무관하다(감시자 행은 두지 않는다 — 생존 창 70분).
 * @param {{ today: string, projectId: string, wsA: string, memberIds: { member: string, duo: string, wsAdmin: string }, users: { wsAdmin: string } }} ctx
 */
export function seedPlan(ctx) {
  const { today, projectId: pid } = ctx
  const id = (k) => deterministicId(`ui-capture:${pid}:${k}`)
  const ids = seedIds(pid)
  const teams = TEAM_DEFS.map(([code, name, color], i) => ({ id: id(`team:${code}`), workspace_id: ctx.wsA, project_id: pid, code, name, color, sort_order: i + 1 }))
  const wbs = []
  let sort = 0
  const row = (code, name, parentId, level, extra = {}) => {
    const r = { id: id(`wbs:${code}`), project_id: pid, parent_id: parentId, code, name, level_idx: level, sort_order: ++sort, deliverable: null,
      planned_start: null, planned_end: null, weight: null, actual_pct: null, milestone: false, is_owner_split: false, assignee_member_id: null, tags: null, ...extra }
    wbs.push(r)
    return r
  }
  const leaf = (code, name, parentId, level, p, t, a) => {
    const fixed = PHASE1_SCHEDULE[code]
    const start = fixed ? plusDays(today, fixed[0]) : plusDays(today, -40 + (p - 1) * 25 + (t - 1) * 8 + (a - 1))
    const end = fixed ? plusDays(today, fixed[1]) : plusDays(start, 3)
    const pct = fixed ? fixed[2] : end < plusDays(today, -2) ? 100 : start <= today && today <= end ? 50 : 0
    const extra = { planned_start: start, planned_end: end, weight: 1, actual_pct: pct,
      assignee_member_id: a === 1 ? ctx.memberIds.member : a === 2 ? ctx.memberIds.duo : null }
    if (code === '2.1.3') Object.assign(extra, { planned_start: plusDays(today, -2), planned_end: today, actual_pct: 60 })   // 오늘 마감
    if (code === '2.2.5') Object.assign(extra, { planned_start: plusDays(today, -2), planned_end: plusDays(today, 3), actual_pct: 50, tags: ['agent'] })   // 진행 · 에이전트 좌석(판정 Q34)
    if (code === '2.3.5') Object.assign(extra, { planned_start: plusDays(today, 5), planned_end: plusDays(today, 5), actual_pct: 0 })
    if (MILESTONE_DELIVERABLES[code]) Object.assign(extra, { deliverable: MILESTONE_DELIVERABLES[code], milestone: true })
    return row(code, name, parentId, level, extra)
  }
  for (let p = 1; p <= 3; p++) {
    const ph = row(`${p}`, `${p}단계 ${['준비', '구축', '전환'][p - 1]}`, null, 0)
    for (let t = 1; t <= 3; t++) {
      const tk = row(`${p}.${t}`, `${['요구 정리', '화면 설계', '데이터 이관'][t - 1]} ${p}-${t}`, ph.id, 1)
      for (let a = 1; a <= (p === 1 && t === 3 ? 6 : 5); a++) {
        const code = `${p}.${t}.${a}`
        const act = leaf(code, `활동 ${code}`, tk.id, 2, p, t, a)
        if (code === '1.1.1') {
          act.weight = null; act.actual_pct = null; act.assignee_member_id = null
          for (let d = 1; d <= 3; d++) {
            const det = leaf(`1.1.1.${d}`, `세부 1.1.1.${d}`, act.id, 3, 1, 1, d)
            if (d === 3) det.is_owner_split = true
          }
        }
      }
    }
  }
  // 부모 날짜 = 자식 범위(뒤에서 앞으로 — 자식이 먼저 채워진다)
  for (const r of [...wbs].reverse()) {
    const kids = wbs.filter((k) => k.parent_id === r.id && k.planned_start)
    if (kids.length && r.weight === null) {
      r.planned_start = kids.map((k) => k.planned_start).sort()[0]
      r.planned_end = kids.map((k) => k.planned_end).sort().at(-1)
    }
  }
  const leaves = wbs.filter((r) => r.weight === 1 && !EXTRA_LEAVES.includes(r.code))
  const owners = leaves.map((r, i) => ({ wbs_item_id: r.id, team_id: teams[i % 5].id, kind: 'primary' }))
  for (const r of wbs.filter((x) => EXTRA_LEAVES.includes(x.code))) owners.push({ wbs_item_id: r.id, team_id: teams[0].id, kind: 'primary' })
  const supportOf = wbs.find((r) => r.code === '2.2.2')
  owners.push({ wbs_item_id: supportOf.id, team_id: teams[4].id, kind: 'support' })
  const byCode = (c) => wbs.find((r) => r.code === c).id
  const chain = ['2.1.1', '2.1.2', '2.1.3', '2.2.1']
  const deps = chain.slice(1).map((c, i) => ({ id: id(`dep:${i}`), project_id: pid, predecessor_id: byCode(chain[i]), successor_id: byCode(c) }))
  // 좌석 1(판정 Q34) — 점유(claimed) + 막힘(blocked). 그 잎의 진척 칸은 점유 중 편집이 막힌다(0011 guard_workflow_actual)
  const seatAt = `${plusDays(today, -1)}T09:00:00+09:00`
  const agentOrder = { id: id('order:1'), project_id: pid, wbs_item_id: byCode('2.2.5'), status: 'claimed', instructions: '캡처 표본 — 선행 확인 대기',
    claimed_by: 'ui-capture-host', claimed_by_user_id: ctx.users.wsAdmin, claimed_at: seatAt, last_heartbeat_at: seatAt,
    heartbeat_phase: 'blocked', heartbeat_agent: 'ui-capture-agent', heartbeat_note: '선행 확인 대기' }
  const issues = [
    ['로그인 화면 응답 지연', 'open', 'high'], ['일정표 인쇄 여백', 'in_progress', 'medium'], ['권한 안내 문구 누락', 'resolved', 'low'],
    ['첨부 미리보기 실패', 'on_hold', 'medium'], ['주간 보고 합계 오차', 'open', 'low'],
  ].map(([title, status, severity], i) => ({ id: id(`issue:${i}`), project_id: pid, title, body: `${title} — 캡처 표본`, status, severity }))
  const announcements = [
    ['분기 점검 일정 안내', 'important', true], ['회의실 변경', 'general', false], ['워크숍 참가 신청', 'event', false],
  ].map(([title, category, is_pinned], i) => ({ id: id(`ann:${i}`), project_id: pid, title, body: `${title} 본문`, category, is_pinned, created_by: ctx.users.wsAdmin }))
  const meetings = [
    { id: id('meeting:1'), project_id: pid, title: '주간 점검', meeting_date: today, start_time: '10:00', end_time: '11:00', category: 'routine', created_by: ctx.users.wsAdmin, created_by_name: 'ui-wsadmin' },
    { id: id('meeting:2'), project_id: pid, title: '설계 검토', meeting_date: plusDays(today, 7), start_time: '14:00', end_time: '15:30', category: 'review', created_by: ctx.users.wsAdmin, created_by_name: 'ui-wsadmin' },
  ]
  const attendees = meetings.flatMap((m) => [ctx.memberIds.member, ctx.memberIds.duo].map((member_id) => ({ meeting_id: m.id, member_id, project_id: pid })))
  const attendance = [['work', -2], ['remote', -1], ['annual', 0]].map(([type, off], i) => ({ id: id(`att:${i}`), project_id: pid, member_id: ctx.memberIds.member, date: plusDays(today, off), type }))
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  const weeklyReport = { id: id('weekly:1'), project_id: pid, week_start: plusDays(today, -((dow + 6) % 7)) }
  // SP4 A1(스펙 D53·§3.2) — 주간 행은 영역(project_areas kind='weekly_section') id 로 묶인다. 옛 구분 '구축'·'전환' 을 영역 code·name 으로,
  // 옛 모듈 '화면'·'데이터' 는 내용이 있는 칸의 첫 줄 머리표 [모듈] 로 옮긴다(이관 규칙과 같은 꼴 — 캡처 화면의 정보가 줄지 않게).
  const weeklyAreas = [['구축', 1], ['전환', 2]].map(([code, sort_order], i) => ({
    id: id(`weekly-area:${i + 1}`), project_id: pid, kind: 'weekly_section', code, name: code, sort_order, active: true,
  }))
  const weeklyRows = [
    // this_issue/next_issue 도 표가 NOT NULL 이다. PostgREST 다중 insert 는 빠진 키를 기본값이 아니라 명시적 NULL 로
    // 채운다(열 목록은 행들의 키 합집합이다) — 두 행의 키 집합이 달라지면 없는 쪽이 NOT NULL 위반으로 죽는다.
    // area_kind 는 어느 행에도 싣지 않는다(합집합 밖이라 기본값 'weekly_section' 이 들어간다 — 영역 FK 의 셋째 열).
    { id: id('weekly-row:1'), report_id: weeklyReport.id, project_id: pid, area_id: weeklyAreas[0].id,
      this_content: '[화면]\n목록 화면 초안', this_issue: '', next_content: '[화면]\n상세 화면', next_issue: '' },
    { id: id('weekly-row:2'), report_id: weeklyReport.id, project_id: pid, area_id: weeklyAreas[1].id,
      this_content: '[데이터]\n이관 규칙 정리', this_issue: '[데이터]\n원천 누락 3건', next_content: '[데이터]\n시험 이관', next_issue: '' },
  ]
  const wikiBody = '# 배포 절차\n\n1. 변경 요약을 공유한다\n2. 점검 창에 배포한다\n'
  const wikiTopic = { id: ids.topicId, project_id: pid, title: '배포 절차', normalized_title: '배포 절차' }
  const wikiRevision = { id: id('wiki-rev:1'), topic_id: ids.topicId, project_id: pid, version_no: 1, title: '배포 절차', body_md: wikiBody, body_hash: sha256(wikiBody), document_kind: 'overview' }
  const invite = { id: id('invite:1'), workspace_id: ctx.wsA, project_id: pid, email: 'ui-invitee@example.com', access_role: 'member',
    token_hash: sha256(ids.inviteToken), created_by: ctx.users.wsAdmin, expires_at: `${plusDays(today, 7)}T00:00:00Z` }
  const runner = { id: id('runner:1'), name: 'ui-capture-runner', owner_user_id: ctx.users.wsAdmin, token_prefix: 'uic_', token_hash: sha256(`ui-capture:${pid}:runner`),
    expires_at: `${plusDays(today, 365)}T00:00:00Z`, project_id: pid }
  const body1 = ['# 설계 검토 회의', '', '## 결정', '- 배포 창은 목요일 오후로 한다', '', `${FENCE}mermaid`, 'flowchart LR', '  A[요청] --> B[검토] --> C[배포]', FENCE, '',
    '| 항목 | 담당 | 기한 |', '|---|---|---|', '| 배포 스크립트 | 개발 | 금요일 |', '', `${FENCE}ts`, "export const window = 'thu-pm'", FENCE, ''].join('\n')
  const body2 = '# 주간 점검\n\n- 지연 항목 두 건을 확인했다\n'
  const minutes = [
    { id: ids.minuteId, date: plusDays(today, -1), team: 'DSG', title: '설계 검토 회의', body: body1 },
    { id: ids.minute2Id, date: plusDays(today, -8), team: 'PLN', title: '주간 점검 회의', body: body2 },
  ]
  return { teams, wbs, owners, deps, issues, announcements, meetings, attendees, attendance, weeklyAreas, weeklyReport, weeklyRows, wikiTopic, wikiRevision, invite, runner, agentOrder, minutes }
}

/** 비밀번호를 재설정할 계정 — 시드 계정 넷만. 부트스트랩 관리자면 throw(판정 Q4) */
export function resetTargets(grades, bootstrapEmail) {
  return grades.map((grade) => {
    const email = SEED_ACCOUNTS[grade]
    if (!email) throw new Error(`시드 계정이 아닌 등급: ${grade}`)
    if (bootstrapEmail && email.toLowerCase() === String(bootstrapEmail).trim().toLowerCase()) throw new Error('부트스트랩 관리자의 비밀번호는 바꾸지 않는다')
    return { grade, email }
  })
}

/** 공지 읽음 워터마크를 지울 계정(순수) — 캡처 계정 넷, 등급 순서 고정. 그 실행이 쓰는 등급과 무관하게 늘 넷이다(공개 화면만 찍는 실행도
 *  다음 실행의 시작 상태를 같게 둔다). 부트스트랩 관리자는 넣지 않는다 — 겹치면 throw(resetTargets 와 같은 가드, 판정 Q4)
 *  @param {string | undefined} bootstrapEmail @returns {{ grade: string, email: string }[]} */
export function seenResetTargets(bootstrapEmail) {
  return resetTargets(Object.keys(SEED_ACCOUNTS), bootstrapEmail)
}

/**
 * 워크스페이스 A 의 초대 허용 도메인 patch(순수) — 쓸 키·값, 쓸 것이 없으면 null(과제 5 권고 2).
 * 제품 기본값 [] 은 초대 불가라 시드 초대가 '사용할 수 없는 초대' 카드로 찍혔다. 값이 없거나 명시 [] 이면 그 도메인 하나, 다른 도메인이
 * 있으면 지우지 않고 뒤에 더한다. 이미 있거나(대소문자·앞뒤 공백 무관) 전체 허용(* 단독)이면 null — 쓰지 않아 이력 행을 늘리지 않는다.
 * 문자열 목록이 아니거나 * 가 다른 항목과 섞인 값(손상 — 해석기가 무효로 본다)은 덮지 않고 멈춘다.
 * @param {Record<string, unknown> | null | undefined} values @param {string} [domain] @returns {Record<string, string[]> | null}
 */
export function inviteDomainPatch(values, domain = SEED_INVITE_DOMAIN) {
  const key = 'invites.allowed_domains'
  const want = domain.trim().toLowerCase()
  const cur = (values ?? {})[key]
  if (cur === undefined) return { [key]: [want] }
  if (!Array.isArray(cur) || cur.some((d) => typeof d !== 'string')) throw new Error(`워크스페이스 A 의 ${key} 가 문자열 목록이 아니다(손상) — 덮지 않는다`)
  const norm = cur.map((d) => d.trim().toLowerCase())
  if (norm.includes('*')) {
    if (norm.length === 1) return null
    throw new Error(`워크스페이스 A 의 ${key} 에 * 가 다른 항목과 섞였다(손상) — 덮지 않는다`)
  }
  return norm.includes(want) ? null : { [key]: [...cur, want] }
}

/** 캡처 조건(스펙 §3.4) — 새 컨텍스트마다 같은 값. javaScript === false 만 JS 를 끈다(D55 첫 페인트 — 그 밖에는 키를 더하지 않아 기본 조건 그대로)
 *  @param {{ width: number, height: number, theme: string, javaScript?: boolean }} s */
export function contextOptions({ width, height, theme, javaScript }) {
  return { viewport: { width, height }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', colorScheme: theme, ...(javaScript === false ? { javaScriptEnabled: false } : {}) }
}

/** 비교 조건 — 늘 같아야 하는 것(날짜·브라우저)과 판·시드의 정체(--allow-cross 참고 대조로만 다를 수 있다, D3) */
export const META_HARD = Object.freeze(['kstDate', 'seedDate', 'browser'])
export const META_CROSS = Object.freeze(['scriptCommit', 'routesSha256', 'seedProjectId'])

/**
 * 두 라벨이 비교 가능한가 → { problems, warnings }(problems 가 비면 비교한다). KST 날짜·시드 날짜·브라우저가 다르면 늘 거부.
 * 스크립트 판(가림·시작 상태 규칙)·routes.json 해시·시드 프로젝트가 다르면 거부 — allowCross(참고 대조)면 경고로 낮춘다(D3: 같은 날 다른
 * db:reset 시드·다른 가림 판이 조용히 비교됐다). 두 라벨의 서버 빌드 id 가 같으면 경고 — 기준·머리 비교라면 같은 서버를 두 번 찍었다.
 * @param {any} a @param {any} b @param {{ allowCross?: boolean }} [opt]
 */
export function compareMeta(a, b, { allowCross = false } = {}) {
  const msg = (k) => `${k} 다름: ${a?.[k]} ≠ ${b?.[k]}`
  const problems = META_HARD.filter((k) => a?.[k] !== b?.[k]).map(msg)
  const cross = META_CROSS.filter((k) => a?.[k] !== b?.[k]).map(msg)
  const warnings = []
  if (allowCross) warnings.push(...cross.map((m) => `참고 대조(--allow-cross): ${m}`))
  else problems.push(...cross)
  if (a?.buildId && a.buildId === b?.buildId) warnings.push(`두 라벨의 서버 빌드 id 가 같다(${a.buildId}) — 기준·머리 비교라면 같은 서버를 두 번 찍었다(자기 결정성 확인이면 정상)`)
  return { problems, warnings }
}

/**
 * 라우트 고르기 — --routes 가 있으면 그 키만, 없으면 since 집합 안의 행(until 이 집합에 들면 뺀다).
 * JSDoc 이 없으면 TS 호출부의 콜백 인자가 암묵 any 가 된다(allowJs, checkJs 없음).
 * @template {{ key: string, since: string, until?: string, tags?: string[] }} R
 * @param {{ routes: R[] }} doc @param {{ routes: string[] | null, since: string[] }} sel @returns {R[]}
 */
export function selectRoutes(doc, { routes, since }) {
  if (routes) {
    const miss = routes.filter((k) => !doc.routes.some((r) => r.key === k))
    if (miss.length) throw new Error(`routes.json 에 없는 키: ${miss.join(',')}`)
    return doc.routes.filter((r) => routes.includes(r.key))
  }
  // tags 에 'manual' 이 든 행은 키로 지정할 때만 찍는다 — 앞선 손질(설정 손상 등)이 있어야 의미가 있는 장
  return doc.routes.filter((r) => since.includes(r.since) && !(r.until && since.includes(r.until)) && !(Array.isArray(r.tags) && r.tags.includes('manual')))
}

/** 한 장의 픽셀 판정(D1) — 글꼴 무효는 비교 제외, 크기 다름, 0 이면 same, SAME_RATIO(판정 Q33 의 0.2%) 이하는 near(볼 목록에 오른다 —
 *  배지 숫자·칩 하나·한 단어 같은 실제 변화가 이 문턱 아래였다), 넘으면 diff */
export function diffVerdict({ ratio, fontA, fontB }) {
  if (fontA !== 'ok' || fontB !== 'ok') return 'skip-font'
  if (ratio === null || ratio === undefined) return 'skip-size'
  if (ratio === 0) return 'same'
  return ratio <= SAME_RATIO ? 'near' : 'diff'
}

/** 알려진 잡음(허용 목록 — 표시만, 판정은 바꾸지 않는다) */
export const KNOWN_NOISE = Object.freeze([
  { key: 'p-agents', width: 768, height: 1024, note: '위임 표 sticky 머리글 아래 테두리 1px 스냅(과제 5 — T5-R6, 0.18% 안팎)' },
])

/** 최종 경로의 모양 — 시드 id(uuid)·자리표시·옛 가림 표기를 하나로(시드가 다른 참고 대조에서도 같은 화면이면 같다) */
const finalShape = (p) => String(p ?? '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{id}').replace(/\{[A-Za-z]+\}|<token>/g, '{id}')
const shotAt = (r) => ({ key: r.key, width: r.width, height: r.height, theme: r.theme })
const sameShot = (x, y) => x.key === y.key && x.width === y.width && x.height === y.height && x.theme === y.theme

/** diff 의 행 매칭(순수, D11·D15) — 둘 다 있는 쌍·대상에만(added → new)·기준에만(missing — 부분 실행이 빠진 장을 같음처럼 숨기지 않는다)
 *  @template {{ key: string, width: number, height: number, theme: string }} R @param {R[]} A @param {R[]} B */
export function diffRows(A, B) {
  return {
    pairs: B.flatMap((b) => { const a = A.find((x) => sameShot(x, b)); return a ? [{ at: shotAt(b), a, b }] : [] }),
    added: B.filter((b) => !A.some((x) => sameShot(x, b))),
    missing: A.filter((a) => !B.some((x) => sameShot(x, a))),
  }
}

/**
 * 한 쌍의 판정(순수, D2) — 어느 쪽이든 problems·idle 거짓·최종 경로(모양) 다름이면 'problem'(사유와 함께 — 같은 이유로 둘 다 엉뚱한 화면이면
 * 픽셀이 같아도 같음이 아니다), 아니면 픽셀 판정(diffVerdict). 알려진 잡음은 near·diff 에 표시만 한다.
 * ignoreFinal(UI-2a) = 최종 경로 비교를 건너뛴다 — 옛 경로 ↔ 새 경로 짝 비교, 또는 기준 서버(옛 경로가 페이지)와 머리(스텁을 거친 새 경로)처럼 다름이 기대인 쌍.
 * 각자의 기대 최종 경로는 찍을 때 finalProblem(expectFinal·baseFinal)이 이미 판정해 problems 에 남는다.
 * @param {{ a: any, b: any, stats: { ratio: number, diffPixels: number, bbox: any } | null }} p @param {{ ignoreFinal?: boolean }} [opt]
 */
export function rowVerdict({ a, b, stats }, { ignoreFinal = false } = {}) {
  const reasons = [...(a.problems ?? []).map((x) => `기준:${x}`), ...(b.problems ?? []).map((x) => `대상:${x}`),
    ...(a.idle === false ? ['기준:idle=false'] : []), ...(b.idle === false ? ['대상:idle=false'] : []),
    ...(!ignoreFinal && finalShape(a.finalPath) !== finalShape(b.finalPath) ? [`finalPath 다름: ${a.finalPath} ≠ ${b.finalPath}`] : [])]
  const ratio = stats?.ratio ?? null
  const verdict = reasons.length ? 'problem' : diffVerdict({ ratio, fontA: a.font, fontB: b.font })
  const noise = KNOWN_NOISE.find((k) => k.key === b.key && k.width === b.width && k.height === b.height)
  return { ...shotAt(b), file: b.file, ratio, diffPixels: stats?.diffPixels ?? null, bbox: stats?.bbox ?? null, verdict, reasons,
    ...(noise && (verdict === 'near' || verdict === 'diff') ? { known: noise.note } : {}) }
}

/** 짝 비교 계획(순수) — pair 를 가진 행과 그 짝 행 키. diff --pair 가 머리 라벨의 행 장을 기준 라벨의 짝 행 장과 비교한다(옛 경로 ↔ 새 경로)
 *  @param {{ key: string, pair?: string }[]} rows @param {{ routes: { key: string }[] }} doc */
export function pairPlan(rows, doc) {
  const keys = new Set(doc.routes.map((r) => r.key))
  return rows.flatMap((r) => (r.pair && keys.has(r.pair) ? [{ key: r.key, pairKey: r.pair }] : []))
}

/** diff --pair 의 행 매칭(순수) — 머리 라벨의 pair 행마다 기준 라벨의 짝 행(같은 크기·테마)을 찾는다. 짝 장이 없으면 unmatched(볼 목록에 new 로 오른다 —
 *  짝이 빠진 채 같음처럼 숨기지 않는다). pair 가 없는 머리 행은 이 비교의 대상이 아니다
 *  @param {any[]} A @param {any[]} B @param {{ key: string, pairKey: string }[]} plan */
export function pairRows(A, B, plan) {
  const pairs = []
  const unmatched = []
  for (const { key, pairKey } of plan) {
    for (const b of B.filter((x) => x.key === key)) {
      const a = A.find((x) => x.key === pairKey && x.width === b.width && x.height === b.height && x.theme === b.theme)
      if (a) pairs.push({ label: `${key}⇐${pairKey}`, a, b })
      else unmatched.push({ label: `${key}⇐${pairKey}`, b })
    }
  }
  return { pairs, unmatched }
}

const LOOK_ORDER = ['problem', 'diff', 'missing', 'new', 'near']
const pctOf = (r) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(2)}%`)

/** diff 의 집계(순수, D1·D15) — 판정별 수와 '볼 목록'(problem → diff → missing → new → near, 같은 판정 안에서는 차이율 큰 순) */
export function summarizeDiff(rows) {
  const count = (v) => rows.filter((r) => r.verdict === v).length
  const look = rows.filter((r) => LOOK_ORDER.includes(r.verdict))
    .sort((x, y) => LOOK_ORDER.indexOf(x.verdict) - LOOK_ORDER.indexOf(y.verdict) || (y.ratio ?? -1) - (x.ratio ?? -1))
    .map((r) => `${r.key}@${r.width}x${r.height}/${r.theme} ${r.verdict} ${pctOf(r.ratio)}${r.reasons?.length ? ` ${r.reasons.join(' · ')}` : ''}${r.known ? ` (알려진 잡음: ${r.known})` : ''}`)
  return { compared: rows.length, same: count('same'), near: count('near'), diff: count('diff'), problem: count('problem'), missing: count('missing'),
    new: count('new'), skipped: rows.filter((r) => String(r.verdict).startsWith('skip')).length, look }
}

/** 최종 경로 판정(순수, D2) — expectFinal 이 있으면 경로+검색어가 그 값, 없으면 채운 경로의 pathname 이 기대값. 다르면 'final:<실제>'.
 *  권한 거부 리디렉션(agents → /projects 등)·로그인 튕김(세션 만료)이 문제로 남지 않던 것을 잡는다 @param {URL} actual */
export function finalProblem(r, values, actual, { base = false } = {}) {
  // base = 기준 서버(--base) 실행 — 그 서버는 옛 경로가 아직 페이지라 baseFinal 이 있으면 그 값이 기대(없으면 expectFinal 과 같다)
  const expectFinal = base && r.baseFinal ? r.baseFinal : r.expectFinal
  const got = expectFinal ? actual.pathname + actual.search : actual.pathname
  const want = expectFinal ? fillPath(expectFinal, values) : new URL(fillPath(r.path, values), 'http://x').pathname
  return got === want ? null : `final:${actual.pathname + actual.search}`
}

/** 서버 빌드 id(순수, D3) — 앱 HTML 의 /_next/static/<id>/_buildManifest.js 또는 RSC 머리 { "b": <id>, "p": … }(HTML 안에서는 이스케이프). 없으면 null */
export function buildIdOf(html) {
  const text = String(html)
  const m = /\/_next\/static\/([\w-]{6,})\/_(?:buildManifest|ssgManifest)\.js/.exec(text) ?? /\\?"b\\?":\\?"([\w-]{6,})\\?",\\?"p\\?":/.exec(text)
  return m ? m[1] : null
}

/** 서버 커밋(순수, D3) — 플래그 > env > 스크립트 HEAD. --base(기준 서버) 실행은 플래그·env 가 없으면 거부(머리 커밋을 서버 정체로 적지 않는다)
 *  @param {{ explicitBase: boolean, envCommit?: string, flagCommit?: string | null, head: string }} s */
export function serverCommitOf({ explicitBase, envCommit, flagCommit, head }) {
  const flag = (flagCommit ?? '').trim()
  const env = (envCommit ?? '').trim()
  const given = flag || env
  if (explicitBase && !given) throw new Error('--base 실행은 서버 커밋이 필요하다 — --server-commit <sha> 또는 UI_CAPTURE_SERVER_COMMIT(기준 서버를 빌드한 트리)')
  if (given && !/^[0-9a-f]{7,40}$/.test(given)) throw new Error(`서버 커밋 형식 밖(7~40자 16진): ${given}`)
  return given ? { commit: given, source: flag ? 'flag' : 'env' } : { commit: head, source: 'head' }
}

/** LLM 키 이름(값은 다루지 않는다) — 있으면 회의록 첫 방문 self-heal 이 외부 LLM 결과를 DB 에 써 다음 실행부터 화면이 달라진다(D9) */
export const LLM_KEYS = Object.freeze(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'LLM_API_KEY'])

/** 결정성 전제(순수, D9) — 사용 기록 수집이 켜지면(USAGE_TRACKING=on, VERCEL_ENV=production) 방문마다 기록이 쌓여 사용 현황 화면이 실행마다
 *  달라진다 → 거부. LLM 키는 이름만 기록. 프로세스 env 가 .env.local 보다 앞선다(Next) @param {string} envText @param {Record<string, string | undefined>} env */
export function envPremise(envText, env) {
  const file = parseEnvFile(envText).values
  const val = (k) => String(env[k] ?? file[k] ?? '').trim()
  const problems = [
    ...(val('USAGE_TRACKING') === 'on' ? ['USAGE_TRACKING=on — 방문마다 사용 기록이 쌓여 사용 현황 화면이 실행마다 달라진다'] : []),
    ...(val('VERCEL_ENV') === 'production' ? ['VERCEL_ENV=production — 사용 기록 수집이 켜진다(그 밖의 운영 분기도)'] : []),
  ]
  return { problems, llmKeys: LLM_KEYS.filter((k) => val(k) !== '') }
}

/** @type {Record<string, (opts: ReturnType<typeof parseArgs>) => Promise<void>>} */
export const COMMANDS = {}

/**
 * 좌표·클라이언트의 한 곳(UI-0 안전 리뷰 P2-2) — cwd 는 레인 B 워크트리(래퍼). 검사(laneTarget) 뒤에만 만든다:
 * db = service_role 클라이언트(검사한 바로 그 URL), sessionClient(jar) = 앱과 같은 @supabase/ssr 쿠키 항아리의 anon 클라이언트,
 * baseUrl = 그 실행이 찍는 앱 서버(--base 는 resolveBase 의 허용 목록을 거친다). 키는 로컬 스택 사이에 같아 대상을 가르지 못하므로
 * 두 스크립트의 다른 곳은 클라이언트를 만들지 않고 이 결과만 쓴다(원문 검사 테스트).
 * @param {{ base?: string | null }} [sel]
 */
export function laneEnv({ base = null } = {}) {
  const envText = readFileSync('.env.local', 'utf8')
  const admin = localAdminEnv(envText)
  const target = laneTarget({ localDbUrl: process.env.LOCAL_DB_URL, supabaseUrl: admin.url, appUrl: process.env.NEXT_PUBLIC_APP_URL })
  const outDir = process.env.UI_CAPTURE_OUT_DIR
  if (!outDir) throw new Error('UI_CAPTURE_OUT_DIR 이 없다 — 래퍼(lane-b.env)로 부른다')
  const premise = envPremise(envText, process.env)
  if (premise.problems.length) throw new Error(`결정성 전제 위반 — ${premise.problems.join('; ')}`)
  const anon = localClientEnv(envText)
  if (anon.url.replace(/\/+$/, '') !== target.supabaseUrl) throw new Error('세션 클라이언트의 Supabase URL 이 검사한 값과 다르다')
  const db = createClient(target.supabaseUrl, admin.serviceRoleKey, { auth: { persistSession: false } })
  /** @param {Map<string, string>} jar */
  const sessionClient = (jar) => createServerClient(target.supabaseUrl, anon.anonKey, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
  } })
  return { envText, target, outDir, db, sessionClient, baseUrl: resolveBase(base, target), explicitBase: base !== null && base !== undefined, llmKeys: premise.llmKeys }
}

export const must = (label, { data, error }) => { if (error) throw new Error(`${label}: ${error.message}`); return data }

export async function userIdByEmail(db, email) {
  return must(`profiles 조회(${email})`, await db.from('profiles').select('user_id').eq('email', email).maybeSingle())?.user_id ?? null
}

/** FNV-1a 64bit hex — src/lib/minutes/blocks.ts 의 fnv1a64 과 같은 값이다(그 TS 는 .mjs 가 import 못 한다).
 *  회의록 생성 RPC 가 요구하는 본문 해시가 이 값이라 sha256 로는 그 RPC 가 MINUTE_CREATE_INPUT_INVALID 로 거절한다. */
export function fnv1a64(text) {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i++) h = BigInt.asUintN(64, (h ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n)
  return h.toString(16).padStart(16, '0')
}

/** GoTrue 로 만든다(SQL 로 넣은 auth.users 는 GoTrue 가 못 읽는다). 비밀번호는 버린다 — shoot 가 시작 때 재설정한다(판정 Q4) */
async function ensureAccount(db, email) {
  const existing = await userIdByEmail(db, email)
  if (existing) return existing
  const { data, error } = await db.auth.admin.createUser({ email, password: randomBytes(24).toString('base64'), email_confirm: true })
  if (error) throw new Error(`계정 생성 실패(${email}): ${error.message}`)
  must(`profiles(${email})`, await db.from('profiles').upsert({ user_id: data.user.id, email, display_name: email.split('@')[0] }))
  return data.user.id
}

/** people(workspace_id, email) 은 부분 유니크 인덱스라 upsert 를 못 쓴다 — select 후 insert/link(perf-baseline.mjs 와 같은 패턴) */
async function ensurePerson(db, wsId, email, userId) {
  const found = must(`people 조회(${email})`, await db.from('people').select('id, user_id').eq('workspace_id', wsId).eq('email', email).maybeSingle())
  if (found) {
    if (!found.user_id) must(`people 연결(${email})`, await db.from('people').update({ user_id: userId }).eq('id', found.id))
    return found.id
  }
  return must(`people 생성(${email})`, await db.from('people').insert({ workspace_id: wsId, email, display_name: email.split('@')[0], user_id: userId }).select('id').single()).id
}

/** 멱등 삽입 — 같은 키는 건너뛴다(갱신 트리거를 타지 않게 insert 만). write 는 **리터럴 표 이름**의 upsert 다 —
 *  이 파일은 설정 표 이름을 가지므로 settings-writes G2 가 식으로 받는 from(표)(…) 뒤에 select 만 허용한다.
 *  다중 insert 는 열 목록을 행들의 키 합집합으로 잡고 없는 키를 NULL 로 채운다 — NOT NULL 열은 전부 명시해야 한다. */
async function insertOnce(label, rows, write) {
  for (let i = 0; i < rows.length; i += 200) must(`${label} 시드(${i})`, await write(rows.slice(i, i + 200)))
}
const once = (onConflict = 'id') => ({ onConflict, ignoreDuplicates: true })

/** 워크스페이스 설정 시드의 한 길 — revision 을 읽고 patch(지금 값 → 쓸 키·값 | null)가 낸 것만 설정 RPC 로 쓴다(설정 쓰기는 RPC 한 길).
 *  쓸 것이 없으면 부르지 않는다 — 이력 행을 늘리지 않는다. 이 파일의 설정 표 읽기·설정 RPC 쓰기는 여기 한 곳이다(settings-writes 의 수) */
async function seedWorkspaceSettings(db, label, workspaceId, actor, patch) {
  const row = must(`${label} — 설정 revision`, await db.from('workspace_settings').select('revision, values').eq('workspace_id', workspaceId).single())
  const set = patch(row.values ?? {})
  if (!set) return { wrote: false, values: row.values ?? {} }
  const res = must(label, await db.rpc('apply_workspace_settings', {
    p_workspace_id: workspaceId, p_expected_revision: row.revision, p_command_id: randomUUID(), p_set: set,
    p_unset: [], p_actor: actor, p_schema_version: SCRIPT_SCHEMA_VERSION, p_source: 'internal',
  }))
  return { wrote: true, values: { ...(row.values ?? {}), ...set }, status: res?.status ?? null, revision: res?.revision ?? null }
}

async function cmdSeed() {
  const { db } = laneEnv()
  const today = kstToday()
  const slugA = (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()
  const wsA = must('워크스페이스 A 조회', await db.from('workspaces').select('id').eq('slug', slugA).maybeSingle())
  if (!wsA) throw new Error(`워크스페이스 '${slugA}' 가 없다 — dev:bootstrap 을 먼저`)

  // 계정 넷 — 소속 순서가 가입 순서다(duo 는 A 먼저 → 선호값 키 워크스페이스 = A)
  const users = {}
  for (const [grade, email] of Object.entries(SEED_ACCOUNTS)) users[grade] = await ensureAccount(db, email)
  let wsB = must('워크스페이스 B 조회', await db.from('workspaces').select('id').eq('slug', SEED_WS_B.slug).maybeSingle())
  if (!wsB) wsB = must('워크스페이스 B 생성', await db.from('workspaces').insert({ slug: SEED_WS_B.slug, name: SEED_WS_B.name }).select('id').single())
  const memberships = [[wsA.id, users.platformAdmin, 'admin'], [wsA.id, users.wsAdmin, 'admin'], [wsA.id, users.member, 'member'], [wsA.id, users.duo, 'member'], [wsB.id, users.duo, 'member']]
  for (const [workspace_id, user_id, role] of memberships) {
    must('workspace_members', await db.from('workspace_members').upsert({ workspace_id, user_id, role }, { onConflict: 'workspace_id,user_id' }))
  }
  must('platform_admins', await db.from('platform_admins').upsert({ user_id: users.platformAdmin }))

  // 워크스페이스 B 의 허용 모듈 — 기본 [] 이면 B 뒤 모듈 화면이 404 다(판정 Q7). 이미 값이 있으면 덮지 않는다
  await seedWorkspaceSettings(db, 'B 허용 모듈', wsB.id, users.duo,
    (v) => (Object.prototype.hasOwnProperty.call(v, 'modules.allowed') ? null : { 'modules.allowed': [...BOOTSTRAP_MODULE_IDS] }))
  // 워크스페이스 A 의 초대 허용 도메인 — 같은 길로(과제 5 권고 2). 이미 그 도메인이 있으면 쓰지 않는다(inviteDomainPatch — 멱등).
  // 행위자는 A 의 워크스페이스 관리자(그 설정의 편집 등급)
  const domainsA = await seedWorkspaceSettings(db, 'A 초대 허용 도메인', wsA.id, users.wsAdmin, (v) => inviteDomainPatch(v))

  // 프로젝트 — 생성 RPC 가 core.level_labels 를 채운다(없으면 WBS·설정이 오류 화면). 같은 날 재실행만 멱등, 다른 날이면 멈춘다
  let project = must('프로젝트 조회', await db.from('projects').select('id, description').eq('workspace_id', wsA.id).eq('name', SEED_PROJECT).maybeSingle())
  const marker = `ui-capture seed ${today}`
  if (project && project.description !== marker) throw new Error(`시드 날짜가 다르다(${project.description}) — db:reset → dev:bootstrap 부터(갱신 트리거를 타지 않게 insert 만 한다)`)
  if (!project) {
    const created = must('프로젝트 생성', await db.rpc('create_project_with_settings', {
      p_workspace_id: wsA.id, p_name: SEED_PROJECT, p_start_date: plusDays(today, -40), p_end_date: plusDays(today, 60), p_description: marker,
      p_values: { 'core.level_labels': [...LEVEL_LABELS_4], 'modules.enabled': [...PROJECT_TOGGLE_IDS] },
      p_copy_from: null, p_actor: users.wsAdmin, p_command_id: randomUUID(), p_schema_version: SCRIPT_SCHEMA_VERSION,
    }))
    project = { id: created.project_id }
  }
  const pid = project.id

  // 명단 — 워크스페이스 관리자는 admin, 멤버·duo 는 member(플랫폼 관리자는 명단 없음)
  const person = {}
  for (const g of ['wsAdmin', 'member', 'duo']) person[g] = await ensurePerson(db, wsA.id, SEED_ACCOUNTS[g], users[g])
  await ensurePerson(db, wsB.id, SEED_ACCOUNTS.duo, users.duo)
  const memberIds = {}
  for (const [g, role] of [['wsAdmin', 'admin'], ['member', 'member'], ['duo', 'member']]) {
    memberIds[g] = must(`project_members(${g})`, await db.from('project_members')
      .upsert({ project_id: pid, person_id: person[g], access_role: role, active: true }, { onConflict: 'project_id,person_id' }).select('id').single()).id
  }
  const plan = seedPlan({ today, projectId: pid, wsA: wsA.id, memberIds, users: { wsAdmin: users.wsAdmin } })
  await insertOnce('teams', plan.teams, (c) => db.from('teams').upsert(c, once()))
  await insertOnce('project_member_teams', [
    { member_id: memberIds.member, team_id: plan.teams[0].id, is_primary: true },
    { member_id: memberIds.duo, team_id: plan.teams[1].id, is_primary: true },
  ], (c) => db.from('project_member_teams').upsert(c, once('member_id,team_id')))
  await insertOnce('wbs_items', plan.wbs, (c) => db.from('wbs_items').upsert(c, once()))
  must('item_owners 비우기', await db.from('item_owners').delete().in('wbs_item_id', plan.wbs.map((r) => r.id)))
  must('item_owners', await db.from('item_owners').insert(plan.owners))
  await insertOnce('task_dependencies', plan.deps, (c) => db.from('task_dependencies').upsert(c, once()))
  await insertOnce('issues', plan.issues, (c) => db.from('issues').upsert(c, once()))
  await insertOnce('announcements', plan.announcements, (c) => db.from('announcements').upsert(c, once()))
  await insertOnce('meetings', plan.meetings, (c) => db.from('meetings').upsert(c, once()))
  await insertOnce('meeting_attendees', plan.attendees, (c) => db.from('meeting_attendees').upsert(c, once('meeting_id,member_id')))
  await insertOnce('attendance_records', plan.attendance, (c) => db.from('attendance_records').upsert(c, once()))
  await insertOnce('project_areas', plan.weeklyAreas, (c) => db.from('project_areas').upsert(c, once()))   // 주간 영역 — 문서·행보다 먼저(영역 FK, SP4 D53)
  await insertOnce('weekly_reports', [plan.weeklyReport], (c) => db.from('weekly_reports').upsert(c, once()))
  await insertOnce('weekly_report_rows', plan.weeklyRows, (c) => db.from('weekly_report_rows').upsert(c, once()))
  await insertOnce('wiki_topics', [plan.wikiTopic], (c) => db.from('wiki_topics').upsert(c, once()))
  await insertOnce('wiki_topic_revisions', [plan.wikiRevision], (c) => db.from('wiki_topic_revisions').upsert(c, once()))
  await insertOnce('agent_projects', [{ project_id: pid }], (c) => db.from('agent_projects').upsert(c, once('project_id')))
  await insertOnce('agent_runners', [plan.runner], (c) => db.from('agent_runners').upsert(c, once()))
  await insertOnce('agent_work_orders', [plan.agentOrder], (c) => db.from('agent_work_orders').upsert(c, once()))   // 좌석 1(판정 Q34) — wbs_items 뒤
  await insertOnce('project_invites', [plan.invite], (c) => db.from('project_invites').upsert(c, once()))
  for (const m of plan.minutes) {
    const exists = must('회의록 조회', await db.from('minutes').select('id').eq('id', m.id).maybeSingle())
    if (exists) continue
    must(`회의록 생성(${m.title})`, await db.rpc('create_minute_with_version', {
      p_minute_id: m.id, p_minute_date: m.date, p_team_code: m.team, p_title: m.title, p_body_md: m.body, p_body_hash: fnv1a64(m.body),
      p_meeting_id: null, p_project_id: pid, p_meeting_occurrence_date: null, p_folder_id: null, p_external_id: null,
      p_actor_id: users.wsAdmin, p_actor_name: 'ui-wsadmin', p_workspace_id: wsA.id,
    }))
  }
  const ids = seedIds(pid)
  must('공유 토큰', await db.from('minutes').update({ share_token: ids.shareToken, share_enabled: true }).eq('id', ids.minuteId))
  const inviteDomainsA = { value: domainsA.values['invites.allowed_domains'] ?? null, wrote: domainsA.wrote,
    ...(domainsA.wrote ? { status: domainsA.status, revision: domainsA.revision } : {}) }
  console.log(JSON.stringify({ ok: true, today, projectId: pid, wsB: wsB.id, wbs: plan.wbs.length, minutes: plan.minutes.length, inviteDomainsA }))
}
COMMANDS.seed = cmdSeed

export const CDN_HOST = 'https://cdn.jsdelivr.net/'
const gitHead = () => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()

/** Playwright 1.58.2 — npx -p 가 PATH 에 둔 .bin 옆 패키지를 import 한다(ESM 은 NODE_PATH·PATH 를 보지 않는다, 판정 Q2) */
export async function loadPlaywright() {
  const bin = (process.env.PATH || '').split(':').find((p) => /\/_npx\/[^/]+\/node_modules\/\.bin$/.test(p) && existsSync(join(p, '..', 'playwright', 'package.json')))
  if (!bin) throw new Error('Playwright 가 PATH 에 없다 — npx --yes -p playwright@1.58.2 node scripts/ui-capture.mjs … 로 부른다')
  const version = JSON.parse(readFileSync(join(bin, '..', 'playwright', 'package.json'), 'utf8')).version
  if (version !== '1.58.2') throw new Error(`Playwright ${version} — 1.58.2 로 고정한다(판정 Q2)`)
  return import(pathToFileURL(join(bin, '..', 'playwright', 'index.mjs')).href)
}

/** 시드 계정의 비밀번호를 새 임의 값(메모리)으로 바꾸고 앱과 같은 @supabase/ssr 쿠키 항아리로 로그인한다(판정 Q4).
 *  클라이언트는 laneEnv 의 것(env.db·env.sessionClient)만 쓴다 @param {ReturnType<typeof laneEnv>} env @param {string[]} grades
 *  @returns {Promise<Record<string, { userId: string, email: string, cookies: { name: string, value: string }[] }>>} */
export async function freshSessions(env, grades) {
  const sessions = {}
  for (const { grade, email } of resetTargets(grades, process.env.BOOTSTRAP_EMAIL || 'admin@example.com')) {
    const userId = await userIdByEmail(env.db, email)
    if (!userId) throw new Error(`시드 계정이 없다(${email}) — ui-capture.mjs seed 를 먼저`)
    const password = randomBytes(24).toString('base64')
    must(`비밀번호 재설정(${grade})`, await env.db.auth.admin.updateUserById(userId, { password }))
    const jar = new Map()
    const { error } = await env.sessionClient(jar).auth.signInWithPassword({ email, password })
    if (error) throw new Error(`로그인 실패(${grade}): ${error.message}`)
    sessions[grade] = { userId, email, cookies: [...jar].map(([name, value]) => ({ name, value })) }
  }
  return sessions
}

/** 실행 시작 선호값의 고정 키 — 계정 키(account_preferences, SP3b D9). PrefsSync 가 서버값과 맞추는 키(src/lib/prefs/sync.ts)를 새
 *  컨텍스트의 로컬값으로: 사이드바는 localStorage 가 없으니 펼침, 언어 쿠키가 없으니 한국어. 테마는 패스마다 따로 넣는다 */
export const RUN_START_PREFS = Object.freeze({ sidebarCollapsed: false, locale: 'ko' })

/** 워크스페이스 행 pin 의 고정 시각 — 결정적이어야 한다(실행 시각을 쓰면 행이 실행마다 바뀐다) */
export const PIN_AT = '2026-01-01T00:00:00Z'
/** 실행 시작의 워크스페이스 행(워크스페이스 키만, SP3b D9) — 최근 방문 = 시드 프로젝트. 은퇴 키 lastProjectId 를 대신한다
 *  @param {string} projectId @returns {Record<string, unknown>} */
export function startPin(projectId) {
  if (!projectId) throw new Error('실행 시작 pin: 프로젝트 id 가 비었다')
  return { recentProjects: [{ id: projectId, at: PIN_AT }] }
}

/**
 * 실행 시작 선호값(순수, UI-0 결정성 리뷰 P2 — D4) — 지금 값과 병합하지 않고 이 객체로 **덮는다**. 그 밖의 UiPrefs 키(간트 일 폭·개요 번호·
 * 완료 숨김·대시보드 펼침·회의록 보기·알림 읽음·알림 설정 …)는 없음 = 제품 기본값이라 db:reset 뒤 첫 실행(빈 prefs + 고정 키)과 같은
 * 화면이다. 병합하면 지난 실행·수동 확인·perf-grid 가 남긴 키가 다음 실행의 시작 상태를 바꿨다. 새 컨텍스트에서 PrefsSync 가 적용·백필할
 * 것이 없어 실행 중 선호 쓰기도 생기지 않는다(테스트가 앱의 computePrefsSync 로 확인).
 * 계정 키만이다 — 워크스페이스 키(최근 방문 등)는 setServerTheme 의 pin 이 워크스페이스 행에 쓴다(SP3b D9).
 * @param {string} theme @returns {Record<string, unknown>}
 */
export function fixedPrefs(theme) {
  // system 은 checks flicker 의 OS 다크 패스만 쓴다(ui1-addendum §5) — 그 패스의 컨텍스트 색 체계가 해석값을 정한다. shoot·axe 는 --theme 이 light|dark 로 막는다
  if (!['light', 'dark', 'system'].includes(theme)) throw new Error(`테마는 light|dark|system: ${theme}`)
  return { ...RUN_START_PREFS, theme }
}

/**
 * 캡처 계정의 서버 선호값을 고정 객체로 덮는다(판정 Q8 — PrefsSync 는 서버값이 이긴다). 계정 행(account_preferences) = fixedPrefs(theme),
 * 모든 소속 워크스페이스 행(user_preferences) = pin(워크스페이스 키만 — shoot 는 startPin(시드 프로젝트))(SP3b D9). 두 행 모두 병합이 아니라
 * 덮는다 — 앞 실행이 남긴 계정 키·알림 읽음·즐겨찾기가 다음 실행의 시작 상태를 바꾸지 않게. seed 가 아니라 실행 시작에서 덮는 이유:
 * perf-grid measure·axe·수동 확인이 그 값을 다시 바꾼다.
 * extra(행의 prefs — 허용 키만, validateRoutes) 는 고정 객체 위에 얹는다 — 그 행을 찍는 동안만이고 끝나면 extra 없이 다시 덮는다.
 * @param {any} db @param {string[]} userIds @param {string} theme @param {Record<string, unknown>} [pin] @param {Record<string, unknown>} [extra]
 */
export async function setServerTheme(db, userIds, theme, pin = {}, extra = {}) {
  const prefs = { ...fixedPrefs(theme), ...extra }
  for (const userId of userIds) {
    must('계정 선호 쓰기', await db.from('account_preferences').upsert(
      { user_id: userId, prefs, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    ))
    const rows = must('소속 조회', await db.from('workspace_members').select('workspace_id').eq('user_id', userId))
    for (const { workspace_id } of rows) {
      must('선호 쓰기', await db.from('user_preferences').upsert(
        { user_id: userId, workspace_id, prefs: pin, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,workspace_id' },
      ))
    }
  }
}

/**
 * 테마 패스의 시작 상태 = db:reset 뒤 첫 실행(과제 5b·D4) — 첫 방문·클릭이 써서 그 뒤 화면을 바꾸는 상태 셋을 되돌린다.
 * ① 공지 읽음 워터마크(announcement_seen) — 캡처 계정(seenResetTargets)의 행 전부. 공지 화면 방문이 워터마크를 써서 db:reset 뒤 첫 실행만
 *    공지 화면에 NEW 칩이 있었고(과제 5 자기 차이 0.13%), 워터마크가 마이크로초로 저장되면(레인 A 수정) 첫 방문 뒤 공지 배지가 사라져
 *    같은 실행의 뒤 화면과 다음 실행이 달라진다.
 * ② 알림 열람·읽음(notification_recipients 의 seen_at·read_at) — 캡처 계정의 행을 미열람·미읽음으로. 벨 열람(markInboxSeen)·모두 읽음·
 *    항목 읽음이 쓰고(전부 user_id 로 거른다) 벨 배지에 든다 — UI-1 의 알림 팝오버 클릭 행이 앞 실행의 뒤 화면·다음 실행을 바꾼다.
 * ③ 진척 스냅샷(wbs_progress_snapshots) — 시드 프로젝트의 행 전부. 대시보드·포트폴리오가 응답 뒤(after) 오늘 스냅샷을 써서 db:reset 뒤 첫
 *    대시보드 방문만 속도 지표(SPI)가 '—' 였다(과제 5b 0.26%). 지운 뒤 사전 방문(warmupSnapshot)이 같은 서버로 다시 쓰게 한다(T6-R1).
 * 거르는 값이 비면 아무것도 지우거나 고치지 않고 멈춘다 — 조건 없는 삭제·갱신을 만들지 않는다.
 * @param {any} db @param {{ userIds: string[], projectId: string }} target
 */
export async function resetRunStart(db, { userIds, projectId }) {
  if (!Array.isArray(userIds) || userIds.length === 0 || userIds.some((u) => !u)) throw new Error('실행 시작 상태: 캡처 계정 id 가 비었다')
  if (!projectId) throw new Error('실행 시작 상태: 시드 프로젝트 id 가 비었다')
  must('공지 읽음 워터마크 지우기', await db.from('announcement_seen').delete().in('user_id', userIds))
  must('알림 열람·읽음 되돌리기', await db.from('notification_recipients').update({ seen_at: null, read_at: null }).in('user_id', userIds))
  must('진척 스냅샷 지우기', await db.from('wbs_progress_snapshots').delete().eq('project_id', projectId))
}

/**
 * 테마 패스의 시작(조립, D15) — 캡처 계정의 선호값을 고정 객체로 덮고(워크스페이스 행 최근 방문 = 시드 프로젝트) 첫 방문·클릭이 쓰는 상태를 되돌린다.
 * 순서가 계약이다: 선호 → 워터마크 → 알림 → 스냅샷(그 뒤 사전 방문). 앞 단계가 실패하면 멈춘다.
 * @param {any} db @param {{ theme: string, userIds: string[], projectId: string }} pass
 */
export async function passStart(db, { theme, userIds, projectId }) {
  await setServerTheme(db, userIds, theme, startPin(projectId))
  await resetRunStart(db, { userIds, projectId })
}

/** 속도 계기 사전 방문(T6-R1)의 계정 등급 — 대시보드를 볼 수 있는 가장 낮은 등급(명단 member — 쓰기 RLS 는 명단 계정만 통과) */
export const WARMUP_GRADE = 'member'
/** 사전 방문 뒤 오늘 스냅샷을 기다리는 상한 — 넘으면 실패(fail-closed) */
export const WARMUP_LIMIT_MS = 30_000

/** 그 실행이 로그인할 등급(순수) — 라우트 등급(공개 제외) + 사전 방문 계정. 공개 화면만 찍는 실행도 member 세션을 연다
 *  @param {{ grade: string }[]} routes @returns {string[]} */
export function runGrades(routes) {
  return [...new Set([...routes.map((r) => r.grade).filter((g) => g !== 'public'), WARMUP_GRADE])]
}

/**
 * check() 가 참이 될 때까지 다시 본다(대기 판정·상한) — { ok, tries, elapsedMs }. 상한까지 거짓이면 ok 거짓(호출자가 throw).
 * check 의 오류는 그대로 올린다 — 조회 실패를 '아직 없음'으로 위장하지 않는다. now·sleep 은 테스트가 가짜 시계로 바꾼다.
 * @param {() => Promise<boolean>} check
 * @param {{ limitMs: number, intervalMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void> }} opts
 */
export async function pollUntil(check, { limitMs, intervalMs = 500, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!Number.isInteger(limitMs) || limitMs <= 0) throw new Error(`대기 상한은 양의 정수(ms): ${limitMs}`)
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) throw new Error(`대기 간격은 양의 정수(ms): ${intervalMs}`)
  const t0 = now()
  for (let tries = 1; ; tries++) {
    if (await check()) return { ok: true, tries, elapsedMs: now() - t0 }
    const elapsed = now() - t0
    if (elapsed >= limitMs) return { ok: false, tries, elapsedMs: elapsed }
    await sleep(Math.min(intervalMs, limitMs - elapsed))
  }
}

/** 사전 방문 실패 문구(순수) — 계정·날짜·서버, 그리고 가장 흔한 원인(남의 서버·다른 스택에 붙은 서버, 명단 밖 계정의 RLS 거부)
 *  @param {{ email: string, date: string, baseUrl: string, limitMs: number }} f */
export function warmupFailure({ email, date, baseUrl, limitMs }) {
  return `속도 계기 사전 방문: ${email} 로 ${baseUrl}/p/{pid}/dashboard 를 열었지만 오늘(${date} KST) 진척 스냅샷이 ${Math.round(limitMs / 1000)}초 안에 `
    + '레인 B DB 에 생기지 않았다 — 앱 서버가 레인 B 스택(54421)에 붙어 있는지 확인(남의 서버·다른 스택이면 레인 B pid 를 숨겨 스냅샷을 쓰지 않는다). '
    + '명단 밖 계정이면 쓰기 RLS 거부(앱은 로그도 남기지 않는다)일 수 있다'
}

/** jsDelivr 응답을 리포 밖 캐시에서 준다 — 라벨 사이 글꼴 바이트를 고정한다(판정 Q3) */
async function routeCdn(context, cacheDir) {
  mkdirSync(cacheDir, { recursive: true })
  await context.route(`${CDN_HOST}**`, async (route) => {
    const file = join(cacheDir, createHash('sha256').update(route.request().url()).digest('hex'))
    if (existsSync(file) && existsSync(`${file}.json`)) {
      return route.fulfill({ status: 200, headers: JSON.parse(readFileSync(`${file}.json`, 'utf8')), body: readFileSync(file) })
    }
    const res = await route.fetch()
    const body = await res.body()
    if (res.status() === 200) {
      writeFileSync(file, body)
      writeFileSync(`${file}.json`, JSON.stringify({ 'content-type': res.headers()['content-type'] ?? 'application/octet-stream', 'access-control-allow-origin': '*' }))
    }
    return route.fulfill({ response: res, body })
  })
}

async function resolveSeed(db) {
  const slugA = (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()
  const wsA = must('워크스페이스 A', await db.from('workspaces').select('id, slug').eq('slug', slugA).single())
  const project = must('시드 프로젝트', await db.from('projects').select('id, description').eq('workspace_id', wsA.id).eq('name', SEED_PROJECT).maybeSingle())
  if (!project) throw new Error('시드 프로젝트가 없다 — ui-capture.mjs seed 를 먼저')
  const seedDate = String(project.description ?? '').replace('ui-capture seed ', '')
  if (seedDate !== kstToday()) throw new Error(`시드 날짜 ${seedDate} ≠ 오늘(KST) ${kstToday()} — db:reset → dev:bootstrap → seed 를 다시`)
  return { pid: project.id, seedDate, wsSlug: wsA.slug, ...seedIds(project.id) }
}

/** 산출물 가림(순수, UI-0 안전 리뷰 P3-1) — 초대·공유 토큰의 **값**을 자리표시로 바꾼다(경로 모양이 바뀌어도 새지 않는다). 빈 값은 건너뛴다
 *  @param {string} text @param {{ inviteToken?: string | null, shareToken?: string | null }} values */
export function redactTokens(text, { inviteToken, shareToken } = {}) {
  let s = String(text)
  for (const [value, mark] of [[inviteToken, '{inviteToken}'], [shareToken, '{shareToken}']]) if (value) s = s.split(value).join(mark)
  return s
}

/**
 * 속도 계기 사전 방문(T6-R1) — 그 실행이 찍는 서버(baseUrl — 기준 서버 실행이면 기준 서버)로 시드 프로젝트 대시보드를 캡처 없이 한 번 열고,
 * 앱이 응답 뒤(after) 쓰는 오늘(KST) 진척 스냅샷이 레인 B DB 에 생길 때까지 읽기로 확인한다(상한 WARMUP_LIMIT_MS — 넘으면 throw).
 * 그래서 포트폴리오 없이 대시보드를 찍는 부분 실행도 계기가 '—' 가 아니라 전 경로 실행과 같은 값이다. 스냅샷을 service_role 로 직접 넣지
 * 않는다 — 방문한 서버 코드의 계산값이어야 (기준, 머리) 비교가 롤업 회귀를 본다. 남의 서버·다른 스택이면 여기서 멈춘다(안전 리뷰 §3).
 */
async function warmupSnapshot({ browser, db, baseUrl, session, theme, projectId, outDir }) {
  const date = kstToday()
  const context = await browser.newContext(contextOptions({ width: 1440, height: 900, theme }))
  try {
    await routeCdn(context, join(outDir, 'cdn-cache'))
    await context.addCookies([...session.cookies, { name: 'dflow-theme', value: theme }].map((c) => ({ name: c.name, value: c.value, url: baseUrl })))
    const page = await context.newPage()
    await page.goto(`${baseUrl}/p/${encodeURIComponent(projectId)}/dashboard`, { waitUntil: 'load', timeout: 60_000 })
    try { await page.waitForLoadState('networkidle', { timeout: 15_000 }) } catch { /* 판정은 아래 DB 확인이 한다 */ }
  } finally { await context.close() }
  const found = async () => Boolean(must('스냅샷 확인', await db.from('wbs_progress_snapshots').select('snap_date')
    .eq('project_id', projectId).eq('snap_date', date).maybeSingle()))
  const res = await pollUntil(found, { limitMs: WARMUP_LIMIT_MS })
  if (!res.ok) throw new Error(warmupFailure({ email: session.email, date, baseUrl, limitMs: WARMUP_LIMIT_MS }))
  return { theme, date, tries: res.tries, elapsedMs: res.elapsedMs }
}

/** 라우트 × 테마 × 크기마다 새 컨텍스트(캐시 없음)로 열고 visit(page, info) 의 결과를 rows 로 모은다.
 *  테마 패스마다 시작 상태를 고정한다(passStart — 선호값 고정 객체·워크스페이스 행 pin·공지 워터마크·알림 열람·진척 스냅샷) 뒤 속도 계기 사전 방문.
 *  env 는 laneEnv 의 결과(shoot 가 서버 커밋 판정에 먼저 쓴다) — 주지 않으면 여기서 만든다 */
/** main 의 스크롤 주체(D19)를 y px 만큼 내리고 한 프레임 기다린다 — 짧은 화면은 브라우저가 끝에서 멈춘다(그만큼만 내려간 장이 찍힌다) */
export async function scrollMain(page, y) {
  await page.evaluate((to) => document.querySelector('main#main-content')?.scrollTo(0, to), y)
  await page.waitForTimeout(200)
}

export async function forEachShot(opts, visit, env = laneEnv({ base: opts.base })) {
  const { db, outDir, baseUrl } = env
  const routesText = readFileSync('scripts/ui-capture.routes.json', 'utf8')
  const doc = JSON.parse(routesText)
  const routes = selectRoutes(doc, opts)
  const seed = await resolveSeed(db)
  // 서버 정체(D3) — 그 실행이 찍는 서버의 빌드 id. 못 찾으면 멈춘다(Next 프로덕션 빌드가 아니거나 다른 것이 그 포트에 떠 있다)
  const loginRes = await fetch(`${baseUrl}/login`)
  if (!loginRes.ok) throw new Error(`앱 서버 확인 실패(${baseUrl}/login → ${loginRes.status})`)
  const buildId = buildIdOf(await loginRes.text())
  if (!buildId) throw new Error(`서버 빌드 id 를 HTML 에서 찾지 못했다(${baseUrl}) — 그 포트의 서버가 Next 프로덕션 빌드인지 확인`)
  const captureIds = []   // 캡처 계정 넷 — 그 실행이 쓰는 등급과 무관하게 넷 모두의 시작 상태를 덮는다
  for (const { email } of seenResetTargets(process.env.BOOTSTRAP_EMAIL || 'admin@example.com')) {
    const userId = await userIdByEmail(db, email)
    if (!userId) throw new Error(`시드 계정이 없다(${email}) — ui-capture.mjs seed 를 먼저`)
    captureIds.push(userId)
  }
  const sessions = await freshSessions(env, runGrades(routes))
  const values = { pid: seed.pid, minuteId: seed.minuteId, topicId: seed.topicId, inviteToken: seed.inviteToken, shareToken: seed.shareToken, wsSlug: seed.wsSlug }
  const redact = (s) => redactInviteTokens(redactTokens(s, values))
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()
  const browserVersion = browser.version()
  const rows = []
  const warmups = []
  try {
    for (const theme of opts.theme) {
      await passStart(db, { theme, userIds: captureIds, projectId: seed.pid })
      warmups.push(await warmupSnapshot({ browser, db, baseUrl, session: sessions[WARMUP_GRADE], theme, projectId: seed.pid, outDir }))
      for (const r of routes) {
        // 행의 계정 선호(prefs — 서버값이 이기는 키라 클릭·init 으로는 못 정한다)는 그 행을 찍는 동안만 덮고, 끝나면 시작 상태로 되돌려 뒤 행을 바꾸지 않게 한다
        if (r.prefs) await setServerTheme(db, captureIds, theme, startPin(seed.pid), r.prefs)
        try {
          for (const [width, height] of opts.sizes) {
            const context = await browser.newContext(contextOptions({ width, height, theme, javaScript: opts.javaScript }))
            try {
              await routeCdn(context, join(outDir, 'cdn-cache'))
              const cookies = [...(r.grade === 'public' ? [] : sessions[r.grade].cookies), { name: 'dflow-theme', value: theme }]
              await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: baseUrl })))
              await context.addInitScript((entries) => {
                try { for (const [k, v] of Object.entries(entries)) window.localStorage.setItem(k, v) } catch { /* 저장소 없음 */ }
              }, r.init ?? {})
              const page = await context.newPage()
              await page.goto(baseUrl + fillPath(r.path, values), { waitUntil: 'load', timeout: 60_000 })
              let idle = true
              // JS 를 끈 장(--js off, D55 첫 페인트)은 스크립트가 없어 네트워크 유휴를 기다릴 것이 없다 — 글꼴만 확정하고 찍는다
              if (opts.javaScript !== false) { try { await page.waitForLoadState('networkidle', { timeout: 15_000 }) } catch { idle = false } }
              await page.evaluate(() => document.fonts.ready.then(() => true))
              await page.waitForTimeout(500)
              let clickFailed = false
              for (const sel of clickSteps(r)) {   // 단계마다 400ms 를 두고 차례로 — 한 단계가 실패하면 뒤 단계는 누르지 않는다
                try { await page.locator(sel).first().click({ timeout: 5_000 }); await page.waitForTimeout(400) } catch { clickFailed = true; break }
              }
              if (opts.scroll > 0) await scrollMain(page, opts.scroll)   // 클릭 뒤 — 고정 요소가 스크롤된 main 위에서 어디 붙는지(D54)
              const missing = []   // 판정 Q35 — 그려져야 할 선택자(예: 좌석표의 막힘 좌석 — Q34)가 0개면 문제로 적는다
              for (const sel of r.expect ?? []) if ((await page.locator(sel).count()) === 0) missing.push(`expect-missing:${sel}`)
              const u = new URL(page.url())
              const final = finalProblem(r, values, u, { base: env.explicitBase })   // D2 — expectFinal 이 없는 행도 채운 경로가 기대 최종 경로다
              const problems = [...pageProblems(await page.content()), ...(final ? [final] : []), ...(clickFailed ? ['click-failed'] : []), ...missing]
              const row0 = { key: r.key, grade: r.grade, width, height, theme, idle, finalPath: redact(u.pathname + u.search) }
              const v = await visit(page, { r, width, height, theme, doc, outDir })
              rows.push({ ...row0, ...v, problems: [...problems, ...(v.problems ?? [])].map(redact) })
            } finally { await context.close() }
          }
        } finally {
          if (r.prefs) await setServerTheme(db, captureIds, theme, startPin(seed.pid))
        }
      }
    }
  } finally { await browser.close() }
  return { rows, outDir, baseUrl, browserVersion, seed, warmups, buildId, routesSha256: sha256(routesText) }
}

async function cmdShoot(opts) {
  if (!opts.label) throw new Error('--label 이 필요하다')
  const env = laneEnv({ base: opts.base })
  const head = gitHead()
  // 서버 정체(D3) — --base(기준 서버) 실행은 그 서버를 빌드한 트리가 있어야 한다. 찍기 전에 판정한다
  const server = serverCommitOf({ explicitBase: env.explicitBase, envCommit: process.env.UI_CAPTURE_SERVER_COMMIT, flagCommit: opts.serverCommit, head })
  const res = await forEachShot(opts, async (page, { r, width, height, theme, doc, outDir }) => {
    const fonts = await page.evaluate(() => {
      const f = [...document.fonts].filter((x) => x.family.replace(/["']/g, '') === 'Pretendard Variable')
      return { registered: f.length, loaded: f.filter((x) => x.status === 'loaded').length, loading: f.filter((x) => x.status === 'loading').length }
    })
    const h1 = await page.evaluate(() => [...document.querySelectorAll('h1')].filter((e) => e.checkVisibility()).map((e) => (e.textContent ?? '').trim().slice(0, 60)))
    // 가림 선택자별 일치 수(D8) — 무효(-1)는 그 장의 문제, 행 가림·숨김 0 은 경고(낡은 선택자)
    const sels = shotSelectors(doc, r)
    const mask = maskReport(sels, await page.evaluate((list) => list.map((s) => { try { return document.querySelectorAll(s).length } catch { return -1 } }), sels.map((s) => s.sel)))
    const dir = join(outDir, opts.label)
    mkdirSync(dir, { recursive: true })
    const file = shotFileName({ key: r.key, width, height, theme })
    const style = shotStyle(doc, r)
    const buf = await page.screenshot({ path: join(dir, file), ...(style ? { style } : {}), animations: 'disabled', caret: 'hide' })
    return { file, sha256: createHash('sha256').update(buf).digest('hex'), font: fontVerdict(fonts), fonts, h1Count: h1.length, h1,
      maskCounts: mask.counts, maskZero: mask.zero, problems: mask.invalid.map((s) => `mask-invalid:${s}`) }
  }, env)
  const maskWarnings = res.rows.flatMap((x) => x.maskZero.map((s) => `${x.key}@${x.width}x${x.height}/${x.theme}: ${s}`))
  const meta = { label: opts.label, commit: server.commit, commitSource: server.source, scriptCommit: head, buildId: res.buildId, browser: res.browserVersion,
    kstDate: kstToday(), seedDate: res.seed.seedDate, seedProjectId: res.seed.pid, routesSha256: res.routesSha256, baseUrl: res.baseUrl, llmKeys: env.llmKeys,
    themes: opts.theme, sizes: opts.sizes, scroll: opts.scroll, javaScript: opts.javaScript, warmups: res.warmups, maskWarnings, rows: res.rows }
  writeFileSync(join(res.outDir, opts.label, 'meta.json'), JSON.stringify(meta, null, 2))
  console.log(JSON.stringify({ ok: true, label: opts.label, shots: res.rows.length, buildId: res.buildId, commit: `${server.commit}(${server.source})`,
    warmups: res.warmups.map((w) => `${w.theme} ${w.elapsedMs}ms`),
    withProblems: res.rows.filter((x) => x.problems.length).map((x) => `${x.key}@${x.width}x${x.height}/${x.theme}:${x.problems.join('+')}`),
    fallbackFonts: res.rows.filter((x) => x.font !== 'ok').length, maskZero: maskWarnings.length }))
}

async function cmdDiff(opts) {
  const [baseLabel, headLabel] = opts.positional
  if (!baseLabel || !headLabel || opts.positional.length !== 2) throw new Error('사용: diff <기준 label> <대상 label> [--allow-cross] [--pair]')
  const { outDir } = laneEnv()
  const A = JSON.parse(readFileSync(join(outDir, baseLabel, 'meta.json'), 'utf8'))
  const B = JSON.parse(readFileSync(join(outDir, headLabel, 'meta.json'), 'utf8'))
  const cmp = compareMeta(A, B, { allowCross: opts.allowCross })
  if (cmp.problems.length) throw new Error(`비교할 수 없다 — ${cmp.problems.join('; ')}(판·시드가 다른 참고 대조는 같은 KST 날짜에서 --allow-cross)`)
  // 비교 쌍 — 기본은 같은 키끼리, --pair 는 머리의 pair 행 ↔ 기준의 짝 행(옛 경로 캡처 ↔ 새 경로 캡처). 최종 경로가 다른 것이 기대인 쌍은 그 비교를 건너뛴다
  const routesDoc = JSON.parse(readFileSync('scripts/ui-capture.routes.json', 'utf8'))
  const baseFinalKeys = new Set(routesDoc.routes.filter((r) => r.baseFinal !== undefined).map((r) => r.key))
  let jobs, added, missing
  if (opts.pair) {
    const pp = pairRows(A.rows, B.rows, pairPlan(routesDoc.routes.filter((r) => B.rows.some((x) => x.key === r.key)), routesDoc))
    jobs = pp.pairs.map((p) => ({ a: p.a, b: p.b, label: p.label, ignoreFinal: true }))
    added = pp.unmatched.map((u) => ({ ...u.b, key: u.label, reasons: ['기준에 짝 장 없음'] }))
    missing = []
  } else {
    const plan = diffRows(A.rows, B.rows)
    jobs = plan.pairs.map(({ a, b }) => ({ a, b, label: b.key, ignoreFinal: baseFinalKeys.has(b.key) }))
    added = plan.added
    missing = plan.missing
  }
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()
  const out = []
  try {
    const page = await browser.newPage()
    const fnSrc = pixelDiffStats.toString()
    for (const { a, b, label, ignoreFinal } of jobs) {
      const stats = await page.evaluate(async ({ pa, pb, src }) => {
        const load = async (b64) => {
          const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
          const c = new OffscreenCanvas(bmp.width, bmp.height)
          const ctx = c.getContext('2d')
          ctx.drawImage(bmp, 0, 0)
          return ctx.getImageData(0, 0, bmp.width, bmp.height)
        }
        return new Function(`return (${src})`)()(await load(pa), await load(pb))
      }, { pa: readFileSync(join(outDir, baseLabel, a.file)).toString('base64'), pb: readFileSync(join(outDir, headLabel, b.file)).toString('base64'), src: fnSrc })
      out.push({ ...rowVerdict({ a, b, stats }, { ignoreFinal }), key: label })
    }
  } finally { await browser.close() }
  for (const b of added) out.push({ key: b.key, width: b.width, height: b.height, theme: b.theme, file: b.file, ratio: null, verdict: 'new', reasons: b.reasons ?? [] })
  for (const a of missing) out.push({ key: a.key, width: a.width, height: a.height, theme: a.theme, file: a.file, ratio: null, verdict: 'missing', reasons: [] })
  const sorted = [...out].sort((x, y) => (y.ratio ?? -1) - (x.ratio ?? -1))
  const sum = summarizeDiff(sorted)
  const box = (r) => (r.bbox ? `${r.bbox.x},${r.bbox.y} ${r.bbox.w}×${r.bbox.h}` : '—')
  const head = (m) => `${m.label} — 서버 ${m.commit}${m.commitSource ? `(${m.commitSource})` : ''} · 빌드 ${m.buildId ?? '—'} · 스크립트 ${m.scriptCommit} · 시드 ${m.seedDate}`
  const suffix = opts.pair ? '-pair' : ''
  const md = [`# diff ${baseLabel} → ${headLabel}${opts.pair ? ' (--pair: 머리의 pair 행 ⇐ 기준의 짝 행)' : ''}`, '', `- 기준: ${head(A)}`, `- 대상: ${head(B)}`,
    `- 판정 수: same ${sum.same} · near ${sum.near} · diff ${sum.diff} · problem ${sum.problem} · missing ${sum.missing} · new ${sum.new} · skip ${sum.skipped}(판정 Q33 문턱 0.2%, near = 0 초과 문턱 이하)`,
    ...(cmp.warnings.length ? ['', '## 경고', ...cmp.warnings.map((w) => `- ${w}`)] : []),
    '', '## 볼 목록', ...(sum.look.length ? sum.look.map((l) => `- ${l}`) : ['- (없음 — 전부 same 또는 skip)']),
    '', '## 전체', '', '| 라우트 | 크기 | 테마 | 차이율 | 다른 픽셀 | 차이 영역(x,y w×h) | 판정 |', '|---|---|---|---|---|---|---|',
    ...sorted.map((r) => `| ${r.key} | ${r.width}×${r.height} | ${r.theme} | ${pctOf(r.ratio)} | ${r.diffPixels ?? '—'} | ${box(r)} | ${r.verdict}${r.known ? ' (알려진 잡음)' : ''} |`)].join('\n')
  writeFileSync(join(outDir, `diff-${baseLabel}--${headLabel}${suffix}.json`), JSON.stringify(sorted, null, 2))
  writeFileSync(join(outDir, `diff-${baseLabel}--${headLabel}${suffix}.md`), `${md}\n`)
  console.log(JSON.stringify({ ok: true, compared: sum.compared, same: sum.same, near: sum.near, diff: sum.diff, problem: sum.problem, missing: sum.missing, new: sum.new,
    skipped: sum.skipped, warnings: cmp.warnings, look: sum.look.slice(0, 20) }))
}

async function cmdAxe(opts) {
  if (!opts.label) throw new Error('--label 이 필요하다')
  const axePath = join(process.cwd(), 'node_modules/axe-core/axe.min.js')
  if (!existsSync(axePath)) throw new Error('node_modules/axe-core/axe.min.js 가 없다(전이 의존) — 멈추고 알린다(스펙 D48)')
  const res = await forEachShot(opts, async (page) => {
    await page.addScriptTag({ path: axePath })
    return page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } })
      const nodes = r.violations.flatMap((v) => v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 200), summary: (n.failureSummary ?? '').slice(0, 200) })))
      return { violations: nodes.length, incomplete: r.incomplete.reduce((s, v) => s + v.nodes.length, 0), nodes }
    })
  })
  const dir = join(res.outDir, opts.label)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'axe.json'), JSON.stringify({ browser: res.browserVersion, kstDate: kstToday(), rows: res.rows }, null, 2))
  console.log(JSON.stringify({ ok: true, label: opts.label, pages: res.rows.length, violations: res.rows.reduce((s, r) => s + r.violations, 0) }))
}

COMMANDS.shoot = cmdShoot
COMMANDS.diff = cmdDiff
COMMANDS.axe = cmdAxe

// ── UI-1 이 이어 고친다(계획 판정 Q28): checks(tab·print·flicker·showcase)·sheet ──────────────────────

/** 'rgb(1, 2, 3)'·'rgba(1, 2, 3, 0.5)'·'rgb(1 2 3 / 50%)' → [r, g, b, a] (읽지 못하면 null) */
export function parseRgb(s) {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(String(s ?? '').trim())
  if (!m) return null
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
  return [Number(m[1]), Number(m[2]), Number(m[3]), a]
}
const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const relLum = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b)
/** WCAG 대비 — src/lib/settings/accent.ts 의 contrastRatio 와 같은 식(.mjs 는 TS 를 import 하지 못해 옮겼다)
 *  @param {number[]} a @param {number[]} b */
export function contrastRgb(a, b) {
  const x = relLum(a)
  const y = relLum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/** 반투명 색을 불투명 배경 위에 합성 @param {number[]} fg [r, g, b, a] @param {number[]} bg [r, g, b, …] */
export function blend(fg, bg) {
  const a = fg[3] ?? 1
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
}
/**
 * 계산된 box-shadow → 번짐 고리 목록(순수) — x·y·흐림 0 이고 퍼짐 ≥ 1px 인 그림자만(Tailwind ring·ring-offset 유틸이 이 모양이다).
 * 색 함수 안의 쉼표로 쪼개지 않는다. 브라우저로 원문을 보내 같은 함수로 읽는다(checkTab)
 * @param {string} shadow @returns {{ color: string, width: number }[]}
 */
export function ringsOf(shadow) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of String(shadow ?? '')) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  const out = []
  for (const raw of parts) {
    const p = raw.trim()
    const m = /^([a-z-]+\([^)]*\)|#[0-9a-fA-F]+|[a-z]+)\s+(.*)$/.exec(p)
    if (!m || m[1] === 'none') continue
    const nums = m[2].split(/\s+/).filter((x) => x !== 'inset').map((x) => parseFloat(x))
    if (nums.length < 4 || nums.some((n) => Number.isNaN(n))) continue
    const [x, y, blur, spread] = nums
    if (x === 0 && y === 0 && blur === 0 && spread >= 1) out.push({ color: m[1], width: spread })
  }
  return out
}
/** 포커스 한 걸음 — 외곽선(스타일 ≠ none, 폭 ≥ 1px) 또는 번짐 고리(ring) 가운데 하나가 바깥 배경과 3:1 이상(D50, WCAG 2.4.7·1.4.11).
 *  색은 rgb()/rgba() 로 받는다(브라우저 쪽에서 캔버스로 정규화 — oklab 등은 parseRgb 가 읽지 못한다) */
/** @param {{ outlineStyle: string, outlineWidth: string, outlineColor: string, background: string, rings?: { color: string, width: number }[] }} s */
export function focusVerdict({ outlineStyle, outlineWidth, outlineColor, background, rings = [] }) {
  const bg = parseRgb(background)
  if (!bg) return { ok: false, why: `배경색을 읽지 못함(${background})` }
  const ratioOf = (color) => { const c = parseRgb(color); return c ? contrastRgb(blend(c, bg), bg) : null }
  const hasOutline = Boolean(outlineStyle) && outlineStyle !== 'none' && parseFloat(outlineWidth) >= 1
  const tries = [...(hasOutline ? [{ via: 'outline', color: outlineColor }] : []), ...rings.filter((r) => r.width >= 1).map((r) => ({ via: 'ring', color: r.color }))]
  if (!tries.length) return { ok: false, why: '외곽선 없음(고리도 없음)' }
  let best = null
  for (const t of tries) {
    const ratio = ratioOf(t.color)
    if (ratio === null) continue
    if (ratio >= 3) return { ok: true, via: t.via, ratio }
    if (!best || ratio > best.ratio) best = { via: t.via, ratio }
  }
  return best ? { ok: false, why: `대비 ${best.ratio.toFixed(2)} < 3(${best.via})`, ratio: best.ratio } : { ok: false, why: `색을 읽지 못함(${tries.map((t) => t.color).join(' / ')})` }
}
/** 깜빡임 — 페인트 전(DOMContentLoaded) 클래스 = 하이드레이션 뒤 클래스 = 기대값 */
export function flickerVerdict({ atDcl, afterHydrate, expected }) {
  if (atDcl !== afterHydrate) return { ok: false, why: `첫 페인트 ${atDcl} → 하이드레이션 뒤 ${afterHydrate}` }
  if (afterHydrate !== expected) return { ok: false, why: `기대 ${expected} ≠ ${afterHydrate}` }
  return { ok: true }
}
/**
 * Tab 순회가 대상에 닿았는가(판정 Q43) — 대상 선택자마다 그 선택자에 맞은 걸음 수, 0 이면 unreached(판정 실패)
 * @param {{ matched?: string[] }[]} steps @param {string[]} targets
 */
export function tabCoverage(steps, targets) {
  const hits = Object.fromEntries(targets.map((t) => [t, steps.filter((s) => (s.matched ?? []).includes(t)).length]))
  return { hits, unreached: targets.filter((t) => hits[t] === 0) }
}
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
/**
 * 대조표 행 — 머리 라벨의 장마다 diff 판정(same·near·diff·problem — 수정 라운드 뒤 판정, ui1-addendum §2)·axe 위반을 붙이고, diff 가 기준에만
 * 있다고 본 장(missing)도 행으로 더한다(머리에 없으니 기준 이미지만 — 빠진 장을 표에서 숨기지 않는다). 차이율 큰 순, 차이가 없으면 new
 * @param {{ rows: any[] }} head @param {any[]} [diff] @param {any[]} [axe]
 * @returns {{ key: string, width: number, height: number, theme: string, file: string, ratio: number | null, verdict: string, reasons: string[], axe: number | null, h1Count: number | null, problems: string[], inHead: boolean }[]}
 */
export function sheetRows(head, diff = [], axe = []) {
  const same = (x, r) => x.key === r.key && x.width === r.width && x.height === r.height && x.theme === r.theme
  const fromHead = head.rows.map((r) => {
    const d = diff.find((x) => same(x, r) && x.verdict !== 'missing')
    const a = axe.find((x) => same(x, r))
    return { key: r.key, width: r.width, height: r.height, theme: r.theme, file: r.file, ratio: d?.ratio ?? null, verdict: d?.verdict ?? 'new', reasons: d?.reasons ?? [],
      axe: a ? a.violations : null, h1Count: r.h1Count, problems: r.problems ?? [], inHead: true }
  })
  const gone = diff.filter((d) => d.verdict === 'missing' && !head.rows.some((r) => same(d, r))).map((d) => ({ key: d.key, width: d.width, height: d.height,
    theme: d.theme, file: d.file, ratio: null, verdict: 'missing', reasons: d.reasons ?? [], axe: null, h1Count: null, problems: [], inHead: false }))
  return [...fromHead.sort((x, y) => (y.ratio ?? -1) - (x.ratio ?? -1)), ...gone]
}
/** 대조표 '볼 목록' 순서 — 문제 → 다름 → 빠짐 → 근소(near 도 눈으로 본다 — ui1-addendum §2) */
const SHEET_LOOK = ['problem', 'diff', 'missing', 'near']
/**
 * 대조표 절의 머리 요약(순수) — 판정별 수와 '볼 목록'(problem → diff → missing → near, 같은 판정 안에서는 차이율 큰 순)
 * @template {{ verdict: string, ratio: number | null }} R @param {R[]} rows
 */
export function sheetSummary(rows) {
  const count = (v) => rows.filter((r) => r.verdict === v).length
  return { same: count('same'), near: count('near'), diff: count('diff'), problem: count('problem'), missing: count('missing'), new: count('new'),
    look: rows.filter((r) => SHEET_LOOK.includes(r.verdict))
      .sort((x, y) => SHEET_LOOK.indexOf(x.verdict) - SHEET_LOOK.indexOf(y.verdict) || (y.ratio ?? -1) - (x.ratio ?? -1)) }
}
/**
 * axe 절(판정 Q45) — 머리·추가 라벨의 모든 테마 행(다크 포함)을 테마·위반 수 순으로
 * @param {any[]} rows
 * @returns {{ label: string | null, key: string, width: number, height: number, theme: string, violations: number }[]}
 */
export function axeTable(rows) {
  return rows.map((r) => ({ label: r.label ?? null, key: r.key, width: r.width, height: r.height, theme: r.theme, violations: r.violations ?? 0 }))
    .sort((a, b) => (a.theme === b.theme ? b.violations - a.violations : a.theme < b.theme ? -1 : 1))
}
/**
 * checks 절(판정 Q43·Q45) — 머리 라벨 폴더의 tab·print·flicker·showcase JSON(없으면 null) → 대조표 요약
 * @param {{ tab?: any, print?: any, flicker?: any, showcase?: any }} src
 */
export function checksSummary({ tab = null, print = null, flicker = null, showcase = null }) {
  return {
    /** @type {{ key: string, theme: string, failed: number, unreached: string[], ok: boolean }[] | null} */
    tab: tab ? tab.rows.map((r) => ({ key: r.key, theme: r.theme, failed: r.failed ?? 0, unreached: r.unreached ?? [], ok: (r.failed ?? 0) === 0 })) : null,
    /** @type {{ key: string, theme: string, texts: number, low: number, ok: boolean }[] | null} */
    print: print ? print.rows.map((r) => ({ key: r.key, theme: r.theme, texts: r.texts, low: r.lowContrast, ok: r.texts > 0 && r.lowContrast === 0 })) : null,
    /** @type {{ key: string, pref: string, ok: boolean, why: string }[] | null} */
    flicker: flicker ? flicker.map((r) => ({ key: r.key, pref: r.pref, ok: Boolean(r.ok), why: r.why ?? '' })) : null,
    /** @type {{ pairs: number, unequal: string[] } | null} */
    showcase: showcase ? { pairs: showcase.length, unequal: showcase.filter((p) => !p.equal).map((p) => p.name) } : null,
  }
}

async function checkTab(opts) {
  const res = await forEachShot({ ...opts, sizes: [[1440, 900]] }, async (page, { r, theme, outDir }) => {
    const dir = join(outDir, opts.label, 'tab')
    mkdirSync(dir, { recursive: true })
    /** @type {string[]} */
    const targets = r.focusTargets ?? []
    const steps = []
    // 한 번 걷기 — 걸음마다 초점 요소의 외곽선·바깥 배경, 그리고 어느 대상 선택자에 맞는지(판정 Q43)
    const walk = async (pass, count) => {
      for (let i = 0; i < count; i++) {
        await page.keyboard.press('Tab')
        const s = await page.evaluate(({ tg, ringsSrc }) => {
          const el = document.activeElement
          if (!el || el === document.body || el === document.documentElement) return null
          // 전환(transition)이 outline-color 를 currentColor 에서 옮기는 중이면 첫 값이 글자색이다 — 끝낸 뒤 읽는다
          for (const a of el.getAnimations()) { try { a.finish() } catch { /* 끝낼 수 없는 애니메이션 */ } }
          // 계산색을 rgba 로 — oklab·color-mix 결과도 캔버스 한 픽셀로 sRGB 에 내린다
          const cv = document.createElement('canvas')
          cv.width = 1
          cv.height = 1
          const ctx = cv.getContext('2d', { willReadFrequently: true })
          const rgba = (c) => {
            ctx.clearRect(0, 0, 1, 1)
            ctx.fillStyle = 'rgba(0, 0, 0, 0)'
            ctx.fillStyle = c
            ctx.fillRect(0, 0, 1, 1)
            const d = ctx.getImageData(0, 0, 1, 1).data
            return [d[0], d[1], d[2], d[3] / 255]
          }
          const str = (c) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`
          // 바깥 배경 = 조상 배경을 불투명할 때까지 모아 아래부터 합성(반투명 머리 띠 등)
          const layers = []
          for (let node = el.parentElement; node; node = node.parentElement) {
            const c = rgba(getComputedStyle(node).backgroundColor)
            if (c[3] > 0) layers.push(c)
            if (c[3] >= 0.999) break
          }
          let bg = [255, 255, 255, 1]
          for (const c of layers.reverse()) bg = [c[0] * c[3] + bg[0] * (1 - c[3]), c[1] * c[3] + bg[1] * (1 - c[3]), c[2] * c[3] + bg[2] * (1 - c[3]), 1]
          const cs = getComputedStyle(el)
          const rings = new Function(`return (${ringsSrc})`)()(cs.boxShadow).map((r) => ({ color: str(rgba(r.color)), width: r.width }))
          const rect = el.getBoundingClientRect()
          return { tag: el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
            outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: str(rgba(cs.outlineColor)), background: str(bg), rings,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, matched: tg.filter((t) => el.matches(t)) }
        }, { tg: targets, ringsSrc: ringsOf.toString() })
        if (!s) continue
        const v = focusVerdict(s)
        const { x, y, width, height } = s.rect
        if (i < 12 && width > 0 && height > 0 && x >= 0 && y >= 0 && x + width <= 1440 && y + height <= 900) {
          await page.screenshot({ path: join(dir, `${r.key}-${theme}-${pass}-${String(i).padStart(2, '0')}.png`),
            clip: { x: Math.max(0, x - 8), y: Math.max(0, y - 8), width: Math.min(1440 - Math.max(0, x - 8), width + 16), height: Math.min(900 - Math.max(0, y - 8), height + 16) } })
        }
        steps.push({ pass, i, tag: s.tag, label: s.label, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, rings: s.rings, background: s.background, matched: s.matched, ...v })
      }
    }
    // ① 첫머리 25걸음 — click 행(모달·팝오버)은 모서리를 누르면 배경이 닫으므로 누르지 않는다. 초점만 문서로 되돌린다
    if (!clickSteps(r).length) await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
    await walk('top', 25)
    // ② focusStart 의 첫 요소에서 15걸음 — 비초점 요소면 임시 tabindex=-1 을 달아 시작점으로만 쓴다
    const startProblems = []
    if (r.focusStart) {
      const started = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!(el instanceof HTMLElement)) return false
        if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
        el.focus()
        return document.activeElement === el
      }, r.focusStart)
      if (started) await walk('start', 15)
      else startProblems.push(`focus-start-missing:${r.focusStart}`)
    }
    const cov = tabCoverage(steps, targets)
    return { steps, coverage: cov.hits, unreached: cov.unreached, startProblems,
      failed: steps.filter((s) => !s.ok).length + cov.unreached.length + startProblems.length }
  })
  writeFileSync(join(res.outDir, opts.label, 'tab.json'), JSON.stringify({ browser: res.browserVersion, buildId: res.buildId, kstDate: kstToday(), rows: res.rows }, null, 2))
  console.log(JSON.stringify({ ok: true, kind: 'tab', pages: res.rows.length,
    failedSteps: res.rows.flatMap((r) => r.steps.filter((s) => !s.ok).map((s) => `${r.key}/${r.theme}#${s.pass}${s.i} ${s.tag} ${s.label}: ${s.why}`)),
    unreached: res.rows.flatMap((r) => [...r.unreached.map((x) => `${r.key}/${r.theme} target-unreached:${x}`), ...r.startProblems.map((x) => `${r.key}/${r.theme} ${x}`)]) }))
}

async function checkPrint(opts) {
  const res = await forEachShot({ ...opts, sizes: [[1440, 900]] }, async (page, { r, theme, outDir }) => {
    await page.emulateMedia({ media: 'print' })
    await page.waitForTimeout(300)
    mkdirSync(join(outDir, opts.label), { recursive: true })
    const file = `print-${r.key}-${theme}.png`
    await page.screenshot({ path: join(outDir, opts.label, file) })
    const colors = await page.evaluate(() => [...document.querySelectorAll('.print-area *')]
      .filter((e) => e.childElementCount === 0 && (e.textContent || '').trim()).slice(0, 300).map((e) => getComputedStyle(e).color))
    const white = [255, 255, 255, 1]
    const ratios = colors.map(parseRgb).filter(Boolean).map((c) => contrastRgb(blend(c, white), white))
    return { file, texts: ratios.length, lowContrast: ratios.filter((x) => x < 4.5).length, minRatio: ratios.length ? Math.min(...ratios) : null }
  })
  writeFileSync(join(res.outDir, opts.label, 'print.json'), JSON.stringify({ browser: res.browserVersion, buildId: res.buildId, rows: res.rows }, null, 2))
  console.log(JSON.stringify({ ok: true, kind: 'print', rows: res.rows.map((r) => `${r.key}/${r.theme} texts ${r.texts} low ${r.lowContrast} min ${r.minRatio?.toFixed(2)}${r.problems.length ? ` problems ${r.problems.join('+')}` : ''}`) }))
}

/** 깜빡임 패스 — 서버 선호·쿠키 = pref, 컨텍스트 색 체계는 system 패스만 OS 다크(그 해석값이 기대값) */
const FLICKER_PASSES = Object.freeze([['light', 'light'], ['dark', 'dark'], ['system', 'dark']])

async function checkFlicker(opts) {
  const env = laneEnv({ base: opts.base })
  const { db, outDir, baseUrl } = env
  const doc = JSON.parse(readFileSync('scripts/ui-capture.routes.json', 'utf8'))
  const routes = selectRoutes(doc, opts)
  const seed = await resolveSeed(db)
  const sessions = await freshSessions(env, [...new Set(routes.map((r) => r.grade).filter((g) => g !== 'public'))])
  const values = { pid: seed.pid, minuteId: seed.minuteId, topicId: seed.topicId, inviteToken: seed.inviteToken, shareToken: seed.shareToken, wsSlug: seed.wsSlug }
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()
  const rows = []
  try {
    for (const [pref, scheme] of FLICKER_PASSES) {
      await setServerTheme(db, Object.values(sessions).map((s) => s.userId), pref, startPin(seed.pid))
      for (const r of routes) {
        const context = await browser.newContext(contextOptions({ width: 1440, height: 900, theme: scheme }))
        try {
          await routeCdn(context, join(outDir, 'cdn-cache'))
          const cookies = [...(r.grade === 'public' ? [] : sessions[r.grade].cookies), { name: 'dflow-theme', value: pref }]
          await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: baseUrl })))
          await context.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => { window.__themeAtDcl = document.documentElement.classList.contains('dark') }, { once: true })
          })
          const page = await context.newPage()
          await page.goto(baseUrl + fillPath(r.path, values), { waitUntil: 'load', timeout: 60_000 })
          try { await page.waitForLoadState('networkidle', { timeout: 15_000 }) } catch { /* 폴링 화면 */ }
          await page.waitForTimeout(800)
          const seen = await page.evaluate(() => ({ atDcl: window.__themeAtDcl ? 'dark' : 'light', afterHydrate: document.documentElement.classList.contains('dark') ? 'dark' : 'light' }))
          const problems = pageProblems(await page.content())
          const v = problems.length ? { ok: false, why: `화면 문제 ${problems.join('+')}` } : flickerVerdict({ ...seen, expected: scheme })
          rows.push({ key: r.key, pref, scheme, ...seen, expected: scheme, ...v })
        } finally { await context.close() }
      }
    }
  } finally { await browser.close() }
  mkdirSync(join(outDir, opts.label), { recursive: true })
  writeFileSync(join(outDir, opts.label, 'flicker.json'), JSON.stringify(rows, null, 2))
  console.log(JSON.stringify({ ok: true, kind: 'flicker', rows: rows.map((r) => `${r.key}/${r.pref} ${r.atDcl}→${r.afterHydrate} ${r.ok ? 'ok' : r.why}`) }))
}

async function checkShowcase(opts) {
  const pick = (page, column) => page.evaluate((col) => {
    const SAMPLES = [['column', '', 'backgroundColor'], ['primary', '[data-sample="primary"]', 'backgroundColor'],
      ['legacyPrimary', '[data-sample="legacy-btn-primary"]', 'backgroundColor'], ['notify', '[data-badge="notify"]', 'backgroundColor'],
      ['review', '[data-badge="review"]', 'backgroundColor'], ['urgent', '[data-badge="urgent"]', 'backgroundColor'],
      ['urgentText', '[data-badge="urgent"]', 'color'], ['errorIcon', '[data-status-kind="partial_error"] svg', 'color'],
      ['selectedRow', '[data-sample="selected-error-focus-row"]', 'backgroundColor']]
    const root = document.querySelector(`[data-showcase-column="${col}"]`)
    return Object.fromEntries(SAMPLES.map(([name, sel, prop]) => {
      const el = sel ? root?.querySelector(sel) : root
      return [name, el ? getComputedStyle(el)[prop] : null]
    }))
  }, column)
  // 라이트 페이지(html 에 dark 없음)의 다크 열 = 중첩 다크, 다크 페이지(html.dark)의 라이트 열 = 페이지 전체 다크를 상속한 같은 컴포넌트(판정 Q37)
  const res = await forEachShot({ ...opts, routes: ['admin-ui-states'], theme: ['light', 'dark'], sizes: [[1440, 900]] },
    async (page, { theme }) => ({ values: await pick(page, theme === 'light' ? 'dark' : 'light') }))
  const bad = res.rows.filter((r) => r.problems.length).map((r) => `${r.theme}:${r.problems.join('+')}`)
  if (bad.length) throw new Error(`쇼케이스 화면 문제 — ${bad.join('; ')}`)
  const nested = res.rows.find((r) => r.theme === 'light')?.values ?? {}
  const whole = res.rows.find((r) => r.theme === 'dark')?.values ?? {}
  const pairs = Object.keys(nested).map((k) => ({ name: k, nestedDark: nested[k], pageDark: whole[k] ?? null, equal: nested[k] !== null && nested[k] === whole[k] }))
  mkdirSync(join(res.outDir, opts.label), { recursive: true })
  writeFileSync(join(res.outDir, opts.label, 'showcase.json'), JSON.stringify(pairs, null, 2))
  console.log(JSON.stringify({ ok: true, kind: 'showcase', pairs: pairs.length, unequal: pairs.filter((p) => !p.equal) }))
}

async function cmdChecks(opts) {
  if (!opts.label) throw new Error('--label 이 필요하다')
  const kind = opts.positional[0]
  const run = { tab: checkTab, print: checkPrint, flicker: checkFlicker, showcase: checkShowcase }[kind ?? '']
  if (!run || opts.positional.length !== 1) throw new Error('사용: checks tab|print|flicker|showcase --label <l> [--routes …] [--theme …]')
  await run(opts)
}

async function cmdSheet(opts) {
  if (!opts.label) throw new Error('--label 이 필요하다(머리 라벨)')
  // 위치 인자: <기준 라벨> [추가 라벨…] — 추가 라벨은 meta.json(이미지 절)이나 axe.json(axe 절)을 가진 라벨(판정 Q45). 형식은 parseArgs 가 본다
  const [baseLabel, ...extras] = opts.positional
  if (!baseLabel) throw new Error('사용: sheet <기준 라벨> [추가 라벨…] --label <머리 라벨>')
  const { outDir } = laneEnv()
  const readJson = (...p) => { const f = join(outDir, ...p); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null }
  const head = readJson(opts.label, 'meta.json')
  if (!head) throw new Error(`${opts.label}/meta.json 이 없다`)
  const diff = readJson(`diff-${baseLabel}--${opts.label}.json`)
  if (diff === null) throw new Error(`diff-${baseLabel}--${opts.label}.json 이 없다 — diff ${baseLabel} ${opts.label} 를 먼저(비교 절을 빈 채로 만들지 않는다)`)
  const axePool = [opts.label, ...extras].flatMap((l) => (readJson(l, 'axe.json')?.rows ?? []).map((r) => ({ ...r, label: l })))
  const sections = [{ label: opts.label, baseLabel, rows: sheetRows(head, diff, axePool) }]
  for (const l of extras) {
    const m = readJson(l, 'meta.json')
    if (m) sections.push({ label: l, baseLabel: null, rows: sheetRows(m, [], axePool) })
    else if (!readJson(l, 'axe.json')) throw new Error(`${l}: meta.json·axe.json 둘 다 없다`)
  }
  const checks = checksSummary({ tab: readJson(opts.label, 'tab.json'), print: readJson(opts.label, 'print.json'),
    flicker: readJson(opts.label, 'flicker.json'), showcase: readJson(opts.label, 'showcase.json') })
  const img = (label, file) => `<img loading="lazy" src="${escapeHtml(`${label}/${file}`)}" alt="">`
  const okCell = (ok) => (ok ? '통과' : '<b>실패</b>')
  const table = (cols, rows) => `<table><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>\n${rows.join('\n')}\n</tbody></table>`
  const where = (r) => `${r.key}@${r.width}x${r.height}/${r.theme}`
  const sectionHtml = (s) => {
    const sum = sheetSummary(s.rows)
    const head2 = `<h2>${escapeHtml(s.label)}${s.baseLabel ? ` — 기준 ${escapeHtml(s.baseLabel)} 과 비교` : ''} · 장 ${s.rows.length}`
      + (s.baseLabel ? ` · 다름 ${sum.diff} · 근소 ${sum.near} · 문제 ${sum.problem} · 빠짐 ${sum.missing} · 같음 ${sum.same} · 새 장 ${sum.new}` : '') + '</h2>'
    const look = s.baseLabel ? `<p>볼 목록(문제·다름·빠짐·근소): ${sum.look.length ? sum.look.map((r) => `${escapeHtml(where(r))} ${escapeHtml(r.verdict)} ${pctOf(r.ratio)}`).join(' · ') : '없음'}</p>` : ''
    const cols = ['라우트', '크기', '테마', '차이율', '판정', 'axe', 'h1', ...(s.baseLabel ? ['기준'] : []), '머리']
    const rows = s.rows.map((r) => {
      const notes = [...r.problems, ...r.reasons]
      return `<tr class="${escapeHtml(r.verdict)}"><td>${escapeHtml(r.key)}${notes.length ? `<br><small>${escapeHtml(notes.join(' '))}</small>` : ''}</td><td>${r.width}×${r.height}</td>`
        + `<td>${escapeHtml(r.theme)}</td><td>${pctOf(r.ratio)}</td><td>${escapeHtml(r.verdict)}</td><td>${r.axe ?? '—'}</td><td>${r.h1Count ?? '—'}</td>`
        + (s.baseLabel ? `<td>${r.verdict !== 'new' ? img(s.baseLabel, r.file) : ''}</td>` : '') + `<td>${r.inHead ? img(s.label, r.file) : '(머리에 없음)'}</td></tr>`
    })
    return [head2, look, table(cols, rows)].join('\n')
  }
  const html = [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
    `<title>${escapeHtml(opts.label)} 대조표</title>`,
    '<style>body{font:13px system-ui,sans-serif;margin:16px}table{border-collapse:collapse;width:100%;margin-bottom:24px}td,th{border:1px solid #ccc;padding:4px;vertical-align:top;text-align:left}img{max-width:360px;display:block}tr.diff,tr.problem,tr.missing{background:#fff3e0}tr.near{background:#fffde7}tr.same td{color:#555}</style>',
    '</head><body>',
    `<h1>${escapeHtml(opts.label)} 대조표</h1>`,
    `<p>기준 ${escapeHtml(baseLabel ?? '—')} · 머리 커밋 ${escapeHtml(head.commit)} · 빌드 ${escapeHtml(head.buildId ?? '—')} · 브라우저 ${escapeHtml(head.browser)} · KST ${escapeHtml(head.kstDate)} · 추가 라벨 ${escapeHtml(extras.join(', ') || '—')} · 쇼케이스 두 열 대조는 라이트 장으로 본다(판정 Q37)</p>`,
    ...sections.map(sectionHtml),
    '<h2>axe 대비 위반 — 모든 라벨·테마(다크 포함)</h2>',
    table(['라벨', '라우트', '크기', '테마', '위반'], axeTable(axePool).map((r) => `<tr><td>${escapeHtml(r.label ?? '—')}</td><td>${escapeHtml(r.key)}</td><td>${r.width}×${r.height}</td><td>${escapeHtml(r.theme)}</td><td>${r.violations}</td></tr>`)),
    '<h2>checks</h2>',
    checks.tab ? table(['Tab 라우트', '테마', '실패', '못 닿은 대상', '판정'], checks.tab.map((r) => `<tr><td>${escapeHtml(r.key)}</td><td>${escapeHtml(r.theme)}</td><td>${r.failed}</td><td>${escapeHtml(r.unreached.join(' · ') || '—')}</td><td>${okCell(r.ok)}</td></tr>`)) : '<p>tab.json 없음</p>',
    checks.print ? table(['인쇄 라우트', '테마', '글자', '4.5 미만', '판정'], checks.print.map((r) => `<tr><td>${escapeHtml(r.key)}</td><td>${escapeHtml(r.theme)}</td><td>${r.texts}</td><td>${r.low}</td><td>${okCell(r.ok)}</td></tr>`)) : '<p>print.json 없음</p>',
    checks.flicker ? table(['깜빡임 라우트', '선호', '판정', '이유'], checks.flicker.map((r) => `<tr><td>${escapeHtml(r.key)}</td><td>${escapeHtml(r.pref)}</td><td>${okCell(r.ok)}</td><td>${escapeHtml(r.why)}</td></tr>`)) : '<p>flicker.json 없음</p>',
    checks.showcase ? `<p>쇼케이스 계산색 대조 ${checks.showcase.pairs}쌍 · 불일치 ${escapeHtml(checks.showcase.unequal.join(', ') || '없음')}</p>` : '<p>showcase.json 없음</p>',
    '</body></html>',
  ].join('\n')
  writeFileSync(join(outDir, `${opts.label}-sheet.html`), html)
  console.log(JSON.stringify({ ok: true, sheet: join(outDir, `${opts.label}-sheet.html`), sections: sections.map((s) => `${s.label}:${s.rows.length}`),
    axeRows: axePool.length, checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v !== null])) }))
}

COMMANDS.checks = cmdChecks
COMMANDS.sheet = cmdSheet

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  const run = COMMANDS[cmd ?? '']
  if (!run) fail(`하위 명령: ${Object.keys(COMMANDS).join('|') || '(없음)'}`)
  try { await run(parseArgs(rest)) } catch (e) { fail(e instanceof Error ? e.message : String(e)) }
}
