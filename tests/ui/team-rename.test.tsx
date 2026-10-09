// @vitest-environment jsdom
// 팀 개명 입력(SP4 D37·D52·계획 P8) — 이름 칸의 연필 → 그 행 안 입력. 공백뿐이면 화면이 막고, 나머지 규칙(길이·예약어·겹침)은 서버 문구를
// 그 행 아래 보인다. 성공은 토스트 + 새로고침. 코드는 그대로이고(코드 열), 팀 색은 견본 단추(팔레트 자리 슬롯 — 눌러 여덟 슬롯에서 고른다).
// 팀 추가는 이름과 코드를 따로 받고, 순서 바꾸기는 한 액션(swapOrderWith)이다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TEAM_PALETTE } from '@/lib/domain/teamColor'
import { t as dict, type DictKey } from '@/lib/i18n/dict'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ addTeam: vi.fn(), addProjectTeam: vi.fn(), updateTeam: vi.fn(), updateProjectTeam: vi.fn(), toast: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/teams', () => ({ addTeam: h.addTeam, updateTeam: h.updateTeam }))
vi.mock('@/app/actions/projectTeams', () => ({ addProjectTeam: h.addProjectTeam, copyGlobalTeams: vi.fn(), updateProjectTeam: h.updateProjectTeam }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: DictKey) => dict('ko', k) }) }))
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

describe('#15 공용 팀 관리 — 개명 입력·팀 색 견본', () => {
  it('행은 이름과 코드를 둘 다 보인다(코드 열 — 이름이 코드와 같아도) — 색 견본은 팔레트 자리 슬롯', async () => {
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    expect(q(`[data-team-row="${RES.id}"]`)!.textContent).toContain('연구')
    expect(q(`[data-team-row="${RES.id}"] [data-team-code]`)!.textContent).toBe('RES')
    expect(q(`[data-team-row="${OPS.id}"] [data-team-code]`)!.textContent).toBe('OPS')
    expect(q(`[data-team-row="${OPS.id}"] [data-team-color].bg-category-1`)).not.toBeNull()
    expect(q(`[data-team-row="${RES.id}"] [data-team-color].bg-category-2`)).not.toBeNull()
    // 코드가 무엇인지 화면이 설명한다 — 가져오기·엑셀의 식별자이고, 바꾸면 이미 내보낸 파일과 어긋난다(2단계에서 바꿀 수 있게 됐다)
    expect(container.textContent).toContain('코드는 가져오기·엑셀에서 쓰는 식별자입니다')
    expect(container.textContent).toContain('이미 내보낸 엑셀 파일의 팀 열은 옛 코드로 남습니다')
    expect(container.textContent).not.toContain('바꿀 수 없음')
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

describe('팀 추가 — 이름과 코드를 따로 받는다', () => {
  const click = async (el: Element) => { await act(async () => (el as HTMLElement).click()) }
  const addButton = () => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '팀 추가')!
  it('코드를 비우면 이름에서 만든 기본 코드를 미리 보이고, 액션에는 코드를 넘기지 않는다(서버가 같은 함수로 만든다)', async () => {
    h.addTeam.mockResolvedValue({ ok: true })
    await render(<TeamsManager teams={[OPS]} workspaceId={WS} />)
    expect(q('[data-team-add-hint]')!.textContent).toContain('비우면 이름에서 만듭니다')
    type(q<HTMLInputElement>('[data-team-add-name]')!, ' 기획팀 ')
    await act(async () => {})
    expect(q('[data-team-add-hint]')!.textContent).toContain('저장될 코드: 기획팀')
    expect(q<HTMLInputElement>('[data-team-add-code]')!.placeholder).toBe('기획팀')
    await click(addButton())
    expect(h.addTeam).toHaveBeenCalledWith(WS, '기획팀', null)
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "'기획팀' 팀을 추가했습니다.", variant: 'success' }))
  })
  it('코드를 적으면 그 값이 미리보기와 액션에 간다 — 이름의 오타가 코드로 굳지 않는다', async () => {
    h.addTeam.mockResolvedValue({ ok: true })
    await render(<TeamsManager teams={[OPS]} workspaceId={WS} />)
    type(q<HTMLInputElement>('[data-team-add-name]')!, '기획팀')
    type(q<HTMLInputElement>('[data-team-add-code]')!, ' TEAM_A ')
    await act(async () => {})
    expect(q('[data-team-add-hint]')!.textContent).toContain('저장될 코드: TEAM_A')
    await click(addButton())
    expect(h.addTeam).toHaveBeenCalledWith(WS, '기획팀', 'TEAM_A')
  })
  it('이름이 비면 화면이 막고, 서버 거부(코드 겹침)는 문구를 보이며 입력을 지우지 않는다', async () => {
    await render(<TeamsManager teams={[OPS]} workspaceId={WS} />)
    await click(addButton())
    expect(q('[role="alert"]')!.textContent).toContain('팀 이름을 입력하세요.')
    expect(h.addTeam).not.toHaveBeenCalled()
    h.addTeam.mockResolvedValue({ ok: false, error: "'ops'는 같은 범위의 다른 팀(OPS)의 코드·이름과 겹칩니다." })
    type(q<HTMLInputElement>('[data-team-add-name]')!, '운영')
    type(q<HTMLInputElement>('[data-team-add-code]')!, 'ops')
    await act(async () => {})
    await click(addButton())
    expect(q('[role="alert"]')!.textContent).toContain('겹칩니다')
    expect(q<HTMLInputElement>('[data-team-add-name]')!.value).toBe('운영')
    expect(q<HTMLInputElement>('[data-team-add-code]')!.value).toBe('ops')
  })
  it('프로젝트 팀도 같은 폼 — addProjectTeam(프로젝트, 이름, 코드)', async () => {
    h.addProjectTeam.mockResolvedValue({ ok: true })
    await render(<ProjectTeamsManager projectId={PID} teams={[OPS]} inherited={false} hasGlobalTeams />)
    type(q<HTMLInputElement>('[data-team-add-name]')!, '품질관리')
    type(q<HTMLInputElement>('[data-team-add-code]')!, 'QA')
    await act(async () => {})
    await click(addButton())
    expect(h.addProjectTeam).toHaveBeenCalledWith(PID, '품질관리', 'QA')
  })
})

describe('팀 색 선택 — 테마 슬롯 여덟 개', () => {
  const click = async (el: Element) => { await act(async () => (el as HTMLElement).click()) }
  const options = () => [...document.body.querySelectorAll<HTMLButtonElement>('[data-team-color-option]')]
  it('견본 단추는 접근 이름과 44px 터치 영역을 갖고, 누르면 여덟 슬롯이 radiogroup 으로 열린다(지금 색이 선택 상태)', async () => {
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    const trigger = q<HTMLButtonElement>(`[data-team-color="${RES.id}"]`)!
    expect(trigger.getAttribute('aria-label')).toBe('연구 팀 색 고르기')
    expect(trigger.className).toContain('before:size-11')
    expect(options()).toHaveLength(0)
    await click(trigger)
    expect(document.body.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('연구 팀 색')
    expect(options().map((o) => o.getAttribute('aria-label'))).toEqual(['색 1', '색 2', '색 3', '색 4', '색 5', '색 6', '색 7', '색 8'])
    expect(options().map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false', 'false', 'false'])
    expect(options().every((o) => o.className.includes('size-11'))).toBe(true)
  })
  it('슬롯을 고르면 updateTeam(id, { colorSlot }) — 성공이면 토스트·새로고침, 목록은 닫힌다', async () => {
    h.updateTeam.mockResolvedValue({ ok: true })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    await click(q(`[data-team-color="${RES.id}"]`)!)
    await click(options()[6])
    expect(h.updateTeam).toHaveBeenCalledWith(RES.id, { colorSlot: 7 })
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "'연구' 팀 색을 바꿨습니다.", variant: 'success' }))
    expect(h.refresh).toHaveBeenCalled()
    expect(options()).toHaveLength(0)
  })
  it('지금 색을 다시 고르면 저장하지 않고 닫기만 한다 · Esc 로 닫으면 포커스가 견본 단추로 돌아온다', async () => {
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    const trigger = q<HTMLButtonElement>(`[data-team-color="${RES.id}"]`)!
    await click(trigger)
    await click(options()[1])
    expect(h.updateTeam).not.toHaveBeenCalled()
    await click(trigger)
    await act(async () => { options()[0].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })) })
    expect(options()).toHaveLength(0)
    expect(document.activeElement).toBe(trigger)
  })
  it('프로젝트 팀도 색을 고른다 — updateProjectTeam(프로젝트, 팀, { colorSlot })', async () => {
    h.updateProjectTeam.mockResolvedValue({ ok: true })
    await render(<ProjectTeamsManager projectId={PID} teams={[OPS, RES]} inherited={false} hasGlobalTeams />)
    await click(q(`[data-team-color="${OPS.id}"]`)!)
    await click(options()[4])
    expect(h.updateProjectTeam).toHaveBeenCalledWith(PID, OPS.id, { colorSlot: 5 })
  })
})

describe('순서 바꾸기·빈 상태', () => {
  it('위·아래 단추는 액션 한 번 — 두 행의 순번을 서버가 맞바꾼다(swapOrderWith). 접근 이름은 팀 이름', async () => {
    h.updateTeam.mockResolvedValue({ ok: true })
    await render(<TeamsManager teams={[OPS, RES]} workspaceId={WS} />)
    const down = q<HTMLButtonElement>(`[data-team-row="${OPS.id}"] button[aria-label="OPS 아래로"]`)!
    expect(q(`[data-team-row="${RES.id}"] button[aria-label="연구 위로"]`)).not.toBeNull()
    await act(async () => down.click())
    expect(h.updateTeam).toHaveBeenCalledTimes(1)
    expect(h.updateTeam).toHaveBeenCalledWith(OPS.id, { swapOrderWith: RES.id })
  })
  it('공용 팀이 0개면 표 대신 빈 상태와 첫 팀을 만드는 안내 — 추가 폼은 그대로 있다', async () => {
    await render(<TeamsManager teams={[]} workspaceId={WS} />)
    expect(q('table')).toBeNull()
    expect(container.textContent).toContain('아직 팀이 없습니다')
    expect(container.textContent).toContain('「팀 추가」')
    expect(q('[data-team-add-name]')).not.toBeNull()
  })
  it('프로젝트 팀 — 상속 중인데 공용 팀도 없으면 팀이 하나도 없다는 사실과 길을 알린다', async () => {
    await render(<ProjectTeamsManager projectId={PID} teams={[]} inherited hasGlobalTeams={false} />)
    expect(q('[data-team-empty]')!.textContent).toContain('이 프로젝트에는 팀이 하나도 없습니다')
    await render(<ProjectTeamsManager projectId={PID} teams={[]} inherited hasGlobalTeams />)
    expect(q('[data-team-empty]')).toBeNull()
  })
  it('프로젝트 팀 안내는 실제 동작을 적는다 — 이 프로젝트에 연결한 회의록의 담당 팀도 이 목록이다', async () => {
    await render(<ProjectTeamsManager projectId={PID} teams={[OPS]} inherited={false} hasGlobalTeams />)
    expect(container.textContent).toContain('이 프로젝트에 연결한 회의록의 담당 팀에 적용됩니다')
    expect(container.textContent).not.toContain('회의록 보관함은 공용 팀 기준을 유지합니다')
  })
})
