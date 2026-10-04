import { chunkMarkdown } from '@/lib/ai/chunk'
import { embedDocuments } from '@/lib/ai/embeddings'
import { embedConfig } from '@/lib/ai/provider'
import { fnv1a64 } from '@/lib/minutes/blocks'
import { isRetryableReadError, nestedOne } from '@/lib/repositories/supabase/common'
import { isValidKnowledgeTimestamp } from './freshness'
import type { SupabaseKnowledgeClient } from './pgvector'
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  type ClaimedIndexJob,
  type IndexContentLoader,
  type IndexContentLoadResult,
  type IndexContentSnapshot,
  type KnowledgeDocumentInput,
} from './types'
import { rowLabel, visibleRows, type WeeklyArea } from '@/lib/domain/weeklySheet'
import { customSearchText, type CustomValues, type FieldDef, type FieldEntity } from '@/lib/domain/customFields'
import { getProjectConfig } from '@/lib/settings/projectConfig'

export const CURRENT_INDEX_VERSION = 1
export const INDEX_CHUNKER_VERSION = 'md1500-v1'

// 초대형 본문이 한 엔티티에서 청크 수백 개를 만들면 upsert 배치 상한(200)을 넘는다.
// 상한 초과분은 색인에서 잘라낸다(검색 실패보다 부분 색인이 낫다).
const MAX_CONTENT_CHARS = 120_000
const CHUNK_MAX = 1_500

type Row = Record<string, unknown>

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function safeDate(value: unknown): string | null {
  const raw = str(value)
  if (!raw) return null
  const date = raw.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function safeTimestamp(value: unknown): string | null {
  const raw = str(value)
  return raw && raw.length <= 64 && isValidKnowledgeTimestamp(raw) ? raw : null
}

function readError(errorCode: string, error: unknown): IndexContentLoadResult {
  return { ok: false, errorCode, retryable: isRetryableReadError(error) }
}

/** 조회 행의 프로젝트가 작업의 프로젝트와 다르면 내용 노출 전에 실패로 끊는다(fail-closed). */
function scopeMismatch(): IndexContentLoadResult {
  return { ok: false, errorCode: 'INDEX_CONTENT_SCOPE_MISMATCH', retryable: false }
}

function joinLines(lines: Array<string | null>): string {
  return lines.filter((line): line is string => Boolean(line && line.trim())).join('\n')
}

async function toSnapshot(input: {
  job: ClaimedIndexJob
  title: string
  text: string
  href: string
  team: string | null
  occurredOn: string | null
  sourceUpdatedAt: string | null
}): Promise<IndexContentSnapshot> {
  const text = input.text.slice(0, MAX_CONTENT_CHARS)
  const chunks = chunkMarkdown(text, CHUNK_MAX)
  // 임베딩 키가 없거나 일부 항목이 실패하면 embedding null — 키워드 검색 폴백은 유지된다(§14).
  const vectors = chunks.length ? await embedDocuments(chunks, 'RETRIEVAL_DOCUMENT') : []
  const contentHash = fnv1a64(text)
  const model = embedConfig().model
  const documents: KnowledgeDocumentInput[] = chunks.map((content, chunkNo) => ({
    projectId: input.job.projectId,
    domain: input.job.domain,
    entityType: input.job.entityType,
    entityId: input.job.entityId,
    chunkNo,
    indexVersion: CURRENT_INDEX_VERSION,
    title: input.title.trim().slice(0, 500),
    content,
    contentHash,
    href: input.href,
    team: input.team,
    occurredOn: input.occurredOn,
    updatedAt: input.sourceUpdatedAt,
    embeddingModel: model,
    embeddingDimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
    chunkerVersion: INDEX_CHUNKER_VERSION,
    embedding: vectors?.[chunkNo] ?? null,
  }))
  return { documents, sourceUpdatedAt: input.sourceUpdatedAt }
}

function primaryOwnerTeam(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const row = value as Row
    const team = nestedOne(row.teams as { code?: unknown } | { code?: unknown }[] | null)
    if (row.kind === 'primary' && typeof team?.code === 'string') return team.code
  }
  return null
}

function ownerLine(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null
  const teams = raw.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const row = value as Row
    const team = nestedOne(row.teams as { code?: unknown } | { code?: unknown }[] | null)
    return typeof team?.code === 'string' ? [team.code] : []
  })
  return teams.length ? `담당팀: ${[...new Set(teams)].join(', ')}` : null
}

async function loadSearchableCustomDefs(
  client: SupabaseKnowledgeClient,
  projectId: string | null | undefined,
  entity: FieldEntity,
): Promise<FieldDef[]> {
  if (!projectId) return []
  try {
    const config = await getProjectConfig(projectId, { client: client as never })
    const state = config.keys[`fields.${entity}` as const]
    if (state && (state.status === 'set' || state.status === 'default')) {
      const defs = state.value as FieldDef[]
      return (defs ?? []).filter(d => d.active && d.searchable)
    }
    return []
  } catch {
    return []
  }
}

async function loadWbsItem(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  const [wbsResult, customDefs] = await Promise.all([
    client.from('wbs_items')
      .select('id, project_id, code, name, biz, deliverable, planned_start, planned_end, actual_pct, updated_at, custom, item_owners(kind, teams(code))')
      .eq('id', job.entityId)
      .maybeSingle(),
    loadSearchableCustomDefs(client, job.projectId, 'wbs_item'),
  ])
  if (wbsResult.error) return readError('WBS_ITEMS_READ_FAILED', wbsResult.error)
  if (!wbsResult.data) return { ok: true, data: null }
  const row = wbsResult.data as Row
  if (row.project_id !== job.projectId || row.id !== job.entityId) return scopeMismatch()

  const code = str(row.code) ?? ''
  const name = str(row.name) ?? ''
  const pct = typeof row.actual_pct === 'number' && Number.isFinite(row.actual_pct)
    ? Math.round(row.actual_pct)
    : null
  const plannedStart = safeDate(row.planned_start)
  const plannedEnd = safeDate(row.planned_end)
  const customValues = (row.custom && typeof row.custom === 'object' ? row.custom : {}) as CustomValues
  const customLines = customSearchText(customDefs, customValues)
  const text = joinLines([
    `# WBS ${code} ${name}`.trim(),
    str(row.biz) ? `구분: ${str(row.biz)}` : null,
    str(row.deliverable) ? `산출물: ${str(row.deliverable)}` : null,
    plannedStart || plannedEnd ? `계획 기간: ${plannedStart ?? '미정'} ~ ${plannedEnd ?? '미정'}` : null,
    pct !== null ? `진행률: ${pct}%` : null,
    ownerLine(row.item_owners),
    customLines || null,
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: `${code} ${name}`.trim(),
      text,
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/wbs?focus=${encodeURIComponent(job.entityId)}`,
      team: primaryOwnerTeam(row.item_owners),
      occurredOn: plannedEnd ?? plannedStart,
      sourceUpdatedAt: safeTimestamp(row.updated_at),
    }),
  }
}

async function loadWeeklyReport(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  const reportResult = await client.from('weekly_reports')
    .select('id, project_id, week_start, title, updated_at')
    .eq('id', job.entityId)
    .maybeSingle()
  if (reportResult.error) return readError('WEEKLY_REPORT_READ_FAILED', reportResult.error)
  if (!reportResult.data) return { ok: true, data: null }
  const report = reportResult.data as Row
  if (report.project_id !== job.projectId) return scopeMismatch()

  // 행은 영역 id 로 묶인다(SP4) — 머리는 그 프로젝트 주간 영역의 이름, 순서는 시트와 같은 visibleRows(D32).
  // 지운 열(section·module·sort_order)을 고르면 열 drop 뒤 조회 전체가 42703 으로 실패한다(런타임에서만 드러난다).
  const [rowsResult, areasResult, customDefs] = await Promise.all([
    client.from('weekly_report_rows')
      .select('area_id, this_content, this_issue, next_content, next_issue, updated_at, custom')
      .eq('report_id', job.entityId)
      .eq('project_id', report.project_id),
    client.from('project_areas')
      .select('id, code, name, sort_order, active')
      .eq('project_id', report.project_id)
      .eq('kind', 'weekly_section'),
    loadSearchableCustomDefs(client, job.projectId, 'weekly_row'),
  ])
  if (rowsResult.error) return readError('WEEKLY_ROWS_READ_FAILED', rowsResult.error)
  if (areasResult.error) return readError('WEEKLY_AREAS_READ_FAILED', areasResult.error)
  const areas: WeeklyArea[] = (Array.isArray(areasResult.data) ? areasResult.data as Row[] : []).map(area => ({
    id: String(area.id),
    code: str(area.code) ?? '',
    name: str(area.name) ?? '',
    sortOrder: Number(area.sort_order) || 0,
    active: area.active !== false,
    teams: [],
  }))
  const rows = visibleRows((Array.isArray(rowsResult.data) ? rowsResult.data as Row[] : []).map(row => ({
    areaId: str(row.area_id) ?? '',
    thisContent: str(row.this_content) ?? '',
    thisIssue: str(row.this_issue) ?? '',
    nextContent: str(row.next_content) ?? '',
    nextIssue: str(row.next_issue) ?? '',
    custom: (row.custom && typeof row.custom === 'object' ? row.custom : {}) as CustomValues,
    updatedAt: row.updated_at,
  })), areas)

  const weekStart = safeDate(report.week_start)
  const lines: Array<string | null> = [`# 주간업무 ${weekStart ?? ''}`.trim()]
  let latest = safeTimestamp(report.updated_at)
  for (const row of rows) {
    const cells = [
      ['금주 업무', row.thisContent],
      ['금주 이슈', row.thisIssue],
      ['차주 업무', row.nextContent],
      ['차주 이슈', row.nextIssue],
    ].filter((cell): cell is [string, string] => Boolean(cell[1] && cell[1].trim()))
    const customText = customSearchText(customDefs, row.custom ?? {})
    if (!cells.length && !customText) continue
    lines.push(`## ${rowLabel(row, areas)}`)
    for (const [label, value] of cells) lines.push(`${label}: ${value.trim()}`)
    if (customText) lines.push(customText)
    const rowUpdated = safeTimestamp(row.updatedAt)
    // 멀티셀 편집은 행 단위로 갱신되므로 최신 시각은 보고서·행 전체의 max가 원본 시각이다.
    if (rowUpdated && (!latest || Date.parse(rowUpdated) > Date.parse(latest))) latest = rowUpdated
  }
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: `주간업무 ${weekStart ?? ''}`.trim(),
      text: joinLines(lines),
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/weekly?week=${encodeURIComponent(weekStart ?? '')}`,
      team: null,
      occurredOn: weekStart,
      sourceUpdatedAt: latest,
    }),
  }
}

async function loadMeeting(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  // 참석자·작성자 계정 정보는 개인 식별 위험이 있어 색인 본문에서 제외한다.
  const { data, error } = await client.from('meetings')
    .select('id, project_id, title, meeting_date, start_time, end_time, location, category, body, updated_at')
    .eq('id', job.entityId)
    .maybeSingle()
  if (error) return readError('MEETING_DETAIL_READ_FAILED', error)
  if (!data) return { ok: true, data: null }
  const row = data as Row
  if (row.project_id !== job.projectId) return scopeMismatch()

  const meetingDate = safeDate(row.meeting_date)
  const time = [str(row.start_time), str(row.end_time)].filter(Boolean).join('~')
  const text = joinLines([
    `# 회의 ${str(row.title) ?? ''}`.trim(),
    meetingDate ? `일시: ${meetingDate}${time ? ` ${time}` : ''}` : null,
    str(row.location) ? `장소: ${str(row.location)}` : null,
    str(row.category) ? `분류: ${str(row.category)}` : null,
    str(row.body),
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: str(row.title) ?? '회의',
      text,
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/meetings?focus=${encodeURIComponent(job.entityId)}`,
      team: null,
      occurredOn: meetingDate,
      sourceUpdatedAt: safeTimestamp(row.updated_at),
    }),
  }
}

async function loadAnnouncement(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  const { data, error } = await client.from('announcements')
    .select('id, project_id, title, body, category, publish_from, publish_to, created_at, updated_at')
    .eq('id', job.entityId)
    .maybeSingle()
  if (error) return readError('ANNOUNCEMENTS_READ_FAILED', error)
  if (!data) return { ok: true, data: null }
  const row = data as Row
  if (row.project_id !== job.projectId) return scopeMismatch()

  const publishFrom = safeDate(row.publish_from)
  const publishTo = safeDate(row.publish_to)
  const text = joinLines([
    `# 공지 ${str(row.title) ?? ''}`.trim(),
    str(row.category) ? `분류: ${str(row.category)}` : null,
    publishFrom || publishTo ? `게시 기간: ${publishFrom ?? '즉시'} ~ ${publishTo ?? '상시'}` : null,
    str(row.body),
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: str(row.title) ?? '공지',
      text,
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/announcements?focus=${encodeURIComponent(job.entityId)}`,
      team: null,
      occurredOn: publishFrom ?? safeDate(row.created_at),
      sourceUpdatedAt: safeTimestamp(row.updated_at) ?? safeTimestamp(row.created_at),
    }),
  }
}

async function loadIssue(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  const [issueResult, customDefs] = await Promise.all([
    client.from('issues')
      .select('id, project_id, code, title, body, status, severity, owner_department, sub_process, resolution_note, due_date, related_systems, created_at, updated_at, custom')
      .eq('id', job.entityId)
      .maybeSingle(),
    loadSearchableCustomDefs(client, job.projectId, 'issue'),
  ])
  if (issueResult.error) return readError('ISSUES_READ_FAILED', issueResult.error)
  if (!issueResult.data) return { ok: true, data: null }
  const row = issueResult.data as Row
  if (row.project_id !== job.projectId) return scopeMismatch()

  const code = str(row.code)
  if (!code) return readError('ISSUE_CODE_MISSING', new Error('이슈 코드가 없습니다.'))
  const title = str(row.title) ?? '이슈'
  const customValues = (row.custom && typeof row.custom === 'object' ? row.custom : {}) as CustomValues
  const customLines = customSearchText(customDefs, customValues)
  const text = joinLines([
    `# 이슈 ${code} ${title}`,
    str(row.status) ? `상태: ${str(row.status)}` : null,
    str(row.severity) ? `심각도: ${str(row.severity)}` : null,
    str(row.owner_department) ? `담당부서: ${str(row.owner_department)}` : null,
    str(row.sub_process) ? `하위 프로세스: ${str(row.sub_process)}` : null,
    safeDate(row.due_date) ? `기한: ${safeDate(row.due_date)}` : null,
    Array.isArray(row.related_systems) && row.related_systems.length > 0 ? `연관 시스템: ${row.related_systems.join(', ')}` : null,
    str(row.body),
    str(row.resolution_note) ? `조치: ${str(row.resolution_note)}` : null,
    customLines || null,
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: `${code} ${title}`,
      text,
      href: `/p/${encodeURIComponent(job.projectId ?? '')}/issues?focus=${encodeURIComponent(job.entityId)}`,
      team: str(row.owner_department),
      occurredOn: safeDate(row.created_at),
      sourceUpdatedAt: safeTimestamp(row.updated_at) ?? safeTimestamp(row.created_at),
    }),
  }
}

async function loadMinute(client: SupabaseKnowledgeClient, job: ClaimedIndexJob): Promise<IndexContentLoadResult> {
  // created_by(계정)·created_by_name(실명)·file_path(Storage 경로)는 select 자체에서 제외한다.
  const { data, error } = await client.from('minutes')
    .select('id, minute_date, team_code, title, body_md, project_id, archived_at, created_at, updated_at, meetings(project_id)')
    .eq('id', job.entityId)
    .maybeSingle()
  if (error) return readError('MINUTE_DETAIL_READ_FAILED', error)
  if (!data) return { ok: true, data: null }
  const row = data as Row
  // soft archive는 원본 삭제가 아니지만 검색 지식에서는 삭제와 같다. 이미 대기 중이던
  // 색인 job도 archived 원문을 다시 살리지 않고 기존 chunk를 제거하게 null로 반환한다.
  if (row.archived_at) return { ok: true, data: null }
  const meeting = nestedOne(row.meetings as { project_id?: unknown } | { project_id?: unknown }[] | null)
  const meetingProjectId = typeof meeting?.project_id === 'string' ? meeting.project_id : null
  const minuteProjectId = str(row.project_id) ?? meetingProjectId
  if (minuteProjectId !== job.projectId) return scopeMismatch()

  const minuteDate = safeDate(row.minute_date)
  const text = joinLines([
    `# 회의록 ${str(row.title) ?? ''}`.trim(),
    minuteDate ? `일자: ${minuteDate}` : null,
    str(row.team_code) ? `팀: ${str(row.team_code)}` : null,
    str(row.body_md),
  ])
  return {
    ok: true,
    data: await toSnapshot({
      job,
      title: str(row.title) ?? '회의록',
      text,
      href: `/minutes/${encodeURIComponent(job.entityId)}`,
      team: str(row.team_code),
      occurredOn: minuteDate,
      sourceUpdatedAt: safeTimestamp(row.updated_at) ?? safeTimestamp(row.created_at),
    }),
  }
}

/**
 * service-role 클라이언트 주입형 콘텐츠 로더 팩토리. 지원 엔티티 5종만 처리하며,
 * 미지원 유형은 삭제로 오인하지 않도록 명시적 실패를 반환한다(재시도 무의미 → dead-letter행).
 */
export function createSupabaseIndexContentLoader(client: SupabaseKnowledgeClient): IndexContentLoader {
  return async job => {
    switch (job.entityType) {
      case 'wbs_item': return loadWbsItem(client, job)
      case 'weekly_report': return loadWeeklyReport(client, job)
      case 'meeting': return loadMeeting(client, job)
      case 'announcement': return loadAnnouncement(client, job)
      case 'minute': return loadMinute(client, job)
      case 'issue': return loadIssue(client, job)
      default: return { ok: false, errorCode: 'INDEX_CONTENT_UNSUPPORTED', retryable: false }
    }
  }
}
