// 사용자 테스트 "화면·설정 UX" 묶음 — 설정 화면 쪽 회귀(BUG-06·21·26·28·29·32·추가 A).
// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  updateProject: vi.fn(), renameWorkspace: vi.fn(), refresh: vi.fn(), toast: vi.fn(), order: [] as string[],
}))
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock('@/app/actions/project', () => ({ updateProject: (...a: unknown[]) => h.updateProject(...a) }))
vi.mock('@/app/actions/platformWorkspaces', () => ({ renameWorkspace: (...a: unknown[]) => h.renameWorkspace(...a) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: vi.fn(), updateWorkspaceSettings: vi.fn(), getSettingsCommandOutcome: vi.fn() }))
vi.mock('@/app/actions/settingsPreview', () => ({ previewSettingsImpact: vi.fn() }))

import { ProjectInfoEditButton } from '@/components/settings/ProjectInfoEditButton'
import { WorkspaceNameEditor } from '@/components/settings/WorkspaceNameEditor'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'
import { StageLabelsEditor } from '@/components/settings/StageLabelsEditor'
import { ApprovalStepsEditor } from '@/components/settings/ApprovalStepsEditor'
import { ModuleAllowEditor } from '@/components/settings/ModuleAllowEditor'

let host: HTMLDivElement, root: Root
const render = (node: ReactNode) => act(async () => { root.render(node) })
const type = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const button = (text: string, within: ParentNode = document) => [...within.querySelectorAll('button')].find(b => b.textContent?.trim() === text) as HTMLButtonElement
beforeEach(() => {
  h.updateProject.mockReset(); h.renameWorkspace.mockReset(); h.refresh.mockReset(); h.toast.mockReset(); h.order.length = 0
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => {
  act(() => root.unmount()); host.remove(); document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  window.location.hash = ''; await new Promise((r) => setTimeout(r, 0))   // 늦게 오는 hashchange 가 다음 테스트로 넘어가지 않게
})

// 실제 원인은 브라우저로 확인했다(2026-10-10): 전환(useTransition) 안에서 액션을 기다린 뒤 부른 refresh 가 이 화면에서 붙지 않았다.
// 액션을 전환 밖에서 기다리고 끝난 뒤 refresh 를 던지면 새로고침 없이 반영된다.
describe('[BUG-06] 프로젝트 기본 정보 저장 — 저장이 끝나면 닫고 알린 뒤 화면을 다시 그린다', () => {
  const open = async () => {
    await render(<ProjectInfoEditButton projectId="p1" name="QA" description={null} startDate={null} endDate={null} />)
    act(() => button('편집', host).click())
  }
  const dateInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')]

  it('저장 성공 → 모달을 닫고 알린 뒤 router.refresh 를 부른다', async () => {
    h.updateProject.mockImplementation(async () => { h.order.push('saved'); return { ok: true } })
    h.refresh.mockImplementation(() => { h.order.push('refresh') })
    h.toast.mockImplementation(() => { h.order.push('toast') })
    await open()
    const [start, end] = dateInputs()
    type(start, '2026-10-12'); type(end, '2026-12-31')
    await act(async () => { button('저장').click() })
    expect(h.updateProject).toHaveBeenCalledWith('p1', { name: 'QA', description: '', start_date: '2026-10-12', end_date: '2026-12-31' })
    expect(h.order).toEqual(['saved', 'toast', 'refresh'])
    expect(h.toast).toHaveBeenCalledWith({ title: '기본 정보를 저장했습니다.', variant: 'success' })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('저장 실패 → 다시 그리지 않고 모달에 사유를 남긴다', async () => {
    h.updateProject.mockResolvedValue({ ok: false, error: '저장하지 못했습니다' })
    await open()
    await act(async () => { button('저장').click() })
    expect(h.refresh).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('저장하지 못했습니다')
  })
  it('[BUG-21] 기간 역전 문구는 공용 한 문형이다', async () => {
    await open()
    const [start, end] = dateInputs()
    type(start, '2026-12-31'); type(end, '2026-10-12')
    act(() => button('저장').click())
    expect(h.updateProject).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('시작일은 종료일보다 늦을 수 없습니다.')
  })
})

describe('[BUG-32] 워크스페이스 이름 — 다시 입력하면 그 칸의 오류가 사라진다', () => {
  it('빈 이름 저장 → 오류, 입력하면 사라진다(저장 전에도)', async () => {
    await render(<WorkspaceNameEditor workspaceId="w1" slug="default" initialName="기본" />)
    const input = host.querySelector('input')!
    type(input, '')
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(host.textContent).toContain('이름을 입력하세요.')
    type(input, '새 이름')
    expect(host.textContent).not.toContain('이름을 입력하세요.')
    expect(h.renameWorkspace).not.toHaveBeenCalled()
  })
})

describe('[BUG-29] SettingsShell — 주소의 #구획 으로 들어오면 그 구획을 보인다', () => {
  const scrolled: string[] = []
  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this.id) }
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => vi.unstubAllGlobals())
  const shell = (extra?: ReactNode) => (
    <SettingsShell items={[{ id: 'project-general', label: '일반' }, { id: 'project-team', label: '팀·영역' }]}>
      <div id="project-general">일반</div>
      <div id="project-team">팀<h4 id="project-team-inner">안쪽</h4></div>
      {extra}
    </SettingsShell>
  )
  const current = () => host.querySelector('[aria-current="location"]')?.textContent
  /** 주소에 해시가 이미 있는 채로 들어온 상태 — jsdom 은 hash 대입 뒤 hashchange 를 늦게 쏘므로 그것이 지나간 뒤에 그린다 */
  const enterWith = async (hash: string) => { window.location.hash = hash; await new Promise((r) => setTimeout(r, 0)) }
  const changeHash = async (hash: string) => { await act(async () => { window.location.hash = hash; await new Promise((r) => setTimeout(r, 0)) }) }

  it('마운트 때 해시의 구획으로 스크롤하고 목차의 현재 범주로 표시한다', async () => {
    await enterWith('#project-team')
    await render(shell())
    expect(scrolled).toEqual(['project-team'])
    expect(current()).toBe('팀·영역')
  })
  it('해시가 바뀌면 다시 이동한다 — 구획 안쪽 제목이면 그 구획이 현재다', async () => {
    await render(shell())
    expect(scrolled).toEqual([])
    await changeHash('#project-team-inner')
    expect(scrolled).toEqual(['project-team-inner'])
    expect(current()).toBe('팀·영역')
  })
  it('다시 그려도(저장 뒤 refresh) 해시로 되돌아가지 않는다 · 껍데기 밖 요소·없는 id 는 무시', async () => {
    await enterWith('#project-team')
    await render(shell())
    await render(shell(<p>다시 그림</p>))
    expect(scrolled).toEqual(['project-team'])
    await changeHash('#nowhere')
    expect(scrolled).toEqual(['project-team'])
  })
})

describe('[추가 A] SettingsSaveBar — 스크롤 상자의 아래 여백(16px) 틈을 같은 배경으로 덮는다', () => {
  it('바 아래로 16px 덮개(after)가 붙는다 — 뒤의 목록이 비치지 않게', async () => {
    await render(<SettingsSaveBar><button type="button">저장</button></SettingsSaveBar>)
    const cls = host.querySelector('[data-save-bar]')!.className
    for (const c of ['sticky', 'bottom-0', 'after:absolute', 'after:top-full', 'after:h-4', 'after:bg-inherit', 'bg-surface']) expect(cls).toContain(c)
  })
})

describe('[BUG-26·28] 상태·승인·모듈 편집기 — 내부 코드 대신 이름, 글자가 세로로 꺾이지 않는 배치', () => {
  it('단계 이름 칸의 라벨은 기본 이름이다(코드는 보조 글자)', async () => {
    await render(<StageLabelsEditor projectId="p1" value={null} revision={1} canEdit />)
    const labels = [...host.querySelectorAll('label')].map(l => l.querySelector('span')!.textContent)
    expect(labels).toEqual(['미착수', '할당됨as', '작업 중ip', '검수 대기im', '완료xx'])
    expect(host.querySelector<HTMLInputElement>('[data-stage-label="ip"]')!.getAttribute('aria-label')).toBe('작업 중 단계의 표시 이름')
  })
  it('승인 단계 — 코드 칸에 머리("코드(내부 식별자)")가 붙고, 버튼 줄은 줄지 않는다(한 줄 배치는 xl 부터)', async () => {
    await render(<ApprovalStepsEditor projectId="p1" steps={null} distinct={null} gate={null} revision={1} canEdit />)
    expect(host.textContent).toContain('코드(내부 식별자)')
    const row = host.querySelector('[data-approval-step]')!
    expect(row.className).toContain('xl:grid-cols-')
    expect(row.className).not.toContain('sm:grid-cols-')
    const buttons = button('삭제', row).parentElement!
    expect(buttons.className).toContain('whitespace-nowrap'); expect(buttons.className).toContain('shrink-0')
  })
  it('모듈 카드는 두 열까지 — 이름은 줄바꿈하지 않고 긴 내부 id 가 줄어든다', async () => {
    await render(<ModuleAllowEditor workspaceId="w1" initialAllowed={[]} revision={1} />)
    const grid = host.querySelector('label')!.parentElement!
    expect(grid.className).toContain('sm:grid-cols-2'); expect(grid.className).not.toContain('grid-cols-3')
    const [name, id] = [...host.querySelector('label')!.querySelectorAll('span')]
    expect(name.className).toContain('whitespace-nowrap'); expect(id.className).toContain('truncate')
  })
})
