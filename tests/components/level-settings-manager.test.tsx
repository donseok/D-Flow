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

  function render(labels: string[] = ['Phase', 'Task', 'Activity'], revision = 1) {
    act(() => {
      root.render(<LevelSettingsManager projectId="proj-1" levelLabels={labels} revision={revision} />)
    })
  }
  const clickSave = async () => { await act(async () => { container.querySelector<HTMLButtonElement>('button[data-save-levels]')!.click() }) }

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

  // 형제 편집기 저장(자동 재기준 포함)·refresh 뒤 revision prop 만 새로워지고 초안은 옛 값이다 — prop 으로 저장하면 옛 초안이
  // 충돌 없이 최신 revision 으로 덮는다(최종 리뷰 FN-2). 저장은 초안을 읽은 시점(base)으로 보내 서버 재기준이 겹침을 가르게 한다.
  it('다른 저장으로 revision prop 이 바뀌어도 초안을 읽은 revision 으로 저장한다(FN-2 a)', async () => {
    render(['Phase', 'Task'], 5)
    render(['Stage', 'Step'], 7)                   // 형제 저장 뒤 refresh — 초안은 첫 값 그대로
    await clickSave()
    expect(updateProjectSettings).toHaveBeenCalledWith('proj-1', expect.objectContaining({ expectedRevision: 5, set: { 'core.level_labels': ['Phase', 'Task'] } }))
  })

  it('자기 저장이 성공하면 다음 저장은 그 revision 으로 보낸다(FN-2 b)', async () => {
    updateProjectSettings.mockResolvedValue({ ok: true, kind: 'applied', commandId: 'c', revision: 6, rebased: false })
    render(['Phase', 'Task'], 5)
    await clickSave()
    await clickSave()
    expect(updateProjectSettings.mock.calls.map((c) => (c[1] as { expectedRevision: number }).expectedRevision)).toEqual([5, 6])
  })

  it('충돌을 받으면 최신 revision 을 기준으로 삼는다 — 알린 뒤 다시 저장하면 영구 충돌에 갇히지 않는다', async () => {
    updateProjectSettings.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: ERR_CONFIG_CONFLICT,
      latest: { revision: 9, values: {}, invalidKeys: [] }, changedKeys: ['core.level_labels'], retryable: false })
    render(['Phase', 'Task'], 5)
    await clickSave()
    await clickSave()
    expect(updateProjectSettings.mock.calls.map((c) => (c[1] as { expectedRevision: number }).expectedRevision)).toEqual([5, 9])
  })

  it('실패 문구는 알림 역할(role=alert)로 읽힌다(FM-16)', async () => {
    updateProjectSettings.mockResolvedValue({ ok: false, kind: 'denied', code: '권한 없음', commandId: 'c', error: '권한 없음', retryable: false })
    render(['Phase'])
    await clickSave()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('권한 없음')
  })

  it('단계가 1개면 삭제 버튼이 없다 — 0단 상태를 만들 수 없다', () => {
    render(['Phase'])
    expect(container.querySelectorAll('button[data-remove-level]')).toHaveLength(0)
  })
})
