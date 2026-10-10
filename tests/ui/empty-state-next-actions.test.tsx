// @vitest-environment jsdom
// 빈 화면의 다음 행동(첫 사용 흐름) — 작업 계획 빈 상태의 "작업 추가"·"엑셀로 가져오기"(쓸 수 있는 사람에게만)와 개요 빈 상태의 작업 계획 버튼.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, isValidElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await vi.importActual<typeof import('@/lib/i18n/dict')>('@/lib/i18n/dict')
  const api = { t: (k: Parameters<typeof t>[0]) => t(k) }
  return { useLocale: () => api }
})
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn() }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: vi.fn(async () => []) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { EmptyState } from '@/components/ui/EmptyState'
import { calInputUtcMon } from '../helpers/calendarFixture'
import { makeProjectActorView } from '../fixtures/actor'
import { dashboardProps } from './_dashboard-fixture'

const admin = makeProjectActorView({ userId: 'u-a', projectRole: 'admin', memberId: 'm-a' })
const member = makeProjectActorView({ userId: 'u-m', projectRole: 'member', memberId: 'm-m' })
const wsAdmin = makeProjectActorView({ userId: 'u-w', workspaceRole: 'admin' })

describe('작업 계획 빈 상태 — 다음 행동', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const render = (actorView: ReturnType<typeof makeProjectActorView> | null, readOnly = false) => act(async () => root.render(
    <WbsGanttSheet levelLabels={['단계', '작업']} items={[]} calendar={calInputUtcMon} today="2026-07-03" actorView={actorView} projectId="p1" readOnly={readOnly} />,
  ))
  const actions = () => container.querySelector('[data-wbs-empty-actions]')

  it('프로젝트 관리자에게 "작업 추가"·"엑셀로 가져오기"가 보이고, 안내는 두 길을 다 말한다', async () => {
    await render(admin)
    expect(container.textContent).toContain('작업을 직접 추가하거나 엑셀로 가져오면 여기에 표시됩니다.')
    expect(container.textContent).not.toContain('엑셀을 업로드하면')
    const box = actions()!
    expect([...box.querySelectorAll('button, a')].map((e) => e.textContent)).toEqual(['작업 추가', '엑셀로 가져오기'])
    expect(box.querySelector('a')!.getAttribute('href')).toBe('/p/p1/import')
  })

  it('"작업 추가"는 최상위 항목 입력을 연다', async () => {
    await render(admin)
    // 최상위 항목 입력(autoFocus) — 검색 입력과 구분하려고 자리 표시 문구의 단계 이름으로 찾는다
    const phaseInput = () => [...container.querySelectorAll<HTMLInputElement>('input.app-input')].find((i) => i.placeholder.includes('단계') && !i.placeholder.includes('검색'))
    expect(phaseInput()).toBeUndefined()
    await act(async () => { actions()!.querySelector('button')!.click() })
    expect(phaseInput()).toBeDefined()
    expect(phaseInput()!.value).toBe('')
  })

  it('워크스페이스 관리자(프로젝트 관리자를 승계)에게도 보인다', async () => {
    await render(wsAdmin)
    expect(actions()).not.toBeNull()
  })

  it.each([
    ['멤버', member, false],
    ['조회 전용(권한 조회 실패 포함 — actor 없음)', null, false],
    ['읽기 전용 화면의 관리자', admin, true],
  ] as const)('%s 에게는 버튼이 없다 — 안내 문구만', async (_n, actorView, readOnly) => {
    await render(actorView, readOnly)
    expect(container.textContent).toContain('작업 항목이 없습니다')
    expect(actions()).toBeNull()
    expect(container.textContent).not.toContain('엑셀로 가져오기')
  })
})

describe('개요 빈 상태 — 작업 계획으로 가는 버튼', () => {
  const empty = () => dashboardProps({ items: [], announcements: [], meetings: [], issues: [] })
  it('전부 비었으면 빈 상태에 작업 계획 링크가 있다', async () => {
    const tree = (await DashboardView(empty())) as ReactElement
    expect(isValidElement(tree) && tree.type).toBe(EmptyState)
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('href="/p/p1/wbs"')
    expect(html).toContain('작업 계획으로 가기')
    expect(html).toContain('작업을 직접 추가하거나 엑셀로 가져오면')
    expect(html).not.toContain('설정에서 WBS 엑셀을 가져오면')
  })
})
