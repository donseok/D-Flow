// @vitest-environment jsdom
// 작업 계획 기본 보기 편집기(views.default 네 연결 ② — SP3b 스펙 §6.4 표·D43, Review Focus 3)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../shell/_dom'
const h = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: h.update, updateWorkspaceSettings: vi.fn(), getSettingsCommandOutcome: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { ViewsDefaultEditor } from '@/components/settings/ViewsDefaultEditor'
import { ERR_VIEWS_BOARD_KANBAN_OFF } from '@/lib/settings/validateConfig'

const P = '00000000-0000-0000-7e57-000000001820'
beforeEach(() => { h.update.mockReset(); h.refresh.mockReset() })
const radio = (name: string) => screen.getByRole('radio', { name })
const saveBtn = () => screen.getByRole('button', { name: '기본 보기 저장' }) as HTMLButtonElement

describe('ViewsDefaultEditor', () => {
  it('라디오 셋 — 저장값이 선택돼 있고 선택된 것만 탭 순서에 든다', () => {
    render(<ViewsDefaultEditor projectId={P} revision={1} initial={{ wbs: 'timeline' }} kanbanOn />)
    expect(radio('간트').getAttribute('aria-checked')).toBe('true')
    expect(radio('간트').getAttribute('tabindex')).toBe('0'); expect(radio('표').getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('radiogroup', { name: '작업 계획 기본 보기' })).toBeTruthy()
    expect(saveBtn().disabled).toBe(true)
  })
  it('칸반이 꺼져 있으면 보드는 비활성 + 사유와 켜는 경로', () => {
    render(<ViewsDefaultEditor projectId={P} revision={1} initial={{ wbs: 'sheet' }} kanbanOn={false} />)
    expect(radio('보드').getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(radio('보드'))
    expect(radio('표').getAttribute('aria-checked')).toBe('true')
    expect(document.querySelector('[data-config-state="disabled"] a[href="#project-modules"]')).toBeTruthy()
  })
  it('저장값 보드 + 칸반 꺼짐 — 보드가 선택된 채 보이고(값을 잃지 않는다), 바꾸지 않으면 저장 버튼 비활성, 바꾸면 저장된다(Review Focus 3)', async () => {
    h.update.mockResolvedValue({ ok: true, kind: 'applied', commandId: 'c', revision: 2, rebased: false })
    render(<ViewsDefaultEditor projectId={P} revision={1} initial={{ wbs: 'board' }} kanbanOn={false} />)
    expect(radio('보드').getAttribute('aria-checked')).toBe('true')
    expect(saveBtn().disabled).toBe(true)
    fireEvent.click(radio('표'))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledWith(P, expect.objectContaining({ set: { 'views.default': { wbs: 'sheet' } }, expectedRevision: 1, unset: [] })))
    await waitFor(() => expect(screen.getByText('저장했습니다.')).toBeTruthy())
  })
  it('서버의 필드 오류는 라디오 묶음에 배선한다(aria-invalid·aria-describedby)', async () => {
    h.update.mockResolvedValue({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: 'x', retryable: false, fieldErrors: [{ key: 'views.default', message: ERR_VIEWS_BOARD_KANBAN_OFF }] })
    render(<ViewsDefaultEditor projectId={P} revision={1} initial={{ wbs: 'sheet' }} kanbanOn />)
    fireEvent.click(radio('보드'))
    fireEvent.click(saveBtn())
    const group = screen.getByRole('radiogroup', { name: '작업 계획 기본 보기' })
    await waitFor(() => expect(group.getAttribute('aria-invalid')).toBe('true'))
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toContain('칸반이 꺼져')
    fireEvent.click(radio('간트'))                                             // 다시 고르면 지난 오류는 걷힌다
    expect(group.getAttribute('aria-invalid')).toBeNull()
  })
  it('방향키로 다음 항목(비활성 보드는 건너뛴다)', () => {
    render(<ViewsDefaultEditor projectId={P} revision={1} initial={{ wbs: 'timeline' }} kanbanOn={false} />)
    fireEvent.keyDown(radio('간트'), { key: 'ArrowRight' })
    expect(radio('표').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio('표'))
  })
  it('409 — 다른 사용자가 바꿨다는 알림과 최신 값으로 다시 보기', async () => {
    h.update.mockResolvedValue({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: 'x', retryable: false, changedKeys: ['views.default'],
      latest: { revision: 7, invalidKeys: [], values: { 'views.default': { wbs: 'timeline' } } } })
    render(<ViewsDefaultEditor projectId={P} revision={1} initial={{ wbs: 'sheet' }} kanbanOn />)
    fireEvent.click(radio('보드'))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(screen.getByRole('button', { name: '최신 값으로 다시 보기' })).toBeTruthy())
    expect(saveBtn().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '최신 값으로 다시 보기' }))
    expect(radio('간트').getAttribute('aria-checked')).toBe('true')
  })
  it('409 의 최신 값이 손상이면 다시 보기는 막히고 내 선택 유지로 최신 revision 위에 다시 저장한다', async () => {
    h.update.mockResolvedValueOnce({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: 'c', error: 'x', retryable: false, changedKeys: ['views.default'],
      latest: { revision: 7, invalidKeys: ['views.default'], values: { 'views.default': 'oops' } } })
      .mockResolvedValueOnce({ ok: true, kind: 'applied', commandId: 'c', revision: 8, rebased: false })
    render(<ViewsDefaultEditor projectId={P} revision={1} initial={{ wbs: 'sheet' }} kanbanOn />)
    fireEvent.click(radio('간트'))
    fireEvent.click(saveBtn())
    await waitFor(() => expect((screen.getByRole('button', { name: '최신 값으로 다시 보기' }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '내 선택 유지' }))
    expect(radio('간트').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(2))
    expect(h.update.mock.calls[1][1]).toMatchObject({ expectedRevision: 7, set: { 'views.default': { wbs: 'timeline' } } })
  })
  it('라디오의 설명·꺼짐 사유를 aria-describedby 로 잇고, 머리 id 가 오면 묶음 이름은 aria-labelledby(u3-3 리뷰 P2-6)', () => {
    render(<><h4 id="vd-head">작업 계획 기본 보기</h4><ViewsDefaultEditor projectId={P} revision={1} initial={{ wbs: 'sheet' }} kanbanOn={false} labelledBy="vd-head" /></>)
    const described = (name: string) => radio(name).getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent ?? '')
    expect(described('표')).toEqual(['행과 열로 편집합니다.'])
    expect(described('보드')[0]).toBe('카드로 묶어 봅니다(칸반).')
    expect(described('보드')[1]).toContain('칸반이 꺼져 있어')
    const group = document.querySelector('[role="radiogroup"]')!
    expect(group.getAttribute('aria-labelledby')).toBe('vd-head'); expect(group.getAttribute('aria-label')).toBeNull()
  })
  it.each([
    ['denied', 'CONFIG_DENIED', '설정을 바꿀 권한이 없습니다.'],
    ['schema_ahead', 'CONFIG_SCHEMA_AHEAD', '설정 형식이 더 새 버전입니다.'],
  ] as const)('%s — 오류를 보이고 기준선은 그대로, 같은 선택으로 다시 저장할 수 있다(u3-3 리뷰 P2-10(b))', async (kind, code, error) => {
    h.update.mockResolvedValue({ ok: false, kind, code, commandId: 'c', error, retryable: false })
    render(<ViewsDefaultEditor projectId={P} revision={3} initial={{ wbs: 'sheet' }} kanbanOn />)
    fireEvent.click(radio('간트'))
    fireEvent.click(saveBtn())
    await waitFor(() => expect(document.querySelector('[data-config-state="patch"]')?.textContent).toContain(error))
    expect(radio('간트').getAttribute('aria-checked')).toBe('true')            // 초안은 남는다
    expect(saveBtn().disabled).toBe(false)                                     // 기준선(sheet)이 바뀌지 않았으니 여전히 바뀐 상태
    expect(saveBtn().textContent).toBe('기본 보기 저장')                         // 결과 불명 갈래로 가지 않는다
    expect(document.querySelector('[data-save-bar] [role="status"]')?.textContent).toBe(''); expect(h.refresh).not.toHaveBeenCalled()
    fireEvent.click(saveBtn())
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(2))
    expect(h.update.mock.calls[1][1]).toMatchObject({ expectedRevision: 3 })   // 기준 revision 도 그대로
    expect(h.update.mock.calls[1][1].commandId).not.toBe(h.update.mock.calls[0][1].commandId)
  })
  it('손상된 저장값 — 손상 알림 + 기본(표)으로 복구 저장 가능', () => {
    render(<ViewsDefaultEditor projectId={P} revision={1} initial={null} invalidReason="보기 값이 올바르지 않습니다." kanbanOn />)
    expect(document.querySelector('[data-config-state="invalid"]')).toBeTruthy()
    expect(radio('표').getAttribute('aria-checked')).toBe('true')
    expect(saveBtn().disabled).toBe(false)
  })
})
