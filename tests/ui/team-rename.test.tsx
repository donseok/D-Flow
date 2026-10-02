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
