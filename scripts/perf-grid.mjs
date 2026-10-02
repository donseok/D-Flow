// scripts/perf-grid.mjs — SP3b UI-0 1만 행 합성 WBS 성능 기준선(스펙 §3.2·D51, 계획 판정 Q9). 로컬 레인 B 전용.
//   seed [--phases 1|3|5|10]
//                      워크스페이스 A 에 프로젝트 PERF-GRID(10) 또는 PERF-GRID-p<N> + WBS N×1,011행(깊이 4·팀 5·담당 20·고정 PRNG).
//                      이름으로 재사용 — 이미 있고 행 수가 맞으면 건너뛴다.
//   measure [--phases N] [--runs 5] [--timeout-ms 120000] [--base <url>] [--label <l>]
//                      비플랫폼 워크스페이스 관리자(ui-capture 시드 계정)로 /p/<id>/wbs 를 runs 회 새 컨텍스트로 열어
//                      ① 이동 → 첫 행 ② 첫 행까지 긴 작업 합 ③ 1,000행 스크롤 프레임 ④ 서버 HTML 시간(끝·TTFB)의 중앙값.
//                      첫 표시 뒤 DOM 행 수 ≠ 시드 행 수면 실패 exit 1(max_rows 잘림을 측정으로 삼지 않는다).
//                      timeout-ms 안에 메인 스레드가 풀려 첫 행이 보이지 않으면 그 run 은 오류가 아니라 '응답 없음' 결과다 —
//                      가상화 없이 전 행을 렌더하는 현재 상태의 기록(스펙 §3.2). 결과 파일을 쓴 뒤 exit 2.
//                      응답 뒤 단계(행 수 안정 대기·스크롤 측정)도 각각 timeout-ms 안에 끝나야 한다 — 넘으면 같은 '응답 없음'이고
//                      멈춘 단계를 stalledAt(load·settle·scroll)으로 남긴다(과제 5b — 한순간 응답 뒤 다시 막힌 run 이 끝없이 기다렸다).
//                      run 마다 브라우저를 새로 띄우고 닫기 소요·시간 초과를 표본에(D7). 시작 상태 = 측정 계정 선호 고정 객체(라이트)·
//                      테마 쿠키(D6), item_owners 총수 < max_rows(D12). 스크롤 = 1,000행 × 행 높이(D13).
// 사용: seed 는 node 로, measure 는 npx --yes -p playwright@1.58.2 node scripts/perf-grid.mjs measure … (래퍼 경유)
// DB·세션 클라이언트와 앱 주소(--base)는 ui-capture 의 laneEnv 가 만든다 — 이 파일은 클라이언트를 만들지 않는다(UI-0 안전 리뷰 P2-2).
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  KEY_RE, LEVEL_LABELS_4, SEED_ACCOUNTS, contextOptions, deterministicId, fail, fixedPrefs, freshSessions, kstToday, laneEnv, laneTarget,
  loadPlaywright, must, plusDays, setServerTheme, startPin, userIdByEmail,
} from './ui-capture.mjs'
import { median } from './lib/perf.mjs'
import { PROJECT_TOGGLE_IDS, SCRIPT_SCHEMA_VERSION } from './lib/settings-consts.mjs'

export const GRID_PROJECT = 'PERF-GRID'
export const GRID_SHAPE = Object.freeze({ phases: 10, tasks: 10, activities: 10, details: 9 })
export const GRID_PHASES = Object.freeze([1, 3, 5, 10])
const ROWS_PER_PHASE = 1 + GRID_SHAPE.tasks * (1 + GRID_SHAPE.activities * (1 + GRID_SHAPE.details))   // 1,011
export const CHECKPOINTS_MS = Object.freeze([5000, 15000, 30000, 60000])

/** --phases 값 → 1·3·5·10(기본 10). 그 밖은 거부 */
export function parsePhases(value) {
  if (value === undefined) return GRID_SHAPE.phases
  const n = /^\d+$/.test(String(value)) ? Number(value) : NaN
  if (!GRID_PHASES.includes(n)) throw new Error(`--phases 는 ${GRID_PHASES.join('·')} 중 하나다: ${value}`)
  return n
}
export const gridRowCount = (phases) => parsePhases(String(phases)) * ROWS_PER_PHASE
export const gridProjectName = (phases) => (parsePhases(String(phases)) === GRID_SHAPE.phases ? GRID_PROJECT : `${GRID_PROJECT}-p${phases}`)

/** 고정 시드 PRNG(0 ≤ x < 1) */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 모든 행이 같은 키 집합을 갖는다 — PostgREST 다중 insert 는 키 합집합으로 열을 만들고 없는 키를 NULL 로 보낸다
/** @param {{ projectId: string, today: string, teamIds: string[], memberIds: string[], phases?: number }} ctx */
export function gridRows({ projectId, today, teamIds, memberIds, phases = GRID_SHAPE.phases }) {
  parsePhases(String(phases))
  const rnd = mulberry32(20260929)
  const wbs = []
  const owners = []
  let sort = 0
  const add = (code, level, parentId, extra = {}) => {
    const r = { id: deterministicId(`perf-grid:${projectId}:${code}`), project_id: projectId, parent_id: parentId, code, name: `항목 ${code}`,
      level_idx: level, sort_order: ++sort, planned_start: null, planned_end: null, weight: null, actual_pct: null, is_owner_split: false, assignee_member_id: null, ...extra }
    wbs.push(r)
    return r
  }
  for (let p = 1; p <= phases; p++) {
    const ph = add(`${p}`, 0, null)
    for (let t = 1; t <= GRID_SHAPE.tasks; t++) {
      const tk = add(`${p}.${t}`, 1, ph.id)
      for (let a = 1; a <= GRID_SHAPE.activities; a++) {
        const ac = add(`${p}.${t}.${a}`, 2, tk.id)
        for (let d = 1; d <= GRID_SHAPE.details; d++) {
          const start = plusDays(today, Math.floor(rnd() * 180) - 90)
          const leaf = add(`${p}.${t}.${a}.${d}`, 3, ac.id, {
            planned_start: start, planned_end: plusDays(start, 1 + Math.floor(rnd() * 20)), weight: 1,
            actual_pct: [0, 25, 50, 75, 100][Math.floor(rnd() * 5)], assignee_member_id: memberIds[Math.floor(rnd() * memberIds.length)],
          })
          owners.push({ wbs_item_id: leaf.id, team_id: teamIds[Math.floor(rnd() * teamIds.length)], kind: 'primary' })
        }
      }
    }
  }
  return { wbs, owners }
}

/** @param {{ LOCAL_DB_URL?: string, supabaseUrl?: string, appUrl?: string }} env */
export function gridTarget(env) {
  return laneTarget({ localDbUrl: env.LOCAL_DB_URL, supabaseUrl: env.supabaseUrl, appUrl: env.appUrl })
}

export function rowCountVerdict(domRows, seedRows) {
  if (domRows !== seedRows) throw new Error(`첫 표시 뒤 DOM 행 ${domRows} ≠ 시드 행 ${seedRows} — max_rows 잘림·접힘·완료 숨김을 확인한다(D51)`)
}

/** 응답 없음 run 이 멈춘 단계 — load 응답 판정 전(첫 행·로드 완료) · settle 행 수 안정 대기 · scroll 스크롤 프레임 측정 */
export const STALL_STAGES = Object.freeze(['load', 'settle', 'scroll'])

/** 응답 없음 run 의 기록(순수) — 어느 단계에서 멈췄는지(stalledAt)를 남긴다. 그 밖의 단계 이름은 거부
 *  @param {string} stage @param {{ timeoutMs: number, domRowsAt: { atMs: number, rows: number | null }[], domRows?: number }} info */
export function stalledRun(stage, { timeoutMs, domRowsAt, domRows }) {
  if (!STALL_STAGES.includes(stage)) throw new Error(`멈춘 단계는 ${STALL_STAGES.join('·')} 가운데 하나다: ${stage}`)
  return { status: 'unresponsive', stalledAt: stage, timeoutMs, domRowsAt, ...(domRows === undefined ? {} : { domRows }) }
}

/** 약속을 기한과 겨룬다 — 기한 안에 끝나면 { ok: true, value }, 넘으면 { ok: false }. 기한 안의 거부는 그대로 거부한다(닫힌 페이지는
 *  결과가 아니라 오류). 먼저 끝나면 기한 타이머를 지운다. 진 약속은 컨텍스트를 닫을 때 거부로 끝나고 여기서 이미 받아 두었다
 *  @template T @param {Promise<T>} promise @param {number} ms @returns {Promise<{ ok: true, value: T } | { ok: false }>} */
export function withDeadline(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ ok: false }), ms)
    promise.then((value) => { clearTimeout(timer); resolve({ ok: true, value }) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

/** run 목록 → 응답 없음 여부·종료 코드·응답한 run 의 중앙값. 응답 없음은 오류(1)가 아니라 결과(2) */
export function classifyRuns(runs) {
  const okRuns = runs.filter((r) => r.status !== 'unresponsive')
  const unresponsive = okRuns.length !== runs.length
  return { unresponsive, exitCode: unresponsive ? 2 : 0, statuses: runs.map((r) => r.status), median: okRuns.length ? summarize(okRuns) : null }
}

const KEYS = ['firstRowMs', 'longTaskMs', 'frameAvgMs', 'framesOver50', 'htmlEndMs', 'ttfbMs', 'domRows']
/** run 들의 키별 중앙값 — null·없음(스크롤 여지 없음·첫 행 없음)은 그 키에서 빼고 뺀 수를 excluded 에 적는다(D14 — 0 으로 세면 중앙값이
 *  내려갔다). 값이 하나도 없으면 null
 *  @param {Record<string, unknown>[]} runs
 *  @returns {{ firstRowMs: number | null, longTaskMs: number | null, frameAvgMs: number | null, framesOver50: number | null, htmlEndMs: number | null,
 *    ttfbMs: number | null, domRows: number | null, excluded: Record<string, number> }} */
export function summarize(runs) {
  const excluded = {}
  const out = Object.fromEntries(KEYS.map((k) => {
    const vals = runs.map((r) => r[k]).filter((v) => v !== null && v !== undefined)
    if (vals.length < runs.length) excluded[k] = runs.length - vals.length
    return [k, vals.length ? median(vals) : null]
  }))
  return { ...out, excluded }
}

/** 프레임 간격 목록 → 통계(순수, D15) — 첫 간격(측정 시작 → 첫 rAF)은 프레임이 아니라 뺀다 @param {number[]} frames */
export function frameStats(frames) {
  const f = frames.slice(1)
  return { frameAvgMs: f.length ? f.reduce((a, b) => a + b, 0) / f.length : null, framesOver50: f.filter((x) => x > 50).length, frameCount: f.length }
}

/** 첫 행까지의 긴 작업 합(순수, D15) — 첫 행 전에 시작한 작업의 길이 합. 첫 행을 못 봤으면 null(0 이 아니다)
 *  @param {[number, number][]} tasks [시작, 길이] @param {number | null} firstRow */
export function longTaskBefore(tasks, firstRow) {
  if (firstRow === null || firstRow === undefined) return null
  return tasks.filter(([s]) => s < firstRow).reduce((sum, [, d]) => sum + d, 0)
}

/** 행 수 표본의 체크포인트(순수, D15) — 지난(≤ 경과) 체크포인트 가운데 아직 안 적은 첫 것, 상한 밖 체크포인트는 없다. 한 반복에 하나만 적고
 *  표본에는 실제 경과도 함께 남긴다 @param {number} elapsed @param {number} timeoutMs @param {number[]} taken */
export function dueCheckpoint(elapsed, timeoutMs, taken) {
  return CHECKPOINTS_MS.find((c) => c <= timeoutMs && c <= elapsed && !taken.includes(c))
}

/** '1,000행 스크롤'(스펙 §3.2 ③)은 행 수다(순수, D13) — 목표 = 1,000 × 행 높이, 한 프레임 10행. 픽셀 고정(40,000px)이면 UI-1 밀도·SPU2 그리드가
 *  행 높이를 바꿀 때 같은 이름의 지표가 다른 행 수를 잰다 @param {number | null} rowHeight */
export function scrollPlan(rowHeight) {
  if (!Number.isInteger(rowHeight) || rowHeight <= 0) throw new Error(`행 높이가 양의 정수가 아니다(${rowHeight}) — [data-row-id] 의 offsetHeight`)
  return { rowHeight, targetPx: 1000 * rowHeight, stepPx: 10 * rowHeight }
}

/** config.toml 의 [api] max_rows(순수, D12) — 래퍼가 20000 으로 고정한 값을 읽는다 @param {string} configText */
export function maxRowsOf(configText) {
  const m = /^max_rows\s*=\s*(\d+)\s*$/m.exec(configText)
  if (!m) throw new Error('supabase/config.toml 에 max_rows 가 없다 — 래퍼(lane-b-run.sh)로 부른다')
  return Number(m[1])
}

/** item_owners 총수 < max_rows(순수, D12) — 앱의 WBS 조회는 item_owners 를 프로젝트 거름·범위 없이 읽는다(src/lib/data/wbs.ts). 총수가 max_rows 에
 *  닿으면 담당 배지가 순서 없이 잘린 채 행 수 대조(wbs_items)는 통과하고 측정이 가벼워진다(D51) @param {number | null} count @param {number} maxRows */
export function ownersVerdict(count, maxRows) {
  if (!Number.isInteger(count)) throw new Error(`item_owners 총수를 읽지 못했다(${count})`)
  if (count >= maxRows) throw new Error(`item_owners ${count} 행 ≥ max_rows ${maxRows} — 앱의 무범위 담당 조회가 잘린다(D51). db:reset 뒤 필요한 규모만 시드한다`)
}

/** 측정 계정 선호값 확인(순수, D6) — 소속 행마다 prefs 가 고정 객체와 정확히 같은가. 다른 소속 id(소속이 없으면 '(소속 없음)')
 *  @param {{ workspace_id: string, prefs: unknown }[]} rows @param {Record<string, unknown>} want */
export function prefsMismatch(rows, want) {
  if (!rows.length) return ['(소속 없음)']
  // 깊이까지 키를 정렬해 비교한다 — jsonb 는 키를 길이·사전순으로 되돌려 주므로(최근 방문 {id, at} → {at, id}) 쓴 순서와 읽은 순서가 다르다. 배열 순서는 의미가 있어 그대로
  const canon = (v) => Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v
  const norm = (o) => JSON.stringify(canon(o ?? {}))
  return rows.filter((r) => norm(r.prefs) !== norm(want)).map((r) => r.workspace_id)
}

/** run 마다 브라우저를 새로 띄운다(D7) — 막힌 렌더러가 다음 run 을 잴 때 살아 있지 않게(프로세스 단위 격리). 결과 JSON 에 적는다 */
export const BROWSER_PER_RUN = true

/** 닫기(순수 조립, D7) — 단계마다 상한(ms)과 겨루고 넘으면 다음 단계로(컨텍스트 → 브라우저). 닫기 오류(이미 닫힘)는 삼킨다.
 *  { closeMs, closeTimedOut } 를 run 표본에 남긴다 @param {[() => Promise<unknown>, number][]} steps */
export async function timedClose(steps) {
  const t0 = Date.now()
  let timedOut = false
  for (const [step, ms] of steps) {
    const r = await withDeadline(Promise.resolve().then(step).catch(() => undefined), ms)
    if (!r.ok) timedOut = true
  }
  return { closeMs: Date.now() - t0, closeTimedOut: timedOut }
}

/** "--키 값" 인자 파서 — 알려진 키만 */
function flags(argv, known) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (!k.startsWith('--') || !known.includes(k.slice(2))) throw new Error(`알 수 없는 인자: ${k}`)
    if (argv[i + 1] === undefined) throw new Error(`${k} 값이 없다`)
    out[k.slice(2)] = argv[++i]
  }
  return out
}

/** measure 인자(순수) — 값 범위와 라벨 형식까지 본다. --label 은 산출 파일 이름이 되므로 KEY_RE 만(UI-0 안전 리뷰 P3-2).
 *  --base 는 여기서는 옮기기만 하고 판정은 laneEnv(앱 포트 허용 목록 — C-port)가 한다
 *  @param {string[]} argv @returns {{ phases: number, runs: number, timeoutMs: number, base: string | null, label: string }} */
export function measureArgs(argv) {
  const f = flags(argv, ['phases', 'runs', 'timeout-ms', 'base', 'label'])
  const opts = { phases: parsePhases(f.phases), runs: f.runs === undefined ? 5 : Number(f.runs),
    timeoutMs: f['timeout-ms'] === undefined ? 120_000 : Number(f['timeout-ms']), base: f.base ?? null, label: f.label ?? 'ui0' }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Error('--runs 는 양의 정수')
  if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs < 1000) throw new Error('--timeout-ms 는 1000 이상의 정수')
  if (!KEY_RE.test(opts.label)) throw new Error(`--label 형식 밖: ${opts.label}`)
  return opts
}

async function cmdSeed(argv) {
  const phases = parsePhases(flags(argv, ['phases']).phases)
  const name = gridProjectName(phases)
  const expectRows = gridRowCount(phases)
  const { db } = laneEnv()
  const today = kstToday()
  const wsA = must('워크스페이스 A', await db.from('workspaces').select('id').eq('slug', (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()).single())
  const actor = await userIdByEmail(db, SEED_ACCOUNTS.wsAdmin)
  if (!actor) throw new Error('ui-capture seed 를 먼저 — 행위자(워크스페이스 관리자) 계정이 없다')
  let project = must('프로젝트 조회', await db.from('projects').select('id').eq('workspace_id', wsA.id).eq('name', name).maybeSingle())
  if (project) {
    const { count, error } = await db.from('wbs_items').select('id', { count: 'exact', head: true }).eq('project_id', project.id)
    if (error) throw new Error(`행 수 조회: ${error.message}`)
    if (count !== expectRows) throw new Error(`${name} 가 이미 있으나 행 ${count} ≠ ${expectRows} — db:reset 부터(다시 넣으면 item_owners 가 max_rows 를 넘을 수 있다)`)
    console.log(JSON.stringify({ ok: true, reused: true, name, projectId: project.id, rows: count }))
    return
  }
  const created = must('프로젝트 생성', await db.rpc('create_project_with_settings', {
    p_workspace_id: wsA.id, p_name: name, p_start_date: plusDays(today, -90), p_end_date: plusDays(today, 120), p_description: `perf-grid seed ${today}`,
    p_values: { 'core.level_labels': [...LEVEL_LABELS_4], 'modules.enabled': [...PROJECT_TOGGLE_IDS] },
    p_copy_from: null, p_actor: actor, p_command_id: randomUUID(), p_schema_version: SCRIPT_SCHEMA_VERSION,
  }))
  project = { id: created.project_id }
  const teamIds = []
  for (let i = 1; i <= 5; i++) {
    const id = deterministicId(`perf-grid:${project.id}:team:${i}`)
    must('팀', await db.from('teams').insert({ id, workspace_id: wsA.id, project_id: project.id, code: `G${i}`, name: `그리드 팀 ${i}`, color: '#315cdb', sort_order: i }))
    teamIds.push(id)
  }
  const memberIds = []
  for (let i = 1; i <= 20; i++) {                // 사람은 워크스페이스 단위 — 다른 규모의 시드가 만든 사람을 다시 쓴다
    const email = `grid-member-${String(i).padStart(2, '0')}@example.com`
    let person = must('사람 조회', await db.from('people').select('id').eq('workspace_id', wsA.id).eq('email', email).maybeSingle())
    if (!person) person = must('사람', await db.from('people').insert({ workspace_id: wsA.id, email, display_name: `담당 ${i}` }).select('id').single())
    memberIds.push(must('명단', await db.from('project_members').insert({ project_id: project.id, person_id: person.id, access_role: null, active: true }).select('id').single()).id)
  }
  const { wbs, owners } = gridRows({ projectId: project.id, today, teamIds, memberIds, phases })
  for (let i = 0; i < wbs.length; i += 200) must(`wbs_items(${i})`, await db.from('wbs_items').insert(wbs.slice(i, i + 200)))
  for (let i = 0; i < owners.length; i += 500) must(`item_owners(${i})`, await db.from('item_owners').insert(owners.slice(i, i + 500)))
  console.log(JSON.stringify({ ok: true, name, projectId: project.id, rows: wbs.length, owners: owners.length }))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** page.evaluate 가 메인 스레드 점유로 안 돌아오면 null — 이 호출 자체에 짧은 timeout */
const probe = (page, ms = 3000) => Promise.race([
  page.evaluate(() => ({ ready: document.readyState, rows: document.querySelectorAll('[data-row-id]').length })).catch(() => null),
  sleep(ms).then(() => null),
])

/** 한 run(D7) — 브라우저를 새로 띄워 재고 닫는다. 막힌 렌더러가 다음 run 을 잴 때 살아 있지 않게(프로세스 격리 — 과제 5 의 3,033행 재측정에서
 *  무응답 뒤 run 이 느렸고 도구가 그 사실을 구분할 자료를 남기지 않았다). 닫기 소요·시간 초과(closeMs·closeTimedOut)를 표본에 남긴다 */
async function oneRun({ chromium, ...rest }) {
  const browser = await chromium.launch()
  const browserVersion = browser.version()
  const context = await browser.newContext(contextOptions({ width: 1440, height: 900, theme: 'light' }))
  let sample = null
  try {
    sample = await measureIn(context, rest)
  } finally {
    const closed = await timedClose([[() => context.close(), 10_000], [() => browser.close(), 15_000]])
    if (sample) sample = { ...sample, ...closed, browser: browserVersion }
  }
  return sample
}

/** 한 컨텍스트에서 한 번 잰다 — 응답하면 { status:'ok', … }, timeoutMs 안에 첫 행이 보이고 로드가 끝나지 않으면 { status:'unresponsive', stalledAt:'load', … }.
 *  '응답'은 page.evaluate 가 돌아오고 readyState=complete·행 ≥ 1 이다(메인 스레드가 풀렸다는 뜻). domRowsAt 은 5·15·30·60초 이후 첫 표본(실제 경과 함께).
 *  응답 뒤 단계(행 수 안정 대기 settle·스크롤 측정 scroll)도 각각 timeoutMs 와 겨룬다 — 한순간 응답으로 잡힌 뒤 메인 스레드가 다시 막히면
 *  시간 제한 없는 page.evaluate 를 끝없이 기다렸다(과제 5 의 5,055행 재측정 셋째 run 15분). 넘으면 그 단계로 stalledRun.
 *  스크롤은 1,000행(행 높이 × 1,000 — scrollPlan), 통계는 페이지가 돌려준 원자료로 node 가 낸다(frameStats·longTaskBefore — 단위 테스트) */
async function measureIn(context, { sessions, base, projectId, seedRows, timeoutMs }) {
  // 측정 시작 상태(D6) — 서버 선호(light, cmdMeasure 가 덮는다)와 같은 테마 쿠키(no-flash 가 첫 칠부터 라이트)
  await context.addCookies([...sessions.wsAdmin.cookies, { name: 'dflow-theme', value: 'light' }].map((c) => ({ name: c.name, value: c.value, url: base })))
  await context.addInitScript(() => {
    const g = { firstRow: null, longTasks: [] }
    window.__grid = g
    new PerformanceObserver((l) => { for (const e of l.getEntries()) g.longTasks.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
    const mo = new MutationObserver(() => { if (g.firstRow === null && document.querySelector('[data-row-id]')) { g.firstRow = performance.now(); mo.disconnect() } })
    mo.observe(document, { childList: true, subtree: true })
  })
  const page = await context.newPage()
  const t0 = Date.now()
  await page.goto(`${base}/p/${projectId}/wbs`, { waitUntil: 'commit', timeout: timeoutMs })
  const domRowsAt = []
  let responsive = false
  while (Date.now() - t0 < timeoutMs) {
    const r = await probe(page)
    const el = Date.now() - t0
    const due = dueCheckpoint(el, timeoutMs, domRowsAt.map((d) => d.atMs))
    if (due !== undefined) domRowsAt.push({ atMs: due, elapsedMs: el, rows: r ? r.rows : null })
    if (r && r.ready === 'complete' && r.rows > 0) { responsive = true; break }
    await sleep(1000)
  }
  if (!responsive) return stalledRun('load', { timeoutMs, domRowsAt })
  const settle = async () => {
    let rows = -1
    for (let k = 0; k < 30; k++) {         // 행 수가 1초 동안 그대로면 첫 표시 완료
      const n = await page.evaluate(() => document.querySelectorAll('[data-row-id]').length)
      if (n === rows) break
      rows = n
      await page.waitForTimeout(1000)
    }
    return rows
  }
  const settled = await withDeadline(settle(), timeoutMs)
  if (!settled.ok) return stalledRun('settle', { timeoutMs, domRowsAt })
  const domRows = settled.value
  rowCountVerdict(domRows, seedRows)
  const height = await withDeadline(page.evaluate(() => document.querySelector('[data-row-id]')?.offsetHeight ?? null), timeoutMs)
  if (!height.ok) return stalledRun('scroll', { timeoutMs, domRowsAt, domRows })
  const plan = scrollPlan(height.value)
  const scrolled = await withDeadline(page.evaluate(async ({ targetPx, stepPx }) => {
    const g = window.__grid
    const nav = performance.getEntriesByType('navigation')[0]
    const el = document.querySelector('[data-wbs-scroll-region]')
    const frames = []
    if (el) {
      let last = performance.now()
      await new Promise((resolve) => {
        const tick = (t) => { frames.push(t - last); last = t; el.scrollTop += stepPx
          if (el.scrollTop >= targetPx || el.scrollTop + el.clientHeight >= el.scrollHeight) resolve(null); else requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
      })
    }
    return { firstRow: g.firstRow, longTasks: g.longTasks, frames, requestStart: nav.requestStart, responseStart: nav.responseStart, responseEnd: nav.responseEnd,
      scrolled: Boolean(el), scrollTop: el ? el.scrollTop : null }
  }, { targetPx: plan.targetPx, stepPx: plan.stepPx }), timeoutMs)
  if (!scrolled.ok) return stalledRun('scroll', { timeoutMs, domRowsAt, domRows })
  const m = scrolled.value
  if (!m.scrolled) throw new Error('[data-wbs-scroll-region] 이 없다 — 스크롤 주체가 바뀌었다')
  return { status: 'ok', firstRowMs: m.firstRow, longTaskMs: longTaskBefore(m.longTasks, m.firstRow), ...frameStats(m.frames),
    htmlEndMs: m.responseEnd - m.requestStart, ttfbMs: m.responseStart - m.requestStart, domRows, rowHeight: plan.rowHeight, scrollTargetPx: plan.targetPx, scrollTop: m.scrollTop }
}

/** @returns {Promise<number>} 종료 코드 — 0 응답, 2 응답 없음(측정은 됐다). 오류는 throw → 1 */
async function cmdMeasure(argv) {
  const opts = measureArgs(argv)
  const phases = opts.phases
  const name = gridProjectName(phases)
  const env = laneEnv({ base: opts.base })
  const { db, outDir, baseUrl: base } = env
  const wsA = must('워크스페이스 A', await db.from('workspaces').select('id').eq('slug', (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()).single())
  const project = must(name, await db.from('projects').select('id').eq('workspace_id', wsA.id).eq('name', name).single())
  const { count: seedRows, error: cErr } = await db.from('wbs_items').select('id', { count: 'exact', head: true }).eq('project_id', project.id)
  if (cErr) throw new Error(`행 수 조회: ${cErr.message}`)
  if (seedRows !== gridRowCount(phases)) throw new Error(`${name} 의 DB 행 ${seedRows} ≠ 기대 ${gridRowCount(phases)} — seed --phases ${phases} 를 다시`)
  // D12 — 앱의 무범위 item_owners 조회가 max_rows 에 닿으면 담당 배지가 잘린 채 행 수 대조는 통과한다
  const { count: ownersTotal, error: oErr } = await db.from('item_owners').select('wbs_item_id', { count: 'exact', head: true })
  if (oErr) throw new Error(`item_owners 총수 조회: ${oErr.message}`)
  const maxRows = maxRowsOf(readFileSync('supabase/config.toml', 'utf8'))
  ownersVerdict(ownersTotal, maxRows)
  const uid = await userIdByEmail(db, SEED_ACCOUNTS.wsAdmin)
  if (!uid) throw new Error('측정 계정(ui-wsadmin)이 없다 — ui-capture seed 를 먼저')
  const { count: stateRows, error: sErr } = await db.from('user_wbs_state').select('project_id', { count: 'exact', head: true }).eq('user_id', uid).eq('project_id', project.id)
  if (sErr) throw new Error(`user_wbs_state 조회: ${sErr.message}`)
  if (stateRows !== 0) throw new Error('측정 계정에 user_wbs_state 가 있다 — 접힘이 행 수를 바꾼다(판정 Q9)')
  // D6 — 측정 시작 상태: 측정 계정의 서버 선호를 shoot 와 같은 고정 객체(계정 행 = 라이트, 워크스페이스 행 = 최근 방문 측정 프로젝트 — SP3b D9)로 덮고 읽어 확인한다.
  // 캡처의 다크 패스가 남긴 테마·간트 일 폭·개요 번호·완료 숨김(판정 Q9)이 측정 조건을 바꾸지 않게. 쿠키 dflow-theme=light 는 run 마다
  const startPrefs = fixedPrefs('light')
  const pin = startPin(project.id)
  await setServerTheme(db, [uid], 'light', pin)
  const accountRows = must('계정 선호 확인', await db.from('account_preferences').select('prefs').eq('user_id', uid))
  const bad = [
    ...prefsMismatch(accountRows.map((r) => ({ workspace_id: '(계정 행)', prefs: r.prefs })), startPrefs).map((x) => (x === '(소속 없음)' ? '(계정 행 없음)' : x)),
    ...prefsMismatch(must('선호 확인', await db.from('user_preferences').select('workspace_id, prefs').eq('user_id', uid)), pin),
  ]
  if (bad.length) throw new Error(`측정 계정의 선호값이 고정 객체와 다르다(${bad.join(', ')}) — 측정 시작 상태를 확인한다`)
  const sessions = await freshSessions(env, ['wsAdmin'])
  const { chromium } = await loadPlaywright()
  const runs = []
  for (let i = 0; i < opts.runs; i++) runs.push(await oneRun({ chromium, sessions, base, projectId: project.id, seedRows, timeoutMs: opts.timeoutMs }))
  const verdict = classifyRuns(runs)
  const out = { label: opts.label, base, phases, project: name, projectRows: seedRows, runs: runs.length, timeoutMs: opts.timeoutMs,
    unresponsive: verdict.unresponsive, runStatuses: verdict.statuses, median: verdict.median, browser: runs[0]?.browser ?? null, kstDate: kstToday(),
    browserPerRun: BROWSER_PER_RUN, closeTimedOut: runs.filter((r) => r.closeTimedOut).length, itemOwners: ownersTotal, maxRows, startTheme: startPrefs.theme, llmKeys: env.llmKeys }
  writeFileSync(join(outDir, `perf-grid-${opts.label}.json`), JSON.stringify({ ...out, samples: runs }, null, 2))
  console.log(JSON.stringify(out))
  return verdict.exitCode
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  try {
    if (cmd === 'seed') await cmdSeed(rest)
    else if (cmd === 'measure') process.exitCode = await cmdMeasure(rest)
    else fail('하위 명령: seed|measure')
  } catch (e) { fail(e instanceof Error ? e.message : String(e)) }
  // 막힌 렌더러·남은 약속이 프로세스를 붙잡지 않게 — exitCode 는 위에서 정해졌다
  process.exit(process.exitCode ?? 0)
}
