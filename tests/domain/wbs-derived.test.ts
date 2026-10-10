// WBS 표시용 파생값(사용자 테스트 BUG-05·12·14·15) — 표·간트·상세 패널·검색이 같은 함수를 쓴다.
import { describe, expect, it } from 'vitest'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'
import {
  compareOutlineNumbers, ganttAxisRange, nextDetailSelection, outlineNumbers, outlineNumbersOfRows, outOfProjectRangeIds,
  shownSchedules, wbsNumberedName,
} from '@/lib/domain/wbsDerived'
import { calUtcSun } from '../helpers/calendarFixture'

const row = (over: Partial<WbsRow>): WbsRow => ({ id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
  plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over })
const tree = (rows: WbsRow[]) => computeTree(rows, '2026-10-10', calUtcSun, { subActTeamOrder: new Map([['A', 0], ['B', 1]]) })

// 리포트의 트리 — 화면에서 추가한 항목이라 저장 code 는 이름의 첫 낱말이다
const REPORT = [
  row({ id: 'p', code: '1', name: '1. 착수준비', sortOrder: 1 }),
  row({ id: 'a', parentId: 'p', code: '요구사항', name: '요구사항 분석', sortOrder: 1 }),
  row({ id: 'b', parentId: 'p', code: '환경', name: '환경 구성', sortOrder: 2 }),
  row({ id: 'a1', parentId: 'a', code: '현행', name: '현행 업무 인터뷰', sortOrder: 1 }),
]

describe('[BUG-05] 개요 번호 — 트리 위치에서 계산한다(저장 code 가 아니다)', () => {
  it('리포트의 기대 표: 1 / 1.1 / 1.2 / 1.1.1', () => {
    const n = outlineNumbers(tree(REPORT))
    expect([n.get('p'), n.get('a'), n.get('b'), n.get('a1')]).toEqual(['1', '1.1', '1.2', '1.1.1'])
  })
  it('평탄한 행에서 낸 번호(검색)가 계산된 트리의 번호(표·상세 패널)와 같다 — 입력 순서와 무관하게 sort_order 로', () => {
    const fromTree = outlineNumbers(tree(REPORT))
    const shuffled = [REPORT[3], REPORT[2], REPORT[0], REPORT[1]]
    expect(outlineNumbersOfRows(shuffled, { subActTeamOrder: new Map() })).toEqual(fromTree)
  })
  it('담당 분리 형제는 팀 순서로 놓인다 — 표와 같은 정렬(buildTree)이라 번호도 같다', () => {
    const rows = [
      row({ id: 'act', sortOrder: 1 }),
      row({ id: 's1', parentId: 'act', sortOrder: 1, isOwnerSplit: true, owners: [{ team: 'B', kind: 'primary' }] }),
      row({ id: 's2', parentId: 'act', sortOrder: 2, isOwnerSplit: true, owners: [{ team: 'A', kind: 'primary' }] }),
    ]
    const opts = { subActTeamOrder: new Map([['A', 0], ['B', 1]]) }
    const n = outlineNumbersOfRows(rows, opts)
    expect([n.get('s2'), n.get('s1')]).toEqual(['1.1', '1.2'])
    expect(n).toEqual(outlineNumbers(tree(rows)))
  })
  it('빈 트리는 빈 지도', () => { expect(outlineNumbers([]).size).toBe(0) })
})

describe('[BUG-05] wbsNumberedName — 검색 결과의 "번호 이름"(중복 출력 없음)', () => {
  it('번호 + 이름', () => { expect(wbsNumberedName('1.1', '요구사항 분석')).toBe('1.1 요구사항 분석') })
  it('이름이 이미 그 번호로 시작하면 다시 붙이지 않는다', () => {
    expect(wbsNumberedName('1', '1. 착수준비')).toBe('1. 착수준비')
    expect(wbsNumberedName('2.1', '2.1 화면설계')).toBe('2.1 화면설계')
  })
  it('번호 뒤가 숫자로 이어지면 다른 번호다 — 붙인다', () => {
    expect(wbsNumberedName('1', '1.1 분석')).toBe('1 1.1 분석')
    expect(wbsNumberedName('1', '10 준비')).toBe('1 10 준비')
  })
  it('번호가 없으면 이름만', () => { expect([wbsNumberedName('', '분석'), wbsNumberedName(null, '분석')]).toEqual(['분석', '분석']) })
  it('compareOutlineNumbers — 마디를 수로 견준다, 빈 번호는 뒤', () => {
    expect(['1.10', '2', '', '1.9', '1'].sort(compareOutlineNumbers)).toEqual(['1', '1.9', '1.10', '2', ''])
  })
})

describe('[BUG-12] 표시 일정 — 직접 입력이 먼저, 없으면 하위의 min(시작)·max(종료)', () => {
  const rows = [
    row({ id: 'p', sortOrder: 1 }),
    row({ id: 'a', parentId: 'p', sortOrder: 1 }),
    row({ id: 'a1', parentId: 'a', sortOrder: 1, plannedStart: '2026-10-12', plannedEnd: '2026-10-16' }),
    row({ id: 'a2', parentId: 'a', sortOrder: 2, plannedStart: '2026-10-14', plannedEnd: '2026-10-30' }),
    row({ id: 'b', parentId: 'p', sortOrder: 2, plannedStart: '2026-11-02', plannedEnd: '2026-11-20' }),
    row({ id: 'b1', parentId: 'b', sortOrder: 1, plannedStart: '2026-10-01', plannedEnd: '2026-12-31' }),
    row({ id: 'c', parentId: 'p', sortOrder: 3 }),
    row({ id: 'c1', parentId: 'c', sortOrder: 1 }),
  ]
  const s = shownSchedules(tree(rows))
  it('일정 없는 상위는 하위에서 계산하고 파생임을 표시한다(손자의 일정이 두 단계 위까지)', () => {
    expect(s.get('a')).toEqual({ start: '2026-10-12', end: '2026-10-30', startDerived: true, endDerived: true })
    // b 는 직접 입력(11/2~11/20)이 그대로 범위에 든다 — b1 의 일정으로 넓어지지 않는다
    expect(s.get('p')).toEqual({ start: '2026-10-12', end: '2026-11-20', startDerived: true, endDerived: true })
  })
  it('직접 입력한 상위는 하위가 더 넓어도 자기 값 그대로(파생 아님)', () => {
    expect(s.get('b')).toEqual({ start: '2026-11-02', end: '2026-11-20', startDerived: false, endDerived: false })
  })
  it('하위에도 일정이 없으면 빈 값(파생 아님)', () => {
    expect(s.get('c')).toEqual({ start: null, end: null, startDerived: false, endDerived: false })
  })
  it('잎은 자기 값 그대로', () => {
    expect(s.get('a1')).toEqual({ start: '2026-10-12', end: '2026-10-16', startDerived: false, endDerived: false })
    expect(s.get('c1')).toEqual({ start: null, end: null, startDerived: false, endDerived: false })
  })
  it('칸마다 따로 — 시작만 직접 입력한 상위는 종료만 파생', () => {
    const half = shownSchedules(tree([
      row({ id: 'p', sortOrder: 1, plannedStart: '2026-10-01' }),
      row({ id: 'x', parentId: 'p', sortOrder: 1, plannedStart: '2026-10-05', plannedEnd: '2026-10-09' }),
    ]))
    expect(half.get('p')).toEqual({ start: '2026-10-01', end: '2026-10-09', startDerived: false, endDerived: true })
  })
  it('표시 전용이다 — 상위의 계획%·실적%(롤업)는 일정 파생과 무관하게 그대로', () => {
    const [p] = tree(rows)
    expect(p.plannedStart).toBeNull()   // 트리의 값은 바뀌지 않는다(DB 에도 쓰지 않는다)
    expect(p.plannedPct).toBe(tree(rows)[0].plannedPct)
  })
})

describe('[BUG-14] 프로젝트 기간 밖 작업·간트 축 범위', () => {
  const rows = [
    row({ id: 'p', sortOrder: 1 }),
    row({ id: 'in', parentId: 'p', sortOrder: 1, plannedStart: '2026-10-12', plannedEnd: '2026-12-31' }),          // 경계 포함 — 안
    row({ id: 'late', parentId: 'p', sortOrder: 2, plannedStart: '2027-03-01', plannedEnd: '2027-03-10' }),       // 리포트의 사례
    row({ id: 'early', parentId: 'p', sortOrder: 3, plannedStart: '2026-10-01', plannedEnd: '2026-10-20' }),
    row({ id: 'none', parentId: 'p', sortOrder: 4 }),
  ]
  it('직접 입력한 일정이 기간을 벗어난 항목만 센다 — 파생 일정의 상위·일정 없는 항목은 세지 않는다', () => {
    expect([...outOfProjectRangeIds(tree(rows), '2026-10-12', '2026-12-31')].sort()).toEqual(['early', 'late'])
  })
  it('기간의 한쪽만 있으면 그쪽만, 기간이 없으면 0건', () => {
    expect([...outOfProjectRangeIds(tree(rows), '2026-10-12', null)]).toEqual(['early'])
    expect([...outOfProjectRangeIds(tree(rows), null, '2026-12-31')]).toEqual(['late'])
    expect(outOfProjectRangeIds(tree(rows), null, undefined).size).toBe(0)
  })
  it('축 = min(프로젝트 시작, 가장 이른 날) ~ max(프로젝트 종료, 가장 늦은 날)', () => {
    expect(ganttAxisRange(['2027-03-01', '2027-03-10', '2026-10-10'], '2026-10-12', '2026-12-31')).toEqual({ start: '2026-10-10', end: '2027-03-10' })
    // 작업이 기간 안쪽에만 있어도 프로젝트 기간 전체가 보인다
    expect(ganttAxisRange(['2026-11-01', '2026-11-10'], '2026-10-12', '2026-12-31')).toEqual({ start: '2026-10-12', end: '2026-12-31' })
    expect(ganttAxisRange(['2026-11-01', null], null, undefined)).toEqual({ start: '2026-11-01', end: '2026-11-01' })
    expect(ganttAxisRange([], null, null)).toBeNull()
  })
})

describe('[BUG-15] 상세 패널이 열린 채 행을 누르면 — 다른 행이면 전환, 같은 행이면 닫기', () => {
  it('nextDetailSelection', () => {
    expect(nextDetailSelection('a', 'b')).toBe('b')
    expect(nextDetailSelection('a', 'a')).toBeNull()
    expect(nextDetailSelection(null, 'a')).toBe('a')
  })
})
