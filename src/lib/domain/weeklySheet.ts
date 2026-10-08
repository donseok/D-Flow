/* ── 주간업무 시트 도메인(순수) — 행 타입(영역 id 로 묶인다)·셀 키·영역 순서·라벨·서버 병합. I/O 없음. 이월은 weeklyCarry.ts. ── */
import type { ConfigArea, ConfigTeam } from '@/lib/settings/projectConfig'
import type { CustomValues } from './customFields'

/** 셀 1개 상한 — 서버 액션·클라이언트 클램프·이월 병합이 공유하는 단일 출처. */
export const WEEKLY_CELL_MAX = 20000

/** 셀 저장 가능한 DB 열 화이트리스트 — 구조 열(report_id·project_id·area_id)은 세션이 쓰지 못한다(열 권한 — 스펙 D27). */
export const WEEKLY_CELL_KEYS = ['this_content', 'this_issue', 'next_content', 'next_issue'] as const
export type WeeklyCellKey = (typeof WEEKLY_CELL_KEYS)[number]
export function isWeeklyCellKey(v: string): v is WeeklyCellKey {
  return (WEEKLY_CELL_KEYS as readonly string[]).includes(v)
}

export const CELL_FIELD = {
  this_content: 'thisContent', this_issue: 'thisIssue',
  next_content: 'nextContent', next_issue: 'nextIssue',
} as const satisfies Record<WeeklyCellKey, keyof WeeklyCells>

/** 열 표시 라벨 — 그리드 헤더(COLS)의 단일 출처. */
export const WEEKLY_CELL_LABEL = {
  this_content: '금주실적 내용', this_issue: '금주 이슈·이벤트',
  next_content: '차주계획 내용', next_issue: '차주 이슈·이벤트',
} as const satisfies Record<WeeklyCellKey, string>

/** 멀티셀 변이의 최소 단위 — 붙여넣기·범위삭제·채우기·undo·배치 액션이 공유. 고유성 키는 `${rowId}:${cellKey}`. */
export interface WeeklyCellEdit {
  rowId: string           // weekly_report_rows.id
  cellKey: WeeklyCellKey  // snake_case DB 열명(구조 열 불가침 — 내용 4열만)
  content: string         // 저장할 새 값(0~CELL_MAX)
  /** 값 CAS 의 기대값(SPU1, 개정 §5.8) — 내가 마지막으로 확인한 서버 값. 서버의 현재 값이 이와 다르면 쓰지 않고 충돌로 돌려준다.
   *  undo·redo 의 역명령은 "지금 서버 값 = 내가 쓴 값"을 여기에 싣는다(§5.8.6). 없으면 옛 무조건 저장이다 */
  expected?: string
}

/** Realtime/refresh 병합(스펙 §5): dirty(`${rowId}:${cellKey}`) 셀만 로컬 유지, 나머지(영역 id 포함)는 서버 채택. */
export function applyServerRow<R extends { id: string } & WeeklyCells>(
  local: R, server: R, dirty: ReadonlySet<string>,
): R {
  const merged: R = { ...server }
  for (const key of WEEKLY_CELL_KEYS) {
    const field = CELL_FIELD[key]
    if (dirty.has(`${server.id}:${key}`)) (merged as WeeklyCells)[field] = (local as WeeklyCells)[field]
  }
  return merged
}

/* ── 주간 영역(project_areas kind='weekly_section') — 순수(스펙 §4.1.1·D32). 행은 영역 id 로 묶이고 순서·라벨은 영역에서 온다.
 *    영역 모양은 해석기의 ConfigArea 그대로다(형만 가져온다 — 이 모듈은 클라이언트 컴포넌트도 import 한다). ── */

/** 주간 행의 내용 네 칸 */
export interface WeeklyCells {
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
}

/** 영역 id 로 묶인 주간 행 — weekly_report_rows(report_id, area_id) 유일 */
export interface WeeklySheetRow extends WeeklyCells {
  id: string
  reportId: string
  areaId: string
  custom?: CustomValues | null
}

export type NewWeeklyRow = Omit<WeeklySheetRow, 'id' | 'reportId'>

/** 주간 영역 — 해석기 getProjectConfig(pid).areas.weekly_section 의 원소 */
export type WeeklyArea = Pick<ConfigArea, 'id' | 'code' | 'name' | 'sortOrder' | 'active' | 'teams'>

export const ALL_CELLS: readonly (keyof WeeklyCells)[] = ['thisContent', 'thisIssue', 'nextContent', 'nextIssue']
export const NEXT_CELLS: readonly (keyof WeeklyCells)[] = ['nextContent', 'nextIssue']

/** 코드 포인트 비교 — 로캘(ko)·ICU 판에 따라 동률 순서가 흔들리지 않게(서버·브라우저·봇이 같은 순서) */
const cmpCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** 영역 순서 — (sortOrder, code, id). sort_order 는 기본 0·유일 아님이라 동률을 code·id 로 끊는다(스펙 D32). 입력은 바꾸지 않는다 */
export function orderAreas<A extends Pick<WeeklyArea, 'id' | 'code' | 'sortOrder'>>(areas: readonly A[]): A[] {
  return [...areas].sort((a, b) => a.sortOrder - b.sortOrder || cmpCode(a.code, b.code) || cmpCode(a.id, b.id))
}

/** "내용 있음" — 주어진 칸 가운데 trim() 이 빈 문자열이 아닌 것이 있는가(스펙 D32·Q37). 이월의 대기 판정은 NEXT_CELLS, 표시·시드
 *  보존은 ALL_CELLS 로 부른다 — 이월·표시·시드가 이 술어 하나만 쓴다(마이그레이션 이관은 다듬지 않는 다른 술어다 — 보존이 목적) */
export function hasContent(row: Partial<WeeklyCells>, cells: readonly (keyof WeeklyCells)[]): boolean {
  return cells.some((c) => (row[c] ?? '').trim() !== '')
}

/** 시트·점검·PPT·봇이 보이는 행(스펙 D32) — 활성 영역의 행(영역 순) → 내용 있는 비활성 영역의 행(영역 순) → 내용 있는 모르는 영역의
 *  행(맨 뒤 — FK 가 막아 정상 경로에서는 없다). 같은 영역 안은 입력 순. 내용 없는 비활성·모르는 영역 행은 뺀다. 화면은 페이지를 읽을 때
 *  한 번 부르고 같은 화면 안에서는 다시 부르지 않는다(Q37 — 실시간 병합이 행을 빼지 않는다) */
export function visibleRows<R extends { areaId: string } & WeeklyCells>(rows: readonly R[], areas: readonly WeeklyArea[]): R[] {
  const ordered = orderAreas(areas)
  const rank = new Map(ordered.map((a, i) => [a.id, i]))
  const active = new Set(ordered.filter((a) => a.active).map((a) => a.id))
  const group = (r: R): number => (active.has(r.areaId) ? 0 : rank.has(r.areaId) ? 1 : 2)
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => active.has(r.areaId) || hasContent(r, ALL_CELLS))
    .sort((x, y) => group(x.r) - group(y.r)
      || (rank.get(x.r.areaId) ?? ordered.length) - (rank.get(y.r.areaId) ?? ordered.length)
      || x.i - y.i)
    .map(({ r }) => r)
}

export const UNKNOWN_AREA_LABEL = '알 수 없는 영역'

/** 행 라벨 — 영역 이름. 비활성이면 표지를 붙이고, 영역 목록에 없으면 알 수 없는 영역 */
export function rowLabel(row: { areaId: string }, areas: readonly Pick<WeeklyArea, 'id' | 'name' | 'active'>[]): string {
  const a = areas.find((x) => x.id === row.areaId)
  if (!a) return UNKNOWN_AREA_LABEL
  return a.active ? a.name : `${a.name} (비활성)`
}

/** 그 code 의 팀(전용·공용 모두 — area_teams_guard 가 허용하는 범위)이 주·보조로 든 영역 id(스펙 §4.1.1·D24). 주간 보고서와 봇이 같이
 *  쓴다(패리티 W18). code 는 그대로 비교한다(팀 code 는 대소문자를 가린다) */
export function areasForTeam(
  areas: readonly Pick<WeeklyArea, 'id' | 'teams'>[],
  teams: readonly Pick<ConfigTeam, 'id' | 'code'>[],
  teamCode: string,
): Set<string> {
  const ids = new Set(teams.filter((t) => t.code === teamCode).map((t) => t.id))
  return new Set(areas.filter((a) => a.teams.some((t) => ids.has(t.teamId))).map((a) => a.id))
}

/** 실시간 병합(스펙 §4.1.7, D32·D44) — 표시 집합은 페이지를 읽을 때 정해졌고(visibleRows) 여기서 다시 계산하지 않는다.
 *  ① 있는 행(id): 자리를 지키고 dirty 칸만 로컬(applyServerRow). 비활성 영역 행의 마지막 칸이 비어도 남는다.
 *  ② 없는 행·활성 영역, 또는 비활성 영역인데 내용이 있다(숨겨 있던 행에 누가 쓴 경우): visibleRows 와 같은 순서(활성 영역 순 →
 *     비활성 영역 순 → 모르는 영역) 자리에 끼운다. 표시 집합은 늘 수만 있다.
 *  ③ 없는 행·모르는 영역(관리자가 방금 더한 영역 — RPC 가 이번 주 문서에 행을 넣었다): 끼우지 않고 refresh 를 알린다 —
 *     라벨·순서가 없는 행을 그리지 않고 영역 목록을 다시 받는다.
 *  ④ 없는 행·비활성으로 아는 영역·내용 없음: 끼우지 않고 refresh — RPC 는 활성 영역에만 행을 넣으므로(§3.2) 그 영역은 그새
 *     재활성됐고 화면의 영역 목록이 낡았다. 숨긴 행에 빈 값이 저장된 경우라면 새로고침이 그대로 숨긴다(헛도는 새로고침 한 번).
 *  순수 함수 — 입력 배열을 바꾸지 않는다. */
export function mergeServerRow(
  rows: readonly WeeklySheetRow[], server: WeeklySheetRow, areas: readonly WeeklyArea[], dirty: ReadonlySet<string>,
): { rows: WeeklySheetRow[]; refresh: boolean } {
  const at = rows.findIndex(r => r.id === server.id)
  if (at >= 0) {
    const next = [...rows]
    next[at] = applyServerRow(rows[at], server, dirty)
    return { rows: next, refresh: false }
  }
  const area = areas.find(a => a.id === server.areaId)
  if (!area) return { rows: [...rows], refresh: true }
  if (!area.active && !hasContent(server, ALL_CELLS)) return { rows: [...rows], refresh: true }
  return { rows: insertByAreaOrder(rows, server, areas), refresh: false }
}

/** 새로고침 반영(스펙 §4.1.7, D32) — 페이지가 다시 정한 표시 집합(server — visibleRows 순)과 순서를 따르고 dirty 칸만 로컬이다.
 *  같은 문서에서 지금 보이는 행이 server 에 없으면(그새 마지막 칸이 빈 비활성 영역 행 — 페이지가 숨겼다) 빼지 않고 영역 순서
 *  자리에 남긴다. 행 삭제는 실시간 DELETE 가 맡는다. 문서가 바뀌면(주차 이동) 호출부가 local 을 [] 로 넘긴다. 순수 함수. */
export function mergeRefreshedRows(
  local: readonly WeeklySheetRow[], server: readonly WeeklySheetRow[], areas: readonly WeeklyArea[], dirty: ReadonlySet<string>,
): WeeklySheetRow[] {
  const localById = new Map(local.map(r => [r.id, r]))
  const serverIds = new Set(server.map(r => r.id))
  let out = server.map(sv => {
    const lc = localById.get(sv.id)
    return lc ? applyServerRow(lc, sv, dirty) : sv
  })
  for (const lc of local) if (!serverIds.has(lc.id)) out = insertByAreaOrder(out, lc, areas)
  return out
}

/** visibleRows 와 같은 순서(활성 영역 순 → 비활성 영역 순 → 모르는 영역) 자리에 행 하나를 끼운다 — 같은 순위 안에서는 뒤에. */
function insertByAreaOrder(
  rows: readonly WeeklySheetRow[], row: WeeklySheetRow, areas: readonly WeeklyArea[],
): WeeklySheetRow[] {
  const ordered = [...orderAreas(areas.filter(a => a.active)), ...orderAreas(areas.filter(a => !a.active))]
  const rankOf = new Map(ordered.map((a, i) => [a.id, i]))
  const rank = (areaId: string) => rankOf.get(areaId) ?? Number.MAX_SAFE_INTEGER
  const mine = rank(row.areaId)
  const at = rows.findIndex(r => rank(r.areaId) > mine)
  return at < 0 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)]
}

/** 점검 묶음(weeklyLint 의 groupOf) — 키 = 영역 id, 라벨 = rowLabel. 시트 화면과 테스트가 같은 함수를 쓴다
 *  (D22: 점검과 시트 PPT 가 같은 묶음 키 — PPT 는 buildSheetSections 가 영역 id 로 묶는다). */
export function areaGroupOf(
  areas: readonly Pick<WeeklyArea, 'id' | 'name' | 'active'>[],
): (row: { areaId: string }) => { key: string; label: string } {
  return (row) => ({ key: row.areaId, label: rowLabel(row, areas) })
}
