// @vitest-environment jsdom
// WBS 표의 키보드 이동·편집(개정 §5.9.2 키보드 행, §5.5.5 Grid cell). 탐색 모드의 방향키는 DOM 포커스만 옮긴다 — 좌표는 itemId + 열 key 이고
// 표 안의 탭 정지는 한 칸뿐이다(roving tabindex). 편집 진입·확정은 종전의 저장 길(updateActual·updateWeight·saveCustomFieldValues) 그대로다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import type { FieldDef } from '@/lib/domain/customFields'
import type { ProjectActorView } from '@/lib/domain/authz'
import { makeProjectActorView } from '../fixtures/actor'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type SaveResult = { ok: boolean; error?: string; conflict?: boolean }
const h = vi.hoisted(() => ({
  updateActual: vi.fn<(id: string, pct: number, expected: number) => Promise<{ ok: boolean; error?: string; conflict?: boolean }>>(),
  updateWeight: vi.fn<(id: string, weight: number | null, expected: number | null) => Promise<{ ok: boolean; error?: string; conflict?: boolean }>>(),
  saveCustom: vi.fn(),
}))
vi.mock('@/app/actions/wbs', () => ({ updateActual: h.updateActual, updateWeight: h.updateWeight, addWbsItem: vi.fn(), getWbsCellSnapshot: vi.fn() }))
vi.mock('@/app/actions/customFieldValues', () => ({ saveCustomFieldValues: h.saveCustom }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: ({ item }: { item: { id: string } }) => <div data-detail={item.id} /> }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { CustomFieldsProvider } from '@/components/fields/CustomFieldValuesEditor'
import { calInputUtcMon } from '../helpers/calendarFixture'

const admin: ProjectActorView = makeProjectActorView({ userId: 'u-adm', projectRole: 'admin', memberId: 'm-adm', rosterTeamIds: ['tp'], rosterTeamCodes: ['PMO'], primaryTeamCode: 'PMO' })

function item(over: Partial<ComputedItem>): ComputedItem {
  return {
    id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over,
  }
}
// p1 > t1(잎) · t2 > a1(잎) / p2(잎). 보이는 행 순서: p1, t1, t2, a1, p2
function fixture(custom?: Record<string, unknown>): ComputedItem[] {
  const a1 = item({ id: 'a1', parentId: 't2', name: '활동', depth: 2, custom: custom as never })
  const t1 = item({ id: 't1', parentId: 'p1', name: '착수', depth: 1, custom: custom as never })
  const t2 = item({ id: 't2', parentId: 'p1', name: '설계', depth: 1, children: [a1] })
  return [item({ id: 'p1', name: '준비', weight: 0.4, children: [t1, t2] }), item({ id: 'p2', name: '마감', weight: 0.6, sortOrder: 1 })]
}
const QTY: FieldDef = { key: 'qty', label: '수량', description: '', type: 'number', required: false, editable_by: 'member', show_in_list: true, searchable: false, sort: 0, active: true } as FieldDef
const NOTE: FieldDef = { ...QTY, key: 'note', label: '비고', type: 'text', sort: 1 } as FieldDef

describe('WBS 표 — 키보드 이동·편집', () => {
  let container: HTMLDivElement, root: Root
  let commits = 0
  beforeEach(() => {
    vi.clearAllMocks()
    h.updateActual.mockResolvedValue({ ok: true })
    h.updateWeight.mockResolvedValue({ ok: true })
    commits = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  const mount = (opts: { actorView?: ProjectActorView | null; readOnly?: boolean; defs?: FieldDef[]; custom?: Record<string, unknown> } = {}) => {
    const sheet = (
      <Profiler id="sheet" onRender={() => { commits++ }}>
        <WbsGanttSheet levelLabels={['Phase', 'Task', 'Activity']} items={fixture(opts.custom)} calendar={calInputUtcMon} today="2026-07-03"
          actorView={opts.actorView === undefined ? admin : opts.actorView} projectId="p1" readOnly={opts.readOnly ?? false} />
      </Profiler>
    )
    return act(async () => root.render(
      opts.defs ? <CustomFieldsProvider projectId="p1" entity="wbs_item" defs={opts.defs} canAdmin locale="ko">{sheet}</CustomFieldsProvider> : sheet,
    ))
  }
  const grid = () => container.querySelector<HTMLElement>('[role="treegrid"]')!
  const rowIds = () => [...grid().querySelectorAll<HTMLElement>('[data-row-id]')].map(r => r.dataset.rowId)
  const cell = (rowId: string, col: string) => grid().querySelector<HTMLElement>(`[data-row-id="${rowId}"] > [data-wbs-cell][data-wbs-col="${col}"]`)!
  /** 지금 포커스가 있는 칸의 좌표 — `행:열` */
  const focused = () => {
    const el = document.activeElement as HTMLElement | null
    const c = el?.closest<HTMLElement>('[data-wbs-cell]')
    return c ? `${c.parentElement!.dataset.rowId}:${c.dataset.wbsCol}${el === c ? '' : `>${el!.tagName.toLowerCase()}`}` : null
  }
  /** 본문의 탭 정지(tabindex=0) 전부 — `행:열` */
  const tabStops = () => [...grid().querySelectorAll<HTMLElement>('[data-row-id] *')]
    .filter(el => el.tabIndex === 0)
    .map(el => { const c = el.closest<HTMLElement>('[data-wbs-cell]'); return c === el ? `${c.parentElement!.dataset.rowId}:${c.dataset.wbsCol}` : el.tagName.toLowerCase() })
  const press = async (key: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    await act(async () => { document.activeElement!.dispatchEvent(ev) })
    return ev
  }
  const focus = (rowId: string, col: string) => act(async () => cell(rowId, col).focus())
  const editorOf = (rowId: string, col: string) => cell(rowId, col).querySelector<HTMLInputElement | HTMLSelectElement>('input:not([type="checkbox"]), select')
  const type = (el: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

  describe('표의 뼈대(ARIA)와 탭 정지', () => {
    it('treegrid — 머리 행·본문 행·칸에 행·열 번호와 트리 단계가 붙는다', async () => {
      await mount()
      expect(grid().getAttribute('aria-label')).toBe('wbs.gridLabel')
      expect(grid().getAttribute('aria-rowcount')).toBe('6')
      const [head, ...rows] = [...grid().querySelectorAll<HTMLElement>(':scope > [role="row"]')]
      expect(head.getAttribute('aria-rowindex')).toBe('1')
      expect([...head.children].every(c => c.getAttribute('role') === 'columnheader')).toBe(true)
      expect(rows.map(r => `${r.dataset.rowId}:${r.getAttribute('aria-rowindex')}:${r.getAttribute('aria-level')}:${r.getAttribute('aria-expanded')}`))
        .toEqual(['p1:2:1:true', 't1:3:2:null', 't2:4:2:true', 'a1:5:3:null', 'p2:6:1:null'])
      // 한 행의 칸은 모두 gridcell 이고 열 번호가 머리 칸과 맞는다
      const cols = (r: Element) => [...r.children].filter(c => c.hasAttribute('aria-colindex')).map(c => `${(c as HTMLElement).dataset.wbsCol ?? 'gantt'}:${c.getAttribute('aria-colindex')}`)
      expect(cols(rows[0])).toEqual(cols(head).slice(0, -1).concat(`gantt:${grid().getAttribute('aria-colcount')}`))
      expect([...rows[0].children].filter(c => c.hasAttribute('aria-colindex')).every(c => c.getAttribute('role') === 'gridcell')).toBe(true)
    })

    it('본문의 탭 정지는 한 칸뿐이다 — 처음에는 첫 행의 작업명. 안쪽 버튼·체크박스·편집 칸은 탭 정지가 아니다', async () => {
      await mount()
      expect(tabStops()).toEqual(['p1:name'])
      expect(grid().querySelectorAll('[data-row-id] button, [data-row-id] input').length).toBeGreaterThan(5)
    })

    it('방향키로 옮기면 탭 정지도 따라간다(늘 하나) — 다시 그리지 않는다', async () => {
      await mount()
      await focus('p1', 'name')
      const before = commits
      await press('ArrowDown')
      await press('ArrowDown')
      await press('ArrowRight')   // t2 는 펼쳐진 부모 — 오른쪽 칸으로 나간다
      expect(focused()).toBe('t2:owners')
      expect(tabStops()).toEqual(['t2:owners'])
      await press('End')
      await press('Home')
      expect(commits).toBe(before)   // 이동은 DOM 포커스만 — React 커밋이 없다
    })

    it('칸 안의 버튼을 눌러 포커스가 들어와도 그 칸이 현재 칸이 된다', async () => {
      await mount()
      await act(async () => cell('a1', 'name').querySelector<HTMLButtonElement>('button[title]')!.focus())
      expect(tabStops()).toEqual(['a1:name'])
      await press('ArrowUp')
      expect(focused()).toBe('t2:name')
    })
  })

  describe('이동', () => {
    it('화살표·Home·End·Ctrl+Home/End', async () => {
      await mount()
      await focus('t1', 'weight')
      await press('ArrowDown'); expect(focused()).toBe('t2:weight')
      await press('ArrowLeft'); expect(focused()).toBe('t2:pend')
      await press('ArrowUp'); await press('ArrowUp'); await press('ArrowUp'); expect(focused()).toBe('p1:pend')
      await press('End'); expect(focused()).toBe('p1:achieve')
      await press('Home'); expect(focused()).toBe('p1:no')
      await press('End', { ctrlKey: true }); expect(focused()).toBe('p2:achieve')
      await press('Home', { metaKey: true }); expect(focused()).toBe('p1:no')
      const ev = await press('ArrowDown')
      expect(ev.defaultPrevented).toBe(true)   // 표가 스크롤 대신 포커스를 옮긴다
    })

    it('Alt+← 같은 브라우저 단축키와 Tab 은 가로채지 않는다(Tab = 표 밖 다음 영역)', async () => {
      await mount()
      await focus('t1', 'weight')
      expect((await press('ArrowLeft', { altKey: true })).defaultPrevented).toBe(false)
      expect((await press('Tab')).defaultPrevented).toBe(false)
      expect(focused()).toBe('t1:weight')
    })

    it('트리 열: ← 는 접고 → 는 편다. 잎에서 ← 는 부모로', async () => {
      await mount()
      await focus('t2', 'name')
      await press('ArrowLeft')
      expect(rowIds()).toEqual(['p1', 't1', 't2', 'p2'])
      expect(focused()).toBe('t2:name')
      await press('ArrowLeft')            // 이미 접힘 — 부모로
      expect(focused()).toBe('p1:name')
      await focus('t2', 'name')
      await press('ArrowRight')
      expect(rowIds()).toEqual(['p1', 't1', 't2', 'a1', 'p2'])
      expect(focused()).toBe('t2:name')
      await focus('a1', 'name')
      await press('ArrowLeft')
      expect(focused()).toBe('t2:name')
    })

    it('현재 칸의 행이 접혀 사라지면 탭 정지는 보이는 가장 가까운 조상으로 간다(열은 그대로)', async () => {
      await mount()
      await focus('a1', 'pactual')
      await act(async () => cell('p1', 'name').querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
      expect(rowIds()).toEqual(['p1', 'p2'])
      expect(tabStops()).toEqual(['p1:pactual'])
    })

    it('열을 숨기면 그 열을 건너뛰고, 현재 칸의 열이 숨겨지면 탭 정지는 작업명으로 간다', async () => {
      await mount()
      await focus('t1', 'weight')
      await act(async () => container.querySelector<HTMLButtonElement>('[data-wbs-columns-toggle]')!.click())
      expect(tabStops()).toEqual(['t1:name'])
      await focus('t1', 'name')
      await press('ArrowRight')
      expect(focused()).toBe('t1:pactual')
    })
  })

  describe('편집 진입·확정·취소(가중치·실적%)', () => {
    it('Enter 로 들어가고 Esc 는 저장 없이 그 칸으로 돌아온다', async () => {
      await mount()
      await focus('t1', 'pactual')
      await press('Enter')
      expect(editorOf('t1', 'pactual')).not.toBeNull()
      expect(focused()).toBe('t1:pactual>input')
      await press('Escape')
      expect(editorOf('t1', 'pactual')).toBeNull()
      expect(focused()).toBe('t1:pactual')
      expect(h.updateActual).not.toHaveBeenCalled()
    })

    it('F2 로도 들어간다. 편집 중 방향키는 입력의 것이다(칸을 옮기지 않는다)', async () => {
      await mount()
      await focus('p1', 'weight')
      await press('F2')
      expect(editorOf('p1', 'weight')?.value).toBe('40')
      const ev = await press('ArrowDown')
      expect(ev.defaultPrevented).toBe(false)
      expect(focused()).toBe('p1:weight>input')
    })

    it('숫자 키는 그 숫자를 초안으로 편집을 연다 — 낙관적 잠금의 기준은 원래 값 그대로', async () => {
      await mount()
      await focus('t1', 'pactual')
      await press('7')
      expect(editorOf('t1', 'pactual')?.value).toBe('7')
      await press('Enter')
      expect(h.updateActual).toHaveBeenCalledWith('t1', 7, 0)
    })

    it('편집 중 Enter = 확정 후 아래 칸', async () => {
      await mount()
      await focus('t1', 'pactual')
      await press('Enter')
      await type(editorOf('t1', 'pactual') as HTMLInputElement, '60')
      await press('Enter')
      expect(h.updateActual).toHaveBeenCalledWith('t1', 60, 0)
      expect(editorOf('t1', 'pactual')).toBeNull()
      expect(focused()).toBe('t2:pactual')
      expect(tabStops()).toEqual(['t2:pactual'])
    })

    it('편집 중 Tab / Shift+Tab = 확정 후 오른쪽 / 왼쪽 칸 — 포커스가 표 밖으로 나가지 않는다', async () => {
      await mount()
      await focus('t1', 'pactual')
      await press('Enter')
      await type(editorOf('t1', 'pactual') as HTMLInputElement, '30')
      const tab = await press('Tab')
      expect(tab.defaultPrevented).toBe(true)
      expect(h.updateActual).toHaveBeenCalledWith('t1', 30, 0)
      expect(focused()).toBe('t1:achieve')

      await focus('p1', 'weight')
      await press('Enter')
      await type(editorOf('p1', 'weight') as HTMLInputElement, '50')
      await press('Tab', { shiftKey: true })
      expect(h.updateWeight).toHaveBeenCalledWith('p1', 0.5, 0.4)
      expect(focused()).toBe('p1:pend')
    })

    it('검증 실패·서버 거부는 편집기에 남는다 — 포커스를 옮기지 않는다', async () => {
      await mount()
      await focus('t1', 'pactual')
      await press('Enter')
      await type(editorOf('t1', 'pactual') as HTMLInputElement, '101')
      await press('Enter')
      expect(h.updateActual).not.toHaveBeenCalled()
      expect(focused()).toBe('t1:pactual>input')
      h.updateActual.mockResolvedValueOnce({ ok: false, error: '거부' } satisfies SaveResult)
      await type(editorOf('t1', 'pactual') as HTMLInputElement, '90')
      await press('Tab')
      expect(h.updateActual).toHaveBeenCalledTimes(1)
      expect(editorOf('t1', 'pactual')).not.toBeNull()
      expect(focused()).toBe('t1:pactual>input')
    })

    it('롤업 행의 실적%처럼 고칠 수 없는 칸은 Enter·F2·숫자로 열리지 않는다', async () => {
      await mount()
      await focus('p1', 'pactual')
      for (const k of ['Enter', 'F2', '5']) await press(k)
      expect(container.querySelector('input[type="number"]')).toBeNull()
      expect(cell('p1', 'pactual').getAttribute('aria-readonly')).toBe('true')
    })
  })

  describe('행 선택·상세', () => {
    it('작업명 칸의 Space 는 행 선택을 뒤집는다 — 체크박스와 같은 상태', async () => {
      await mount()
      await focus('t1', 'name')
      const box = () => cell('t1', 'no').querySelector<HTMLInputElement>('input[type="checkbox"]')!
      const ev = await press(' ')
      expect(ev.defaultPrevented).toBe(true)
      expect(box().checked).toBe(true)
      expect(grid().querySelector('[data-row-id="t1"]')!.getAttribute('aria-selected')).toBe('true')
      expect(focused()).toBe('t1:name')
      await press(' ')
      expect(box().checked).toBe(false)
    })

    it('작업명 칸의 Enter 는 상세 패널을 연다(이름 버튼과 같은 동작)', async () => {
      await mount()
      await focus('t2', 'name')
      await press('Enter')
      expect(container.querySelector('[data-detail]')?.getAttribute('data-detail')).toBe('t2')
    })
  })

  describe('조회 전용', () => {
    it.each([['명단 밖(조회)', { actorView: null }], ['읽기 전용 시트', { readOnly: true }]] as const)('%s — 이동은 되고 편집 진입·행 선택은 안 된다', async (_n, opts) => {
      await mount(opts)
      expect(tabStops()).toEqual(['p1:name'])
      await focus('t1', 'pactual')
      await press('ArrowLeft')
      expect(focused()).toBe('t1:pplan')
      await press('ArrowRight')
      for (const k of ['Enter', 'F2', ' ', '5']) await press(k)
      expect(container.querySelector('input[type="number"]')).toBeNull()
      await focus('p1', 'weight')
      for (const k of ['Enter', 'F2', '5']) await press(k)
      expect(container.querySelector('input[type="number"]')).toBeNull()
      await focus('t1', 'name')
      await press(' ')
      expect(grid().querySelector('[aria-selected="true"]')).toBeNull()
      expect(h.updateActual).not.toHaveBeenCalled()
      expect(h.updateWeight).not.toHaveBeenCalled()
    })
  })

  describe('사용자 정의 필드 칸', () => {
    it('이동 모델에 들어온다 — Enter/F2 로 편집, Tab = 확정 후 오른쪽 칸, Esc = 그 칸으로 복귀', async () => {
      h.saveCustom.mockResolvedValue({ ok: true, values: { qty: 5 } })
      await mount({ defs: [QTY, NOTE], custom: { qty: 1 } })
      await focus('t1', 'achieve')
      await press('ArrowRight')
      expect(focused()).toBe('t1:cf:qty')
      expect(tabStops()).toEqual(['t1:cf:qty'])
      await press('F2')
      expect(editorOf('t1', 'cf:qty')?.value).toBe('1')
      await type(editorOf('t1', 'cf:qty') as HTMLInputElement, '5')
      const tab = await press('Tab')
      expect(tab.defaultPrevented).toBe(true)
      expect(h.saveCustom).toHaveBeenCalledWith('p1', 'wbs_item', 't1', { qty: 1 }, { qty: 5 })
      expect(focused()).toBe('t1:cf:note')

      await press('Enter')
      expect(editorOf('t1', 'cf:note')).not.toBeNull()
      await press('Escape')
      expect(editorOf('t1', 'cf:note')).toBeNull()
      expect(focused()).toBe('t1:cf:note')
      expect(h.saveCustom).toHaveBeenCalledTimes(1)
    })

    it('편집 중 Enter = 확정 후 아래 칸. 값이 그대로면 저장 없이 옮긴다', async () => {
      await mount({ defs: [QTY], custom: { qty: 1 } })
      await focus('t1', 'cf:qty')
      await press('Enter')
      await press('Enter')
      expect(h.saveCustom).not.toHaveBeenCalled()
      expect(focused()).toBe('t2:cf:qty')
    })
  })
})
