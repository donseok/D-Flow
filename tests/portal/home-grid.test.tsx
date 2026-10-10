// @vitest-environment jsdom
// 홈 구성(편집 모드) — 추가·제거·이동·크기·취소·되돌리기·저장 실패, 키보드 조작, 초점·라이브 영역(2026-10-10 위젯 강화)
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../shell/_dom'
const h = vi.hoisted(() => ({ save: vi.fn(), reload: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ postPrefsNow: h.save }))
vi.mock('@/lib/portal/reload', () => ({ reloadPortalPage: h.reload }))
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
import { HomeGrid, type HomeGalleryItem, type HomeGridSlot } from '@/components/portal/HomeGrid'
import type { LayoutItem, PortalWidgetId, WidgetSize } from '@/lib/portal/widgets'

const TITLE: Partial<Record<PortalWidgetId, string>> = { my_work: '내 업무', projects: '진행 중인 프로젝트', upcoming: '다가오는 회의', memo: '메모', due_work: '지연·임박 작업' }
const slot = (id: PortalWidgetId, size: WidgetSize): HomeGridSlot => ({ id, size, title: TITLE[id]!, node: <section data-widget={id}><a href={`/x/${id}`}>{TITLE[id]} 본문</a></section> })
const SLOTS = [slot('my_work', 'full'), slot('projects', 'full'), slot('upcoming', 'half')]
const GALLERY: HomeGalleryItem[] = (['my_work', 'projects', 'upcoming', 'memo', 'due_work'] as const).map((id) => ({ id, title: TITLE[id]!, desc: `${TITLE[id]} 설명`, size: id === 'my_work' || id === 'projects' ? 'full' : 'half', isNew: id === 'due_work' }))
const DEFAULTS: LayoutItem[] = [{ id: 'my_work', size: 'full' }, { id: 'projects', size: 'full' }, { id: 'upcoming', size: 'half' }]
const mount = (over: Partial<Parameters<typeof HomeGrid>[0]> = {}) =>
  render(<HomeGrid workspaceId="ws" slots={SLOTS} gallery={GALLERY} defaults={DEFAULTS} personal={false} canEdit {...over} />)
const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const cells = () => [...document.querySelectorAll('[data-widget-cell]')].map((el) => `${el.getAttribute('data-widget-cell')}:${el.getAttribute('data-size')}`)
const live = () => document.querySelector('[aria-live="polite"]')!.textContent
const open = () => fireEvent.click(btn('홈 구성'))
const saved = () => h.save.mock.calls[0][0] as { prefs: { portalLayout: unknown; portalHiddenWidgets: unknown }; workspaceId: string }
beforeEach(() => { h.save.mockReset(); h.reload.mockReset() })

describe('보기 모드', () => {
  it('위젯을 순서·크기대로 놓는다 — 2열 격자(좁으면 한 열), full 은 두 칸', () => {
    mount()
    expect(cells()).toEqual(['my_work:full', 'projects:full', 'upcoming:half'])
    const grid = document.querySelector('[data-home-grid] .grid')!
    expect(grid.className).toContain('grid-cols-1'); expect(grid.className).toContain('lg:grid-cols-2')
    expect(document.querySelector('[data-widget-cell="my_work"]')!.className).toContain('lg:col-span-2')
    expect(document.querySelector('[data-widget-cell="upcoming"]')!.className).not.toContain('col-span')
    expect(document.querySelector('[role="toolbar"]')).toBeNull(); expect(document.querySelector('[inert]')).toBeNull()
  })
  it('개인 설정을 읽지 못했으면 홈 구성을 열 수 없다 — 사유를 글로 보인다', () => {
    mount({ canEdit: false })
    expect(btn('홈 구성').getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('개인 설정을 읽지 못해 지금은 홈을 구성할 수 없습니다')).toBeTruthy()
    fireEvent.click(btn('홈 구성'))
    expect(document.querySelector('[role="toolbar"]')).toBeNull()
  })
  it('올린 위젯이 없으면 빈 홈 안내', () => {
    mount({ slots: [] })
    expect(screen.getByText('홈에 올린 위젯이 없습니다')).toBeTruthy()
  })
})

describe('편집 모드 — 이동·크기·제거', () => {
  it('열면 도구 모음과 위젯마다 조작 묶음 — 본문은 누를 수 없다(inert). 바꾸기 전에는 저장이 꺼져 있다', () => {
    mount(); open()
    expect(screen.getByRole('toolbar', { name: '홈 구성' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '내 업무 배치' })).toBeTruthy()
    expect(document.querySelectorAll('[inert]').length).toBe(3)
    expect(btn('저장').disabled).toBe(true)
    expect(document.activeElement).toBe(btn('위젯 추가'))                       // 연 뒤 초점이 편집 도구로 간다
  })
  it('앞·뒤 버튼으로 옮긴다 — 끝에서는 꺼져 있고, 옮긴 결과를 라이브 영역이 알린다', () => {
    mount(); open()
    expect(btn('내 업무 앞으로').disabled).toBe(true); expect(btn('다가오는 회의 뒤로').disabled).toBe(true)
    fireEvent.click(btn('다가오는 회의 앞으로'))
    expect(cells()).toEqual(['my_work:full', 'upcoming:half', 'projects:full'])
    expect(live()).toBe('다가오는 회의: 2번째 자리(2번째 줄)로 옮겼습니다. 전체 3개.')
    expect(document.activeElement).toBe(btn('다가오는 회의 앞으로'))            // 누른 버튼에 초점이 남는다
    fireEvent.click(btn('다가오는 회의 앞으로'))
    expect(cells()[0]).toBe('upcoming:half')
    expect(document.activeElement).toBe(btn('다가오는 회의 뒤로'))              // 맨 앞이라 '앞으로'가 꺼졌다 — 초점을 켜진 쪽으로
    expect(h.save).not.toHaveBeenCalled()                                       // 저장 전에는 서버에 쓰지 않는다
  })
  it('손잡이의 화살표 키 — 위·왼쪽은 앞으로, 아래·오른쪽은 뒤로(끌어 놓기 없이)', () => {
    mount(); open()
    const handle = () => btn(/^진행 중인 프로젝트 옮기기/)
    fireEvent.keyDown(handle(), { key: 'ArrowUp' })
    expect(cells()).toEqual(['projects:full', 'my_work:full', 'upcoming:half'])
    expect(document.activeElement).toBe(handle())
    fireEvent.keyDown(handle(), { key: 'ArrowRight' }); fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    expect(cells()).toEqual(['my_work:full', 'upcoming:half', 'projects:full'])
    fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    expect(live()).toBe('진행 중인 프로젝트: 더 옮길 자리가 없습니다')
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(cells()).toEqual(['my_work:full', 'projects:full', 'upcoming:half'])
    expect(btn('저장').disabled).toBe(true)                                     // 제자리로 돌아오면 바뀐 것이 없다
  })
  it('끌어 놓기 — 놓은 위젯의 자리를 차지한다', () => {
    mount(); open()
    // 테스트 도구(_dom)에 끌기 이벤트가 없어 직접 보낸다 — jsdom 에는 DataTransfer 가 없으므로 필요한 칸만 붙인다
    const dataTransfer = { effectAllowed: '', setData: vi.fn() }
    const drag = (el: Element, type: string) => act(() => { el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer })) })
    drag(document.querySelector('[data-widget-cell="upcoming"] [data-widget-dragbar]')!, 'dragstart')      // 끄는 자리는 조작 띠다(버튼이 아니다)
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'upcoming')
    const target = document.querySelector('[data-widget-cell="my_work"]')!
    drag(target, 'dragover'); drag(target, 'drop')
    expect(cells()).toEqual(['upcoming:half', 'my_work:full', 'projects:full'])
    expect(live()).toContain('다가오는 회의: 1번째 자리')
  })
  it('크기 — 반 폭·전체 폭을 고른다(누른 쪽이 aria-pressed)', () => {
    mount(); open()
    const size = screen.getByRole('group', { name: '다가오는 회의 크기' })
    const [half, full] = [...size.querySelectorAll('button')]
    expect([half.getAttribute('aria-pressed'), full.getAttribute('aria-pressed')]).toEqual(['true', 'false'])
    fireEvent.click(full)
    expect(cells()[2]).toBe('upcoming:full'); expect(full.getAttribute('aria-pressed')).toBe('true')
    expect(live()).toBe('다가오는 회의: 전체 폭(으)로 바꿨습니다')
  })
  it('빼면 그 자리의 다음 위젯으로 초점이 간다 — 마지막을 빼면 앞 위젯, 다 빼면 위젯 추가', () => {
    mount(); open()
    fireEvent.click(btn('진행 중인 프로젝트 빼기'))
    expect(cells()).toEqual(['my_work:full', 'upcoming:half'])
    expect(live()).toBe('진행 중인 프로젝트을(를) 뺐습니다. 남은 위젯 2개.')
    expect(document.activeElement).toBe(btn(/^다가오는 회의 옮기기/))
    fireEvent.click(btn('다가오는 회의 빼기'))
    expect(document.activeElement).toBe(btn(/^내 업무 옮기기/))
    fireEvent.click(btn('내 업무 빼기'))
    expect(cells()).toEqual([]); expect(screen.getByText('홈에 올린 위젯이 없습니다')).toBeTruthy()
    expect(document.activeElement).toBe(btn('위젯 추가'))
  })
})

describe('편집 모드 — 갤러리', () => {
  it('이름·설명과 함께 보이고, 이미 올린 것은 표시만·새로 켜진 것은 새로 추가됨', () => {
    mount({ personal: true }); open()
    fireEvent.click(btn('위젯 추가'))
    const item = (id: string) => document.querySelector(`[data-gallery-item="${id}"]`)!
    expect(item('my_work').textContent).toContain('홈에 있음'); expect(item('my_work').querySelector('button')).toBeNull()
    expect(item('memo').textContent).toContain('메모 설명'); expect(item('memo').textContent).not.toContain('새로 추가됨')
    expect(item('due_work').textContent).toContain('새로 추가됨')
    expect(btn('위젯 목록 닫기').getAttribute('aria-expanded')).toBe('true')
  })
  it('더하면 끝에 자리표시 카드로 놓인다(내용은 저장 뒤) — 초점은 다음에 더할 위젯으로', () => {
    mount(); open(); fireEvent.click(btn('위젯 추가'))
    fireEvent.click(btn('메모 추가'))
    expect(cells()).toEqual(['my_work:full', 'projects:full', 'upcoming:half', 'memo:half'])
    expect(document.querySelector('[data-widget-placeholder="memo"]')!.textContent).toContain('저장하면 이 자리에 내용이 표시됩니다')
    expect(live()).toBe('메모을(를) 끝에 더했습니다. 전체 4개.')
    expect(document.activeElement).toBe(btn('지연·임박 작업 추가'))
    fireEvent.click(btn('지연·임박 작업 추가'))
    expect(document.activeElement).toBe(btn('위젯 목록 닫기'))                  // 더할 것이 없으면 목록 버튼으로
    expect(screen.getByRole('group', { name: '메모 배치' })).toBeTruthy()       // 새로 더한 위젯도 바로 옮기고 뺄 수 있다
  })
})

describe('저장·취소·되돌리기', () => {
  it('저장 — 개인 구성 한 번 쓰기(순서·크기 + 갤러리에 있던 위젯), 옛 숨김은 비운다. 성공하면 화면을 다시 읽는다', async () => {
    h.save.mockResolvedValue({ ok: true })
    mount(); open()
    fireEvent.click(btn('다가오는 회의 앞으로')); fireEvent.click(btn('내 업무 빼기'))
    fireEvent.click(btn('위젯 추가')); fireEvent.click(btn('메모 추가'))
    await act(async () => { fireEvent.click(btn('저장')) })
    await waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1))
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(saved()).toEqual({ workspaceId: 'ws', prefs: { portalHiddenWidgets: [],
      portalLayout: { v: 1, items: [{ id: 'upcoming', size: 'half' }, { id: 'projects', size: 'full' }, { id: 'memo', size: 'half' }], known: ['my_work', 'projects', 'upcoming', 'memo', 'due_work'] } } })
  })
  it('저장 실패 — 알리고, 편집 모드와 바꾼 내용을 그대로 둔다. 다시 저장할 수 있다', async () => {
    h.save.mockResolvedValueOnce({ ok: false }).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true })
    mount(); open()
    fireEvent.click(btn('다가오는 회의 앞으로'))
    await act(async () => { fireEvent.click(btn('저장')) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('홈 구성을 저장하지 못했습니다'))
    expect(h.reload).not.toHaveBeenCalled()
    expect(cells()).toEqual(['my_work:full', 'upcoming:half', 'projects:full']); expect(screen.getByRole('toolbar')).toBeTruthy()
    await act(async () => { fireEvent.click(btn('저장')) })                       // 네트워크 오류도 같은 실패다
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('alert')).toBeTruthy(); expect(h.reload).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(btn('저장')) })
    await waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1))
  })
  it('취소 — 바꾼 것을 버리고 보기 모드로. 서버에 쓰지 않는다', () => {
    mount(); open()
    fireEvent.click(btn('내 업무 빼기')); fireEvent.click(btn('취소'))
    expect(cells()).toEqual(['my_work:full', 'projects:full', 'upcoming:half'])
    expect(document.querySelector('[role="toolbar"]')).toBeNull(); expect(h.save).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(btn('홈 구성'))
    open()
    expect(cells()).toEqual(['my_work:full', 'projects:full', 'upcoming:half'])   // 다시 열어도 버린 초안이 남아 있지 않다
  })
  it('기본값으로 되돌리기 — 초안이 워크스페이스 기본 배치가 되고, 저장하면 개인 구성을 지운다(null)', async () => {
    h.save.mockResolvedValue({ ok: true })
    mount({ personal: true, slots: [slot('memo', 'full'), slot('my_work', 'half')] }); open()
    fireEvent.click(btn('기본값으로 되돌리기'))
    expect(cells()).toEqual(['my_work:full', 'projects:full', 'upcoming:half'])
    expect(screen.getByText('저장하면 워크스페이스 기본 배치를 따릅니다')).toBeTruthy()
    expect(h.save).not.toHaveBeenCalled()                                       // 되돌리기도 저장 전에는 쓰지 않는다
    await act(async () => { fireEvent.click(btn('저장')) })
    await waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1))
    expect(saved().prefs).toEqual({ portalLayout: null, portalHiddenWidgets: [] })
  })
  it('되돌린 뒤 다시 손대면 그 배치를 내 구성으로 저장한다', async () => {
    h.save.mockResolvedValue({ ok: true })
    mount({ personal: true, slots: [slot('memo', 'full')] }); open()
    fireEvent.click(btn('기본값으로 되돌리기')); fireEvent.click(btn('다가오는 회의 빼기'))
    await act(async () => { fireEvent.click(btn('저장')) })
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    expect(saved().prefs.portalLayout).toMatchObject({ v: 1, items: [{ id: 'my_work', size: 'full' }, { id: 'projects', size: 'full' }] })
  })
  it('이미 기본 배치를 보는 사람은 되돌려도 저장할 것이 없다', () => {
    mount(); open()
    fireEvent.click(btn('기본값으로 되돌리기'))
    expect(btn('저장').disabled).toBe(true)
  })
  it('옛 숨김으로 기본 배치의 일부만 보던 사람은 되돌리면 숨김이 풀린다(저장 가능)', async () => {
    h.save.mockResolvedValue({ ok: true })
    mount({ slots: [slot('my_work', 'full'), slot('upcoming', 'half')] }); open()
    fireEvent.click(btn('기본값으로 되돌리기'))
    expect(btn('저장').disabled).toBe(false)
    await act(async () => { fireEvent.click(btn('저장')) })
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    expect(saved().prefs).toEqual({ portalLayout: null, portalHiddenWidgets: [] })
  })
  it('저장 중에는 다시 보내지 않는다', async () => {
    let finish!: (r: { ok: boolean }) => void
    h.save.mockImplementation(() => new Promise((r) => { finish = r }))
    mount(); open()
    fireEvent.click(btn('내 업무 빼기'))
    fireEvent.click(btn('저장')); fireEvent.click(btn('저장'))
    expect(h.save).toHaveBeenCalledTimes(1); expect(btn('저장').getAttribute('aria-busy')).toBe('true')
    await act(async () => { finish({ ok: true }) })
    await waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1))
  })
})
