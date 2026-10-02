#!/usr/bin/env node
// SP3b E2E(스펙 §8.3) — ui/sp3-menu 브랜치 전용. 창 직전(과제 39)에 scripts/e2e-local.mjs 로 합치고 지운다(main 에 들어가지 않는다 — V15).
// 서버 = 레인 B 프로덕션 빌드(E2E_BASE_URL=http://127.0.0.1:3201 — 래퍼가 싣는다). 좌표는 ui-capture.mjs 의 laneEnv 가 판정한다(포트 3201~3203·DB 54422 밖이면 멈춘다).
// 계정: 캡처 시드의 ui-wsadmin(= ana, A 관리자·플랫폼 관리자 아님)·ui-duo(A·B 멤버), 이 스크립트가 만드는 bea(B 전용 관리자). 비밀번호는 실행마다 새로 만들어 메모리에만 둔다.
// 전제: ui-capture.mjs seed 가 끝난 DB(워크스페이스 A·B, 시드 프로젝트, A 회의록). 단계는 이름으로 부른다: node scripts/e2e-sp3b.mjs [E1 E2 …].
// 단계 — E1 옛 경로 307, E2 회의록 행의 워크스페이스·타 워크스페이스 404, E4 비소속 404(센티널 없음), E6 두 워크스페이스·SP3a R15 해소,
//        E8 루트 리졸버, E9 전환 대상 라우트, E11 소프트 이동, E5 전환기 트리거(소속 둘 이상만), E7 모듈 끈 메뉴, E10 비소속 배지 null. E3 은 UI-3 몫(건너뜀 표시).
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cookieHeader, localClientEnv, notFoundRendered, minuteInput } from './lib/e2e.mjs'
import { createSessionFactory } from './lib/e2e-session.mjs'
import { SCRIPT_SCHEMA_VERSION, PROJECT_TOGGLE_IDS } from './lib/settings-consts.mjs'
import { LEVEL_LABELS_4, SEED_ACCOUNTS, SEED_PROJECT, SEED_WS_B, fnv1a64, laneEnv, loadPlaywright, must, userIdByEmail } from './ui-capture.mjs'

export const DUO = Object.freeze({ email: SEED_ACCOUNTS.duo, name: 'duo' })
export const ANA = Object.freeze({ email: SEED_ACCOUNTS.wsAdmin, name: 'ana' })
export const BEA = Object.freeze({ email: 'e2e-bea@example.com', name: 'bea' })
export const POFF_NAME = 'E2E SP3b 이슈 꺼짐'
export const PB_NAME = 'E2E SP3b B 프로젝트'
export const MINUTE_B_TITLE = 'E2E SP3b B 회의록'
export const PLATFORM = Object.freeze({ email: SEED_ACCOUNTS.platformAdmin, name: 'plat' })
export const SWITCHER_MARK = 'data-ws-switcher="list"'

/** 옛 경로 × 쿼리 → 기대 대상(순수) */
export function legacyCases(slug, ids) {
  const W = `/w/${slug}`
  const base = [['/meetings', 'meetings'], ['/minutes', 'minutes'], ['/agents', 'agents'], ['/portfolio', 'portfolio'], ['/usage', 'usage'], ['/admin/teams', 'admin/teams']]
  const out = []
  for (const [from, seg] of base) {
    out.push({ from, to: `${W}/${seg}` })
    out.push({ from: `${from}?view=calendar`, to: `${W}/${seg}?view=calendar` })
  }
  out.push({ from: '/usage?days=7&menu=a&menu=b', to: `${W}/usage?days=7&menu=a&menu=b` })
  out.push({ from: '/minutes?q=%ED%95%9C%20%26', to: `${W}/minutes?q=%ED%95%9C%20%26` })
  out.push({ from: `/admin/accounts?project=${ids.projectId}`, to: `${W}/admin/accounts?project=${ids.projectId}` })
  out.push({ from: `/minutes/${ids.minuteId}?block=2&version=v`, to: `${W}/minutes/${ids.minuteId}?block=2&version=v` })
  return out
}

/** 307·요청 원점·경로·쿼리(순수) — Location 은 절대 주소든 상대 경로든 origin 에 풀어 본다(스텁은 상대 경로를 낸다 — 판정 W2).
 *  쿼리는 디코드한 (키, 값) 목록의 순서까지 같아야 한다(%20 과 + 같은 인코딩 차이는 같은 값, 중복 키 순서는 다른 값)
 *  @returns {string[]} 문제 목록 */
export function expectLocation(res, origin, path) {
  const p = []
  if (res.status !== 307) p.push(`상태 ${res.status} ≠ 307`)
  const loc = res.headers.get('location') ?? ''
  let got, want
  try { got = new URL(loc, origin); want = new URL(path, origin) } catch { return [...p, `Location 을 읽을 수 없다: ${loc}`] }
  if (got.origin !== new URL(origin).origin) p.push(`Location 원점 ${got.origin} ≠ ${origin}`)
  if (got.pathname !== want.pathname) p.push(`Location 경로 ${got.pathname} ≠ ${want.pathname}`)
  if (JSON.stringify([...got.searchParams]) !== JSON.stringify([...want.searchParams])) p.push(`Location 쿼리 ${got.search} ≠ ${want.search}`)
  return p
}

/** notFound 판정(순수) — HTTP 404 또는 로딩 경계 안 스트리밍 notFound() 의 digest. 센티널(보이면 안 되는 글자)이 본문에 실렸는지도 함께 */
export function hiddenVerdict({ status, html }, sentinels = []) {
  const p = []
  if (!(status === 404 || notFoundRendered(html))) p.push(`404 가 아니다(상태 ${status}, notFound digest 없음)`)
  for (const s of sentinels) if (html.includes(s)) p.push(`본문에 숨겨야 할 글자 '${s}' 가 있다`)
  return p
}

/** 워크스페이스 전환기 트리거 판정(순수, E5·D4) — 소속 둘 이상이면 SSR HTML 에 트리거 표지가 있고, 하나면 이름만(표지 없음).
 *  개수는 보지 않는다 — 768~1023 에서 드로어를 연 상태는 같은 전환기를 한 번 더 마운트한다(U2b-4 이월)
 *  @returns {string[]} 문제 목록 */
export function switcherVerdict(html, expectList) {
  const has = html.includes(SWITCHER_MARK)
  if (expectList && !has) return [`전환기 트리거(${SWITCHER_MARK})가 없다 — 소속이 둘 이상이면 있어야 한다`]
  if (!expectList && has) return [`전환기 트리거(${SWITCHER_MARK})가 있다 — 소속이 하나면 이름만 보여야 한다`]
  return []
}

/** 프로젝트 내비의 이슈 링크 판정(순수, E7) — 같은 화면의 다른 내비 링크(WBS)를 대조로 본다(내비가 안 그려진 화면을 '없음'으로 읽지 않는다)
 *  @returns {string[]} 문제 목록 */
export function issuesLinkVerdict(html, pid, expectPresent) {
  const p = []
  if (!html.includes(`href="/p/${pid}/wbs"`)) p.push('내비가 그려지지 않았다(WBS 링크 없음 — 대조 실패)')
  const has = html.includes(`href="/p/${pid}/issues"`)
  if (expectPresent && !has) p.push('이슈 링크가 없다(모듈을 켰는데)')
  if (!expectPresent && has) p.push('이슈 링크가 있다(모듈을 껐는데)')
  return p
}

/** /api/shell 배지 판정(순수, E10) — hidden = 소속이 아닌 워크스페이스·볼 수 없는 프로젝트의 범위라 세 배지 모두 null(남의 수를 흘리지 않는다),
 *  own = 자기 워크스페이스의 검토 대기 수는 숫자(대조 — 같은 경로가 숫자를 낸다는 것)
 *  @param {{ status: number, body: any }} res @param {'hidden' | 'own'} kind @returns {string[]} */
export function shellBadgeVerdict(res, kind) {
  if (res.status !== 200) return [`상태 ${res.status} ≠ 200`]
  const b = res.body?.badges
  if (!b || typeof b !== 'object') return ['응답에 badges 가 없다']
  if (kind === 'hidden') return ['myWorkReview', 'projectApprovals', 'projectUnreadAnnouncements'].filter((k) => b[k] !== null).map((k) => `${k} = ${JSON.stringify(b[k])} (null 이어야 한다)`)
  return typeof b.myWorkReview === 'number' ? [] : [`myWorkReview = ${JSON.stringify(b.myWorkReview)} (자기 워크스페이스는 숫자여야 한다)`]
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)

async function main(steps) {
  const env = laneEnv({ base: process.env.E2E_BASE_URL ?? null })
  const { db, baseUrl } = env
  const origin = new URL(baseUrl).origin
  const slugA = (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()
  const wsA = must('워크스페이스 A', await db.from('workspaces').select('id, slug').eq('slug', slugA).maybeSingle())
  const wsB = must('워크스페이스 B', await db.from('workspaces').select('id, slug').eq('slug', SEED_WS_B.slug).maybeSingle())
  if (!wsA || !wsB) throw new Error('워크스페이스 A·B 가 없다 — ui-capture.mjs seed 를 먼저')
  const seedProject = must('시드 프로젝트', await db.from('projects').select('id, name').eq('workspace_id', wsA.id).eq('name', SEED_PROJECT).maybeSingle())
  if (!seedProject) throw new Error('시드 프로젝트가 없다 — ui-capture.mjs seed 를 먼저')
  const ana = await userIdByEmail(db, ANA.email), duo = await userIdByEmail(db, DUO.email)
  if (!ana || !duo) throw new Error('캡처 시드 계정이 없다 — ui-capture.mjs seed 를 먼저')

  // ── 픽스처 — 멱등. bea = B 전용 관리자, B 의 공용 팀·회의록 하나, A 의 이슈 꺼진 프로젝트 하나
  let bea = await userIdByEmail(db, BEA.email)
  if (!bea) {
    const created = await db.auth.admin.createUser({ email: BEA.email, password: randomBytes(24).toString('base64'), email_confirm: true })
    if (created.error) throw new Error(`bea 생성 실패: ${created.error.message}`)
    bea = created.data.user.id
    must('profiles(bea)', await db.from('profiles').upsert({ user_id: bea, email: BEA.email, display_name: BEA.name }))
  }
  must('workspace_members(bea@B)', await db.from('workspace_members').upsert({ workspace_id: wsB.id, user_id: bea, role: 'admin' }, { onConflict: 'workspace_id,user_id' }))
  const teamB = must('B 공용 팀 조회', await db.from('teams').select('id').eq('workspace_id', wsB.id).is('project_id', null).eq('code', 'OPS').maybeSingle())
  if (!teamB) must('B 공용 팀', await db.from('teams').insert({ workspace_id: wsB.id, project_id: null, code: 'OPS', name: '운영', sort_order: 1 }))
  const minuteB = must('B 회의록 조회', await db.from('minutes').select('id').eq('workspace_id', wsB.id).eq('title', MINUTE_B_TITLE).maybeSingle())?.id ?? randomUUID()
  const bodyB = `# ${MINUTE_B_TITLE}\n\n참고: /minutes/${minuteB}\n`
  if (!must('B 회의록 존재', await db.from('minutes').select('id').eq('id', minuteB).maybeSingle())) {
    must('B 회의록', await db.rpc('create_minute_with_version', {
      p_minute_id: minuteB, p_minute_date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }), p_team_code: 'OPS', p_title: MINUTE_B_TITLE,
      p_body_md: bodyB, p_body_hash: fnv1a64(bodyB), p_meeting_id: null, p_project_id: null, p_meeting_occurrence_date: null, p_folder_id: null,
      p_external_id: null, p_actor_id: duo, p_actor_name: DUO.name, p_workspace_id: wsB.id,
    }))
  }
  // 프로젝트 둘 — 설정 쓰기는 생성 RPC 한 길(생성 RPC 호출은 이 함수 안 한 곳). 이미 있으면 만들지 않는다
  const ensureProject = async (workspaceId, name, actorId, modules) => {
    const found = must(`프로젝트 조회(${name})`, await db.from('projects').select('id').eq('workspace_id', workspaceId).eq('name', name).maybeSingle())
    if (found) return found.id
    return must(`프로젝트 생성(${name})`, await db.rpc('create_project_with_settings', {
      p_workspace_id: workspaceId, p_name: name, p_start_date: null, p_end_date: null, p_description: 'e2e-sp3b',
      p_values: { 'core.level_labels': [...LEVEL_LABELS_4], 'modules.enabled': modules },
      p_copy_from: null, p_actor: actorId, p_command_id: randomUUID(), p_schema_version: SCRIPT_SCHEMA_VERSION,
    })).project_id
  }
  const pOff = await ensureProject(wsA.id, POFF_NAME, ana, PROJECT_TOGGLE_IDS.filter((m) => m !== 'issues'))
  // duo 는 B 에서도 프로젝트 역할이 있어야 프로젝트 없는 회의록을 쓸 수 있다(그 워크스페이스에 역할이 있는 사람만 — 멤버십만으로는 거부)
  const pB = await ensureProject(wsB.id, PB_NAME, bea, [...PROJECT_TOGGLE_IDS])
  const duoB = must('duo@B 명단 인물', await db.from('people').select('id').eq('workspace_id', wsB.id).eq('email', DUO.email).maybeSingle())
  if (!duoB) throw new Error('duo 의 B 인물 행이 없다 — ui-capture.mjs seed 를 먼저')
  must('duo@B 프로젝트 명단', await db.from('project_members').upsert({ project_id: pB, person_id: duoB.id, access_role: 'member', active: true }, { onConflict: 'project_id,person_id' }))
  const minuteA = must('A 회의록', await db.from('minutes').select('id, title').eq('workspace_id', wsA.id).order('created_at', { ascending: true }).limit(1)).at(0)
  if (!minuteA) throw new Error('A 에 회의록이 없다 — ui-capture.mjs seed 를 먼저')

  // ── 세션 — 계정마다 새 비밀번호(메모리)로 로그인한다. 같은 항아리로 fetch(쿠키)와 서버 액션을 부른다
  class Fail extends Error {}
  const session = createSessionFactory({
    env: localClientEnv(env.envText), base: origin, manifestPath: '.next/server/server-reference-manifest.json', Fail,
    actions: {
      createMinute: { filename: 'src/app/actions/minutes.ts', exportedName: 'createMinute', worker: '/w/[slug]/minutes/page' },
      updateProjectSettings: { filename: 'src/app/actions/settings.ts', exportedName: 'updateProjectSettings', worker: '/p/[projectId]/settings/page' },
    },
  })
  const login = async (label, userId, email) => {
    const pw = randomBytes(24).toString('base64')
    must(`비밀번호(${label})`, await db.auth.admin.updateUserById(userId, { password: pw }))
    const s = session(label)
    await s.login(email, pw)
    return s
  }
  const plat = await userIdByEmail(db, PLATFORM.email)
  if (!plat) throw new Error('캡처 시드 플랫폼 관리자가 없다 — ui-capture.mjs seed 를 먼저')
  const S = { ana: await login('ana', ana, ANA.email), duo: await login('duo', duo, DUO.email), bea: await login('bea', bea, BEA.email), plat: await login('plat', plat, PLATFORM.email) }
  const cookies = (s, extra = {}) => cookieHeader([...[...s.jar].map(([name, value]) => ({ name, value })), ...Object.entries(extra).map(([name, value]) => ({ name, value }))])
  const get = async (s, path, { extra, follow = false } = {}) => {
    const res = await fetch(origin + path, { redirect: follow ? 'follow' : 'manual', headers: { cookie: cookies(s, extra) } })
    return { status: res.status, headers: res.headers, html: res.status === 307 || res.status === 308 ? '' : await res.text(), url: res.url }
  }

  const results = []
  const run = async (name, what, fn) => {
    if (steps.length && !steps.includes(name)) return
    const t = new Date()
    let problems
    try { problems = await fn() } catch (e) { problems = [`예외: ${e instanceof Error ? e.message : String(e)}`] }
    results.push({ name, what, ok: problems.length === 0, problems, at: t.toISOString() })
    console.log(`${problems.length ? '✗' : '✓'} ${name} ${what}${problems.length ? ` — ${problems.join(' · ')}` : ''}`)
  }

  await run('E1', '옛 경로 → 새 경로 307(쿼리 보존·요청 원점)', async () => {
    const p = []
    for (const c of legacyCases(wsA.slug, { minuteId: minuteA.id, projectId: seedProject.id })) {
      const res = await get(S.ana, c.from)
      for (const x of expectLocation(res, origin, c.to)) p.push(`${c.from}: ${x}`)
    }
    return p
  })

  await run('E2', '회의록 영구 링크 — 행의 워크스페이스로, 타 워크스페이스 계정은 404', async () => {
    const p = []
    const ok = await get(S.ana, `/minutes/${minuteA.id}`)
    for (const x of expectLocation(ok, origin, `/w/${wsA.slug}/minutes/${minuteA.id}`)) p.push(`ana: ${x}`)
    const page = await get(S.ana, `/w/${wsA.slug}/minutes/${minuteA.id}`)
    if (page.status !== 200 || !page.html.includes(minuteA.title)) p.push(`ana 상세 상태 ${page.status}·제목 ${page.html.includes(minuteA.title)}`)
    const bea = await get(S.bea, `/minutes/${minuteA.id}`, { follow: true })
    p.push(...hiddenVerdict(bea, [minuteA.title]).map((x) => `bea: ${x}`))
    return p
  })

  await run('E4', '비소속(bea) — 워크스페이스 A 화면 404·A 의 이름이 본문에 없다', async () => {
    const p = []
    for (const path of [`/w/${wsA.slug}`, `/w/${wsA.slug}/minutes`, `/w/${wsA.slug}/agents`]) {
      const res = await get(S.bea, path)
      p.push(...hiddenVerdict(res, [SEED_PROJECT, minuteA.title]).map((x) => `${path}: ${x}`))
      console.log(`  · E4 ${path} → 상태 ${res.status}${notFoundRendered(res.html) ? ' + notFound digest' : ''}`)   // 판정은 S-2 대로 '404 또는 digest' — 실제 상태를 남긴다
    }
    return p
  })

  await run('E6', '두 워크스페이스(duo) — 각자의 회의록만, 프로젝트 없는 회의록 생성은 인자 워크스페이스에', async () => {
    const p = []
    const a = await get(S.duo, `/w/${wsA.slug}/minutes`), b = await get(S.duo, `/w/${wsB.slug}/minutes`)
    if (a.status !== 200 || b.status !== 200) p.push(`상태 A ${a.status} · B ${b.status}`)
    if (!a.html.includes(minuteA.title)) p.push('A 목록에 A 회의록이 없다')
    if (a.html.includes(MINUTE_B_TITLE)) p.push('A 목록에 B 회의록이 샌다')
    if (!b.html.includes(MINUTE_B_TITLE)) p.push('B 목록에 B 회의록이 없다')
    if (b.html.includes(minuteA.title)) p.push('B 목록에 A 회의록이 샌다')
    const title = `E2E SP3b 생성 ${stamp()}`
    // 팀 마스터는 프로세스 전역 캐시(TTL 60초 — 오래된 값을 주면서 뒤에서 갱신)라, 방금 만든 B 의 공용 팀이 아직 캐시에 없으면 '잘못된 담당' 이 난다.
    // 그 한 가지 거절만 갱신될 때까지 다시 시도한다(최대 90초) — 다른 거절은 바로 문제로 둔다
    let result
    for (let attempt = 0; attempt < 19; attempt++) {
      result = (await S.duo.action(`/w/${wsB.slug}/minutes`, 'createMinute', [
        minuteInput({ date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }), teamCode: 'OPS', title, bodyMd: '# 생성\n', projectId: null }), null, null, wsB.id,
      ])).result
      if (result?.ok || result?.error !== '잘못된 담당입니다.') break
      await new Promise((r) => setTimeout(r, 5000))
    }
    if (!result?.ok) p.push(`createMinute 실패: ${JSON.stringify(result)}`)
    else {
      const row = must('생성 행', await db.from('minutes').select('workspace_id').eq('id', result.id).maybeSingle())
      if (row?.workspace_id !== wsB.id) p.push(`새 행의 워크스페이스 ${row?.workspace_id} ≠ B`)
    }
    return p
  })

  await run('E8', '루트 리졸버 — 쿠키 없음→첫 소속, 쿠키=B→B, 위조 쿠키→첫 소속', async () => {
    const p = []
    const to = (res) => new URL(res.headers.get('location') ?? '', origin).pathname
    const r1 = await get(S.ana, '/'); if (r1.status !== 307 || !to(r1).startsWith(`/w/${wsA.slug}`)) p.push(`ana: ${r1.status} ${to(r1)}`)
    const r2 = await get(S.duo, '/', { extra: { 'dflow-ws': wsB.slug } }); if (r2.status !== 307 || !to(r2).startsWith(`/w/${wsB.slug}`)) p.push(`duo+B: ${r2.status} ${to(r2)}`)
    const r3 = await get(S.ana, '/', { extra: { 'dflow-ws': wsB.slug } }); if (r3.status !== 307 || !to(r3).startsWith(`/w/${wsA.slug}`)) p.push(`ana+위조: ${r3.status} ${to(r3)}`)
    return p
  })

  await run('E9', '전환 대상 — 이슈가 꺼진 프로젝트는 개요 + fallback, 비소속은 404', async () => {
    const p = []
    const q = `/api/nav/switch-target?project=${pOff}&path=${encodeURIComponent(`/p/${seedProject.id}/issues`)}`
    const ok = await get(S.ana, q)
    let body = null
    try { body = JSON.parse(ok.html) } catch { /* 아래에서 문제로 */ }
    if (ok.status !== 200 || body?.href !== `/p/${pOff}/dashboard` || body?.fallbackModule !== 'issues') p.push(`ana: ${ok.status} ${ok.html.slice(0, 120)}`)
    const no = await get(S.bea, q)
    if (no.status !== 404) p.push(`bea: 상태 ${no.status} ≠ 404`)
    return p
  })

  await run('E11', '소프트 이동 — 회의록 카드의 영구 링크가 스텁을 지나 새 상세로(전체 새로고침·오류 경계 없음)', async () => {
    const p = []
    const { chromium } = await loadPlaywright()
    const browser = await chromium.launch()
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      await ctx.addCookies([...S.duo.jar].map(([name, value]) => ({ name, value, url: origin })))
      const page = await ctx.newPage()
      const docs = [], errs = []
      page.on('request', (r) => { if (r.resourceType() === 'document') docs.push(r.url()) })
      page.on('pageerror', (e) => errs.push(String(e)))
      const startPath = `/w/${wsB.slug}/minutes`
      await page.goto(origin + startPath, { waitUntil: 'networkidle' })
      const link = page.locator(`a[href$="/minutes/${minuteB}"]`).first()
      if ((await link.count()) === 0) return [`${startPath} 에 회의록 링크가 없다`]
      docs.length = 0
      await link.click()
      try { await page.waitForURL((u) => u.pathname === `/w/${wsB.slug}/minutes/${minuteB}`, { timeout: 15_000 }) } catch { p.push(`최종 경로 ${new URL(page.url()).pathname}`) }
      if (docs.length) p.push(`전체 새로고침(문서 요청 ${docs.length})`)
      if (errs.length) p.push(`페이지 오류 ${errs.length}`)
      if ((await page.getByText('화면을 불러오지 못했습니다').count()) > 0) p.push('오류 경계가 보인다')
      if (new URL(page.url()).search.includes('_rsc')) p.push('주소에 _rsc 가 샌다')
    } finally { await browser.close() }
    return p
  })

  await run('E5', '전환기 — 소속이 둘 이상(duo)일 때만 트리거, 하나(ana·시드 플랫폼 관리자)면 이름만, 비소속 보기엔 배지', async () => {
    const p = []
    const memberships = async (userId) => must('소속 수', await db.from('workspace_members').select('workspace_id').eq('user_id', userId)).length
    for (const [who, s, uid, mustList] of [['duo', S.duo, duo, true], ['ana', S.ana, ana, false], ['plat', S.plat, plat, null]]) {
      const n = await memberships(uid)
      const expectList = n >= 2
      if (mustList !== null && expectList !== mustList) { p.push(`${who}: 소속 ${n}곳 — 시드가 기대와 다르다`); continue }
      const res = await get(s, `/w/${wsA.slug}`)
      if (res.status !== 200) { p.push(`${who}: 상태 ${res.status}`); continue }
      p.push(...switcherVerdict(res.html, expectList).map((x) => `${who}(소속 ${n}): ${x}`))
    }
    // 플랫폼 관리자가 소속 아닌 B 를 볼 때 — 전환기 목록은 소속만(트리거 없음)이고 보는 중 배지가 뜬다
    const viewB = await get(S.plat, `/w/${wsB.slug}`)
    if (viewB.status !== 200) p.push(`plat 가 B 를 볼 때 상태 ${viewB.status}`)
    else {
      p.push(...switcherVerdict(viewB.html, false).map((x) => `plat@B: ${x}`))
      if (!viewB.html.includes('플랫폼 관리자로 보는 중')) p.push('plat@B: 보는 중 배지가 없다')
    }
    return p
  })

  await run('E7', '모듈 끈 메뉴 — 프로젝트의 이슈를 켜면 내비에 링크가 생기고 끄면 사라진다(끝에 원래 값으로)', async () => {
    const p = []
    const readCfg = async () => {
      const row = must('설정 읽기', await db.from('project_settings').select('revision, values').eq('project_id', pOff).maybeSingle())
      if (!row) throw new Error(`프로젝트 설정 행이 없다(${pOff})`)
      return { revision: Number(row.revision), enabled: row.values['modules.enabled'] }
    }
    const setModules = async (enabled) => {
      const cur = await readCfg()
      const r = await S.ana.action(`/p/${pOff}/settings`, 'updateProjectSettings', [pOff, { expectedRevision: cur.revision, commandId: randomUUID(), set: { 'modules.enabled': enabled }, unset: [] }])
      if (!r.result?.ok || r.result.kind !== 'applied') throw new Error(`updateProjectSettings 결과: ${JSON.stringify(r.result)}`)
    }
    const nav = async (expectPresent, what) => {
      const res = await get(S.ana, `/p/${pOff}/dashboard`)
      if (res.status !== 200) return [`${what}: 개요 상태 ${res.status}`]
      return issuesLinkVerdict(res.html, pOff, expectPresent).map((x) => `${what}: ${x}`)
    }
    const original = (await readCfg()).enabled
    if (!Array.isArray(original)) throw new Error('modules.enabled 가 배열이 아니다')
    try {
      p.push(...(await nav(original.includes('issues'), '시작')))
      await setModules(original.includes('issues') ? original.filter((m) => m !== 'issues') : [...original, 'issues'])
      p.push(...(await nav(!original.includes('issues'), '바꾼 뒤')))
    } finally {
      const now = (await readCfg()).enabled
      if (JSON.stringify(now) !== JSON.stringify(original)) await setModules(original)   // 되돌림 — 이 값은 E9 의 전제다
    }
    p.push(...(await nav(original.includes('issues'), '되돌린 뒤')))
    return p
  })

  await run('E10', '비소속 배지 — bea 의 A 범위 /api/shell 은 세 배지 모두 null, 자기 B 는 숫자', async () => {
    const p = []
    const shell = async (s, q) => {
      const res = await get(s, `/api/shell?${q}`)
      let body = null
      try { body = JSON.parse(res.html) } catch { /* 아래에서 상태·badges 문제로 */ }
      return { status: res.status, body }
    }
    p.push(...shellBadgeVerdict(await shell(S.bea, `ws=${wsA.id}&project=${seedProject.id}`), 'hidden').map((x) => `bea@A: ${x}`))
    p.push(...shellBadgeVerdict(await shell(S.bea, `ws=${wsB.id}&project=${pB}`), 'own').map((x) => `bea@B: ${x}`))
    return p
  })

  if (!steps.length || steps.includes('E3')) {
    results.push({ name: 'E3', what: '건너뜀(UI-3)', ok: true, skipped: true, problems: [], at: new Date().toISOString() })
    console.log('- E3 건너뜀(UI-3)')
  }

  const outDir = process.env.UI_CAPTURE_OUT_DIR
  if (outDir && results.length) {
    mkdirSync(outDir, { recursive: true })
    const file = join(outDir, `e2e-sp3b-${new Date().toISOString().replace(/[:.]/g, '-')}.md`)
    writeFileSync(file, ['| 단계 | 내용 | 결과 | 시각 |', '|---|---|---|---|', ...results.map((r) => `| ${r.name} | ${r.what} | ${r.skipped ? '건너뜀' : r.ok ? '✓' : `✗ ${r.problems.join(' · ').replace(/\|/g, '/')}`} | ${r.at} |`)].join('\n') + '\n')
    console.log(`표: ${file}`)
  }
  if (results.some((r) => !r.ok)) process.exit(1)
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main(process.argv.slice(2)).catch((e) => { console.error(`✗ ${e instanceof Error ? e.message : String(e)}`); process.exit(1) })
}
