// @vitest-environment jsdom
// 주간 시트 colgroup 의 자식은 <col> 뿐이어야 한다 — 같은 줄의 <col /> 과 주석 사이 공백이 텍스트 노드가 되면 React 가
// "whitespace text nodes cannot be a child of <colgroup>" 를 내고, SSR HTML 을 브라우저 파서가 버려 hydration 이 어긋난다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
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
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = { on: () => channel, subscribe: () => channel }
    return { channel: () => channel, removeChannel: vi.fn() }
  },
}))

const { WeeklySheetView } = await import('@/components/weekly/WeeklySheetView')

const AREAS: WeeklyArea[] = [{ id: 'a1', code: 'EXP', name: '실험', sortOrder: 1, active: true, teams: [] }]
const row: WeeklySheetRow = {
  id: 'r1', reportId: 'rep', areaId: 'a1',
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '',
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('WeeklySheetView — colgroup', () => {
  it('colgroup 의 자식은 <col> 다섯뿐이고 React 가 colgroup 공백 경고를 내지 않는다', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => root.render(
      <WeeklySheetView
        projectId="p1" weekStart="2026-09-21" weekLabel="9월 4주차" weekTitle="9월 4주차"
        prevWeek="2026-09-14" nextWeek="2026-09-28"
        thisRange="9/21~9/25" nextRange="9/28~10/2" projectName="Acme"
        report={{ id: 'rep', title: '' }} areas={AREAS} initialRows={[row]} hasCarrySource={false}
        me={{ id: 'u1', name: 'alice' }} canEditCells canCreateRound
      />,
    ))
    const colgroup = container.querySelector('colgroup')!
    expect(colgroup).not.toBeNull()
    // React 는 'In HTML, whitespace text nodes cannot be a child of <%s>. …' 에 태그 이름을 인자로 넘긴다.
    const nesting = err.mock.calls.filter((c) => String(c[0]).includes('cannot be a child of') && c.includes('colgroup'))
    expect(nesting).toEqual([])
    expect(Array.from(colgroup.childNodes).map((n) => n.nodeName)).toEqual(['COL', 'COL', 'COL', 'COL', 'COL'])
  })
})
