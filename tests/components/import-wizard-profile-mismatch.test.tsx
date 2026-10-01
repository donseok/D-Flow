// @vitest-environment jsdom
// Task 1b — 저장 양식과 파일 구조가 다르면 마법사는 경고(role=alert)와 함께 감지 결과로 시작하고, 사용자가 "저장된 양식 사용"을
// 직접 고르기 전에는 저장 양식을 보내지 않는다. 실제 LocaleProvider·ToastProvider 로 그려 i18n 키 배선까지 본다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExcelProfile } from '@/lib/excel/profile'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/app/actions/importBackup', () => ({ getWbsBackup: vi.fn() }))   // 마법사가 import 하는 서버 액션 — 이 테스트는 append 만 돈다

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { ensureEnLoaded } from '@/lib/i18n/dict'
import { ToastProvider } from '@/components/ui/Toast'
import { ImportWizard } from '@/components/import/ImportWizard'

const SAVED: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
  teamColumns: [[6, '팀A']], ownerMarks: { '●': 'primary', '△': 'support' },
}
const DETECTED: ExcelProfile = {
  ...SAVED,
  logical: { ...SAVED.logical, deliverable: 3, start: 4, end: 5, actualPct: 6 },
  teamColumns: [[7, '팀A'], [8, '팀B']],
}
const MISMATCH = { fields: ['deliverable', 'start', 'end', 'actualPct', 'teamColumns'], extraTeams: ['팀B'], missingTeams: [] }
const INSPECT_BODY = {
  ok: true,
  detection: {
    sheetNames: ['WBS'], profile: DETECTED, confidence: { header: 1, hierarchy: 1, logical: 1 },
    preview: { headers: [], rows: [] }, warnings: [],
  },
  savedProfile: SAVED,
  profileMismatch: MISMATCH,
}

let executeResponse: () => Response
const executeForms: FormData[] = []

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/import/inspect') return new Response(JSON.stringify(INSPECT_BODY), { status: 200 })
    if (url === '/api/import/execute') { executeForms.push(init!.body as FormData); return executeResponse() }
    throw new Error(`unexpected fetch ${url}`)
  }))
}

describe('ImportWizard — 저장 양식·파일 구조 불일치', () => {
  let container: HTMLDivElement
  let root: Root

  const button = (name: string) =>
    [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === name) as HTMLButtonElement | undefined
  const click = (el: HTMLElement) => act(async () => { el.click(); await Promise.resolve() })
  const lastForm = () => {
    const fd = executeForms.at(-1)!
    return {
      profile: JSON.parse(String(fd.get('profile'))) as ExcelProfile,
      useSavedProfile: fd.get('useSavedProfile'), confirmProfileMismatch: fd.get('confirmProfileMismatch'),
      saveProfile: fd.get('saveProfile'),
    }
  }

  async function inspectFile() {
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'wbs.xlsx')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await click(button('양식 분석하기')!)
  }

  beforeEach(async () => {
    executeForms.length = 0
    executeResponse = () => new Response(JSON.stringify({ ok: true, count: 2, mode: 'append', reindexed: 0, profileSaved: false }), { status: 200 })
    stubFetch()
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

  it('경고를 띄우고 감지 결과로 실행한다 — 저장 양식 플래그 없음', async () => {
    await inspectFile()
    const alert = [...container.querySelectorAll('[role=alert]')].find(a => a.textContent?.includes('저장된 양식과 이 파일의 열 구조가 다릅니다'))
    expect(alert).toBeDefined()
    expect(alert!.textContent).toContain('팀B')
    expect(alert!.textContent).toContain('시작')
    expect(button('저장된 양식 사용')).toBeDefined()

    await click(button('가져오기 실행')!)
    expect(lastForm().profile.logical.start).toBe(4)
    expect(lastForm().profile.teamColumns).toEqual(DETECTED.teamColumns)
    expect(lastForm()).toMatchObject({ useSavedProfile: 'false', confirmProfileMismatch: 'false' })
  })

  const saveBox = () =>
    container.querySelector<HTMLInputElement>('input[type=checkbox][aria-label="이 양식을 프로젝트 기본값으로 저장"]')!

  it('불일치면 "기본값으로 저장"이 꺼진 채로 시작해 감지 양식이 저장 양식을 덮어쓰지 않는다', async () => {
    await inspectFile()
    expect(saveBox().checked).toBe(false)
    await click(button('가져오기 실행')!)
    expect(lastForm().saveProfile).toBe('false')
  })

  it('불일치여도 사용자가 켜면 저장한다', async () => {
    await inspectFile()
    await click(saveBox())
    expect(saveBox().checked).toBe(true)
    await click(button('가져오기 실행')!)
    expect(lastForm().saveProfile).toBe('true')
  })

  it('"저장된 양식 사용"을 누른 뒤에만 저장 양식을 확인 플래그와 함께 보낸다', async () => {
    await inspectFile()
    await click(button('저장된 양식 사용')!)
    expect(button('저장된 양식 사용')).toBeUndefined() // 고른 뒤에는 되돌리기(감지 결과로)만 남는다
    await click(button('가져오기 실행')!)
    expect(lastForm().profile.logical.start).toBe(3)
    expect(lastForm()).toMatchObject({ useSavedProfile: 'true', confirmProfileMismatch: 'true' })
  })

  // 서버 문구는 한국어 고정(로그·API 용) — 화면은 코드로 i18n 문구를 고른다(T1b 리뷰 carry g).
  it('서버가 409 PROFILE_MISMATCH 로 막으면 2단계에 머물며 코드에 맞는 i18n 사유를 보인다(서버 문구가 아니라)', async () => {
    executeResponse = () => new Response(
      JSON.stringify({ code: 'PROFILE_MISMATCH', error: '저장된 엑셀 양식과 파일 구조가 다릅니다(서버)', profileMismatch: MISMATCH }),
      { status: 409 },
    )
    await inspectFile()
    await click(button('가져오기 실행')!)
    expect(document.body.textContent).not.toContain('(서버)')
    expect(container.textContent).toContain('저장된 양식으로 읽으면 값이 다른 열에서 읽힙니다')
    expect(button('가져오기 실행')).toBeDefined()
  })

  it('409 PROFILE_MISMATCH 의 불일치가 없으면(대조 불가) 대조 불가 문구를 보인다', async () => {
    executeResponse = () => new Response(
      JSON.stringify({ code: 'PROFILE_MISMATCH', error: '파일 구조를 감지하지 못해(서버)', profileMismatch: null }),
      { status: 409 },
    )
    await inspectFile()
    await click(button('가져오기 실행')!)
    expect(document.body.textContent).not.toContain('(서버)')
    expect(container.textContent).toContain('저장된 양식과 대조할 수 없습니다')
  })

  it('영어 화면에서는 409 PROFILE_MISMATCH 사유를 영어로 보인다', async () => {
    await ensureEnLoaded()   // EN 사전은 지연 청크다
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(
      <LocaleProvider initialLocale="en"><ToastProvider>
        <ImportWizard projectId="11111111-1111-4111-8111-111111111111" currentItemCount={0} />
      </ToastProvider></LocaleProvider>,
    ))
    executeResponse = () => new Response(
      JSON.stringify({ code: 'PROFILE_MISMATCH', error: '저장된 엑셀 양식과 파일 구조가 다릅니다(서버)', profileMismatch: MISMATCH }),
      { status: 409 },
    )
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'wbs.xlsx')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await click(button('Analyze layout')!)
    await click(button('Run import')!)
    expect(document.body.textContent).not.toContain('(서버)')
    expect(container.textContent).toContain('would take values from the wrong columns')
  })
})
