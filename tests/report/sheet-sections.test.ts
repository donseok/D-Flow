// 시트 PPT 의 페이지 집합과 점검 묶음이 같은 키(영역 id)를 쓴다(D22), 템플릿 예시 문구가 출력에 남지 않는다(E23).
// E23 정적 분석: 예시 문구('예시 작업 4 — …')는 weekly-template.pptx slide2 표 칸 (1,2) 에만 있고 렌더러가 그 칸을 늘 교체한다
// (templateFill.ts renderTemplate 의 buildPage — 시트 갈래·기본 갈래·연속 슬라이드 모두). 아래 두 케이스가 실측으로 판정한다.
import { describe, expect, it } from 'vitest'
import { buildSheetSections, sheetLineText } from '@/lib/report/sheetNarrative'
import { fillSheetTemplate, fillWeeklyTemplate } from '@/lib/report/templateFill'
import { lintWeeklySheet } from '@/lib/domain/weeklyLint'
import { areaGroupOf, visibleRows, type WeeklyArea, type WeeklySheetRow } from '@/lib/domain/weeklySheet'
import type { NarrativeModel } from '@/lib/report/narrative'
import { findSentinels, sentinelsFor, zipTextParts } from '../fixtures/legacy-sentinels'

const area = (id: string, name: string, sortOrder: number, active = true): WeeklyArea =>
  ({ id, code: id.toUpperCase(), name, sortOrder, active, teams: [] })
const AREAS: WeeklyArea[] = [
  area('a-exp', '실험', 1), area('a-data', '데이터', 2), area('a-ops', '운영', 3),
  area('a-old', '구 영역', 0, false), area('a-gone', '닫힌 영역', 4, false),
]
const DUP = '- 같은 줄\n- 같은 줄'   // 점검이 묶음마다 지적 하나 이상을 내게 한다(완전 중복)
const row = (id: string, areaId: string, thisContent = ''): WeeklySheetRow =>
  ({ id, reportId: 'rep', areaId, thisContent, thisIssue: '', nextContent: '', nextIssue: '' })
const ROWS: WeeklySheetRow[] = [
  row('r-ops', 'a-ops', DUP), row('r-exp', 'a-exp', DUP), row('r-data', 'a-data', DUP),
  row('r-old', 'a-old', DUP),   // 내용 있는 비활성 — 활성 뒤 페이지
  row('r-gone', 'a-gone'),      // 내용 없는 비활성 — 페이지·점검 묶음 없음
]
const META = { meta: { prevWeekRange: '9/21~9/25', weekRange: '9/28~10/2' } }

describe('시트 PPT 페이지 = 보이는 행(영역 순) — 점검과 같은 묶음(D22)', () => {
  it('페이지 = 활성 영역(영역 순) → 내용 있는 비활성 영역, 내용 없는 비활성 영역·고정 구분 페이지 없음', () => {
    expect(buildSheetSections(ROWS, AREAS).map(s => s.areaId)).toEqual(['a-exp', 'a-data', 'a-ops', 'a-old'])
  })

  it('같은 시트에서 점검 묶음 = 페이지 묶음 — 같은 키(영역 id), 같은 수', () => {
    const findings = lintWeeklySheet(visibleRows(ROWS, AREAS), areaGroupOf(AREAS))
    const lintGroups = new Set(findings.map(f => f.groupKey))
    const pages = buildSheetSections(ROWS, AREAS).map(s => s.areaId)
    expect(lintGroups.size).toBe(pages.length)
    expect([...lintGroups].sort()).toEqual([...pages].sort())   // 지적 순서는 점검 규칙 순서라 키 집합으로 견준다
  })
})

describe('E23 — 템플릿 예시 문구가 출력의 텍스트 파트에 남지 않는다', () => {
  // 뺄 등록 이름 없음 — 합성 영역 이름(실험·데이터·운영·구 영역)은 센티널과 같지 않다. 예시 문구는 그 안의 옛 구분명 하나로 적중한다.
  const SP4 = sentinelsFor('SP4', [])
  const hitsIn = async (buf: Buffer) =>
    (await zipTextParts(buf)).flatMap(p => findSentinels(p.text, SP4).map(hit => `${p.name}: ${hit}`))

  it('시트 갈래(fillSheetTemplate) — SP4 센티널 0건', async () => {
    const buf = await fillSheetTemplate(buildSheetSections(ROWS, AREAS), META,
      { labels: { left: '금주실적', right: '차주계획' }, lineFormatter: sheetLineText })
    expect(await hitsIn(buf)).toEqual([])
  })

  it('기본 갈래(fillWeeklyTemplate) — SP4 센티널 0건', async () => {
    const narr: NarrativeModel = {
      prev: [{ phase: '설계', num: 1, items: ['범위 확정'] }],
      curr: [{ phase: '구축', num: 1, items: ['화면 개발'] }],
      issues: ['일정 협의'], events: ['착수 회의 (9/28)'],
    }
    expect(await hitsIn(await fillWeeklyTemplate(narr, META))).toEqual([])
  })
})
