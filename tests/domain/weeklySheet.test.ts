import { describe, it, expect } from 'vitest'
import {
  applyServerRow, isWeeklyCellKey,
  ALL_CELLS, NEXT_CELLS, UNKNOWN_AREA_LABEL, areasForTeam, hasContent, orderAreas, rowLabel, visibleRows,
  type WeeklyArea, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'
import { SYNTHETIC_TEAMS } from '../fixtures/synthetic/teams'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'

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
const arow = (id: string, areaId: string, over: Partial<WeeklySheetRow> = {}): WeeklySheetRow =>
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

describe('applyServerRow — dirty 칸만 로컬, 나머지(영역 id 포함)는 서버', () => {
  const local = arow('r1', 'a-exp', { thisContent: '입력중(dirty)', nextContent: '로컬낡음' })
  const server = arow('r1', 'a-data', { thisContent: '서버값1', nextContent: '서버값2' })
  it('dirty 셀은 로컬 유지, 나머지는 서버 채택', () => {
    const merged = applyServerRow(local, server, new Set(['r1:this_content']))
    expect(merged.thisContent).toBe('입력중(dirty)')
    expect(merged.nextContent).toBe('서버값2')
    expect(merged.areaId).toBe('a-data')
  })
  it('dirty 없으면 서버 그대로', () => {
    expect(applyServerRow(local, server, new Set())).toEqual(server)
  })
})

describe('모듈 표면 — 옛 구분 체계의 이름이 없다(스펙 §4.1.1·E5)', () => {
  it('옛 상수·정렬·라벨·묶음·이월 함수를 내보내지 않는다(이월은 weeklyCarry.ts)', async () => {
    const surface = Object.keys(await import('@/lib/domain/weeklySheet'))
    for (const name of ['WEEKLY_SECTIONS', 'WEEKLY_TEAM_SECTIONS', 'sortWeeklyRows', 'rowSectionLabel', 'sectionKeyOf', 'carryOverRows', 'defaultWeeklyRows']) {
      expect(surface, name).not.toContain(name)
    }
  })
})
