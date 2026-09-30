// 열거 게이트 매니페스트(스펙 §4.3, 정본 §6.5.3, 판정 P14·P17·P19) — 'use server' 액션과 src/app/api 라우트의 함수 핸들러 전부.
// 새 액션·핸들러를 만들면 여기 항목이 있어야 CI 가 통과한다(D38 — 뒤 SP 가 만드는 액션도).
// guard 는 기록용 분류다 — 판정은 코드가 하고, deny 테스트는 모듈 항목과 guard 가 네 가드 등급(superuser·workspaceAdmin·projectAdmin·projectMember)인
// null 항목에서 모든 가드를 한꺼번에 거부시켜 본다(스펙 §4.3 deny 첫 줄 — 전 항목).
// module: 단일·목록(전부 유효해야 통과 — D18)·null(core·공용 — requireModule 을 부르면 실패).
// deny: 모듈 거부 때의 반환값(결과 유니온이 아닌 액션·셸 항목 — P17). 없으면 { ok:false, error: ERR_MODULE_DISABLED } 를 포함해야 한다.
// sample: 액션 호출 인자 — 관문은 가드 바로 뒤·입력 검증 앞이라(P17) 가드 앞 검증만 통과하면 된다(uuid·빈 객체). null 항목도 가드 앞 검증이
// 표본을 거부하면(가드에 닿지 않으면) sample 을 둔다(실측 18개 — 워크스페이스 id·항목 uuid·값 범위를 가드 앞에서 본다: accounts 셋·createProject·teams 둘·
// setAgentProjectEnabled·settings 둘·updateActual·wbsAssign 다섯·wbsSpec 셋). session null 항목도 세션 없음 실행(deny.test)이 로그인 판정까지 가게 넷에
// 둔다(revokeAgentToken·getAgentProjectState 의 uuid, settings 조회 둘의 범위 객체). 행 헬퍼 안의 관문(checkOwner 등)은 입력 검증 뒤라 그 검증을 통과하는 표본이 필요하다.
// adminBeforeGuard 는 null 항목에도 둔다 — 등급 거부 모드(세션은 있고 등급 가드만 거부)에서 인증 뒤·등급 가드 앞에 행을 service_role 로 읽는 것(updateTeam).
// delegatedTo: 라우트의 실행 확인을 맡은 전용 테스트(P15). delegatedStatic: 위임 파일이 메서드를 import 하지 않고 경로 문자열로 정적 확인하는
// 라우트의 사유(닫힌 목록 — 지금은 v1 에이전트 11). adminBeforeGuard: 가드 앞에서 대상 행을 service_role 로 읽는 액션의 사유.
// target: 모듈 판정의 대상(deny 하네스가 그 범위에서만 모듈을 끈다 — 틀린 범위의 관문은 통과해 FAIL). 기본은 sample 에서 파생한다 — 프로젝트 id(P)가
// 있으면 project, 행 id(U)만 있으면 row(행의 프로젝트·워크스페이스), 둘 다 없으면 session(세션 유일 워크스페이스). 행 id 를 받지만 판정은 세션인
// 항목만 적는다(회의록 폴더 넷·일괄 지정 — P13·P28).
// ownerBranch: '관리자 또는 작성자·주최자' 헬퍼를 지나는 모듈 액션의 작성자 판정 — deny 하네스가 관리자 거부(멤버 행위자, ROW.created_by 가 그
// userId) 상태로 모듈을 꺼서 작성자 분기도 관문을 지나는지 본다(B5 F1-14·F1-15). note 의 '관리자 또는 작성자|주최자' 와 짝이다.
import type { ModuleId } from '@/lib/modules/defaults'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

export type Guard = 'superuser' | 'workspaceAdmin' | 'projectAdmin' | 'projectMember' | 'agentPrincipal' | 'cronSecret' | 'public' | 'session' | 'minutesSecret'
export interface GateEntry {
  guard: Guard
  module: ModuleId | readonly ModuleId[] | null
  note?: string
  deny?: unknown
  sample?: readonly unknown[]
  delegatedTo?: string
  delegatedStatic?: string
  adminBeforeGuard?: string
  target?: 'project' | 'row' | 'session'
  ownerBranch?: string
}
export const NOTE_REQUIRED: ReadonlySet<Guard> = new Set<Guard>(['session', 'public', 'cronSecret', 'minutesSecret'])

// 표본 id — tests/gates/_harness.ts 의 U·P 와 같은 값(가드 mock 이 P 를 자기 프로젝트로 본다)
const U = '00000000-0000-0000-7e57-000000001431'
const P = '00000000-0000-0000-7e57-000000001432'
const A = (f: string) => `src/app/actions/${f}.ts`
const R = (p: string) => `src/app/api/${p}/route.ts`
const nul = (guard: Guard, note?: string): GateEntry => ({ guard, module: null, ...(note ? { note } : {}) })
const SESSION_SELF = '로그인만 — 자기 행(user_id)만 읽고 쓴다'

export const ACTION_GATES: Readonly<Record<string, GateEntry>> = {
  // ── accounts(D) — 플랫폼·워크스페이스 관리
  [`${A('accounts')}#createAccount`]: { ...nul('workspaceAdmin'), sample: [{ workspaceId: U }] },   // 빈 workspaceId 는 가드 앞(isWorkspaceIdInput)에서 막힌다
  [`${A('accounts')}#bulkCreateAccounts`]: { ...nul('workspaceAdmin'), sample: [U, '', ''] },   // typeof workspaceId 가 가드 앞
  [`${A('accounts')}#resetPassword`]: nul('superuser'),
  [`${A('accounts')}#setPlatformAdmin`]: nul('superuser'),
  [`${A('accounts')}#setWorkspaceRole`]: { ...nul('workspaceAdmin'), sample: [U, U, 'member'] },
  [`${A('accounts')}#listAccounts`]: nul('workspaceAdmin'),
  // ── agentHub — 허브(agents)
  [`${A('agentHub')}#refreshAgentHub`]: { guard: 'projectMember', module: 'agents', sample: [P] },
  [`${A('agentHub')}#applyHubDelegations`]: { guard: 'projectMember', module: 'agents', sample: [P, [{ itemId: U, delegated: true }]] },   // 길이 0 은 가드 앞 검증에서 막힌다
  [`${A('agentHub')}#runHubProcessOp`]: { guard: 'projectMember', module: 'agents', sample: [P, { kind: 'stop', orderId: U }] },   // isProcessOp 가 가드 앞에서 본다. 내부 관문이 없는 갈래(stop)로 외곽 관문을 문다 — unapprove 는 loadOrderForReview 의 내부 관문이 대신 거부해 외곽 관문을 증명하지 못한다(B5 T17-I1)
  // ── agentSeatmap — 전역 좌석표(projectId 가 없으면 세션 유일 워크스페이스)
  [`${A('agentSeatmap')}#refreshSeatmap`]: { guard: 'session', module: 'agents', note: 'getActorForView + canViewAgents — 층은 getSeatmap 이 거른다', sample: ['all'] },
  // ── agentTokens — 계정 단위 PAT(P19)
  [`${A('agentTokens')}#createAgentToken`]: nul('session', '계정 단위 PAT — 대상 프로젝트가 없다. API 표면은 v1 라우트 관문이 닫는다'),
  [`${A('agentTokens')}#revokeAgentToken`]: { ...nul('session', '계정 단위 PAT 회수'), sample: [U] },   // isUuidLike 가 세션 앞
  [`${A('agentTokens')}#listMyAgentTokens`]: nul('session', '계정 단위 PAT 목록'),
  // ── agentWork — 옛 토글 둘은 모듈을 켜는 문(P8), 승인 계열은 agents
  [`${A('agentWork')}#setAgentProjectEnabled`]: { ...nul('projectAdmin', 'D41 옛 토글 — agents 를 켜는 문이라 자기 관문에 막히면 안 된다(P8)'), sample: [P, true] },   // isUuidLike 가 가드 앞(과제 19 뒤에도 그대로)
  [`${A('agentWork')}#getAgentProjectState`]: { ...nul('session', '세션 RLS(read_agent_projects) — 설정 화면의 토글 상태'), sample: [P] },   // isUuidLike 가 앞. 코드 가드 없이 RLS 로 읽는다(deny.test RLS_ONLY)
  [`${A('agentWork')}#approveAgentCompletion`]: { guard: 'projectAdmin', module: 'agents', sample: [U, null], adminBeforeGuard: 'loadOrderForAdmin 이 주문 행에서 프로젝트를 읽는다(service_role)' },
  [`${A('agentWork')}#rejectAgentCompletion`]: { guard: 'projectAdmin', module: 'agents', sample: [U, '사유', null], adminBeforeGuard: 'loadOrderForReview 가 주문 행에서 프로젝트를 읽는다' },
  [`${A('agentWork')}#unapproveAgentCompletion`]: { guard: 'projectAdmin', module: 'agents', sample: [U], adminBeforeGuard: 'loadOrderForReview' },
  [`${A('agentWork')}#requestAgentRework`]: { guard: 'projectAdmin', module: 'agents', sample: [U, '사유'], adminBeforeGuard: 'loadOrderForReview' },
  [`${A('agentWork')}#getAgentOrderForItem`]: { guard: 'projectMember', module: 'agents', sample: [U], deny: { ok: true, order: null, priorOrders: [], projectId: P } },
  // ── announcements
  [`${A('announcements')}#createAnnouncement`]: { guard: 'projectAdmin', module: 'announcements', sample: [P, {}] },
  [`${A('announcements')}#updateAnnouncement`]: { guard: 'projectAdmin', module: 'announcements', sample: [U, {}] },
  [`${A('announcements')}#deleteAnnouncement`]: { guard: 'projectAdmin', module: 'announcements', sample: [U] },
  [`${A('announcements')}#markAnnouncementsSeen`]: { guard: 'session', module: 'announcements', note: '로그인만 — 자기 읽음 시각', sample: [P, '2026-09-01T00:00:00Z'] },
  [`${A('announcements')}#getHeaderAnnouncements`]: { guard: 'session', module: 'announcements', note: '셸 티커 — 꺼지면 빈 목록(§4.2 셸 행)', sample: [P], deny: { ok: true, rows: [] } },
  [`${A('announcements')}#getUnreadAnnouncementCount`]: { guard: 'session', module: 'announcements', note: '셸 배지 — 꺼지면 0', sample: [P], deny: 0 },
  [`${A('announcements')}#createAnnouncementFromMeeting`]: { guard: 'projectAdmin', module: ['announcements', 'meetings'], sample: [U, '2026-09-01'] },
  // ── attachments — WBS 산출물(core)
  [`${A('attachments')}#listAttachments`]: nul('session', '로그인 + 세션 RLS(wbs 산출물)'),
  [`${A('attachments')}#recordAttachment`]: nul('projectMember'),
  [`${A('attachments')}#removeAttachment`]: nul('projectMember'),
  // ── attendance
  [`${A('attendance')}#upsertAttendance`]: { guard: 'projectMember', module: 'attendance', sample: [P, { memberId: U, date: '2026-09-01', type: 'annual' }] },
  [`${A('attendance')}#removeAttendance`]: { guard: 'projectMember', module: 'attendance', sample: [U] },
  // ── brief — 대시보드(core) 카드의 AI. AI 판정은 aiAvailable(모듈 없음 — P19)
  [`${A('brief')}#ensureProjectBriefAction`]: nul('projectAdmin'),
  [`${A('brief')}#getProjectBriefAction`]: nul('session', '로그인 + 세션 RLS — 저장된 브리핑 읽기'),
  // ── chat
  [`${A('chat')}#reindexProjectAction`]: { guard: 'projectAdmin', module: 'chatbot', sample: [P] },
  // ── inbox — 셸 알림함
  [`${A('inbox')}#getInboxFeed`]: nul('session', SESSION_SELF),
  [`${A('inbox')}#markInboxSeen`]: nul('session', SESSION_SELF),
  [`${A('inbox')}#markAllInboxRead`]: nul('session', SESSION_SELF),
  [`${A('inbox')}#markInboxItemRead`]: nul('session', SESSION_SELF),
  // ── inviteRedeem — 로그인 전
  [`${A('inviteRedeem')}#getInvitePreview`]: nul('public', '초대 토큰 — 로그인 전·워크스페이스 미확정'),
  [`${A('inviteRedeem')}#getInviteSessionState`]: nul('public', '초대 토큰'),
  [`${A('inviteRedeem')}#redeemInvite`]: nul('public', '초대 토큰 + 로그인 세션'),
  [`${A('inviteRedeem')}#redeemInviteWithSignup`]: nul('public', '초대 토큰 — 가입'),
  // ── issueAnalysis
  [`${A('issueAnalysis')}#ensureIssueAnalysisAction`]: { guard: 'projectMember', module: 'issues', sample: [P, 'all'] },
  // ── issueAttachments
  [`${A('issueAttachments')}#listIssueAttachments`]: { guard: 'session', module: 'issues', note: '로그인 + 이슈 행의 프로젝트', sample: [U] },
  [`${A('issueAttachments')}#recordIssueAttachment`]: { guard: 'projectAdmin', module: 'issues', note: '관리자 또는 작성자(requireIssueEditable)', sample: [U, { fileName: 'a.txt', filePath: 'x/a.txt', size: 1, mime: 'text/plain' }], ownerBranch: 'requireIssueEditable — issues.created_by' },
  [`${A('issueAttachments')}#removeIssueAttachment`]: { guard: 'projectAdmin', module: 'issues', note: '관리자 또는 작성자', sample: [U], ownerBranch: 'requireIssueEditable(첨부 행의 이슈) — issues.created_by' },
  // ── issueUpdates
  [`${A('issueUpdates')}#listIssueUpdates`]: { guard: 'session', module: 'issues', note: '로그인 + 이슈 행의 프로젝트', sample: [U] },
  [`${A('issueUpdates')}#addIssueUpdate`]: { guard: 'projectMember', module: 'issues', sample: [U, { body: 'b', category: null, mentionedMemberIds: [] }] },
  [`${A('issueUpdates')}#archiveIssueUpdate`]: { guard: 'projectMember', module: 'issues', sample: [U, U] },
  [`${A('issueUpdates')}#unarchiveIssueUpdate`]: { guard: 'projectMember', module: 'issues', sample: [U, U] },
  [`${A('issueUpdates')}#purgeIssueUpdate`]: { guard: 'projectMember', module: 'issues', sample: [U, U] },
  // ── issues
  [`${A('issues')}#fetchIssueMajorProcesses`]: { guard: 'session', module: 'issues', note: '로그인 + 인자 프로젝트', sample: [P] },
  [`${A('issues')}#fetchIssueProjectMembers`]: { guard: 'session', module: 'issues', note: '로그인 + 인자 프로젝트', sample: [P] },
  [`${A('issues')}#createIssue`]: { guard: 'projectMember', module: 'issues', sample: [P, {}] },
  [`${A('issues')}#prepareMinuteIssueDraft`]: { guard: 'projectMember', module: ['issues', 'minutes'], sample: [P, {}] },
  [`${A('issues')}#createIssueFromMinuteBlock`]: { guard: 'projectMember', module: ['issues', 'minutes'], sample: [P, {}, {}] },
  [`${A('issues')}#updateIssue`]: { guard: 'projectAdmin', module: 'issues', note: '관리자 또는 작성자(adminOrOwnerGate)', sample: [U, {}], ownerBranch: 'adminOrOwnerGate — 작성자 비교는 호출부' },
  [`${A('issues')}#updateIssueProgress`]: { guard: 'projectMember', module: 'issues', sample: [U, {}] },
  [`${A('issues')}#deleteIssue`]: { guard: 'projectAdmin', module: 'issues', note: '관리자 또는 작성자', sample: [U], ownerBranch: 'adminOrOwnerGate — 작성자 비교는 호출부' },
  // ── llmConfig — 플랫폼
  [`${A('llmConfig')}#maskToken`]: nul('public', '순수 문자열 가림 — 서버 액션으로 노출된 순수 함수(데이터 없음)'),
  [`${A('llmConfig')}#listLlmProfiles`]: nul('superuser'),
  [`${A('llmConfig')}#createLlmProfile`]: nul('superuser'),
  [`${A('llmConfig')}#updateLlmProfile`]: nul('superuser'),
  [`${A('llmConfig')}#deleteLlmProfile`]: nul('superuser'),
  [`${A('llmConfig')}#getLlmConfig`]: nul('superuser'),
  [`${A('llmConfig')}#saveLlmConfig`]: nul('superuser'),
  [`${A('llmConfig')}#testLlmConnection`]: nul('superuser'),
  // ── meetingNotify
  [`${A('meetingNotify')}#notifyMeetingSaved`]: { guard: 'projectAdmin', module: 'meetings', note: '관리자 또는 주최자', sample: [U, 'created', []], ownerBranch: '관리자 가드 거부 뒤 getActor 로 합류 — 주최자 비교는 관문 뒤' },
  // ── meetings
  [`${A('meetings')}#createMeeting`]: { guard: 'projectMember', module: 'meetings', sample: [P, {}] },
  [`${A('meetings')}#updateMeeting`]: { guard: 'projectAdmin', module: 'meetings', note: '관리자 또는 주최자(adminOrOwnerGate)', sample: [U, {}], ownerBranch: 'adminOrOwnerGate — 주최자 비교는 호출부' },
  [`${A('meetings')}#deleteMeeting`]: { guard: 'projectAdmin', module: 'meetings', note: '관리자 또는 주최자', sample: [U], ownerBranch: 'adminOrOwnerGate — 주최자 비교는 호출부' },
  [`${A('meetings')}#setMeetingAttendees`]: { guard: 'projectAdmin', module: 'meetings', note: '관리자 또는 주최자', sample: [U, []], ownerBranch: 'adminOrOwnerGate — 주최자 비교는 호출부' },
  [`${A('meetings')}#cancelOccurrence`]: { guard: 'projectAdmin', module: 'meetings', note: '관리자 또는 주최자', sample: [U, '2026-09-01'], ownerBranch: 'occurrenceGate → adminOrOwnerGate' },
  [`${A('meetings')}#fetchMyMeetings`]: { guard: 'session', module: 'meetings', note: '전역 내 회의 — 세션 유일 워크스페이스, 행은 getMyMeetings 가 거른다', sample: ['2026-09-01', '2026-09-30'], deny: { ok: true, meetings: [], exceptions: [] } },
  [`${A('meetings')}#fetchMeetingDetail`]: { guard: 'session', module: 'meetings', note: '로그인 + 회의 행의 프로젝트', sample: [U], deny: null },
  // ── minutes — 워크스페이스 모듈(행의 워크스페이스 / 새 회의록은 대상 / 행 없는 목록·폴더는 세션 유일 워크스페이스)
  [`${A('minutes')}#createMinute`]: { guard: 'session', module: 'minutes', note: 'requireActor — 프로젝트면 그 프로젝트, 아니면 세션 유일 워크스페이스', sample: [{ date: '2026-09-01', teamCode: 'PMO', title: 'Acme', bodyMd: '# b', projectId: null }] },
  [`${A('minutes')}#updateMinuteMeta`]: { guard: 'session', module: 'minutes', note: 'requireActor + checkOwner(행의 워크스페이스) — 관문이 입력 검증 뒤라 유효한 표본', sample: [U, { minuteDate: '2026-09-01', teamCode: 'PMO', title: 'Acme', meetingId: null }] },
  [`${A('minutes')}#assignMinutesProject`]: { guard: 'session', module: 'minutes', note: 'requireActor — 일괄(회의록 화면 전용) 세션 유일 워크스페이스', sample: [[U], null], target: 'session' },
  [`${A('minutes')}#resetMinuteExternalId`]: { guard: 'session', module: 'minutes', note: 'requireActor + 행', sample: [U] },
  [`${A('minutes')}#fetchMinuteFoldersLite`]: { guard: 'session', module: 'minutes', note: '로그인 — 목록형: RLS 가 보여 준 폴더 행의 워크스페이스마다 관문, 꺼진 곳의 행을 뺀다(P13 둘째 문장, Ruling B5 fix 우려 ②). 행이 있는 곳이 모두 꺼지면 null, 보이는 행이 없으면 세션 유일 워크스페이스 판정(꺼짐 null·켜짐 []). /minutes/[id] 메타 모달·업로드 모달·챗 패널도 불러 P28 폴더 조작과 다르다', sample: [], deny: null },
  [`${A('minutes')}#replaceMinuteBody`]: { guard: 'session', module: 'minutes', note: 'requireActor + 행', sample: [U, '# b', { fileName: 'a.md', filePath: 'x/a.md', size: 1, mime: 'text/markdown' }] },
  [`${A('minutes')}#recordMinuteFile`]: { guard: 'session', module: 'minutes', note: 'requireActor + 행', sample: [U, { role: 'attachment', fileName: 'a.txt', filePath: 'x/a.txt', size: 1, mime: 'text/plain' }] },
  [`${A('minutes')}#removeMinuteFile`]: { guard: 'session', module: 'minutes', note: 'requireActor + 파일 행의 회의록', sample: [U] },
  [`${A('minutes')}#deleteMinute`]: { guard: 'session', module: 'minutes', note: 'requireActor + 행', sample: [U] },
  [`${A('minutes')}#fetchMinuteDetail`]: { guard: 'session', module: 'minutes', note: '로그인 + 행', sample: [U], deny: null },
  [`${A('minutes')}#getMinuteFileUrl`]: { guard: 'session', module: 'minutes', note: '로그인 + 파일 행의 회의록(행의 워크스페이스 — /minutes/[id] 와 같은 판정)', sample: [U] },
  [`${A('minutes')}#getMinuteVersionFileUrl`]: { guard: 'session', module: 'minutes', note: '로그인 + 행', sample: [U, U] },
  [`${A('minutes')}#fetchProjectMeetingsLite`]: { guard: 'session', module: ['minutes', 'meetings'], note: '로그인 + 인자 프로젝트(회의록 폼의 회의 선택)', sample: [P], deny: { ok: true, meetings: [] } },
  [`${A('minutes')}#fetchMeetingMinutesLite`]: { guard: 'session', module: ['minutes', 'meetings'], note: '로그인 + 회의 행의 프로젝트', sample: [U], deny: [] },
  [`${A('minutes')}#fetchMinutesRange`]: { guard: 'session', module: 'minutes', note: '로그인 — 세션 유일 워크스페이스', sample: ['2026-09-01', '2026-09-30', null], deny: [] },
  [`${A('minutes')}#fetchMinutesSearch`]: { guard: 'session', module: 'minutes', note: '로그인 — 세션 유일 워크스페이스', sample: ['acme', null], deny: [] },
  [`${A('minutes')}#fetchMinutesExplorer`]: { guard: 'session', module: 'minutes', note: '로그인 — 세션 유일 워크스페이스', sample: [], deny: null },
  [`${A('minutes')}#createMinuteFolder`]: { guard: 'session', module: 'minutes', note: 'requireActor — 세션 유일 워크스페이스', sample: ['폴더', null] },
  [`${A('minutes')}#renameMinuteFolder`]: { guard: 'session', module: 'minutes', note: 'requireActor — 세션 유일 워크스페이스(폴더 조작은 /minutes 탐색기 전용 — 그 화면이 유일 워크스페이스로 닫힌다, 판정 P28)', sample: [U, '폴더'], target: 'session' },
  [`${A('minutes')}#deleteMinuteFolder`]: { guard: 'session', module: 'minutes', note: 'requireActor — 세션 유일 워크스페이스(폴더 조작은 /minutes 탐색기 전용 — 그 화면이 유일 워크스페이스로 닫힌다, 판정 P28)', sample: [U], target: 'session' },
  [`${A('minutes')}#moveMinuteFolder`]: { guard: 'session', module: 'minutes', note: '로그인 — 세션 유일 워크스페이스(폴더 조작은 /minutes 탐색기 전용 — 판정 P28)', sample: [U, null], target: 'session' },
  [`${A('minutes')}#moveMinuteToFolder`]: { guard: 'session', module: 'minutes', note: 'requireActor + 행', sample: [U, null] },
  [`${A('minutes')}#fetchMinuteFavorites`]: { guard: 'session', module: 'minutes', note: '로그인 — 세션 유일 워크스페이스', sample: [], deny: null },
  [`${A('minutes')}#toggleMinuteFavorite`]: { guard: 'session', module: 'minutes', note: '로그인 + 행', sample: [U, true], deny: false },
  [`${A('minutes')}#toggleMinuteHighlight`]: { guard: 'session', module: 'minutes', note: 'requireActor + 행', sample: [U, 0, 'h'] },
  [`${A('minutes')}#ensureMinuteInsightsAction`]: { guard: 'session', module: 'minutes', note: '행의 범위 멤버(requireMinuteMember)', sample: [U], deny: { status: 'unavailable', error: ERR_MODULE_DISABLED } },
  [`${A('minutes')}#getMinuteShare`]: { guard: 'session', module: 'minutes', note: 'requireActor + 행', sample: [U] },
  [`${A('minutes')}#setMinuteShare`]: { guard: 'session', module: 'minutes', note: 'requireActor + 행', sample: [U, 'enable'] },
  // ── notifications·preferences — 셸
  [`${A('notifications')}#getNotifications`]: nul('session', '셸 파생 알림 — 로그인 + RLS'),
  [`${A('notifications')}#markAllNotificationsRead`]: nul('session', SESSION_SELF),
  [`${A('preferences')}#getUiPrefs`]: nul('session', SESSION_SELF),
  [`${A('preferences')}#saveUiPrefs`]: nul('session', SESSION_SELF),
  [`${A('preferences')}#getWbsCollapse`]: nul('session', SESSION_SELF),
  [`${A('preferences')}#saveWbsCollapse`]: nul('session', SESSION_SELF),
  // ── project(A) — 설정·프로젝트 관리(core)
  [`${A('project')}#listProjects`]: nul('session', '로그인 + RLS — 셸 프로젝트 목록'),
  [`${A('project')}#listProjectsWithState`]: nul('session', '로그인 + RLS'),
  [`${A('project')}#createProject`]: { ...nul('workspaceAdmin'), sample: [{ workspaceId: U }] },   // isWorkspaceIdInput 이 가드 앞
  [`${A('project')}#updateProject`]: nul('projectAdmin'),
  [`${A('project')}#setProjectPrivacy`]: nul('projectAdmin'),
  [`${A('project')}#setBaseDate`]: nul('projectAdmin'),
  [`${A('project')}#addHoliday`]: nul('projectAdmin'),
  [`${A('project')}#removeHoliday`]: nul('projectAdmin'),
  [`${A('projectAreas')}#listAreas`]: nul('projectAdmin'),
  [`${A('projectAreas')}#upsertArea`]: nul('projectAdmin'),
  [`${A('projectInvites')}#listProjectInvites`]: nul('projectAdmin'),
  [`${A('projectInvites')}#createProjectInvite`]: nul('projectAdmin'),
  [`${A('projectInvites')}#revokeProjectInvite`]: nul('projectAdmin'),
  [`${A('projectTeams')}#addProjectTeam`]: nul('projectAdmin'),
  [`${A('projectTeams')}#updateProjectTeam`]: nul('projectAdmin'),
  [`${A('projectTeams')}#copyGlobalTeams`]: nul('projectAdmin'),
  // ── roster(D) — members(core)
  [`${A('roster')}#upsertRosterMember`]: nul('projectAdmin'),
  [`${A('roster')}#removeRosterMember`]: nul('projectAdmin'),
  [`${A('roster')}#listRoster`]: nul('projectMember'),
  // ── settings(A) — core
  [`${A('settings')}#updateProjectSettings`]: { ...nul('projectAdmin'), sample: [P, {}] },   // isUuidLike 가 가드 앞
  [`${A('settings')}#updateWorkspaceSettings`]: { ...nul('workspaceAdmin'), sample: [U, {}] },   // isUuidLike 가 가드 앞
  [`${A('settings')}#getSettingsCommandOutcome`]: { ...nul('session', '범위 분기 — 프로젝트 관리자·워크스페이스 관리자(내부 가드)'), sample: [{ projectId: P }, U] },   // 범위 객체가 가드 인자
  [`${A('settings')}#listSettingsHistory`]: { ...nul('session', '범위 분기 — 프로젝트 관리자·워크스페이스 관리자(내부 가드)'), sample: [{ projectId: P }] },
  [`${A('settingsPreview')}#previewSettingsImpact`]: { ...nul('workspaceAdmin', '설정 미리보기 — 모듈을 켜는 관리 화면이어서 모듈 관문 밖'), sample: [U, ['agents']] },
  // ── teams — 워크스페이스 관리
  [`${A('teams')}#addTeam`]: { ...nul('workspaceAdmin'), sample: [U, 'T'] },   // typeof workspaceId 가 가드 앞
  [`${A('teams')}#updateTeam`]: { ...nul('workspaceAdmin'), adminBeforeGuard: '인증 뒤 teams 행에서 대상 워크스페이스를 읽는다(service_role) — 등급 가드는 그 뒤' },
  [`${A('teams')}#listTeamsAdmin`]: { ...nul('workspaceAdmin'), sample: [U] },
  // ── wbs·wbsAssign·wbsMarkdown·wbsSpec — WBS(core). 위임·프롬프트 둘만 agents
  [`${A('wbs')}#getChangeLogs`]: nul('session', '로그인 + RLS(WBS 변경 이력)'),
  [`${A('wbs')}#updateActual`]: { ...nul('projectMember'), sample: [U, 50] },   // 0~100 검사가 가드 앞
  [`${A('wbs')}#updateWeight`]: nul('projectMember'),
  [`${A('wbs')}#addWbsItem`]: nul('projectMember'),
  [`${A('wbs')}#addSubAct`]: nul('projectMember'),
  [`${A('wbs')}#updateWbsFields`]: nul('projectMember'),
  [`${A('wbs')}#addTaskDependency`]: nul('projectMember'),
  [`${A('wbs')}#removeTaskDependency`]: nul('projectMember'),
  [`${A('wbs')}#updateDeliverable`]: nul('projectMember'),
  [`${A('wbs')}#deleteWbsItem`]: nul('projectMember'),
  [`${A('wbs')}#moveWbsItem`]: nul('projectMember'),
  [`${A('wbsAssign')}#setWbsAssignee`]: { ...nul('projectAdmin'), sample: [U, null] },   // resolveItemProjectId 의 isUuidLike 가 가드 앞
  [`${A('wbsAssign')}#setWbsAssigneeCascade`]: { ...nul('projectAdmin'), sample: [U, U] },
  [`${A('wbsAssign')}#setWbsStage`]: { ...nul('projectAdmin'), sample: [U, null] },
  [`${A('wbsAssign')}#setWbsDevWorkflow`]: { ...nul('projectAdmin', 'WBS 필드(core) — 주문 발행은 ensureOrder 의 두 원천 AND 가 막는다(P19)'), sample: [U, false, false] },
  [`${A('wbsAssign')}#getWbsAssigneeStage`]: { ...nul('projectMember'), sample: [U] },
  [`${A('wbsMarkdown')}#previewWbsUpload`]: nul('projectAdmin'),
  [`${A('wbsMarkdown')}#applyWbsUpload`]: nul('projectAdmin'),
  [`${A('wbsSpec')}#getWbsSpec`]: { ...nul('projectMember'), sample: [U] },   // loadItemProject 의 isUuidLike 가 가드 앞
  [`${A('wbsSpec')}#updateWbsSpec`]: { ...nul('projectAdmin'), sample: [U, 's'] },
  [`${A('wbsSpec')}#updateWbsSpecFields`]: { ...nul('projectAdmin'), sample: [U, { priority: null }] },   // 빈 fields 는 가드 앞에서 막힌다(fields.priority TypeError)
  [`${A('wbsSpec')}#updateAgentPrompt`]: { guard: 'projectAdmin', module: 'agents', note: '위임권(requireDelegationRight)', sample: [U, '프롬프트'] },
  [`${A('wbsSpec')}#setAgentDelegation`]: { guard: 'projectAdmin', module: 'agents', note: '위임권(requireDelegationRight)', sample: [U, true] },
  // ── weekly
  [`${A('weekly')}#createWeeklyReport`]: { guard: 'projectAdmin', module: 'weekly', sample: [P, '2026-09-07', false] },
  [`${A('weekly')}#saveWeeklyTitle`]: { guard: 'projectMember', module: 'weekly', sample: [P, U, '제목'] },
  [`${A('weekly')}#prepareWeeklyCellRewrite`]: { guard: 'projectMember', module: 'weekly', sample: [P, []] },
  [`${A('weekly')}#saveWeeklyCell`]: { guard: 'projectMember', module: 'weekly', sample: [P, U, 'this_content', '내용'] },
  [`${A('weekly')}#saveWeeklyCells`]: { guard: 'projectMember', module: 'weekly', sample: [P, []] },
  // ── wiki
  [`${A('wiki')}#createWikiDocument`]: { guard: 'projectMember', module: 'wiki', sample: [{ projectId: P, title: 't', bodyMd: 'b', documentKind: 'note' }] },
  [`${A('wiki')}#updateWikiDocument`]: { guard: 'projectMember', module: 'wiki', sample: [{ projectId: P, topicId: U, title: 't', bodyMd: 'b', documentKind: 'note' }] },
  [`${A('wiki')}#verifyWikiDocument`]: { guard: 'projectMember', module: 'wiki', sample: [{ projectId: P, topicId: U }] },
  [`${A('wiki')}#restoreWikiDocumentRevision`]: { guard: 'projectMember', module: 'wiki', sample: [{ projectId: P, topicId: U, revisionId: U }] },
  [`${A('wiki')}#createWikiQuestion`]: { guard: 'projectMember', module: 'wiki', sample: [{ projectId: P, question: 'q' }] },
  [`${A('wiki')}#answerWikiQuestion`]: { guard: 'projectMember', module: 'wiki', sample: [{ projectId: P, questionId: U, answerMd: 'a' }] },
  [`${A('wiki')}#reviewWikiItem`]: { guard: 'projectAdmin', module: 'wiki', sample: [{ projectId: P, topicId: U, itemId: U, reviewState: 'accepted' }] },
  [`${A('wiki')}#submitWikiFeedback`]: { guard: 'projectMember', module: 'wiki', sample: [{ projectId: P, topicId: U, kind: 'helpful' }] },
  [`${A('wiki')}#curateWikiItem`]: { guard: 'projectAdmin', module: 'wiki', sample: [{ projectId: P, topicId: U, itemId: U, action: 'hide' }] },
  [`${A('wiki')}#mergeWikiTopics`]: { guard: 'projectAdmin', module: 'wiki', sample: [{ projectId: P, sourceTopicId: U, targetTopicId: U }] },
}

// 모듈 라우트의 실행 확인(P15)은 그 라우트의 기존 테스트 파일이 맡는다 — 과제 14·18·20·21 이 모듈 거부 케이스를 더한다
const sess = (module: ModuleId, delegatedTo: string, note = '로그인 세션 — 프로젝트면 그 프로젝트, 없으면 세션 유일 워크스페이스'): GateEntry => ({ guard: 'session', module, note, delegatedTo })
const agent = (): GateEntry => ({
  guard: 'agentPrincipal', module: 'agents', delegatedTo: 'tests/modules/agents-gate.test.ts',
  delegatedStatic: '두 원천 AND — agents-gate 가 경로 문자열로 핸들러의 판정 호출을 보고, 실행은 tests/agent/{wbs-structure,me-route,watch-route} 가 본다(과제 18)',
})
const mapi = (delegatedTo: string): GateEntry => ({ guard: 'minutesSecret', module: 'minutes_integration', note: '배포 비밀 + user_email — 409 module_disabled', delegatedTo })
const LEGACY_CHAT = 'tests/api/chat-legacy-scope.test.ts'
const MINUTES_EXT = 'tests/minutes/external-api.test.ts'

export const ROUTE_GATES: Readonly<Record<string, GateEntry>> = {
  [`${R('chat/command')}#POST`]: sess('chatbot', 'tests/api/chat-command-gate.test.ts', '로그인 — 프로젝트 화면 전용(프로젝트 없으면 안내문)'),
  [`${R('chat/context')}#GET`]: sess('chatbot', LEGACY_CHAT, '로그인 — 프로젝트 문맥이면 그 프로젝트, 없으면 세션 유일 워크스페이스. ?probe=1 은 관문만(P12)'),
  [`${R('chat/health')}#GET`]: nul('superuser'),
  [`${R('chat/index/worker')}#POST`]: nul('cronSecret', 'x-cron-secret — 잡마다 moduleState(과제 22)'),
  [`${R('chat/reindex')}#POST`]: { guard: 'projectAdmin', module: 'chatbot', delegatedTo: 'tests/api/chat-reindex.test.ts' },
  [`${R('chat')}#POST`]: sess('chatbot', LEGACY_CHAT),
  [`${R('chat/stream')}#POST`]: sess('chatbot', LEGACY_CHAT),
  [`${R('chat/v2/stream')}#POST`]: sess('chatbot', 'tests/ai/chat-v2-route.test.ts', '로그인 — 요청의 프로젝트 힌트(pageContext·projectId), 없으면 세션 유일 워크스페이스. env 501 은 관문 앞, 강등 501 은 관문 뒤'),
  [`${R('cron/ai-index')}#GET`]: nul('cronSecret', 'CRON_SECRET — 잡마다 moduleState(과제 22)'),
  [`${R('cron/inbox-retention')}#GET`]: nul('cronSecret', 'CRON_SECRET — 알림함 보존(셸)'),
  [`${R('export')}#GET`]: nul('session', '로그인 + 목록 — WBS 내보내기(core)'),
  [`${R('import/execute')}#POST`]: nul('projectAdmin'),
  [`${R('import/inspect')}#POST`]: nul('projectAdmin'),
  [`${R('import/template')}#GET`]: nul('session', '로그인 — 정적 양식(core)'),
  [`${R('issue-analysis')}#GET`]: { guard: 'projectMember', module: 'issues', delegatedTo: 'tests/api/issue-analysis-gate.test.ts' },
  [`${R('minutes/chat')}#POST`]: sess('minutes', 'tests/api/minutes-chat-route.test.ts', '로그인 — 문서 모드는 회의록 행의 워크스페이스, 보관함 모드는 세션 유일 워크스페이스'),
  [`${R('minutes/export')}#GET`]: sess('minutes', 'tests/minutes/export-route.test.ts', '로그인 — 세션 유일 워크스페이스(전 회의록 ZIP)'),
  [`${R('prefs')}#POST`]: nul('session', '셸 개인 설정 — 안의 액션이 세션을 본다'),
  [`${R('report')}#GET`]: sess('weekly', 'tests/api/report-route.test.ts', 'source=sheet 갈래만 weekly 관문 — 기본 갈래(WBS 보고서 모달)는 core(P4)'),
  [`${R('shell')}#GET`]: nul('session', '셸 — 안의 액션이 각자 관문을 지나 그 항목만 비운다(§4.2), 결재 배지는 projectsWithModule'),
  [`${R('track')}#POST`]: sess('usage', 'tests/actions/usage-track-gate.test.ts', '로그인 claims — 경로의 프로젝트, 없으면 세션 유일 워크스페이스. 꺼지면 200 skipped(P19)'),
  [`${R('v1/agent/me')}#GET`]: agent(),
  [`${R('v1/agent/watch')}#POST`]: agent(),
  [`${R('v1/agent/work/[id]/claim')}#POST`]: agent(),
  [`${R('v1/agent/work/[id]/heartbeat')}#POST`]: agent(),
  [`${R('v1/agent/work/[id]/release')}#POST`]: agent(),
  [`${R('v1/agent/work/[id]/report')}#POST`]: agent(),
  [`${R('v1/agent/work/[id]')}#GET`]: agent(),
  [`${R('v1/agent/work/mine')}#GET`]: agent(),
  [`${R('v1/agent/work')}#GET`]: agent(),
  [`${R('v1/minutes/folder')}#POST`]: mapi('tests/minutes/folder-batch.test.ts'),
  [`${R('v1/minutes/link')}#POST`]: mapi(MINUTES_EXT),
  [`${R('v1/minutes/meta')}#GET`]: mapi('tests/api/minutes-meta-modules.test.ts'),
  [`${R('v1/minutes')}#POST`]: mapi(MINUTES_EXT),
  [`${R('v1/minutes')}#GET`]: mapi(MINUTES_EXT),
  [`${R('v1/wbs/import')}#POST`]: agent(),
  [`${R('v1/wbs/structure')}#GET`]: agent(),
  [`${R('wiki/ask')}#POST`]: sess('wiki', 'tests/actions/wiki-ask-route.test.ts'),
  [`${R('wiki/reindex')}#POST`]: nul('superuser'),
  [`${R('wiki/search')}#GET`]: sess('wiki', 'tests/actions/wiki-search-route.test.ts'),
  [`${R('wiki/search')}#POST`]: sess('wiki', 'tests/actions/wiki-search-route.test.ts'),
  [`${R('wiki/summarize')}#POST`]: sess('wiki', 'tests/actions/wiki-summarize-route.test.ts'),
  [`${R('wiki/worker')}#POST`]: nul('cronSecret', 'WIKI_WORKER_SECRET — 잡마다 moduleState(과제 22)'),
  [`${R('wiki/worker')}#GET`]: nul('cronSecret', 'CRON_SECRET — 잡마다 moduleState(과제 22)'),
}

/** 접두는 모듈을 가리키지만 라우트 단 관문이 맞지 않는 경로 — 모듈 판정을 null 로 덮는다(닫힌 목록, 사유 필수) */
export const ROUTE_MODULE_OVERRIDES: Readonly<Record<string, string>> = {
  '/api/chat/health': '플랫폼 진단(슈퍼유저) — 대상 워크스페이스가 없다',
  '/api/wiki/reindex': '플랫폼 운영(슈퍼유저, 실제로는 챗 색인 잡 현황) — 대상 워크스페이스가 없다',
  '/api/chat/index/worker': '워커 — 잡마다 moduleState 로 판정(D16)',
  '/api/cron/ai-index': '워커 — 잡마다 moduleState 로 판정(D16)',
  '/api/wiki/worker': '워커 — 잡마다 moduleState 로 판정(D16)',
}

/** 어느 모듈의 apiPrefixes 에도 걸리지 않는 셸·크론 경로(스펙 §4.3 닫힌 목록). Phase C 가 /api/brand 를 더한다 */
export const CORE_ROUTE_ALLOW: Readonly<Record<string, string>> = {
  '/api/prefs': '셸 — 개인 UI 설정',
  '/api/shell': '셸 — 알림함·파생 알림·공지 배지·티커·결재 배지 통합 조회',
  '/api/cron/inbox-retention': '크론 — 알림함 보존 정리',
}

/** 메타데이터 라우트(icon·opengraph-image·sitemap 등 — 요청마다 서버 코드로 그린다) 닫힌 허용 목록(판정 F12). 모듈 경로 아래의 메타데이터는 모듈 데이터를
 *  그릴 수 있어 관문이 필요하다 — 여기 더하지 말고 먼저 관문 설계를 정한다 */
export const METADATA_ROUTE_ALLOW: Readonly<Record<string, string>> = {
  'src/app/icon.tsx': '앱 아이콘(정적 그림) — 데이터 없음',
  'src/app/apple-icon.tsx': '앱 아이콘(정적 그림) — 데이터 없음',
}
