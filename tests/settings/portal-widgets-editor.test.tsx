// @vitest-environment jsdom
// 홈 위젯 편집기(portal.widgets 네 연결 ② — SP3b 스펙 §6.4 표, W20). 저장 규약은 MenuOrderEditor 의 것(useSettingsCommand)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../shell/_dom'
const h = vi.hoisted(() => ({ update: vi.fn(), outcome: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/settings', () => ({ updateWorkspaceSettings: h.update, updateProjectSettings: vi.fn(), getSettingsCommandOutcome: h.outcome }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
// 위젯 이름·편집기 문구 모두 사전의 한국어 글자로 본다
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
import { PortalWidgetsEditor } from '@/components/settings/PortalWidgetsEditor'
import { defaultPortalWidgets } from '@/lib/portal/widgets'

const WS = '00000000-0000-0000-7e57-000000001810'
const saveBtn = () => screen.getByRole('button', { name: '홈 위젯 저장' }) as HTMLButtonElement
beforeEach(() => { h.update.mockReset(); h.outcome.mockReset(); h.refresh.mockReset() })

describe('PortalWidgetsEditor', () => {
  it('열마다 구획, 행마다 스위치와 위·아래 버튼(끌기만의 조작 없음)', () => {
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    expect(screen.getByRole('group', { name: '주 열' })).toBeTruthy(); expect(screen.getByRole('group', { name: '보조 열' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: '공지 보이기' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: '공지 위로' })).toBeTruthy()
    expect(document.querySelector('[draggable="true"]')).toBeNull()
  })
  it('같은 열 안에서만 옮긴다 — 열의 첫 항목은 위로, 끝 항목은 아래로가 비활성', () => {
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    expect(screen.getByRole('button', { name: '검토 대기 위로' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '진행 중인 프로젝트 아래로' }).hasAttribute('disabled')).toBe(true)
    expect(saveBtn().disabled).toBe(true)                                   // 바뀐 것이 없으면 저장하지 않는다
  })
  it('끄고 순서를 바꿔 저장 — 패치는 portal.widgets 하나({ id, enabled } 만), 저장 뒤 새로고침', async () => {
    h.update.mockResolvedValue({ ok: true, kind: 'applied', commandId: 'c', revision: 4, rebased: false })
    render(<PortalWidgetsEditor workspaceId={WS} revision={3} initial={defaultPortalWidgets()} />)
    fireEvent.click(screen.getByRole('switch', { name: '다가오는 회의 보이기' }))
    fireEvent.click(screen.getByRole('button', { name: '공지 위로' }))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    const [wid, patch] = h.update.mock.calls[0]
    expect(wid).toBe(WS); expect(patch.expectedRevision).toBe(3); expect(patch.unset).toEqual([])
    expect(Object.keys(patch.set)).toEqual(['portal.widgets'])
    expect(patch.set['portal.widgets'].every((w: object) => Object.keys(w).sort().join() === 'enabled,id')).toBe(true)   // 여분 필드는 서버가 거부한다
    expect(patch.set['portal.widgets'].map((w: { id: string; enabled: boolean }) => `${w.id}:${w.enabled}`)).toEqual(
      ['my_work:true', 'projects:true', 'review:true', 'upcoming:false', 'announcements:true', 'recent_docs:true'])
    await waitFor(() => expect(screen.getByText('저장했습니다.')).toBeTruthy())
    expect(h.refresh).toHaveBeenCalled()
    expect(saveBtn().disabled).toBe(true)                                   // 저장된 값이 새 기준이다
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
      fieldErrors: [{ key: 'portal.widgets', message: '위젯 항목에는 id·enabled 만 둡니다.' }] })
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
