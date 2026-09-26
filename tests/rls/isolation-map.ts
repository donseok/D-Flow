// 전수 교차 테스트(workspace-isolation.test.ts)의 표별 "A 행" 판별식. service 경로(RLS 없음)에서 별칭 t 로 평가한다.
// 표가 새로 생기면 여기 없다는 이유로 테스트가 실패한다 — 새 표의 스코프를 반드시 정하게 한다.
import { F } from './harness'

const A = `'${F.ws}'::uuid`
const AP = `(select id from public.projects where workspace_id = ${A})`
/** A 에만 속한 계정 — 두 워크스페이스 사용자(dana)는 빠진다 */
const A_ONLY = `(select user_id from public.workspace_members where workspace_id = ${A}
                 except select user_id from public.workspace_members where workspace_id <> ${A})`
const A_MINUTES = `(select id from public.minutes where project_id in ${AP} or (project_id is null and created_by in ${A_ONLY}))`
const inAP = 't.project_id in ' + AP

export const A_ROW_FILTER: Record<string, string> = {
  agent_lead_leases: inAP, agent_projects: inAP,
  agent_runners: `(${inAP} or t.owner_user_id in ${A_ONLY})`,
  agent_watchers: `(${inAP} or t.user_id in ${A_ONLY})`,
  agent_work_orders: inAP,
  agent_work_reports: `t.work_order_id in (select id from public.agent_work_orders where project_id in ${AP})`,
  ai_documents: inAP, ai_index_jobs: inAP, announcement_seen: inAP, announcements: inAP,
  area_teams: `t.area_id in (select id from public.project_areas where project_id in ${AP})`,
  attendance_records: inAP,
  change_logs: `t.wbs_item_id in (select id from public.wbs_items where project_id in ${AP})`,
  deliverable_attachments: `t.wbs_item_id in (select id from public.wbs_items where project_id in ${AP})`,
  holidays: inAP, issue_analysis_runs: inAP, issue_assignees: inAP, issue_attachments: inAP, issue_links: inAP,
  issue_major_processes: inAP, issue_mega_areas: 'true', issue_number_counters: inAP, issue_updates: inAP, issues: inAP,
  item_owners: `t.wbs_item_id in (select id from public.wbs_items where project_id in ${AP})`,
  llm_config: 'true', llm_profiles: 'true',
  meeting_attendees: inAP,
  meeting_exceptions: `t.meeting_id in (select id from public.meetings where project_id in ${AP})`,
  meetings: inAP,
  minute_embeddings: `t.minute_id in ${A_MINUTES}`, minute_favorites: `t.minute_id in ${A_MINUTES}`,
  minute_files: `t.minute_id in ${A_MINUTES}`,
  minute_folders: `(${inAP} or (t.project_id is null and t.created_by in ${A_ONLY}))`,
  minute_highlights: `t.minute_id in ${A_MINUTES}`, minute_insights: `t.minute_id in ${A_MINUTES}`,
  minute_versions: `t.minute_id in ${A_MINUTES}`, minutes: `t.id in ${A_MINUTES}`,
  notification_events: `(${inAP} or (t.project_id is null and t.actor_user_id in ${A_ONLY}))`,
  notification_recipients: `t.event_id in (select id from public.notification_events where project_id in ${AP})`,
  people: `t.workspace_id = ${A}`,
  platform_admins: 'true',
  profiles: `t.user_id in ${A_ONLY}`,
  project_ai_briefs: inAP, project_areas: inAP, project_invites: inAP,
  project_member_teams: `t.member_id in (select id from public.project_members where project_id in ${AP})`,
  project_members: inAP, project_settings: inAP,
  projects: `t.workspace_id = ${A}`,
  task_dependencies: inAP,
  teams: `t.workspace_id = ${A}`,
  usage_events: `(${inAP} or t.user_id in ${A_ONLY})`,
  user_preferences: `t.user_id in ${A_ONLY}`,
  user_wbs_state: inAP, wbs_embeddings: inAP, wbs_items: inAP, wbs_progress_snapshots: inAP,
  weekly_report_rows: `t.report_id in (select id from public.weekly_reports where project_id in ${AP})`,
  weekly_reports: inAP, wiki_change_events: inAP, wiki_feedback: inAP,
  wiki_item_relations: `t.from_item_id in (select id from public.wiki_items where project_id in ${AP})`,
  wiki_item_sources: `t.wiki_item_id in (select id from public.wiki_items where project_id in ${AP})`,
  wiki_items: inAP, wiki_processing_jobs: inAP, wiki_project_rebuild_jobs: inAP, wiki_questions: inAP,
  wiki_topic_revisions: inAP, wiki_topics: inAP,
  workspace_members: `t.workspace_id = ${A}`,
  workspace_settings: `t.workspace_id = ${A}`,
  workspaces: `t.id = ${A}`,
}

/** D2 — 전역 참조 데이터. 읽기는 예외(쓰기는 여전히 거부돼야 한다). 만료: SP5 */
export const OPEN_BY_DESIGN: ReadonlySet<string> = new Set(['issue_mega_areas'])

/** 픽스처가 A 행을 넣지 못한 표 → 사유. 비어 있는 게 목표다 */
export const UNFILLED: Record<string, string> = {}

/**
 * RLS 를 켜지 않은 public 표, security_invoker 가 아닌 뷰(소유자 권한으로 RLS 를 건너뛴다), RLS 를 걸 수 없는 구체화 뷰·외부 표 → 사유.
 * 비어 있는 게 목표다. 기본 권한(pg_default_acl)이 새 표에 authenticated 쓰기를 주므로 RLS 를 잊은 표는 곧 교차 워크스페이스 누설이다.
 */
export const RLS_EXEMPT: Record<string, string> = {}

/**
 * B 계정이 "자기 이름으로" A 부모에 매다는 쓰기 — 복사 insert 로는 안 드러나는 경로($1 = B 계정 id). 각 탐침은 RLS 거부(42501 + RLS 문구)여야
 * 통과다 — 다른 오류(컬럼 이름 변경 42703 등)는 탐침이 정책까지 가지 못했다는 뜻이라 실패로 센다.
 * 의무 대상: 복사 insert 를 트리거·권한이 RLS 보다 먼저 막은 표, 그리고 INSERT·ALL 정책의 WITH CHECK 가 자기 컬럼을 auth.uid() 와 비교하는
 * 표(복사 행의 소유자는 A 사용자·null 이라 소유자 비교가 먼저 떨어져 프로젝트·워크스페이스 판정이 평가되지 않는다).
 */
export const OWN_INSERT_PROBES: ReadonlyArray<{ table: string; sql: string }> = [
  { table: 'change_logs', sql: `insert into public.change_logs (wbs_item_id, field, user_id) values ('${F.leaf.aErp}', 'actual_pct', $1)` },
  { table: 'minute_highlights', sql: `insert into public.minute_highlights (minute_id, block_index, block_hash, created_by) values ('${F.rows.minute}', 7, 'rls-x', $1)` },
  { table: 'minute_folders', sql: `insert into public.minute_folders (name, project_id, created_by) values ('RLS 침입', '${F.projects.a}', $1)` },
  { table: 'minute_files', sql: `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime, uploaded_by) values ('${F.rows.minute}', 'attachment', 'x.txt', 'rls/x.txt', 1, 'text/plain', $1)` },
  { table: 'minute_favorites', sql: `insert into public.minute_favorites (user_id, minute_id) values ($1, '${F.rows.minute}')` },
  { table: 'announcement_seen', sql: `insert into public.announcement_seen (user_id, project_id) values ($1, '${F.projects.a}')` },
  { table: 'user_wbs_state', sql: `insert into public.user_wbs_state (user_id, project_id) values ($1, '${F.projects.a}')` },
  // 복사 insert 는 major_seq 를 들고 가서 assign_issue_major_seq 트리거가 RLS 전에 막는다 — seq 없이 넣어 RLS 가 판정하게 한다.
  // 탐침은 모두 $1 을 쓴다 — 안 쓰면 08P01(bind 인자 수 불일치)로 정책까지 가지 못한다(이 탐침이 그랬다, F17 에서 발견)
  { table: 'issue_major_processes', sql: `insert into public.issue_major_processes (project_id, mega_code, name) values ('${F.projects.a}', '99', 'RLS 침입 ' || $1::text)` },
  // WITH CHECK 가 소유자 비교로 시작하는 표 — 자기 이름으로 넣어 뒤의 프로젝트·워크스페이스 판정을 태운다
  { table: 'issues', sql: `insert into public.issues (project_id, title, created_by) values ('${F.projects.a}', 'RLS 침입', $1)` },
  { table: 'meetings', sql: `insert into public.meetings (project_id, title, meeting_date, created_by) values ('${F.projects.a}', 'RLS 침입', '2026-09-01', $1)` },
  { table: 'user_preferences', sql: `insert into public.user_preferences (user_id, workspace_id, prefs) values ($1, '${F.ws}', '{}')` },
  { table: 'issue_updates', sql: `insert into public.issue_updates (issue_id, project_id, body, author_name, author_user_id) values ('${F.rows.issue}', '${F.projects.a}', 'RLS 침입', 'rls', $1)` },
  // user_id·asked_by 는 컬럼 권한이 없고 기본값이 auth.uid() 다 — 열린 컬럼만 넣는다
  { table: 'wiki_feedback', sql: `insert into public.wiki_feedback (project_id, topic_id, feedback_type, comment) values ('${F.projects.a}', '${F.rows.wikiTopic}', 'helpful', 'RLS ' || $1::text)` },
  { table: 'wiki_questions', sql: `insert into public.wiki_questions (project_id, topic_id, question) values ('${F.projects.a}', '${F.rows.wikiTopic}', 'RLS ' || $1::text)` },
  // people 은 표 단위 INSERT 가 없고 세 컬럼만 열려 있다 — 그 컬럼으로 넣어 people_insert(워크스페이스 판정)를 태운다
  { table: 'people', sql: `insert into public.people (display_name, email, workspace_id) values ('RLS 침입', 'rls-probe-' || $1::text || '@example.com', '${F.ws}')` },
  // teams — 복사 insert(첫 행 = A 공용 팀 …d0)는 wsadmin_insert_teams 를, 이 탐침은 프로젝트 팀 분기(pa_insert_project_teams)를 태운다
  { table: 'teams', sql: `insert into public.teams (workspace_id, project_id, code, name) values ('${F.ws}', '${F.projects.a}', 'RLSX', 'RLS ' || $1::text)` },
]

/**
 * 0006 뒤 B 계정의 누설 목록 — 비어 있어야 한다. 0005 실측(개방 읽기 40 + 자기 이름 insert 6, bea 는 옛 app_role() 의
 * 'pmo_admin' 으로 A 회의록 폴더·하이라이트·첨부 쓰기 6 추가)은 커밋 7a0ae42·45a7c7d 의 이 파일 참조.
 */
export const KNOWN_LEAKS: Record<'bea' | 'ben', readonly string[]> = { bea: [], ben: [] }
