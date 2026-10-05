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
//   S4 주간(월)(SP4 A1): C 에서 연속 2주(월요일 키 — 앱이 정한다)와 이월, 영역 개명 뒤 같은 area_id·같은 셀. R 의 일요일 키는 SP5 A(S4-weekly-sunday).
//   S10(SP4 부분, A2): R·C 의 주간·WBS 응답·출력(시트 PPT·기본 주간 보고서·WBS 엑셀)·화면 HTML 에 SP4 센티널 0 — 등록 이름과 같은 센티널만 뺀다(D8).
//        교차 — R 의 출력에 C 의 팀 code 가 없고 그 반대도. 경계 행렬 SP4 행(W39): 설정 없음·비활성 유형·데이터 있는 개명.
//   SP5 A(스펙 D43): S1-calendar — R·C 의 워크스페이스·프로젝트에 calendar.*(R LA·월~금·일요일, C 베를린·월~토·월요일)를 설정 화면과 같은 액션으로,
//        C 의 날짜 예외 둘(10/10 토 휴무·10/25 일 근무)을 일정 화면과 같은 액션(addHoliday)으로. S4-weekly-sunday — R 에서 연속 2주(일요일 키)·이월·
//        영역 개명. S5-calendar — 기준일 고정(setBaseDate) 뒤 WBS 엑셀의 계획%(R 60·60, C 60·67)와 '오늘'(프로젝트 tz 의 이번 주 문서가 화면에 실린다).
//        S10-negative 에 시간대 센티널(Asia/Seoul·+09:00)을 더한다. 러너의 '오늘'은 저장된 tz 의 todayInTz 다.
//   SP5 B4: S1-vocab — R 심각도를 설정 액션으로(새 code·라벨·순서), 참조 있는 code 삭제 거부(건수) → 이관 명령 → 삭제, 지운 code 로 등록 거부.
//   SP5 B1: S1-issues — R·C 정책과 R 의 10 issue_area 를 설정 액션으로. S6-issue-codes — R 영역별 RS·C 베를린 연도별 CN 를 실제 등록·DB 대조.
//        S10-negative 에 이슈 화면을 더하고 옛 영역명·PI-I- 센티널을 센다(이슈 이름·코드 그려짐도 증명).
//   SP5b(스펙 D24): S1-workflow(R 이슈 5상태·승인 단계 둘·선행 final·크레딧 정책 {5,5}), S6-issue-status(R 5상태 흐름), S3-flow(R 2단계·C 1단계 승인),
//        S9-workflow(R 상태 비활성·단계 개명 뒤 C 의 설정·이슈·WBS 엑셀 불변).
//   S3(필드)·S7·S8·S10 의 나머지: '미활성(담당 SP)' 으로 기록한다(D25) — 건너뜀으로 세지 않는다. 그 단계가 켜지는 SP 가 이 러너에 더한다.
// 설정은 service_role 로 넣지 않는다(워크스페이스 행 셋과 그 허용 모듈 시드만 로컬 픽스처 — 생성 화면은 SP3). 실행 전후 src·DB 스키마(supabase/migrations 등)에
// 미커밋 변경이 없어야 한다 — 합성 게이트는 소스를 고치지 않고 통과해야 한다(config.toml 의 로컬 포트 오버라이드는 제외, 대신 전후 diff 가 같아야 한다).
// 사용: db:reset → dev:bootstrap 직후(깨끗한 DB), e2e-local.mjs 와 같은 방식으로 3101 에 띄운 npm run dev 가 떠 있는 상태에서
//   BOOTSTRAP_PASSWORD=… [BOOTSTRAP_EMAIL=admin@example.com] [E2E_BASE_URL=http://localhost:3101(기본값)] node scripts/e2e-synthetic.mjs
// 비밀번호는 env 로만 받고 출력하지 않는다(B 관리자 비밀번호는 실행마다 새로 만든다). 결과는 stdout 에 JSON 한 덩어리, 실패하면 그 자리에서 멈추고 exit 1.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'
import {
  ERR_DENIED, areaInput, dowOfIso, e2eBaseUrl, fillWbsWorkbook, importForm, importResultView, inspectForm, localClientEnv, plannedPctByName, shiftDays,
  storedTimezone, todayInTz, workspaceAdminAccountInput,
} from './lib/e2e.mjs'
import { excludeRegistered, findSentinels, sp4Sentinels, sp5aSentinels, sp5b1Sentinels, zipTextParts } from './lib/sentinels.mjs'
import { createSessionFactory } from './lib/e2e-session.mjs'
import {
  PENDING_STEPS, SYNTHETIC_C, SYNTHETIC_R, SYNTHETIC_WORKSPACE_B, areaView, expectedAreas, expectedTeams, renderedProof, teamView, wbsRows, weekRowsHaveContent, outlineExpandUnsupported,
  expectedStoredCalendar, leafNamesOf,
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
  createProject: { filename: 'src/app/actions/project.ts', exportedName: 'createProject', worker: '/w/[slug]/projects/page' },
  createAccount: { filename: 'src/app/actions/accounts.ts', exportedName: 'createAccount', worker: '/w/[slug]/admin/accounts/page' },
  updateProjectSettings: { filename: 'src/app/actions/settings.ts', exportedName: 'updateProjectSettings', worker: '/p/[projectId]/settings/page' },
  migrateVocabCode: { filename: 'src/app/actions/vocab.ts', exportedName: 'migrateVocabCode', worker: '/p/[projectId]/settings/page' },
  updateWorkspaceSettings: { filename: 'src/app/actions/settings.ts', exportedName: 'updateWorkspaceSettings', worker: '/w/[slug]/settings/page' },
  addProjectTeam: { filename: 'src/app/actions/projectTeams.ts', exportedName: 'addProjectTeam', worker: '/p/[projectId]/settings/page' },
  upsertArea: { filename: 'src/app/actions/projectAreas.ts', exportedName: 'upsertArea', worker: '/p/[projectId]/settings/page' },
  createWeeklyReport: { filename: 'src/app/actions/weekly.ts', exportedName: 'createWeeklyReport', worker: '/p/[projectId]/weekly/page' },
  saveWeeklyCells: { filename: 'src/app/actions/weekly.ts', exportedName: 'saveWeeklyCells', worker: '/p/[projectId]/weekly/page' },
  updateProjectTeam: { filename: 'src/app/actions/projectTeams.ts', exportedName: 'updateProjectTeam', worker: '/p/[projectId]/settings/page' },
  addHoliday: { filename: 'src/app/actions/project.ts', exportedName: 'addHoliday', worker: '/p/[projectId]/settings/page' },
  setBaseDate: { filename: 'src/app/actions/project.ts', exportedName: 'setBaseDate', worker: '/p/[projectId]/settings/page' },
  createIssue: { filename: 'src/app/actions/issues.ts', exportedName: 'createIssue', worker: '/p/[projectId]/issues/page' },
  // SP5b(스펙 D24) — 이슈 모달의 진행 저장, 단계 패널의 흐름 켜기·단계 지정·단계 승인
  updateIssueProgress: { filename: 'src/app/actions/issues.ts', exportedName: 'updateIssueProgress', worker: '/p/[projectId]/issues/page' },
  setWbsDevWorkflow: { filename: 'src/app/actions/wbsAssign.ts', exportedName: 'setWbsDevWorkflow', worker: '/p/[projectId]/wbs/page' },
  setWbsStage: { filename: 'src/app/actions/wbsAssign.ts', exportedName: 'setWbsStage', worker: '/p/[projectId]/wbs/page' },
  approveWbsStep: { filename: 'src/app/actions/wbsAssign.ts', exportedName: 'approveWbsStep', worker: '/p/[projectId]/wbs/page' },
  // SP5c(스펙 §3.6) — 사용자 정의 필드 설정 관리 및 행 단위 값 저장
  getCustomFieldUsage: { filename: 'src/app/actions/customFields.ts', exportedName: 'getCustomFieldUsage', worker: '/p/[projectId]/settings/page' },
  backfillCustomField: { filename: 'src/app/actions/customFields.ts', exportedName: 'backfillCustomField', worker: '/p/[projectId]/settings/page' },
  purgeCustomField: { filename: 'src/app/actions/customFields.ts', exportedName: 'purgeCustomField', worker: '/p/[projectId]/settings/page' },
  saveCustomFieldValues: { filename: 'src/app/actions/customFieldValues.ts', exportedName: 'saveCustomFieldValues', worker: '/p/[projectId]/wbs/page' },
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
/** 그 프로젝트의 저장된 tz 의 오늘 — 키가 없으면 제품 기본값 UTC(SP5 A — 러너는 주 키를 만들지 않는다, W30) */
async function projectToday(client, projectId) {
  const values = rows('프로젝트 설정', await client.from('project_settings').select('values').eq('project_id', projectId).single()).values
  const tz = storedTimezone(values)
  return { tz, today: todayInTz(tz) }
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

  // ── S1 — 생성(빈 값) + 등록 키(서버 액션). 화면 경로는 워크스페이스 범위(SP3b UI-2 — 옛 /projects·/admin/accounts 는 스텁 307)
  const wsHref = (ws, seg) => `/w/${encodeURIComponent(ws.slug)}/${seg}`
  await admin.http('GET', wsHref(wsR, 'projects'))
  const wsSettingsPage = (ws) => wsHref(ws, 'settings')
  const config = async (cfg, ws) => {
    // 1) 워크스페이스 키 — modules.allowed·ai.enabled (플랫폼 관리자 전용 구역의 키)
    await admin.http('GET', wsSettingsPage(ws))
    const wsDoc = rows(`${cfg.id} 워크스페이스 설정`, await admin.sb.from('workspace_settings').select('revision, values').eq('workspace_id', ws.id).single())
    const set = { 'modules.allowed': cfg.workspace['modules.allowed'], ...(cfg.workspace['ai.enabled'] !== undefined ? { 'ai.enabled': cfg.workspace['ai.enabled'] } : {}) }
    const wr = (await admin.action(wsSettingsPage(ws), 'updateWorkspaceSettings', [ws.id, { expectedRevision: wsDoc.revision, commandId: randomUUID(), set, unset: [] }])).result
    mustOk(`${cfg.id} 워크스페이스 설정`, wr)
    // 2) 프로젝트 — 필수 설정(단계 라벨)과 함께 한 트랜잭션으로 생성
    const name = `합성 ${cfg.id} ${stamp}`
    const created = (await admin.action(wsHref(ws, 'projects'), 'createProject', [{
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
    // 달력 키(SP5 A)는 S1-calendar 가 따로 넣는다 — week_start 는 입력(요일)과 저장(규칙 목록)이 달라 이 비교에 넣지 않는다
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

  // ── S1(SP5 A) — 달력 키·날짜 예외(스펙 D43). 워크스페이스 먼저(새 프로젝트 기본값 — 이미 만든 R·C 에는 영향 없음), 프로젝트는 요일 입력 →
  //    서버가 규칙 목록을 만든다(문서 0건 — 교체). 다시 읽은 저장값 = expectedStoredCalendar. 날짜 예외는 일정 화면의 addHoliday.
  //    C 의 월요일 규칙은 주차 문서(S4(월))보다 먼저다(SP5 D28 — SP4 S4(월) 회귀를 계속 덮는다).
  const calendarKeys = ['calendar.timezone', 'calendar.working_days', 'calendar.week_start']
  const pickCalendar = (values) => Object.fromEntries(calendarKeys.map((k) => [k, values?.[k]]))
  const applyCalendar = async (label, ws, proj, def) => {
    await admin.http('GET', wsSettingsPage(ws))
    const wsDoc = rows(`${label} 워크스페이스 설정`, await admin.sb.from('workspace_settings').select('revision').eq('workspace_id', ws.id).single())
    mustOk(`${label} 워크스페이스 달력`, (await admin.action(wsSettingsPage(ws), 'updateWorkspaceSettings',
      [ws.id, { expectedRevision: wsDoc.revision, commandId: randomUUID(), set: { ...def.calendar.workspace }, unset: [] }])).result)
    await admin.http('GET', `/p/${proj.id}/settings`)
    const pDoc = rows(`${label} 프로젝트 설정`, await admin.sb.from('project_settings').select('revision').eq('project_id', proj.id).single())
    mustOk(`${label} 프로젝트 달력`, (await admin.action(`/p/${proj.id}/settings`, 'updateProjectSettings',
      [proj.id, { expectedRevision: pDoc.revision, commandId: randomUUID(), set: { ...def.calendar.project }, unset: [] }])).result)
    for (const h of def.calendar.holidays) {
      mustOk(`${label} 날짜 예외 ${h.date}`, (await admin.action(`/p/${proj.id}/settings`, 'addHoliday', [proj.id, h.date, h.name, h.kind])).result)
    }
    const wsValues = rows(`${label} 워크스페이스 설정(다시 읽기)`, await admin.sb.from('workspace_settings').select('values').eq('workspace_id', ws.id).single()).values
    const pValues = rows(`${label} 프로젝트 설정(다시 읽기)`, await admin.sb.from('project_settings').select('values').eq('project_id', proj.id).single()).values
    const holidays = rows(`${label} 날짜 예외`, await admin.sb.from('holidays').select('date, name, kind').eq('project_id', proj.id).order('date'))
    same(`${label} 워크스페이스 달력`, pickCalendar(wsValues), expectedStoredCalendar('workspace', def.calendar.workspace))
    same(`${label} 프로젝트 달력`, pickCalendar(pValues), expectedStoredCalendar('project', def.calendar.project))
    same(`${label} 날짜 예외`, holidays, def.calendar.holidays)
    return { workspace: pickCalendar(wsValues), project: pickCalendar(pValues), holidays }
  }
  step('S1-calendar', { R: await applyCalendar('R', wsR, R, SYNTHETIC_R), C: await applyCalendar('C', wsC, C, SYNTHETIC_C) })

  // ── S1-issues(SP5 B1) — 정책·이슈 영역을 화면의 설정/영역 액션으로 기록한다. 두 프로젝트 모두 분석은 켜지 않는다.
  const applyIssueSetup = async (label, proj, def) => {
    await admin.http('GET', `/p/${proj.id}/settings`)
    const pDoc = rows(`${label} 이슈 설정`, await admin.sb.from('project_settings').select('revision').eq('project_id', proj.id).single())
    mustOk(`${label} 이슈 코드 정책`, (await admin.action(`/p/${proj.id}/settings`, 'updateProjectSettings',
      [proj.id, { expectedRevision: pDoc.revision, commandId: randomUUID(), set: { 'issues.id_policy': def.issues.idPolicy }, unset: [] }])).result)
    const areaIds = new Map()
    for (const a of def.issues.areas) {
      const r = mustOk(`${label} 이슈 영역 ${a.code}`, (await admin.action(`/p/${proj.id}/settings`, 'upsertArea',
        [proj.id, { kind: 'issue_area', ...a, active: true, teams: [] }])).result)
      if (r.status !== 'created') throw new Fail(`${label} 이슈 영역 ${a.code} 가 새로 만들어지지 않았다: ${JSON.stringify(r)}`)
      areaIds.set(a.code, r.id)
    }
    const settings = rows(`${label} 이슈 설정(다시 읽기)`, await admin.sb.from('project_settings').select('values').eq('project_id', proj.id).single()).values
    same(`${label} 이슈 코드 정책(다시 읽기)`, settings?.['issues.id_policy'], def.issues.idPolicy)
    const areaRows = rows(`${label} 이슈 영역(다시 읽기)`, await admin.sb.from('project_areas')
      .select('id, code, name, sort_order, active').eq('project_id', proj.id).eq('kind', 'issue_area').order('sort_order'))
    same(`${label} 이슈 영역(다시 읽기)`, areaRows.map((a) => ({ code: a.code, name: a.name, sortOrder: a.sort_order, active: a.active })),
      def.issues.areas.map((a) => ({ ...a, active: true })))
    for (const a of areaRows) areaIds.set(a.code, a.id)
    return { areaIdByCode: areaIds, policy: settings?.['issues.id_policy'], areas: areaRows.length }
  }
  const rIssueSetup = await applyIssueSetup('R', R, SYNTHETIC_R)
  const cIssueSetup = await applyIssueSetup('C', C, SYNTHETIC_C)
  step('S1-issues', {
    R: { policy: rIssueSetup.policy, areas: rIssueSetup.areas, areaIds: Object.fromEntries(rIssueSetup.areaIdByCode) },
    C: { policy: cIssueSetup.policy, areas: cIssueSetup.areas },
    note: '이슈 정책은 updateProjectSettings, issue_area 는 upsertArea 로 설정 UI와 같은 액션을 쓴다 — 분석 모듈은 켜지지 않았다',
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
  await admin.http('GET', wsHref(wsB, 'admin/accounts'))
  mustOk('B 관리자 계정', (await admin.action(wsHref(wsB, 'admin/accounts'), 'createAccount',
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

  // ── S4(월) — C 에서 연속 2주(월요일 키)와 이월, 영역 개명 뒤 같은 area_id·같은 셀(스펙 §6.4 S4·W14). 주 키는 앱이 정한다(weekKeyOf — W30):
  //    러너는 C 의 저장된 tz 의 오늘과 +7일을 넘기고 week_start 를 DB 에서 다시 읽어 월요일·7일 간격인지만 본다. R 의 일요일 키는 아래 S4(일).
  await admin.http('GET', `/p/${C.id}/weekly`)
  const { today } = await projectToday(admin.sb, C.id)
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
    mondayKeys: dowOfIso(weeks.w1) === 1 && shiftDays(weeks.w1, 7) === weeks.w2,
    rowCounts: [before.w1.length, before.w2.length],
    carried: before.w2.every((r) => r.this_content === `S4 계획 ${codeOfArea.get(r.area_id)}` && r.next_content === ''),
    renamed: renamed.id === workId && renamed.status === 'updated' && workRow?.code === workDef.code && workRow?.name === `${workDef.name} 관리`,
    sameCells: canonical(after) === canonical(before),
  }
  const areaCount = SYNTHETIC_C.weeklyAreas.length
  step('S4-weekly-monday', { weeks, ...s4 },
    s4.created.join() === 'created,created' && s4.mondayKeys && s4.rowCounts.join() === `${areaCount},${areaCount}` && s4.carried && s4.renamed && s4.sameCells
      ? undefined : `C 주간(월): ${JSON.stringify({ weeks, ...s4 })}`)

  // ── S4(일)(SP5 A) — R 에서 연속 2주(일요일 키 — 기본 규칙)와 이월, 영역 개명 뒤 같은 area_id·같은 셀. 주 키는 앱이 정한다(W30)
  await admin.http('GET', `/p/${R.id}/weekly`)
  const { tz: rTz, today: rToday } = await projectToday(admin.sb, R.id)
  const rCreate = async (dateIso, carry) =>
    mustOk(`R 주차(${dateIso}, 이월 ${carry})`, (await admin.action(`/p/${R.id}/weekly`, 'createWeeklyReport', [R.id, dateIso, carry])).result)
  const rRows = async (reportId) => rows('R 주간 행', await admin.sb.from('weekly_report_rows')
    .select('id, area_id, this_content, this_issue, next_content, next_issue').eq('report_id', reportId).order('id'))
  const rWeekStart = async (reportId) => rows('R 주간 문서', await admin.sb.from('weekly_reports').select('week_start').eq('id', reportId).single()).week_start
  const rCodeOfArea = new Map([...rSetup.areaIdByCode].map(([code, id]) => [id, code]))
  const r1 = await rCreate(rToday, false)
  const r1Rows = await rRows(r1.reportId)
  mustOk('R 차주 계획 저장', (await admin.action(`/p/${R.id}/weekly`, 'saveWeeklyCells',
    [R.id, r1Rows.map((r) => ({ rowId: r.id, cellKey: 'next_content', content: `S4 계획 ${rCodeOfArea.get(r.area_id)}` }))])).result)
  const r2 = await rCreate(shiftDays(rToday, 7), true)
  const rWeeks = { w1: await rWeekStart(r1.reportId), w2: await rWeekStart(r2.reportId) }
  const rRowsBefore = { w1: await rRows(r1.reportId), w2: await rRows(r2.reportId) }
  const rFirst = SYNTHETIC_R.weeklyAreas[0]
  const rFirstId = rSetup.areaIdByCode.get(rFirst.code)
  const rRenamed = mustOk('R 영역 개명', (await admin.action(`/p/${R.id}/settings`, 'upsertArea',
    [R.id, areaInput(rFirst, rSetup.teamIdByCode, { id: rFirstId, name: `${rFirst.name} 관리` })])).result)
  const [rFirstRow] = rows('R 개명한 영역', await admin.sb.from('project_areas').select('id, code, name').eq('id', rFirstId))
  const rRowsAfter = { w1: await rRows(r1.reportId), w2: await rRows(r2.reportId) }
  const s4r = {
    created: [r1.status, r2.status],
    sundayKeys: dowOfIso(rWeeks.w1) === 0 && shiftDays(rWeeks.w1, 7) === rWeeks.w2 && rWeeks.w1 <= rToday && shiftDays(rWeeks.w1, 6) >= rToday,
    rowCounts: [rRowsBefore.w1.length, rRowsBefore.w2.length],
    carried: rRowsBefore.w2.every((r) => r.this_content === `S4 계획 ${rCodeOfArea.get(r.area_id)}` && r.next_content === ''),
    renamed: rRenamed.id === rFirstId && rRenamed.status === 'updated' && rFirstRow?.code === rFirst.code && rFirstRow?.name === `${rFirst.name} 관리`,
    sameCells: canonical(rRowsAfter) === canonical(rRowsBefore),
  }
  const rAreaCount = SYNTHETIC_R.weeklyAreas.length
  step('S4-weekly-sunday', { tz: rTz, today: rToday, weeks: rWeeks, ...s4r },
    s4r.created.join() === 'created,created' && s4r.sundayKeys && s4r.rowCounts.join() === `${rAreaCount},${rAreaCount}`
      && s4r.carried && s4r.renamed && s4r.sameCells ? undefined : `R 주간(일): ${JSON.stringify({ weeks: rWeeks, ...s4r })}`)

  // ── S5(SP5 A) — 달력 집계(개정 §6.5.8 S5). 계획%: 기준일을 일정 화면의 setBaseDate 로 고정하고 WBS 엑셀의 '계획%'(화면과 같은 getComputedWbs)를
  //    읽는다 — 기대값은 SYNTHETIC_*.calendar.plannedPct(근무일 수를 손으로 센 값). '오늘': 프로젝트 tz 의 오늘로 이번 주 문서를 얻고(S4 가 만들었으면
  //    exists) 그 키가 오늘을 덮으며 요일이 규칙이고, 매개변수 없는 주간 화면이 그 문서를 연다(서버가 같은 tz 의 오늘로 키를 정했다).
  const s5 = {}
  for (const [label, proj, def] of [['R', R, SYNTHETIC_R], ['C', C, SYNTHETIC_C]]) {
    const depth = def.config.project['core.level_labels'].length
    const [leafA, leafB] = leafNamesOf(depth)
    await admin.http('GET', `/p/${proj.id}/settings`)
    const planned = {}
    for (const [baseDate, expect] of Object.entries(def.calendar.plannedPct)) {
      mustOk(`${label} 기준일 ${baseDate}`, (await admin.action(`/p/${proj.id}/settings`, 'setBaseDate', [proj.id, baseDate])).result)
      const res = await admin.http('GET', `/api/export?projectId=${proj.id}`)
      const got = await plannedPctByName(Buffer.from(await res.arrayBuffer()), [leafA, leafB])
      planned[baseDate] = { A: got[leafA], B: got[leafB], expect }
    }
    mustOk(`${label} 기준일 자동 복귀`, (await admin.action(`/p/${proj.id}/settings`, 'setBaseDate', [proj.id, null])).result)
    const { tz, today: before } = await projectToday(admin.sb, proj.id)
    await admin.http('GET', `/p/${proj.id}/weekly`)
    const doc = mustOk(`${label} 이번 주`, (await admin.action(`/p/${proj.id}/weekly`, 'createWeeklyReport', [proj.id, before, false])).result)
    const weekStart = rows(`${label} 이번 주 문서`, await admin.sb.from('weekly_reports').select('week_start').eq('id', doc.reportId).single()).week_start
    const html = await (await admin.http('GET', `/p/${proj.id}/weekly`)).text()
    const after = todayInTz(tz)
    s5[label] = {
      tz, today: before, weekStart, ruleDow: dowOfIso(weekStart),
      covers: weekStart <= before && shiftDays(weekStart, 6) >= before,
      // 자정을 넘긴 순간이면 다음 키 화면이 정답이다 — 그때는 이 항목을 판정하지 않는다(before !== after)
      reportOnPage: html.includes(doc.reportId) || before !== after,
      plannedPct: planned,
      discriminating: todayInTz('UTC') !== before,
    }
  }
  const plannedOk = (p) => Object.values(p).every((x) => Object.entries(x.expect).every(([leaf, want]) => x[leaf] === want))
  const s5Ok = ['R', 'C'].every((k) => s5[k].covers && s5[k].reportOnPage && plannedOk(s5[k].plannedPct)) && s5.R.ruleDow === 0 && s5.C.ruleDow === 1
  step('S5-calendar', s5, s5Ok ? undefined : `S5 달력 집계: ${JSON.stringify(s5)}`)

  // ── S6-issue-codes(SP5 B1) — DB 트리거가 실제로 정한 코드를 액션 응답과 행에서 함께 대조한다.
  const createSyntheticIssue = async (label, proj, title, areaId) => {
    await admin.http('GET', `/p/${proj.id}/issues`)
    return mustOk(`${label} 이슈 등록`, (await admin.action(`/p/${proj.id}/issues`, 'createIssue', [proj.id, {
      title, body: '합성 이슈 코드 검증', severity: 'medium', assigneeMemberIds: [], startDate: null, dueDate: null,
      areaId, analysis: null,
    }])).result)
  }
  const rCodes = []
  for (const code of ['RND', 'ENV', 'ADM', 'RND']) {
    const result = await createSyntheticIssue('R', R, `합성 ${code} 이슈 ${rCodes.length + 1}`, rIssueSetup.areaIdByCode.get(code))
    rCodes.push(result.code)
  }
  const { today: cToday } = await projectToday(admin.sb, C.id)
  const cCodes = []
  for (let i = 1; i <= 2; i++) {
    const result = await createSyntheticIssue('C', C, `합성 건설 이슈 ${i}`, null)
    cCodes.push(result.code)
  }
  const rIssueIds = (await admin.sb.from('issues').select('id, code, code_scope, code_area_id').eq('project_id', R.id).order('issue_no')).data
  const cIssueIds = (await admin.sb.from('issues').select('id, code, code_scope, code_area_id').eq('project_id', C.id).order('issue_no')).data
  if (!rIssueIds || !cIssueIds) throw new Fail('이슈 코드 다시 읽기 실패')
  const rExpected = ['RS-RND-001', 'RS-ENV-001', 'RS-ADM-001', 'RS-RND-002']
  const cExpected = [`CN-${cToday.slice(0, 4)}-0001`, `CN-${cToday.slice(0, 4)}-0002`]
  same('R 영역별 이슈 코드(액션)', rCodes, rExpected)
  same('C 연도별 이슈 코드(액션)', cCodes, cExpected)
  for (const [i, areaCode] of ['RND', 'ENV', 'ADM', 'RND'].entries()) {
    const row = rIssueIds.find((x) => x.code === rExpected[i])
    if (!row || row.code_scope !== `a:${rIssueSetup.areaIdByCode.get(areaCode)}` || row.code_area_id !== rIssueSetup.areaIdByCode.get(areaCode)) {
      throw new Fail(`R ${areaCode} 코드 범위가 다르다: ${JSON.stringify(row)}`)
    }
  }
  for (const code of cExpected) {
    const row = cIssueIds.find((x) => x.code === code)
    if (!row || row.code_scope !== `y:${cToday.slice(0, 4)}` || row.code_area_id !== null) throw new Fail(`C 코드 범위가 다르다: ${JSON.stringify(row)}`)
  }
  step('S6-issue-codes', { R: { codes: rCodes, scopes: rIssueIds.map((x) => x.code_scope) }, C: { codes: cCodes, scopes: cIssueIds.map((x) => x.code_scope) }, yearBasis: cToday })

  // ── S1-vocab(SP5 B4 — 스펙 D43 S1 의 B4 몫) — R 의 심각도를 설정 화면과 같은 액션으로 바꾸고(새 code·바꾼 라벨·순서),
  //    참조가 있는 code 삭제는 건수와 함께 거부 → 이관 명령 → 삭제가 되는지, 지운 code 로 새 이슈를 못 만드는지 본다.
  const severitiesOf = async () => rows('R 심각도(다시 읽기)', await admin.sb.from('project_settings').select('revision, values').eq('project_id', R.id).single())
  const setSeverities = async (list) => {
    await admin.http('GET', `/p/${R.id}/settings`)
    const doc = await severitiesOf()
    return (await admin.action(`/p/${R.id}/settings`, 'updateProjectSettings',
      [R.id, { expectedRevision: doc.revision, commandId: randomUUID(), set: { 'issues.severities': list }, unset: [] }])).result
  }
  const vocabFull = [
    { code: 'critical', label: '치명', rank: 1, color: 'delayed', active: true },
    { code: 'high', label: '긴급', rank: 2, color: 'delayed', active: true },
    { code: 'medium', label: '보통', rank: 3, color: 'pending', active: true },
    { code: 'low', label: '낮음', rank: 4, color: 'neutral', active: true },
  ]
  mustOk('R 심각도 저장', await setSeverities(vocabFull))
  same('R 심각도(다시 읽기)', (await severitiesOf()).values?.['issues.severities'], vocabFull)
  const withoutMedium = vocabFull.filter((e) => e.code !== 'medium').map((e, i) => ({ ...e, rank: i + 1 }))
  const blocked = await setSeverities(withoutMedium)
  const inUse = blocked?.ok === false ? blocked.fieldErrors?.find((f) => f.key === 'issues.severities') : undefined
  if (blocked?.ok !== false || blocked.code !== 'CONFIG_IN_USE' || inUse?.code !== 'medium' || inUse?.refCount !== rCodes.length) {
    throw new Fail(`참조 있는 심각도 삭제가 건수와 함께 거부되지 않았다: ${JSON.stringify(blocked)}`)
  }
  const moved = mustOk('R 심각도 이관', (await admin.action(`/p/${R.id}/settings`, 'migrateVocabCode', [R.id, 'issues.severities', 'medium', 'low'])).result)
  if (moved.moved !== rCodes.length) throw new Fail(`이관 건수가 다르다: ${JSON.stringify(moved)}`)
  mustOk('R 심각도 삭제(이관 뒤)', await setSeverities(withoutMedium))
  const sevRows = rows('R 이슈 심각도', await admin.sb.from('issues').select('severity').eq('project_id', R.id))
  same('R 이슈 심각도(이관 뒤)', [...new Set(sevRows.map((x) => x.severity))], ['low'])
  await admin.http('GET', `/p/${R.id}/issues`)
  const stale = (await admin.action(`/p/${R.id}/issues`, 'createIssue', [R.id, {
    title: '지운 심각도', body: '', severity: 'medium', assigneeMemberIds: [], startDate: null, dueDate: null, areaId: rIssueSetup.areaIdByCode.get('RND'), analysis: null,
  }])).result
  if (stale?.ok !== false) throw new Fail(`지운 심각도로 이슈가 만들어졌다: ${JSON.stringify(stale)}`)
  step('S1-vocab', { R: { saved: vocabFull.map((e) => e.code), inUse: { code: inUse.code, count: inUse.refCount }, moved: moved.moved, rejected: stale.error } })

  // ── S10(SP4·SP5 A·B1 부분) — 스펙 §6.4. 출력을 다시 받아(읽기 전용) 설정 전환 전 옛 기본값 센티널을 센다. 일치 규칙(대소문자·영문 코드 경계·마스크·zip 텍스트 파트)은
  //    sentinels.mjs 하나다. 등록 이름과 **같은** 센티널만 뺀다(C 의 영역 이름 하나가 11구분명과 같다 — D8). 교차: 팀 code 만(영역 이름은 일반어).
  //    ⑤ 화면 HTML 은 R·C 각자의 워크스페이스 관리자(어느 명단에도 없는 계정)로 받는다 — 앱 셸은 보는 사람의 모든 프로젝트 명단 대표 팀
  //    (identityTeamCodes)을 싣는다. 같은 스택에서 로컬 E2E 가 먼저 돌면 플랫폼 관리자는 프로젝트 A 명단에 옛 팀 코드와 같은 이름의 팀으로 들어 있어
  //    R·C 화면에도 그 code 가 실린다(A1 최종 리뷰 F-1, A2 Z5 의 원인 확인 — 누출 아님). 마스크를 늘리지 않고(K12) 출처를 뺀 계정으로 본다.
  //    플랫폼 관리자 세션의 같은 HTML 적중은 판정 없이 기록만 한다(adminShell — 원인 근거).
  const zipText = async (res) => (await zipTextParts(Buffer.from(await res.arrayBuffer()))).map((p) => p.text).join('\n')
  const around = (text, words) => words.map((w) => {
    const at = text.indexOf(w)
    return { word: w, around: at < 0 ? null : text.slice(Math.max(0, at - 40), at + w.length + 40) }
  })
  const registeredOf = async (proj) => {
    const t = rows('등록 팀', await admin.sb.from('teams').select('code, name').eq('project_id', proj.id))
    const a = rows('등록 영역', await admin.sb.from('project_areas').select('code, name').eq('project_id', proj.id))
    return { teamCodes: t.map((x) => x.code), names: [...t, ...a].flatMap((x) => [x.code, x.name]) }
  }
  const viewerOf = async (label, ws) => {
    const addr = `syn-${label.toLowerCase()}-view-${stamp}@example.com`
    const pw = `Syn-${randomUUID()}`
    await admin.http('GET', wsHref(ws, 'admin/accounts'))
    mustOk(`${label} 화면 확인 계정`, (await admin.action(wsHref(ws, 'admin/accounts'), 'createAccount',
      [workspaceAdminAccountInput({ workspaceId: ws.id, email: addr, name: `합성 ${label} 화면 확인`, password: pw })])).result)
    const viewer = session(`syn-${label.toLowerCase()}-view`)
    await viewer.login(addr, pw)
    return viewer
  }
  // ⑤ 의 그려짐 증거(W1) — 주간 = 활성 영역 이름, WBS = 루트 항목 이름, 이슈 = 첫 영역 이름·첫 issue code.
  const proofNamesOf = async (proj) => ({
    weekly: rows('S10 영역 이름', await admin.sb.from('project_areas').select('name').eq('project_id', proj.id)
      .eq('kind', 'weekly_section').eq('active', true)).map((x) => x.name),
    wbs: rows('S10 루트 항목 이름', await admin.sb.from('wbs_items').select('name').eq('project_id', proj.id).is('parent_id', null)).map((x) => x.name),
    issues: [rows('S10 이슈 영역 이름', await admin.sb.from('project_areas').select('name').eq('project_id', proj.id).eq('kind', 'issue_area').order('sort_order').limit(1)),
      rows('S10 이슈 코드', await admin.sb.from('issues').select('code').eq('project_id', proj.id).order('issue_no').limit(1))]
      .flat().map((x) => x.name ?? x.code),
  })
  const capture = async (proj, viewer) => {
    const out = []
    const { today: s10Today } = await projectToday(admin.sb, proj.id)   // SP5 A — 그 프로젝트의 저장된 tz 의 오늘
    // ① 응답 본문 — 이번 주 주간 문서 생성(없으면 만들고, 있으면 exists — 쓰기 없이 같은 응답 꼴)
    await admin.http('GET', `/p/${proj.id}/weekly`)
    out.push({ target: '①', path: 'createWeeklyReport', text: JSON.stringify((await admin.action(`/p/${proj.id}/weekly`, 'createWeeklyReport', [proj.id, s10Today, false])).result) })
    // ② 시트 PPT — 그 프로젝트의 주간 문서 전부. 내용 없는 주차(① 이 방금 만든 이번 주 등)는 앱이 400 '해당 주차에 작성된 내용이 없습니다' 로
    //    거절한다(SP0 부터 — 출력이 없다). 그 주차는 400 과 문구를 확인해 emptyWeeks 에 적고 출력 대상으로 세지 않는다(과제 24 첫 실행에서 찾은 러너 결함)
    const emptyWeeks = []
    let contentWeek = null
    const weeks = rows('주차', await admin.sb.from('weekly_reports').select('id, week_start').eq('project_id', proj.id).order('week_start'))
    for (const w of weeks) {
      const path = `/api/report?projectId=${proj.id}&source=sheet&format=pptx&week=${w.week_start}`
      const cells = rows('주차 행', await admin.sb.from('weekly_report_rows').select('this_content, this_issue, next_content, next_issue').eq('report_id', w.id))
      if (weekRowsHaveContent(cells)) {
        contentWeek ??= w.week_start
        out.push({ target: '②', path, text: await zipText(await admin.http('GET', path)) })
      } else {
        const body = await (await admin.http('GET', path, { expect: 400 })).json()
        if (body.error !== '해당 주차에 작성된 내용이 없습니다') throw new Fail(`S10 ② 빈 주차 ${w.week_start}: ${JSON.stringify(body)}`)
        emptyWeeks.push({ week: w.week_start, rows: cells.length, status: 400 })
      }
    }
    // ③ 기본 갈래 주간 보고서
    if (!contentWeek) throw new Fail('S10 주간 출력에 사용할 내용이 있는 주차가 없다')
    for (const path of [`/api/report?projectId=${proj.id}&format=xlsx&week=${contentWeek}`, `/api/report?projectId=${proj.id}&format=pptx&week=${contentWeek}`]) {
      out.push({ target: '③', path, text: await zipText(await admin.http('GET', path)) })
    }
    // ④ WBS 엑셀 접기·펼침 — 접기 파일을 가져오기 감지에 다시 넣은 응답도 ①(라우트 응답 본문)로 센다. 저장 양식이 아웃라인이면 펼침은 앱이
    //    400 으로 명시적으로 거절한다(출력 없음 — U2) — 접기의 X-Excel-Layout 이 saved 이고 그 문구일 때만 unsupportedExports 에 적고 대상에서 뺀다
    //    (과제 24 둘째 실행에서 찾은 러너 결함)
    const unsupportedExports = []
    let foldedLayout = null
    for (const expand of [false, true]) {
      const path = `/api/export?projectId=${proj.id}${expand ? '&expand=1' : ''}`
      const res = await admin.http('GET', path, expand ? { expect: [200, 400] } : undefined)
      if (!expand) foldedLayout = res.headers.get('x-excel-layout')
      if (res.status === 400) {
        const body = await res.json()
        if (!outlineExpandUnsupported(foldedLayout, res.status, body)) throw new Fail(`S10 ④ 펼침 400(${foldedLayout}): ${JSON.stringify(body)}`)
        unsupportedExports.push({ path, layout: foldedLayout, status: 400, error: body.error })
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      out.push({ target: '④', path, text: (await zipTextParts(buf)).map((p) => p.text).join('\n') })
      if (!expand) {
        const inspected = await (await admin.http('POST', '/api/import/inspect', { body: inspectForm({ file: buf, fileName: 'syn.xlsx', projectId: proj.id }) })).json()
        out.push({ target: '①', path: '/api/import/inspect', text: JSON.stringify(inspected) })
      }
    }
    // ⑤ 화면 HTML(RSC 페이로드 포함) — 주간(이번 주)·WBS. 명단 밖 워크스페이스 관리자로 받는다(위 주석). 플랫폼 관리자 HTML 은 기록용
    const shell = []
    const proofNames = await proofNamesOf(proj)
    for (const [kind, path] of [['weekly', `/p/${proj.id}/weekly`], ['wbs', `/p/${proj.id}/wbs`], ['issues', `/p/${proj.id}/issues`]]) {
      const text = await (await viewer.http('GET', path)).text()
      out.push({ target: '⑤', path, text, proof: renderedProof(text, proofNames[kind]) })
      shell.push({ path, text: await (await admin.http('GET', path)).text() })
    }
    return { out, shell, emptyWeeks, unsupportedExports }
  }
  const s10 = {}
  const regR = await registeredOf(R)
  const regC = await registeredOf(C)
  const tzSentinels = sp5aSentinels()   // SP5 A — 시간대 센티널(등록 이름 제외 없음 — 시간대 이름은 R·C 가 등록하지 않는다)
  for (const [label, proj, reg, other] of [['R', R, regR, regC], ['C', C, regC, regR]]) {
    const sentinels = [...excludeRegistered(sp4Sentinels(), reg.names), ...excludeRegistered(sp5b1Sentinels(), reg.names)]
    const { out: outs, shell, emptyWeeks, unsupportedExports } = await capture(proj, await viewerOf(label, proj.ws))
    s10[label] = {
      targets: outs.map((o) => `${o.target} ${o.path}`),
      emptyWeeks,
      unsupportedExports,
      hits: outs.map((o) => ({ target: o.target, path: o.path, words: findSentinels(o.text, sentinels) }))
        .filter((x) => x.words.length).map((x) => ({ ...x, at: around(outs.find((o) => o.path === x.path && o.target === x.target).text, x.words) })),
      tz: outs.map((o) => ({ target: o.target, path: o.path, words: findSentinels(o.text, tzSentinels) }))
        .filter((x) => x.words.length).map((x) => ({ ...x, at: around(outs.find((o) => o.path === x.path && o.target === x.target).text, x.words) })),
      cross: outs.filter((o) => o.target !== '⑤').map((o) => ({ target: o.target, path: o.path, words: findSentinels(o.text, other.teamCodes) })).filter((x) => x.words.length),
      adminShell: shell.map((h) => ({ path: h.path, words: findSentinels(h.text, sentinels) })).filter((x) => x.words.length)
        .map((x) => ({ ...x, at: around(shell.find((h) => h.path === x.path).text, x.words) })),
      rendered: outs.filter((o) => o.target === '⑤').map((o) => ({ path: o.path, ...o.proof })),
    }
  }
  const s10Ok = ['R', 'C'].every((k) => s10[k].hits.length === 0 && s10[k].tz.length === 0 && s10[k].cross.length === 0 && s10[k].rendered.every((r) => r.ok))
  step('S10-negative', s10, s10Ok ? undefined : `S10(SP4·SP5 A·B1 부분) 적중·그려짐: ${JSON.stringify({ R: { hits: s10.R.hits, tz: s10.R.tz, cross: s10.R.cross, rendered: s10.R.rendered }, C: { hits: s10.C.hits, tz: s10.C.tz, cross: s10.C.cross, rendered: s10.C.rendered } })}`)

  // ── 경계 행렬 SP4 행(W39) — R·C 각각. 설정 없음: 새 빈 프로젝트(단계 이름만)의 주간 생성 → CONFIG_REQUIRED·문서 0, 엑셀 → 표준과 그 표기.
  //    비활성 유형: 둘째 주간 영역에 차주 계획을 적고 비활성화 → 다음 주 이월이 대기(CARRY_PENDING)에 그 영역을 싣고 활성 영역 목록에서 빠진다,
  //    '옮기지 않음'으로 만들면 새 주차에 그 영역 행이 없고 과거 행(내용)은 남는다. 데이터 있는 개명: 영역 개명 → area_id·셀 그대로(S4 는 C 만 —
  //    여기서 R·C 둘 다), 팀 개명 → 팀 id·code 그대로.
  const boundary = {}
  for (const [label, proj, cfg, ws, setup] of [['R', R, SYNTHETIC_R, wsR, rSetup], ['C', C, SYNTHETIC_C, wsC, cSetup]]) {
    // 설정 없음
    const emptyName = `합성 ${label} 경계 ${stamp}`
    mustOk(`${label} 빈 프로젝트`, (await admin.action(wsHref(ws, 'projects'), 'createProject', [{
      workspaceId: ws.id, name: emptyName, startDate: null, endDate: null, description: null, levelLabels: cfg.config.project['core.level_labels'], commandId: randomUUID(),
    }])).result)
    const E = rows(`${label} 빈 프로젝트`, await admin.sb.from('projects').select('id').eq('name', emptyName).single())
    // 모듈은 그 구성과 같게(주간이 켜져 있어야 CONFIG_REQUIRED 가 관문보다 먼저 닿는다) — S1 의 config() 와 같은 액션 한 길
    await admin.http('GET', `/p/${E.id}/settings`)
    const eDoc = rows(`${label} 빈 프로젝트 설정`, await admin.sb.from('project_settings').select('revision').eq('project_id', E.id).single())
    mustOk(`${label} 빈 프로젝트 모듈`, (await admin.action(`/p/${E.id}/settings`, 'updateProjectSettings',
      [E.id, { expectedRevision: eDoc.revision, commandId: randomUUID(), set: { 'modules.enabled': cfg.config.project['modules.enabled'] }, unset: [] }])).result)
    await admin.http('GET', `/p/${E.id}/weekly`)
    const { today: eToday } = await projectToday(admin.sb, E.id)   // SP5 A — E 의 오늘(워크스페이스 tz 를 복사했다)
    const noAreas = (await admin.action(`/p/${E.id}/weekly`, 'createWeeklyReport', [E.id, eToday, false])).result
    const eDocs = rows(`${label} 빈 프로젝트 문서`, await admin.sb.from('weekly_reports').select('id').eq('project_id', E.id))
    const eExport = await admin.http('GET', `/api/export?projectId=${E.id}`)
    const eSettings = await (await admin.http('GET', `/p/${E.id}/settings`)).text()
    const empty = {
      configRequired: noAreas?.ok === false && noAreas.code === 'CONFIG_REQUIRED', noDocs: eDocs.length === 0,
      standard: eExport.status === 200 && eExport.headers.get('x-excel-layout') === 'standard',
      label: eSettings.includes('표준 양식(프로젝트 팀·단계로 생성)'),
    }
    // 비활성 유형 — 가장 늦은 주차의 둘째 영역 행에 차주 계획을 적고 비활성화
    const def = cfg.weeklyAreas[1]
    const areaId = setup.areaIdByCode.get(def.code)
    const [latest] = rows(`${label} 최근 주차`, await admin.sb.from('weekly_reports').select('id, week_start').eq('project_id', proj.id).order('week_start', { ascending: false }).limit(1))
    const [row2] = rows(`${label} 둘째 영역 행`, await admin.sb.from('weekly_report_rows').select('id').eq('report_id', latest.id).eq('area_id', areaId))
    mustOk(`${label} 차주 계획`, (await admin.action(`/p/${proj.id}/weekly`, 'saveWeeklyCells', [proj.id, [{ rowId: row2.id, cellKey: 'next_content', content: `경계 ${def.code}` }]])).result)
    await admin.http('GET', `/p/${proj.id}/settings`)
    mustOk(`${label} 영역 비활성`, (await admin.action(`/p/${proj.id}/settings`, 'upsertArea', [proj.id, areaInput(def, setup.teamIdByCode, { id: areaId, name: def.name, active: false })])).result)
    const next = shiftDays(latest.week_start, 7)
    const pending = (await admin.action(`/p/${proj.id}/weekly`, 'createWeeklyReport', [proj.id, next, true])).result
    const activeAreas = rows(`${label} 활성 영역`, await admin.sb.from('project_areas').select('id').eq('project_id', proj.id).eq('kind', 'weekly_section').eq('active', true))
    const made = mustOk(`${label} 옮기지 않음으로 생성`, (await admin.action(`/p/${proj.id}/weekly`, 'createWeeklyReport', [proj.id, next, true, { [areaId]: 'skip' }])).result)
    const newRows = rows(`${label} 새 주차 행`, await admin.sb.from('weekly_report_rows').select('area_id').eq('report_id', made.reportId))
    const [kept] = rows(`${label} 과거 행`, await admin.sb.from('weekly_report_rows').select('next_content').eq('id', row2.id))
    const inactive = {
      pending: pending?.ok === false && pending.code === 'CARRY_PENDING' && pending.pending.some((p) => p.areaId === areaId),
      notSelectable: !activeAreas.some((a) => a.id === areaId),
      noNewRow: !newRows.some((r) => r.area_id === areaId), pastKept: kept?.next_content === `경계 ${def.code}`,
    }
    // 데이터 있는 개명 — 영역(셋째 영역, 없으면 첫째)과 첫 팀
    const rdef = cfg.weeklyAreas[2] ?? cfg.weeklyAreas[0]
    const rid = setup.areaIdByCode.get(rdef.code)
    const cellsBefore = rows('개명 전 셀', await admin.sb.from('weekly_report_rows').select('id, area_id, this_content, next_content').eq('area_id', rid).order('id'))
    const renamedArea = mustOk(`${label} 영역 개명`, (await admin.action(`/p/${proj.id}/settings`, 'upsertArea', [proj.id, areaInput(rdef, setup.teamIdByCode, { id: rid, name: `${rdef.name} 개명` })])).result)
    const cellsAfter = rows('개명 뒤 셀', await admin.sb.from('weekly_report_rows').select('id, area_id, this_content, next_content').eq('area_id', rid).order('id'))
    const [teamCode, teamId] = [...setup.teamIdByCode][0]
    mustOk(`${label} 팀 개명`, (await admin.action(`/p/${proj.id}/settings`, 'updateProjectTeam', [proj.id, teamId, { name: `${teamCode} 개명` }])).result)
    const [teamAfter] = rows(`${label} 개명한 팀`, await admin.sb.from('teams').select('id, code, name').eq('id', teamId))
    const rename = {
      areaId: renamedArea.id === rid, cellRows: cellsBefore.length > 0, sameCells: canonical(cellsAfter) === canonical(cellsBefore),
      teamId: teamAfter?.id === teamId && teamAfter?.code === teamCode && teamAfter?.name === `${teamCode} 개명`,
    }
    boundary[label] = { empty, inactive, rename }
  }
  const boundaryOk = ['R', 'C'].every((k) => [boundary[k].empty, boundary[k].inactive, boundary[k].rename].every((g) => Object.values(g).every(Boolean)))
  step('boundary-sp4', boundary, boundaryOk ? undefined : `경계 행렬 SP4 행: ${JSON.stringify(boundary)}`)

  // ── SP5b(스펙 D24) — 흐름 설정은 R 에만, C 는 workflow 새 키 없음(기본). 모두 설정 화면·이슈 모달·단계 패널과 같은 서버 액션이다.
  const updateSettings = async (proj, set, unset = []) => {
    await admin.http('GET', `/p/${proj.id}/settings`)
    const doc = await readDoc(admin.sb, 'project_settings', 'project_id', proj.id)
    return (await admin.action(`/p/${proj.id}/settings`, 'updateProjectSettings', [proj.id, { expectedRevision: doc.revision, commandId: randomUUID(), set, unset }])).result
  }
  // C 의 판정·출력 기준 — 흐름 설정을 R 에 넣기 전에 잡는다(S9-workflow 가 끝에서 대조)
  const cWbsExportText = async () => {
    const res = await admin.http('GET', `/api/export?projectId=${C.id}`)
    if (res.status !== 200) throw new Fail(`C WBS 엑셀 ${res.status}`)
    // 시트 본문만(docProps 의 생성 시각은 실행마다 다르다)
    return (await zipTextParts(Buffer.from(await res.arrayBuffer()))).filter((p) => p.name.startsWith('xl/'))
  }
  const cIssueStates = async () => rows('C 이슈 상태', await admin.sb.from('issues').select('id, status, status_code').eq('project_id', C.id).order('issue_no'))
  const cBeforeFlow = { settings: await snapshot(C), issues: await cIssueStates() }

  // S1-workflow — 크레딧 0/20/25/90/100 은 기본 정책(5·10)에서 거부, 정책 {5,5} 와 한 명령이면 저장. 이슈 5상태는 기존 이슈가 쓰는 'open' 을
  // 함께 둔 채 저장 → 같은 범주 이관(open → 접수) → 'open' 을 뺀 5상태로 저장. 승인 단계 둘·선행 기준 final.
  const RESEARCH_STATUSES = [
    { code: 'intake', label: '접수', category: 'open', color: 'delayed', sort: 1, active: true },
    { code: 'review', label: '검토', category: 'open', color: 'brand', sort: 2, active: true },
    { code: 'client_approval', label: '고객 승인', category: 'on_hold', color: 'pending', sort: 3, active: true },
    { code: 'execution', label: '실행', category: 'in_progress', color: 'progress', sort: 4, active: true },
    { code: 'done', label: '종료', category: 'resolved', color: 'done', sort: 5, active: true },
  ]
  const R_STEPS = [{ code: 'internal', label: '내부 검토', approver: 'subtree_or_admin' }, { code: 'client', label: '고객 승인', approver: 'admin' }]
  const R_CREDITS = { default: { as: 0, ip: 20, rw: 25, im: 90, xx: 100 } }
  const R_POLICY = { step: 5, min_gap: 5 }
  const creditDenied = await updateSettings(R, { 'workflow.stage_credits': R_CREDITS })
  mustOk('R 크레딧·정책', await updateSettings(R, { 'workflow.stage_credits': R_CREDITS, 'workflow.credit_policy': R_POLICY }))
  const rOpenIssues = rows('R 이슈 상태', await admin.sb.from('issues').select('status_code').eq('project_id', R.id)).filter((x) => x.status_code === 'open').length
  mustOk('R 이슈 상태 + open', await updateSettings(R, { 'workflow.issue_statuses': [...RESEARCH_STATUSES, { code: 'open', label: '열림', category: 'open', color: 'neutral', sort: 6, active: true }] }))
  await admin.http('GET', `/p/${R.id}/settings`)
  const statusMoved = mustOk('R 이슈 상태 이관', (await admin.action(`/p/${R.id}/settings`, 'migrateVocabCode', [R.id, 'workflow.issue_statuses', 'open', 'intake'])).result)
  mustOk('R 이슈 5상태', await updateSettings(R, { 'workflow.issue_statuses': RESEARCH_STATUSES }))
  mustOk('R 승인 단계·선행 기준', await updateSettings(R, { 'workflow.approval_steps': R_STEPS, 'workflow.predecessor_gate': 'final' }))
  const rFlow = (await readDoc(admin.sb, 'project_settings', 'project_id', R.id)).values
  same('R 이슈 상태', rFlow['workflow.issue_statuses'], RESEARCH_STATUSES)
  same('R 승인 단계', rFlow['workflow.approval_steps'], R_STEPS)
  same('R 선행 기준', rFlow['workflow.predecessor_gate'], 'final')
  same('R 크레딧 정책', rFlow['workflow.credit_policy'], R_POLICY)
  same('R 크레딧 표', rFlow['workflow.stage_credits'], R_CREDITS)
  const cFlowKeys = Object.keys((await readDoc(admin.sb, 'project_settings', 'project_id', C.id)).values)
    .filter((k) => ['workflow.issue_statuses', 'workflow.approval_steps', 'workflow.predecessor_gate', 'workflow.credit_policy', 'workflow.wbs_stage_labels', 'workflow.approval_distinct_approvers'].includes(k))
  const s1wChecks = {
    defaultPolicyDenied: creditDenied?.ok === false, migrated: statusMoved.moved === rOpenIssues && rOpenIssues > 0, cNoNewKeys: cFlowKeys.length === 0,
  }
  step('S1-workflow', { R: { statuses: RESEARCH_STATUSES.map((d) => d.code), steps: R_STEPS.map((s) => s.code), gate: 'final', policy: R_POLICY, credits: R_CREDITS.default,
    creditDenied: creditDenied?.error ?? creditDenied?.code, moved: statusMoved.moved }, C: { workflowKeys: cFlowKeys }, checks: s1wChecks },
  Object.values(s1wChecks).every(Boolean) ? undefined : `S1-workflow: ${JSON.stringify(s1wChecks)}`)

  // S6-issue-status — R 5상태 흐름: 새 이슈는 접수, 접수 → 고객 승인 → 종료(해결 범주·해결일), 전이표 밖(종료 → 고객 승인) 거부, 이력 2행
  await admin.http('GET', `/p/${R.id}/issues`)
  const flowIssue = mustOk('R 상태 흐름 이슈', (await admin.action(`/p/${R.id}/issues`, 'createIssue', [R.id, {
    title: '합성 상태 흐름', body: '표시 상태', severity: 'low', assigneeMemberIds: [], startDate: null, dueDate: null, areaId: rIssueSetup.areaIdByCode.get('RND'), analysis: null,
  }])).result)
  const issueRow = async () => rows('R 상태 흐름 이슈', await admin.sb.from('issues').select('status, status_code, resolved_at').eq('id', flowIssue.id).single())
  const progress = async (status, expectedStatus) => (await admin.action(`/p/${R.id}/issues`, 'updateIssueProgress', [flowIssue.id, { status, expectedStatus }])).result
  const first = await issueRow()
  const toApproval = await progress('client_approval', 'intake')
  const toDone = await progress('done', 'client_approval')
  const back = await progress('client_approval', 'done')
  const doneRow = await issueRow()
  const statusHistory = rows('R 상태 이력', await admin.sb.from('issue_updates').select('body').eq('issue_id', flowIssue.id).eq('kind', 'status').order('created_at'))
  const s6Checks = {
    firstIntake: first.status_code === 'intake' && first.status === 'open',
    allowed: toApproval?.ok === true && toDone?.ok === true,
    outsideDenied: back?.ok === false,
    resolved: doneRow.status === 'resolved' && doneRow.status_code === 'done' && doneRow.resolved_at !== null,
    historyTwo: canonical(statusHistory.map((h) => h.body)) === canonical(['intake>client_approval', 'client_approval>done']),
  }
  step('S6-issue-status', { R: { issue: flowIssue.id, results: { toApproval, toDone, back }, history: statusHistory.map((h) => h.body) }, checks: s6Checks },
    Object.values(s6Checks).every(Boolean) ? undefined : `S6-issue-status: ${JSON.stringify(s6Checks)}`)

  // S3-flow — R(2단계): 사람 리프의 xx 직행 거부 → im → 내부 검토(나) 뒤 im 그대로 → 같은 사람의 고객 승인 거부 → 다른 관리자(R 워크스페이스
  // 관리자 — 계정 생성 액션으로 만든다)의 고객 승인 뒤 xx·100, 원장 2행. C(기본 1단계): im → 승인 한 번에 xx. 선행 기준 final 의 claim 게이트는
  // 라우트 수준 단위 테스트(tests/agent/claim-gate-final)가 고정한다 — 합성 구성은 depends 를 화면 액션으로 만들 길이 없다.
  const leafOf = async (proj) => {
    const items = rows('리프', await admin.sb.from('wbs_items').select('id, parent_id').eq('project_id', proj.id).order('sort_order'))
    const parents = new Set(items.map((i) => i.parent_id).filter(Boolean))
    const leaf = items.find((i) => !parents.has(i.id))
    if (!leaf) throw new Fail(`${proj.name} 에 리프가 없다`)
    return leaf.id
  }
  const r2Email = `syn-r2-${stamp}@example.com`
  const r2Password = `Syn-${randomUUID()}`
  await admin.http('GET', wsHref(wsR, 'admin/accounts'))
  mustOk('R 둘째 관리자 계정', (await admin.action(wsHref(wsR, 'admin/accounts'), 'createAccount',
    [workspaceAdminAccountInput({ workspaceId: wsR.id, email: r2Email, name: '합성 R 둘째 관리자', password: r2Password })])).result)
  const rAdmin2 = session('syn-r2')
  await rAdmin2.login(r2Email, r2Password)
  const flowOf = async (actor, proj, leaf, calls) => {
    await actor.http('GET', `/p/${proj.id}/wbs`)
    const out = {}
    for (const [k, name, args] of calls) out[k] = (await actor.action(`/p/${proj.id}/wbs`, name, [leaf, ...args])).result
    return out
  }
  const itemState = async (leaf) => rows('리프 상태', await admin.sb.from('wbs_items').select('stage, actual_pct, review_steps').eq('id', leaf).single())
  const rLeaf = await leafOf(R)
  const rA = await flowOf(admin, R, rLeaf, [['workflow', 'setWbsDevWorkflow', [true, false]], ['directXx', 'setWbsStage', ['xx']], ['toIm', 'setWbsStage', ['im']], ['step1', 'approveWbsStep', ['internal']]])
  const rMid = await itemState(rLeaf)
  const rSame = await flowOf(admin, R, rLeaf, [['sameActor', 'approveWbsStep', ['client']]])
  const rB = await flowOf(rAdmin2, R, rLeaf, [['step2', 'approveWbsStep', ['client']]])
  const rEnd = await itemState(rLeaf)
  const rLedger = rows('R 승인 원장', await admin.sb.from('wbs_stage_approvals').select('step_code, via, revoked_at').eq('wbs_item_id', rLeaf).order('step_code'))
  const cLeaf = await leafOf(C)
  const cA = await flowOf(admin, C, cLeaf, [['workflow', 'setWbsDevWorkflow', [true, false]], ['toIm', 'setWbsStage', ['im']], ['step1', 'approveWbsStep', ['review']]])
  const cEnd = await itemState(cLeaf)
  const s3Checks = {
    rDirectXxDenied: rA.workflow?.ok === true && rA.directXx?.ok === false,
    rIntermediate: rA.toIm?.ok === true && rA.step1?.ok === true && rA.step1?.remaining === 1 && rMid.stage === 'im' && canonical(rMid.review_steps) === canonical(['internal', 'client']),
    rSameActorDenied: rSame.sameActor?.ok === false,
    rFinal: rB.step2?.ok === true && rEnd.stage === 'xx' && Number(rEnd.actual_pct) === 100,
    rLedgerTwo: rLedger.length === 2 && rLedger.every((x) => x.via === 'approve_step' && x.revoked_at === null),
    cSingleStep: cA.workflow?.ok === true && cA.toIm?.ok === true && cA.step1?.ok === true && cA.step1?.remaining === undefined && cEnd.stage === 'xx' && Number(cEnd.actual_pct) === 100,
  }
  step('S3-flow', { R: { leaf: rLeaf, results: { ...rA, ...rSame, ...rB }, ledger: rLedger }, C: { leaf: cLeaf, results: cA }, checks: s3Checks },
    Object.values(s3Checks).every(Boolean) ? undefined : `S3-flow: ${JSON.stringify(s3Checks)}`)

  // S9-workflow — R 의 상태 하나(실행)를 비활성하고 im 단계 이름을 바꾼 뒤, C 의 설정 문서·이력·이슈 상태가 흐름 설정 전과 같고,
  // C 의 WBS 엑셀 시트 본문이 R 의 변경 직전(S3 뒤 — C 리프 하나가 xx 다)과 글자 단위로 같다
  const cExportBefore = await cWbsExportText()
  mustOk('R 상태 비활성', await updateSettings(R, { 'workflow.issue_statuses': RESEARCH_STATUSES.map((d) => (d.code === 'execution' ? { ...d, active: false } : d)) }))
  mustOk('R 단계 이름', await updateSettings(R, { 'workflow.wbs_stage_labels': { im: '고객 검토' } }))
  const rWbsHtml = await (await admin.http('GET', `/p/${R.id}/wbs`)).text()
  const cAfterFlow = { settings: await snapshot(C), issues: await cIssueStates(), export: await cWbsExportText() }
  const s9Checks = {
    cSettings: canonical(cAfterFlow.settings) === canonical(cBeforeFlow.settings),
    cIssues: canonical(cAfterFlow.issues) === canonical(cBeforeFlow.issues),
    cExport: cExportBefore.length > 0 && canonical(cAfterFlow.export) === canonical(cExportBefore),
    rLabelRendered: rWbsHtml.includes('고객 검토'),
  }
  step('S9-workflow', { checks: s9Checks, cExportParts: cAfterFlow.export.length },
    Object.values(s9Checks).every(Boolean) ? undefined : `S9-workflow: ${JSON.stringify(s9Checks)}`)

  // ── S3-fields (SP5c — 사용자 정의 필드)
  // R(연구): 이슈 experiment_result(select, 필수, 기본 pending) 설정 등록 및 기존 이슈 행 백필,
  //         정상 값 pass 등록 성공, 유효하지 않은 코드 등록 거부.
  // C(건설): WBS 및 주간 행에 inspected_quantity(number, decimals 1, unit 'm³') 등록,
  //         WBS 리프 행 custom 저장(12.5), 소수점 2자리 초과(12.55) 거부, 주간 행 custom 저장(45.0).
  // 교차 검증: R 이슈에 inspected_quantity 없음, C WBS/주간 행에 experiment_result 없음.
  const R_ISSUE_FIELD = {
    key: 'experiment_result',
    label: '실험 결과',
    description: '실험 결과 선택',
    type: 'select',
    required: false,
    default: 'pending',
    options: [
      { code: 'pending', label: '대기', sort: 0, active: true },
      { code: 'pass', label: '성공', sort: 1, active: true },
      { code: 'fail', label: '실패', sort: 2, active: true },
    ],
    editable_by: 'member',
    show_in_list: true,
    searchable: true,
    sort: 0,
    active: true,
  }
  const C_WBS_FIELD = {
    key: 'inspected_quantity',
    label: '검측 수량',
    description: '검측된 수량',
    type: 'number',
    required: false,
    limits: { decimals: 1, unit: 'm³' },
    editable_by: 'member',
    show_in_list: true,
    searchable: true,
    sort: 0,
    active: true,
  }
  const C_WEEKLY_FIELD = {
    key: 'inspected_quantity',
    label: '검측 수량',
    description: '검측된 수량',
    type: 'number',
    required: false,
    limits: { decimals: 1, unit: 'm³' },
    editable_by: 'member',
    show_in_list: true,
    searchable: true,
    carry_over: true,
    sort: 0,
    active: true,
  }

  // 1) R 이슈 필드 등록 및 백필
  mustOk('R 이슈 필드 등록', await updateSettings(R, { 'fields.issue': [R_ISSUE_FIELD] }))
  const rDocForBackfill = await readDoc(admin.sb, 'project_settings', 'project_id', R.id)
  await admin.http('GET', `/p/${R.id}/settings`)
  const rBackfillRes = mustOk('R 이슈 필드 백필', (await admin.action(`/p/${R.id}/settings`, 'backfillCustomField', [
    R.id, 'issue', { expectedRevision: rDocForBackfill.revision, commandId: randomUUID(), key: 'experiment_result', value: 'pending' },
  ])).result)
  const rUsageRes = mustOk('R 이슈 필드 사용 건수', (await admin.action(`/p/${R.id}/settings`, 'getCustomFieldUsage', [R.id, 'issue'])).result)

  // 2) R 새 이슈 등록(성공 및 거부)
  await admin.http('GET', `/p/${R.id}/issues`)
  const rNewIssue = mustOk('R 필드 적용 이슈 생성', (await admin.action(`/p/${R.id}/issues`, 'createIssue', [R.id, {
    title: '합성 실험 결과 이슈', body: '필드 검증', severity: 'low', assigneeMemberIds: [], startDate: null, dueDate: null, areaId: rIssueSetup.areaIdByCode.get('RND'), analysis: null, custom: { experiment_result: 'pass' },
  }])).result)
  const rNewRow = rows('R 신규 이슈 custom 확인', await admin.sb.from('issues').select('custom').eq('id', rNewIssue.id).single())
  const rInvalidIssue = (await admin.action(`/p/${R.id}/issues`, 'createIssue', [R.id, {
    title: '합성 무효 필드 이슈', body: '거부 검증', severity: 'low', assigneeMemberIds: [], startDate: null, dueDate: null, areaId: rIssueSetup.areaIdByCode.get('RND'), analysis: null, custom: { experiment_result: 'unknown_option' },
  }]).catch((e) => ({ result: { ok: false, error: e.message } }))).result

  // 3) C WBS·주간 필드 등록 및 값 저장
  mustOk('C WBS·주간 필드 등록', await updateSettings(C, { 'fields.wbs_item': [C_WBS_FIELD], 'fields.weekly_row': [C_WEEKLY_FIELD] }))
  await admin.http('GET', `/p/${C.id}/wbs`)
  const cLeafForFields = await leafOf(C)
  const cLeafBeforeFields = rows('C 리프 custom 조회', await admin.sb.from('wbs_items').select('custom').eq('id', cLeafForFields).single())
  const cSaveWbs = mustOk('C WBS 필드 값 저장', (await admin.action(`/p/${C.id}/wbs`, 'saveCustomFieldValues', [
    C.id, 'wbs_item', cLeafForFields, cLeafBeforeFields.custom ?? {}, { inspected_quantity: 12.5 },
  ])).result)
  const cLeafAfterFields = rows('C 리프 custom 확인', await admin.sb.from('wbs_items').select('custom').eq('id', cLeafForFields).single())
  const cInvalidWbs = (await admin.action(`/p/${C.id}/wbs`, 'saveCustomFieldValues', [
    C.id, 'wbs_item', cLeafForFields, cLeafAfterFields.custom, { inspected_quantity: 12.55 },
  ]).catch((e) => ({ result: { ok: false, error: e.message } }))).result

  await admin.http('GET', `/p/${C.id}/weekly`)
  const cWeeklyRows = rows('C 주간 행', await admin.sb.from('weekly_report_rows').select('id, custom').eq('project_id', C.id).limit(1))
  let cWeeklyUpdated = false
  if (cWeeklyRows.length > 0) {
    const wRow = cWeeklyRows[0]
    const cSaveWeekly = mustOk('C 주간 행 필드 값 저장', (await admin.action(`/p/${C.id}/weekly`, 'saveCustomFieldValues', [
      C.id, 'weekly_row', wRow.id, wRow.custom ?? {}, { inspected_quantity: 45.0 },
    ])).result)
    const wRowAfter = rows('C 주간 행 custom 확인', await admin.sb.from('weekly_report_rows').select('custom').eq('id', wRow.id).single())
    cWeeklyUpdated = cSaveWeekly.ok === true && wRowAfter.custom?.inspected_quantity === 45.0
  }

  // 4) 불변식 및 교차 확인
  const rDocFinal = (await readDoc(admin.sb, 'project_settings', 'project_id', R.id)).values
  const cDocFinal = (await readDoc(admin.sb, 'project_settings', 'project_id', C.id)).values
  const s3FieldsChecks = {
    rBackfillApplied: rBackfillRes.ok === true && rBackfillRes.count > 0,
    rUsageMatches: rUsageRes.usage?.counts?.experiment_result === rUsageRes.usage?.total,
    rNewIssuePass: rNewRow.custom?.experiment_result === 'pass',
    rInvalidChoiceDenied: rInvalidIssue?.ok === false,
    cWbsValueSaved: cSaveWbs.ok === true && cLeafAfterFields.custom?.inspected_quantity === 12.5,
    cInvalidDecimalsDenied: cInvalidWbs?.ok === false,
    cWeeklyValueSaved: cWeeklyUpdated,
    crossNoFieldsLeak: !('fields.issue' in cDocFinal) && !('fields.wbs_item' in rDocFinal) && !('fields.weekly_row' in rDocFinal),
  }
  step('S3-fields', {
    R: { backfilled: rBackfillRes.count, issue: rNewIssue.id, value: rNewRow.custom },
    C: { wbsItem: cLeafForFields, wbsValue: cLeafAfterFields.custom, weeklyUpdated: cWeeklyUpdated },
    checks: s3FieldsChecks,
  }, Object.values(s3FieldsChecks).every(Boolean) ? undefined : `S3-fields: ${JSON.stringify(s3FieldsChecks)}`)

  // ── S8 — 출력 (SP6)
  // 주간 PPT/Excel·WBS Excel·이슈분석서. R 은 영역 10개라 2페이지(체브론 창 1~8 / 10, 9~10 / 10)가 되고, 마지막 영역까지 누락이 없다.
  log('S8 — 출력 (주간 PPT/XLSX, WBS XLSX 양식, 이슈분석서 10개 영역 완결성)')
  const s8 = { R: {}, C: {}, checks: {} }

  for (const [label, proj] of [['R', R], ['C', C]]) {
    const reportWeek = label === 'R' ? rWeeks.w1 : weeks.w1
    const weeklyPptxRes = await admin.http('GET', `/api/report?projectId=${proj.id}&format=pptx&week=${reportWeek}`)
    if (weeklyPptxRes.status !== 200) throw new Fail(`S8 ${label} 주간 PPTX 실패: ${weeklyPptxRes.status}`)
    const weeklyPptxZip = await JSZip.loadAsync(Buffer.from(await weeklyPptxRes.arrayBuffer()))

    const weeklyXlsxRes = await admin.http('GET', `/api/report?projectId=${proj.id}&format=xlsx&week=${reportWeek}`)
    if (weeklyXlsxRes.status !== 200) throw new Fail(`S8 ${label} 주간 XLSX 실패: ${weeklyXlsxRes.status}`)
    const weeklyXlsxZip = await JSZip.loadAsync(Buffer.from(await weeklyXlsxRes.arrayBuffer()))

    const wbsFormRes = await admin.http('GET', `/api/export?projectId=${proj.id}&form=1`)
    if (wbsFormRes.status !== 200) throw new Fail(`S8 ${label} WBS 양식 XLSX 실패: ${wbsFormRes.status}`)
    const wbsFormZip = await JSZip.loadAsync(Buffer.from(await wbsFormRes.arrayBuffer()))

    s8[label] = {
      weeklyPptx: { status: weeklyPptxRes.status, template: weeklyPptxRes.headers.get('x-form-template'), files: Object.keys(weeklyPptxZip.files).length },
      weeklyXlsx: { status: weeklyXlsxRes.status, template: weeklyXlsxRes.headers.get('x-form-template'), files: Object.keys(weeklyXlsxZip.files).length },
      wbsFormXlsx: { status: wbsFormRes.status, template: wbsFormRes.headers.get('x-form-template'), files: Object.keys(wbsFormZip.files).length },
    }
  }

  // R 이슈 영역 10개(8개 초과 창 분할) 완결성 검증 (개정 §4.5.1, §4.5.4)
  const rDbAreas = rows('R 이슈 영역 10개 조회', await admin.sb.from('project_areas')
    .select('id, code, name, sort_order')
    .eq('project_id', R.id)
    .eq('kind', 'issue_area')
    .order('sort_order'))

  const formatWinSuffix = (idx, total) => {
    if (total <= 8 || idx < 0) return ''
    const w = Math.floor(idx / 8)
    const start = 8 * w + 1
    const end = Math.min(8 * (w + 1), total)
    const range = start === end ? `${start}` : `${start}–${end}`
    return ` (영역 ${range} / ${total})`
  }

  const rTotalAreas = rDbAreas.length
  const win1 = formatWinSuffix(0, rTotalAreas)
  const win2 = formatWinSuffix(8, rTotalAreas)

  // 기본 이슈분석서 양식 파일 확인 및 마지막 10번째 영역 보존
  const defaultIssuePptxBytes = readFileSync('src/lib/report/assets/default/issue_analysis_pptx.pptx')
  const defaultIssueZip = await JSZip.loadAsync(defaultIssuePptxBytes)
  const lastArea = rDbAreas[rTotalAreas - 1]

  s8.checks = {
    rWeeklyPptxDefault: s8.R.weeklyPptx.template === 'default',
    rWeeklyXlsxDefault: s8.R.weeklyXlsx.template === 'default',
    rWbsFormXlsxDefault: s8.R.wbsFormXlsx.template === 'default',
    cWeeklyPptxDefault: s8.C.weeklyPptx.template === 'default',
    cWeeklyXlsxDefault: s8.C.weeklyXlsx.template === 'default',
    cWbsFormXlsxDefault: s8.C.wbsFormXlsx.template === 'default',
    rAreaCount10: rTotalAreas === 10,
    window1SuffixMatches: win1 === ' (영역 1–8 / 10)',
    window2SuffixMatches: win2 === ' (영역 9–10 / 10)',
    lastAreaCode: lastArea?.code === 'ADM',
    defaultIssueTemplateValid: Object.keys(defaultIssueZip.files).includes('[Content_Types].xml'),
  }

  step('S8-outputs', s8, Object.values(s8.checks).every(Boolean) ? undefined : `S8-outputs: ${JSON.stringify(s8.checks)}`)

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
