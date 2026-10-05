import { describe, expect, it } from 'vitest'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'
import { buildWbsExportCatalog } from '@/lib/report/catalog/wbsExportBuild'
import { calUtcMon } from '../../helpers/calendarFixture'

const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
  plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over,
})

describe('buildWbsExportCatalog (정본 §4.5.3)', () => {
  it('트리를 펼치고, 빈 가중치는 null, 상태 라벨은 칸반과 같다', () => {
    const items = computeTree([
      row({ id: 'a', code: 'A', name: '부모' }),
      row({
        id: 'b', parentId: 'a', code: 'B', name: '잎', weight: 0.5, deliverable: '산출',
        plannedStart: '2026-09-01', plannedEnd: '2026-10-01', actualPct: 0,
        owners: [{ team: 'RES', kind: 'primary' }, { team: 'OPS', kind: 'support' }],
        custom: { note: ['가', '나'] },
      }),
    ], '2026-10-07', calUtcMon, { subActTeamOrder: new Map() })
    const catalog = buildWbsExportCatalog({
      project: { name: 'Acme', start_date: null, end_date: '2026-12-31', levelLabels: ['단계', '작업'] },
      items,
      today: '2026-10-07',
      teams: [{ code: 'RES', name: '자원', color: '#111' }, { code: 'OPS', name: '운영', color: '#222' }],
      fieldKeys: ['note'],
    })
    expect(catalog.project).toEqual({ name: 'Acme', start_date: '', end_date: '2026-12-31', level_labels: ['단계', '작업'] })
    expect(catalog.wbs_items.map((item) => item.code)).toEqual(['A', 'B'])
    const leaf = catalog.wbs_items[1]
    expect(leaf.level_label).toBe('작업')
    expect(leaf.weight_pct).toBe(50)
    expect(catalog.wbs_items[0].weight_pct).toBeNull()
    expect(leaf.owner_text).toBe('RES (OPS)')
    expect(leaf.owners).toEqual([
      { team_code: 'RES', team_name: '자원', kind: 'primary' },
      { team_code: 'OPS', team_name: '운영', kind: 'support' },
    ])
    expect(leaf.deliverable).toBe('산출')
    expect(leaf.delay_days).toBe(6)
    expect(leaf.status_label).toBe('지연')
    expect(leaf.custom.note).toEqual(['가', '나'])
  })

  it('없는 루트는 빈 값이다', () => {
    const catalog = buildWbsExportCatalog({})
    expect(catalog.wbs_items).toEqual([])
    expect(catalog.kpi.total).toBe(0)
    expect(catalog.project.name).toBe('')
  })
})

