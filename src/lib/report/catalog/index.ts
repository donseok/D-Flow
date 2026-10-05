/**
 * SP6 데이터 카탈로그 스키마, 경로 해석기, 값 서식화 (정본 §4.4.2·§4.5, 개정 §3.6.8·§4.5.2)
 */
import { formatPct1, formatPp1, round1 } from '@/lib/domain/format'
import { FormRenderError, type FormFormat, type FormKind, type Placeholder, type RenderMapping, type RenderOptions } from '../engine/types'
import type { CatalogFieldMeta, CatalogValueType } from './types'

export * from './types'

/** 사용자 정의 필드 키 정규식 (SP5c FIELD_KEY_RE 동일) */
export const CUSTOM_FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/

/* ============================================================================
 * 슬라이드 내장 토큰 (pptx 전용, 정본 §4.4.4)
 * ========================================================================== */
export const SLIDE_BUILTIN_FIELDS: Record<string, CatalogFieldMeta> = {
  'slide.page': { path: 'slide.page', type: 'int', description: '현재 슬라이드 페이지 번호' },
  'slide.page_count': { path: 'slide.page_count', type: 'int', description: '전체 슬라이드 페이지 수' },
  'slide.continuation': { path: 'slide.continuation', type: 'text', description: '연속 슬라이드 접미 표기 (options.continuation_label)' },
}

/* ============================================================================
 * 1. Weekly Catalog Schema (weekly_report_pptx, weekly_report_xlsx)
 * ========================================================================== */

const WEEKLY_SECTION_FIELDS: Record<string, CatalogFieldMeta> = {
  '.code': { path: '.code', type: 'text', description: '구분 코드' },
  '.name': { path: '.name', type: 'text', description: '구분 이름' },
  '.this_content': { path: '.this_content', type: 'list<text>', description: '금주 실적/내용 목록' },
  '.next_content': { path: '.next_content', type: 'list<text>', description: '차주 계획 목록' },
  '.this_issue': { path: '.this_issue', type: 'list<text>', description: '금주 이슈 목록' },
  '.next_issue': { path: '.next_issue', type: 'list<text>', description: '차주 이슈 목록' },
}

const WBS_GROUP_ITEM_FIELDS: Record<string, CatalogFieldMeta> = {
  '.title': { path: '.title', type: 'text', description: '그룹 제목' },
  '.num': { path: '.num', type: 'int', description: '그룹 번호' },
  '.lines': { path: '.lines', type: 'list<text>', description: '하위 항목 목록' },
}

const ISSUE_DETAIL_FIELDS: Record<string, CatalogFieldMeta> = {
  '.grade': { path: '.grade', type: 'text', description: '이슈 등급' },
  '.content': { path: '.content', type: 'text', description: '이슈 내용' },
  '.action': { path: '.action', type: 'text', description: '조치 계획' },
}

const MEETING_ITEM_FIELDS: Record<string, CatalogFieldMeta> = {
  '.date': { path: '.date', type: 'text', description: '회의 일자 (M/D)' },
  '.date_iso': { path: '.date_iso', type: 'date', description: '회의 일자 (YYYY-MM-DD)' },
  '.time': { path: '.time', type: 'text', description: '회의 시간' },
  '.title': { path: '.title', type: 'text', description: '회의명' },
  '.location': { path: '.location', type: 'text', description: '회의 장소' },
  '.attendee_count': { path: '.attendee_count', type: 'int', description: '참석자 수' },
}

const ANNOUNCEMENT_ITEM_FIELDS: Record<string, CatalogFieldMeta> = {
  '.date': { path: '.date', type: 'date', description: '공지 일자 (YYYY-MM-DD)' },
  '.title': { path: '.title', type: 'text', description: '공지 제목' },
}

const ATTENDANCE_ITEM_FIELDS: Record<string, CatalogFieldMeta> = {
  '.member_name': { path: '.member_name', type: 'text', description: '구성원 이름' },
  '.per_day': { path: '.per_day', type: 'list<text>', description: '요일별 근태 목록' },
  '.count': { path: '.count', type: 'int', description: '근태 합계' },
}

const PHASE_ITEM_FIELDS: Record<string, CatalogFieldMeta> = {
  '.name': { path: '.name', type: 'text', description: '단계명' },
  '.weight_pct': { path: '.weight_pct', type: 'pct1', description: '가중치 비율' },
  '.planned_pct': { path: '.planned_pct', type: 'pct1', description: '계획 공정율' },
  '.actual_pct': { path: '.actual_pct', type: 'pct1', description: '실적 공정율' },
  '.gap': { path: '.gap', type: 'pct1', description: '공정율 차이' },
  '.done_count': { path: '.done_count', type: 'int', description: '완료 항목 수' },
  '.total_count': { path: '.total_count', type: 'int', description: '전체 항목 수' },
  '.delayed_count': { path: '.delayed_count', type: 'int', description: '지연 항목 수' },
  '.status': { path: '.status', type: 'text', description: '상태 코드' },
  '.status_label': { path: '.status_label', type: 'text', description: '상태 라벨' },
}

const PLAN_ACTUAL_SUB_FIELDS: Record<string, CatalogFieldMeta> = {
  '.name': { path: '.name', type: 'text', description: '작업명' },
  '.owner_text': { path: '.owner_text', type: 'text', description: '담당자/팀명' },
  '.status_label': { path: '.status_label', type: 'text', description: '상태 라벨' },
  '.actual_pct': { path: '.actual_pct', type: 'pct1', description: '실적 공정율' },
}

const PLAN_ACTUAL_FIELDS: Record<string, CatalogFieldMeta> = {
  '.phase_name': { path: '.phase_name', type: 'text', description: '단계명' },
  '.planned_pct': { path: '.planned_pct', type: 'pct1', description: '계획 공정율' },
  '.actual_pct': { path: '.actual_pct', type: 'pct1', description: '실적 공정율' },
  '.prev_week': { path: '.prev_week', type: 'list<record>', description: '전주 작업 목록', recordFields: PLAN_ACTUAL_SUB_FIELDS },
  '.this_week': { path: '.this_week', type: 'list<record>', description: '금주 작업 목록', recordFields: PLAN_ACTUAL_SUB_FIELDS },
  '.next_week': { path: '.next_week', type: 'list<record>', description: '차주 작업 목록', recordFields: PLAN_ACTUAL_SUB_FIELDS },
}

const WORKLOAD_FIELDS: Record<string, CatalogFieldMeta> = {
  '.name': { path: '.name', type: 'text', description: '팀/담당자명' },
  '.per_day': { path: '.per_day', type: 'list<text>', description: '요일별 투입 목록' },
  '.total': { path: '.total', type: 'int', description: '투입 합계' },
  '.note': { path: '.note', type: 'text', description: '비고' },
}

const WBS_ROW_FIELDS: Record<string, CatalogFieldMeta> = {
  '.no': { path: '.no', type: 'int', description: '순번' },
  '.level_label': { path: '.level_label', type: 'text', description: '레벨 라벨' },
  '.depth': { path: '.depth', type: 'int', description: '트리 깊이' },
  '.name': { path: '.name', type: 'text', description: '작업명' },
  '.deliverable': { path: '.deliverable', type: 'text', description: '산출물' },
  '.owner_text': { path: '.owner_text', type: 'text', description: '담당자명' },
  '.weight_pct': { path: '.weight_pct', type: 'pct1', description: '가중치 비율' },
  '.planned_start': { path: '.planned_start', type: 'date', description: '계획 시작일' },
  '.planned_end': { path: '.planned_end', type: 'date', description: '계획 종료일' },
  '.planned_pct': { path: '.planned_pct', type: 'pct1', description: '계획 공정율' },
  '.actual_pct': { path: '.actual_pct', type: 'pct1', description: '실적 공정율' },
  '.gap': { path: '.gap', type: 'pct1', description: '공정율 차이' },
  '.delay_days': { path: '.delay_days', type: 'int', description: '지연 일수' },
  '.status': { path: '.status', type: 'text', description: '상태 코드' },
  '.status_label': { path: '.status_label', type: 'text', description: '상태 라벨' },
}

const AI_COMMENT_BLOCK_FIELDS: Record<string, CatalogFieldMeta> = {
  '.title': { path: '.title', type: 'text', description: '블록 제목' },
  '.lines': { path: '.lines', type: 'list<text>', description: '상세 문장 목록' },
}

const AI_COMMENT_FIELDS: Record<string, CatalogFieldMeta> = {
  '.left_title': { path: '.left_title', type: 'text', description: '좌측 제목' },
  '.right_title': { path: '.right_title', type: 'text', description: '우측 제목' },
  '.left': { path: '.left', type: 'list<record>', description: '좌측 AI 요약 블록 목록', recordFields: AI_COMMENT_BLOCK_FIELDS },
  '.right': { path: '.right', type: 'list<record>', description: '우측 AI 요약 블록 목록', recordFields: AI_COMMENT_BLOCK_FIELDS },
}

const WEEK_DAYS_FIELDS: Record<string, CatalogFieldMeta> = {
  '.date': { path: '.date', type: 'date', description: '근무일 일자 (YYYY-MM-DD)' },
  '.dow': { path: '.dow', type: 'int', description: 'ISO 요일 (1=월 … 7=일)' },
}

export const WEEKLY_CATALOG_FIELDS: Record<string, CatalogFieldMeta> = {
  // report.*
  'report.project_name': { path: 'report.project_name', type: 'text', description: '프로젝트 이름' },
  'report.week_label': { path: 'report.week_label', type: 'text', description: '보고서 주차 서식 라벨 (예: 2026년 7월 1주차 (6/29~7/3))' },
  'report.week_tag': { path: 'report.week_tag', type: 'text', description: '파일명용 주차 태그 (예: 7월1주차)' },
  'report.week_year': { path: 'report.week_year', type: 'int', description: '주차 기준 연도 (원자 토큰)' },
  'report.week_month': { path: 'report.week_month', type: 'int', description: '주차 기준 월 (원자 토큰)' },
  'report.week_ordinal': { path: 'report.week_ordinal', type: 'int', description: '해당 월의 주차 순번 (원자 토큰)' },
  'report.week_end': { path: 'report.week_end', type: 'date', description: '주차 기간 종료일 (YYYY-MM-DD, 포함)' },
  'report.week_days': { path: 'report.week_days', type: 'list<record>', description: '주차 표시 요일 목록', recordFields: WEEK_DAYS_FIELDS },
  'report.week_range': { path: 'report.week_range', type: 'text', description: '금주 표시 요일 범위 (예: 6/29~7/3)' },
  'report.prev_week_range': { path: 'report.prev_week_range', type: 'text', description: '전주 표시 요일 범위' },
  'report.next_week_range': { path: 'report.next_week_range', type: 'text', description: '차주 표시 요일 범위' },
  'report.week_start': { path: 'report.week_start', type: 'date', description: '주차 시작일 (주 키, YYYY-MM-DD)' },
  'report.today': { path: 'report.today', type: 'date', description: '기준일 (YYYY-MM-DD)' },
  'report.generated_at': { path: 'report.generated_at', type: 'text', description: '보고서 생성 일시' },
  'report.description': { path: 'report.description', type: 'text', description: '프로젝트 설명' },

  // kpi.*
  'kpi.plan': { path: 'kpi.plan', type: 'pct1', description: '계획 공정율 (%)' },
  'kpi.actual': { path: 'kpi.actual', type: 'pct1', description: '실적 공정율 (%)' },
  'kpi.variance': { path: 'kpi.variance', type: 'pp1', description: '공정율 편차 (%p)' },
  'kpi.total': { path: 'kpi.total', type: 'int', description: '전체 작업 수' },
  'kpi.done': { path: 'kpi.done', type: 'int', description: '완료 작업 수' },
  'kpi.in_progress': { path: 'kpi.in_progress', type: 'int', description: '진행중 작업 수' },
  'kpi.not_started': { path: 'kpi.not_started', type: 'int', description: '미착수 작업 수' },
  'kpi.delayed': { path: 'kpi.delayed', type: 'int', description: '지연 작업 수' },
  'kpi.done_this_week': { path: 'kpi.done_this_week', type: 'int', description: '금주 완료 작업 수' },
  'kpi.done_ratio': { path: 'kpi.done_ratio', type: 'pct1', description: '완료 비율 (%)' },
  'kpi.in_progress_ratio': { path: 'kpi.in_progress_ratio', type: 'pct1', description: '진행중 비율 (%)' },
  'kpi.delayed_ratio': { path: 'kpi.delayed_ratio', type: 'pct1', description: '지연 비율 (%)' },
  'kpi.phase_count': { path: 'kpi.phase_count', type: 'int', description: '전체 단계 수' },
  'kpi.total_leaves': { path: 'kpi.total_leaves', type: 'int', description: '전체 리프 작업 수' },

  // sections[]
  'sections': {
    path: 'sections',
    type: 'list<record>',
    description: '주간보고 구분(영역) 목록',
    recordFields: WEEKLY_SECTION_FIELDS,
    customEntity: 'weekly_row',
  },

  // wbs_groups
  'wbs_groups.prev': { path: 'wbs_groups.prev', type: 'list<record>', description: '전주 WBS 그룹 목록', recordFields: WBS_GROUP_ITEM_FIELDS },
  'wbs_groups.curr': { path: 'wbs_groups.curr', type: 'list<record>', description: '금주 WBS 그룹 목록', recordFields: WBS_GROUP_ITEM_FIELDS },

  // issues, events
  'issues': { path: 'issues', type: 'list<text>', description: '금주 주요 이슈 요약 줄 목록' },
  'issues_detail': { path: 'issues_detail', type: 'list<record>', description: '이슈 상세 목록', recordFields: ISSUE_DETAIL_FIELDS },
  'events': { path: 'events', type: 'list<text>', description: '주요 이벤트 목록' },

  // meetings
  'meetings.this_week': { path: 'meetings.this_week', type: 'list<record>', description: '금주 회의 목록', recordFields: MEETING_ITEM_FIELDS },
  'meetings.next_week': { path: 'meetings.next_week', type: 'list<record>', description: '차주 회의 목록', recordFields: MEETING_ITEM_FIELDS },
  'meetings.total': { path: 'meetings.total', type: 'int', description: '전체 회의 수' },

  // announcements
  'announcements.prev_week': { path: 'announcements.prev_week', type: 'list<record>', description: '전주 공지 목록', recordFields: ANNOUNCEMENT_ITEM_FIELDS },
  'announcements.this_week': { path: 'announcements.this_week', type: 'list<record>', description: '금주 공지 목록', recordFields: ANNOUNCEMENT_ITEM_FIELDS },

  // attendance
  'attendance.this_week': { path: 'attendance.this_week', type: 'list<record>', description: '금주 근태 목록', recordFields: ATTENDANCE_ITEM_FIELDS },
  'attendance.next_week': { path: 'attendance.next_week', type: 'list<record>', description: '차주 근태 목록', recordFields: ATTENDANCE_ITEM_FIELDS },

  // phases, plan_actual, workload, wbs_rows
  'phases': { path: 'phases', type: 'list<record>', description: '공정 진도 단계별 목록', recordFields: PHASE_ITEM_FIELDS },
  'plan_actual': { path: 'plan_actual', type: 'list<record>', description: '단계별 계획 대비 실적 목록', recordFields: PLAN_ACTUAL_FIELDS },
  'workload': { path: 'workload', type: 'list<record>', description: '팀별 투입 공수 목록', recordFields: WORKLOAD_FIELDS },
  'wbs_rows': { path: 'wbs_rows', type: 'list<record>', description: 'WBS 전체 행 목록', recordFields: WBS_ROW_FIELDS },

  // ai_comment
  'ai_comment': { path: 'ai_comment', type: 'list<record>', description: 'AI 브리핑 코멘트 슬라이드용 목록 (0 또는 1건)', recordFields: AI_COMMENT_FIELDS },
}

/* ============================================================================
 * 2. Issue Analysis Catalog Schema (issue_analysis_pptx)
 * ========================================================================== */

const CAUSE_FIELDS: Record<string, CatalogFieldMeta> = {
  '.category': { path: '.category', type: 'text', description: '원인 분류 코드' },
  '.category_label': { path: '.category_label', type: 'text', description: '원인 분류 라벨' },
  '.direct_cause': { path: '.direct_cause', type: 'text', description: '직접 원인' },
  '.root_cause': { path: '.root_cause', type: 'text', description: '근본 원인' },
}

const OPPORTUNITY_ISSUE_FIELDS: Record<string, CatalogFieldMeta> = {
  '.code': { path: '.code', type: 'text', description: '이슈 코드' },
  '.title': { path: '.title', type: 'text', description: '이슈 제목' },
}

const OPPORTUNITY_FIELDS: Record<string, CatalogFieldMeta> = {
  '.no': { path: '.no', type: 'int', description: '개선기회 번호' },
  '.title': { path: '.title', type: 'text', description: '개선기회 제목' },
  '.description': { path: '.description', type: 'text', description: '개선기회 설명' },
  '.issues': { path: '.issues', type: 'list<record>', description: '연계 이슈 목록', recordFields: OPPORTUNITY_ISSUE_FIELDS },
}

const ISSUE_FIELDS: Record<string, CatalogFieldMeta> = {
  '.code': { path: '.code', type: 'text', description: '이슈 코드' },
  '.title': { path: '.title', type: 'text', description: '이슈 제목' },
  '.body': { path: '.body', type: 'text', description: '이슈 본문' },
  '.sub_process': { path: '.sub_process', type: 'text', description: '세부 프로세스' },
  '.owner_department': { path: '.owner_department', type: 'text', description: '주관 부서' },
  '.status': { path: '.status', type: 'text', description: '이슈 상태 범주 (제품 고정)' },
  '.status_code': { path: '.status_code', type: 'text', description: '이슈 표시 상태 코드 (SP5b 설정)' },
  '.status_label': { path: '.status_label', type: 'text', description: '이슈 표시 상태 라벨' },
  '.severity': { path: '.severity', type: 'text', description: '심각도 코드' },
  '.severity_label': { path: '.severity_label', type: 'text', description: '심각도 라벨' },
  '.related_systems': { path: '.related_systems', type: 'list<text>', description: '관련 시스템 목록' },
  '.source_lines': { path: '.source_lines', type: 'list<text>', description: '원천 정보 줄 목록' },
  '.causes': { path: '.causes', type: 'list<record>', description: '원인 분석 목록', recordFields: CAUSE_FIELDS },
}

const SEVERITY_COUNT_FIELDS: Record<string, CatalogFieldMeta> = {
  '.code': { path: '.code', type: 'text', description: '심각도 코드' },
  '.label': { path: '.label', type: 'text', description: '심각도 라벨' },
  '.count': { path: '.count', type: 'int', description: '해당 심각도 이슈 건수' },
}

const AREA_FIELDS: Record<string, CatalogFieldMeta> = {
  '.code': { path: '.code', type: 'text', description: '영역 코드' },
  '.name': { path: '.name', type: 'text', description: '영역 이름' },
  '.summary.total_count': { path: '.summary.total_count', type: 'int', description: '영역 총 이슈 수' },
  '.summary.status.open': { path: '.summary.status.open', type: 'int', description: '미조치 이슈 수' },
  '.summary.status.in_progress': { path: '.summary.status.in_progress', type: 'int', description: '진행중 이슈 수' },
  '.summary.status.resolved': { path: '.summary.status.resolved', type: 'int', description: '해결완료 이슈 수' },
  '.summary.status.on_hold': { path: '.summary.status.on_hold', type: 'int', description: '보류 이슈 수' },
  '.summary.severity_counts': { path: '.summary.severity_counts', type: 'list<record>', description: '심각도별 집계 목록', recordFields: SEVERITY_COUNT_FIELDS },
  '.summary.owner_departments': { path: '.summary.owner_departments', type: 'list<text>', description: '주관 부서 목록' },
  '.summary.related_systems': { path: '.summary.related_systems', type: 'list<text>', description: '관련 시스템 목록' },
  '.issues': {
    path: '.issues',
    type: 'list<record>',
    description: '영역 소속 이슈 목록',
    recordFields: ISSUE_FIELDS,
    customEntity: 'issue',
  },
  '.opportunities': {
    path: '.opportunities',
    type: 'list<record>',
    description: '영역 소속 개선기회 목록',
    recordFields: OPPORTUNITY_FIELDS,
  },
}

const FLAT_ISSUE_FIELDS: Record<string, CatalogFieldMeta> = {
  ...ISSUE_FIELDS,
  '.area_code': { path: '.area_code', type: 'text', description: '소속 영역 코드' },
  '.area_name': { path: '.area_name', type: 'text', description: '소속 영역 이름' },
}

const FLAT_OPPORTUNITY_FIELDS: Record<string, CatalogFieldMeta> = {
  ...OPPORTUNITY_FIELDS,
  '.area_code': { path: '.area_code', type: 'text', description: '소속 영역 코드' },
  '.area_name': { path: '.area_name', type: 'text', description: '소속 영역 이름' },
}

export const ISSUE_ANALYSIS_CATALOG_FIELDS: Record<string, CatalogFieldMeta> = {
  // summary.*
  'summary.project_name': { path: 'summary.project_name', type: 'text', description: '프로젝트 이름' },
  'summary.author_name': { path: 'summary.author_name', type: 'text', description: '작성자 이름' },
  'summary.author_team': { path: 'summary.author_team', type: 'text', description: '작성자 대표 팀' },
  'summary.generated_at': { path: 'summary.generated_at', type: 'text', description: '분석서 생성 일시 (ISO)' },
  'summary.date_label': { path: 'summary.date_label', type: 'text', description: '표지 일자 표기 (예: 26.09.23)' },
  'summary.issue_count': { path: 'summary.issue_count', type: 'int', description: '전체 이슈 수' },
  'summary.area_count': { path: 'summary.area_count', type: 'int', description: '이슈가 있는 영역 수' },

  // areas[]
  'areas': {
    path: 'areas',
    type: 'list<record>',
    description: '영역별 분석 목록',
    recordFields: AREA_FIELDS,
  },

  // issues[] (평탄화)
  'issues': {
    path: 'issues',
    type: 'list<record>',
    description: '전체 이슈 평탄화 목록',
    recordFields: FLAT_ISSUE_FIELDS,
    customEntity: 'issue',
  },

  // opportunities[] (평탄화)
  'opportunities': {
    path: 'opportunities',
    type: 'list<record>',
    description: '전체 개선기회 평탄화 목록',
    recordFields: FLAT_OPPORTUNITY_FIELDS,
  },
}

/* ============================================================================
 * 3. WBS Export Catalog Schema (wbs_export_xlsx)
 * ========================================================================== */

const WBS_OWNER_FIELDS: Record<string, CatalogFieldMeta> = {
  '.team_code': { path: '.team_code', type: 'text', description: '담당 팀 코드' },
  '.team_name': { path: '.team_name', type: 'text', description: '담당 팀명' },
  '.kind': { path: '.kind', type: 'text', description: '담당 종류 (primary | support)' },
}

const WBS_ITEM_FIELDS: Record<string, CatalogFieldMeta> = {
  '.no': { path: '.no', type: 'int', description: '순번' },
  '.depth': { path: '.depth', type: 'int', description: '트리 깊이' },
  '.level_label': { path: '.level_label', type: 'text', description: '단계 라벨' },
  '.code': { path: '.code', type: 'text', description: 'WBS 항목 코드' },
  '.name': { path: '.name', type: 'text', description: '작업명' },
  '.deliverable': { path: '.deliverable', type: 'text', description: '산출물' },
  '.owner_text': { path: '.owner_text', type: 'text', description: '담당 팀/인원 텍스트' },
  '.owners': { path: '.owners', type: 'list<record>', description: '담당 팀 목록', recordFields: WBS_OWNER_FIELDS },
  '.weight_pct': { path: '.weight_pct', type: 'pct1', description: '가중치 (%)' },
  '.planned_pct': { path: '.planned_pct', type: 'pct1', description: '계획 공정율 (%)' },
  '.actual_pct': { path: '.actual_pct', type: 'pct1', description: '실적 공정율 (%)' },
  '.gap': { path: '.gap', type: 'pct1', description: '계획 실적 차이 (%p)' },
  '.planned_start': { path: '.planned_start', type: 'date', description: '계획 시작일 (YYYY-MM-DD)' },
  '.planned_end': { path: '.planned_end', type: 'date', description: '계획 종료일 (YYYY-MM-DD)' },
  '.delay_days': { path: '.delay_days', type: 'int', description: '지연 일수' },
  '.status': { path: '.status', type: 'text', description: '상태 코드' },
  '.status_label': { path: '.status_label', type: 'text', description: '상태 라벨' },
}

const WBS_TEAM_FIELDS: Record<string, CatalogFieldMeta> = {
  '.code': { path: '.code', type: 'text', description: '팀 코드' },
  '.name': { path: '.name', type: 'text', description: '팀 이름' },
  '.color': { path: '.color', type: 'text', description: '팀 색상 hex' },
}

const WBS_HOLIDAY_FIELDS: Record<string, CatalogFieldMeta> = {
  '.date': { path: '.date', type: 'date', description: '휴일 일자 (YYYY-MM-DD)' },
  '.name': { path: '.name', type: 'text', description: '휴일 명칭' },
}

export const WBS_EXPORT_CATALOG_FIELDS: Record<string, CatalogFieldMeta> = {
  // project.*
  'project.name': { path: 'project.name', type: 'text', description: '프로젝트 이름' },
  'project.start_date': { path: 'project.start_date', type: 'date', description: '프로젝트 시작일 (YYYY-MM-DD)' },
  'project.end_date': { path: 'project.end_date', type: 'date', description: '프로젝트 종료일 (YYYY-MM-DD)' },
  'project.level_labels': { path: 'project.level_labels', type: 'list<text>', description: 'WBS 단계별 라벨 목록' },

  // wbs_items[]
  'wbs_items': {
    path: 'wbs_items',
    type: 'list<record>',
    description: 'WBS 평탄화 항목 목록',
    recordFields: WBS_ITEM_FIELDS,
    customEntity: 'wbs_item',
  },

  // teams[]
  'teams': { path: 'teams', type: 'list<record>', description: '프로젝트 팀 목록', recordFields: WBS_TEAM_FIELDS },

  // holidays[]
  'holidays': { path: 'holidays', type: 'list<record>', description: '프로젝트 휴일 목록', recordFields: WBS_HOLIDAY_FIELDS },

  // kpi.* (weekly와 동일)
  'kpi.plan': { path: 'kpi.plan', type: 'pct1', description: '계획 공정율 (%)' },
  'kpi.actual': { path: 'kpi.actual', type: 'pct1', description: '실적 공정율 (%)' },
  'kpi.variance': { path: 'kpi.variance', type: 'pp1', description: '공정율 편차 (%p)' },
  'kpi.total': { path: 'kpi.total', type: 'int', description: '전체 작업 수' },
  'kpi.done': { path: 'kpi.done', type: 'int', description: '완료 작업 수' },
  'kpi.in_progress': { path: 'kpi.in_progress', type: 'int', description: '진행중 작업 수' },
  'kpi.not_started': { path: 'kpi.not_started', type: 'int', description: '미착수 작업 수' },
  'kpi.delayed': { path: 'kpi.delayed', type: 'int', description: '지연 작업 수' },
  'kpi.done_this_week': { path: 'kpi.done_this_week', type: 'int', description: '금주 완료 작업 수' },
  'kpi.done_ratio': { path: 'kpi.done_ratio', type: 'pct1', description: '완료 비율 (%)' },
  'kpi.in_progress_ratio': { path: 'kpi.in_progress_ratio', type: 'pct1', description: '진행중 비율 (%)' },
  'kpi.delayed_ratio': { path: 'kpi.delayed_ratio', type: 'pct1', description: '지연 비율 (%)' },
  'kpi.phase_count': { path: 'kpi.phase_count', type: 'int', description: '전체 단계 수' },
  'kpi.total_leaves': { path: 'kpi.total_leaves', type: 'int', description: '전체 리프 작업 수' },
}

/* ============================================================================
 * 4. Catalog Registry & Path Resolution
 * ========================================================================== */

export const CATALOG_REGISTRY: Record<FormKind, Record<string, CatalogFieldMeta>> = {
  weekly_report_pptx: WEEKLY_CATALOG_FIELDS,
  weekly_report_xlsx: WEEKLY_CATALOG_FIELDS,
  issue_analysis_pptx: ISSUE_ANALYSIS_CATALOG_FIELDS,
  wbs_export_xlsx: WBS_EXPORT_CATALOG_FIELDS,
}

/** 양식 종류의 카탈로그 메타 조회 */
export function getCatalogForKind(formKind: FormKind): Record<string, CatalogFieldMeta> {
  return CATALOG_REGISTRY[formKind]
}

export interface ResolvedCatalogPath {
  field: CatalogFieldMeta
  isCustom: boolean
  customKey?: string
}

/**
 * 둘러싼 블록의 scope 스택에서 가장 안쪽의 컨텍스트 레코드 메타를 탐색한다.
 * 매핑이 주어지면 블록 토큰의 매핑된 경로도 반영한다.
 */
function resolveEnclosingContext(
  formKind: FormKind,
  scope: readonly string[],
  mapping: RenderMapping = {},
): CatalogFieldMeta | undefined {
  if (scope.length === 0) return undefined
  const catalog = CATALOG_REGISTRY[formKind]
  let currentMeta: CatalogFieldMeta | undefined
  const currentScopeTokens: string[] = []

  for (const blockToken of scope) {
    currentScopeTokens.push(blockToken)
    const compositeScopeKey = currentScopeTokens.join('/')
    const mappedBlockPath = mapping[compositeScopeKey] ?? mapping[blockToken]

    // blockToken 예: '{{#slide areas}}', '{{#rows .issues}}', '{{#items wbs_groups.curr}}'
    const match = blockToken.match(/^\{\{\s*#([a-z_]+)\s+([^}\s]+)\s*\}\}$/)
    if (!match) continue
    const [, , rawBlockPath] = match
    const effectiveBlockPath = mappedBlockPath ?? rawBlockPath

    if (effectiveBlockPath.startsWith('.')) {
      if (currentMeta?.recordFields && currentMeta.recordFields[effectiveBlockPath]) {
        currentMeta = currentMeta.recordFields[effectiveBlockPath]
      } else {
        // 상대 경로 탐색 실패
        return undefined
      }
    } else {
      currentMeta = catalog[effectiveBlockPath]
    }
  }

  return currentMeta
}

/**
 * 카탈로그 경로 해석 순수 함수.
 * 절대 경로 및 블록 스코프 안의 상대 경로, 그리고 SP5c 사용자 정의 필드(custom.<key>)를 해석한다.
 */
export function resolveCatalogPath(
  formKind: FormKind,
  path: string,
  scope: readonly string[] = [],
  activeCustomKeys?: readonly string[],
  mapping: RenderMapping = {},
): ResolvedCatalogPath | null {
  const catalog = CATALOG_REGISTRY[formKind]

  // PPTX 내장 슬라이드 토큰 검사
  if (formKind.endsWith('_pptx') && SLIDE_BUILTIN_FIELDS[path]) {
    return { field: SLIDE_BUILTIN_FIELDS[path], isCustom: false }
  }

  // 1. 상대 경로 처리 ('.' 로 시작)
  if (path.startsWith('.')) {
    const enclosing = resolveEnclosingContext(formKind, scope, mapping)
    if (!enclosing) return null

    // 1-1. 스칼라 목록에서의 '{{.}}' 처리
    if (path === '.') {
      if (enclosing.type === 'list<text>') {
        return {
          field: { path: '.', type: 'text', description: '항목 텍스트 (스칼라)' },
          isCustom: false,
        }
      }
      return null
    }

    // 1-2. 사용자 정의 필드: '.custom.<key>'
    if (path.startsWith('.custom.')) {
      if (!enclosing.customEntity) return null
      const key = path.slice('.custom.'.length)
      if (!CUSTOM_FIELD_KEY_RE.test(key)) return null
      if (activeCustomKeys && !activeCustomKeys.includes(key)) return null

      // weekly_row는 그 구분 안 행 순서대로 list<text>, issue 및 wbs_item은 text (또는 list<text>)
      const valueType: CatalogValueType = enclosing.customEntity === 'weekly_row' ? 'list<text>' : 'text'
      return {
        field: {
          path,
          type: valueType,
          description: `사용자 정의 필드 (${key})`,
        },
        isCustom: true,
        customKey: key,
      }
    }

    // 1-3. 일반 상대 필드
    if (enclosing.recordFields && enclosing.recordFields[path]) {
      return { field: enclosing.recordFields[path], isCustom: false }
    }

    return null
  }

  // 2. 절대 경로 처리
  if (catalog[path]) {
    return { field: catalog[path], isCustom: false }
  }

  return null
}

/* ============================================================================
 * 5. Value Formatter (정본 §4.4.2 표)
 * ========================================================================== */

/**
 * 카탈로그 값을 양식 규약에 맞춰 서식화한다.
 */
export function formatCatalogValue(
  value: unknown,
  type: CatalogValueType,
  format: FormFormat,
  options?: Pick<RenderOptions, 'empty_text'>,
): unknown {
  const emptyText = options?.empty_text ?? ''

  // 빈 값 처리: null, undefined, '', 빈 배열
  if (value === null || value === undefined || value === '') {
    return emptyText
  }
  if (Array.isArray(value) && value.length === 0) {
    return emptyText
  }

  switch (type) {
    case 'text':
      return String(value)

    case 'int': {
      if (typeof value === 'number') {
        const rounded = Math.round(value)
        return format === 'xlsx' ? rounded : String(rounded)
      }
      const parsedInt = parseInt(String(value), 10)
      if (isNaN(parsedInt)) return emptyText
      return format === 'xlsx' ? parsedInt : String(parsedInt)
    }

    case 'pct1': {
      if (typeof value === 'number') {
        return format === 'xlsx' ? round1(value) : formatPct1(value)
      }
      const parsedPct = parseFloat(String(value))
      if (isNaN(parsedPct)) return emptyText
      return format === 'xlsx' ? round1(parsedPct) : formatPct1(parsedPct)
    }

    case 'pp1': {
      if (typeof value === 'number') {
        return format === 'xlsx' ? round1(value) : formatPp1(value)
      }
      const parsedPp = parseFloat(String(value))
      if (isNaN(parsedPp)) return emptyText
      return format === 'xlsx' ? round1(parsedPp) : formatPp1(parsedPp)
    }

    case 'date': {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const isoDate = value.slice(0, 10)
        return format === 'xlsx' ? new Date(`${isoDate}T00:00:00Z`) : isoDate
      }
      if (value instanceof Date && !isNaN(value.getTime())) {
        return format === 'xlsx' ? value : value.toISOString().slice(0, 10)
      }
      return String(value)
    }

    case 'list<text>': {
      if (Array.isArray(value)) {
        const filtered = value
          .filter(v => v !== null && v !== undefined && v !== '')
          .map(String)
        return filtered.length > 0 ? filtered.join('\n') : emptyText
      }
      return String(value)
    }

    case 'list<record>':
      throw new FormRenderError(
        'TYPE_MISMATCH',
        undefined,
        undefined,
        'Cannot format list<record> as a scalar value',
      )

    default:
      return String(value)
  }
}

/* ============================================================================
 * 6. Loader Detector (정본 §4.5.4)
 * ========================================================================== */

/**
 * 플레이스홀더 목록이 요구하는 데이터 루트 네임스페이스 및 커스텀 필드 로딩 여부를 감지한다.
 */
export function detectRequiredRoots(
  placeholders: readonly Placeholder[],
  mapping: RenderMapping = {},
): { roots: Set<string>; hasCustomFields: boolean } {
  const roots = new Set<string>()
  let hasCustomFields = false

  for (const p of placeholders) {
    const compositeKey = [...p.scope, p.token].join('/')
    const effectivePath = mapping[compositeKey] ?? mapping[p.token] ?? p.path

    if (effectivePath.includes('.custom.')) {
      hasCustomFields = true
    }

    if (effectivePath.startsWith('.')) {
      // 스코프의 최상위 블록 경로에서 루트를 추출
      if (p.scope.length > 0) {
        const topBlock = p.scope[0]
        const m = topBlock.match(/^\{\{\s*#[a-z_]+\s+([^.\s}]+)/)
        if (m) roots.add(m[1])
      }
    } else {
      const root = effectivePath.split('.')[0]
      if (root) roots.add(root)
    }
  }

  return { roots, hasCustomFields }
}
