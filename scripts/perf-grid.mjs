// scripts/perf-grid.mjs — SP3b UI-0 1만 행 합성 WBS 성능 기준선(스펙 §3.2·D51, 계획 판정 Q9). 로컬 레인 B 전용.
//   seed               워크스페이스 A 에 프로젝트 PERF-GRID(이름으로 재사용) + WBS 10,110행(깊이 4·팀 5·담당 20·고정 PRNG)
//   measure [--runs 5] [--base <url>] [--label <l>]
//                      비플랫폼 워크스페이스 관리자(ui-capture 시드 계정)로 /p/<id>/wbs 를 runs 회 새 컨텍스트로 열어
//                      ① 이동 → 첫 행 ② 첫 행까지 긴 작업 합 ③ 1,000행 스크롤 프레임 ④ 서버 HTML 시간(끝·TTFB)의 중앙값.
//                      첫 표시 뒤 DOM 행 수 ≠ 시드 행 수면 실패(max_rows 잘림을 측정으로 삼지 않는다).
// 사용: seed 는 node 로, measure 는 npx --yes -p playwright@1.58.2 node scripts/perf-grid.mjs measure … (래퍼 경유)
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  LEVEL_LABELS_4, SEED_ACCOUNTS, contextOptions, deterministicId, fail, freshSessions, kstToday, laneEnv, laneTarget,
  loadPlaywright, must, plusDays, userIdByEmail,
} from './ui-capture.mjs'
import { localClientEnv } from './lib/e2e.mjs'
import { median } from './lib/perf.mjs'
import { PROJECT_TOGGLE_IDS, SCRIPT_SCHEMA_VERSION } from './lib/settings-consts.mjs'

export const GRID_PROJECT = 'PERF-GRID'
export const GRID_SHAPE = Object.freeze({ phases: 10, tasks: 10, activities: 10, details: 9 })

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
/** @param {{ projectId: string, today: string, teamIds: string[], memberIds: string[] }} ctx */
export function gridRows({ projectId, today, teamIds, memberIds }) {
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
  for (let p = 1; p <= GRID_SHAPE.phases; p++) {
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

const KEYS = ['firstRowMs', 'longTaskMs', 'frameAvgMs', 'framesOver50', 'htmlEndMs', 'ttfbMs', 'domRows']
export function summarize(runs) {
  return Object.fromEntries(KEYS.map((k) => [k, median(runs.map((r) => r[k]))]))
}

async function cmdSeed() {
  const { admin: coord } = laneEnv()
  const db = createClient(coord.url, coord.serviceRoleKey, { auth: { persistSession: false } })
  const today = kstToday()
  const wsA = must('워크스페이스 A', await db.from('workspaces').select('id').eq('slug', (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()).single())
  const actor = await userIdByEmail(db, SEED_ACCOUNTS.wsAdmin)
  if (!actor) throw new Error('ui-capture seed 를 먼저 — 행위자(워크스페이스 관리자) 계정이 없다')
  let project = must('프로젝트 조회', await db.from('projects').select('id').eq('workspace_id', wsA.id).eq('name', GRID_PROJECT).maybeSingle())
  if (project) {
    const existing = must('행 수', await db.from('wbs_items').select('id', { count: 'exact', head: true }).eq('project_id', project.id))
    throw new Error(`PERF-GRID 가 이미 있다 — db:reset 부터(다시 넣으면 item_owners 가 max_rows 를 넘을 수 있다). 현재 행 ${existing ?? '?'}`)
  }
  const created = must('프로젝트 생성', await db.rpc('create_project_with_settings', {
    p_workspace_id: wsA.id, p_name: GRID_PROJECT, p_start_date: plusDays(today, -90), p_end_date: plusDays(today, 120), p_description: `perf-grid seed ${today}`,
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
  for (let i = 1; i <= 20; i++) {
    const person = must('사람', await db.from('people').insert({ workspace_id: wsA.id, email: `grid-member-${String(i).padStart(2, '0')}@example.com`, display_name: `담당 ${i}` }).select('id').single())
    memberIds.push(must('명단', await db.from('project_members').insert({ project_id: project.id, person_id: person.id, access_role: null, active: true }).select('id').single()).id)
  }
  const { wbs, owners } = gridRows({ projectId: project.id, today, teamIds, memberIds })
  for (let i = 0; i < wbs.length; i += 200) must(`wbs_items(${i})`, await db.from('wbs_items').insert(wbs.slice(i, i + 200)))
  for (let i = 0; i < owners.length; i += 500) must(`item_owners(${i})`, await db.from('item_owners').insert(owners.slice(i, i + 500)))
  console.log(JSON.stringify({ ok: true, projectId: project.id, rows: wbs.length, owners: owners.length }))
}

async function cmdMeasure(argv) {
  const opts = { runs: 5, base: null, label: 'ui0' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs') opts.runs = Number(argv[++i])
    else if (argv[i] === '--base') opts.base = argv[++i]
    else if (argv[i] === '--label') opts.label = argv[++i]
    else throw new Error(`알 수 없는 인자: ${argv[i]}`)
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Error('--runs 는 양의 정수')
  const { envText, admin: coord, target, outDir } = laneEnv()
  const base = opts.base ? laneTarget({ localDbUrl: process.env.LOCAL_DB_URL, supabaseUrl: coord.url, appUrl: opts.base }).appUrl : target.appUrl
  const db = createClient(coord.url, coord.serviceRoleKey, { auth: { persistSession: false } })
  const wsA = must('워크스페이스 A', await db.from('workspaces').select('id').eq('slug', (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()).single())
  const project = must('PERF-GRID', await db.from('projects').select('id').eq('workspace_id', wsA.id).eq('name', GRID_PROJECT).single())
  const { count: seedRows, error: cErr } = await db.from('wbs_items').select('id', { count: 'exact', head: true }).eq('project_id', project.id)
  if (cErr) throw new Error(`행 수 조회: ${cErr.message}`)
  const uid = await userIdByEmail(db, SEED_ACCOUNTS.wsAdmin)
  const { count: stateRows, error: sErr } = await db.from('user_wbs_state').select('project_id', { count: 'exact', head: true }).eq('user_id', uid).eq('project_id', project.id)
  if (sErr) throw new Error(`user_wbs_state 조회: ${sErr.message}`)
  if (stateRows !== 0) throw new Error('측정 계정에 user_wbs_state 가 있다 — 접힘이 행 수를 바꾼다(판정 Q9)')
  const prefs = must('선호 조회', await db.from('user_preferences').select('prefs').eq('user_id', uid))
  if (prefs.some((p) => p.prefs?.wbsHideDone === true)) throw new Error('측정 계정의 wbsHideDone 이 켜져 있다(판정 Q9)')
  const sessions = await freshSessions(db, localClientEnv(envText), ['wsAdmin'])
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()
  const browserVersion = browser.version()
  const runs = []
  try {
    for (let i = 0; i < opts.runs; i++) {
      const context = await browser.newContext(contextOptions({ width: 1440, height: 900, theme: 'light' }))
      try {
        await context.addCookies(sessions.wsAdmin.cookies.map((c) => ({ ...c, url: base })))
        await context.addInitScript(() => {
          const g = { firstRow: null, longTasks: [] }
          window.__grid = g
          new PerformanceObserver((l) => { for (const e of l.getEntries()) g.longTasks.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
          const mo = new MutationObserver(() => { if (g.firstRow === null && document.querySelector('[data-row-id]')) { g.firstRow = performance.now(); mo.disconnect() } })
          mo.observe(document, { childList: true, subtree: true })
        })
        const page = await context.newPage()
        await page.goto(`${base}/p/${project.id}/wbs`, { waitUntil: 'load', timeout: 120_000 })
        await page.waitForSelector('[data-row-id]', { state: 'attached', timeout: 120_000 })
        let domRows = -1
        for (let k = 0; k < 30; k++) {           // 행 수가 1초 동안 그대로면 첫 표시 완료
          const n = await page.evaluate(() => document.querySelectorAll('[data-row-id]').length)
          if (n === domRows) break
          domRows = n
          await page.waitForTimeout(1000)
        }
        rowCountVerdict(domRows, seedRows)
        const m = await page.evaluate(async () => {
          const g = window.__grid
          const nav = performance.getEntriesByType('navigation')[0]
          const el = document.querySelector('[data-wbs-scroll-region]')
          const frames = []
          if (el) {
            let last = performance.now()
            await new Promise((resolve) => {
              const tick = (t) => { frames.push(t - last); last = t; el.scrollTop += 400
                if (el.scrollTop >= 40_000 || el.scrollTop + el.clientHeight >= el.scrollHeight) resolve(null); else requestAnimationFrame(tick) }
              requestAnimationFrame(tick)
            })
          }
          const f = frames.slice(1)
          return { firstRowMs: g.firstRow, longTaskMs: g.longTasks.filter(([s]) => s < g.firstRow).reduce((s, [, d]) => s + d, 0),
            frameAvgMs: f.length ? f.reduce((a, b) => a + b, 0) / f.length : null, framesOver50: f.filter((x) => x > 50).length,
            htmlEndMs: nav.responseEnd - nav.requestStart, ttfbMs: nav.responseStart - nav.requestStart, scrolled: Boolean(el) }
        })
        if (!m.scrolled) throw new Error('[data-wbs-scroll-region] 이 없다 — 스크롤 주체가 바뀌었다')
        runs.push({ ...m, domRows })
      } finally { await context.close() }
    }
  } finally { await browser.close() }
  const out = { label: opts.label, base, projectRows: seedRows, runs: runs.length, median: summarize(runs), browser: browserVersion, kstDate: kstToday() }
  writeFileSync(join(outDir, `perf-grid-${opts.label}.json`), JSON.stringify({ ...out, samples: runs }, null, 2))
  console.log(JSON.stringify(out))
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  try {
    if (cmd === 'seed') await cmdSeed()
    else if (cmd === 'measure') await cmdMeasure(rest)
    else fail('하위 명령: seed|measure')
  } catch (e) { fail(e instanceof Error ? e.message : String(e)) }
}
