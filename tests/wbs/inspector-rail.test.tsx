// @vitest-environment jsdom
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '../shell/_dom'
import { withTeams } from '../fixtures/teams'
import type { ComputedItem } from '@/lib/domain/types'
import { t, type DictKey } from '@/lib/i18n/dict'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/actions/wbs', () => ({ getChangeLogs: async () => [] }))
vi.mock('@/app/actions/attachments', () => ({ listAttachments: async () => ({ ok: true, rows: [], download: 'allowed' }) }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({}) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: DictKey) => t('ko', k) }) }))
vi.mock('@/components/wbs/WbsAssigneeStagePanel', () => ({ WbsAssigneeStagePanel: () => null }))
vi.mock('@/components/wbs/DependencyEgoGraph', () => ({ DependencyEgoGraph: () => null }))
vi.mock('@/components/wbs/ChangeHistoryList', () => ({ ChangeHistoryList: () => null }))
import { RightRailProvider } from '@/components/app/RightRail'
import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'

const item: ComputedItem = { id: 'r1', parentId: null, code: '1', sortOrder: 0, name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: 0, owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0 }
describe('행 인스펙터의 레일 틀', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app-rail"></div>'; localStorage.clear() })
  async function show(width: number, provider = true, onClose = vi.fn()) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const panel = withTeams(<RowDetailPanel item={item} onClose={onClose} projectId="p" levelLabels={['단계', '작업']} timeZone="UTC" />)
    let mounted!: ReturnType<typeof render>
    await act(async () => { mounted = render(provider ? <RightRailProvider>{panel}</RightRailProvider> : panel) })
    return mounted
  }
  it('1440 병치·제목과 닫기 하나·옛 저장 폭을 본문 여유로 제한', async () => {
    localStorage.setItem('wbs.detailPanelWidth', '1400')
    await show(1440)
    const rail = document.querySelector('[data-rail="inspector"]')!
    expect(rail.getAttribute('role')).toBe('complementary')
    expect(rail.closest('#app-rail')).not.toBeNull()
    expect(rail.querySelectorAll('h2')).toHaveLength(1)
    expect(rail.querySelectorAll('[aria-label="닫기"]')).toHaveLength(1)
    expect((rail as HTMLElement).style.getPropertyValue('--rail-w')).toBe('440px')
  })
  it('1280 오버레이·초점 가둠·Esc 뒤 트리거 복귀', async () => {
    const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus()
    const close = vi.fn()
    const mounted = await show(1280, true, close)
    const rail = document.querySelector<HTMLElement>('[data-rail="inspector"]')!
    expect(rail.getAttribute('aria-modal')).toBe('true')
    expect(rail.contains(document.activeElement)).toBe(true)
    await act(async () => rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).toHaveBeenCalledTimes(1)
    mounted.unmount(); expect(document.activeElement).toBe(trigger)
  })
  it('공급자 밖은 기존 오버레이, 기본 폭 400', async () => {
    await show(1440, false)
    expect(document.querySelector('[data-rail]')).toBeNull()
    const dlg = document.querySelector('[role="dialog"]')!
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.querySelector('aside')?.style.width).toBe('400px')
    expect(dlg.querySelector('aside')?.style.maxWidth).toBe('100vw')
  })
})
