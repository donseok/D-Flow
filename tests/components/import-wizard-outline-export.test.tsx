// @vitest-environment jsdom
// A2-2 리뷰 정확성 P2(U2) — 저장 양식이 아웃라인(공식 양식의 코드 열 1/1.1/1.1.1)이면 라우트가 펼침 내보내기를 400 으로 거부한다
// (sub-act 는 부모 code 를 승계해 아웃라인 깊이를 늘릴 근거가 없다). 완료 화면은 그 경우 늘 실패하는 버튼을 내지 않고 사유를 보인다.
// 판정 양식 = 이번에 저장했으면 방금 쓴 양식, 아니면 프로젝트에 이미 저장된 양식(없으면 표준 양식 — 펼침 가능). 근본 해결은 스펙 §9 이월.
// 렌더·fetch mock 은 import-wizard-profile-save-warning.test.tsx 방식.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExcelProfile } from '@/lib/excel/profile'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/app/actions/importBackup', () => ({ getWbsBackup: vi.fn() }))

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ImportWizard } from '@/components/import/ImportWizard'
import { t } from '@/lib/i18n/dict'

const LOGICAL = { extraAxis: null, code: null, name: 1, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 }
const OUTLINE: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
  hierarchy: { kind: 'outline', column: 0 }, logical: LOGICAL, teamColumns: [[6, 'RES']], ownerMarks: { '●': 'primary', '△': 'support' },
}
const COLUMNS: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
  hierarchy: { kind: 'columns', columns: [0, 1] }, logical: { ...LOGICAL, name: null }, teamColumns: [[6, 'RES']], ownerMarks: { '●': 'primary', '△': 'support' },
}
const inspectBody = (detected: ExcelProfile, saved: ExcelProfile | null) => ({
  ok: true,
  detection: { sheetNames: ['WBS'], profile: detected, confidence: { header: 1, hierarchy: 1, logical: 1 }, preview: { headers: [], rows: [] }, warnings: [] },
  savedProfile: saved,
  profileMismatch: null,
})
const done = (profileSaved: boolean) => new Response(JSON.stringify({ ok: true, kind: 'applied', commandId: '00000000-0000-4000-8000-000000001aa2', count: 2, mode: 'append', reindexed: 0, profileSaved }), { status: 200 })

let inspect: ReturnType<typeof inspectBody>
let executeResponse: () => Response

describe('ImportWizard 완료 화면 — 아웃라인 양식이면 펼침 내보내기 버튼 대신 사유(U2)', () => {
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
    expect(container.textContent).toContain(t('ko', 'importWizard.doneCountSuffix'))
  }
  const exportButton = () => document.querySelector(`[aria-label="${t('ko', 'importWizard.exportProfileButton')}"]`)

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/import/inspect') return new Response(JSON.stringify(inspect), { status: 200 })
      if (url === '/api/import/execute') return executeResponse()
      throw new Error(`unexpected fetch ${url}`)
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })
  const mount = () => act(async () => root.render(
    <LocaleProvider><ToastProvider>
      <ImportWizard projectId="11111111-1111-4111-8111-111111111111" currentItemCount={0} timeZone="UTC" />
    </ToastProvider></LocaleProvider>,
  ))

  it('이번에 아웃라인 양식을 저장했으면 버튼이 없고 사유(exportProfileUnsupported)를 보인다', async () => {
    inspect = inspectBody(OUTLINE, null); executeResponse = () => done(true)
    await mount(); await runToDone()
    expect(exportButton()).toBeNull()
    expect(container.textContent).toContain(t('ko', 'importWizard.exportProfileUnsupported'))
    expect(container.textContent).not.toContain(t('ko', 'importWizard.exportProfileDesc'))
  })
  it('이번에 저장하지 않았어도 프로젝트의 저장 양식이 아웃라인이면 같다(라우트가 그 양식을 쓴다)', async () => {
    inspect = inspectBody(OUTLINE, OUTLINE); executeResponse = () => done(false)
    await mount(); await runToDone()
    expect(exportButton()).toBeNull()
    expect(container.textContent).toContain(t('ko', 'importWizard.exportProfileUnsupported'))
    expect(container.textContent).not.toContain(t('ko', 'importWizard.exportLayoutDesc'))
  })
  it('아웃라인 파일이라도 저장하지 않았고 저장 양식이 없으면 표준 양식이라 버튼이 있다(대조)', async () => {
    inspect = inspectBody(OUTLINE, null); executeResponse = () => done(false)
    await mount(); await runToDone()
    expect(exportButton()).not.toBeNull()
    expect(container.textContent).toContain(t('ko', 'importWizard.exportLayoutDesc'))
    expect(container.textContent).not.toContain(t('ko', 'importWizard.exportProfileUnsupported'))
  })
  it('열 계층 양식을 저장했으면 버튼과 "이 양식 그대로" 설명(대조)', async () => {
    inspect = inspectBody(COLUMNS, null); executeResponse = () => done(true)
    await mount(); await runToDone()
    expect(exportButton()).not.toBeNull()
    expect(container.textContent).toContain(t('ko', 'importWizard.exportProfileDesc'))
  })
})
