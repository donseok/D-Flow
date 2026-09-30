// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ save: vi.fn(), outcome: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: mocks.save, getSettingsCommandOutcome: mocks.outcome }))
import { MilestoneKeywordsEditor } from '@/components/settings/MilestoneKeywordsEditor'

function change(input: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('MilestoneKeywordsEditor', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    mocks.save.mockReset(); mocks.outcome.mockReset(); mocks.refresh.mockReset()
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  it('키워드 목록과 빈 목록을 명시적으로 저장한다', async () => {
    mocks.save.mockResolvedValue({ ok: true, revision: 3 })
    act(() => root.render(<MilestoneKeywordsEditor projectId="p-1" revision={2} initial={['출시']} source="프로젝트 설정" />))
    const input = host.querySelector<HTMLTextAreaElement>('textarea')!
    act(() => change(input, ' 킥오프 \n 출시 '))
    await act(async () => { host.querySelector<HTMLButtonElement>('button.btn-primary')!.click(); await Promise.resolve() })
    expect(mocks.save).not.toHaveBeenCalled()
    expect(host.querySelector('[aria-label="변경 내용 검토"]')?.textContent).toContain('대시보드의 마일스톤 판정이 즉시 다시 계산됩니다')
    await act(async () => { host.querySelector<HTMLButtonElement>('button.btn-primary')!.click(); await Promise.resolve() })
    expect(mocks.save).toHaveBeenCalledWith('p-1', expect.objectContaining({ expectedRevision: 2, set: { 'core.milestone_keywords': ['킥오프', '출시'] } }))
    act(() => change(input, ''))
    await act(async () => { host.querySelector<HTMLButtonElement>('button.btn-primary')!.click(); await Promise.resolve() })
    expect(host.querySelector('[aria-label="변경 내용 검토"]')?.textContent).toContain('변경: 없음')
    await act(async () => { host.querySelector<HTMLButtonElement>('button.btn-primary')!.click(); await Promise.resolve() })
    expect(mocks.save).toHaveBeenLastCalledWith('p-1', expect.objectContaining({ expectedRevision: 3, set: { 'core.milestone_keywords': [] } }))
  })

  it('손상 설정을 빈 목록으로 복구할 수 있다', async () => {
    mocks.save.mockResolvedValue({ ok: true, revision: 2 })
    act(() => root.render(<MilestoneKeywordsEditor projectId="p-1" revision={1} initial={[]} source="제품 기본값" invalidReason="형식 오류" />))
    expect(host.textContent).toContain('형식 오류')
    await act(async () => { host.querySelector<HTMLButtonElement>('button.btn-primary')!.click(); await Promise.resolve() })
    await act(async () => { host.querySelector<HTMLButtonElement>('button.btn-primary')!.click(); await Promise.resolve() })
    expect(mocks.save).toHaveBeenCalledWith('p-1', expect.objectContaining({ set: { 'core.milestone_keywords': [] } }))
  })

  async function primary() { await act(async () => { host.querySelector<HTMLButtonElement>('button.btn-primary')!.click(); await Promise.resolve() }) }
  function mount(revision = 2) { act(() => root.render(<MilestoneKeywordsEditor projectId="p-1" revision={revision} initial={['출시']} source="프로젝트 설정" />)) }

  it('필드 오류는 입력 자리(field), 패치 거부는 저장 자리(patch)로 갈라 보인다', async () => {
    mocks.save
      .mockResolvedValueOnce({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: '입력 오류', retryable: false,
        fieldErrors: [{ key: 'core.milestone_keywords', message: '키워드가 겹칩니다.' }] })
      .mockResolvedValueOnce({ ok: false, kind: 'denied', code: 'ERR_DENIED', commandId: 'c', error: '권한이 없습니다.', retryable: false })
    mount(); act(() => change(host.querySelector('textarea')!, '킥오프'))
    await primary(); await primary()
    expect(host.querySelector('[data-config-state="field"]')?.textContent).toContain('키워드가 겹칩니다.')
    expect(host.querySelector('[data-config-state="patch"]')).toBeNull()
    await primary()                                   // 검토 단계가 열린 채이므로 한 번에 다시 저장한다
    expect(host.querySelector('[data-config-state="patch"]')?.textContent).toContain('권한이 없습니다.')
  })

  it('응답이 유실되면 명령 이력으로 확인하고 적용이면 재전송하지 않는다', async () => {
    mocks.save.mockRejectedValueOnce(new Error('network'))
    mocks.outcome.mockResolvedValue({ ok: true, outcome: { status: 'applied', revision: 3 } })
    mount(); act(() => change(host.querySelector('textarea')!, '킥오프'))
    await primary(); await primary()
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.outcome).toHaveBeenCalledWith({ projectId: 'p-1' }, mocks.save.mock.calls[0][1].commandId)
    expect(host.textContent).toContain('저장된 명령을 확인했습니다.')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('결과가 끝내 불명이면 같은 명령을 다시 보내고, 충돌 뒤 저장은 새 commandId 를 쓴다', async () => {
    mocks.save.mockRejectedValue(new Error('network'))
    mocks.outcome.mockResolvedValue({ ok: true, outcome: { status: 'unknown' } })
    mount(); act(() => change(host.querySelector('textarea')!, '킥오프'))
    await primary(); await primary()
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls[1][1]).toEqual(mocks.save.mock.calls[0][1])
    await primary()
    expect(mocks.save.mock.calls[2][1].commandId).toBe(mocks.save.mock.calls[0][1].commandId)
  })

  it('충돌이면 비교 화면을 보이고 내 값 다시 적용 뒤 새 id·최신 revision 으로 저장한다', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: '충돌',
      latest: { revision: 6, values: { 'core.milestone_keywords': ['다른'] }, invalidKeys: [] }, changedKeys: ['core.milestone_keywords'], retryable: false })
      .mockResolvedValue({ ok: true, kind: 'applied', revision: 7, commandId: 'c', rebased: false })
    mount(); act(() => change(host.querySelector('textarea')!, '킥오프'))
    await primary(); await primary()
    const first = mocks.save.mock.calls[0][1].commandId
    expect(host.textContent).toContain('다른')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.includes('내 값 다시 적용'))!.click() })
    await primary(); await primary()
    expect(mocks.save.mock.calls[1][1].commandId).not.toBe(first)
    expect(mocks.save.mock.calls[1][1].expectedRevision).toBe(6)
  })
})
