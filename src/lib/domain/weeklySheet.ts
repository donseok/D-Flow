/* ── 주간업무 시트 도메인(순수) — 행 타입·셀 키·이월·서버 병합. I/O 없음. ── */
import type { ConfigArea, ConfigTeam } from '@/lib/settings/projectConfig'

export interface WeeklySheetRow {
  id: string
  reportId: string
  section: string
  module: string
  sortOrder: number
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
}

export type NewWeeklyRow = Omit<WeeklySheetRow, 'id' | 'reportId'>

/** 레거시 주간보고 양식의 업무영역 구분 — 시트 행 순서이자 PPT 보고 순서(단일 출처).
 *  PMO(사업 관리)를 맨 앞에 두고, 사업/원가(영업·구매·관리회계)에 이어 현장(품질·생산·조업·표준화·물류·설비·가공)이 뒤따른다. */
export const WEEKLY_SECTIONS = [
  'PMO', '영업', '구매', '관리회계', '품질', '생산계획',
  '조업', '표준화', '물류', '설비및L2', '가공',
] as const

/** 봇 도구(weekly:read)의 담당 팀 → 주간업무 구분 매핑. WEEKLY_SECTIONS 바로 옆에 두는 이유:
 *  구분 개명·신설이 이 파일 한 곳의 수정으로 끝나게 하기 위해서다 — 도구 쪽 사본이던 시절엔
 *  구분이 갈릴 때마다 손동기화가 필요했다.
 *  키는 팀 코드, 값은 section 문자열 완전일치로 매칭되는 구분 집합. */
export const WEEKLY_TEAM_SECTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  ERP: new Set(['ERP', '영업', '구매', '관리회계', '생산계획']),
  MES: new Set(['MES', '품질', '생산계획', '조업', '표준화', '물류', '설비및L2', '가공']),
  PMO: new Set(['PMO']),
  가공: new Set(['가공']),
  // 주간업무 구분(업무영역 11종)에 MDM 이 아직 없다 — 빈 매핑은 '알려진 팀이지만 조회 불가'로
  // 명시 거부된다(weekly 도구의 validateTeam). 구분 신설 시 여기에 채우면 자동 활성.
  MDM: new Set<string>(),
}

/** 매핑 불가 행이 흡수되는 구분 — 어떤 경우에도 이월 내용을 조용히 버리지 않기 위한 종착지. */
const FALLBACK_SECTION: string = WEEKLY_SECTIONS[0]

const isWeeklySection = (v: string): boolean => (WEEKLY_SECTIONS as readonly string[]).includes(v)

/** 표준 구분은 WEEKLY_SECTIONS의 업무 순서로, 비표준(레거시·자유 입력) 행은 그 뒤에서
 *  기존 sortOrder 순으로 정렬한다. 과거 주차의 sort_order는 주차마다 값이 달라(PMO를 백필한
 *  주차는 -10·1..9, 그 뒤 주차는 1..10) 숫자만으로는 중간에 삽입된 구분을 제자리에 놓을 수 없다.
 *  표시 순서를 이름이 정하게 하면 과거 행의 구조 필드를 고쳐 쓰지 않아도 되고,
 *  화면·점검·PPT·봇 저장소가 한 규칙을 공유하게 된다. */
export function sortWeeklyRows<T extends Pick<WeeklySheetRow, 'section' | 'sortOrder'>>(
  rows: readonly T[],
): T[] {
  const rank = (section: string) => {
    const i = (WEEKLY_SECTIONS as readonly string[]).indexOf(section.trim())
    return i < 0 ? WEEKLY_SECTIONS.length : i
  }
  return [...rows].sort((a, b) => rank(a.section) - rank(b.section) || a.sortOrder - b.sortOrder)
}

/** 행 라벨 — 신규 시트는 구분명 단독('영업'), 모듈이 적힌 행은 '구분 · 모듈'로 병기.
 *  구분이 없으면 모듈로 폴백하고 둘 다 없으면 '기타'(이름 없는 묶음이 생기지 않게). */
export function rowSectionLabel(row: Pick<WeeklySheetRow, 'section' | 'module'>): string {
  const sec = row.section.trim(), mod = row.module.trim()
  if (!sec) return mod || '기타'
  return mod && mod !== sec ? `${sec} · ${mod}` : sec
}

/** 한 '구분'으로 묶이는 단위의 키 — PPT 페이지 합성(buildSheetSections)과 주간보고 점검이 공유한다.
 *  표준 구분명이면 모듈과 무관하게 구분명 하나로 묶고(PPT가 한 장으로 싣는 단위), 비표준 행은
 *  라벨(구분 · 모듈)로 가른다 — 한 구분 아래 모듈로 나뉜 행들이 서로 섞이지 않게.
 *  폐지된 구분의 행도 여기서는 비표준이라 자기 이름으로 묶인다 — 표준 구분과 섞이지 않고
 *  별도 페이지로 인쇄된다(내용을 임의로 합치지 않는 쪽을 택한 것).
 *  두 곳이 서로 다른 단위를 쓰면, 점검을 통과한 시트가 PPT에서는 중복으로 인쇄된다. */
export function sectionKeyOf(row: Pick<WeeklySheetRow, 'section' | 'module'>): string {
  const sec = row.section.trim()
  return isWeeklySection(sec) ? sec : rowSectionLabel(row)
}

/** 셀 1개 상한 — 서버 액션·클라이언트 클램프·이월 병합이 공유하는 단일 출처. */
export const WEEKLY_CELL_MAX = 20000

/** 새 주차 기본 스켈레톤 — 업무영역 11행(구분당 1행, 셀은 빈값). 신규 행의 module은 항상 ''. */
export function defaultWeeklyRows(): NewWeeklyRow[] {
  return WEEKLY_SECTIONS.map((section, i) => ({
    section, module: '', sortOrder: i + 1,
    thisContent: '', thisIssue: '', nextContent: '', nextIssue: '',
  }))
}

/** 셀 저장 가능한 DB 열 화이트리스트 — 구조 필드(section/module/sort_order)는 별도 액션으로만. */
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
}

/** 새 주차 이월: 결과는 항상 표준 구분 행이다. 전주 차주계획 → 금주실적, next 는 비움.
 *  같은 구분의 행이 여럿이면(동시 백필로 생길 수 있다) sortOrder 순으로 줄바꿈으로 이어붙인다.
 *  표준이 아닌 구분의 내용도 버리지 않고 첫 구분(FALLBACK_SECTION)에 붙인다 — 영역 체계는 SP4 에서 바뀐다. */
export function carryOverRows(prev: WeeklySheetRow[]): NewWeeklyRow[] {
  const out = defaultWeeklyRows()
  const bySection = new Map(out.map(r => [r.section, r]))
  // 붙이는 값의 앞뒤 공백·개행을 실제로 다듬는다. 사용자가 셀 마지막 줄에서 Enter를 친 흔한 경우,
  // 후행 개행이 병합 구분자 \n과 겹쳐 빈 줄이 되고 PPT에 빈 불릿으로 찍힌다(셀 내부 문단 빈 줄은 보존).
  // 상한을 넘기면 더 붙이지 않는다 — 넘긴 채 시드되면 그 셀은 이후 저장 자체가 거부된다.
  const append = (cur: string, add: string) => {
    const t = add.trim()
    if (!t) return cur
    const merged = cur ? `${cur}\n${t}` : t
    return merged.length > WEEKLY_CELL_MAX ? merged.slice(0, WEEKLY_CELL_MAX) : merged
  }
  for (const r of [...prev].sort((a, b) => a.sortOrder - b.sortOrder)) {
    // Map.get 은 프로토타입을 보지 않는다 — 'toString' 같은 구분명도 폴백으로 간다.
    const target = bySection.get(r.section.trim()) ?? bySection.get(FALLBACK_SECTION)!
    target.thisContent = append(target.thisContent, r.nextContent)
    target.thisIssue = append(target.thisIssue, r.nextIssue)
  }
  return out
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

/* ── SP4 주간 영역(project_areas kind='weekly_section') — 순수(스펙 §4.1.1·D32). 행은 영역 id 로 묶이고 순서·라벨은 영역에서 온다.
 *    ① 단계에서는 옛 행 모양(WeeklySheetRow)과 함께 둔다 — 소비처가 하나씩 옮겨 간 뒤(SP4 계획 과제 19~24) 과제 25 가 옛 것을 지우고
 *    WeeklyAreaRow 를 WeeklySheetRow 로 이름을 되돌린다. 영역 모양은 해석기의 ConfigArea 그대로다(형만 가져온다 — 이 모듈은 클라이언트
 *    컴포넌트도 import 한다). ── */

/** 주간 행의 내용 네 칸 */
export interface WeeklyCells {
  thisContent: string
  thisIssue: string
  nextContent: string
  nextIssue: string
}

/** 영역 id 로 묶인 주간 행 — weekly_report_rows(report_id, area_id) 유일 */
export interface WeeklyAreaRow extends WeeklyCells {
  id: string
  reportId: string
  areaId: string
}

export type NewWeeklyAreaRow = Omit<WeeklyAreaRow, 'id' | 'reportId'>

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
  rows: readonly WeeklyAreaRow[], server: WeeklyAreaRow, areas: readonly WeeklyArea[], dirty: ReadonlySet<string>,
): { rows: WeeklyAreaRow[]; refresh: boolean } {
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
  local: readonly WeeklyAreaRow[], server: readonly WeeklyAreaRow[], areas: readonly WeeklyArea[], dirty: ReadonlySet<string>,
): WeeklyAreaRow[] {
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
  rows: readonly WeeklyAreaRow[], row: WeeklyAreaRow, areas: readonly WeeklyArea[],
): WeeklyAreaRow[] {
  const ordered = [...orderAreas(areas.filter(a => a.active)), ...orderAreas(areas.filter(a => !a.active))]
  const rankOf = new Map(ordered.map((a, i) => [a.id, i]))
  const rank = (areaId: string) => rankOf.get(areaId) ?? Number.MAX_SAFE_INTEGER
  const mine = rank(row.areaId)
  const at = rows.findIndex(r => rank(r.areaId) > mine)
  return at < 0 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)]
}

/** 점검 묶음(과제 21 의 groupOf) — 키 = 영역 id, 라벨 = rowLabel. 시트 화면과 테스트가 같은 함수를 쓴다
 *  (D22: 점검과 시트 PPT 가 같은 묶음 키 — PPT 는 buildSheetSections 가 영역 id 로 묶는다). */
export function areaGroupOf(
  areas: readonly Pick<WeeklyArea, 'id' | 'name' | 'active'>[],
): (row: { areaId: string }) => { key: string; label: string } {
  return (row) => ({ key: row.areaId, label: rowLabel(row, areas) })
}
