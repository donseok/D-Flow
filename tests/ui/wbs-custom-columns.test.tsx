// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import type { FieldDef } from '@/lib/domain/customFields'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('@/app/actions/customFieldValues', () => ({ saveCustomFieldValues: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (key: string) => key }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { CustomFieldsProvider } from '@/components/fields/CustomFieldValuesEditor'
import { calInputUtcMon } from '../helpers/calendarFixture'

const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'qty', label: '수량', description: '', type: 'number', required: false, editable_by: 'member',
  show_in_list: true, searchable: false, sort: 0, active: true, ...over,
} as FieldDef)

const base: ComputedItem = {
  id: 'a1', parentId: null, code: '1', sortOrder: 0, name: '일정 항목', biz: null, deliverable: null,
  plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: 1, actualPct: 0, owners: [], isOwnerSplit: false,
  plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0,
}

const cell = (c: HTMLElement, k: string) => [...c.querySelectorAll(`[data-wbs-col="${k}"]`)].at(-1)

describe('WbsGanttSheet — 사용자 정의 필드 열', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  async function render(defs: FieldDef[] | null, custom: unknown) {
    await act(async () => root.render(
      <CustomFieldsProvider projectId="p1" entity="wbs_item" defs={defs} canAdmin={false} locale="ko">
        <WbsGanttSheet levelLabels={['Phase', 'Task']} items={[{ ...base, custom: custom as never }]} calendar={calInputUtcMon}
          today="2026-07-03" actorView={null} projectId="p1" readOnly />
      </CustomFieldsProvider>,
    ))
  }

  it('show_in_list 활성 필드만 열을 만들고 0·false 를 그대로 보인다', async () => {
    await render([def({}), def({ key: 'ok', label: '승인', type: 'boolean', sort: 1 }), def({ key: 'hid', label: '숨김', show_in_list: false, sort: 2 }), def({ key: 'off', label: '꺼짐', active: false, sort: 3 })], { qty: 0, ok: false })
    expect(cell(container, 'cf:qty')?.textContent).toBe('0')
    expect(cell(container, 'cf:ok')?.textContent).toBe('아니오')
    expect(cell(container, 'cf:hid')).toBeUndefined()
    expect(cell(container, 'cf:off')).toBeUndefined()
    expect(container.textContent).toContain('수량')
  })

  it('값이 없으면 빈 표시, 손상 값은 경고 표식', async () => {
    await render([def({})], {})
    expect(cell(container, 'cf:qty')?.textContent).toBe('—')
    await render([def({})], { qty: { bad: true } })
    expect(cell(container, 'cf:qty')?.textContent).toBe('!')
  })

  it('정의를 읽지 못하면(null) 열을 만들지 않는다', async () => {
    await render(null, { qty: 1 })
    expect(container.querySelector('[data-wbs-col^="cf:"]')).toBeNull()
  })
})
