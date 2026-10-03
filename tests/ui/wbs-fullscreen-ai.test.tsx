// @vitest-environment jsdom
// AA3 — WBS 전체 화면 안에서 AI 를 여는 길(스펙 §5.5·§8.5(c) "전체 화면에서 AI 열기(1440·390)", D56). 전체 화면이 전역 바(AI 아이콘)를 덮으므로
// 전체 화면 툴바에 AI 토글을 둔다 — 레일 API 를 부르고, AI 를 쓸 수 있을 때(aiAvailable)만 보인다. 첫 Esc 는 열린 AI 에 양보한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: ({ item, onClose }: { item: { id: string }; onClose(): void }) => <aside data-test-inspector={item.id}><button onClick={onClose}>상세 닫기</button></aside> }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { calInputUtcMon } from '../helpers/calendarFixture'
import { RightRailProvider, useRightRail } from '@/components/app/RightRail'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}
let rail: ReturnType<typeof useRightRail> | null = null
function RailApi({ ai }: { ai: boolean }) {
  rail = useRightRail()
  const set = rail.setAiAvailable
  // 테스트에서 AssistantChat 탐침 대신 가용 여부를 싣는다
  if (rail.aiAvailable !== ai) queueMicrotask(() => set(ai))
  return null
}

describe('WBS 전체 화면 툴바의 AI 토글(AA3)', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); rail = null })
  const toggle = () => container.querySelector<HTMLButtonElement>('[data-wbs-ai-toggle]')
  async function show(ai: boolean) {
    await act(async () => root.render(
      <RightRailProvider><RailApi ai={ai} /><WbsGanttSheet levelLabels={['Phase', 'Task', 'Activity']} items={[item({ id: 'p1' })]} calendar={calInputUtcMon} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} /></RightRailProvider>,
    ))
    await act(async () => { await Promise.resolve() })
  }
  const enterFs = async () => { await act(async () => { container.querySelector<HTMLButtonElement>('[data-wbs-fullscreen-toggle]')!.click() }) }

  it('전체 화면 밖에서는 없고(전역 바 아이콘이 진입점), 전체 화면 안에서 AI 를 쓸 수 있으면 보인다', async () => {
    await show(true)
    expect(toggle()).toBeNull()
    await enterFs()
    expect(toggle()).not.toBeNull()
    expect(toggle()!.getAttribute('aria-label')).toBe('chat.open')
  })
  it('AI 를 쓸 수 없으면(탐침 404) 전체 화면에서도 없다', async () => {
    await show(false); await enterFs()
    expect(toggle()).toBeNull()
  })
  it('누르면 레일 점유자 ai 를 열고·닫는다(aria-pressed)', async () => {
    await show(true); await enterFs()
    await act(async () => { toggle()!.click() })
    expect(rail!.occupant).toBe('ai'); expect(toggle()!.getAttribute('aria-pressed')).toBe('true')
    await act(async () => { toggle()!.click() })
    expect(rail!.occupant).toBeNull()
  })
  it('AI 가 열려 있으면 첫 Esc 는 전체 화면을 닫지 않는다(AI 에 양보)', async () => {
    await show(true); await enterFs()
    await act(async () => { toggle()!.click() })
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.querySelector('[data-wbs-fullscreen="open"]')).not.toBeNull()
  })
  it('행 선택→AI→인스펙터 전환은 선택을 보존하고 점유자 하나만 보인다', async () => {
    await show(true)
    const row = container.querySelector<HTMLButtonElement>('[data-row-id="p1"] [data-wbs-col="name"] button[title]')!
    await act(async () => row.click())
    expect(rail!.occupant).toBe('inspector')
    expect(container.querySelector('[data-test-inspector]')?.getAttribute('data-test-inspector')).toBe('p1')
    await act(async () => rail!.open('ai'))
    expect(container.querySelector('[data-test-inspector]')).toBeNull()
    await act(async () => rail!.open('inspector'))
    expect(container.querySelector('[data-test-inspector]')?.getAttribute('data-test-inspector')).toBe('p1')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-test-inspector] button')!.click())
    expect(rail!.occupant).toBeNull()
    await act(async () => rail!.open('inspector'))
    expect(container.querySelector('[data-test-inspector]')).toBeNull()
  })
  it('AI를 닫은 뒤 보존된 숨은 선택이 전체 화면 Esc를 막지 않는다', async () => {
    await show(true); await enterFs()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-row-id="p1"] [data-wbs-col="name"] button[title]')!.click())
    await act(async () => rail!.open('ai'))
    await act(async () => rail!.close('ai'))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('[data-wbs-fullscreen="open"]')).toBeNull()
  })
})
