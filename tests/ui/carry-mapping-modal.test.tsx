// @vitest-environment jsdom
// 이월 매핑 창(스펙 §5.1, D31·Q37) — 창 단독(선택·옮기지 않음·넘침 표시·제출 인자)과 시트 화면의 라운드 흐름
// (CARRY_PENDING → 창, 다시 대기로 온 영역은 같은 창에 다시, 넘침만 돌아와도 고칠 줄이 남는다, 그 밖 실패는 토스트 — D45).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WeeklyArea } from '@/lib/domain/weeklySheet'
import type { CarryOverflow, CarryPending } from '@/lib/domain/weeklyCarry'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  router: { refresh: vi.fn(), push: vi.fn() },
  toast: vi.fn(),
  createWeeklyReport: vi.fn(),
}))
// 화면 문구는 사전에서 온다 — 진짜 ko 사전으로 풀어 한국어 단언을 그대로 둔다
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t('ko', k as Parameters<typeof t>[1])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ locale: 'ko', t: ko, setLocale: () => {} }) }
})
vi.mock('next/navigation', () => ({ useRouter: () => h.router }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock('@/components/weekly/usePresence', () => ({ usePresence: () => [] }))
vi.mock('@/components/app/PresenceStrip', () => ({ PresenceStrip: () => null }))
vi.mock('@/app/actions/weekly', () => ({
  createWeeklyReport: h.createWeeklyReport, prepareWeeklyCellRewrite: vi.fn(), saveWeeklyCell: vi.fn(),
  saveWeeklyCells: vi.fn(), saveWeeklyTitle: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = { on: () => channel, subscribe: () => channel }
    return { channel: () => channel, removeChannel: vi.fn() }
  },
}))

const { CarryMappingModal, mergeCarrySources } = await import('@/components/weekly/CarryMappingModal')
const { WeeklySheetView } = await import('@/components/weekly/WeeklySheetView')

const AREAS: WeeklyArea[] = [
  { id: 'a-ops', code: 'OPS', name: '운영', sortOrder: 3, active: true, teams: [] },
  { id: 'a-exp', code: 'EXP', name: '실험', sortOrder: 1, active: true, teams: [] },
  { id: 'a-data', code: 'DATA', name: '데이터', sortOrder: 2, active: true, teams: [] },
  { id: 'a-old', code: 'OLD', name: '구 영역', sortOrder: 0, active: false, teams: [] },
  { id: 'a-gone', code: 'GONE', name: '닫힌 영역', sortOrder: 4, active: false, teams: [] },
]
const OLD: CarryPending = { areaId: 'a-old', areaName: '구 영역', cells: ['nextContent', 'nextIssue'] }
const GONE: CarryPending = { areaId: 'a-gone', areaName: '닫힌 영역', cells: ['nextIssue'] }
const pendingRes = (pending: CarryPending[], overflow: CarryOverflow[] = []) =>
  ({ ok: false as const, code: 'CARRY_PENDING' as const, pending, overflow })

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  h.router.refresh.mockClear()
  h.toast.mockClear()
  h.createWeeklyReport.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

// 창은 document.body 로 포털된다
const selectFor = (name: string) =>
  document.querySelector<HTMLSelectElement>(`select[aria-label="${name} 대기 내용을 옮길 영역"]`)
const button = (label: string) =>
  [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined
function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
  act(() => { setter.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })) })
}
/** 전환(startTransition) 안의 await 뒤 상태 갱신까지 비운다 */
async function click(el: HTMLElement) {
  await act(async () => { el.click() })
  await act(async () => {})
}

describe('CarryMappingModal — 창 단독', () => {
  function render(props: Partial<Parameters<typeof CarryMappingModal>[0]> = {}) {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    act(() => root.render(
      <CarryMappingModal open pending={[OLD, GONE]} overflow={[]} areas={AREAS} busy={false}
        onSubmit={onSubmit} onClose={onClose} {...props} />,
    ))
    return { onSubmit, onClose }
  }

  it('대기 영역마다 한 줄 — "비활성 영역 X — 대기 N칸", 선택지는 활성 영역(영역 순)과 옮기지 않음', () => {
    render()
    const lines = [...document.querySelectorAll('[data-carry-source]')].map(li => li.querySelector('span')?.textContent)
    expect(lines).toEqual(['비활성 영역 구 영역 — 대기 2칸', '비활성 영역 닫힌 영역 — 대기 1칸'])
    const options = [...selectFor('구 영역')!.options].map(o => [o.value, o.textContent])
    expect(options).toEqual([['', '영역 선택'], ['a-exp', '실험'], ['a-data', '데이터'], ['a-ops', '운영'], ['skip', '옮기지 않음']])
  })

  it('모든 대기 영역을 고르기 전에는 보낼 수 없고, 고르면 원본 영역 id → 대상 영역 id | skip 으로 보낸다', () => {
    const { onSubmit } = render()
    expect(button('이 매핑으로 이월')!.disabled).toBe(true)
    choose(selectFor('구 영역')!, 'a-data')
    expect(button('이 매핑으로 이월')!.disabled).toBe(true)
    choose(selectFor('닫힌 영역')!, 'skip')
    expect(button('이 매핑으로 이월')!.disabled).toBe(false)
    act(() => button('이 매핑으로 이월')!.click())
    expect(onSubmit).toHaveBeenCalledWith({ 'a-old': 'a-data', 'a-gone': 'skip' })
  })

  it('직전 라운드의 매핑을 미리 고른 채로 연다 — 그 매핑에 없는 영역만 다시 고른다', () => {
    const { onSubmit } = render({ mapping: { 'a-old': 'a-exp' } })
    expect(selectFor('구 영역')!.value).toBe('a-exp')
    expect(selectFor('닫힌 영역')!.value).toBe('')
    choose(selectFor('닫힌 영역')!, 'a-ops')
    act(() => button('이 매핑으로 이월')!.click())
    expect(onSubmit).toHaveBeenCalledWith({ 'a-old': 'a-exp', 'a-gone': 'a-ops' })
  })

  it('넘침은 영역·칸·글자 수와 상한을 보이고, 보내는 매핑에는 대기 목록 밖의 키를 싣지 않는다', () => {
    const { onSubmit } = render({
      pending: [OLD], mapping: { 'a-old': 'a-exp', 'a-stale': 'a-ops' },
      overflow: [{ areaId: 'a-exp', areaName: '실험', cell: 'this_content', length: 21000 }],
    })
    const alert = document.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('20,000자')
    expect(alert.querySelector('[data-carry-overflow="a-exp"]')!.textContent).toBe('실험 · 금주실적 내용 21,000자')
    act(() => button('이 매핑으로 이월')!.click())
    expect(onSubmit).toHaveBeenCalledWith({ 'a-old': 'a-exp' })
  })

  it('보내는 중에는 선택과 두 버튼이 잠긴다', () => {
    render({ busy: true, mapping: { 'a-old': 'skip', 'a-gone': 'skip' } })
    expect(selectFor('구 영역')!.disabled).toBe(true)
    expect(button('이 매핑으로 이월')!.disabled).toBe(true)
    expect(button('취소')!.disabled).toBe(true)
  })
})

describe('mergeCarrySources — 라운드마다 대기 영역을 모은다', () => {
  it('같은 영역은 새 값으로 바꾸고 자리를 지키며, 새 영역은 뒤에 붙인다', () => {
    const renamed: CarryPending = { ...OLD, areaName: '구 영역(개명)', cells: ['nextContent'] }
    expect(mergeCarrySources([OLD], [GONE, renamed])).toEqual([renamed, GONE])
  })
  it('넘침만 돌아온 라운드(빈 대기 목록)에도 앞 라운드의 영역이 남는다', () => {
    expect(mergeCarrySources([OLD, GONE], [])).toEqual([OLD, GONE])
  })
})

describe('시트 화면의 이월 흐름(스펙 §5.1)', () => {
  function showEmpty() {
    act(() => root.render(
      <WeeklySheetView
        projectId="p1" weekStart="2026-09-21" weekLabel="9월 4주차" weekTitle="9월 4주차"
        prevWeek="2026-09-14" nextWeek="2026-09-28"
        thisRange="9/21~9/25" nextRange="9/28~10/2" projectName="Acme"
        report={null} areas={AREAS} initialRows={[]} hasCarrySource
        me={{ id: 'u1', name: 'alice' }} canEditCells canCreateRound
      />,
    ))
  }

  it('CARRY_PENDING 이면 창을 열고 영역 목록을 새로 받으며, 고른 매핑으로 같은 액션을 다시 부른다 — 성공하면 닫힌다', async () => {
    h.createWeeklyReport
      .mockResolvedValueOnce(pendingRes([OLD]))
      .mockResolvedValueOnce({ ok: true, reportId: 'rep', status: 'created' })
    showEmpty()
    await click(button('이전 주차에서 이월해 시작')!)
    expect(h.createWeeklyReport).toHaveBeenLastCalledWith('p1', '2026-09-21', true, undefined)
    expect(selectFor('구 영역')).not.toBeNull()
    expect(h.router.refresh).toHaveBeenCalledTimes(1)
    choose(selectFor('구 영역')!, 'a-exp')
    await click(button('이 매핑으로 이월')!)
    expect(h.createWeeklyReport).toHaveBeenLastCalledWith('p1', '2026-09-21', true, { 'a-old': 'a-exp' })
    expect(selectFor('구 영역')).toBeNull()
    expect(h.router.refresh).toHaveBeenCalledTimes(2)
  })

  it('다시 대기로 온 영역(그새 비활성 — Q37)은 같은 창에 다시 보이고 고른 값이 지워진다', async () => {
    h.createWeeklyReport.mockResolvedValueOnce(pendingRes([OLD])).mockResolvedValueOnce(pendingRes([OLD]))
    showEmpty()
    await click(button('이전 주차에서 이월해 시작')!)
    choose(selectFor('구 영역')!, 'a-data')
    await click(button('이 매핑으로 이월')!)
    expect(h.createWeeklyReport).toHaveBeenCalledTimes(2)
    expect(selectFor('구 영역')!.value).toBe('')
    expect(button('이 매핑으로 이월')!.disabled).toBe(true)
  })

  it('넘침만 돌아오면(대기 목록이 빔) 앞 라운드의 줄과 고른 값이 남아 옮기지 않음으로 바꿔 다시 보낸다(D31)', async () => {
    h.createWeeklyReport
      .mockResolvedValueOnce(pendingRes([OLD]))
      .mockResolvedValueOnce(pendingRes([], [{ areaId: 'a-exp', areaName: '실험', cell: 'this_content', length: 20001 }]))
      .mockResolvedValueOnce({ ok: true, reportId: 'rep', status: 'created' })
    showEmpty()
    await click(button('이전 주차에서 이월해 시작')!)
    choose(selectFor('구 영역')!, 'a-exp')
    await click(button('이 매핑으로 이월')!)
    expect(selectFor('구 영역')!.value).toBe('a-exp')
    expect(document.querySelector('[data-carry-overflow="a-exp"]')).not.toBeNull()
    choose(selectFor('구 영역')!, 'skip')
    await click(button('이 매핑으로 이월')!)
    expect(h.createWeeklyReport).toHaveBeenLastCalledWith('p1', '2026-09-21', true, { 'a-old': 'skip' })
    expect(selectFor('구 영역')).toBeNull()
  })

  it('그 밖의 실패는 결과의 고정 문구를 토스트로만 — 창을 열지 않는다(D45)', async () => {
    h.createWeeklyReport.mockResolvedValueOnce({ ok: false, code: 'WEEKLY_FORBIDDEN', error: '주간 시트를 만들지 못했습니다.' })
    showEmpty()
    await click(button('기본 시트로 시작')!)
    expect(h.createWeeklyReport).toHaveBeenLastCalledWith('p1', '2026-09-21', false, undefined)
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: '주간 시트를 만들지 못했습니다.', variant: 'error' }))
    expect(document.querySelector('[data-carry-source]')).toBeNull()
  })
})
