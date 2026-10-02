// @vitest-environment jsdom
// 팀 개명 입력(SP4 D37·D52·계획 P8) — 이름 칸의 연필 → 그 행 안 입력. 공백뿐이면 화면이 막고, 나머지 규칙(길이·예약어·겹침)은 서버 문구를
// 그 행 아래 보인다. 성공은 토스트 + 새로고침. 코드는 그대로이고 #15 는 팀 색 칩(팔레트 자리 슬롯)을 그린다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TEAM_PALETTE } from '@/lib/domain/teamColor'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ updateTeam: vi.fn(), updateProjectTeam: vi.fn(), toast: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/teams', () => ({ addTeam: vi.fn(), updateTeam: h.updateTeam }))
vi.mock('@/app/actions/projectTeams', () => ({ addProjectTeam: vi.fn(), copyGlobalTeams: vi.fn(), updateProjectTeam: h.updateProjectTeam }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))

import { TeamsManager } from '@/components/admin/TeamsManager'
import { ProjectTeamsManager } from '@/components/settings/ProjectTeamsManager'

const WS = '00000000-0000-0000-7e57-000000001a80', PID = '00000000-0000-0000-7e57-000000001a81'
const OPS = { id: '00000000-0000-0000-7e57-000000001a82', code: 'OPS', name: 'OPS', color: TEAM_PALETTE[0], sortOrder: 0, active: true, progressVisible: true }
const RES = { id: '00000000-0000-0000-7e57-000000001a83', code: 'RES', name: '연구', color: TEAM_PALETTE[1], sortOrder: 1, active: true, progressVisible: true }
let container: HTMLDivElement, root: Root
const q = <T extends Element>(sel: string) => container.querySelector<T>(sel)
const type = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)) }
const startRename = async (teamId: string) => { await act(async () => q<HTMLButtonElement>(`[data-team-rename="${teamId}"]`)!.click()) }
const save = async () => { await act(async () => q<HTMLButtonElement>('[data-team-rename-save]')!.click()) }

beforeEach(() => { vi.clearAllMocks(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('#15 공용 팀 관리 — 개명 입력·팀 색 칩', () => {
  it('이름 칸은 이름(코드와 다르면 코드도)과 팀 색 칩 — 팔레트 자리 슬롯', async () => {
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    expect(q(`[data-team-row="${RES.id}"]`)!.textContent).toContain('연구')
    expect(q(`[data-team-row="${RES.id}"]`)!.textContent).toContain('RES')
    expect(q(`[data-team-row="${OPS.id}"] .bg-category-1-weak`)).not.toBeNull()
    expect(q(`[data-team-row="${RES.id}"] .bg-category-2-weak`)).not.toBeNull()
    expect(container.textContent).not.toContain('지원하지 않습니다')
  })
  it('[RF5] 공백뿐이면 화면이 막는다 — 액션을 부르지 않는다', async () => {
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    type(q<HTMLInputElement>('[data-team-rename-input]')!, '   ')
    await save()
    expect(q('[role="alert"]')!.textContent).toContain('팀 이름을 입력하세요.')
    expect(h.updateTeam).not.toHaveBeenCalled()
  })
  it('[RF5] 다른 팀 코드와 대소문자만 다른 이름 — 서버 거부 문구를 그 행 아래 보이고 목록은 그대로', async () => {
    h.updateTeam.mockResolvedValue({ ok: false, error: '같은 범위의 다른 팀(OPS)의 코드·이름과 겹칩니다.' })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    type(q<HTMLInputElement>('[data-team-rename-input]')!, 'ops')
    await save()
    expect(h.updateTeam).toHaveBeenCalledWith(RES.id, { name: 'ops' })
    expect(q(`[data-team-row="${RES.id}"] [role="alert"]`)!.textContent).toContain('겹칩니다')
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
  })
  it('자기 코드로 되돌리기도 서버에 맡긴다 — 성공이면 토스트·새로고침(성공 뒤 목록은 새로고침이 다시 그린다)', async () => {
    h.updateTeam.mockResolvedValue({ ok: true })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    type(q<HTMLInputElement>('[data-team-rename-input]')!, ' RES ')
    await save()
    expect(h.updateTeam).toHaveBeenCalledWith(RES.id, { name: 'RES' })
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
    expect(h.refresh).toHaveBeenCalled()
    expect(q('[data-team-rename-input]')).toBeNull()
  })
})

describe('개명 입력의 세부(B-2 리뷰 P3 — 붙여넣기 자름·IME·포커스·오류 연결)', () => {
  const key = (el: Element, init: KeyboardEventInit) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })) })
  it('40자를 넘는 이름을 조용히 자르지 않는다 — 입력에 길이 상한이 없고, 그대로 서버에 보내 서버의 길이 문구를 보인다', async () => {
    h.updateTeam.mockResolvedValue({ ok: false, error: '팀 이름은 40자 이하여야 합니다.' })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    const input = q<HTMLInputElement>('[data-team-rename-input]')!
    expect(input.hasAttribute('maxlength')).toBe(false)
    const long = '가'.repeat(41)
    type(input, long)
    await save()
    expect(h.updateTeam).toHaveBeenCalledWith(RES.id, { name: long })
    expect(q(`[data-team-row="${RES.id}"] [role="alert"]`)!.textContent).toContain('40자 이하')
  })
  it('한글 IME 조합 중 Enter 는 저장하지 않는다 — 조합이 끝난 Enter 한 번만 저장한다', async () => {
    h.updateTeam.mockResolvedValue({ ok: true })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    const input = q<HTMLInputElement>('[data-team-rename-input]')!
    type(input, '연구개발')
    await key(input, { key: 'Enter', isComposing: true })
    expect(h.updateTeam).not.toHaveBeenCalled()
    await key(input, { key: 'Enter' })
    expect(h.updateTeam).toHaveBeenCalledTimes(1)
  })
  it('저장 중 다시 저장해도 액션은 한 번 — 재진입 가드', async () => {
    let resolve!: (v: { ok: boolean }) => void
    h.updateTeam.mockImplementation(() => new Promise((r) => { resolve = r }))
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    const input = q<HTMLInputElement>('[data-team-rename-input]')!
    type(input, '연구개발')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })
    expect(h.updateTeam).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ ok: true }) })
  })
  it('저장·취소 뒤 포커스는 그 행의 연필 버튼으로 돌아온다', async () => {
    h.updateTeam.mockResolvedValue({ ok: true })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    await key(q<HTMLInputElement>('[data-team-rename-input]')!, { key: 'Escape' })
    expect(document.activeElement).toBe(q(`[data-team-rename="${RES.id}"]`))
    await startRename(RES.id)
    type(q<HTMLInputElement>('[data-team-rename-input]')!, '연구개발')
    await save()
    expect(document.activeElement).toBe(q(`[data-team-rename="${RES.id}"]`))
  })
  it('[RF5] 저장 중 입력은 disabled 가 아니라 readOnly+aria-busy — 포커스를 잃지 않고, 서버가 거부하면 입력에 포커스가 있다(B-4 리뷰 I2)', async () => {
    let resolve!: (v: { ok: boolean; error?: string }) => void
    h.updateTeam.mockImplementation(() => new Promise((r) => { resolve = r }))
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    const input = q<HTMLInputElement>('[data-team-rename-input]')!
    type(input, 'ops')
    input.focus()
    await key(input, { key: 'Enter' })
    // disabled 면 브라우저가 포커스를 body 로 옮긴다(focus fixup) — 저장 중에도 입력은 켜진 채 잠근다
    expect(input.disabled).toBe(false)
    expect(input.readOnly).toBe(true)
    expect(input.getAttribute('aria-busy')).toBe('true')
    await key(input, { key: 'Escape' })                       // 저장 중 Esc 는 결과를 버리지 않는다(응답이 닫힌 칸에 떨어지지 않게)
    expect(q('[data-team-rename-input]')).toBe(input)
    await act(async () => { resolve({ ok: false, error: '같은 범위의 다른 팀(OPS)의 코드·이름과 겹칩니다.' }) })
    expect(q(`[data-team-row="${RES.id}"] [role="alert"]`)!.textContent).toContain('겹칩니다')
    expect(input.readOnly).toBe(false)
    expect(input.hasAttribute('aria-busy')).toBe(false)
    expect(document.activeElement).toBe(input)
    await key(input, { key: 'Escape' })                       // 거부 뒤에는 키보드로 바로 취소할 수 있다
    expect(document.activeElement).toBe(q(`[data-team-rename="${RES.id}"]`))
  })
  it('[RF5] 저장 버튼으로 저장했다가 서버가 거부해도 포커스는 입력으로 돌아온다 — 꺼진 버튼에 남지 않는다', async () => {
    h.updateTeam.mockResolvedValue({ ok: false, error: '같은 범위의 다른 팀(OPS)의 코드·이름과 겹칩니다.' })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    type(q<HTMLInputElement>('[data-team-rename-input]')!, 'ops')
    q<HTMLButtonElement>('[data-team-rename-save]')!.focus()
    await save()
    expect(document.activeElement).toBe(q('[data-team-rename-input]'))
  })
  it('오류 문구는 입력과 aria-describedby·aria-invalid 로 이어진다', async () => {
    h.updateTeam.mockResolvedValue({ ok: false, error: '같은 범위의 다른 팀(OPS)의 코드·이름과 겹칩니다.' })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await startRename(RES.id)
    const input = q<HTMLInputElement>('[data-team-rename-input]')!
    expect(input.getAttribute('aria-invalid')).not.toBe('true')
    type(input, 'ops')
    await save()
    const alert = q<HTMLElement>(`[data-team-row="${RES.id}"] [role="alert"]`)!
    expect(alert.id).not.toBe('')
    expect(input.getAttribute('aria-describedby')).toBe(alert.id)
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })
})

describe('설정 팀 절 — 개명 입력', () => {
  it('전용 팀 행의 개명은 updateProjectTeam(projectId, id, { name })', async () => {
    h.updateProjectTeam.mockResolvedValue({ ok: true })
    await render(<ProjectTeamsManager projectId={PID} teams={[RES]} inherited={false} hasGlobalTeams />)
    await startRename(RES.id)
    type(q<HTMLInputElement>('[data-team-rename-input]')!, '연구개발')
    await save()
    expect(h.updateProjectTeam).toHaveBeenCalledWith(PID, RES.id, { name: '연구개발' })
    expect(h.refresh).toHaveBeenCalled()
  })
})
