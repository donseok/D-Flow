// @vitest-environment jsdom
// 공유 모달의 실패 문구 — 공유 상태 조회·저장 실패는 액션이 사유 코드(code)를 함께 돌려주고 모달이 사전 문구를 고른다.
// 액션의 한국어 문구를 그대로 그리면 영어 화면(제목·설명·스위치는 영어)에 한국어 한 줄이 뜬다(H2 최종 리뷰).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { t as realT, registerEn } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'
import type { MinuteShareResult } from '@/app/actions/minutes'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { getMinuteShare, setMinuteShare, L } = vi.hoisted(() => ({
  getMinuteShare: vi.fn<(id: string) => Promise<MinuteShareResult>>(),
  setMinuteShare: vi.fn<(id: string, op: string) => Promise<MinuteShareResult>>(),
  L: { locale: 'ko' as 'ko' | 'en' },
}))
registerEn(EN)
vi.mock('@/app/actions/minutes', () => ({ getMinuteShare, setMinuteShare }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => {
  // 모달의 조회 effect 가 t 에 의존한다 — 렌더마다 새 함수를 주면 effect 가 끝없이 다시 돈다. 로케일마다 한 함수.
  const fns = new Map<string, (k: string) => string>()
  const tOf = (locale: 'ko' | 'en') => {
    if (!fns.has(locale)) fns.set(locale, (k: string) => realT(locale, k as Parameters<typeof realT>[1]))
    return fns.get(locale)!
  }
  return { useLocale: () => ({ locale: L.locale, t: tOf(L.locale) }) }
})

import { MinuteShareModal } from '@/components/minutes/MinuteShareModal'

const LOOKUP_KO = '공유 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.'
const SAVE_KO = '공유 설정을 저장하지 못했습니다.'

describe('MinuteShareModal — 실패 문구', () => {
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

  async function render() {
    await act(async () => { root.render(<MinuteShareModal open onClose={() => {}} minuteId="m1" />) })
    await act(async () => {})
  }
  const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement
  const toggle = () => dialog().querySelector('[role="switch"]') as HTMLButtonElement

  it('공유 상태 조회 실패(code=share_lookup) — 영어 화면은 영어 사전 문구, 한국어가 섞이지 않는다', async () => {
    L.locale = 'en'
    getMinuteShare.mockResolvedValue({ ok: false, error: LOOKUP_KO, code: 'share_lookup' })
    await render()
    expect(dialog().textContent).toContain(realT('en', 'min.share.title'))
    expect(dialog().textContent).toContain(realT('en', 'min.share.lookupFailed'))
    expect(dialog().textContent).not.toMatch(/[가-힣]/)
  })

  it('저장 실패(code=share_save) — 영어 화면은 영어 사전 문구, 한국어가 섞이지 않는다', async () => {
    L.locale = 'en'
    getMinuteShare.mockResolvedValue({ ok: true, enabled: false, token: null })
    setMinuteShare.mockResolvedValue({ ok: false, error: SAVE_KO, code: 'share_save' })
    await render()
    await act(async () => { toggle().click() })
    expect(setMinuteShare).toHaveBeenCalledWith('m1', 'enable')
    expect(dialog().textContent).toContain(realT('en', 'min.share.saveFailed'))
    expect(dialog().textContent).not.toMatch(/[가-힣]/)
  })

  it('한국어 화면은 종전 문구 그대로다 — 사전의 한국어 문구가 액션 문구와 같다', async () => {
    expect(realT('ko', 'min.share.lookupFailed')).toBe(LOOKUP_KO)
    expect(realT('ko', 'min.share.saveFailed')).toBe(SAVE_KO)
    getMinuteShare.mockResolvedValue({ ok: false, error: LOOKUP_KO, code: 'share_lookup' })
    await render()
    expect(dialog().textContent).toContain(LOOKUP_KO)
  })

  it('code 가 없는 거부(권한·보관)는 받은 문구를 그대로, 문구도 없으면 일반 문구', async () => {
    getMinuteShare.mockResolvedValue({ ok: false, error: '보관된 회의록은 공유 설정을 바꿀 수 없습니다.' })
    await render()
    expect(dialog().textContent).toContain('보관된 회의록은 공유 설정을 바꿀 수 없습니다.')
    act(() => root.unmount())
    root = createRoot(container)
    getMinuteShare.mockResolvedValue({ ok: false })
    await render()
    expect(dialog().textContent).toContain(realT('ko', 'min.share.failed'))
  })
})
