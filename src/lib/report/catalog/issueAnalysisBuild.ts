/**
 * 이슈 분석 카탈로그 (정본 §4.5.2·§4.5.4).
 * 로더는 loadSavedIssueAnalysisRun 한 묶음. 고정 슬라이드 삽입(§4.9)은 여기 없다.
 */
import type { IssueAreaRef } from '@/lib/domain/issueAreas'
import type { IssueStatus } from '@/lib/domain/issues'
import { t, type DictKey } from '@/lib/i18n/dict'
import {
  activeVocab,
  type CauseCategoryDef,
  type IssueStatusDef,
  type SeverityDef,
  type SourceDef,
} from '@/lib/settings/vocab'
import { ISSUE_ANALYSIS_OPPORTUNITY_CAPACITY } from '../issues/deckPlan'
import type { IssueAnalysisReport, IssueAnalysisReportIssue } from '../issues/model'
import type {
  IssueAnalysisCatalogArea,
  IssueAnalysisCatalogCause,
  IssueAnalysisCatalogIssue,
  IssueAnalysisCatalogModel,
  IssueAnalysisCatalogOpportunity,
} from './types'

const EMPTY_SUMMARY = {
  project_name: '',
  author_name: '',
  author_team: '',
  generated_at: '',
  date_label: '',
  issue_count: 0,
  area_count: 0,
}

/** 스캔 루트가 저장 실행을 요구하지 않을 때의 빈 모델. 없는 값을 채우지 않는다. */
export function emptyIssueAnalysisCatalog(): IssueAnalysisCatalogModel {
  return { summary: { ...EMPTY_SUMMARY }, areas: [], issues: [], opportunities: [] }
}

export interface IssueAnalysisCatalogInput {
  report: IssueAnalysisReport
  areas: readonly IssueAreaRef[]
  projectName: string
  authorName: string
  authorTeam: string
  timeZone: string
  severities: readonly SeverityDef[]
  sources: readonly SourceDef[]
  causeCategories: readonly CauseCategoryDef[]
  issueStatuses: readonly IssueStatusDef[]
}

function compact(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitDetail(value: string): string[] {
  return value.split(/\r?\n|[|;]/).map(compact).filter(Boolean)
}

/** 현 deckPlan.formatDateIn 의 YY.MM.DD. 타임존은 calendar.timezone. */
function dateLabel(value: string, timeZone: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('이슈 분석서 생성일시가 올바르지 않습니다.')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}.${get('month')}.${get('day')}`
}

function vocabRow<T extends { code: string; label: string }>(list: readonly T[], code: string, what: string): T {
  const row = list.find((entry) => entry.code === code)
  if (!row) throw new Error(`설정에 없는 ${what}입니다: ${code}`)
  return row
}

/**
 * 저장 실행은 범주만 담는다. 표시 상태 code 가 없으면 Issue.statusCode 생략 계약
 * (범주 code 와 같은 기본 상태)을 status_code 로 쓴다. 같은 code 의 행이 없고
 * 라벨이 비어 있으면 기본 4범주의 i18n `issue.status.<status>`.
 */
function statusFields(status: IssueStatus, statuses: readonly IssueStatusDef[]): {
  status: string
  status_code: string
  status_label: string
} {
  const row = statuses.find((entry) => entry.code === status)
  const stored = row?.label
  const status_label = stored == null || stored === ''
    ? t('ko', `issue.status.${status}` as DictKey)
    : stored
  return { status, status_code: status, status_label }
}

/** issueSourceLines. 원천 유형 줄은 issues.sources[].label. 회의록 줄은 제품 고정. */
function sourceLines(issue: IssueAnalysisReportIssue, sources: readonly SourceDef[]): string[] {
  const lines: string[] = []
  if (issue.source.manual) {
    lines.push(vocabRow(sources, issue.source.manual.type, '원천 유형').label)
    lines.push(...splitDetail(issue.source.manual.detail))
  }
  for (const source of issue.source.minutes) {
    const context = compact([source.minuteDate, source.minuteTitle].filter(Boolean).join(' '))
    lines.push(context ? `회의록 · ${context}` : '회의록')
  }
  return [...new Set(lines)]
}

function causesOf(
  issue: IssueAnalysisReportIssue,
  analyses: IssueAnalysisCatalogInput['report']['areas'][number]['causeAnalyses'],
  categories: readonly CauseCategoryDef[],
): IssueAnalysisCatalogCause[] {
  const analysis = analyses?.find((row) => row.issueId === issue.id)
  return (analysis?.causes ?? []).map((cause) => ({
    category: cause.category,
    category_label: vocabRow(categories, cause.category, '원인 분류').label,
    direct_cause: cause.directCause,
    root_cause: cause.rootCause ?? '추가 확인 필요',
  }))
}

function toIssue(
  issue: IssueAnalysisReportIssue,
  input: IssueAnalysisCatalogInput,
  analyses: IssueAnalysisCatalogInput['report']['areas'][number]['causeAnalyses'],
): IssueAnalysisCatalogIssue {
  return {
    code: issue.code,
    title: issue.title,
    body: issue.body,
    sub_process: issue.subProcess,
    owner_department: issue.ownerDepartment,
    ...statusFields(issue.status, input.issueStatuses),
    // 저장 JSON 은 issues.custom 을 싣지 않는다. 값을 만들지 않는다.
    custom: {},
    severity: issue.severity,
    severity_label: vocabRow(input.severities, issue.severity, '심각도').label,
    related_systems: [...issue.relatedSystems],
    source_lines: sourceLines(issue, input.sources),
    causes: causesOf(issue, analyses, input.causeCategories),
  }
}

function opportunitiesOf(
  area: IssueAnalysisCatalogInput['report']['areas'][number],
): Array<Omit<IssueAnalysisCatalogOpportunity, 'area_code' | 'area_name'>> {
  return area.opportunities.map((opportunity, index) => {
    if (opportunity.issueIds.length > ISSUE_ANALYSIS_OPPORTUNITY_CAPACITY) {
      throw new Error(`개선기회 연결 이슈는 최대 ${ISSUE_ANALYSIS_OPPORTUNITY_CAPACITY}건입니다.`)
    }
    const issues = opportunity.issueIds.map((id) => {
      const issue = area.issues.find((row) => row.id === id)
      if (!issue) throw new Error(`개선기회에 연결한 이슈를 찾을 수 없습니다: ${id}`)
      return { code: issue.code, title: issue.title }
    })
    return {
      no: index + 1,
      title: opportunity.title,
      description: opportunity.description,
      issues,
    }
  })
}

export function buildIssueAnalysisCatalog(input: IssueAnalysisCatalogInput): IssueAnalysisCatalogModel {
  const byId = new Map(input.areas.map((area) => [area.id, area]))
  const withIssues = input.report.areas.filter((area) => area.issues.length > 0)
  for (const area of withIssues) {
    if (!byId.has(area.areaId)) throw new Error(`이슈 영역을 찾을 수 없습니다: ${area.areaId}`)
  }
  const sorted = [...withIssues].sort((a, b) => {
    const left = byId.get(a.areaId)!
    const right = byId.get(b.areaId)!
    return left.sortOrder - right.sortOrder || left.code.localeCompare(right.code)
  })

  const areas: IssueAnalysisCatalogArea[] = []
  const flatIssues: IssueAnalysisCatalogIssue[] = []
  const flatOpportunities: IssueAnalysisCatalogOpportunity[] = []
  for (const area of sorted) {
    const ref = byId.get(area.areaId)!
    const issues = area.issues.map((issue) => toIssue(issue, input, area.causeAnalyses))
    const opportunities = opportunitiesOf(area)
    const counts = area.summary.statusCounts
    areas.push({
      code: ref.code,
      name: ref.name,
      summary: {
        total_count: area.summary.totalCount,
        status: {
          open: counts.open ?? 0,
          in_progress: counts.in_progress ?? 0,
          resolved: counts.resolved ?? 0,
          on_hold: counts.on_hold ?? 0,
        },
        severity_counts: activeVocab(input.severities).map((severity) => ({
          code: severity.code,
          label: severity.label,
          count: area.summary.severityCounts[severity.code] ?? 0,
        })),
        owner_departments: [...area.summary.ownerDepartments],
        related_systems: [...area.summary.relatedSystems],
      },
      issues,
      opportunities,
    })
    for (const issue of issues) {
      flatIssues.push({ ...issue, area_code: ref.code, area_name: ref.name })
    }
    for (const opportunity of opportunities) {
      flatOpportunities.push({ ...opportunity, area_code: ref.code, area_name: ref.name })
    }
  }

  return {
    summary: {
      project_name: input.projectName,
      author_name: input.authorName,
      author_team: input.authorTeam,
      generated_at: input.report.generatedAt,
      date_label: dateLabel(input.report.generatedAt, input.timeZone),
      issue_count: input.report.issueCount,
      area_count: areas.length,
    },
    areas,
    issues: flatIssues,
    opportunities: flatOpportunities,
  }
}
