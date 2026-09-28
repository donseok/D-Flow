// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const updateProjectSettings = vi.fn()
const refresh = vi.fn()

vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: (...a: unknown[]) => updateProjectSettings(...(a as [])) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

import { LevelSettingsManager } from '@/components/settings/LevelSettingsManager'
import { ERR_CONFIG_CONFLICT } from '@/lib/settings/errors'

function labelInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[data-level-label]'))
}

describe('LevelSettingsManager', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    updateProjectSettings.mockReset().mockResolvedValue({ ok: true, kind: 'applied', commandId: 'c', revision: 2, rebased: false })
    refresh.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(labels: string[] = ['Phase', 'Task', 'Activity']) {
    act(() => {
      root.render(<LevelSettingsManager projectId="proj-1" levelLabels={labels} revision={1} />)
    })
  }

  it('현재 라벨을 단계당 입력 하나로 그린다', () => {
    render(['Phase', 'Task', 'Activity'])
    expect(labelInputs(container).map((i) => i.value)).toEqual(['Phase', 'Task', 'Activity'])
  })

  it('단계 추가를 누르면 빈 입력이 하나 늘어난다', () => {
    render(['Phase', 'Task'])
    const addBtn = container.querySelector<HTMLButtonElement>('button[data-add-level]')!
    act(() => addBtn.click())
    const inputs = labelInputs(container)
    expect(inputs).toHaveLength(3)
    expect(inputs[2].value).toBe('')
  })

  it('행 삭제를 누르면 그 단계가 빠진다', () => {
    render(['Phase', 'Task', 'Activity'])
    const removeBtns = container.querySelectorAll<HTMLButtonElement>('button[data-remove-level]')
    act(() => removeBtns[1].click())
    expect(labelInputs(container).map((i) => i.value)).toEqual(['Phase', 'Activity'])
  })

  it('저장하면 입력값 그대로 액션을 호출하고 성공 시 새로고침한다', async () => {
    render(['Phase', 'Task'])
    const inputs = labelInputs(container)
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(inputs[1], 'System')
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    })
    const saveBtn = container.querySelector<HTMLButtonElement>('button[data-save-levels]')!
    await act(async () => { saveBtn.click() })
    expect(updateProjectSettings).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      expectedRevision: 1, commandId: expect.stringMatching(/^[0-9a-f-]{36}$/), set: { 'core.level_labels': ['Phase', 'System'] }, unset: [],
    }))
    expect(refresh).toHaveBeenCalled()
  })

  it('액션 실패면 에러를 보여주고 새로고침하지 않는다', async () => {
    updateProjectSettings.mockResolvedValue({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: '설정 값이 올바르지 않습니다',
      fieldErrors: [{ key: 'core.level_labels', message: '기존 WBS 에 깊이 4단 항목이 있어 줄일 수 없습니다.' }], retryable: false })
    render(['Phase', 'Task', 'Activity'])
    const saveBtn = container.querySelector<HTMLButtonElement>('button[data-save-levels]')!
    await act(async () => { saveBtn.click() })
    expect(container.textContent).toContain('줄일 수 없습니다')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('충돌(conflict)이면 충돌 문구를 보이고 최신 값을 다시 읽는다', async () => {
    updateProjectSettings.mockResolvedValue({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: ERR_CONFIG_CONFLICT,
      latest: { revision: 2, values: {}, invalidKeys: [] }, changedKeys: ['core.level_labels'], retryable: false })
    render(['Phase', 'Task'])
    const saveBtn = container.querySelector<HTMLButtonElement>('button[data-save-levels]')!
    await act(async () => { saveBtn.click() })
    expect(container.textContent).toContain(ERR_CONFIG_CONFLICT)
    expect(refresh).toHaveBeenCalled()
  })

  it('crypto.randomUUID 가 없는 환경(비보안 컨텍스트)에서도 요청 id 를 만들어 저장한다(T28-M2)', async () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView | null>(a: T) => real.getRandomValues(a as never) as T })
    try {
      render(['Phase', 'Task'])
      const saveBtn = container.querySelector<HTMLButtonElement>('button[data-save-levels]')!
      await act(async () => { saveBtn.click() })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(updateProjectSettings).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      commandId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    }))
  })

  it('단계가 1개면 삭제 버튼이 없다 — 0단 상태를 만들 수 없다', () => {
    render(['Phase'])
    expect(container.querySelectorAll('button[data-remove-level]')).toHaveLength(0)
  })
})
