import { UNKNOWN_AREA_LABEL, visibleRows, type WeeklyArea, type WeeklySheetRow } from '@/lib/domain/weeklySheet'

/* ============================================================================
 * 주간업무 시트 → PPT 변환(순수). 스펙 §6.
 * 시트는 구분(업무영역)당 한 페이지로 나가며, 각 페이지에 그 구분의
 * 금주실적·차주계획·이슈사항·주요이벤트 4셀을 함께 싣는다.
 * ========================================================================== */

/** 시트 셀 줄 → PPT 들여쓰기. 작성자가 쓴 마커를 그대로 두고 깊이만 부여(subLineText와 별개). */
export function sheetLineText(line: string): string {
  const t = line.trimStart()
  if (t.startsWith('.')) return `            ${t}` // 12칸 — 3단계
  if (t.startsWith('-')) return `        ${t}`     // 8칸 — 2단계
  return `    ${t}`                                 // 4칸 — 1단계(숫자·일반)
}

/** 셀 텍스트 → 줄 배열. 문단 구분(빈 줄)은 존중하되 연속 빈 줄은 1개로, 앞뒤 빈 줄은 제거. */
export function cellLines(text: string): string[] {
  const lines = text.split('\n').map(l => l.replace(/\s+$/, ''))
  const out: string[] = []
  for (const l of lines) {
    if (l.trim() === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(l.trim() === '' ? '' : l)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/** 한 영역(페이지)의 4셀 줄 묶음. items가 비면 그 셀은 헤더만/대체 문구로 렌더된다. */
export interface SheetSectionCells {
  areaId: string        // 묶음 키 — 점검(weeklyLint)의 groupKey 와 같은 키(D22)
  section: string       // 페이지 머리 = 영역 이름(스펙 §4.1.4 — 비활성 표지 없이, 콘텐츠 셀 헤더로 표기)
  thisContent: string[] // 금주실적
  nextContent: string[] // 차주계획
  thisIssue: string[]   // 이슈사항
  nextIssue: string[]   // 주요이벤트
}

/** 여러 행의 줄 묶음을 한 셀로 — 행 사이에 빈 줄 1개를 끼워 시각적으로 구분(빈 묶음은 건너뜀). */
function joinCells(parts: string[][]): string[] {
  const filled = parts.filter(p => p.length > 0)
  const out: string[] = []
  filled.forEach((p, i) => { if (i > 0) out.push(''); out.push(...p) })
  return out
}

/** 시트 rows → 영역별 4셀 묶음(스펙 §4.1.4). 페이지 = 보이는 행(visibleRows — 활성 영역의 행(영역 순) → 내용 있는 비활성 영역의 행)의
 *  영역 묶음이다. 고정 구분 페이지·"시트에 없는 영역의 빈 페이지"는 없다 — 그 문서에 행이 있는 영역만(W17·E31).
 *  같은 영역에 여러 행이 있으면(옛 데이터) 입력 순으로 이어붙인다. 점검(weeklyLint)도 같은 키(영역 id)로 묶는다(D22). */
export function buildSheetSections(rows: readonly WeeklySheetRow[], areas: readonly WeeklyArea[]): SheetSectionCells[] {
  const order: string[] = []
  const byArea = new Map<string, WeeklySheetRow[]>()
  for (const r of visibleRows(rows, areas)) {
    const own = byArea.get(r.areaId)
    if (own) own.push(r)
    else { byArea.set(r.areaId, [r]); order.push(r.areaId) }
  }
  const nameOf = (areaId: string) => areas.find(a => a.id === areaId)?.name ?? UNKNOWN_AREA_LABEL
  return order.map(areaId => {
    const own = byArea.get(areaId)!
    const cell = (field: 'thisContent' | 'nextContent') => joinCells(own.map(r => cellLines(r[field])))
    // 이슈/이벤트 셀은 문단 빈 줄만 걷어내고 작성 원문을 그대로 싣는다 — 마커·들여쓰기 구조 보존(캡·요약 없음 — 넘침은 fillSheetTemplate 의 paginateLines).
    const issue = (field: 'thisIssue' | 'nextIssue') =>
      own.flatMap(r => cellLines(r[field]).filter(l => l.trim() !== ''))
    return {
      areaId,
      section: nameOf(areaId),
      thisContent: cell('thisContent'),
      nextContent: cell('nextContent'),
      thisIssue: issue('thisIssue'),
      nextIssue: issue('nextIssue'),
    }
  })
}
