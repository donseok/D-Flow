// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const update = vi.fn(), outcome = vi.fn(), refresh = vi.fn()
vi.mock('@/app/actions/settings', () => ({ updateWorkspaceSettings: (...a: unknown[]) => update(...a), getSettingsCommandOutcome: (...a: unknown[]) => outcome(...a) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
import { MenuOrderEditor } from '@/components/settings/MenuOrderEditor'

describe('MenuOrderEditor', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ ok: true, kind: 'applied', revision: 2, commandId: 'c', rebased: false })
    outcome.mockReset(); refresh.mockReset()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<MenuOrderEditor workspaceId="ws-1" revision={1} initialMenu={{ order: [], labels: {} }} />))
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  async function click(label: string) {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?? [...host.querySelectorAll('button')].find(x => x.textContent?.includes(label))!
    await act(async () => button.click())
  }
  it('그룹 안 순서만 바꾸고 안정 메뉴 id를 저장한다', async () => {
    await click('내 작업 위로')
    await click('메뉴 설정 저장')
    const patch = update.mock.calls[0][1]
    expect(patch.expectedRevision).toBe(1)
    expect(patch.set['navigation.menu'].order.slice(0, 3)).toEqual(['ws.my_work', 'ws.home', 'ws.projects'])
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('이름을 바꿀 때 항목 id를 유지한다', async () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="홈 메뉴 이름"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '시작')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('메뉴 설정 저장')
    expect(update.mock.calls[0][1].set['navigation.menu'].labels).toEqual({ 'ws.home': '시작' })
  })
  function rename(value: string) {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="홈 메뉴 이름"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  it('서버가 변경 없음(revision 그대로)을 알리면 "바뀐 값이 없습니다"를 보인다', async () => {
    update.mockResolvedValue({ ok: true, kind: 'applied', revision: 1, commandId: 'c', rebased: false })
    rename('시작'); await click('메뉴 설정 저장')
    expect(host.textContent).toContain('바뀐 값이 없습니다.')
    expect(host.textContent).not.toContain('저장했습니다')
  })
  it('필드 오류는 입력 자리(field), 패치 거부는 저장 자리(patch)로 갈라 보인다', async () => {
    update
      .mockResolvedValueOnce({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: '입력 오류', retryable: false,
        fieldErrors: [{ key: 'navigation.menu', message: '이름이 겹칩니다.' }] })
      .mockResolvedValueOnce({ ok: false, kind: 'denied', code: 'ERR_DENIED', commandId: 'c', error: '권한이 없습니다.', retryable: false })
    rename('시작'); await click('메뉴 설정 저장')
    expect(host.querySelector('[data-config-state="field"]')?.textContent).toContain('이름이 겹칩니다.')
    expect(host.querySelector('[data-config-state="patch"]')).toBeNull()
    await click('메뉴 설정 저장')
    expect(host.querySelector('[data-config-state="patch"]')?.textContent).toContain('권한이 없습니다.')
  })
  it('응답이 유실되면 명령 이력으로 확인하고, 불명이면 같은 명령을 다시 보낸다', async () => {
    update.mockRejectedValueOnce(new Error('network'))
    outcome.mockResolvedValueOnce({ ok: true, outcome: { status: 'applied', revision: 2 } })
    rename('시작'); await click('메뉴 설정 저장')
    expect(update).toHaveBeenCalledTimes(1)
    expect(outcome).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, update.mock.calls[0][1].commandId)
    expect(host.textContent).toContain('저장된 명령을 확인했습니다.')
    update.mockReset().mockRejectedValue(new Error('network'))
    outcome.mockResolvedValue({ ok: true, outcome: { status: 'unknown' } })
    rename('시작2'); await click('메뉴 설정 저장')
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[1][1]).toEqual(update.mock.calls[0][1])
    await click('저장 결과 확인 및 재시도')
    expect(update.mock.calls[2][1].commandId).toBe(update.mock.calls[0][1].commandId)
  })
  it('충돌 뒤 저장은 새 commandId 와 최신 revision 을 쓴다', async () => {
    update.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: '충돌',
      latest: { revision: 6, values: { 'navigation.menu': { order: [], labels: { 'ws.home': '다른' } } }, invalidKeys: [] }, changedKeys: ['navigation.menu'], retryable: false })
    rename('시작'); await click('메뉴 설정 저장')
    const first = update.mock.calls[0][1].commandId
    await click('내 값 다시 적용'); await click('메뉴 설정 저장')
    expect(update.mock.calls[1][1].commandId).not.toBe(first)
    expect(update.mock.calls[1][1].expectedRevision).toBe(6)
  })
})
