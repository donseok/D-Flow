/* ── 주간업무 시트 도메인(순수) — 행 타입·셀 키·이월·서버 병합. I/O 없음. ── */

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
} as const satisfies Record<WeeklyCellKey, keyof WeeklySheetRow>

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

/** Realtime/refresh 병합(스펙 §5): dirty(`${rowId}:${cellKey}`) 셀만 로컬 유지, 나머지는 서버 채택. */
export function applyServerRow(
  local: WeeklySheetRow, server: WeeklySheetRow, dirty: ReadonlySet<string>,
): WeeklySheetRow {
  const merged = { ...server }
  for (const key of WEEKLY_CELL_KEYS) {
    if (dirty.has(`${server.id}:${key}`)) merged[CELL_FIELD[key]] = local[CELL_FIELD[key]]
  }
  return merged
}
