// 회의록 문단 → WBS 작업 등록의 순수 규칙 — 위치 후보·결정형 점수·폴백 작업명·"등록됨" 판정과 화면·액션이 함께 쓰는 모양.
// 클라이언트·서버 공용이라 I/O·서버 모듈을 import 하지 않는다(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §4·§5.6).

import type { MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import { canAddChild } from '@/lib/domain/wbsAffordance'
import { WBS_NAME_MAX } from '@/lib/domain/wbsValueRules'
import type { MinuteBlock } from '@/lib/minutes/blocks'

export const MINUTE_WBS_ROWS_MAX = 30
export const MINUTE_WBS_SOURCE_KINDS = ['manual', 'action'] as const
export type MinuteWbsSourceKind = (typeof MINUTE_WBS_SOURCE_KINDS)[number]
export const WBS_ROOT_PARENT = '__root__'                  // 선택기의 "맨 위" 값 — 제출 때 parentId null 로 바꾼다
export const MINUTE_WBS_PROMPT_CANDIDATES_MAX = 80

/** 트리 한 줄 — getComputedWbs 의 ComputedItem 에서 뽑는다(depth 0-based) */
export interface MinuteWbsTreeRow { id: string; parentId: string | null; name: string; isOwnerSplit: boolean; actualPct: number | null; assigneeMemberId: string | null; devWorkflow: boolean; depth: number }
/** 고를 수 있는 부모 — path 는 "1 설계 › 1.2 인증" 꼴(번호 + 이름을 ' › ' 로) */
export interface MinuteWbsParentOption { id: string; path: string; depth: number; leaf: boolean; actualPct: number | null; assigneeMemberId: string | null; dependencyCount: number; childNames: string[] }

/** 경로 조각 사이 — pathOf 가 잇고 scoreParentCandidates 가 다시 가른다 */
const PATH_SEPARATOR = ' › '

/**
 * 하위 작업을 넣을 수 있는 위치 — 수동 「하위 추가」와 RPC(create_wbs_items_from_minute)가 거부하는 곳을 미리 뺀다:
 * SUB-ACT 자신, 직접 하위에 SUB-ACT 가 있는 부모, 흐름이 켜진 작업, 진행 중인 에이전트 주문이 있는 작업, 깊이 상한(canAddChild)에 닿은 항목.
 * rows 는 트리 순서(부모 → 자식)로 받고 그 순서를 지킨다. 하위가 없는 작업(leaf)도 남긴다 — 검색으로 고를 수 있다.
 */
export function pickableParents(rows: readonly MinuteWbsTreeRow[], opts: { maxDepth: number | null; numbers: ReadonlyMap<string, string>; activeOrderItemIds: ReadonlySet<string>; dependencyCounts: ReadonlyMap<string, number> }): MinuteWbsParentOption[] {
  const byId = new Map(rows.map(row => [row.id, row]))
  const childrenOf = new Map<string, MinuteWbsTreeRow[]>()
  for (const row of rows) {
    if (row.parentId == null) continue
    const siblings = childrenOf.get(row.parentId)
    if (siblings) siblings.push(row)
    else childrenOf.set(row.parentId, [row])
  }
  // 조상부터 자기까지 "번호 이름"(번호가 없으면 이름만)을 ' › ' 로 — 끊긴 부모·순환은 거기서 멈춘다
  const pathOf = (row: MinuteWbsTreeRow): string => {
    const labels: string[] = []
    const seen = new Set<string>()
    for (let at: MinuteWbsTreeRow | undefined = row; at && !seen.has(at.id); at = at.parentId == null ? undefined : byId.get(at.parentId)) {
      seen.add(at.id)
      const no = opts.numbers.get(at.id)
      labels.push(no ? `${no} ${at.name}` : at.name)
    }
    return labels.reverse().join(PATH_SEPARATOR)
  }
  const options: MinuteWbsParentOption[] = []
  for (const row of rows) {
    const children = childrenOf.get(row.id) ?? []
    if (row.isOwnerSplit || children.some(child => child.isOwnerSplit) || row.devWorkflow
        || opts.activeOrderItemIds.has(row.id) || !canAddChild(row.depth, opts.maxDepth)) continue
    options.push({
      id: row.id,
      path: pathOf(row),
      depth: row.depth,
      leaf: children.length === 0,
      actualPct: row.actualPct,
      assigneeMemberId: row.assigneeMemberId,
      dependencyCount: opts.dependencyCounts.get(row.id) ?? 0,
      childNames: children.map(child => child.name),
    })
  }
  return options
}

/** AI 후보 = 하위가 이미 있는 것만(leaf=false) */
export function recommendableParents(options: readonly MinuteWbsParentOption[]): MinuteWbsParentOption[] {
  return options.filter(option => !option.leaf)
}

const WORD_SPLIT_RE = /[^\p{L}\p{N}]+/u
/** 경로 조각 머리의 개요 번호("1.10 ") — 이름이 아니라 위치라 낱말로 세지 않는다(회의 날짜 10/21 의 '10' 과 엇맞지 않게) */
const OUTLINE_NUMBER_RE = /^\d+(?:\.\d+)*\s+/
/** limit 을 주지 않을 때 — 폴백 추천은 상위 3개(설계 §4.2) */
const SCORE_LIMIT_DEFAULT = 3

function wordsOf(value: string): Set<string> {
  return new Set(value.toLowerCase().split(WORD_SPLIT_RE).filter(word => Array.from(word).length >= 2))
}

/** 경로의 이름만 — 조각마다 머리의 개요 번호를 걷는다. 이름 속 숫자("API v2"·"2026 결산")는 남는다 */
function pathNames(path: string): string {
  return path.split(PATH_SEPARATOR).map(segment => segment.replace(OUTLINE_NUMBER_RE, '')).join(' ')
}

/** 글 낱말마다 앞부분 전부(UTF-16 두 단위부터 — 후보 낱말은 두 글자 이상이라 그보다 짧을 수 없다). 후보 낱말이 여기 있으면 "글 낱말이 그것과 같거나 그것으로 시작한다" */
function prefixesOf(words: ReadonlySet<string>): Set<string> {
  const prefixes = new Set<string>()
  for (const word of words) {
    for (let end = 2; end <= word.length; end++) prefixes.add(word.slice(0, end))
  }
  return prefixes
}

/**
 * 결정형 점수 — 2글자 이상 낱말(공백·구두점 분리, 소문자)의 겹침 수, 경로 겹침 2점·하위 이름 겹침 1점. 0점은 뺀다. 상위 limit 개 id.
 * 겹침 = 글 낱말이 후보 낱말과 같거나 그것으로 시작한다(조사 붙은 '로그인을'·'API를' 이 '로그인'·'api' 를 잡는다 — 후보 낱말은 줄이지 않는다).
 * 후보 낱말 하나는 경로·하위 이름 쪽마다 한 번만 센다. 경로는 개요 번호를 빼고 이름만 본다.
 */
export function scoreParentCandidates(text: string, options: readonly MinuteWbsParentOption[], limit?: number): string[] {
  const textPrefixes = prefixesOf(wordsOf(text))
  if (textPrefixes.size === 0) return []
  const overlap = (candidateWords: ReadonlySet<string>): number => {
    let count = 0
    for (const word of candidateWords) if (textPrefixes.has(word)) count += 1
    return count
  }
  const scored: { id: string; score: number }[] = []
  for (const option of options) {
    const score = 2 * overlap(wordsOf(pathNames(option.path))) + overlap(wordsOf(option.childNames.join(' ')))
    if (score > 0) scored.push({ id: option.id, score })
  }
  // 정렬은 안정 정렬 — 동점은 입력(트리) 순서를 지킨다
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit ?? SCORE_LIMIT_DEFAULT)).map(entry => entry.id)
}

/** 앞뒤 공백을 빼고 공백을 접어 작업명 상한(WBS_NAME_MAX, UTF-16 길이) 안으로 — 서로게이트 쌍은 가르지 않는다 */
function clampWbsName(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= WBS_NAME_MAX) return compact
  let out = ''
  for (const char of compact) {
    if (out.length + char.length > WBS_NAME_MAX) break
    out += char
  }
  return out.trimEnd()
}

/** 마크다운 한 줄을 작업명 글로 — 인용·제목 '#'·글머리·번호·체크 상자, 링크·강조 표시를 걷는다(기간의 '~' 같은 낱개 기호는 남긴다) */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:>\s*)+/, '')
    .replace(/^\s*#{1,6}(?:\s+|$)/, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])(?:\s+|$)/, '')
    .replace(/^\s*\[[ xX]\](?:\s+|$)/, '')
    .replace(/^\s*\[(?:완료|미완료)\]\s*/, '') // minuteBlockDraftText 가 체크 상자를 옮겨 적은 표시
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/__|~~|[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 결정형 작업명 — insightLabel(trim) 있으면 그것, 없으면 첫 줄(마크다운 글머리·번호·'#' 제거), 공백 접기, 200자 상한 */
export function fallbackWbsName(text: string, insightLabel?: string | null): string {
  const label = insightLabel?.trim()
  if (label) return clampWbsName(label)
  // 걷고 나서 빈 줄(빈 체크 상자 등)은 건너뛴다. 끝까지 남는 글이 없으면 '' — 화면에서 사람이 작업명을 넣는다
  for (const line of text.split(/\r?\n/)) {
    const plain = plainLine(line)
    if (plain) return clampWbsName(plain)
  }
  return ''
}

export interface MinuteWbsDraftRow { row: number; blockIndex: number; blockHash: string; excerpt: string; name: string; parentIds: string[]; plannedEnd: string | null; assigneeMemberId: string | null; registered: { itemId: string; code: string; name: string } | null }
export interface MinuteWbsDrafts { rows: MinuteWbsDraftRow[]; parents: MinuteWbsParentOption[]; members: { id: string; name: string }[]; mode: 'ai' | 'fallback' }
export interface MinuteWbsCreateRow { source: MinuteIssueSourceInput; name: string; parentId: string | null; plannedStart: string | null; plannedEnd: string | null; assigneeMemberId: string | null; confirmParentLeaf: boolean }
export interface MinuteLinkedWbsItem { linkId: string; itemId: string; code: string; name: string; projectId: string; minuteVersionId: string; bodyHash: string; blockIndex: number; blockHash: string; sourceKind: MinuteWbsSourceKind }
export interface WbsItemMinuteSource { linkId: string; minuteId: string; minuteVersionId: string; minuteVersionNo: number; minuteTitle: string; minuteDate: string; bodyHash: string; blockIndex: number; blockHash: string; excerpt: string; createdAt: string }

/**
 * 현재 본문의 블록 hash 로 "등록됨"을 판정 — 버전이 달라도 같은 hash 면 그 블록 index 로 옮겨 붙인다. 안 맞는 연결은 뺀다.
 * 같은 hash 의 블록이 여럿이면 저장된 index 에 가장 가까운 블록(같은 거리면 앞 블록)으로 옮긴다. 입력 연결은 고치지 않는다.
 */
export function activeLinkedWbsItems(links: readonly MinuteLinkedWbsItem[], blocks: readonly MinuteBlock[]): MinuteLinkedWbsItem[] {
  const indexesByHash = new Map<string, number[]>()
  for (const block of blocks) {
    const indexes = indexesByHash.get(block.hash)
    if (indexes) indexes.push(block.index)
    else indexesByHash.set(block.hash, [block.index])
  }
  const active: MinuteLinkedWbsItem[] = []
  for (const link of links) {
    const indexes = indexesByHash.get(link.blockHash)
    if (!indexes) continue
    const nearest = indexes.reduce((best, index) =>
      Math.abs(index - link.blockIndex) < Math.abs(best - link.blockIndex) ? index : best)
    active.push(nearest === link.blockIndex ? link : { ...link, blockIndex: nearest })
  }
  return active
}
