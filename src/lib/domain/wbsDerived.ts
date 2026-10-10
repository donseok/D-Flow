/**
 * WBS 표시용 파생값의 단일 출처(사용자 테스트 BUG-05·12·14·15) — DB 에 쓰지 않고 트리에서 그때그때 계산한다.
 * 표·간트·상세 패널·검색이 각자 따로 계산하면 같은 항목이 화면마다 다르게 보인다(번호가 그랬다 — 표는 트리 위치,
 * 상세 패널·검색은 저장 code). 진척·계획% 계산(rollup.ts)은 여기 값을 쓰지 않는다 — 숫자를 바꾸지 않는 표시 전용이다.
 */
import { buildTree, type BuildTreeOpts } from './tree'
import type { WbsRow } from './types'

/** 트리 순회에 필요한 최소 모양 — ComputedItem·TreeNode 가 구조적으로 만족한다 */
interface NodeLike<T> { id: string; children: readonly T[] }

/**
 * 개요 번호(1 / 1.2 / 1.2.1) — 형제 안의 표시 순서로 매긴다. **화면에 보이는 WBS 번호는 이것 하나다.**
 * 저장 열 `wbs_items.code` 는 가져오기의 추적 키다(엑셀의 코드 칸·에이전트 가져오기의 upsert 키). 화면에서 추가한 항목에는
 * 이름의 첫 낱말이 들어가므로(addWbsItem) 번호로 보일 수 없다 — 표시에 쓰지 않는다(내보내기·에이전트 계약에서만 쓴다).
 */
export function outlineNumbers<T extends NodeLike<T>>(roots: readonly T[]): Map<string, string> {
  const m = new Map<string, string>()
  const walk = (ns: readonly T[], prefix: string) =>
    ns.forEach((n, i) => {
      const num = prefix ? `${prefix}.${i + 1}` : String(i + 1)
      m.set(n.id, num)
      walk(n.children, num)
    })
  walk(roots, '')
  return m
}

/** 번호를 매기는 데 필요한 열 — 형제 순서(sort_order)와 담당 분리 행의 팀 순서 */
export interface OutlineRow {
  id: string
  parentId: string | null
  sortOrder: number
  isOwnerSplit: boolean
  owners: WbsRow['owners']
}

/** 평탄한 행에서 개요 번호 — 표와 같은 정렬(buildTree)을 거친다. 검색처럼 계산된 트리가 없는 자리가 쓴다. */
export function outlineNumbersOfRows(rows: readonly OutlineRow[], opts: BuildTreeOpts): Map<string, string> {
  const full: WbsRow[] = rows.map(r => ({
    id: r.id, parentId: r.parentId, sortOrder: r.sortOrder, isOwnerSplit: r.isOwnerSplit, owners: r.owners,
    code: '', name: '', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  }))
  return outlineNumbers(buildTree(full, opts))
}

/**
 * "번호 이름" 한 줄 — 이름이 이미 그 번호로 시작하면("1. 착수준비" + 1) 번호를 다시 붙이지 않는다.
 * 번호 뒤가 숫자·점+숫자로 이어지면("1.1 분석" 의 1, "10 준비" 의 1) 다른 번호이므로 붙인다.
 */
export function wbsNumberedName(number: string | null | undefined, name: string): string {
  if (!number) return name
  const head = name.trimStart()
  if (head.startsWith(number) && !/^(\d|\.\d)/.test(head.slice(number.length))) return name
  return `${number} ${name}`
}

/** 개요 번호의 순서 — 마디를 수로 견준다('1.10' 은 '1.9' 뒤). 빈 번호(매기지 못한 항목)는 맨 뒤, 서로는 같음(받은 순서 유지) */
export function compareOutlineNumbers(a: string, b: string): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1
    if (y[i] === undefined) return 1
    if (x[i] !== y[i]) return x[i] - y[i]
  }
  return 0
}

/** 한 항목의 표시 일정 — 직접 입력이 있으면 그 값, 없으면 하위에서 계산한 값 */
export interface ShownSchedule {
  start: string | null
  end: string | null
  /** 그 칸이 하위 작업에서 계산된 값인가(직접 입력이 아니다) — 화면이 연한 글자·툴팁으로 구분한다 */
  startDerived: boolean
  endDerived: boolean
}

interface ScheduleNode<T> extends NodeLike<T> { plannedStart: string | null; plannedEnd: string | null }

/**
 * 일정 롤업(BUG-12) — 칸마다: 직접 입력한 값이 있으면 그 값, 없으면 하위의 min(시작)·max(종료). 하위에도 없으면 빈 값.
 * 하위의 값도 같은 규칙으로 정해진 "표시 일정"이다(손자의 일정이 두 단계 위까지 올라간다).
 * 잎은 자기 값 그대로다. 표시 전용 — 상위의 계획%는 지금도 하위의 가중 평균이라 이 값과 무관하다.
 */
export function shownSchedules<T extends ScheduleNode<T>>(roots: readonly T[]): Map<string, ShownSchedule> {
  const m = new Map<string, ShownSchedule>()
  const walk = (n: T): ShownSchedule => {
    let lo: string | null = null
    let hi: string | null = null
    for (const c of n.children) {
      const s = walk(c)
      // 하위의 한쪽만 있는 일정도 범위에 든다 — 시작만 있는 작업은 그 날이 시작이자 지금까지 아는 끝이다
      for (const d of [s.start, s.end]) {
        if (d == null) continue
        if (lo == null || d < lo) lo = d
        if (hi == null || d > hi) hi = d
      }
    }
    const startDerived = n.plannedStart == null && lo != null
    const endDerived = n.plannedEnd == null && hi != null
    const out: ShownSchedule = { start: n.plannedStart ?? lo, end: n.plannedEnd ?? hi, startDerived, endDerived }
    m.set(n.id, out)
    return out
  }
  roots.forEach(walk)
  return m
}

/**
 * 프로젝트 기간 밖 작업(BUG-14) — 직접 입력한 일정이 기간을 벗어난 항목의 id. 저장은 막지 않고 화면이 알린다.
 * 기간의 한쪽만 정해졌으면 그쪽만 본다. 기간이 없으면 빈 집합(견줄 기준이 없다). 파생 일정은 세지 않는다 — 원인인 하위 행이 이미 세어진다.
 */
export function outOfProjectRangeIds<T extends ScheduleNode<T>>(
  roots: readonly T[], projectStart: string | null | undefined, projectEnd: string | null | undefined,
): Set<string> {
  const out = new Set<string>()
  if (!projectStart && !projectEnd) return out
  const outside = (d: string | null) => d != null && ((!!projectStart && d < projectStart) || (!!projectEnd && d > projectEnd))
  const walk = (ns: readonly T[]) => ns.forEach(n => {
    if (outside(n.plannedStart) || outside(n.plannedEnd)) out.add(n.id)
    walk(n.children)
  })
  walk(roots)
  return out
}

/**
 * 간트 축 범위(BUG-14) — min(프로젝트 시작, 가장 이른 날) ~ max(프로젝트 종료, 가장 늦은 날).
 * dates 는 작업 일정·예측 일정·기준일처럼 축에 보여야 하는 날짜 전부다. 하나도 없으면 null.
 */
export function ganttAxisRange(
  dates: readonly (string | null | undefined)[], projectStart: string | null | undefined, projectEnd: string | null | undefined,
): { start: string; end: string } | null {
  const all = [...dates, projectStart, projectEnd].filter((d): d is string => !!d)
  if (all.length === 0) return null
  return { start: all.reduce((a, b) => (a < b ? a : b)), end: all.reduce((a, b) => (a > b ? a : b)) }
}

/** 상세 패널이 열린 채 행 이름을 눌렀을 때(BUG-15) — 다른 행이면 그 행으로 전환, 같은 행이면 닫는다(null) */
export function nextDetailSelection(openId: string | null, clickedId: string): string | null {
  return openId === clickedId ? null : clickedId
}
