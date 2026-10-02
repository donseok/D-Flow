import { describe, expect, it } from 'vitest'
import { buildWbsAoa } from '../fixtures/excel/legacyBuild'   // 동등성 오라클 — 옛 원문(P7)
import { LEGACY_EXCEL_PROFILE_V1 } from '../fixtures/excel/legacy-3row-profile'   // 옛 3행 양식(W26 의 비교 기준)
import { buildAoaWithProfile } from '@/lib/excel/exportWithProfile'
import { deriveStandardExcelProfile, resolveTeamColumns } from '@/lib/excel/standardProfile'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap } from '@/lib/domain/teams'
import type { ComputedItem, WbsRow } from '@/lib/domain/types'
import { calUtcSun } from '../helpers/calendarFixture'

// 표준 레이아웃(SP4 D16) — 저장 양식이 없을 때 내보낼 때마다 트리에서 계산한다. 옛 빌더(상태 머리를 고친 뒤 — 과제 9)와 셀 단위로 같다(W23).
const LABELS3 = ['Phase', 'Task', 'Activity']
const LABELS5 = ['단계', '시스템', '서브시스템', '작업묶음', '작업']
const TEAMS = ['R&D', 'Ops']
const OPTS = { subActTeamOrder: teamOrderMap([...TEAMS, 'QA']) }
const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
  plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over,
})
/** 깊이 0..depth 의 한 줄기 + 잎 둘(하나는 비활성 팀 QA 담당 — 활성 목록 밖이라 열이 뒤에 붙는다) + sub-act 둘을 가진 잎 하나 */
function tree(depth: number): ComputedItem[] {
  const rows: WbsRow[] = []
  let parent: string | null = null
  for (let d = 0; d <= depth; d++) {
    const id = `n${d}`
    rows.push(row({ id, parentId: parent, code: `c${d}`, sortOrder: d, name: `깊이${d}`, biz: d === 0 ? 'BZ' : null }))
    parent = id
  }
  rows.push(row({ id: 'L1', parentId: parent, code: 'l1', sortOrder: 90, name: '잎1', deliverable: '보고서', plannedStart: '2026-03-02', plannedEnd: '2026-03-06',
    weight: 2, actualPct: 40, owners: [{ team: 'R&D', kind: 'primary' }, { team: 'QA', kind: 'support' }] }))
  rows.push(row({ id: 'L2', parentId: parent, code: 'l2', sortOrder: 91, name: '잎2', plannedStart: '2026-03-09', plannedEnd: '2026-03-13',
    owners: [{ team: 'Ops', kind: 'primary' }, { team: 'R&D', kind: 'support' }] }))
  rows.push(row({ id: 'S0', parentId: 'L2', code: 'l2', sortOrder: 92, name: '잎2 (Ops 주관)', actualPct: 30, owners: [{ team: 'Ops', kind: 'primary' }], isOwnerSplit: true,
    plannedStart: '2026-03-09', plannedEnd: '2026-03-13' }))
  rows.push(row({ id: 'S1', parentId: 'L2', code: 'l2', sortOrder: 93, name: '잎2 (R&D 지원)', actualPct: 50, owners: [{ team: 'R&D', kind: 'support' }], isOwnerSplit: true,
    plannedStart: '2026-03-09', plannedEnd: '2026-03-13' }))
  return computeTree(rows, '2026-03-11', calUtcSun, OPTS)
}
function standard(items: ComputedItem[], codes: readonly string[], labels: readonly string[], expandSubActs = false): unknown[][] {
  const r = buildAoaWithProfile(items, deriveStandardExcelProfile(resolveTeamColumns(items, codes), labels),
    { expandSubActs, levelLabels: labels, deep: 'fold' }, 'Acme')
  if (!r.ok) throw new Error(r.error)
  return r.aoa
}

describe('deriveStandardExcelProfile — W26', () => {
  it('레거시 5팀·3단이면 옛 3행 양식(LEGACY_EXCEL_PROFILE_V1)과 같다', () => {
    const legacyCodes = LEGACY_EXCEL_PROFILE_V1.teamColumns.map(([, code]) => code)
    expect(deriveStandardExcelProfile(legacyCodes, LABELS3)).toEqual(LEGACY_EXCEL_PROFILE_V1)
  })
  it('열 배치 — 팀 열은 Biz·계층 L열·스페이서 2 뒤, 산출물부터 그 뒤', () => {
    const p = deriveStandardExcelProfile(TEAMS, LABELS5)
    expect(p.hierarchy).toEqual({ kind: 'columns', columns: [1, 2, 3, 4, 5] })
    expect(p.teamColumns).toEqual([[8, 'R&D'], [9, 'Ops']])
    expect(p.logical).toEqual({ extraAxis: 0, code: null, name: null, deliverable: 10, start: 11, end: 12, weight: 13, actualPct: 15 })
    expect(p.ownerMarks).toEqual({ '●': 'primary', '△': 'support' })
  })
  it('단계 이름이 없으면 throw — 표준 양식을 만들 수 없다(라우트가 먼저 409·422 로 거른다)', () => {
    expect(() => deriveStandardExcelProfile(TEAMS, [])).toThrow()
  })
})

describe('resolveTeamColumns', () => {
  it('활성 팀 코드 뒤에 트리 담당에 처음 나온 팀(비활성·sub-act·목록 밖)을 등장 순으로', () => {
    expect(resolveTeamColumns(tree(2), TEAMS)).toEqual(['R&D', 'Ops', 'QA'])
    expect(resolveTeamColumns(tree(2), [])).toEqual(['R&D', 'QA', 'Ops'])
  })
})

describe('표준 레이아웃 ≡ 옛 빌더(셀 단위) — W23', () => {
  it.each([
    ['L=3, 깊이 L 이내', 2, LABELS3],
    ['L=3, 깊이 L 초과 — 마지막 계층 열로 접는다', 4, LABELS3],
    ['L=5', 4, LABELS5],
    ['L=5, 깊이 초과', 6, LABELS5],
  ] as const)('%s(접기)', (_n, depth, labels) => {
    const items = tree(depth)
    expect(standard(items, TEAMS, labels)).toEqual(buildWbsAoa(items, 'Acme', TEAMS, labels))
  })
  it('팀 0개·담당 없음 — 둘째 머리 행에 담당 칸이 없다, 옛 빌더와 같다', () => {
    const items = computeTree([row({ id: 'A', name: '단독' })], '2026-03-11', calUtcSun, { subActTeamOrder: new Map() })
    const aoa = standard(items, [], LABELS3)
    expect(aoa).toEqual(buildWbsAoa(items, 'Acme', [], LABELS3))
    expect(aoa[1]).not.toContain('담당')
  })
  it('마지막 칸은 상태 — 과제 9 뒤의 옛 빌더가 기준이다', () => {
    const aoa = standard(tree(2), TEAMS, LABELS3)
    expect((aoa[2] as unknown[]).at(-1)).toBe('상태')
  })
})

describe('펼침 — sub-act 는 계층 열이 모자랄 때만 insertAt(Q40 정정 — U3), 얕으면 제 깊이의 계층 열, 접는 것은 일반 항목뿐', () => {
  it('깊은 트리 + 펼침: 일반 항목은 마지막 계층 열로 접히고 sub-act 는 insertAt(마지막 계층 열 + 1) 에', () => {
    const aoa = standard(tree(4), TEAMS, LABELS3, true)
    const insertAt = 1 + LABELS3.length   // 마지막 계층 열(3) + 1
    expect((aoa[2] as unknown[])[insertAt]).toBe('세부업무')
    const subRows = aoa.slice(3).filter((r) => (r as unknown[])[insertAt] !== '')
    expect(subRows.map((r) => (r as unknown[])[insertAt]).sort()).toEqual(['잎2 (Ops 주관)', '잎2 (R&D 지원)'].sort())   // 순서는 sub-act 팀 순서 규칙(computeTree)의 몫
    for (const r of subRows) expect((r as unknown[]).slice(1, insertAt)).toEqual(['', '', ''])
    const deep = aoa.slice(3).find((r) => (r as unknown[])[3] === '깊이4')
    expect(deep).toBeDefined()
  })
  it('얕은 트리(sub-act 가 라벨 깊이 안)면 sub-act 는 제 깊이의 계층 열에 — insertAt 은 비어 있다(A2-2 리뷰 정정: 늘 insertAt 이면 깊이를 건너뛰어 왕복이 깨진다)', () => {
    const items = tree(0)   // 잎이 깊이 1, sub-act 가 깊이 2(< L=3)
    const aoa = standard(items, TEAMS, LABELS3, true)
    const insertAt = 1 + LABELS3.length
    expect(aoa.slice(3).filter((r) => (r as unknown[])[insertAt] !== '')).toHaveLength(0)
    const sub = aoa.slice(3).filter((r) => String((r as unknown[])[3]).includes('(') )
    expect(sub).toHaveLength(2)
    for (const r of sub) expect((r as unknown[]).slice(1, 3)).toEqual(['', ''])
  })
})

describe('깊은 트리 — 표준은 접고, 저장 양식은 거부(D16)', () => {
  it('같은 깊은 트리를 deep: reject 로 만들면 지금 거부 문구 그대로', () => {
    const items = tree(4)
    const r = buildAoaWithProfile(items, deriveStandardExcelProfile(TEAMS, LABELS3), { expandSubActs: false, levelLabels: LABELS3 }, 'Acme')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('설정 화면의 "저장된 양식 비우기"')
  })
})
