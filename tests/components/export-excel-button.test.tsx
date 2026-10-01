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
      <LocaleProvider initialLocale="en"><ToastProvider><ExportExcelButton projectId="p1" layout={null} /></ToastProvider></LocaleProvider>,
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

  it('단계 이름 손상(422 + CONFIG_INVALID)이면 양식 비우기가 아니라 단계 이름 안내(FN-7)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '설정 값이 올바르지 않습니다. (core.level_labels)', code: 'CONFIG_INVALID', key: 'core.level_labels' }), { status: 422 })))
    await act(async () => { (document.body.querySelector('button') as HTMLButtonElement).click() })
    await act(async () => {})
    expect(document.body.textContent).toContain(t('en', 'settings.exportErrLevelLabels'))
    expect(document.body.textContent).not.toContain(t('en', 'settings.exportErrProfileCorrupt'))
    expect(document.body.textContent).not.toMatch(/[가-힣]/)
  })

  it('fetch 가 던져도(오프라인) 실패 토스트를 띄우고 버튼은 다시 풀린다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const button = document.body.querySelector('button') as HTMLButtonElement
    await act(async () => { button.click() })
    await act(async () => {})
    expect(document.body.textContent).toContain(t('en', 'settings.exportFailed'))
    expect(button.disabled).toBe(false)
    err.mockRestore()
  })
})

// 버튼 옆 레이아웃 표기(SP4 D48) — 실제 컴포넌트·사전으로 그린다. null 이면(손상·설정 조회 실패) 표기 칸이 없다.
describe('ExportExcelButton — 레이아웃 표기', () => {
  const draw = async (locale: 'ko' | 'en', layout: Parameters<typeof ExportExcelButton>[0]['layout']) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const r = createRoot(container)
    await act(async () => r.render(
      <LocaleProvider initialLocale={locale}><ToastProvider><ExportExcelButton projectId="p1" layout={layout} /></ToastProvider></LocaleProvider>,
    ))
    const label = container.querySelector('[data-export-layout]')
    const out = { kind: label?.getAttribute('data-export-layout') ?? null, text: label?.textContent ?? null }
    act(() => r.unmount())
    container.remove()
    return out
  }
  it('표준·저장(날짜)·저장(날짜 미상)·없음', async () => {
    expect(await draw('ko', { kind: 'standard' })).toEqual({ kind: 'standard', text: '표준 양식(프로젝트 팀·단계로 생성)' })
    expect(await draw('ko', { kind: 'saved', savedAt: '2026-09-30', viaWizard: true })).toEqual({ kind: 'saved', text: '저장된 양식(임포트 마법사, 2026-09-30)' })
    expect(await draw('en', { kind: 'saved', savedAt: null, viaWizard: false })).toEqual({ kind: 'saved', text: 'Saved layout (date unknown)' })
    expect(await draw('en', null)).toEqual({ kind: null, text: null })
  })
})
