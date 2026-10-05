import { describe, it, expect } from 'vitest'
import { buildAoaWithProfile, buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { parseWithProfile, linkByDepth } from '@/lib/excel/parseWithProfile'
import { deriveStandardExcelProfile } from '@/lib/excel/standardProfile'
import { splitLeafOwners } from '@/lib/excel/validate'
import type { WbsRow } from '@/lib/domain/types'
import type { FieldDef } from '@/lib/domain/customFields'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap } from '@/lib/domain/teams'
import { calUtcSun } from '../helpers/calendarFixture'

const OPTS = { subActTeamOrder: teamOrderMap(['PMO', 'ERP']) }

const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x',
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, ...over,
})

describe('WBS Excel 사용자 정의 필드 왕복 (SP5c §3.6.7)', () => {
  const customFields: FieldDef[] = [
    {
      key: 'cf_num',
      label: '난이도점수',
      description: '작업 난이도',
      type: 'number',
      required: false,
      editable_by: 'member',
      show_in_list: true,
      searchable: true,
      sort: 10,
      active: true,
      limits: { decimals: 0 },
    },
    {
      key: 'cf_date',
      label: '검수희망일',
      description: '검수 희망일',
      type: 'date',
      required: false,
      editable_by: 'member',
      show_in_list: true,
      searchable: false,
      sort: 20,
      active: true,
    },
    {
      key: 'cf_text',
      label: '비고메모',
      description: '추가 비고',
      type: 'text',
      required: false,
      editable_by: 'member',
      show_in_list: true,
      searchable: true,
      sort: 30,
      active: true,
    },
    {
      key: 'cf_inactive',
      label: '비활성필드',
      description: '숨김',
      type: 'text',
      required: false,
      editable_by: 'member',
      show_in_list: true,
      searchable: false,
      sort: 40,
      active: false,
    },
  ]

  const SRC: WbsRow[] = [
    row({
      id: 'P1', parentId: null, code: '1', sortOrder: 0, name: '1. 단계',
      custom: { cf_num: 10, cf_date: '2026-10-15', cf_text: '상위메모' },
    }),
    row({
      id: 'A1', parentId: 'P1', code: '1.1', sortOrder: 1, name: '세부작업',
      deliverable: '산출물', plannedStart: '2026-10-01', plannedEnd: '2026-10-10', actualPct: 80,
      owners: [{ team: 'PMO', kind: 'primary' }, { team: 'ERP', kind: 'support' }],
      custom: { cf_num: 5, cf_date: '2026-10-08', cf_text: '실행메모' },
    }),
  ]

  const items = computeTree(SRC, '2026-10-01', calUtcSun, OPTS)

  it('deriveStandardExcelProfile — 활성 필드만 customColumns 에 등록된다', () => {
    const profile = deriveStandardExcelProfile(['PMO', 'ERP'], ['Phase', 'Activity'], customFields)
    expect(profile.customColumns).toEqual([
      [13, 'cf_num'],
      [14, 'cf_date'],
      [15, 'cf_text'],
    ])
  })

  it('buildAoaWithProfile — 헤더 라벨과 행 데이터(타입 보존)가 올바르게 배치된다', () => {
    const profile = deriveStandardExcelProfile(['PMO', 'ERP'], ['Phase', 'Activity'], customFields)
    const built = buildAoaWithProfile(items, profile, {
      expandSubActs: false,
      levelLabels: ['Phase', 'Activity'],
      customFieldDefs: customFields,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const aoa = built.aoa
    const headerRow = aoa[profile.headerRow] as unknown[]

    expect(headerRow[13]).toBe('난이도점수')
    expect(headerRow[14]).toBe('검수희망일')
    expect(headerRow[15]).toBe('비고메모')

    const dataRow1 = aoa[profile.headerRow + 1] as unknown[]
    expect(dataRow1[13]).toBe(10)
    expect(dataRow1[14]).toBeInstanceOf(Date)
    expect(dataRow1[15]).toBe('상위메모')

    const dataRow2 = aoa[profile.headerRow + 2] as unknown[]
    expect(dataRow2[13]).toBe(5)
    expect(dataRow2[14]).toBeInstanceOf(Date)
    expect(dataRow2[15]).toBe('실행메모')
  })

  it('엑셀 파일 왕복(export → parse → link → split) — custom 값이 온전히 복원된다', () => {
    const profile = deriveStandardExcelProfile(['PMO', 'ERP'], ['Phase', 'Activity'], customFields)
    const exported = buildWorkbookWithProfile(items, profile, [], {
      expandSubActs: false,
      levelLabels: ['Phase', 'Activity'],
      customFieldDefs: customFields,
    })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return

    const parsed = parseWithProfile(exported.buffer, profile)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.rows.length).toBe(2)
    expect(parsed.rows[0].custom).toEqual({
      cf_num: 10,
      cf_date: '2026-10-15',
      cf_text: '상위메모',
    })
    expect(parsed.rows[1].custom).toEqual({
      cf_num: 5,
      cf_date: '2026-10-08',
      cf_text: '실행메모',
    })

    const linked = linkByDepth(parsed.rows)
    expect(linked.ok).toBe(true)
    if (!linked.ok) return

    expect(linked.items[0].custom).toEqual(parsed.rows[0].custom)
    expect(linked.items[1].custom).toEqual(parsed.rows[1].custom)

    const split = splitLeafOwners(linked.items)
    // A1 이 복수 담당(PMO, ERP)이므로 분리되어 자식 sub-act 에도 custom 이 승계된다
    const subActs = split.filter((i) => i.isOwnerSplit)
    expect(subActs.length).toBe(2)
    for (const sub of subActs) {
      expect(sub.custom).toEqual({
        cf_num: 5,
        cf_date: '2026-10-08',
        cf_text: '실행메모',
      })
    }
  })
})
