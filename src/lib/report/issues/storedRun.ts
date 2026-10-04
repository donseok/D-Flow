import {
  isIssueSourceType,
} from '@/lib/domain/issueAnalysis'
import type { IssueAreaRef } from '@/lib/domain/issueAreas'
import { ISSUE_MINUTE_SOURCE_KINDS } from '@/lib/domain/issueMinuteSource'
import {
  ISSUE_STATUSES,
  type IssueSeverity,
  type IssueStatus,
} from '@/lib/domain/issues'
import {
  DEFAULT_ISSUE_ANALYSIS_VOCAB,
  ISSUE_ANALYSIS_CAUSES_PER_ISSUE_MAX,
  ISSUE_ANALYSIS_DIRECT_CAUSE_MAX,
  ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX,
  ISSUE_ANALYSIS_MEGA_DEFINITION_MAX,
  ISSUE_ANALYSIS_ROOT_CAUSE_MAX,
  ISSUE_ANALYSIS_SCHEMA_VERSION,
  type IssueAnalysisAreaMajor,
  type IssueAnalysisAreaProcessDefinitions,
  type IssueAnalysisAreaSummary,
  type IssueAnalysisIssueCauseAnalysis,
  type IssueAnalysisMinuteSourceSnapshot,
  type IssueAnalysisOpportunity,
  type IssueAnalysisReport,
  type IssueAnalysisReportArea,
  type IssueAnalysisReportIssue,
  type IssueAnalysisVocab,
} from './model'
import { VOCAB_CODE_RE } from '@/lib/settings/vocab'

type JsonRecord = Record<string, unknown>

const record = (value: unknown): JsonRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null

const stringValue = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

const positiveInteger = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null
  return [...value]
}
function parseCountMap<T extends string>(
  value: unknown,
  keys: readonly T[],
): Record<T, number> | null {
  const object = record(value)
  if (!object) return null
  const result = {} as Record<T, number>
  for (const key of keys) {
    const count = object[key]
    if (!Number.isSafeInteger(count) || Number(count) < 0) return null
    result[key] = Number(count)
  }
  return result
}

function parseMinuteSource(value: unknown): IssueAnalysisMinuteSourceSnapshot | null {
  const object = record(value)
  if (!object) return null
  const id = nonEmpty(object.id)
  const minuteId = nonEmpty(object.minuteId)
  const minuteVersionId = nonEmpty(object.minuteVersionId)
  const minuteVersionNo = positiveInteger(object.minuteVersionNo)
  const minuteTitle = stringValue(object.minuteTitle)
  const minuteDate = stringValue(object.minuteDate)
  const excerpt = stringValue(object.excerpt)
  const kind = object.kind
  if (
    !id
    || !minuteId
    || !minuteVersionId
    || minuteVersionNo === null
    || minuteTitle === null
    || minuteDate === null
    || excerpt === null
    || typeof kind !== 'string'
    || !(ISSUE_MINUTE_SOURCE_KINDS as readonly string[]).includes(kind)
  ) return null
  return {
    id,
    minuteId,
    minuteVersionId,
    minuteVersionNo,
    minuteTitle,
    minuteDate,
    excerpt,
    kind: kind as IssueAnalysisMinuteSourceSnapshot['kind'],
  }
}

function parseIssue(
  value: unknown,
  expectedAreaCode: string,
  areaId: string,
): IssueAnalysisReportIssue | null {
  const object = record(value)
  if (!object) return null
  const id = nonEmpty(object.id)
  const code = nonEmpty(object.code ?? object.piIssueCode)
  const title = nonEmpty(object.title)
  const body = nonEmpty(object.body)
  const subProcess = nonEmpty(object.subProcess)
  const ownerDepartment = nonEmpty(object.ownerDepartment)
  const relatedSystems = stringArray(object.relatedSystems)
  const assigneeMemberIds = stringArray(object.assigneeMemberIds)
  const status = object.status
  const severity = object.severity
  const source = record(object.source)
  // 0062 이전 저장본은 majorId 키 자체가 없다 — null과 동일하게 취급한다.
  let majorId: string | null = null
  if (Object.prototype.hasOwnProperty.call(object, 'majorId') && object.majorId !== null) {
    const parsedMajorId = nonEmpty(object.majorId)
    if (!parsedMajorId) return null
    majorId = parsedMajorId
  }
  if (
    !id
    || !code
    || (object.megaCode !== undefined && object.megaCode !== expectedAreaCode)
    || (object.areaId !== undefined && object.areaId !== areaId)
    || !title
    || !body
    || !subProcess
    || !ownerDepartment
    || !relatedSystems
    || !assigneeMemberIds
    || typeof status !== 'string'
    || !(ISSUE_STATUSES as readonly string[]).includes(status)
    || typeof severity !== 'string'
    || !VOCAB_CODE_RE.test(severity)   // 심각도는 설정 어휘(B4) — 기록된 code 를 받는다(지금 목록에 없어도 당시 값)
    || !source
  ) return null

  let manual: IssueAnalysisReportIssue['source']['manual'] = null
  if (source.manual !== null) {
    const manualObject = record(source.manual)
    if (
      !manualObject
      || !isIssueSourceType(manualObject.type)
      || typeof manualObject.detail !== 'string'
    ) return null
    manual = { type: manualObject.type, detail: manualObject.detail }
  }
  if (!Array.isArray(source.minutes)) return null
  const minutes = source.minutes.map(parseMinuteSource)
  if (minutes.some(item => item === null)) return null

  return {
    id,
    code,
    areaId,
    majorId,
    title,
    body,
    status: status as IssueStatus,
    severity: severity as IssueSeverity,
    subProcess,
    ownerDepartment,
    relatedSystems,
    assigneeMemberIds,
    source: {
      manual,
      minutes: minutes as IssueAnalysisMinuteSourceSnapshot[],
    },
  }
}

function parseSummary(
  value: unknown,
  issues: readonly IssueAnalysisReportIssue[],
): IssueAnalysisAreaSummary | null {
  const object = record(value)
  if (!object || object.totalCount !== issues.length) return null
  const statusCounts = parseCountMap(object.statusCounts, ISSUE_STATUSES)
  // 심각도 칸 = 저장된 키 전부(당시 프로젝트 어휘 — B4 이전은 high·medium·low). 이슈에 나온 code 는 반드시 있어야 하고 값은 이슈와 같아야 한다
  const severityRecord = record(object.severityCounts)
  const severityKeys = severityRecord ? Object.keys(severityRecord) : []
  const severityCounts = severityRecord && severityKeys.every(k => VOCAB_CODE_RE.test(k))
    && issues.every(issue => severityKeys.includes(issue.severity))
    ? parseCountMap(severityRecord, severityKeys)
    : null
  const ownerDepartments = stringArray(object.ownerDepartments)
  const relatedSystems = stringArray(object.relatedSystems)
  if (!statusCounts || !severityCounts || !ownerDepartments || !relatedSystems) return null

  const expectedStatuses = Object.fromEntries(
    ISSUE_STATUSES.map(status => [
      status,
      issues.filter(issue => issue.status === status).length,
    ]),
  ) as Record<IssueStatus, number>
  const expectedSeverities = Object.fromEntries(
    severityKeys.map(severity => [
      severity,
      issues.filter(issue => issue.severity === severity).length,
    ]),
  ) as Record<IssueSeverity, number>
  if (
    ISSUE_STATUSES.some(status => statusCounts[status] !== expectedStatuses[status])
    || severityKeys.some(severity => severityCounts[severity] !== expectedSeverities[severity])
  ) return null

  const expectedDepartments = [...new Set(issues.map(issue => issue.ownerDepartment))]
    .sort((a, b) => a.localeCompare(b, 'ko'))
  const expectedSystems = [...new Set(issues.flatMap(issue => issue.relatedSystems))]
    .sort((a, b) => a.localeCompare(b, 'ko'))
  if (
    JSON.stringify(ownerDepartments) !== JSON.stringify(expectedDepartments)
    || JSON.stringify(relatedSystems) !== JSON.stringify(expectedSystems)
  ) return null

  return {
    totalCount: issues.length,
    statusCounts,
    severityCounts,
    ownerDepartments,
    relatedSystems,
  }
}

function parseOpportunities(
  value: unknown,
  issues: readonly IssueAnalysisReportIssue[],
): IssueAnalysisOpportunity[] | null {
  if (!Array.isArray(value)) return null
  if ((issues.length === 0) !== (value.length === 0)) return null
  const validIds = new Set(issues.map(issue => issue.id))
  const covered = new Set<string>()
  const opportunities: IssueAnalysisOpportunity[] = []
  for (const raw of value) {
    const object = record(raw)
    const title = object && nonEmpty(object.title)
    const description = object && nonEmpty(object.description)
    if (
      !object
      || !title
      || title.length > 200
      || !description
      || description.length > 4_000
      || !Array.isArray(object.issueIds)
      || object.issueIds.length < 1
      || object.issueIds.length > 5
      || object.issueIds.some(id => typeof id !== 'string')
    ) return null
    const issueIds = object.issueIds as string[]
    if (
      new Set(issueIds).size !== issueIds.length
      || issueIds.some(id => !validIds.has(id))
    ) return null
    issueIds.forEach(id => covered.add(id))
    opportunities.push({ title, description, issueIds: [...issueIds] })
  }
  if (issues.some(issue => !covered.has(issue.id))) return null
  return opportunities
}

const UNSAFE_ANALYSIS_CONTROL_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u

function parseAreaMajors(value: unknown): IssueAnalysisAreaMajor[] | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>()
  const majors: IssueAnalysisAreaMajor[] = []
  let lastSeq = 0
  for (const raw of value) {
    const object = record(raw)
    const id = object && nonEmpty(object.id)
    const majorSeq = object ? positiveInteger(object.majorSeq) : null
    const name = object && nonEmpty(object.name)
    if (
      !object || !id || majorSeq === null || !name
      || name.length > 100
      || ids.has(id)
      // 체번(0062)은 결번 없는 오름차순 정본이다 — 흐트러진 저장본은 산출물로 쓰지 않는다.
      || majorSeq <= lastSeq
    ) return null
    ids.add(id)
    lastSeq = majorSeq
    majors.push({ id, majorSeq, name })
  }
  return majors
}

function parseProcessDefinitions(
  value: unknown,
  majors: readonly IssueAnalysisAreaMajor[],
): IssueAnalysisAreaProcessDefinitions | null {
  const object = record(value)
  const megaDefinition = object && nonEmpty(object.megaDefinition)
  if (
    !object || !megaDefinition
    || megaDefinition.length > ISSUE_ANALYSIS_MEGA_DEFINITION_MAX
    || UNSAFE_ANALYSIS_CONTROL_RE.test(megaDefinition)
    || !Array.isArray(object.majors)
    || object.majors.length !== majors.length
  ) return null
  const byId = new Map<string, string>()
  for (const raw of object.majors) {
    const item = record(raw)
    const majorId = item && nonEmpty(item.majorId)
    const definition = item && nonEmpty(item.definition)
    if (
      !item || !majorId || !definition
      || definition.length > ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX
      || UNSAFE_ANALYSIS_CONTROL_RE.test(definition)
      || byId.has(majorId)
    ) return null
    byId.set(majorId, definition)
  }
  if (majors.some(major => !byId.has(major.id))) return null
  return {
    megaDefinition,
    majors: majors.map(major => ({
      majorId: major.id,
      definition: byId.get(major.id) as string,
    })),
  }
}

function parseCauseAnalyses(
  value: unknown,
  issues: readonly IssueAnalysisReportIssue[],
  categoryCodes: readonly string[],
): IssueAnalysisIssueCauseAnalysis[] | null {
  if (!Array.isArray(value) || value.length !== issues.length) return null

  const validIds = new Set(issues.map(issue => issue.id))
  const byIssueId = new Map<string, IssueAnalysisIssueCauseAnalysis>()
  for (const rawAnalysis of value) {
    const analysis = record(rawAnalysis)
    const issueId = analysis && nonEmpty(analysis.issueId)
    if (
      !analysis
      || !issueId
      || !validIds.has(issueId)
      || byIssueId.has(issueId)
      || !Array.isArray(analysis.causes)
      || analysis.causes.length < 1
      || analysis.causes.length > ISSUE_ANALYSIS_CAUSES_PER_ISSUE_MAX
    ) return null

    const categories = new Set<string>()
    const causes: IssueAnalysisIssueCauseAnalysis['causes'] = []
    for (const rawCause of analysis.causes) {
      const cause = record(rawCause)
      const category = cause?.category
      const directCause = typeof cause?.directCause === 'string'
        ? cause.directCause.trim()
        : ''
      if (
        !cause
        || typeof category !== 'string'
        || !categoryCodes.includes(category)
        || categories.has(category)
        || !directCause
        || directCause.length > ISSUE_ANALYSIS_DIRECT_CAUSE_MAX
        || UNSAFE_ANALYSIS_CONTROL_RE.test(directCause)
      ) return null

      let rootCause: string | null
      if (cause.rootCause === null) {
        rootCause = null
      } else if (typeof cause.rootCause === 'string') {
        rootCause = cause.rootCause.trim()
        if (
          !rootCause
          || rootCause.length > ISSUE_ANALYSIS_ROOT_CAUSE_MAX
          || UNSAFE_ANALYSIS_CONTROL_RE.test(rootCause)
        ) return null
      } else {
        return null
      }

      categories.add(category)
      causes.push({
        category: category as IssueAnalysisIssueCauseAnalysis['causes'][number]['category'],
        directCause,
        rootCause,
      })
    }
    causes.sort((left, right) =>
      categoryCodes.indexOf(left.category)
      - categoryCodes.indexOf(right.category))
    byIssueId.set(issueId, { issueId, causes })
  }

  if (issues.some(issue => !byIssueId.has(issue.id))) return null
  return issues.map(issue => byIssueId.get(issue.id)!)
}

/** 분석 어휘 스냅샷 — 두 목록 모두 { code, label } 만, code 형식·유일, 라벨 비어 있지 않음. 원인 분류는 1개 이상 */
function parseVocabSnapshot(value: unknown): IssueAnalysisVocab | null {
  const object = record(value)
  if (!object || Object.keys(object).sort().join(',') !== 'causeCategories,sources') return null
  const list = (raw: unknown): Array<{ code: string; label: string }> | null => {
    if (!Array.isArray(raw)) return null
    const out: Array<{ code: string; label: string }> = []
    for (const item of raw) {
      const e = record(item)
      if (!e || Object.keys(e).sort().join(',') !== 'code,label') return null
      if (typeof e.code !== 'string' || !VOCAB_CODE_RE.test(e.code) || typeof e.label !== 'string' || !e.label.trim()) return null
      if (out.some(x => x.code === e.code)) return null
      out.push({ code: e.code, label: e.label })
    }
    return out
  }
  const causeCategories = list(object.causeCategories)
  const sources = list(object.sources)
  if (!causeCategories?.length || !sources) return null
  return { causeCategories, sources }
}

/**
 * 다운로드는 브라우저가 보낸 분석 JSON을 신뢰하지 않고 DB의 저장 실행을 다시 읽는다.
 * 이 파서는 저장 JSON이 현재 v1 계약과 한 항목이라도 다르면 null로 거부한다.
 */
export function parseStoredIssueAnalysisReport(
  value: unknown,
  expectedProjectId: string | undefined,
  areaRefs: readonly IssueAreaRef[],
): IssueAnalysisReport | null {
  const object = record(value)
  const projectId = object && nonEmpty(object.projectId)
  const generatedAt = object && nonEmpty(object.generatedAt)
  if (
    !object
    || object.schemaVersion !== ISSUE_ANALYSIS_SCHEMA_VERSION
    || !projectId
    || (expectedProjectId !== undefined && projectId !== expectedProjectId)
    || !generatedAt
    || Number.isNaN(new Date(generatedAt).getTime())
    || !Number.isSafeInteger(object.issueCount)
    || Number(object.issueCount) < 1
    || !Array.isArray(object.areas)
  ) return null
  // 분석 어휘(B4) — 있으면 엄격히 읽고, 없으면 기본값(B4 이전·기본 어휘 실행)
  const hasVocab = Object.prototype.hasOwnProperty.call(object, 'vocab')
  const vocab = hasVocab ? parseVocabSnapshot(object.vocab) : DEFAULT_ISSUE_ANALYSIS_VOCAB
  if (!vocab) return null
  const causeCodes = vocab.causeCategories.map(e => e.code)

  const allIds = new Set<string>()
  const areas: IssueAnalysisReportArea[] = []
  const seenCodes = new Set<string>()
  for (const storedArea of object.areas) {
    const areaObject = record(storedArea)
    const areaCode = areaObject && nonEmpty(areaObject.areaCode ?? areaObject.megaCode)
    if (!areaObject || !areaCode || seenCodes.has(areaCode) || !Array.isArray(areaObject.issues)) return null
    seenCodes.add(areaCode)
    const expected = areaRefs.find(area => area.code === areaCode)
    const areaId = expected?.id ?? nonEmpty(areaObject.areaId) ?? `stored:${areaCode}`
    const areaName = expected?.name ?? areaCode
    if (!expected) console.warn('[issue-analysis] 저장 실행의 영역 코드가 현재 정본에 없음:', areaCode)
    const issues = areaObject.issues.map(issue => parseIssue(issue, areaCode, areaId))
    if (issues.some(issue => issue === null)) return null
    const typedIssues = issues as IssueAnalysisReportIssue[]
    if (typedIssues.some(issue => allIds.has(issue.id))) return null
    typedIssues.forEach(issue => allIds.add(issue.id))

    const hasMajors = Object.prototype.hasOwnProperty.call(areaObject, 'majors')
    const majors = hasMajors ? parseAreaMajors(areaObject.majors) : undefined
    if (hasMajors && majors === null) return null
    const majorIds = new Set((majors ?? []).map(major => major.id))
    if (typedIssues.some(issue =>
      issue.majorId !== null && !majorIds.has(issue.majorId))) return null

    const hasProcessDefinitions = Object.prototype.hasOwnProperty.call(
      areaObject,
      'processDefinitions',
    )
    if (hasProcessDefinitions && majors === undefined) return null
    const processDefinitions = hasProcessDefinitions
      ? parseProcessDefinitions(areaObject.processDefinitions, majors ?? [])
      : undefined
    if (hasProcessDefinitions && processDefinitions === null) return null

    const summary = parseSummary(areaObject.summary, typedIssues)
    const opportunities = parseOpportunities(areaObject.opportunities, typedIssues)
    const hasCauseAnalyses = Object.prototype.hasOwnProperty.call(
      areaObject,
      'causeAnalyses',
    )
    const causeAnalyses = hasCauseAnalyses
      ? parseCauseAnalyses(areaObject.causeAnalyses, typedIssues, causeCodes)
      : undefined
    if (!summary || !opportunities) return null
    if (hasCauseAnalyses && causeAnalyses === null) return null
    areas.push({
      areaId,
      areaCode,
      areaName,
      ...(majors === undefined || majors === null ? {} : { majors }),
      ...(processDefinitions === undefined || processDefinitions === null
        ? {}
        : { processDefinitions }),
      summary,
      issues: typedIssues,
      ...(causeAnalyses === undefined || causeAnalyses === null
        ? {}
        : { causeAnalyses }),
      opportunities,
    })
  }

  if (allIds.size !== Number(object.issueCount)) return null
  return {
    schemaVersion: ISSUE_ANALYSIS_SCHEMA_VERSION,
    projectId,
    issueCount: Number(object.issueCount),
    generatedAt,
    ...(hasVocab ? { vocab } : {}),
    areas: areas.sort((a, b) => (areaRefs.find(area => area.code === a.areaCode)?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (areaRefs.find(area => area.code === b.areaCode)?.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.areaCode.localeCompare(b.areaCode)),
  }
}
