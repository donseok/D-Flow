/** 내 업무 병합(스펙 §5.9) — 순수. 행 순서 = 기한 오름차순(없음은 뒤) → 종류(wbs·issue·approval·meeting) → id. 커서 = 마지막 행의 (due, kind, id) */
export type MyWorkKind = 'wbs' | 'issue' | 'approval' | 'meeting'
export const MY_WORK_KINDS: readonly MyWorkKind[] = ['wbs', 'issue', 'approval', 'meeting']
export interface MyWorkRow {
  kind: MyWorkKind; id: string; title: string; projectId: string; projectName: string
  due: string | null; overdueDays: number | null; status: string; href: string
}
const KIND_RANK: Record<MyWorkKind, number> = { wbs: 0, issue: 1, approval: 2, meeting: 3 }
type Key = [string | null, MyWorkKind, string]

function keyCompare(a: Key, b: Key): number {
  if (a[0] !== b[0]) { if (a[0] === null) return 1; if (b[0] === null) return -1; return a[0] < b[0] ? -1 : 1 }
  if (a[1] !== b[1]) return KIND_RANK[a[1]] - KIND_RANK[b[1]]
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0
}
export function compareMyWork(a: MyWorkRow, b: MyWorkRow): number { return keyCompare([a.due, a.kind, a.id], [b.due, b.kind, b.id]) }

export function encodeCursor(row: Pick<MyWorkRow, 'due' | 'kind' | 'id'>): string {
  return Buffer.from(JSON.stringify([row.due, row.kind, row.id])).toString('base64url')
}
/** 형식 밖 커서는 null(처음부터) — URL 에서 오는 값이다 */
export function decodeCursor(c: string | null | undefined): Key | null {
  if (!c) return null
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(v) || v.length !== 3) return null
    const [due, kind, id] = v as [unknown, unknown, unknown]
    if ((due !== null && typeof due !== 'string') || typeof id !== 'string' || !MY_WORK_KINDS.includes(kind as MyWorkKind)) return null
    return [due as string | null, kind as MyWorkKind, id]
  } catch { return null }
}

export function mergeMyWork(sources: MyWorkRow[][], cursor: string | null, limit: number): { rows: MyWorkRow[]; nextCursor: string | null } {
  const after = decodeCursor(cursor)
  const all = sources.flat().sort(compareMyWork).filter((r) => !after || keyCompare([r.due, r.kind, r.id], after) > 0)
  const rows = all.slice(0, limit)
  return { rows, nextCursor: all.length > limit && rows.length ? encodeCursor(rows[rows.length - 1]) : null }
}

/** WBS 의 '미완료' = actual_pct null 이거나 100 미만(원시값 — 반올림 금지, computeCompletionMap 규약), 리프 = 자식이 없는 행(wbs_items 에 상태 열이 없다) */
export function openLeafIds(items: readonly { id: string; actual_pct: number | null }[], childParentIds: ReadonlySet<string>): Set<string> {
  return new Set(items.filter((i) => !childParentIds.has(i.id) && (i.actual_pct === null || Number(i.actual_pct) < 100)).map((i) => i.id))
}
