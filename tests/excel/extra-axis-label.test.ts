import { describe, expect, it } from 'vitest'
import { buildAoaWithProfile, buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { deriveStandardExcelProfile, resolveTeamColumns } from '@/lib/excel/standardProfile'
import { detectHeaderRow, detectLogicalColumns, detectWorkbook } from '@/lib/excel/detect'
import { parseWithProfile } from '@/lib/excel/parseWithProfile'
import { HEADER } from '@/lib/excel/headerWords'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap } from '@/lib/domain/teams'
import type { WbsRow } from '@/lib/domain/types'
import { calUtcSun } from '../helpers/calendarFixture'

// 추가 축 이름(core.extra_axis_label) — 내보내기는 그 열의 머리를 설정 이름으로 쓰고, 감지기는 그 이름을 그 열의 별칭으로 함께 본다.
// 둘이 같이 가야 왕복한다: 머리만 바꾸면 다시 가져올 때 그 열을 못 찾아 값이 빠진다.
const TEAMS = ['RES', 'OPS']
const LABELS = ['단계', '작업', '세부']
const AXIS = '트랙'
const row = (over: Partial<WbsRow>): WbsRow => ({ id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
  plannedStart: '2026-03-02', plannedEnd: '2026-03-06', weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over })
const ROWS: WbsRow[] = [
  row({ id: 'A', code: '1', sortOrder: 0, name: '첫 단계', biz: '가' }),
  row({ id: 'B', parentId: 'A', code: '1.1', sortOrder: 1, name: '첫 작업', biz: '나' }),
  row({ id: 'C', parentId: 'B', code: '1.1.1', sortOrder: 2, name: '첫 세부', biz: '다', deliverable: '보고서', owners: [{ team: 'RES', kind: 'primary' }] }),
]
const items = computeTree(ROWS, '2026-03-04', calUtcSun, { subActTeamOrder: teamOrderMap(TEAMS) })
const profile = deriveStandardExcelProfile(resolveTeamColumns(items, TEAMS), LABELS)
const base = { expandSubActs: false, levelLabels: LABELS, deep: 'fold' as const }
const axisCol = profile.logical.extraAxis!

describe('엑셀 머리 — 추가 축 열', () => {
  it('설정 이름이 있으면 그 이름으로, 없으면(null·생략) 기본 낱말로 쓴다', () => {
    const headerOf = (extraAxisLabel?: string | null) => {
      const built = buildAoaWithProfile(items, profile, { ...base, extraAxisLabel }, 'Acme')
      if (!built.ok) throw new Error(built.error)
      return built.aoa[profile.headerRow][axisCol]
    }
    expect(headerOf(AXIS)).toBe(AXIS)
    expect(headerOf(null)).toBe(HEADER.extraAxis)
    expect(headerOf()).toBe(HEADER.extraAxis)
  })
})

describe('감지 — 추가 축 이름을 그 열의 별칭으로 본다', () => {
  it('설정 이름 머리는 이름을 넘겨야 추가 축 열로 잡힌다(대소문자·앞뒤 공백 무시)', () => {
    const labels = [' track ', '산출물']
    expect(detectLogicalColumns(labels.map((l) => l.trim()), new Set(), 'Track').logical.extraAxis).toBe(0)
    expect(detectLogicalColumns(labels.map((l) => l.trim())).logical.extraAxis).toBeNull()
  })
  it('기존 낱말은 설정 이름이 있어도 그대로 잡힌다 — 설정을 바꾸기 전에 낸 파일', () => {
    expect(detectLogicalColumns([HEADER.extraAxis, '산출물'], new Set(), AXIS).logical.extraAxis).toBe(0)
  })
  it('머리 행 점수에도 든다', () => {
    const aoa = [['제목'], [AXIS, '산출물']]
    expect(detectHeaderRow(aoa, 10, AXIS).score).toBe(detectHeaderRow(aoa).score + 1)
  })
  it('왕복 — 설정 이름으로 낸 파일을 같은 이름으로 감지하면 추가 축 값이 돌아온다. 이름 없이 감지하면 그 열을 못 찾는다', () => {
    const built = buildWorkbookWithProfile(items, profile, [], { ...base, extraAxisLabel: AXIS }, 'Acme')
    if (!built.ok) throw new Error(built.error)
    const withLabel = detectWorkbook(built.buffer, { extraAxisLabel: AXIS })
    if (!withLabel.ok) throw new Error(withLabel.error)
    expect(withLabel.result.profile.logical.extraAxis).toBe(axisCol)
    const parsed = parseWithProfile(built.buffer, withLabel.result.profile)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.rows.map((r) => r.extraAxis)).toEqual(['가', '나', '다'])
    const without = detectWorkbook(built.buffer)
    if (!without.ok) throw new Error(without.error)
    expect(without.result.profile.logical.extraAxis).toBeNull()
  })
})
