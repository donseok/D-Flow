'use server'

// 회의록 → WBS 등록(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §4·§5). 이슈 등록(issues.ts 의 회의록 블록 흐름)의 쌍둥이다.
// 준비: 가드 → 모듈 관문 → 입력 → 원문 검증 → 읽기(세션 클라이언트 — RLS)·AI 한 번으로 줄 전부의 초안. 하나라도 못 읽으면 그 사유로 멈춘다.
// 등록: 가드 → 모듈 관문 → 입력 → 원문 검증 → 설정 깊이 → service_role RPC 한 번(N 줄 = 트랜잭션 하나, RPC 가 등급·부모·중복을 다시 본다).
// RPC 는 줄의 블록 index·hash·발췌·깊이 상한을 믿으므로 전부 서버가 검증한 원문과 설정에서 만든다 — 클라이언트 값은 싣지 않는다.
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth'
import { requireProjectAdmin, resolveProjectId } from '@/lib/authz'
import { ERR_ANON, ERR_MISSING } from '@/lib/authz/errors'
import { requireModule } from '@/lib/modules/gate'
import { aiAvailable } from '@/lib/modules/aiAvailable'
import { generateAnswer } from '@/lib/ai/llm'
import {
  MINUTE_WBS_DRAFT_SYSTEM_PROMPT, buildMinuteWbsDraftPrompt, parseMinuteWbsDraftResponse, type MinuteWbsAiRow,
} from '@/lib/ai/minute-wbs-draft'
import { cachedMinuteWbsDraft } from '@/lib/ai/minute-wbs-draft-cache'
import { enqueueIndexChange } from '@/lib/ai/index/enqueueChange'
import { getComputedWbs } from '@/lib/data/wbs'
import { personOf } from '@/lib/data/memberSelect'
import { fetchAllByKeyset } from '@/lib/data/paging'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { getProjectConfig, levelDepthOf } from '@/lib/settings/projectConfig'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'
import { ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'
import { emitNotification } from '@/lib/notify/emit'
import { minuteIssueSourceExcerpt, verifyMinuteIssueBlock, type VerifiedMinuteIssueBlock } from '@/lib/minutes/verifySource'
import { fnv1a64, minuteBlockDraftText, type MinuteBlock } from '@/lib/minutes/blocks'
import { INS_PRIORITY } from '@/lib/minutes/annotations'
import { minuteSelectionKeyHash } from '@/lib/minutes/selection'
import { makeMinuteIssueSourceKey, type MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import {
  MINUTE_WBS_LEAF_UNCONFIRMED, MINUTE_WBS_PROMPT_CANDIDATES_MAX, MINUTE_WBS_ROWS_MAX, MINUTE_WBS_SOURCE_KINDS, fallbackWbsName, pickableParents, recommendableParents,
  scoreParentCandidates, type MinuteWbsCreateRow, type MinuteWbsDraftRow, type MinuteWbsDrafts, type MinuteWbsParentOption,
  type MinuteWbsTreeRow, type WbsItemMinuteSource,
} from '@/lib/domain/minuteWbs'
import { outlineNumbers } from '@/lib/domain/wbsDerived'
import { wbsNameViolation } from '@/lib/domain/wbsValueRules'
import { isUuidLike, isValidIsoDate } from '@/lib/domain/validate'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import type { ComputedItem } from '@/lib/domain/types'
import { failWith, rpcFailure, tokenTable, type OwnTokenKeys } from '@/lib/errors/dbFail'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'

export type MinuteWbsDraftsResult = { ok: true; value: MinuteWbsDrafts } | { ok: false; error: string }
/** 거부의 code — 등록 RPC 의 토큰(MINUTE_WBS_LEAF_UNCONFIRMED 등). 창이 문구를 해석하지 않고 갈래를 판단한다. 토큰이 없는 거부에는 없다 */
export type MinuteWbsCreateResult = { ok: true; items: { row: number; itemId: string; code: string }[] } | { ok: false; error: string; row?: number; code?: string }
export type WbsItemMinuteSourcesResult = { ok: true; rows: WbsItemMinuteSource[] } | { ok: false; error: string }

/** 진행 중인 에이전트 주문 — 활성 유일 인덱스(agent_work_orders_active_per_item_uidx)·등록 RPC 의 WBS_PARENT_WORKFLOW 와 같은 집합 */
const ACTIVE_ORDER_STATUSES = ['ready', 'claimed', 'reported']
/** 프롬프트에 싣는 줄 원문 상한 — 빌더는 자르지 않는다(저장 발췌 상한 4,000 과 별개) */
const PROMPT_ROW_TEXT_MAX = 1_500
/** 줄마다 프롬프트 후보의 앞자리를 차지하는 결정형 상위 수 */
const PROMPT_SCORED_PER_ROW = 20
/** AI 에 주는 기존 작업명 예시 수(말단 작업 이름, 트리 순서) */
const EXAMPLE_NAMES_MAX = 20
/** 폴백 위치 추천 수(설계 §4.2) */
const FALLBACK_PARENTS_MAX = 3
/**
 * AI 출력 상한 — 줄 수를 따라 는다. 바닥은 4,096: thinking 토큰도 이 상한에 들어 1,200 일 때 답이 잘린 실측이 있다(llm.ts geminiGenerationConfig).
 * 줄마다 200 을 더하고 8,192(이슈 초안의 상한)에서 멈춘다 — 30줄 가까운 묶음에서 배열이 잘려 전부 결정형으로 떨어지지 않게
 */
const DRAFT_TOKENS_BASE = 4_096
const DRAFT_TOKENS_PER_ROW = 200
const DRAFT_TOKENS_MAX = 8_192
const draftTokenBudget = (rows: number): number => Math.min(DRAFT_TOKENS_MAX, DRAFT_TOKENS_BASE + DRAFT_TOKENS_PER_ROW * rows)
/** AI 초안 캐시 키의 판 — 프롬프트 모양(별칭 등)이 바뀌면 올린다 */
const DRAFT_CACHE_VERSION = 'minute-wbs-draft-v1'
/** 문단의 요약 라벨을 고르는 순서 — 할 일(액션)이 먼저, 그다음 요약 표시의 우선순위(위험 → 기한 → 결정) */
const LABEL_KINDS: readonly string[] = ['action', ...INS_PRIORITY.filter((kind) => kind !== 'action')]

/** 등록 RPC(create_wbs_items_from_minute)의 사유 토큰 → 문구. 표에 없는 것(MINUTE_WBS_ISOLATION·색인 날 23505 등)은 createFailed 다 */
const RPC_TOKENS: OwnTokenKeys = {
  MINUTE_WBS_ROWS_INVALID: { status: 400, code: 'MINUTE_WBS_ROWS_INVALID', key: 'srv.minuteWbs.rowsInvalid' },
  WBS_ACTOR_FORBIDDEN: { status: 403, code: 'WBS_ACTOR_FORBIDDEN', key: 'srv.minuteWbs.forbidden' },
  MINUTE_NOT_FOUND: { status: 404, code: 'MINUTE_NOT_FOUND', key: 'srv.minuteWbs.minuteNotFound' },
  MINUTE_ARCHIVED: { status: 409, code: 'MINUTE_ARCHIVED', key: 'srv.minuteWbs.minuteArchived' },
  MINUTE_PROJECT_MISMATCH: { status: 409, code: 'MINUTE_PROJECT_MISMATCH', key: 'srv.minuteWbs.minuteProjectMismatch' },
  MINUTE_VERSION_NOT_FOUND: { status: 404, code: 'MINUTE_VERSION_NOT_FOUND', key: 'srv.minuteWbs.versionNotFound' },
  MINUTE_BODY_STALE: { status: 409, code: 'MINUTE_BODY_STALE', key: 'srv.minuteWbs.bodyStale' },
  WBS_NAME_REQUIRED: { status: 400, code: 'WBS_NAME_REQUIRED', key: 'srv.minuteWbs.nameRequired' },
  WBS_NAME_TOO_LONG: { status: 400, code: 'WBS_NAME_TOO_LONG', key: 'srv.minuteWbs.nameTooLong' },
  WBS_PARENT_NOT_FOUND: { status: 404, code: 'WBS_PARENT_NOT_FOUND', key: 'srv.minuteWbs.parentNotFound' },
  WBS_PARENT_SUB_ACT: { status: 409, code: 'WBS_PARENT_SUB_ACT', key: 'srv.minuteWbs.parentSubAct' },
  WBS_PARENT_WORKFLOW: { status: 409, code: 'WBS_PARENT_WORKFLOW', key: 'srv.minuteWbs.parentWorkflow' },
  WBS_PARENT_DEPTH: { status: 409, code: 'WBS_PARENT_DEPTH', key: 'srv.minuteWbs.parentDepth' },
  [MINUTE_WBS_LEAF_UNCONFIRMED]: { status: 409, code: MINUTE_WBS_LEAF_UNCONFIRMED, key: 'srv.minuteWbs.parentLeafUnconfirmed' },
  WBS_DATE_RANGE_INVALID: { status: 400, code: 'WBS_DATE_RANGE_INVALID', key: 'srv.minuteWbs.dateRange' },
  WBS_ASSIGNEE_INVALID: { status: 400, code: 'WBS_ASSIGNEE_INVALID', key: 'srv.minuteWbs.assigneeInvalid' },
  MINUTE_BLOCK_ALREADY_LINKED: { status: 409, code: 'MINUTE_BLOCK_ALREADY_LINKED', key: 'srv.minuteWbs.alreadyLinked' },
}

type Session = Awaited<ReturnType<typeof createServerClient>>
type Fail = { ok: false; error: string; row?: number }
type Loaded<T> = { ok: true; value: T } | { ok: false; error: string }
type Verified = VerifiedMinuteIssueBlock

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isUuidText = (v: unknown): v is string => typeof v === 'string' && isUuidLike(v)

/**
 * 원문 묶음 — 줄마다 manual·action 만(등록 RPC 의 source_kind. risk 는 WBS 연결에 없다)·회의록 id 와 버전 id 는 uuid 꼴(RPC 인자가 uuid 다),
 * 그리고 모두 같은 회의록·버전·본문. 원문의 나머지 모양(앵커·선택)은 verifyMinuteIssueBlock 이 본다.
 */
function sourceProblem(t: ServerTranslate, sources: readonly unknown[]): Fail | null {
  for (const [row, source] of sources.entries()) {
    if (!isRecord(source) || !(MINUTE_WBS_SOURCE_KINDS as readonly unknown[]).includes(source.kind)
        || !isUuidText(source.minuteId) || !isUuidText(source.minuteVersionId)) {
      return { ok: false, error: t('srv.issues.minutesSourceInformationNotValid'), row }
    }
  }
  const [head, ...rest] = sources as readonly MinuteIssueSourceInput[]
  const same = (s: MinuteIssueSourceInput) => s.minuteId === head.minuteId && s.minuteVersionId === head.minuteVersionId
    && String(s.bodyHash).toLowerCase() === String(head.bodyHash).toLowerCase()
  return rest.every(same) ? null : { ok: false, error: t('srv.minuteWbs.sourceMixed') }
}

/**
 * 줄마다 원문 검증(WBS 문구 갈래) + 제목 줄 거부. 회의록·버전 단위의 거부(보관·버전 없음·본문 바뀜 …)는 모든 줄이 같은 문구로 실패하므로
 * 그때는 줄을 가리키지 않는다 — 한 줄만 걸리면 그 줄 번호와 함께.
 */
async function verifyRows(
  t: ServerTranslate, projectId: string, workspaceId: string | undefined, sources: readonly MinuteIssueSourceInput[], logLabel: string, includeInsight: boolean,
): Promise<{ ok: true; values: Verified[] } | Fail> {
  const results = await Promise.all(sources.map((source) => verifyMinuteIssueBlock(projectId, workspaceId, source, logLabel, includeInsight, 'wbs')))
  const failed = results.flatMap((r, row) => (r.ok ? [] : [{ row, error: r.error }]))
  if (failed.length > 0) {
    const whole = failed.length === results.length && failed.every((f) => f.error === failed[0].error)
    return whole ? { ok: false, error: failed[0].error } : { ok: false, error: failed[0].error, row: failed[0].row }
  }
  const values = results.flatMap((r) => (r.ok ? [r.value] : []))
  // 제목 줄은 등록하지 않는다(이슈와 같은 규칙) — 선택 등록의 제목만 걸친 범위는 verifyMinuteIssueBlock 이 거부한다
  const heading = values.findIndex((v, i) => !sources[i].selection && v.block.headingDepth)
  if (heading >= 0) return { ok: false, error: t('srv.minuteWbs.headingBlock'), row: heading }
  return { ok: true, values }
}

/** 줄의 원문 — 선택 등록이면 검증된 선택 발췌, 아니면 블록 원문(이슈 등록의 발췌와 같은 선택) */
const rowText = (v: Verified): string => v.selectionExcerpt ?? minuteBlockDraftText(v.block)

/** 앞에서 max 자 — 서로게이트 쌍 가운데서 자르지 않는다 */
function clip(value: string, max: number): string {
  if (value.length <= max) return value
  const head = value.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head
}

/** 깊이 상한 = 단계 이름 수(levelDepthOf). 설정을 못 읽거나 단계 이름이 손상이면 등록하지 않는다 */
async function loadMaxDepth(t: ServerTranslate, projectId: string): Promise<Loaded<number>> {
  try {
    return { ok: true, value: levelDepthOf(await getProjectConfig(projectId)) }
  } catch (e) {
    return { ok: false, error: failWith('minuteWbs.config', e, t('srv.minuteWbs.configUnavailable')) }
  }
}

interface TreeFacts { rows: MinuteWbsTreeRow[]; numbers: ReadonlyMap<string, string>; dependencyCounts: ReadonlyMap<string, number>; exampleNames: string[] }
/**
 * 작업 계획 — 계산된 트리(세션) 하나에서 위치 후보의 재료를 다 꺼낸다: 트리 순서의 행, 표의 번호 열과 같은 개요 번호(outlineNumbers — WBS 표가
 * 같은 트리에 쓰는 계산), 선행·후행 연결 수(task_dependencies 를 끝까지 읽은 것 + 가져오기의 선행), 말단 작업 이름(예시).
 */
async function loadTree(t: ServerTranslate, projectId: string): Promise<Loaded<TreeFacts>> {
  try {
    const { items, dependencies } = await getComputedWbs(projectId)
    const rows: MinuteWbsTreeRow[] = []
    const leafNames: string[] = []
    const walk = (nodes: readonly ComputedItem[]) => {
      for (const n of nodes) {
        rows.push({
          id: n.id, parentId: n.parentId, name: n.name, isOwnerSplit: n.isOwnerSplit, actualPct: n.actualPct,
          assigneeMemberId: n.assigneeMemberId ?? null, devWorkflow: n.devWorkflow === true, depth: n.depth,
        })
        if (n.children.length === 0 && !n.isOwnerSplit) leafNames.push(n.name)
        walk(n.children)
      }
    }
    walk(items)
    const dependencyCounts = new Map<string, number>()
    for (const d of dependencies) {
      for (const id of [d.predecessorId, d.successorId]) dependencyCounts.set(id, (dependencyCounts.get(id) ?? 0) + 1)
    }
    return { ok: true, value: { rows, numbers: outlineNumbers(items), dependencyCounts, exampleNames: [...new Set(leafNames)].slice(0, EXAMPLE_NAMES_MAX) } }
  } catch (e) {
    return { ok: false, error: failWith('minuteWbs.tree', e, t('srv.minuteWbs.treeUnavailable')) }
  }
}

/** 진행 중인 에이전트 주문이 있는 항목 — 끝까지 읽는다(잘린 목록이면 주문 있는 작업이 후보로 보인다) */
async function loadActiveOrderItemIds(t: ServerTranslate, sb: Session, projectId: string): Promise<Loaded<ReadonlySet<string>>> {
  try {
    const rows = await fetchAllByKeyset<Record<string, unknown>>('[minuteWbs] agent_work_orders', (r) => String(r.id), (after, limit) => {
      const q = sb.from('agent_work_orders').select('id, wbs_item_id', { count: 'exact' })
        .eq('project_id', projectId).in('status', ACTIVE_ORDER_STATUSES)
      return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
    })
    return { ok: true, value: new Set(rows.flatMap((r) => (typeof r.wbs_item_id === 'string' ? [r.wbs_item_id] : []))) }
  } catch (e) {
    return { ok: false, error: failWith('minuteWbs.orders', e, t('srv.minuteWbs.treeUnavailable')) }
  }
}

/**
 * 담당자 후보 — 이 프로젝트의 활성 명단 행이면서 활성 인물(설계 §4.4). 등록 RPC(0061 의 WBS_ASSIGNEE_INVALID)·setWbsAssignee 의 선행 조회와
 * 같은 조건이다 — 명단 행만 활성인 비활성 인물을 후보로 내보이면 고른 뒤 등록이 그 줄에서 막힌다. 순서는 명단 화면과 같은 가나다순.
 */
async function loadMembers(t: ServerTranslate, sb: Session, projectId: string): Promise<Loaded<{ id: string; name: string }[]>> {
  const { data, error } = await sb.from('project_members')
    .select('id, active, people!inner(display_name, active)')
    .eq('project_id', projectId)
    .eq('active', true)
    .eq('people.active', true)
  if (error) return { ok: false, error: failWith('minuteWbs.roster', error, t('srv.minuteWbs.rosterUnavailable')) }
  // 두 조건을 응답에서도 다시 본다 — 임베드 필터가 빠진 응답이 비활성 인물을 후보로 내보내지 않게(fail-closed)
  const members = ((data ?? []) as Record<string, unknown>[]).flatMap((row) => {
    const person = personOf(row)
    return row.active === true && person !== null && person.active === true && typeof person.display_name === 'string'
      ? [{ id: String(row.id), name: person.display_name }] : []
  })
  return { ok: true, value: sortByKoreanName(members, (member) => member.name) }
}

type Registered = { itemId: string; code: string; name: string }
/** "등록됨" — 그 회의록·이 프로젝트의 연결을 문단 내용(block_hash)으로 묶어 처음 만든 작업을 보인다(버전이 달라도 — 설계 §5.6) */
async function loadRegistered(t: ServerTranslate, sb: Session, projectId: string, minuteId: string): Promise<Loaded<ReadonlyMap<string, Registered>>> {
  const { data, error } = await sb.from('wbs_item_links')
    .select('wbs_item_id, block_hash, wbs_items!wbs_item_links_item_project_fk(code, name)')
    .eq('minute_id', minuteId)
    .eq('project_id', projectId)
    .eq('link_type', 'minute_block')
    .order('created_at', { ascending: true })
  if (error) return { ok: false, error: failWith('minuteWbs.links', error, t('srv.minuteWbs.linksUnavailable')) }
  const byHash = new Map<string, Registered>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const raw = r.wbs_items as Record<string, unknown> | Record<string, unknown>[] | null
    const item = Array.isArray(raw) ? raw[0] : raw
    if (!item || typeof r.block_hash !== 'string' || byHash.has(r.block_hash)) continue
    byHash.set(r.block_hash, { itemId: String(r.wbs_item_id), code: String(item.code ?? ''), name: String(item.name ?? '') })
  }
  return { ok: true, value: byHash }
}

/** 같은 본문의 요약 항목 하나 — 문단(index·hash)·종류·라벨 */
type InsightLabel = { blockIndex: number; blockHash: string; kind: string; label: string }
type MinuteContext = { minuteDate: string; insights: InsightLabel[] }
/**
 * AI 가 날짜를 해석할 회의 날짜와 같은 본문(body_hash)의 요약 항목 — 「기한」은 날짜 재료(설계 §4.3), 나머지는 문단 등록 줄의 라벨(§4.1 —
 * 원문 검증은 action 이 아닌 줄의 라벨을 싣지 않는다). 한 번에 읽는다
 */
async function loadMinuteContext(t: ServerTranslate, sb: Session, head: MinuteIssueSourceInput, storedBodyHash: string): Promise<Loaded<MinuteContext>> {
  const [version, insights] = await Promise.all([
    sb.from('minute_versions').select('minute_date').eq('id', head.minuteVersionId).eq('minute_id', head.minuteId).maybeSingle(),
    sb.from('minute_insights').select('block_index, block_hash, kind, label').eq('minute_id', head.minuteId).eq('body_hash', storedBodyHash),
  ])
  const problem = version.error ?? insights.error ?? (version.data ? null : new Error('minute_versions 행 없음'))
  if (problem) return { ok: false, error: failWith('minuteWbs.minute', problem, t('srv.minuteWbs.minuteContextUnavailable')) }
  const rows = ((insights.data ?? []) as Record<string, unknown>[]).flatMap((r) =>
    (typeof r.label === 'string' && r.label.trim() && typeof r.kind === 'string'
      ? [{ blockIndex: Number(r.block_index), blockHash: String(r.block_hash ?? ''), kind: r.kind, label: r.label.trim() }]
      : []))
  return { ok: true, value: { minuteDate: String((version.data as Record<string, unknown>).minute_date ?? ''), insights: rows } }
}

/** 문단의 요약 라벨 — 같은 본문에서 그 문단(index·hash 가 모두 맞는)에 붙은 요약을 LABEL_KINDS 순서로. 없으면 null */
function blockLabelOf(insights: readonly InsightLabel[], block: MinuteBlock): string | null {
  for (const kind of LABEL_KINDS) {
    const hit = insights.find((i) => i.kind === kind && i.blockIndex === block.index && i.blockHash === block.hash)
    if (hit) return hit.label
  }
  return null
}

/** 프롬프트 후보 — 줄마다의 결정형 상위를 순위별로 번갈아 앞에 두고(줄마다 1순위부터), 남은 자리는 트리 순서로 채운다 */
function promptCandidatesOf(scored: readonly string[][], candidates: readonly MinuteWbsParentOption[]): MinuteWbsParentOption[] {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const picked = new Set<string>()
  const depth = Math.max(0, ...scored.map((ids) => ids.length))
  for (let rank = 0; rank < depth; rank += 1) {
    for (const ids of scored) if (ids[rank] !== undefined) picked.add(ids[rank])
  }
  for (const c of candidates) picked.add(c.id)
  return [...picked].slice(0, MINUTE_WBS_PROMPT_CANDIDATES_MAX).flatMap((id) => byId.get(id) ?? [])
}

/** AI 한 번 — 못 쓰는 응답(null·예외·못 읽음)은 null 이고 결정형 초안으로 간다. 출력 상한은 줄 수(allow.rowCount)를 따른다 */
async function draftWithAi(prompt: string, allow: Parameters<typeof parseMinuteWbsDraftResponse>[1]): Promise<MinuteWbsAiRow[] | null> {
  try {
    const raw = await generateAnswer(MINUTE_WBS_DRAFT_SYSTEM_PROMPT, [{ role: 'user', content: prompt }], {
      timeoutMs: 20_000, maxOutputTokens: draftTokenBudget(allow.rowCount), allowModelFallback: false, retries: 0, retryRateLimit: false,
    })
    if (raw === null) return null
    const parsed = parseMinuteWbsDraftResponse(raw, allow)
    if (parsed === null) console.error('[prepareMinuteWbsDrafts] AI 응답을 읽지 못함(결정형 초안 사용)')
    return parsed
  } catch (cause) {
    console.error('[prepareMinuteWbsDrafts] AI 초안 생성 실패(결정형 초안 사용):', cause instanceof Error ? cause.message : cause)
    return null
  }
}

/**
 * 등록 창의 초안 — 줄 전부의 작업명·위치 후보(≤3)·계획 종료일·담당자를 AI 한 번으로 채우고, 못 쓰는 줄은 결정형으로 채운다(mode).
 * 원문 문자열은 받지 않는다 — 불변 앵커만 받아 서버가 검증한 블록만 AI 입력·발췌로 쓴다. 읽기는 전부 세션 클라이언트(RLS)다.
 */
export async function prepareMinuteWbsDrafts(projectId: string, sources: MinuteIssueSourceInput[]): Promise<MinuteWbsDraftsResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'minutes')   // 회의록 → WBS — WBS 는 core 라 회의록 관문 하나. 꺼지면 원문·AI 앞에서 끝난다
  if (!mod.ok) return { ok: false, error: mod.error }
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > MINUTE_WBS_ROWS_MAX) return { ok: false, error: t('srv.minuteWbs.rowsInvalid') }
  const badSource = sourceProblem(t, sources)
  if (badSource) return { ok: false, error: badSource.error }
  const verified = await verifyRows(t, projectId, g.actor.projectWorkspace.get(projectId), sources, 'prepareMinuteWbsDrafts', true)
  if (!verified.ok) return { ok: false, error: verified.error }
  const values = verified.values

  const sb = await createServerClient()
  const [maxDepth, tree, orders, members, registered, context, llm] = await Promise.all([
    loadMaxDepth(t, projectId),
    loadTree(t, projectId),
    loadActiveOrderItemIds(t, sb, projectId),
    loadMembers(t, sb, projectId),
    loadRegistered(t, sb, projectId, sources[0].minuteId),
    loadMinuteContext(t, sb, sources[0], values[0].storedBodyHash),
    aiAvailable({ projectId }, { module: 'minutes' }),
  ])
  // 하나라도 못 읽으면 그 사유로 멈춘다 — 위치 후보·명단·"등록됨"을 빈 목록으로 그리지 않는다(에러 처리 3원칙 ①)
  if (!maxDepth.ok) return maxDepth
  if (!tree.ok) return tree
  if (!orders.ok) return orders
  if (!members.ok) return members
  if (!registered.ok) return registered
  if (!context.ok) return context

  const parents = pickableParents(tree.value.rows, {
    maxDepth: maxDepth.value, numbers: tree.value.numbers, activeOrderItemIds: orders.value, dependencyCounts: tree.value.dependencyCounts,
  })
  const candidates = recommendableParents(parents)
  const deadlines = context.value.insights.filter((i) => i.kind === 'deadline')
  const actionHashes = new Set<string>()
  const inputs = values.map((v, row) => {
    const source = sources[row]
    const text = rowText(v)
    // 문단 등록(manual)은 원문 검증이 라벨을 싣지 않는다 — 같은 본문의 그 문단 요약에서 찾는다(설계 §4.1). 선택 등록은 선택한 글이 원문이다
    const label = v.insightLabel ?? (source.selection ? null : blockLabelOf(context.value.insights, v.block))
    const fallbackName = fallbackWbsName(text, label)
    const last = source.selection ? source.selection.endBlockIndex : source.blockIndex
    const deadlineLabels = deadlines.filter((d) => d.blockIndex >= source.blockIndex && d.blockIndex <= last).map((d) => d.label)
    const registeredItem = registered.value.get(v.block.hash) ?? null
    // 한꺼번에(action) 줄 — 이미 등록된 문단(창이 회색으로 막는다)과 앞 줄과 같은 문단(같은 hash — 등록 RPC 가 둘째 줄을 막는다)은 다듬지 않는다.
    // 문단 등록(manual)은 등록된 문단이어도 다듬는다(「WBS로 하나 더 등록」)
    const duplicate = source.kind === 'action' && registeredItem === null && actionHashes.has(v.block.hash)
    if (source.kind === 'action') actionHashes.add(v.block.hash)
    return {
      row, v, text, label, fallbackName, registeredItem, duplicate,
      shell: source.kind === 'action' && (registeredItem !== null || duplicate),
      // 결정형 점수의 글 = 작업명 + 문단(설계 §4.2)
      scoreText: `${fallbackName}\n${text}`,
      deadlineLabel: deadlineLabels.length ? deadlineLabels.join(' / ') : null,
      // 문단 전체가 원천인데 여러 항목의 목록·표면 그 수 — 한 작업으로 묶인다는 안내(선택은 목록의 일부일 수 있어 싣지 않는다)
      listItems: !source.selection && (v.block.items ?? 0) >= 2 ? v.block.items : undefined,
    }
  })
  // 다듬을 줄 — AI 프롬프트·결정형 점수는 이 줄들만(줄 번호는 이 목록의 자리로 다시 매긴다)
  const drafted = inputs.filter((input) => !input.shell)
  const promptRowOf = new Map(drafted.map((input, at) => [input.row, at]))

  // AI 줄(프롬프트 자리 → 줄, 위치·담당자는 실제 id). 다듬을 줄이 없으면 부르지 않는다
  let aiByPromptRow: ReadonlyMap<number, MinuteWbsAiRow> = new Map()
  if (llm && drafted.length > 0) {
    const promptCandidates = promptCandidatesOf(drafted.map((input) => scoreParentCandidates(input.scoreText, candidates, PROMPT_SCORED_PER_ROW)), candidates)
    // 별칭 — uuid 대신 c1…·m1…(응답이 짧아져 큰 묶음도 출력 상한에 덜 걸린다). 응답은 별칭으로 읽고 이 요청의 실제 id 로 되돌린다
    const candidateIdOf = new Map(promptCandidates.map((c, at) => [`c${at + 1}`, c.id]))
    const memberIdOf = new Map(members.value.map((member, at) => [`m${at + 1}`, member.id]))
    const prompt = buildMinuteWbsDraftPrompt({
      minuteDate: context.value.minuteDate,
      rows: drafted.map((input, at) => ({ row: at, text: clip(input.text, PROMPT_ROW_TEXT_MAX), insightLabel: input.label, deadlineLabel: input.deadlineLabel })),
      candidates: promptCandidates.map((c, at) => ({ id: `c${at + 1}`, path: c.path, childNames: c.childNames })),
      members: members.value.map((member, at) => ({ id: `m${at + 1}`, name: member.name })),
      exampleNames: tree.value.exampleNames,
    })
    // 같은 프롬프트(줄 원문·후보·명단·회의 날짜)면 인스턴스 캐시의 별칭 줄을 쓴다(설계 §7) — AI 를 쓸 수 없을 때는 보지 않는다(이 갈래 밖)
    const cacheKey = [DRAFT_CACHE_VERSION, projectId, sources[0].minuteVersionId, fnv1a64(prompt)].join(':')
    const aliasRows = await cachedMinuteWbsDraft(cacheKey, () => draftWithAi(prompt, {
      rowCount: drafted.length, candidateIds: new Set(candidateIdOf.keys()), memberIds: new Set(memberIdOf.keys()),
    }))
    aiByPromptRow = new Map((aliasRows ?? []).map((r) => [r.row, {
      ...r,
      parentIds: r.parentIds.flatMap((alias) => candidateIdOf.get(alias) ?? []),
      assigneeMemberId: r.assigneeMemberId === null ? null : memberIdOf.get(r.assigneeMemberId) ?? null,
    }]))
  }
  // 칸 단위로 채운다 — AI 가 준 칸은 그대로 쓰고 빈 칸만 결정형으로: 줄이 없으면 통째로(이름·위치 상위 3, 종료일·담당자 없음), 이름이 비면
  // 이름만, 위치는 이름도 위치도 비었을 때만 결정형 상위 3(이름을 낸 AI 줄의 빈 위치는 "확신 없음"이라 그대로 둔다 — 화면이 마지막 위치를 쓴다).
  // AI 가 준 위치가 모두 후보 밖이었으면(parentsRejected) 그 줄의 위치도 결정형 상위 3
  const rows: MinuteWbsDraftRow[] = inputs.map((input) => {
    const base = {
      row: input.row,
      blockIndex: input.v.block.index,
      blockHash: input.v.block.hash,
      excerpt: minuteIssueSourceExcerpt(input.text),
      registered: input.registeredItem,
      ...(input.duplicate ? { duplicate: true } : {}),
      ...(input.listItems !== undefined ? { listItems: input.listItems } : {}),
    }
    // 다듬지 않은 줄(등록됨·같은 문단) — 창이 막는 줄이라 이름(결정형)만 싣는다
    if (input.shell) return { ...base, name: input.fallbackName, parentIds: [], plannedEnd: null, assigneeMemberId: null }
    const at = promptRowOf.get(input.row)
    const ai = at === undefined ? undefined : aiByPromptRow.get(at)
    const aiParents = ai && !ai.parentsRejected && (ai.name !== '' || ai.parentIds.length > 0) ? ai.parentIds : null
    return {
      ...base,
      name: ai?.name || input.fallbackName,
      parentIds: aiParents ?? scoreParentCandidates(input.scoreText, candidates, FALLBACK_PARENTS_MAX),
      plannedEnd: ai?.plannedEnd ?? null,
      assigneeMemberId: ai?.assigneeMemberId ?? null,
    }
  })
  // AI 가 한 칸이라도 채운 줄이 있으면 ai — 빈 줄만 돌아왔으면 결정형 초안과 같으므로 fallback(화면이 확인 안내를 띄운다).
  // 다듬을 줄이 하나도 없었으면 결정형 초안도 없다 — 안내를 띄우지 않는다(ai)
  const contributed = [...aiByPromptRow.values()].some((r) => r.name !== '' || r.parentIds.length > 0 || r.plannedEnd !== null || r.assigneeMemberId !== null)
  return { ok: true, value: { rows, parents, members: members.value, mode: drafted.length === 0 || contributed ? 'ai' : 'fallback' } }
}

/** 줄 입력 — 작업명(앞뒤 공백을 뺀 1~200자), 날짜(없음 또는 실재하는 YYYY-MM-DD, 시작 ≤ 종료), 위치·담당자(없음 또는 uuid), 말단 확인(참거짓) */
function rowProblem(t: ServerTranslate, row: Record<string, unknown>): string | null {
  if (typeof row.name !== 'string') return t('err.invalidRequest')
  if (!row.name.trim()) return t('srv.minuteWbs.nameRequired')
  if (wbsNameViolation(row.name)) return t('srv.minuteWbs.nameTooLong')
  const dateOk = (v: unknown) => v == null || (typeof v === 'string' && isValidIsoDate(v))
  const idOk = (v: unknown) => v == null || (typeof v === 'string' && isUuidLike(v))
  if (!dateOk(row.plannedStart) || !dateOk(row.plannedEnd) || !idOk(row.parentId) || !idOk(row.assigneeMemberId)
      || typeof row.confirmParentLeaf !== 'boolean') return t('err.invalidRequest')
  if (typeof row.plannedStart === 'string' && typeof row.plannedEnd === 'string' && row.plannedStart > row.plannedEnd) return t('srv.minuteWbs.dateRange')
  return null
}

/** RPC 줄 — 블록 index·hash·발췌·원문 키는 서버가 검증한 원문에서 만든다(RPC 는 이 값을 믿는다) */
function rpcRow(row: MinuteWbsCreateRow, source: MinuteIssueSourceInput, v: Verified) {
  return {
    name: row.name.trim(),
    parent_id: row.parentId ?? null,
    planned_start: row.plannedStart ?? null,
    planned_end: row.plannedEnd ?? null,
    assignee_member_id: row.assigneeMemberId ?? null,
    block_index: v.block.index,
    block_hash: v.block.hash,
    excerpt: minuteIssueSourceExcerpt(rowText(v)),
    source_kind: source.kind,
    source_key: makeMinuteIssueSourceKey({
      minuteVersionId: source.minuteVersionId,
      blockIndex: v.block.index,
      blockHash: v.block.hash,
      kind: source.kind,
      selectionHash: v.selectionExcerpt ? minuteSelectionKeyHash(v.selectionExcerpt) : null,
    }),
    // 같은 말단 부모로 가는 줄이 여럿이어도 줄마다 자기 확인을 싣는다 — RPC 가 등록 전 트리로 줄마다 본다
    confirm_parent_leaf: row.confirmParentLeaf,
  }
}

/** RPC 반환 [{ row, item_id, code }] — 줄 수·순서가 맞지 않으면 null */
function createdItems(data: unknown, count: number): { row: number; itemId: string; code: string }[] | null {
  if (!Array.isArray(data) || data.length !== count) return null
  const items = data.flatMap((x, i) => (isRecord(x) && x.row === i && typeof x.item_id === 'string' && typeof x.code === 'string'
    ? [{ row: i, itemId: x.item_id, code: x.code }] : []))
  return items.length === count ? items : null
}

/**
 * 회의록 줄들을 WBS 작업으로 — 전부 또는 전무(RPC 한 번 = 트랜잭션 하나). 거부는 사유와 줄 번호(RPC detail)로 돌려준다.
 * 등록 뒤 처리(트랜잭션 밖): 색인 큐 한 번, 담당자를 지정한 줄은 setWbsAssignee 와 같은 도우미 셋(전이 → 알림 → 주문 — 실패는 로그만), 진척 스냅샷.
 */
export async function createWbsItemsFromMinute(projectId: string, rows: MinuteWbsCreateRow[]): Promise<MinuteWbsCreateResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MINUTE_WBS_ROWS_MAX) return { ok: false, error: t('srv.minuteWbs.rowsInvalid') }
  for (const [row, value] of rows.entries()) {
    if (!isRecord(value)) return { ok: false, error: t('err.invalidRequest'), row }
  }
  const sources = rows.map((value) => value.source)
  const badSource = sourceProblem(t, sources)
  if (badSource) return badSource
  for (const [row, value] of rows.entries()) {
    const problem = rowProblem(t, value as unknown as Record<string, unknown>)
    if (problem) return { ok: false, error: problem, row }
  }
  const verified = await verifyRows(t, projectId, g.actor.projectWorkspace.get(projectId), sources, 'createWbsItemsFromMinute', false)
  if (!verified.ok) return verified
  const maxDepth = await loadMaxDepth(t, projectId)
  if (!maxDepth.ok) return maxDepth

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (cause) {
    return { ok: false, error: failWith('minuteWbs.create', cause, t('srv.minuteWbs.createFailed')) }
  }
  // service_role 전용 DEFINER RPC — 등급(actor_is_project_admin)·회의록·부모·중복을 함수 안에서 다시 본다. p_actor 는 가드 결과만
  const { data, error } = await admin.rpc('create_wbs_items_from_minute', {
    p_project_id: projectId,
    p_actor: g.actor.userId,
    p_minute_id: sources[0].minuteId,
    p_minute_version_id: sources[0].minuteVersionId,
    p_body_hash: verified.values[0].storedBodyHash,
    p_max_depth: maxDepth.value,
    p_rows: rows.map((value, i) => rpcRow(value, sources[i], verified.values[i])),
  })
  if (error) {
    const mapped = rpcFailure(error, tokenTable(RPC_TOKENS, t), t)
    const message = failWith('minuteWbs.create', error, mapped?.message ?? t('srv.minuteWbs.createFailed'))
    // 줄 거부는 detail 이 줄 번호(0부터)다. 색인의 날 23505 는 'Key (…)' 세부라 줄이 아니다
    const row = /^\d+$/.test(error.details ?? '') ? Number(error.details) : undefined
    // 토큰(code)도 돌려준다 — 창이 문구를 해석하지 않고 갈래를 판단한다(MINUTE_WBS_LEAF_UNCONFIRMED 면 그 위치를 하위 없는 작업으로 고쳐 확인을 받는다)
    const code = mapped ? { code: mapped.code } : {}
    return row !== undefined && row < rows.length ? { ok: false, error: message, row, ...code } : { ok: false, error: message, ...code }
  }
  const items = createdItems(data, rows.length)
  if (!items) return { ok: false, error: failWith('minuteWbs.create', new Error('RPC 반환 모양이 계약과 다르다'), t('srv.minuteWbs.createFailed')) }

  await enqueueIndexChange(items.map((item) => ({ domain: 'wbs' as const, projectId, entityId: item.itemId })))
  // 담당자를 지정한 줄 — setWbsAssignee 의 부수효과와 같은 순서·같은 도우미(설계 §5.5). 새 작업은 업무 흐름이 꺼진 채라 실제로는 알림만 나간다
  await Promise.all(items.map(async (item) => {
    const memberId = rows[item.row].assigneeMemberId ?? null
    if (memberId === null) return
    try {
      const tr = await applyWorkflowEvent(admin, { event: 'assign', actorUserId: g.actor.userId, itemId: item.itemId })
      if (!tr.ok) console.error('[createWbsItemsFromMinute] 배정 전이 실패:', item.itemId, tr.error)
    } catch (e) {
      console.error('[createWbsItemsFromMinute] 배정 전이 예외:', item.itemId, e)
    }
    try {
      await emitNotification({
        type: 'work.assigned', projectId, actorUserId: g.actor.userId, entityType: 'wbs_item', entityId: item.itemId,
        payload: { title: rows[item.row].name.trim(), detail: t('srv.minuteWbs.assignedDetail'), href: `/p/${projectId}/wbs` },
        recipientMemberIds: [memberId],
      })
    } catch (e) {
      console.error('[createWbsItemsFromMinute] 배정 알림 예외:', item.itemId, e)
    }
    try {
      const order = await ensureOrderForWorkflowLeaf(admin, { projectId, wbsItemId: item.itemId, actorUserId: g.actor.userId })
      if (!order.ok) console.error('[createWbsItemsFromMinute] 자동 주문 발행 실패:', item.itemId, order.error)
    } catch (e) {
      console.error('[createWbsItemsFromMinute] 자동 주문 발행 예외:', item.itemId, e)
    }
  }))
  after(() => recordProgressSnapshot(projectId))
  revalidatePath('/(app)/p/[projectId]', 'layout')
  revalidatePath('/(app)/w/[slug]/minutes/[id]', 'page')
  return { ok: true, items }
}

/**
 * WBS 작업 상세의 「회의록 원문」 — 그 작업의 연결을 만든 순서대로. 산출물 목록(attachments.ts listAttachments)과 같은 읽기다: 로그인 +
 * 세션 클라이언트(RLS) — 항목을 읽을 수 있는 사람이면 명단 밖 조회 전용도 보고(상세 패널을 여는 사람 그대로), 못 읽는 항목은 없는 항목과
 * 같은 답이다(존재를 드러내지 않는다). 연결 표의 읽기 정책(wbs_item_links_ws_read)도 그 프로젝트를 볼 수 있는 사람이다.
 * 회의록 모듈이 꺼졌으면 관문의 거부(module_disabled) 그대로 — 화면은 그 코드에서 구역을 닫는다.
 */
export async function getWbsItemMinuteSources(itemId: string): Promise<WbsItemMinuteSourcesResult> {
  const t = await serverTranslator()
  if (typeof itemId !== 'string' || !isUuidLike(itemId)) return { ok: false, error: t('err.invalidRequest') }
  if (!(await getSession())) return { ok: false, error: ERR_ANON }
  // 항목의 프로젝트 — 세션 클라이언트(RLS)로 읽는다. 못 읽는 항목은 없는 항목과 같은 ERR_MISSING 이다
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (resolved.projectId === null) return { ok: false, error: ERR_MISSING }
  const projectId = resolved.projectId
  const mod = await requireModule({ projectId }, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }

  const sb = await createServerClient()
  const { data, error } = await sb.from('wbs_item_links')
    .select('id, minute_id, minute_version_id, minute_version_no, minute_title_snapshot, minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot, created_at')
    .eq('wbs_item_id', itemId)
    .eq('project_id', projectId)
    .eq('link_type', 'minute_block')
    .order('created_at', { ascending: true })
  if (error) return { ok: false, error: failWith('minuteWbs.sources', error, t('srv.minuteWbs.sourcesUnavailable')) }
  return {
    ok: true,
    rows: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      linkId: String(r.id),
      minuteId: String(r.minute_id),
      minuteVersionId: String(r.minute_version_id),
      minuteVersionNo: Number(r.minute_version_no),
      minuteTitle: String(r.minute_title_snapshot),
      minuteDate: String(r.minute_date_snapshot),
      bodyHash: String(r.body_hash),
      blockIndex: Number(r.block_index),
      blockHash: String(r.block_hash),
      excerpt: String(r.excerpt_snapshot),
      createdAt: String(r.created_at),
    })),
  }
}
