// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const preview = vi.fn(), update = vi.fn(), outcome = vi.fn(), refresh = vi.fn()
vi.mock('@/app/actions/settingsPreview', () => ({ previewProjectSettingsImpact: (...a: unknown[]) => preview(...a) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: (...a: unknown[]) => update(...a), getSettingsCommandOutcome: (...a: unknown[]) => outcome(...a) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
import { ModuleToggleEditor } from '@/components/settings/ModuleToggleEditor'
import type { ProjectModuleOption } from '@/components/settings/ModuleToggleEditor'

const options: ProjectModuleOption[] = [
  { id: 'agents', label: '에이전트', allowed: true, available: true },
  { id: 'kanban', label: '칸반', allowed: false, available: true },
  { id: 'wiki', label: '위키', allowed: true, available: true },
  { id: 'chatbot', label: '챗봇', allowed: false, available: false },
]

describe('ModuleToggleEditor', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    preview.mockReset().mockResolvedValue({ ok: true, revision: 3, before: ['agents', 'kanban'], impact: { removed: [{ moduleId: 'agents', dataCount: 4, dataLabel: '에이전트 작업' }] } })
    update.mockReset().mockResolvedValue({ ok: true, kind: 'applied', revision: 4, commandId: 'c', rebased: false })
    outcome.mockReset(); refresh.mockReset()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<ModuleToggleEditor projectId="p" revision={3} initialEnabled={['agents', 'kanban']} options={options} />))
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  async function click(text: string) {
    const b = [...host.querySelectorAll('button')].find(x => x.textContent?.includes(text))!
    await act(async () => b.click())
  }
  function toggle(id: string) {
    const input = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(x => x.closest('label')?.textContent?.includes(id))!
    act(() => input.click())
  }
  it('허용 밖 저장값을 유지하고, 계약 밖 미선택 모듈은 편집기 대신 안내에 둔다', () => {
    expect(host.textContent).toContain('워크스페이스 미허용 또는 배포 비가용 — 저장값 유지')
    expect(host.textContent).toContain('이 배포/계약에서 사용할 수 없는 모듈: 챗봇')
    expect([...host.querySelectorAll('input[type="checkbox"]')]).toHaveLength(2)
  })
  it('모듈을 끌 때 데이터 건수를 검토하고 미허용 저장값을 보존해 저장한다', async () => {
    toggle('agents'); await click('변경 내용 검토')
    expect(host.textContent).toContain('에이전트 작업 4건')
    await click('변경 저장')
    expect(update).toHaveBeenCalledWith('p', expect.objectContaining({ expectedRevision: 3, set: { 'modules.enabled': ['kanban'] } }))
  })
  it('409에서 내 선택을 유지하고 최신 revision으로 재검토한다', async () => {
    update.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: '충돌',
      latest: { revision: 5, values: { 'modules.enabled': ['wiki'] }, invalidKeys: [] }, changedKeys: ['modules.enabled'], retryable: false })
    toggle('agents'); await click('변경 내용 검토'); await click('변경 저장')
    expect(host.textContent).toContain('내 선택: 칸반')
    expect(host.textContent).toContain('최신 값: 위키')
    await click('내 값 다시 검토'); await click('변경 내용 검토')
    expect(preview).toHaveBeenCalledTimes(2)
  })
  it('필수 프로젝트 모듈 설정 누락을 목록 자리에서 알린다', () => {
    act(() => root.render(<ModuleToggleEditor key="missing" projectId="p" revision={3} initialEnabled={null} requiredMissing options={options} />))
    expect(host.querySelector('[data-config-state="required"]')?.textContent).toContain('modules.enabled')
  })
})
