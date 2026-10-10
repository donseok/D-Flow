// @vitest-environment jsdom
// 프로젝트 준비 체크리스트(첫 사용 흐름) — 완료는 서버가 내린 단계 상태, 브라우저에 저장하는 것은 건너뛰기·닫기뿐.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await vi.importActual<typeof import('@/lib/i18n/dict')>('@/lib/i18n/dict')
  const api = { t: (k: Parameters<typeof t>[0]) => t(k) }
  return { useLocale: () => api }
})

import { ProjectSetupChecklist } from '@/components/settings/ProjectSetupChecklist'
import type { SetupStep } from '@/lib/domain/projectSetup'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let box: HTMLDivElement
beforeEach(() => { box = document.createElement('div'); document.body.append(box); root = createRoot(box) })
afterEach(() => { act(() => root.unmount()); box.remove(); localStorage.clear() })

const STEPS: SetupStep[] = [
  { id: 'basic', state: 'todo' }, { id: 'levels', state: 'done' }, { id: 'teams', state: 'todo' }, { id: 'members', state: 'todo' },
  { id: 'calendar', state: 'done' }, { id: 'firstData', state: 'todo' },
]
const DONE: SetupStep[] = STEPS.map((s) => ({ ...s, state: 'done' }))
type Opts = { userId?: string; projectId?: string; steps?: SetupStep[]; variant?: 'panel' | 'banner' }
const mount = ({ userId = 'user', projectId = 'project', steps = STEPS, variant }: Opts = {}) => act(async () => root.render(
  <ProjectSetupChecklist key={`${userId}:${projectId}:${variant}`} userId={userId} projectId={projectId} steps={steps} variant={variant} />))
const click = (el: Element) => act(async () => { (el as HTMLElement).click() })
const row = (id: string) => box.querySelector(`[data-setup-step="${id}"]`)!
const stateOf = (id: string) => row(id).getAttribute('data-setup-state')
const button = (scope: Element, text: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text)!

describe('패널(설정 화면)', () => {
  it('단계마다 서버 상태를 그대로 보인다 — "확인했어요" 버튼이 없다', async () => {
    await mount()
    expect(box.textContent).toContain('프로젝트 준비')
    expect(box.textContent).toContain('2/6 완료')
    expect(Object.fromEntries(STEPS.map((s) => [s.id, stateOf(s.id)])))
      .toEqual({ basic: 'todo', levels: 'done', teams: 'todo', members: 'todo', calendar: 'done', firstData: 'todo' })
    expect(box.textContent).not.toContain('확인했어요')
    expect(box.querySelector('[data-setup-step="areas"]')).toBeNull()   // 서버가 내리지 않은 단계(모듈 꺼짐)는 없다
  })

  it('각 단계에 해당 설정 위치로 가는 링크가 있다', async () => {
    await mount()
    const href = (id: string) => row(id).querySelector('a')!.getAttribute('href')
    expect(href('basic')).toBe('/p/project/settings#project-general')
    expect(href('teams')).toBe('/p/project/settings#project-team')
    expect(href('members')).toBe('/p/project/members')
    expect(href('calendar')).toBe('/p/project/settings#project-calendar')
    expect(href('firstData')).toBe('/p/project/wbs')
    expect(row('teams').querySelector('a')!.getAttribute('aria-label')).toBe('팀 열기')
  })

  it('건너뛰기는 아직인 단계에만 있고 브라우저에 저장된다 — 다시 열어도 유지, 취소할 수 있다', async () => {
    await mount()
    expect(button(row('levels'), '건너뛰기')).toBeUndefined()            // 완료 단계에는 없다
    await click(button(row('teams'), '건너뛰기'))
    expect(stateOf('teams')).toBe('skipped')
    expect(JSON.parse(localStorage.getItem('project-setup:v2:user:project')!)).toEqual({ skipped: ['teams'], hidden: false })
    act(() => root.unmount()); root = createRoot(box)
    await mount()
    expect(stateOf('teams')).toBe('skipped')
    await click(button(row('teams'), '건너뛰기 취소'))
    expect(stateOf('teams')).toBe('todo')
  })

  it('서버 상태가 완료면 그것이 우선 — 건너뛴 단계가 실제로 채워지면 완료로 보인다', async () => {
    localStorage.setItem('project-setup:v2:user:project', JSON.stringify({ skipped: ['teams'], hidden: false }))
    await mount({ steps: STEPS.map((s) => (s.id === 'teams' ? { ...s, state: 'done' } : s)) })
    expect(stateOf('teams')).toBe('done')
    expect(box.textContent).toContain('3/6 완료')
  })

  it('다른 계정·다른 프로젝트와 건너뛰기를 공유하지 않는다', async () => {
    await mount()
    await click(button(row('teams'), '건너뛰기'))
    await mount({ userId: 'other' }); expect(stateOf('teams')).toBe('todo')
    await mount({ projectId: 'other-project' }); expect(stateOf('teams')).toBe('todo')
    await mount(); expect(stateOf('teams')).toBe('skipped')
  })

  it('닫으면 다시 여는 버튼만 남고(진행 표시 포함), 열면 목록이 돌아온다', async () => {
    await mount()
    await click(button(box, '닫기'))
    expect(box.querySelector('[data-setup-panel]')).toBeNull()
    const reopen = [...box.querySelectorAll('button')].find((b) => b.textContent?.startsWith('준비 체크리스트 열기'))!
    expect(reopen.textContent).toContain('2/6 완료')
    await click(reopen)
    expect(box.querySelector('[data-setup-panel]')).not.toBeNull()
  })

  it('확인 불가 단계는 완료로도 아직으로도 말하지 않는다 — 건너뛰기도 없다', async () => {
    await mount({ steps: STEPS.map((s) => (s.id === 'members' ? { ...s, state: 'unknown' } : s)) })
    expect(stateOf('members')).toBe('unknown')
    expect(row('members').textContent).toContain('이 단계의 상태를 읽지 못했습니다.')
    expect(button(row('members'), '건너뛰기')).toBeUndefined()
  })

  it('전부 완료면 그렇게 말한다', async () => {
    await mount({ steps: DONE })
    expect(box.textContent).toContain('6/6 완료')
    expect(box.textContent).toContain('준비 단계를 모두 마쳤습니다.')
  })

  it('옛 저장값(v1 — 몇 번째까지 확인했나)은 읽지 않는다. 깨진 저장값은 저장 불가 안내', async () => {
    localStorage.setItem('project-setup:v1:user:project', JSON.stringify({ step: 4, hidden: true }))
    await mount()
    expect(box.querySelector('[data-setup-panel]')).not.toBeNull()
    expect(stateOf('basic')).toBe('todo')
    act(() => root.unmount()); root = createRoot(box)
    localStorage.setItem('project-setup:v2:user:project', '{not json')
    await mount()
    expect(box.querySelector('[role="alert"]')?.textContent).toBe('이 브라우저에서는 건너뛰기·닫기를 저장할 수 없습니다.')
    expect(box.querySelector('[data-setup-panel]')).not.toBeNull()
  })
})

describe('배너(개요 화면 — 프로젝트 관리자에게만 내려온다)', () => {
  const banner = () => box.querySelector('[data-setup-banner]')

  it('미완료면 한 줄: 진행·다음 단계 링크·전체 보기·닫기', async () => {
    await mount({ variant: 'banner' })
    expect(banner()!.textContent).toContain('프로젝트 준비')
    expect(banner()!.textContent).toContain('2/6 완료')
    const next = banner()!.querySelector('[data-setup-next]')!
    expect(next.textContent).toBe('다음: 기본 정보')
    expect(next.getAttribute('href')).toBe('/p/project/settings#project-general')
    expect([...banner()!.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/p/project/settings')
    expect(box.querySelector('[data-setup-step]')).toBeNull()   // 접힌 한 줄 — 단계 목록은 설정 화면에 있다
  })

  it('다음 단계는 건너뛴 단계를 지난다', async () => {
    localStorage.setItem('project-setup:v2:user:project', JSON.stringify({ skipped: ['basic', 'teams'], hidden: false }))
    await mount({ variant: 'banner' })
    expect(banner()!.querySelector('[data-setup-next]')!.textContent).toBe('다음: 멤버')
  })

  it('전부 완료면 숨는다', async () => {
    await mount({ variant: 'banner', steps: DONE })
    expect(banner()).toBeNull()
    expect(box.textContent).toBe('')
  })

  it('남은 단계를 모두 건너뛰었으면 숨는다', async () => {
    localStorage.setItem('project-setup:v2:user:project', JSON.stringify({ skipped: ['basic', 'teams', 'members', 'firstData'], hidden: false }))
    await mount({ variant: 'banner' })
    expect(banner()).toBeNull()
  })

  it('닫으면 숨고, 다시 들어와도 숨어 있다 — 설정 화면의 패널도 같은 닫힘을 본다', async () => {
    await mount({ variant: 'banner' })
    await click(banner()!.querySelector('button[aria-label="준비 안내 닫기"]')!)
    expect(banner()).toBeNull()
    act(() => root.unmount()); root = createRoot(box)
    await mount({ variant: 'banner' })
    expect(banner()).toBeNull()
    act(() => root.unmount()); root = createRoot(box)
    await mount()
    expect(box.querySelector('[data-setup-panel]')).toBeNull()
    expect(box.textContent).toContain('준비 체크리스트 열기')
  })
})
