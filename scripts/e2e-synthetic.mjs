// scripts/e2e-synthetic.mjs — 합성 게이트(스펙 SP3a §7.3, `npm run accept:synthetic`). 로컬 전용.
// 고객 이름·실명 없는 합성 구성 둘(R — 연구 과제, C — 건설 현장, tests/fixtures/synthetic/configs.ts 와 같은 값)로 "코드를 건드리지 않고
// 설정만으로 다른 업무 형태를 만들 수 있다"를 로컬 스택에서 실제 서버 액션으로 단언한다.
//   S1 생성: 워크스페이스 R·C 와 각 프로젝트를 빈 값으로 만들고(생성과 필수 설정이 한 트랜잭션 — createProject) SP3a 등록 키를 **화면과 같은 서버 액션**으로
//        넣는다 — 워크스페이스(modules.allowed·ai.enabled)는 updateWorkspaceSettings, 프로젝트(단계 라벨·모듈 구성·마일스톤 키워드·크레딧 표)는
//        updateProjectSettings. 다시 읽은 값이 넣은 값과 같고 설정 이력이 남는다(행위자 = 플랫폼 관리자, source = edit).
//        SP4 A1(S1-teams-areas): 팀(addProjectTeam — R RES·OPS, C CIV·MEP·SAF)과 주간 영역·담당 팀(upsertArea — R 셋·C 넷,
//        tests/fixtures/synthetic/areas.ts 와 같은 값)을 설정 화면과 같은 액션으로 더하고 다시 읽은 값이 같다(C 는 두 키에 weekly — D40).
//   S9 격리: R 의 설정을 바꾼 뒤 C 의 설정 문서(전 키·revision)·이력이 그대로다. 다른 워크스페이스(B)의 관리자는 R·C 의 설정 두 표와 이력 두 표를 0건 읽는다.
//   S2 WBS(SP4 A1): R 4단(exceljs 로 직접)·C 3단(양식 다운로드)을 양식 저장과 함께 가져오고, 같은 commandId 재전송이 항목 1벌·kind 'duplicate'·
//        wbs.excel_profile 이력 1건이다.
//   S4 주간(월)(SP4 A1): C 에서 연속 2주(월요일 키 — 앱이 정한다)와 이월, 영역 개명 뒤 같은 area_id·같은 셀. R 의 일요일 키는 SP5.
//   S3·S5~S8·S10: '미활성(담당 SP)' 으로 기록한다(D25) — 건너뜀으로 세지 않는다. 그 단계가 켜지는 SP 가 이 러너에 더한다.
// 설정은 service_role 로 넣지 않는다(워크스페이스 행 셋과 그 허용 모듈 시드만 로컬 픽스처 — 생성 화면은 SP3). 실행 전후 src·DB 스키마(supabase/migrations 등)에
// 미커밋 변경이 없어야 한다 — 합성 게이트는 소스를 고치지 않고 통과해야 한다(config.toml 의 로컬 포트 오버라이드는 제외, 대신 전후 diff 가 같아야 한다).
// 사용: db:reset → dev:bootstrap 직후(깨끗한 DB), e2e-local.mjs 와 같은 방식으로 3101 에 띄운 npm run dev 가 떠 있는 상태에서
//   BOOTSTRAP_PASSWORD=… [BOOTSTRAP_EMAIL=admin@example.com] [E2E_BASE_URL=http://localhost:3101(기본값)] node scripts/e2e-synthetic.mjs
// 비밀번호는 env 로만 받고 출력하지 않는다(B 관리자 비밀번호는 실행마다 새로 만든다). 결과는 stdout 에 JSON 한 덩어리, 실패하면 그 자리에서 멈추고 exit 1.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  ERR_DENIED, areaInput, e2eBaseUrl, fillWbsWorkbook, importForm, importResultView, inspectForm, isMondayIso, localClientEnv, seoulToday, shiftDays,
  workspaceAdminAccountInput,
} from './lib/e2e.mjs'
import { createSessionFactory } from './lib/e2e-session.mjs'
import {
  PENDING_STEPS, SYNTHETIC_C, SYNTHETIC_R, SYNTHETIC_WORKSPACE_B, areaView, expectedAreas, expectedTeams, teamView, wbsRows,
} from './lib/synthetic.mjs'
import { BOOTSTRAP_MODULE_IDS } from './lib/bootstrap-modules.mjs'
import { localAdminEnv } from './lib/targets.mjs'

class Fail extends Error {}
const log = (m) => console.error(`· ${m}`)

let env
let adminEnv
try {
  const text = readFileSync('.env.local', 'utf8')
  env = localClientEnv(text)
  adminEnv = localAdminEnv(text)
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
}
const base = (() => {
  try { return e2eBaseUrl(process.env.E2E_BASE_URL || 'http://localhost:3101') } catch (e) {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  }
})()
const email = (process.env.BOOTSTRAP_EMAIL || 'admin@example.com').trim().toLowerCase()
const password = process.env.BOOTSTRAP_PASSWORD
if (!password) { console.error('✗ BOOTSTRAP_PASSWORD 가 없다 — dev:bootstrap 때 쓴 값을 env 로 넘긴다'); process.exit(1) }

const MANIFEST = '.next/server/server-reference-manifest.json'
const ACTIONS = {
  createProject: { filename: 'src/app/actions/project.ts', exportedName: 'createProject', worker: '/projects/page' },
  createAccount: { filename: 'src/app/actions/accounts.ts', exportedName: 'createAccount', worker: '/admin/accounts/page' },
  updateProjectSettings: { filename: 'src/app/actions/settings.ts', exportedName: 'updateProjectSettings', worker: '/p/[projectId]/settings/page' },
  updateWorkspaceSettings: { filename: 'src/app/actions/settings.ts', exportedName: 'updateWorkspaceSettings', worker: '/w/[slug]/settings/page' },
  addProjectTeam: { filename: 'src/app/actions/projectTeams.ts', exportedName: 'addProjectTeam', worker: '/p/[projectId]/settings/page' },
  upsertArea: { filename: 'src/app/actions/projectAreas.ts', exportedName: 'upsertArea', worker: '/p/[projectId]/settings/page' },
  createWeeklyReport: { filename: 'src/app/actions/weekly.ts', exportedName: 'createWeeklyReport', worker: '/p/[projectId]/weekly/page' },
  saveWeeklyCells: { filename: 'src/app/actions/weekly.ts', exportedName: 'saveWeeklyCells', worker: '/p/[projectId]/weekly/page' },
}
const session = createSessionFactory({ env, base, manifestPath: MANIFEST, actions: ACTIONS, Fail })

const summary = { base, email, steps: [], pending: PENDING_STEPS }
const step = (name, detail, failure) => {
  if (['name', 'at', 'ok'].some((k) => k in detail)) throw new Fail(`단계 ${name} 의 기록에 예약 키(name·at·ok)가 있다`)
  summary.steps.push({ name, at: new Date().toISOString(), ok: !failure, ...detail })
  if (failure) { log(`${name} ✗`); throw new Fail(failure) }
  log(`${name} ✓`)
}
function rows(what, { data, error }) {
  if (error || !data) throw new Fail(`${what} 조회 실패: ${error?.message ?? 'data 없음'}`)
  return data
}
const mustOk = (what, result) => { if (!result || result.ok !== true) throw new Fail(`${what} 실패: ${JSON.stringify(result)}`); return result }
/** 키 순서를 정렬한 JSON — jsonb 는 키를 정렬해 저장하므로 순서가 다른 같은 값을 같다고 본다(배열 순서는 그대로다). */
const canonical = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))
const same = (what, actual, expected) => {
  if (canonical(actual) !== canonical(expected)) throw new Fail(`${what} 가 다르다: ${canonical(actual)} (기대 ${canonical(expected)})`)
}
/**
 * 소스·스키마가 깨끗한가 — 합성 게이트는 코드를 고치지 않고 통과해야 한다(스펙 §7.3: `git diff --quiet -- src supabase`).
 * 검사 대상은 src 와 DB 스키마(supabase/migrations·rollbacks·seed)다. supabase/config.toml 은 뺀다 — 전용 로컬 스택(포트·project_id)을 쓰는
 * 스크래치 워크트리는 그 파일만 환경에 맞게 바꿔 둔다(커밋하지 않는다). 대신 그 파일의 diff 도 실행 전후로 같아야 한다.
 */
const GUARDED = ['src', 'supabase/migrations', 'supabase/rollbacks', 'supabase/seed.sql']
const gitOut = (args) => execFileSync('git', args, { encoding: 'utf8' })
const fingerprint = () => createHash('sha256').update(gitOut(['diff', '--', 'src', 'supabase'])).digest('hex')
let sourceFingerprint = null
function assertSourceClean(when) {
  const dirty = gitOut(['status', '--porcelain', '--', ...GUARDED]).trim()
  if (dirty) throw new Fail(`${when}: src·supabase 스키마에 미커밋 변경이 있다 — 합성 게이트는 소스를 건드리지 않고 통과해야 한다:\n${dirty}`)
  const now = fingerprint()
  if (sourceFingerprint !== null && now !== sourceFingerprint) throw new Fail(`${when}: 실행 중에 src·supabase 의 diff 가 바뀌었다`)
  sourceFingerprint = now
}

async function main() {
  assertSourceClean('실행 전')
  const admin = session('admin')
  const me = await admin.login(email, password)
  const svc = createClient(adminEnv.url, adminEnv.serviceRoleKey, { auth: { persistSession: false } })
  // 초 단위 + 무작위 꼬리 — 슬러그·계정 이메일이 같은 분에 다시 돌려도 겹치지 않는다
  const stamp = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 4)}`
  step('login', { userId: me.id })

  // ── 워크스페이스 R·C·B — 행만 service_role(로컬 전용, 생성 화면은 SP3). 이름은 합성이고 실행마다 새 슬러그라 다시 돌려도 겹치지 않는다.
  const makeWorkspace = async (slug, name) => {
    const { data, error } = await svc.from('workspaces').insert({ slug: `${slug}-${stamp}`, name: `${name} ${stamp}` }).select('id, slug, name').single()
    if (error) throw new Fail(`워크스페이스 ${slug} 픽스처 실패: ${error.message}`)
    return data
  }
  const wsR = await makeWorkspace(SYNTHETIC_R.slug, SYNTHETIC_R.name)
  const wsC = await makeWorkspace(SYNTHETIC_C.slug, SYNTHETIC_C.name)
  const wsB = await makeWorkspace(SYNTHETIC_WORKSPACE_B.slug, SYNTHETIC_WORKSPACE_B.name)
  // 새 워크스페이스는 허용 모듈이 비어(닫힌) 있다 — 기본(비core 13)으로 채워 두면 S1 의 updateWorkspaceSettings 가 구성별 목록으로 바꾼다
  const seedAllowed = async (ws) => {
    const r = rows('워크스페이스 설정', await svc.from('workspace_settings').select('revision').eq('workspace_id', ws.id).single())
    const { error } = await svc.rpc('apply_workspace_settings', { p_workspace_id: ws.id, p_expected_revision: r.revision, p_command_id: randomUUID(),
      p_set: { 'modules.allowed': [...BOOTSTRAP_MODULE_IDS] }, p_unset: [], p_actor: me.id, p_schema_version: 1, p_source: 'internal' })
    if (error) throw new Fail(`${ws.slug} 허용 모듈 시드 실패: ${error.message}`)
  }
  for (const ws of [wsR, wsC, wsB]) await seedAllowed(ws)

  // ── S1 — 생성(빈 값) + 등록 키(서버 액션)
  await admin.http('GET', '/projects')
  const wsSettingsPage = (ws) => `/w/${encodeURIComponent(ws.slug)}/settings`
  const config = async (cfg, ws) => {
    // 1) 워크스페이스 키 — modules.allowed·ai.enabled (플랫폼 관리자 전용 구역의 키)
    await admin.http('GET', wsSettingsPage(ws))
    const wsDoc = rows(`${cfg.id} 워크스페이스 설정`, await admin.sb.from('workspace_settings').select('revision, values').eq('workspace_id', ws.id).single())
    const set = { 'modules.allowed': cfg.workspace['modules.allowed'], ...(cfg.workspace['ai.enabled'] !== undefined ? { 'ai.enabled': cfg.workspace['ai.enabled'] } : {}) }
    const wr = (await admin.action(wsSettingsPage(ws), 'updateWorkspaceSettings', [ws.id, { expectedRevision: wsDoc.revision, commandId: randomUUID(), set, unset: [] }])).result
    mustOk(`${cfg.id} 워크스페이스 설정`, wr)
    // 2) 프로젝트 — 필수 설정(단계 라벨)과 함께 한 트랜잭션으로 생성
    const name = `합성 ${cfg.id} ${stamp}`
    const created = (await admin.action('/projects', 'createProject', [{
      workspaceId: ws.id, name, startDate: null, endDate: null, description: null, levelLabels: cfg.project['core.level_labels'], commandId: randomUUID(),
    }])).result
    mustOk(`${cfg.id} createProject`, created)
    const proj = rows(`${cfg.id} 프로젝트`, await admin.sb.from('projects').select('id, workspace_id').eq('name', name).single())
    if (proj.workspace_id !== ws.id) throw new Fail(`${cfg.id} 프로젝트가 다른 워크스페이스에 생겼다`)
    same(`${cfg.id} 생성 직후 단계 라벨`, rows(`${cfg.id} 설정`, await admin.sb.from('project_settings').select('values').eq('project_id', proj.id).single()).values['core.level_labels'], cfg.project['core.level_labels'])
    // 3) 나머지 등록 키 — 모듈 구성·마일스톤 키워드·크레딧 표(고정 정책에서 유효한 값)
    await admin.http('GET', `/p/${proj.id}/settings`)
    const doc = rows(`${cfg.id} 설정`, await admin.sb.from('project_settings').select('revision').eq('project_id', proj.id).single())
    const pset = {
      'modules.enabled': cfg.project['modules.enabled'],
      ...(cfg.project['core.milestone_keywords'] !== undefined ? { 'core.milestone_keywords': cfg.project['core.milestone_keywords'] } : {}),
      ...(cfg.project['workflow.stage_credits'] !== undefined ? { 'workflow.stage_credits': cfg.project['workflow.stage_credits'] } : {}),
    }
    const pr = (await admin.action(`/p/${proj.id}/settings`, 'updateProjectSettings', [proj.id, { expectedRevision: doc.revision, commandId: randomUUID(), set: pset, unset: [] }])).result
    mustOk(`${cfg.id} 프로젝트 설정`, pr)
    return { id: proj.id, ws, name, expected: { ...cfg.project, ...pset } }
  }
  const R = await config(SYNTHETIC_R.config, wsR)
  const C = await config(SYNTHETIC_C.config, wsC)

  const readDoc = async (client, table, col, id) => rows(`${table} ${id}`, await client.from(table).select('values, revision, schema_version').eq(col, id).single())
  const readHistory = async (client, table, col, id) => rows(`${table} 이력 ${id}`, await client.from(table).select('id, revision, key, new_value, source, changed_by').eq(col, id).order('id', { ascending: true }))
  for (const [label, proj, cfg] of [['R', R, SYNTHETIC_R.config], ['C', C, SYNTHETIC_C.config]]) {
    const pdoc = await readDoc(admin.sb, 'project_settings', 'project_id', proj.id)
    for (const [key, value] of Object.entries(proj.expected)) same(`${label} ${key}`, pdoc.values[key], value)
    const wdoc = await readDoc(admin.sb, 'workspace_settings', 'workspace_id', proj.ws.id)
    same(`${label} modules.allowed`, wdoc.values['modules.allowed'], cfg.workspace['modules.allowed'])
    if (cfg.workspace['ai.enabled'] !== undefined) same(`${label} ai.enabled`, wdoc.values['ai.enabled'], cfg.workspace['ai.enabled'])
    const phist = await readHistory(admin.sb, 'project_settings_history', 'project_id', proj.id)
    // 키마다 이력이 남아야 한다 — 서버 액션으로 바뀐 키는 source=edit·행위자=플랫폼 관리자. 생성 때 이미 그 값이었던 키(modules.enabled 의 기본값은
    // 워크스페이스 허용 목록에서 나온다)는 값이 안 바뀌어 edit 행이 없고, 생성 행(source=create)의 값이 기대값이어야 한다.
    for (const key of Object.keys(proj.expected).filter((k) => k !== 'core.level_labels')) {
      const edit = phist.find((x) => x.source === 'edit' && x.key === key)
      if (edit) {
        if (edit.changed_by !== me.id) throw new Fail(`${label} ${key} 이력의 행위자가 플랫폼 관리자가 아니다: ${edit.changed_by}`)
        continue
      }
      const created = phist.find((x) => x.source === 'create' && x.key === key)
      if (!created) throw new Fail(`${label} ${key} 의 설정 이력이 없다`)
      same(`${label} ${key} 의 생성 시점 값(edit 행이 없어 생성 행이 근거)`, created.new_value, proj.expected[key])
    }
  }
  step('S1-create', {
    R: { workspace: wsR.slug, projectId: R.id, keys: Object.keys(R.expected) },
    C: { workspace: wsC.slug, projectId: C.id, keys: Object.keys(C.expected) },
    note: '생성(필수 설정 한 트랜잭션) → 서버 액션으로 등록 키 → 다시 읽은 값이 같고 이력(행위자·source=edit)이 남는다',
  })

  // ── S1 추가(SP4 A1 — 스펙 §6.4 S1·D40) — 팀(addProjectTeam)·주간 영역과 담당 팀(upsertArea)을 설정 화면과 같은 액션으로 더하고 다시 읽는다.
  //    팀 이름은 code 와 같다(addProjectTeam 은 이름을 받지 않는다 — 개명은 A2·B, D37). 픽스처의 팀 이름은 그 뒤 몫이다.
  const teamsAndAreas = async (label, proj, def) => {
    await admin.http('GET', `/p/${proj.id}/settings`)
    for (const code of def.teams) {
      mustOk(`${label} addProjectTeam(${code})`, (await admin.action(`/p/${proj.id}/settings`, 'addProjectTeam', [proj.id, code])).result)
    }
    const teamRows = rows(`${label} 팀`, await admin.sb.from('teams').select('id, code, name, sort_order, active').eq('project_id', proj.id))
    same(`${label} 팀(다시 읽기)`, teamView(teamRows), expectedTeams(def.teams))
    const teamIdByCode = new Map(teamRows.map((t) => [t.code, t.id]))
    for (const a of def.weeklyAreas) {
      const r = mustOk(`${label} upsertArea(${a.code})`, (await admin.action(`/p/${proj.id}/settings`, 'upsertArea', [proj.id, areaInput(a, teamIdByCode)])).result)
      if (r.status !== 'created') throw new Fail(`${label} 영역 ${a.code} 가 새로 만들어지지 않았다: ${JSON.stringify(r)}`)
    }
    const areaRows = rows(`${label} 주간 영역`, await admin.sb.from('project_areas')
      .select('id, code, name, sort_order, active, area_teams(team_id, kind)').eq('project_id', proj.id).eq('kind', 'weekly_section'))
    same(`${label} 주간 영역(다시 읽기)`, areaView(areaRows, new Map(teamRows.map((t) => [t.id, t.code]))), expectedAreas(def.weeklyAreas))
    return { teamIdByCode, areaIdByCode: new Map(areaRows.map((a) => [a.code, a.id])) }
  }
  const rSetup = await teamsAndAreas('R', R, SYNTHETIC_R)
  const cSetup = await teamsAndAreas('C', C, SYNTHETIC_C)
  step('S1-teams-areas', {
    R: { teams: [...SYNTHETIC_R.teams], areas: SYNTHETIC_R.weeklyAreas.map((a) => a.code), areaIds: Object.fromEntries(rSetup.areaIdByCode) },
    C: { teams: [...SYNTHETIC_C.teams], areas: SYNTHETIC_C.weeklyAreas.map((a) => a.code), areaIds: Object.fromEntries(cSetup.areaIdByCode) },
    note: '팀은 addProjectTeam, 주간 영역·담당 팀은 upsertArea(설정 화면의 편집기와 같은 액션) — 다시 읽은 code·이름·순서·활성·담당 팀이 넣은 값과 같다',
  })

  // ── S9 — 격리
  const snapshot = async (proj) => ({
    project: await readDoc(admin.sb, 'project_settings', 'project_id', proj.id),
    workspace: await readDoc(admin.sb, 'workspace_settings', 'workspace_id', proj.ws.id),
    projectHistory: await readHistory(admin.sb, 'project_settings_history', 'project_id', proj.id),
    workspaceHistory: await readHistory(admin.sb, 'workspace_settings_history', 'workspace_id', proj.ws.id),
  })
  const cBefore = await snapshot(C)
  // R 의 설정을 바꾼다 — 프로젝트(마일스톤 키워드)와 워크스페이스(ai.enabled)
  const rDoc = await readDoc(admin.sb, 'project_settings', 'project_id', R.id)
  mustOk('R 설정 변경', (await admin.action(`/p/${R.id}/settings`, 'updateProjectSettings',
    [R.id, { expectedRevision: rDoc.revision, commandId: randomUUID(), set: { 'core.milestone_keywords': ['격리확인'] }, unset: [] }])).result)
  const rWs = await readDoc(admin.sb, 'workspace_settings', 'workspace_id', wsR.id)
  mustOk('R 워크스페이스 설정 변경', (await admin.action(wsSettingsPage(wsR), 'updateWorkspaceSettings',
    [wsR.id, { expectedRevision: rWs.revision, commandId: randomUUID(), set: { 'ai.enabled': false }, unset: [] }])).result)
  const rAfter = await readDoc(admin.sb, 'project_settings', 'project_id', R.id)
  if (rAfter.revision <= rDoc.revision) throw new Fail('R 의 설정이 바뀌지 않았다 — 격리 시험이 비어 버린다')
  const cAfter = await snapshot(C)
  same('C 의 설정 문서·이력(R 변경 뒤)', cAfter, cBefore)

  // 다른 워크스페이스(B) 관리자는 R·C 의 설정 두 표와 이력 두 표를 0건 읽는다 — 같은 서버 액션 경로의 계정 생성으로 만든다
  const bEmail = `syn-b-${stamp}@example.com`
  const bPassword = `Syn-${randomUUID()}`
  await admin.http('GET', '/admin/accounts')
  mustOk('B 관리자 계정', (await admin.action('/admin/accounts', 'createAccount',
    [workspaceAdminAccountInput({ workspaceId: wsB.id, email: bEmail, name: '합성 B 관리자', password: bPassword })])).result)
  const bAdmin = session('syn-b')
  await bAdmin.login(bEmail, bPassword)
  const visible = {}
  for (const [table, col, ids] of [
    ['project_settings', 'project_id', [R.id, C.id]], ['project_settings_history', 'project_id', [R.id, C.id]],
    ['workspace_settings', 'workspace_id', [wsR.id, wsC.id]], ['workspace_settings_history', 'workspace_id', [wsR.id, wsC.id]],
  ]) {
    visible[table] = rows(`B 가 읽은 ${table}`, await bAdmin.sb.from(table).select(col).in(col, ids)).length
    if (visible[table] !== 0) throw new Fail(`워크스페이스 B 관리자가 ${table} 를 ${visible[table]}행 읽었다`)
  }
  // 대조 — 플랫폼 관리자는 같은 질의에 행이 있다(0건이 '표가 비어서'가 아니라 격리라는 근거)
  const control = rows('대조 질의', await admin.sb.from('project_settings').select('project_id').in('project_id', [R.id, C.id]))
  if (control.length !== 2) throw new Fail(`대조 질의가 ${control.length}행 — 격리 0건의 근거가 비었다`)
  // B 관리자는 R 의 설정을 서버 액션으로도 바꿀 수 없다
  const denied = (await bAdmin.action(`/p/${R.id}/settings`, 'updateProjectSettings',
    [R.id, { expectedRevision: rAfter.revision, commandId: randomUUID(), set: { 'core.milestone_keywords': ['침범'] }, unset: [] }]).catch((e) => ({ result: { ok: false, error: e.message } }))).result
  if (denied?.ok !== false) throw new Fail(`B 관리자가 R 의 설정을 바꿨다: ${JSON.stringify(denied)}`)
  same('R 의 설정(B 침범 시도 뒤)', (await readDoc(admin.sb, 'project_settings', 'project_id', R.id)).values, rAfter.values)
  step('S9-isolation', {
    cUnchanged: { projectRevision: cBefore.project.revision, workspaceRevision: cBefore.workspace.revision, projectHistoryRows: cBefore.projectHistory.length, workspaceHistoryRows: cBefore.workspaceHistory.length },
    rChanged: { before: rDoc.revision, after: rAfter.revision },
    bAdminVisibleRows: visible, controlRows: control.length, deniedWrite: { error: denied?.error ?? ERR_DENIED },
  })

  // ── S2 — WBS 가져오기(스펙 §6.4 S2·§4.4, W5). R 4단(양식의 예시가 3단이라 fillWbsWorkbook 의 새 통합 문서 길로 직접 만든다)·C 3단(내려받은
  //    양식에 채운다), 담당 = 그 프로젝트 팀(S1). 같은 commandId 재전송 → 항목 1벌·kind 'duplicate'·wbs.excel_profile 이력 1건(같은 값은 다시 쓰지 않는다).
  const profileHistory = async (proj) =>
    (await readHistory(admin.sb, 'project_settings_history', 'project_id', proj.id)).filter((h) => h.key === 'wbs.excel_profile')
  const importTwice = async (label, proj, def, templateBuf) => {
    const depth = def.config.project['core.level_labels'].length
    const rowsIn = wbsRows(depth, def.teams)
    const file = await fillWbsWorkbook(rowsIn, templateBuf)
    const fileName = `synthetic-${def.config.id}.xlsx`
    const inspected = await (await admin.http('POST', '/api/import/inspect', { body: inspectForm({ file, fileName, projectId: proj.id }) })).json()
    const commandId = randomUUID()
    const send = async () => (await admin.http('POST', '/api/import/execute', { body: importForm({
      file, fileName, projectId: proj.id, profile: inspected.detection.profile, mode: 'append', commandId, saveProfile: true, registerTeams: false,
    }) })).json()
    const first = await send()
    const second = await send()
    const items = rows(`${label} 항목`, await admin.sb.from('wbs_items').select('id').eq('project_id', proj.id))
    const history = await profileHistory(proj)
    const view = {
      commandId, depth, file: templateBuf ? '양식 다운로드에 채움' : 'exceljs 새 통합 문서', rows: rowsIn.length,
      first: importResultView(first), second: importResultView(second), items: items.length, profileHistory: history.length,
    }
    const ok = first.ok === true && first.kind === 'applied' && first.commandId === commandId && first.count === rowsIn.length && first.profileSaved === true
      && second.ok === true && second.kind === 'duplicate' && second.commandId === commandId && second.count === rowsIn.length
      && items.length === rowsIn.length && history.length === 1
    if (!ok) throw new Fail(`${label} S2: ${JSON.stringify(view)}`)
    return view
  }
  const cTemplate = Buffer.from(await (await admin.http('GET', `/api/import/template?projectId=${C.id}`)).arrayBuffer())
  step('S2-wbs-import', { R: await importTwice('R', R, SYNTHETIC_R, null), C: await importTwice('C', C, SYNTHETIC_C, cTemplate) })

  // ── S4(월) — C 에서 연속 2주(월요일 키)와 이월, 영역 개명 뒤 같은 area_id·같은 셀(스펙 §6.4 S4·W14). 주 키는 앱이 정한다(mondayIso — W30):
  //    러너는 오늘과 +7일을 넘기고 week_start 를 DB 에서 다시 읽어 월요일·7일 간격인지만 본다. R 의 일요일 키는 SP5 다(PENDING_STEPS).
  await admin.http('GET', `/p/${C.id}/weekly`)
  const today = seoulToday()
  const createWeek = async (dateIso, carry) =>
    mustOk(`C 주차(${dateIso}, 이월 ${carry})`, (await admin.action(`/p/${C.id}/weekly`, 'createWeeklyReport', [C.id, dateIso, carry])).result)
  const weekRows = async (reportId) => rows('C 주간 행', await admin.sb.from('weekly_report_rows')
    .select('id, area_id, this_content, this_issue, next_content, next_issue').eq('report_id', reportId).order('id'))
  const weekStart = async (reportId) => rows('C 주간 문서', await admin.sb.from('weekly_reports').select('week_start').eq('id', reportId).single()).week_start
  const codeOfArea = new Map([...cSetup.areaIdByCode].map(([code, id]) => [id, code]))
  const w1 = await createWeek(today, false)
  const w1Rows = await weekRows(w1.reportId)
  mustOk('C 차주 계획 저장', (await admin.action(`/p/${C.id}/weekly`, 'saveWeeklyCells',
    [C.id, w1Rows.map((r) => ({ rowId: r.id, cellKey: 'next_content', content: `S4 계획 ${codeOfArea.get(r.area_id)}` }))])).result)
  const w2 = await createWeek(shiftDays(today, 7), true)
  const weeks = { w1: await weekStart(w1.reportId), w2: await weekStart(w2.reportId) }
  const before = { w1: await weekRows(w1.reportId), w2: await weekRows(w2.reportId) }
  const workDef = SYNTHETIC_C.weeklyAreas[0]
  const workId = cSetup.areaIdByCode.get(workDef.code)
  const renamed = mustOk('C 영역 개명', (await admin.action(`/p/${C.id}/settings`, 'upsertArea',
    [C.id, areaInput(workDef, cSetup.teamIdByCode, { id: workId, name: `${workDef.name} 관리` })])).result)
  const [workRow] = rows('C 개명한 영역', await admin.sb.from('project_areas').select('id, code, name').eq('id', workId))
  const after = { w1: await weekRows(w1.reportId), w2: await weekRows(w2.reportId) }
  const s4 = {
    created: [w1.status, w2.status],
    mondayKeys: isMondayIso(weeks.w1) && shiftDays(weeks.w1, 7) === weeks.w2,
    rowCounts: [before.w1.length, before.w2.length],
    carried: before.w2.every((r) => r.this_content === `S4 계획 ${codeOfArea.get(r.area_id)}` && r.next_content === ''),
    renamed: renamed.id === workId && renamed.status === 'updated' && workRow?.code === workDef.code && workRow?.name === `${workDef.name} 관리`,
    sameCells: canonical(after) === canonical(before),
  }
  const areaCount = SYNTHETIC_C.weeklyAreas.length
  step('S4-weekly-monday', { weeks, ...s4 },
    s4.created.join() === 'created,created' && s4.mondayKeys && s4.rowCounts.join() === `${areaCount},${areaCount}` && s4.carried && s4.renamed && s4.sameCells
      ? undefined : `C 주간(월): ${JSON.stringify({ weeks, ...s4 })}`)

  for (const [id, owner] of Object.entries(PENDING_STEPS)) step(`${id}-pending`, { status: '미활성', owner })

  assertSourceClean('실행 뒤')
  summary.ok = true
}

main().catch((e) => {
  summary.ok = false
  summary.error = e instanceof Fail ? e.message : `${e?.stack ?? e}`
  console.error(`✗ ${summary.error}`)
}).finally(() => {
  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.ok ? 0 : 1)
})
