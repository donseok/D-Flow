// @vitest-environment jsdom
// 주간 시트 셀 저장의 값 CAS·충돌 비교·되돌리기(개정 §5.8 — SPU1 완료 조건 Q05·Q10, §5.8.6 결정 35). 다른 사람이 그 칸을 바꿨으면 무조건
// 다시 쓰지 않고 비교로 간다. 되돌리기는 서버가 확인한 저장만, "지금 서버 값 = 내가 쓴 값"을 기대값으로 싣는 역명령이다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WeeklyArea, WeeklySheetRow } from '@/lib/domain/weeklySheet'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Change = (payload: { eventType: string; new?: Record<string, unknown> }) => void
const h = vi.hoisted(() => ({
  onChange: null as Change | null, router: { refresh: vi.fn(), push: vi.fn() }, toast: vi.fn(),
  cell: vi.fn(), cells: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => h.router }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock('@/components/weekly/usePresence', () => ({ usePresence: () => [] }))
vi.mock('@/components/app/PresenceStrip', () => ({ PresenceStrip: () => null }))
// 화면 문구는 사전에서 온다 — 진짜 ko 사전으로 풀어 한국어 단언을 그대로 둔다
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t('ko', k as Parameters<typeof t>[1])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ locale: 'ko', t: ko, setLocale: () => {} }) }
})
vi.mock('@/app/actions/weekly', () => ({
  createWeeklyReport: vi.fn(), prepareWeeklyCellRewrite: vi.fn(), saveWeeklyCell: h.cell, saveWeeklyCells: h.cells, saveWeeklyTitle: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = { on: (_e: string, _f: unknown, cb: Change) => { h.onChange = cb; return channel }, subscribe: () => channel }
    return { channel: () => channel, removeChannel: vi.fn() }
  },
}))

const { WeeklySheetView } = await import('@/components/weekly/WeeklySheetView')
const { editSessionStore } = await import('@/lib/sync/editSession')

const AREAS: WeeklyArea[] = [{ id: 'a-exp', code: 'EXP', name: '실험', sortOrder: 1, active: true, teams: [] }]
const row = (thisContent: string): WeeklySheetRow => ({ id: 'r1', reportId: 'rep', areaId: 'a-exp', thisContent, thisIssue: '', nextContent: '', nextIssue: '' })

let container: HTMLDivElement
let root: Root
const cell = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="금주실적 내용, 실험"]')!
const dialog = () => document.querySelector<HTMLElement>('[data-testid="conflict-resolver"]')
const choose = (action: 'mine' | 'latest' | 'continue') => act(async () => dialog()!.querySelector<HTMLButtonElement>(`[data-conflict-action="${action}"]`)!.click())
const values = () => (['mine', 'latest', 'base'] as const).map(w => dialog()!.querySelector(`[data-conflict-value="${w}"]`)?.textContent)
const session = () => editSessionStore.getSession('weekly:r1:this_content')?.status
const typeInto = (value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(cell(), value)
  cell().dispatchEvent(new Event('input', { bubbles: true }))
})
/** 디바운스(1.5초)를 넘겨 저장을 내보내고 응답까지 흘린다 */
const flush = (ms = 1600) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const key = (k: string, init: KeyboardEventInit = {}) => act(async () => { cell().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
const show = (content: string) => act(async () => root.render(
  <WeeklySheetView
    projectId="p1" weekStart="2026-09-21" weekLabel="9월 4주차" weekTitle="9월 4주차" prevWeek="2026-09-14" nextWeek="2026-09-28"
    thisRange="9/21~9/25" nextRange="9/28~10/2" projectName="Acme" report={{ id: 'rep', title: '' }} areas={AREAS}
    initialRows={[row(content)]} hasCarrySource={false} me={{ id: 'u1', name: 'alice' }} canEditCells canCreateRound
  />,
))

beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.cell.mockResolvedValue({ ok: true })
  h.cells.mockResolvedValue({ ok: true })
  editSessionStore.clearAll()
  editSessionStore.setConnectionState('online')
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  await show('50')
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('WeeklySheetView — 셀 저장의 값 CAS(Q05)', () => {
  it('저장은 편집을 시작할 때의 값(내가 확인한 서버 값)을 기대값으로 싣는다', async () => {
    await typeInto('60')
    expect(session()).toBe('editing')
    expect(editSessionStore.getSummary().isFullySynced).toBe(false)
    await flush()
    expect(h.cell).toHaveBeenCalledTimes(1)
    expect(h.cell).toHaveBeenCalledWith('p1', 'r1', 'this_content', '60', '50')
    expect(session()).toBe('saved')
    expect(editSessionStore.getSummary().isFullySynced).toBe(true)
  })

  it('이어 쓴 저장의 기대값은 방금 내가 쓴 값이다', async () => {
    await typeInto('60'); await flush()
    await typeInto('65'); await flush()
    expect(h.cell).toHaveBeenLastCalledWith('p1', 'r1', 'this_content', '65', '60')
  })

  it('저장이 가는 중에 더 친 값은 겹쳐 보내지 않는다 — 응답 뒤에 방금 쓴 값을 기대값으로 이어 보낸다(내 저장끼리 충돌하지 않는다)', async () => {
    let settle!: (v: { ok: boolean }) => void
    h.cell.mockImplementationOnce(() => new Promise(res => { settle = res }))
    await typeInto('60'); await flush()
    await typeInto('61'); await flush()
    await act(async () => { cell().dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(h.cell).toHaveBeenCalledTimes(1)
    expect(session()).not.toBe('saved')
    await act(async () => { settle({ ok: true }) })
    expect(h.cell).toHaveBeenCalledTimes(2)
    expect(h.cell).toHaveBeenLastCalledWith('p1', 'r1', 'this_content', '61', '60')
    expect(dialog()).toBeNull()
  })

  it('Q05 — 편집 중 실시간으로 남의 값(70)이 와도 내 입력이 남고, 저장은 옛 기준(50)으로 나가 서버가 충돌로 답한다 → 비교', async () => {
    await typeInto('60')
    act(() => h.onChange!({ eventType: 'UPDATE', new: { id: 'r1', report_id: 'rep', area_id: 'a-exp', this_content: '70', this_issue: '', next_content: '', next_issue: '' } }))
    expect(cell().value).toBe('60')
    h.cell.mockResolvedValueOnce({ ok: false, conflict: true, latest: '70', error: 'x' })
    await flush()
    expect(h.cell).toHaveBeenCalledWith('p1', 'r1', 'this_content', '60', '50')
    expect(values()).toEqual(['60', '70', '50'])
    expect(cell().value).toBe('60')
    expect(session()).toBe('conflict')
    expect(editSessionStore.getSummary()).toMatchObject({ conflictCount: 1, isFullySynced: false })
    expect(container.querySelector('[data-cell-conflict]')).not.toBeNull()
  })

  it('Q05 — 충돌한 칸은 정하기 전에 다시 나가지 않는다(자동 재시도·포커스 이탈·더 친 입력 모두)', async () => {
    await typeInto('60')
    h.cell.mockResolvedValueOnce({ ok: false, conflict: true, latest: '70', error: 'x' })
    await flush()
    await choose('continue')
    await flush(5000)
    await act(async () => { cell().dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    await typeInto('61')
    await flush(5000)
    expect(h.cell).toHaveBeenCalledTimes(1)
    expect(h.cells).not.toHaveBeenCalled()
    expect(cell().value).toBe('61')
    expect(session()).toBe('conflict')
  })

  it('Q05 — 내 값으로 저장: 본 서버 값(70)을 기대값으로 한 번만 쓴다', async () => {
    await typeInto('60')
    h.cell.mockResolvedValueOnce({ ok: false, conflict: true, latest: '70', error: 'x' })
    await flush()
    await choose('mine')
    await flush(0)
    expect(h.cell).toHaveBeenCalledTimes(2)
    expect(h.cell).toHaveBeenLastCalledWith('p1', 'r1', 'this_content', '60', '70')
    expect(dialog()).toBeNull()
    expect(session()).toBe('saved')
  })

  it('Q05 — 서버 값 받기: 쓰지 않는다. 칸은 서버 값이 되고 표시가 걷힌다', async () => {
    await typeInto('60')
    h.cell.mockResolvedValueOnce({ ok: false, conflict: true, latest: '70', error: 'x' })
    await flush()
    await choose('latest')
    await flush(5000)
    expect(h.cell).toHaveBeenCalledTimes(1)
    expect(cell().value).toBe('70')
    expect(session()).toBeUndefined()
    expect(editSessionStore.getSummary().isFullySynced).toBe(true)
    // 받은 뒤의 편집은 받은 값(70)이 기준이다
    await typeInto('75'); await flush()
    expect(h.cell).toHaveBeenLastCalledWith('p1', 'r1', 'this_content', '75', '70')
  })

  it('Q05 — 계속 편집 뒤에도 칸의 "충돌 · 비교"로 다시 열어 정한다', async () => {
    await typeInto('60')
    h.cell.mockResolvedValueOnce({ ok: false, conflict: true, latest: '70', error: 'x' })
    await flush()
    await choose('continue')
    expect(dialog()).toBeNull()
    await typeInto('62')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-cell-conflict]')!.click())
    expect(values()).toEqual(['62', '70', '50'])
    await choose('mine')
    await flush(0)
    expect(h.cell).toHaveBeenLastCalledWith('p1', 'r1', 'this_content', '62', '70')
  })

  it('Q10 — 응답을 잃은 저장은 같은 기대값(50)으로 다시 묻는다. 서버가 이미 내 값이면(충돌 응답·값 60) 반영으로 읽고 더 쓰지 않는다', async () => {
    await typeInto('60')
    h.cell.mockRejectedValueOnce(new Error('network'))
    await flush()
    expect(session()).toBe('outcome_unknown')
    expect(editSessionStore.getSummary().isFullySynced).toBe(false)
    h.cell.mockResolvedValueOnce({ ok: false, conflict: true, latest: '60', error: 'x' })
    await flush(2100)
    expect(h.cell).toHaveBeenCalledTimes(2)
    expect(h.cell).toHaveBeenLastCalledWith('p1', 'r1', 'this_content', '60', '50')
    expect(dialog()).toBeNull()
    expect(session()).toBe('saved')
    await flush(5000)
    expect(h.cell).toHaveBeenCalledTimes(2)
  })

  it('Q10 — 응답을 잃은 뒤 더 쳤고 서버 값이 내 앞선 저장(60)이면 남의 변경이 아니다 — 그 위에서 이어 쓴다(비교 없음)', async () => {
    await typeInto('60')
    h.cell.mockRejectedValueOnce(new Error('network'))
    await flush()
    await typeInto('61')
    h.cell.mockResolvedValueOnce({ ok: false, conflict: true, latest: '60', error: 'x' })
    await flush(2100)
    await flush(0)
    expect(dialog()).toBeNull()
    expect(h.cell).toHaveBeenCalledTimes(3)
    expect(h.cell.mock.calls[1]).toEqual(['p1', 'r1', 'this_content', '61', '50'])
    expect(h.cell.mock.calls[2]).toEqual(['p1', 'r1', 'this_content', '61', '60'])
    expect(session()).toBe('saved')
  })

  it('Q10 — 응답을 잃었고 미반영이면(재시도가 통과) 한 번만 쓰인다. 제3의 값이면 비교로 간다', async () => {
    await typeInto('60')
    h.cell.mockRejectedValueOnce(new Error('network'))
    await flush()
    await flush(2100)
    expect(h.cell).toHaveBeenCalledTimes(2)
    expect(session()).toBe('saved')
    await typeInto('80')
    h.cell.mockRejectedValueOnce(new Error('network'))
    await flush()
    h.cell.mockResolvedValueOnce({ ok: false, conflict: true, latest: '99', error: 'x' })
    await flush(2100)
    expect(values()).toEqual(['80', '99', '60'])
  })
})

describe('WeeklySheetView — 되돌리기는 서버가 확인한 저장만, 역명령은 CAS(§5.8.6)', () => {
  const undo = () => key('z', { ctrlKey: true })

  it('붙여넣기 배치: 확인 전에는 되돌리지 않고, 확인 뒤의 역명령은 내가 쓴 값을 기대값으로 싣는다', async () => {
    let settle!: (v: { ok: boolean }) => void
    h.cells.mockImplementationOnce(() => new Promise(res => { settle = res }))
    await act(async () => { cell().focus() })
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
    paste.clipboardData = { getData: (t: string) => (t === 'text/plain' ? '60' : ''), types: ['text/plain'] }
    await act(async () => { cell().dispatchEvent(paste) })
    expect(h.cells).toHaveBeenCalledTimes(1)
    expect(h.cells.mock.calls[0][1]).toEqual([{ rowId: 'r1', cellKey: 'this_content', content: '60', expected: '50' }])
    await undo()                                     // 아직 서버가 확인하지 않았다
    expect(h.cells).toHaveBeenCalledTimes(1)
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '아직 되돌릴 수 없습니다' }))
    expect(cell().value).toBe('60')
    await act(async () => { settle({ ok: true }) })
    await undo()
    expect(h.cells).toHaveBeenCalledTimes(2)
    expect(h.cells.mock.calls[1][1]).toEqual([{ rowId: 'r1', cellKey: 'this_content', content: '50', expected: '60' }])
    expect(cell().value).toBe('50')
  })

  it('되돌리는 사이 다른 사람이 바꿨으면(70) 덮지 않는다 — 비교로 가고 그 칸의 되돌리기 이력을 버린다', async () => {
    await act(async () => { cell().focus() })
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
    paste.clipboardData = { getData: (t: string) => (t === 'text/plain' ? '60' : ''), types: ['text/plain'] }
    await act(async () => { cell().dispatchEvent(paste) })
    await flush(0)
    h.cells.mockResolvedValueOnce({ ok: true, conflicts: [{ rowId: 'r1', cellKey: 'this_content', latest: '70' }] })
    await undo()
    await flush(0)
    expect(h.cells.mock.calls[1][1]).toEqual([{ rowId: 'r1', cellKey: 'this_content', content: '50', expected: '60' }])
    expect(values()).toEqual(['50', '70', '60'])
    expect(session()).toBe('conflict')
    await choose('latest')
    expect(cell().value).toBe('70')
    // 이력이 버려졌다 — 다시 실행(redo)·되돌리기 모두 서버로 나가지 않는다
    await key('z', { ctrlKey: true, shiftKey: true })
    await undo()
    await flush(5000)
    expect(h.cells).toHaveBeenCalledTimes(2)
    expect(h.cell).not.toHaveBeenCalled()
  })

  it('배치의 일부 칸만 충돌하면 그 칸만 비교로 가고 나머지는 저장됨이다', async () => {
    await act(async () => { cell().focus() })
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
    paste.clipboardData = { getData: (t: string) => (t === 'text/plain' ? '60\t이슈' : ''), types: ['text/plain'] }
    h.cells.mockResolvedValueOnce({ ok: true, conflicts: [{ rowId: 'r1', cellKey: 'this_content', latest: '70' }] })
    // 범위 붙여넣기는 선택이 옮겨 가며 시작 칸의 포커스 이탈 저장(단건)도 같이 나간다 — 같은 기대값(50)의 CAS 라 서버는 같은 답을 한다
    h.cell.mockResolvedValue({ ok: false, conflict: true, latest: '70', error: 'x' })
    await act(async () => { cell().dispatchEvent(paste) })
    await flush(0)
    for (const call of h.cell.mock.calls) expect(call).toEqual(['p1', 'r1', 'this_content', '60', '50'])
    expect(h.cells.mock.calls[0][1]).toEqual([
      { rowId: 'r1', cellKey: 'this_content', content: '60', expected: '50' },
      { rowId: 'r1', cellKey: 'this_issue', content: '이슈', expected: '' },
    ])
    expect(editSessionStore.getSession('weekly:r1:this_issue')?.status).toBe('saved')
    expect(session()).toBe('conflict')
    expect(values()).toEqual(['60', '70', '50'])
  })
})
