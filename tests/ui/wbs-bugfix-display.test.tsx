// @vitest-environment jsdom
// WBS 계산·표시 묶음(사용자 테스트 BUG-05·12·14·15·23·24)의 화면 회귀 — 시트(표·간트)와 상세 패널.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import { WBS_NAME_MAX } from '@/lib/domain/wbsValueRules'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const updateActual = vi.fn(async () => ({ ok: true }))
vi.mock('@/app/actions/wbs', () => ({
  updateActual: (...a: unknown[]) => updateActual(...(a as [])),
  updateWeight: vi.fn(async () => ({ ok: true })),
  addWbsItem: vi.fn(),
  getWbsCellSnapshot: vi.fn(),
  getChangeLogs: vi.fn().mockResolvedValue([]),
  updateWbsFields: vi.fn(), updateDeliverable: vi.fn(), addSubAct: vi.fn(), deleteWbsItem: vi.fn(), moveWbsItem: vi.fn(),
  addTaskDependency: vi.fn(), removeTaskDependency: vi.fn(),
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments: vi.fn().mockResolvedValue({ ok: true, rows: [], download: 'allowed' }), recordAttachment: vi.fn(), removeAttachment: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  return { useLocale: () => ({ t: (k: Parameters<typeof t>[0]) => t(k) }) }
})
vi.mock('@/components/wbs/WbsAssigneeStagePanel', () => ({ WbsAssigneeStagePanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'
import { calInputUtcMon } from '../helpers/calendarFixture'
import { makeProjectActorView } from '../fixtures/actor'

const base: ComputedItem = {
  id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0,
}
const node = (over: Partial<ComputedItem>): ComputedItem => ({ ...base, ...over })

// 리포트의 트리 — 화면에서 추가한 항목이라 저장 code 는 이름의 첫 낱말이다. 일정은 맨 아래 잎에만 있다
const interview = node({ id: 'a1', parentId: 'a', code: '현행', name: '현행 업무 인터뷰', depth: 2, plannedStart: '2026-10-12', plannedEnd: '2026-10-16', actualPct: 0 })
const analysis = node({ id: 'a', parentId: 'p', code: '요구사항', name: '요구사항 분석', depth: 1, children: [interview] })
const env = node({ id: 'b', parentId: 'p', code: '환경', name: '환경 구성', depth: 1, sortOrder: 1, plannedStart: '2027-03-01', plannedEnd: '2027-03-10', actualPct: 40, rolledActualPct: 40 })
const phase = node({ id: 'p', code: '1', name: '1. 착수준비', depth: 0, children: [analysis, env] })
const ADMIN = makeProjectActorView({ userId: 'u-a', projectRole: 'admin', memberId: 'm-a', rosterTeamIds: ['tp'], rosterTeamCodes: ['PMO'], primaryTeamCode: 'PMO' })

describe('WBS 계산·표시 묶음 — 화면', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { updateActual.mockClear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

  const sheet = async (over: Record<string, unknown> = {}) => {
    await act(async () => root.render(
      <WbsGanttSheet levelLabels={['Phase', 'Task', 'Activity']} items={[phase]} calendar={calInputUtcMon} today="2026-10-10" actorView={null}
        projectId="p1" startDate="2026-10-12" endDate="2026-12-31" initialCollapsed={[]} initialOutline readOnly {...over} />,
    ))
    await act(async () => {})
  }
  const rowEl = (id: string) => container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!
  const cell = (id: string, col: string) => rowEl(id).querySelector<HTMLElement>(`[data-wbs-col="${col}"]`)!
  const nameButton = (id: string) => container.querySelector<HTMLButtonElement>(`[data-wbs-open-detail="${id}"]`)!
  const panelTitle = () => document.querySelector('[data-wbs-detail-title]')?.textContent ?? null

  describe('[BUG-12] 일정 롤업 — 표·간트', () => {
    it('일정 없는 상위 행은 하위의 min/max 를 연한 글자 + 툴팁으로 보인다', async () => {
      await sheet()
      expect(cell('a', 'pstart').textContent).toBe('26.10.12')
      expect(cell('a', 'pend').textContent).toBe('26.10.16')
      expect(cell('a', 'pstart').getAttribute('data-derived')).toBe('true')
      expect(cell('a', 'pstart').getAttribute('title')).toBe('하위 작업에서 계산됨')
      // 두 단계 위(1. 착수준비)는 두 하위 전체: 10/12 ~ 27/3/10
      expect([cell('p', 'pstart').textContent, cell('p', 'pend').textContent]).toEqual(['26.10.12', '27.03.10'])
    })
    it('직접 입력한 행은 파생 표시가 없다', async () => {
      await sheet()
      expect(cell('a1', 'pstart').getAttribute('data-derived')).toBeNull()
      expect(cell('a1', 'pstart').textContent).toBe('26.10.12')
    })
    it('간트에 요약 막대가 그려진다 — 파생 막대는 표시(옅게 + 툴팁)가 붙는다', async () => {
      await sheet()
      const derived = (id: string) => rowEl(id).querySelector('[data-derived-bar]')
      expect(derived('p')).not.toBeNull()
      expect(derived('a')!.getAttribute('title')).toContain('하위 작업에서 계산됨')
      expect(derived('a1')).toBeNull()
      expect(rowEl('a1').querySelector('[data-testid="gantt-bar-a1"]')).not.toBeNull()
    })
  })

  describe('[BUG-14] 프로젝트 기간 밖 작업', () => {
    it('안내에 건수가 뜨고, 해당 행의 날짜 칸이 표시된다(파생 일정의 상위 행은 아니다)', async () => {
      await sheet()
      const banner = container.querySelector('[data-wbs-out-of-range]')!
      expect(banner.textContent).toContain('프로젝트 기간 밖 작업 1건')
      expect(cell('b', 'pstart').getAttribute('data-out-of-range')).toBe('true')
      expect(cell('b', 'pstart').getAttribute('title')).toBe('프로젝트 기간을 벗어난 일정')
      expect(cell('a1', 'pstart').getAttribute('data-out-of-range')).toBeNull()
      expect(cell('p', 'pstart').getAttribute('data-out-of-range')).toBeNull()
    })
    it('기간 안의 작업뿐이면 안내가 없다', async () => {
      await sheet({ items: [node({ ...phase, children: [analysis] })] })
      expect(container.querySelector('[data-wbs-out-of-range]')).toBeNull()
    })
    it('간트 축이 프로젝트 기간 전체를 덮는다 — 작업이 10월뿐이어도 12월까지', async () => {
      await sheet({ items: [node({ ...phase, children: [analysis] })] })
      expect(container.textContent).toContain('12월')
    })
  })

  describe('[BUG-16] 간트 주 머리 — 주 시작 설정의 주로 끊는다', () => {
    it('월요일 시작 달력: 축이 토요일(10/10)에 시작해도 W02 는 월요일(10/12)이다', async () => {
      await sheet()
      expect(container.textContent).toContain('W0110/10')
      expect(container.textContent).toContain('W0210/12')
      expect(container.textContent).toContain('W0310/19')
    })
  })

  describe('[BUG-05] 번호 — 상세 패널이 표의 번호 열과 같은 번호를 보인다', () => {
    it('표의 번호 열과 패널 머리의 번호가 같다(저장 code "요구사항" 이 아니다)', async () => {
      await sheet()
      expect(cell('a', 'outline').textContent).toBe('1.1')
      await act(async () => nameButton('a').click())
      expect(document.querySelector('[data-wbs-detail-number]')!.textContent).toBe('1.1')
      await act(async () => nameButton('a1').click())
      expect(document.querySelector('[data-wbs-detail-number]')!.textContent).toBe('1.1.1')
    })
  })

  describe('[BUG-15] 상세 패널 전환', () => {
    it('다른 행을 누르면 그 행으로 바뀌고, 같은 행을 다시 누르면 닫힌다', async () => {
      await sheet()
      await act(async () => nameButton('a').click())
      expect(panelTitle()).toBe('요구사항 분석')
      await act(async () => nameButton('b').click())
      expect(panelTitle()).toBe('환경 구성')
      await act(async () => nameButton('b').click())
      expect(panelTitle()).toBeNull()
    })
    it('오버레이의 막이 누름을 받아 닫으려 할 때 — 막 아래가 다른 행의 이름이면 닫지 않고 전환한다', async () => {
      await sheet()
      await act(async () => nameButton('a').click())
      const scrim = document.querySelector<HTMLElement>('[role="dialog"] > [aria-hidden]')!
      // jsdom 은 배치를 하지 않는다 — 눌린 자리 아래의 요소 목록을 흉내 낸다(막 → 그 아래 행의 이름 버튼)
      ;(document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = () => [scrim, nameButton('b')]
      await act(async () => scrim.click())
      expect(panelTitle()).toBe('환경 구성')
      // 같은 행 위(또는 빈 자리)를 누르면 닫힌다
      ;(document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = () => [scrim, nameButton('b')]
      await act(async () => scrim.click())
      expect(panelTitle()).toBeNull()
      delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint
    })
  })

  describe('[BUG-24] 숫자 셀 — 들어갈 때 값 전체를 고른다', () => {
    it('실적% 칸을 열면 기존 값이 선택된다(그대로 치면 덮는다), 범위 밖 값으로 Enter 해 거부돼도 다시 전체 선택', async () => {
      const select = vi.spyOn(HTMLInputElement.prototype, 'select')
      await sheet({ readOnly: false, actorView: ADMIN })
      await act(async () => rowEl('a1').querySelector<HTMLElement>('[title="클릭하여 실적% 입력"]')!.click())
      const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
      expect(input).not.toBeNull()
      expect(select).toHaveBeenCalled()
      select.mockClear()
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, '150')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
      expect(updateActual).not.toHaveBeenCalled()                       // 0~100 밖 — 서버에 가지 않는다
      expect(container.querySelector('input[type="number"]')).not.toBeNull()   // 편집기는 남는다
      expect(select).toHaveBeenCalled()
    })
  })
})

describe('[BUG-23·05·12] 상세 패널 머리·개요', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const mount = async (item: ComputedItem, props: Record<string, unknown> = {}) => {
    await act(async () => root.render(<RowDetailPanel timeZone="Asia/Seoul" levelLabels={['Phase', 'Task', 'Activity']} item={item} allItems={[item]} dependencies={[]} projectId="p1" onClose={() => {}} {...props} />))
    await act(async () => {})
  }

  it('긴 이름은 두 줄로 줄이고 전체 이름을 title 로 둔다', async () => {
    const long = '가'.repeat(200)
    await mount(node({ id: 'i', name: long }))
    const h = container.querySelector<HTMLElement>('[data-wbs-detail-title]')!
    expect(h.className).toContain('line-clamp-2')
    expect(h.getAttribute('title')).toBe(long)
  })
  it('번호를 넘기지 않으면 저장 code 를 대신 보이지 않는다', async () => {
    await mount(node({ id: 'i', code: '요구사항', name: '요구사항 분석' }))
    expect(container.querySelector('[data-wbs-detail-number]')).toBeNull()
    expect(container.querySelector('header')!.textContent).not.toContain('요구사항요구사항')
  })
  it('파생 일정은 계산된 값 + "하위 작업에서 계산됨", 기간 밖이면 그 안내', async () => {
    await mount(node({ id: 'i', name: '요약' }), { shown: { start: '2026-10-12', end: '2026-10-16', startDerived: true, endDerived: true }, numbers: new Map([['i', '1.1']]) })
    expect(container.querySelector('[data-wbs-detail-schedule]')!.textContent).toBe('26.10.12 ~ 26.10.16')
    expect(container.querySelector('[data-wbs-detail-derived]')!.textContent).toBe('하위 작업에서 계산됨')
    expect(container.querySelector('[data-wbs-detail-number]')!.textContent).toBe('1.1')
    await mount(node({ id: 'i', name: '늦은 작업', plannedStart: '2027-03-01', plannedEnd: '2027-03-10' }), { outOfRange: true })
    expect(container.querySelector('[data-wbs-detail-derived]')).toBeNull()
    expect(container.querySelector('[data-wbs-detail-out-of-range]')!.textContent).toBe('프로젝트 기간을 벗어난 일정')
  })
  it('이름 입력 칸은 서버와 같은 상한(maxLength)을 둔다', async () => {
    await mount(node({ id: 'i', name: '작업' }), { editable: true })
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="편집"]')!.click())
    expect(container.querySelector<HTMLInputElement>('input.app-input')!.maxLength).toBe(WBS_NAME_MAX)
  })
})
