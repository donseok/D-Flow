/** 순서 이동(moveWbsItem)의 기대값 — 화면이 본 그 항목의 자리(SPU1, 개정 §5.8 — 무통보 덮어쓰기 0건).
 *  서버는 sort_order 로 이웃을 정하므로(화면의 팀 정렬과 다를 수 있다) 여기서도 같은 열로 고른다: 같은 부모의 형제를 sort_order → id 순으로
 *  세워 바로 위/아래를 맞바꿀 이웃으로 싣는다(경계면 null). 형제 목록에 그 항목이 없으면(목록을 받지 못한 화면) 이웃은 싣지 않는다 —
 *  서버는 부모·sort_order 만 대조한다. */
export interface MoveExpectation { parentId: string | null; sortOrder: number; neighborId?: string | null }

type Positioned = { id: string; parentId: string | null; sortOrder: number }

export function moveExpectation(item: Positioned, all: readonly Positioned[], dir: 'up' | 'down'): MoveExpectation {
  const own = { parentId: item.parentId ?? null, sortOrder: item.sortOrder }
  const sibs = all
    .filter(x => (x.parentId ?? null) === own.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const idx = sibs.findIndex(x => x.id === item.id)
  if (idx < 0) return own
  return { ...own, neighborId: sibs[dir === 'up' ? idx - 1 : idx + 1]?.id ?? null }
}
