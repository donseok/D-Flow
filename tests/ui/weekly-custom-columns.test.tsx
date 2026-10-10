// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FieldDef } from '@/lib/domain/customFields'
import type { WeeklyArea, WeeklySheetRow } from '@/lib/domain/weeklySheet'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 화면 문구는 사전에서 온다 — 진짜 ko 사전으로 풀어 한국어 단언을 그대로 둔다
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t(k as Parameters<typeof t>[0])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ t: ko }) }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/weekly/usePresence', () => ({ usePresence: () => [] }))
vi.mock('@/components/app/PresenceStrip', () => ({ PresenceStrip: () => null }))
vi.mock('@/app/actions/weekly', () => ({
  createWeeklyReport: vi.fn(), prepareWeeklyCellRewrite: vi.fn(), saveWeeklyCell: vi.fn(),
  saveWeeklyCells: vi.fn(), saveWeeklyTitle: vi.fn(),
}))
vi.mock('@/app/actions/customFieldValues', () => ({ saveCustomFieldValues: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = { on: () => channel, subscribe: () => channel }
    return { channel: () => channel, removeChannel: vi.fn() }
  },
}))

import { WeeklySheetView } from '@/components/weekly/WeeklySheetView'
import { CustomFieldsProvider } from '@/components/fields/CustomFieldValuesEditor'

const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'qty', label: '수량', description: '', type: 'number', required: false, editable_by: 'member',
  show_in_list: true, searchable: false, sort: 0, active: true, ...over,
} as FieldDef)

const AREAS: WeeklyArea[] = [{ id: 'a1', code: 'EXP', name: '실험', sortOrder: 1, active: true, teams: [] }]

const mkRow = (id: string, custom?: unknown): WeeklySheetRow => ({
  id, reportId: 'rep', areaId: 'a1',
  thisContent: '금주 내용', thisIssue: '금주 이슈',
  nextContent: '차주 내용', nextIssue: '차주 이슈',
  custom: custom as never,
})

describe('WeeklySheetView — 사용자 정의 필드 열 및 편집 모달', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function render(defs: FieldDef[] | null, row: WeeklySheetRow) {
    await act(async () => root.render(
      <CustomFieldsProvider projectId="p1" entity="weekly_row" defs={defs} canAdmin={false}>
        <WeeklySheetView
          projectId="p1" weekStart="2026-09-21" weekLabel="9월 4주차" weekTitle="9월 4주차"
          prevWeek="2026-09-14" nextWeek="2026-09-28"
          thisRange="9/21~9/25" nextRange="9/28~10/2" projectName="Acme"
          report={{ id: 'rep', title: '' }} areas={AREAS} initialRows={[row]} hasCarrySource={false}
          me={{ id: 'u1', name: 'alice' }} canEditCells canCreateRound
        />
      </CustomFieldsProvider>,
    ))
  }

  it('show_in_list 활성 필드만 헤더와 셀을 만들고 0·false 를 그대로 보인다', async () => {
    const defs = [
      def({ key: 'qty', label: '수량', type: 'number', sort: 0 }),
      def({ key: 'confirmed', label: '확인', type: 'boolean', sort: 1 }),
      def({ key: 'hidden', label: '숨김', show_in_list: false, sort: 2 }),
      def({ key: 'inactive', label: '비활성', active: false, sort: 3 }),
    ]
    await render(defs, mkRow('r1', { qty: 0, confirmed: false, hidden: '숨김값' }))

    const ths = Array.from(container.querySelectorAll('thead th')).map(th => th.textContent)
    expect(ths).toContain('수량')
    expect(ths).toContain('확인')
    expect(ths).not.toContain('숨김')
    expect(ths).not.toContain('비활성')

    const tds = Array.from(container.querySelectorAll('tbody td')).map(td => td.textContent)
    expect(tds).toContain('0')
    expect(tds).toContain('아니오')
    expect(tds).not.toContain('숨김값')
  })

  it('값이 없으면 빈 표시(—), 손상 값은 경고 표식(!)', async () => {
    await render([def({ key: 'qty', label: '수량' })], mkRow('r1', {}))
    const tdsEmpty = Array.from(container.querySelectorAll('tbody td')).map(td => td.textContent)
    expect(tdsEmpty).toContain('—')

    await render([def({ key: 'qty', label: '수량' })], mkRow('r1', { qty: { bad: true } }))
    const tdsBad = Array.from(container.querySelectorAll('tbody td')).map(td => td.textContent)
    expect(tdsBad).toContain('!')
  })

  it('추가 정보 버튼을 누르면 해당 행의 추가 정보 편집 모달이 열린다', async () => {
    await render([def({ key: 'qty', label: '수량' })], mkRow('r1', { qty: 42 }))
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('추가 정보'))
    expect(btn).toBeDefined()

    await act(async () => { btn?.click() })
    expect(document.body.textContent).toContain('실험 — 추가 정보')
  })
})
