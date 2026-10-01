import { describe, it, expect } from 'vitest'
import {
  carryOverRows, applyServerRow, defaultWeeklyRows, isWeeklyCellKey,
  sortWeeklyRows, WEEKLY_CELL_MAX, WEEKLY_SECTIONS, type WeeklySheetRow,
  ALL_CELLS, NEXT_CELLS, UNKNOWN_AREA_LABEL, areasForTeam, hasContent, orderAreas, rowLabel, visibleRows,
  type WeeklyArea, type WeeklyAreaRow,
} from '@/lib/domain/weeklySheet'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'
import { SYNTHETIC_TEAMS } from '../fixtures/synthetic/teams'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'

const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
  id: 'r1', reportId: 'rep1', section: '영업', module: '', sortOrder: 1,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('carryOverRows', () => {
  it('신규 체계 시트 — 차주계획→금주실적 1:1 이월, next는 비움, 11행 유지', () => {
    const prev = [
      row({ id: 'a', sortOrder: 2, section: '구매', module: '', nextContent: '계획B', nextIssue: '이슈B' }),
      row({ id: 'b', sortOrder: 1, section: '영업', module: '', thisContent: '지난실적', nextContent: '계획A' }),
    ]
    const out = carryOverRows(prev)
    expect(out).toHaveLength(11)
    expect(out.map(r => r.section)).toEqual([...WEEKLY_SECTIONS])
    expect(out[0]).toMatchObject({ section: 'PMO', thisContent: '', nextContent: '' }) // PMO가 맨 앞·빈 값
    expect(out.find(r => r.section === '영업')).toMatchObject({ thisContent: '계획A', thisIssue: '', nextContent: '', nextIssue: '' })
    expect(out.find(r => r.section === '구매')).toMatchObject({ thisContent: '계획B', thisIssue: '이슈B', nextContent: '', nextIssue: '' })
    expect('id' in out[0]).toBe(false)
  })
  it('같은 구분 행이 여럿이면 sortOrder 순으로 줄바꿈으로 병합한다', () => {
    // 동시 백필(data/weeklySheet.ts ensureStandardRows)로 같은 구분 행이 둘 생길 수 있다.
    const prev = [
      row({ id: 'b', sortOrder: 5, section: '관리회계', nextContent: '원가 계획', nextIssue: '기준 미정' }),
      row({ id: 'a', sortOrder: 4, section: '관리회계', nextContent: '자금 계획' }),
      row({ id: 'c', sortOrder: 11, section: '가공', nextContent: 'A 라인 점검' }),
    ]
    const out = carryOverRows(prev)
    expect(out).toHaveLength(11)
    const by = (s: string) => out.find(r => r.section === s)!
    expect(by('관리회계').thisContent).toBe('자금 계획\n원가 계획') // 입력 순서가 아니라 sortOrder 순
    expect(by('관리회계').thisIssue).toBe('기준 미정')
    expect(by('가공').thisContent).toBe('A 라인 점검')
    expect(by('품질').thisContent).toBe('')                         // 원본에 없던 구분은 빈 행
  })
  it('빈 입력 → 빈 표준 11행(빈 배열 아님)', () => {
    const out = carryOverRows([])
    expect(out).toHaveLength(11)
    expect(out.every(r => r.thisContent === '' && r.nextContent === '')).toBe(true)
  })
  it('표준이 아닌 구분의 내용도 버리지 않는다 — 결과는 표준 구분 행뿐이고 내용은 그중 한 행에 붙는다', () => {
    // 어느 구분에 붙는지는 고정하지 않는다 — 영역 체계는 SP4 에서 바뀐다.
    const prev = [
      row({ id: 'a', sortOrder: 7, section: '폐지된 구분', nextContent: '외부 연동 일정 협의', nextIssue: '담당자 미정' }),
    ]
    const out = carryOverRows(prev)
    expect(out.map(r => r.section)).toEqual([...WEEKLY_SECTIONS])
    const hit = out.filter(r => r.thisContent === '외부 연동 일정 협의')
    expect(hit).toHaveLength(1)
    expect(hit[0].thisIssue).toBe('담당자 미정')
  })
  it('이월 대상은 구분(section)만으로 정한다 — 모듈 칸이 표준 구분명이어도 그쪽으로 옮기지 않는다', () => {
    const prev = [
      row({ id: 'a', sortOrder: 1, section: '기타 구분', module: '물류', nextContent: '모듈 칸이 물류인 내용' }),
      row({ id: 'b', sortOrder: 2, section: '영업', module: '물류', nextContent: '영업 내용' }),
    ]
    const out = carryOverRows(prev)
    const by = (s: string) => out.find(r => r.section === s)!
    expect(by('물류').thisContent).toBe('')
    expect(by('영업').thisContent).toBe('영업 내용')
    expect(out.filter(r => r.thisContent.includes('모듈 칸이 물류인 내용'))).toHaveLength(1)
  })
  it('병합 시 앞뒤 빈 줄을 다듬는다 — PPT에 빈 불릿이 찍히지 않게', () => {
    const prev = [
      row({ id: 'a', sortOrder: 1, section: '관리회계', nextContent: '1. 자금 계획\n\n' }),
      row({ id: 'b', sortOrder: 2, section: '관리회계', nextContent: '\n1. 원가 계획' }),
      row({ id: 'c', sortOrder: 3, section: '물류', nextContent: '\n\n1. 통관\n' }),
    ]
    const out = carryOverRows(prev)
    const by = (s: string) => out.find(r => r.section === s)!
    expect(by('관리회계').thisContent).toBe('1. 자금 계획\n1. 원가 계획') // 빈 줄 없이 정확히 두 줄
    expect(by('물류').thisContent).toBe('1. 통관')                        // 단독 값도 앞뒤 개행 제거
  })
  it('셀 내부의 문단 구분 빈 줄은 보존한다 — 다듬는 건 앞뒤뿐', () => {
    const prev = [row({ sortOrder: 1, section: '영업', module: '', nextContent: '1. A\n\n2. B' })]
    expect(carryOverRows(prev).find(r => r.section === '영업')!.thisContent).toBe('1. A\n\n2. B')
  })
  it('상속 키 구분명(toString 등)도 내용을 버리지 않는다 — 구분 조회가 프로토타입 체인을 타지 않는다', () => {
    for (const k of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const prev = [row({ sortOrder: 1, section: k, nextContent: '1. 잃으면 안 되는 내용' })]
      expect(carryOverRows(prev).filter(r => r.thisContent === '1. 잃으면 안 되는 내용'), k).toHaveLength(1)
    }
  })
  it('병합 결과가 셀 상한을 넘지 않게 클램프 — 넘치면 저장 불가 셀이 시드된다', () => {
    const half = 'x'.repeat(WEEKLY_CELL_MAX - 10)
    const prev = [
      row({ id: 'a', sortOrder: 1, section: '관리회계', nextContent: half }),
      row({ id: 'b', sortOrder: 2, section: '관리회계', nextContent: half }),
    ]
    const merged = carryOverRows(prev).find(r => r.section === '관리회계')!.thisContent
    expect(merged.length).toBeLessThanOrEqual(WEEKLY_CELL_MAX)
    expect(merged.startsWith(half)).toBe(true) // 앞부분은 보존
  })
})

describe('applyServerRow', () => {
  const local = row({ thisContent: '입력중(dirty)', nextContent: '로컬낡음' })
  const server = row({ thisContent: '서버값1', nextContent: '서버값2', module: '변경모듈' })
  it('dirty 셀은 로컬 유지, 나머지는 서버 채택(구조 필드 포함)', () => {
    const merged = applyServerRow(local, server, new Set(['r1:this_content']))
    expect(merged.thisContent).toBe('입력중(dirty)')
    expect(merged.nextContent).toBe('서버값2')
    expect(merged.module).toBe('변경모듈')
  })
  it('dirty 없으면 서버 그대로', () => {
    expect(applyServerRow(local, server, new Set())).toEqual(server)
  })
})

describe('defaultWeeklyRows', () => {
  const rows = defaultWeeklyRows()
  it('업무영역 11행 — 구분 순서 보존(PMO 선두), sortOrder 1부터 연속, module은 빈값', () => {
    expect(rows).toHaveLength(11)
    expect(rows[0].section).toBe('PMO') // 맨 앞이 PMO
    expect(rows.map(r => r.section)).toEqual([...WEEKLY_SECTIONS])
    // 개수를 상수에서 끌어와 구분이 늘 때마다 이 단언을 손보지 않게 한다.
    expect(rows.map(r => r.sortOrder)).toEqual(Array.from({ length: WEEKLY_SECTIONS.length }, (_, i) => i + 1))
    expect(rows.every(r => r.module === '')).toBe(true)
  })
  it('셀 4개는 모두 빈값', () => {
    for (const r of rows) expect(r.thisContent + r.thisIssue + r.nextContent + r.nextIssue).toBe('')
  })
})

describe('sortWeeklyRows', () => {
  it('백필된 표준 구분을 이름 순서대로 놓고 비표준 행은 뒤로 보낸다', () => {
    // 과거 시트의 sort_order는 주차마다 다르다(PMO 백필 주차는 -10·1..9, 이후 주차는 1..10).
    // 숫자를 신뢰하면 중간 삽입 구분이 엉뚱한 자리에 서므로, 표시 순서는 이름이 정한다.
    const rows = [
      row({ id: 'other', section: '기타 구분', module: '', sortOrder: 0 }),
      row({ id: 'logistics', section: '물류', module: '', sortOrder: 7 }),
      row({ id: 'standard', section: '표준화', module: '', sortOrder: -4 }),
      row({ id: 'ops', section: '조업', module: '', sortOrder: 6 }),
      row({ id: 'custom', section: '기타', module: '', sortOrder: -1 }),
    ]

    expect(sortWeeklyRows(rows).map(r => r.id)).toEqual([
      'ops', 'standard', 'logistics', 'custom', 'other',
    ])
  })
  it('폐지된 조업및표준화 행은 표준 구분 뒤로 밀린다 — 이관 전에도 순서가 흔들리지 않게', () => {
    const rows = [
      row({ id: 'merged', section: '조업및표준화', module: '', sortOrder: 7 }),
      row({ id: 'ops', section: '조업', module: '', sortOrder: 7 }),
      row({ id: 'pmo', section: 'PMO', module: '', sortOrder: 1 }),
    ]
    expect(sortWeeklyRows(rows).map(r => r.id)).toEqual(['pmo', 'ops', 'merged'])
  })
})

describe('isWeeklyCellKey', () => {
  it('화이트리스트만 통과', () => {
    expect(isWeeklyCellKey('this_content')).toBe(true)
    expect(isWeeklyCellKey('next_issue')).toBe(true)
    expect(isWeeklyCellKey('section')).toBe(false)     // 구조 필드는 셀 저장 경로로 못 바꿈
    expect(isWeeklyCellKey('id; drop table')).toBe(false)
  })
})

/* ── SP4 주간 영역(스펙 §4.1.1·D32·Q37) — 행은 영역 id 로 묶이고 순서·라벨은 영역에서 온다 ── */
const area = (over: Partial<WeeklyArea> & { id: string }): WeeklyArea =>
  ({ code: over.id, name: over.id, sortOrder: 0, active: true, teams: [], ...over })
const arow = (id: string, areaId: string, over: Partial<WeeklyAreaRow> = {}): WeeklyAreaRow =>
  ({ id, reportId: 'rep', areaId, thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over })

describe('orderAreas — (sortOrder, code, id), 동률도 결정적', () => {
  it('sortOrder 가 같으면 code, code 도 같으면 id — 입력 순서와 무관하다', () => {
    const areas = [
      area({ id: 'z2', code: 'B', sortOrder: 1 }), area({ id: 'a1', code: 'A', sortOrder: 1 }),
      area({ id: 'z1', code: 'B', sortOrder: 1 }), area({ id: 'm', code: 'Z', sortOrder: 0 }),
    ]
    const want = ['m', 'a1', 'z1', 'z2']
    expect(orderAreas(areas).map((a) => a.id)).toEqual(want)
    expect(orderAreas([...areas].reverse()).map((a) => a.id)).toEqual(want)
  })
  it('입력 배열을 바꾸지 않는다', () => {
    const areas = [area({ id: 'b', sortOrder: 2 }), area({ id: 'a', sortOrder: 1 })]
    orderAreas(areas)
    expect(areas.map((a) => a.id)).toEqual(['b', 'a'])
  })
})

describe('hasContent — 칸 집합별 술어 하나, 공백뿐은 내용이 아니다(Q37)', () => {
  it('ALL_CELLS 는 네 칸, NEXT_CELLS 는 차주 두 칸만 본다', () => {
    expect(hasContent(arow('r', 'a', { thisContent: '실적' }), ALL_CELLS)).toBe(true)
    expect(hasContent(arow('r', 'a', { thisContent: '실적' }), NEXT_CELLS)).toBe(false)
    expect(hasContent(arow('r', 'a', { nextIssue: '이슈' }), NEXT_CELLS)).toBe(true)
  })
  it('공백·탭·개행·전각 공백·NBSP 뿐인 칸은 내용이 없다(화면의 trim() 과 같은 판정)', () => {
    expect(hasContent(arow('r', 'a', { thisContent: ' \n\t', nextContent: '　 ' }), ALL_CELLS)).toBe(false)
  })
})

describe('visibleRows — 활성 영역 행(영역 순) → 내용 있는 비활성 영역 행 → 내용 있는 모르는 영역 행(D32)', () => {
  const areas = [
    area({ id: 'b', sortOrder: 2 }), area({ id: 'a', sortOrder: 1 }),
    area({ id: 'x', sortOrder: 0, active: false }), area({ id: 'y', sortOrder: 3, active: false }),
  ]
  it('활성은 내용이 없어도 영역 순, 비활성은 내용이 있을 때만 뒤에, 모르는 영역은 내용이 있을 때만 맨 뒤', () => {
    const rows = [
      arow('r-y', 'y'), arow('r-q', 'q', { nextIssue: '영역 목록에 없는 행' }), arow('r-b', 'b'),
      arow('r-x', 'x', { thisContent: '옛 내용' }), arow('r-a', 'a'), arow('r-q2', 'q2'),
    ]
    expect(visibleRows(rows, areas).map((r) => r.id)).toEqual(['r-a', 'r-b', 'r-x', 'r-q'])
  })
  it('같은 영역의 행이 여럿이면(유일 인덱스 이전 데이터) 입력 순을 지킨다', () => {
    const rows = [arow('r2', 'a', { thisContent: '둘' }), arow('r1', 'a', { thisContent: '하나' })]
    expect(visibleRows(rows, areas).map((r) => r.id)).toEqual(['r2', 'r1'])
  })
  it('입력 배열을 바꾸지 않는다', () => {
    const rows = [arow('r-b', 'b'), arow('r-a', 'a')]
    visibleRows(rows, areas)
    expect(rows.map((r) => r.id)).toEqual(['r-b', 'r-a'])
  })
})

describe('rowLabel — 영역 이름, 비활성 표지, 모르는 영역', () => {
  it('활성 = 이름, 비활성 = "이름 (비활성)", 영역 목록에 없음 = 알 수 없는 영역', () => {
    const areas = [area({ id: 'a', name: '실험' }), area({ id: 'x', name: '옛 영역', active: false })]
    expect(rowLabel(arow('r', 'a'), areas)).toBe('실험')
    expect(rowLabel(arow('r', 'x'), areas)).toBe('옛 영역 (비활성)')
    expect(rowLabel(arow('r', 'nope'), areas)).toBe(UNKNOWN_AREA_LABEL)
  })
  it('개명해도 같은 areaId 의 행은 같은 영역이다 — 라벨만 바뀌고 행·셀은 그대로(W14)', () => {
    const before = [area({ id: 'a', code: 'EXP', name: '실험' })]
    const after = [area({ id: 'a', code: 'EXP', name: '실험 설계' })]
    const r = arow('r', 'a', { thisContent: '그대로' })
    expect(visibleRows([r], after)).toEqual([r])
    expect([rowLabel(r, before), rowLabel(r, after)]).toEqual(['실험', '실험 설계'])
  })
})

describe('areasForTeam — 그 code 의 팀이 주·보조로 든 영역(공용·전용 팀 둘 다, D24·W18)', () => {
  it('같은 code 의 전용·공용 팀 어느 쪽이 붙어도 그 영역이다 — 대소문자는 그대로 비교한다', () => {
    const teams = [{ id: 't-own', code: 'RES' }, { id: 't-common', code: 'RES' }, { id: 't-ops', code: 'OPS' }]
    const areas = [
      area({ id: 'a1', teams: [{ teamId: 't-own', kind: 'primary' }] }),
      area({ id: 'a2', teams: [{ teamId: 't-common', kind: 'support' }] }),
      area({ id: 'a3', teams: [{ teamId: 't-ops', kind: 'primary' }] }),
    ]
    expect([...areasForTeam(areas, teams, 'RES')].sort()).toEqual(['a1', 'a2'])
    expect(areasForTeam(areas, teams, 'res').size).toBe(0)
    expect(areasForTeam(areas, teams, 'NONE').size).toBe(0)
  })
})

describe.each(SYNTHETIC_CONFIGS.map((c) => [c.id] as const))('합성 구성 %s — 영역 함수', (id) => {
  const areas = SYNTHETIC_WEEKLY_AREAS[id]
  const teams = SYNTHETIC_TEAMS[id]
  it('모든 팀이 영역을 하나 이상 맡고, areasForTeam 은 주·보조를 모두 센다', () => {
    for (const t of teams) {
      const want = areas.filter((a) => a.teams.some((x) => x.teamId === t.id)).map((a) => a.id).sort()
      expect([...areasForTeam(areas, teams, t.code)].sort(), t.code).toEqual(want)
      expect(want.length, t.code).toBeGreaterThan(0)
    }
  })
  it('모든 영역이 활성이면 보이는 행은 영역 순서 그대로', () => {
    const rows = [...areas].reverse().map((a, i) => arow(`r${i}`, a.id))
    expect(visibleRows(rows, areas).map((r) => r.areaId)).toEqual(orderAreas(areas).map((a) => a.id))
  })
})
