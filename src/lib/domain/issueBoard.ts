/**
 * 이슈 보드 — 열 파생과 일괄 상태 이동의 판정(SPU2·SPU3 이월, 개정 §3.5 보드 행·§6.2). 순수 함수만.
 * 열은 프로젝트의 표시 상태 정의(`workflow.issue_statuses`)에서 나온다 — 범주 4개 고정 열이 아니다.
 * 이동 가능 여부는 issueWorkflow 의 전이 판정 한 곳을 쓴다(화면 선택지 = DB 트리거와 같은 규칙, 최종 판정은 트리거).
 */
import { orderedVocab, type IssueCategory, type IssueStatusDef } from '@/lib/settings/vocab'
import type { Issue } from './issues'
import { allowedTargets, canTransitionCode } from './issueWorkflow'

/** 이슈 행의 표시 상태 code — 옛 픽스처처럼 statusCode 가 없으면 범주 code(기본 4정의와 같다) */
export const issueStatusCode = (issue: Pick<Issue, 'status' | 'statusCode'>): string => issue.statusCode ?? issue.status

/** 열 하나에서 처음 그리는 카드 수와 '더 보기' 한 번에 늘리는 수 — 열이 길어져도 렌더가 무너지지 않게 하는 단순 상한 */
export const ISSUE_BOARD_PAGE = 30

export interface IssueBoardColumn {
  code: string
  /** 정의에 없는 code(지워진 상태)면 null — code 를 그대로 제목으로 쓴다 */
  def: IssueStatusDef | null
  /** active = 설정의 활성 상태. inactive·unknown 은 이슈가 남아 있을 때만 생기는 열이고 이동 대상이 되지 못한다 */
  kind: 'active' | 'inactive' | 'unknown'
  category: IssueCategory
  cards: Issue[]
}

/**
 * 보드 열 — 활성 표시 상태 전부(설정 순서, 이슈 0건이어도 열은 선다) + 이슈가 남은 비활성 상태(설정 순서) + 정의에 없는 code(code 순).
 * 비활성·모르는 상태에 남은 이슈를 감추지 않는다(조용히 사라지면 "없음"으로 읽힌다). 카드 순서는 넘겨받은 순서 그대로다.
 */
export function issueBoardColumns(defs: readonly IssueStatusDef[], issues: readonly Issue[]): IssueBoardColumn[] {
  const byCode = new Map<string, Issue[]>()
  for (const issue of issues) {
    const code = issueStatusCode(issue)
    const list = byCode.get(code)
    if (list) list.push(issue)
    else byCode.set(code, [issue])
  }
  const ordered = orderedVocab(defs)
  const known = new Set(ordered.map(d => d.code))
  const columns: IssueBoardColumn[] = ordered.filter(d => d.active)
    .map(d => ({ code: d.code, def: d, kind: 'active' as const, category: d.category, cards: byCode.get(d.code) ?? [] }))
  for (const d of ordered) {
    const cards = byCode.get(d.code)
    if (!d.active && cards?.length) columns.push({ code: d.code, def: d, kind: 'inactive', category: d.category, cards })
  }
  for (const code of [...byCode.keys()].filter(c => !known.has(c)).sort()) {
    const cards = byCode.get(code)!
    columns.push({ code, def: null, kind: 'unknown', category: cards[0].status, cards })
  }
  return columns
}

/** 카드의 이동 선택지 — 그 이슈의 현재 상태에서 전이표가 허용하는 활성 표시 상태(설정 순서, 자기 제외) */
export const issueMoveTargets = (defs: readonly IssueStatusDef[], issue: Pick<Issue, 'status' | 'statusCode'>): IssueStatusDef[] =>
  allowedTargets(defs, issueStatusCode(issue), issue.status)

/** 일괄 이동에서 미리 걸러지는 사유 — same: 이미 그 상태, not_allowed: 전이표 밖 */
export type BulkMoveBlockReason = 'same' | 'not_allowed'

export interface BulkMovePlan {
  /** 대상 상태 정의 — 정의에 없거나 비활성이면 null(아무것도 옮기지 않는다) */
  target: IssueStatusDef | null
  movable: Issue[]
  blocked: { issue: Issue; reason: BulkMoveBlockReason }[]
}

/** 일괄 이동 미리보기 — 고른 이슈를 대상 상태로 옮길 수 있는 것과 없는 것으로 나눈다(건별 판정, 범주를 넘는 이동 포함) */
export function planBulkMove(defs: readonly IssueStatusDef[], issues: readonly Issue[], targetCode: string): BulkMovePlan {
  const def = defs.find(d => d.code === targetCode)
  const target = def?.active ? def : null
  const plan: BulkMovePlan = { target, movable: [], blocked: [] }
  for (const issue of issues) {
    const from = issueStatusCode(issue)
    if (from === targetCode) plan.blocked.push({ issue, reason: 'same' })
    else if (target && canTransitionCode(defs, from, targetCode, issue.status)) plan.movable.push(issue)
    else plan.blocked.push({ issue, reason: 'not_allowed' })
  }
  return plan
}

export interface BulkMoveOutcome {
  issueId: string
  ok: boolean
  /** 서버가 돌려준 거부 사유(전이 거부·충돌·권한 등). 응답을 받지 못했으면 null — 화면이 일반 문구를 쓴다 */
  error?: string | null
  conflict?: boolean
}

/** 상태 저장 한 건 — 화면이 `updateIssueProgress` 를 넘긴다(한 길). 테스트는 가짜를 넘긴다 */
export type IssueStatusSender = (issueId: string, patch: { status: string; expectedStatus: string }) =>
  Promise<{ ok: boolean; error?: string; conflict?: boolean }>

/**
 * 일괄 이동 실행 — 건별로 같은 액션을 차례로 부른다(새 일괄 RPC 없음: 서버는 건마다 같은 가드·관문·전이 판정을 탄다).
 * 한 건의 거부·예외가 나머지를 멈추지 않는다. 결과는 넘긴 순서 그대로다.
 */
export async function runBulkMove(
  issues: readonly Issue[], targetCode: string, send: IssueStatusSender, onProgress?: (done: number) => void,
): Promise<BulkMoveOutcome[]> {
  const out: BulkMoveOutcome[] = []
  for (const issue of issues) {
    try {
      const res = await send(issue.id, { status: targetCode, expectedStatus: issueStatusCode(issue) })
      out.push(res.ok ? { issueId: issue.id, ok: true } : { issueId: issue.id, ok: false, error: res.error ?? null, conflict: res.conflict })
    } catch (e) {
      console.error('[issues] 일괄 상태 이동 — 응답을 받지 못했다', issue.id, e)
      out.push({ issueId: issue.id, ok: false, error: null })
    }
    onProgress?.(out.length)
  }
  return out
}
