// @vitest-environment jsdom
// 메모 위젯 — 입력이 멈추면 저장, 결과를 글로 알림, 실패해도 글은 남고 다시 저장할 수 있다(2026-10-10 위젯 강화)
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '../shell/_dom'
const h = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ postPrefsNow: h.save }))
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
import { MemoWidget } from '@/components/portal/MemoWidget'

const box = () => document.querySelector('textarea[data-portal-memo]') as HTMLTextAreaElement
// 공용 도구의 change 는 input 전용이다 — textarea 는 그 원형의 값 설정자로 바꾸고 input 이벤트를 보낸다(React 가 변경으로 받는다)
const type = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box(), value)
  box().dispatchEvent(new Event('input', { bubbles: true }))
})
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
beforeEach(() => { vi.useFakeTimers(); h.save.mockReset() })
afterEach(() => { vi.useRealTimers() })

it('저장된 글로 시작하고 글자 수 상한을 건다', () => {
  render(<MemoWidget workspaceId="ws" initial="적어 둔 글" />)
  expect(box().value).toBe('적어 둔 글'); expect(box().maxLength).toBe(2000); expect(box().getAttribute('aria-label')).toBe('메모')
  expect(screen.getByText('6/2000자')).toBeTruthy()
})
it('입력이 멈추면 한 번만 저장한다 — 워크스페이스 범위 개인 설정 portalMemo', async () => {
  h.save.mockResolvedValue({ ok: true })
  render(<MemoWidget workspaceId="ws" initial="" />)
  type('가'); type('가나'); type('가나다')
  expect(h.save).not.toHaveBeenCalled()
  await tick(800)
  expect(h.save).toHaveBeenCalledTimes(1)
  expect(h.save).toHaveBeenCalledWith({ prefs: { portalMemo: '가나다' }, workspaceId: 'ws' })
  expect(screen.getByRole('status').textContent).toBe('저장됨')
})
it('입력 칸을 떠나면 기다리지 않고 바로 저장한다', async () => {
  h.save.mockResolvedValue({ ok: true })
  render(<MemoWidget workspaceId="ws" initial="" />)
  type('급한 글')
  await act(async () => { box().dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })   // React 의 onBlur 는 focusout 을 듣는다
  expect(h.save).toHaveBeenCalledTimes(1)
})
it('저장 실패 — 알리고 글은 남는다. 다시 저장으로 같은 글을 보낸다', async () => {
  h.save.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
  render(<MemoWidget workspaceId="ws" initial="옛 글" />)
  type('새 글')
  await tick(800)
  expect(screen.getByRole('alert').textContent).toContain('저장하지 못했습니다'); expect(box().value).toBe('새 글')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '다시 저장' })) })
  expect(h.save).toHaveBeenCalledTimes(2); expect(h.save.mock.calls[1][0].prefs.portalMemo).toBe('새 글')
  expect(screen.getByRole('status').textContent).toBe('저장됨')
})
it('네트워크 오류도 실패로 알린다', async () => {
  h.save.mockRejectedValue(new Error('offline'))
  render(<MemoWidget workspaceId="ws" initial="" />)
  type('글')
  await tick(800)
  expect(screen.getByRole('alert')).toBeTruthy()
})
it('저장된 글과 같아지면 다시 보내지 않는다', async () => {
  h.save.mockResolvedValue({ ok: true })
  render(<MemoWidget workspaceId="ws" initial="그대로" />)
  type('그대로!'); type('그대로')
  await tick(800)
  expect(h.save).not.toHaveBeenCalled()
})
it('개인 설정을 읽지 못했으면(null) 입력을 열지 않는다 — 빈 글로 서버의 옛 글을 덮지 않는다', () => {
  render(<MemoWidget workspaceId="ws" initial={null} />)
  expect(box()).toBeNull(); expect(screen.getByText('개인 설정을 읽지 못해 메모를 열 수 없습니다')).toBeTruthy()
})
