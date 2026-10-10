// RPC → 그 RPC 가 만지는 표(SP4 스펙 D25·Q9). 열거 게이트의 표 판별(tests/invariants/_ast.ts 의 tablesInNode)은 리터럴 `.from('<표>')`
// 만 본다 — DEFINER RPC 안의 쓰기는 그 눈을 우회한다. tablesInNode 가 리터럴 `.rpc('<이름>')` 를 여기 적힌 표로 바꿔 합치고, 여기 없는
// 이름은 `rpc?:<이름>` 표지로 낸다 — 관문 없는 자리에서 그 표지를 만나면 실패다(모듈 항목이 부르는 RPC 는 모듈 관문이 먼저 닫으므로
// 없어도 된다). 두 축이 같은 대응·같은 판정을 쓴다: 액션 축(deny.test.ts)은 module null 항목 전부(라우트 null 항목 포함), 라우트 축
// (deny.routes.test.ts)은 BRANCH_GATE 의 관문 없는 갈래(core 구간 갈래·조기 반환 갈래 — K4). 비리터럴 이름도 `rpc?:<dynamic>` 표지다(K8).
// 한계: 다른 파일 도우미가 부르는 RPC(예: applyWorkflowEvent 의 apply_workflow_event, writeProjectSettingsInternal 의
// apply_project_settings)와 라우트 축의 최상위 if·switch 밖 core 폴스루 문장은 보지 않는다.
// 관리 목록이다 — 규칙(tests/gates/rpc-tables.test.ts 가 검사한다):
//  - 키 = 마이그레이션이 정의한 public 함수 이름, 코드 포인트 순. src 가 리터럴로 부르지 않는 이름은 두지 않는다(죽은 항목).
//  - 값 = 그 함수 본문(+ 본문이 부르는 public 함수, 트리거 제외)이 쓰는(insert·update·delete·merge·truncate) public 표(스펙 §4.1.9).
//    적어도 토글 모듈 표(_tables.ts)는 빠짐없이, 본문이 쓰지 않는 표는 적지 않는다(SQL 에서 잰 집합과 대조). 순서는 자유, 중복 없음.
//    읽기만 하는 표는 넣지 않는다 — RPC 의 모듈 표 읽기는 이 게이트가 보지 않는다(한계). 빈 목록 = 아는 RPC, 쓰는 표 없음.
//  - 새 RPC 를 부르는 커밋이 같은 커밋에서 한 줄을 더한다. 마이그레이션이 RPC 를 다시 정의해 표가 바뀌면 그 커밋이 고친다.
// 첫 판(SP4 A1 과제 8) = main 의 module null 항목이 부르는 리터럴 RPC 11개 — 어느 것도 토글 모듈 표를 쓰지 않는다(실측).
export const UNKNOWN_RPC_PREFIX = 'rpc?:'
/** 이름이 리터럴이 아닌 `.rpc(…)`·`['rpc'](…)` 의 표지 이름(`rpc?:<dynamic>`) — 무엇을 부르는지 모르니 실패다(K8) */
export const DYNAMIC_RPC = '<dynamic>'
/** 비리터럴 `.rpc(` 허용 — `<파일>#<호출 식 원문>` → 그 파일의 자리 수·사유(닫힌 목록. rpc-tables.test.ts 가 src 실측 개수와 대조한다).
 *  Supabase 호출이 아닌 같은 이름의 메서드만 둔다. */
export const DYNAMIC_RPC_ALLOW: Readonly<Record<string, { count: number; why: string }>> = {
  'src/app/actions/settings.ts#a.rpc': {
    count: 1,
    why: '설정 어댑터 메서드 a.rpc(admin, …) — Supabase 호출이 아니다. 실제 호출은 같은 파일의 리터럴 admin.rpc(apply_project_settings·apply_workspace_settings) 둘',
  },
}

export const RPC_TABLES: Readonly<Record<string, readonly string[]>> = {
  apply_project_settings: ['project_settings', 'project_settings_history'],
  apply_wbs_bulk_item: ['wbs_items', 'item_owners', 'change_logs'],
  apply_workflow_event_cas: ['wbs_items', 'agent_work_orders', 'change_logs', 'wbs_stage_approvals'],
  apply_workflow_event_stage_cas: ['wbs_items', 'agent_work_orders', 'change_logs', 'wbs_stage_approvals'],
  apply_workspace_settings: ['workspace_settings', 'workspace_settings_history'],
  // 0056 — 워크스페이스 보관. 본문이 쓰는 표는 workspaces 하나다(보관 기록 열만 고친다 — 모듈 표의 행은 건드리지 않는다)
  archive_workspace: ['workspaces'],
  can_attach: [],
  // 팀 유연화 2단계 — 코드 변경은 팀 행과 그 팀 회의록의 사본 열(team_code)
  change_team_code: ['teams', 'minutes'],
  consume_project_invite: ['people', 'profiles', 'project_invites', 'project_member_teams', 'project_members', 'workspace_members'],
  convert_inherited_teams: ['teams', 'item_owners', 'project_member_teams', 'area_teams', 'project_invites', 'minutes', 'minute_folders'],
  create_project_with_settings: ['form_templates', 'area_teams', 'project_areas', 'project_settings', 'project_settings_history', 'projects', 'teams'],
  // SP5 B2 — 공용 팀 + (teams 모드) 회의록 팀 루트 / 루트 없는 활성 공용 팀의 루트
  create_team: ['teams', 'minute_folders'],
  create_weekly_report: ['weekly_reports', 'weekly_report_rows'],
  // 0054 — 워크스페이스 행·첫 관리자 멤버십·인물 + 설정 값(안에서 apply_workspace_settings 를 부른다 — 그 함수의 표를 함께 적는다. 설정 행 생성·권한 이력은 트리거)
  create_workspace_with_admin: ['workspaces', 'workspace_members', 'people', 'workspace_settings', 'workspace_settings_history'],
  // 0055 — 빈 워크스페이스 삭제. 본문이 쓰는 표는 workspaces 하나다(부속 행은 FK 캐스케이드·권한 이력은 삭제 트리거 — 규칙: 트리거 제외).
  // 모듈 표를 포함해 닫힌 목록 밖의 참조 표에 행이 있으면 RPC 가 지우지 않고 거부한다
  delete_empty_workspace: ['workspaces'],
  // 0058 — 프로젝트 삭제. 비-CASCADE 참조의 자식 쪽을 손으로 지운 뒤 projects 행을 지운다(나머지는 FK 캐스케이드 — 규칙: 트리거·캐스케이드 제외).
  // 연동 토큰에서는 그 프로젝트·전용 팀의 참조만 떼고, 삭제 사실을 권한 이력에 한 행 남긴다. 회의록이 있으면 아무것도 쓰지 않고 거부한다
  delete_project: ['integration_credentials', 'wbs_stage_approvals', 'agent_work_orders', 'area_teams', 'project_member_teams', 'weekly_report_rows',
    'issue_assignees', 'issues', 'issue_major_processes', 'attendance_records', 'meeting_attendees', 'wiki_change_events', 'wiki_questions',
    'wiki_items', 'wbs_items', 'minute_folders', 'projects', 'authz_events'],
  ensure_team_roots: ['minute_folders'],
  get_project_creation_receipt: [], // command receipt read only; no writes
  import_wbs_cmd: ['wbs_items', 'item_owners', 'holidays', 'command_receipts'],
  // 팀 병합 — 원본 팀의 참조를 대상 팀으로 옮기고 원본을 비활성으로
  merge_teams: ['item_owners', 'project_member_teams', 'area_teams', 'project_invites', 'minutes', 'minute_folders', 'integration_credentials', 'teams'],
  project_delete_summary: [], // 삭제 미리보기 — 건수만 읽는다
  purge_read_notifications: ['notification_events', 'notification_recipients'],
  // 0053 — 관리자가 한 비밀번호 재설정의 기록 1행
  record_password_reset: ['authz_events'],
  // 0053 — 소속 삭제 + 수락 전 초대 회수 + 소유 토큰 닫기(명단 권한 null·이력은 트리거가 쓴다 — 규칙: 트리거 제외)
  remove_workspace_member: ['workspace_members', 'project_invites', 'integration_credentials'],
  // 0055 — 워크스페이스 이름(행의 name 한 칸)
  rename_workspace: ['workspaces'],
  // 0056 — 보관된 워크스페이스 복원. workspaces 의 보관 기록 열을 비우고 복원 시각·실행자를 적는다
  restore_workspace: ['workspaces'],
  set_platform_admin: ['authz_commands', 'platform_admins'],
  set_workspace_role: ['authz_commands', 'workspace_members'],
  team_reference_counts: [], // 병합 미리보기 — 건수만 읽는다
  upsert_project_area: ['project_areas', 'area_teams', 'weekly_report_rows'],
  upsert_project_member_cmd: ['authz_commands', 'people', 'project_member_teams', 'project_members'],
}
