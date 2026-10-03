// @vitest-environment jsdom
import { act } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../shell/_dom'
import { HiddenWidgetsProvider, useHiddenWidgets } from '@/components/portal/HiddenWidgetsProvider'
import { WidgetHideButton } from '@/components/portal/WidgetHideButton'
import { ShowHiddenWidgets } from '@/components/portal/ShowHiddenWidgets'
const h = vi.hoisted(() => ({ save: vi.fn(), reload: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ postPrefsNow: h.save }))
vi.mock('@/lib/portal/reload', () => ({ reloadPortalPage: h.reload }))
beforeEach(() => { h.save.mockReset(); h.reload.mockReset() })
function Batch({ restore = false }: { restore?: boolean }) {
  const commands = useHiddenWidgets()
  return <button onClick={() => { void commands.change('announcements'); void commands.change(restore ? null : 'upcoming') }}>연속 변경</button>
}
it('연속 요청을 순서대로 저장하고 최신 목록을 보존한 뒤 한 번만 다시 읽는다', async () => {
  let finish!: (response: { ok: boolean }) => void
  h.save.mockImplementationOnce(() => new Promise(r => { finish = r })).mockResolvedValue({ ok: true })
  render(<HiddenWidgetsProvider workspaceId="ws" hidden={[]}><Batch /></HiddenWidgetsProvider>)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
  expect(h.reload).not.toHaveBeenCalled()
  await act(async () => { finish({ ok: true }) })
  await waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1))
  expect(h.save.mock.calls[1][0]).toEqual({ prefs: { portalHiddenWidgets: ['announcements', 'upcoming'] }, workspaceId: 'ws' })
})
it('숨김 직후 복원 요청도 앞 저장 뒤에 적용한다', async () => {
  h.save.mockResolvedValue({ ok: true })
  render(<HiddenWidgetsProvider workspaceId="ws" hidden={[]}><Batch restore /></HiddenWidgetsProvider>)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1))
  expect(h.save.mock.calls[1][0].prefs.portalHiddenWidgets).toEqual([])
})
it('실패한 요청은 후속 목록에 섞지 않는다', async () => {
  h.save.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
  render(<HiddenWidgetsProvider workspaceId="ws" hidden={[]}><Batch /></HiddenWidgetsProvider>)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1))
  expect(h.save.mock.calls[1][0].prefs.portalHiddenWidgets).toEqual(['upcoming'])
})
it('저장 중 다른 숨김 조작을 막고 실패하면 알린다', async () => {
  let finish!: (response: { ok: boolean }) => void
  h.save.mockImplementation(() => new Promise(r => { finish = r }))
  render(<HiddenWidgetsProvider workspaceId="ws" hidden={[]}>
    <WidgetHideButton workspaceId="ws" widgetId="announcements" hidden={[]} title="공지" />
    <ShowHiddenWidgets workspaceId="ws" count={1} />
  </HiddenWidgetsProvider>)
  fireEvent.click(screen.getByRole('button', { name: '이 위젯 숨기기' }))
  expect((screen.getByRole('button', { name: /다시 보기/ }) as HTMLButtonElement).disabled).toBe(true)
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
  await act(async () => { finish({ ok: false }) })
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('숨기지 못했습니다'))
  expect(h.reload).not.toHaveBeenCalled()
})
it('복원 네트워크 실패는 알림을 유지하고 화면을 다시 읽지 않는다', async () => {
  h.save.mockRejectedValue(new Error('offline'))
  render(<HiddenWidgetsProvider workspaceId="ws" hidden={['announcements']}>
    <ShowHiddenWidgets workspaceId="ws" count={1} />
  </HiddenWidgetsProvider>)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('다시 보이지 못했습니다'))
  expect(h.reload).not.toHaveBeenCalled()
})
