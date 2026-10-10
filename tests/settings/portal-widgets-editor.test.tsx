// @vitest-environment jsdom
// 홈 위젯 편집기(portal.widgets 네 연결 ② — SP3b 스펙 §6.4 표, W20 · 2026-10-10 위젯 강화: 허용·기본 배치·크기). 저장 규약은 MenuOrderEditor 의 것(useSettingsCommand)
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../shell/_dom'
const h = vi.hoisted(() => ({ update: vi.fn(), outcome: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/settings', () => ({ updateWorkspaceSettings: h.update, updateProjectSettings: vi.fn(), getSettingsCommandOutcome: h.outcome }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
// 위젯 이름·편집기 문구 모두 사전의 한국어 글자로 본다
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
import { PortalWidgetsEditor } from '@/components/settings/PortalWidgetsEditor'
import { PORTAL_WIDGET_IDS, defaultPortalWidgets, parsePortalWidgets, type PortalWidgetSetting } from '@/lib/portal/widgets'

const WS = '00000000-0000-0000-7e57-000000001810'
const saveBtn = () => screen.getByRole('button', { name: '홈 위젯 저장' }) as HTMLButtonElement
const check = (name: string) => document.querySelector(`input[type="checkbox"][aria-label="${name}"]`) as HTMLInputElement
/** 공용 도구의 change 는 input 전용이다 — select 는 값을 고르고 change 이벤트를 직접 보낸다 */
const pick = (el: HTMLSelectElement, value: string) => act(() => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })) })
const size = (name: string) => document.querySelector(`select[aria-label="${name}"]`) as HTMLSelectElement
beforeEach(() => { h.update.mockReset(); h.outcome.mockReset(); h.refresh.mockReset() })

describe('PortalWidgetsEditor', () => {
  it('한 목록 — 위젯마다 허용 스위치·기본 배치·기본 크기·위·아래 버튼(끌기만의 조작 없음), 이름과 설명', () => {
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    expect(document.querySelectorAll('[data-portal-widget-row]').length).toBe(PORTAL_WIDGET_IDS.length)
    expect(screen.getByRole('switch', { name: '공지 보이기' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: '공지 위로' })).toBeTruthy()
    expect(check('내 업무 기본 배치에 넣기').checked).toBe(true); expect(check('메모 기본 배치에 넣기').checked).toBe(false)   // 새 위젯은 기본 배치 밖
    expect(size('내 업무 기본 크기').value).toBe('full'); expect(size('공지 기본 크기').value).toBe('half')
    expect(document.querySelector('[data-portal-widget-row="my_issues"]')!.textContent).toContain('이슈 기능이 켜진 곳에서만 보입니다')
    expect(document.querySelector('[draggable="true"]')).toBeNull()
  })
  it('구성원은 각자 홈을 바꿀 수 있고 끈 위젯은 누구에게도 보이지 않는다고 알린다', () => {
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    expect(screen.getByText(/구성원은 각자 홈을 바꿀 수 있고, 여기서 끈 위젯은 누구에게도 보이지 않습니다/)).toBeTruthy()
  })
  it('목록의 첫 항목은 위로, 끝 항목은 아래로가 비활성 — 열 구분 없이 어디로든 옮긴다', () => {
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    expect(screen.getByRole('button', { name: '내 업무 위로' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '위키 최근 문서 아래로' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '검토 대기 위로' }).hasAttribute('disabled')).toBe(false)     // 옛 '보조 열의 첫 항목' — 이제 위로 간다
    expect(saveBtn().disabled).toBe(true)                                   // 바뀐 것이 없으면 저장하지 않는다
  })
  it('끄고 순서·크기·기본 배치를 바꿔 저장 — 패치는 portal.widgets 하나, 항목마다 네 칸(새 형태), 저장 뒤 새로고침', async () => {
    h.update.mockResolvedValue({ ok: true, kind: 'applied', commandId: 'c', revision: 4, rebased: false })
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    fireEvent.click(screen.getByRole('switch', { name: '다가오는 회의 보이기' }))
    fireEvent.click(screen.getByRole('button', { name: '공지 위로' }))
    fireEvent.click(check('메모 기본 배치에 넣기'))
    pick(size('메모 기본 크기'), 'full')
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    const [wid, patch] = h.update.mock.calls[0]
    expect(wid).toBe(WS); expect(patch.expectedRevision).toBe(3); expect(patch.unset).toEqual([])
    expect(Object.keys(patch.set)).toEqual(['portal.widgets'])
    const stored = patch.set['portal.widgets'] as { id: string; enabled: boolean; size: string; inDefault: boolean }[]
    expect(stored.every((w) => Object.keys(w).sort().join() === 'enabled,id,inDefault,size')).toBe(true)
    expect(parsePortalWidgets(stored)).toEqual({ ok: true, value: stored })                               // 서버의 parse 가 그대로 받는다
    expect(stored.slice(0, 6).map((w) => `${w.id}:${w.enabled}`)).toEqual(['my_work:true', 'projects:true', 'review:true', 'upcoming:false', 'announcements:true', 'recent_docs:true'])
    expect(stored.find((w) => w.id === 'memo')).toEqual({ id: 'memo', enabled: true, size: 'full', inDefault: true })
    expect(stored.find((w) => w.id === 'my_work')).toEqual({ id: 'my_work', enabled: true, size: 'full', inDefault: true })   // 손대지 않은 항목도 레지스트리 기본으로 네 칸
    await waitFor(() => expect(screen.getByText('저장했습니다.')).toBeTruthy())
    expect(h.refresh).toHaveBeenCalled()
    expect(saveBtn().disabled).toBe(true)                                   // 저장된 값이 새 기준이다
  })
  it('끈 위젯은 기본 배치·크기를 고를 수 없다(끄면 누구에게도 보이지 않는다)', () => {
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    fireEvent.click(screen.getByRole('switch', { name: '공지 보이기' }))
    expect(check('공지 기본 배치에 넣기').disabled).toBe(true); expect(size('공지 기본 크기').disabled).toBe(true)
  })
  it('옛 형태로 저장된 값을 그대로 읽는다 — 손대기 전에는 바뀐 것이 없다', () => {
    const old = [{ id: 'announcements', enabled: false }, ...defaultPortalWidgets().filter((w) => w.id !== 'announcements')] as PortalWidgetSetting
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={old} />)
    expect(document.querySelector('[data-portal-widget-row]')!.getAttribute('data-portal-widget-row')).toBe('announcements')
    expect(screen.getByRole('switch', { name: '공지 보이기' }).getAttribute('aria-checked')).toBe('false')
    expect(saveBtn().disabled).toBe(true)
  })
  it('새 형태로 저장된 값의 기본 배치·크기를 그린다', () => {
    const stored = defaultPortalWidgets().map((w) => (w.id === 'memo' ? { ...w, size: 'full' as const, inDefault: true } : w.id === 'projects' ? { ...w, inDefault: false } : w))
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={stored} />)
    expect(check('메모 기본 배치에 넣기').checked).toBe(true); expect(size('메모 기본 크기').value).toBe('full')
    expect(check('진행 중인 프로젝트 기본 배치에 넣기').checked).toBe(false)
  })
  it('409 — 내 값·최신 값 비교를 보이고 저장을 막는다, 최신 값을 고르면 그 값으로', async () => {
    h.update.mockResolvedValue({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: 'x', retryable: false, changedKeys: ['portal.widgets'],
      latest: { revision: 9, invalidKeys: [], values: { 'portal.widgets': defaultPortalWidgets().map((w) => ({ ...w, enabled: false })) } } })
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    fireEvent.click(screen.getByRole('switch', { name: '공지 보이기' }))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(screen.getByText('최신 값 사용')).toBeTruthy())
    expect(saveBtn().disabled).toBe(true)
    fireEvent.click(screen.getByText('최신 값 사용'))
    expect(screen.getByRole('switch', { name: '내 업무 보이기' }).getAttribute('aria-checked')).toBe('false')
  })
  it('저장 결과 불명 — 같은 명령으로 결과를 확인한다(재전송 전에)', async () => {
    h.update.mockRejectedValueOnce(new Error('network'))
    h.outcome.mockResolvedValue({ ok: true, outcome: { status: 'applied', revision: 5 } })
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    fireEvent.click(screen.getByRole('switch', { name: '공지 보이기' }))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.outcome).toHaveBeenCalledWith({ workspaceId: WS }, h.update.mock.calls[0][1].commandId))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
    expect(h.update).toHaveBeenCalledTimes(1)
  })
  it('결과를 끝내 모르면 같은 명령으로 한 번 다시 보내고, 그래도 모르면 "결과 확인 및 재시도"', async () => {
    h.update.mockRejectedValue(new Error('network'))
    h.outcome.mockResolvedValue({ ok: true, outcome: { status: 'unknown' } })
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    fireEvent.click(screen.getByRole('switch', { name: '공지 보이기' }))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(saveBtn().textContent).toBe('저장 결과 확인 및 재시도'))
    expect(h.update).toHaveBeenCalledTimes(2)
    expect(h.update.mock.calls[1][1].commandId).toBe(h.update.mock.calls[0][1].commandId)
  })
  it('서버 필드 오류는 그 키 자리(field), 다른 거부는 저장 바 위(patch)', async () => {
    h.update.mockResolvedValueOnce({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: '입력 오류', retryable: false,
      fieldErrors: [{ key: 'portal.widgets', message: '위젯 항목에는 id·enabled·size·inDefault 만 둡니다.' }] })
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    fireEvent.click(screen.getByRole('switch', { name: '공지 보이기' }))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(document.querySelector('[data-config-state="field"]')?.textContent).toContain('id·enabled'))
    expect(document.querySelector('[data-config-state="patch"]')).toBeNull()
  })
  it('손상된 저장값 — 손상 알림 + 기본 순서로 복구 저장 가능', () => {
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={null} invalidReason="알 수 없는 위젯입니다: x" />)
    expect(document.querySelector('[data-config-state="invalid"]')).toBeTruthy()
    expect(saveBtn().disabled).toBe(false)
  })
})
