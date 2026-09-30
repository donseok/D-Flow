// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const preview = vi.fn()
const update = vi.fn()
const outcome = vi.fn()
const refresh = vi.fn()
vi.mock('@/app/actions/settingsPreview', () => ({ previewSettingsImpact: (...args: unknown[]) => preview(...args) }))
vi.mock('@/app/actions/settings', () => ({
  updateWorkspaceSettings: (...args: unknown[]) => update(...args),
  getSettingsCommandOutcome: (...args: unknown[]) => outcome(...args),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { ModuleAllowEditor } from '@/components/settings/ModuleAllowEditor'

describe('ModuleAllowEditor', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    preview.mockReset().mockResolvedValue({ ok: true, revision: 1, before: ['kanban'], impact: { removed: [{ moduleId: 'kanban', projectCount: 2 }], affectedProjects: 2 } })
    update.mockReset().mockResolvedValue({ ok: true, kind: 'applied', revision: 2, commandId: 'c', rebased: false })
    outcome.mockReset()
    refresh.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(<ModuleAllowEditor workspaceId="ws" initialAllowed={['kanban']} revision={1} />))
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  function button(label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(label))
    if (!found) throw new Error(`button missing: ${label}`)
    return found
  }
  async function click(label: string) { await act(async () => { button(label).click() }) }
  function toggle(id: string) {
    const input = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find(x => x.closest('label')?.textContent?.includes(id))
    if (!input) throw new Error(`checkbox missing: ${id}`)
    act(() => input.click())
  }

  it('영향 수를 검토한 뒤 같은 revision으로 저장한다', async () => {
    toggle('kanban')
    await click('변경 내용 검토')
    expect(host.textContent).toContain('영향받는 프로젝트: 2개')
    await click('변경 저장')
    expect(update).toHaveBeenCalledWith('ws', expect.objectContaining({ expectedRevision: 1, set: { 'modules.allowed': [] } }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('미리보기 중 revision이 바뀌면 내 선택과 최신 값을 보여주고 재검토한다', async () => {
    preview.mockResolvedValueOnce({ ok: true, revision: 3, before: ['agents'], impact: { removed: [], affectedProjects: 0 } })
    toggle('kanban')
    await click('변경 내용 검토')
    expect(host.textContent).toContain('내 선택: 없음')
    expect(host.textContent).toContain('최신 값: 에이전트')
    await click('내 값 다시 검토')
    await click('변경 내용 검토')
    expect(preview).toHaveBeenCalledTimes(2)
  })

  it('응답 유실 뒤 결과가 불명이면 같은 commandId와 패치를 다시 보낸다', async () => {
    update.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network'))
    outcome.mockResolvedValue({ ok: true, outcome: { status: 'unknown' } })
    toggle('kanban')
    await click('변경 내용 검토')
    await click('변경 저장')
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[1]).toEqual(update.mock.calls[0])
    expect(host.textContent).toContain('저장 결과를 확인하지 못했습니다')
    await click('저장 결과 확인 및 재시도')
    expect(update).toHaveBeenCalledTimes(3)
    expect(update.mock.calls[2]).toEqual(update.mock.calls[0])
  })

  it('필수 허용 목록 누락을 표시하고 저장 후 복구 안내를 숨긴다', async () => {
    act(() => root.render(<ModuleAllowEditor key="missing" workspaceId="ws" initialAllowed={null} requiredMissing revision={1} />))
    expect(host.querySelector('[data-config-state="required"]')?.textContent).toContain('modules.allowed')
    await click('변경 내용 검토')
    await click('변경 저장')
    expect(host.querySelector('[data-config-state="required"]')).toBeNull()
  })

  it('서버의 허용 목록 필드 오류를 목록 바로 아래에 표시한다', async () => {
    update.mockResolvedValue({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c',
      error: '입력 오류', fieldErrors: [{ key: 'modules.allowed', message: '허용 목록을 확인하세요.' }], retryable: false })
    toggle('kanban'); await click('변경 내용 검토'); await click('변경 저장')
    expect(host.querySelector('[data-config-state="field"]')?.textContent).toContain('허용 목록을 확인하세요.')
    expect(host.querySelector('[data-config-state="patch"]')).toBeNull()
  })
})
