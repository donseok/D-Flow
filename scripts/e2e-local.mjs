// scripts/e2e-local.mjs — SP0 done_when 1번 흐름 + SP1 조직 코어 흐름을 로컬 스택에서 HTTP 로 완주한다. 로컬 전용.
//   SP0: 로그인 → 프로젝트 생성(단계 라벨 입력) → WBS 엑셀 양식 다운로드·채우기 → 임포트(inspect → execute append·replace)
//        → 주간보고 PPT·엑셀, WBS 엑셀 내보내기 → 산출물 zip 전 항목에서 원 고객사 흔적 검사.
//   SP1: 프로젝트 A·B → 프로젝트 팀(A: 두 팀, B: 한 팀) → 명단(본인@A 관리자·다중 팀, 외부 인력 bob@A, 본인@B 멤버)
//        → A 임포트(팀명 담당) → 외부 인력 bob 을 A 리프 담당으로 → 회의(참석자 bob) → 초대 발급(carol, 멤버, A 첫 팀)
//        → 새 세션으로 가입+합류 → carol 로그인: A 멤버, B 조회 전용(같은 워크스페이스 — 스펙 2.4.1), 타 워크스페이스·미존재는
//        not-found(존재 은닉 — 상태 코드가 아니라 notFound() digest 로 판정) → 관리자 세션으로 주요 화면 렌더(오류 표식·흐름 데이터).
//   SP2: 워크스페이스 A(부트스트랩)·B(service_role 로 행만 — 생성 화면은 SP3). B 의 프로젝트 C 와 B 관리자 bea 는 플랫폼 관리자가
//        createProject(B, …)·createAccount({ workspaceId: B, … }) 로 → A 관리자 ana(플랫폼 관리자 아님)가 createProject(A, …) 로
//        E2E A2 → 외부 이메일 초대·가입 → 그 계정의 워크스페이스 소속은 A 하나 → ana 가 회의록 업로드(프로젝트 지정·미지정 —
//        Storage 키 ws/<A>/p/…) → bea 로그인: A 프로젝트 URL 은 not-found, 회의록·프로젝트 목록에 A 흔적 없음, A 경로 Storage 쓰기·
//        읽기 거부 → 외부 회의록 API(meta·목록)가 user_email 의 워크스페이스로만 좁혀진다.
//   SP3a: A 의 설정을 updateProjectSettings 로 바꿔 이력(전·후·행위자)과 같은 명령 재전송의 duplicate 를 보고, A 를 원본으로 복사
//        생성해 이력이 copy/copied_from 인지 본다(2a·2b). 워크스페이스 B 의 modules.allowed 는 만든 직후 비core 13개로 기록한다.
//   SP3a B: render-pages 뒤 A 의 issues·agents·chatbot 과 워크스페이스의 minutes_integration 을 끄고 화면·액션·외부 API·색인 워커의 관문을 본다.
//   SP4 A1: 기존 import 두 단계는 명령 id(commandId)를 싣고 replace 앞에 사전 백업(getWbsBackup)을 받는다. minutes-api-scope 뒤·render-pages 앞에서
//        B 의 주간 영역 0개 → CONFIG_REQUIRED, 영역(실험·운영)·주차 셋·이월 대기 → 매핑·개명·추가(W17), B 의 시트 PPT·기본 보고서 둘의 센티널 0·
//        임베드, A 의 등록 이름 영역, 새 프로젝트 I 의 가져오기 멱등(같은 명령 id 2회 = 1벌, 다른 내용 422), 상속 프로젝트 D 의 미등록 팀 →
//        409 → 전환·등록. render-pages 는 B 의 주간·설정 화면을 더하고 B 주간 HTML 의 센티널을 기록한다(스펙 §6.3 — 단계는 이름으로 부른다).
// 브라우저 자동화는 비밀번호를 입력하지 못하므로 화면이 부르는 것과 같은 경로(서버 액션·API 라우트)를 직접 부른다.
// 사용: db:reset → dev:bootstrap 직후(깨끗한 DB), 스크래치 워크트리에서 npm run env:local 뒤 러너와 같은 앱 주소·시크릿으로 3101 에 띄운 npm run dev 가
// 떠 있는 상태에서(3000 은 main 체크아웃의 사용자 dev 서버라 러너가 거부한다 — e2eBaseUrl)
//   INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3101 MINUTES_API_ENABLED=true MINUTES_API_SECRET=<시크릿> CRON_SECRET=<시크릿> npm run dev -- -p 3101
//   BOOTSTRAP_PASSWORD=… E2E_B_PASSWORD=… MINUTES_API_SECRET=<같은 시크릿> CRON_SECRET=<같은 시크릿> [BOOTSTRAP_EMAIL=admin@example.com] \
//   [E2E_BASE_URL=http://localhost:3101(기본값)] [E2E_OUT_DIR=<산출물 폴더>] node scripts/e2e-local.mjs
// 비밀번호·시크릿은 env 로만 받고 출력하지 않는다(ana·외부 계정·carol 의 비밀번호는 실행마다 새로 만든다).
// 결과는 stdout 에 JSON 한 덩어리. 어느 단계든 실패하면 그 자리에서 멈추고 exit 1.
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  A_ADMIN, B_ADMIN, COPY_LEVEL_LABELS, ERR_DENIED, ERR_MODULE_DISABLED, INVITEE, LEVEL_LABELS, OTHER_WORKSPACE, OUTSIDER, SP1_TEAMS, TEMPLATE_HEADER, WS_TEAM,
  dispositionFilename, e2eRows, findTraces, inWorkspaceStorage, inviteInput,
  e2eBaseUrl, inviteTokenFromUrl, leafCodes, leakedIds, localClientEnv, meetingInput, minuteBodyPath, minuteInput, minuteSource,
  notFoundRendered, pageProblems, presentTexts, redactInviteTokens, rosterPlan, rosterView, signupInput, teamIdsByCode, toCell,
  workspaceAdminAccountInput,
} from './lib/e2e.mjs'
import {
  E2E_AREAS, REGISTERED_AREA, UNREGISTERED_TEAM, areaInput, carriedText, fillWbsWorkbook, importForm, importResultView, inspectForm, isMondayIso,
  pptText, seoulToday, sentinelReport, shiftDays, slideCount, teamRefs,
} from './lib/e2e.mjs'
import { SENTINEL_MASKS, excludeRegistered, findSentinels, sp4Sentinels, zipTextParts } from './lib/sentinels.mjs'
import { createSessionFactory } from './lib/e2e-session.mjs'
import { BOOTSTRAP_MODULE_IDS } from './lib/bootstrap-modules.mjs'
import { SCRIPT_SCHEMA_VERSION } from './lib/settings-consts.mjs'
import { localAdminEnv } from './lib/targets.mjs'

class Fail extends Error {}
const log = (m) => console.error(`· ${m}`)

let env
let adminEnv
try {
  const text = readFileSync('.env.local', 'utf8')
  env = localClientEnv(text)
  adminEnv = localAdminEnv(text) // 타 워크스페이스 픽스처 전용(로컬 판정은 targets.mjs 한 곳)
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
const outDir = process.env.E2E_OUT_DIR || join(tmpdir(), 'd-flow-e2e')
if (!password) { console.error('✗ BOOTSTRAP_PASSWORD 가 없다 — dev:bootstrap 때 쓴 값을 env 로 넘긴다'); process.exit(1) }
// B 관리자 비밀번호 — 기본값을 두지 않는다(리포에 적힌 값이 로컬 계정 비밀번호가 되지 않게). 8자 미만은 createAccount 가 거부한다.
const bPassword = process.env.E2E_B_PASSWORD
if (!bPassword || bPassword.length < 8) { console.error('✗ E2E_B_PASSWORD 가 없거나 8자 미만이다'); process.exit(1) }
// 외부 회의록 API 시크릿 — dev 서버를 띄울 때 준 MINUTES_API_SECRET 과 같은 값(MINUTES_API_ENABLED=true 도 필요, 없으면 라우트가 404).
const minutesApiSecret = process.env.MINUTES_API_SECRET
if (!minutesApiSecret) { console.error('✗ MINUTES_API_SECRET 가 없다 — dev 서버에 준 값과 같은 값을 넘긴다'); process.exit(1) }
const cronSecret = process.env.CRON_SECRET
if (!cronSecret) { console.error('✗ CRON_SECRET 가 없다 — dev 서버에 준 값과 같은 값을 넘긴다'); process.exit(1) }

const MANIFEST = '.next/server/server-reference-manifest.json'
const ACTIONS = {
  createProject: { filename: 'src/app/actions/project.ts', exportedName: 'createProject', worker: '/projects/page' },
  createAccount: { filename: 'src/app/actions/accounts.ts', exportedName: 'createAccount', worker: '/admin/accounts/page' },
  addTeam: { filename: 'src/app/actions/teams.ts', exportedName: 'addTeam', worker: '/admin/teams/page' },
  createMinute: { filename: 'src/app/actions/minutes.ts', exportedName: 'createMinute', worker: '/minutes/page' },
  addProjectTeam: { filename: 'src/app/actions/projectTeams.ts', exportedName: 'addProjectTeam', worker: '/p/[projectId]/settings/page' },
  upsertRosterMember: { filename: 'src/app/actions/roster.ts', exportedName: 'upsertRosterMember', worker: '/p/[projectId]/members/page' },
  setWbsAssignee: { filename: 'src/app/actions/wbsAssign.ts', exportedName: 'setWbsAssignee', worker: '/p/[projectId]/wbs/page' },
  createMeeting: { filename: 'src/app/actions/meetings.ts', exportedName: 'createMeeting', worker: '/p/[projectId]/meetings/page' },
  createProjectInvite: { filename: 'src/app/actions/projectInvites.ts', exportedName: 'createProjectInvite', worker: '/p/[projectId]/members/page' },
  redeemInviteWithSignup: { filename: 'src/app/actions/inviteRedeem.ts', exportedName: 'redeemInviteWithSignup', worker: '/invite/[token]/page' },
  updateProjectSettings: { filename: 'src/app/actions/settings.ts', exportedName: 'updateProjectSettings', worker: '/p/[projectId]/settings/page' },
  createIssue: { filename: 'src/app/actions/issues.ts', exportedName: 'createIssue', worker: '/p/[projectId]/issues/page' },
  createAgentToken: { filename: 'src/app/actions/agentTokens.ts', exportedName: 'createAgentToken', worker: '/account/page' },
  setWorkspaceRole: { filename: 'src/app/actions/accounts.ts', exportedName: 'setWorkspaceRole', worker: '/admin/accounts/page' },
  listAuthzEvents: { filename: 'src/app/actions/authzEvents.ts', exportedName: 'listAuthzEvents', worker: '/w/[slug]/settings/page' },
  createWeeklyReport: { filename: 'src/app/actions/weekly.ts', exportedName: 'createWeeklyReport', worker: '/p/[projectId]/weekly/page' },
  saveWeeklyCells: { filename: 'src/app/actions/weekly.ts', exportedName: 'saveWeeklyCells', worker: '/p/[projectId]/weekly/page' },
  upsertArea: { filename: 'src/app/actions/projectAreas.ts', exportedName: 'upsertArea', worker: '/p/[projectId]/settings/page' },
  getWbsBackup: { filename: 'src/app/actions/importBackup.ts', exportedName: 'getWbsBackup', worker: '/p/[projectId]/import/page' },
}

const summary = { base, email, outDir, steps: [], artifacts: [] }
/**
 * 단계 기록 — 그 단계의 검사가 끝난 뒤 부른다. failure 를 주면 ✗ 로 기록·출력하고 Fail 을 던진다
 * (기록을 남긴 채 실패해야 결과 JSON 에 어느 단계에서 무엇이 틀렸는지 남는다).
 * @param {string} name @param {object} detail @param {string} [failure]
 */
const step = (name, detail, failure) => {
  // detail 의 name·at·ok 가 단계 이름·시각·판정을 덮으면 결과 JSON 이 거짓말을 한다(러너 개발 중 name 으로 실제로 한 번 겪었다).
  if (['name', 'at', 'ok'].some((k) => k in detail)) throw new Fail(`단계 ${name} 의 기록에 예약 키(name·at·ok)가 있다`)
  summary.steps.push({ name, at: new Date().toISOString(), ok: !failure, ...detail })
  if (failure) {
    log(`${name} ✗`)
    throw new Fail(failure)
  }
  log(`${name} ✓`)
}

const session = createSessionFactory({ env, base, manifestPath: MANIFEST, actions: ACTIONS, Fail })

/** { ok: true } 계열 반환이 아니면 멈춘다 — 실패 문구를 그대로 올린다. */
function mustOk(name, result) {
  if (!result || result.ok !== true) throw new Fail(`${name} 실패: ${JSON.stringify(result)}`)
  return result
}

/** 조회 오류를 '0건'으로 넘기지 않는다. */
function rows(what, { data, error }) {
  if (error || !data) throw new Fail(`${what} 조회 실패: ${error?.message ?? 'data 없음'}`)
  return data
}

function same(what, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Fail(`${what} 가 다르다: ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`)
  }
}

const ROSTER_SELECT = 'id, access_role, people!inner(display_name, email, user_id), project_member_teams(is_primary, teams(code))'

async function main() {
  mkdirSync(outDir, { recursive: true })
  const admin = session('admin')
  // service_role — 세션 경로에 grant 가 없는 표(project_invites)·남의 소속·Storage 목록의 확인과 워크스페이스 B 행에만 쓴다(로컬 전용, localAdminEnv).
  const svc = createClient(adminEnv.url, adminEnv.serviceRoleKey, { auth: { persistSession: false } })
  /** 계정의 워크스페이스 소속·플랫폼 관리자 여부 — 남의 소속은 세션으로 읽을 수 없어 service_role 로 본다. */
  const membershipOf = async (addr) => {
    const prof = rows(`프로필(${addr})`, await svc.from('profiles').select('user_id').eq('email', addr))
    if (prof.length !== 1) throw new Fail(`${addr} 프로필이 ${prof.length}건`)
    const userId = prof[0].user_id
    const memberships = rows('워크스페이스 소속', await svc.from('workspace_members').select('workspace_id,role').eq('user_id', userId).order('workspace_id'))
    const platform = rows('플랫폼 관리자', await svc.from('platform_admins').select('user_id').eq('user_id', userId))
    return { userId, memberships, platformAdmin: platform.length > 0 }
  }

  // ── 1. 로그인 — 미들웨어가 /login 으로 돌려보내지 않아야 한다(302/307 이면 실패). 부트스트랩 계정의 워크스페이스(= A)는
  // 정확히 하나·관리자여야 한다 — 화면(/projects)도 유일 소속일 때만 그 워크스페이스로 프로젝트를 만든다.
  const me = await admin.login(email, password)
  await admin.http('GET', '/projects')
  const myWs = rows('워크스페이스 소속', await admin.sb.from('workspace_members').select('workspace_id,role').eq('user_id', me.id))
  if (myWs.length !== 1 || myWs[0].role !== 'admin') throw new Fail(`부트스트랩 계정의 워크스페이스 소속이 ${JSON.stringify(myWs)}(관리자 1건이어야 한다)`)
  const wsA = myWs[0].workspace_id
  step('login', { userId: me.id, workspaceId: wsA, cookieNames: [...admin.jar.keys()] })

  // ── 2. 프로젝트 A·B — 화면(NewProjectModal)이 부르는 createProject({ workspaceId, … }). 결과는 그 세션으로 DB 에서 확인한다
  // (같은 이름 1건 + 지정한 워크스페이스 + 라벨 그대로).
  const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, '')
  const createProject = async (who, workspaceId, label) => {
    const name = `E2E ${label} ${stamp}`
    const { actionId, result } = await who.action('/projects', 'createProject', [{
      workspaceId, name, startDate: null, endDate: null, description: null, levelLabels: LEVEL_LABELS, commandId: randomUUID(),
    }])
    if (!result?.ok) throw new Fail(`createProject(${label}) 실패: ${JSON.stringify(result)}`)
    const found = rows('프로젝트', await who.sb.from('projects').select('id,name,workspace_id').eq('name', name))
    if (found.length !== 1) throw new Fail(`생성된 프로젝트 ${name} 가 ${found.length}건`)
    if (found[0].workspace_id !== workspaceId) throw new Fail(`${name} 가 워크스페이스 ${found[0].workspace_id} 에 생겼다(기대 ${workspaceId})`)
    // 설정 문서는 통째로 읽어 JS 에서 고른다 — 키에 점이 있어 PostgREST 경로 필터를 쓰지 않는다
    const { data: settings, error } = await who.sb.from('project_settings').select('values,revision').eq('project_id', found[0].id).single()
    if (error) throw new Fail(`프로젝트 설정 조회 실패: ${error.message}`)
    same(`${name} 단계 라벨`, settings.values['core.level_labels'], LEVEL_LABELS)
    if (settings.revision !== 1) throw new Fail(`${name} 의 revision 이 ${settings.revision}(기대 1)`)
    return { id: found[0].id, name, workspaceId: found[0].workspace_id, settings: settings.values, actionId }
  }
  const A = await createProject(admin, wsA, 'A')
  const B = await createProject(admin, wsA, 'B')
  step('create-projects', {
    path: `server action createProject(${A.actionId.slice(0, 12)}…) via POST /projects`,
    projects: [A, B].map(({ id, name, settings }) => ({ id, name, settings })), workspaceId: A.workspaceId, rows: 2,
  })

  // ── 2a. 설정 액션 — 프로젝트 A 의 마일스톤 키워드를 바꾸고 이력에 전·후·행위자가 남는지 본다(스펙 §7.3 #1). 설정 화면을 GET 해 액션을 등록한다.
  await admin.http('GET', `/p/${A.id}/settings`)
  const cmd1 = randomUUID()
  const upd = await admin.action(`/p/${A.id}/settings`, 'updateProjectSettings',
    [A.id, { expectedRevision: 1, commandId: cmd1, set: { 'core.milestone_keywords': ['Kick-Off', '오픈'] }, unset: [] }])
  if (!upd.result?.ok || upd.result.kind !== 'applied' || upd.result.revision !== 2) throw new Fail(`updateProjectSettings 결과가 예상과 다르다: ${JSON.stringify(upd.result)}`)
  const hist = rows('설정 이력', await admin.sb.from('project_settings_history').select('key,old_value,new_value,changed_by,source,revision').eq('project_id', A.id).eq('command_id', cmd1))
  same('이력 1행', hist.length, 1)
  same('이력 키·전후·행위자', [hist[0].key, hist[0].old_value, hist[0].new_value, hist[0].changed_by, hist[0].source, hist[0].revision],
    ['core.milestone_keywords', null, ['kick-off', '오픈'], me.id, 'edit', 2])
  const dup = await admin.action(`/p/${A.id}/settings`, 'updateProjectSettings',
    [A.id, { expectedRevision: 1, commandId: cmd1, set: { 'core.milestone_keywords': ['Kick-Off', '오픈'] }, unset: [] }])
  same('같은 명령 재전송은 duplicate', dup.result?.kind, 'duplicate')
  step('settings-update', { projectId: A.id, commandId: cmd1, revision: 2, history: hist[0], duplicate: dup.result?.kind })

  // ── 2b. 복사 생성(스펙 §7.3 #2) — A 를 원본으로. 복사본 이력은 source copy·copied_from A·행위자 본인·revision 1 이다. 라벨은 입력값 —
  // A 와 다른 라벨(COPY_LEVEL_LABELS)을 넣어 원본에서 복사된 것이 아님을 가른다. 키워드는 원본에서 복사된다.
  const copyName = `E2E A-copy ${stamp}`
  const cp = await admin.action('/projects', 'createProject', [{ workspaceId: wsA, name: copyName, startDate: null, endDate: null, description: null,
    levelLabels: COPY_LEVEL_LABELS, copyFromProjectId: A.id, commandId: randomUUID() }])
  if (!cp.result?.ok) throw new Fail(`복사 생성 실패: ${JSON.stringify(cp.result)}`)
  const cpHist = rows('복사 이력', await admin.sb.from('project_settings_history').select('key,source,copied_from,changed_by,revision').eq('project_id', cp.result.projectId))
  if (!cpHist.length || cpHist.some((h) => h.source !== 'copy' || h.copied_from !== A.id || h.changed_by !== me.id || Number(h.revision) !== 1)) {
    throw new Fail(`복사 이력이 copy/copied_from A/행위자 본인/revision 1 이 아니다: ${JSON.stringify(cpHist)}`)
  }
  const cpSettings = rows('복사본 설정', await admin.sb.from('project_settings').select('values').eq('project_id', cp.result.projectId).single())
  same('복사본 단계 라벨(입력값)', cpSettings.values['core.level_labels'], COPY_LEVEL_LABELS)
  same('복사본 키워드(원본에서)', cpSettings.values['core.milestone_keywords'], ['kick-off', '오픈'])
  step('create-copy', { projectId: cp.result.projectId, from: A.id, levelLabels: cpSettings.values['core.level_labels'], historyKeys: cpHist.map((h) => h.key).sort() })

  // ── 3. 프로젝트 팀 — 설정 화면(ProjectTeamsManager)의 addProjectTeam. 부트스트랩은 팀을 만들지 않는다(Task 8).
  for (const p of [A, B]) await admin.http('GET', `/p/${p.id}/settings`)
  for (const [p, codes] of [[A, SP1_TEAMS.A], [B, SP1_TEAMS.B]]) {
    for (const code of codes) mustOk(`addProjectTeam(${code})`, (await admin.action(`/p/${p.id}/settings`, 'addProjectTeam', [p.id, code])).result)
  }
  const teamRows = rows('팀', await admin.sb.from('teams').select('id,code,project_id,workspace_id').in('project_id', [A.id, B.id]))
  if (teamRows.length !== SP1_TEAMS.A.length + SP1_TEAMS.B.length) throw new Fail(`프로젝트 팀이 ${teamRows.length}건`)
  if (teamRows.some((t) => t.workspace_id !== A.workspaceId)) throw new Fail('프로젝트 팀의 워크스페이스가 프로젝트와 다르다')
  const teamIds = { A: teamIdsByCode(teamRows, A.id, SP1_TEAMS.A), B: teamIdsByCode(teamRows, B.id, SP1_TEAMS.B) }
  step('project-teams', { A: SP1_TEAMS.A, B: SP1_TEAMS.B, rows: teamRows.length })

  // ── 4. 명단 — upsertRosterMember(RPC upsert_project_member 한 번). 본인 이름은 부트스트랩 프로필 그대로(개명하지 않게).
  const { data: profile, error: profErr } = await admin.sb.from('profiles').select('display_name').eq('user_id', me.id).single()
  if (profErr) throw new Fail(`프로필 조회 실패: ${profErr.message}`)
  const plan = rosterPlan({ selfName: profile.display_name, selfEmail: email, teamIds })
  for (const p of [A, B]) await admin.http('GET', `/p/${p.id}/members`)
  const upsert = async (p, input) => mustOk('upsertRosterMember', (await admin.action(`/p/${p.id}/members`, 'upsertRosterMember', [p.id, input])).result).memberId
  const selfA = await upsert(A, plan.selfA)
  const bobId = await upsert(A, plan.bob)
  const selfB = await upsert(B, plan.selfB)
  const roster = async (pid) => rosterView(rows('명단', await admin.sb.from('project_members').select(ROSTER_SELECT).eq('project_id', pid)))
  const rosterA = await roster(A.id)
  const rosterB = await roster(B.id)
  const byId = (view, id) => view.find((r) => r.memberId === id)
  same('A 명단 행 수', rosterA.length, 2)
  same('본인@A', byId(rosterA, selfA), { memberId: selfA, name: profile.display_name, email, accessRole: 'admin', linked: true, teams: [...SP1_TEAMS.A] })
  same('외부 인력 bob@A', byId(rosterA, bobId), { memberId: bobId, name: 'bob', email: null, accessRole: null, linked: false, teams: [] })
  same('B 명단', rosterB, [{ memberId: selfB, name: profile.display_name, email, accessRole: 'member', linked: true, teams: [...SP1_TEAMS.B] }])
  step('roster', { A: rosterA, B: rosterB, rows: rosterA.length + rosterB.length })

  // ── 5. A 에 WBS 임포트 — 양식 다운로드 → 행 채우기 → inspect → execute (ImportWizard 와 같은 폼 필드·기본값: append, saveProfile)
  const team = SP1_TEAMS.A[0]
  const template = Buffer.from(await (await admin.http('GET', '/api/import/template')).arrayBuffer())
  writeFileSync(join(outDir, 'wbs-template.xlsx'), template)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(template)
  const ws = wb.getWorksheet('WBS')
  if (!ws) throw new Fail("양식에 'WBS' 시트가 없다")
  const header = ws.getRow(1).values.slice(1)
  if (JSON.stringify(header) !== JSON.stringify(TEMPLATE_HEADER)) throw new Fail(`양식 헤더가 다르다: ${JSON.stringify(header)}`)
  // 예시 행 자리에 덮어쓰고 남는 예시 행은 비운다(spliceRows 는 SheetJS 가 쓴 시트에서 행을 지우지 못했다 — 2026-09-24 실측).
  const wbsRows = e2eRows(team)
  const lastExample = ws.rowCount
  wbsRows.forEach((r, i) => { ws.getRow(i + 2).values = r.map(toCell) })
  for (let n = wbsRows.length + 2; n <= lastExample; n++) ws.getRow(n).values = []
  const filled = Buffer.from(await wb.xlsx.writeBuffer())
  const check = new ExcelJS.Workbook()
  await check.xlsx.load(filled)
  const written = check.getWorksheet('WBS').actualRowCount
  if (written !== wbsRows.length + 1) throw new Fail(`채운 양식의 WBS 시트가 ${written}행(기대 헤더+${wbsRows.length})`)
  writeFileSync(join(outDir, 'wbs-filled.xlsx'), filled)
  step('fill-template', { rows: wbsRows.length, team, file: join(outDir, 'wbs-filled.xlsx') })

  const inspected = await (await admin.http('POST', '/api/import/inspect', {
    body: inspectForm({ file: filled, fileName: 'wbs-filled.xlsx', projectId: A.id }),
  })).json()
  const profileDetected = inspected.detection.profile
  step('import-inspect', { hierarchy: profileDetected.hierarchy, teamColumns: profileDetected.teamColumns, warnings: inspected.detection.warnings })

  const execute = async (mode, commandId) => {
    // ImportWizard 와 같은 폼 필드·기본값(append, saveProfile)에 명령 id(스펙 §4.4 #1 — SP4 A1). 3 단계에서 만든 프로젝트 팀이 이미 있어야 한다 — 409(needsTeams)면 실패
    const form = importForm({ file: filled, fileName: 'wbs-filled.xlsx', projectId: A.id, profile: profileDetected, mode, commandId, saveProfile: true, registerTeams: false })
    try {
      return (await admin.http('POST', '/api/import/execute', { body: form })).json()
    } catch (e) {
      // 가져오기 라우트의 팀 대조는 요청 범위 원천(src/lib/teams/source.ts — 캐시 없음, SP4 A1)이다. 3 단계에서 만든 팀을 못 봤다면 결함이다 —
      // 재시도로 덮지 않는다.
      if (e instanceof Fail && e.message.includes('→ 409') && e.message.includes('needsTeams')) {
        throw new Fail(`${e.message} — 가져오기 라우트가 3 단계에서 만든 프로젝트 팀을 못 봤다(요청 범위 팀 원천 — 캐시 없음). 결함으로 보고한다`)
      }
      throw e
    }
  }
  const importedItems = async () => {
    const data = rows('WBS', await admin.sb.from('wbs_items')
      .select('id,code,name,level_idx,assignee_member_id,item_owners(kind,teams(code))').eq('project_id', A.id).order('code'))
    if (data.length !== wbsRows.length) throw new Fail(`임포트 뒤 WBS 가 ${data.length}행(기대 ${wbsRows.length})`)
    const owned = data.filter((i) => i.item_owners.some((o) => o.teams?.code === team))
    const expectOwned = wbsRows.filter((r) => r.at(-1) === team).length
    if (owned.length !== expectOwned) throw new Fail(`팀 ${team} 담당 행이 ${owned.length}건(기대 ${expectOwned})`)
    return data
  }
  const appendCmd = randomUUID()
  const appended = await execute('append', appendCmd)
  if (appended.kind !== 'applied' || appended.commandId !== appendCmd) throw new Fail(`append 결과 종류·명령 id: ${JSON.stringify(importResultView(appended))}`)
  step('import-append', { commandId: appendCmd, response: appended, items: await importedItems() })

  // replace — 마법사처럼 실행 전에 사전 백업을 받는다(getWbsBackup — D50). 같은 파일로 트리를 통째로 갈아 끼운다. 사전 백업과 라우트 응답의 백업은
  // 교체 전 5행이어야 하고, 교체 뒤에도 5행이다(중복 없음). 명령 id 는 append 와 다른 새 의도다.
  await admin.http('GET', `/p/${A.id}/import`)
  const preBackup = mustOk('getWbsBackup', (await admin.action(`/p/${A.id}/import`, 'getWbsBackup', [A.id])).result).backup
  if (preBackup.rows.length !== wbsRows.length) throw new Fail(`사전 백업이 ${preBackup.rows.length}행(기대 ${wbsRows.length})`)
  const replaceCmd = randomUUID()
  const replaced = await execute('replace', replaceCmd)
  if (replaced.kind !== 'applied' || replaced.commandId !== replaceCmd) throw new Fail(`replace 결과 종류·명령 id: ${JSON.stringify(importResultView(replaced))}`)
  if (replaced.backup?.rows?.length !== wbsRows.length) throw new Fail(`replace 백업이 ${replaced.backup?.rows?.length}행(기대 ${wbsRows.length})`)
  const items = await importedItems()
  step('import-replace', {
    commandId: replaceCmd, preBackup: { rows: preBackup.rows.length, generatedAt: preBackup.generatedAt },
    response: { ...replaced, backup: { rows: replaced.backup.rows.length, generatedAt: replaced.backup.generatedAt } },
    items,
  })

  // ── 6. 외부 인력(계정 없음) bob 을 A 리프 담당으로 — WBS 담당 패널(WbsAssigneeStagePanel)의 setWbsAssignee.
  await admin.http('GET', `/p/${A.id}/wbs`)
  const leafCode = leafCodes(wbsRows)[0]
  const leaf = items.find((i) => i.code === leafCode)
  if (!leaf) throw new Fail(`리프 ${leafCode} 가 임포트 결과에 없다`)
  mustOk('setWbsAssignee', (await admin.action(`/p/${A.id}/wbs`, 'setWbsAssignee', [leaf.id, bobId])).result)
  const assigned = rows('담당', await admin.sb.from('wbs_items').select('id,code').eq('project_id', A.id).eq('assignee_member_id', bobId))
  same('bob 담당 항목', assigned.map((i) => i.code), [leafCode])
  step('assign-external', { itemId: leaf.id, itemCode: leafCode, memberId: bobId, rows: assigned.length })

  // ── 7. 회의 + 참석자 bob — 회의 화면(MeetingFormModal)의 createMeeting.
  await admin.http('GET', `/p/${A.id}/meetings`)
  const meetingDate = seoulToday()
  const meeting = mustOk('createMeeting', (await admin.action(`/p/${A.id}/meetings`, 'createMeeting', [A.id, meetingInput({ date: meetingDate, attendeeIds: [bobId] })])).result)
  const attendees = rows('참석자', await admin.sb.from('meeting_attendees').select('member_id,project_id').eq('meeting_id', meeting.id))
  same('회의 참석자', attendees, [{ member_id: bobId, project_id: A.id }])
  step('meeting', { meetingId: meeting.id, meetingDate, attendees: attendees.length })

  // ── 8. 내보내기 — 리포트 화면의 주간보고 PPT·엑셀, WBS 화면의 엑셀(담당·회의가 들어간 뒤의 A).
  const exports = [
    ['report-pptx', `/api/report?projectId=${A.id}&format=pptx`, 'report.pptx'],
    ['report-xlsx', `/api/report?projectId=${A.id}&format=xlsx`, 'report.xlsx'],
    ['wbs-xlsx', `/api/export?projectId=${A.id}`, 'wbs_export.xlsx'],
  ]
  for (const [kind, path, fallback] of exports) {
    const res = await admin.http('GET', path)
    const buf = Buffer.from(await res.arrayBuffer())
    const file = join(outDir, dispositionFilename(res.headers.get('content-disposition'), fallback))
    writeFileSync(file, buf)
    summary.artifacts.push({ kind, file, bytes: buf.length, contentType: res.headers.get('content-type') })
  }
  step('export', { files: summary.artifacts.map((a) => a.file) })

  // ── 9. 산출물 zip 의 모든 항목(XML·rels·docProps·미디어)을 UTF-8 로 풀어 흔적 검사.
  for (const a of summary.artifacts) {
    const zip = await JSZip.loadAsync(readFileSync(a.file))
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
    const entries = await Promise.all(names.map(async (name) => ({ name, text: await zip.file(name).async('string') })))
    const root = a.kind.endsWith('pptx') ? 'ppt/presentation.xml' : 'xl/workbook.xml'
    a.entries = names.length
    a.hasRoot = names.includes(root)
    a.traces = findTraces(entries)
    if (!a.hasRoot) throw new Fail(`${a.file} 에 ${root} 가 없다`)
  }
  const traced = summary.artifacts.filter((a) => a.traces.length)
  step('trace-scan', { entriesScanned: summary.artifacts.reduce((n, a) => n + a.entries, 0), hits: traced.length },
    traced.length ? `흔적 적중: ${JSON.stringify(traced.map((a) => ({ file: a.file, traces: a.traces })))}` : undefined)

  // ── 10. 초대 발급 — 명단 화면(ProjectInviteManager)의 createProjectInvite. 토큰은 응답 url 에만 있다(DB 는 해시).
  const invite = mustOk('createProjectInvite', (await admin.action(`/p/${A.id}/members`, 'createProjectInvite', [A.id, inviteInput([teamIds.A[0]])])).result)
  if (invite.alreadyAccount !== false) {
    throw new Fail(`${INVITEE.email} 계정 존재 여부가 ${invite.alreadyAccount} — 깨끗한 DB 에서 돌린다(npm run db:reset && npm run dev:bootstrap)`)
  }
  const token = inviteTokenFromUrl(invite.url, base)
  const invites = rows('초대', await svc.from('project_invites').select('id,email,access_role,redeemed_at').eq('project_id', A.id))
  same('A 초대', invites.map(({ id, email: e, access_role, redeemed_at }) => ({ id, email: e, access_role, redeemed_at })),
    [{ id: invite.row.id, email: INVITEE.email, access_role: 'member', redeemed_at: null }])
  step('invite-issue', {
    inviteId: invite.row.id, email: invite.row.email, accessRole: invite.row.accessRole, teamCodes: invite.row.teamCodes,
    status: invite.row.status, urlOrigin: new URL(invite.url).origin, mailed: invite.mailed, mailError: invite.mailError ?? null, rows: invites.length,
  })

  // ── 11. 새 세션(쿠키 없음)으로 가입+합류 — 초대 화면(InviteRedeemCard)의 redeemInviteWithSignup. 비밀번호는 실행마다 새로(출력하지 않는다).
  const carol = session('carol')
  await carol.http('GET', `/invite/${token}`)
  const carolPassword = `E2E-${randomUUID()}`
  const redeemed = mustOk('redeemInviteWithSignup', (await carol.action(`/invite/${token}`, 'redeemInviteWithSignup', [token, signupInput(INVITEE.name, carolPassword)])).result)
  same('합류 결과', { projectId: redeemed.projectId, email: redeemed.email }, { projectId: A.id, email: INVITEE.email })
  const rosterA2 = await roster(A.id)
  const carolRow = rosterA2.find((r) => r.email === INVITEE.email)
  same('A 명단 행 수(합류 뒤)', rosterA2.length, 3)
  if (!carolRow) throw new Fail(`합류했는데 A 명단에 ${INVITEE.email} 가 없다`)
  const { memberId: carolMemberId, ...carolView } = carolRow
  same('carol@A', carolView, { name: INVITEE.name, email: INVITEE.email, accessRole: 'member', linked: true, teams: [SP1_TEAMS.A[0]] })
  const consumed = rows('초대', await svc.from('project_invites').select('redeemed_at').eq('id', invite.row.id))
  if (!consumed[0]?.redeemed_at) throw new Fail('합류했는데 초대가 소비되지 않았다')
  step('invite-redeem', { projectId: redeemed.projectId, memberId: carolMemberId, teams: carolView.teams, redeemedAt: consumed[0].redeemed_at, rows: rosterA2.length })

  // ── 12. 워크스페이스 B — 존재 은닉 대조군이자 2-워크스페이스 흐름의 상대편. 워크스페이스를 만드는 화면은 SP3 몫이라 행만
  // service_role 로 만든다(로컬 전용). 그 안의 프로젝트 C 와 B 관리자 bea 는 앱 경로로 — 플랫폼 관리자는 소속 없는 워크스페이스에도
  // createProject·createAccount 를 쓸 수 있다(워크스페이스 관리 가드가 플랫폼 관리자를 통과시킨다). 손으로 행을 넣으면 계정의
  // profiles·people·workspace_members 가 앱 불변식과 어긋날 수 있다.
  const { data: otherWs, error: owErr } = await svc.from('workspaces')
    .upsert({ slug: OTHER_WORKSPACE.slug, name: OTHER_WORKSPACE.name }, { onConflict: 'slug' }).select('id').single()
  if (owErr) throw new Fail(`타 워크스페이스 픽스처 실패: ${owErr.message}`)
  const wsB = otherWs.id
  // B 의 허용 모듈 — 생성 화면(Phase C)이 없어 service_role RPC 로 기록한다(Phase C 가 updateWorkspaceSettings 로 바꾼다). 없으면 B 에서 모듈이 전부 닫힌다(Phase B 뒤).
  {
    const { data: wsRow, error: wsErr } = await svc.from('workspace_settings').select('revision').eq('workspace_id', wsB).single()
    if (wsErr) throw new Fail(`B 설정 행 조회 실패: ${wsErr.message}`)
    const { error: aErr } = await svc.rpc('apply_workspace_settings', { p_workspace_id: wsB, p_expected_revision: wsRow.revision, p_command_id: randomUUID(),
      p_set: { 'modules.allowed': [...BOOTSTRAP_MODULE_IDS] },   // 비core 13 — 목록은 bootstrap-modules.mjs 한 곳(레지스트리 대조 테스트)
      p_unset: [], p_actor: me.id, p_schema_version: SCRIPT_SCHEMA_VERSION, p_source: 'internal' })
    if (aErr) throw new Fail(`B modules.allowed 기록 실패: ${aErr.message}`)
  }
  const C = await createProject(admin, wsB, 'C')
  await admin.http('GET', '/admin/accounts')
  const createWorkspaceAdmin = async (workspaceId, who, pass) => {
    mustOk(`createAccount(${who.name})`, (await admin.action('/admin/accounts', 'createAccount',
      [workspaceAdminAccountInput({ workspaceId, email: who.email, name: who.name, password: pass })])).result)
    return membershipOf(who.email)
  }
  const beaWs = await createWorkspaceAdmin(wsB, B_ADMIN, bPassword)
  same('bea 의 워크스페이스 소속', beaWs.memberships, [{ workspace_id: wsB, role: 'admin' }])
  if (beaWs.platformAdmin) throw new Fail('bea 가 플랫폼 관리자다 — 워크스페이스 경계 시험이 비어 버린다')
  step('other-workspace-fixture', {
    via: 'workspaces 행과 modules.allowed 만 service_role(로컬 전용 — 생성·설정 화면은 SP3), 프로젝트는 createProject(B, …), 관리자는 createAccount({ workspaceId: B })',
    workspace: OTHER_WORKSPACE.slug, workspaceId: wsB, projectId: C.id, projectName: C.name,
    bAdmin: { email: B_ADMIN.email, userId: beaWs.userId, memberships: beaWs.memberships, platformAdmin: beaWs.platformAdmin },
  })

  // ── 13. carol 로그인 — A 는 명단 멤버, B 는 같은 워크스페이스라 조회 전용(스펙 2.4.1 '그 외 워크스페이스 멤버 → viewer':
  // 화면은 열리고 쓰기는 거부), C(타 워크스페이스)·미존재 id 는 똑같이 not-found(존재 은닉). 관리자(플랫폼 관리자)는 C 를 본다 —
  // not-found 가 부재가 아니라 은닉이라는 대조. (app)/loading.tsx 스트리밍 때문에 은닉돼도 HTTP 상태는 200 일 수 있어
  // 은닉 판정은 실제 HTTP 404 또는 notFound() digest 다(어느 신호였는지 기록). 열려야 하는 화면은 pageProblems 로 본다 —
  // 스트리밍된 오류 digest·열화 표시가 없고, 그 페이지 세그먼트만 그리는 문구(WBS 히어로 제목, A 는 리프명)가 있어야 한다.
  // 프로젝트 이름만으로는 안 된다: 레이아웃 사이드바가 볼 수 있는 프로젝트를 모든 화면에 싣는다.
  // 은닉된 화면에 그 프로젝트 이름이 실리면 실패다 — SP1 은 projects·read_all_* 읽기 정책이 개방이라 기록만 했고, SP2(0006)가 닫았다.
  const carolUser = await carol.login(INVITEE.email, carolPassword)
  const missing = randomUUID()
  const see = async (who, label, pid, name, { hidden = false, expectTexts = [], page = 'wbs' } = {}) => {
    const path = `/p/${pid}/${page}`
    const res = await who.http('GET', path, { expect: hidden ? [200, 404] : 200 })
    const html = await res.text()
    const digest = notFoundRendered(html)
    const entry = {
      who: who.label, project: label, path, status: res.status,
      notFound: res.status === 404 || digest, notFoundSignal: res.status === 404 ? 'http-404' : digest ? 'digest' : null,
      projectNameInHtml: name ? html.includes(name) : null,
      ...(hidden ? {} : { expect: expectTexts, problems: pageProblems(html, expectTexts) }),
    }
    if (entry.notFound !== hidden) throw new Fail(`${who.label} ${label} 화면: notFound=${entry.notFound}(기대 ${hidden})`)
    if (hidden && entry.projectNameInHtml) throw new Fail(`${who.label} ${label} 화면: 은닉된 프로젝트 이름이 HTML 에 실렸다`)
    if (!hidden && entry.problems.length) throw new Fail(`${who.label} ${label} 화면 문제: ${entry.problems.join(', ')}`)
    return entry
  }
  const wbsTitle = (name) => `${name} WBS · 간트` // wbs/page.tsx 히어로 — 페이지 세그먼트만 그린다(i18n wbs.heroTitleSuffix)
  const visibility = []
  visibility.push(await see(carol, 'A(명단 멤버)', A.id, A.name, { expectTexts: [wbsTitle(A.name), leaf.name] }))
  visibility.push(await see(carol, 'B(같은 워크스페이스, 명단 없음)', B.id, B.name, { expectTexts: [wbsTitle(B.name)] }))
  const denied = (await carol.action(`/p/${B.id}/meetings`, 'createMeeting', [B.id, meetingInput({ date: meetingDate, attendeeIds: [] })])).result
  same('carol 의 B 회의 생성', denied, { ok: false, error: ERR_DENIED })
  const bMeetings = rows('B 회의', await admin.sb.from('meetings').select('id').eq('project_id', B.id))
  same('B 회의 수', bMeetings.length, 0)
  visibility.push({ who: 'carol', project: 'B(같은 워크스페이스, 명단 없음)', action: 'createMeeting', result: denied, bMeetings: bMeetings.length })
  visibility.push(await see(carol, 'C(워크스페이스 B)', C.id, C.name, { hidden: true }))
  visibility.push(await see(carol, '미존재 id', missing, null, { hidden: true }))
  visibility.push(await see(admin, 'C(워크스페이스 B)', C.id, C.name, { expectTexts: [wbsTitle(C.name)] }))
  step('visibility', { carolUserId: carolUser.id, checks: visibility })

  // ── 14. A 관리자 ana(플랫폼 관리자 아님) — 부트스트랩 계정이 createAccount({ workspaceId: A }) 로 만든다. ana 가 createProject(A, …)
  // 로 E2E A2 를 만든다: 워크스페이스 관리 가드(requireWorkspaceAdmin)를 플랫폼 관리자 우회 없이 통과하는 경로다.
  const anaPassword = `E2E-${randomUUID()}`
  const anaWs = await createWorkspaceAdmin(wsA, A_ADMIN, anaPassword)
  same('ana 의 워크스페이스 소속', anaWs.memberships, [{ workspace_id: wsA, role: 'admin' }])
  if (anaWs.platformAdmin) throw new Fail('ana 가 플랫폼 관리자다 — 워크스페이스 관리 가드를 우회한다')
  const ana = session('ana')
  await ana.login(A_ADMIN.email, anaPassword)
  await ana.http('GET', '/projects')
  const A2 = await createProject(ana, wsA, 'A2')
  step('workspace-admin-project', {
    aAdmin: { email: A_ADMIN.email, userId: anaWs.userId, memberships: anaWs.memberships, platformAdmin: anaWs.platformAdmin },
    path: `server action createProject(${A2.actionId.slice(0, 12)}…) via POST /projects as ana`,
    projectId: A2.id, projectName: A2.name, workspaceId: A2.workspaceId,
  })

  // ── 15. ana 가 A2 에 외부 이메일을 멤버로 초대 → 새 세션으로 가입·합류 → 그 계정의 워크스페이스 소속은 A 하나뿐(service_role 로 확인).
  // 합류한 계정으로 A2 는 열리고 워크스페이스 B 의 C 는 not-found.
  await ana.http('GET', `/p/${A2.id}/members`)
  const oInvite = mustOk('createProjectInvite(outsider)',
    (await ana.action(`/p/${A2.id}/members`, 'createProjectInvite', [A2.id, inviteInput([], OUTSIDER.email)])).result)
  if (oInvite.alreadyAccount !== false) throw new Fail(`${OUTSIDER.email} 계정 존재 여부가 ${oInvite.alreadyAccount} — 깨끗한 DB 에서 돌린다`)
  const oToken = inviteTokenFromUrl(oInvite.url, base)
  const outsider = session('outsider')
  await outsider.http('GET', `/invite/${oToken}`)
  const outsiderPassword = `E2E-${randomUUID()}`
  const oRedeemed = mustOk('redeemInviteWithSignup(outsider)',
    (await outsider.action(`/invite/${oToken}`, 'redeemInviteWithSignup', [oToken, signupInput(OUTSIDER.name, outsiderPassword)])).result)
  same('outsider 합류 결과', { projectId: oRedeemed.projectId, email: oRedeemed.email }, { projectId: A2.id, email: OUTSIDER.email })
  const outsiderWs = await membershipOf(OUTSIDER.email)
  same('outsider 의 워크스페이스 소속', outsiderWs.memberships, [{ workspace_id: wsA, role: 'member' }])
  const outsiderRow = (await roster(A2.id)).find((r) => r.email === OUTSIDER.email)
  if (!outsiderRow) throw new Fail(`합류했는데 A2 명단에 ${OUTSIDER.email} 가 없다`)
  same('outsider@A2 권한', { accessRole: outsiderRow.accessRole, linked: outsiderRow.linked }, { accessRole: 'member', linked: true })
  await outsider.login(OUTSIDER.email, outsiderPassword)
  const outsiderChecks = [
    await see(outsider, 'A2(초대받은 프로젝트)', A2.id, A2.name, { expectTexts: [wbsTitle(A2.name)] }),
    await see(outsider, 'C(워크스페이스 B)', C.id, C.name, { hidden: true }),
  ]
  step('outsider-invite', {
    inviteId: oInvite.row.id, email: OUTSIDER.email, userId: outsiderWs.userId, projectId: oRedeemed.projectId,
    memberships: outsiderWs.memberships, platformAdmin: outsiderWs.platformAdmin, checks: outsiderChecks, rows: outsiderWs.memberships.length,
  })

  // ── 16. 회의록 업로드(프로젝트 지정·미지정 각 1건) — 화면(MinuteUploadModal)과 같은 순서: 회의록 id 선발급 → 본문 .md 를 세션으로
  // Storage 에 올림(스토리지 RLS 가 판정) → createMinute(입력, 폴더 null, source). 올린 사람은 ana(플랫폼 관리자 아님).
  // 미지정 회의록의 담당은 그 워크스페이스의 공용 팀이어야 한다 — 부트스트랩은 팀을 만들지 않으므로 공용 팀 하나를 addTeam(A, …) 으로
  // 만든다(팀 관리 화면은 아직 플랫폼 관리자 전용 — ws 관리자 화면은 SP3). Storage 객체 이름이 전부 ws/<A>/p/… 여야 한다.
  await admin.http('GET', '/admin/teams')
  mustOk(`addTeam(${WS_TEAM})`, (await admin.action('/admin/teams', 'addTeam', [wsA, WS_TEAM])).result)
  await ana.http('GET', '/minutes')
  const upload = async (label, projectId, teamCode) => {
    const minuteId = randomUUID()
    const title = `E2E-MIN-${label}-${stamp}`
    const bodyMd = `# ${title}\n\n- E2E 회의록 본문(${label})\n`
    const fileName = `e2e-${label.toLowerCase()}.md`
    const filePath = minuteBodyPath({ workspaceId: wsA, projectId, minuteId, fileName })
    const body = Buffer.from(bodyMd, 'utf8')
    const up = await ana.sb.storage.from('minutes').upload(filePath, body, { contentType: 'text/markdown', upsert: false })
    if (up.error) throw new Fail(`회의록 본문 업로드 실패(${label}): ${up.error.message}`)
    const created = mustOk(`createMinute(${label})`, (await ana.action('/minutes', 'createMinute', [
      minuteInput({ date: meetingDate, teamCode, title, bodyMd, projectId }), null, minuteSource({ minuteId, fileName, filePath, size: body.length }),
    ])).result)
    same(`createMinute(${label}) id`, created.id, minuteId)
    return { label, minuteId, title, projectId, teamCode, filePath, fileName }
  }
  const minutes = [await upload('PROJECT', A.id, SP1_TEAMS.A[0]), await upload('NOPROJECT', null, WS_TEAM)]
  const minuteIds = minutes.map((m) => m.minuteId)
  const minuteRows = rows('회의록', await svc.from('minutes').select('id,workspace_id,project_id,team_code').in('id', minuteIds))
  const fileRows = rows('회의록 파일', await svc.from('minute_files').select('minute_id,role,file_path').in('minute_id', minuteIds))
  const storageChecks = []
  for (const m of minutes) {
    const row = minuteRows.find((r) => r.id === m.minuteId)
    same(`회의록 ${m.label} 범위`, row && { workspace_id: row.workspace_id, project_id: row.project_id, team_code: row.team_code },
      { workspace_id: wsA, project_id: m.projectId, team_code: m.teamCode })
    const files = fileRows.filter((f) => f.minute_id === m.minuteId)
    same(`회의록 ${m.label} 파일`, files.map((f) => ({ role: f.role, file_path: f.file_path })), [{ role: 'body', file_path: m.filePath }])
    const dir = m.filePath.slice(0, m.filePath.lastIndexOf('/'))
    const { data: listed, error: lErr } = await svc.storage.from('minutes').list(dir)
    if (lErr) throw new Fail(`Storage 목록 조회 실패(${m.label}): ${lErr.message}`)
    const objectNames = (listed ?? []).map((o) => `${dir}/${o.name}`)
    same(`회의록 ${m.label} Storage 객체`, objectNames, [m.filePath])
    if (!objectNames.every((n) => inWorkspaceStorage(n, wsA))) throw new Fail(`회의록 ${m.label} 객체가 ws/<A>/p/… 규약 경로가 아니다: ${objectNames}`)
    storageChecks.push({ label: m.label, minuteId: m.minuteId, projectId: m.projectId, objects: objectNames, prefix: `ws/${wsA}/p/${m.projectId ?? '_'}/` })
  }
  // 버킷 최상위는 'ws' 하나 — 옛 형식(<minuteId>/… 등) 객체가 없다.
  const { data: top, error: topErr } = await svc.storage.from('minutes').list('')
  if (topErr) throw new Fail(`Storage 최상위 목록 조회 실패: ${topErr.message}`)
  same('minutes 버킷 최상위', (top ?? []).map((o) => o.name), ['ws'])
  step('minutes-upload', { uploader: 'ana', workspaceTeam: WS_TEAM, minutes: storageChecks, bucketTop: ['ws'], rows: minutes.length })

  // ── 17. bea(워크스페이스 B 관리자) 로그인 — A 의 프로젝트 URL 은 not-found(존재 은닉), 자기 워크스페이스의 C 는 열린다.
  // 회의록 목록·프로젝트 목록 HTML(SSR·RSC 페이로드)에 A 의 회의록 제목·프로젝트 이름이 없다(대조: ana 의 회의록 목록에는 있다).
  // A 경로로의 Storage 쓰기·A 객체 읽기는 스토리지 RLS 가 거부한다.
  const bea = session('bea')
  await bea.login(B_ADMIN.email, bPassword)
  const beaChecks = [
    await see(bea, 'A2(워크스페이스 A)', A2.id, A2.name, { hidden: true }),
    await see(bea, 'A(워크스페이스 A) 대시보드', A.id, A.name, { hidden: true, page: 'dashboard' }),
    await see(bea, 'C(자기 워크스페이스)', C.id, C.name, { expectTexts: [wbsTitle(C.name)] }),
  ]
  const titles = minutes.map((m) => m.title)
  const aNames = [A.name, B.name, A2.name]
  const beaMinutesHtml = await (await bea.http('GET', '/minutes')).text()
  const anaMinutesHtml = await (await ana.http('GET', '/minutes')).text()
  const beaProjectsHtml = await (await bea.http('GET', '/projects')).text()
  const lists = {
    beaMinutes: { problems: pageProblems(beaMinutesHtml), aTitles: presentTexts(beaMinutesHtml, titles), aProjectNames: presentTexts(beaMinutesHtml, aNames) },
    anaMinutes: { problems: pageProblems(anaMinutesHtml), aTitles: presentTexts(anaMinutesHtml, titles) },
    beaProjects: { problems: pageProblems(beaProjectsHtml, [`/p/${C.id}/dashboard`]), aProjectNames: presentTexts(beaProjectsHtml, aNames) },
  }
  if (lists.beaMinutes.problems.length || lists.anaMinutes.problems.length || lists.beaProjects.problems.length) {
    throw new Fail(`목록 화면 문제: ${JSON.stringify(lists)}`)
  }
  same('bea 회의록 목록의 A 회의록 제목', lists.beaMinutes.aTitles, [])
  same('bea 회의록 목록의 A 프로젝트 이름', lists.beaMinutes.aProjectNames, [])
  same('ana 회의록 목록의 A 회의록 제목(대조)', lists.anaMinutes.aTitles, titles)
  same('bea 프로젝트 목록의 A 프로젝트 이름', lists.beaProjects.aProjectNames, [])
  // Storage — A 워크스페이스 경로로 쓰기(무프로젝트 자리, 새 회의록 id)와 A 의 실제 객체 읽기.
  const probePath = minuteBodyPath({ workspaceId: wsA, projectId: null, minuteId: randomUUID(), fileName: 'e2e-bea-probe.md' })
  const beaUp = await bea.sb.storage.from('minutes').upload(probePath, Buffer.from('# probe\n'), { contentType: 'text/markdown', upsert: false })
  const beaDown = await bea.sb.storage.from('minutes').download(minutes[0].filePath)
  const storage = { upload: beaUp.error ? `거부: ${beaUp.error.message}` : 'ok', download: beaDown.error ? `거부: ${beaDown.error.message || beaDown.error.name}` : 'ok' }
  if (!beaUp.error) throw new Fail('bea 가 워크스페이스 A 경로에 Storage 객체를 올렸다')
  if (!beaDown.error) throw new Fail('bea 가 워크스페이스 A 의 회의록 본문 파일을 내려받았다')
  const { data: probeListed, error: probeErr } = await svc.storage.from('minutes').list(probePath.slice(0, probePath.lastIndexOf('/')))
  if (probeErr) throw new Fail(`Storage 목록 조회 실패(probe): ${probeErr.message}`)
  same('거부된 업로드의 객체', (probeListed ?? []).length, 0)
  step('workspace-b-isolation', { bea: beaChecks, lists, storage })

  // ── 17b. SP3a C — 워크스페이스 설정 화면의 경계. A 에만 속한 ana(워크스페이스 A 관리자, 플랫폼 관리자 아님)가 B 의 설정 화면을 열면
  // not-found(존재 은닉 — 상태 코드가 아니라 notFound() digest 로도 판정, 이름이 HTML 에 실리면 실패)이고, 자기 워크스페이스 화면은 열리되
  // 플랫폼 관리자 전용 구역(modules.allowed)이 없다. 플랫폼 관리자는 B 화면을 열고 그 구역을 본다(대조 — 은닉이 부재가 아니라는 근거).
  const [wsARow] = rows('워크스페이스 A 이름·슬러그', await svc.from('workspaces').select('slug, name').eq('id', wsA))
  const wsSettings = async (who, slug, wsName, { hidden }) => {
    const path = `/w/${encodeURIComponent(slug)}/settings`
    const res = await who.http('GET', path, { expect: hidden ? [200, 404] : 200 })
    const html = await res.text()
    const digest = notFoundRendered(html)
    const entry = {
      who: who.label, path, status: res.status, notFound: res.status === 404 || digest,
      notFoundSignal: res.status === 404 ? 'http-404' : digest ? 'digest' : null,
      nameInHtml: html.includes(wsName),
      // 구역의 유무는 편집기 전용 문구로 본다 — 키 이름은 '기록' 범주의 변경 이력에도 나온다(부트스트랩이 modules.allowed 를 썼다).
      modulesAllowedInHtml: html.includes('프로젝트 관리자가 켤 수 있는 모듈을 고릅니다'),
      ...(hidden ? {} : { problems: pageProblems(html, [`${wsName} 설정`]) }),
    }
    if (entry.notFound !== hidden) throw new Fail(`${who.label} ${path}: notFound=${entry.notFound}(기대 ${hidden})`)
    if (hidden && entry.nameInHtml) throw new Fail(`${who.label} ${path}: 은닉된 워크스페이스 이름이 HTML 에 실렸다`)
    if (!hidden && entry.problems.length) throw new Fail(`${who.label} ${path} 화면 문제: ${entry.problems.join(', ')}`)
    return entry
  }
  const wsSettingsChecks = [
    await wsSettings(ana, OTHER_WORKSPACE.slug, OTHER_WORKSPACE.name, { hidden: true }),
    await wsSettings(ana, wsARow.slug, wsARow.name, { hidden: false }),
    await wsSettings(bea, wsARow.slug, wsARow.name, { hidden: true }),
    await wsSettings(admin, OTHER_WORKSPACE.slug, OTHER_WORKSPACE.name, { hidden: false }),
  ]
  if (wsSettingsChecks[1].modulesAllowedInHtml) throw new Fail('플랫폼 관리자가 아닌 ana 의 설정 화면에 모듈 허용 구역이 있다')
  if (!wsSettingsChecks[3].modulesAllowedInHtml) throw new Fail('플랫폼 관리자의 설정 화면에 모듈 허용 구역이 없다')
  step('workspace-settings-boundary', { checks: wsSettingsChecks })

  // ── 17c. SP3a D — 관리 화면의 권한 변경이 행위자·명령 id 와 함께 이력에 남고 관리자가 읽는다(스펙 §7.3 의 8단계).
  // 플랫폼 관리자(admin)가 setWorkspaceRole(A, ana, member) → 다시 admin 으로 되돌린다. 화면이 부르는 같은 서버 액션이다.
  // 이력은 DB(권한 RPC 안의 트리거가 쓴다)와 listAuthzEvents(화면의 읽기)로 둘 다 본다. 직접 쓰기 길은 없다.
  await admin.http('GET', `/admin/accounts?project=${A.id}`, { expect: [200, 404] })
  await admin.http('GET', `/w/${encodeURIComponent(wsARow.slug)}/settings`)
  const flip = async (role) => mustOk(`setWorkspaceRole(${role})`, (await admin.action('/admin/accounts', 'setWorkspaceRole', [wsA, anaWs.userId, role])).result)
  await flip('member'); await flip('admin')
  const events = rows('권한 이력', await svc.from('authz_events').select('id, kind, workspace_id, target_user_id, before, after, cause, actor_user_id, command_id')
    .eq('kind', 'workspace_role').eq('workspace_id', wsA).eq('target_user_id', anaWs.userId).eq('actor_user_id', me.id).order('id', { ascending: false }).limit(2))
  same('이력 행 수(되돌림 + 변경)', events.length, 2)
  same('되돌림(최신)의 전·후', [events[0].before, events[0].after], [{ role: 'member' }, { role: 'admin' }])
  same('변경의 전·후', [events[1].before, events[1].after], [{ role: 'admin' }, { role: 'member' }])
  for (const e of events) {
    if (e.cause !== 'direct') throw new Fail(`권한 이력의 원인이 direct 가 아니다: ${e.cause}`)
    if (!e.command_id) throw new Fail('권한 이력에 명령 id 가 없다')
  }
  if (events[0].command_id === events[1].command_id) throw new Fail('두 호출이 같은 명령 id 를 썼다')
  const listed = (await admin.action(`/w/${wsARow.slug}/settings`, 'listAuthzEvents', [wsA])).result
  if (!listed?.ok) throw new Fail(`listAuthzEvents 실패: ${JSON.stringify(listed)}`)
  const flipRows = listed.rows.filter((r) => r.kind === 'workspace_role').slice(0, 2)
  same('화면 목록의 요약', flipRows.map((r) => r.summary), ['멤버 → 관리자', '관리자 → 멤버'])
  if (flipRows.some((r) => r.actorName === '삭제된 계정' || r.actorName === '시스템')) throw new Fail(`행위자 이름이 비었다: ${JSON.stringify(flipRows)}`)
  step('authz-events', { rows: events.map((e) => ({ id: e.id, before: e.before, after: e.after, cause: e.cause, hasCommandId: !!e.command_id })), listed: flipRows })

  // ── 18. 외부 회의록 API(시크릿 + user_email) — meta 의 projects·목록의 items 가 그 사람의 워크스페이스로만 좁혀진다.
  // A 관리자(ana)·A 에 초대된 외부 계정은 C 를 못 보고, B 관리자(bea)는 C 만 본다. 플랫폼 관리자는 전부 본다(대조 — 음성 판정이
  // 비어 있지 않다는 근거). 모르는 이메일은 403 unknown_user, 볼 수 없는 프로젝트의 회의 목록은 404.
  const api = async (path, expect = 200) => {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${minutesApiSecret}` }, redirect: 'manual' })
    const body = await res.json().catch(() => null)
    if (res.status !== expect) throw new Fail(`GET ${path} → ${res.status}(기대 ${expect}): ${JSON.stringify(body)?.slice(0, 300)}`)
    return body
  }
  const meta = async (who) => {
    const body = await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent(who)}`)
    if (!Array.isArray(body?.projects) || !Array.isArray(body?.teams)) throw new Fail(`meta(${who}) 응답 형식: ${JSON.stringify(body)?.slice(0, 300)}`)
    return { projectIds: body.projects.map((p) => p.id), teams: body.teams }
  }
  const listTitles = async (who) => {
    const body = await api(`/api/v1/minutes?user_email=${encodeURIComponent(who)}&per_page=100`)
    if (!Array.isArray(body?.items)) throw new Fail(`목록(${who}) 응답 형식: ${JSON.stringify(body)?.slice(0, 300)}`)
    return body.items.map((i) => i.title)
  }
  const aIds = [A.id, B.id, A2.id]
  const metas = { ana: await meta(A_ADMIN.email), outsider: await meta(OUTSIDER.email), bea: await meta(B_ADMIN.email), platformAdmin: await meta(email) }
  const api18 = {
    meta: {
      ana: { projectIds: metas.ana.projectIds, leaked: leakedIds(metas.ana.projectIds, [C.id]), teams: metas.ana.teams },
      outsider: { projectIds: metas.outsider.projectIds, leaked: leakedIds(metas.outsider.projectIds, [C.id]) },
      bea: { projectIds: metas.bea.projectIds, leaked: leakedIds(metas.bea.projectIds, aIds), teams: metas.bea.teams },
      platformAdmin: { sees: leakedIds(metas.platformAdmin.projectIds, [...aIds, C.id]).sort() },
    },
    list: { ana: presentTexts((await listTitles(A_ADMIN.email)).join('\n'), titles), bea: presentTexts((await listTitles(B_ADMIN.email)).join('\n'), titles) },
  }
  same('ana meta 의 B 프로젝트', api18.meta.ana.leaked, [])
  same('outsider meta 의 B 프로젝트', api18.meta.outsider.leaked, [])
  same('bea meta 의 A 프로젝트', api18.meta.bea.leaked, [])
  same('bea meta 프로젝트', metas.bea.projectIds, [C.id])
  if (leakedIds(metas.ana.projectIds, aIds).length !== aIds.length) throw new Fail(`ana meta 에 A 프로젝트가 빠졌다: ${metas.ana.projectIds}`)
  if (!metas.outsider.projectIds.includes(A2.id)) throw new Fail('outsider meta 에 초대받은 A2 가 없다')
  if (!metas.ana.teams.includes(WS_TEAM)) throw new Fail(`ana meta 팀에 A 공용 팀 ${WS_TEAM} 이 없다: ${metas.ana.teams}`)
  if (metas.bea.teams.includes(WS_TEAM)) throw new Fail(`bea meta 팀에 A 공용 팀 ${WS_TEAM} 이 실렸다`)
  same('플랫폼 관리자 meta(대조 — 전 워크스페이스)', api18.meta.platformAdmin.sees, [...aIds, C.id].sort())
  same('ana 목록의 A 회의록(대조)', api18.list.ana, titles)
  same('bea 목록의 A 회의록', api18.list.bea, [])
  const unknown = await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent('e2e-nobody@example.com')}`, 403)
  same('모르는 이메일', unknown?.code, 'unknown_user')
  const hiddenMeetings = await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent(B_ADMIN.email)}&project_id=${A2.id}`, 404)
  step('minutes-api-scope', { ...api18, unknownUser: { status: 403, code: unknown.code }, beaMeetingsOfA2: { status: 404, body: hiddenMeetings } })

  // ── 18b. SP4 A1(스펙 §6.3 — 단계는 이름으로 부른다, Q7). render-pages 앞이다 — 그 단계가 B 의 주간·설정 화면을 영역이 든 상태로 렌더한다.
  //    주 키는 앱이 정한다(mondayIso — W30): 러너는 날짜(오늘·±7일)를 넘기고 week_start 는 DB 에서 다시 읽는다.
  const today = seoulToday()
  const { exp, run, fresh } = E2E_AREAS
  const bTeam = { code: SP1_TEAMS.B[0], id: teamIds.B[0] }
  const weeklyRowsOf = async (reportId) => rows('주간 행', await admin.sb.from('weekly_report_rows')
    .select('id, area_id, this_content, this_issue, next_content, next_issue').eq('report_id', reportId).order('id'))
  const weekStartOf = async (reportId) => rows('주간 문서', await admin.sb.from('weekly_reports').select('week_start').eq('id', reportId).single()).week_start
  const rowFor = (list, areaId) => {
    const r = list.find((x) => x.area_id === areaId)
    if (!r) throw new Fail(`영역 ${areaId} 의 주간 행이 없다`)
    return r
  }
  const createWeek = async (p, dateIso, carry, mapping) => (await admin.action(`/p/${p.id}/weekly`, 'createWeeklyReport',
    mapping === undefined ? [p.id, dateIso, carry] : [p.id, dateIso, carry, mapping])).result
  const saveCells = async (p, edits) => mustOk('saveWeeklyCells', (await admin.action(`/p/${p.id}/weekly`, 'saveWeeklyCells', [p.id, edits])).result)
  const putArea = async (p, input) => mustOk(`upsertArea(${input.code})`, (await admin.action(`/p/${p.id}/settings`, 'upsertArea', [p.id, input])).result)
  const fetchZip = async (path, file) => {
    const buf = Buffer.from(await (await admin.http('GET', path)).arrayBuffer())
    writeFileSync(join(outDir, file), buf)
    return { path, file, bytes: buf.length, entries: await zipTextParts(buf) }
  }

  // weekly-areas-required — B(SP1 팀 하나, 사용자 정의 이름만)에 주간 영역이 0개면 문서를 만들지 않는다(W1·W14)
  await admin.http('GET', `/p/${B.id}/weekly`)
  const bAreas0 = rows('B 주간 영역', await admin.sb.from('project_areas').select('id').eq('project_id', B.id).eq('kind', 'weekly_section'))
  const required = await createWeek(B, today, false)
  const bDocs0 = rows('B 주간 문서', await admin.sb.from('weekly_reports').select('id').eq('project_id', B.id))
  step('weekly-areas-required', { projectId: B.id, team: bTeam.code, areasBefore: bAreas0.length, result: required, documents: bDocs0.length },
    bAreas0.length !== 0 || required?.ok !== false || required.code !== 'CONFIG_REQUIRED' || bDocs0.length !== 0
      ? `영역 0개의 주간 생성: ${JSON.stringify({ areas: bAreas0.length, required, documents: bDocs0.length })}` : undefined)

  // weekly-carry-mapping — 영역 '실험'(B 팀 주)·'운영' → W0(지난주)·W1(이번 주) → W1 차주 계획 → '운영' 비활성(내용 있음) → W2(다음 주) 이월은
  // CARRY_PENDING(문서 없음) → 매핑 {운영 → 실험} 재요청 → '실험' 개명 → 새 영역 '신규'(이번 주 이후 문서 W1·W2 에만 행 — W17)
  await admin.http('GET', `/p/${B.id}/settings`)
  const bTeamIds = new Map([[bTeam.code, bTeam.id]])
  const expDef = { ...exp, sortOrder: 1, teams: [[bTeam.code, 'primary']] }
  const runDef = { ...run, sortOrder: 2, teams: [] }
  const freshDef = { ...fresh, sortOrder: 3, teams: [] }
  const expArea = await putArea(B, areaInput(expDef, bTeamIds))
  const runArea = await putArea(B, areaInput(runDef, bTeamIds))
  const w0 = mustOk('W0 생성', await createWeek(B, shiftDays(today, -7), false))
  const w1 = mustOk('W1 생성', await createWeek(B, today, false))
  const w1Initial = await weeklyRowsOf(w1.reportId)
  const carryOwn = 'carry-own-1'
  const carryMapped = 'carry-mapped-1'
  const carryIssue = 'carry-mapped-issue'
  await saveCells(B, [
    { rowId: rowFor(w1Initial, expArea.id).id, cellKey: 'next_content', content: carryOwn },
    { rowId: rowFor(w1Initial, runArea.id).id, cellKey: 'next_content', content: carryMapped },
    { rowId: rowFor(w1Initial, runArea.id).id, cellKey: 'next_issue', content: carryIssue },
  ])
  const w1Saved = await weeklyRowsOf(w1.reportId)
  const deactivated = await putArea(B, areaInput(runDef, bTeamIds, { id: runArea.id, active: false }))
  const pending = await createWeek(B, shiftDays(today, 7), true)
  const docsAfterPending = rows('B 주간 문서', await admin.sb.from('weekly_reports').select('id').eq('project_id', B.id)).length
  const w2 = mustOk('W2 매핑 재요청', await createWeek(B, shiftDays(today, 7), true, { [runArea.id]: expArea.id }))
  const w2Rows = await weeklyRowsOf(w2.reportId)
  const w1AfterCarry = await weeklyRowsOf(w1.reportId)
  const renamed = await putArea(B, areaInput(expDef, bTeamIds, { id: expArea.id, name: exp.renamed }))
  const w2AfterRename = await weeklyRowsOf(w2.reportId)
  const freshArea = await putArea(B, areaInput(freshDef, bTeamIds))
  const freshRows = rows('신규 영역 행', await admin.sb.from('weekly_report_rows').select('report_id').eq('area_id', freshArea.id))
  const bAreaRows = rows('B 영역', await admin.sb.from('project_areas').select('id, code, name, active').eq('project_id', B.id).eq('kind', 'weekly_section'))
  const weeks = { w0: await weekStartOf(w0.reportId), w1: await weekStartOf(w1.reportId), w2: await weekStartOf(w2.reportId) }
  const expW2 = rowFor(w2Rows, expArea.id)
  const carryCheck = {
    pending: pending?.ok === false && pending.code === 'CARRY_PENDING' && (pending.overflow ?? []).length === 0
      && JSON.stringify((pending.pending ?? []).map((p) => [p.areaId, p.cells])) === JSON.stringify([[runArea.id, ['nextContent', 'nextIssue']]]),
    noDocumentWhilePending: docsAfterPending === 2,
    twoContents: expW2.this_content === carriedText(carryOwn, carryMapped) && expW2.this_issue === carriedText('', carryIssue)
      && expW2.next_content === '' && expW2.next_issue === '',
    w2ActiveOnly: w2Rows.length === 1,
    w1Unchanged: JSON.stringify(w1AfterCarry) === JSON.stringify(w1Saved),
    renameSameArea: renamed.id === expArea.id && renamed.status === 'updated'
      && JSON.stringify(bAreaRows.filter((a) => a.code === exp.code).map((a) => [a.id, a.name])) === JSON.stringify([[expArea.id, exp.renamed]]),
    renameSameCells: JSON.stringify(w2AfterRename) === JSON.stringify(w2Rows),
    freshOnlyFromThisWeek: freshArea.status === 'created' && freshArea.rowsAdded === 2
      && JSON.stringify(freshRows.map((r) => r.report_id).sort()) === JSON.stringify([w1.reportId, w2.reportId].sort()),
    mondayKeys: isMondayIso(weeks.w0) && shiftDays(weeks.w0, 7) === weeks.w1 && shiftDays(weeks.w1, 7) === weeks.w2,
  }
  step('weekly-carry-mapping', {
    projectId: B.id, areas: { exp: expArea.id, run: runArea.id, fresh: freshArea.id }, reports: { w0: w0.reportId, w1: w1.reportId, w2: w2.reportId },
    weeks, deactivated: deactivated.status, pending: pending?.pending ?? null, w2Exp: { thisContent: expW2.this_content, thisIssue: expW2.this_issue },
    freshRows: freshRows.length, checks: carryCheck,
  }, Object.values(carryCheck).every(Boolean) ? undefined : `이월·매핑·개명·추가: ${JSON.stringify(carryCheck)}`)

  // weekly-outputs — B 의 W2 시트 PPT·기본 갈래 주간 보고서 둘(xlsx·pptx)의 텍스트 파트에 SP4 센티널 0(부정 테스트 1 의 봇 밖 — §6.4 의 일치 규칙,
  // 등록 이름은 같은 문자열만 뺀다), 시트 PPT 장 수 = 표지 + 보이는 영역, 임베드 PGRST201 0(W21 — 주간 행 → 문서 FK 는 하나다)
  const bRegistered = [bTeam.code, ...[exp, run, fresh].flatMap((a) => [a.code, a.name]), exp.renamed]
  const bSentinels = excludeRegistered(sp4Sentinels(), bRegistered)
  const outputs = [
    await fetchZip(`/api/report?projectId=${B.id}&source=sheet&format=pptx&week=${weeks.w2}`, 'weekly-b-w2.pptx'),
    await fetchZip(`/api/report?projectId=${B.id}&format=xlsx`, 'report-b.xlsx'),
    await fetchZip(`/api/report?projectId=${B.id}&format=pptx`, 'report-b.pptx'),
  ]
  const sheetEntries = outputs[0].entries
  const embed = await admin.sb.from('weekly_reports').select('id, weekly_report_rows(count)').eq('project_id', B.id)
  const rowCounts = Object.fromEntries((embed.data ?? []).map((r) => [r.id, r.weekly_report_rows?.[0]?.count ?? null]))
  const outCheck = {
    slides: slideCount(sheetEntries.map((e) => e.name)) === 1 + 2,   // 표지 + 보이는 영역 둘(개명한 실험·신규) — 운영은 W2 에 행이 없다
    visibleNames: presentTexts(pptText(sheetEntries), [exp.renamed, fresh.name]).length === 2,
    sentinels: outputs.every((o) => sentinelReport(o.entries, bSentinels).length === 0),
    embed: !embed.error,
    rowCounts: JSON.stringify([rowCounts[w0.reportId], rowCounts[w1.reportId], rowCounts[w2.reportId]]) === JSON.stringify([2, 3, 2]),
  }
  step('weekly-outputs', {
    outputs: outputs.map((o) => ({ path: o.path, file: o.file, bytes: o.bytes, parts: o.entries.length, sentinelHits: sentinelReport(o.entries, bSentinels) })),
    slides: slideCount(sheetEntries.map((e) => e.name)), embedError: embed.error?.code ?? null, rowCounts, checks: outCheck,
  }, Object.values(outCheck).every(Boolean) ? undefined : `주간 출력: ${JSON.stringify(outCheck)}`)

  // weekly-registered-names — A(SP1 팀 둘 — 옛 팀 코드와 같은 이름)에 옛 기본값과 같은 이름의 영역(첫 팀 주) → 주차·시트 PPT. 스스로 등록한 이름은
  // 나와야 하고(부정 테스트 2) 다른 센티널은 0. 봇 필터 패리티는 단위 테스트(W18 — E2E 는 LLM 플래너에 기대지 않는다)
  await admin.http('GET', `/p/${A.id}/settings`)
  const aTeamIds = new Map(SP1_TEAMS.A.map((code, i) => [code, teamIds.A[i]]))
  const sales = await putArea(A, areaInput({ ...REGISTERED_AREA, sortOrder: 1, teams: [[SP1_TEAMS.A[0], 'primary']] }, aTeamIds))
  await admin.http('GET', `/p/${A.id}/weekly`)
  const aWeek = mustOk('A 주차 생성', await createWeek(A, today, false))
  const aRows = await weeklyRowsOf(aWeek.reportId)
  await saveCells(A, [{ rowId: rowFor(aRows, sales.id).id, cellKey: 'this_content', content: 'registered-name check' }])
  const aPpt = await fetchZip(`/api/report?projectId=${A.id}&source=sheet&format=pptx&week=${await weekStartOf(aWeek.reportId)}`, 'weekly-a.pptx')
  const aRegistered = [...SP1_TEAMS.A, REGISTERED_AREA.code, REGISTERED_AREA.name]
  const regCheck = {
    created: sales.status === 'created' && aWeek.status === 'created' && aRows.length === 1,
    nameShown: findSentinels(pptText(aPpt.entries), [REGISTERED_AREA.name]).length === 1,
    otherSentinels: sentinelReport(aPpt.entries, excludeRegistered(sp4Sentinels(), aRegistered)).length === 0,
    slides: slideCount(aPpt.entries.map((e) => e.name)) === 1 + 1,
  }
  step('weekly-registered-names', { projectId: A.id, areaId: sales.id, registered: aRegistered, reportId: aWeek.reportId, checks: regCheck },
    Object.values(regCheck).every(Boolean) ? undefined : `등록 이름: ${JSON.stringify(regCheck)}`)

  // import-idempotent — 새 프로젝트 I(팀 = A 의 첫 팀 code)에 같은 명령 id K 로 append 두 번 = 항목 1벌·두 번째 duplicate(W5), K 로 replace 는
  // 422 COMMAND_REUSED(아무것도 바꾸지 않는다). 영수증은 세션 PostgREST 로 getImportReceipt 와 같은 술어(본인 RLS·command_id·kind·project_id)로
  // 읽는다 — 그 액션은 A1 화면에 호출부가 없어 매니페스트에 없다(결과 화면은 B 의 #23). 액션의 프로젝트 필터 증거는 tests/actions/import-reads.test.ts
  const I = await createProject(admin, wsA, 'I')
  await admin.http('GET', `/p/${I.id}/settings`)
  mustOk(`addProjectTeam(${team})`, (await admin.action(`/p/${I.id}/settings`, 'addProjectTeam', [I.id, team])).result)
  const profI = (await (await admin.http('POST', '/api/import/inspect', {
    body: inspectForm({ file: filled, fileName: 'wbs-filled.xlsx', projectId: I.id }),
  })).json()).detection.profile
  const K = randomUUID()
  const sendI = async (mode, expect = 200) => (await admin.http('POST', '/api/import/execute', {
    body: importForm({ file: filled, fileName: 'wbs-filled.xlsx', projectId: I.id, profile: profI, mode, commandId: K }), expect,
  })).json()
  const firstI = await sendI('append')
  const secondI = await sendI('append')
  const itemsI = rows('I 항목', await admin.sb.from('wbs_items').select('id').eq('project_id', I.id).order('id'))
  const reusedI = await sendI('replace', 422)
  const itemsIAfter = rows('I 항목', await admin.sb.from('wbs_items').select('id').eq('project_id', I.id).order('id'))
  const receiptsOf = async (projectId) => rows('영수증', await admin.sb.from('command_receipts')
    .select('command_id, project_id, result, created_at').eq('command_id', K).eq('kind', 'wbs_import').eq('project_id', projectId))
  const receiptI = await receiptsOf(I.id)
  const receiptOther = await receiptsOf(A.id)
  const idemCheck = {
    first: firstI.ok === true && firstI.kind === 'applied' && firstI.commandId === K && firstI.count === wbsRows.length,
    second: secondI.ok === true && secondI.kind === 'duplicate' && secondI.commandId === K && secondI.count === wbsRows.length,
    oneSet: itemsI.length === wbsRows.length,
    reused: reusedI.ok === false && reusedI.code === 'COMMAND_REUSED',
    untouched: JSON.stringify(itemsIAfter) === JSON.stringify(itemsI),
    receipt: receiptI.length === 1 && receiptI[0].result?.mode === 'append' && Number(receiptI[0].result?.count) === wbsRows.length,
    otherProject: receiptOther.length === 0,
  }
  step('import-idempotent', {
    projectId: I.id, commandId: K, first: importResultView(firstI), second: importResultView(secondI), reused: importResultView(reusedI),
    items: itemsI.length, receipt: receiptI.map((r) => ({ projectId: r.project_id, mode: r.result?.mode ?? null, count: r.result?.count ?? null, createdAt: r.created_at })),
    otherProjectReceipts: receiptOther.length, receiptVia: 'PostgREST(세션) — getImportReceipt 와 같은 술어(본인 RLS·command_id·kind·project_id)',
    checks: idemCheck,
  }, Object.values(idemCheck).every(Boolean) ? undefined : `가져오기 멱등: ${JSON.stringify(idemCheck)}`)

  // import-unregistered-teams — 공용 팀(단계 16 의 WS_TEAM)을 상속하는 새 프로젝트 D. 명단·영역·초대를 그 공용 팀으로 꾸린다 — 명단·초대 액션은
  // 아직 팀 마스터 캐시로 팀을 고르고(A2 가 옮긴다) 새 프로젝트를 바로 못 볼 수 있어 배선은 service_role 로 한다(로컬 전용 픽스처). 미등록 팀이
  // 든 파일로 registerTeams=false → 409(needsTeams·inheritsCommon·공용 팀 목록) → true(같은 명령 id — 409 는 영수증을 남기지 않는다) → 공용 팀이
  // 같은 code·이름·색의 전용 팀으로 전환되고(그 프로젝트의 공용 팀 참조 0 — D54) 새 팀이 전용 팀, 팀 목록이 공용 팀 code 를 잃지 않는다
  const D = await createProject(admin, wsA, 'D')
  const commonTeams = rows('공용 팀', await svc.from('teams').select('id, code, name, color, sort_order, progress_visible, active')
    .eq('workspace_id', wsA).is('project_id', null))
  const ops = commonTeams.find((t) => t.code === WS_TEAM)
  if (!ops) throw new Fail(`워크스페이스 A 의 공용 팀 ${WS_TEAM} 이 없다(단계 16)`)
  const [selfPerson] = rows('본인 인물', await svc.from('people').select('id').eq('workspace_id', wsA).eq('user_id', me.id))
  if (!selfPerson) throw new Fail('워크스페이스 A 에 본인 인물이 없다(단계 4)')
  const [dMember] = rows('D 명단', await svc.from('project_members')
    .insert({ project_id: D.id, person_id: selfPerson.id, access_role: 'member', active: true }).select('id'))
  rows('D 명단 팀', await svc.from('project_member_teams').insert({ member_id: dMember.id, team_id: ops.id, is_primary: true }).select('member_id'))
  const [dArea] = rows('D 영역', await svc.from('project_areas')
    .insert({ project_id: D.id, kind: 'weekly_section', code: 'OPSA', name: '운영 지원', sort_order: 1, active: true }).select('id'))
  rows('D 영역 팀', await svc.from('area_teams').insert({ area_id: dArea.id, team_id: ops.id, kind: 'primary' }).select('area_id'))
  const [dInvite] = rows('D 초대', await svc.from('project_invites').insert({
    workspace_id: wsA, project_id: D.id, email: 'e2e-dana@example.com', access_role: 'member', team_ids: [ops.id],
    token_hash: createHash('sha256').update(randomUUID()).digest('hex'), created_by: me.id, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  }).select('id'))
  const dRows = e2eRows(WS_TEAM, UNREGISTERED_TEAM)
  const dFile = await fillWbsWorkbook(dRows, template)
  const dFilePath = join(outDir, 'wbs-unregistered.xlsx')
  writeFileSync(dFilePath, dFile)
  const profD = (await (await admin.http('POST', '/api/import/inspect', {
    body: inspectForm({ file: dFile, fileName: 'wbs-unregistered.xlsx', projectId: D.id }),
  })).json()).detection.profile
  const KD = randomUUID()
  const sendD = async (registerTeams, expect) => (await admin.http('POST', '/api/import/execute', {
    body: importForm({ file: dFile, fileName: 'wbs-unregistered.xlsx', projectId: D.id, profile: profD, mode: 'append', commandId: KD, registerTeams }), expect,
  })).json()
  const needs = await sendD(false, 409)
  const ownBefore = rows('D 전용 팀', await svc.from('teams').select('id').eq('project_id', D.id))
  const done = await sendD(true, 200)
  const ownTeams = rows('D 전용 팀', await svc.from('teams').select('id, code, name, color, sort_order, progress_visible, active').eq('project_id', D.id))
  const opsAfter = rows('공용 팀', await svc.from('teams').select('id, project_id, active').eq('id', ops.id))
  const wiring = {
    items: rows('D 항목 담당', await svc.from('wbs_items').select('id, item_owners(team_id)').eq('project_id', D.id)),
    members: rows('D 명단 팀', await svc.from('project_members').select('id, project_member_teams(team_id)').eq('project_id', D.id)),
    areas: rows('D 영역 팀', await svc.from('project_areas').select('id, area_teams(team_id)').eq('project_id', D.id)),
    invites: rows('D 초대 팀', await svc.from('project_invites').select('id, team_ids').eq('project_id', D.id)),
  }
  const ownOps = ownTeams.find((t) => t.code === WS_TEAM)
  const commonRefs = teamRefs(wiring, commonTeams.map((t) => t.id))
  const ownOpsRefs = ownOps ? teamRefs(wiring, [ownOps.id]) : null
  const teamCheck = {
    needs: needs.ok === false && needs.code === 'NEEDS_TEAMS' && JSON.stringify(needs.needsTeams) === JSON.stringify([UNREGISTERED_TEAM])
      && needs.inheritsCommon === true && (needs.commonTeams ?? []).some((t) => t.code === WS_TEAM),
    nothingBeforeRegister: ownBefore.length === 0,
    applied: done.ok === true && done.kind === 'applied' && done.commandId === KD && done.count === dRows.length,
    convertedSameAsCommon: !!ownOps && JSON.stringify([ownOps.name, ownOps.color, ownOps.sort_order, ownOps.progress_visible, ownOps.active])
      === JSON.stringify([ops.name, ops.color, ops.sort_order, ops.progress_visible, ops.active]),
    codesKept: JSON.stringify(ownTeams.map((t) => t.code).sort()) === JSON.stringify([UNREGISTERED_TEAM, WS_TEAM].sort()),
    noCommonRefs: Object.values(commonRefs).every((n) => n === 0),
    refsMoved: JSON.stringify(ownOpsRefs) === JSON.stringify({ item_owners: 1, project_member_teams: 1, area_teams: 1, invites: 1 }),
    commonIntact: opsAfter.length === 1 && opsAfter[0].project_id === null && opsAfter[0].active === ops.active,
  }
  step('import-unregistered-teams', {
    projectId: D.id, commandId: KD, file: dFilePath, fixture: { member: dMember.id, area: dArea.id, invite: dInvite.id, commonTeam: ops.id },
    needs: { code: needs.code, needsTeams: needs.needsTeams, inheritsCommon: needs.inheritsCommon, commonTeams: (needs.commonTeams ?? []).map((t) => t.code) },
    applied: importResultView(done), ownTeams: ownTeams.map((t) => t.code), commonRefs, ownOpsRefs, checks: teamCheck,
  }, Object.values(teamCheck).every(Boolean) ? undefined : `미등록 팀·전환: ${JSON.stringify(teamCheck)}`)

  // ── 19. 관리자 세션으로 주요 화면 렌더(눈확인의 기계 부분) — 스트리밍된 오류 digest·notFound·열화 표시가 없고, 흐름에서 만든
  // 데이터가 그 페이지 세그먼트에 실려 있어야 한다(조회 실패를 빈 목록으로 그리는 화면은 오류 표식이 없다). /projects 는 프로젝트
  // 이름이 사이드바에도 있으므로 카드 링크(`/p/<id>/dashboard` — 사이드바는 /projects 에서 프로젝트 메뉴를 그리지 않는다)로 본다.
  // B 단계(20~23) 앞이다 — 모듈을 끄기 전에 켜진 화면이 열려야 한다.
  const pages = [
    ['/projects', [`/p/${A.id}/dashboard`, `/p/${B.id}/dashboard`]],
    [`/p/${A.id}/dashboard`, []],
    [`/p/${A.id}/members`, ['bob', INVITEE.name]],
    [`/p/${A.id}/meetings`, [meetingInput({ date: meetingDate, attendeeIds: [] }).title]],
    [`/p/${A.id}/issues`, []],
    [`/p/${A.id}/announcements`, []],
    [`/p/${A.id}/weekly`, []],
    [`/p/${A.id}/wbs`, [leaf.name]],
    [`/p/${A.id}/attendance`, []],
    ['/minutes', titles],
    // SP4 A1 — B 의 주간(이번 주 W1: 개명한 실험·비활성 운영·신규)과 설정(주간 영역 편집기)
    [`/p/${B.id}/weekly`, [exp.renamed, fresh.name]],
    [`/p/${B.id}/settings`, [exp.renamed, fresh.name]],
  ]
  const rendered = []
  for (const [path, expectTexts] of pages) {
    const html = await (await admin.http('GET', path)).text()
    const entry = { path, bytes: html.length, expect: expectTexts, problems: pageProblems(html, expectTexts) }
    // 기록용 — B 주간 화면의 서버 렌더 HTML(RSC 페이로드 포함)의 센티널(스펙 §6.3 render-pages, 재검토 반영 B P3-2). 실패로 세지 않는다 —
    // 적중이 있으면 A2 의 S10 앞에서 K12 규칙으로 처리한다(실측 근거·존재 단언을 같은 커밋에, 옛 이름 자체는 마스크하지 않는다)
    if (path === `/p/${B.id}/weekly`) Object.assign(entry, { sentinels: findSentinels(html, bSentinels), masks: [...SENTINEL_MASKS] })
    rendered.push(entry)
  }
  const broken = rendered.filter((r) => r.problems.length)
  step('render-pages', { pages: rendered, problems: broken.length }, broken.length ? `화면 오류 표식: ${JSON.stringify(broken)}` : undefined)

  // ── 20~23. SP3a B 모듈 관문 — 설정 화면의 액션으로 프로젝트 모듈을 바꾸고, 워크스페이스 허용과 시드만 로컬 service_role 로 쓴다.
  const projectModules = async () => {
    const [row] = rows('A 설정', await admin.sb.from('project_settings').select('revision, values').eq('project_id', A.id))
    return { revision: Number(row.revision), enabled: row.values['modules.enabled'] }
  }
  const setProjectModules = async (what, next) => {
    const cur = await projectModules()
    const response = await admin.action(`/p/${A.id}/settings`, 'updateProjectSettings',
      [A.id, { expectedRevision: cur.revision, commandId: randomUUID(), set: { 'modules.enabled': next(cur.enabled) }, unset: [] }])
    if (!response.result?.ok || response.result.kind !== 'applied') throw new Fail(`${what}: updateProjectSettings 결과: ${JSON.stringify(response.result)}`)
    return (await projectModules()).enabled
  }

  // 20. 시드 이슈가 켜진 화면에 보이는지 먼저 확인한 뒤, 꺼진 화면·액션·분석 API 모두에서 차단되는지 본다.
  const issueTitle = `E2E 관문 이슈 ${randomUUID().slice(0, 8)}`
  rows('이슈 시드', await svc.from('issues').insert({ project_id: A.id, title: issueTitle, body: 'E2E', severity: 'medium' }).select('id'))
  if (!(await (await admin.http('GET', `/p/${A.id}/issues`)).text()).includes(issueTitle)) throw new Fail('켜진 이슈 화면에 시드 이슈가 없다')
  const enabledNoIssues = await setProjectModules('issues 끄기', (enabled) => enabled.filter((id) => id !== 'issues'))
  const issuesRes = await admin.http('GET', `/p/${A.id}/issues`, { expect: [200, 404] })
  const issuesHtml = await issuesRes.text()
  const created = await admin.action(`/p/${A.id}/issues`, 'createIssue',
    [A.id, { title: 'E2E 거부', body: '', severity: 'medium', assigneeMemberIds: [], startDate: null, dueDate: null }])
  const analysisRes = await admin.http('GET', `/api/issue-analysis?projectId=${A.id}&runId=${randomUUID()}`, { expect: 404 })
  const analysisText = await analysisRes.text()
  const issuesOff = {
    enabled: enabledNoIssues,
    page: { status: issuesRes.status, notFound: issuesRes.status === 404 || notFoundRendered(issuesHtml), issueInHtml: issuesHtml.includes(issueTitle) },
    createIssue: created.result,
    issueAnalysis: { status: analysisRes.status, body: JSON.parse(analysisText), issueInBody: analysisText.includes(issueTitle) },
  }
  step('module-issues-off', issuesOff,
    enabledNoIssues.includes('issues') || !issuesOff.page.notFound || issuesOff.page.issueInHtml
      || created.result?.ok !== false || created.result?.error !== ERR_MODULE_DISABLED
      || issuesOff.issueAnalysis.body?.error !== ERR_MODULE_DISABLED || issuesOff.issueAnalysis.issueInBody
      ? `issues 관문: ${JSON.stringify(issuesOff)}` : undefined)

  // 21. agent_projects 행이 켜진 채 agents 모듈만 끈 상태를 먼저 확인해 두 원천 AND 를 증명한다.
  const agentRow = async () => rows('agent_projects', await svc.from('agent_projects').select('enabled').eq('project_id', A.id))[0]?.enabled ?? null
  // 옛 토글(setAgentProjectEnabled)은 Phase C 에서 지워졌다 — 켜기·끄기는 모듈 편집기(modules.enabled 의 agents)가 한 길이다.
  // 켜기는 agent_projects 행을 만들거나 enabled 로 되돌리고, 끄기는 행을 건드리지 않는다(agentsSync.ts).
  const withAgents = (enabled) => (enabled.includes('agents') ? enabled : [...enabled, 'agents'])
  // 기본 modules.enabled 에 agents 가 이미 있어 그대로 저장하면 '새로 켬'이 아니라 등록 행이 안 생긴다 — 껐다 켜야 행이 만들어진다(agentsSync).
  await setProjectModules('agents 끄기(등록 준비)', (enabled) => enabled.filter((id) => id !== 'agents'))
  await setProjectModules('agents 켜기', withAgents)
  await admin.http('GET', '/account')
  const tokenResult = await admin.action('/account', 'createAgentToken', [{ name: `e2e-${randomUUID().slice(0, 8)}`, projectId: null, scopes: ['work:read'], expiresDays: 1 }])
  mustOk('createAgentToken', tokenResult.result)
  const agentApi = async (path, expectedStatus) => {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${tokenResult.result.token}` }, redirect: 'manual' })
    const body = await res.json().catch(() => null)
    if (res.status !== expectedStatus) throw new Fail(`GET ${path} → ${res.status}(기대 ${expectedStatus}): ${JSON.stringify(body)?.slice(0, 300)}`)
    return body
  }
  const meHas = (body) => Array.isArray(body?.projects) && body.projects.some((project) => project.id === A.id)
  const agents = { tokenPrefix: tokenResult.result.prefix, meBefore: meHas(await agentApi('/api/v1/agent/me', 200)) }
  await agentApi(`/api/v1/wbs/structure?project_id=${A.id}`, 200)
  agents.enabledAfterModuleOff = await setProjectModules('agents 끄기(모듈만)', (enabled) => enabled.filter((id) => id !== 'agents'))
  agents.rowAfterModuleOff = await agentRow()
  agents.meAfterModuleOff = meHas(await agentApi('/api/v1/agent/me', 200))
  agents.structureAfterModuleOff = { status: 404, body: await agentApi(`/api/v1/wbs/structure?project_id=${A.id}`, 404) }
  await setProjectModules('agents 다시 켜기', withAgents)
  agents.meAfterToggleOn = meHas(await agentApi('/api/v1/agent/me', 200))
  agents.enabledAfterToggleOn = (await projectModules()).enabled
  await setProjectModules('agents 끄기(모듈 편집기)', (enabled) => enabled.filter((id) => id !== 'agents'))
  agents.rowAfterToggleOff = await agentRow()
  agents.enabledAfterToggleOff = (await projectModules()).enabled
  agents.meAfterToggleOff = meHas(await agentApi('/api/v1/agent/me', 200))
  step('module-agents-off', agents,
    !agents.meBefore || agents.enabledAfterModuleOff.includes('agents') || agents.rowAfterModuleOff !== true || agents.meAfterModuleOff
      || !agents.meAfterToggleOn || !agents.enabledAfterToggleOn.includes('agents')
      || agents.rowAfterToggleOff !== true || agents.enabledAfterToggleOff.includes('agents') || agents.meAfterToggleOff
      ? `agents 관문: ${JSON.stringify(agents)}` : undefined)

  // 22. 회의록 연동 허용을 빼면 업로드 계열 API 는 409 이고, 다른 워크스페이스는 그대로 열린다.
  const [wsRow] = rows('A 워크스페이스 설정', await svc.from('workspace_settings').select('revision, values').eq('workspace_id', wsA))
  const allowedA = wsRow.values['modules.allowed']
  const { error: allowErr } = await svc.rpc('apply_workspace_settings', {
    p_workspace_id: wsA, p_expected_revision: Number(wsRow.revision), p_command_id: randomUUID(),
    p_set: { 'modules.allowed': allowedA.filter((id) => id !== 'minutes_integration') },
    p_unset: [], p_actor: me.id, p_schema_version: SCRIPT_SCHEMA_VERSION, p_source: 'internal',
  })
  if (allowErr) throw new Fail(`A modules.allowed 기록 실패: ${allowErr.message}`)
  const externalId = `e2e:${randomUUID()}`
  const uploadOff = await fetch(`${base}/api/v1/minutes`, {
    method: 'POST', redirect: 'manual',
    headers: { authorization: `Bearer ${minutesApiSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ user_email: A_ADMIN.email, date: seoulToday(), team: WS_TEAM, title: 'E2E 관문', body_markdown: '# 관문', external_id: externalId }),
  })
  const integration = {
    allowedBefore: allowedA.includes('minutes_integration'),
    meta: await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent(A_ADMIN.email)}`, 409),
    list: await api(`/api/v1/minutes?user_email=${encodeURIComponent(A_ADMIN.email)}`, 409),
    upload: { status: uploadOff.status, body: await uploadOff.json().catch(() => null) },
    createdRows: rows('업로드 행', await svc.from('minutes').select('id').eq('external_id', externalId)).length,
    beaStillOpen: (await meta(B_ADMIN.email)).projectIds,
  }
  step('module-minutes-integration-off', integration,
    !integration.allowedBefore || integration.meta?.code !== 'module_disabled' || integration.list?.code !== 'module_disabled'
      || integration.upload.status !== 409 || integration.upload.body?.code !== 'module_disabled' || integration.createdRows !== 0
      || JSON.stringify(integration.beaStillOpen) !== JSON.stringify([C.id])
      ? `회의록 업로드 관문: ${JSON.stringify(integration)}` : undefined)

  // 23. chatbot 을 끈 프로젝트의 대기 잡은 처리 대신 skipped 로 마감한다.
  const enabledNoChat = await setProjectModules('chatbot 끄기', (enabled) => enabled.filter((id) => id !== 'chatbot'))
  const entityId = `e2e-${randomUUID()}`
  const [job] = rows('색인 대기 행', await svc.from('ai_index_jobs').insert({
    job_key: ['v1', A.id, 'wbs', 'wbs_item', entityId].map(encodeURIComponent).join(':'),
    operation: 'upsert', project_id: A.id, domain: 'wbs', entity_type: 'wbs_item', entity_id: entityId,
    payload: {}, status: 'pending', run_after: new Date(Date.now() - 86_400_000).toISOString(),
  }).select('id'))
  const cron = await fetch(`${base}/api/cron/ai-index`, { headers: { authorization: `Bearer ${cronSecret}` }, redirect: 'manual' })
  const cronBody = await cron.json().catch(() => null)
  const [after] = rows('색인 행 재조회', await svc.from('ai_index_jobs').select('status, last_error').eq('id', job.id))
  const indexSkip = { enabled: enabledNoChat, cron: { status: cron.status, skipped: cronBody?.skipped ?? null, claimed: cronBody?.claimed ?? null }, job: after }
  step('module-index-skip', indexSkip,
    enabledNoChat.includes('chatbot') || cron.status !== 200 || !(cronBody?.skipped >= 1) || after.status !== 'skipped' || after.last_error !== 'module_disabled'
      ? `색인 크론: ${JSON.stringify(indexSkip)}` : undefined)
}

try {
  await main()
  summary.ok = true
} catch (e) {
  summary.ok = false
  // 실패 메시지에 /invite/<토큰> 경로가 들어갈 수 있다(초대 화면 GET·POST 실패) — 출력 전에 가린다.
  summary.error = redactInviteTokens(e?.message ?? String(e))
  if (!(e instanceof Fail)) console.error(redactInviteTokens(e?.stack ?? String(e)))
  process.exitCode = 1
}
console.log(JSON.stringify(summary, null, 2))
