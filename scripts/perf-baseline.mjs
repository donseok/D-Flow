// scripts/perf-baseline.mjs — SP2·SP3a 성능 기준선(대시보드·WBS·이슈 p50/p95). 로컬 전용.
//   seed:    service_role 로 부트스트랩 워크스페이스의 프로젝트 PERF(없으면 부트스트랩 관리자를 행위자로
//            create_project_with_settings 로 생성, 있으면 재사용)에
//            wbs_items 800행(10 단계 × 80) · announcements 20행 · issues 50행을 결정적 id 로 멱등 upsert.
//            추가로 슈퍼유저가 아닌 워크스페이스 멤버 1명(PERF_MEMBER_EMAIL, 기본 bob@example.com)을
//            그 워크스페이스에 'member'로, PERF 프로젝트 명단(project_members)에 'member' 로 넣는다
//            (리뷰 라운드 1 — 슈퍼유저로만 재면 my_workspace_ids()/is_ws_member() 가 is_superuser() 분기로
//            빠져 평범한 멤버가 타는 exists() 서브쿼리 경로가 측정에서 빠진다). 프로젝트 id 를 stdout 에 낸다.
//   measure: 어드민(BOOTSTRAP_EMAIL/PASSWORD)·멤버(PERF_MEMBER_EMAIL/PASSWORD) 두 계정으로 각각 로그인해
//            PERF 프로젝트의 대시보드·WBS·이슈 화면을 워밍업 3회 + N 회 순차 요청, 페르소나별 p50/p95 를
//            JSON 으로 stdout 에 낸다: { label, n, personas: { admin: { routes }, member: { routes } } }.
// 좌표는 scripts/lib/e2e.mjs(localClientEnv)·scripts/lib/targets.mjs(localAdminEnv) 로만 읽는다 — 원격
// 좌표면 그 함수들이 throw 한다(원본 DB 금지, D-Flow CLAUDE.md).
// 사용:
//   PERF_MEMBER_PASSWORD=… node scripts/perf-baseline.mjs seed
//   BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD=… PERF_MEMBER_PASSWORD=… \
//     node scripts/perf-baseline.mjs measure --base http://localhost:3101 --label sp2-phase-a --n 100 [--ia legacy|ws]
//   --ia(SP3b): 경로 셋에 IA 별 경로를 더한다(없으면 그 셋만) — legacy = /projects·/api/shell?route&menu, ws = /w/<slug>·/w/<slug>/projects·/api/shell?ws&project
//   SP4 A2: seed [--items <n>(기본 800 — 800 이 아니면 프로젝트 PERF-<n>)] [--weekly(주간 영역 셋·2026-01-05 문서 하나 — SP4 스키마 전용)],
//           measure [--items <n>] [--routes dashboard,wbs,issues,export,weekly(기본 dashboard,wbs,issues)] [--personas admin|admin,member(기본 둘)]
//           [--expect-items <n>(wbs 화면·export 본문의 서로 다른 시드 항목 이름 수가 n 인지 — 다르면 실패. 표준 내보내기에는 코드 열이 없어
//           이름으로 센다)]. export 는 바이너리로 읽는다.
//   SP5b P0: workflow --label <이름> [--n 30] [--items n] — apply_workflow_event 를 pg 로 직접 잰다(D22). PERF 프로젝트의 리프 하나를 한 트랜잭션에서
//           위임·주문 ready 로 맞추고 service_role 로 에이전트 순환(WORKFLOW_AGENT_CYCLE) + 위임 해제 뒤 사람 순환(set_stage ip·im·xx)을 돈 뒤
//           롤백한다(데이터 불변). 사건마다 p50/p95 를 JSON 으로. 두 스키마(8인자·9인자)에서 이름 인자로 같은 호출을 한다.
//   DSN 은 perfDsn(scripts/lib/perf.mjs) — LOCAL_DB_URL 필수(없으면 멈춘다 — 기본 DSN 인 메인 스택으로 떨어지지 않는다), .env.local 의 API 와 같은 스택인지 포트로 대조.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { Pool } from 'pg'
import { cookieHeader, localClientEnv, notFoundRendered } from './lib/e2e.mjs'
import { localAdminEnv } from './lib/targets.mjs'
import { distinctSeedNames, IA_KINDS, iaRoutes, parseNameList, percentile, perfBaseUrl, perfDsn, perfProjectName, perfRoutes, PERF_ROUTE_NAMES, PERF_WEEK, summarizeEventSamples, wbsSeedCodes, WORKFLOW_AGENT_CYCLE, WORKFLOW_HUMAN_CYCLE } from './lib/perf.mjs'
import { zipTextParts } from './lib/sentinels.mjs'
import { PROJECT_TOGGLE_IDS, SCRIPT_SCHEMA_VERSION } from './lib/settings-consts.mjs'

const ANNOUNCEMENT_COUNT = 20
const ISSUE_COUNT = 50
const WARMUP = 3
const DEFAULT_N = 100
const MEMBER_EMAIL = (process.env.PERF_MEMBER_EMAIL || 'bob@example.com').trim().toLowerCase()

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

/**
 * email 로 기존 auth 사용자 id 를 찾는다 — supabase-js 의 auth.admin.listUsers() 는 쓰지 않는다: 로컬 GoTrue 가
 * 이 리포의 RLS 픽스처(SQL 로 auth.users 에 직접 넣은 행 — confirmation_token 이 NULL)를 만나면
 * "Database error finding users"(500, NULL→string 스캔 오류)로 죽는다. 대신 직접 접속(seed 가 perfDsn 으로 정한 DSN
 * — LOCAL_DB_URL 필수·API 와 같은 스택·금지 목록이면 throw)으로 `auth.users` 를 읽는다.
 */
async function findAuthUserIdByEmail(dsn, email) {
  const pool = new Pool({ connectionString: dsn })
  try {
    const { rows } = await pool.query('select id from auth.users where lower(email) = lower($1)', [email])
    return rows[0]?.id ?? null
  } finally {
    await pool.end()
  }
}

/** 없으면 만들고, 있으면 그대로 쓴다(비밀번호는 최초 생성 때만 반영 — 이미 있으면 재사용, 바꾸지 않는다). */
async function findOrCreateAuthUserId(admin, dsn, email, password) {
  const existingId = await findAuthUserIdByEmail(dsn, email)
  if (existingId) return existingId
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) fail(`계정 생성 실패(${email}): ${error.message}`)
  return data.user.id
}

/** people(workspace_id, email) 은 부분 유니크 인덱스라 upsert onConflict 를 못 쓴다 — select 후 insert/link(dev-bootstrap.mjs 와 같은 패턴). */
async function findOrCreatePerson(admin, wsId, email, displayName, userId) {
  const { data: existing, error: selErr } = await admin.from('people')
    .select('id, user_id').eq('workspace_id', wsId).eq('email', email).maybeSingle()
  if (selErr) fail(`people 조회 실패(${email}): ${selErr.message}`)
  if (!existing) {
    const { data, error } = await admin.from('people')
      .insert({ workspace_id: wsId, email, display_name: displayName, user_id: userId }).select('id').single()
    if (error) fail(`people 생성 실패(${email}): ${error.message}`)
    return data.id
  }
  if (!existing.user_id) {
    const { error } = await admin.from('people').update({ user_id: userId }).eq('id', existing.id)
    if (error) fail(`people 연결 실패(${email}): ${error.message}`)
  }
  return existing.id
}

function parseSeedArgs(argv) {
  const out = { items: 800, weekly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--items') out.items = Number(argv[++i])
    else if (a === '--weekly') out.weekly = true
    else fail(`알 수 없는 인자: ${a}`)
  }
  try { perfProjectName(out.items) } catch (e) { fail(e.message) }
  return out
}

async function seed(argv) {
  const { items, weekly } = parseSeedArgs(argv)
  const projectName = perfProjectName(items)
  const target = localAdminEnv(envText())
  let dsn
  try { dsn = perfDsn(process.env, target.url) } catch (e) { fail(e.message) }
  const admin = createClient(target.url, target.serviceRoleKey, { auth: { persistSession: false } })
  const slug = (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()
  const memberPassword = process.env.PERF_MEMBER_PASSWORD
  if (!memberPassword || memberPassword.length < 8) fail('PERF_MEMBER_PASSWORD 가 없거나 8자 미만이다 — measure 에서도 같은 값을 쓴다')

  const { data: ws, error: wsErr } = await admin.from('workspaces').select('id').eq('slug', slug).maybeSingle()
  if (wsErr) fail(`워크스페이스 조회 실패: ${wsErr.message}`)
  if (!ws) fail(`워크스페이스 '${slug}' 가 없다 — npm run dev:bootstrap 을 먼저 돌린다`)

  const { data: existing, error: selErr } = await admin.from('projects')
    .select('id').eq('workspace_id', ws.id).eq('name', projectName).maybeSingle()
  if (selErr) fail(`프로젝트 조회 실패: ${selErr.message}`)
  let projectId = existing?.id
  if (!projectId) {
    const { data: adminUser, error: auErr } = await admin.from('profiles').select('user_id').eq('email', (process.env.BOOTSTRAP_EMAIL || 'admin@example.com').trim().toLowerCase()).maybeSingle()
    if (auErr || !adminUser) fail(`부트스트랩 관리자 조회 실패: ${auErr?.message ?? '행 없음'}`)
    const { data: created, error: insErr } = await admin.rpc('create_project_with_settings', {
      p_workspace_id: ws.id, p_name: projectName, p_start_date: null, p_end_date: null, p_description: null,
      p_values: { 'core.level_labels': ['Phase', 'Task', 'Activity'], 'modules.enabled': [...PROJECT_TOGGLE_IDS] },
      p_copy_from: null, p_actor: adminUser.user_id, p_command_id: randomUUID(), p_schema_version: SCRIPT_SCHEMA_VERSION,
    })
    if (insErr) fail(`프로젝트 생성 실패: ${insErr.message}`)
    projectId = created.project_id
  }
  // 기준일은 seed 마다 건다(멱등) — 생성 RPC 와 한 문장이 아니라, 생성 뒤 여기서 실패하고 재실행하면 기준일 없는 PERF 를 재사용하게 된다
  const { error: bdErr } = await admin.from('projects').update({ base_date: '2026-01-05' }).eq('id', projectId)
  if (bdErr) fail(`base_date 설정 실패: ${bdErr.message}`)

  const wbsRows = wbsSeedCodes(items).map(({ code, stage, index, sortOrder }) => ({
    id: deterministicId(`wbs:${projectId}:${code}`),
    project_id: projectId,
    code,
    name: `${stage}단계 업무 ${index}`,
    sort_order: sortOrder,
    planned_start: plusDays('2026-01-05', (stage - 1) * 14),
    planned_end: plusDays('2026-01-05', (stage - 1) * 14 + 13),
    weight: 1,
  }))
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
  // 이슈 상태는 두 단계(SP5b D4 — 새 이슈는 트리거가 열림으로 시작하고, 상태는 전이로만 바뀐다). 이미 그 상태면 건너뛴다(멱등)
  for (const code of ['in_progress', 'resolved', 'on_hold']) {
    const ids = issueRows.filter((_, i) => ['open', 'in_progress', 'resolved', 'on_hold'][(i + 1) % 4] === code).map((r) => r.id)
    const { error } = await admin.from('issues').update({ status_code: code }).in('id', ids).neq('status_code', code)
    if (error) fail(`issues 상태 시드 실패(${code}): ${error.message}`)
  }

  // P12 — 주간 화면 기록용(SP4 스키마 전용). ui-capture 시드와 같은 길: service_role 이 결정적 id 로 넣는다(있으면 그대로 — ignoreDuplicates,
  // RPC 를 부르지 않는다). 영역 → 문서 → 행 순서(영역 FK, SP4 D53)
  if (weekly) {
    const areas = [1, 2, 3].map((n) => ({
      id: deterministicId(`area:${projectId}:${n}`), project_id: projectId, kind: 'weekly_section', code: `W${n}`, name: `영역 ${n}`, sort_order: n, active: true,
    }))
    const report = { id: deterministicId(`weekly:${projectId}:${PERF_WEEK}`), project_id: projectId, week_start: PERF_WEEK }
    const weeklyRows = areas.map((a, i) => ({
      id: deterministicId(`weekly-row:${projectId}:${a.code}`), report_id: report.id, project_id: projectId, area_id: a.id,
      this_content: `금주 실적 ${i + 1}`, this_issue: '', next_content: `차주 계획 ${i + 1}`, next_issue: '',
    }))
    for (const [table, rows] of [['project_areas', areas], ['weekly_reports', [report]], ['weekly_report_rows', weeklyRows]]) {
      const { error } = await admin.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      if (error) fail(`${table} 시드 실패: ${error.message}`)
    }
  }

  // 슈퍼유저가 아닌 워크스페이스 멤버 — is_superuser() 분기를 타지 않는 실제 멤버 경로를 측정하기 위함.
  const memberUserId = await findOrCreateAuthUserId(admin, dsn, MEMBER_EMAIL, memberPassword)
  const { error: profErr } = await admin.from('profiles')
    .upsert({ user_id: memberUserId, email: MEMBER_EMAIL, display_name: MEMBER_EMAIL.split('@')[0] })
  if (profErr) fail(`profiles 시드 실패: ${profErr.message}`)
  const { error: wmErr } = await admin.from('workspace_members')
    .upsert({ workspace_id: ws.id, user_id: memberUserId, role: 'member' }, { onConflict: 'workspace_id,user_id' })
  if (wmErr) fail(`workspace_members 시드 실패: ${wmErr.message}`)
  const personId = await findOrCreatePerson(admin, ws.id, MEMBER_EMAIL, MEMBER_EMAIL.split('@')[0], memberUserId)
  const { error: pmErr } = await admin.from('project_members')
    .upsert({ project_id: projectId, person_id: personId, access_role: 'member', active: true }, { onConflict: 'project_id,person_id' })
  if (pmErr) fail(`project_members 시드 실패: ${pmErr.message}`)

  console.log(JSON.stringify({ projectId, projectName, items, weekly }))
}

function parseMeasureArgs(argv) {
  const out = { base: null, label: null, n: DEFAULT_N, items: 800, routes: ['dashboard', 'wbs', 'issues'], personas: ['admin', 'member'], expectItems: null, ia: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') out.base = argv[++i]
    else if (a === '--label') out.label = argv[++i]
    else if (a === '--n') out.n = Number(argv[++i])
    else if (a === '--items') out.items = Number(argv[++i])
    else if (a === '--routes') out.routes = (() => { try { return parseNameList(argv[++i], PERF_ROUTE_NAMES) } catch (e) { return fail(e.message) } })()
    else if (a === '--personas') out.personas = (() => { try { return parseNameList(argv[++i], ['admin', 'member']) } catch (e) { return fail(e.message) } })()
    else if (a === '--expect-items') out.expectItems = Number(argv[++i])
    else if (a === '--ia') out.ia = argv[++i]
    else fail(`알 수 없는 인자: ${a}`)
  }
  if (!out.base) fail('measure 는 --base <url> 이 필요하다')
  if (!out.label) fail('measure 는 --label <이름> 이 필요하다')
  if (!Number.isInteger(out.n) || out.n <= 0) fail('--n 은 양의 정수여야 한다')
  try { perfProjectName(out.items) } catch (e) { fail(e.message) }
  if (out.expectItems !== null && (!Number.isInteger(out.expectItems) || out.expectItems <= 0)) fail('--expect-items 는 양의 정수여야 한다')
  if (out.ia !== null && !IA_KINDS.includes(out.ia)) fail(`--ia 는 ${IA_KINDS.join('|')} 여야 한다`)
  return out
}

/** 로그인해 쿠키 헤더를 만든다(session() 패턴, e2e-local.mjs 와 같다). */
async function login(env, email, password) {
  const jar = new Map()
  const sb = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  })
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) fail(`로그인 실패(${email}): ${error.message}`)
  return { sb, cookie: cookieHeader([...jar].map(([name, value]) => ({ name, value }))) }
}

/** 경로 하나를 워밍업 WARMUP 회 + n 회 순차 요청해 p50/p95 를 낸다. 200 아니면 즉시 중단(fail-closed). */
async function measureRoutes(base, cookie, routes, n) {
  const last = new Map()
  const timedGet = async (path) => {
    const started = performance.now()
    const res = await fetch(`${base}${path}`, { headers: { cookie } })
    const binary = path.startsWith('/api/export')
    const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text()
    const elapsed = performance.now() - started
    if (res.status !== 200) fail(`${path} → ${res.status}(200 기대)`)
    if (binary && !String(res.headers.get('content-type') ?? '').includes('spreadsheetml')) fail(`${path} 가 엑셀이 아니다: ${res.headers.get('content-type')}`)
    if (!binary && notFoundRendered(body)) fail(`${path} 가 notFound 를 그렸다 — 모듈 관문이 닫혔다`)
    last.set(path, body)
    return elapsed
  }
  const routeStats = {}
  for (const path of routes) {
    for (let i = 0; i < WARMUP; i++) await timedGet(path)
    const samples = []
    for (let i = 0; i < n; i++) samples.push(await timedGet(path))
    routeStats[path] = { p50: percentile(samples, 50), p95: percentile(samples, 95) }
  }
  return { routeStats, last }
}

async function measure(argv) {
  const { base: rawBase, label, n, items, routes: routeNames, personas, expectItems, ia } = parseMeasureArgs(argv)
  const base = (() => { try { return perfBaseUrl(rawBase) } catch (e) { return fail(e.message) } })()
  const env = localClientEnv(envText())
  const projectName = perfProjectName(items)
  const adminEmail = (process.env.BOOTSTRAP_EMAIL || 'admin@example.com').trim().toLowerCase()
  const adminPassword = process.env.BOOTSTRAP_PASSWORD
  if (!adminPassword) fail('BOOTSTRAP_PASSWORD 가 없다 — dev:bootstrap 때 쓴 값을 env 로 넘긴다')
  const memberPassword = process.env.PERF_MEMBER_PASSWORD
  if (personas.includes('member') && !memberPassword) fail('PERF_MEMBER_PASSWORD 가 없다 — seed 때 쓴 값을 env 로 넘긴다')

  // 프로젝트 id 는 어드민 세션으로 확정한다(권한이 가장 넓어 항상 보인다) — 페르소나들이 같은 pid 의 같은 경로를 잰다.
  const adminSession = await login(env, adminEmail, adminPassword)
  const { data: project, error: projErr } = await adminSession.sb.from('projects').select('id, workspace_id').eq('name', projectName).maybeSingle()
  if (projErr) fail(`${projectName} 프로젝트 조회 실패: ${projErr.message}`)
  if (!project) fail(`${projectName} 프로젝트가 없다 — 'node scripts/perf-baseline.mjs seed --items ${items}' 를 먼저 돌린다`)
  // --ia ws 의 경로는 측정 프로젝트가 속한 워크스페이스의 slug·id 로 만든다(옛 IA 는 그 값이 필요 없다)
  let slug = ''
  if (ia === 'ws') {
    const { data: ws, error: wsErr } = await adminSession.sb.from('workspaces').select('slug').eq('id', project.workspace_id).maybeSingle()
    if (wsErr) fail(`워크스페이스 조회 실패: ${wsErr.message}`)
    if (!ws) fail(`${projectName} 프로젝트의 워크스페이스를 읽지 못했다(${project.workspace_id})`)
    slug = ws.slug
  }
  const routes = [...perfRoutes(project.id, routeNames), ...iaRoutes(ia, { slug, wid: project.workspace_id, pid: project.id })]

  const result = { label, n, items, ...(ia ? { ia } : {}), personas: {} }
  for (const persona of personas) {
    const cookie = persona === 'admin' ? adminSession.cookie : (await login(env, MEMBER_EMAIL, memberPassword)).cookie
    const { routeStats, last } = await measureRoutes(base, cookie, routes, n)
    result.personas[persona] = { routes: routeStats }
    if (expectItems !== null) {
      const counts = {}
      for (const path of routes.filter((p) => p.endsWith('/wbs') || p.startsWith('/api/export'))) {
        const body = last.get(path)
        const text = Buffer.isBuffer(body) ? (await zipTextParts(body)).map((p) => p.text).join('\n') : body
        counts[path] = distinctSeedNames(text)
        if (counts[path] !== expectItems) fail(`${persona} ${path} 의 항목 수 ${counts[path]} ≠ ${expectItems}`)
      }
      result.personas[persona].items = counts
    }
  }
  console.log(JSON.stringify(result))
}

function parseWorkflowArgs(argv) {
  const out = { label: null, n: 30, items: 800 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--label') out.label = argv[++i]
    else if (a === '--n') out.n = Number(argv[++i])
    else if (a === '--items') out.items = Number(argv[++i])
    else fail(`모르는 인자: ${a}`)
  }
  if (!out.label) fail('workflow 는 --label <이름> 이 필요하다')
  if (!Number.isInteger(out.n) || out.n <= 0) fail('--n 은 양의 정수여야 한다')
  try { perfProjectName(out.items) } catch (e) { fail(e.message) }
  return out
}

const WF_CALL = 'select public.apply_workflow_event(p_event => $1, p_actor => $2, p_item_id => $3, p_order_id => $4, p_stage => $5) as r'

/** 사건 하나를 재고 결과가 ok 가 아니면 멈춘다(fail-closed — 실패한 사건을 시간으로 세지 않는다). */
async function timedEvent(c, samples, key, args) {
  const started = performance.now()
  const { rows } = await c.query(WF_CALL, args)
  const elapsed = performance.now() - started
  const r = rows[0].r
  if (!r?.ok) fail(`${key} 실패: ${JSON.stringify(r)}`)
  ;(samples[key] ??= []).push(elapsed)
}

async function workflowBench(argv) {
  const { label, n, items } = parseWorkflowArgs(argv)
  const env = localClientEnv(envText())
  const dsn = (() => { try { return perfDsn(process.env, env.url) } catch (e) { return fail(e.message) } })()
  const adminEmail = (process.env.BOOTSTRAP_EMAIL || 'admin@example.com').trim().toLowerCase()
  const pool = new Pool({ connectionString: dsn })
  try {
    const projectName = perfProjectName(items)
    const { rows: projects } = await pool.query('select id from public.projects where name = $1', [projectName])
    if (projects.length !== 1) fail(`${projectName} 프로젝트가 ${projects.length}개다 — seed 를 먼저 돌린다(정확히 1개여야 한다)`)
    const pid = projects[0].id
    const { rows: leaves } = await pool.query(
      `select w.id from public.wbs_items w where w.project_id = $1
         and not exists (select 1 from public.wbs_items c where c.parent_id = w.id) order by w.id limit 1`, [pid])
    if (!leaves.length) fail(`${projectName} 에 리프가 없다`)
    const leaf = leaves[0].id
    const actor = await findAuthUserIdByEmail(dsn, adminEmail)
    if (!actor) fail(`행위자 계정이 없다(${adminEmail}) — dev:bootstrap 을 먼저 돌린다`)
    const { rows: sig } = await pool.query(
      `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'apply_workflow_event'`)
    const samples = {}
    for (let i = 0; i < WARMUP + n; i++) {
      const target = i < WARMUP ? {} : samples
      const c = await pool.connect()
      try {
        await c.query('begin')
        await c.query('update public.wbs_items set dev_workflow = true, tags = $2, stage = null, actual_pct = 0 where id = $1', [leaf, ['agent']])
        await c.query('delete from public.agent_work_orders where wbs_item_id = $1', [leaf])
        const order = randomUUID()
        await c.query(`insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, 'ready')`, [order, pid, leaf])
        await c.query('set local role service_role')
        for (const event of WORKFLOW_AGENT_CYCLE) await timedEvent(c, target, event, [event, actor, null, order, null])
        // 사람 경로 — 위임·주문을 걷고(postgres) 단계 지정 순환
        await c.query('reset role')
        await c.query('update public.wbs_items set tags = null, stage = null, actual_pct = 0 where id = $1', [leaf])
        await c.query('delete from public.agent_work_orders where wbs_item_id = $1', [leaf])
        await c.query('set local role service_role')
        for (const stage of WORKFLOW_HUMAN_CYCLE) await timedEvent(c, target, `set_stage:${stage}`, ['set_stage', actor, leaf, null, stage])
      } finally {
        await c.query('rollback').catch(() => {})
        c.release()
      }
    }
    console.log(JSON.stringify({ label, n, items, signature: sig.map((r) => r.args), events: summarizeEventSamples(samples) }))
  } finally {
    await pool.end()
  }
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'seed') await seed(rest)
else if (cmd === 'measure') await measure(rest)
else if (cmd === 'workflow') await workflowBench(rest)
else fail("사용: node scripts/perf-baseline.mjs seed [--items n] [--weekly] | measure --base <url> --label <이름> [--n 100] [--items n] [--routes a,b] [--personas admin] [--expect-items n] [--ia legacy|ws] | workflow --label <이름> [--n 30] [--items n]")
