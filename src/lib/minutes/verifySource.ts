import 'server-only'
// 회의록 블록 원문 검증 — 이슈 초안·등록(app/actions/issues.ts)이 쓰던 것을 WBS 등록도 같이 쓰도록 액션 밖으로 뺐다.
// 'use server' 파일에서 export 하면 클라이언트가 부를 수 있는 서버 액션이 되므로(가드 없는 검증이 그렇게 열리지 않게) 서버 라이브러리에 둔다.
// 호출자가 먼저 프로젝트 가드를 통과하고, 그 actor 의 워크스페이스를 projectWorkspaceId 로 넘긴다.
import { createServerClient } from '@/lib/supabase/server'
import { ISSUE_MINUTE_SOURCE_KINDS, type MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import {
  fnv1a64, isMarkableBlock, minuteBlockDraftText, splitMinuteBlocks, type MinuteBlock,
} from '@/lib/minutes/blocks'
import {
  MINUTE_SELECTION_MAX_BLOCK_SPAN, MINUTE_SELECTION_MAX_CHARS, matchMinuteSelection,
} from '@/lib/minutes/selection'
import { serverTranslator } from '@/lib/i18n/server'

const BLOCK_HASH_RE = /^[0-9a-f]{16}$/i

export interface VerifiedMinuteIssueBlock {
  storedBodyHash: string
  block: MinuteBlock
  insightLabel: string | null
  draftContextText: string
  /** 드래그 선택 등록이면 검증·정규화된 발췌, 블록 등록이면 null. */
  selectionExcerpt: string | null
}

export type MinuteIssueBlockVerification =
  | { ok: true; value: VerifiedMinuteIssueBlock }
  | { ok: false; error: string }

function minuteIssueDraftContext(
  blocks: readonly MinuteBlock[],
  selectedIndex: number,
  version: { title?: unknown; minute_date?: unknown },
): string {
  const lines: string[] = []
  const title = typeof version.title === 'string' ? version.title.trim() : ''
  const date = typeof version.minute_date === 'string' ? version.minute_date.trim() : ''
  if (title || date) lines.push(`회의록: ${[title, date].filter(Boolean).join(' · ')}`)

  // 선택 블록이 속한 heading 계층만 추적한다. 같은 문서의 다른 절 제목을 섞지 않는다.
  const headings: MinuteBlock[] = []
  let parentDepth = Number.POSITIVE_INFINITY
  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    const candidate = blocks[index]
    if (!candidate?.headingDepth || candidate.headingDepth >= parentDepth) continue
    headings.unshift(candidate)
    parentDepth = candidate.headingDepth
    if (parentDepth === 1) break
  }
  if (headings.length) lines.push(`상위 섹션: ${headings.map(heading => heading.text).join(' > ')}`)

  // 한 블록만으로 대명사나 대상이 불명확할 때를 위해 같은 절의 바로 앞·뒤 본문만 보조로 준다.
  const neighbors: string[] = []
  for (const direction of [-1, 1] as const) {
    for (let index = selectedIndex + direction; index >= 0 && index < blocks.length; index += direction) {
      const candidate = blocks[index]
      if (candidate.headingDepth) break
      if (isMarkableBlock(candidate)) {
        neighbors.push(
          `${direction < 0 ? '직전 문맥' : '직후 문맥'}: ${minuteBlockDraftText(candidate)}`,
        )
        break
      }
    }
  }
  lines.push(...neighbors)
  return lines.join('\n')
}

/** 선택이 걸친 블록 전체 원문 — 잘린 문장 경계를 AI 가 원문으로 보완할 수 있게 컨텍스트로 준다. */
function selectionRangeContext(
  blocks: readonly MinuteBlock[],
  startIndex: number,
  endIndex: number,
): string {
  const texts: string[] = []
  for (let index = startIndex; index <= endIndex && index < blocks.length; index += 1) {
    const candidate = blocks[index]
    if (candidate && isMarkableBlock(candidate)) texts.push(minuteBlockDraftText(candidate))
  }
  return texts.length ? `선택 범위 블록 원문:\n${texts.join('\n')}` : ''
}

function validMinuteIssueSource(source: MinuteIssueSourceInput): boolean {
  const base = Boolean(
    source.minuteId
    && source.minuteVersionId
    && Number.isSafeInteger(source.blockIndex)
    && source.blockIndex >= 0
    && BLOCK_HASH_RE.test(source.blockHash)
    && BLOCK_HASH_RE.test(source.bodyHash)
    && ISSUE_MINUTE_SOURCE_KINDS.includes(source.kind),
  )
  if (!base) return false
  const selection = source.selection
  // null 도 '선택 없음'으로 취급한다 — 임의 JSON 페이로드가 TypeError(500)를 만들지 않게.
  if (selection == null) return true
  // 선택 등록은 인사이트 kind 를 얹지 않는다 — manual 만 유효(스펙 §4.1).
  return Boolean(
    source.kind === 'manual'
    && typeof selection.text === 'string'
    && selection.text.length > 0
    && selection.text.length <= MINUTE_SELECTION_MAX_CHARS
    && Number.isSafeInteger(selection.endBlockIndex)
    && selection.endBlockIndex >= source.blockIndex
    && selection.endBlockIndex - source.blockIndex <= MINUTE_SELECTION_MAX_BLOCK_SPAN
    && BLOCK_HASH_RE.test(selection.endBlockHash),
  )
}

/**
 * 회의록 기반 초안 생성과 최종 저장이 같은 불변 원문 검증을 공유한다.
 * 클라이언트는 버전/블록 앵커만 제시하며, 실제 AI 입력·저장 스냅샷은 여기서 찾은 블록만 사용한다.
 * projectWorkspaceId 는 대상 프로젝트의 워크스페이스(가드를 통과한 actor 의 스냅샷) — 프로젝트 없는 회의록은 이것과 같아야 한다.
 */
export async function verifyMinuteIssueBlock(
  projectId: string,
  projectWorkspaceId: string | undefined,
  source: MinuteIssueSourceInput,
  logLabel: string,
  includeInsight = false,
): Promise<MinuteIssueBlockVerification> {
  const t = await serverTranslator()
  // 상한 초과는 형식 오류가 아니라 사용자가 고칠 수 있는 입력이다 — 오도 문구와 분리한다.
  if (
    source.selection
    && typeof source.selection.text === 'string'
    && (
      source.selection.text.length > MINUTE_SELECTION_MAX_CHARS
      || (
        Number.isSafeInteger(source.selection.endBlockIndex)
        && source.selection.endBlockIndex - source.blockIndex > MINUTE_SELECTION_MAX_BLOCK_SPAN
      )
    )
  ) {
    return { ok: false, error: t('srv.issues.selectionTooLarge') }
  }
  if (!projectId || !validMinuteIssueSource(source)) {
    return { ok: false, error: t('srv.issues.minutesSourceInformationNotValid') }
  }

  const sb = await createServerClient()
  const [versionRes, minuteRes] = await Promise.all([
    sb
      .from('minute_versions')
      .select('id, minute_id, body_md, body_hash, title, minute_date')
      .eq('id', source.minuteVersionId)
      .eq('minute_id', source.minuteId)
      .maybeSingle(),
    sb
      .from('minutes')
      .select('project_id, archived_at, workspace_id')
      .eq('id', source.minuteId)
      .maybeSingle(),
  ])
  const { data: version, error: versionErr } = versionRes
  if (versionErr) {
    console.error(`[${logLabel}] 원문 버전 조회 실패:`, versionErr.message)
    return { ok: false, error: t('srv.issues.couldNotVerifyMinutesSource') }
  }
  if (!version) return { ok: false, error: t('srv.issues.minutesSourceVersionNotFound') }
  if (minuteRes.error) {
    console.error(`[${logLabel}] 현재 회의록 조회 실패:`, minuteRes.error.message)
    return { ok: false, error: t('srv.issues.couldNotVerifyMinutesStatus') }
  }
  if (!minuteRes.data) return { ok: false, error: t('err.minutesNotFound') }
  if (minuteRes.data.archived_at) {
    return { ok: false, error: t('srv.issues.issuesCannotCreatedArchivedMinutes') }
  }

  // 버전의 project_id는 생성 당시 스냅샷이다. 이동 후에는 현재 회의록의 프로젝트만 경계로 쓴다.
  const currentProjectId = (minuteRes.data.project_id as string | null) ?? null
  if (currentProjectId !== null && currentProjectId !== projectId) {
    return { ok: false, error: t('srv.issues.minutesIssueBelongDifferentProjects') }
  }
  // 프로젝트 없는 회의록은 워크스페이스로만 스코프된다 — 다른 워크스페이스 프로젝트의 이슈로 옮기면 그 워크스페이스에만 속한
  // 사람도 발췌·제목을 읽는다(0009 issue_links 트리거가 DB 에서도 막는다). 워크스페이스를 모르면 거부(fail-closed).
  if (currentProjectId === null && (!projectWorkspaceId || minuteRes.data.workspace_id !== projectWorkspaceId)) {
    return { ok: false, error: t('srv.issues.minutesAnotherWorkspaceCannotCreate') }
  }

  const bodyMd = version.body_md as string
  const storedBodyHash = (version.body_hash as string).toLowerCase()
  if (storedBodyHash !== source.bodyHash.toLowerCase() || fnv1a64(bodyMd) !== storedBodyHash) {
    return { ok: false, error: t('srv.issues.minutesSourceVersionChanged') }
  }
  const blocks = splitMinuteBlocks(bodyMd)
  const block = blocks[source.blockIndex]
  if (!block || !isMarkableBlock(block) || block.hash !== source.blockHash.toLowerCase()) {
    return { ok: false, error: t('srv.issues.minutesBodyChanged') }
  }

  let selectionExcerpt: string | null = null
  if (source.selection) {
    const match = matchMinuteSelection(
      blocks,
      source.blockIndex,
      source.blockHash,
      source.selection.endBlockIndex,
      source.selection.endBlockHash,
      source.selection.text,
    )
    if (!match.ok) {
      return {
        ok: false,
        error: t('srv.issues.couldNotMatchSelectionAgainst'),
      }
    }
    // 제목만의 선택으로는 이슈를 만들지 않는다 — 블록 흐름의 heading 거절과 같은 원칙.
    const endIndex = source.selection.endBlockIndex
    const hasBody = blocks.some((candidate, index) =>
      index >= source.blockIndex && index <= endIndex
      && isMarkableBlock(candidate) && !candidate.headingDepth)
    if (!hasBody) {
      return { ok: false, error: t('srv.issues.selectRangeActualIssueContent') }
    }
    selectionExcerpt = match.excerpt
  }

  let insightLabel: string | null = null
  if (includeInsight && source.kind !== 'manual') {
    const { data: insight, error: insightErr } = await sb
      .from('minute_insights')
      .select('label')
      .eq('minute_id', source.minuteId)
      .eq('body_hash', storedBodyHash)
      .eq('block_index', source.blockIndex)
      .eq('block_hash', block.hash)
      .eq('kind', source.kind)
      .maybeSingle()
    if (insightErr) {
      // 보조 라벨 조회 실패는 원문 검증 실패가 아니다. 본문만으로도 결정형 초안을 만들 수 있다.
      console.error(`[${logLabel}] 인사이트 라벨 조회 실패(무시):`, insightErr.message)
    } else if (typeof insight?.label === 'string') {
      insightLabel = insight.label
    }
  }
  return {
    ok: true,
    value: {
      storedBodyHash,
      block,
      insightLabel,
      selectionExcerpt,
      draftContextText: source.selection
        ? [
            minuteIssueDraftContext(blocks, source.blockIndex, version),
            selectionRangeContext(blocks, source.blockIndex, source.selection.endBlockIndex),
          ].filter(Boolean).join('\n')
        : minuteIssueDraftContext(blocks, source.blockIndex, version),
    },
  }
}

const MINUTE_ISSUE_SOURCE_EXCERPT_MAX = 4_000
const MINUTE_ISSUE_SOURCE_EXCERPT_NOTICE = '\n[전체 내용은 연결된 회의록 원문에서 확인]'

export function minuteIssueSourceExcerpt(value: string): string {
  if (value.length <= MINUTE_ISSUE_SOURCE_EXCERPT_MAX) return value
  const budget = MINUTE_ISSUE_SOURCE_EXCERPT_MAX - MINUTE_ISSUE_SOURCE_EXCERPT_NOTICE.length
  let prefix = value.slice(0, budget)
  // 서로게이트 쌍 중간에서 자르면 깨진 문자가 저장되므로 경계만 한 글자 당긴다.
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1)
  return `${prefix.trimEnd()}${MINUTE_ISSUE_SOURCE_EXCERPT_NOTICE}`
}
