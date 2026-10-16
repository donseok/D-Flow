import { describe, expect, it } from 'vitest'
import { parseWeeklyColumns, weeklyColumnKeys, weeklyColumnLabels, weeklyValues, type WeeklyColumn } from '@/lib/domain/weeklyColumns'
import { applyServerRow, weeklyField, type WeeklySheetRow } from '@/lib/domain/weeklySheet'
import { carryOverRows, seedOf } from '@/lib/domain/weeklyCarry'
import { advanceActive, clearEdits, fillEdits, pasteEdits, rectFromAddrs, valuesInRect } from '@/lib/domain/sheetSelection'
import { buildWeeklyRewriteSelection } from '@/lib/domain/weeklyRewrite'
import { weeklyCatalogSections } from '@/lib/report/catalog/weeklyBuild'
import { lintWeeklySheet } from '@/lib/domain/weeklyLint'

const columns: WeeklyColumn[] = [
  { id: 'delivery', label: '산출물', carryOver: true },
  { id: 'customer', label: '고객 협의', carryOver: false },
  { id: 'release', label: '배포', carryOver: true },
]
const keys = weeklyColumnKeys(columns)
const area = { id: 'a', code: 'A', name: '개발', active: true, sortOrder: 0, teams: [] }
const row: WeeklySheetRow = { id: 'r', reportId: 'rep', areaId: 'a', thisContent: '', thisIssue: '', nextContent: '', nextIssue: '',
  this_delivery: '완료', next_delivery: '다음 산출물', next_customer: '이월 안 함', next_release: '배포 예정' }

describe('project weekly item layout', () => {
  it('validates bounds, duplicate names/ids and trims names', () => {
    expect(parseWeeklyColumns([]).ok).toBe(false)
    expect(parseWeeklyColumns(Array.from({ length: 13 }, (_, i) => ({ id: `i${i}`, label: `${i}`, carryOver: true }))).ok).toBe(false)
    expect(parseWeeklyColumns([...columns, columns[0]]).ok).toBe(false)
    expect(parseWeeklyColumns([{ ...columns[0], id: '__proto__' }]).ok).toBe(false)
    expect(parseWeeklyColumns([{ ...columns[0], label: '  산출물  ' }])).toEqual({ ok: true, value: [columns[0]] })
    expect(weeklyValues({ project_id: 'attack', this_delivery: 'safe', next_release: 7 })).toEqual({ this_delivery: 'safe' })
  })
  it('keeps identity through rename/reorder and builds both periods', () => {
    const reordered = [{ ...columns[2], label: '운영 배포' }, columns[0]]
    expect(weeklyColumnKeys(reordered)).toEqual(['this_release', 'this_delivery', 'next_release', 'next_delivery'])
    expect(weeklyColumnLabels(reordered).next_release).toBe('차주계획 운영 배포')
    expect(row[weeklyField(weeklyColumnKeys(reordered)[3])]).toBe('다음 산출물')
  })
  it('navigates, pastes, copies, clears and fills a six-column grid', () => {
    const rect = rectFromAddrs(['r'], { rowId: 'r', col: 'this_delivery' }, { rowId: 'r', col: 'next_release' }, keys)!
    expect(rect.right).toBe(5)
    expect(valuesInRect([row], rect, keys)).toEqual([['완료', '', '', '다음 산출물', '이월 안 함', '배포 예정']])
    expect(advanceActive(['r', 'r2'], { rowId: 'r', col: 'next_release' }, 'next', keys)).toEqual({ rowId: 'r2', col: 'this_delivery' })
    expect(pasteEdits(['r'], { rowId: 'r', col: 'next_customer' }, [['x', 'y', 'z']], keys)).toMatchObject({ clippedCols: 1, edits: [{ cellKey: 'next_customer' }, { cellKey: 'next_release' }] })
    expect(clearEdits([row], ['r'], rect, keys)).toHaveLength(4)
    expect(fillEdits([row], ['r'], { top: 0, bottom: 0, left: 0, right: 0 }, rect, keys)).toHaveLength(5)
  })
  it('carries only configured enabled next values, atomically includes them in the seed', () => {
    const result = carryOverRows([row], [area], {}, () => ({}), columns)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows[0]).toMatchObject({ this_delivery: '다음 산출물', this_release: '배포 예정' })
    expect(result.rows[0].this_customer).toBeUndefined()
    expect(seedOf(result.rows)[0].cells).toEqual({ this_delivery: '다음 산출물', this_release: '배포 예정' })
    expect(carryOverRows([{ ...row, areaId: 'old' }], [area], {}, () => ({}), columns)).toMatchObject({ ok: false, pending: [{ areaId: 'old' }] })
    expect(carryOverRows([{ ...row, next_delivery: 'x'.repeat(20001) }], [area], {}, () => ({}), columns)).toMatchObject({ ok: false, overflow: [{ cell: 'this_delivery' }] })
  })
  it('retains dirty dynamic cells on realtime merge, takes clean server cells', () => {
    const merged = applyServerRow(row, { ...row, this_delivery: '다른 사람', next_release: '새 일정' }, new Set(['r:this_delivery']))
    expect(merged.this_delivery).toBe('완료')
    expect(merged.next_release).toBe('새 일정')
  })
  it('uses all configured items in AI selection, lint and report output', () => {
    const rect = { top: 0, bottom: 0, left: 0, right: 5 }
    const selected = buildWeeklyRewriteSelection([row], rect, () => area.name, keys, weeklyColumnLabels(columns))
    expect(selected.map(s => s.label)).toContain('차주계획 배포')
    const sections = weeklyCatalogSections([row], [area], [], columns)
    expect(sections.map(s => s.name)).toEqual(['개발 · 산출물', '개발 · 고객 협의', '개발 · 배포'])
    expect(sections[2].next_content.join('\n')).toContain('배포 예정')
    const findings = lintWeeklySheet([{ ...row, this_release: '1. 첫째\n3. 셋째' }], () => ({ key: 'a', label: '개발' }), undefined, keys)
    expect(findings.some(f => f.cellKey === 'this_release')).toBe(true)
  })
})
