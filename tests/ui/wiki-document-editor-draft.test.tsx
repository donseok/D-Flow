// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DictKey } from '@/lib/i18n/dict'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
const { updateWikiDocument } = vi.hoisted(() => ({ updateWikiDocument: vi.fn() }))
vi.mock('@/app/actions/wiki', () => ({
  createWikiDocument: vi.fn(),
  updateWikiDocument,
  verifyWikiDocument: vi.fn(),
}))
vi.mock('@/components/wiki/wikiAnalytics', () => ({ trackWikiEvent: vi.fn() }))

import { WikiDocumentEditor } from '@/components/wiki/WikiDocumentEditor'
import { t } from '@/lib/i18n/dict'

const TOPIC = {
  id: 't1',
  title: '연계 규칙',
  bodyMd: '서버 본문',
  bodyUpdatedAt: '2026-09-01T00:00:00.000Z',
  documentKind: 'overview',
}
const A_KEY = 'wiki-draft:v2:uA:p1:t1'
const draftOf = (bodyMd: string) =>
  JSON.stringify({ title: TOPIC.title, bodyMd, kind: 'overview', savedAt: '2026-09-26T00:00:00.000Z' })
const DEBOUNCE_WAIT_MS = 700 // 편집기 debounce(600ms)보다 길게

describe('WikiDocumentEditor — 사용자별 로컬 초안', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.clear()
    updateWikiDocument.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  const mount = (userId: string | null, topic = TOPIC) =>
    act(async () => root.render(
      <WikiDocumentEditor key={topic.bodyUpdatedAt} projectId="p1" locale="ko" topic={topic} canEdit userId={userId} />,
    ))
  const button = (key: DictKey) =>
    [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === t('ko', key))
  const click = (key: DictKey) => act(async () => button(key)!.click())
  const hasBanner = () => container.textContent?.includes(t('ko', 'wiki.document.draftFound')) ?? false
  const textarea = () => container.querySelector('textarea')!
  async function typeBody(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), value)
      textarea().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('(a) 사용자 A 의 초안은 사용자 B 에게 복구 배너로 뜨지 않는다', async () => {
    window.localStorage.setItem(A_KEY, draftOf('A 의 초안'))
    await mount('uB')
    await click('wiki.document.edit')

    expect(hasBanner()).toBe(false)
    expect(window.localStorage.getItem(A_KEY)).toBe(draftOf('A 의 초안'))
  })

  it('(b) 편집에 들어가면(아직 안 고친 상태) 배너가 뜨고 저장소의 초안이 남아 있다', async () => {
    window.localStorage.setItem(A_KEY, draftOf('A 의 초안'))
    await mount('uA')
    await click('wiki.document.edit')

    expect(hasBanner()).toBe(true)
    expect(window.localStorage.getItem(A_KEY)).toBe(draftOf('A 의 초안'))
  })

  it('(c-1) 배너에서 버리기 → 저장소에서 사라진다', async () => {
    window.localStorage.setItem(A_KEY, draftOf('A 의 초안'))
    await mount('uA')
    await click('wiki.document.edit')
    await click('wiki.document.draftDiscard')

    expect(hasBanner()).toBe(false)
    expect(window.localStorage.getItem(A_KEY)).toBeNull()
  })

  it('(c-2) 배너에서 이어서 쓰기 → 본문이 초안으로 바뀐다', async () => {
    window.localStorage.setItem(A_KEY, draftOf('A 의 초안'))
    await mount('uA')
    await click('wiki.document.edit')
    await click('wiki.document.draftRestore')

    expect(hasBanner()).toBe(false)
    expect(textarea().value).toBe('A 의 초안')
  })

  it('(d) userId 가 없으면 초안을 읽지도 쓰지도 않는다', async () => {
    window.localStorage.setItem(A_KEY, draftOf('A 의 초안'))
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await mount(null)
    await click('wiki.document.edit')
    expect(hasBanner()).toBe(false)

    await typeBody('고친 본문')
    await act(async () => { window.dispatchEvent(new Event('beforeunload')) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, DEBOUNCE_WAIT_MS)) })

    expect(setItem).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
  })

  it('(d 대조) userId 가 있으면 사용자별 키로 쓴다', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await mount('uA')
    await click('wiki.document.edit')
    await typeBody('고친 본문')
    await act(async () => { window.dispatchEvent(new Event('beforeunload')) })

    expect(setItem).toHaveBeenCalledWith(A_KEY, expect.stringContaining('고친 본문'))
  })

  it('(e) 마운트하면 사용자 없는 옛 키를 지우고 v2 와 다른 키는 남긴다', async () => {
    window.localStorage.setItem('wiki-draft:p1:t1', draftOf('옛 초안'))
    window.localStorage.setItem(A_KEY, draftOf('A 의 초안'))
    window.localStorage.setItem('other-key', 'x')
    await mount('uA')

    expect(window.localStorage.getItem('wiki-draft:p1:t1')).toBeNull()
    expect(window.localStorage.getItem(A_KEY)).not.toBeNull()
    expect(window.localStorage.getItem('other-key')).toBe('x')
  })

  it('(f) 저장 충돌 안내대로 새로고침 뒤 다시 편집하면 초안을 되살릴 수 있다', async () => {
    updateWikiDocument.mockResolvedValueOnce({ ok: false, conflict: true, error: 'conflict' })
    await mount('uA')
    await click('wiki.document.edit')
    await typeBody('내 본문')
    await click('wiki.document.save')
    expect(container.textContent).toContain(t('ko', 'wiki.document.conflictHint'))

    // 새로고침 — 남이 저장한 본문으로 편집기가 새로 뜬다(WikiTopicDetail 은 bodyUpdatedAt 을 key 로 쓴다).
    await mount('uA', { ...TOPIC, bodyMd: '남의 본문', bodyUpdatedAt: '2026-09-02T00:00:00.000Z' })
    await click('wiki.document.edit')
    expect(hasBanner()).toBe(true)
    await click('wiki.document.draftRestore')
    expect(textarea().value).toBe('내 본문')
  })
})
