import { describe, it, expect } from 'vitest'
import { sheetLineText, cellLines, buildSheetSections } from '@/lib/report/sheetNarrative'
import type { WeeklyArea, WeeklyAreaRow } from '@/lib/domain/weeklySheet'

const area = (id: string, name: string, sortOrder: number, active = true): WeeklyArea =>
  ({ id, code: id.toUpperCase(), name, sortOrder, active, teams: [] })
const AREAS: WeeklyArea[] = [area('a-exp', '실험', 1), area('a-data', '데이터', 2), area('a-ops', '운영', 3)]
const row = (id: string, areaId: string, over: Partial<WeeklyAreaRow> = {}): WeeklyAreaRow => ({
  id, reportId: 'rep1', areaId, thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('sheetLineText', () => {
  it('일반·숫자 줄은 4칸, 마커 추가 없음', () => {
    expect(sheetLineText('1. 현업 인터뷰 참석')).toBe('    1. 현업 인터뷰 참석')
    expect(sheetLineText('프로세스 분석')).toBe('    프로세스 분석')
  })
  it("'-' 줄은 8칸, '.' 줄은 12칸", () => {
    expect(sheetLineText('- 대상 : 운영팀')).toBe('        - 대상 : 운영팀')
    expect(sheetLineText('. 세부 검토')).toBe('            . 세부 검토')
  })
  it('이미 들여쓴 입력도 시작 문자로 판정', () => {
    expect(sheetLineText('  - 대상')).toBe('        - 대상')
  })
})

describe('cellLines', () => {
  it('줄 분해 + 연속 빈 줄 축약 + 앞뒤 빈 줄 제거', () => {
    expect(cellLines('1. A\n- a\n\n\n2. B\n')).toEqual(['1. A', '- a', '', '2. B'])
    expect(cellLines('\n\n1. A')).toEqual(['1. A'])
    expect(cellLines('')).toEqual([])
    expect(cellLines('   \n  ')).toEqual([])
  })
})

describe('상세 PPT 이슈·이벤트 원문 보존', () => {
  it("여러 줄 이슈는 마커·들여쓰기 구조 그대로, '외 N건' 캡 없이 전량 실린다", () => {
    const built = buildSheetSections([
      row('e', 'a-exp', { thisIssue: '1. 변화관리 교육세션\n- 대상 : Acme TF\n- 일정 : 7/20(월)\n2. 인터뷰 지연\n- 원인 : 일정 충돌\n- 대응 : 재조율' }),
    ], AREAS)
    expect(built.find(s => s.areaId === 'a-exp')!.thisIssue).toEqual([
      '1. 변화관리 교육세션', '- 대상 : Acme TF', '- 일정 : 7/20(월)',
      '2. 인터뷰 지연', '- 원인 : 일정 충돌', '- 대응 : 재조율',
    ])
  })

  it('주요이벤트도 작성한 줄 그대로 — 날짜 병합·재작성 없음', () => {
    const built = buildSheetSections([
      row('e', 'a-exp', { nextIssue: '• 7/13(월) 설계 검토회의\n• 7/13(월) 장비 벤치마킹\n• 7/15(수) 운영 인터뷰' }),
    ], AREAS)
    expect(built.find(s => s.areaId === 'a-exp')!.nextIssue).toEqual([
      '• 7/13(월) 설계 검토회의', '• 7/13(월) 장비 벤치마킹', '• 7/15(수) 운영 인터뷰',
    ])
  })

  it('긴 줄도 절단("…") 없이 원문 유지 — 넘침은 PPT 페이지네이션이 처리', () => {
    const long = `1. ${'가'.repeat(100)}`
    const built = buildSheetSections([row('e', 'a-exp', { thisIssue: long })], AREAS)
    expect(built.find(s => s.areaId === 'a-exp')!.thisIssue).toEqual([long])
  })
})

describe('buildSheetSections — 페이지 = 보이는 영역(스펙 §4.1.4, D32)', () => {
  it('페이지는 영역 순서(sortOrder)를 따른다 — 행 입력 순서와 무관하고 고정 구분 페이지가 없다', () => {
    const built = buildSheetSections([row('o', 'a-ops'), row('d', 'a-data'), row('x', 'a-exp')], AREAS)
    expect(built.map(s => [s.areaId, s.section])).toEqual([['a-exp', '실험'], ['a-data', '데이터'], ['a-ops', '운영']])
  })

  it('각 영역에 4셀(실적·계획·이슈·이벤트)이 함께 담긴다', () => {
    const s = buildSheetSections([
      row('x', 'a-exp', { thisContent: '1. 점검표\n- 범위', thisIssue: '지연 위험', nextContent: '1. 계획', nextIssue: '일정 협의 필요\n추가 인력' }),
    ], AREAS)[0]
    expect(s.thisContent).toEqual(['1. 점검표', '- 범위'])
    expect(s.nextContent).toEqual(['1. 계획'])
    expect(s.thisIssue).toEqual(['지연 위험'])
    expect(s.nextIssue).toEqual(['일정 협의 필요', '추가 인력'])
  })

  it('활성 영역의 빈 행은 빈 4셀 페이지가 된다', () => {
    const built = buildSheetSections([row('x', 'a-exp', { thisContent: '실적' }), row('d', 'a-data')], AREAS)
    expect(built.find(s => s.areaId === 'a-data')).toEqual({
      areaId: 'a-data', section: '데이터', thisContent: [], nextContent: [], thisIssue: [], nextIssue: [],
    })
  })

  it('내용 있는 비활성 영역은 활성 영역 뒤 페이지(머리는 영역 이름 그대로), 내용 없는 비활성 영역은 페이지가 없다', () => {
    const areas = [...AREAS, area('a-old', '구 영역', 0, false), area('a-gone', '닫힌 영역', 9, false)]
    const built = buildSheetSections([
      row('old', 'a-old', { thisContent: '남은 실적' }), row('gone', 'a-gone'), row('x', 'a-exp'),
    ], areas)
    expect(built.map(s => [s.areaId, s.section])).toEqual([['a-exp', '실험'], ['a-old', '구 영역']])
  })

  it('행이 없는 영역은 페이지가 없다 — 문서 뒤에 더한 영역의 빈 페이지가 과거 주차에 생기지 않는다(W17·E31)', () => {
    expect(buildSheetSections([row('x', 'a-exp')], AREAS).map(s => s.areaId)).toEqual(['a-exp'])
  })

  it('개명하면 같은 영역이 새 이름으로 나간다(W14)', () => {
    const renamed = AREAS.map(a => (a.id === 'a-exp' ? { ...a, name: '실험·검증' } : a))
    expect(buildSheetSections([row('x', 'a-exp')], renamed)[0]).toMatchObject({ areaId: 'a-exp', section: '실험·검증' })
  })

  it('같은 영역의 여러 행(옛 데이터)은 입력 순으로 이어붙이고 사이에 빈 줄 1개, 이슈는 빈 줄 없이', () => {
    const s = buildSheetSections([
      row('p', 'a-ops', { thisContent: '1차 실적', thisIssue: '1차 이슈' }),
      row('q', 'a-ops', { thisContent: '2차 실적', thisIssue: '2차 이슈' }),
    ], AREAS)[0]
    expect(s.thisContent).toEqual(['1차 실적', '', '2차 실적'])
    expect(s.thisIssue).toEqual(['1차 이슈', '2차 이슈'])
  })
})
