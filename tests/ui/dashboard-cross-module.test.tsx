// 개요 카드의 교차 모듈 표시(P20)와 '이 프로젝트 회의록'(D53). DashboardView 는 async 서버 컴포넌트라 돌려준 요소 트리를 순회한다
// (자식 서버 컴포넌트는 실행되지 않는다 — 회의 카드 머리 링크는 MeetingSchedule 을 따로 렌더해 본다)
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/teams/source', () => ({ projectTeams: vi.fn(async () => []) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getMeetingRowExtras: vi.fn(async () => ({ bodies: {}, memberNames: {} })) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { DashboardView } from '@/components/dashboard/DashboardView'
import { AnnouncementStrip } from '@/components/dashboard/AnnouncementStrip'
import { MeetingSchedule } from '@/components/dashboard/MeetingSchedule'
import { IssueStatusCard } from '@/components/dashboard/IssueStatusCard'
import { IssueTrendCard } from '@/components/dashboard/IssueTrendCard'
import { IssueQueueCard } from '@/components/dashboard/IssueQueueCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'
import { dashboardProps, DASH_MEETING } from './_dashboard-fixture'
import { MEET_CATS } from '../fixtures/vocab'

const els = (node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []) => {
  if (Array.isArray(node)) node.forEach((n) => els(n, out))
  else if (isValidElement(node)) {
    out.push(node as ReactElement<Record<string, unknown>>)
    els((node as ReactElement<{ children?: ReactNode }>).props.children, out)
  }
  return out
}
const view = async (over: Parameters<typeof dashboardProps>[0] = {}) => els((await DashboardView(dashboardProps(over))) as ReactElement)
const has = (tree: ReactElement[], type: unknown) => tree.some((e) => e.type === type)
const all = { issues: true, announcements: true, meetings: true }

beforeEach(() => vi.clearAllMocks())

describe('개요 카드의 교차 모듈 표시(P20)', () => {
  it('모듈이 켜져 있으면 이슈·공지·회의 카드가 있고, 회의 카드에 회의록 링크를 넘긴다', async () => {
    const tree = await view({ modules: all, minutesHref: '/w/acme/minutes?project=p1' })
    for (const t of [AnnouncementStrip, MeetingSchedule, IssueStatusCard, IssueTrendCard, IssueQueueCard]) expect(has(tree, t)).toBe(true)
    expect(tree.find((e) => e.type === MeetingSchedule)?.props.minutesHref).toBe('/w/acme/minutes?project=p1')
  })
  it('끄면 그 카드만 사라진다 — 실패 표시(LoadErrorNotice)로도 남지 않는다', async () => {
    const off = await view({ issues: null, modules: { ...all, issues: false } })
    for (const t of [IssueStatusCard, IssueTrendCard, IssueQueueCard, LoadErrorNotice]) expect(has(off, t)).toBe(false)
    expect(has(off, MeetingSchedule)).toBe(true); expect(has(off, AnnouncementStrip)).toBe(true)
    const noAnn = await view({ announcements: null, modules: { ...all, announcements: false } })
    expect(has(noAnn, AnnouncementStrip)).toBe(false); expect(has(noAnn, LoadErrorNotice)).toBe(false)
    const noMeet = await view({ meetings: null, modules: { ...all, meetings: false } })
    expect(has(noMeet, MeetingSchedule)).toBe(false); expect(has(noMeet, LoadErrorNotice)).toBe(false)
  })
  it('켜진 모듈의 조회 실패는 그대로 사유를 보인다(꺼짐과 구분)', async () => {
    expect(has(await view({ issues: null }), LoadErrorNotice)).toBe(true)
  })
  it("'비어 있음' 판정은 꺼진 모듈을 빈 것으로 본다 — 켜진 것만 비었으면 화면 전체 빈 상태", async () => {
    const tree = (await DashboardView(dashboardProps({ meetings: [], announcements: [], issues: null, modules: { ...all, issues: false } }))) as ReactElement
    expect(tree.type).toBe(EmptyState)
  })
})

describe("회의 카드 머리 — '이 프로젝트 회의록'(D53)", () => {
  const card = async (minutesHref: string | null) => renderToStaticMarkup((await MeetingSchedule({ categories: MEET_CATS,
    projectId: 'p1', meetings: [DASH_MEETING], exceptions: [], today: '2026-09-27', minutesHref,
  })) as ReactElement)
  it('링크가 있으면 머리 오른쪽에 그 링크, 없으면 그리지 않는다', async () => {
    const on = await card('/w/acme/minutes?project=p1')
    expect(on).toContain('href="/w/acme/minutes?project=p1"'); expect(on).toContain('이 프로젝트 회의록')
    expect(await card(null)).not.toContain('이 프로젝트 회의록')
  })
})
