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
const options = { max_lines_per_cell: 15, max_rows_per_slide: 5, item_cap: 0, empty_text: '', continuation_label: '(계속)' }
const setting = { template_id: null, mapping: { '{{a}}': 'project.name' }, options } as unknown as FormKindState['setting']
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

  const pickFile = async () => {
    const file = new File([new Uint8Array(10)], '새.pptx')
    const el = container.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(el, 'files', { value: [file], configurable: true })
    await act(async () => { el.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  const registered = (over: Record<string, unknown> = {}) => ({ ok: true, templateId: TID, version: 3, path: 'p', warnings: [], placeholderCount: 4, ...over })

  it('업로드는 준비 → Storage → 등록 → 활성화 순서로 진행하고 Storage 실패 때 등록하지 않는다', async () => {
    m.prepare.mockResolvedValue({ ok: true, path: 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx' })
    m.upload.mockResolvedValueOnce({ error: { message: 'x' } }).mockResolvedValueOnce({ error: null })
    m.register.mockResolvedValue(registered())
    m.activate.mockResolvedValue({ ok: true, status: 'applied', revision: 8 })
    await render()
    await pickFile()
    expect(m.register).not.toHaveBeenCalled()
    expect(container.querySelector('[role=alert]')?.textContent).toContain('올리지 못했습니다')
    await pickFile()
    expect(m.register).toHaveBeenCalledWith(PID, 'weekly_report_pptx', 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx', '새.pptx')
    // 등록되면 바로 활성화한다 — 현재 revision 과 새 명령 id 로
    expect(m.activate).toHaveBeenCalledWith(PID, TID, { expectedRevision: 7, commandId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    const status = container.querySelector('[role=status]')?.textContent ?? ''
    expect(status).toContain('v3')
    expect(status).toContain('활성화')
    expect(m.refresh).toHaveBeenCalled()
  })

  it('표를 자동으로 연결한 양식은 어느 슬라이드의 어떤 머리글을 이었는지 알려준다', async () => {
    m.prepare.mockResolvedValue({ ok: true, path: 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx' })
    m.upload.mockResolvedValue({ error: null })
    m.register.mockResolvedValue(registered({
      autoTokens: { slide: 5, columns: { name: 0, this: 1, next: 2 }, headers: { name: '구분', this: '전주 (10/05~10/16)', next: '금주 (10/19~10/23)' }, removedRows: 0, removedSlides: 0, rowsPerSlide: 5, linesPerCell: 15, datedHeaders: 0 },
    }))
    m.activate.mockResolvedValue({ ok: true, status: 'applied', revision: 8 })
    await render()
    await pickFile()
    const status = container.querySelector('[role=status]')?.textContent ?? ''
    expect(status).toContain('슬라이드 5')
    expect(status).toContain('전주 (10/05~10/16)')
    expect(status).toContain('업무영역')
    expect(status).toContain('한 장에 5줄씩, 한 칸에 15줄')
    // 표본 행 수가 현재 설정과 같으면 설정을 건드리지 않는다
    expect(m.update).not.toHaveBeenCalled()
  })

  it('양식의 표본 행 수·칸 크기가 설정과 다르면 한 장당 줄 수·칸당 줄 수를 먼저 저장하고 새 revision 으로 활성화한다', async () => {
    m.prepare.mockResolvedValue({ ok: true, path: 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx' })
    m.upload.mockResolvedValue({ error: null })
    m.register.mockResolvedValue(registered({
      autoTokens: { slide: 2, columns: { name: null, this: 0, next: 1 }, headers: { name: '', this: '금주 (10/05~10/16) 실적', next: '차주 (10/19~10/23) 계획' }, removedRows: 1, removedSlides: 10, rowsPerSlide: 2, linesPerCell: 12, datedHeaders: 2, lineStyles: ['title', 'label'], leaveTable: { slide: 13, days: 5, week: 'next' } },
    }))
    m.update.mockResolvedValue({ ok: true, revision: 8 })
    m.activate.mockResolvedValue({ ok: true, status: 'applied', revision: 9 })
    await render()
    await pickFile()
    const patch = m.update.mock.calls[0][1]
    expect(patch.expectedRevision).toBe(7)
    expect(patch.set['forms.weekly_report_pptx']).toEqual({ ...setting, options: { ...options, max_rows_per_slide: 2, max_lines_per_cell: 12 } })
    expect(m.activate.mock.calls[0][2].expectedRevision).toBe(8)
    const status = container.querySelector('[role=status]')?.textContent ?? ''
    expect(status).toContain('두 열 표')
    expect(status).toContain('업무 건마다 한 줄')
    expect(status).toContain('한 장에 2줄씩, 한 칸에 12줄')
    expect(status).toContain('보고 주차 날짜')
    expect(status).toContain('줄 서식')
    expect(status).toContain('슬라이드 13의 휴가 표는 근태 기록으로')
    expect(status).toContain('차주 휴가인 요일 칸')
    expect(status).toContain('슬라이드 10장은 지웠습니다')
    // 뒤이은 명령은 활성화가 돌려준 revision 으로 간다
    m.deactivate.mockResolvedValue({ ok: true, status: 'applied', revision: 10 })
    await render({ kinds: [kind([row({ active: true })])] })
    await click(button('해제'))
    expect(m.deactivate.mock.calls[0][2].expectedRevision).toBe(9)
  })

  it('한 장당 줄 수 저장에 실패하면 활성화하지 않고 등록만 됐다고 알린다', async () => {
    m.prepare.mockResolvedValue({ ok: true, path: 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx' })
    m.upload.mockResolvedValue({ error: null })
    m.register.mockResolvedValue(registered({
      autoTokens: { slide: 2, columns: { name: null, this: 0, next: 1 }, headers: { name: '', this: '금주 실적', next: '차주 계획' }, removedRows: 0, removedSlides: 0, rowsPerSlide: 2, linesPerCell: 12, datedHeaders: 0 },
    }))
    m.update.mockResolvedValue({ ok: false, error: '설정 저장 실패' })
    await render()
    await pickFile()
    expect(m.activate).not.toHaveBeenCalled()
    expect(container.querySelector('[role=alert]')?.textContent).toContain('줄 수')
    expect(m.refresh).toHaveBeenCalled()
  })

  it('자리표시자가 없는 양식은 활성화하지 않고 자리가 없다고 알린다', async () => {
    m.prepare.mockResolvedValue({ ok: true, path: 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx' })
    m.upload.mockResolvedValue({ error: null })
    m.register.mockResolvedValue(registered({ placeholderCount: 0, warnings: [{ code: 'NO_PLACEHOLDERS', message: '서버 문구' }] }))
    await render()
    await pickFile()
    expect(m.activate).not.toHaveBeenCalled()
    const alert = container.querySelector('[role=alert]')?.textContent ?? ''
    expect(alert).toContain('v3')
    expect(alert).toContain('자리표시자')
    expect(container.querySelector('[role=status]')).toBeNull()
    expect(m.refresh).toHaveBeenCalled()
  })

  it('서버가 새 revision 을 내려줘도 알림은 남고, 다음 명령은 새 revision 으로 보낸다', async () => {
    // 설정 페이지는 이 컴포넌트를 revision 으로 remount 하지 않는다 — 활성화 뒤 router.refresh() 가 새 revision 을 가져와도
    // "등록하고 활성화했습니다 … 표를 연결했습니다" 알림이 남아야 한다. CAS 기준(rev)은 props 를 따라간다.
    m.prepare.mockResolvedValue({ ok: true, path: 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx' })
    m.upload.mockResolvedValue({ error: null })
    m.register.mockResolvedValue(registered({
      autoTokens: { slide: 5, columns: { name: 0, this: 1, next: 2 }, headers: { name: '구분', this: '전주', next: '금주' }, removedRows: 0, removedSlides: 0, rowsPerSlide: 5, linesPerCell: 15, datedHeaders: 0 },
    }))
    m.activate.mockResolvedValue({ ok: true, status: 'applied', revision: 8 })
    await render()
    await pickFile()
    expect(container.querySelector('[role=status]')?.textContent).toContain('슬라이드 5')
    // refresh 가 돌아온 모습: 같은 트리에 새 revision 과 새 목록이 내려온다
    await render({ revision: 8, kinds: [kind([row({ id: TID, version: 3, active: true }), row({ id: 'dddddddd-4444-4444-8444-444444444444', version: 2 })])] })
    expect(container.querySelector('[role=status]')?.textContent).toContain('슬라이드 5')
    // 다른 사람이 revision 을 9 로 올린 뒤의 해제는 9 를 기준으로 보낸다
    await render({ revision: 9, kinds: [kind([row({ id: TID, version: 3, active: true })])] })
    m.deactivate.mockResolvedValue({ ok: true, status: 'applied', revision: 10 })
    await click(button('해제'))
    expect(m.deactivate.mock.calls[0][2].expectedRevision).toBe(9)
  })

  it('설정 페이지는 양식 관리 컴포넌트를 revision 으로 remount 하지 않는다', async () => {
    const page = (await import('node:fs')).readFileSync('src/app/(app)/p/[projectId]/settings/page.tsx', 'utf8')
    const line = page.split('\n').find((l) => l.includes('<FormTemplatesManager '))
    expect(line).toBeDefined()
    expect(line).toMatch(/key=\{projectId\}/)
    expect(line).not.toMatch(/revision\}`/)
  })

  it('등록 뒤 활성화가 미매핑으로 막히면 매핑 상자를 열고 등록은 됐다고 알린다', async () => {
    m.prepare.mockResolvedValue({ ok: true, path: 'ws/w/p/p/weekly_report_pptx/incoming/f.pptx' })
    m.upload.mockResolvedValue({ error: null })
    m.register.mockResolvedValue(registered())
    m.activate.mockResolvedValue({ ok: false, code: 'UNMAPPED', error: '매핑되지 않은 자리표시자가 있어 활성화할 수 없습니다.', unmapped: ['{{b}}'] })
    await render()
    await pickFile()
    expect(container.querySelector('input[aria-label="{{b}} 경로"]')).not.toBeNull()
    expect(container.querySelector('[role=status]')?.textContent).toContain('연결하면 활성화')
  })
})
