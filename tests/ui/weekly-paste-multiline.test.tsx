// @vitest-environment jsdom
// 주간 시트 붙여넣기 — 셀 안에서 긁어 복사한 여러 줄 텍스트는 고른 한 칸에 그대로 들어간다(줄마다 아래 영역 행으로 펼치지 않는다).
// 시트가 직접 복사한 범위(한 열 여러 행)는 표식 형식으로 알아보고 예전처럼 행으로 펼친다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WeeklyArea, WeeklySheetRow } from '@/lib/domain/weeklySheet'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ router: { refresh: vi.fn(), push: vi.fn() }, toast: vi.fn(), cell: vi.fn(), cells: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => h.router }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock('@/components/weekly/usePresence', () => ({ usePresence: () => [] }))
vi.mock('@/components/app/PresenceStrip', () => ({ PresenceStrip: () => null }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t(k as Parameters<typeof t>[0])
  return { useLocale: () => ({ t: ko }) }
})
vi.mock('@/app/actions/weekly', () => ({
  createWeeklyReport: vi.fn(), prepareWeeklyCellRewrite: vi.fn(), saveWeeklyCell: h.cell, saveWeeklyCells: h.cells, saveWeeklyTitle: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = { on: () => channel, subscribe: () => channel }
    return { channel: () => channel, removeChannel: vi.fn() }
  },
}))

const { WeeklySheetView } = await import('@/components/weekly/WeeklySheetView')
const { editSessionStore } = await import('@/lib/sync/editSession')

const AREAS: WeeklyArea[] = [
  { id: 'a-1', code: 'A1', name: '조업', sortOrder: 1, active: true, teams: [] },
  { id: 'a-2', code: 'A2', name: '품질', sortOrder: 2, active: true, teams: [] },
]
const ROWS: WeeklySheetRow[] = [
  { id: 'r1', reportId: 'rep', areaId: 'a-1', thisContent: '', thisIssue: '', nextContent: '', nextIssue: '' },
  { id: 'r2', reportId: 'rep', areaId: 'a-2', thisContent: '기존', thisIssue: '', nextContent: '', nextIssue: '' },
]

let container: HTMLDivElement
let root: Root
const cellOf = (area: string) => container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="금주실적 내용, ${area}"]`)!

type FakeClipboard = { types: string[]; getData: (t: string) => string; setData: (t: string, v: string) => void }
function clipboard(data: Record<string, string>): FakeClipboard {
  return {
    get types() { return Object.keys(data) },
    getData: (t: string) => data[t] ?? '',
    setData: (t: string, v: string) => { data[t] = v },
  }
}
async function fire(type: 'paste' | 'copy', target: HTMLElement, cb: FakeClipboard) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
  e.clipboardData = cb
  await act(async () => { target.dispatchEvent(e) })
  return e
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.cell.mockResolvedValue({ ok: true })
  h.cells.mockResolvedValue({ ok: true })
  editSessionStore.clearAll()
  editSessionStore.setConnectionState('online')
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  await act(async () => root.render(
    <WeeklySheetView
      projectId="p1" weekStart="2026-10-11" weekLabel="10월 2주차" weekTitle="10월 2주차" prevWeek="2026-10-04" nextWeek="2026-10-18"
      thisRange="10/11~10/15" nextRange="10/18~10/22" projectName="Acme" report={{ id: 'rep', title: '' }} areas={AREAS}
      initialRows={ROWS} hasCarrySource={false} me={{ id: 'u1', name: 'alice' }} canEditCells canCreateRound
    />,
  ))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('WeeklySheetView — 여러 줄 텍스트 붙여넣기', () => {
  it('셀 안에서 긁어 복사한 두 줄은 고른 칸 하나에 줄바꿈째 들어가고 아래 영역 행은 그대로다', async () => {
    await act(async () => { cellOf('조업').focus() })
    const text = ' - 개선 과제(4개 Major Process)의 정의서 작성\n - 개선 과제 外 현 프로세스 정의 추가 예정'
    const e = await fire('paste', cellOf('조업'), clipboard({ 'text/plain': text }))
    expect(e.defaultPrevented).toBe(true)
    expect(cellOf('조업').value).toBe(text)
    expect(cellOf('품질').value).toBe('기존')
    expect(h.cells).toHaveBeenCalledTimes(1)
    expect(h.cells.mock.calls[0][1]).toEqual([{ rowId: 'r1', cellKey: 'this_content', content: text, expected: '' }])
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('시트에서 복사한 한 열 두 행 범위는 표식으로 알아보고 두 행으로 펼친다', async () => {
    // 출처 범위: 조업·품질의 금주실적 내용(세로 두 칸)을 Shift+↓로 고른 뒤 복사
    await act(async () => { cellOf('조업').focus() })
    await act(async () => { cellOf('조업').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })) })
    const cb = clipboard({})
    await fire('copy', cellOf('조업'), cb)
    expect(cb.types).toContain('application/x-dflow-sheet')
    expect(cb.getData('text/plain')).toBe('\n기존')
    // 같은 범위를 다음 열(금주 이슈) 맨 위에 붙여넣는다
    const issue = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="금주실적 이슈 및 주요 이벤트, 조업"]')!
    await act(async () => { issue.focus() })
    await fire('paste', issue, cb)
    expect(h.cells).toHaveBeenCalledTimes(1)
    expect(h.cells.mock.calls[0][1]).toEqual([
      { rowId: 'r1', cellKey: 'this_issue', content: '', expected: '' },
      { rowId: 'r2', cellKey: 'this_issue', content: '기존', expected: '' },
    ])
  })
})
