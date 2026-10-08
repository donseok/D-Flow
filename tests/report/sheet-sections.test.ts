// 시트 PPT 의 페이지 집합과 점검 묶음이 같은 키(영역 id)를 쓴다(D22), 양식의 예시 문구가 출력에 남지 않는다(E23).
// E23: 출력은 양식 엔진이 제품 기본 양식(assets/default/weekly_report_pptx.pptx)을 채운 것이다 — 옛 원본 양식과 그 렌더러는 지웠다.
// 아래 두 케이스가 시트 구분만 실은 모델·주간 모델까지 실은 모델의 렌더 결과로 판정한다.
import { describe, expect, it } from 'vitest'
import { buildSheetSections, sheetLineText } from '@/lib/report/sheetNarrative'
import { readFile } from 'node:fs/promises'
import { DEFAULT_RENDER_OPTIONS, engineFor } from '@/lib/report/engine'
import { buildWeeklyCatalog, weeklyCatalogSections } from '@/lib/report/catalog/weeklyBuild'
import { defaultFormAssetPath } from '@/lib/report/forms/loadTemplate'
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
/** /api/report 와 같은 길 — 기본 주간 양식을 카탈로그 모델로 채운다 */
const renderDefault = async (input: Parameters<typeof buildWeeklyCatalog>[0]) =>
  engineFor('pptx').render(
    new Uint8Array(await readFile(defaultFormAssetPath('weekly_report_pptx'))),
    buildWeeklyCatalog(input), {}, DEFAULT_RENDER_OPTIONS.weekly_report_pptx,
  )

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

describe('E23 — 양식 예시 문구가 출력의 텍스트 파트에 남지 않는다', () => {
  // 뺄 등록 이름 없음 — 합성 영역 이름(실험·데이터·운영·구 영역)은 센티널과 같지 않다. 예시 문구는 그 안의 옛 구분명 하나로 적중한다.
  const SP4 = sentinelsFor('SP4', [])
  const hitsIn = async (buf: Uint8Array) =>
    (await zipTextParts(buf)).flatMap(p => findSentinels(p.text, SP4).map(hit => `${p.name}: ${hit}`))

  it('시트 구분만 실은 출력 — 페이지가 보이는 구분 순이고 SP4 센티널 0건', async () => {
    const sections = weeklyCatalogSections(ROWS, AREAS, [])
    expect(sections.map(s => s.name)).toEqual(buildSheetSections(ROWS, AREAS).map(s => s.section))   // 카탈로그 구분 = 시트 PPT 페이지(D22)
    const buf = await renderDefault({ sections })
    const slides = (await zipTextParts(buf)).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p.name)).map(p => p.text).join('\n')
    for (const s of sections) expect(slides, s.name).toContain(s.name)
    expect(slides).toContain(sheetLineText('- 같은 줄'))
    expect(await hitsIn(buf)).toEqual([])
  })

  it('주간 모델·서술까지 실은 출력 — SP4 센티널 0건', async () => {
    const narr: NarrativeModel = {
      prev: [{ phase: '설계', num: 1, items: ['범위 확정'] }],
      curr: [{ phase: '구축', num: 1, items: ['화면 개발'] }],
      issues: ['일정 협의'], events: ['착수 회의 (9/28)'],
    }
    const buf = await renderDefault({ narrative: narr, sections: weeklyCatalogSections(ROWS, AREAS, []) })
    expect(await hitsIn(buf)).toEqual([])
  })
})
