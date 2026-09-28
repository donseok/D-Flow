// 카탈로그 메타(개정 §2.10) — 레지스트리를 런타임에 가볍게 두려고 소비처·테스트·상태를 옆 파일에 둔다. 상태 어휘: planned·stored·wired·verified.
// SP3a Phase A 는 키마다 마감 상태(스펙 §3.6 표)와 SP 를 적는다. Phase C 가 consumers·tests 경로를 채우고 catalog-sync 가 대조한다.
import type { SettingKey, SettingScope } from './registry'

export type CatalogStatus = 'planned' | 'stored' | 'wired' | 'verified'
export interface CatalogMeta { consumers: readonly string[]; tests: readonly string[]; status: CatalogStatus; sp: string }

const A = (status: CatalogStatus): CatalogMeta => ({ consumers: [], tests: [], status, sp: 'SP3a' })
export const CATALOG_META: Readonly<Record<SettingKey, CatalogMeta>> = {
  'modules.allowed': A('verified'), 'ai.enabled': A('verified'), 'invites.allowed_domains': A('verified'),
  'branding.product_name': A('stored'), 'branding.logo': A('stored'), 'branding.accent': A('stored'), 'branding.mail_from_name': A('verified'),
  'navigation.menu': A('stored'),
  'core.level_labels': A('verified'), 'core.extra_axis_label': A('stored'), 'core.milestone_keywords': A('verified'),
  'wbs.excel_profile': A('stored'), 'modules.enabled': A('verified'), 'workflow.stage_credits': A('wired'),
}

/** 카탈로그에만 있고 레지스트리에는 없는 키(개정 §2.6.1 "등록 시점") — 등록하는 SP 가 이 목록에서 빼고 defs 에 넣는다 */
export const PLANNED_KEYS: readonly { key: string; scope: SettingScope; sp: string; shape: string }[] = [
  { key: 'portal.widgets', scope: 'workspace', sp: 'SP3b', shape: '{ id: PortalWidgetId; enabled: boolean }[]' },
  { key: 'security.local_drafts', scope: 'workspace', sp: 'SPU1', shape: '{ allowed: boolean; retention_days: number }' },
  { key: 'calendar.timezone', scope: 'workspace', sp: 'SP5 Phase A', shape: 'IANA 시간대' },
  { key: 'calendar.working_days', scope: 'workspace', sp: 'SP5 Phase A', shape: 'number[](ISO 1~7)' },
  { key: 'calendar.week_start', scope: 'workspace', sp: 'SP5 Phase A', shape: "'sunday' | 'monday'" },
  { key: 'minutes.root_folders', scope: 'workspace', sp: 'SP5 Phase B', shape: "{ mode: 'teams' } | { mode: 'custom'; names: string[] }" },
  { key: 'minutes.attachments', scope: 'workspace', sp: 'SP5 Phase B', shape: '첨부 정책 객체' },
  { key: 'notify.policy', scope: 'workspace', sp: 'SP8', shape: '{ [type]: { enabled: boolean } }' },
  { key: 'workflow.issue_statuses', scope: 'project', sp: 'SP5b', shape: '{ code; label; color; category; sort; active }[]' },
  { key: 'workflow.wbs_stage_labels', scope: 'project', sp: 'SP5b', shape: 'Partial<Record<단계, string>>' },
  { key: 'workflow.approval_steps', scope: 'project', sp: 'SP5b', shape: '{ code; label; approver }[] 1~3' },
  { key: 'workflow.approval_distinct_approvers', scope: 'project', sp: 'SP5b', shape: 'boolean' },
  { key: 'workflow.predecessor_gate', scope: 'project', sp: 'SP5b', shape: "'reached' | 'final'" },
  { key: 'workflow.credit_policy', scope: 'project', sp: 'SP5b', shape: '{ step: 1 | 5; min_gap: 1..10 }' },
  { key: 'issues.id_policy', scope: 'project', sp: 'SP5 Phase B', shape: '{ prefix; pattern; counter_scope; reset }' },
  { key: 'issues.analysis', scope: 'project', sp: 'SP5 Phase B', shape: "'optional' | 'required'" },
  { key: 'issues.severities', scope: 'project', sp: 'SP5 Phase B', shape: '어휘 목록' },
  { key: 'issues.cause_categories', scope: 'project', sp: 'SP5 Phase B', shape: '어휘 목록' },
  { key: 'issues.sources', scope: 'project', sp: 'SP5 Phase B', shape: '어휘 목록' },
  { key: 'attendance.types', scope: 'project', sp: 'SP5 Phase B', shape: '어휘 목록' },
  { key: 'meetings.categories', scope: 'project', sp: 'SP5 Phase B', shape: '어휘 목록' },
  { key: 'calendar.timezone', scope: 'project', sp: 'SP5 Phase A', shape: 'IANA 시간대(seedFrom)' },
  { key: 'calendar.week_start', scope: 'project', sp: 'SP5 Phase A', shape: '규칙 목록 { day; from }[]' },
  { key: 'calendar.working_days', scope: 'project', sp: 'SP5 Phase A', shape: 'number[](seedFrom)' },
  { key: 'fields.wbs_item', scope: 'project', sp: 'SP5c', shape: 'FieldDef[]' },
  { key: 'fields.issue', scope: 'project', sp: 'SP5c', shape: 'FieldDef[]' },
  { key: 'fields.weekly_row', scope: 'project', sp: 'SP5c', shape: 'FieldDef[]' },
  { key: 'forms.weekly_report_pptx', scope: 'project', sp: 'SP6', shape: '{ template_id; mapping; options }' },
  { key: 'forms.weekly_report_xlsx', scope: 'project', sp: 'SP6', shape: '{ template_id; mapping; options }' },
  { key: 'forms.issue_analysis_pptx', scope: 'project', sp: 'SP6', shape: '{ template_id; mapping; options }' },
  { key: 'forms.wbs_export_xlsx', scope: 'project', sp: 'SP6', shape: '{ template_id; mapping; options }' },
  { key: 'minutes.auto_file_by_path', scope: 'project', sp: 'SP7', shape: 'boolean' },
  { key: 'minutes.attachments', scope: 'project', sp: 'SP5 Phase B', shape: '첨부 정책 객체(seedFrom)' },
  { key: 'views.default', scope: 'project', sp: 'SP3b', shape: "{ wbs: 'sheet'|'timeline'|'board'; density }" },
]

/** 개인 설정(개정 §2.8.5) — 개인 설정 저장소의 키. 저장 위치는 SP3b 스펙이 정한다(D32) */
export const PERSONAL_PREFS: readonly { key: string; desc: string }[] = [
  { key: 'theme', desc: '라이트·다크' }, { key: 'locale', desc: 'ko·en' }, { key: 'heroCollapsed', desc: '머리 접기' },
  { key: 'sidebarCollapsed', desc: '사이드바 접기' }, { key: 'dashSections', desc: '대시보드 구역' }, { key: 'minutesView', desc: '회의록 보기' },
  { key: 'minuteFontSize', desc: '회의록 글자 크기' }, { key: 'minutesExplorerLayout', desc: '회의록 탐색기 배치' }, { key: 'notifRead', desc: '읽은 알림' },
  { key: 'lastProjectId', desc: '마지막 프로젝트' }, { key: 'wbsHideDone', desc: 'WBS 완료 숨김' }, { key: 'wbsOutline', desc: 'WBS 아웃라인' },
  { key: 'wbsGanttScale', desc: '간트 축척' }, { key: 'notif', desc: '알림 토글' },
]
