// @vitest-environment jsdom
// SP4 §4.4·D50·D54 — 마법사가 실행 의도의 명령 id 를 폼에 싣고(재시도·등록 재실행은 같은 id, 성공 뒤·입력 변경·확정 실패 뒤는 새 id,
// 같은 파일을 다시 골라도 같은 id — RF3), 상속 프로젝트의 409 에 전환 확인 문구를 보이며(슈퍼유저 전용 분기 없음 — D4),
// replace 는 사전 백업 내려받기를 시작한 뒤에만 실행한다(D50). 실제 LocaleProvider·ToastProvider 로 그린다(import-wizard-profile-mismatch 방식).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExcelProfile } from '@/lib/excel/profile'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ getWbsBackup: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/app/actions/importBackup', () => ({ getWbsBackup: h.getWbsBackup }))

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ImportWizard } from '@/components/import/ImportWizard'

const P = '00000000-0000-0000-7e57-0000000018a1'
const LM = 1_790_000_000_000
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DETECTED: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
  teamColumns: [[6, 'CIV']], ownerMarks: { '●': 'primary', '△': 'support' },
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
const applied = (over: Record<string, unknown> = {}) => new Response(JSON.stringify({
  ok: true, kind: 'applied', commandId: 'echo', count: 2, mode: 'append', reindexed: 0, profileSaved: false, ...over,
}), { status: 200 })
const needsTeams = (inheritsCommon: boolean) => new Response(JSON.stringify({
  ok: false, code: 'NEEDS_TEAMS', needsTeams: ['CIV'], inheritsCommon,
  commonTeams: inheritsCommon ? [{ code: 'RES', name: '연구팀' }, { code: 'OPS', name: '운영팀' }] : [],
  error: '등록되지 않은 팀이 있습니다.',
}), { status: 409 })
const failure = (status: number, code: string, error: string) =>
  new Response(JSON.stringify({ ok: false, code, error, ...(status === 503 ? { retryable: true } : {}) }), { status })
const NETWORK_DOWN = (): Response => { throw new TypeError('Failed to fetch') }

let executeResponse: (form: FormData) => Response
const forms: FormData[] = []
const downloads: string[] = []

beforeAll(() => {
  // jsdom 에는 객체 URL 이 없다 — 내려받기(downloadBackup)가 쓰는 둘만 채운다
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:wbs-backup'), revokeObjectURL: vi.fn() })
})

describe('ImportWizard — 명령 id·전환 확인·사전 백업(SP4 §4.4·D50·D54)', () => {
  let container: HTMLDivElement
  let root: Root

  const button = (name: string) =>
    [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === name) as HTMLButtonElement | undefined
  /** 클릭 뒤 fetch·json·서버 액션의 약속 사슬이 다 풀릴 때까지 기다린다 */
  const press = (el: HTMLElement) => act(async () => {
    el.click()
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
  const saveBox = () => document.querySelector<HTMLInputElement>('input[type=checkbox][aria-label="이 양식을 프로젝트 기본값으로 저장"]')!
  const replaceRadio = () => document.querySelector<HTMLInputElement>('input[type=radio][aria-label="전체 교체(replace)"]')!
  const sent = (i: number) => ({ commandId: forms[i].get('commandId'), registerTeams: forms[i].get('registerTeams'), mode: forms[i].get('mode') })

  async function inspect(file = new File(['x'], 'wbs.xlsx', { lastModified: LM })) {
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await press(button('양식 분석하기')!)
  }

  beforeEach(async () => {
    forms.length = 0
    downloads.length = 0
    executeResponse = () => applied()
    h.getWbsBackup.mockReset()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/import/inspect') return new Response(JSON.stringify(INSPECT_BODY), { status: 200 })
      if (url === '/api/import/execute') {
        const fd = init!.body as FormData
        forms.push(fd)
        return executeResponse(fd)
      }
      throw new Error(`unexpected fetch ${url}`)
    }))
    // <a download>.click() 은 jsdom 에서 탐색을 시도한다 — 내려받기 이름만 모은다(afterEach 가 상속된 HTMLElement.click 으로 되돌린다)
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { downloads.push(this.download) }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(
      <LocaleProvider initialLocale="ko"><ToastProvider>
        <ImportWizard projectId={P} currentItemCount={3} />
      </ToastProvider></LocaleProvider>,
    ))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    delete (HTMLAnchorElement.prototype as Partial<HTMLAnchorElement>).click
  })

  it('실행은 명령 id(uuid v4)를 싣는다 — 네트워크 실패 뒤 다시 누르면 같은 id 로 재시도한다', async () => {
    executeResponse = NETWORK_DOWN
    await inspect()
    await press(button('가져오기 실행')!)
    expect(String(sent(0).commandId)).toMatch(UUID_V4)
    expect(document.body.textContent).toContain('네트워크 오류가 발생했습니다')
    executeResponse = () => applied()
    await press(button('가져오기 실행')!)
    expect(sent(1).commandId).toBe(sent(0).commandId)
    expect(document.body.textContent).toContain('가져오기 완료')
  })

  it('503(재시도 가능) 뒤에는 같은 id, 422(확정 실패 — COMMAND_REUSED) 뒤에는 새 id', async () => {
    executeResponse = () => failure(503, 'CONFIG_BUSY', '잠시 후 다시 시도하세요.')
    await inspect()
    await press(button('가져오기 실행')!)
    executeResponse = () => failure(422, 'COMMAND_REUSED', '이미 다른 내용으로 쓴 실행 ID 입니다.')
    await press(button('가져오기 실행')!)
    executeResponse = () => applied()
    await press(button('가져오기 실행')!)
    expect(sent(1).commandId).toBe(sent(0).commandId)
    expect(sent(2).commandId).not.toBe(sent(1).commandId)
    expect(String(sent(2).commandId)).toMatch(UUID_V4)
  })

  it('상속 프로젝트의 409 — 전환 확인 문구와 공용 팀 목록, 슈퍼유저 전용 문구 없음. 등록 재실행은 같은 id 와 registerTeams=true', async () => {
    executeResponse = (fd) => (fd.get('registerTeams') === 'true' ? applied() : needsTeams(true))
    await inspect()
    await press(button('가져오기 실행')!)
    const dialog = document.querySelector('[role=dialog]')!
    expect(dialog.textContent).toContain('공용 팀 2개')
    expect(dialog.textContent).toContain('같은 코드·이름·색의 이 프로젝트 팀으로 전환')
    expect(dialog.querySelector('[data-teams-convert]')!.textContent).toContain('연구팀')
    expect(dialog.textContent).toContain('CIV')
    expect(document.body.textContent).not.toContain('슈퍼유저')
    const register = button('등록하고 계속')!
    expect(register.disabled).toBe(false)
    await press(register)
    expect([sent(0).registerTeams, sent(1).registerTeams]).toEqual(['false', 'true'])
    expect(sent(1).commandId).toBe(sent(0).commandId)
    expect(document.body.textContent).toContain('가져오기 완료')
  })

  it('전용 팀이 있는 프로젝트의 409 — 이 프로젝트 팀으로 등록한다는 안내(전환 문구 없음), 등록 버튼은 열려 있다', async () => {
    executeResponse = () => needsTeams(false)
    await inspect()
    await press(button('가져오기 실행')!)
    const dialog = document.querySelector('[role=dialog]')!
    expect(dialog.textContent).toContain('이 프로젝트의 팀으로 등록됩니다')
    expect(dialog.querySelector('[data-teams-convert]')).toBeNull()
    expect(dialog.textContent).not.toContain('전환')
    expect(button('등록하고 계속')!.disabled).toBe(false)
  })

  it('성공 뒤 같은 파일로 다시 가져오면 새 id — 옛 id 로 duplicate 만 받지 않는다', async () => {
    await inspect()
    await press(button('가져오기 실행')!)
    await press(button('다른 파일 가져오기')!)
    await inspect()
    await press(button('가져오기 실행')!)
    expect(forms).toHaveLength(2)
    expect(sent(1).commandId).not.toBe(sent(0).commandId)
  })

  it('응답을 잃은 뒤 처음부터 다시 — 같은 파일을 다시 골라 같은 입력으로 실행하면 같은 id(두 벌이 되지 않는다, RF3)', async () => {
    executeResponse = NETWORK_DOWN
    await inspect()
    await press(button('가져오기 실행')!)
    await press(button('처음부터 다시')!)
    executeResponse = () => applied()
    await inspect(new File(['x'], 'wbs.xlsx', { lastModified: LM }))   // OS 에서 다시 고른 같은 파일 — 새 File 객체, 같은 이름·크기·수정 시각
    await press(button('가져오기 실행')!)
    expect(sent(1).commandId).toBe(sent(0).commandId)
  })

  it('입력이 바뀌면 새 id — 양식 저장을 끄면 다른 실행이다', async () => {
    executeResponse = NETWORK_DOWN
    await inspect()
    await press(button('가져오기 실행')!)
    await press(saveBox())
    await press(button('가져오기 실행')!)
    expect(sent(1).commandId).not.toBe(sent(0).commandId)
  })

  it('replace — 사전 백업을 받기 전에는 실행이 잠기고, 백업 읽기에 실패하면 실행하지 않는다', async () => {
    h.getWbsBackup.mockResolvedValue({ ok: false, code: 'BACKUP_UNAVAILABLE', error: '지금 WBS 를 백업하지 못했습니다. 잠시 후 다시 시도하세요.' })
    await inspect()
    await press(replaceRadio())
    expect(document.querySelector('[data-pre-backup]')).not.toBeNull()
    expect(button('가져오기 실행')!.disabled).toBe(true)
    await press(button('실행 전 백업 받기')!)
    expect(h.getWbsBackup).toHaveBeenCalledWith(P)
    expect(document.body.textContent).toContain('지금 WBS 를 백업하지 못했습니다')
    expect(downloads).toEqual([])
    expect(button('가져오기 실행')!.disabled).toBe(true)
    expect(forms).toHaveLength(0)
  })

  it('replace — 백업 액션 호출이 던져도(네트워크) 실행은 잠긴 채다', async () => {
    h.getWbsBackup.mockRejectedValue(new TypeError('Failed to fetch'))
    await inspect()
    await press(replaceRadio())
    await press(button('실행 전 백업 받기')!)
    expect(document.body.textContent).toContain('백업을 받지 못해 실행할 수 없습니다')
    expect(button('가져오기 실행')!.disabled).toBe(true)
  })

  it('replace — 백업 내려받기를 시작하면(이름에 실행 전) 실행이 열리고, 입력을 바꾸면 다시 잠긴다', async () => {
    h.getWbsBackup.mockResolvedValue({ ok: true, backup: { rows: [{ id: 'w-01' }], generatedAt: '2026-10-01T00:00:00.000Z' } })
    executeResponse = () => applied({ mode: 'replace' })
    await inspect()
    await press(replaceRadio())
    await press(button('실행 전 백업 받기')!)
    expect(downloads).toHaveLength(1)
    expect(downloads[0]).toMatch(new RegExp(`^wbs-backup-${P}-\\d{4}-\\d{2}-\\d{2}-실행 전\\.json$`))
    expect(button('가져오기 실행')!.disabled).toBe(false)
    await press(saveBox())
    expect(button('가져오기 실행')!.disabled).toBe(true)
    await press(saveBox())
    expect(button('가져오기 실행')!.disabled).toBe(false)
    await press(button('가져오기 실행')!)
    expect(forms).toHaveLength(1)
    expect(sent(0).mode).toBe('replace')
    expect(String(sent(0).commandId)).toMatch(UUID_V4)
  })
})
