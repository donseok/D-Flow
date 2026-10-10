// @vitest-environment jsdom
// SP5 B4 묶음4 — 어휘 편집기. code 불변·이름·순서(= sort·rank)·사용 여부, 고정 항목('minutes')·원인 분류 삭제 금지,
// 설정 명령(CAS revision·명령 id), 기록이 있는 code 삭제 → CONFIG_IN_USE(건수) → 다른 항목으로 옮기기(migrateVocabCode).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultVocab } from '@/lib/settings/vocab'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ update: vi.fn(), outcome: vi.fn(), migrate: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: m.update, updateWorkspaceSettings: vi.fn(), getSettingsCommandOutcome: m.outcome }))
vi.mock('@/app/actions/vocab', () => ({ migrateVocabCode: m.migrate }))

import { VocabEditor } from '@/components/settings/VocabEditor'

const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
let container: HTMLDivElement
let root: Root
async function render(props: Partial<React.ComponentProps<typeof VocabEditor>> = {}) {
  await act(async () => {
    root.render(<VocabEditor projectId={PID} vocabKey="meetings.categories" value={defaultVocab('meetings.categories')} revision={7} canEdit {...props} />)
  })
}
const byLabel = <T extends Element>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!
const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!
async function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function click(el: Element) { await act(async () => { (el as HTMLElement).click() }) }
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('VocabEditor', () => {
  it('이름·순서를 바꿔 저장하면 순서가 sort 가 되고 CAS revision·명령 id 를 싣는다', async () => {
    m.update.mockResolvedValue({ ok: true, revision: 8 })
    await render()
    await type(byLabel<HTMLInputElement>('settings.vocab.label routine'), '주간 회의')
    await click(byLabel('settings.vocab.down routine'))
    await click(button('settings.vocab.save'))
    await flush()
    const [pid, patch] = m.update.mock.calls[0]
    expect(pid).toBe(PID)
    expect(patch.expectedRevision).toBe(7)
    expect(typeof patch.commandId).toBe('string')
    const saved = patch.set['meetings.categories'] as { code: string; label: string; sort: number }[]
    expect(saved.slice(0, 2)).toEqual([
      expect.objectContaining({ code: 'general', sort: 1 }), expect.objectContaining({ code: 'routine', label: '주간 회의', sort: 2 }),
    ])
    expect(container.textContent).toContain('settings.vocab.saved')
  })
  it('code 는 입력 칸이 없다 — 새 항목만 code 를 받는다', async () => {
    await render()
    expect(container.querySelector('[aria-label="settings.vocab.code routine"]')).toBeNull()
    await type(container.querySelectorAll<HTMLInputElement>('input.font-mono')[0], 'offsite')
    await click(button('settings.vocab.add'))
    expect(container.querySelector('[data-vocab-row="offsite"]')).not.toBeNull()
  })
  it("출처 'minutes' 는 지우거나 끌 수 없고, 저장된 원인 분류는 지울 수 없다(끄기만)", async () => {
    await render({ vocabKey: 'issues.sources', value: defaultVocab('issues.sources') })
    expect(byLabel<HTMLButtonElement>('settings.vocab.remove minutes').disabled).toBe(true)
    expect(byLabel<HTMLInputElement>('settings.vocab.active minutes').disabled).toBe(true)
    expect(byLabel<HTMLButtonElement>('settings.vocab.remove interview').disabled).toBe(false)
    act(() => root.unmount()); root = createRoot(container)   // 키가 다른 편집기 — 실제 화면도 key 로 새로 만든다
    await render({ vocabKey: 'issues.cause_categories', value: defaultVocab('issues.cause_categories') })
    expect(byLabel<HTMLButtonElement>('settings.vocab.remove it').disabled).toBe(true)
    expect(byLabel<HTMLInputElement>('settings.vocab.active it').disabled).toBe(false)
  })
  it('기록이 있는 code 를 지우면 건수와 함께 옮기기를 열고, 옮긴 뒤 다시 저장한다', async () => {
    m.update.mockResolvedValueOnce({
      ok: false, kind: 'invalid', code: 'CONFIG_IN_USE', commandId: 'c', retryable: false, error: 'in use',
      fieldErrors: [{ key: 'meetings.categories', message: "'review' 을(를) 쓰는 기록이 3건", refCount: 3, code: 'review' }],
    }).mockResolvedValueOnce({ ok: true, revision: 9 })
    m.migrate.mockResolvedValue({ ok: true, moved: 3 })
    await render()
    await click(byLabel('settings.vocab.remove review'))
    await click(button('settings.vocab.save'))
    await flush()
    expect(container.textContent).toContain("'review' 을(를) 쓰는 기록이 3건")
    const group = byLabel('settings.vocab.migrate')
    expect(group.textContent).toContain('3')
    await click(button('settings.vocab.migrate'))
    await flush()
    expect(m.migrate).toHaveBeenCalledWith(PID, 'meetings.categories', 'review', 'routine')
    expect(container.textContent).toContain('settings.vocab.migrated')
    await click(button('settings.vocab.save'))
    await flush()
    expect(m.update).toHaveBeenCalledTimes(2)
    expect((m.update.mock.calls[1][1].set['meetings.categories'] as { code: string }[]).map(e => e.code)).not.toContain('review')
  })
  it('검증에 걸리면(활성 0) 저장하지 않는다', async () => {
    await render({ vocabKey: 'issues.severities', value: defaultVocab('issues.severities') })
    for (const c of ['high', 'medium', 'low']) await click(byLabel(`settings.vocab.active ${c}`))
    expect(button('settings.vocab.save').disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('활성')
  })
})
