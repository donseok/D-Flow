// @vitest-environment jsdom
// SP5 B3 과제9 — 회의록 첨부 정책 편집기. MB 입력 → 정확한 바이트, null(제한 없음)과 [](모두 거부) 구분, 운영 상한 검증,
// 설정 명령(CAS revision·명령 id)·불확실 결과 재확인, 손상 값 복구 저장, 워크스페이스/프로젝트 두 범위.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ATTACHMENT_POLICY } from '@/lib/minutes/attachmentPolicy'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ updateProject: vi.fn(), updateWorkspace: vi.fn(), outcome: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('@/app/actions/settings', () => ({
  updateProjectSettings: m.updateProject, updateWorkspaceSettings: m.updateWorkspace, getSettingsCommandOutcome: m.outcome,
}))

import { AttachmentPolicyEditor, draftToRaw } from '@/components/settings/AttachmentPolicyEditor'

const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
const WID = 'aaaaaaaa-1111-4111-8111-111111111111'
let container: HTMLDivElement
let root: Root
async function render(props: Partial<React.ComponentProps<typeof AttachmentPolicyEditor>> = {}) {
  await act(async () => {
    root.render(<AttachmentPolicyEditor scope={{ projectId: PID }} policy={DEFAULT_ATTACHMENT_POLICY} revision={7} canEdit {...props} />)
  })
}
const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
async function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const saveBtn = () => [...container.querySelectorAll('button')].find(b => b.textContent === 'settings.minAtt.save' || b.textContent === 'settings.minAtt.retry')!
const radio = (label: string) => [...container.querySelectorAll('label')].find(l => l.textContent === label)!.querySelector('input')!

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('draftToRaw', () => {
  it('20MB 는 운영 상한과 정확히 같은 바이트, 목록 모드 빈 입력은 [], 제한 없음은 null', () => {
    const base = { enabled: true, previewEnabled: true, maxFileMb: '20', maxCount: '10', maxTotalMb: '200', extMode: 'any' as const, extText: '' }
    expect(draftToRaw(base)).toMatchObject({ maxFileBytes: 20_971_520, maxTotalBytes: 209_715_200, maxCount: 10, allowedExtensions: null })
    expect(draftToRaw({ ...base, extMode: 'list', extText: '' })).toMatchObject({ allowedExtensions: [] })
    expect(draftToRaw({ ...base, extMode: 'list', extText: '.PDF, png  xlsx' })).toMatchObject({ allowedExtensions: ['pdf', 'png', 'xlsx'] })
    expect(draftToRaw({ ...base, maxFileMb: '' })).toMatchObject({ maxFileBytes: Number.NaN })
  })
})

describe('AttachmentPolicyEditor', () => {
  it('바꾸지 않으면 저장할 수 없다 — 바꾸면 그 키 하나를 CAS revision·명령 id 와 함께 보낸다', async () => {
    m.updateProject.mockResolvedValue({ ok: true, revision: 8 })
    await render()
    expect(saveBtn().disabled).toBe(true)
    await type(input('settings.minAtt.maxCount'), '3')
    await type(input('settings.minAtt.maxTotal'), '50')
    expect(saveBtn().disabled).toBe(false)
    await act(async () => { saveBtn().click() })
    expect(m.updateProject).toHaveBeenCalledWith(PID, {
      expectedRevision: 7, commandId: expect.any(String), unset: [],
      set: { 'minutes.attachments': { ...DEFAULT_ATTACHMENT_POLICY, maxCount: 3, maxTotalBytes: 50 * 1024 * 1024 } },
    })
    expect(container.textContent).toContain('settings.minAtt.saved')
    expect(m.refresh).toHaveBeenCalled()
  })

  it('운영 상한을 넘거나 총량 관계가 깨지면 저장을 막고 사유를 보인다', async () => {
    await render()
    await type(input('settings.minAtt.maxFile'), '21')
    expect(saveBtn().disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('개당 용량')
    await type(input('settings.minAtt.maxFile'), '20')
    await type(input('settings.minAtt.maxTotal'), '10')
    expect(saveBtn().disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('총 용량')
  })

  it('목록 모드의 빈 목록은 모두 거부라는 경고를 보이고 [] 로 저장한다', async () => {
    m.updateProject.mockResolvedValue({ ok: true, revision: 8 })
    await render()
    await act(async () => { radio('settings.minAtt.extList').click() })
    expect(container.textContent).toContain('settings.minAtt.extEmpty')
    await act(async () => { saveBtn().click() })
    expect(m.updateProject.mock.calls[0][1].set['minutes.attachments'].allowedExtensions).toEqual([])
  })

  it('손상 값은 기본값으로 시작해 바로 저장(복구)할 수 있다', async () => {
    m.updateProject.mockResolvedValue({ ok: true, revision: 8 })
    await render({ policy: null, invalid: true })
    expect(container.textContent).toContain('settings.minAtt.invalid')
    expect(saveBtn().disabled).toBe(false)
    await act(async () => { saveBtn().click() })
    expect(m.updateProject.mock.calls[0][1].set['minutes.attachments']).toEqual(DEFAULT_ATTACHMENT_POLICY)
    expect(container.textContent).not.toContain('settings.minAtt.invalid')
  })

  it('결과를 모르면(던짐) 명령 이력으로 확인하고, 그래도 모르면 같은 명령을 보류해 다시 보낸다', async () => {
    m.updateProject.mockRejectedValueOnce(new Error('network'))
    m.outcome.mockResolvedValueOnce({ ok: true, outcome: { status: 'unknown' } })
    await render()
    await type(input('settings.minAtt.maxCount'), '5')
    await type(input('settings.minAtt.maxTotal'), '100')
    await act(async () => { saveBtn().click() })
    expect(m.outcome).toHaveBeenCalledWith({ projectId: PID }, expect.any(String))
    expect(container.textContent).toContain('settings.minAtt.uncertain')
    expect(input('settings.minAtt.maxCount').disabled).toBe(true)
    const first = m.updateProject.mock.calls[0][1]
    m.updateProject.mockResolvedValueOnce({ ok: true, revision: 9 })
    await act(async () => { saveBtn().click() })
    expect(m.updateProject.mock.calls[1][1]).toBe(first)
    expect(container.textContent).toContain('settings.minAtt.saved')
  })

  it('워크스페이스 범위는 워크스페이스 설정 명령으로 저장한다', async () => {
    m.updateWorkspace.mockResolvedValue({ ok: true, revision: 3 })
    await render({ scope: { workspaceId: WID } })
    await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
    await act(async () => { saveBtn().click() })
    expect(m.updateWorkspace).toHaveBeenCalledWith(WID, expect.objectContaining({ set: { 'minutes.attachments': { ...DEFAULT_ATTACHMENT_POLICY, enabled: false } } }))
    expect(m.updateProject).not.toHaveBeenCalled()
  })

  it('편집 권한이 없으면 입력과 저장을 잠근다', async () => {
    await render({ canEdit: false })
    expect(input('settings.minAtt.maxCount').disabled).toBe(true)
    expect(saveBtn().disabled).toBe(true)
  })
})
