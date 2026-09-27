// @vitest-environment jsdom
// 설정 화면 Excel 내보내기 실패 토스트 — 서버 본문의 한국어 사유를 영어 화면에 그대로 싣지 않는다(최종 리뷰 UI M-1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { registerEn, t } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
registerEn(EN)

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ExportExcelButton } from '@/components/settings/ExportExcelButton'

const RAW = '저장된 엑셀 양식이 손상되었습니다: hierarchy — 설정 화면의 "저장된 양식 비우기"로 양식을 비우세요.'

describe('ExportExcelButton — 실패 사유는 사전 문구', () => {
  let root: Root
  beforeEach(async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(
      <LocaleProvider initialLocale="en"><ToastProvider><ExportExcelButton projectId="p1" /></ToastProvider></LocaleProvider>,
    ))
  })
  afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals() })

  it('422 면 영어 제목과 손상 안내(영어) — 서버 본문은 보이지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: RAW }), { status: 422 })))
    await act(async () => { (document.body.querySelector('button') as HTMLButtonElement).click() })
    await act(async () => {})
    expect(document.body.textContent).toContain(t('en', 'settings.exportFailed'))
    expect(document.body.textContent).toContain(t('en', 'settings.exportErrProfileCorrupt'))
    expect(document.body.textContent).not.toContain(RAW)
    expect(document.body.textContent).not.toMatch(/[가-힣]/)
  })
})
