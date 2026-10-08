// @vitest-environment jsdom
// 이슈 첨부 삭제 실패 — 삭제 도우미의 한국어 문구를 영어 화면에 그대로 싣지 않는다(H2 최종 리뷰). 액션 계약은 그대로 두고
// 그리는 자리에서 사전 문구를 고른다. 같은 섹션의 목록 실패는 이미 사전 문구다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { t as realT, registerEn } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'
import type { IssueAttachment } from '@/lib/domain/issueAttachments'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { listIssueAttachments, removeIssueAttachment, getIssueAttachmentUrl, L } = vi.hoisted(() => ({
  listIssueAttachments: vi.fn(),
  getIssueAttachmentUrl: vi.fn<(issueId: string, id: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>>(),
  removeIssueAttachment: vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>(),
  L: { locale: 'ko' as 'ko' | 'en' },
}))
registerEn(EN)
vi.mock('@/app/actions/issueAttachments', () => ({ listIssueAttachments, removeIssueAttachment, getIssueAttachmentUrl }))
vi.mock('@/lib/issues/uploadIssueAttachments', () => ({ uploadIssueAttachments: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: L.locale, t: (k: string) => realT(L.locale, k as Parameters<typeof realT>[1]) }),
}))

import { IssueAttachments } from '@/components/issues/IssueAttachments'
import { ERR_OBJECT_REMOVE, ERR_ROW_REMOVE } from '@/lib/attachments/removeStoredAttachment'

const ISSUE = 'cccccccc-3333-4333-8333-333333333333'
const ATT: IssueAttachment = {
  id: 'a1', issueId: ISSUE, fileName: 'plan.pdf', filePath: `ws/w/p/p1/issue-attachments/${ISSUE}/1-plan.pdf`,
  size: 10, mime: 'application/pdf', createdAt: '2026-09-27T00:00:00Z',
}

describe('IssueAttachments — 삭제 실패 문구', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    L.locale = 'ko'
    listIssueAttachments.mockResolvedValue({ ok: true, items: [ATT] })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render() {
    await act(async () => { root.render(<IssueAttachments issueId={ISSUE} editable />) })
    await act(async () => {})
  }
  const del = () => container.querySelector(`button[aria-label="${realT(L.locale, 'issue.attach.remove')}"]`) as HTMLButtonElement
  const line = () => [...container.querySelectorAll('p')].find(p => p.className.includes('text-danger'))?.textContent

  it.each([
    ['객체 삭제 실패', ERR_OBJECT_REMOVE, 'common.attach.objectRemoveFailed'],
    ['기록 삭제 실패', ERR_ROW_REMOVE, 'common.attach.rowRemoveFailed'],
  ] as const)('%s — 영어 화면은 영어 사전 문구, 한국어 화면은 종전 문구 그대로', async (_name, error, key) => {
    removeIssueAttachment.mockResolvedValue({ ok: false, error })
    L.locale = 'en'
    await render()
    await act(async () => { del().click() })
    expect(removeIssueAttachment).toHaveBeenCalledWith('a1')
    expect(line()).toBe(realT('en', key))
    expect(container.textContent).not.toMatch(/[가-힣]/)
    expect(realT('ko', key)).toBe(error)
  })

  it('도우미의 두 문구가 아닌 사유는 받은 문구를 그대로, 사유가 없으면 일반 문구', async () => {
    await render()
    removeIssueAttachment.mockResolvedValue({ ok: false, error: '권한 없음' })
    await act(async () => { del().click() })
    expect(line()).toBe('권한 없음')
    removeIssueAttachment.mockResolvedValue({ ok: false })
    await act(async () => { del().click() })
    expect(line()).toBe(realT('ko', 'issue.err.attachRemoveFailed'))
  })

  // SP5 B3 과제7 — 목록에 서명 링크가 없다. 파일명을 누르면 그때 이슈·첨부 id 로 60초 링크를 받아 연다.
  it('파일명을 누르면 링크를 받아 새 창으로 연다 — 목록에는 a[href] 가 없다', async () => {
    getIssueAttachmentUrl.mockResolvedValue({ ok: true, url: 'https://signed.example.com/plan' })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await render()
    expect(container.querySelectorAll('a')).toHaveLength(0)
    const btn = container.querySelector('button[title="plan.pdf"]') as HTMLButtonElement
    await act(async () => { btn.click() })
    expect(getIssueAttachmentUrl).toHaveBeenCalledWith(ISSUE, 'a1')
    expect(open).toHaveBeenCalledWith('https://signed.example.com/plan', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('링크 발급 실패는 사전 문구로 — 영어 화면에 한국어 사유를 싣지 않는다', async () => {
    L.locale = 'en'
    getIssueAttachmentUrl.mockResolvedValue({ ok: false, error: '첨부 없음' })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await render()
    await act(async () => { (container.querySelector('button[title="plan.pdf"]') as HTMLButtonElement).click() })
    expect(open).not.toHaveBeenCalled()
    expect(line()).toBe(realT('en', 'issue.attach.linkFailed'))
    open.mockRestore(); err.mockRestore()
  })
})
