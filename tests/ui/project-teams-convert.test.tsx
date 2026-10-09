// @vitest-environment jsdom
// '공용 팀 전환으로 시작'(T14·계획 P7) — 확인 창이 전환의 실제 결과(연결을 옮기고 되돌리지 않는다)를 말하고 성공 토스트가 전환을 말한다. 화면에 '전역' 낱말이 없다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 화면 문구는 사전(settingsUi·adminUi)에 있다 — 옮긴 문구만 한국어 글자로 돌려주는 대역(공급자 없는 기본 t 는 키를 돌려준다)
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale())
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ copy: vi.fn(), toast: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/projectTeams', () => ({ addProjectTeam: vi.fn(), updateProjectTeam: vi.fn(), copyGlobalTeams: h.copy }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))

import { ProjectTeamsManager } from '@/components/settings/ProjectTeamsManager'

const PID = '00000000-0000-0000-7e57-000000001a61'
let container: HTMLDivElement, root: Root
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
beforeEach(async () => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  await act(async () => root.render(<ProjectTeamsManager projectId={PID} teams={[]} inherited hasGlobalTeams />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('공용 팀 전환으로 시작', () => {
  it('확인 창이 연결 이전·되돌릴 수 없음을 말하고, 확인하면 전환 액션 → 전환 토스트·새로고침', async () => {
    expect(document.body.textContent).not.toContain('전역')
    await act(async () => button('공용 팀 전환으로 시작').click())
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('팀 연결')
    expect(dialog.textContent).toContain('되돌릴 수 없습니다')
    h.copy.mockResolvedValue({ ok: true })
    await act(async () => button('전환하기').click())
    expect(h.copy).toHaveBeenCalledWith(PID)
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('전환했습니다'), variant: 'success' }))
    expect(h.refresh).toHaveBeenCalled()
  })
  it('already 실패는 그 문구를 보이고 새로고침하지 않는다', async () => {
    await act(async () => button('공용 팀 전환으로 시작').click())
    h.copy.mockResolvedValue({ ok: false, error: '이미 프로젝트 팀이 정의되어 있습니다.' })
    await act(async () => button('전환하기').click())
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('이미 프로젝트 팀이 정의되어 있습니다.')
    expect(h.refresh).not.toHaveBeenCalled()
  })
})
