// RPC → 그 RPC 가 만지는 표(SP4 스펙 D25·Q9). 열거 게이트의 표 판별(tests/invariants/_ast.ts 의 tablesInNode)은 리터럴 `.from('<표>')`
// 만 본다 — DEFINER RPC 안의 쓰기는 그 눈을 우회한다. tablesInNode 가 리터럴 `.rpc('<이름>')` 를 여기 적힌 표로 바꿔 합치고, 여기 없는
// 이름은 `rpc?:<이름>` 표지로 낸다 — module null 항목(deny.test.ts)이 그 표지를 만나면 실패다(모듈 항목이 부르는 RPC 는 모듈 관문이 먼저
// 닫으므로 없어도 된다). 그래서 액션 축(deny.test.ts)과 라우트 축(deny.routes.test.ts)이 같은 대응을 쓴다.
// 관리 목록이다 — 규칙(tests/gates/rpc-tables.test.ts 가 검사한다):
//  - 키 = 마이그레이션이 정의한 public 함수 이름, 코드 포인트 순. src 가 리터럴로 부르지 않는 이름은 두지 않는다(죽은 항목).
//  - 값 = 그 함수 본문(+ 본문이 부르는 public 함수, 트리거 제외)이 쓰는(insert·update·delete·merge·truncate) public 표(스펙 §4.1.9).
//    적어도 토글 모듈 표(_tables.ts)는 빠짐없이, 본문이 쓰지 않는 표는 적지 않는다(SQL 에서 잰 집합과 대조). 순서는 자유, 중복 없음.
//    읽기만 하는 표는 넣지 않는다 — RPC 의 모듈 표 읽기는 이 게이트가 보지 않는다(한계). 빈 목록 = 아는 RPC, 쓰는 표 없음.
//  - 새 RPC 를 부르는 커밋이 같은 커밋에서 한 줄을 더한다. 마이그레이션이 RPC 를 다시 정의해 표가 바뀌면 그 커밋이 고친다.
// 첫 판(SP4 A1 과제 8) = main 의 module null 항목이 부르는 리터럴 RPC 11개 — 어느 것도 토글 모듈 표를 쓰지 않는다(실측).
export const UNKNOWN_RPC_PREFIX = 'rpc?:'

export const RPC_TABLES: Readonly<Record<string, readonly string[]>> = {
  apply_project_settings: ['project_settings', 'project_settings_history'],
  apply_workspace_settings: ['workspace_settings', 'workspace_settings_history'],
  can_attach: [],
  consume_project_invite: ['people', 'profiles', 'project_invites', 'project_member_teams', 'project_members', 'workspace_members'],
  create_project_with_settings: ['area_teams', 'project_areas', 'project_settings', 'project_settings_history', 'projects', 'teams'],
  import_wbs: ['holidays', 'item_owners', 'wbs_items'],
  purge_read_notifications: ['notification_events', 'notification_recipients'],
  replace_wbs: ['holidays', 'item_owners', 'wbs_items'],
  set_platform_admin: ['authz_commands', 'platform_admins'],
  set_workspace_role: ['authz_commands', 'workspace_members'],
  upsert_project_member_cmd: ['authz_commands', 'people', 'project_member_teams', 'project_members'],
}
