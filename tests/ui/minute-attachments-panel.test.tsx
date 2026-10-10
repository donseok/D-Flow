// @vitest-environment jsdom
// SP5 B3 과제 8 — 회의록 상세의 첨부 패널. 정책 안내·추가(전송→확정)·실패 보상·재시도·삭제 실패 유지·권한 없는 사용자·미리보기 정리.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MinuteFile } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({
  toast: vi.fn(), refresh: vi.fn(),
  fetchPolicy: vi.fn(), record: vi.fn(), remove: vi.fn(), fileUrl: vi.fn(), previewUrl: vi.fn(),
  upload: vi.fn(), storageRemove: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: m.refresh }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: m.toast }) }))
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div data-testid="modal">{children}</div> : null),
}))
vi.mock('@/app/actions/minutes', () => ({
  fetchMinuteAttachmentPolicy: m.fetchPolicy, recordMinuteFile: m.record, removeMinuteFile: m.remove,
  getMinuteFileUrl: m.fileUrl, getMinuteFilePreviewUrl: m.previewUrl,
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ upload: m.upload, remove: m.storageRemove }) } }),
}))

import { MinuteAttachmentsPanel } from '@/components/minutes/MinuteAttachmentsPanel'

const MID = '00000000-0000-4000-8000-0000000019d1'
const WID = '00000000-0000-4000-8000-0000000019d2'
const POLICY = { enabled: true, maxFileBytes: 1000, maxCount: 2, maxTotalBytes: 2000, allowedExtensions: null, previewEnabled: true }
const FILE: MinuteFile = {
  id: 'f1', minuteId: MID, role: 'attachment', fileName: '도면.png', filePath: `ws/${WID}/p/_/minute-files/${MID}/1-도면.png`,
  size: 512, mime: 'image/png', createdAt: '2026-10-01T00:00:00Z', uploadedBy: 'u1', uploadedByName: '김첨부',
}

let container: HTMLDivElement
let root: Root
async function render(props: Partial<React.ComponentProps<typeof MinuteAttachmentsPanel>> = {}) {
  await act(async () => {
    root.render(<MinuteAttachmentsPanel minuteId={MID} workspaceId={WID} projectId={null} files={[FILE]} canManage timeZone="Asia/Seoul" {...props} />)
  })
}
const text = () => container.textContent ?? ''
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label')?.startsWith(label))
async function pick(...files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  // 처리 효과(전송 → 확정)가 마이크로태스크로 이어진다
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.fetchPolicy.mockResolvedValue({ ok: true, policy: POLICY })
  m.upload.mockResolvedValue({ error: null })
  m.storageRemove.mockResolvedValue({ error: null })
  m.record.mockResolvedValue({ ok: true })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('MinuteAttachmentsPanel', () => {
  it('목록에 등록자·크기, 정책 안내에 사용량을 보인다 — 정책은 회의록 id 로만 묻는다', async () => {
    await render()
    expect(m.fetchPolicy).toHaveBeenCalledWith(MID)
    expect(text()).toContain('도면.png')
    expect(text()).toContain('512 B')
    expect(text()).toContain('min.att.by')
    expect(text()).toContain('min.att.usage')
    expect(button('min.att.preview')).toBeTruthy()
    expect(button('min.att.delete')).toBeTruthy()
  })

  it('권한 없는 사용자에게는 추가·삭제를 그리지 않는다', async () => {
    await render({ canManage: false })
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(button('min.att.delete')).toBeUndefined()
    expect(button('min.att.download')).toBeTruthy()
  })

  it('정책 조회 실패면 추가를 막고 사유를 보인다(기본값으로 열지 않는다)', async () => {
    m.fetchPolicy.mockResolvedValue({ ok: false, error: '첨부 설정을 불러오지 못했습니다.' })
    await render()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(text()).toContain('첨부 설정을 불러오지 못했습니다.')
  })

  it('정책이 꺼져 있으면 추가 없이 안내만', async () => {
    m.fetchPolicy.mockResolvedValue({ ok: true, policy: { ...POLICY, enabled: false } })
    await render()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(text()).toContain('min.att.disabled')
  })

  it('추가: minute-files 경로로 upsert 없이 올리고 확정한 뒤 새로고침', async () => {
    await render()
    await pick(new File(['x'], '메모.txt', { type: 'text/plain' }))
    expect(m.upload).toHaveBeenCalledTimes(1)
    const [path, , opts] = m.upload.mock.calls[0] as [string, File, { upsert: boolean }]
    expect(path).toMatch(new RegExp(`^ws/${WID}/p/_/minute-files/${MID}/\\d+-`))
    expect(opts).toEqual({ upsert: false })
    expect(m.record).toHaveBeenCalledWith(MID, expect.objectContaining({ role: 'attachment', fileName: '메모.txt', filePath: path }))
    expect(m.refresh).toHaveBeenCalled()
    expect(text()).not.toContain('메모.txt')
  })

  it('확정 거부면 올린 객체를 지우고 실패로 남긴다 — 재시도는 새 경로로', async () => {
    m.record.mockResolvedValueOnce({ ok: false, error: '이 회의록의 첨부 총용량 한도를 넘었습니다.' })
    await render()
    await pick(new File(['x'], '메모.txt'))
    const firstPath = (m.upload.mock.calls[0] as [string])[0]
    expect(m.storageRemove).toHaveBeenCalledWith([firstPath])
    expect(text()).toContain('이 회의록의 첨부 총용량 한도를 넘었습니다.')
    expect(m.refresh).not.toHaveBeenCalled()
    await act(async () => { button('min.att.retry')!.click() })
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
    expect(m.upload).toHaveBeenCalledTimes(2)
    expect(m.record).toHaveBeenCalledTimes(2)
    expect(m.refresh).toHaveBeenCalled()
  })

  it('정책 한도를 넘는 파일은 올리지 않고 재시도 없이 사유를 보인다', async () => {
    await render()
    await pick(new File([new Uint8Array(1001)], 'big.bin'))
    expect(m.upload).not.toHaveBeenCalled()
    expect(text()).toContain('min.att.reject.TOO_LARGE')
    expect(button('min.att.retry')).toBeUndefined()
  })

  it('삭제 실패면 목록에 남기고 사유를 보인다', async () => {
    m.remove.mockResolvedValue({ ok: false, error: '첨부 기록을 지우지 못했습니다 — 새로고침한 뒤 확인하세요.' })
    await render()
    await act(async () => { button('min.att.delete')!.click() })
    await act(async () => { button('min.att.deleteConfirm')!.click() })
    expect(m.remove).toHaveBeenCalledWith('f1')
    expect(text()).toContain('도면.png')
    expect(text()).toContain('첨부 기록을 지우지 못했습니다')
    expect(m.refresh).not.toHaveBeenCalled()
  })

  it('삭제 성공이면 토스트 + 새로고침', async () => {
    m.remove.mockResolvedValue({ ok: true })
    await render()
    await act(async () => { button('min.att.delete')!.click() })
    await act(async () => { button('min.att.deleteConfirm')!.click() })
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'min.att.deleteDone' }))
    expect(m.refresh).toHaveBeenCalled()
  })

  it('미리보기: 서버가 허용한 이미지만 img 로 연다, 거부는 사유', async () => {
    m.previewUrl.mockResolvedValueOnce({ ok: true, url: 'https://storage.example.com/s', kind: 'image' })
    await render()
    await act(async () => { button('min.att.preview')!.click() })
    expect(container.querySelector('[data-testid="modal"] img')?.getAttribute('src')).toBe('https://storage.example.com/s')
    m.previewUrl.mockResolvedValueOnce({ ok: false, error: '미리 볼 수 없는 파일입니다. 내려받아 확인하세요.' })
    await act(async () => { button('min.att.preview')!.click() })
    expect(text()).toContain('미리 볼 수 없는 파일입니다')
  })

  it('미리보기 응답 전에 패널이 사라지면 늦은 응답을 그리지 않는다', async () => {
    let resolve!: (v: unknown) => void
    m.previewUrl.mockReturnValueOnce(new Promise(r => { resolve = r }))
    await render()
    await act(async () => { button('min.att.preview')!.click() })
    act(() => root.unmount())
    await act(async () => { resolve({ ok: true, url: 'https://storage.example.com/s', kind: 'image' }) })
    expect(container.querySelector('img')).toBeNull()
    root = createRoot(container)
  })
})
