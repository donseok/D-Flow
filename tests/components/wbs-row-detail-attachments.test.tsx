// @vitest-environment jsdom
// 산출물 첨부 목록(P7-2-DL) — 목록 실패는 빈 목록이 아니라 오류, 다운로드 링크는 서버 판정(can_attach)이 allowed 일 때만.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem, DeliverableAttachment } from '@/lib/domain/types'
import type { AttachmentList } from '@/app/actions/attachments'
import { t as realT, registerEn } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { listAttachments, removeAttachment, L } = vi.hoisted(() => ({
  listAttachments: vi.fn<(itemId: string) => Promise<AttachmentList>>(),
  removeAttachment: vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>(),
  L: { locale: 'ko' as 'ko' | 'en' },
}))
registerEn(EN)
vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn().mockResolvedValue([]),
  updateWbsFields: vi.fn(), updateDeliverable: vi.fn(), addWbsItem: vi.fn(),
  addSubAct: vi.fn(), deleteWbsItem: vi.fn(), moveWbsItem: vi.fn(),
  addTaskDependency: vi.fn(), removeTaskDependency: vi.fn(),
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments, recordAttachment: vi.fn(), removeAttachment,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: L.locale, t: (k: string) => realT(L.locale, k as Parameters<typeof realT>[1]) }),
}))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => [] }))
vi.mock('@/components/wbs/WbsAssigneeStagePanel', () => ({ WbsAssigneeStagePanel: () => null }))

import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'
import { ERR_OBJECT_REMOVE, ERR_ROW_REMOVE } from '@/lib/attachments/removeStoredAttachment'

const ko = (k: Parameters<typeof realT>[1]) => realT('ko', k)

const item: ComputedItem = {
  id: 'item-1', parentId: null, code: 'A-1', sortOrder: 1, name: '대상 작업',
  biz: null, deliverable: null, plannedStart: '2026-08-31', plannedEnd: '2026-09-02',
  weight: null, actualPct: 100, owners: [], isOwnerSplit: false,
  plannedPct: 100, rolledActualPct: 100, achievement: 100, status: 'done',
  children: [], depth: 0,
}
const att = (over: Partial<DeliverableAttachment> = {}): DeliverableAttachment => ({
  id: 'att-1', wbsItemId: 'item-1', fileName: 'plan.xlsx', filePath: 'ws/w/p/p1/deliverables/item-1/1-plan.xlsx',
  size: 2048, mime: 'application/octet-stream', createdAt: '2026-09-27T00:00:00Z', url: null,
  ...over,
})

describe('RowDetailPanel — 산출물 첨부 목록의 정직성', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    L.locale = 'ko'
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(canAttach = false) {
    await act(async () => {
      root.render(<RowDetailPanel item={item} allItems={[item]} dependencies={[]} projectId="p1" onClose={() => {}} canAttach={canAttach} />)
    })
    await act(async () => {})
  }
  /** 첨부 섹션 — 머리글 문구를 가진 section. 패널의 다른 영역(링크·알림)과 섞지 않는다. */
  function section(): HTMLElement {
    const head = [...container.querySelectorAll('section')].find(s => s.textContent?.includes(realT(L.locale, 'wbs.attachments')))
    expect(head).toBeTruthy()
    return head as HTMLElement
  }
  const fileNode = (name: string) => section().querySelector(`[title="${name}"]`) as HTMLElement | null

  it('denied — 파일명은 보이지만 링크가 아니고, 다운로드 불가 안내가 보인다', async () => {
    listAttachments.mockResolvedValue({ ok: true, rows: [att()], download: 'denied' })
    await render()
    const s = section()
    expect(fileNode('plan.xlsx')).toBeTruthy()
    expect(fileNode('plan.xlsx')!.tagName).not.toBe('A')
    expect(s.querySelectorAll('a[href="#"]')).toHaveLength(0)
    expect(s.querySelectorAll('a')).toHaveLength(0)
    expect(s.textContent).toContain(ko('wbs.attachDownloadDenied'))
  })

  it('ok:false — 빈 목록 문구 대신 오류와 재시도. 재시도는 목록을 다시 부른다', async () => {
    listAttachments.mockResolvedValueOnce({ ok: false, error: '첨부 목록을 불러오지 못했습니다.' })
    await render()
    const s = section()
    const alert = s.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('첨부 목록을 불러오지 못했습니다.')
    expect(s.textContent).not.toContain(ko('wbs.noAttachments'))
    expect(listAttachments).toHaveBeenCalledTimes(1)

    listAttachments.mockResolvedValueOnce({ ok: true, rows: [att()], download: 'denied' })
    const retry = alert!.querySelector('button') as HTMLButtonElement
    expect(retry.textContent).toContain(ko('common.retry'))
    await act(async () => { retry.click() })
    await act(async () => {})
    expect(listAttachments).toHaveBeenCalledTimes(2)
    expect(section().querySelector('[role="alert"]')).toBeNull()
    expect(fileNode('plan.xlsx')).toBeTruthy()
  })

  it('ok:false 의 서버 문구(한국어)를 그대로 보이지 않는다 — 영어 화면은 영어 사전 문구', async () => {
    L.locale = 'en'
    listAttachments.mockResolvedValueOnce({ ok: false, error: '첨부 목록을 불러오지 못했습니다.' })
    await render()
    const alert = section().querySelector('[role="alert"]')!
    expect(alert.textContent).toContain(realT('en', 'wbs.attachLoadFail'))
    expect(alert.textContent).not.toMatch(/[가-힣]/)
  })

  // 삭제 실패 — 같은 섹션의 목록 실패는 사전 문구인데 삭제 실패만 도우미의 한국어 문구가 그대로 떴다.
  it.each([
    ['객체 삭제 실패', ERR_OBJECT_REMOVE, 'common.attach.objectRemoveFailed'],
    ['기록 삭제 실패', ERR_ROW_REMOVE, 'common.attach.rowRemoveFailed'],
  ] as const)('삭제 실패(%s)의 서버 문구(한국어)를 그대로 보이지 않는다 — 영어 화면은 영어 사전 문구', async (_name, error, key) => {
    L.locale = 'en'
    listAttachments.mockResolvedValue({ ok: true, rows: [att()], download: 'allowed' })
    removeAttachment.mockResolvedValue({ ok: false, error })
    await render(true)
    const del = section().querySelector(`button[aria-label="${realT('en', 'wbs.deleteAttachmentAria')}"]`) as HTMLButtonElement
    await act(async () => { del.click() })
    expect(removeAttachment).toHaveBeenCalledWith('att-1')
    const line = [...section().querySelectorAll('p')].find(p => p.className.includes('text-delayed'))!
    expect(line.textContent).toBe(realT('en', key))
    expect(line.textContent).not.toMatch(/[가-힣]/)
    // 한국어 화면은 종전 문구 그대로다
    expect(realT('ko', key)).toBe(error)
  })

  it('삭제 실패 — 도우미의 두 문구가 아닌 사유는 받은 문구를 그대로, 사유가 없으면 일반 문구', async () => {
    listAttachments.mockResolvedValue({ ok: true, rows: [att()], download: 'allowed' })
    await render(true)
    const del = () => section().querySelector(`button[aria-label="${ko('wbs.deleteAttachmentAria')}"]`) as HTMLButtonElement
    const line = () => [...section().querySelectorAll('p')].find(p => p.className.includes('text-delayed'))!.textContent
    removeAttachment.mockResolvedValue({ ok: false, error: '권한 없음' })
    await act(async () => { del().click() })
    expect(line()).toBe('권한 없음')
    removeAttachment.mockResolvedValue({ ok: false })
    await act(async () => { del().click() })
    expect(line()).toBe(ko('wbs.deleteFail'))
  })

  it('unknown — 권한 확인 실패 경고와 재시도, 링크 없음', async () => {
    listAttachments.mockResolvedValue({ ok: true, rows: [att()], download: 'unknown' })
    await render()
    const s = section()
    const alert = s.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain(ko('wbs.attachDownloadUnknown'))
    expect(alert!.querySelector('button')).toBeTruthy()
    expect(s.querySelectorAll('a')).toHaveLength(0)
    expect(fileNode('plan.xlsx')!.tagName).not.toBe('A')
  })

  it('allowed — 서명 URL 은 링크, linkError 행은 링크 없이 실패 표시', async () => {
    listAttachments.mockResolvedValue({
      ok: true, download: 'allowed',
      rows: [
        att({ id: 'att-1', fileName: 'plan.xlsx', url: 'https://signed.example.com/plan' }),
        att({ id: 'att-2', fileName: 'spec.pdf', url: null, linkError: true }),
      ],
    })
    await render()
    const s = section()
    const ok = fileNode('plan.xlsx')!
    expect(ok.tagName).toBe('A')
    expect(ok.getAttribute('href')).toBe('https://signed.example.com/plan')
    const bad = fileNode('spec.pdf')!
    expect(bad.tagName).not.toBe('A')
    expect(bad.closest('li')!.textContent).toContain(ko('wbs.attachLinkFail'))
    expect(ok.closest('li')!.textContent).not.toContain(ko('wbs.attachLinkFail'))
    expect(s.querySelectorAll('a[href="#"]')).toHaveLength(0)
    expect(s.querySelectorAll('a')).toHaveLength(1)
    expect(s.textContent).not.toContain(ko('wbs.attachDownloadDenied'))
    expect(s.querySelector('[role="alert"]')).toBeNull()
  })

  // 재시도(최종 리뷰 UI m-2) — 재시도 중에 알림·목록을 걷어 내면 재시도 버튼이 사라져 키보드 포커스가 body 로 떨어지고,
  // 이미 읽은 목록(권한 unknown)도 '불러오는 중'으로 가려진다.
  const deferred = () => {
    let resolve!: (v: AttachmentList) => void
    const promise = new Promise<AttachmentList>(r => { resolve = r })
    return { promise, resolve }
  }

  it('재시도 중에도 재시도 버튼은 남아 포커스를 쥐고(aria-busy), 성공해 알림이 사라지면 포커스는 섹션 머리로', async () => {
    listAttachments.mockResolvedValueOnce({ ok: false, error: '첨부 목록을 불러오지 못했습니다.' })
    await render()
    const retry = section().querySelector('[role="alert"] button') as HTMLButtonElement
    retry.focus()
    const next = deferred()
    listAttachments.mockReturnValueOnce(next.promise)
    await act(async () => { retry.click() })
    expect(retry.isConnected).toBe(true)
    expect(document.activeElement).toBe(retry)
    expect(retry.getAttribute('aria-busy')).toBe('true')
    expect(retry.getAttribute('aria-disabled')).toBe('true')
    await act(async () => { retry.click() }) // 도는 중에는 다시 부르지 않는다
    expect(listAttachments).toHaveBeenCalledTimes(2)

    await act(async () => { next.resolve({ ok: true, rows: [att()], download: 'denied' }) })
    expect(section().querySelector('[role="alert"]')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(section().querySelector('[data-attach-heading]'))
  })

  it('권한 unknown 재시도는 이미 읽은 목록을 가리지 않는다 — 재시도 중에도 파일이 보이고 버튼에 포커스가 남는다', async () => {
    listAttachments.mockResolvedValueOnce({ ok: true, rows: [att()], download: 'unknown' })
    await render()
    const retry = section().querySelector('[role="alert"] button') as HTMLButtonElement
    retry.focus()
    const next = deferred()
    listAttachments.mockReturnValueOnce(next.promise)
    await act(async () => { retry.click() })
    expect(fileNode('plan.xlsx')).toBeTruthy()
    expect(section().textContent).not.toContain(ko('common.loading'))
    expect(document.activeElement).toBe(retry)

    await act(async () => { next.resolve({ ok: true, rows: [att()], download: 'unknown' }) })
    expect(fileNode('plan.xlsx')).toBeTruthy()
    expect(document.activeElement).toBe(section().querySelector('[role="alert"] button'))
    expect(retry.getAttribute('aria-busy')).not.toBe('true')
  })

  it('listAttachments 가 던지면 오류 상태다 — 빈 목록 문구가 아니다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    listAttachments.mockRejectedValue(new Error('network'))
    await render()
    const s = section()
    expect(s.querySelector('[role="alert"]')?.textContent).toContain(ko('wbs.attachLoadFail'))
    expect(s.textContent).not.toContain(ko('wbs.noAttachments'))
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
