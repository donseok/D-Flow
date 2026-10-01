// @vitest-environment jsdom
// W5 — 가져오기는 성공했는데 양식 저장이 실패하면(응답 profileSave) 완료 화면이 경고(role=status)로 드러낸다.
// '이 양식으로 내보내기'는 저장했을 때만 참이라 그리지 않는다. 렌더·fetch mock 은 import-wizard-profile-mismatch.test.tsx 방식.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExcelProfile } from '@/lib/excel/profile'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/app/actions/importBackup', () => ({ getWbsBackup: vi.fn() }))   // 마법사가 import 하는 서버 액션 — 이 테스트는 append 만 돈다

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ImportWizard } from '@/components/import/ImportWizard'
import { registerEn, t } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'
registerEn(EN)

const DETECTED: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
  teamColumns: [[6, '팀A']], ownerMarks: { '●': 'primary', '△': 'support' },
}
const INSPECT_BODY = {
  ok: true,
  detection: {
    sheetNames: ['WBS'], profile: DETECTED, confidence: { header: 1, hierarchy: 1, logical: 1 },
    preview: { headers: [], rows: [] }, warnings: [],
  },
  savedProfile: null,
  profileMismatch: null,
}

let executeResponse: () => Response

describe('ImportWizard — 양식 저장 실패 경고(W5)', () => {
  let container: HTMLDivElement
  let root: Root

  const button = (name: string) =>
    [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === name) as HTMLButtonElement | undefined
  const click = (el: HTMLElement) => act(async () => { el.click(); await Promise.resolve() })

  async function runToDone() {
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'wbs.xlsx')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await click(button('양식 분석하기')!)
    await click(button('가져오기 실행')!)
  }
  const statusWith = (text: string) =>
    [...document.querySelectorAll('[role="status"]')].find((el) => el.textContent?.includes(text))

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/import/inspect') return new Response(JSON.stringify(INSPECT_BODY), { status: 200 })
      if (url === '/api/import/execute') return executeResponse()
      throw new Error(`unexpected fetch ${url}`)
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(
      <LocaleProvider initialLocale="ko"><ToastProvider>
        <ImportWizard projectId="11111111-1111-4111-8111-111111111111" currentItemCount={0} />
      </ToastProvider></LocaleProvider>,
    ))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('profileSave 실패가 경고(role=status)로 보이고 사유 코드를 싣는다 — 펼침 버튼은 그대로 있고 설명은 저장/표준 양식 안내(SP4 §4.3)', async () => {
    executeResponse = () => new Response(JSON.stringify({ ok: true, count: 2, mode: 'append', reindexed: 0, profileSaved: false,
      profileSave: { ok: false, code: 'CONFIG_UNAVAILABLE', error: 'x' } }), { status: 200 })
    await runToDone()
    const status = statusWith(t('ko', 'importWizard.profileSaveFailedTitle'))
    expect(status).toBeTruthy()
    expect(status!.textContent).toContain('CONFIG_UNAVAILABLE')
    // 처방은 다음 가져오기의 '양식 저장' 선택 — 설정 화면에는 양식을 저장하는 UI 가 없고, '다시 시도'는 교체 가져오기를 다시 돌려
    // 변경 이력을 또 지운다(FM-14)
    expect(status!.textContent).toContain(t('ko', 'importWizard.saveProfileLabel'))
    expect(status!.textContent).not.toMatch(/설정 화면에서 다시 저장|다시 시도/)
    for (const locale of ['ko', 'en'] as const) expect(t(locale, 'importWizard.profileSaveFailedDesc')).toContain(t(locale, 'importWizard.saveProfileLabel'))
    // 저장 양식이 없으면 라우트가 표준 양식으로 낸다(409 는 더 없다) — 버튼은 양식 저장 여부와 무관하게 보이고 설명만 다르다
    expect(document.querySelector(`[aria-label="${t('ko', 'importWizard.exportProfileButton')}"]`)).not.toBeNull()
    expect(container.textContent).toContain(t('ko', 'importWizard.exportLayoutDesc'))
    expect(container.textContent).not.toContain(t('ko', 'importWizard.exportProfileDesc'))
  })

  it('저장하지 않았을 뿐(profileSave 없음)이면 경고가 없다', async () => {
    executeResponse = () => new Response(JSON.stringify({ ok: true, count: 2, mode: 'append', reindexed: 0, profileSaved: false }), { status: 200 })
    await runToDone()
    expect(container.textContent).toContain(t('ko', 'importWizard.doneCountSuffix'))   // 완료 화면까지 왔다
    expect(statusWith(t('ko', 'importWizard.profileSaveFailedTitle'))).toBeUndefined()
    expect(container.textContent).not.toContain(t('ko', 'importWizard.profileSaveFailedTitle'))
  })
})
