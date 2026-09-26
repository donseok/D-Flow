// scripts/perf-baseline.mjs — SP2 성능 기준선(대시보드·WBS p50/p95). 로컬 전용.
//   seed:    service_role 로 부트스트랩 워크스페이스의 프로젝트 PERF(없으면 생성, 있으면 재사용)에
//            wbs_items 800행(10 단계 × 80) · announcements 20행 · issues 50행을 결정적 id 로 멱등 upsert.
//            프로젝트 id 를 stdout 에 낸다.
//   measure: BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD 로 로그인해 PERF 프로젝트의 대시보드·WBS 화면을
//            워밍업 3회 + N 회 순차 요청해 p50/p95 를 JSON 으로 stdout 에 낸다.
// 좌표는 scripts/lib/e2e.mjs(localClientEnv)·scripts/lib/targets.mjs(localAdminEnv) 로만 읽는다 — 원격
// 좌표면 그 함수들이 throw 한다(원본 DB 금지, D-Flow CLAUDE.md).
// 사용:
//   node scripts/perf-baseline.mjs seed
//   BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD=… \
//     node scripts/perf-baseline.mjs measure --base http://localhost:3000 --label sp2-phase-a --n 30
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookieHeader, localAppUrl, localClientEnv } from './lib/e2e.mjs'
import { localAdminEnv } from './lib/targets.mjs'
import { percentile } from './lib/perf.mjs'

const PROJECT_NAME = 'PERF'
const STAGES = 10
const ITEMS_PER_STAGE = 80
const ANNOUNCEMENT_COUNT = 20
const ISSUE_COUNT = 50
const ROUTES_OF = (pid) => [`/p/${pid}/dashboard`, `/p/${pid}/wbs`]
const WARMUP = 3

const fail = (m) => { console.error(`✗ ${m}`); process.exit(1) }

function envText() {
  try { return readFileSync('.env.local', 'utf8') } catch { fail('.env.local 이 없다 — npm run env:local 을 먼저 돌린다') }
}

/** 문자열 → 결정적 UUID(v4 형식이지만 버전 비트는 임의 — 재실행마다 같은 id 를 내는 것이 목적, RFC 무작위성은 필요 없다). */
function deterministicId(seed) {
  const h = createHash('sha256').update(seed).digest('hex').slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** 'YYYY-MM-DD' 기준일 + n 일(결정적 계획일). */
function plusDays(base, n) {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function seed() {
  const target = localAdminEnv(envText())
  const admin = createClient(target.url, target.serviceRoleKey, { auth: { persistSession: false } })
  const slug = (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()

  const { data: ws, error: wsErr } = await admin.from('workspaces').select('id').eq('slug', slug).maybeSingle()
  if (wsErr) fail(`워크스페이스 조회 실패: ${wsErr.message}`)
  if (!ws) fail(`워크스페이스 '${slug}' 가 없다 — npm run dev:bootstrap 을 먼저 돌린다`)

  const { data: existing, error: selErr } = await admin.from('projects')
    .select('id').eq('workspace_id', ws.id).eq('name', PROJECT_NAME).maybeSingle()
  if (selErr) fail(`프로젝트 조회 실패: ${selErr.message}`)
  let projectId = existing?.id
  if (!projectId) {
    const { data: created, error: insErr } = await admin.from('projects')
      .insert({ name: PROJECT_NAME, workspace_id: ws.id, base_date: '2026-01-05' }).select('id').single()
    if (insErr) fail(`프로젝트 생성 실패: ${insErr.message}`)
    projectId = created.id
  }

  const wbsRows = []
  for (let i = 1; i <= STAGES; i++) {
    for (let j = 1; j <= ITEMS_PER_STAGE; j++) {
      const code = `P.${i}.${j}`
      wbsRows.push({
        id: deterministicId(`wbs:${projectId}:${code}`),
        project_id: projectId,
        code,
        name: `${i}단계 업무 ${j}`,
        sort_order: (i - 1) * ITEMS_PER_STAGE + j,
        planned_start: plusDays('2026-01-05', (i - 1) * 14),
        planned_end: plusDays('2026-01-05', (i - 1) * 14 + 13),
        weight: 1,
      })
    }
  }
  const announcementRows = Array.from({ length: ANNOUNCEMENT_COUNT }, (_, i) => {
    const n = i + 1
    return {
      id: deterministicId(`announcement:${projectId}:${n}`),
      project_id: projectId,
      title: `공지 ${n}`,
      body: `성능 기준선 시드 공지 ${n}`,
      category: ['general', 'important', 'event'][n % 3],
      is_pinned: n % 5 === 0,
    }
  })
  const issueRows = Array.from({ length: ISSUE_COUNT }, (_, i) => {
    const n = i + 1
    return {
      id: deterministicId(`issue:${projectId}:${n}`),
      project_id: projectId,
      title: `이슈 ${n}`,
      body: `성능 기준선 시드 이슈 ${n}`,
      status: ['open', 'in_progress', 'resolved', 'on_hold'][n % 4],
      severity: ['high', 'medium', 'low'][n % 3],
    }
  })

  for (const [label, table, rows] of [['wbs_items', 'wbs_items', wbsRows], ['announcements', 'announcements', announcementRows], ['issues', 'issues', issueRows]]) {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      const { error } = await admin.from(table).upsert(chunk, { onConflict: 'id' })
      if (error) fail(`${label} 시드 실패(${i}~${i + chunk.length}): ${error.message}`)
    }
  }

  console.log(JSON.stringify({ projectId }))
}

function parseMeasureArgs(argv) {
  const out = { base: null, label: null, n: 30 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') out.base = argv[++i]
    else if (a === '--label') out.label = argv[++i]
    else if (a === '--n') out.n = Number(argv[++i])
    else fail(`알 수 없는 인자: ${a}`)
  }
  if (!out.base) fail('measure 는 --base <url> 이 필요하다')
  if (!out.label) fail('measure 는 --label <이름> 이 필요하다')
  if (!Number.isInteger(out.n) || out.n <= 0) fail('--n 은 양의 정수여야 한다')
  return out
}

async function measure(argv) {
  const { base: rawBase, label, n } = parseMeasureArgs(argv)
  const base = (() => { try { return localAppUrl(rawBase) } catch (e) { return fail(e.message) } })()
  const env = localClientEnv(envText())
  const email = (process.env.BOOTSTRAP_EMAIL || 'admin@example.com').trim().toLowerCase()
  const password = process.env.BOOTSTRAP_PASSWORD
  if (!password) fail('BOOTSTRAP_PASSWORD 가 없다 — dev:bootstrap 때 쓴 값을 env 로 넘긴다')

  const jar = new Map()
  const sb = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  })
  const { error: loginErr } = await sb.auth.signInWithPassword({ email, password })
  if (loginErr) fail(`로그인 실패: ${loginErr.message}`)
  const cookie = cookieHeader([...jar].map(([name, value]) => ({ name, value })))

  const { data: project, error: projErr } = await sb.from('projects').select('id').eq('name', PROJECT_NAME).maybeSingle()
  if (projErr) fail(`PERF 프로젝트 조회 실패: ${projErr.message}`)
  if (!project) fail("PERF 프로젝트가 없다 — 'node scripts/perf-baseline.mjs seed' 를 먼저 돌린다")

  const routes = ROUTES_OF(project.id)
  const timedGet = async (path) => {
    const started = performance.now()
    const res = await fetch(`${base}${path}`, { headers: { cookie } })
    await res.text()
    const elapsed = performance.now() - started
    if (res.status !== 200) fail(`${path} → ${res.status}(200 기대)`)
    return elapsed
  }

  const result = { label, n, routes: {} }
  for (const path of routes) {
    for (let i = 0; i < WARMUP; i++) await timedGet(path)
    const samples = []
    for (let i = 0; i < n; i++) samples.push(await timedGet(path))
    result.routes[path] = { p50: percentile(samples, 50), p95: percentile(samples, 95) }
  }
  console.log(JSON.stringify(result))
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'seed') await seed()
else if (cmd === 'measure') await measure(rest)
else fail("사용: node scripts/perf-baseline.mjs seed | measure --base <url> --label <이름> [--n 30]")
