/**
 * SP6 데이터 카탈로그 타입 정의 (정본 §4.5, 개정 §3.6.8·§4.5.2)
 *
 * 양식 종류(FormKind), 카탈로그 값 유형(CatalogValueType),
 * 각 form_kind별 카탈로그 모델 및 필드 스키마 정의를 담는다.
 */
import type { FormKind, FormFormat } from '../engine/types'

export type { FormKind, FormFormat }

/** 카탈로그 필드 타입 (정본 §4.4.2 표) */
export type CatalogValueType =
  | 'text'
  | 'int'
  | 'pct1'
  | 'pp1'
  | 'date'
  | 'list<text>'
  | 'list<record>'

/** 카탈로그 필드 노드 메타데이터 */
export interface CatalogFieldMeta {
  path: string
  type: CatalogValueType
  description: string
  /** list<record>일 때 하위 레코드의 필드 메타데이터 */
  recordFields?: Record<string, CatalogFieldMeta>
  /** 사용자 정의 필드(custom.<key>) 지원 여부 및 대상 엔티티 */
  customEntity?: 'weekly_row' | 'issue' | 'wbs_item'
}

/* ============================================================================
 * 1. Weekly Catalog Model (`weekly_report_pptx`, `weekly_report_xlsx`)
 * ========================================================================== */

export interface WeeklyCatalogReport {
  project_name: string
  week_label: string // '2026년 7월 1주차 (6/29~7/3)'
  week_tag: string   // '7월1주차'
  week_year: number
  week_month: number
  week_ordinal: number
  week_end: string   // 'YYYY-MM-DD'
  week_days: Array<{ date: string; dow: number }>
  week_range: string
  prev_week_range: string
  next_week_range: string
  week_start: string // 'YYYY-MM-DD'
  today: string      // 'YYYY-MM-DD'
  generated_at: string
  description: string
}

export interface WeeklyCatalogKpi {
  plan: number
  actual: number
  variance: number
  total: number
  done: number
  in_progress: number
  not_started: number
  delayed: number
  done_this_week: number
  done_ratio: number
  in_progress_ratio: number
  delayed_ratio: number
  phase_count: number
  total_leaves: number
}

export interface WeeklyCatalogSection {
  code: string
  name: string
  this_content: string[]
  next_content: string[]
  this_issue: string[]
  next_issue: string[]
  /** SP5c 사용자 정의 필드 (그 구분 안 행 순서대로 list<text>) */
  custom: Record<string, string[]>
}

export interface WeeklyCatalogWbsGroupItem {
  title: string
  num: number
  lines: string[]
}

export interface WeeklyCatalogIssueDetail {
  grade: string
  content: string
  action: string
}

export interface WeeklyCatalogMeetingItem {
  date: string
  date_iso: string
  time: string
  title: string
  location: string
  attendee_count: number
}

export interface WeeklyCatalogAnnouncementItem {
  date: string
  title: string
}

export interface WeeklyCatalogAttendanceItem {
  member_name: string
  per_day: string[]
  count: number
}

export interface WeeklyCatalogPhaseItem {
  name: string
  weight_pct: number
  planned_pct: number
  actual_pct: number
  gap: number
  done_count: number
  total_count: number
  delayed_count: number
  status: string
  status_label: string
}

export interface WeeklyCatalogPlanActualSubItem {
  name: string
  owner_text: string
  status_label: string
  actual_pct: number
}

export interface WeeklyCatalogPlanActualItem {
  phase_name: string
  planned_pct: number
  actual_pct: number
  prev_week: WeeklyCatalogPlanActualSubItem[]
  this_week: WeeklyCatalogPlanActualSubItem[]
  next_week: WeeklyCatalogPlanActualSubItem[]
}

export interface WeeklyCatalogWorkloadItem {
  name: string
  per_day: string[] | number[]
  total: number
  note: string
}

export interface WeeklyCatalogWbsRowItem {
  no: number
  level_label: string
  depth: number
  name: string
  deliverable: string
  owner_text: string
  weight_pct: number | null
  planned_start: string
  planned_end: string
  planned_pct: number
  actual_pct: number
  gap: number
  delay_days: number
  status: string
  status_label: string
}

export interface WeeklyCatalogAiCommentItem {
  left_title: string
  right_title: string
  left: Array<{ title: string; lines: string[] }>
  right: Array<{ title: string; lines: string[] }>
}

export interface WeeklyCatalogModel {
  report: WeeklyCatalogReport
  kpi: WeeklyCatalogKpi
  sections: WeeklyCatalogSection[]
  wbs_groups: {
    prev: WeeklyCatalogWbsGroupItem[]
    curr: WeeklyCatalogWbsGroupItem[]
  }
  issues: string[]
  issues_detail: WeeklyCatalogIssueDetail[]
  events: string[]
  meetings: {
    this_week: WeeklyCatalogMeetingItem[]
    next_week: WeeklyCatalogMeetingItem[]
    total: number
  }
  announcements: {
    prev_week: WeeklyCatalogAnnouncementItem[]
    this_week: WeeklyCatalogAnnouncementItem[]
  }
  attendance: {
    this_week: WeeklyCatalogAttendanceItem[]
    next_week: WeeklyCatalogAttendanceItem[]
  }
  phases: WeeklyCatalogPhaseItem[]
  plan_actual: WeeklyCatalogPlanActualItem[]
  workload: WeeklyCatalogWorkloadItem[]
  wbs_rows: WeeklyCatalogWbsRowItem[]
  ai_comment: WeeklyCatalogAiCommentItem[]
}

/* ============================================================================
 * 2. Issue Analysis Catalog Model (`issue_analysis_pptx`)
 * ========================================================================== */

export interface IssueAnalysisCatalogSummary {
  project_name: string
  author_name: string
  author_team: string
  generated_at: string
  date_label: string
  issue_count: number
  area_count: number
}

export interface IssueAnalysisCatalogCause {
  category: string
  category_label: string
  direct_cause: string
  root_cause: string
}

export interface IssueAnalysisCatalogOpportunityIssue {
  code: string
  title: string
}

export interface IssueAnalysisCatalogOpportunity {
  no: number
  title: string
  description: string
  issues: IssueAnalysisCatalogOpportunityIssue[]
  area_code?: string
  area_name?: string
}

export interface IssueAnalysisCatalogIssue {
  code: string
  title: string
  body: string
  sub_process: string
  owner_department: string
  status: string
  status_code: string
  status_label: string
  /** SP5c 사용자 정의 필드 */
  custom: Record<string, string | string[]>
  severity: string
  severity_label: string
  related_systems: string[]
  source_lines: string[]
  causes: IssueAnalysisCatalogCause[]
  area_code?: string
  area_name?: string
}

export interface IssueAnalysisCatalogArea {
  code: string
  name: string
  summary: {
    total_count: number
    status: {
      open: number
      in_progress: number
      resolved: number
      on_hold: number
    }
    severity_counts: Array<{ code: string; label: string; count: number }>
    owner_departments: string[]
    related_systems: string[]
  }
  issues: IssueAnalysisCatalogIssue[]
  opportunities: IssueAnalysisCatalogOpportunity[]
}

export interface IssueAnalysisCatalogModel {
  summary: IssueAnalysisCatalogSummary
  areas: IssueAnalysisCatalogArea[]
  /** 전 영역 평탄화 이슈 목록 */
  issues: IssueAnalysisCatalogIssue[]
  /** 전 영역 평탄화 개선기회 목록 */
  opportunities: IssueAnalysisCatalogOpportunity[]
}

/* ============================================================================
 * 3. WBS Export Catalog Model (`wbs_export_xlsx`)
 * ========================================================================== */

export interface WbsExportCatalogProject {
  name: string
  start_date: string
  end_date: string
  level_labels: string[]
}

export interface WbsExportCatalogOwner {
  team_code: string
  team_name: string
  kind: 'primary' | 'support'
}

export interface WbsExportCatalogItem {
  no: number
  depth: number
  level_label: string
  code: string
  name: string
  deliverable: string
  owner_text: string
  owners: WbsExportCatalogOwner[]
  weight_pct: number | null
  planned_pct: number
  actual_pct: number
  gap: number
  planned_start: string
  planned_end: string
  delay_days: number
  status: string
  status_label: string
  /** SP5c 사용자 정의 필드 */
  custom: Record<string, string | string[]>
}

export interface WbsExportCatalogTeam {
  code: string
  name: string
  color: string
}

export interface WbsExportCatalogHoliday {
  date: string
  name: string
}

export interface WbsExportCatalogModel {
  project: WbsExportCatalogProject
  wbs_items: WbsExportCatalogItem[]
  teams: WbsExportCatalogTeam[]
  holidays: WbsExportCatalogHoliday[]
  kpi: WeeklyCatalogKpi
}

/** 4종 양식 통합 카탈로그 모델 유니온 */
export type CatalogModel =
  | WeeklyCatalogModel
  | IssueAnalysisCatalogModel
  | WbsExportCatalogModel
