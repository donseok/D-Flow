// @vitest-environment jsdom
// 사용자 테스트 버그 리포트(2026-10-10)의 가져오기 마법사 — 화면 배선: 계층 방식 전환 뒤의 깊이(BUG-08), 계층 열 고르기·실행 잠금(BUG-07),
// 양식 저장 기본값(BUG-04), 새로 만들 팀·건너뛴 행 미리보기(BUG-10·33), 단계 표시로 돌아가기(BUG-30).
// 실제 LocaleProvider·ToastProvider 로 그려 사전 키 배선까지 본다.
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

const HEADERS = ['단계', '작업', '활동', '시작일', '종료일']
const ROWS = [
  ['2. 설계', '', '', '', ''],
  ['', '2.1 화면설계', '', '2026-10-20', '2026-10-31'],
  ['', '', '2.1.1 와이어프레임', '2026-10-20', '2026-10-24'],
  ['', '2.2 DB설계', '', '2026-11-01', '2026-11-15'],
]
/** 감지가 구조를 확정하지 못한 파일 — 아웃라인 후보는 없고(코드 열 모름) 열=계층 후보는 단계·작업·활동 */
const UNSURE: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0,
  hierarchy: { kind: 'outline', column: 0 },
  logical: { extraAxis: null, code: null, name: null, deliverable: null, start: 3, end: 4, weight: null, actualPct: null },
  teamColumns: [], ownerMarks: { '●': 'primary', '△': 'support' },
}
let inspectBody: Record<string, unknown>
const executeForms: FormData[] = []

describe('ImportWizard — 버그 리포트 회귀', () => {
  let container: HTMLDivElement
  let root: Root

  const button = (name: string) =>
    [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === name) as HTMLButtonElement | undefined
  const click = (el: HTMLElement) => act(async () => { el.click(); await Promise.resolve() })
  const radio = (label: string) => container.querySelector<HTMLInputElement>(`input[type=radio][aria-label="${label}"]`)!
  const depths = () => [...container.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td')?.textContent)
  const saveBox = () => container.querySelector<HTMLInputElement>('input[type=checkbox][aria-label="이 양식을 프로젝트 기본값으로 저장"]')!
  const hierarchyBoxes = () => [...container.querySelectorAll<HTMLInputElement>('[data-hierarchy-columns] input[type=checkbox]')]

  async function inspectFile() {
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'wbs.xlsx')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await click(button('양식 분석하기')!)
  }

  beforeEach(async () => {
    executeForms.length = 0
    inspectBody = {
      ok: true,
      detection: {
        sheetNames: ['WBS'], profile: UNSURE, confidence: { header: 1, hierarchy: 0, logical: 0.3 },
        preview: { headers: HEADERS, rows: ROWS }, warnings: ["'이름' 열을 찾지 못했습니다 — 2단계에서 이름 열을 직접 지정하세요"],
        hierarchyCandidates: { columns: [0, 1, 2], outline: 0, name: null }, uncertain: true,
      },
      savedProfile: null, profileMismatch: null, skippedHolidays: [], newTeams: ['신규팀'], skippedRows: 2,
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/import/inspect') return new Response(JSON.stringify(inspectBody), { status: 200 })
      if (url === '/api/import/execute') {
        executeForms.push(init!.body as FormData)
        return new Response(JSON.stringify({ ok: true, kind: 'applied', commandId: '00000000-0000-4000-8000-000000001aa2', count: 4, mode: 'append', reindexed: 0, profileSaved: false, skippedRows: 2 }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(
      <LocaleProvider><ToastProvider>
        <ImportWizard projectId="11111111-1111-4111-8111-111111111111" currentItemCount={0} timeZone="UTC" />
      </ToastProvider></LocaleProvider>,
    ))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('[BUG-07] 이름 열을 못 찾은 아웃라인 양식은 실행이 닫히고 사유를 말한다 — 추정으로 실행하지 않는다', async () => {
    await inspectFile()
    expect(radio('아웃라인 코드').checked).toBe(true)
    expect(container.textContent).toContain('이름 열을 골라야 실행할 수 있습니다.')
    expect(button('가져오기 실행')!.disabled).toBe(true)
  })

  it('[BUG-08] 열=계층으로 바꾸면 감지된 후보(단계·작업·활동)가 계층 열이 되고 깊이가 0·1·2·1 로 다시 계산된다', async () => {
    await inspectFile()
    await click(radio('열 = 계층'))
    expect(hierarchyBoxes().map(b => b.checked)).toEqual([true, true, true, false, false])
    expect(depths()).toEqual(['0', '1', '2', '1'])
    // 계층 표지는 세 열에만 — '시작일' 열에 '계층' 이 남지 않는다
    const heads = [...container.querySelectorAll('thead th')].map(th => th.textContent ?? '')
    expect(heads.filter(h => h.includes('계층')).length).toBe(3)
    expect(heads.find(h => h.startsWith('시작일'))).toBe('시작일시작일')   // 머리 + 논리 열 표지(시작일)
    expect(button('가져오기 실행')!.disabled).toBe(false)

    await click(button('가져오기 실행')!)
    const sent = JSON.parse(String(executeForms.at(-1)!.get('profile'))) as ExcelProfile
    expect(sent.hierarchy).toEqual({ kind: 'columns', columns: [0, 1, 2] })
    expect(sent.logical.name).toBeNull()
  })

  it('[BUG-08] 계층 열은 화면에서 고친다 — 다 끄면 실행이 닫히고, 켠 열의 순서는 왼쪽부터다', async () => {
    await inspectFile()
    await click(radio('열 = 계층'))
    for (const box of hierarchyBoxes().slice(0, 3)) await click(box)
    expect(container.textContent).toContain('계층 열을 하나 이상 골라야 실행할 수 있습니다.')
    expect(button('가져오기 실행')!.disabled).toBe(true)
    expect(depths()).toEqual(['?', '?', '?', '?'])
    await click(hierarchyBoxes()[1])
    await click(hierarchyBoxes()[0])
    expect(depths()).toEqual(['0', '1', '?', '1'])
    expect(button('가져오기 실행')!.disabled).toBe(false)
  })

  it('[BUG-04] "기본값으로 저장"은 꺼진 채 시작하고 saveProfile=false 로 간다. 구조를 확정하지 못한 파일에서 켜면 저장되지 않을 수 있음을 알린다', async () => {
    await inspectFile()
    await click(radio('열 = 계층'))
    expect(saveBox().checked).toBe(false)
    expect(container.textContent).not.toContain('열 지정을 직접 고치지 않으면 양식은 저장되지 않습니다')
    await click(saveBox())
    expect(container.textContent).toContain('열 지정을 직접 고치지 않으면 양식은 저장되지 않습니다')
    await click(saveBox())
    await click(button('가져오기 실행')!)
    expect(executeForms.at(-1)!.get('saveProfile')).toBe('false')
  })

  it('[BUG-10·33] 새로 만들 팀과 건너뛸 행 수를 실행 전에 보이고, 완료 화면도 건너뛴 수를 말한다', async () => {
    await inspectFile()
    const teams = container.querySelector('[data-new-teams]')
    expect(teams?.textContent).toContain('새로 만들 팀 1개')
    expect(teams?.textContent).toContain('신규팀')
    expect(container.querySelector('[data-skipped-rows]')?.textContent).toBe('이름도 값도 없는 행 2개는 건너뜁니다.')
    await click(radio('열 = 계층'))
    await click(button('가져오기 실행')!)
    expect(container.textContent).toContain('가져오기 완료')
    expect(container.querySelector('[data-skipped-rows]')?.textContent).toBe('이름도 값도 없는 행 2개를 건너뛰었습니다.')
  })

  it('[BUG-10] 새 팀이 없으면(또는 서버가 판정하지 못하면) 그 안내를 그리지 않는다', async () => {
    inspectBody = { ...inspectBody, newTeams: [], skippedRows: 0 }
    await inspectFile()
    expect(container.querySelector('[data-new-teams]')).toBeNull()
    expect(container.querySelector('[data-skipped-rows]')).toBeNull()
  })

  it('[BUG-30] 단계 표시를 눌러 파일 선택으로 돌아가고, 다시 눌러 검토로 온다 — 고친 양식이 그대로다. 완료 뒤에는 누를 수 없다', async () => {
    expect(container.querySelector('[data-step-goto]')).toBeNull()   // 아직 끝낸 단계가 없다
    await inspectFile()
    await click(radio('열 = 계층'))
    const back = container.querySelector<HTMLButtonElement>('[data-step-goto]')!
    expect(back.textContent).toContain('파일 선택 단계로 돌아가기')
    await click(back)
    expect(button('양식 분석하기')).toBeDefined()
    expect(container.textContent).toContain('wbs.xlsx')             // 고른 파일이 남아 있다
    const forward = container.querySelector<HTMLButtonElement>('[data-step-goto]')!
    expect(forward.textContent).toContain('확인 및 실행 단계로 돌아가기')
    await click(forward)
    expect(radio('열 = 계층').checked).toBe(true)                   // 다시 분석하지 않았다 — 고친 방식 그대로
    expect(depths()).toEqual(['0', '1', '2', '1'])
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(([u]) => u === '/api/import/inspect')).toHaveLength(1)

    await click(button('가져오기 실행')!)
    expect(container.textContent).toContain('가져오기 완료')
    expect(container.querySelector('[data-step-goto]')).toBeNull()
  })
})
