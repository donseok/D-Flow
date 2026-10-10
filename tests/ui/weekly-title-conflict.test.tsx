// @vitest-environment jsdom
// 주간 문서 제목 저장의 값 CAS·충돌 비교(SPU1 — 개정 §5.8). 저장은 내가 마지막으로 확인한 서버 제목을 기대값으로 싣고(기본 제목은 ''),
// 다른 사람이 그새 바꿨으면 실패 토스트가 아니라 비교로 간다 — 입력은 그대로 남는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WeeklyArea, WeeklySheetRow } from '@/lib/domain/weeklySheet'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ router: { refresh: vi.fn(), push: vi.fn() }, toast: vi.fn(), title: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => h.router }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock('@/components/weekly/usePresence', () => ({ usePresence: () => [] }))
vi.mock('@/components/app/PresenceStrip', () => ({ PresenceStrip: () => null }))
// 화면 문구는 사전에서 온다 — 진짜 ko 사전으로 풀어 한국어 단언을 그대로 둔다
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t(k as Parameters<typeof t>[0])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ t: ko }) }
})
vi.mock('@/app/actions/weekly', () => ({
  createWeeklyReport: vi.fn(), prepareWeeklyCellRewrite: vi.fn(), saveWeeklyCell: vi.fn(), saveWeeklyCells: vi.fn(), saveWeeklyTitle: h.title,
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = { on: () => channel, subscribe: () => channel }
    return { channel: () => channel, removeChannel: vi.fn() }
  },
}))

const { WeeklySheetView } = await import('@/components/weekly/WeeklySheetView')

const AREAS: WeeklyArea[] = [{ id: 'a-exp', code: 'EXP', name: '실험', sortOrder: 1, active: true, teams: [] }]
const ROW: WeeklySheetRow = { id: 'r1', reportId: 'rep', areaId: 'a-exp', thisContent: '', thisIssue: '', nextContent: '', nextIssue: '' }
const FALLBACK = '▣ 주간업무보고 - Acme(9월 4주차)'

let container: HTMLDivElement
let root: Root
const input = () => container.querySelector<HTMLInputElement>('input[aria-label="시트 제목"]')!
const dialog = () => document.querySelector<HTMLElement>('[data-testid="conflict-resolver"]')
const choose = (action: 'mine' | 'latest' | 'continue') => act(async () => { dialog()!.querySelector<HTMLButtonElement>(`[data-conflict-action="${action}"]`)!.click() })
const values = () => (['mine', 'latest', 'base'] as const).map(w => dialog()!.querySelector(`[data-conflict-value="${w}"]`)?.textContent)
/** 제목을 고쳐 쓰고 포커스를 뺀다(blur 저장) */
const retitle = (value: string) => act(async () => {
  input().focus()
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
  input().dispatchEvent(new Event('input', { bubbles: true }))
  input().blur()
})
const show = (title: string) => act(async () => root.render(
  <WeeklySheetView
    projectId="p1" weekStart="2026-09-21" weekLabel="9월 4주차" weekTitle="9월 4주차" prevWeek="2026-09-14" nextWeek="2026-09-28"
    thisRange="9/21~9/25" nextRange="9/28~10/2" projectName="Acme" report={{ id: 'rep', title }} areas={AREAS}
    initialRows={[ROW]} hasCarrySource={false} me={{ id: 'u1', name: 'alice' }} canEditCells canCreateRound
  />,
))

beforeEach(() => {
  vi.clearAllMocks()
  h.title.mockResolvedValue({ ok: true })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('WeeklySheetView — 제목 저장의 값 CAS', () => {
  it('저장은 내가 본 서버 제목을 기대값으로 싣는다 — 기본 제목을 보고 있었으면 빈 문자열이다', async () => {
    await show('9월 4주 보고')
    await retitle('9월 4주 보고(수정)')
    expect(h.title).toHaveBeenLastCalledWith('p1', 'rep', '9월 4주 보고(수정)', '9월 4주 보고')
    await retitle('한 번 더')
    expect(h.title).toHaveBeenLastCalledWith('p1', 'rep', '한 번 더', '9월 4주 보고(수정)')   // 방금 내가 쓴 값이 다음 기대값
    await act(async () => root.unmount()); root = createRoot(container)
    await show('')
    expect(input().value).toBe(FALLBACK)
    await retitle('새 제목')
    expect(h.title).toHaveBeenLastCalledWith('p1', 'rep', '새 제목', '')
  })

  it('충돌이면 실패 토스트 대신 비교를 띄우고 입력을 남긴다 — 내 값으로 저장은 본 서버 값을 기대값으로 한 번 쓴다', async () => {
    await show('9월 4주 보고')
    h.title.mockResolvedValueOnce({ ok: false, conflict: true, error: 'x', latest: '남이 바꾼 제목' })
    await retitle('내 제목')
    expect(values()).toEqual(['내 제목', '남이 바꾼 제목', '9월 4주 보고'])
    expect(input().value).toBe('내 제목')
    expect(h.toast).not.toHaveBeenCalled()
    await choose('mine')
    expect(h.title).toHaveBeenCalledTimes(2)
    expect(h.title).toHaveBeenLastCalledWith('p1', 'rep', '내 제목', '남이 바꾼 제목')
    expect(dialog()).toBeNull()
    expect(input().value).toBe('내 제목')
  })

  it('서버 값 받기는 쓰지 않고 입력을 서버 제목으로 바꾼다(빈 제목이면 기본 제목). 계속 편집은 쓰지 않고 입력을 남긴다', async () => {
    await show('9월 4주 보고')
    h.title.mockResolvedValue({ ok: false, conflict: true, error: 'x', latest: '' })
    await retitle('내 제목')
    expect(values()).toEqual(['내 제목', FALLBACK, '9월 4주 보고'])
    await choose('continue')
    expect(h.title).toHaveBeenCalledTimes(1)
    expect(input().value).toBe('내 제목')
    await retitle('내 제목 2')
    await choose('latest')
    expect(h.title).toHaveBeenCalledTimes(2)
    expect(input().value).toBe(FALLBACK)
    expect(h.router.refresh).toHaveBeenCalledTimes(1)
  })

  it('일반 실패는 토스트다 — 비교를 띄우지 않고, 같은 값으로 다시 저장할 수 있다', async () => {
    await show('9월 4주 보고')
    h.title.mockResolvedValueOnce({ ok: false, error: '제목을 저장하지 못했습니다.' })
    await retitle('내 제목')
    expect(dialog()).toBeNull()
    expect(h.toast).toHaveBeenCalledTimes(1)
    await retitle('내 제목')
    expect(h.title).toHaveBeenLastCalledWith('p1', 'rep', '내 제목', '9월 4주 보고')
  })
})
