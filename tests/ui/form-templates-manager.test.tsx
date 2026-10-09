// @vitest-environment jsdom
// SP6 — 양식 관리 화면: 업로드(준비→브라우저 Storage→등록), 활성화/해제의 CAS revision·명령 id,
// 미매핑 토큰 → 매핑 저장 후 재활성화, 권한 없음 잠금, 실패 문구 노출.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 화면 문구는 사전(settingsUi·adminUi)에 있다 — 옮긴 문구만 한국어 글자로 돌려주는 대역(공급자 없는 기본 t 는 키를 돌려준다)
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale())

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({
  prepare: vi.fn(), register: vi.fn(), activate: vi.fn(), deactivate: vi.fn(), update: vi.fn(), upload: vi.fn(), refresh: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }))
vi.mock('@/app/actions/formTemplates', () => ({
  prepareFormTemplateUpload: m.prepare, registerFormTemplate: m.register,
  activateFormTemplate: m.activate, deactivateFormTemplate: m.deactivate,
}))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: m.update }))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ upload: m.upload }) } }),
}))

import { FormTemplatesManager, type FormKindState } from '@/components/settings/FormTemplatesManager'

const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
const TID = 'cccccccc-3333-4333-8333-333333333333'
const setting = { template_id: null, mapping: { '{{a}}': 'project.name' }, options: {} } as unknown as FormKindState['setting']
const row = (over: Partial<FormKindState['templates'][number]> = {}) => ({
  id: TID, version: 2, fileName: '주간.pptx', sizeBytes: 2048, active: false, createdAt: '2026-10-05T00:00:00Z', errors: 0, warnings: 1, ...over,
})
const kind = (templates = [row()]): FormKindState => ({ kind: 'weekly_report_pptx', label: '주간보고 (PPTX)', setting, templates })

let container: HTMLDivElement
let root: Root
async function render(props: Partial<React.ComponentProps<typeof FormTemplatesManager>> = {}) {
  await act(async () => { root.render(<FormTemplatesManager projectId={PID} revision={7} canEdit kinds={[kind()]} {...props} />) })
}
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!
const click = async (el: HTMLElement) => { await act(async () => { el.click() }) }

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('FormTemplatesManager', () => {
  it('활성화는 현재 revision 과 새 명령 id 를 보내고 성공하면 새로고침한다', async () => {
    m.activate.mockResolvedValue({ ok: true, status: 'applied', revision: 8 })
    await render()
    await click(button('활성화'))
    expect(m.activate).toHaveBeenCalledWith(PID, TID, { expectedRevision: 7, commandId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(container.querySelector('[role=status]')?.textContent).toContain('활성화했습니다')
    expect(m.refresh).toHaveBeenCalled()
  })

  it('활성 양식은 해제 버튼이 되고 deactivate 를 부른다', async () => {
    m.deactivate.mockResolvedValue({ ok: true, status: 'applied', revision: 8 })
    await render({ kinds: [kind([row({ active: true })])] })
    expect(container.textContent).toContain('사용자 양식 사용 중')
    await click(button('해제'))
    expect(m.deactivate).toHaveBeenCalledTimes(1)
    expect(m.activate).not.toHaveBeenCalled()
  })

  it('미매핑 토큰이 오면 입력칸을 보이고, 매핑 저장 뒤 새 revision 으로 다시 활성화한다', async () => {
    m.activate
      .mockResolvedValueOnce({ ok: false, code: 'UNMAPPED', error: '매핑되지 않은 자리표시자가 있어 활성화할 수 없습니다.', unmapped: ['{{b}}'] })
      .mockResolvedValueOnce({ ok: true, status: 'applied', revision: 9 })
    m.update.mockResolvedValue({ ok: true, revision: 8 })
    await render()
    await click(button('활성화'))
    expect(container.querySelector('[role=alert]')?.textContent).toContain('매핑되지 않은')
    const input = container.querySelector<HTMLInputElement>('input[aria-label="{{b}} 경로"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, 'project.name'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(button('매핑 저장 후 활성화'))
    const patch = m.update.mock.calls[0][1]
    expect(patch.expectedRevision).toBe(7)
    expect(patch.set['forms.weekly_report_pptx'].mapping).toEqual({ '{{a}}': 'project.name', '{{b}}': 'project.name' })
    expect(m.activate.mock.calls[1][2].expectedRevision).toBe(8)
    expect(container.querySelector('[role=status]')?.textContent).toContain('매핑을 저장하고')
  })

  it('권한이 없으면 버튼과 파일 선택이 잠긴다', async () => {
    await render({ canEdit: false })
    expect(button('활성화').disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(true)
  })

  it('업로드는 준비 → Storage → 등록 순서로 진행하고 Storage 실패 때 등록하지 않는다', async () => {
    m.prepare.mockResolvedValue({ ok: true, path: 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx' })
    m.upload.mockResolvedValueOnce({ error: { message: 'x' } }).mockResolvedValueOnce({ error: null })
    m.register.mockResolvedValue({ ok: true, templateId: TID, version: 3, path: 'p', warnings: [] })
    await render()
    const file = new File([new Uint8Array(10)], '새.pptx')
    const pick = async () => {
      const el = container.querySelector<HTMLInputElement>('input[type=file]')!
      Object.defineProperty(el, 'files', { value: [file], configurable: true })
      await act(async () => { el.dispatchEvent(new Event('change', { bubbles: true })) })
    }
    await pick()
    expect(m.register).not.toHaveBeenCalled()
    expect(container.querySelector('[role=alert]')?.textContent).toContain('올리지 못했습니다')
    await pick()
    expect(m.register).toHaveBeenCalledWith(PID, 'weekly_report_pptx', 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx', '새.pptx')
    expect(container.querySelector('[role=status]')?.textContent).toContain('v3')
  })
})
