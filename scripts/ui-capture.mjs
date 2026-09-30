// scripts/ui-capture.mjs — SP3b 캡처·눈확인 도구(스펙 D48·§3.4, 계획 판정 Q2~Q5·Q8·Q33). 로컬 레인 B 전용
// (api 54421 · db 54422 · 앱 3201, 기준 서버 3202). 하위 명령: seed · shoot · diff · axe (UI-1 이 checks·sheet 를 더한다).
// 순수 함수는 export 해 tests/scripts/ui-capture.test.ts 가 import 한다 — 최상위에서 파일·네트워크·env 를 건드리지 않는다(isMain 가드).
// Playwright 는 package.json 에 없다: `npx --yes -p playwright@1.58.2 node scripts/ui-capture.mjs …` 로 부르고 PATH 에서 찾는다.
// 주석에 설정 표·설정 RPC 이름을 따옴표로 적지 않는다(settings-writes 게이트가 원문을 센다).
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { assertNotForbidden, classifySupabaseUrl, localAdminEnv } from './lib/targets.mjs'
import { e2eBaseUrl, localClientEnv, pageProblems, redactInviteTokens } from './lib/e2e.mjs'
import { PROJECT_TOGGLE_IDS, SCRIPT_SCHEMA_VERSION } from './lib/settings-consts.mjs'
import { BOOTSTRAP_MODULE_IDS } from './lib/bootstrap-modules.mjs'

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

export const SEED_ACCOUNTS = Object.freeze({
  platformAdmin: 'ui-platform@example.com', wsAdmin: 'ui-wsadmin@example.com', member: 'ui-member@example.com', duo: 'ui-duo@example.com',
})
export const SEED_PROJECT = 'UI-CAPTURE'
export const SEED_WS_B = Object.freeze({ slug: 'ui-capture-b', name: '캡처 B 워크스페이스' })
export const LEVEL_LABELS_4 = Object.freeze(['단계', '작업', '활동', '세부'])
const TEAM_DEFS = [['PLN', '기획', '#4f46e5'], ['DSG', '설계', '#0276a8'], ['DEV', '개발', '#7c3aed'], ['QAS', '품질', '#a65b00'], ['OPS', '운영', '#0f766e']]
const FENCE = '`'.repeat(3)
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

/** shoot·seed 가 같은 값을 계산한다(저장하지 않는다 — 초대 토큰은 자격 증명이다) */
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
 * 결정적 시드 행(순수) — 같은 ctx 면 같은 행. 날짜는 ctx.today(KST) 상대값이라 캡처 쌍은 같은 KST 날짜 안에 찍는다.
 * WBS: 3단계 × 3작업 × 5활동 + 1.1.1 아래 세부 3 = 60행(깊이 4). 모든 행 is_owner_split=false 인데 세부 1.1.1.3 하나만 true(분리 부모 접힘 표본).
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
    const r = { id: id(`wbs:${code}`), project_id: pid, parent_id: parentId, code, name, level_idx: level, sort_order: ++sort,
      planned_start: null, planned_end: null, weight: null, actual_pct: null, milestone: false, is_owner_split: false, assignee_member_id: null, tags: null, ...extra }
    wbs.push(r)
    return r
  }
  const leaf = (code, name, parentId, level, p, t, a) => {
    const start = plusDays(today, -40 + (p - 1) * 25 + (t - 1) * 8 + (a - 1))
    const end = plusDays(start, 3)
    let pct = end < plusDays(today, -2) ? 100 : start <= today && today <= end ? 50 : 0
    if (code === '1.2.4' || code === '1.3.5') pct = 40                                              // 지연
    const extra = { planned_start: start, planned_end: end, weight: 1, actual_pct: pct,
      assignee_member_id: a === 1 ? ctx.memberIds.member : a === 2 ? ctx.memberIds.duo : null }
    if (code === '2.1.3') Object.assign(extra, { planned_start: plusDays(today, -2), planned_end: today, actual_pct: 60 })   // 오늘 마감
    if (code === '2.2.5') Object.assign(extra, { planned_start: plusDays(today, -2), planned_end: plusDays(today, 3), actual_pct: 50, tags: ['agent'] })   // 진행 · 에이전트 좌석(판정 Q34)
    if (code === '2.3.5') Object.assign(extra, { planned_start: plusDays(today, 5), planned_end: plusDays(today, 5), actual_pct: 0, milestone: true })
    if (code === '1.1.5') Object.assign(extra, { planned_start: plusDays(today, -30), planned_end: plusDays(today, -30), actual_pct: 100, milestone: true })
    return row(code, name, parentId, level, extra)
  }
  for (let p = 1; p <= 3; p++) {
    const ph = row(`${p}`, `${p}단계 ${['준비', '구축', '전환'][p - 1]}`, null, 0)
    for (let t = 1; t <= 3; t++) {
      const tk = row(`${p}.${t}`, `${['요구 정리', '화면 설계', '데이터 이관'][t - 1]} ${p}-${t}`, ph.id, 1)
      for (let a = 1; a <= 5; a++) {
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
  const leaves = wbs.filter((r) => r.weight === 1)
  const owners = leaves.map((r, i) => ({ wbs_item_id: r.id, team_id: teams[i % 5].id, kind: 'primary' }))
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
  const weeklyRows = [
    // this_issue/next_issue 도 표가 NOT NULL 이다. PostgREST 다중 insert 는 빠진 키를 기본값이 아니라 명시적 NULL 로
    // 채운다(열 목록은 행들의 키 합집합이다) — 두 행의 키 집합이 달라지면 없는 쪽이 NOT NULL 위반으로 죽는다.
    { id: id('weekly-row:1'), report_id: weeklyReport.id, section: '구축', module: '화면', sort_order: 1, this_content: '목록 화면 초안', this_issue: '', next_content: '상세 화면', next_issue: '' },
    { id: id('weekly-row:2'), report_id: weeklyReport.id, section: '전환', module: '데이터', sort_order: 2, this_content: '이관 규칙 정리', this_issue: '원천 누락 3건', next_content: '시험 이관', next_issue: '' },
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
  return { teams, wbs, owners, deps, issues, announcements, meetings, attendees, attendance, weeklyReport, weeklyRows, wikiTopic, wikiRevision, invite, runner, agentOrder, minutes }
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

/** 캡처 조건(스펙 §3.4) — 새 컨텍스트마다 같은 값 @param {{ width: number, height: number, theme: string }} s */
export function contextOptions({ width, height, theme }) {
  return { viewport: { width, height }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', colorScheme: theme }
}

/** 두 라벨이 비교 가능한가 — 같은 KST 날짜·시드 날짜·브라우저. 문제 목록(빈 배열이면 비교 가능) */
export function compareMeta(a, b) {
  return ['kstDate', 'seedDate', 'browser'].filter((k) => a?.[k] !== b?.[k]).map((k) => `${k} 다름: ${a?.[k]} ≠ ${b?.[k]}`)
}

/**
 * 라우트 고르기 — --routes 가 있으면 그 키만, 없으면 since 집합 안의 행(until 이 집합에 들면 뺀다).
 * JSDoc 이 없으면 TS 호출부의 콜백 인자가 암묵 any 가 된다(allowJs, checkJs 없음).
 * @template {{ key: string, since: string, until?: string }} R
 * @param {{ routes: R[] }} doc @param {{ routes: string[] | null, since: string[] }} sel @returns {R[]}
 */
export function selectRoutes(doc, { routes, since }) {
  if (routes) {
    const miss = routes.filter((k) => !doc.routes.some((r) => r.key === k))
    if (miss.length) throw new Error(`routes.json 에 없는 키: ${miss.join(',')}`)
    return doc.routes.filter((r) => routes.includes(r.key))
  }
  return doc.routes.filter((r) => since.includes(r.since) && !(r.until && since.includes(r.until)))
}

/** 한 장의 판정 — 글꼴 무효는 비교 제외, 크기 다름, SAME_RATIO 이하는 같음(판정 Q33) */
export function diffVerdict({ ratio, fontA, fontB }) {
  if (fontA !== 'ok' || fontB !== 'ok') return 'skip-font'
  if (ratio === null || ratio === undefined) return 'skip-size'
  return ratio <= SAME_RATIO ? 'same' : 'diff'
}

/** @type {Record<string, (opts: ReturnType<typeof parseArgs>) => Promise<void>>} */
export const COMMANDS = {}

/** 좌표 — cwd 는 레인 B 워크트리(래퍼). service_role·anon·앱 주소·산출 폴더 */
export function laneEnv() {
  const envText = readFileSync('.env.local', 'utf8')
  const admin = localAdminEnv(envText)
  const target = laneTarget({ localDbUrl: process.env.LOCAL_DB_URL, supabaseUrl: admin.url, appUrl: process.env.NEXT_PUBLIC_APP_URL })
  const outDir = process.env.UI_CAPTURE_OUT_DIR
  if (!outDir) throw new Error('UI_CAPTURE_OUT_DIR 이 없다 — 래퍼(lane-b.env)로 부른다')
  return { envText, admin, target, outDir }
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

async function cmdSeed() {
  const { admin: coord } = laneEnv()
  const db = createClient(coord.url, coord.serviceRoleKey, { auth: { persistSession: false } })
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
  const wsRow = must('B 설정 revision', await db.from('workspace_settings').select('revision, values').eq('workspace_id', wsB.id).single())
  if (!Object.prototype.hasOwnProperty.call(wsRow.values ?? {}, 'modules.allowed')) {
    must('B 허용 모듈', await db.rpc('apply_workspace_settings', {
      p_workspace_id: wsB.id, p_expected_revision: wsRow.revision, p_command_id: randomUUID(), p_set: { 'modules.allowed': [...BOOTSTRAP_MODULE_IDS] },
      p_unset: [], p_actor: users.duo, p_schema_version: SCRIPT_SCHEMA_VERSION, p_source: 'internal',
    }))
  }

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
  console.log(JSON.stringify({ ok: true, today, projectId: pid, wsB: wsB.id, wbs: plan.wbs.length, minutes: plan.minutes.length }))
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

/** 시드 계정의 비밀번호를 새 임의 값(메모리)으로 바꾸고 앱과 같은 @supabase/ssr 쿠키 항아리로 로그인한다(판정 Q4) */
export async function freshSessions(db, anon, grades) {
  const sessions = {}
  for (const { grade, email } of resetTargets(grades, process.env.BOOTSTRAP_EMAIL || 'admin@example.com')) {
    const userId = await userIdByEmail(db, email)
    if (!userId) throw new Error(`시드 계정이 없다(${email}) — ui-capture.mjs seed 를 먼저`)
    const password = randomBytes(24).toString('base64')
    must(`비밀번호 재설정(${grade})`, await db.auth.admin.updateUserById(userId, { password }))
    const jar = new Map()
    const sb = createServerClient(anon.url, anon.anonKey, { cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    } })
    const { error } = await sb.auth.signInWithPassword({ email, password })
    if (error) throw new Error(`로그인 실패(${grade}): ${error.message}`)
    sessions[grade] = { userId, cookies: [...jar].map(([name, value]) => ({ name, value })) }
  }
  return sessions
}

/** 캡처 계정의 서버 테마를 명시로 쓴다 — 그 계정의 모든 소속 행(판정 Q8). PrefsSync 는 서버값이 이긴다 */
export async function setServerTheme(db, userIds, theme) {
  for (const userId of userIds) {
    const rows = must('소속 조회', await db.from('workspace_members').select('workspace_id').eq('user_id', userId))
    for (const { workspace_id } of rows) {
      const cur = must('선호 조회', await db.from('user_preferences').select('prefs').eq('user_id', userId).eq('workspace_id', workspace_id).maybeSingle())
      must('선호 쓰기', await db.from('user_preferences').upsert(
        { user_id: userId, workspace_id, prefs: { ...(cur?.prefs ?? {}), theme }, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,workspace_id' },
      ))
    }
  }
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

/** 라우트 × 테마 × 크기마다 새 컨텍스트(캐시 없음)로 열고 visit(page, info) 의 결과를 rows 로 모은다 */
export async function forEachShot(opts, visit) {
  const { envText, admin: coord, target, outDir } = laneEnv()
  const baseUrl = opts.base ? e2eBaseUrl(opts.base) : target.appUrl
  const anon = localClientEnv(envText)
  const db = createClient(coord.url, coord.serviceRoleKey, { auth: { persistSession: false } })
  const doc = JSON.parse(readFileSync('scripts/ui-capture.routes.json', 'utf8'))
  const routes = selectRoutes(doc, opts)
  const seed = await resolveSeed(db)
  const grades = [...new Set(routes.map((r) => r.grade).filter((g) => g !== 'public'))]
  const sessions = await freshSessions(db, anon, grades)
  const values = { pid: seed.pid, minuteId: seed.minuteId, topicId: seed.topicId, inviteToken: seed.inviteToken, shareToken: seed.shareToken, wsSlug: seed.wsSlug }
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()
  const browserVersion = browser.version()
  const rows = []
  try {
    for (const theme of opts.theme) {
      await setServerTheme(db, Object.values(sessions).map((s) => s.userId), theme)
      for (const r of routes) {
        for (const [width, height] of opts.sizes) {
          const context = await browser.newContext(contextOptions({ width, height, theme }))
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
            try { await page.waitForLoadState('networkidle', { timeout: 15_000 }) } catch { idle = false }
            await page.evaluate(() => document.fonts.ready.then(() => true))
            await page.waitForTimeout(500)
            let clickFailed = false
            if (r.click) {
              try { await page.locator(r.click).first().click({ timeout: 5_000 }); await page.waitForTimeout(400) } catch { clickFailed = true }
            }
            const missing = []   // 판정 Q35 — 그려져야 할 선택자(예: 좌석표의 막힘 좌석 — Q34)가 0개면 문제로 적는다
            for (const sel of r.expect ?? []) if ((await page.locator(sel).count()) === 0) missing.push(`expect-missing:${sel}`)
            const u = new URL(page.url())
            const expectFinal = r.expectFinal ? fillPath(r.expectFinal, values) : null
            const problems = [...pageProblems(await page.content()), ...(expectFinal && u.pathname + u.search !== expectFinal ? [`final:${redactInviteTokens(u.pathname + u.search)}`] : []),
              ...(clickFailed ? ['click-failed'] : []), ...missing]
            const base = { key: r.key, grade: r.grade, width, height, theme, idle, finalPath: redactInviteTokens(u.pathname + u.search), problems }
            rows.push({ ...base, ...(await visit(page, { r, width, height, theme, doc, outDir })) })
          } finally { await context.close() }
        }
      }
    }
  } finally { await browser.close() }
  return { rows, outDir, baseUrl, browserVersion, seed }
}

async function cmdShoot(opts) {
  if (!opts.label) throw new Error('--label 이 필요하다')
  const res = await forEachShot(opts, async (page, { r, width, height, theme, doc, outDir }) => {
    const fonts = await page.evaluate(() => {
      const f = [...document.fonts].filter((x) => x.family.replace(/["']/g, '') === 'Pretendard Variable')
      return { registered: f.length, loaded: f.filter((x) => x.status === 'loaded').length, loading: f.filter((x) => x.status === 'loading').length }
    })
    const h1 = await page.evaluate(() => [...document.querySelectorAll('h1')].filter((e) => e.checkVisibility()).map((e) => (e.textContent ?? '').trim().slice(0, 60)))
    const dir = join(outDir, opts.label)
    mkdirSync(dir, { recursive: true })
    const file = shotFileName({ key: r.key, width, height, theme })
    const style = maskStyle([...(doc.commonMask ?? []), ...(r.mask ?? [])])
    const buf = await page.screenshot({ path: join(dir, file), ...(style ? { style } : {}), animations: 'disabled', caret: 'hide' })
    return { file, sha256: createHash('sha256').update(buf).digest('hex'), font: fontVerdict(fonts), fonts, h1Count: h1.length, h1 }
  })
  const meta = { label: opts.label, commit: process.env.UI_CAPTURE_SERVER_COMMIT || gitHead(), scriptCommit: gitHead(), browser: res.browserVersion,
    kstDate: kstToday(), seedDate: res.seed.seedDate, baseUrl: res.baseUrl, themes: opts.theme, sizes: opts.sizes, rows: res.rows }
  writeFileSync(join(res.outDir, opts.label, 'meta.json'), JSON.stringify(meta, null, 2))
  console.log(JSON.stringify({ ok: true, label: opts.label, shots: res.rows.length, withProblems: res.rows.filter((x) => x.problems.length).map((x) => `${x.key}@${x.width}x${x.height}/${x.theme}:${x.problems.join('+')}`), fallbackFonts: res.rows.filter((x) => x.font !== 'ok').length }))
}

async function cmdDiff(opts) {
  const [baseLabel, headLabel] = opts.positional
  if (!baseLabel || !headLabel) throw new Error('사용: diff <기준 label> <대상 label>')
  const { outDir } = laneEnv()
  const A = JSON.parse(readFileSync(join(outDir, baseLabel, 'meta.json'), 'utf8'))
  const B = JSON.parse(readFileSync(join(outDir, headLabel, 'meta.json'), 'utf8'))
  const problems = compareMeta(A, B)
  if (problems.length) throw new Error(`비교할 수 없다 — ${problems.join('; ')}`)
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()
  const out = []
  try {
    const page = await browser.newPage()
    const fnSrc = pixelDiffRatio.toString()
    for (const b of B.rows) {
      const a = A.rows.find((x) => x.key === b.key && x.width === b.width && x.height === b.height && x.theme === b.theme)
      const at = { key: b.key, width: b.width, height: b.height, theme: b.theme }
      if (!a) { out.push({ ...at, ratio: null, verdict: 'new' }); continue }
      const ratio = await page.evaluate(async ({ pa, pb, src }) => {
        const load = async (b64) => {
          const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
          const c = new OffscreenCanvas(bmp.width, bmp.height)
          const ctx = c.getContext('2d')
          ctx.drawImage(bmp, 0, 0)
          return ctx.getImageData(0, 0, bmp.width, bmp.height)
        }
        return new Function(`return (${src})`)()(await load(pa), await load(pb))
      }, { pa: readFileSync(join(outDir, baseLabel, a.file)).toString('base64'), pb: readFileSync(join(outDir, headLabel, b.file)).toString('base64'), src: fnSrc })
      out.push({ ...at, ratio, verdict: diffVerdict({ ratio, fontA: a.font, fontB: b.font }) })
    }
  } finally { await browser.close() }
  const sorted = [...out].sort((x, y) => (y.ratio ?? -1) - (x.ratio ?? -1))
  const pct = (r) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(2)}%`)
  const md = [`# diff ${baseLabel}(${A.commit}) → ${headLabel}(${B.commit})`, '', '| 라우트 | 크기 | 테마 | 차이율 | 판정 |', '|---|---|---|---|---|',
    ...sorted.map((r) => `| ${r.key} | ${r.width}×${r.height} | ${r.theme} | ${pct(r.ratio)} | ${r.verdict} |`)].join('\n')
  writeFileSync(join(outDir, `diff-${baseLabel}--${headLabel}.json`), JSON.stringify(sorted, null, 2))
  writeFileSync(join(outDir, `diff-${baseLabel}--${headLabel}.md`), `${md}\n`)
  console.log(JSON.stringify({ ok: true, compared: out.length, diff: out.filter((r) => r.verdict === 'diff').length,
    skipped: out.filter((r) => r.verdict.startsWith('skip')).length, top10: sorted.slice(0, 10).map((r) => `${r.key}@${r.width}x${r.height}/${r.theme} ${pct(r.ratio)}`) }))
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

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  const run = COMMANDS[cmd ?? '']
  if (!run) fail(`하위 명령: ${Object.keys(COMMANDS).join('|') || '(없음)'}`)
  try { await run(parseArgs(rest)) } catch (e) { fail(e instanceof Error ? e.message : String(e)) }
}
