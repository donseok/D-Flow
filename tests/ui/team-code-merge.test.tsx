// @vitest-environment jsdom
// 팀 유연화 2단계의 화면 — ① 코드 바꾸기: 코드 칸의 연필 → 확인 모달(옛 엑셀 파일 경고) → 액션 ② 다른 팀으로 합치기: 대상 고르기 →
// 영향 건수 미리보기 → 확인. 미리보기를 못 읽으면 확인 단추가 열리지 않고, 실패 문구는 모달 안에 보이며, 성공은 알림 + 새로고침이다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TEAM_PALETTE } from '@/lib/domain/teamColor'
import { t as dict, type DictKey } from '@/lib/i18n/dict'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({
  changeTeamCode: vi.fn(), previewTeamMerge: vi.fn(), mergeTeams: vi.fn(),
  changeProjectTeamCode: vi.fn(), previewProjectTeamMerge: vi.fn(), mergeProjectTeams: vi.fn(),
  toast: vi.fn(), refresh: vi.fn(),
}))
vi.mock('@/app/actions/teams', () => ({
  addTeam: vi.fn(), updateTeam: vi.fn(), changeTeamCode: h.changeTeamCode, previewTeamMerge: h.previewTeamMerge, mergeTeams: h.mergeTeams,
}))
vi.mock('@/app/actions/projectTeams', () => ({
  addProjectTeam: vi.fn(), copyGlobalTeams: vi.fn(), updateProjectTeam: vi.fn(),
  changeProjectTeamCode: h.changeProjectTeamCode, previewProjectTeamMerge: h.previewProjectTeamMerge, mergeProjectTeams: h.mergeProjectTeams,
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: DictKey) => dict('ko', k) }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))

import { TeamsManager } from '@/components/admin/TeamsManager'
import { ProjectTeamsManager } from '@/components/settings/ProjectTeamsManager'

const WS = '00000000-0000-0000-7e57-000000005a80', PID = '00000000-0000-0000-7e57-000000005a81'
const team = (n: number, code: string, name: string, over: Record<string, unknown> = {}) =>
  ({ id: `00000000-0000-0000-7e57-000000005a9${n}`, code, name, color: TEAM_PALETTE[n], sortOrder: n, active: true, progressVisible: true, ...over })
const OPS = team(0, 'OPS', '운영'), RES = team(1, 'RES', '연구'), OLD = team(2, 'OLD', '옛 팀', { active: false })
const COUNTS = { itemOwners: 3, memberTeams: 2, areaTeams: 0, minutes: 4, minuteFolders: 1, invites: 0, credentials: 0 }
const SUMMARY = {
  moved: { itemOwners: 3, memberTeams: 1, areaTeams: 0, minutes: 4, invites: 0, credentials: 0 },
  deduped: { itemOwners: 0, memberTeams: 1, areaTeams: 0 }, foldersRenamed: 0, sourceRefsLeft: 0,
}

let container: HTMLDivElement, root: Root
// 모달은 body 에 포털로 그려진다 — 문서 전체에서 찾는다
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel)
const click = async (el: Element | null) => { await act(async () => (el as HTMLElement).click()) }
const type = async (el: HTMLInputElement, v: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const pick = async (v: string) => {
  const el = q<HTMLSelectElement>('[data-team-merge-target]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)) }
const dialogText = () => q('[role="dialog"]')?.textContent ?? ''

beforeEach(() => { vi.clearAllMocks(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('코드 바꾸기 — 공용 팀', () => {
  it('연필을 누르면 지금 코드가 든 입력과 옛 엑셀 파일 경고가 뜬다 — 그때까지 액션은 없다', async () => {
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    expect(q('[data-team-code-input]')).toBeNull()
    await click(q(`[data-team-code-edit="${RES.id}"]`))
    expect(q<HTMLInputElement>('[data-team-code-input]')!.value).toBe('RES')
    expect(q('[data-team-code-warn]')!.textContent).toContain('이미 엑셀로 내보낸 파일의 팀 열은 옛 코드입니다')
    expect(dialogText()).toContain("'연구' 팀의 코드 RES")
    expect(h.changeTeamCode).not.toHaveBeenCalled()
  })
  it('빈 값·같은 값은 화면이 막는다', async () => {
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await click(q(`[data-team-code-edit="${RES.id}"]`))
    await click(q('[data-team-code-save]'))
    expect(q('[role="dialog"] [role="alert"]')!.textContent).toBe('지금 코드와 같습니다.')
    await type(q<HTMLInputElement>('[data-team-code-input]')!, '   ')
    await click(q('[data-team-code-save]'))
    expect(q('[role="dialog"] [role="alert"]')!.textContent).toBe('팀 코드를 입력하세요.')
    expect(h.changeTeamCode).not.toHaveBeenCalled()
  })
  it('확인하면 워크스페이스·팀·공백 걷은 코드로 액션을 부르고, 성공이면 알림 + 새로고침 + 모달 닫힘', async () => {
    h.changeTeamCode.mockResolvedValue({ ok: true })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await click(q(`[data-team-code-edit="${RES.id}"]`))
    await type(q<HTMLInputElement>('[data-team-code-input]')!, ' LAB ')
    await click(q('[data-team-code-save]'))
    expect(h.changeTeamCode).toHaveBeenCalledWith(WS, RES.id, 'LAB')
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "'연구' 팀 코드를 LAB(으)로 바꿨습니다.", variant: 'success' }))
    expect(h.refresh).toHaveBeenCalled()
    expect(q('[data-team-code-input]')).toBeNull()
  })
  it('서버가 거부하면 문구를 모달 안에 보이고 닫지 않는다 — 알림·새로고침 없음', async () => {
    h.changeTeamCode.mockResolvedValue({ ok: false, error: "'OPS' 코드를 쓰는 팀이 이미 있습니다." })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await click(q(`[data-team-code-edit="${RES.id}"]`))
    await type(q<HTMLInputElement>('[data-team-code-input]')!, 'OPS')
    await click(q('[data-team-code-save]'))
    expect(q('[role="dialog"] [role="alert"]')!.textContent).toContain('이미 있습니다')
    expect(q('[data-team-code-input]')).not.toBeNull()
    expect(h.toast).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})

describe('코드 바꾸기 — 프로젝트 팀', () => {
  it('프로젝트 액션을 그 프로젝트 id 로 부른다', async () => {
    h.changeProjectTeamCode.mockResolvedValue({ ok: true })
    await render(<ProjectTeamsManager projectId={PID} teams={[OPS, RES]} inherited={false} hasGlobalTeams />)
    await click(q(`[data-team-code-edit="${OPS.id}"]`))
    await type(q<HTMLInputElement>('[data-team-code-input]')!, 'RUN')
    await click(q('[data-team-code-save]'))
    expect(h.changeProjectTeamCode).toHaveBeenCalledWith(PID, OPS.id, 'RUN')
    expect(h.changeTeamCode).not.toHaveBeenCalled()
    expect(h.refresh).toHaveBeenCalled()
  })
})

describe('다른 팀으로 합치기 — 공용 팀', () => {
  it('대상 후보는 원본을 뺀 활성 팀뿐이고, 고르기 전에는 확인 단추가 잠겨 있다', async () => {
    await render(<TeamsManager teams={[OPS, RES, OLD]} workspaceId={WS} />)
    await click(q(`[data-team-merge-open="${RES.id}"]`))
    const options = [...q<HTMLSelectElement>('[data-team-merge-target]')!.options].map((o) => o.value)
    expect(options).toEqual(['', OPS.id])
    expect(q<HTMLButtonElement>('[data-team-merge-confirm]')!.disabled).toBe(true)
    expect(q('[data-team-merge-warn]')!.textContent).toContain('되돌릴 수 없습니다')
    expect(h.previewTeamMerge).not.toHaveBeenCalled()
  })
  it('대상을 고르면 영향 건수를 읽어 0 이 아닌 것만 보이고, 그 뒤에야 확인 단추가 열린다', async () => {
    h.previewTeamMerge.mockResolvedValue({ ok: true, counts: COUNTS })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await click(q(`[data-team-merge-open="${RES.id}"]`))
    await pick(OPS.id)
    expect(h.previewTeamMerge).toHaveBeenCalledWith(WS, RES.id, OPS.id)
    const impact = q('[data-team-merge-impact]')!
    expect(impact.textContent).toContain('작업 담당 3건')
    expect(impact.textContent).toContain('회의록 4건')
    expect(impact.querySelector('[data-team-merge-count="areaTeams"]')).toBeNull()
    expect(q<HTMLButtonElement>('[data-team-merge-confirm]')!.disabled).toBe(false)
    expect(h.mergeTeams).not.toHaveBeenCalled()
  })
  it('가리키는 것이 없으면 그 사실을 알린다(팀만 비활성)', async () => {
    h.previewTeamMerge.mockResolvedValue({ ok: true, counts: { ...COUNTS, itemOwners: 0, memberTeams: 0, minutes: 0, minuteFolders: 0 } })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await click(q(`[data-team-merge-open="${RES.id}"]`))
    await pick(OPS.id)
    expect(q('[data-team-merge-impact]')!.textContent).toContain('이 팀을 가리키는 것이 없습니다')
  })
  it('미리보기를 못 읽으면 오류를 보이고 확인 단추를 열지 않는다', async () => {
    h.previewTeamMerge.mockResolvedValue({ ok: false, error: '합칠 때의 영향을 확인하지 못했습니다. 잠시 후 다시 시도하세요.' })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await click(q(`[data-team-merge-open="${RES.id}"]`))
    await pick(OPS.id)
    expect(q('[role="dialog"] [role="alert"]')!.textContent).toContain('확인하지 못했습니다')
    expect(q('[data-team-merge-impact]')).toBeNull()
    expect(q<HTMLButtonElement>('[data-team-merge-confirm]')!.disabled).toBe(true)
  })
  it('확인하면 병합 액션을 부르고, 성공이면 알림(원본 → 대상) + 새로고침 + 모달 닫힘', async () => {
    h.previewTeamMerge.mockResolvedValue({ ok: true, counts: COUNTS })
    h.mergeTeams.mockResolvedValue({ ok: true, summary: { ...SUMMARY, foldersRenamed: 2 } })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await click(q(`[data-team-merge-open="${RES.id}"]`))
    await pick(OPS.id)
    await click(q('[data-team-merge-confirm]'))
    expect(h.mergeTeams).toHaveBeenCalledWith(WS, RES.id, OPS.id)
    const title = h.toast.mock.calls[0][0].title as string
    expect(title).toContain("'연구' 팀을 '운영' 팀으로 합쳤습니다.")
    expect(title).toContain('회의록 폴더 2개')
    expect(h.refresh).toHaveBeenCalled()
    expect(q('[data-team-merge-target]')).toBeNull()
  })
  it('병합이 거부되면 문구를 모달 안에 보이고 닫지 않는다', async () => {
    h.previewTeamMerge.mockResolvedValue({ ok: true, counts: COUNTS })
    h.mergeTeams.mockResolvedValue({ ok: false, error: '비활성화된 팀으로는 합칠 수 없습니다. 합칠 대상 팀을 먼저 활성화하세요.' })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await click(q(`[data-team-merge-open="${RES.id}"]`))
    await pick(OPS.id)
    await click(q('[data-team-merge-confirm]'))
    expect(dialogText()).toContain('비활성화된 팀으로는 합칠 수 없습니다')
    expect(q('[data-team-merge-target]')).not.toBeNull()
    expect(h.toast).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('합칠 다른 활성 팀이 없으면 그 사실을 알리고 확인 단추는 잠긴다', async () => {
    await render(<TeamsManager teams={[RES, OLD]} workspaceId={WS} />)
    await click(q(`[data-team-merge-open="${RES.id}"]`))
    expect(q('[data-team-merge-none]')!.textContent).toContain('합칠 수 있는 다른 활성 팀이 없습니다')
    expect(q('[data-team-merge-target]')).toBeNull()
    expect(q<HTMLButtonElement>('[data-team-merge-confirm]')!.disabled).toBe(true)
  })
  it('대상을 바꿔 고르면 늦게 온 앞 응답이 지금 대상의 건수를 덮지 않는다', async () => {
    const ETC = team(3, 'ETC', '그밖')
    let resolveFirst: (v: unknown) => void = () => {}
    h.previewTeamMerge
      .mockImplementationOnce(() => new Promise((res) => { resolveFirst = res }))
      .mockResolvedValueOnce({ ok: true, counts: { ...COUNTS, itemOwners: 9 } })
    await render(<TeamsManager teams={[OPS, RES, ETC]} workspaceId={WS} />)
    await click(q(`[data-team-merge-open="${RES.id}"]`))
    await pick(OPS.id)
    await pick(ETC.id)
    expect(q('[data-team-merge-impact]')!.textContent).toContain('작업 담당 9건')
    await act(async () => { resolveFirst({ ok: true, counts: { ...COUNTS, itemOwners: 1 } }) })
    expect(q('[data-team-merge-impact]')!.textContent).toContain('작업 담당 9건')
  })
})

describe('다른 팀으로 합치기 — 프로젝트 팀', () => {
  it('비활성 원본도 합칠 수 있고, 프로젝트 액션을 그 프로젝트 id 로 부른다', async () => {
    h.previewProjectTeamMerge.mockResolvedValue({ ok: true, counts: COUNTS })
    h.mergeProjectTeams.mockResolvedValue({ ok: true, summary: SUMMARY })
    await render(<ProjectTeamsManager projectId={PID} teams={[OPS, RES, OLD]} inherited={false} hasGlobalTeams />)
    await click(q(`[data-team-merge-open="${OLD.id}"]`))
    await pick(RES.id)
    expect(h.previewProjectTeamMerge).toHaveBeenCalledWith(PID, OLD.id, RES.id)
    await click(q('[data-team-merge-confirm]'))
    expect(h.mergeProjectTeams).toHaveBeenCalledWith(PID, OLD.id, RES.id)
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "'옛 팀' 팀을 '연구' 팀으로 합쳤습니다.", variant: 'success' }))
    expect(h.mergeTeams).not.toHaveBeenCalled()
  })
})
