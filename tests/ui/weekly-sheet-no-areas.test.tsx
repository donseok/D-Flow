// @vitest-environment jsdom
// 주간 시트의 영역 안내(스펙 §6.1 — W1·W14 의 배너, D32, Review Focus [RF4]). 영역 0개면 '설정 필요' 안내와 관리자 설정 링크만,
// 영역이 있으면 빈 시트 설명이 영역 이름을 나열한다(옛 구분 이름 0). 같은 화면 안에서는 행을 빼지 않는다(D32).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WeeklyArea, WeeklySheetRow } from '@/lib/domain/weeklySheet'
import { findSentinels, sentinelsFor } from '../fixtures/legacy-sentinels'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Change = (payload: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => void
const h = vi.hoisted(() => ({ onChange: null as Change | null, router: { refresh: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => h.router }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/weekly/usePresence', () => ({ usePresence: () => [] }))
vi.mock('@/components/app/PresenceStrip', () => ({ PresenceStrip: () => null }))
vi.mock('@/app/actions/weekly', () => ({
  createWeeklyReport: vi.fn(), prepareWeeklyCellRewrite: vi.fn(), saveWeeklyCell: vi.fn(async () => ({ ok: true })),
  saveWeeklyCells: vi.fn(), saveWeeklyTitle: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = {
      on: (_event: string, _filter: unknown, cb: Change) => { h.onChange = cb; return channel },
      subscribe: () => channel,
    }
    return { channel: () => channel, removeChannel: vi.fn() }
  },
}))

const { WeeklySheetView } = await import('@/components/weekly/WeeklySheetView')

const area = (id: string, code: string, name: string, sortOrder: number, active = true): WeeklyArea =>
  ({ id, code, name, sortOrder, active, teams: [] })
const EXP = area('a-exp', 'EXP', '실험', 1)
const DATA = area('a-data', 'DATA', '데이터', 2)
const OPS = area('a-ops', 'OPS', '운영', 3)
const OLD = area('a-old', 'OLD', '구 영역', 0, false)
const REPORT = { id: 'rep', title: '' }
const SETTINGS = '/p/p1/settings#project-team'
const row = (id: string, areaId: string, thisContent = ''): WeeklySheetRow =>
  ({ id, reportId: 'rep', areaId, thisContent, thisIssue: '', nextContent: '', nextIssue: '' })
const record = (r: WeeklySheetRow) => ({
  id: r.id, report_id: r.reportId, project_id: 'p1', area_id: r.areaId,
  this_content: r.thisContent, this_issue: r.thisIssue, next_content: r.nextContent, next_issue: r.nextIssue,
})

let container: HTMLDivElement
let root: Root
const text = () => document.body.textContent ?? ''
const buttons = () => [...document.querySelectorAll('button')].map(b => b.textContent?.trim())
const settingsLink = () => document.querySelector(`a[href="${SETTINGS}"]`)
const labels = () => [...container.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td')?.textContent)

/** 같은 root 에 다시 그리면 router.refresh() 뒤 서버가 내려준 새 props 와 같다. */
function show(p: { areas: WeeklyArea[]; report?: { id: string; title: string } | null; rows?: WeeklySheetRow[]; admin?: boolean }) {
  act(() => root.render(
    <WeeklySheetView
      projectId="p1" weekStart="2026-09-21" weekLabel="9월 4주차" weekTitle="9월 4주차"
      prevWeek="2026-09-14" nextWeek="2026-09-28"
      thisRange="9/21~9/25" nextRange="9/28~10/2" projectName="Acme"
      report={p.report ?? null} areas={p.areas} initialRows={p.rows ?? []} hasCarrySource
      me={{ id: 'u1', name: 'alice' }} canEditCells canCreateRound={p.admin ?? true}
    />,
  ))
}
function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  h.onChange = null
  h.router.refresh.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('영역 0개 — 설정 필요 안내(W1)', () => {
  it('관리자: 안내와 설정 링크만 — 기본 시트로 시작·이월 버튼이 없다(비활성 영역만 있어도 0개다)', () => {
    show({ areas: [OLD] })
    expect(text()).toContain('주간보고 영역을 먼저 설정하세요')
    expect(settingsLink()?.textContent).toBe('업무영역 설정으로')
    expect(buttons()).not.toContain('기본 시트로 시작')
    expect(buttons()).not.toContain('이전 주차에서 이월해 시작')
  })

  it('비관리자: 관리자에게 요청하라는 안내, 설정 링크 없음(설정의 팀·업무영역 절은 관리자에게만 보인다)', () => {
    show({ areas: [], admin: false })
    expect(text()).toContain('프로젝트 관리자에게 주간보고 영역 설정을 요청하세요')
    expect(settingsLink()).toBeNull()
  })
})

describe('영역 있음 — 빈 시트 설명과 영역 라벨(W14)', () => {
  it('빈 시트 설명이 활성 영역 이름을 영역 순으로 나열하고 옛 구분 이름은 0건, 시작 버튼 둘', () => {
    show({ areas: [OPS, OLD, EXP, DATA] })
    expect(text()).toContain('업무영역 3개(실험·데이터·운영)')
    expect(findSentinels(text(), sentinelsFor('SP4', []))).toEqual([])
    expect(buttons()).toEqual(expect.arrayContaining(['이전 주차에서 이월해 시작', '기본 시트로 시작']))
    expect(settingsLink()).toBeNull()
  })

  it('개명하면 같은 행(영역 id)이 새 이름으로 보인다', () => {
    show({ areas: [{ ...EXP, name: '실험·검증' }], report: REPORT, rows: [row('r-exp', 'a-exp', '실적')] })
    expect(labels()).toEqual(['실험·검증'])
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="금주실적 내용, 실험·검증"]')!.value).toBe('실적')
  })
})

describe('D32 — 같은 화면 안에서는 행을 빼지 않는다', () => {
  it('비활성 영역 행의 마지막 칸을 비워도 — 입력·실시간 메아리·새로고침 뒤에도 — 그 화면에서 행이 남는다', () => {
    show({ areas: [EXP, OLD], report: REPORT, rows: [row('r-exp', 'a-exp'), row('r-old', 'a-old', '남은 내용')] })
    expect(labels()).toEqual(['실험', '구 영역 (비활성)'])
    typeInto(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="금주실적 내용, 구 영역 (비활성)"]')!, '')
    expect(labels()).toEqual(['실험', '구 영역 (비활성)'])
    act(() => h.onChange!({ eventType: 'UPDATE', new: record(row('r-old', 'a-old')) }))   // 내 저장의 실시간 메아리 — 네 칸 모두 빔
    expect(labels()).toEqual(['실험', '구 영역 (비활성)'])
    show({ areas: [EXP, OLD], report: REPORT, rows: [row('r-exp', 'a-exp')] })          // router.refresh() — 페이지가 visibleRows 로 그 행을 숨겼다
    expect(labels()).toEqual(['실험', '구 영역 (비활성)'])
    expect(h.router.refresh).not.toHaveBeenCalled()
  })
})

describe('[RF4] 문서는 있는데 보일 행이 0개', () => {
  it('관리자: 활성 영역을 저장하면 이번 주 이후 시트에 행이 생긴다는 안내와 설정 링크 — 빈 표를 그리지 않는다', () => {
    show({ areas: [EXP], report: REPORT, rows: [] })
    expect(text()).toContain('활성 영역을 저장하면 이번 주 이후 시트에 행이 생깁니다')
    expect(settingsLink()).not.toBeNull()
    expect(container.querySelector('table')).toBeNull()
  })

  it('비관리자: 같은 안내, 설정 링크 없음', () => {
    show({ areas: [EXP], report: REPORT, rows: [], admin: false })
    expect(text()).toContain('프로젝트 관리자가 업무영역에서 활성 영역을 저장하면 이번 주 이후 시트에 행이 생깁니다')
    expect(settingsLink()).toBeNull()
  })
})

describe('[RF2] 이웃 주 링크', () => {
  it('이전/다음 주 링크는 서버가 준 키 — 클라이언트가 ±7일로 다시 계산하지 않는다', () => {
    act(() => root.render(
      <WeeklySheetView
        projectId="p1" weekStart="2026-10-05" weekLabel="10월 2주차" weekTitle="10월 2주차"
        prevWeek="2026-09-28" nextWeek="2026-10-11"
        thisRange="10/5~10/9" nextRange="10/12~10/16" projectName="Acme"
        report={null} areas={[]} initialRows={[]} hasCarrySource
        me={{ id: 'u1', name: 'alice' }} canEditCells canCreateRound
      />,
    ))
    expect(container.querySelector('a[aria-label="이전 주"]')?.getAttribute('href')).toBe('/p/p1/weekly?week=2026-09-28')
    expect(container.querySelector('a[aria-label="다음 주"]')?.getAttribute('href')).toBe('/p/p1/weekly?week=2026-10-11')
  })
})
