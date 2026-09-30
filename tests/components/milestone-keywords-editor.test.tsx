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
    expect(mocks.save).toHaveBeenCalledWith('p-1', expect.objectContaining({ expectedRevision: 2, set: { 'core.milestone_keywords': ['킥오프', '출시'] } }))
    act(() => change(input, ''))
    await act(async () => { host.querySelector<HTMLButtonElement>('button.btn-primary')!.click(); await Promise.resolve() })
    expect(mocks.save).toHaveBeenLastCalledWith('p-1', expect.objectContaining({ expectedRevision: 3, set: { 'core.milestone_keywords': [] } }))
  })

  it('손상 설정을 빈 목록으로 복구할 수 있다', async () => {
    mocks.save.mockResolvedValue({ ok: true, revision: 2 })
    act(() => root.render(<MilestoneKeywordsEditor projectId="p-1" revision={1} initial={[]} source="제품 기본값" invalidReason="형식 오류" />))
    expect(host.textContent).toContain('형식 오류')
    await act(async () => { host.querySelector<HTMLButtonElement>('button.btn-primary')!.click(); await Promise.resolve() })
    expect(mocks.save).toHaveBeenCalledWith('p-1', expect.objectContaining({ set: { 'core.milestone_keywords': [] } }))
  })
})
