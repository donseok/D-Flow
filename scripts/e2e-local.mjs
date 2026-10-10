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
//   SP4 A2: next build + next start -p 3101 에서 돈다(과제 24 — 팀 원천에 프로세스 전역 캐시가 없음을 본다). import-unregistered-teams 뒤·render-pages 앞에서
//        새 프로젝트 N 에 팀을 만든 직후 그 팀이 든 파일을 가져오고(409 없음 — KLC:56 해제), 저장 양식 없는 N 의 엑셀 내보내기 접기·펼침이 표준 양식
//        (X-Excel-Layout: standard)이고 텍스트 파트에 SP4 센티널이 0 이다(스펙 §6.3).
//   SP3b UI-2(스펙 §8.3 — 브랜치 전용 e2e-sp3b.mjs 를 과제 39 가 합쳤다, V15): 화면 경로는 워크스페이스 범위(/w/<slug>/…)다 — 옛 경로(/projects·
//        /minutes·/admin/…)는 스텁 307 이라 이 러너는 새 경로를 부른다(서버 액션 매니페스트 키도 /w/[slug]/…/page). module-index-skip 뒤에
//        sp3b- 단계: 두 워크스페이스 계정 duo·B 의 공용 팀·회의록을 더하고 E1 옛 경로 307(쿼리 보존)·E2 회의록 영구 링크·E4 비소속 404·
//        E6 두 워크스페이스 목록과 인자 워크스페이스 생성·E8 루트 리졸버·E9 전환 대상·E11 소프트 이동(Playwright)·E5 전환기·E7 모듈 끈 메뉴·
//        E10 비소속 배지. E3(옛 칸반 → 작업 계획 보드 307 — UI-3 과제 1 이 더했다, 과제 14 의 스텁 뒤에 초록)은 E1 바로 뒤.
//   SP5 A: import-unregistered-teams 뒤(SP4 A2 의 export-standard 뒤)·render-pages 앞에서 달력 넷 — calendar-week-sunday(일요일 프로젝트 S 와 월요일·월~토
//        프로젝트 M 의 연속 2주·이월·라벨·범위·기본 보고서 라벨), calendar-week-transition(월요일 T 를 일요일로 전환 — 미리보기 E = 저장 E, 과도기 6일,
//        과거·과도기 URL 이 같은 문서), calendar-tz(워크스페이스 Pago Pago 와 프로젝트 Kiritimati 시간대 검증, 끝에 tz 복귀),
//        calendar-workday(토요일 근무 예외 → 의존성 연결·계획%, 예외 없는 토요일로 옮기면 거부). 기존 주간 단계의 키는 일요일(워크스페이스 기본값 복사 —
//        SP5 D5)이고 러너의 '오늘'은 그 범위에 저장된 tz 다.
//   재점검 보강(sp3b- 단계 뒤 — 앞 단계의 소속 수·모듈 상태를 건드리지 않게 맨 끝): team-code-merge(공용 팀을 이름·코드 따로 만들고 코드를 바꾸면
//        그 팀 회의록의 사본 코드가 따라가고, 다른 팀으로 합치면 원본은 비활성·회의록 담당은 대상 팀), minutes-no-team(팀 없이 등록 → 목록의 "팀 없음" →
//        팀 지정 → 해제), notify-policy(작업 배정 알림을 끄면 이벤트 행이 생기지 않고 켜면 생긴다), conflict-compare(두 브라우저 컨텍스트의 주간 제목
//        충돌 → 비교 → 서버 값 받기), workspace-create(/admin/workspaces 에서 만들고 진입 — 0054 의 생성 RPC), account-lifecycle(비밀번호 재설정의
//        기록, 세션의 소속 직접 삭제 거부, 제거 뒤 권한 회수), health-headers(/api/health·/login 보안 헤더), minutes-share-link(발급 → 비로그인 열림 →
//        회수 뒤 닫힘), workers(선택 — E2E_WORKERS=1 일 때만. 서버가 CHAT_V2_ENABLED·CHAT_V2_INDEX_WORKER_ENABLED·WIKI_SERVICE_ENABLED·
//        WIKI_WORKER_ENABLED 로 떠 있어야 한다. 꺼져 있으면 건너뜀으로 기록하고 실패로 세지 않는다).
//   설정 반영 완주(맨 끝 — setting- 단계): 설정 한 키를 설정 화면의 액션으로 바꾸고 그 값이 화면·동작에 나타나는지, 다른 워크스페이스(프로젝트 키는
//        다른 프로젝트)에는 나타나지 않는지 본 뒤 되돌린다. setting-extra-axis(작업 계획·가져오기 마법사·엑셀 머리·다시 감지), setting-views-default
//        (첫 진입 보기), setting-portal-widgets(홈 위젯), setting-product-name(세 범위 탭 제목), setting-accent(셸 스타일 블록), setting-logo
//        (탭 아이콘·읽기 라우트), setting-menu(사이드 내비 순서·이름), setting-auto-file(외부 업로드의 folder_path 편철), setting-local-drafts
//        (선택 — E2E_WIKI=1 이고 서버가 WIKI_SERVICE_ENABLED=true 일 때만. 위키 편집기에 내려가는 초안 정책). 알림 정책의 격리는 합성 게이트 S7b.
//        widgets-personal(setting-portal-widgets 바로 뒤 — 개인 홈 구성: 위젯 추가·순서·크기 저장, 빼기, 관리자가 끈 위젯은 개인 구성에서도 사라짐,
//        다른 사용자·다른 워크스페이스는 그대로, 끝에 기본 배치로 되돌림. 쓰기는 개인 설정 라우트 POST /api/prefs).
// 브라우저 자동화는 비밀번호를 입력하지 못하므로 화면이 부르는 것과 같은 경로(서버 액션·API 라우트)를 직접 부른다.
// 사용: db:reset → dev:bootstrap 직후(깨끗한 DB), 스크래치 워크트리에서 npm run env:local 뒤 러너와 같은 앱 주소·시크릿으로 3101 에 띄운 서버(A1 은 npm run dev, A2 부터 next build 뒤 npx next start -p 3101)가
// 떠 있는 상태에서(3000 은 main 체크아웃의 사용자 dev 서버라 러너가 거부한다 — e2eBaseUrl)
//   INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3101 MINUTES_API_ENABLED=true CRON_SECRET=<시크릿> npm run dev -- -p 3101
//   BOOTSTRAP_PASSWORD=… E2E_B_PASSWORD=… CRON_SECRET=<같은 시크릿> [BOOTSTRAP_EMAIL=admin@example.com] \
//   [E2E_BASE_URL=http://localhost:3101(기본값)] [E2E_OUT_DIR=<산출물 폴더>] [E2E_WORKERS=1] [E2E_WIKI=1] npx --yes -p playwright@1.58.2 node scripts/e2e-local.mjs
//   (sp3b-E11 과 conflict-compare 가 브라우저를 쓴다 — Playwright 1.58.2 를 npx 로 PATH 에 싣는다. 없으면 그 단계가 실패한다)
// 비밀번호·시크릿은 env 로만 받고 출력하지 않는다(ana·외부 계정·carol 의 비밀번호는 실행마다 새로 만든다).
// 결과는 stdout 에 JSON 한 덩어리. 어느 단계든 실패하면 그 자리에서 멈추고 exit 1.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
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
  DUO, SP3B_B_TEAM, SP3B_MINUTE_B, archivedRowVerdict, cookieHeader, expectLocation, hiddenVerdict, issuesLinkVerdict, kanbanStubCase, legacyCases,
  shellBadgeVerdict, switcherVerdict,
} from './lib/e2e.mjs'
import {
  A2_TEAM, E2E_AREAS, REGISTERED_AREA, UNREGISTERED_TEAM, areaInput, carriedText, fillWbsWorkbook, importForm, importResultView, inspectForm, nextServerMode,
  pptText, sentinelReport, shiftDays, slideCount, teamRefs, teamSlotVerdict, issueAnalysisRunFixture, zipHasAll,
  dowOfIso, nextDowOnOrAfter, plainWeekLabel, plannedPctByName, rangeText, storedTimezone, todayInTz,
} from './lib/e2e.mjs'
import { SENTINEL_MASKS, excludeRegistered, findSentinels, sp4Sentinels, zipTextParts } from './lib/sentinels.mjs'
import { createSessionFactory } from './lib/e2e-session.mjs'
import { BOOTSTRAP_MODULE_IDS } from './lib/bootstrap-modules.mjs'
import { SCRIPT_SCHEMA_VERSION } from './lib/settings-consts.mjs'
import { localAdminEnv } from './lib/targets.mjs'
import { kanbanBoardRendered, parseE2eSelection, runSelectedE2e } from './lib/e2e-selection.mjs'
import {
  CONFLICT_DIALOG, CONFLICT_TAKE_LATEST, LEAVER, NOTIFY_PROBE_TYPE, NO_TEAM_FILTER, NO_TEAM_LABEL, WEEKLY_TITLE_INPUT,
  healthProblems, minuteMetaPatch, notifyPolicyOf, recheckNames, securityHeaderProblems, settingPatch, workerProblems, workersEnabled,
} from './lib/e2e.mjs'
import {
  ACCENT_PROBE, PORTAL_LAYOUT_PROBE, PORTAL_PROBE_WIDGET, TINY_PNG_BASE64, WIKI_PROBE_KIND, accentRootOf, brandMarkPath, canonicalJson, draftPoliciesOf, filedUnder, iconHrefsOf, navItemsOf,
  navMenuProbe, navMenuProblems, portalLayoutOf, portalWidgetsOff, productInTitle, settingProbeNames, titlesOf, widgetCellsOf, widgetIdsOf, wikiStepEnabled,
} from './lib/e2e.mjs'

// --only sp3b-E3: 레인 B 캡처 시드·3201만 사용한다. 전체 러너의 비밀번호/외부 API 시크릿을 요구하지 않는다.
try {
  const selected = parseE2eSelection(process.argv.slice(2))
  if (selected) process.exit(await runSelectedE2e(selected) ? 0 : 1)
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
}

class Fail extends Error {}
const log = (m) => console.error(`· ${m}`)

let env
let adminEnv
let envText
try {
  envText = readFileSync('.env.local', 'utf8')
  env = localClientEnv(envText)
  adminEnv = localAdminEnv(envText) // 타 워크스페이스 픽스처 전용(로컬 판정은 targets.mjs 한 곳)
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
// 외부 회의록 API 의 자격증명은 env 시크릿이 아니라 워크스페이스별 integration_credentials(kind='minutes_api') 행이다 — 단계 18 이
// issueMinutesToken 으로 워크스페이스마다 한 행을 만든다. dev 서버에는 MINUTES_API_ENABLED=true 만 필요하다(없으면 라우트가 404).
/**
 * 회의록 연동 토큰 발급(로컬 전용) — 발급 화면 대신 service_role 로 행을 넣는다. 형식은 앱의 generateCredentialToken('minutes_api')
 * (src/lib/agent/token.ts)과 같다: dflow_int_<prefix 12자 영숫자>_<secret 43자>, DB 에는 sha256 hex 만. 평문은 반환만 하고 출력하지 않는다.
 */
async function issueMinutesToken(svc, workspaceId, createdBy) {
  let prefix = ''
  while (prefix.length < 12) prefix += randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '')
  prefix = prefix.slice(0, 12)
  const token = `dflow_int_${prefix}_${randomBytes(32).toString('base64url')}`
  const { error } = await svc.from('integration_credentials').insert({
    workspace_id: workspaceId, kind: 'minutes_api', name: `e2e-${prefix}`, token_prefix: prefix,
    token_hash: createHash('sha256').update(token).digest('hex'), created_by: createdBy,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  })
  if (error) throw new Error(`회의록 연동 자격증명 발급 실패: ${error.message}`)
  return token
}
const cronSecret = process.env.CRON_SECRET
if (!cronSecret) { console.error('✗ CRON_SECRET 가 없다 — dev 서버에 준 값과 같은 값을 넘긴다'); process.exit(1) }

const MANIFEST = '.next/server/server-reference-manifest.json'
const ACTIONS = {
  createProject: { filename: 'src/app/actions/project.ts', exportedName: 'createProject', worker: '/w/[slug]/projects/page' },
  createAccount: { filename: 'src/app/actions/accounts.ts', exportedName: 'createAccount', worker: '/w/[slug]/admin/accounts/page' },
  addTeam: { filename: 'src/app/actions/teams.ts', exportedName: 'addTeam', worker: '/w/[slug]/admin/teams/page' },
  // SP5 B2 minutes-teams — 팀 개명·비활성(공용 팀 관리 화면)과 탐색기의 폴더 만들기
  updateTeam: { filename: 'src/app/actions/teams.ts', exportedName: 'updateTeam', worker: '/w/[slug]/admin/teams/page' },
  createMinuteFolder: { filename: 'src/app/actions/minutes.ts', exportedName: 'createMinuteFolder', worker: '/w/[slug]/minutes/page' },
  createMinute: { filename: 'src/app/actions/minutes.ts', exportedName: 'createMinute', worker: '/w/[slug]/minutes/page' },
  addProjectTeam: { filename: 'src/app/actions/projectTeams.ts', exportedName: 'addProjectTeam', worker: '/p/[projectId]/settings/page' },
  upsertRosterMember: { filename: 'src/app/actions/roster.ts', exportedName: 'upsertRosterMember', worker: '/p/[projectId]/members/page' },
  setWbsAssignee: { filename: 'src/app/actions/wbsAssign.ts', exportedName: 'setWbsAssignee', worker: '/p/[projectId]/wbs/page' },
  createMeeting: { filename: 'src/app/actions/meetings.ts', exportedName: 'createMeeting', worker: '/p/[projectId]/meetings/page' },
  createProjectInvite: { filename: 'src/app/actions/projectInvites.ts', exportedName: 'createProjectInvite', worker: '/p/[projectId]/members/page' },
  redeemInviteWithSignup: { filename: 'src/app/actions/inviteRedeem.ts', exportedName: 'redeemInviteWithSignup', worker: '/invite/[token]/page' },
  updateProjectSettings: { filename: 'src/app/actions/settings.ts', exportedName: 'updateProjectSettings', worker: '/p/[projectId]/settings/page' },
  createIssue: { filename: 'src/app/actions/issues.ts', exportedName: 'createIssue', worker: '/p/[projectId]/issues/page' },
  // SP5b I issue-status-flow — 이슈 모달의 진행 저장과 설정 화면의 기록 옮기기
  updateIssueProgress: { filename: 'src/app/actions/issues.ts', exportedName: 'updateIssueProgress', worker: '/p/[projectId]/issues/page' },
  migrateVocabCode: { filename: 'src/app/actions/vocab.ts', exportedName: 'migrateVocabCode', worker: '/p/[projectId]/settings/page' },
  // SP5b W1 workflow-approval — 명세 패널의 승인 버튼, 단계 패널의 단계 지정·단계 승인
  approveAgentCompletion: { filename: 'src/app/actions/agentWork.ts', exportedName: 'approveAgentCompletion', worker: '/p/[projectId]/wbs/page' },
  setWbsStage: { filename: 'src/app/actions/wbsAssign.ts', exportedName: 'setWbsStage', worker: '/p/[projectId]/wbs/page' },
  setWbsDevWorkflow: { filename: 'src/app/actions/wbsAssign.ts', exportedName: 'setWbsDevWorkflow', worker: '/p/[projectId]/wbs/page' },
  approveWbsStep: { filename: 'src/app/actions/wbsAssign.ts', exportedName: 'approveWbsStep', worker: '/p/[projectId]/wbs/page' },
  createAgentToken: { filename: 'src/app/actions/agentTokens.ts', exportedName: 'createAgentToken', worker: '/account/page' },
  setWorkspaceRole: { filename: 'src/app/actions/accounts.ts', exportedName: 'setWorkspaceRole', worker: '/w/[slug]/admin/accounts/page' },
  listAuthzEvents: { filename: 'src/app/actions/authzEvents.ts', exportedName: 'listAuthzEvents', worker: '/w/[slug]/settings/page' },
  createWeeklyReport: { filename: 'src/app/actions/weekly.ts', exportedName: 'createWeeklyReport', worker: '/p/[projectId]/weekly/page' },
  saveWeeklyCells: { filename: 'src/app/actions/weekly.ts', exportedName: 'saveWeeklyCells', worker: '/p/[projectId]/weekly/page' },
  upsertArea: { filename: 'src/app/actions/projectAreas.ts', exportedName: 'upsertArea', worker: '/p/[projectId]/settings/page' },
  getWbsBackup: { filename: 'src/app/actions/importBackup.ts', exportedName: 'getWbsBackup', worker: '/p/[projectId]/import/page' },
  // SP5 A 달력 단계(스펙 §6.3) — 화면이 부르는 액션과 그 액션을 쓰는 페이지
  updateWorkspaceSettings: { filename: 'src/app/actions/settings.ts', exportedName: 'updateWorkspaceSettings', worker: '/w/[slug]/settings/page' },
  previewWeekStartChange: { filename: 'src/app/actions/settingsPreview.ts', exportedName: 'previewWeekStartChange', worker: '/p/[projectId]/settings/page' },
  addHoliday: { filename: 'src/app/actions/project.ts', exportedName: 'addHoliday', worker: '/p/[projectId]/settings/page' },
  setBaseDate: { filename: 'src/app/actions/project.ts', exportedName: 'setBaseDate', worker: '/p/[projectId]/settings/page' },
  createAnnouncement: { filename: 'src/app/actions/announcements.ts', exportedName: 'createAnnouncement', worker: '/p/[projectId]/announcements/page' },
  addWbsItem: { filename: 'src/app/actions/wbs.ts', exportedName: 'addWbsItem', worker: '/p/[projectId]/wbs/page' },
  updateWbsFields: { filename: 'src/app/actions/wbs.ts', exportedName: 'updateWbsFields', worker: '/p/[projectId]/wbs/page' },
  addTaskDependency: { filename: 'src/app/actions/wbs.ts', exportedName: 'addTaskDependency', worker: '/p/[projectId]/wbs/page' },
  // 재점검 보강 — 공용 팀 관리 화면의 코드 바꾸기·합치기, 회의록 상세의 메타·공유 모달, 플랫폼 관리의 워크스페이스 만들기, 계정 관리의 제거·재설정
  changeTeamCode: { filename: 'src/app/actions/teams.ts', exportedName: 'changeTeamCode', worker: '/w/[slug]/admin/teams/page' },
  mergeTeams: { filename: 'src/app/actions/teams.ts', exportedName: 'mergeTeams', worker: '/w/[slug]/admin/teams/page' },
  updateMinuteMeta: { filename: 'src/app/actions/minutes.ts', exportedName: 'updateMinuteMeta', worker: '/w/[slug]/minutes/[id]/page' },
  setMinuteShare: { filename: 'src/app/actions/minutes.ts', exportedName: 'setMinuteShare', worker: '/w/[slug]/minutes/[id]/page' },
  createPlatformWorkspace: { filename: 'src/app/actions/platformWorkspaces.ts', exportedName: 'createPlatformWorkspace', worker: '/admin/workspaces/page' },
  // workspace-archive(0056) — 보관·복원과, 보관 중 거부를 볼 이름 바꾸기(같은 이름이면 쓰지 않는다 — 원상 확인에 쓴다)
  archivePlatformWorkspace: { filename: 'src/app/actions/platformWorkspaces.ts', exportedName: 'archivePlatformWorkspace', worker: '/admin/workspaces/page' },
  restorePlatformWorkspace: { filename: 'src/app/actions/platformWorkspaces.ts', exportedName: 'restorePlatformWorkspace', worker: '/admin/workspaces/page' },
  renameWorkspace: { filename: 'src/app/actions/platformWorkspaces.ts', exportedName: 'renameWorkspace', worker: '/admin/workspaces/page' },
  removeWorkspaceMember: { filename: 'src/app/actions/accounts.ts', exportedName: 'removeWorkspaceMember', worker: '/w/[slug]/admin/accounts/page' },
  resetPassword: { filename: 'src/app/actions/accounts.ts', exportedName: 'resetPassword', worker: '/w/[slug]/admin/accounts/page' },
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
  // 정확히 하나·관리자여야 한다(SP3b 의 두 워크스페이스 흐름은 끝의 duo 가 맡는다). 화면 경로는 워크스페이스 범위다(/w/<slug>/…).
  const me = await admin.login(email, password)
  const myWs = rows('워크스페이스 소속', await admin.sb.from('workspace_members').select('workspace_id,role').eq('user_id', me.id))
  if (myWs.length !== 1 || myWs[0].role !== 'admin') throw new Fail(`부트스트랩 계정의 워크스페이스 소속이 ${JSON.stringify(myWs)}(관리자 1건이어야 한다)`)
  const wsA = myWs[0].workspace_id
  const [{ slug: slugA }] = rows('워크스페이스 A 슬러그', await admin.sb.from('workspaces').select('slug').eq('id', wsA))
  /** 워크스페이스 id → 화면 경로의 슬러그(A 는 여기서, B 는 단계 12 에서 더한다) */
  const slugOf = new Map([[wsA, slugA]])
  const wsPath = (workspaceId, seg) => {
    const slug = slugOf.get(workspaceId)
    if (!slug) throw new Fail(`워크스페이스 ${workspaceId} 의 슬러그를 모른다`)
    return `/w/${encodeURIComponent(slug)}${seg ? `/${seg}` : ''}`
  }
  await admin.http('GET', wsPath(wsA, 'projects'))
  step('login', { userId: me.id, workspaceId: wsA, slug: slugA, cookieNames: [...admin.jar.keys()] })
  // SP5 A — 러너의 '오늘'은 그 범위에 저장된 tz(없으면 제품 기본값 UTC). 판독은 service_role(설정 표 읽기만 — 쓰기는 늘 설정 액션)
  const tzOfProject = async (projectId) =>
    storedTimezone(rows('프로젝트 설정', await svc.from('project_settings').select('values').eq('project_id', projectId).single()).values)
  const tzOfWorkspace = async (workspaceId) =>
    storedTimezone(rows('워크스페이스 설정', await svc.from('workspace_settings').select('values').eq('workspace_id', workspaceId).single()).values)

  // ── 2. 프로젝트 A·B — 화면(NewProjectModal)이 부르는 createProject({ workspaceId, … }). 결과는 그 세션으로 DB 에서 확인한다
  // (같은 이름 1건 + 지정한 워크스페이스 + 라벨 그대로).
  const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, '')
  const createProject = async (who, workspaceId, label) => {
    const name = `E2E ${label} ${stamp}`
    const { actionId, result } = await who.action(wsPath(workspaceId, 'projects'), 'createProject', [{
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
    path: `server action createProject(${A.actionId.slice(0, 12)}…) via POST ${wsPath(wsA, 'projects')}`,
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
  const cp = await admin.action(wsPath(wsA, 'projects'), 'createProject', [{ workspaceId: wsA, name: copyName, startDate: null, endDate: null, description: null,
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
  const meetingDate = todayInTz(await tzOfProject(A.id))   // SP5 A — 프로젝트에 저장된 tz 의 오늘
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
  // SP6 뒤로 주간보고 출력은 양식 엔진을 거친다 — 주간 영역이 0개인 프로젝트는 409 '설정 필요'다(영역이 있는 출력은 weekly-outputs·
  // weekly-registered-names 단계가 본다). 이 시점의 A 는 영역이 없으므로 보고서 둘은 그 거절을, WBS 엑셀은 파일을 확인한다.
  const reportRefusals = []
  for (const [kind, path, fallback] of exports) {
    if (kind.startsWith('report-')) {
      const refused = await admin.http('GET', path, { expect: 409 })
      const body = await refused.json()
      if (body?.error !== '설정 필요') throw new Fail(`${kind}: 영역 없는 프로젝트의 거절 문구가 다르다 — ${JSON.stringify(body)}`)
      reportRefusals.push({ kind, status: 409 })
      continue
    }
    const res = await admin.http('GET', path)
    const buf = Buffer.from(await res.arrayBuffer())
    const file = join(outDir, dispositionFilename(res.headers.get('content-disposition'), fallback))
    writeFileSync(file, buf)
    summary.artifacts.push({ kind, file, bytes: buf.length, contentType: res.headers.get('content-type') })
  }
  step('export', { files: summary.artifacts.map((a) => a.file), reportRefusals })

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
  slugOf.set(wsB, OTHER_WORKSPACE.slug)
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
  const createWorkspaceAdmin = async (workspaceId, who, pass) => {
    await admin.http('GET', wsPath(workspaceId, 'admin/accounts'))
    mustOk(`createAccount(${who.name})`, (await admin.action(wsPath(workspaceId, 'admin/accounts'), 'createAccount',
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
  const wbsTexts = (name) => ['작업 계획', name] // UI-3 통합 제목과 프로젝트 식별을 각각 확인한다.
  const visibility = []
  visibility.push(await see(carol, 'A(명단 멤버)', A.id, A.name, { expectTexts: [...wbsTexts(A.name), leaf.name] }))
  visibility.push(await see(carol, 'B(같은 워크스페이스, 명단 없음)', B.id, B.name, { expectTexts: wbsTexts(B.name) }))
  const denied = (await carol.action(`/p/${B.id}/meetings`, 'createMeeting', [B.id, meetingInput({ date: meetingDate, attendeeIds: [] })])).result
  same('carol 의 B 회의 생성', denied, { ok: false, error: ERR_DENIED })
  const bMeetings = rows('B 회의', await admin.sb.from('meetings').select('id').eq('project_id', B.id))
  same('B 회의 수', bMeetings.length, 0)
  visibility.push({ who: 'carol', project: 'B(같은 워크스페이스, 명단 없음)', action: 'createMeeting', result: denied, bMeetings: bMeetings.length })
  visibility.push(await see(carol, 'C(워크스페이스 B)', C.id, C.name, { hidden: true }))
  visibility.push(await see(carol, '미존재 id', missing, null, { hidden: true }))
  visibility.push(await see(admin, 'C(워크스페이스 B)', C.id, C.name, { expectTexts: wbsTexts(C.name) }))
  step('visibility', { carolUserId: carolUser.id, checks: visibility })

  // ── 14. A 관리자 ana(플랫폼 관리자 아님) — 부트스트랩 계정이 createAccount({ workspaceId: A }) 로 만든다. ana 가 createProject(A, …)
  // 로 E2E A2 를 만든다: 워크스페이스 관리 가드(requireWorkspaceAdmin)를 플랫폼 관리자 우회 없이 통과하는 경로다.
  const anaPassword = `E2E-${randomUUID()}`
  const anaWs = await createWorkspaceAdmin(wsA, A_ADMIN, anaPassword)
  same('ana 의 워크스페이스 소속', anaWs.memberships, [{ workspace_id: wsA, role: 'admin' }])
  if (anaWs.platformAdmin) throw new Fail('ana 가 플랫폼 관리자다 — 워크스페이스 관리 가드를 우회한다')
  const ana = session('ana')
  await ana.login(A_ADMIN.email, anaPassword)
  await ana.http('GET', wsPath(wsA, 'projects'))
  const A2 = await createProject(ana, wsA, 'A2')
  step('workspace-admin-project', {
    aAdmin: { email: A_ADMIN.email, userId: anaWs.userId, memberships: anaWs.memberships, platformAdmin: anaWs.platformAdmin },
    path: `server action createProject(${A2.actionId.slice(0, 12)}…) via POST ${wsPath(wsA, 'projects')} as ana`,
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
    await see(outsider, 'A2(초대받은 프로젝트)', A2.id, A2.name, { expectTexts: wbsTexts(A2.name) }),
    await see(outsider, 'C(워크스페이스 B)', C.id, C.name, { hidden: true }),
  ]
  step('outsider-invite', {
    inviteId: oInvite.row.id, email: OUTSIDER.email, userId: outsiderWs.userId, projectId: oRedeemed.projectId,
    memberships: outsiderWs.memberships, platformAdmin: outsiderWs.platformAdmin, checks: outsiderChecks, rows: outsiderWs.memberships.length,
  })

  // ── 16. 회의록 업로드(프로젝트 지정·미지정 각 1건) — 화면(MinuteUploadModal)과 같은 순서: 회의록 id 선발급 → 본문 .md 를 세션으로
  // Storage 에 올림(스토리지 RLS 가 판정) → createMinute(입력, 폴더 null, source). 올린 사람은 ana(플랫폼 관리자 아님).
  // 미지정 회의록의 담당은 그 워크스페이스의 공용 팀이어야 한다 — 부트스트랩은 팀을 만들지 않으므로 공용 팀 하나를 addTeam(A, …) 으로
  // 만든다(워크스페이스 관리 화면 /w/<slug>/admin/teams). Storage 객체 이름이 전부 ws/<A>/p/… 여야 한다.
  // 회의록 화면은 워크스페이스 범위다 — createMinute 의 넷째 인자는 화면의 슬러그 워크스페이스(프로젝트 없는 회의록의 범위, SP3b D26).
  await admin.http('GET', wsPath(wsA, 'admin/teams'))
  mustOk(`addTeam(${WS_TEAM})`, (await admin.action(wsPath(wsA, 'admin/teams'), 'addTeam', [wsA, WS_TEAM])).result)
  await ana.http('GET', wsPath(wsA, 'minutes'))
  const upload = async (label, projectId, teamCode) => {
    const minuteId = randomUUID()
    const title = `E2E-MIN-${label}-${stamp}`
    const bodyMd = `# ${title}\n\n- E2E 회의록 본문(${label})\n`
    const fileName = `e2e-${label.toLowerCase()}.md`
    const filePath = minuteBodyPath({ workspaceId: wsA, projectId, minuteId, fileName })
    const body = Buffer.from(bodyMd, 'utf8')
    const up = await ana.sb.storage.from('minutes').upload(filePath, body, { contentType: 'text/markdown', upsert: false })
    if (up.error) throw new Fail(`회의록 본문 업로드 실패(${label}): ${up.error.message}`)
    const created = mustOk(`createMinute(${label})`, (await ana.action(wsPath(wsA, 'minutes'), 'createMinute', [
      minuteInput({ date: meetingDate, teamCode, title, bodyMd, projectId }), null, minuteSource({ minuteId, fileName, filePath, size: body.length }), wsA,
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
  // 자기 워크스페이스(B)의 회의록 목록·프로젝트 목록 HTML(SSR·RSC 페이로드)에 A 의 회의록 제목·프로젝트 이름이 없다(대조: ana 의 A 회의록 목록에는 있다).
  // A 범위 화면(/w/<A>/…) 자체가 bea 에게 404 인 것은 sp3b-E4 가 본다.
  // A 경로로의 Storage 쓰기·A 객체 읽기는 스토리지 RLS 가 거부한다.
  const bea = session('bea')
  await bea.login(B_ADMIN.email, bPassword)
  const beaChecks = [
    await see(bea, 'A2(워크스페이스 A)', A2.id, A2.name, { hidden: true }),
    await see(bea, 'A(워크스페이스 A) 대시보드', A.id, A.name, { hidden: true, page: 'dashboard' }),
    await see(bea, 'C(자기 워크스페이스)', C.id, C.name, { expectTexts: wbsTexts(C.name) }),
  ]
  const titles = minutes.map((m) => m.title)
  const aNames = [A.name, B.name, A2.name]
  const beaMinutesHtml = await (await bea.http('GET', wsPath(wsB, 'minutes'))).text()
  const anaMinutesHtml = await (await ana.http('GET', wsPath(wsA, 'minutes'))).text()
  const beaProjectsHtml = await (await bea.http('GET', wsPath(wsB, 'projects'))).text()
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
      // 열린 화면의 표지 = 문서 제목. SP3b(V6)부터 워크스페이스 레이아웃의 제목 틀이 '<페이지> · <워크스페이스> | <제품>' 이다(전엔 '<워크스페이스> 설정 | …').
      // 본문 h1 '{이름} 설정' 은 SSR 이 두 텍스트 노드 사이에 주석을 끼워 한 문자열로 찾을 수 없다
      ...(hidden ? {} : { problems: pageProblems(html, [`<title>설정 · ${wsName} |`]) }),
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
  await admin.http('GET', `${wsPath(wsA, 'admin/accounts')}?project=${A.id}`, { expect: [200, 404] })
  await admin.http('GET', `/w/${encodeURIComponent(wsARow.slug)}/settings`)
  const flip = async (role) => mustOk(`setWorkspaceRole(${role})`, (await admin.action(wsPath(wsA, 'admin/accounts'), 'setWorkspaceRole', [wsA, anaWs.userId, role])).result)
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

  // ── 18. 외부 회의록 API(워크스페이스 자격증명 + user_email) — meta 의 projects·목록의 items 가 자격증명의 워크스페이스로만 좁혀진다.
  // A 자격증명으로 A 관리자(ana)·A 에 초대된 외부 계정은 C 를 못 보고, B 자격증명으로 B 관리자(bea)는 C 만 본다. 플랫폼 관리자도 A 자격증명으로는
  // A 뿐이다(승격 없음). 다른 워크스페이스의 자격증명으로는 그 사람이 403 unknown_user(그 워크스페이스의 사용자가 아님), 자격증명 형식이 아닌
  // Bearer 는 401, 모르는 이메일은 403 unknown_user, 볼 수 없는 프로젝트의 회의 목록은 404.
  const minutesTokenA = await issueMinutesToken(svc, wsA, me.id)
  const minutesTokenB = await issueMinutesToken(svc, wsB, me.id)
  const api = async (path, expect = 200, token = minutesTokenA) => {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, redirect: 'manual' })
    const body = await res.json().catch(() => null)
    if (res.status !== expect) throw new Fail(`GET ${path} → ${res.status}(기대 ${expect}): ${JSON.stringify(body)?.slice(0, 300)}`)
    return body
  }
  const meta = async (who, token = minutesTokenA) => {
    const body = await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent(who)}`, 200, token)
    if (!Array.isArray(body?.projects) || !Array.isArray(body?.teams)) throw new Fail(`meta(${who}) 응답 형식: ${JSON.stringify(body)?.slice(0, 300)}`)
    return { projectIds: body.projects.map((p) => p.id), teams: body.teams }
  }
  const listTitles = async (who, token = minutesTokenA) => {
    const body = await api(`/api/v1/minutes?user_email=${encodeURIComponent(who)}&per_page=100`, 200, token)
    if (!Array.isArray(body?.items)) throw new Fail(`목록(${who}) 응답 형식: ${JSON.stringify(body)?.slice(0, 300)}`)
    return body.items.map((i) => i.title)
  }
  const aIds = [A.id, B.id, A2.id]
  const metas = { ana: await meta(A_ADMIN.email), outsider: await meta(OUTSIDER.email), bea: await meta(B_ADMIN.email, minutesTokenB), platformAdmin: await meta(email) }
  const api18 = {
    meta: {
      ana: { projectIds: metas.ana.projectIds, leaked: leakedIds(metas.ana.projectIds, [C.id]), teams: metas.ana.teams },
      outsider: { projectIds: metas.outsider.projectIds, leaked: leakedIds(metas.outsider.projectIds, [C.id]) },
      bea: { projectIds: metas.bea.projectIds, leaked: leakedIds(metas.bea.projectIds, aIds), teams: metas.bea.teams },
      platformAdmin: { sees: leakedIds(metas.platformAdmin.projectIds, [...aIds, C.id]).sort() },
    },
    list: { ana: presentTexts((await listTitles(A_ADMIN.email)).join('\n'), titles), bea: presentTexts((await listTitles(B_ADMIN.email, minutesTokenB)).join('\n'), titles) },
  }
  same('ana meta 의 B 프로젝트', api18.meta.ana.leaked, [])
  same('outsider meta 의 B 프로젝트', api18.meta.outsider.leaked, [])
  same('bea meta 의 A 프로젝트', api18.meta.bea.leaked, [])
  same('bea meta 프로젝트', metas.bea.projectIds, [C.id])
  if (leakedIds(metas.ana.projectIds, aIds).length !== aIds.length) throw new Fail(`ana meta 에 A 프로젝트가 빠졌다: ${metas.ana.projectIds}`)
  if (!metas.outsider.projectIds.includes(A2.id)) throw new Fail('outsider meta 에 초대받은 A2 가 없다')
  if (!metas.ana.teams.includes(WS_TEAM)) throw new Fail(`ana meta 팀에 A 공용 팀 ${WS_TEAM} 이 없다: ${metas.ana.teams}`)
  if (metas.bea.teams.includes(WS_TEAM)) throw new Fail(`bea meta 팀에 A 공용 팀 ${WS_TEAM} 이 실렸다`)
  same('플랫폼 관리자 meta(A 자격증명 — A 뿐, 다른 워크스페이스로 넓어지지 않는다)', api18.meta.platformAdmin.sees, [...aIds].sort())
  const crossWs = {
    beaWithA: (await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent(B_ADMIN.email)}`, 403))?.code,
    anaWithB: (await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent(A_ADMIN.email)}`, 403, minutesTokenB))?.code,
    notACredential: (await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent(A_ADMIN.email)}`, 401, `e2e-${randomUUID()}`))?.code,
  }
  same('다른 워크스페이스 자격증명·자격증명 아닌 Bearer', crossWs, { beaWithA: 'unknown_user', anaWithB: 'unknown_user', notACredential: 'unauthorized' })
  same('ana 목록의 A 회의록(대조)', api18.list.ana, titles)
  same('bea 목록의 A 회의록', api18.list.bea, [])
  const unknown = await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent('e2e-nobody@example.com')}`, 403)
  same('모르는 이메일', unknown?.code, 'unknown_user')
  const hiddenMeetings = await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent(B_ADMIN.email)}&project_id=${A2.id}`, 404, minutesTokenB)
  step('minutes-api-scope', { ...api18, crossWs, unknownUser: { status: 403, code: unknown.code }, beaMeetingsOfA2: { status: 404, body: hiddenMeetings } })

  // ── 18b. SP4 A1(스펙 §6.3 — 단계는 이름으로 부른다, Q7). render-pages 앞이다 — 그 단계가 B 의 주간·설정 화면을 영역이 든 상태로 렌더한다.
  //    주 키는 앱이 정한다(weekKeyOf — W30): 러너는 날짜(오늘·±7일)를 넘기고 week_start 는 DB 에서 다시 읽는다. 오늘은 B 에 저장된 tz 다(SP5 A).
  const today = todayInTz(await tzOfProject(B.id))
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
    // SP5 D5 — 새 프로젝트는 워크스페이스 기본값(일요일)을 복사한다. 키는 앱이 정하고 러너는 요일·간격만 본다(W30)
    sundayKeys: dowOfIso(weeks.w0) === 0 && shiftDays(weeks.w0, 7) === weeks.w1 && shiftDays(weeks.w1, 7) === weeks.w2,
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
  const sendD = async (registerTeams, expect, convertToken = null) => (await admin.http('POST', '/api/import/execute', {
    body: importForm({ file: dFile, fileName: 'wbs-unregistered.xlsx', projectId: D.id, profile: profD, mode: 'append', commandId: KD, registerTeams, convertToken }), expect,
  })).json()
  const needs = await sendD(false, 409)
  const ownBefore = rows('D 전용 팀', await svc.from('teams').select('id').eq('project_id', D.id))
  // 등록 재요청은 409 가 준 전환 동의 토큰을 돌려보낸다(A1-5 R3) — 토큰 없는 등록은 전환 없이 다시 409 다
  const noToken = await sendD(true, 409)
  const ownAfterNoToken = rows('D 전용 팀', await svc.from('teams').select('id').eq('project_id', D.id))
  const done = await sendD(true, 200, needs.convertToken)
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
    tokenRequired: noToken.ok === false && noToken.code === 'NEEDS_TEAMS' && noToken.convertToken === needs.convertToken && ownAfterNoToken.length === 0
      && typeof needs.convertToken === 'string',
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

  // ── 18c. SP4 A2(스펙 §6.3 — 단계는 이름으로 부른다). 팀 원천은 요청 범위라(프로세스 전역 캐시 없음) 같은 서버 프로세스에서 방금 만든 팀을
  //    가져오기가 바로 본다 — 옛 캐시는 모듈 인스턴스마다 60초 TTL 이라 next start 에서 409(needsTeams)였다(KLC:56). 양식은 저장하지 않는다 —
  //    다음 단계가 이 프로젝트를 "저장 양식 없음"으로 내보낸다.
  const N = await createProject(admin, wsA, 'N')
  const serverMode = nextServerMode(await (await admin.http('GET', `/p/${N.id}/settings`)).text())   // next start 인지(W3) — dev 면 이 단계는 근거가 아니다
  mustOk(`addProjectTeam(${A2_TEAM})`, (await admin.action(`/p/${N.id}/settings`, 'addProjectTeam', [N.id, A2_TEAM])).result)
  const nRows = e2eRows(A2_TEAM)
  const nFile = await fillWbsWorkbook(nRows)
  const nInspected = await (await admin.http('POST', '/api/import/inspect', {
    body: inspectForm({ file: nFile, fileName: 'wbs-n.xlsx', projectId: N.id }),
  })).json()
  const nCmd = randomUUID()
  let nApplied
  try {
    nApplied = await (await admin.http('POST', '/api/import/execute', {
      body: importForm({ file: nFile, fileName: 'wbs-n.xlsx', projectId: N.id, profile: nInspected.detection.profile, mode: 'append',
        commandId: nCmd, saveProfile: false, registerTeams: false }),
    })).json()
  } catch (e) {
    if (e instanceof Fail && e.message.includes('→ 409')) {
      throw new Fail(`${e.message} — 방금 만든 팀을 가져오기가 못 봤다(프로세스 전역 팀 캐시가 남았다 — SP4 A2 결함)`)
    }
    throw e
  }
  const nItems = rows('N 항목', await admin.sb.from('wbs_items').select('id, item_owners(teams(code))').eq('project_id', N.id))
  const nCheck = {
    applied: nApplied.ok === true && nApplied.kind === 'applied' && nApplied.commandId === nCmd,
    items: nItems.length === nRows.length,
    owned: nItems.some((i) => i.item_owners.some((o) => o.teams?.code === A2_TEAM)),
    nextStart: serverMode === 'production',
  }
  step('teams-source-next-start', { projectId: N.id, serverMode, commandId: nCmd, response: importResultView(nApplied), items: nItems.length, checks: nCheck },
    Object.values(nCheck).every(Boolean) ? undefined : `방금 만든 팀으로 가져오기: ${JSON.stringify(nCheck)}`)

  // export-standard — 저장 양식이 없는 N 의 엑셀 내보내기(접기·펼침) 둘 다 200·X-Excel-Layout standard(SP4 §4.3 — 예전 펼침은 409),
  // 텍스트 파트(시트·공유 문자열·docProps)에 SP4 센티널 0 — N 이 스스로 등록한 팀 code·name 은 뺀다(D8).
  const nTeams = rows('N 팀', await admin.sb.from('teams').select('code, name').eq('project_id', N.id))
  const nSentinels = excludeRegistered(sp4Sentinels(), nTeams.flatMap((t) => [t.code, t.name]))
  const nExports = []
  for (const expand of [false, true]) {
    const res = await admin.http('GET', `/api/export?projectId=${N.id}${expand ? '&expand=1' : ''}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const file = join(outDir, `wbs-n${expand ? '-expand' : ''}.xlsx`)
    writeFileSync(file, buf)
    nExports.push({ expand, status: res.status, layout: res.headers.get('x-excel-layout'), file, hits: sentinelReport(await zipTextParts(buf), nSentinels) })
  }
  const exportCheck = {
    ok: nExports.every((e) => e.status === 200),
    standard: nExports.every((e) => e.layout === 'standard'),
    noSentinels: nExports.every((e) => e.hits.length === 0),
  }
  step('export-standard', { projectId: N.id, exports: nExports, checks: exportCheck },
    Object.values(exportCheck).every(Boolean) ? undefined : `표준 내보내기: ${JSON.stringify(exportCheck)}`)

  // ── 18d. SP5 A 달력(스펙 §6.3 — 단계는 이름으로 부른다). 프로젝트는 단계마다 새로(기존 A·B 의 주간·WBS 를 건드리지 않는다). 주간 문서는 영역이 있어야
  //    하므로(SP4 W1) 영역 하나(CAL)를 둔다. 라벨은 전환 없는 키에서만 러너가 계산한다(plainWeekLabel — 과도기 라벨은 단위 테스트가 정본).
  const calTag = randomUUID().slice(0, 6)
  const calArea = { code: 'CAL', name: '달력 영역', sortOrder: 1, teams: [] }
  const newCalProject = async (label) => {
    const name = `E2E 달력 ${label} ${calTag}`
    await admin.http('GET', wsPath(wsA, 'projects'))
    mustOk(`${label} createProject`, (await admin.action(wsPath(wsA, 'projects'), 'createProject', [{
      workspaceId: wsA, name, startDate: null, endDate: null, description: null, levelLabels: LEVEL_LABELS, commandId: randomUUID(),
    }])).result)
    return rows(`${label} 프로젝트`, await admin.sb.from('projects').select('id, workspace_id').eq('name', name).single())
  }
  const setProject = async (p, set) => {
    await admin.http('GET', `/p/${p.id}/settings`)
    const doc = rows('프로젝트 설정', await admin.sb.from('project_settings').select('revision').eq('project_id', p.id).single())
    return mustOk('updateProjectSettings', (await admin.action(`/p/${p.id}/settings`, 'updateProjectSettings',
      [p.id, { expectedRevision: doc.revision, commandId: randomUUID(), set, unset: [] }])).result)
  }
  const storedOf = async (p) => rows('프로젝트 설정', await admin.sb.from('project_settings').select('values').eq('project_id', p.id).single()).values
  const withArea = async (p) => {
    await admin.http('GET', `/p/${p.id}/settings`)
    return putArea(p, areaInput(calArea, new Map()))
  }

  // calendar-week-sunday — S(일요일 기본, 월~금)와 M(월요일, 월~토 — 문서 전에 설정)에 같은 2주(오늘·+7, 이월). 키 요일·간격, 화면 라벨·범위,
  // 기본 보고서(xlsx) 라벨 'YYYY년 M월 N주차 (범위)'(개정 §4.2.9 셋째 — P2-§5-accept 일요일 시작 보고)
  const calS = await newCalProject('S')
  const calM = await newCalProject('M')
  await setProject(calM, { 'calendar.week_start': 'monday', 'calendar.working_days': [1, 2, 3, 4, 5, 6] })
  const sundayWeek = {}
  for (const [label, p, ruleDow, firstOffset, displayLen] of [['S', calS, 0, 1, 5], ['M', calM, 1, 0, 6]]) {
    const area = await withArea(p)
    const pToday = todayInTz(await tzOfProject(p.id))
    await admin.http('GET', `/p/${p.id}/weekly`)
    const w1 = mustOk(`${label} W1`, await createWeek(p, pToday, false))
    const w1Rows = await weeklyRowsOf(w1.reportId)
    await saveCells(p, [{ rowId: rowFor(w1Rows, area.id).id, cellKey: 'next_content', content: `달력 이월 ${label}` }])
    const w2 = mustOk(`${label} W2`, await createWeek(p, shiftDays(pToday, 7), true))
    const weeks = { w1: await weekStartOf(w1.reportId), w2: await weekStartOf(w2.reportId) }
    const w2Rows = await weeklyRowsOf(w2.reportId)
    const labels = { w1: plainWeekLabel(weeks.w1).label, w2: plainWeekLabel(weeks.w2).label }
    // 표시 요일 = 기간 안 근무일 — S 는 키 + 1(월)~+5(금), M 은 키(월)~+5(토)
    const ranges = { w1: rangeText(shiftDays(weeks.w1, firstOffset), shiftDays(weeks.w1, firstOffset + displayLen - 1)) }
    const html = await (await admin.http('GET', `/p/${p.id}/weekly?week=${weeks.w1}`)).text()
    const report = await fetchZip(`/api/report?projectId=${p.id}&format=xlsx`, `calendar-${label}-report.xlsx`)
    const reportText = report.entries.map((x) => x.text).join('\n')
    const { year } = plainWeekLabel(weeks.w1)
    const reportLabel = `${year}년 ${labels.w1} (${ranges.w1})`
    sundayWeek[label] = {
      projectId: p.id, weeks, dows: [dowOfIso(weeks.w1), dowOfIso(weeks.w2)], labels, ranges, reportLabel,
      checks: {
        ruleKeys: dowOfIso(weeks.w1) === ruleDow && shiftDays(weeks.w1, 7) === weeks.w2 && weeks.w1 <= pToday && shiftDays(weeks.w1, 6) >= pToday,
        carried: rowFor(w2Rows, area.id).this_content === `달력 이월 ${label}`,
        pageLabel: presentTexts(html, [labels.w1, ranges.w1]).length === 2,
        reportLabel: reportText.includes(reportLabel),
      },
    }
  }
  const sundayOk = ['S', 'M'].every((k) => Object.values(sundayWeek[k].checks).every(Boolean))
  step('calendar-week-sunday', sundayWeek, sundayOk ? undefined : `일요일·월요일 주: ${JSON.stringify(sundayWeek)}`)

  // calendar-week-transition — T 를 월요일로 시작해 지난주·이번 주 문서를 만든 뒤 일요일로 전환(D5·D38). 미리보기의 E = 저장된 규칙의 E,
  // 과도기 6일(월~토), 기존 문서 그대로, E 앞날의 키 = 과도기 키(월요일), E 의 키 = E(일요일). 과거 URL(옛 월요일)·과도기 안 날짜 URL 이 같은 문서를 연다
  const calT = await newCalProject('T')
  await setProject(calT, { 'calendar.week_start': 'monday' })
  await withArea(calT)
  const tToday = todayInTz(await tzOfProject(calT.id))
  await admin.http('GET', `/p/${calT.id}/weekly`)
  const tPast = mustOk('T 지난주', await createWeek(calT, shiftDays(tToday, -7), false))
  const tNow = mustOk('T 이번 주', await createWeek(calT, tToday, false))
  const tPastKey = await weekStartOf(tPast.reportId)
  await admin.http('GET', `/p/${calT.id}/settings`)
  const preview = mustOk('T 미리보기', (await admin.action(`/p/${calT.id}/settings`, 'previewWeekStartChange', [calT.id, 'sunday'])).result).preview
  await setProject(calT, { 'calendar.week_start': 'sunday' })
  const tStored = (await storedOf(calT))['calendar.week_start']
  const e = preview.effectiveFrom
  await admin.http('GET', `/p/${calT.id}/weekly`)
  const kpDoc = mustOk('T 과도기 주', await createWeek(calT, shiftDays(e, -1), false))
  const kp = await weekStartOf(kpDoc.reportId)
  const eDoc = mustOk('T 전환 뒤 첫 주', await createWeek(calT, e, false))
  const eKey = await weekStartOf(eDoc.reportId)
  const pastHtml = await (await admin.http('GET', `/p/${calT.id}/weekly?week=${tPastKey}`)).text()
  const midHtml = await (await admin.http('GET', `/p/${calT.id}/weekly?week=${shiftDays(kp, 2)}`)).text()
  const transition = {
    projectId: calT.id, preview, stored: tStored, kp, e, docs: { past: tPastKey, now: await weekStartOf(tNow.reportId), kp, e: eKey },
    checks: {
      previewMatchesStored: JSON.stringify(tStored) === JSON.stringify([{ day: 'monday', from: null }, { day: 'sunday', from: e }]),
      effectiveSunday: typeof e === 'string' && dowOfIso(e) === 0 && e > tToday,
      sixDays: preview.transitionDays === 6 && dowOfIso(kp) === 1 && shiftDays(kp, 6) === e,
      keptDocs: preview.keptDocs === 2 && Array.isArray(preview.blockingWeeks) && preview.blockingWeeks.length === 0,
      eKey: eKey === e,
      pastUrl: pastHtml.includes(tPast.reportId),
      midTransitionUrl: midHtml.includes(kpDoc.reportId),
    },
  }
  step('calendar-week-transition', { ...transition, pastUrl: `/p/${calT.id}/weekly?week=${tPastKey}`, midTransitionUrl: `/p/${calT.id}/weekly?week=${shiftDays(kp, 2)}` },
    Object.values(transition.checks).every(Boolean) ? undefined : `주 시작 전환: ${JSON.stringify(transition)}`)

  // calendar-tz — 워크스페이스 A(Pago Pago)와 새 프로젝트(Kiritimati)를 서로 다른 tz 로 둔다(UTC−11·UTC+14, 날짜 경계가 항상 갈린다).
  // 프로젝트 '오늘' 기준 주간 문서·공지와 워크스페이스 '오늘'을 따로 계산한다. 사용현황 일자는 결정적 순간
  // (2026-01-15T03:30Z — Pago Pago 01-14·UTC 01-15)의 이벤트 한 행으로 두 tz 를 비교한다(행은 로컬 픽스처 — 끝에 지운다). 끝에 워크스페이스 tz 를 되돌린다
  // (키가 없던 워크스페이스면 unset — 뒤 단계의 '오늘'이 원래 tz 를 전제한다).
  const wsPage = `/w/${encodeURIComponent(wsARow.slug)}/settings`   // wsARow — 단계 16 이 읽은 워크스페이스 A 의 슬러그
  const wsTzBefore = rows('워크스페이스 A 설정', await svc.from('workspace_settings').select('values').eq('workspace_id', wsA).single()).values['calendar.timezone']
  const setWorkspaceTz = async (tz) => {
    await admin.http('GET', wsPage)
    const doc = rows('워크스페이스 설정', await admin.sb.from('workspace_settings').select('revision').eq('workspace_id', wsA).single())
    const patch = tz === undefined ? { set: {}, unset: ['calendar.timezone'] } : { set: { 'calendar.timezone': tz }, unset: [] }
    return mustOk('updateWorkspaceSettings', (await admin.action(wsPage, 'updateWorkspaceSettings', [wsA, { expectedRevision: doc.revision, commandId: randomUUID(), ...patch }])).result)
  }
  const WORKSPACE_TZ = 'Pacific/Pago_Pago'
  const PROJECT_TZ = 'Pacific/Kiritimati'
  let tzStep
  await setWorkspaceTz(WORKSPACE_TZ)
  try {
    const calL = await newCalProject('L')
    await setProject(calL, { 'calendar.timezone': PROJECT_TZ })
    const lStored = await storedOf(calL)
    const workspaceTzStored = storedTimezone(rows('워크스페이스 시간대', await svc.from('workspace_settings').select('values').eq('workspace_id', wsA).single()).values)
    await withArea(calL)
    const lToday = todayInTz(PROJECT_TZ)
    const workspaceToday = todayInTz(WORKSPACE_TZ)
    await admin.http('GET', `/p/${calL.id}/weekly`)
    const lDoc = mustOk('L 이번 주', await createWeek(calL, lToday, false))
    const lHtml = await (await admin.http('GET', `/p/${calL.id}/weekly`)).text()
    const lAfter = todayInTz(PROJECT_TZ)
    await admin.http('GET', `/p/${calL.id}/announcements`)
    const annNow = `E2E 오늘 게시 ${calTag}`
    const annLater = `E2E 내일 게시 ${calTag}`
    for (const [title, from] of [[annNow, lToday], [annLater, shiftDays(lToday, 1)]]) {
      mustOk(`공지 ${title}`, (await admin.action(`/p/${calL.id}/announcements`, 'createAnnouncement', [calL.id, {
        title, body: '시간대 확인용', category: 'general', isPinned: false, publishFrom: from, publishTo: shiftDays(lToday, 1), milestoneDate: null,
      }])).result)
    }
    // 공지 '오늘 게시중' 판정 = 프로젝트 tz 의 오늘 — 헤더 티커는 UI-2 가 지웠으므로 셸의 안읽음 배지(같은 판정)로 본다. createAnnouncement 는 작성자의
    // 읽음 표시를 방금 만든 공지로 올린다(자기 공지는 읽음 — 앱 의도) — 그대로 세면 0 이라 판정을 못 본다(체크포인트 A 첫 실행의 빨강). 작성자 워터마크를
    // 걷고 세면 안읽음 = 오늘 게시중인 공지 수 = annNow 하나(annLater 는 내일부터). 관리자는 공지 화면을 HTTP 로만 열어 다시 읽음 표시되지 않는다
    rows('작성자 읽음 표시 걷기', await svc.from('announcement_seen').delete().eq('user_id', me.id).eq('project_id', calL.id).select('project_id'))
    const shell = await (await admin.http('GET', `/api/shell?ws=${wsA}&project=${calL.id}`)).json()
    const unreadBadge = shell?.badges?.projectUnreadAnnouncements ?? null
    // 포털 홈 공지 카드도 같은 판정(과제 32 — 프로젝트마다 그 tz 의 오늘): 오늘 게시만 있고 내일 게시는 없다
    const homeHtml = await (await admin.http('GET', wsPath(wsA, ''))).text()
    const instant = '2026-01-15T03:30:00Z'
    const ev = rows('사용 이벤트 픽스처', await svc.from('usage_events').insert({
      user_id: me.id, menu_key: 'weekly', path: '/e2e-calendar-tz', project_id: null, occurred_at: instant, event_name: 'page_view',
    }).select('id').single())
    let usage
    try {
      const day = async (tz) => {
        const { data, error } = await admin.sb.rpc('usage_daily_actives', { p_from: '2026-01-13', p_to: '2026-01-16', p_timezone: tz })
        if (error) throw new Fail(`usage_daily_actives(${tz}): ${error.message}`)
        return (data ?? []).filter((r) => r.events > 0).map((r) => String(r.d))
      }
      // 일자 판독을 /usage GET 보다 먼저 — 그 화면의 after()(purgeOldUsageEvents)가 보존 기간(90일) 밖인 이 픽스처를 지운다(체크포인트 A 첫 실행에서
      // Pago Pago 판독 뒤 UTC 판독이 빈 배열이었다 — 경합)
      const la = await day(WORKSPACE_TZ)
      const utc = await day('UTC')
      const bad = await admin.sb.rpc('usage_daily_actives', { p_from: '2026-01-13', p_to: '2026-01-16', p_timezone: 'Asia/Seol' })
      const usageHtml = await (await admin.http('GET', wsPath(wsA, 'usage'))).text()
      usage = { la, utc, invalidCode: bad.error?.code ?? null, tzNote: usageHtml.replace(/<!-- -->/g, '').includes(`${WORKSPACE_TZ} 기준`) }   // '{timezone} 기준' 은 JSX 보간 — SSR 이 텍스트 노드 사이에 <!-- --> 를 넣는다
    } finally {
      await svc.from('usage_events').delete().eq('id', ev.id)
    }
    tzStep = {
      projectId: calL.id, seeded: { workspaceTimezone: workspaceTzStored, projectTimezone: lStored['calendar.timezone'], weekStart: lStored['calendar.week_start'] },
      today: { workspace: workspaceToday, project: lToday, distinct: workspaceToday !== lToday },
      reportOnPage: lHtml.includes(lDoc.reportId) || lToday !== lAfter, unreadBadge, portalHome: { now: homeHtml.includes(annNow), later: homeHtml.includes(annLater) }, usage,
      checks: {
        seeded: workspaceTzStored === WORKSPACE_TZ && lStored['calendar.timezone'] === PROJECT_TZ
          && JSON.stringify(lStored['calendar.week_start']) === JSON.stringify([{ day: 'sunday', from: null }]),
        todayPair: workspaceToday !== lToday,
        // 자정을 넘긴 순간이면 다음 키 화면이 정답이다 — 그때는 이 항목을 판정하지 않는다(lToday !== lAfter)
        today: lHtml.includes(lDoc.reportId) || lToday !== lAfter,
        badge: unreadBadge === 1,
        portal: homeHtml.includes(annNow) && !homeHtml.includes(annLater),
        usageDays: usage.la.includes('2026-01-14') && !usage.la.includes('2026-01-15') && usage.utc.includes('2026-01-15') && !usage.utc.includes('2026-01-14'),
        usageInvalid: usage.invalidCode === '22023',
        tzNote: usage.tzNote,   // SP8 뒤로 사용 현황은 그 워크스페이스의 시간대로 센다(예전엔 전체 합산이라 UTC 고정이었다)
      },
    }
  } finally {
    await setWorkspaceTz(wsTzBefore)
  }
  const wsTzAfter = rows('워크스페이스 A 설정(복귀)', await svc.from('workspace_settings').select('values').eq('workspace_id', wsA).single()).values['calendar.timezone']
  tzStep.restored = wsTzAfter === wsTzBefore
  step('calendar-tz', tzStep, Object.values(tzStep.checks).every(Boolean) && tzStep.restored ? undefined : `시간대: ${JSON.stringify(tzStep)}`)
  const calL = { id: tzStep.projectId }

  // calendar-workday — W(월~금)에서 계획 기간이 토요일 하루인 작업은 근무일이 없어 의존성을 걸 수 없다 → 그 토요일을 'work' 예외로 등록하면 걸린다
  // (앱 검사·DB 트리거가 같은 판정 — D37). 예외 없는 토요일로 옮기면 DB 의존성 트리거가 거부한다. 기준일 = 그 토요일이면 계획% 100(1/1 근무일)
  const calW = await newCalProject('W')
  const wToday = todayInTz(await tzOfProject(calW.id))
  const sat = nextDowOnOrAfter(shiftDays(wToday, 7), 6)
  const fri = shiftDays(sat, -1)
  await admin.http('GET', `/p/${calW.id}/wbs`)
  const pred = mustOk('W 선행', (await admin.action(`/p/${calW.id}/wbs`, 'addWbsItem', [calW.id, null, 'E2E 선행'])).result)
  const succ = mustOk('W 후행', (await admin.action(`/p/${calW.id}/wbs`, 'addWbsItem', [calW.id, null, 'E2E 후행'])).result)
  mustOk('W 선행 기간', (await admin.action(`/p/${calW.id}/wbs`, 'updateWbsFields', [pred.id, { plannedStart: fri, plannedEnd: fri }])).result)
  mustOk('W 후행 기간', (await admin.action(`/p/${calW.id}/wbs`, 'updateWbsFields', [succ.id, { plannedStart: sat, plannedEnd: sat }])).result)
  const link = async () => (await admin.action(`/p/${calW.id}/wbs`, 'addTaskDependency', [calW.id, pred.id, succ.id, 'FS', 0])).result
  const beforeWork = await link()
  await admin.http('GET', `/p/${calW.id}/settings`)
  await admin.action(`/p/${calW.id}/settings`, 'addHoliday', [calW.id, sat, 'E2E 토요 근무', 'work'])
  const holidayRow = rows('W 날짜 예외', await admin.sb.from('holidays').select('date, kind').eq('project_id', calW.id).eq('date', sat))
  const afterWork = await link()
  const plainSat = shiftDays(sat, 7)
  await admin.http('GET', `/p/${calW.id}/wbs`)
  const moved = (await admin.action(`/p/${calW.id}/wbs`, 'updateWbsFields', [succ.id, { plannedStart: plainSat, plannedEnd: plainSat }])).result
  const succNow = rows('W 후행(다시 읽기)', await admin.sb.from('wbs_items').select('planned_start, planned_end').eq('id', succ.id).single())
  await admin.http('GET', `/p/${calW.id}/settings`)
  mustOk('W 기준일', (await admin.action(`/p/${calW.id}/settings`, 'setBaseDate', [calW.id, sat])).result)
  const wExport = await admin.http('GET', `/api/export?projectId=${calW.id}`)
  const wPct = await plannedPctByName(Buffer.from(await wExport.arrayBuffer()), ['E2E 후행'])
  mustOk('W 기준일 자동', (await admin.action(`/p/${calW.id}/settings`, 'setBaseDate', [calW.id, null])).result)
  const workday = {
    projectId: calW.id, saturday: sat, beforeWork, afterWork, plainSaturday: { result: moved, item: succNow }, plannedPct: wPct['E2E 후행'], holiday: holidayRow,
    checks: {
      beforeRejected: beforeWork?.ok === false,
      holidayWork: holidayRow.length === 1 && holidayRow[0].kind === 'work',
      afterLinked: afterWork?.ok === true,
      plainSaturdayRejected: moved?.ok === false && succNow.planned_start === sat && succNow.planned_end === sat,
      planned100: wPct['E2E 후행'] === 100,
    },
  }
  step('calendar-workday', workday, Object.values(workday.checks).every(Boolean) ? undefined : `근무 예외: ${JSON.stringify(workday)}`)

  // ── 19. 관리자 세션으로 주요 화면 렌더(눈확인의 기계 부분) — 스트리밍된 오류 digest·notFound·열화 표시가 없고, 흐름에서 만든
  // 데이터가 그 페이지 세그먼트에 실려 있어야 한다(조회 실패를 빈 목록으로 그리는 화면은 오류 표식이 없다). 프로젝트 목록(/w/<A>/projects)은
  // 프로젝트 이름이 셸(전환기)에도 있으므로 카드 링크(`/p/<id>/dashboard`)로 본다.
  // B 단계(20~23) 앞이다 — 모듈을 끄기 전에 켜진 화면이 열려야 한다.
  const pages = [
    [wsPath(wsA, 'projects'), [`/p/${A.id}/dashboard`, `/p/${B.id}/dashboard`]],
    [`/p/${A.id}/dashboard`, []],
    [`/p/${A.id}/members`, ['bob', INVITEE.name]],
    [`/p/${A.id}/meetings`, [meetingInput({ date: meetingDate, attendeeIds: [] }).title]],
    [`/p/${A.id}/issues`, []],
    [`/p/${A.id}/announcements`, []],
    [`/p/${A.id}/weekly`, []],
    [`/p/${A.id}/wbs`, [leaf.name]],
    [`/p/${A.id}/attendance`, []],
    [wsPath(wsA, 'minutes'), titles],
    // SP4 A1 — B 의 주간(이번 주 W1: 개명한 실험·비활성 운영·신규)과 설정(주간 영역 편집기)
    [`/p/${B.id}/weekly`, [exp.renamed, fresh.name]],
    [`/p/${B.id}/settings`, [exp.renamed, fresh.name]],
    // SP5 A — 일요일 프로젝트의 주간(라벨·범위), 전환 프로젝트의 과거 URL(옛 월요일 키 — 같은 문서), Kiritimati 프로젝트 설정(달력 절)
    [`/p/${calS.id}/weekly?week=${sundayWeek.S.weeks.w1}`, [sundayWeek.S.labels.w1]],
    [`/p/${calT.id}/weekly?week=${transition.docs.past}`, []],
    [`/p/${calL.id}/settings`, ['Pacific/Kiritimati']],
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

  // ── SP4 B — 팀 색 렌더(스펙 §6.3 teams-color-render, 재검토 반영 T12). UI 위험 파일(TeamsProvider·범위 레이아웃 셋)의 깨짐은 빌드·테스트로
  // 잡히지 않는다(CLAUDE.md) — 팀이 있는 프로젝트 A 의 화면이 팀 슬롯 클래스를 그리고 옛 team-N 클래스가 없음을 본다. 회의록은 워크스페이스
  // 범위(공용 팀 WS_TEAM 담당). 보고서는 모달이라 서버 HTML 에 없다 — Playwright 로 WBS 도구 줄의 보고서 버튼을 눌러 그 DOM 을 본다.
  {
    const seen = []
    for (const path of [`/p/${A.id}/wbs`, `/p/${A.id}/wbs?view=board`, `/p/${A.id}/dashboard`, wsPath(wsA, 'minutes')]) {
      const html = await (await admin.http('GET', path)).text()
      seen.push({ path, serverMode: nextServerMode(html), problems: pageProblems(html), ...teamSlotVerdict(html) })
    }
    const reportPath = `/p/${A.id}/wbs#report`
    try {
      const { loadPlaywright } = await import('./ui-capture.mjs')
      const { chromium } = await loadPlaywright()
      const browser = await chromium.launch()
      try {
        const origin = new URL(base).origin
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
        await ctx.addCookies([...admin.jar].map(([name, value]) => ({ name, value, url: origin })))
        const page = await ctx.newPage()
        const errs = []
        page.on('pageerror', (e) => errs.push(String(e)))
        await page.goto(`${origin}/p/${A.id}/wbs`, { waitUntil: 'networkidle' })
        await page.locator('[data-wbs-weekly-report]').first().click()
        const dialog = page.locator('[role="dialog"]').first()
        await dialog.waitFor({ timeout: 15_000 })
        seen.push({ path: reportPath, problems: errs, ...teamSlotVerdict(await dialog.innerHTML()) })
      } finally { await browser.close() }
    } catch (e) {
      seen.push({ path: reportPath, problems: [`playwright: ${String(e?.message ?? e).slice(0, 200)}`], slots: [], legacy: [], neutral: 0 })
    }
    const bad = seen.filter((s) => s.problems.length || !s.slots.length || s.legacy.length || (s.serverMode !== undefined && s.serverMode !== 'production'))
    step('teams-color-render', { pages: seen }, bad.length ? `팀 색 렌더 실패: ${JSON.stringify(bad)}` : undefined)
  }

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

  // ── issue-code-flow (SP5 B1, P1-AC2): 기본 코드·영역 코드·분석서·색인·모듈 전환을 한 흐름으로 확인한다.
  const basicName = `E2E 코드 기본 ${randomUUID().slice(0, 8)}`
  await admin.http('GET', wsPath(wsA, 'projects'))
  mustOk('E2E 코드 기본 프로젝트', (await admin.action(wsPath(wsA, 'projects'), 'createProject', [{
    workspaceId: wsA, name: basicName, startDate: null, endDate: null, description: null, levelLabels: LEVEL_LABELS, commandId: randomUUID(),
  }])).result)
  const basic = rows('E2E 코드 기본 프로젝트 조회', await admin.sb.from('projects').select('id').eq('name', basicName).single())
  await admin.http('GET', `/p/${basic.id}/issues`)
  const basicCreated = mustOk('ISS-001 기본 이슈', (await admin.action(`/p/${basic.id}/issues`, 'createIssue', [basic.id, {
    title: 'E2E 기본 코드 이슈', body: '분석 없이 등록', severity: 'medium', assigneeMemberIds: [], startDate: null, dueDate: null,
    areaId: null, analysis: null,
  }])).result)
  const [basicIssue] = rows('기본 이슈 다시 읽기', await admin.sb.from('issues').select('id, issue_no, code').eq('id', basicCreated.id))
  if (basicCreated.code !== 'ISS-001' || basicIssue?.code !== 'ISS-001') throw new Fail(`새 프로젝트 기본 코드는 ISS-001 이어야 한다: ${JSON.stringify({ action: basicCreated.code, row: basicIssue })}`)

  const aSettingsBefore = rows('A 이슈 흐름 설정 백업', await admin.sb.from('project_settings').select('revision, values').eq('project_id', A.id).single())
  const aModulesBefore = aSettingsBefore.values['modules.enabled']
  const aPolicyBefore = aSettingsBefore.values['issues.id_policy']
  const updateASettings = async (set, unset = []) => {
    await admin.http('GET', `/p/${A.id}/settings`)
    const doc = rows('A 이슈 흐름 설정', await admin.sb.from('project_settings').select('revision').eq('project_id', A.id).single())
    return mustOk('A 이슈 흐름 설정 갱신', (await admin.action(`/p/${A.id}/settings`, 'updateProjectSettings',
      [A.id, { expectedRevision: doc.revision, commandId: randomUUID(), set, unset }])).result)
  }
  const analysisPolicy = { prefix: 'E2E', pattern: '{prefix}-{area}-{seq:3}', counter_scope: 'area', reset: 'never' }
  const hasIndexKey = /^(OPENAI|ANTHROPIC|AI_GATEWAY)[A-Z_]*=.+/m.test(envText)
  const enabledForIssueFlow = [...new Set([...aModulesBefore, 'issue_analysis', ...(hasIndexKey ? ['chatbot'] : [])])]
  await updateASettings({ 'issues.id_policy': analysisPolicy, 'modules.enabled': enabledForIssueFlow })
  await admin.http('GET', `/p/${A.id}/settings`)
  const analysisArea = mustOk('RND issue_area', (await admin.action(`/p/${A.id}/settings`, 'upsertArea', [A.id, {
    kind: 'issue_area', code: 'RND', name: '연구', sortOrder: 1, active: true, teams: [],
  }])).result)
  const areaId = analysisArea.id
  await admin.http('GET', `/p/${A.id}/issues`)
  const richIssue = mustOk('E2E 분석 분류 이슈', (await admin.action(`/p/${A.id}/issues`, 'createIssue', [A.id, {
    title: 'E2E 영역 코드 이슈', body: '영역 코드와 분석 분류가 연결된다.', severity: 'high', assigneeMemberIds: [], startDate: null, dueDate: null,
    areaId, analysis: { majorName: 'E2E 원인', subProcess: '등록 절차', ownerDepartment: 'E2E 부서', relatedSystems: ['E2E 시스템'], sourceType: 'other', sourceDetail: 'E2E 인터뷰' },
  }])).result)
  if (richIssue.code !== 'E2E-RND-001') throw new Fail(`영역 이슈 코드가 다르다: ${richIssue.code}`)
  const [richRow] = rows('영역 코드 이슈 다시 읽기', await admin.sb.from('issues')
    .select('id, issue_no, code, area_id, code_area_id').eq('id', richIssue.id))
  if (!richRow || richRow.code !== 'E2E-RND-001' || richRow.area_id !== areaId || richRow.code_area_id !== areaId) {
    throw new Fail(`이슈 영역 외래 키가 다르다: ${JSON.stringify(richRow)}`)
  }
  const issueHtmlBeforeRename = await (await admin.http('GET', `/p/${A.id}/issues`)).text()
  if (!issueHtmlBeforeRename.includes(richRow.code) || issueHtmlBeforeRename.includes(`#${richRow.issue_no}`)) {
    throw new Fail('이슈 목록은 업무 코드를 표시하고 #issue_no 를 숨겨야 한다')
  }

  const analysisJson = { ...issueAnalysisRunFixture({ areaCode: 'RND', areaName: '연구', issueId: richRow.id, code: richRow.code }), projectId: A.id }
  const [analysisRun] = rows('E2E 저장 분석 실행', await svc.from('issue_analysis_runs').insert({
    project_id: A.id, input_hash: createHash('sha256').update(`${A.id}:${richRow.id}`).digest('hex'), prompt_version: 'e2e-issue-code-flow',
    model: 'e2e-fixture', status: 'ready', analysis_json: analysisJson, input_snapshot: {}, issue_count: 1, created_by: me.id,
  }).select('id'))
  const deckRes = await admin.http('GET', `/api/issue-analysis?projectId=${A.id}&runId=${analysisRun.id}`)
  const deck = Buffer.from(await deckRes.arrayBuffer())
  const deckCheck = await zipHasAll(deck, ['E2E-RND-001', '연구'])
  if (!deckCheck.ok) throw new Fail(`분석서 텍스트에 영역·이슈 코드가 없다: ${deckCheck.missing.join(', ')}`)

  let bot = { mode: 'unit-only', evidence: 'tests/ai/index-issue-loader.test.ts' }
  if (hasIndexKey) {
    const jobKey = ['v1', A.id, 'issues', 'issue', richRow.id].map(encodeURIComponent).join(':')
    const { error: enqueueError } = await svc.rpc('upsert_ai_index_jobs', { p_jobs: [{
      job_key: jobKey, operation: 'upsert', project_id: A.id, domain: 'issues', entity_type: 'issue', entity_id: richRow.id,
      payload: {}, run_after: new Date(Date.now() - 60_000).toISOString(),
    }] })
    if (enqueueError) throw new Fail(`이슈 색인 잡 등록 실패: ${enqueueError.message}`)
    const cronRes = await fetch(`${base}/api/cron/ai-index`, { headers: { authorization: `Bearer ${cronSecret}` }, redirect: 'manual' })
    const cronJson = await cronRes.json().catch(() => null)
    if (cronRes.status !== 200) throw new Fail(`이슈 색인 크론 응답 ${cronRes.status}: ${JSON.stringify(cronJson)}`)
    const docs = rows('이슈 색인 문서', await svc.from('ai_documents').select('title, content')
      .eq('project_id', A.id).eq('domain', 'issues').eq('entity_type', 'issue').eq('entity_id', richRow.id))
    const doc = docs[0]
    if (!doc || !String(doc.title).includes(richRow.code) || String(doc.title).includes(`#${richRow.issue_no}`)
      || String(doc.content).includes(`#${richRow.issue_no}`)) throw new Fail('색인 문서에 이슈 코드가 없거나 #issue_no 가 남았다')
    bot = { mode: 'indexed', cron: { status: cronRes.status, claimed: cronJson?.claimed ?? null }, title: doc.title,
      noIssueNo: !String(doc.content).includes(`#${richRow.issue_no}`) }
  }

  await admin.http('GET', `/p/${A.id}/settings`)
  mustOk('RND 영역 개명', (await admin.action(`/p/${A.id}/settings`, 'upsertArea', [A.id, {
    id: areaId, kind: 'issue_area', code: 'RND', name: '연구개발', sortOrder: 1, active: true, teams: [],
  }])).result)
  const [renamedRow] = rows('개명 뒤 코드', await admin.sb.from('issues').select('code, area_id, code_area_id').eq('id', richRow.id))
  if (renamedRow?.code !== 'E2E-RND-001' || renamedRow.area_id !== areaId || renamedRow.code_area_id !== areaId) {
    throw new Fail(`영역 개명 뒤 코드·영역 id 가 바뀌었다: ${JSON.stringify(renamedRow)}`)
  }
  await updateASettings({ 'modules.enabled': aModulesBefore })
  const analysisDenied = await admin.action(`/p/${A.id}/issues`, 'createIssue', [A.id, {
    title: 'E2E 분석 꺼짐 거부', body: '', severity: 'medium', assigneeMemberIds: [], startDate: null, dueDate: null,
    areaId, analysis: { majorName: '거부', subProcess: '거부', ownerDepartment: '거부', relatedSystems: [], sourceType: 'other', sourceDetail: '거부' },
  }])
  const reportOff = await admin.http('GET', `/api/issue-analysis?projectId=${A.id}&runId=${analysisRun.id}`, { expect: 404 })
  const reportOffBody = await reportOff.json()
  if (analysisDenied.result?.ok !== false || analysisDenied.result.error !== ERR_MODULE_DISABLED || reportOffBody?.error !== ERR_MODULE_DISABLED) {
    throw new Fail(`분석 모듈 꺼짐을 쓰기·다운로드가 거부하지 않았다: ${JSON.stringify({ action: analysisDenied.result, report: reportOffBody })}`)
  }
  await admin.http('GET', `/p/${A.id}/issues`)
  const plainAfterOff = mustOk('분석 꺼진 일반 이슈 등록', (await admin.action(`/p/${A.id}/issues`, 'createIssue', [A.id, {
    title: 'E2E 분석 없이 등록', body: '영역 코드는 유지', severity: 'medium', assigneeMemberIds: [], startDate: null, dueDate: null,
    areaId, analysis: null,
  }])).result)
  if (plainAfterOff.code !== 'E2E-RND-002') throw new Fail(`분석 꺼짐이 일반 발급을 막았거나 카운터가 틀리다: ${plainAfterOff.code}`)
  await updateASettings(aPolicyBefore === undefined ? {} : { 'issues.id_policy': aPolicyBefore }, aPolicyBefore === undefined ? ['issues.id_policy'] : [])
  step('issue-code-flow', {
    basic: { projectId: basic.id, code: basicCreated.code },
    area: { id: areaId, code: richRow.code, areaId: richRow.area_id, codeAreaId: richRow.code_area_id, renamedCode: renamedRow.code, nextCode: plainAfterOff.code },
    list: { codeRendered: issueHtmlBeforeRename.includes(richRow.code), noIssueNo: !issueHtmlBeforeRename.includes(`#${richRow.issue_no}`) },
    report: { status: deckRes.status, bytes: deck.length, codeAndArea: deckCheck },
    analysisOff: { rejectedWrite: analysisDenied.result.error, reportStatus: reportOff.status, plainCodeAfterOff: plainAfterOff.code }, bot,
  })

  // 19b. 회의록 팀 루트(SP5 B2 — §6.3 minutes-teams): 공용 팀 생성(create_team) → 같은 트랜잭션의 팀 루트(kind·team_id, 이름 = 팀 이름) →
  // 폴더 없이 올린 회의록이 그 루트로 편철되고 team_id 가 그 팀 → 팀 개명 → 루트 이름이 따라가고 폴더 id 는 그대로 → 비활성 → 그 루트 아래
  // 새 폴더(편철)와 그 팀 담당의 새 회의록이 거부된다. 팀 루트의 세션 위조 다섯(선점·종류 변경·삭제·비활성 아래 생성·팀 이름 선점)은 RLS 테스트가 본다.
  const MT_CODE = `MT${stamp.slice(-4)}`
  await admin.http('GET', wsPath(wsA, 'admin/teams'))
  mustOk(`addTeam(${MT_CODE})`, (await admin.action(wsPath(wsA, 'admin/teams'), 'addTeam', [wsA, MT_CODE])).result)
  const [mtTeam] = rows('회의록 팀', await svc.from('teams').select('id, code, name, active').eq('workspace_id', wsA).is('project_id', null).eq('code', MT_CODE))
  const mtRoots = () => svc.from('minute_folders').select('id, name, kind, team_id, project_id, parent_id').eq('team_id', mtTeam.id)
  const [mtRoot] = rows('팀 루트', await mtRoots())
  same('팀 루트(생성 직후)', mtRoot && { kind: mtRoot.kind, name: mtRoot.name, project_id: mtRoot.project_id, parent_id: mtRoot.parent_id },
    { kind: 'team_root', name: MT_CODE, project_id: null, parent_id: null })
  await ana.http('GET', wsPath(wsA, 'minutes'))
  const mtMinute = mustOk('createMinute(팀 루트 자동 편철)', (await ana.action(wsPath(wsA, 'minutes'), 'createMinute', [
    minuteInput({ date: meetingDate, teamCode: MT_CODE, title: `E2E-MT-${stamp}`, bodyMd: '# E2E 팀 루트 편철\n', projectId: null }), null, null, wsA,
  ])).result)
  const [mtRow] = rows('팀 루트 회의록', await svc.from('minutes').select('id, folder_id, team_id, team_code').eq('id', mtMinute.id))
  same('팀 루트 회의록 편철·team_id', mtRow && { folder_id: mtRow.folder_id, team_id: mtRow.team_id, team_code: mtRow.team_code },
    { folder_id: mtRoot.id, team_id: mtTeam.id, team_code: MT_CODE })
  const MT_NAME = `E2E 회의록팀 ${stamp.slice(-4)}`
  mustOk('updateTeam(개명)', (await admin.action(wsPath(wsA, 'admin/teams'), 'updateTeam', [mtTeam.id, { name: MT_NAME }])).result)
  const [mtRenamed] = rows('개명 뒤 팀 루트', await mtRoots())
  same('개명 뒤 팀 루트(이름 추종·id 불변)', mtRenamed && { id: mtRenamed.id, name: mtRenamed.name }, { id: mtRoot.id, name: MT_NAME })
  const explorerHtml = await (await ana.http('GET', wsPath(wsA, 'minutes'))).text()
  mustOk('updateTeam(비활성)', (await admin.action(wsPath(wsA, 'admin/teams'), 'updateTeam', [mtTeam.id, { active: false }])).result)
  const folderDenied = (await ana.action(wsPath(wsA, 'minutes'), 'createMinuteFolder', [wsA, 'E2E 비활성 아래', mtRoot.id])).result
  const minuteDenied = (await ana.action(wsPath(wsA, 'minutes'), 'createMinute', [
    minuteInput({ date: meetingDate, teamCode: MT_CODE, title: `E2E-MT-DENY-${stamp}`, bodyMd: '# 거부\n', projectId: null }), null, null, wsA,
  ])).result
  const [mtAfter] = rows('비활성 뒤 팀 루트', await mtRoots())
  const mtChecks = {
    rootRenderedAsTeamName: explorerHtml.includes(MT_NAME),
    folderUnderInactiveDenied: folderDenied?.ok === false && String(folderDenied.error).includes('비활성 팀'),
    minuteForInactiveDenied: minuteDenied?.ok === false,
    rootKept: mtAfter?.id === mtRoot.id && mtAfter?.name === MT_NAME,
  }
  step('minutes-teams', { team: { id: mtTeam.id, code: MT_CODE, name: MT_NAME }, rootId: mtRoot.id, minuteId: mtMinute.id,
    denied: { folder: folderDenied?.error, minute: minuteDenied?.error }, checks: mtChecks },
  Object.values(mtChecks).every(Boolean) ? undefined : `회의록 팀 루트: ${JSON.stringify(mtChecks)}`)

  // 19c. 이슈 표시 상태(SP5b I — 스펙 §6.1 issue-status-flow): 연구 5상태 정의를 설정 액션으로 저장 → 새 이슈는 첫 상태(접수) →
  // 허용 전이(접수→고객 승인→종료)는 통과·이력 2행, 전이표 밖(종료→고객 승인 = resolved→on_hold)은 거부 → 참조 있는 상태(검토) 삭제는
  // CONFIG_IN_USE → 다른 범주로 옮기기는 거부, 같은 범주(접수)로 옮긴 뒤 삭제는 통과. 모두 화면과 같은 서버 액션 경로다.
  const RESEARCH_STATUSES = [
    { code: 'intake', label: '접수', category: 'open', color: 'delayed', sort: 1, active: true },
    { code: 'review', label: '검토', category: 'open', color: 'brand', sort: 2, active: true },
    { code: 'client_approval', label: '고객 승인', category: 'on_hold', color: 'pending', sort: 3, active: true },
    { code: 'execution', label: '실행', category: 'in_progress', color: 'progress', sort: 4, active: true },
    { code: 'done', label: '종료', category: 'resolved', color: 'done', sort: 5, active: true },
  ]
  // 기본 4상태를 쓰는 이슈가 있는 프로젝트에서는 'open' 을 지울 수 없다(CONFIG_IN_USE — 그것도 계약이다). 새 프로젝트에서 시작한다
  const flowName = `E2E 상태 흐름 ${randomUUID().slice(0, 8)}`
  await admin.http('GET', wsPath(wsA, 'projects'))
  mustOk('E2E 상태 흐름 프로젝트', (await admin.action(wsPath(wsA, 'projects'), 'createProject', [{
    workspaceId: wsA, name: flowName, startDate: null, endDate: null, description: null, levelLabels: LEVEL_LABELS, commandId: randomUUID(),
  }])).result)
  const flowP = rows('E2E 상태 흐름 프로젝트 조회', await admin.sb.from('projects').select('id').eq('name', flowName).single())
  const updateFlowSettings = async (set, unset = []) => {
    await admin.http('GET', `/p/${flowP.id}/settings`)
    const doc = rows('상태 흐름 프로젝트 설정', await admin.sb.from('project_settings').select('revision').eq('project_id', flowP.id).single())
    return (await admin.action(`/p/${flowP.id}/settings`, 'updateProjectSettings',
      [flowP.id, { expectedRevision: doc.revision, commandId: randomUUID(), set, unset }])).result
  }
  mustOk('이슈 상태 5개 저장', await updateFlowSettings({ 'workflow.issue_statuses': RESEARCH_STATUSES }))
  await admin.http('GET', `/p/${flowP.id}/issues`)
  const newFlowIssue = async (title) => mustOk(title, (await admin.action(`/p/${flowP.id}/issues`, 'createIssue', [flowP.id, {
    title, body: '상태 흐름', severity: 'medium', assigneeMemberIds: [], startDate: null, dueDate: null, areaId: null, analysis: null,
  }])).result)
  const progress = async (id, status, expectedStatus) => (await admin.action(`/p/${flowP.id}/issues`, 'updateIssueProgress', [id, { status, expectedStatus }])).result
  const flowIssue = await newFlowIssue('E2E 상태 흐름')
  const flowRow = () => admin.sb.from('issues').select('status, status_code, resolved_at').eq('id', flowIssue.id).single()
  const firstState = rows('첫 상태', await flowRow())
  const toApproval = await progress(flowIssue.id, 'client_approval', 'intake')
  const toDone = await progress(flowIssue.id, 'done', 'client_approval')
  const backToApproval = await progress(flowIssue.id, 'client_approval', 'done')
  const doneState = rows('종료 상태', await flowRow())
  const history = rows('상태 이력', await admin.sb.from('issue_updates').select('body').eq('issue_id', flowIssue.id).eq('kind', 'status').order('created_at'))
  const reviewIssue = await newFlowIssue('E2E 검토 상태')
  const toReview = await progress(reviewIssue.id, 'review', 'intake')
  const withoutReview = RESEARCH_STATUSES.filter((d) => d.code !== 'review')
  const deleteInUse = await updateFlowSettings({ 'workflow.issue_statuses': withoutReview })
  await admin.http('GET', `/p/${flowP.id}/settings`)
  const crossMigrate = (await admin.action(`/p/${flowP.id}/settings`, 'migrateVocabCode', [flowP.id, 'workflow.issue_statuses', 'review', 'done'])).result
  const sameMigrate = (await admin.action(`/p/${flowP.id}/settings`, 'migrateVocabCode', [flowP.id, 'workflow.issue_statuses', 'review', 'intake'])).result
  const deleteAfter = await updateFlowSettings({ 'workflow.issue_statuses': withoutReview })
  const isChecks = {
    firstIsIntake: firstState?.status_code === 'intake' && firstState?.status === 'open',
    allowedPassed: toApproval?.ok === true && toDone?.ok === true,
    outsideDenied: backToApproval?.ok === false && String(backToApproval?.error).includes('옮길 수 없습니다'),
    resolvedDerived: doneState?.status === 'resolved' && doneState?.status_code === 'done' && doneState?.resolved_at !== null,
    historyTwo: JSON.stringify(history.map((h) => h.body)) === JSON.stringify(['intake>client_approval', 'client_approval>done']),
    inUseDenied: toReview?.ok === true && deleteInUse?.ok === false && deleteInUse?.code === 'CONFIG_IN_USE',
    crossCategoryDenied: crossMigrate?.ok === false && String(crossMigrate?.error).includes('같은 범주'),
    sameCategoryMoved: sameMigrate?.ok === true && sameMigrate?.moved === 1,
    deletedAfterMove: deleteAfter?.ok === true,
  }
  step('issue-status-flow', { project: flowP.id, issue: flowIssue.id, results: { toApproval, toDone, backToApproval, deleteInUse, crossMigrate, sameMigrate, deleteAfter }, checks: isChecks },
    Object.values(isChecks).every(Boolean) ? undefined : `이슈 상태 흐름: ${JSON.stringify(isChecks)}`)

  // 19d. WBS 2단계 승인(SP5b W1 — 스펙 §6.1 workflow-approval): 새 프로젝트에 승인 단계 둘(내부 검토 = 서브트리 관리자 이상, 고객 승인 = 관리자)을
  // 설정 액션으로 저장 → 위임 리프의 주문을 PAT 로 claim·완료 보고 → 첫 승인(나) 뒤 주문 reported·단계 im·work.approval_step 1·work.approved 0 →
  // 같은 사람의 둘째 단계는 거부(서로 다른 승인자) → 다른 관리자(carol)의 둘째 승인 뒤 approved·xx·100·work.approved 1, 원장 2행(via=approve).
  // 사람 경로: 위임 없는 리프는 xx 직행이 approval_required, im 으로 올린 뒤 단계 승인 둘로 xx. 선행 기준(final)의 claim 게이트 대조는 W2 가 이 단계에 더한다.
  const wfName = `E2E 승인 흐름 ${randomUUID().slice(0, 8)}`
  await admin.http('GET', wsPath(wsA, 'projects'))
  mustOk('E2E 승인 흐름 프로젝트', (await admin.action(wsPath(wsA, 'projects'), 'createProject', [{
    workspaceId: wsA, name: wfName, startDate: null, endDate: null, description: null, levelLabels: LEVEL_LABELS, commandId: randomUUID(),
  }])).result)
  const wfP = rows('E2E 승인 흐름 프로젝트 조회', await admin.sb.from('projects').select('id').eq('name', wfName).single())
  const updateWfSettings = async (set, unset = []) => {
    await admin.http('GET', `/p/${wfP.id}/settings`)
    const doc = rows('승인 흐름 프로젝트 설정', await admin.sb.from('project_settings').select('revision').eq('project_id', wfP.id).single())
    return (await admin.action(`/p/${wfP.id}/settings`, 'updateProjectSettings',
      [wfP.id, { expectedRevision: doc.revision, commandId: randomUUID(), set, unset }])).result
  }
  const WF_STEPS = [{ code: 'internal', label: '내부 검토', approver: 'subtree_or_admin' }, { code: 'client', label: '고객 승인', approver: 'admin' }]
  mustOk('승인 단계 둘 저장', await updateWfSettings({ 'workflow.approval_steps': WF_STEPS }))
  // agents 등록 행은 모듈을 새로 켤 때 생긴다(agentsSync) — 껐다 켠다
  const wfModules = async (label, fn) => {
    const cur = rows('승인 흐름 모듈', await admin.sb.from('project_settings').select('values').eq('project_id', wfP.id).single()).values['modules.enabled']
    mustOk(label, await updateWfSettings({ 'modules.enabled': fn(cur) }))
  }
  await wfModules('승인 흐름 agents 끄기', (e) => e.filter((id) => id !== 'agents'))
  await wfModules('승인 흐름 agents 켜기', (e) => [...e.filter((id) => id !== 'agents'), 'agents'])
  // 둘째 관리자 — 초대로 들어온 carol 을 이 프로젝트 명단의 관리자로(명단 = 권한)
  const carolPerson = rows('carol 인물', await svc.from('people').select('id').eq('workspace_id', wsA).eq('user_id', carolUser.id).single())
  rows('carol 명단', await svc.from('project_members').insert({ project_id: wfP.id, person_id: carolPerson.id, access_role: 'admin' }).select('id'))
  // 리프 둘(에이전트 리프 W·사람 리프 H) — 화면과 같은 액션으로 만든다: 추가 → (W 만) 담당 지정 → 개발 워크플로 켜기. W 는 담당자가 있는 리프라
  // 켜는 순간 assign 사건(as)과 ready 주문 자동 발행이 따른다(ensureOrderForWorkflowLeaf). W 의 담당자는 나 — claim 은 담당자 본인만,
  // work.approved 는 담당자에게 간다(워크스페이스 관리자는 명단 없이도 관리자다 — 담당자가 되려면 명단 행이 있어야 한다)
  const myPerson = rows('내 인물', await svc.from('people').select('id').eq('workspace_id', wsA).eq('user_id', me.id).single())
  const myWfMember = rows('승인 흐름 내 명단', await svc.from('project_members').insert({ project_id: wfP.id, person_id: myPerson.id, access_role: 'member' }).select('id'))[0]
  await admin.http('GET', `/p/${wfP.id}/wbs`)
  const wfLeaf = mustOk('승인 흐름 W', (await admin.action(`/p/${wfP.id}/wbs`, 'addWbsItem', [wfP.id, null, 'E2E 에이전트 리프'])).result)
  const humanLeaf = mustOk('승인 흐름 H', (await admin.action(`/p/${wfP.id}/wbs`, 'addWbsItem', [wfP.id, null, 'E2E 사람 리프'])).result)
  mustOk('W 담당', (await admin.action(`/p/${wfP.id}/wbs`, 'setWbsAssignee', [wfLeaf.id, myWfMember.id])).result)
  mustOk('W 워크플로', (await admin.action(`/p/${wfP.id}/wbs`, 'setWbsDevWorkflow', [wfLeaf.id, true, false])).result)
  mustOk('H 워크플로', (await admin.action(`/p/${wfP.id}/wbs`, 'setWbsDevWorkflow', [humanLeaf.id, true, false])).result)
  const wfOrder = rows('승인 흐름 주문', await svc.from('agent_work_orders').select('id').eq('wbs_item_id', wfLeaf.id).eq('status', 'ready'))[0]
  if (!wfOrder) throw new Fail('개발 워크플로를 켠 담당 리프에 ready 주문이 없다')
  await admin.http('GET', '/account')
  const wfToken = mustOk('승인 흐름 토큰', (await admin.action('/account', 'createAgentToken', [{ name: `e2e-wf-${randomUUID().slice(0, 8)}`, projectId: wfP.id, scopes: ['work:read', 'work:claim'], expiresDays: 1 }])).result)
  const agentPost = async (path, body, expectedStatus) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${wfToken.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (res.status !== expectedStatus) throw new Fail(`POST ${path} → ${res.status}(기대 ${expectedStatus}): ${JSON.stringify(json)?.slice(0, 300)}`)
    return json
  }
  await agentPost(`/api/v1/agent/work/${wfOrder.id}/claim`, { agent: 'e2e-wf' }, 200)
  await agentPost(`/api/v1/agent/work/${wfOrder.id}/report`, { agent: 'e2e-wf', kind: 'completion', percent: 100, summary: 'E2E 완료' }, 200)
  const wfReport = rows('완료 보고', await svc.from('agent_work_reports').select('id').eq('work_order_id', wfOrder.id).eq('kind', 'completion'))[0]
  const notifCount = async (type) => rows(`알림 ${type}`, await svc.from('notification_events').select('id').eq('project_id', wfP.id).eq('type', type)).length
  const wfState = async () => ({
    order: rows('주문 상태', await svc.from('agent_work_orders').select('status').eq('id', wfOrder.id).single()).status,
    item: rows('항목 상태', await svc.from('wbs_items').select('stage, actual_pct, review_round, review_steps').eq('id', wfLeaf.id).single()),
  })
  const approvedBefore = await notifCount('work.approved')
  await admin.http('GET', `/p/${wfP.id}/wbs`)
  const step1 = (await admin.action(`/p/${wfP.id}/wbs`, 'approveAgentCompletion', [wfOrder.id, wfReport.id, 'internal'])).result
  const afterStep1 = await wfState()
  const approvalStepEvents = await notifCount('work.approval_step')
  const approvedAfterStep1 = await notifCount('work.approved')
  const sameActor = (await admin.action(`/p/${wfP.id}/wbs`, 'approveAgentCompletion', [wfOrder.id, wfReport.id, 'client'])).result
  await carol.http('GET', `/p/${wfP.id}/wbs`)
  const step2 = (await carol.action(`/p/${wfP.id}/wbs`, 'approveAgentCompletion', [wfOrder.id, wfReport.id, 'client'])).result
  const afterStep2 = await wfState()
  const approvedAfterStep2 = await notifCount('work.approved')
  const ledger = rows('승인 원장', await svc.from('wbs_stage_approvals').select('step_code, via, revoked_at').eq('wbs_item_id', wfLeaf.id).order('step_code'))
  // 사람 경로
  const directXx = (await admin.action(`/p/${wfP.id}/wbs`, 'setWbsStage', [humanLeaf.id, 'xx'])).result
  const toIm = (await admin.action(`/p/${wfP.id}/wbs`, 'setWbsStage', [humanLeaf.id, 'im'])).result
  const human1 = (await admin.action(`/p/${wfP.id}/wbs`, 'approveWbsStep', [humanLeaf.id, 'internal'])).result
  const human2 = (await carol.action(`/p/${wfP.id}/wbs`, 'approveWbsStep', [humanLeaf.id, 'client'])).result
  const humanItem = rows('사람 리프', await svc.from('wbs_items').select('stage, actual_pct').eq('id', humanLeaf.id).single())
  const wfChecks = {
    firstStepIntermediate: step1?.ok === true && step1?.remaining === 1 && afterStep1.order === 'reported' && afterStep1.item.stage === 'im'
      && JSON.stringify(afterStep1.item.review_steps) === JSON.stringify(['internal', 'client']),
    approvalStepNotified: approvalStepEvents === 1 && approvedAfterStep1 === approvedBefore,
    sameActorDenied: sameActor?.ok === false && String(sameActor?.error).includes('다른 사람'),
    finalApproved: step2?.ok === true && step2?.remaining === undefined && afterStep2.order === 'approved' && afterStep2.item.stage === 'xx' && Number(afterStep2.item.actual_pct) === 100,
    approvedNotified: approvedAfterStep2 === approvedBefore + 1,
    ledgerTwo: ledger.length === 2 && ledger.every((r) => r.via === 'approve' && r.revoked_at === null),
    humanDirectXxDenied: directXx?.ok === false && String(directXx?.error).includes('승인 단계가 둘 이상'),
    humanStepApproved: toIm?.ok === true && human1?.ok === true && human1?.remaining === 1 && human2?.ok === true
      && humanItem.stage === 'xx' && Number(humanItem.actual_pct) === 100,
  }
  step('workflow-approval', { project: wfP.id, order: wfOrder.id, results: { step1, sameActor, step2, directXx, toIm, human1, human2 }, ledger, checks: wfChecks },
    Object.values(wfChecks).every(Boolean) ? undefined : `승인 흐름: ${JSON.stringify(wfChecks)}`)

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

  // 21. 에이전트 사용 여부의 원천은 agents 모듈 하나다(SP7 — 옛 등록 표는 0041 이 지웠다). 모듈을 끄면 에이전트 API 가 닫히고 켜면 열린다.
  // 켜기·끄기는 모듈 편집기(modules.enabled 의 agents)가 한 길이다. 새로 켜는 저장은 주문 백필을 돈다(agentsSync.ts).
  const withAgents = (enabled) => (enabled.includes('agents') ? enabled : [...enabled, 'agents'])
  // 기본 modules.enabled 에 agents 가 이미 있다 — 껐다 켜서 '새로 켬'(백필) 경로를 한 번 지난다.
  await setProjectModules('agents 끄기(새로 켬 준비)', (enabled) => enabled.filter((id) => id !== 'agents'))
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
  agents.meAfterModuleOff = meHas(await agentApi('/api/v1/agent/me', 200))
  agents.structureAfterModuleOff = { status: 404, body: await agentApi(`/api/v1/wbs/structure?project_id=${A.id}`, 404) }
  await setProjectModules('agents 다시 켜기', withAgents)
  agents.meAfterToggleOn = meHas(await agentApi('/api/v1/agent/me', 200))
  agents.enabledAfterToggleOn = (await projectModules()).enabled
  await setProjectModules('agents 끄기(모듈 편집기)', (enabled) => enabled.filter((id) => id !== 'agents'))
  agents.enabledAfterToggleOff = (await projectModules()).enabled
  agents.meAfterToggleOff = meHas(await agentApi('/api/v1/agent/me', 200))
  step('module-agents-off', agents,
    !agents.meBefore || agents.enabledAfterModuleOff.includes('agents') || agents.meAfterModuleOff
      || !agents.meAfterToggleOn || !agents.enabledAfterToggleOn.includes('agents')
      || agents.enabledAfterToggleOff.includes('agents') || agents.meAfterToggleOff
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
  const wsToday = todayInTz(await tzOfWorkspace(wsA))   // SP5 A — 외부 회의록 날짜는 워크스페이스에 저장된 tz 의 오늘
  const uploadOff = await fetch(`${base}/api/v1/minutes`, {
    method: 'POST', redirect: 'manual',
    headers: { authorization: `Bearer ${minutesTokenA}`, 'content-type': 'application/json' },
    body: JSON.stringify({ user_email: A_ADMIN.email, date: wsToday, team: WS_TEAM, title: 'E2E 관문', body_markdown: '# 관문', external_id: externalId }),
  })
  const integration = {
    allowedBefore: allowedA.includes('minutes_integration'),
    meta: await api(`/api/v1/minutes/meta?user_email=${encodeURIComponent(A_ADMIN.email)}`, 409),
    list: await api(`/api/v1/minutes?user_email=${encodeURIComponent(A_ADMIN.email)}`, 409),
    upload: { status: uploadOff.status, body: await uploadOff.json().catch(() => null) },
    createdRows: rows('업로드 행', await svc.from('minutes').select('id').eq('external_id', externalId)).length,
    beaStillOpen: (await meta(B_ADMIN.email, minutesTokenB)).projectIds,
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
    operation: 'upsert', project_id: A.id, workspace_id: wsA, domain: 'wbs', entity_type: 'wbs_item', entity_id: entityId,   // workspace_id — 0036 뒤로 필수
    payload: {}, status: 'pending', run_after: new Date(Date.now() - 86_400_000).toISOString(),
  }).select('id'))
  const cron = await fetch(`${base}/api/cron/ai-index`, { headers: { authorization: `Bearer ${cronSecret}` }, redirect: 'manual' })
  const cronBody = await cron.json().catch(() => null)
  const [after] = rows('색인 행 재조회', await svc.from('ai_index_jobs').select('status, last_error').eq('id', job.id))
  const indexSkip = { enabled: enabledNoChat, cron: { status: cron.status, skipped: cronBody?.skipped ?? null, claimed: cronBody?.claimed ?? null }, job: after }
  step('module-index-skip', indexSkip,
    enabledNoChat.includes('chatbot') || cron.status !== 200 || !(cronBody?.skipped >= 1) || after.status !== 'skipped' || after.last_error !== 'module_disabled'
      ? `색인 크론: ${JSON.stringify(indexSkip)}` : undefined)

  // ── 24. SP3b UI-2(스펙 §8.3) — 워크스페이스 범위 IA. 단계 이름은 sp3b-<스펙 번호>. 앞 단계의 A(이슈·agents·chatbot 꺼짐)·B·C·ana·bea·
  //    플랫폼 관리자(부트스트랩 계정 — 소속 A 하나)를 그대로 쓰고, 두 워크스페이스 계정 duo 와 B 의 공용 팀·회의록만 더한다.
  //    픽스처: duo 는 createAccount(B, 멤버, 프로젝트 C 멤버 — B 에서 프로젝트 없는 회의록을 쓸 역할), A 소속만 service_role 행(로컬 전용 —
  //    기존 계정을 다른 워크스페이스에 더하는 화면이 아직 없다). B 의 공용 팀은 addTeam(B), 회의록은 bea 의 createMinute(B, 프로젝트 없음).
  //    B 의 공용 팀은 단계 18 의 'bea meta 팀에 A 공용 팀이 없다' 단언 뒤에 만든다(코드도 A 의 WS_TEAM 과 다르다 — SP3B_B_TEAM).
  const origin = new URL(base).origin
  const duoPassword = `E2E-${randomUUID()}`
  await admin.http('GET', wsPath(wsB, 'admin/accounts'))
  mustOk(`createAccount(${DUO.name})`, (await admin.action(wsPath(wsB, 'admin/accounts'), 'createAccount', [{
    workspaceId: wsB, email: DUO.email, password: duoPassword, name: DUO.name, workspaceRole: 'member', projectId: C.id, accessRole: 'member',
  }])).result)
  const duoB = await membershipOf(DUO.email)
  rows('duo@A 소속', await svc.from('workspace_members').insert({ workspace_id: wsA, user_id: duoB.userId, role: 'member', invited_by: me.id }).select('user_id'))
  const duoWs = await membershipOf(DUO.email)
  same('duo 의 워크스페이스 소속', duoWs.memberships.map((m) => [m.workspace_id, m.role]).sort(), [[wsA, 'member'], [wsB, 'member']].sort())
  await admin.http('GET', wsPath(wsB, 'admin/teams'))
  mustOk(`addTeam(${SP3B_B_TEAM})`, (await admin.action(wsPath(wsB, 'admin/teams'), 'addTeam', [wsB, SP3B_B_TEAM])).result)
  await bea.http('GET', wsPath(wsB, 'minutes'))
  const minuteB = mustOk('createMinute(B)', (await bea.action(wsPath(wsB, 'minutes'), 'createMinute', [
    minuteInput({ date: meetingDate, teamCode: SP3B_B_TEAM, title: SP3B_MINUTE_B, bodyMd: `# ${SP3B_MINUTE_B}\n`, projectId: null }), null, null, wsB,
  ])).result).id
  const duo = session('duo')
  await duo.login(DUO.email, duoPassword)
  step('sp3b-fixture', {
    via: 'duo = createAccount(B, 멤버, C 멤버) + A 소속 service_role 행(로컬 전용), B 공용 팀 = addTeam(B), B 회의록 = bea 의 createMinute(B)',
    duo: { userId: duoWs.userId, memberships: duoWs.memberships }, bTeam: SP3B_B_TEAM, minuteB,
  })

  // 쿠키 항아리로 직접 GET(리다이렉트는 따르지 않는 것이 기본) — 상태 코드를 판정하는 단계라 session.http 의 기대 상태 검사 대신 쓴다
  const raw = async (who, path, { extra = {}, follow = false } = {}) => {
    const cookie = cookieHeader([...[...who.jar].map(([name, value]) => ({ name, value })), ...Object.entries(extra).map(([name, value]) => ({ name, value }))])
    const res = await fetch(origin + path, { redirect: follow ? 'follow' : 'manual', headers: { cookie } })
    return { status: res.status, headers: res.headers, html: res.status === 307 || res.status === 308 ? '' : await res.text(), url: res.url }
  }
  const minuteA = minutes[0]   // A 의 프로젝트 회의록(단계 16) — ana 는 A 관리자
  const wsMinuteA = minutes[1] // A 의 프로젝트 없는 회의록 — A 의 모든 멤버가 본다(duo 는 A 의 프로젝트 명단에 없다)
  const sp3b = (name, detail, problems) => step(`sp3b-${name}`, { ...detail, problems }, problems.length ? problems.join(' · ') : undefined)

  {
    const p = []
    const cases = legacyCases(slugA, { minuteId: minuteA.minuteId, projectId: A.id })
    for (const c of cases) for (const x of expectLocation(await raw(ana, c.from), origin, c.to)) p.push(`${c.from}: ${x}`)
    sp3b('E1', { what: '옛 경로 → 새 경로 307(쿼리 보존·요청 원점)', cases: cases.length }, p)
  }
  {
    // E3(UI-3, D36) — 옛 칸반 딥링크는 작업 계획의 보드 보기로 307(view → group, 나머지 쿼리 보존), 그 대상이 200 으로 보드를 그린다.
    // 프로젝트 A 는 칸반이 켜져 있다(단계 20~ 은 이슈·agents·chatbot 만 끈다). ana 는 A 관리자
    const p = []
    const c = kanbanStubCase(A.id)
    for (const x of expectLocation(await raw(ana, c.path), origin, c.want)) p.push(`${c.path}: ${x}`)
    const page = await raw(ana, c.want)
    if (page.status !== 200 || !kanbanBoardRendered(page.html)) p.push(`보드가 그려지지 않았다(상태 ${page.status}, 표지 ${kanbanBoardRendered(page.html)})`)
    sp3b('E3', { what: '옛 칸반 → 작업 계획 보드 307(view→group·쿼리 보존)·대상 200 + 보드 표지', from: c.path, to: c.want }, p)
  }
  {
    const p = []
    const ok = await raw(ana, `/minutes/${minuteA.minuteId}`)
    for (const x of expectLocation(ok, origin, `${wsPath(wsA, 'minutes')}/${minuteA.minuteId}`)) p.push(`ana: ${x}`)
    const page = await raw(ana, `${wsPath(wsA, 'minutes')}/${minuteA.minuteId}`)
    if (page.status !== 200 || !page.html.includes(minuteA.title)) p.push(`ana 상세 상태 ${page.status}·제목 ${page.html.includes(minuteA.title)}`)
    p.push(...hiddenVerdict(await raw(bea, `/minutes/${minuteA.minuteId}`, { follow: true }), [minuteA.title]).map((x) => `bea: ${x}`))
    sp3b('E2', { what: '회의록 영구 링크 — 행의 워크스페이스로, 타 워크스페이스 계정은 404' }, p)
  }
  {
    const p = [], statuses = {}
    for (const path of [wsPath(wsA), wsPath(wsA, 'minutes'), wsPath(wsA, 'agents')]) {
      const res = await raw(bea, path)
      statuses[path] = `${res.status}${notFoundRendered(res.html) ? '+digest' : ''}`   // 판정은 S-2 대로 '404 또는 digest' — 실제 상태를 남긴다
      p.push(...hiddenVerdict(res, [A.name, minuteA.title, wsMinuteA.title]).map((x) => `${path}: ${x}`))
    }
    sp3b('E4', { what: '비소속(bea) — 워크스페이스 A 화면 404·A 의 이름이 본문에 없다', statuses }, p)
  }
  {
    const p = []
    const a = await raw(duo, wsPath(wsA, 'minutes')), b = await raw(duo, wsPath(wsB, 'minutes'))
    if (a.status !== 200 || b.status !== 200) p.push(`상태 A ${a.status} · B ${b.status}`)
    if (!a.html.includes(wsMinuteA.title)) p.push('A 목록에 A 회의록이 없다')
    if (a.html.includes(SP3B_MINUTE_B)) p.push('A 목록에 B 회의록이 샌다')
    if (!b.html.includes(SP3B_MINUTE_B)) p.push('B 목록에 B 회의록이 없다')
    if (b.html.includes(wsMinuteA.title) || b.html.includes(minuteA.title)) p.push('B 목록에 A 회의록이 샌다')
    await duo.http('GET', wsPath(wsB, 'minutes'))
    const title = `E2E SP3b 생성 ${stamp}`
    const result = (await duo.action(wsPath(wsB, 'minutes'), 'createMinute', [
      minuteInput({ date: meetingDate, teamCode: SP3B_B_TEAM, title, bodyMd: '# 생성\n', projectId: null }), null, null, wsB,
    ])).result
    let createdIn = null
    if (!result?.ok) p.push(`createMinute 실패: ${JSON.stringify(result)}`)
    else {
      createdIn = rows('생성 행', await svc.from('minutes').select('workspace_id').eq('id', result.id))[0]?.workspace_id ?? null
      if (createdIn !== wsB) p.push(`새 행의 워크스페이스 ${createdIn} ≠ B`)
    }
    sp3b('E6', { what: '두 워크스페이스(duo) — 각자의 회의록만, 프로젝트 없는 회의록 생성은 인자 워크스페이스에', createdIn }, p)
  }
  {
    const p = []
    const to = (res) => new URL(res.headers.get('location') ?? '', origin).pathname
    const r1 = await raw(ana, '/'); if (r1.status !== 307 || !to(r1).startsWith(wsPath(wsA))) p.push(`ana: ${r1.status} ${to(r1)}`)
    const r2 = await raw(duo, '/', { extra: { 'dflow-ws': OTHER_WORKSPACE.slug } }); if (r2.status !== 307 || !to(r2).startsWith(wsPath(wsB))) p.push(`duo+B: ${r2.status} ${to(r2)}`)
    const r3 = await raw(ana, '/', { extra: { 'dflow-ws': OTHER_WORKSPACE.slug } }); if (r3.status !== 307 || !to(r3).startsWith(wsPath(wsA))) p.push(`ana+위조: ${r3.status} ${to(r3)}`)
    sp3b('E8', { what: '루트 리졸버 — 쿠키 없음→첫 소속, 쿠키=B→B, 위조 쿠키→첫 소속', to: [to(r1), to(r2), to(r3)] }, p)
  }
  {
    // A 는 단계 20 에서 이슈를 껐다 — B(이슈 켜짐)의 이슈 화면에서 A 로 전환하면 개요 + fallback
    const p = []
    const q = `/api/nav/switch-target?project=${A.id}&path=${encodeURIComponent(`/p/${B.id}/issues`)}`
    const ok = await raw(ana, q)
    let body = null
    try { body = JSON.parse(ok.html) } catch { /* 아래에서 문제로 */ }
    if (ok.status !== 200 || body?.href !== `/p/${A.id}/dashboard` || body?.fallbackModule !== 'issues') p.push(`ana: ${ok.status} ${ok.html.slice(0, 120)}`)
    const no = await raw(bea, q)
    if (no.status !== 404) p.push(`bea: 상태 ${no.status} ≠ 404`)
    sp3b('E9', { what: '전환 대상 — 이슈가 꺼진 프로젝트는 개요 + fallback, 비소속은 404', body }, p)
  }
  {
    const p = []
    let docs = [], errs = []
    try {
      const { loadPlaywright } = await import('./ui-capture.mjs')
      const { chromium } = await loadPlaywright()
      const browser = await chromium.launch()
      try {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
        await ctx.addCookies([...duo.jar].map(([name, value]) => ({ name, value, url: origin })))
        const page = await ctx.newPage()
        page.on('request', (r) => { if (r.resourceType() === 'document') docs.push(r.url()) })
        page.on('pageerror', (e) => errs.push(String(e)))
        const startPath = wsPath(wsB, 'minutes')
        await page.goto(origin + startPath, { waitUntil: 'networkidle' })
        const link = page.locator(`a[href$="/minutes/${minuteB}"]`).first()
        if ((await link.count()) === 0) p.push(`${startPath} 에 회의록 링크가 없다`)
        else {
          docs = []
          await link.click()
          try { await page.waitForURL((u) => u.pathname === `${wsPath(wsB, 'minutes')}/${minuteB}`, { timeout: 15_000 }) } catch { p.push(`최종 경로 ${new URL(page.url()).pathname}`) }
          if (docs.length) p.push(`전체 새로고침(문서 요청 ${docs.length})`)
          if (errs.length) p.push(`페이지 오류 ${errs.length}`)
          if ((await page.getByText('화면을 불러오지 못했습니다').count()) > 0) p.push('오류 경계가 보인다')
          if (new URL(page.url()).search.includes('_rsc')) p.push('주소에 _rsc 가 샌다')
        }
      } finally { await browser.close() }
    } catch (e) { p.push(`브라우저: ${e instanceof Error ? e.message : String(e)}`) }
    sp3b('E11', { what: '소프트 이동 — 회의록 카드의 영구 링크가 새 상세로(전체 새로고침·오류 경계 없음)', documents: docs.length, pageErrors: errs.length }, p)
  }
  {
    const p = [], seen = {}
    for (const [who, s, uid, mustList] of [['duo', duo, duoWs.userId, true], ['ana', ana, anaWs.userId, false], ['admin', admin, me.id, false]]) {
      const n = rows('소속 수', await svc.from('workspace_members').select('workspace_id').eq('user_id', uid)).length
      seen[who] = n
      if ((n >= 2) !== mustList) { p.push(`${who}: 소속 ${n}곳 — 픽스처가 기대와 다르다`); continue }
      const res = await raw(s, wsPath(wsA))
      if (res.status !== 200) { p.push(`${who}: 상태 ${res.status}`); continue }
      p.push(...switcherVerdict(res.html, mustList).map((x) => `${who}(소속 ${n}): ${x}`))
    }
    // 플랫폼 관리자가 소속 아닌 B 를 볼 때 — 전환기 목록은 소속만(트리거 없음)이고 보는 중 배지가 뜬다
    const viewB = await raw(admin, wsPath(wsB))
    if (viewB.status !== 200) p.push(`admin 이 B 를 볼 때 상태 ${viewB.status}`)
    else {
      p.push(...switcherVerdict(viewB.html, false).map((x) => `admin@B: ${x}`))
      if (!viewB.html.includes('플랫폼 관리자로 보는 중')) p.push('admin@B: 보는 중 배지가 없다')
    }
    sp3b('E5', { what: '전환기 — 소속이 둘 이상(duo)일 때만 트리거, 하나(ana·플랫폼 관리자)면 이름만, 비소속 보기엔 배지', memberships: seen }, p)
  }
  {
    // A 의 이슈(단계 20 에서 끔)를 ana 가 켜면 내비에 링크가 생기고, 끝에 원래 값으로 되돌린다
    const p = []
    const readCfg = async () => {
      const [row] = rows('A 설정', await svc.from('project_settings').select('revision, values').eq('project_id', A.id))
      return { revision: Number(row.revision), enabled: row.values['modules.enabled'] }
    }
    const setModules = async (enabled) => {
      const cur = await readCfg()
      const r = await ana.action(`/p/${A.id}/settings`, 'updateProjectSettings', [A.id, { expectedRevision: cur.revision, commandId: randomUUID(), set: { 'modules.enabled': enabled }, unset: [] }])
      if (!r.result?.ok || r.result.kind !== 'applied') throw new Fail(`sp3b-E7 updateProjectSettings 결과: ${JSON.stringify(r.result)}`)
    }
    const nav = async (expectPresent, what) => {
      const res = await raw(ana, `/p/${A.id}/dashboard`)
      if (res.status !== 200) return [`${what}: 개요 상태 ${res.status}`]
      return issuesLinkVerdict(res.html, A.id, expectPresent).map((x) => `${what}: ${x}`)
    }
    await ana.http('GET', `/p/${A.id}/settings`)
    const original = (await readCfg()).enabled
    if (!Array.isArray(original)) throw new Fail('A 의 modules.enabled 가 배열이 아니다')
    try {
      p.push(...(await nav(original.includes('issues'), '시작')))
      await setModules(original.includes('issues') ? original.filter((m) => m !== 'issues') : [...original, 'issues'])
      p.push(...(await nav(!original.includes('issues'), '바꾼 뒤')))
    } finally {
      const now = (await readCfg()).enabled
      if (JSON.stringify(now) !== JSON.stringify(original)) await setModules(original)
    }
    p.push(...(await nav(original.includes('issues'), '되돌린 뒤')))
    sp3b('E7', { what: '모듈 끈 메뉴 — 프로젝트의 이슈를 켜면 내비에 링크가 생기고 끄면 사라진다(끝에 원래 값으로)', original }, p)
  }
  {
    const p = []
    const shell = async (who, q) => {
      const res = await raw(who, `/api/shell?${q}`)
      let body = null
      try { body = JSON.parse(res.html) } catch { /* 아래에서 상태·badges 문제로 */ }
      return { status: res.status, body }
    }
    p.push(...shellBadgeVerdict(await shell(bea, `ws=${wsA}&project=${A.id}`), 'hidden').map((x) => `bea@A: ${x}`))
    p.push(...shellBadgeVerdict(await shell(bea, `ws=${wsB}&project=${C.id}`), 'own').map((x) => `bea@B: ${x}`))
    sp3b('E10', { what: '비소속 배지 — bea 의 A 범위 /api/shell 은 세 배지 모두 null, 자기 B 는 숫자' }, p)
  }

  // ── 25. 재점검 보강 — 최근 추가분의 완주. 앞 단계의 픽스처를 그대로 쓰고(A·B·C, ana·bea·duo·carol, 플랫폼 관리자) 맨 끝에 둔다:
  //    여기서 플랫폼 관리자의 소속이 둘이 되고(새 워크스페이스의 첫 관리자) A 의 팀·회의록이 늘어, 앞에 두면 sp3b- 단계의 전제(소속 수·목록)가 깨진다.
  //    DB 확인은 앞 단계와 같은 두 길뿐이다 — 세션 클라이언트(RLS)와 service_role 클라이언트(localAdminEnv 가 로컬로 판정한 주소).
  const rc = recheckNames(stamp)
  const allOk = (checks) => Object.values(checks).every(Boolean)
  /** 조건이 참이 될 때까지 기다린다(브라우저의 저장이 서버에 닿는 시간) — 끝내 거짓이면 null */
  const until = async (probe, ms = 15_000) => {
    for (const end = Date.now() + ms; ;) {
      const v = await probe()
      if (v) return v
      if (Date.now() > end) return null
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  /** 워크스페이스 설정 문서(값·revision) — 읽기만 한다. 쓰기는 늘 설정 액션·생성 액션이다 */
  const wsSettingsOf = async (workspaceId) => {
    const doc = rows('워크스페이스 설정', await svc.from('workspace_settings').select('values, revision').eq('workspace_id', workspaceId).single())
    return { values: doc.values, revision: Number(doc.revision) }
  }
  /** 권한 변경 이력(최신 먼저) — 읽기만 한다. 행은 권한 RPC 안에서만 생긴다 */
  const authzRowsOf = async (filter) => rows('권한 이력', await filter(svc.from('authz_events')
    .select('id, kind, workspace_id, target_user_id, before, after, cause, actor_user_id, command_id')).order('id', { ascending: false }))

  // 25a. team-code-merge — 공용 팀을 이름·코드 따로 만든다(addTeam 의 셋째 인자) → 원본 팀 담당의 회의록 → 코드 바꾸기(change_team_code — 그 팀
  //      회의록의 사본 열이 같은 트랜잭션에서 따라간다) → 대상 팀으로 합치기(merge_teams — 원본은 비활성, 회의록 담당은 대상 팀으로, 원본을 가리키는 것 0).
  {
    const teamsPage = wsPath(wsA, 'admin/teams')
    const teamOf = async (id) => rows('공용 팀', await svc.from('teams').select('id, code, name, active').eq('id', id))[0]
    const teamByCode = async (code) => {
      const found = rows(`공용 팀(${code})`, await svc.from('teams').select('id, code, name, active').eq('workspace_id', wsA).is('project_id', null).eq('code', code))
      if (found.length !== 1) throw new Fail(`공용 팀 ${code} 가 ${found.length}건`)
      return found[0]
    }
    await admin.http('GET', teamsPage)
    for (const t of [rc.teams.source, rc.teams.target]) {
      mustOk(`addTeam(${t.code})`, (await admin.action(teamsPage, 'addTeam', [wsA, t.name, t.code])).result)
    }
    const src = await teamByCode(rc.teams.source.code)
    const dst = await teamByCode(rc.teams.target.code)
    await ana.http('GET', wsPath(wsA, 'minutes'))
    const teamMinute = mustOk('createMinute(원본 팀)', (await ana.action(wsPath(wsA, 'minutes'), 'createMinute', [
      minuteInput({ date: meetingDate, teamCode: rc.teams.source.code, title: rc.minutes.team, bodyMd: `# ${rc.minutes.team}\n`, projectId: null }), null, null, wsA,
    ])).result)
    const minuteTeam = async () => {
      const [row] = rows('팀 회의록', await svc.from('minutes').select('team_id, team_code').eq('id', teamMinute.id))
      return row ?? null
    }
    const minuteAtCreate = await minuteTeam()
    const changed = (await admin.action(teamsPage, 'changeTeamCode', [wsA, src.id, rc.teams.renamedCode])).result
    const srcAfterCode = await teamOf(src.id)
    const minuteAfterCode = await minuteTeam()
    const sameCode = (await admin.action(teamsPage, 'changeTeamCode', [wsA, src.id, rc.teams.renamedCode])).result
    const merged = (await admin.action(teamsPage, 'mergeTeams', [wsA, src.id, dst.id])).result
    const srcAfterMerge = await teamOf(src.id)
    const dstAfterMerge = await teamOf(dst.id)
    const minuteAfterMerge = await minuteTeam()
    const mergedAgain = (await admin.action(teamsPage, 'mergeTeams', [wsA, dst.id, dst.id])).result
    const checks = {
      // 이름과 코드가 따로 저장됐다(예전에는 한 입력이 둘 다였다)
      nameAndCodeSeparate: src.name === rc.teams.source.name && src.code === rc.teams.source.code && src.name !== src.code
        && dst.name === rc.teams.target.name && dst.code === rc.teams.target.code,
      minuteOwnedBySource: minuteAtCreate?.team_id === src.id && minuteAtCreate?.team_code === rc.teams.source.code,
      codeChanged: changed?.ok === true && srcAfterCode?.code === rc.teams.renamedCode && srcAfterCode?.name === rc.teams.source.name && srcAfterCode?.active === true,
      minuteCodeFollowed: minuteAfterCode?.team_id === src.id && minuteAfterCode?.team_code === rc.teams.renamedCode,
      sameCodeRejected: sameCode?.ok === false,
      merged: merged?.ok === true && merged.summary?.moved?.minutes >= 1 && merged.summary?.sourceRefsLeft === 0,
      sourceInactive: srcAfterMerge?.active === false && dstAfterMerge?.active === true,
      minuteMovedToTarget: minuteAfterMerge?.team_id === dst.id && minuteAfterMerge?.team_code === rc.teams.target.code,
      selfMergeRejected: mergedAgain?.ok === false,
    }
    step('team-code-merge', {
      source: { id: src.id, name: src.name, code: [rc.teams.source.code, rc.teams.renamedCode] }, target: { id: dst.id, name: dst.name, code: dst.code },
      minuteId: teamMinute.id, minute: { atCreate: minuteAtCreate, afterCode: minuteAfterCode, afterMerge: minuteAfterMerge },
      results: { changed, sameCode, merged, mergedAgain }, checks,
    }, allOk(checks) ? undefined : `팀 코드 변경·병합: ${JSON.stringify({ checks, changed, merged, minuteAfterCode, minuteAfterMerge })}`)
  }

  // 25b. minutes-no-team — 팀 없이 등록(담당 빈 값 — 0052) → 목록의 "팀 없음" 탭 → 팀 지정(상세 화면의 메타 모달이 부르는 updateMinuteMeta) → 해제.
  {
    const listPage = wsPath(wsA, 'minutes')
    await ana.http('GET', listPage)
    const created = mustOk('createMinute(팀 없음)', (await ana.action(listPage, 'createMinute', [
      minuteInput({ date: meetingDate, teamCode: '', title: rc.minutes.noTeam, bodyMd: `# ${rc.minutes.noTeam}\n`, projectId: null }), null, null, wsA,
    ])).result)
    const teamOfMinute = async () => {
      const [row] = rows('팀 없는 회의록', await svc.from('minutes').select('team_id, team_code, folder_id, workspace_id, project_id').eq('id', created.id))
      return row ?? null
    }
    const atCreate = await teamOfMinute()
    const noTeamHtml = await (await ana.http('GET', `${listPage}?team=${NO_TEAM_FILTER}`)).text()
    const [opsTeam] = rows(`공용 팀(${WS_TEAM})`, await svc.from('teams').select('id, code, active').eq('workspace_id', wsA).is('project_id', null).eq('code', WS_TEAM))
    if (!opsTeam?.active) throw new Fail(`팀 지정에 쓸 공용 팀 ${WS_TEAM} 이 없거나 비활성이다`)
    const detail = `${listPage}/${created.id}`
    await ana.http('GET', detail)
    const patch = (teamCode) => minuteMetaPatch({ date: meetingDate, title: rc.minutes.noTeam, teamCode })
    const assigned = (await ana.action(detail, 'updateMinuteMeta', [created.id, patch(WS_TEAM)])).result
    const afterAssign = await teamOfMinute()
    const teamHtml = await (await ana.http('GET', `${listPage}?team=${opsTeam.id}`)).text()
    const cleared = (await ana.action(detail, 'updateMinuteMeta', [created.id, patch('')])).result
    const afterClear = await teamOfMinute()
    const unknownTeam = (await ana.action(detail, 'updateMinuteMeta', [created.id, patch(`ZZ${stamp.slice(-4)}`)])).result
    const checks = {
      createdWithoutTeam: atCreate?.team_id === null && atCreate?.team_code === '' && atCreate?.workspace_id === wsA && atCreate?.project_id === null,
      listedUnderNoTeam: noTeamHtml.includes(rc.minutes.noTeam) && noTeamHtml.includes(NO_TEAM_LABEL),
      assigned: assigned?.ok === true && afterAssign?.team_id === opsTeam.id && afterAssign?.team_code === WS_TEAM,
      listedUnderTeam: teamHtml.includes(rc.minutes.noTeam),
      cleared: cleared?.ok === true && afterClear?.team_id === null && afterClear?.team_code === '',
      // 없는 팀 코드는 "팀 없음"으로 삼키지 않고 거부한다
      unknownTeamRejected: unknownTeam?.ok === false,
    }
    step('minutes-no-team', { minuteId: created.id, team: { id: opsTeam.id, code: WS_TEAM }, rows: { atCreate, afterAssign, afterClear },
      results: { assigned, cleared, unknownTeam }, checks },
    allOk(checks) ? undefined : `팀 없는 회의록: ${JSON.stringify({ checks, atCreate, afterAssign, afterClear, assigned, cleared })}`)
  }

  // 25c. notify-policy — 워크스페이스가 작업 배정 알림을 끄면(설정 액션) 담당 지정이 이벤트·수신자 행을 하나도 만들지 않고, 다시 켜면 만든다.
  //      대상은 프로젝트 A 의 리프(단계 6 의 것)와 계정이 있는 멤버 carol — 행위자(플랫폼 관리자)와 다른 사람이어야 수신자가 생긴다.
  {
    const settingsPage = `/w/${encodeURIComponent(slugA)}/settings`
    const wbsPage = `/p/${A.id}/wbs`
    const key = 'notify.policy'
    const stored = (await wsSettingsOf(wsA)).values[key]   // 없으면 undefined — 끝에 그 상태로 되돌린다
    const setPolicy = async (value) => {
      await admin.http('GET', settingsPage)
      const { revision } = await wsSettingsOf(wsA)
      return mustOk('updateWorkspaceSettings(알림 정책)', (await admin.action(settingsPage, 'updateWorkspaceSettings',
        [wsA, { expectedRevision: revision, commandId: randomUUID(), ...settingPatch(key, value) }])).result)
    }
    const events = async () => rows('알림 이벤트', await svc.from('notification_events').select('id').eq('type', NOTIFY_PROBE_TYPE).eq('entity_id', leaf.id)).map((e) => e.id)
    const recipientsOf = async (ids) => (ids.length === 0 ? []
      : rows('알림 수신자', await svc.from('notification_recipients').select('event_id, member_id, user_id').in('event_id', ids)))
    const assigneeOf = async () => rows('리프 담당', await svc.from('wbs_items').select('assignee_member_id').eq('id', leaf.id).single()).assignee_member_id
    await admin.http('GET', wbsPage)
    const assign = async (memberId) => mustOk(`setWbsAssignee(${memberId ? '지정' : '해제'})`, (await admin.action(wbsPage, 'setWbsAssignee', [leaf.id, memberId])).result)
    const originalAssignee = await assigneeOf()
    const [carolUser] = rows('carol 계정', await svc.from('profiles').select('user_id').eq('email', INVITEE.email))
    let offNew = [], onNew = [], onRecipients = [], offStored, restored = false
    try {
      await assign(null)                                   // 같은 담당자 재지정은 발행하지 않는다 — 빈 상태에서 시작한다
      const before = await events()
      await setPolicy(notifyPolicyOf(NOTIFY_PROBE_TYPE, false))
      offStored = (await wsSettingsOf(wsA)).values[key]
      await assign(carolMemberId)
      offNew = (await events()).filter((id) => !before.includes(id))
      await assign(null)
      await setPolicy(notifyPolicyOf(NOTIFY_PROBE_TYPE, true))
      await assign(carolMemberId)
      onNew = (await events()).filter((id) => !before.includes(id))
      onRecipients = await recipientsOf(onNew)
    } finally {
      // 설정과 담당을 시작 상태로 — 실패해도 되돌린다(뒤 단계와 다시 돌리는 사람이 같은 바닥에서 시작하게)
      const now = (await wsSettingsOf(wsA)).values[key]
      if (JSON.stringify(now) !== JSON.stringify(stored)) await setPolicy(stored)
      if ((await assigneeOf()) !== originalAssignee) await assign(originalAssignee)
      restored = JSON.stringify((await wsSettingsOf(wsA)).values[key]) === JSON.stringify(stored) && (await assigneeOf()) === originalAssignee
    }
    const checks = {
      policyStored: JSON.stringify(offStored) === JSON.stringify(notifyPolicyOf(NOTIFY_PROBE_TYPE, false)),
      offNoEvent: offNew.length === 0,
      onOneEvent: onNew.length === 1,
      onRecipientIsCarol: onRecipients.length === 1 && onRecipients[0].member_id === carolMemberId && onRecipients[0].user_id === carolUser?.user_id,
      restored,
    }
    step('notify-policy', { type: NOTIFY_PROBE_TYPE, itemId: leaf.id, recipientMemberId: carolMemberId, events: { off: offNew.length, on: onNew.length },
      recipients: onRecipients.length, checks },
    allOk(checks) ? undefined : `알림 정책: ${JSON.stringify({ checks, off: offNew.length, on: onNew.length, onRecipients })}`)
  }

  // 25d. conflict-compare — 같은 주간 시트를 두 브라우저 컨텍스트(같은 계정)로 연다. 첫 컨텍스트가 제목 칸에 들어가 있는 동안 둘째가 제목을 저장하고,
  //      첫 컨텍스트가 다른 제목으로 나오면 서버가 쓰지 않고 비교(내 값·서버 값)를 띄운다 → "서버 값 받기" → 입력은 서버 제목, DB 는 둘째의 값 그대로.
  //      프로젝트 B 는 단계 weekly-carry-mapping 이 이번 주 문서를 만들어 뒀고 플랫폼 관리자는 그 멤버다.
  {
    const p = []
    const detail = { titles: rc.weeklyTitle, dialogText: null, shownAfter: null, storedAfter: null, pageErrors: 0 }
    const titleRows = async (title) => rows('주간 제목', await svc.from('weekly_reports').select('id, title').eq('project_id', B.id).eq('title', title))
    try {
      const { loadPlaywright } = await import('./ui-capture.mjs')
      const { chromium } = await loadPlaywright()
      const browser = await chromium.launch()
      try {
        const errs = []
        const open = async () => {
          const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
          await ctx.addCookies([...admin.jar].map(([name, value]) => ({ name, value, url: origin })))
          const page = await ctx.newPage()
          page.on('pageerror', (e) => errs.push(String(e)))
          await page.goto(`${origin}/p/${B.id}/weekly`, { waitUntil: 'networkidle' })
          return page
        }
        const first = await open()
        const mineInput = first.locator(WEEKLY_TITLE_INPUT).first()
        if ((await mineInput.count()) === 0) p.push('첫 컨텍스트에 시트 제목 입력이 없다(이번 주 문서가 열리지 않았다)')
        else {
          // 칸에 들어가 둔다 — 편집 중인 입력은 내려온 서버 제목으로 바뀌지 않는다(그래서 나올 때 기대값이 옛 제목이다)
          await mineInput.click()
          const second = await open()
          const theirsInput = second.locator(WEEKLY_TITLE_INPUT).first()
          await theirsInput.fill(rc.weeklyTitle.theirs)
          await theirsInput.blur()
          const saved = await until(async () => ((await titleRows(rc.weeklyTitle.theirs)).length === 1 ? true : null))
          if (!saved) p.push('둘째 컨텍스트의 제목이 저장되지 않았다')
          else {
            await mineInput.fill(rc.weeklyTitle.mine)
            await mineInput.blur()
            const dialog = first.locator(CONFLICT_DIALOG)
            try { await dialog.waitFor({ state: 'visible', timeout: 15_000 }) } catch { p.push('비교 대화상자가 뜨지 않았다(충돌이 조용히 덮였거나 저장이 거부되지 않았다)') }
            if ((await dialog.count()) > 0) {
              detail.dialogText = (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 300)
              if (!detail.dialogText.includes(rc.weeklyTitle.mine)) p.push('비교에 내 값이 없다')
              if (!detail.dialogText.includes(rc.weeklyTitle.theirs)) p.push('비교에 서버 값이 없다')
              // 비교가 떠 있는 동안 서버는 그대로다 — 내 값이 저장되지 않았다
              if ((await titleRows(rc.weeklyTitle.mine)).length !== 0) p.push('비교를 고르기도 전에 내 값이 저장됐다')
              await dialog.getByRole('button', { name: CONFLICT_TAKE_LATEST }).click()
              try { await dialog.waitFor({ state: 'hidden', timeout: 10_000 }) } catch { p.push('서버 값 받기 뒤에도 비교가 닫히지 않았다') }
              detail.shownAfter = await mineInput.inputValue()
              if (detail.shownAfter !== rc.weeklyTitle.theirs) p.push(`입력이 서버 제목이 아니다: ${JSON.stringify(detail.shownAfter)}`)
            }
          }
          const [mineStored, theirsStored] = [await titleRows(rc.weeklyTitle.mine), await titleRows(rc.weeklyTitle.theirs)]
          detail.storedAfter = { mine: mineStored.length, theirs: theirsStored.length }
          if (mineStored.length !== 0 || theirsStored.length !== 1) p.push(`저장된 제목이 둘째의 값 하나가 아니다: ${JSON.stringify(detail.storedAfter)}`)
        }
        detail.pageErrors = errs.length
        if (errs.length) p.push(`페이지 오류 ${errs.length}`)
      } finally { await browser.close() }
    } catch (e) { p.push(`브라우저: ${e instanceof Error ? e.message : String(e)}`) }
    step('conflict-compare', { what: '주간 제목 충돌 → 비교 → 서버 값 받기(쓰지 않는다)', projectId: B.id, ...detail, problems: p }, p.length ? p.join(' · ') : undefined)
  }

  // 25e. workspace-create — 플랫폼 관리 화면(/admin/workspaces)의 createPlatformWorkspace. 워크스페이스·첫 관리자 멤버십·인물·설정이 한 번에 생기고
  //      (0054 의 생성 RPC — 설정 값은 그 안에서 설정 RPC 가 쓴다), 같은 slug 는 다시 못 쓰고 반쪽 행이 남지 않는다. 만든 뒤 그 워크스페이스로 들어간다.
  //      플랫폼 관리자가 아닌 ana 에게 이 화면은 없다(404).
  let newWs
  {
    const page = '/admin/workspaces'
    const modules = ['kanban', 'wiki']
    const before = rows('워크스페이스 수', await svc.from('workspaces').select('id')).length
    await admin.http('GET', page)
    const made = (await admin.action(page, 'createPlatformWorkspace', [{ name: rc.workspace.name, slug: rc.workspace.slug, modules }])).result
    if (!made?.ok) throw new Fail(`createPlatformWorkspace 실패: ${JSON.stringify(made)}`)
    const found = rows('새 워크스페이스', await svc.from('workspaces').select('id, slug, name, created_by').eq('slug', rc.workspace.slug))
    if (found.length !== 1) throw new Fail(`새 워크스페이스 ${rc.workspace.slug} 가 ${found.length}건`)
    newWs = found[0]
    slugOf.set(newWs.id, newWs.slug)
    const members = rows('새 워크스페이스 소속', await svc.from('workspace_members').select('user_id, role, invited_by').eq('workspace_id', newWs.id))
    const people = rows('새 워크스페이스 인물', await svc.from('people').select('user_id, email').eq('workspace_id', newWs.id))
    const settings = await wsSettingsOf(newWs.id)
    const joined = await authzRowsOf((q) => q.eq('workspace_id', newWs.id).eq('kind', 'workspace_role'))
    const dup = (await admin.action(page, 'createPlatformWorkspace', [{ name: `${rc.workspace.name} 2`, slug: rc.workspace.slug, modules }])).result
    const after = rows('워크스페이스 수', await svc.from('workspaces').select('id')).length
    const listHtml = await (await admin.http('GET', page)).text()
    const home = await raw(admin, wsPath(newWs.id))
    const projectsPage = await raw(admin, wsPath(newWs.id, 'projects'))
    const anaView = await raw(ana, page, { follow: true })
    const checks = {
      created: made.workspace?.id === newWs.id && newWs.name === rc.workspace.name && newWs.created_by === me.id,
      firstAdminIsCreator: JSON.stringify(members) === JSON.stringify([{ user_id: me.id, role: 'admin', invited_by: me.id }]),
      person: people.length === 1 && people[0].user_id === me.id && people[0].email === email,
      modulesStored: JSON.stringify([...(settings.values['modules.allowed'] ?? [])].sort()) === JSON.stringify([...modules].sort()) && settings.revision === 1,
      joinRecorded: joined.length === 1 && joined[0].actor_user_id === me.id && joined[0].target_user_id === me.id && !!joined[0].command_id
        && JSON.stringify(joined[0].after) === JSON.stringify({ role: 'admin', invited_by: me.id }),
      // 같은 slug 는 사유 코드로 거부되고 워크스페이스는 하나만 늘었다(반쪽 행 없음)
      slugTaken: dup?.ok === false && dup.code === 'slug_taken' && dup.field === 'slug' && after === before + 1,
      listed: listHtml.includes(rc.workspace.slug) && listHtml.includes(rc.workspace.name),
      entered: home.status === 200 && !notFoundRendered(home.html) && home.html.includes(rc.workspace.name) && projectsPage.status === 200,
      hiddenFromWorkspaceAdmin: hiddenVerdict(anaView, [rc.workspace.name]).length === 0,
    }
    step('workspace-create', { workspace: { id: newWs.id, slug: newWs.slug, name: newWs.name }, members, modules: settings.values['modules.allowed'],
      revision: settings.revision, duplicate: dup, status: { home: home.status, projects: projectsPage.status, ana: anaView.status }, checks },
    allOk(checks) ? undefined : `워크스페이스 생성: ${JSON.stringify({ checks, members, people, settings, dup, home: home.status, ana: anaView.status })}`)
  }

  // 25f. account-lifecycle — 새 계정 leaver(A 멤버·프로젝트 A 멤버)로 ① 관리자의 비밀번호 재설정이 권한 변경 이력에 남고 새 비밀번호로만 로그인된다
  //      ② 세션(워크스페이스 관리자 ana)의 소속 직접 삭제는 거부된다(0054 — 초대·토큰 회수 없이 소속만 빠지는 길을 닫았다)
  //      ③ 제거(remove_workspace_member)는 소속을 지우고 그 워크스페이스의 명단 권한을 회수한다 — 그 사람의 세션으로 프로젝트·워크스페이스 화면이 닫힌다.
  {
    const accountsPage = wsPath(wsA, 'admin/accounts')
    const firstPassword = `E2E-${randomUUID()}`
    const nextPassword = `E2E-${randomUUID()}`
    await admin.http('GET', accountsPage)
    mustOk(`createAccount(${LEAVER.name})`, (await admin.action(accountsPage, 'createAccount', [{
      workspaceId: wsA, email: LEAVER.email, password: firstPassword, name: LEAVER.name, workspaceRole: 'member', projectId: A.id, accessRole: 'member',
    }])).result)
    const lv = await membershipOf(LEAVER.email)
    const accessOf = async () => rows('leaver 명단', await svc.from('project_members').select('access_role, people!inner(user_id)').eq('project_id', A.id).eq('people.user_id', lv.userId))
      .map((r) => r.access_role)
    const accessBefore = await accessOf()
    // ① 비밀번호 재설정 — 기록이 먼저, 변경이 다음이다
    const reset = (await admin.action(accountsPage, 'resetPassword', [wsA, lv.userId, nextPassword])).result
    const resetRows = await authzRowsOf((q) => q.eq('kind', 'password_reset').eq('workspace_id', wsA).eq('target_user_id', lv.userId))
    const leaver = session('leaver')
    await leaver.login(LEAVER.email, nextPassword)
    const oldLogin = await session('leaver-old').sb.auth.signInWithPassword({ email: LEAVER.email, password: firstPassword })
    const pageBefore = await raw(leaver, `/p/${A.id}/dashboard`)
    // ② 세션의 직접 삭제 — 워크스페이스 관리자여도 권한에서 막힌다
    const direct = await ana.sb.from('workspace_members').delete().eq('workspace_id', wsA).eq('user_id', lv.userId).select('user_id')
    const afterDirect = await membershipOf(LEAVER.email)
    // ③ 제거 — 계정 관리 화면이 부르는 액션(ana 는 A 의 관리자, 대상은 멤버)
    await ana.http('GET', accountsPage)
    const removed = (await ana.action(accountsPage, 'removeWorkspaceMember', [wsA, lv.userId])).result
    const afterRemove = await membershipOf(LEAVER.email)
    const accessAfter = await accessOf()
    const leftRows = await authzRowsOf((q) => q.eq('kind', 'workspace_role').eq('workspace_id', wsA).eq('target_user_id', lv.userId))
    const pageAfter = await raw(leaver, `/p/${A.id}/dashboard`, { follow: true })
    const wsAfter = await raw(leaver, wsPath(wsA), { follow: true })
    const removedAgain = (await ana.action(accountsPage, 'removeWorkspaceMember', [wsA, lv.userId])).result
    const checks = {
      joined: JSON.stringify(lv.memberships) === JSON.stringify([{ workspace_id: wsA, role: 'member' }]) && JSON.stringify(accessBefore) === JSON.stringify(['member']),
      resetRecorded: reset?.ok === true && resetRows.length === 1 && resetRows[0].actor_user_id === me.id && resetRows[0].cause === 'direct'
        && !!resetRows[0].command_id && JSON.stringify(resetRows[0].after) === JSON.stringify({ reset: true }),
      newPasswordOnly: !!oldLogin.error && pageBefore.status === 200,
      directDeleteDenied: direct.error?.code === '42501' && afterDirect.memberships.length === 1,
      removed: removed?.ok === true && removed.removed?.projects >= 1 && afterRemove.memberships.length === 0,
      accessRevoked: JSON.stringify(accessAfter) === JSON.stringify([null]),
      removalRecorded: leftRows[0]?.actor_user_id === anaWs.userId && leftRows[0]?.after === null && JSON.stringify(leftRows[0]?.before) === JSON.stringify({ role: 'member' }) && !!leftRows[0]?.command_id,
      projectClosed: hiddenVerdict(pageAfter, [A.name]).length === 0,
      workspaceClosed: hiddenVerdict(wsAfter, [A.name]).length === 0,
      // 이미 빠진 사람을 다시 빼는 요청은 조용한 성공이 아니다
      secondRemovalRejected: removedAgain?.ok === false,
    }
    step('account-lifecycle', {
      userId: lv.userId, reset: { ok: reset?.ok ?? null, rows: resetRows.length }, directDelete: direct.error ? { code: direct.error.code } : 'ok',
      removed, access: { before: accessBefore, after: accessAfter }, memberships: { before: lv.memberships.length, after: afterRemove.memberships.length },
      status: { projectBefore: pageBefore.status, projectAfter: pageAfter.status, workspaceAfter: wsAfter.status }, checks,
    }, allOk(checks) ? undefined : `계정 수명주기: ${JSON.stringify({ checks, reset, removed, direct: direct.error?.code ?? 'ok', accessAfter, resetRows: resetRows.length })}`)
  }

  // 25g. health-headers — 무인증 헬스체크(얕은 점검은 DB 를 건드리지 않고, 깊은 점검은 잡 시크릿이 맞을 때만)와 /login 응답의 보안 헤더.
  {
    const health = async (query, headers = {}) => {
      const res = await fetch(`${base}/api/health${query}`, { headers, redirect: 'manual' })
      return { status: res.status, body: await res.json().catch(() => null), cacheControl: res.headers.get('cache-control') }
    }
    const shallow = await health('')
    const deepNoSecret = await health('?deep=1')
    const deep = await health('?deep=1', { authorization: `Bearer ${cronSecret}` })
    const login = await fetch(`${base}/login`, { redirect: 'manual' })
    const problems = [
      ...healthProblems(shallow, 'shallow').map((x) => `얕은 점검: ${x}`),
      ...healthProblems(deepNoSecret, 'shallow').map((x) => `시크릿 없는 깊은 점검: ${x}`),
      ...healthProblems(deep, 'deep').map((x) => `깊은 점검: ${x}`),
      ...(login.status === 200 ? [] : [`/login 상태 ${login.status}`]),
      ...securityHeaderProblems(login.headers).map((x) => `/login: ${x}`),
    ]
    step('health-headers', { health: { shallow: shallow.body, deepNoSecret: deepNoSecret.body, deep: deep.body }, loginStatus: login.status,
      hsts: login.headers.get('strict-transport-security'), problems }, problems.length ? problems.join(' · ') : undefined)
  }

  // 25h. minutes-share-link — 회의록 상세의 공유 모달이 부르는 setMinuteShare. 켜면 로그인하지 않은 요청으로 열리고(제목이 본문에 있다), 끄면 같은
  //      주소가 닫힌다. 토큰은 결과에 남기지 않는다(길이만) — 주소가 곧 열람 권한이다. 대상은 A 의 프로젝트 없는 회의록(단계 16, 작성자 ana).
  {
    const target = minutes[1]
    const detail = `${wsPath(wsA, 'minutes')}/${target.minuteId}`
    const anon = async (token) => {
      const res = await fetch(`${origin}/share/minutes/${token}`, { redirect: 'manual' })
      return { status: res.status, html: res.status >= 300 && res.status < 400 ? '' : await res.text() }
    }
    await ana.http('GET', detail)
    const on = (await ana.action(detail, 'setMinuteShare', [target.minuteId, 'enable'])).result
    if (!on?.ok || typeof on.token !== 'string' || !on.token) throw new Fail(`공유 켜기 실패: ${JSON.stringify({ ok: on?.ok ?? null, enabled: on?.enabled ?? null, error: on?.error ?? null })}`)
    const opened = await anon(on.token)
    const off = (await ana.action(detail, 'setMinuteShare', [target.minuteId, 'disable'])).result
    const closed = await anon(on.token)
    const bogus = await anon(randomUUID())
    const [stored] = rows('공유 상태', await svc.from('minutes').select('share_enabled').eq('id', target.minuteId))
    const checks = {
      enabled: on.enabled === true,
      openedWithoutLogin: opened.status === 200 && !notFoundRendered(opened.html) && opened.html.includes(target.title),
      disabled: off?.ok === true && off.enabled === false && stored?.share_enabled === false,
      closedAfterRevoke: hiddenVerdict(closed, [target.title]).length === 0,
      unknownTokenClosed: hiddenVerdict(bogus, [target.title]).length === 0,
    }
    step('minutes-share-link', { minuteId: target.minuteId, tokenLength: on.token.length, status: { opened: opened.status, closed: closed.status, bogus: bogus.status }, checks },
      allOk(checks) ? undefined : `회의록 공유 링크: ${JSON.stringify({ checks, status: { opened: opened.status, closed: closed.status, bogus: bogus.status } })}`)
  }

  // 25i. workers(선택) — 색인 워커·위키 워커·첨부 청소 잡을 한 번씩 친다. 서버가 그 플래그로 떠 있어야 하므로 E2E_WORKERS=1 일 때만 돈다.
  //      꺼져 있으면 건너뜀으로 기록한다(실패로 세지 않는다). 색인은 failed 0 이고 문서가 쌓여 있어야 한다(임베딩 키가 있는 서버).
  if (!workersEnabled(process.env)) {
    step('workers', { skipped: true, reason: 'E2E_WORKERS=1 이 아니다 — 색인·위키 워커 단계를 건너뛴다(실패로 세지 않는다)' })
  } else {
    const job = async (path) => {
      const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${cronSecret}` }, redirect: 'manual' })
      return { status: res.status, body: await res.json().catch(() => null) }
    }
    const docCount = async () => {
      const { count, error } = await svc.from('ai_documents').select('id', { count: 'exact', head: true })
      if (error || typeof count !== 'number') throw new Fail(`색인 문서 수 조회 실패: ${error?.message ?? '행 수 없음'}`)
      return count
    }
    const docsBefore = await docCount()
    const index = await job('/api/cron/ai-index')
    const docsAfter = await docCount()
    const wiki = await job('/api/wiki/worker')
    const gc = await job('/api/cron/minutes-attachments-gc')
    const problems = workerProblems({ index, wiki, gc, docsBefore, docsAfter })
    step('workers', { skipped: false, index: { status: index.status, body: index.body }, documents: { before: docsBefore, after: docsAfter },
      wiki: { status: wiki.status, body: wiki.body }, gc: { status: gc.status, body: gc.body }, problems }, problems.length ? problems.join(' · ') : undefined)
  }

  // ── 26. 설정 반영 완주 — 카탈로그에서 wired 로 남아 있던 키마다 "설정 값을 바꾼다 → 그 값이 화면·동작에 나타난다 → 다른 워크스페이스
  //    (프로젝트 키는 다른 프로젝트)에는 나타나지 않는다 → 되돌린다" 를 한 단계로 본다(단계 이름 setting-<키>). 이 단계들이 카탈로그 상태 verified 의
  //    근거다(src/lib/settings/catalog-meta.ts 의 E2E_EVIDENCE — 단계 이름을 바꾸면 그 표도 바꾼다). 알림 정책의 두 워크스페이스 격리는
  //    합성 게이트의 S7b 가 본다. 맨 끝에 둔다: 앞 단계의 설정값·소속 수·모듈 상태를 전제하는 단계가 뒤에 없고, 각 단계가 자기 값을 되돌린다.
  //    쓰기는 설정 화면이 부르는 액션(updateWorkspaceSettings·updateProjectSettings — 플랫폼 관리자), 읽기는 그 범위의 보통 계정이 여는 화면이다
  //    (두 워크스페이스에 모두 속한 duo, A 관리자 ana, B 관리자 bea). 워크스페이스 A = 바꾸는 쪽, B = 그대로여야 하는 쪽.
  const sp = settingProbeNames(stamp)
  /** 프로젝트 설정 문서(값·revision) — 읽기만 한다. 쓰기는 늘 설정 액션이다 */
  const projectSettingsOf = async (projectId) => {
    const doc = rows('프로젝트 설정', await svc.from('project_settings').select('values, revision').eq('project_id', projectId).single())
    return { values: doc.values, revision: Number(doc.revision) }
  }
  /** 한 키를 설정 화면과 같은 액션으로 쓴다 — 값이 undefined 면 키를 지운다(저장값이 없던 상태로) */
  const workspaceKey = (workspaceId, key) => ({
    key, read: () => wsSettingsOf(workspaceId),
    put: async (value) => {
      const page = wsPath(workspaceId, 'settings')
      await admin.http('GET', page)
      const { revision } = await wsSettingsOf(workspaceId)
      return mustOk(`updateWorkspaceSettings(${key})`, (await admin.action(page, 'updateWorkspaceSettings',
        [workspaceId, { expectedRevision: revision, commandId: randomUUID(), ...settingPatch(key, value) }])).result)
    },
  })
  const projectKey = (projectId, key) => ({
    key, read: () => projectSettingsOf(projectId),
    put: async (value) => {
      const page = `/p/${projectId}/settings`
      await admin.http('GET', page)
      const { revision } = await projectSettingsOf(projectId)
      return mustOk(`updateProjectSettings(${key})`, (await admin.action(page, 'updateProjectSettings',
        [projectId, { expectedRevision: revision, commandId: randomUUID(), ...settingPatch(key, value) }])).result)
    },
  })
  /**
   * 값을 넣고 probe 를 돌린 뒤 저장값을 시작 상태로 되돌린다 — probe 가 던져도 되돌린다(뒤 단계와 다시 돌리는 사람이 같은 바닥에서 시작하게).
   * toInput: 저장 형태와 입력 형태가 다른 키(강조색 — 입력은 hex 하나, 저장은 파생 세트)의 되돌리기 입력.
   */
  const withSetting = async (target, value, probe, { toInput = (stored) => stored } = {}) => {
    const stored = (await target.read()).values[target.key]
    let out, restored = false
    try {
      await target.put(value)
      out = await probe((await target.read()).values[target.key])
    } finally {
      const now = (await target.read()).values[target.key]
      if (canonicalJson(now) !== canonicalJson(stored)) await target.put(toInput(stored))
      restored = canonicalJson((await target.read()).values[target.key]) === canonicalJson(stored)
    }
    return { out, restored }
  }
  const settingStep = (name, key, detail, checks) => step(name, { key, ...detail, checks },
    allOk(checks) ? undefined : `${key}: ${JSON.stringify({ checks, ...detail }).slice(0, 1500)}`)
  /** 화면 한 장(상태·본문) — 열려야 하는 화면이라 200 이 아니면 그 자리에서 멈춘다(빈 본문으로 '없음'을 판정하지 않는다) */
  const screenOf = async (who, path, extra = {}) => {
    const res = await raw(who, path, { extra })
    if (res.status !== 200) throw new Fail(`[${who.label}] GET ${path} → ${res.status}(설정 반영을 볼 화면이 열리지 않는다)`)
    return res.html
  }
  // 범위마다 한 장씩: 워크스페이스 범위(/w/<slug>/…)·프로젝트 범위(/p/<id>/…)·전역 범위(/account — 쿠키가 가리키는 소속 워크스페이스)
  const shellPages = async (side) => (side === 'A'
    ? { workspace: await screenOf(duo, wsPath(wsA, 'projects')), project: await screenOf(ana, `/p/${A.id}/dashboard`), global: await screenOf(duo, '/account', { 'dflow-ws': slugA }) }
    : { workspace: await screenOf(duo, wsPath(wsB, 'projects')), project: await screenOf(bea, `/p/${C.id}/dashboard`), global: await screenOf(duo, '/account', { 'dflow-ws': OTHER_WORKSPACE.slug }) })
  const everyScope = (pages, test) => Object.fromEntries(Object.entries(pages).map(([scope, html]) => [scope, test(html)]))
  const allTrue = (o) => Object.values(o).every((v) => v === true)

  // 26a. setting-extra-axis — core.extra_axis_label(프로젝트 N). 작업 계획 화면과 가져오기 마법사에 그 이름이 실리고, 엑셀 내보내기의 그 열 머리가
  //      그 이름이며, 그 파일을 다시 감지시키면 그 열이 추가 축으로 잡힌다. 같은 파일을 이름이 없는 프로젝트(B)로 감지시키면 그 열을 못 찾는다
  //      (별칭이 그 프로젝트의 설정에서만 온다). B 의 화면에는 그 이름이 없다.
  {
    const target = projectKey(N.id, 'core.extra_axis_label')
    const has = async (projectId, seg) => (await screenOf(admin, `/p/${projectId}/${seg}`)).includes(sp.axis)
    const exported = async () => {
      const buf = Buffer.from(await (await admin.http('GET', `/api/export?projectId=${N.id}`)).arrayBuffer())
      return { buf, head: (await zipTextParts(buf)).some((part) => part.text.includes(sp.axis)) }
    }
    /** 그 프로젝트의 감지가 잡은 추가 축 열(0 부터) — 못 찾으면 null, 파일을 못 읽으면 'unreadable' */
    const detectedAxis = async (buf, projectId) => {
      const res = await admin.http('POST', '/api/import/inspect', { body: inspectForm({ file: buf, fileName: 'wbs-axis.xlsx', projectId }), expect: [200, 400] })
      return res.status === 200 ? (await res.json()).detection?.profile?.logical?.extraAxis ?? null : 'unreadable'
    }
    const before = { wbs: await has(N.id, 'wbs'), exportHead: (await exported()).head }
    const { out, restored } = await withSetting(target, sp.axis, async (stored) => {
      const file = await exported()
      writeFileSync(join(outDir, 'wbs-n-extra-axis.xlsx'), file.buf)
      return {
        stored, wbs: await has(N.id, 'wbs'), wizard: await has(N.id, 'import'), exportHead: file.head,
        detectedHere: await detectedAxis(file.buf, N.id), detectedElsewhere: await detectedAxis(file.buf, B.id),
        otherWbs: await has(B.id, 'wbs'), otherWizard: await has(B.id, 'import'),
      }
    })
    const after = { wbs: await has(N.id, 'wbs'), exportHead: (await exported()).head }
    settingStep('setting-extra-axis', target.key, { projectId: N.id, otherProjectId: B.id, label: sp.axis, before, during: out, after }, {
      cleanStart: !before.wbs && !before.exportHead,
      stored: out.stored === sp.axis,
      shownOnWbs: out.wbs, shownOnImportWizard: out.wizard, exportHeader: out.exportHead,
      roundTripDetected: Number.isInteger(out.detectedHere),
      otherProjectDoesNotDetect: out.detectedElsewhere === null,
      otherProjectClean: !out.otherWbs && !out.otherWizard,
      restored: restored && !after.wbs && !after.exportHead,
    })
  }

  // 26b. setting-views-default — views.default(프로젝트 N). 주소에 보기를 적지 않은 첫 진입이 보드로 열리고, 주소의 보기(sheet)가 설정을 이기며,
  //      다른 프로젝트(B)의 첫 진입은 표 그대로다. 개인 설정은 이 판정에 끼지 않는다(주소 → 이 설정 → 표).
  {
    const target = projectKey(N.id, 'views.default')
    const board = async (projectId, query = '') => kanbanBoardRendered(await screenOf(admin, `/p/${projectId}/wbs${query}`))
    const before = await board(N.id)
    const { out, restored } = await withSetting(target, { wbs: 'board' }, async (stored) => ({
      stored, first: await board(N.id), explicitSheet: await board(N.id, '?view=sheet'), other: await board(B.id),
    }))
    const after = await board(N.id)
    settingStep('setting-views-default', target.key, { projectId: N.id, otherProjectId: B.id, before, during: out, after }, {
      cleanStart: before === false,
      stored: canonicalJson(out.stored) === canonicalJson({ wbs: 'board' }),
      firstEntryIsBoard: out.first === true,
      urlBeatsSetting: out.explicitSheet === false,
      otherProjectStaysSheet: out.other === false,
      restored: restored && after === false,
    })
  }

  // 26c. setting-portal-widgets — portal.widgets(워크스페이스 A). 위젯 하나를 끄면 A 의 홈에서 그 위젯만 사라지고(다른 위젯은 그대로),
  //      같은 계정(duo)이 여는 B 의 홈에는 남는다. duo 는 개인 숨김이 없는 계정이다(개인 숨김은 이 설정과 다른 층).
  {
    const target = workspaceKey(wsA, 'portal.widgets')
    const widgets = async (workspaceId) => widgetIdsOf(await screenOf(duo, wsPath(workspaceId)))
    const before = { a: await widgets(wsA), b: await widgets(wsB) }
    const { out, restored } = await withSetting(target, portalWidgetsOff(PORTAL_PROBE_WIDGET), async (stored) => ({
      stored, a: await widgets(wsA), b: await widgets(wsB),
    }))
    const after = await widgets(wsA)
    settingStep('setting-portal-widgets', target.key, { widget: PORTAL_PROBE_WIDGET, before, during: { a: out.a, b: out.b }, after }, {
      cleanStart: before.a.includes(PORTAL_PROBE_WIDGET) && before.b.includes(PORTAL_PROBE_WIDGET),
      stored: canonicalJson(out.stored) === canonicalJson(portalWidgetsOff(PORTAL_PROBE_WIDGET)),
      goneFromHome: !out.a.includes(PORTAL_PROBE_WIDGET),
      othersKept: JSON.stringify(out.a) === JSON.stringify(before.a.filter((id) => id !== PORTAL_PROBE_WIDGET)),
      otherWorkspaceKeeps: JSON.stringify(out.b) === JSON.stringify(before.b),
      restored: restored && JSON.stringify(after) === JSON.stringify(before.a),
    })
  }

  // 26c-2. widgets-personal — 개인 홈 구성(위젯 강화 2026-10-10). duo 가 A 의 홈을 구성하면(위젯 추가·순서·크기) 그대로 그려지고, 한 위젯을 빼면 사라진다.
  //      관리자가 끈 위젯은 개인 구성에 있어도 사라졌다가 다시 켜면 제자리로 돌아온다. 같은 계정의 B 홈과 다른 계정(ana)의 A 홈은 그대로다.
  //      쓰기는 화면이 부르는 것과 같은 개인 설정 라우트(POST /api/prefs — 본인 행), 끝에 개인 구성을 지워(null) 기본 배치로 되돌린다.
  //      위젯 설정을 잠깐 끄는 쓰기는 26c 와 같은 설정 액션이다(portalTarget — 이 단계는 설정 키의 근거가 아니라 개인 구성의 근거다).
  {
    const portalTarget = workspaceKey(wsA, 'portal.widgets')
    const homeOf = async (who, workspaceId) => widgetCellsOf(await screenOf(who, wsPath(workspaceId)))
    const savePrefs = async (who, workspaceId, prefs) => {
      const cookie = cookieHeader([...who.jar].map(([name, value]) => ({ name, value })))
      const res = await fetch(`${origin}/api/prefs`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId, prefs }) })
      return res.status
    }
    const idsOf = (cells) => cells.map((c) => c.id)
    const probe = PORTAL_LAYOUT_PROBE
    const before = { duoA: await homeOf(duo, wsA), duoB: await homeOf(duo, wsB), anaA: await homeOf(ana, wsA) }
    const out = {}
    let resetStatus = null
    try {
      out.saveStatus = await savePrefs(duo, wsA, { portalLayout: portalLayoutOf(probe.items), portalHiddenWidgets: [] })
      out.arranged = { duoA: await homeOf(duo, wsA), duoB: await homeOf(duo, wsB), anaA: await homeOf(ana, wsA) }
      out.removeStatus = await savePrefs(duo, wsA, { portalLayout: portalLayoutOf(probe.items.filter((i) => i.id !== probe.removeId)) })
      out.removed = await homeOf(duo, wsA)
      const off = await withSetting(portalTarget, portalWidgetsOff(PORTAL_PROBE_WIDGET), async () => ({ duoA: await homeOf(duo, wsA), duoB: await homeOf(duo, wsB) }))
      out.adminOff = off.out
      out.settingRestored = off.restored
      out.adminOn = await homeOf(duo, wsA)
    } finally {
      resetStatus = await savePrefs(duo, wsA, { portalLayout: null, portalHiddenWidgets: [] })
    }
    const after = await homeOf(duo, wsA)
    const kept = probe.items.filter((i) => i.id !== probe.removeId)
    const checks = {
      cleanStart: !idsOf(before.duoA).includes(probe.items[0].id) && idsOf(before.duoA).includes(PORTAL_PROBE_WIDGET) && idsOf(before.duoA).includes(probe.removeId),
      saved: out.saveStatus === 200 && out.removeStatus === 200,
      orderAndSize: canonicalJson(out.arranged?.duoA) === canonicalJson(probe.items),
      otherWorkspaceKeeps: canonicalJson(out.arranged?.duoB) === canonicalJson(before.duoB),
      otherUserKeeps: canonicalJson(out.arranged?.anaA) === canonicalJson(before.anaA),
      removedGone: canonicalJson(out.removed) === canonicalJson(kept),
      adminOffHides: canonicalJson(out.adminOff?.duoA) === canonicalJson(kept.filter((i) => i.id !== PORTAL_PROBE_WIDGET)),
      adminOffOtherWorkspaceKeeps: canonicalJson(out.adminOff?.duoB) === canonicalJson(before.duoB),
      adminOnReturns: out.settingRestored === true && canonicalJson(out.adminOn) === canonicalJson(kept),
      resetToDefault: resetStatus === 200 && canonicalJson(after) === canonicalJson(before.duoA),
    }
    step('widgets-personal', { layout: probe.items, removeId: probe.removeId, adminOffWidget: PORTAL_PROBE_WIDGET, before, ...out, resetStatus, after, checks },
      allOk(checks) ? undefined : `개인 홈 구성: ${JSON.stringify({ checks, before, ...out, resetStatus, after }).slice(0, 2000)}`)
  }

  // 26d. setting-product-name — branding.product_name(워크스페이스 A). 세 범위(워크스페이스·프로젝트·전역)의 탭 제목이 그 이름으로 끝나고,
  //      B 의 세 화면에는 그 글자가 어디에도 없다(제목·셸의 aria·RSC 페이로드 전부).
  {
    const target = workspaceKey(wsA, 'branding.product_name')
    const before = everyScope(await shellPages('A'), (html) => html.includes(sp.product))
    const { out, restored } = await withSetting(target, sp.product, async (stored) => {
      const a = await shellPages('A'), b = await shellPages('B')
      return { stored, titled: everyScope(a, (html) => productInTitle(html, sp.product)), titles: everyScope(a, (html) => titlesOf(html)[0] ?? null),
        leaked: everyScope(b, (html) => html.includes(sp.product)) }
    })
    const after = everyScope(await shellPages('A'), (html) => html.includes(sp.product))
    settingStep('setting-product-name', target.key, { productName: sp.product, before, during: out, after }, {
      cleanStart: !Object.values(before).some(Boolean),
      stored: out.stored === sp.product,
      titleInEveryScope: allTrue(out.titled),
      otherWorkspaceClean: !Object.values(out.leaked).some(Boolean),
      restored: restored && !Object.values(after).some(Boolean),
    })
  }

  // 26e. setting-accent — branding.accent(워크스페이스 A). 입력은 hex 하나, 저장은 파생 세트다. A 의 세 범위 셸이 그 세트의 스타일 블록을 싣고
  //      (:root 의 action 배경 = 저장된 라이트 세트의 bg), B 의 셸에는 강조색 블록이 없다(제품 기본색).
  {
    const target = workspaceKey(wsA, 'branding.accent')
    const before = { a: everyScope(await shellPages('A'), accentRootOf), b: everyScope(await shellPages('B'), accentRootOf) }
    const { out, restored } = await withSetting(target, ACCENT_PROBE, async (stored) => ({
      stored: { base: stored?.base ?? null, lightBg: stored?.light?.bg ?? null },
      a: everyScope(await shellPages('A'), accentRootOf), b: everyScope(await shellPages('B'), accentRootOf),
    }), { toInput: (stored) => (stored === undefined || stored === null ? stored : stored.base) })
    const after = everyScope(await shellPages('A'), accentRootOf)
    settingStep('setting-accent', target.key, { input: ACCENT_PROBE, before, during: out, after }, {
      storedDerived: out.stored.base?.toLowerCase() === ACCENT_PROBE && /^#[0-9a-f]{6}$/.test(out.stored.lightBg ?? ''),
      styleInEveryScope: Object.values(out.a).every((v) => v !== null && v === out.stored.lightBg),
      changedFromBefore: Object.entries(out.a).every(([scope, v]) => v !== before.a[scope]),
      otherWorkspaceUnchanged: JSON.stringify(out.b) === JSON.stringify(before.b) && Object.values(out.b).every((v) => v !== out.stored.lightBg),
      restored: restored && JSON.stringify(after) === JSON.stringify(before.a),
    })
  }

  // 26f. setting-logo — branding.logo(워크스페이스 A)의 마크 슬롯. 파일은 service_role 로 올린다(업로드 액션은 파일 인자라 이 러너의 액션 호출로
  //      부르지 못한다 — 형식 검사는 단위 테스트 logo-upload 가 본다). 설정 값은 설정 액션으로 쓴다. A 의 세 범위 탭 아이콘이 읽기 라우트를 가리키고
  //      그 라우트가 올린 바이트를 그대로 돌려주며, B 의 화면에는 로고 주소가 없고 B 관리자에게 A 의 로고 라우트는 404 다.
  {
    const target = workspaceKey(wsA, 'branding.logo')
    const bytes = Buffer.from(TINY_PNG_BASE64, 'base64')
    const objectPath = brandMarkPath(wsA, createHash('sha256').update(bytes).digest('hex'))
    const href = `/api/brand/${wsA}/mark`
    const up = await svc.storage.from('branding').upload(objectPath, bytes, { contentType: 'image/png', upsert: true })
    if (up.error) throw new Fail(`로고 픽스처 업로드 실패: ${up.error.message}`)
    const icons = (pages) => everyScope(pages, (html) => iconHrefsOf(html).filter((h) => h.startsWith('/api/brand/')))
    const anyBrand = (pages) => everyScope(pages, (html) => html.includes('/api/brand/'))
    const before = { a: anyBrand(await shellPages('A')), b: anyBrand(await shellPages('B')) }
    let removed = false
    const run = await (async () => {
      try {
        return await withSetting(target, { full: null, full_dark: null, mark: objectPath }, async (stored) => {
          const served = await raw(duo, href)
          const servedBytes = served.status === 200 ? Buffer.from(await (await fetch(origin + href, {
            headers: { cookie: cookieHeader([...duo.jar].map(([name, value]) => ({ name, value }))) } })).arrayBuffer()) : null
          return {
            stored, a: icons(await shellPages('A')), b: anyBrand(await shellPages('B')),
            served: { status: served.status, type: served.headers.get('content-type'), sameBytes: servedBytes ? servedBytes.equals(bytes) : false },
            outsider: (await raw(bea, href)).status, otherSlot: (await raw(duo, `/api/brand/${wsA}/full`)).status,
          }
        })
      } finally {
        // 픽스처 객체를 치운다 — 설정을 되돌린 뒤라 가리키는 값이 없다
        removed = !(await svc.storage.from('branding').remove([objectPath])).error
      }
    })()
    const { out, restored } = run
    const after = anyBrand(await shellPages('A'))
    settingStep('setting-logo', target.key, { slot: 'mark', href, before, during: out, after, fixtureRemoved: removed }, {
      cleanStart: !Object.values(before.a).some(Boolean) && !Object.values(before.b).some(Boolean),
      stored: out.stored?.mark === objectPath,
      iconInEveryScope: Object.values(out.a).every((hrefs) => hrefs.includes(href)),
      servedToMember: out.served.status === 200 && out.served.type === 'image/png' && out.served.sameBytes,
      emptySlotIs404: out.otherSlot === 404,
      otherWorkspaceClean: !Object.values(out.b).some(Boolean),
      nonMemberIs404: out.outsider === 404,
      restored: restored && !Object.values(after).some(Boolean) && removed,
    })
  }

  // 26g. setting-menu — navigation.menu(워크스페이스 A). 사이드 내비의 주 그룹 순서가 뒤집히고(프로젝트가 홈보다 앞) 그 항목의 이름이 바뀐다.
  //      같은 계정(duo)이 여는 B 의 내비는 순서·이름 그대로다. 전역 범위(/account)도 쿠키가 가리키는 워크스페이스의 메뉴를 그린다.
  //      전역 검색(⌘K)은 같은 navFor 결과(셸의 groups·workspaceGroups)를 받아 그린다 — 대화상자를 열어 보는 것은 단위 테스트(global-search)가 맡는다.
  {
    const target = workspaceKey(wsA, 'navigation.menu')
    const value = navMenuProbe(sp.menuLabel)
    const nav = async (side) => ({
      workspace: navItemsOf(await screenOf(duo, wsPath(side === 'A' ? wsA : wsB, 'projects'))),
      global: navItemsOf(await screenOf(duo, '/account', { 'dflow-ws': side === 'A' ? slugA : OTHER_WORKSPACE.slug })),
    })
    const problems = (navs, applied) => Object.entries(navs).flatMap(([scope, items]) => navMenuProblems(items, sp.menuLabel, applied).map((x) => `${scope}: ${x}`))
    const before = problems(await nav('A'), false)
    const { out, restored } = await withSetting(target, value, async (stored) => {
      const a = await nav('A'), b = await nav('B')
      return { stored, a: problems(a, true), b: problems(b, false), order: a.workspace.slice(0, 4).map((i) => i.id), otherOrder: b.workspace.slice(0, 4).map((i) => i.id) }
    })
    const after = problems(await nav('A'), false)
    settingStep('setting-menu', target.key, { value, before, during: out, after }, {
      cleanStart: before.length === 0,
      stored: canonicalJson(out.stored) === canonicalJson(value),
      orderAndLabelApplied: out.a.length === 0,
      otherWorkspaceUnchanged: out.b.length === 0,
      restored: restored && after.length === 0,
    })
  }

  // 26h. setting-auto-file — minutes.auto_file_by_path(워크스페이스 B 의 프로젝트 C — A 는 단계 22 가 회의록 연동을 닫아 두었다). 외부 업로드 API 로
  //      folder_path 를 보내면 켜진(기본) 프로젝트에서는 그 폴더로 편철되고, 끈 프로젝트에서는 폴더가 만들어지지 않고 팀 루트(키 부재와 같은 자리)로 간다.
  //      같은 워크스페이스의 다른 프로젝트(C2 — 이 단계가 만든다)는 켜진 채라 같은 요청이 편철된다. 프로젝트는 회의 연결(meeting.project_id)이 정한다.
  {
    const C2 = await createProject(admin, wsB, 'C2')
    const target = projectKey(C.id, 'minutes.auto_file_by_path')
    const date = todayInTz(await tzOfWorkspace(wsB))
    const send = async (projectId, folder) => {
      const res = await fetch(`${base}/api/v1/minutes`, {
        method: 'POST', redirect: 'manual',
        headers: { authorization: `Bearer ${minutesTokenB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ user_email: B_ADMIN.email, date, team: SP3B_B_TEAM, title: `E2E 자동 편철 ${folder}`, body_markdown: `# ${folder}\n`,
          external_id: `e2e:${randomUUID()}`, meeting: { project_id: projectId, title: sp.meeting, date }, folder_path: [folder] }),
      })
      const body = await res.json().catch(() => null)
      return { status: res.status, code: body?.code ?? null, error: body?.error ?? null, folderPath: body?.folder_path ?? null, pathStatus: body?.folder_path_status ?? null, filed: filedUnder(body, folder) }
    }
    const folderRows = async (name) => rows(`폴더(${name})`, await svc.from('minute_folders').select('id').eq('name', name)).length
    const onDefault = await send(C.id, sp.folders.on)
    const { out, restored } = await withSetting(target, false, async (stored) => ({
      stored, off: await send(C.id, sp.folders.off), offFolders: await folderRows(sp.folders.off),
      other: await send(C2.id, sp.folders.other), otherFolders: await folderRows(sp.folders.other),
    }))
    const onAgain = await send(C.id, `${sp.folders.on} 2`)
    settingStep('setting-auto-file', target.key, { projectId: C.id, otherProjectId: C2.id, onDefault, during: out, onAgain }, {
      filedWhenOn: onDefault.status === 201 && onDefault.filed && (await folderRows(sp.folders.on)) === 1,
      stored: out.stored === false,
      notFiledWhenOff: out.off.status === 201 && !out.off.filed && out.offFolders === 0,
      otherProjectStillFiles: out.other.status === 201 && out.other.filed && out.otherFolders === 1,
      filedAgainAfterRestore: restored && onAgain.status === 201 && onAgain.filed,
    })
  }

  // 26i. setting-local-drafts(선택) — security.local_drafts(워크스페이스 A). 초안을 쓰는 표면은 위키 편집기 하나이고, 서버가 읽은 정책이 그 편집기의
  //      prop 으로 내려간다. A 에서 끄면 A 프로젝트의 위키 문서 화면이 allowed:false 를 받고, B 프로젝트의 화면은 켜진 채다.
  //      위키 화면은 서버가 WIKI_SERVICE_ENABLED=true 로 떠 있어야 열리므로 E2E_WIKI=1 일 때만 돈다(아니면 건너뜀으로 기록 — 이 키의 승격 근거가 되지 못한다).
  //      문서 픽스처는 화면의 문서 만들기가 부르는 RPC(create_wiki_document)를 그 프로젝트 멤버의 세션으로 부른다.
  if (!wikiStepEnabled(process.env)) {
    step('setting-local-drafts', { key: 'security.local_drafts', skipped: true, reason: 'E2E_WIKI=1 이 아니다 — 위키 화면(WIKI_SERVICE_ENABLED=true 서버)이 필요한 단계를 건너뛴다(실패로 세지 않는다)' })
  } else {
    const target = workspaceKey(wsA, 'security.local_drafts')
    const topicOf = async (who, projectId) => {
      const { data, error } = await who.sb.rpc('create_wiki_document', {
        p_project_id: projectId, p_title: sp.wikiTitle, p_body_md: `# ${sp.wikiTitle}\n`, p_document_kind: WIKI_PROBE_KIND, p_parent_id: null })
      const id = typeof data === 'string' ? data : data?.id
      if (error || typeof id !== 'string') throw new Fail(`위키 문서 픽스처 실패(${who.label}): ${error?.message ?? JSON.stringify(data)}`)
      return id
    }
    const topicA = await topicOf(ana, A.id), topicB = await topicOf(bea, C.id)
    const policy = async (who, projectId, topicId) => draftPoliciesOf(await screenOf(who, `/p/${projectId}/wiki/topics/${topicId}`))
    const before = { a: await policy(ana, A.id, topicA), b: await policy(bea, C.id, topicB) }
    const off = { allowed: false, retention_days: 7 }
    const { out, restored } = await withSetting(target, off, async (stored) => ({
      stored, a: await policy(ana, A.id, topicA), b: await policy(bea, C.id, topicB),
    }))
    const after = await policy(ana, A.id, topicA)
    settingStep('setting-local-drafts', target.key, { skipped: false, topics: { a: topicA, b: topicB }, before, during: out, after }, {
      cleanStart: before.a.length === 1 && before.a[0].allowed === true && before.b.length === 1 && before.b[0].allowed === true,
      stored: canonicalJson(out.stored) === canonicalJson(off),
      draftsOffOnScreen: out.a.length === 1 && out.a[0].allowed === false,
      otherWorkspaceStillOn: JSON.stringify(out.b) === JSON.stringify(before.b),
      restored: restored && JSON.stringify(after) === JSON.stringify(before.a),
    })
  }

  // 27. workspace-archive — 워크스페이스 보관·복원(0056). 보관 = 숨김 + 동결, 자료는 그대로. 대조용 워크스페이스 B(e2e-other)를 보관해
  //     그 관리자(bea)·두 곳 소속(duo)·플랫폼 관리자(admin)·세션 없는 경로(연동 API·공유 링크)가 모두 닫히는지 보고, 복원해 원상을 확인한다.
  //     맨 끝에 둔다 — 앞 단계들이 B 를 쓴다. 중간에 실패해도 finally 가 복원한다(액션이 안 되면 service_role RPC 로 — B 를 보관된 채 남기지 않는다).
  {
    const page = '/admin/workspaces'
    const slugB = OTHER_WORKSPACE.slug
    const REASON = 'E2E 보관 확인'
    const UPLOAD_TITLE = 'E2E 보관 중 업로드'
    const detailB = `${wsPath(wsB, 'minutes')}/${minuteB}`
    const [{ name: nameB }] = rows('워크스페이스 B 이름', await svc.from('workspaces').select('name').eq('id', wsB))
    const opened = (res) => res.status === 200 && !notFoundRendered(res.html)
    const beaScreens = async () => ({ projects: await raw(bea, wsPath(wsB, 'projects')), dashboard: await raw(bea, `/p/${C.id}/dashboard`) })
    const anon = async (token) => {
      const res = await fetch(`${origin}/share/minutes/${token}`, { redirect: 'manual' })
      return { status: res.status, html: res.status >= 300 && res.status < 400 ? '' : await res.text() }
    }
    const apiB = (path, init = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...init, headers: { authorization: `Bearer ${minutesTokenB}`, ...(init.headers ?? {}) } })
    const metaB = async () => (await apiB(`/api/v1/minutes/meta?user_email=${encodeURIComponent(B_ADMIN.email)}`)).status
    const uploadB = async () => (await apiB('/api/v1/minutes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_email: B_ADMIN.email, date: meetingDate, team: SP3B_B_TEAM, title: UPLOAD_TITLE, body_markdown: '# 보관', external_id: `e2e:${randomUUID()}` }),
    })).status
    // bea 의 세션(JWT)으로 PostgREST 에 직접 — 화면을 거치지 않는 읽기·쓰기도 RLS 가 닫는지 본다
    const sessionProjects = async () => {
      const { data, error } = await bea.sb.from('projects').select('id').eq('workspace_id', wsB)
      if (error) throw new Fail(`bea 세션의 프로젝트 조회 실패: ${error.message}`)
      return data.length
    }
    const sessionWrite = async () => {
      const { data, error } = await bea.sb.from('projects').update({ description: 'E2E 보관 중 쓰기' }).eq('id', C.id).select('id')
      return { rows: data?.length ?? null, error: error?.message ?? null }
    }
    const descriptionOfC = async () => rows('C 설명', await svc.from('projects').select('description').eq('id', C.id))[0].description
    const recordOf = async () => rows('보관 기록', await svc.from('workspaces')
      .select('archived_at, archived_by, archive_reason, restored_at, restored_by').eq('id', wsB))[0]
    const listHtml = async () => (await admin.http('GET', page)).text()

    await bea.http('GET', detailB)
    const on = (await bea.action(detailB, 'setMinuteShare', [minuteB, 'enable'])).result
    if (!on?.ok || typeof on.token !== 'string' || !on.token) throw new Fail(`B 회의록 공유 켜기 실패: ${JSON.stringify({ ok: on?.ok ?? null, error: on?.error ?? null })}`)
    const descriptionBefore = await descriptionOfC()
    const before = {
      bea: await beaScreens(), duo: await raw(duo, wsPath(wsA)), share: await anon(on.token), meta: await metaB(),
      projects: await sessionProjects(), list: await listHtml(),
    }
    // 주소를 틀리게 적으면 보관하지 않는다(엉뚱한 행을 접지 않는다)
    const wrongSlug = (await admin.action(page, 'archivePlatformWorkspace', [wsB, slugA, REASON])).result
    // 플랫폼 관리자가 아니면 보관하지 못한다 — 그 워크스페이스의 관리자도. bea 는 /admin/workspaces 를 열 수 없어(404) 액션 주소가 없으므로 RPC 실행권으로 본다
    const beaRpc = await bea.sb.rpc('archive_workspace', { p_actor: beaWs.userId, p_workspace_id: wsB, p_expected_slug: slugB, p_reason: null })

    const notArchivedYet = (await recordOf()).archived_at === null   // 틀린 주소·bea 의 시도 뒤에도 그대로다

    let archived = null, during = null, restoredBy = null
    try {
      archived = (await admin.action(page, 'archivePlatformWorkspace', [wsB, slugB, `  ${REASON}  `])).result
      if (!archived?.ok) throw new Fail(`archivePlatformWorkspace 실패: ${JSON.stringify(archived)}`)
      const upload = await uploadB()
      during = {
        record: await recordOf(),
        again: (await admin.action(page, 'archivePlatformWorkspace', [wsB, slugB, '두 번째 사유'])).result,
        bea: await beaScreens(),
        adminHome: await raw(admin, wsPath(wsB)), adminProject: await raw(admin, `/p/${C.id}/dashboard`),
        duo: await raw(duo, wsPath(wsA)),
        share: await anon(on.token), meta: await metaB(), upload,
        uploaded: rows('보관 중 올라간 회의록', await svc.from('minutes').select('id').eq('workspace_id', wsB).eq('title', UPLOAD_TITLE)).length,
        projects: await sessionProjects(), write: await sessionWrite(), description: await descriptionOfC(),
        rename: (await admin.action(page, 'renameWorkspace', [wsB, nameB])).result,
        list: await listHtml(),
      }
    } finally {
      let res = null
      try { res = (await admin.action(page, 'restorePlatformWorkspace', [wsB])).result } catch (e) {
        console.error('[workspace-archive] 복원 액션 실패 — service_role 로 복원한다:', e?.message ?? e)
      }
      if (res?.ok) restoredBy = res.unchanged ? 'action(unchanged)' : 'action'
      else {
        const { error } = await svc.rpc('restore_workspace', { p_actor: me.id, p_workspace_id: wsB })
        if (error) throw new Fail(`복원 실패 — ${slugB} 가 보관된 채 남았다(수동 복원 필요): ${error.message}`)
        restoredBy = 'service_role'
      }
    }
    const after = {
      record: await recordOf(), bea: await beaScreens(), duo: await raw(duo, wsPath(wsA)), share: await anon(on.token), meta: await metaB(),
      projects: await sessionProjects(), rename: (await admin.action(page, 'renameWorkspace', [wsB, nameB])).result,
      restoreAgain: (await admin.action(page, 'restorePlatformWorkspace', [wsB])).result, list: await listHtml(),
    }
    const off = (await bea.action(detailB, 'setMinuteShare', [minuteB, 'disable'])).result

    const checks = {
      cleanStart: opened(before.bea.projects) && opened(before.bea.dashboard) && opened(before.share) && before.share.html.includes(SP3B_MINUTE_B)
        && before.meta === 200 && before.projects >= 1 && switcherVerdict(before.duo.html, true).length === 0
        && archivedRowVerdict(before.list, slugB, false).length === 0,
      wrongSlugRefused: wrongSlug?.ok === false && wrongSlug.code === 'slug_mismatch' && notArchivedYet,
      workspaceAdminCannotArchive: !!beaRpc.error && notArchivedYet,   // 실행권이 없어 거부됐고 아무것도 바뀌지 않았다
      archived: archived.unchanged === false && typeof during.record.archived_at === 'string' && during.record.archived_by === me.id
        && during.record.archive_reason === REASON,
      idempotent: during.again?.ok === true && during.again.unchanged === true && (await recordOf()).archive_reason !== '두 번째 사유',
      // 그 워크스페이스의 관리자에게 없는 것이다 — 화면 404(소속 아님과 같은 꼴), 이름·프로젝트 이름이 본문에 없다
      adminOfItHidden: hiddenVerdict(during.bea.projects, [nameB, C.name]).length === 0 && hiddenVerdict(during.bea.dashboard, [C.name]).length === 0,
      // 플랫폼 관리자에게도 그 화면은 404 다(들어가 읽는 길은 복원이다)
      platformAdminHidden: hiddenVerdict(during.adminHome, [nameB]).length === 0 && hiddenVerdict(during.adminProject, [C.name]).length === 0,
      // 두 곳 소속이던 duo — 남은 소속이 하나라 전환기 트리거가 사라지고 B 의 이름이 셸에 없다
      switcherGone: during.duo.status === 200 && switcherVerdict(during.duo.html, false).length === 0 && !during.duo.html.includes(nameB),
      actionRefused: during.rename?.ok === false,
      sessionReadsEmpty: during.projects === 0,
      sessionWriteRefused: (during.write.rows === 0 || during.write.error !== null) && during.description === descriptionBefore,
      apiRefused: during.meta === 401 && during.upload === 401 && during.uploaded === 0,
      shareClosed: hiddenVerdict(during.share, [SP3B_MINUTE_B]).length === 0,
      listedArchived: archivedRowVerdict(during.list, slugB, true).length === 0 && archivedRowVerdict(during.list, slugA, false).length === 0
        && during.list.includes(REASON),
      restored: restoredBy === 'action' && after.record.archived_at === null && after.record.archived_by === null && after.record.archive_reason === null
        && typeof after.record.restored_at === 'string' && after.record.restored_by === me.id,
      restoreIdempotent: after.restoreAgain?.ok === true && after.restoreAgain.unchanged === true,
      backToNormal: opened(after.bea.projects) && opened(after.bea.dashboard) && opened(after.share) && after.share.html.includes(SP3B_MINUTE_B)
        && after.meta === 200 && after.projects === before.projects && switcherVerdict(after.duo.html, true).length === 0
        && after.rename?.ok === true && archivedRowVerdict(after.list, slugB, false).length === 0,
      shareTurnedOff: off?.ok === true && off.enabled === false,
    }
    const status = {
      during: { beaProjects: during.bea.projects.status, beaDashboard: during.bea.dashboard.status, adminHome: during.adminHome.status, adminProject: during.adminProject.status,
        duo: during.duo.status, share: during.share.status, meta: during.meta, upload: during.upload, sessionProjects: during.projects, write: during.write, rename: during.rename },
      after: { beaProjects: after.bea.projects.status, beaDashboard: after.bea.dashboard.status, share: after.share.status, meta: after.meta, sessionProjects: after.projects },
    }
    step('workspace-archive', { workspace: { id: wsB, slug: slugB }, reason: REASON, restoredBy, record: { during: during.record, after: after.record }, status, checks },
      allOk(checks) ? undefined : `워크스페이스 보관·복원: ${JSON.stringify({ checks, restoredBy, status, wrongSlug, again: during.again, beaRpc: beaRpc.error?.code ?? null })}`)
  }
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
