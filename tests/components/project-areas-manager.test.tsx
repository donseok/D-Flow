// @vitest-environment jsdom
// 주간 업무영역 편집기(스펙 §4.1.8·D26) — kind 고정(종류 탭 없음), 저장은 upsertArea(→ RPC), 새 영역 코드는 이름으로 미리 채우고 고칠 수
// 있다(기존 영역은 불변), 비활성화 안내, 저장으로 생긴 주간 행 수 알림, 배정된 비활성·목록 밖 팀의 해제, 시트와 같은 영역 순서.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// 화면 문구는 사전(settingsUi·adminUi)에 있다 — 사전의 한국어 글자를 돌려주는 대역(공급자 없는 기본 t 는 키를 돌려준다)
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { UpsertAreaResult } from '@/app/actions/projectAreas'
import type { ConfigArea } from '@/lib/settings/projectConfig'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ upsertArea: vi.fn(), refresh: vi.fn(), toast: vi.fn() }))
vi.mock('@/app/actions/projectAreas', () => ({ upsertArea: h.upsertArea }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))

import { ProjectAreasManager } from '@/components/settings/ProjectAreasManager'

const EXP: ConfigArea = {
  id: 'a1', kind: 'weekly_section', code: 'EXP', name: '실험', sortOrder: 0, active: true, teams: [{ teamId: 't-res', kind: 'primary' }],
}
const DATA: ConfigArea = {
  id: 'a2', kind: 'weekly_section', code: 'DATA', name: '데이터', sortOrder: 1, active: true,
  teams: [{ teamId: 't-res', kind: 'primary' }, { teamId: 't-old', kind: 'support' }, { teamId: 't-unknown', kind: 'support' }],
}
const RUN: ConfigArea = { id: 'a3', kind: 'weekly_section', code: 'RUN', name: '운영', sortOrder: 1, active: false, teams: [] }
const TEAMS = [
  { id: 't-res', code: 'RES', active: true }, { id: 't-ops', code: 'OPS', active: true },
  { id: 't-old', code: 'OLD', active: false }, { id: 't-idle', code: 'IDLE', active: false },
]
const CREATED: UpsertAreaResult = { ok: true, id: 'a-new', status: 'created', rowsAdded: 2 }
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

describe('ProjectAreasManager — 주간 업무영역 편집기', () => {
  let container: HTMLDivElement
  let root: Root
  const renderWith = (areas: readonly ConfigArea[]) => act(() => root.render(
    <ProjectAreasManager projectId="p1" kind="weekly_section" areas={areas} teamOptions={TEAMS} />,
  ))
  beforeEach(() => {
    vi.clearAllMocks()
    h.upsertArea.mockResolvedValue(CREATED)
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    renderWith([RUN, DATA, EXP])
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel)
  const click = (sel: string) => act(() => { q(sel)!.click() })
  const clickNew = () => act(() => { [...container.querySelectorAll('button')].find(b => b.textContent?.includes('새 영역'))!.click() })
  const typeInto = (el: HTMLInputElement, value: string) => act(() => { setValue.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  const submit = () => act(async () => { q('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

  it('kind 는 고정이다 — 종류 탭이 없고, 저장은 weekly_section 으로 보낸다', async () => {
    expect(q('[data-area-editor="weekly_section"]')).not.toBeNull()
    expect(q('[role="tablist"]')).toBeNull()
    expect(q('[data-area-kind]')).toBeNull()
    expect(container.textContent).not.toContain('이슈 영역')
    click('[aria-label="EXP 편집"]')
    await submit()
    expect(h.upsertArea).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'a1', kind: 'weekly_section' }))
  })

  it('영역은 시트와 같은 순서(순서, 코드)로 보인다', () => {
    expect([...container.querySelectorAll('tr[data-area-row]')].map(r => r.getAttribute('data-area-row'))).toEqual(['EXP', 'DATA', 'RUN'])
  })

  it('기존 영역을 편집하면 코드는 읽기 전용, 새 영역은 입력 가능', () => {
    click('[aria-label="EXP 편집"]')
    expect(q<HTMLInputElement>('input[data-area-code]')!.value).toBe('EXP')
    expect(q<HTMLInputElement>('input[data-area-code]')!.readOnly).toBe(true)
    clickNew()
    expect(q<HTMLInputElement>('input[data-area-code]')!.value).toBe('')
    expect(q<HTMLInputElement>('input[data-area-code]')!.readOnly).toBe(false)
  })

  it('새 영역의 코드는 이름으로 미리 채우고, 코드를 고친 뒤에는 이름을 따라가지 않는다', async () => {
    clickNew()
    typeInto(q<HTMLInputElement>('input[data-area-name]')!, '품질')
    expect(q<HTMLInputElement>('input[data-area-code]')!.value).toBe('품질')
    typeInto(q<HTMLInputElement>('input[data-area-code]')!, 'QA')
    typeInto(q<HTMLInputElement>('input[data-area-name]')!, '품질 관리')
    expect(q<HTMLInputElement>('input[data-area-code]')!.value).toBe('QA')
    await submit()
    expect(h.upsertArea).toHaveBeenCalledWith('p1', { kind: 'weekly_section', code: 'QA', name: '품질 관리', sortOrder: 2, active: true, teams: [] })
  })

  it('기존 영역은 이름을 바꿔도 코드가 따라가지 않는다', () => {
    click('[aria-label="DATA 편집"]')
    typeInto(q<HTMLInputElement>('input[data-area-name]')!, '데이터 플랫폼')
    expect(q<HTMLInputElement>('input[data-area-code]')!.value).toBe('DATA')
  })

  it('편집 저장은 id·kind·담당 팀을 넘기고, 새로 생긴 주간 행 수를 알린 뒤 새로고침한다', async () => {
    click('[aria-label="EXP 편집"]')
    const sel = q<HTMLSelectElement>('select[data-area-team="OPS"]')!
    act(() => { sel.value = 'support'; sel.dispatchEvent(new Event('change', { bubbles: true })) })
    await submit()
    expect(h.upsertArea).toHaveBeenCalledWith('p1', {
      id: 'a1', kind: 'weekly_section', code: 'EXP', name: '실험', sortOrder: 0, active: true,
      teams: [{ teamId: 't-res', kind: 'primary' }, { teamId: 't-ops', kind: 'support' }],
    })
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "'EXP' 영역을 저장했습니다.", description: expect.stringContaining('2곳'), variant: 'success',
    }))
    expect(h.refresh).toHaveBeenCalled()
  })

  it('생긴 행이 없으면(비활성 영역 저장 등) 행 수를 말하지 않는다', async () => {
    h.upsertArea.mockResolvedValue({ ok: true, id: 'a3', status: 'updated', rowsAdded: 0 } satisfies UpsertAreaResult)
    click('[aria-label="RUN 편집"]')
    await submit()
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(h.toast.mock.calls[0][0].description).toBeUndefined()
  })

  it('비활성으로 바꾸면 "이번 주 이후 시트에서 숨겨지고 내용은 남는다"를 안내한다', () => {
    click('[aria-label="EXP 편집"]')
    expect(q('[data-area-deactivate-note]')).toBeNull()
    act(() => { q<HTMLInputElement>('input[data-area-active]')!.click() })
    const note = q('[data-area-deactivate-note]')!
    expect(note.textContent).toContain('이번 주 이후 주간 시트에서 숨겨지고')
    expect(note.textContent).toContain('남습니다')
  })

  it('배정된 비활성·목록 밖 팀은 표·폼에 표시되고 해제할 수 있다, 배정 안 된 비활성 팀은 폼에 없다', async () => {
    const dataRow = q('tr[data-area-row="DATA"]')!
    expect(dataRow.textContent).toContain('OLD(비활성)')
    expect(dataRow.textContent).toContain('알 수 없는 팀')
    click('[aria-label="DATA 편집"]')
    const old = q<HTMLSelectElement>('select[data-area-team="OLD"]')!
    expect(old.value).toBe('support')
    expect(old.closest('label')!.textContent).toContain('비활성')
    expect(q('select[data-area-team="IDLE"]')).toBeNull()
    act(() => { old.value = ''; old.dispatchEvent(new Event('change', { bubbles: true })) })
    await submit()
    const sent = h.upsertArea.mock.calls[0][1] as { teams: { teamId: string }[] }
    expect(sent.teams.map(t => t.teamId)).not.toContain('t-old')
  })

  it('순서 칸이 비어 있으면 저장하지 않고 안내한다(0 으로 바꾸지 않는다)', async () => {
    click('[aria-label="EXP 편집"]')
    typeInto(q<HTMLInputElement>('input[data-area-order]')!, '')
    await submit()
    expect(h.upsertArea).not.toHaveBeenCalled()
    expect(q('[role="alert"]')?.textContent).toBe('순서를 입력하세요.')
  })

  it('저장 실패는 액션의 고정 문구를 보이고 새로고침하지 않는다', async () => {
    h.upsertArea.mockResolvedValue({ ok: false, code: 'AREA_FORBIDDEN', error: '이 프로젝트의 업무영역을 바꿀 권한이 없습니다.' } satisfies UpsertAreaResult)
    click('[aria-label="EXP 편집"]')
    await submit()
    expect(q('[role="alert"]')!.textContent).toBe('이 프로젝트의 업무영역을 바꿀 권한이 없습니다.')
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('영역이 하나도 없으면 주간보고에 영역이 필요하다고 안내한다', () => {
    renderWith([])
    expect(container.textContent).toContain('아직 업무영역이 없습니다')
    expect(container.textContent).toContain('주간보고')
  })
})
