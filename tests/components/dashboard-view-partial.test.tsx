import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Link from 'next/link'
import { computeTree } from '@/lib/domain/rollup'
import type { Announcement, Meeting, WbsRow } from '@/lib/domain/types'
import type { DashboardIssue } from '@/lib/domain/issueDashboard'
import type { TrendModel } from '@/lib/domain/trend'

// 대시보드 부분 표시 — WBS 가 비어도 회의·이슈·공지는 그리고, 조회 실패한 위젯은 '0건'·'데이터 없음' 대신 사유를 둔다.
// DashboardView 는 async 서버 컴포넌트라 renderToStaticMarkup 을 바로 쓸 수 없다 — 돌려준 요소 트리를 순회해
// 자식 컴포넌트의 타입(함수 참조)을 모은다. 자식은 실행되지 않는다(팀 캐시 호출 여부는 뷰 자신의 것만 잡힌다).
const mocks = vi.hoisted(() => ({ teamsForProjectSync: vi.fn(() => []) }))
vi.mock('@/lib/teams/master', () => ({ teamsForProjectSync: mocks.teamsForProjectSync }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { DashboardView } from '@/components/dashboard/DashboardView'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'
import { AnnouncementStrip } from '@/components/dashboard/AnnouncementStrip'
import { ExecSummary } from '@/components/dashboard/ExecSummary'
import { TrendChart } from '@/components/dashboard/TrendChart'
import { SpiPanel } from '@/components/dashboard/SpiPanel'
import { MilestoneTimeline } from '@/components/dashboard/MilestoneTimeline'
import { MeetingSchedule } from '@/components/dashboard/MeetingSchedule'
import { RiskWorklist } from '@/components/dashboard/RiskWorklist'
import { TeamProgress } from '@/components/dashboard/TeamProgress'
import { IssueStatusCard } from '@/components/dashboard/IssueStatusCard'
import { IssueTrendCard } from '@/components/dashboard/IssueTrendCard'
import { IssueQueueCard } from '@/components/dashboard/IssueQueueCard'
import { ERR_ISSUES_LOAD } from '@/lib/data/issues'
import { ERR_ANNOUNCEMENTS_LOAD } from '@/lib/data/announcements'
import { ERR_MEETINGS_LOAD } from '@/lib/data/meetings'

const typesIn = (node: ReactNode, out = new Set<unknown>()): Set<unknown> => {
  if (Array.isArray(node)) node.forEach(n => typesIn(n, out))
  else if (isValidElement(node)) {
    out.add(node.type)
    typesIn((node as ReactElement<{ children?: ReactNode }>).props.children, out)
  }
  return out
}
/** 타입이 같은 요소들 — props 까지 본다. */
const elsOf = (node: ReactNode, type: unknown, out: ReactElement<Record<string, unknown>>[] = []) => {
  if (Array.isArray(node)) node.forEach(n => elsOf(n, type, out))
  else if (isValidElement(node)) {
    if (node.type === type) out.push(node as ReactElement<Record<string, unknown>>)
    elsOf((node as ReactElement<{ children?: ReactNode }>).props.children, type, out)
  }
  return out
}

const TODAY = '2026-09-27'
const leaf: WbsRow = {
  id: 'w1', parentId: null, code: '1', sortOrder: 1, name: '설계', biz: null, deliverable: null,
  plannedStart: '2026-09-01', plannedEnd: '2026-10-30', weight: null, actualPct: 30, owners: [], isOwnerSplit: false,
}
const ITEMS = computeTree([leaf], TODAY, new Set(), { subActTeamOrder: new Map() })
const ISSUE: DashboardIssue = {
  id: 'i1', issueNo: 1, piIssueCode: null, megaCode: null, title: '접속 오류', status: 'open', severity: 'high',
  dueDate: '2026-09-20', resolvedAt: null, createdAt: '2026-09-01T00:00:00+00:00',
}
const ANN: Announcement = {
  id: 'a1', projectId: 'p1', title: '킥오프 안내', body: '', category: 'general', isPinned: false,
  publishFrom: null, publishTo: null, milestoneDate: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
}
const MEETING: Meeting = {
  id: 'm1', projectId: 'p1', title: '주간 회의', meetingDate: '2026-09-28', startTime: null, endTime: null, location: null,
  category: 'routine', body: '', recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null,
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', attendeeIds: [],
}

type Props = Parameters<typeof DashboardView>[0]
const base: Props = {
  items: ITEMS, projectId: 'p1', projectName: 'Acme', startDate: '2026-09-01', endDate: '2026-12-31', today: TODAY,
  holidays: [], snapshots: [], historyFailed: false, announcements: [ANN], meetings: [MEETING], meetingExceptions: [],
  issues: [ISSUE], milestoneKeywords: [],
}
const view = async (over: Partial<Props> = {}) => (await DashboardView({ ...base, ...over })) as ReactElement

beforeEach(() => vi.clearAllMocks())

describe('DashboardView — WBS 가 비어도 회의·이슈·공지는 그린다', () => {
  it('(a) WBS 0건 + 이슈 1건: 빈 상태 없이 이슈·마일스톤·공지 스트립을 그리고, WBS 카드와 팀 캐시는 건너뛴다', async () => {
    const tree = await view({ items: [], announcements: [], meetings: [] })
    const types = typesIn(tree)
    expect(types.has(EmptyState)).toBe(false)
    for (const t of [IssueStatusCard, MilestoneTimeline, AnnouncementStrip, IssueQueueCard, MeetingSchedule]) expect(types.has(t)).toBe(true)
    for (const t of [ExecSummary, TrendChart, SpiPanel, TeamProgress, RiskWorklist]) expect(types.has(t)).toBe(false)
    expect(mocks.teamsForProjectSync).not.toHaveBeenCalled()
    // WBS 자리에는 WBS 화면으로 가는 인라인 빈 카드
    expect(elsOf(tree, Link).some(l => l.props.href === '/p/p1/wbs')).toBe(true)
  })

  it('(b) 네 데이터셋(WBS·이슈·공지·회의)이 모두 비었을 때만 빈 상태 하나', async () => {
    const empty = await view({ items: [], issues: [], announcements: [], meetings: [] })
    expect(empty.type).toBe(EmptyState)
    for (const over of [{ issues: [ISSUE] }, { announcements: [ANN] }, { meetings: [MEETING] }] as Partial<Props>[]) {
      const tree = await view({ items: [], issues: [], announcements: [], meetings: [], ...over })
      expect(typesIn(tree).has(EmptyState)).toBe(false)
    }
    expect(mocks.teamsForProjectSync).not.toHaveBeenCalled()
  })

  it('(c) 정상 회귀: 기존 카드가 모두 있다', async () => {
    const tree = await view()
    const types = typesIn(tree)
    for (const t of [
      AnnouncementStrip, ExecSummary, MilestoneTimeline, TrendChart, SpiPanel, TeamProgress, MeetingSchedule,
      IssueStatusCard, IssueTrendCard, RiskWorklist, IssueQueueCard,
    ]) expect(types.has(t)).toBe(true)
    expect(types.has(EmptyState)).toBe(false)
    expect(types.has(LoadErrorNotice)).toBe(false)
    expect(mocks.teamsForProjectSync).toHaveBeenCalledWith('p1')
    expect(elsOf(tree, TrendChart)[0].props.historyFailed).toBe(false)
  })
})

describe('DashboardView — 조회 실패는 0건으로 위장하지 않는다', () => {
  it('(d) issues=null → 이슈 카드 셋 대신 LoadErrorNotice(ERR_ISSUES_LOAD) — 이슈 섹션과 실행 큐 옆 두 자리', async () => {
    const tree = await view({ issues: null })
    const types = typesIn(tree)
    for (const t of [IssueStatusCard, IssueTrendCard, IssueQueueCard]) expect(types.has(t)).toBe(false)
    expect(elsOf(tree, LoadErrorNotice).map(n => n.props.message)).toEqual([ERR_ISSUES_LOAD, ERR_ISSUES_LOAD])
    // 조치 행(F)에서는 WBS 실행 큐 옆 자리를 채운다 — 한 줄 스캔 문법 유지
    const direct = (el: ReactElement<Record<string, unknown>>) =>
      new Set([el.props.children].flat(Infinity).filter(isValidElement).map(c => c.type))
    const row = elsOf(tree, 'div').find(d => direct(d).has(RiskWorklist))!
    expect(direct(row).has(LoadErrorNotice)).toBe(true)
  })

  it('(d) issues=null 이면 WBS 가 비어도 빈 상태로 빠지지 않는다 — 사유는 한 번만(재시도 버튼·스크린리더 알림 중복 없음)', async () => {
    const tree = await view({ items: [], issues: null, announcements: [], meetings: [] })
    const types = typesIn(tree)
    expect(types.has(EmptyState)).toBe(false)
    expect(elsOf(tree, LoadErrorNotice).map(n => n.props.message)).toEqual([ERR_ISSUES_LOAD])
  })

  it('공지=null → 공지 스트립 대신 LoadErrorNotice(ERR_ANNOUNCEMENTS_LOAD), 타임라인은 공지 마일스톤 없이 그린다', async () => {
    const withMs = { ...ANN, milestoneDate: '2026-10-15' }
    const ok = await view({ announcements: [withMs] })
    const okPoints = elsOf(ok, MilestoneTimeline)[0].props.points as unknown[]

    const tree = await view({ announcements: null })
    const types = typesIn(tree)
    expect(types.has(AnnouncementStrip)).toBe(false)
    expect(types.has(MilestoneTimeline)).toBe(true)
    expect(elsOf(tree, LoadErrorNotice).map(n => n.props.message)).toEqual([ERR_ANNOUNCEMENTS_LOAD])
    expect((elsOf(tree, MilestoneTimeline)[0].props.points as unknown[]).length).toBe(okPoints.length - 1)
  })

  it('회의=null → 회의 일정 대신 LoadErrorNotice(ERR_MEETINGS_LOAD)', async () => {
    const tree = await view({ meetings: null })
    const types = typesIn(tree)
    expect(types.has(MeetingSchedule)).toBe(false)
    expect(elsOf(tree, LoadErrorNotice).map(n => n.props.message)).toEqual([ERR_MEETINGS_LOAD])
  })

  it('공지·회의 실패도 빈 것으로 치지 않는다 — WBS·이슈가 비어도 빈 상태로 빠지지 않는다', async () => {
    for (const over of [{ announcements: null }, { meetings: null }] as Partial<Props>[]) {
      const tree = await view({ items: [], issues: [], announcements: [], meetings: [], ...over })
      expect(typesIn(tree).has(EmptyState)).toBe(false)
      expect(elsOf(tree, LoadErrorNotice)).toHaveLength(1)
    }
  })

  it('(d) historyFailed=true → TrendChart·SpiPanel 에 historyFailed 가 전달된다', async () => {
    const tree = await view({ historyFailed: true })
    expect(elsOf(tree, TrendChart)[0].props.historyFailed).toBe(true)
    expect(elsOf(tree, SpiPanel)[0].props.historyFailed).toBe(true)
  })
})

describe('TrendChart — 이력 조회 실패', () => {
  const model: TrendModel = {
    empty: false, axisStart: '2026-09-01', axisEnd: '2026-12-31',
    plannedSeries: [{ date: '2026-09-01', pct: 0 }, { date: '2026-12-31', pct: 100 }],
    // 이력 0건일 때 buildTrend 가 합성하는 (축 시작,0)→(오늘,실적) 선
    actualSeries: [{ date: '2026-09-01', pct: 0 }, { date: TODAY, pct: 30 }],
    spiSeries: [], currentSpi: null, velocityWeek: null, hasHistory: false,
  }
  const html = async (historyFailed: boolean) =>
    renderToStaticMarkup((await TrendChart({ model, today: TODAY, historyFailed })) as ReactElement)

  it('실패면 합성된 실적 선을 그리지 않고 사유를 경고로 보인다', async () => {
    const out = await html(true)
    expect(out).not.toContain('stroke-brand')
    expect(out).toContain('role="alert"')
    expect(out).toContain('진척 이력을 불러오지 못해 추세선을 그리지 않았습니다.')
    expect(out).not.toContain('실적 이력은 지금부터 기록됩니다')
  })

  it('정상(이력 0건)은 종전대로 실적 선 + 이력 안내', async () => {
    const out = await html(false)
    expect(out).toContain('stroke-brand')
    expect(out).not.toContain('role="alert"')
    expect(out).toContain('실적 이력은 지금부터 기록됩니다')
  })
})
