// @vitest-environment jsdom
// WBS 표의 셀 범위(직사각형) 선택·복사·붙여넣기·지우기(개정 §5.9.2 "Shift+방향키=범위 — 행 체크 선택과 다른 상태", §5.8 무통보 덮어쓰기 0건).
// 범위는 React 상태가 아니다 — 훅의 ref 와 칸의 DOM 속성(data-wbs-range·aria-selected)에 있다. 저장은 기존 액션을 "화면이 본 값"과 함께 부른다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import type { FieldDef } from '@/lib/domain/customFields'
import type { ProjectActorView } from '@/lib/domain/authz'
import { makeProjectActorView } from '../fixtures/actor'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  updateActual: vi.fn(),
  updateWeight: vi.fn(),
  updateDeliverable: vi.fn(),
  saveCustom: vi.fn(),
  snapshot: vi.fn(),
  bulkPaste: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/app/actions/wbs', () => ({
  updateActual: h.updateActual, updateWeight: h.updateWeight, updateDeliverable: h.updateDeliverable, addWbsItem: vi.fn(), getWbsCellSnapshot: vi.fn(),
}))
vi.mock('@/app/actions/wbsBulk', () => ({ createWbsBulkSnapshot: h.snapshot, bulkPasteWbsItems: h.bulkPaste, bulkUpdateWbsItems: vi.fn() }))
vi.mock('@/app/actions/customFieldValues', () => ({ saveCustomFieldValues: h.saveCustom }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: ({ item }: { item: { id: string } }) => <div data-detail={item.id} /> }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { CustomFieldsProvider } from '@/components/fields/CustomFieldValuesEditor'
import { calInputUtcMon } from '../helpers/calendarFixture'

const admin: ProjectActorView = makeProjectActorView({ userId: 'u-adm', projectRole: 'admin', memberId: 'm-adm', rosterTeamIds: ['tp'], rosterTeamCodes: ['PMO'], primaryTeamCode: 'PMO' })
const member: ProjectActorView = makeProjectActorView({ userId: 'u-mem', projectRole: 'member', memberId: 'm-mem', rosterTeamIds: ['tp'], rosterTeamCodes: ['PMO'], primaryTeamCode: 'PMO' })

function item(over: Partial<ComputedItem>): ComputedItem {
  return {
    id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [{ team: 'PMO', kind: 'primary' }], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over,
  }
}
// p1 > t1(잎) · t2 > a1(잎) / p2(잎). 보이는 행 순서: p1, t1, t2, a1, p2
function fixture(custom?: Record<string, unknown>): ComputedItem[] {
  const c = custom as never
  const a1 = item({ id: 'a1', parentId: 't2', name: '활동', depth: 2, weight: 0.25, actualPct: 30, rolledActualPct: 30, custom: c })
  const t1 = item({ id: 't1', parentId: 'p1', name: '착수', depth: 1, weight: 0.5, actualPct: 10, rolledActualPct: 10, deliverable: '착수 보고서', custom: c })
  const t2 = item({ id: 't2', parentId: 'p1', name: '설계', depth: 1, rolledActualPct: 30, children: [a1], custom: c })
  return [item({ id: 'p1', name: '준비', weight: 0.4, rolledActualPct: 20, children: [t1, t2], custom: c }), item({ id: 'p2', name: '마감', weight: 0.6, sortOrder: 1, custom: c })]
}
const QTY: FieldDef = { key: 'qty', label: '수량', description: '', type: 'number', required: false, editable_by: 'member', show_in_list: true, searchable: false, sort: 0, active: true } as FieldDef
const NOTE: FieldDef = { ...QTY, key: 'note', label: '비고', type: 'text', sort: 1 } as FieldDef
const MANY: FieldDef[] = ['f1', 'f2', 'f3', 'f4', 'f5'].map((key, sort) => ({ ...QTY, key, label: key, type: 'text', sort }) as FieldDef)

describe('WBS 표 — 셀 범위 선택·복사·붙여넣기·지우기', () => {
  let container: HTMLDivElement, root: Root
  let commits = 0
  beforeEach(() => {
    vi.clearAllMocks()
    h.updateActual.mockResolvedValue({ ok: true })
    h.updateWeight.mockResolvedValue({ ok: true })
    h.updateDeliverable.mockResolvedValue({ ok: true })
    commits = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  const mount = (opts: { actorView?: ProjectActorView | null; readOnly?: boolean; defs?: FieldDef[]; custom?: Record<string, unknown>; items?: ComputedItem[] } = {}) => {
    const sheet = (
      <Profiler id="sheet" onRender={() => { commits++ }}>
        <WbsGanttSheet levelLabels={['Phase', 'Task', 'Activity']} items={opts.items ?? fixture(opts.custom)} calendar={calInputUtcMon} today="2026-07-03"
          actorView={opts.actorView === undefined ? admin : opts.actorView} projectId="p1" readOnly={opts.readOnly ?? false} />
      </Profiler>
    )
    return act(async () => root.render(
      opts.defs ? <CustomFieldsProvider projectId="p1" entity="wbs_item" defs={opts.defs} canAdmin>{sheet}</CustomFieldsProvider> : sheet,
    ))
  }
  const grid = () => container.querySelector<HTMLElement>('[role="treegrid"]')!
  const cell = (rowId: string, col: string) => grid().querySelector<HTMLElement>(`[data-row-id="${rowId}"] > [data-wbs-cell][data-wbs-col="${col}"]`)!
  const coord = (c: HTMLElement) => `${c.parentElement!.dataset.rowId}:${c.dataset.wbsCol}`
  /** 범위 표시가 붙은 칸 — `행:열`(문서 순서) */
  const ranged = () => [...grid().querySelectorAll<HTMLElement>('[data-wbs-cell][data-wbs-range]')].map(coord)
  const selectedCells = () => [...grid().querySelectorAll<HTMLElement>('[data-wbs-cell][aria-selected="true"]')].map(coord)
  const selectedRows = () => [...grid().querySelectorAll<HTMLElement>('[data-row-id][aria-selected="true"]')].map(r => r.dataset.rowId)
  const focused = () => { const c = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-wbs-cell]'); return c ? coord(c) : null }
  const live = () => container.querySelector('[data-wbs-range-live]')?.textContent
  const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })
  const press = async (key: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    await act(async () => { document.activeElement!.dispatchEvent(ev) })
    await flush()
    return ev
  }
  const focus = (rowId: string, col: string) => act(async () => cell(rowId, col).focus())
  const SHIFT = { shiftKey: true }
  /** 네이티브 copy/paste — 포커스가 있는 요소에서 떠서 document 까지 올라간다 */
  const clip = async (type: 'copy' | 'paste', text = '') => {
    const data = { text, setData: vi.fn((_type: string, v: string) => { data.text = v }), getData: vi.fn(() => data.text) }
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', { value: data })
    await act(async () => { document.activeElement!.dispatchEvent(ev) })
    await flush()
    return { ev, data }
  }
  const dialog = () => document.querySelector<HTMLElement>('[data-wbs-range-dialog]')
  const sum = (key: string) => dialog()?.querySelector(`[data-wbs-range-sum="${key}"]`)?.textContent ?? null
  const toast = () => container.querySelector('[role="status"].fixed, [role="alert"].fixed')?.textContent ?? null

  describe('범위 선택 — 키보드', () => {
    it('데이터 열의 Shift+→↓ — 기준 칸부터 직사각형. 칸에 data-wbs-range·aria-selected 가 붙고 포커스가 끝 칸으로 간다', async () => {
      await mount()
      await focus('t1', 'weight')
      expect((await press('ArrowRight', SHIFT)).defaultPrevented).toBe(true)
      await press('ArrowDown', SHIFT)
      expect(ranged()).toEqual(['t1:weight', 't1:pplan', 't2:weight', 't2:pplan'])
      expect(selectedCells()).toEqual(ranged())
      expect(focused()).toBe('t2:pplan')
      expect(live()).toBe('wbs.range.selected')
      // 행 체크 선택과는 다른 상태다 — 행은 하나도 골라지지 않았다
      expect(selectedRows()).toEqual([])
    })

    it('반대 방향은 줄인다 — 한 칸까지 줄어도 범위다. 기준을 지나면 반대쪽으로 늘어난다', async () => {
      await mount()
      await focus('t1', 'weight')
      await press('ArrowDown', SHIFT)
      await press('ArrowDown', SHIFT)
      expect(ranged()).toEqual(['t1:weight', 't2:weight', 'a1:weight'])
      await press('ArrowUp', SHIFT)
      await press('ArrowUp', SHIFT)
      expect(ranged()).toEqual(['t1:weight'])
      await press('ArrowUp', SHIFT)
      expect(ranged()).toEqual(['p1:weight', 't1:weight'])
    })

    it('범위를 늘리고 줄이는 동안 React 는 다시 그리지 않는다 — 범위는 ref 와 DOM 속성에 있다', async () => {
      await mount()
      await focus('t1', 'weight')
      const before = commits
      for (const k of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) await press(k, SHIFT)
      expect(ranged()).toEqual(['t1:weight', 't2:weight'])
      await press('Escape')
      expect(commits).toBe(before)
    })

    it('식별 열(작업명)의 Shift+↓ 는 종전대로 행 범위다 — 셀 범위는 생기지 않는다', async () => {
      await mount()
      await focus('t1', 'name')
      await press('ArrowDown', SHIFT)
      expect(selectedRows()).toEqual(['t1', 't2'])
      expect(ranged()).toEqual([])
      // 작업명 열의 Shift+→ 는 가로채지 않는다(종전 그대로)
      expect((await press('ArrowRight', SHIFT)).defaultPrevented).toBe(false)
    })

    it('왼쪽으로는 첫 데이터 열에서 멈춘다 — 식별 열로 넘어가지 않는다', async () => {
      await mount()
      await focus('t1', 'owners')
      await press('ArrowLeft', SHIFT)
      expect(ranged()).toEqual(['t1:owners'])
      expect(focused()).toBe('t1:owners')
    })

    it('보통의 방향키·다른 칸의 포커스·편집 진입은 범위를 푼다', async () => {
      await mount()
      await focus('t1', 'weight')
      await press('ArrowDown', SHIFT)
      await press('ArrowRight')
      expect(ranged()).toEqual([])
      expect(focused()).toBe('t2:pplan')
      await focus('t1', 'weight')
      await press('ArrowDown', SHIFT)
      await focus('p2', 'weight')
      expect(ranged()).toEqual([])
      await press('ArrowUp', SHIFT)
      expect(ranged()).toEqual(['a1:weight', 'p2:weight'])
      await press('Enter')   // a1 의 가중치 편집기가 열린다 — 선택은 그 한 칸으로 줄어든다
      expect(cell('a1', 'weight').querySelector('input')).not.toBeNull()
      expect(ranged()).toEqual([])
    })

    it('Esc — 범위 해제가 행 선택 해제보다 먼저다(한 번에 한 겹)', async () => {
      await mount()
      await focus('t1', 'name')
      await press(' ')
      expect(selectedRows()).toEqual(['t1'])
      await focus('t1', 'weight')
      await press('ArrowDown', SHIFT)
      const first = await press('Escape')
      expect(first.defaultPrevented).toBe(true)
      expect(ranged()).toEqual([])
      expect(live()).toBe('wbs.range.released')
      expect(selectedRows()).toEqual(['t1'])
      await press('Escape')
      expect(selectedRows()).toEqual([])
    })

    it('끝 칸의 행이 접혀 사라지면 범위는 풀린다 — 남은 칸에 표시가 남지 않는다', async () => {
      await mount()
      await focus('t2', 'weight')
      await press('ArrowDown', SHIFT)
      expect(ranged()).toEqual(['t2:weight', 'a1:weight'])
      await act(async () => cell('t2', 'name').querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
      expect(grid().querySelector('[data-row-id="a1"]')).toBeNull()
      expect(ranged()).toEqual([])
      expect(selectedCells()).toEqual([])
    })
  })

  describe('범위 선택 — Shift+클릭', () => {
    const shiftClick = async (rowId: string, col: string) => {
      const el = cell(rowId, col)
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true, button: 0 })
      await act(async () => { el.dispatchEvent(down) })
      await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true, button: 0 })) })
      return down
    }
    it('포커스 칸부터 누른 칸까지 — 편집 가능한 칸을 눌러도 편집기는 열리지 않는다', async () => {
      await mount()
      await focus('t1', 'weight')
      const down = await shiftClick('a1', 'pactual')
      expect(down.defaultPrevented).toBe(true)
      expect(ranged()).toHaveLength(9)
      expect(ranged()[0]).toBe('t1:weight')
      expect(ranged()[8]).toBe('a1:pactual')
      expect(focused()).toBe('a1:pactual')
      expect(container.querySelector('input[type="number"]')).toBeNull()
      // 이어서 누르면 기준은 그대로다
      await shiftClick('t2', 'weight')
      expect(ranged()).toEqual(['t1:weight', 't2:weight'])
    })

    it('식별 열의 Shift+클릭은 종전 그대로 — 범위를 만들지 않는다', async () => {
      await mount()
      await focus('t1', 'weight')
      expect((await shiftClick('a1', 'name')).defaultPrevented).toBe(false)
      expect(ranged()).toEqual([])
    })
  })

  describe('복사', () => {
    it('범위를 TSV 로 — 날짜는 YYYY-MM-DD, 퍼센트는 숫자+%, 빈 값은 빈 칸', async () => {
      await mount()
      await focus('t1', 'deliverable')
      for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown']) await press(k, SHIFT)
      const { ev, data } = await clip('copy')
      expect(ev.defaultPrevented).toBe(true)
      expect(data.setData).toHaveBeenCalledWith('text/plain', '착수 보고서\t2026-07-01\t2026-07-10\t50%\n\t2026-07-01\t2026-07-10\t')
      expect(live()).toBe('wbs.range.copied')
    })

    it('범위가 없으면 포커스가 있는 한 칸 — 식별 열(작업명)도 된다', async () => {
      await mount()
      await focus('t1', 'name')
      expect((await clip('copy')).data.text).toBe('착수')
      await focus('a1', 'pactual')
      expect((await clip('copy')).data.text).toBe('30%')
    })

    it('편집기 안과 표 밖의 복사는 가로채지 않는다', async () => {
      await mount()
      await focus('t1', 'weight')
      await press('Enter')
      expect(document.activeElement?.tagName).toBe('INPUT')
      expect((await clip('copy')).ev.defaultPrevented).toBe(false)
      await press('Escape')
      await act(async () => container.querySelector<HTMLElement>('[data-wbs-fullscreen-toggle]')!.focus())
      expect((await clip('copy')).ev.defaultPrevented).toBe(false)
    })
  })

  describe('붙여넣기 — 기존 저장 길을 화면이 본 값과 함께', () => {
    it('가중치·실적% — 칸마다 updateWeight·updateActual(값, 기대값). 롤업 부모의 실적은 건너뛴다', async () => {
      await mount()
      await focus('t1', 'weight')
      // t1: 가중치 60%·(계획% 열)·실적 40 / t2(부모): 가중치 빈 칸(이미 균등)·(계획%)·실적 99
      const { ev } = await clip('paste', '60%\tx\t40\n\tx\t99')
      expect(ev.defaultPrevented).toBe(true)
      expect(h.updateWeight.mock.calls).toEqual([['t1', 0.6, 0.5]])
      expect(h.updateActual.mock.calls).toEqual([['t1', 40, 10]])
      expect(h.refresh).toHaveBeenCalledTimes(1)
      // 깨끗하게 끝났다 — 상자 없이 한 줄(건너뛴 읽기 전용 칸 수를 덧붙인다)
      expect(dialog()).toBeNull()
      expect(toast()).toBe('wbs.range.pasted · wbs.range.toastSkipped')
      expect(live()).toBe('wbs.range.pasted')
      // 붙여넣은 직사각형이 범위로 남는다
      expect(ranged()).toHaveLength(6)
      expect(focused()).toBe('t1:weight')
    })

    it('범위가 있으면 기준 칸은 범위의 왼쪽 위다 — 어느 방향으로 늘렸든', async () => {
      await mount()
      await focus('a1', 'weight')
      await press('ArrowUp', SHIFT)
      await press('ArrowUp', SHIFT)   // a1 → t1 로 위로 늘림. 포커스는 t1
      await clip('paste', '70\n\n80')
      expect(h.updateWeight.mock.calls).toEqual([['t1', 0.7, 0.5], ['a1', 0.8, 0.25]])
    })

    it('산출물·계획일(관리자) — 일괄 저장 길: 스냅샷의 updated_at 을 CAS 로, 한 행의 칸은 한 번에', async () => {
      h.snapshot.mockResolvedValue({ ok: true, rows: [
        { id: 't1', name: '착수', plannedStart: '2026-07-01', plannedEnd: '2026-07-10', deliverable: '착수 보고서', biz: null, stage: null, assigneeMemberId: null, teamCode: null, updatedAt: 'T1' },
        { id: 't2', name: '설계', plannedStart: '2026-07-01', plannedEnd: '2026-07-10', deliverable: null, biz: null, stage: null, assigneeMemberId: null, teamCode: null, updatedAt: 'T2' },
      ] })
      h.bulkPaste.mockResolvedValue({ ok: true, total: 2, succeeded: ['t1', 't2'], failed: [] })
      await mount()
      await focus('t1', 'deliverable')
      await clip('paste', '새 보고서\t26.07.02\t\n설계서\t2026-07-01\t2026-07-15')
      expect(h.snapshot).toHaveBeenCalledWith('p1', ['t1', 't2'])
      expect(h.bulkPaste).toHaveBeenCalledWith('p1', [
        { target: { id: 't1', updatedAt: 'T1' }, changes: { deliverable: { mode: 'set', value: '새 보고서' }, plannedStart: { mode: 'set', value: '2026-07-02' }, plannedEnd: { mode: 'clear' } } },
        { target: { id: 't2', updatedAt: 'T2' }, changes: { deliverable: { mode: 'set', value: '설계서' }, plannedEnd: { mode: 'set', value: '2026-07-15' } } },
      ])
      expect(h.updateDeliverable).not.toHaveBeenCalled()
      expect(toast()).toBe('wbs.range.pasted')
    })

    it('화면이 본 값과 서버 값이 다른 행은 쓰지 않는다(무통보 덮어쓰기 0건) — 충돌로 모아 보이고 다시 읽는다', async () => {
      h.snapshot.mockResolvedValue({ ok: true, rows: [
        // t1 의 산출물은 그새 남이 바꿨다 — 화면이 본 값(착수 보고서)이 아니다
        { id: 't1', name: '착수', plannedStart: '2026-07-01', plannedEnd: '2026-07-10', deliverable: '남이 고친 보고서', biz: null, stage: null, assigneeMemberId: null, teamCode: null, updatedAt: 'T1' },
        { id: 't2', name: '설계', plannedStart: '2026-07-01', plannedEnd: '2026-07-10', deliverable: null, biz: null, stage: null, assigneeMemberId: null, teamCode: null, updatedAt: 'T2' },
        { id: 'a1', name: '활동', plannedStart: '2026-07-01', plannedEnd: '2026-07-10', deliverable: null, biz: null, stage: null, assigneeMemberId: null, teamCode: null, updatedAt: 'T3' },
      ] })
      // t2 는 스냅샷 뒤에 또 바뀌었다 — RPC 의 updated_at CAS 가 거부한다. a1 은 검증 거부
      h.bulkPaste.mockResolvedValue({ ok: false, total: 2, succeeded: [], failed: [
        { itemId: 't2', reason: 'conflict', message: '충돌' }, { itemId: 'a1', reason: 'validation', message: '의존 관계가 있어 비울 수 없습니다' },
      ] })
      await mount()
      await focus('t1', 'deliverable')
      await clip('paste', '내 보고서\n설계서\n활동 산출물')
      expect(h.bulkPaste.mock.calls[0][1].map((op: { target: { id: string } }) => op.target.id)).toEqual(['t2', 'a1'])   // t1 은 보내지도 않았다
      expect(dialog()?.dataset.wbsRangeDialog).toBe('done')
      expect(sum('written')).toContain('wbs.range.sum.written')
      expect(sum('conflict')).toContain('착수 · wbs.colDeliverable')
      expect(sum('conflict')).toContain('설계 · wbs.colDeliverable')
      expect(sum('failed')).toContain('활동 · wbs.colDeliverable — 의존 관계가 있어 비울 수 없습니다')
      expect(dialog()?.textContent).toContain('wbs.range.conflictNote')
      expect(h.refresh).toHaveBeenCalledTimes(1)
    })

    it('부분 성공 — 충돌·거부·값 오류·표 밖을 건수와 사유로 보인다. 성공한 칸은 그대로 반영된다', async () => {
      h.updateWeight.mockImplementation(async (id: string) => (id === 'a1' ? { ok: false, conflict: true, latest: 0.9, error: 'x' } : { ok: true }))
      h.updateActual.mockResolvedValue({ ok: false, code: 'actual_locked', error: 'x' })
      await mount()
      await focus('t1', 'weight')
      await clip('paste', '55\tx\t100\n넷\n35\n\n넘침\n넘침')
      expect(h.updateWeight.mock.calls).toEqual([['t1', 0.55, 0.5], ['a1', 0.35, 0.25], ['p2', null, 0.6]])
      expect(sum('written')).toContain('wbs.range.cells')
      expect(sum('conflict')).toContain('활동 · wbs.colWeight')
      expect(sum('failed')).toContain('착수 · wbs.colActualPct — wbs.actualLocked')
      expect(sum('invalid')).toContain('설계 · wbs.colWeight — wbs.range.why.number')
      expect(sum('skipped')).toContain('착수 · wbs.colPlannedPct — wbs.range.why.readonly')
      expect(sum('clipped')).toContain('wbs.range.clippedDetail')
      // 닫으면 포커스가 표로 돌아온다
      await act(async () => [...dialog()!.closest('[role="dialog"]')!.querySelectorAll('button')].find(b => b.textContent === 'common.close')!.click())
      expect(dialog()).toBeNull()
    })

    it('충돌인데 서버 값이 이미 내 값이면 충돌이 아니다 — 쓰지 않았고 알릴 것도 없다', async () => {
      h.updateWeight.mockResolvedValue({ ok: false, conflict: true, latest: 0.7, error: 'x' })
      await mount()
      await focus('t1', 'weight')
      await clip('paste', '70')
      expect(dialog()).toBeNull()
      expect(toast()).toBe('wbs.range.pasted')
    })

    it('사용자 정의 필드 — 한 행의 칸을 saveCustomFieldValues 한 번으로(행 custom 전체가 기대값)', async () => {
      h.saveCustom.mockResolvedValue({ ok: true, values: {} })
      await mount({ defs: [QTY, NOTE], custom: { qty: 1 } })
      await focus('t1', 'cf:qty')
      await clip('paste', '5\t메모\n글자\t둘째')
      expect(h.saveCustom.mock.calls).toEqual([
        ['p1', 'wbs_item', 't1', { qty: 1 }, { qty: 5, note: '메모' }],
        ['p1', 'wbs_item', 't2', { qty: 1 }, { qty: 1, note: '둘째' }],   // '글자' 는 숫자가 아니다 — 그 칸만 빠진다
      ])
      expect(sum('invalid')).toContain('설계 · 수량 — wbs.range.why.number')
    })

    it('필드 충돌 — 다른 칸만 바뀐 행은 그 최신 행 위에 한 번 더 얹고, 내 칸이 바뀐 행은 쓰지 않는다', async () => {
      h.saveCustom
        .mockResolvedValueOnce({ ok: false, code: 'FIELD_CONFLICT', error: 'x', latest: { qty: 1, note: '남의 메모' } })
        .mockResolvedValueOnce({ ok: true, values: {} })
        .mockResolvedValueOnce({ ok: false, code: 'FIELD_CONFLICT', error: 'x', latest: { qty: 9 } })
      await mount({ defs: [QTY, NOTE], custom: { qty: 1 } })
      await focus('t1', 'cf:qty')
      await clip('paste', '5\n6')
      expect(h.saveCustom.mock.calls).toEqual([
        ['p1', 'wbs_item', 't1', { qty: 1 }, { qty: 5 }],
        ['p1', 'wbs_item', 't1', { qty: 1, note: '남의 메모' }, { qty: 5, note: '남의 메모' }],
        ['p1', 'wbs_item', 't2', { qty: 1 }, { qty: 6 }],
      ])
      expect(sum('conflict')).toContain('설계 · 수량')
      expect(sum('conflict')).not.toContain('착수')
    })

    it('멤버 — 산출물은 단건 액션(updateDeliverable)으로, 가중치·계획일은 권한이 없어 건너뛴다', async () => {
      await mount({ actorView: member })
      await focus('t1', 'deliverable')
      await clip('paste', '내 산출물\t2026-08-01\t2026-08-02\t90')
      expect(h.updateDeliverable.mock.calls).toEqual([['t1', '내 산출물', '착수 보고서']])
      expect(h.snapshot).not.toHaveBeenCalled()
      expect(h.updateWeight).not.toHaveBeenCalled()
      expect(toast()).toBe('wbs.range.pasted · wbs.range.toastSkipped')
    })

    it('전부 이미 같은 값이면 저장하지 않는다', async () => {
      await mount()
      await focus('t1', 'weight')
      await clip('paste', '50%')
      expect(h.updateWeight).not.toHaveBeenCalled()
      expect(toast()).toBe('wbs.range.nothing')
      expect(h.refresh).not.toHaveBeenCalled()
    })

    it('편집기 안의 붙여넣기는 가로채지 않는다', async () => {
      await mount()
      await focus('t1', 'weight')
      await press('Enter')
      const { ev } = await clip('paste', '70')
      expect(ev.defaultPrevented).toBe(false)
      expect(h.updateWeight).not.toHaveBeenCalled()
    })
  })

  describe('지우기', () => {
    it('Delete — 범위의 비울 수 있는 칸만 비운다. 실적%는 비울 수 없는 칸으로 알린다', async () => {
      await mount()
      await focus('t1', 'weight')
      await press('ArrowRight', SHIFT)
      await press('ArrowRight', SHIFT)   // 가중치 · 계획% · 실적%
      const ev = await press('Delete')
      expect(ev.defaultPrevented).toBe(true)
      expect(h.updateWeight.mock.calls).toEqual([['t1', null, 0.5]])
      expect(h.updateActual).not.toHaveBeenCalled()
      expect(sum('invalid')).toContain('착수 · wbs.colActualPct — wbs.range.why.required')
      expect(live()).toBe('wbs.range.erased')
      // 범위는 그대로 남는다
      expect(ranged()).toHaveLength(3)
    })

    it('Backspace 도 같다. 범위가 없으면 지우지 않는다 — 가로채지도 않는다', async () => {
      await mount()
      await focus('t1', 'weight')
      expect((await press('Delete')).defaultPrevented).toBe(false)
      expect((await press('Backspace')).defaultPrevented).toBe(false)
      expect(h.updateWeight).not.toHaveBeenCalled()
      await press('ArrowDown', SHIFT)
      await press('ArrowUp', SHIFT)   // 한 칸짜리 범위
      await press('Backspace')
      expect(h.updateWeight.mock.calls).toEqual([['t1', null, 0.5]])
      expect(toast()).toBe('wbs.range.erased')
    })

    it('큰 범위는 지우기 전에 묻는다 — 취소하면 아무것도 쓰지 않는다', async () => {
      h.saveCustom.mockResolvedValue({ ok: true, values: {} })
      await mount({ defs: MANY, custom: { f1: '가', f2: '나', f3: '다', f4: '라', f5: '마' } })
      await focus('p1', 'cf:f1')
      for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) await press(k, SHIFT)
      expect(ranged()).toHaveLength(25)
      await press('Delete')
      expect(dialog()?.dataset.wbsRangeDialog).toBe('confirm')
      expect(h.saveCustom).not.toHaveBeenCalled()
      const button = (text: string) => [...dialog()!.closest('[role="dialog"]')!.querySelectorAll('button')].find(b => b.textContent === text)!
      await act(async () => button('common.cancel').click())
      expect(dialog()).toBeNull()
      expect(h.saveCustom).not.toHaveBeenCalled()
      await focus('p1', 'cf:f1')
      for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) await press(k, SHIFT)
      await press('Delete')
      await act(async () => button('wbs.range.erase').click())
      await flush()
      // 행마다 한 번 — 다섯 행
      expect(h.saveCustom).toHaveBeenCalledTimes(5)
      expect(h.saveCustom.mock.calls[0]).toEqual(['p1', 'wbs_item', 'p1', { f1: '가', f2: '나', f3: '다', f4: '라', f5: '마' }, {}])
      expect(dialog()?.dataset.wbsRangeDialog).toBe('done')
    })
  })

  describe('조회 전용 — 범위·복사는 되고 붙여넣기·지우기는 안 된다', () => {
    it.each([['읽기 전용 시트', { readOnly: true }]] as const)('%s', async (_n, opts) => {
      await mount(opts)
      expect(grid().hasAttribute('aria-multiselectable')).toBe(false)
      await focus('t1', 'weight')
      await press('ArrowDown', SHIFT)
      expect(ranged()).toEqual(['t1:weight', 't2:weight'])
      // 범위가 있는 동안은 표가 다중 선택임을 알린다(행 선택이 없는 화면)
      expect(grid().getAttribute('aria-multiselectable')).toBe('true')
      expect((await clip('copy')).data.text).toBe('50%\n')
      expect((await clip('paste', '70\n80')).ev.defaultPrevented).toBe(false)
      expect((await press('Delete')).defaultPrevented).toBe(false)
      expect(h.updateWeight).not.toHaveBeenCalled()
      expect(dialog()).toBeNull()
      await press('Escape')
      expect(grid().hasAttribute('aria-multiselectable')).toBe(false)
    })

    it('명단 밖(조회) — 붙여넣어도 쓸 수 있는 칸이 없다: 저장하지 않고 건너뛴 사유를 보인다', async () => {
      await mount({ actorView: null })
      await focus('t1', 'weight')
      await clip('paste', '70')
      expect(h.updateWeight).not.toHaveBeenCalled()
      expect(sum('skipped')).toContain('착수 · wbs.colWeight — wbs.range.why.denied')
    })
  })
})
