// @vitest-environment jsdom
// 주간 시트의 실시간 병합(스펙 §4.1.7, D44) — 화면이 모르는 영역의 INSERT 는 그리지 않고 router.refresh() 로 영역을 다시 받는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WeeklyArea, WeeklySheetRow } from '@/lib/domain/weeklySheet'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Change = (payload: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => void
const h = vi.hoisted(() => ({ onChange: null as Change | null, router: { refresh: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => h.router }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/weekly/usePresence', () => ({ usePresence: () => [] }))
vi.mock('@/components/app/PresenceStrip', () => ({ PresenceStrip: () => null }))
vi.mock('@/app/actions/weekly', () => ({
  createWeeklyReport: vi.fn(), prepareWeeklyCellRewrite: vi.fn(), saveWeeklyCell: vi.fn(),
  saveWeeklyCells: vi.fn(), saveWeeklyTitle: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = {
      on: (_event: string, _filter: unknown, cb: Change) => { h.onChange = cb; return channel },
      subscribe: () => channel,
    }
    return { channel: () => channel, removeChannel: vi.fn() }
  },
}))

const { WeeklySheetView } = await import('@/components/weekly/WeeklySheetView')

const AREAS: WeeklyArea[] = [
  { id: 'a-exp', code: 'EXP', name: '실험', sortOrder: 1, active: true, teams: [] },
  { id: 'a-data', code: 'DATA', name: '데이터', sortOrder: 2, active: true, teams: [] },
  { id: 'a-ops', code: 'OPS', name: '운영', sortOrder: 3, active: true, teams: [] },
]
const row = (id: string, areaId: string, thisContent = ''): WeeklySheetRow =>
  ({ id, reportId: 'rep', areaId, thisContent, thisIssue: '', nextContent: '', nextIssue: '' })
const record = (r: WeeklySheetRow) => ({
  id: r.id, report_id: r.reportId, project_id: 'p1', area_id: r.areaId,
  this_content: r.thisContent, this_issue: r.thisIssue, next_content: r.nextContent, next_issue: r.nextIssue,
})

let container: HTMLDivElement
let root: Root
const labels = () => [...container.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td')?.textContent)

/** 같은 root 에 다시 그리면 router.refresh() 뒤 서버가 내려준 새 props 와 같다(컴포넌트는 key 없이 유지된다). */
function show(initialRows: WeeklySheetRow[], opts: { areas?: WeeklyArea[]; reportId?: string } = {}) {
  act(() => root.render(
    <WeeklySheetView
      projectId="p1" weekStart="2026-09-21" weekLabel="9월 4주차" weekTitle="9월 4주차"
      thisRange="9/21~9/25" nextRange="9/28~10/2" projectName="Acme"
      report={{ id: opts.reportId ?? 'rep', title: '' }} areas={opts.areas ?? AREAS} initialRows={initialRows} hasCarrySource={false}
      me={{ id: 'u1', name: 'alice' }} canEditCells canCreateRound
    />,
  ))
}

beforeEach(() => {
  h.onChange = null
  h.router.refresh.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('WeeklySheetView — 영역 라벨과 실시간 병합', () => {
  it('행 라벨은 영역 이름이고 순서는 받은 순서(페이지가 visibleRows 로 정했다), 열 머리는 업무영역', () => {
    show([row('r1', 'a-exp'), row('r3', 'a-ops')])
    expect(labels()).toEqual(['실험', '운영'])
    const heads = [...container.querySelectorAll('thead th')].map(th => th.textContent)
    expect(heads).toContain('업무영역')
    expect(heads).not.toContain('구분')
  })

  it('[RF2] 모르는 영역의 INSERT 는 그리지 않고 router.refresh() 를 한 번 부른다(D44)', () => {
    show([row('r1', 'a-exp'), row('r3', 'a-ops')])
    act(() => h.onChange!({ eventType: 'INSERT', new: record(row('r-new', 'a-new', '새 영역 내용')) }))
    expect(labels()).toEqual(['실험', '운영'])
    expect(h.router.refresh).toHaveBeenCalledTimes(1)
  })

  it('아는 영역의 INSERT 는 영역 순서 자리에 끼우고 새로고침하지 않는다', () => {
    show([row('r1', 'a-exp'), row('r3', 'a-ops')])
    act(() => h.onChange!({ eventType: 'INSERT', new: record(row('r2', 'a-data')) }))
    expect(labels()).toEqual(['실험', '데이터', '운영'])
    expect(h.router.refresh).not.toHaveBeenCalled()
  })

  it('UPDATE 는 자리를 지키고 값을 바꾼다', () => {
    show([row('r1', 'a-exp'), row('r3', 'a-ops')])
    act(() => h.onChange!({ eventType: 'UPDATE', new: record(row('r1', 'a-exp', '서버 실적')) }))
    expect(labels()).toEqual(['실험', '운영'])
    const cell = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="금주실적 내용, 실험"]')!
    expect(cell.value).toBe('서버 실적')
  })

  it('D44 의 새로고침이 영역과 행을 다시 내려주면 새 영역의 행이 영역 순서 자리에 보인다', () => {
    show([row('r1', 'a-exp'), row('r3', 'a-ops')])
    act(() => h.onChange!({ eventType: 'INSERT', new: record(row('r-new', 'a-new')) }))
    const areas: WeeklyArea[] = [...AREAS, { id: 'a-new', code: 'NEW', name: '신규', sortOrder: 1.5, active: true, teams: [] }]
    show([row('r1', 'a-exp'), row('r-new', 'a-new'), row('r3', 'a-ops')], { areas })
    expect(labels()).toEqual(['실험', '신규', '운영'])
  })

  it('주차가 바뀌면(다른 문서) 받은 행으로 바뀐다 — 옛 문서의 행을 남기지 않는다', () => {
    show([row('r1', 'a-exp'), row('r3', 'a-ops')])
    show([row('s2', 'a-data', '다음 주 실적')], { reportId: 'rep-2' })
    expect(labels()).toEqual(['데이터'])
  })
})
