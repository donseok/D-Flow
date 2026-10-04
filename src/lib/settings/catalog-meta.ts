// 카탈로그 메타(개정 §2.10) — 레지스트리를 런타임에 가볍게 두려고 소비처·테스트·상태를 옆 파일에 둔다. 상태 어휘: planned·stored·wired·verified.
// 소비처는 설정값을 실제로 읽거나 표시하는 대표 진입점이다. 뒤 SP 가 소비를 배선하면 이 목록과 상태를 함께 갱신한다.
import type { SettingKey, SettingScope } from './registry'

export type CatalogStatus = 'planned' | 'stored' | 'wired' | 'verified'
export interface CatalogMeta { consumers: readonly string[]; tests: readonly string[]; status: CatalogStatus; sp: string }

const A = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP3a' })
const S5A = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 A' })
const S5B1 = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 B1' })
const S5B3 = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 B3' })
const S5B2 = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 B2' })
const S5B4 = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5 B4' })
const S5BW = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5b W' })
const S5BI = (status: CatalogStatus, consumers: string[], tests: string[]): CatalogMeta => ({ consumers, tests, status, sp: 'SP5b I' })
export const CATALOG_META: Readonly<Record<SettingKey, CatalogMeta>> = {
  'fields.wbs_item': { status: 'stored', sp: 'SP5c', consumers: ['src/components/settings/CustomFieldsSettings.tsx', 'supabase/migrations/0027_custom_fields.sql'], tests: ['tests/domain/custom-fields.test.ts', 'tests/rls/custom-fields.test.ts', 'tests/ui/custom-fields-settings.test.tsx'] },
  'fields.issue': { status: 'stored', sp: 'SP5c', consumers: ['src/components/settings/CustomFieldsSettings.tsx', 'supabase/migrations/0027_custom_fields.sql'], tests: ['tests/domain/custom-fields.test.ts', 'tests/rls/custom-fields.test.ts', 'tests/ui/custom-fields-settings.test.tsx'] },
  'fields.weekly_row': { status: 'stored', sp: 'SP5c', consumers: ['src/components/settings/CustomFieldsSettings.tsx', 'supabase/migrations/0027_custom_fields.sql'], tests: ['tests/domain/custom-fields.test.ts', 'tests/rls/custom-fields.test.ts', 'tests/ui/custom-fields-settings.test.tsx'] },
  'modules.allowed': A('verified', ['src/lib/modules/effective.ts', 'src/lib/settings/validateConfig.ts'], ['tests/modules/effective.test.ts', 'tests/settings/config-lifecycle.test.ts']),
  'ai.enabled': A('verified', ['src/lib/modules/aiAvailable.ts'], ['tests/modules/effective.test.ts']),
  'invites.allowed_domains': A('verified', ['src/lib/data/inviteDomains.ts'], ['tests/settings/workspace-config.test.ts', 'tests/domain/invites.test.ts']),
  'branding.product_name': A('stored', ['src/lib/settings/displayBranding.ts', 'src/lib/shell/loadShell.ts', 'src/components/app/BrandSlot.tsx', 'src/components/ui/BrandMark.tsx'], ['tests/settings/display-branding.test.ts', 'tests/shell/scope-layouts.test.tsx']),
  'branding.logo': A('stored', ['src/app/api/brand/[workspaceId]/[slot]/route.ts', 'src/lib/shell/loadShell.ts', 'src/components/app/BrandSlot.tsx', 'src/components/ui/BrandMark.tsx'], ['tests/settings/logo-upload.test.ts', 'tests/api/brand-route.test.ts', 'tests/shell/scope-layouts.test.tsx', 'tests/shell/brand.test.tsx']),
  'branding.accent': A('stored', ['src/components/settings/AccentEditor.tsx', 'src/lib/shell/loadShell.ts', 'src/lib/settings/accentCss.ts'], ['tests/settings/accent.test.ts', 'tests/shell/brand.test.tsx']),
  'branding.mail_from_name': A('verified', ['src/lib/mail/fromName.ts', 'src/lib/settings/displayBranding.ts'], ['tests/settings/display-branding.test.ts']),
  'navigation.menu': A('stored', ['src/components/settings/MenuOrderEditor.tsx', 'src/lib/shell/loadShell.ts'], ['tests/settings/registry.test.ts', 'tests/shell/scope-layouts.test.tsx']),
  'core.level_labels': A('verified', ['src/app/api/v1/wbs/structure/route.ts', 'src/lib/agent/wbsImport.ts'], ['tests/settings/project-config.test.ts', 'tests/settings/create-project.test.ts']),
  // SP4 A2 — 팀 예약어 파생(reservedTeamNames — 팀 추가·개명·가져오기 등록)이 읽는다. 표시 소비(엑셀 머리 등)는 아직 없어 stored 그대로
  'core.extra_axis_label': A('stored', ['src/app/actions/projectTeams.ts', 'src/app/api/import/execute/route.ts'], ['tests/settings/registry.test.ts', 'tests/actions/project-teams-actions.test.ts']),
  'core.milestone_keywords': A('verified', ['src/app/(app)/p/[projectId]/dashboard/page.tsx', 'src/lib/ai/tools/dashboard.ts'], ['tests/settings/default-keywords.test.ts', 'tests/settings/project-config.test.ts']),
  // SP4 — 표준 레이아웃(저장하지 않는다)·한 경로 내보내기·표기(D48)로 네 연결이 실물이다(개정 §6.1-3): ① 정의·이 행 ② 편집 = 임포트 마법사의
  // 저장(execute 의 양식 저장)·설정 화면의 '저장된 양식 비우기'(ClearExcelProfileButton — 레지스트리 widget, updateProjectSettings)·내보내기 표기
  // ③ 소비 = 내보내기·inspect·execute ④ 테스트(동등성·라우트). 편집 UI 칸은 실재 컴포넌트를 가리킨다(A2 최종 리뷰 완료 P2-3 — 옛 이름
  // ExcelProfilePanel 은 만들어진 적이 없다. catalog-sync 가 custom 컴포넌트의 실재를 본다)
  'wbs.excel_profile': {
    status: 'verified', sp: 'SP4',
    consumers: ['src/app/api/import/inspect/route.ts', 'src/app/api/export/route.ts', 'src/app/api/import/execute/route.ts', 'src/app/(app)/p/[projectId]/settings/page.tsx'],
    tests: ['tests/excel/standard-profile.test.ts', 'tests/api/export-route.test.ts'],
  },
  'modules.enabled': A('verified', ['src/lib/modules/effective.ts', 'src/app/(app)/p/[projectId]/settings/page.tsx'], ['tests/modules/effective.test.ts', 'tests/settings/config-lifecycle.test.ts']),
  'workflow.stage_credits': A('verified', ['src/components/settings/StageCreditSlider.tsx', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/settings/registry.test.ts', 'tests/domain/stage-credits.test.ts', 'tests/rls/workflow-policy.test.ts']),
  // SP5 A(스펙 D44) — 두 스코프 공용 키 이름(메타는 키 이름 하나 — 스코프별 소비처 (나) 꼴은 SP5 B 마감 판정). 워크스페이스 값의 소비처는
  // 새 프로젝트의 초기값(createProject 의 seedFrom — 상속 아님)과 워크스페이스 화면 달력(viewZone — merge 뒤 슬러그 워크스페이스), 프로젝트 값의
  // 소비처는 load.ts·주간·봇 도구 등이다. 과제 29 가 정의·편집(설정 화면 달력 절)·소비처·테스트 네 연결을 확인하고 verified 로 올렸다.
  // a6 리뷰 Q3 정정: data/usage.ts 는 p_timezone 을 받기만 하고 지금 호출부(/w/[slug]/usage)는 usageTimezone(null) = UTC 고정이다
  // (워크스페이스 필터는 SP8) — 소비처에서 뺐다. defs/project.ts 는 정의·편집 파일이라 소비처가 아니다(→ actions/project.ts 의 seedFrom)
  'calendar.timezone': S5A('verified',
    ['src/lib/calendar/load.ts', 'src/lib/settings/workspaceConfig.ts', 'src/app/(app)/p/[projectId]/weekly/page.tsx', 'src/lib/calendar/viewZone.ts', 'src/app/actions/project.ts'],
    ['tests/domain/calendar.test.ts', 'tests/rls/calendar-parity.test.ts', 'tests/calendar/load.test.ts', 'tests/components/time-display-zone.test.tsx', 'tests/scripts/bootstrap-timezone.test.ts'],
  ),
  'calendar.working_days': S5A('verified',
    ['src/lib/domain/calendar.ts', 'src/lib/calendar/load.ts', 'src/lib/domain/progress.ts', 'src/lib/calendar/viewZone.ts', 'src/app/actions/project.ts'],
    ['tests/domain/calendar.test.ts', 'tests/rls/calendar-parity.test.ts', 'tests/components/calendar-first-column.test.tsx', 'tests/settings/calendar-keys.test.ts'],
  ),
  'calendar.week_start': S5A('verified',
    ['src/lib/report/week.ts', 'src/app/actions/weekly.ts', 'src/lib/ai/tools/weekly.ts', 'src/lib/calendar/viewZone.ts', 'src/app/actions/project.ts'],
    ['tests/rls/week-start-transition.test.ts', 'tests/report/week.test.ts', 'tests/ai/bot-week-rules.test.ts', 'tests/actions/settings-week-start.test.ts'],
  ),
  // SP5 B1 — 정의·편집·소비처·검증이 이어졌다(스펙 D44)
  'issues.id_policy': S5B1('verified', ['src/lib/issues/context.ts', 'src/app/actions/issues.ts', 'src/components/settings/IssuePolicyEditor.tsx'], ['tests/issues/id-policy.test.ts', 'tests/rls/issue-code-policy.test.ts', 'tests/ui/issue-policy-editor.test.tsx']),
  'issues.analysis': S5B1('verified', ['src/lib/issues/rules.ts', 'src/app/actions/issues.ts', 'src/app/(app)/p/[projectId]/settings/page.tsx'], ['tests/issues/rules.test.ts', 'tests/actions/issue-entry-rules.test.ts', 'tests/rls/issue-areas.test.ts']),
  'minutes.attachments': S5B3('verified', ['src/lib/minutes/resolveAttachmentPolicy.ts', 'src/app/actions/minutes.ts', 'src/components/settings/AttachmentPolicyEditor.tsx'], ['tests/minutes/attachment-policy.test.ts', 'tests/rls/minute-attachments-policy.test.ts', 'tests/ui/attachment-policy-editor.test.tsx']),
  // SP5 B2 — create_team·ensure_team_roots(SQL)가 모드를 읽고, 외부 업로드·배치·재편철의 경로 정규화가 모드별로 갈린다(v2.9 — rootMode·folders).
  // 정의·편집(teams 되돌리기 — 플랫폼 관리자)·소비처·테스트 네 연결로 verified. 화면은 teams 만(D21)
  'minutes.root_folders': S5B2('verified', ['src/lib/minutes/rootMode.ts', 'src/lib/minutes/folders.ts', 'src/app/api/v1/minutes/route.ts', 'src/app/actions/teams.ts', 'src/app/actions/settings.ts', 'src/components/settings/RootFoldersEditor.tsx'], ['tests/minutes/root-folders.test.ts', 'tests/rls/minutes-teams.test.ts', 'tests/minutes/folder-path.test.ts', 'tests/minutes/external-api.test.ts', 'tests/ui/workspace-settings-page.test.tsx']),
  'attendance.types': S5B4('verified', ['src/components/attendance/AttendanceView.tsx', 'src/app/actions/attendance.ts', 'src/lib/report/weekly.ts', 'src/lib/ai/tools/attendance.ts', 'src/lib/ai/chat/router.ts', 'src/components/settings/VocabEditor.tsx'], ['tests/settings/vocab.test.ts', 'tests/rls/config-vocabulary.test.ts', 'tests/report/weekly.test.ts', 'tests/ai/chat-v2-router.test.ts', 'tests/ui/vocab-editor.test.tsx']),
  'meetings.categories': S5B4('verified', ['src/components/meetings/MeetingFormModal.tsx', 'src/components/meetings/MeetingCalendar.tsx', 'src/app/actions/meetings.ts', 'src/lib/data/meetings.ts', 'src/lib/minutes/meetings.ts', 'src/app/actions/meetingNotify.ts'], ['tests/settings/vocab.test.ts', 'tests/rls/config-vocabulary.test.ts', 'tests/minutes/external-api.test.ts', 'tests/ui/meeting-form-announce.test.tsx', 'tests/ui/vocab-editor.test.tsx']),
  'issues.severities': S5B4('verified', ['src/components/issues/IssuesView.tsx', 'src/components/issues/IssueModals.tsx', 'src/app/actions/issues.ts', 'src/lib/domain/issues.ts', 'src/lib/report/issues/model.ts', 'src/components/dashboard/IssueQueueCard.tsx'], ['tests/settings/vocab.test.ts', 'tests/rls/config-vocabulary.test.ts', 'tests/domain/issues.test.ts', 'tests/actions/vocab-migrate.test.ts', 'tests/ui/vocab-editor.test.tsx']),
  'issues.sources': S5B4('verified', ['src/components/issues/IssueModals.tsx', 'src/app/actions/issues.ts', 'src/lib/report/issues/deckPlan.ts', 'src/lib/report/issues/model.ts'], ['tests/settings/vocab.test.ts', 'tests/rls/config-vocabulary.test.ts', 'tests/report/issue-analysis-vocab.test.ts', 'tests/ui/vocab-editor.test.tsx']),
  // SP5b I — 정의·편집기(VocabEditor 범주 칸)·DB 트리거·소비처(목록·모달·이력)·테스트(골든 TS·SQL) 넷이 이어져 verified
  'workflow.issue_statuses': S5BI('verified', ['src/lib/domain/issueWorkflow.ts', 'src/app/actions/issues.ts', 'src/components/issues/IssuesView.tsx', 'src/components/issues/IssueModals.tsx', 'src/components/settings/VocabEditor.tsx', 'supabase/migrations/0025_issue_status_vocab.sql'], ['tests/domain/issue-workflow.test.ts', 'tests/rls/issue-workflow.test.ts', 'tests/actions/issues-gate.test.ts']),
  // SP5b W1 — 정의·SQL 판독(workflow_value_of·apply_workflow_event·guard_workflow_actual)·승인 액션까지. 화면 주입·설정 편집기는 W2, verified 는 Z
  'workflow.credit_policy': S5BW('verified', ['src/lib/settings/validateConfig.ts', 'src/components/settings/StageCreditSlider.tsx', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/domain/stage-credits.test.ts', 'tests/settings/registry.test.ts', 'tests/ui/workflow-settings-editors.test.tsx']),
  'workflow.wbs_stage_labels': S5BW('verified', ['src/components/wbs/StageLabelsProvider.tsx', 'src/lib/agent/predecessorGate.ts', 'src/components/settings/StageLabelsEditor.tsx'], ['tests/ui/stage-labels-injection.test.tsx', 'tests/ui/workflow-settings-editors.test.tsx', 'tests/settings/registry.test.ts']),
  'workflow.approval_steps': S5BW('verified', ['src/lib/domain/approvalSteps.ts', 'src/app/actions/agentWork.ts', 'src/app/actions/wbsAssign.ts', 'src/components/settings/ApprovalStepsEditor.tsx', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/domain/approval-steps.test.ts', 'tests/domain/approval-count.test.ts', 'tests/rls/workflow-policy.test.ts']),
  'workflow.approval_distinct_approvers': S5BW('verified', ['src/lib/domain/approvable.ts', 'src/components/settings/ApprovalStepsEditor.tsx', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/domain/approval-count.test.ts', 'tests/rls/workflow-policy.test.ts']),
  'workflow.predecessor_gate': S5BW('verified', ['src/lib/domain/agentWork.ts', 'src/lib/agent/predecessorGate.ts', 'src/lib/agent/depends.ts', 'supabase/migrations/0026_workflow_policy.sql'], ['tests/agent/predecessor-gate.test.ts', 'tests/agent/claim-gate-final.test.ts', 'tests/rls/workflow-policy.test.ts']),
  'issues.cause_categories': S5B4('verified', ['src/lib/ai/issue-analysis.ts', 'src/lib/report/issues/storedRun.ts', 'src/lib/report/issues/deckPlan.ts', 'src/app/actions/issueAnalysis.ts'], ['tests/settings/vocab.test.ts', 'tests/ai/issue-analysis.test.ts', 'tests/report/issue-analysis-stored-run.test.ts', 'tests/report/issue-analysis-vocab.test.ts']),
}

/** 카탈로그에만 있고 레지스트리에는 없는 키(개정 §2.6.1 "등록 시점") — 등록하는 SP 가 이 목록에서 빼고 defs 에 넣는다 */
export const PLANNED_KEYS: readonly { key: string; scope: SettingScope; sp: string; shape: string }[] = [
  { key: 'portal.widgets', scope: 'workspace', sp: 'SP3b', shape: '{ id: PortalWidgetId; enabled: boolean }[]' },
  { key: 'security.local_drafts', scope: 'workspace', sp: 'SPU1', shape: '{ allowed: boolean; retention_days: number }' },
  { key: 'notify.policy', scope: 'workspace', sp: 'SP8', shape: '{ [type]: { enabled: boolean } }' },
  { key: 'forms.weekly_report_pptx', scope: 'project', sp: 'SP6', shape: '{ template_id; mapping; options }' },
  { key: 'forms.weekly_report_xlsx', scope: 'project', sp: 'SP6', shape: '{ template_id; mapping; options }' },
  { key: 'forms.issue_analysis_pptx', scope: 'project', sp: 'SP6', shape: '{ template_id; mapping; options }' },
  { key: 'forms.wbs_export_xlsx', scope: 'project', sp: 'SP6', shape: '{ template_id; mapping; options }' },
  { key: 'minutes.auto_file_by_path', scope: 'project', sp: 'SP7', shape: 'boolean' },
  { key: 'views.default', scope: 'project', sp: 'SP3b', shape: "{ wbs: 'sheet'|'timeline'|'board'; density }" },
]

/** 개인 설정(개정 §2.8.5) — 계정 키는 계정 행, 워크스페이스 키는 그 워크스페이스의 개인 행(SP3b D9 — 키 목록의 정본은 prefs 의 split.ts).
 *  표 이름을 여기 적지 않는다 — 설정 해석기 쪽 파일은 개인 설정 저장소 이름을 원문에 두지 않는다(tests/settings/project-isolation) */
export const PERSONAL_PREFS: readonly { key: string; desc: string; scope: '계정' | '워크스페이스' }[] = [
  { key: 'theme', desc: '시스템·라이트·다크', scope: '계정' }, { key: 'locale', desc: 'ko·en', scope: '계정' },
  { key: 'sidebarCollapsed', desc: '사이드바 접기', scope: '계정' }, { key: 'dashSections', desc: '대시보드 구역', scope: '계정' },
  { key: 'minutesView', desc: '회의록 보기', scope: '계정' }, { key: 'minuteFontSize', desc: '회의록 글자 크기', scope: '계정' },
  { key: 'minutesExplorerLayout', desc: '회의록 탐색기 배치', scope: '계정' }, { key: 'wbsHideDone', desc: 'WBS 완료 숨김', scope: '계정' },
  { key: 'wbsOutline', desc: 'WBS 아웃라인', scope: '계정' }, { key: 'wbsGanttScale', desc: '간트 축척', scope: '계정' },
  { key: 'notif', desc: '알림 토글', scope: '계정' },
  { key: 'startPage', desc: '시작 화면', scope: '워크스페이스' }, { key: 'favoriteProjectIds', desc: '즐겨찾기 프로젝트(최대 20)', scope: '워크스페이스' },
  { key: 'recentProjects', desc: '최근 방문 프로젝트(최대 10)', scope: '워크스페이스' }, { key: 'notifRead', desc: '읽은 알림', scope: '워크스페이스' },
]
