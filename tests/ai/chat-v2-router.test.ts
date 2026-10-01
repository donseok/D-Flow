import { describe, expect, it, vi } from 'vitest'
import { routeChatRequest, teamFromTeams, type RouteChatOptions, type RouteTeam } from '@/lib/ai/chat/router'
import type { ChatRequestV2, PageContextV1 } from '@/lib/ai/chat/protocol'
import { FIXTURE_TEAM_CODES } from '../fixtures/teams'

const NOW = new Date('2026-07-19T00:00:00.000Z')
/** 이름 = code 인 팀 목록(개명 전 모양) — 옛 코드 기반 케이스를 그대로 돌린다 */
const asTeams = (codes: readonly string[]): RouteTeam[] => codes.map((code) => ({ code, name: code }))
const teamFromCodes = (message: string, codes: readonly string[]) => teamFromTeams(message, asTeams(codes))
/** 팀 인자 기대값('ERP')을 지키는 픽스처 — 라우터는 등록된 팀 코드로만 팀을 뽑는다. */
const LEGACY_TEAMS: RouteChatOptions = { teamsFor: () => asTeams(FIXTURE_TEAM_CODES) }

function context(domain: PageContextV1['domain'], extra: Partial<PageContextV1> = {}): PageContextV1 {
  return {
    contextVersion: 1,
    pathname: `/p/p1/${domain}`,
    domain,
    projectId: 'p1',
    timezone: 'Asia/Seoul',
    ...extra,
  }
}

function request(message: string, pageContext?: PageContextV1): ChatRequestV2 {
  return { projectId: pageContext?.projectId ?? 'p1', message, history: [], ...(pageContext ? { pageContext } : {}) }
}

describe('chat v2 deterministic router', () => {
  it('lets explicit attendance nouns win over generic status words', () => {
    const route = routeChatRequest(request('근태 현황 알려줘', context('dashboard')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.domains).toEqual(['attendance'])
    expect(route.calls[0].tool).toBe('get_attendance')
  })

  it('routes ERP weekly issues without using the whole question as a search needle', () => {
    const route = routeChatRequest(request('ERP 금주 이슈 정리해줘', context('weekly')), NOW, LEGACY_TEAMS)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({
      tool: 'get_weekly_sheet',
      args: { projectId: 'p1', weekStart: '2026-07-13', team: 'ERP' },
    })
    expect(route.calls[0].args).not.toHaveProperty('query')
  })

  it('resolves relative meeting dates deterministically', () => {
    const route = routeChatRequest(request('내일 회의 알려줘', context('meetings')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({
      tool: 'list_meetings', args: { from: '2026-07-20', to: '2026-07-20' },
    })
  })

  it('lets explicit relative dates override a page month range', () => {
    const monthly = context('meetings', { range: { from: '2026-07-01', to: '2026-07-31' } })
    const today = routeChatRequest(request('오늘 회의 알려줘', monthly), NOW)
    const thisWeek = routeChatRequest(request('이번 주 회의 알려줘', monthly), NOW)
    expect(today.kind).toBe('tools')
    expect(thisWeek.kind).toBe('tools')
    if (today.kind !== 'tools' || thisWeek.kind !== 'tools') return
    expect(today.calls[0].args).toMatchObject({ from: '2026-07-19', to: '2026-07-19' })
    expect(thisWeek.calls[0].args).toMatchObject({ from: '2026-07-13', to: '2026-07-19' })
  })

  it('parses explicit ISO, Korean dates, and this month before page defaults', () => {
    const monthly = context('meetings', { range: { from: '2026-06-01', to: '2026-06-30' } })
    const iso = routeChatRequest(request('2026-08-03 회의', monthly), NOW)
    const korean = routeChatRequest(request('8월 4일 회의', monthly), NOW)
    const month = routeChatRequest(request('이번 달 회의', monthly), NOW)
    expect(iso.kind).toBe('tools')
    expect(korean.kind).toBe('tools')
    expect(month.kind).toBe('tools')
    if (iso.kind !== 'tools' || korean.kind !== 'tools' || month.kind !== 'tools') return
    expect(iso.calls[0].args).toMatchObject({ from: '2026-08-03', to: '2026-08-03' })
    expect(korean.calls[0].args).toMatchObject({ from: '2026-08-04', to: '2026-08-04' })
    expect(month.calls[0].args).toMatchObject({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('parses explicit ranges, named months, and adjacent relative periods', () => {
    const page = context('meetings', { range: { from: '2026-05-01', to: '2026-05-31' } })
    const range = routeChatRequest(request('8월 3일부터 8월 5일까지 회의', page), NOW)
    const namedMonth = routeChatRequest(request('2026년 8월 회의', page), NOW)
    const priorWeek = routeChatRequest(request('지난주 회의', page), NOW)
    const nextWeek = routeChatRequest(request('차주 회의', page), NOW)
    const priorMonth = routeChatRequest(request('전월 회의', page), NOW)
    const nextMonth = routeChatRequest(request('익월 회의', page), NOW)
    const routes = [range, namedMonth, priorWeek, nextWeek, priorMonth, nextMonth]
    expect(routes.every(route => route.kind === 'tools')).toBe(true)
    if (routes.some(route => route.kind !== 'tools')) return
    expect(range.calls[0].args).toMatchObject({ from: '2026-08-03', to: '2026-08-05' })
    expect(namedMonth.calls[0].args).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
    expect(priorWeek.calls[0].args).toMatchObject({ from: '2026-07-06', to: '2026-07-12' })
    expect(nextWeek.calls[0].args).toMatchObject({ from: '2026-07-20', to: '2026-07-26' })
    expect(priorMonth.calls[0].args).toMatchObject({ from: '2026-06-01', to: '2026-06-30' })
    expect(nextMonth.calls[0].args).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('does not pass all filters and only forwards allowed natural WBS statuses', () => {
    const all = routeChatRequest(request('작업 알려줘', context('kanban', {
      filters: { status: 'all', team: 'all' },
    })), NOW)
    const progress = routeChatRequest(request('진행 중 작업', context('wbs')), NOW)
    const notStarted = routeChatRequest(request('미착수 작업', context('wbs')), NOW)
    expect(all.kind).toBe('tools')
    expect(progress.kind).toBe('tools')
    expect(notStarted.kind).toBe('tools')
    if (all.kind !== 'tools' || progress.kind !== 'tools' || notStarted.kind !== 'tools') return
    expect(all.calls[0].args).not.toHaveProperty('status')
    expect(all.calls[0].args).not.toHaveProperty('team')
    expect(progress.calls[0].args).toMatchObject({ status: 'in_progress' })
    expect(notStarted.calls[0].args).toMatchObject({ status: 'not_started' })
  })

  it('does not interpret 미완료 as the done filter', () => {
    const route = routeChatRequest(request('미완료 작업 알려줘', context('wbs')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0].args).not.toHaveProperty('status')
  })

  it('passes explicit WBS schedule ranges with overlap or boundary semantics', () => {
    const overlap = routeChatRequest(request('이번 주 작업 알려줘', context('wbs')), NOW)
    const starts = routeChatRequest(request('이번 주 시작 작업 알려줘', context('wbs')), NOW)
    const ends = routeChatRequest(request('이번 주 완료 예정 작업 알려줘', context('wbs')), NOW)
    const explicit = routeChatRequest(request('2026-06-01 작업 알려줘', context('wbs')), NOW)
    expect(overlap.kind).toBe('tools')
    expect(starts.kind).toBe('tools')
    expect(ends.kind).toBe('tools')
    expect(explicit.kind).toBe('tools')
    if (
      overlap.kind !== 'tools' || starts.kind !== 'tools'
      || ends.kind !== 'tools' || explicit.kind !== 'tools'
    ) return
    expect(overlap.calls[0]).toMatchObject({
      tool: 'find_wbs_items',
      args: { from: '2026-07-13', to: '2026-07-19', dateMode: 'overlap' },
    })
    expect(starts.calls[0].args).toMatchObject({
      from: '2026-07-13', to: '2026-07-19', dateMode: 'starts',
    })
    expect(ends.calls[0].args).toMatchObject({
      from: '2026-07-13', to: '2026-07-19', dateMode: 'ends',
    })
    expect(ends.calls[0].args).not.toHaveProperty('status')
    expect(explicit.calls[0].args).toMatchObject({
      from: '2026-06-01', to: '2026-06-01', dateMode: 'overlap',
    })
  })

  it('uses the selected WBS entity for dependency questions', () => {
    const route = routeChatRequest(request('이 작업의 선행 작업 알려줘', context('wbs', {
      selectedEntity: { type: 'wbs_item', id: 'item-1' },
    })), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_wbs_dependencies', args: { itemId: 'item-1' } })
  })

  it('routes selected WBS audit and attachment questions to metadata-only read tools', () => {
    const page = context('wbs', { selectedEntity: { type: 'wbs_item', id: 'item-1' } })
    const audit = routeChatRequest(request('이 작업 최근 변경 이력', page), NOW)
    const files = routeChatRequest(request('이 작업 첨부파일', page), NOW)
    expect(audit.kind).toBe('tools')
    expect(files.kind).toBe('tools')
    if (audit.kind !== 'tools' || files.kind !== 'tools') return
    expect(audit.calls[0]).toMatchObject({ tool: 'get_wbs_change_log', args: { itemId: 'item-1' } })
    expect(files.calls[0]).toMatchObject({ tool: 'list_wbs_attachments', args: { itemId: 'item-1' } })
  })

  it('uses current KST week for explicit weekly words instead of a stale page week', () => {
    const page = context('weekly', { weekStart: '2026-06-01' })
    const current = routeChatRequest(request('금주 업무 알려줘', page), NOW)
    const prior = routeChatRequest(request('지난주 업무 알려줘', page), NOW)
    const compare = routeChatRequest(request('지난주와 이번 주 주간업무 비교', page), NOW)
    expect(current.kind).toBe('tools')
    expect(prior.kind).toBe('tools')
    expect(compare.kind).toBe('tools')
    if (current.kind !== 'tools' || prior.kind !== 'tools' || compare.kind !== 'tools') return
    expect(current.calls[0].args).toMatchObject({ weekStart: '2026-07-13' })
    expect(prior.calls[0].args).toMatchObject({ weekStart: '2026-07-06' })
    expect(compare.calls[0]).toMatchObject({
      tool: 'compare_weekly_sheets',
      args: { fromWeekStart: '2026-07-06', toWeekStart: '2026-07-13' },
    })
  })

  it('maps explicit weekly dates to their ordered Monday anchors', () => {
    const page = context('weekly', { weekStart: '2026-07-13' })
    const sheet = routeChatRequest(request('2026-06-01 주간업무 알려줘', page), NOW)
    const compare = routeChatRequest(request(
      '2026년 6월 15일과 2026년 6월 1일 주간업무 비교', page,
    ), NOW)
    expect(sheet.kind).toBe('tools')
    expect(compare.kind).toBe('tools')
    if (sheet.kind !== 'tools' || compare.kind !== 'tools') return
    expect(sheet.calls[0]).toMatchObject({
      tool: 'get_weekly_sheet', args: { weekStart: '2026-06-01' },
    })
    expect(compare.calls[0]).toMatchObject({
      tool: 'compare_weekly_sheets',
      args: { fromWeekStart: '2026-06-01', toWeekStart: '2026-06-15' },
    })
  })

  it('lets explicit weekly menu nouns win over the legacy weekly-summary intent', () => {
    const route = routeChatRequest(request('주간업무 정리해줘', context('weekly')), NOW)
    const performance = routeChatRequest(request('금주 실적 알려줘', context('weekly')), NOW)
    expect(route.kind).toBe('tools')
    expect(performance.kind).toBe('tools')
    if (route.kind !== 'tools' || performance.kind !== 'tools') return
    expect(route.calls[0].tool).toBe('get_weekly_sheet')
    expect(performance.domains).toEqual(['weekly'])
  })

  it('never routes a write command to a read tool', () => {
    const route = routeChatRequest(request('이 작업 실적 80으로 올려줘', context('wbs')), NOW)
    expect(route).toMatchObject({ kind: 'command', calls: [] })
  })

  it('asks for a project when a project-scoped tool has no project hint', () => {
    const route = routeChatRequest({
      projectId: null, message: '오늘 연차인 사람', history: [],
      pageContext: { ...context('attendance'), projectId: null, pathname: '/attendance' },
    }, NOW)
    expect(route).toMatchObject({ kind: 'clarify', reason: 'project_required', calls: [] })
  })

  it('restores a related conversation domain and entity on an unknown page', () => {
    const route = routeChatRequest({
      projectId: null,
      message: '그 항목 자세히 알려줘',
      history: [],
      pageContext: { ...context('unknown'), projectId: null, pathname: '/somewhere' },
      conversationState: {
        version: 1,
        lastDomains: ['wbs'],
        lastEntities: [{ type: 'wbs_item', id: 'item-1', ref: 'S1', projectId: 'p1', title: '설계' }],
      },
    }, NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route).toMatchObject({ reason: 'conversation_state' })
    expect(route.calls[0]).toMatchObject({ tool: 'get_wbs_item_detail', args: { projectId: 'p1', itemId: 'item-1' } })
  })

  it('uses all-project my-meetings scope on the global page but scoped detail hints', () => {
    const globalPage = {
      ...context('meetings'), projectId: null, pathname: '/meetings',
      selectedEntity: { type: 'meeting' as const, id: 'm1' },
      selectedProjectId: 'p1',
    }
    const list = routeChatRequest({
      projectId: null, message: '내일 내 회의', history: [], pageContext: globalPage,
      conversationState: {
        version: 1, lastDomains: ['meetings'],
        lastEntities: [{ type: 'meeting', id: 'm1', ref: 'S1', projectId: 'p1', title: '주간회의' }],
      },
    }, NOW)
    const detail = routeChatRequest({ projectId: null, message: '그 회의 상세', history: [], pageContext: globalPage }, NOW)
    expect(list.kind).toBe('tools')
    expect(detail.kind).toBe('tools')
    if (list.kind !== 'tools' || detail.kind !== 'tools') return
    expect(list.calls[0].tool).toBe('list_my_meetings')
    expect(list.calls[0].args).not.toHaveProperty('projectId')
    expect(detail.calls[0]).toMatchObject({ tool: 'get_meeting_detail', args: { projectId: 'p1', meetingId: 'm1' } })
  })

  it('requires a selected meeting before reading attendee or detail-only fields', () => {
    const missing = routeChatRequest(request('ERP 주간회의 참석자 알려줘', context('meetings')), NOW)
    const selected = routeChatRequest(request('ERP 주간회의 참석자 알려줘', context('meetings', {
      selectedEntity: { type: 'meeting', id: 'meeting-1' },
    })), NOW)
    expect(missing).toMatchObject({
      kind: 'clarify', reason: 'meeting_selection_required', calls: [],
    })
    expect(selected.kind).toBe('tools')
    if (selected.kind !== 'tools') return
    expect(selected.calls[0]).toMatchObject({
      tool: 'get_meeting_detail', args: { meetingId: 'meeting-1' },
    })
  })

  it('omits all member filters and maps attendance leave terms precisely', () => {
    const all = routeChatRequest(request('오늘 휴가인 사람', context('attendance', {
      filters: { memberId: 'all' }, range: { from: '2026-07-01', to: '2026-07-31' },
    })), NOW)
    const member = routeChatRequest(request('오늘 반반차', context('attendance', {
      filters: { memberId: 'member-1' },
    })), NOW)
    expect(all.kind).toBe('tools')
    expect(member.kind).toBe('tools')
    if (all.kind !== 'tools' || member.kind !== 'tools') return
    expect(all.calls[0].args).not.toHaveProperty('memberId')
    expect(all.calls[0].args).toMatchObject({
      from: '2026-07-19', to: '2026-07-19', types: ['annual', 'half', 'quarter', 'sick'],
    })
    expect(member.calls[0].args).toMatchObject({ memberId: 'member-1', types: ['quarter'] })
  })

  it.each([
    ['전체 프로젝트 현황 알려줘', context('wbs')],
    ['주간 요약', context('dashboard')],
    ['도와줘', context('projects', { projectId: null, pathname: '/projects' })],
  ])('preserves the legacy bot for unsupported intent/page: %s', (message, page) => {
    const route = routeChatRequest(request(message, page), NOW)
    expect(route.kind).toBe('legacy')
  })

  it('routes 멤버별 업무 to the honest team-level workload tool instead of legacy', () => {
    const route = routeChatRequest(request('멤버별 업무 정리해줘', context('wbs')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_member_workload', args: { projectId: 'p1' } })
  })

  it('falls back before streaming for unsupported meeting-attendance intersections', () => {
    const route = routeChatRequest(request('내일 회의 참석자 중 휴가인 사람이 있나?', context('meetings')), NOW)
    expect(route).toMatchObject({
      kind: 'legacy',
      domains: ['attendance', 'meetings'],
      calls: [],
      reason: 'unsupported_meeting_attendance_intersection',
    })
  })
})

describe('chat v2 router — Phase 2 신규 도메인', () => {
  it('routes 고정 공지 to list_announcements with pinnedOnly', () => {
    const route = routeChatRequest(request('고정 공지 알려줘', context('announcements')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.domains).toEqual(['announcements'])
    expect(route.calls[0]).toMatchObject({
      tool: 'list_announcements', args: { projectId: 'p1', pinnedOnly: true },
    })
  })

  it('routes a quoted announcement search to search_announcements', () => {
    const route = routeChatRequest(request("'배포 일정' 공지 찾아줘", context('announcements')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({
      tool: 'search_announcements', args: { projectId: 'p1', query: '배포 일정' },
    })
  })

  it('routes 완료된 공지 to announcements, not to a WBS status query', () => {
    const route = routeChatRequest(request('완료된 공지 알려줘', context('wbs')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.domains).toEqual(['announcements'])
  })

  it('routes quoted minutes searches globally without a project id on /minutes', () => {
    const page = context('minutes', { projectId: null, pathname: '/minutes' })
    const route = routeChatRequest(
      { projectId: null, message: "'ERP 인터페이스' 회의록 찾아줘", history: [], pageContext: page },
      NOW,
    )
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'search_minutes', args: { query: 'ERP 인터페이스' } })
    expect(route.calls[0].args).not.toHaveProperty('projectId')
  })

  it('routes a selected minute detail question to get_minute_detail', () => {
    const page = context('minutes', {
      projectId: null, pathname: '/minutes',
      selectedEntity: { type: 'minute', id: 'min-1' },
    })
    const route = routeChatRequest(
      { projectId: null, message: '이 회의록 결정사항 정리해줘', history: [], pageContext: page },
      NOW,
    )
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_minute_detail', args: { minuteId: 'min-1' } })
  })

  it('asks for a minute selection when detail words come without a target', () => {
    const page = context('minutes', { projectId: null, pathname: '/minutes' })
    const route = routeChatRequest(
      { projectId: null, message: '그 회의록 상세 내용 알려줘', history: [], pageContext: page },
      NOW,
    )
    expect(route.kind).toBe('clarify')
    if (route.kind !== 'clarify') return
    expect(route.reason).toBe('minute_selection_required')
  })

  it('routes the kanban page view mode into get_kanban_view', () => {
    const route = routeChatRequest(request('카드 현황 알려줘', context('kanban', { view: 'owner' })), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({
      tool: 'get_kanban_view', args: { projectId: 'p1', view: 'owner' },
    })
  })

  it('pairs a delayed-card question with both kanban and wbs evidence', () => {
    const route = routeChatRequest(request('지연된 카드 알려줘', context('kanban')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    const tools = route.calls.map(call => call.tool)
    expect(tools).toContain('get_kanban_view')
    expect(route.calls.find(call => call.tool === 'get_kanban_view')?.args).toMatchObject({ status: 'delayed' })
  })

  it('routes 대시보드 요약 to get_project_dashboard even with an overview-like phrasing', () => {
    const route = routeChatRequest(request('대시보드 현황 요약해줘', context('wbs')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_project_dashboard', args: { projectId: 'p1' } })
  })

  it('routes ERP 팀 멤버 to list_members with the team filter', () => {
    const route = routeChatRequest(request('ERP 팀 구성원 알려줘', context('members')), NOW, LEGACY_TEAMS)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'list_members', args: { projectId: 'p1', team: 'ERP' } })
  })

  it('routes 프로젝트 설정 to get_safe_project_settings', () => {
    const route = routeChatRequest(request('프로젝트 설정이랑 공휴일 알려줘', context('settings')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'get_safe_project_settings', args: { projectId: 'p1' } })
  })

  it('keeps generic questions on a supported page routed by page context', () => {
    const route = routeChatRequest(request('여기 뭐가 있어?', context('announcements')), NOW)
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.domains).toEqual(['announcements'])
  })
})

describe('chat v2 router — Wiki 도메인', () => {
  it('"어떻게 하기로 했지" 류 질문은 정리된 결론이 있는 Wiki로 보낸다', () => {
    const page = context('wiki', { projectId: 'p1', pathname: '/p/p1/wiki' })
    const route = routeChatRequest(
      { projectId: 'p1', message: '연계 방식 어떻게 하기로 했지?', history: [], pageContext: page },
      NOW,
    )
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls[0]).toMatchObject({ tool: 'search_wiki', args: { projectId: 'p1' } })
  })

  it('회의록을 지목한 질문은 결론 표현이 있어도 Wiki가 가로채지 않는다', () => {
    const page = context('minutes', {
      projectId: null, pathname: '/minutes',
      selectedEntity: { type: 'minute', id: 'min-1' },
    })
    const route = routeChatRequest(
      { projectId: null, message: '이 회의록 결정사항 정리해줘', history: [], pageContext: page },
      NOW,
    )
    expect(route.kind).toBe('tools')
    if (route.kind !== 'tools') return
    expect(route.calls.map(call => call.domain)).not.toContain('wiki')
  })
})

describe('chat v2 router — Wiki 도메인 회귀 방지', () => {
  it('프로젝트가 없는 전역 화면에서는 결정 표현만으로 wiki가 붙지 않는다', () => {
    const page = context('minutes', { projectId: null, pathname: '/minutes' })
    const route = routeChatRequest(
      { projectId: null, message: '이번 달 결정 사항 정리해줘', history: [], pageContext: page },
      NOW,
    )
    expect(route.domains).not.toContain('wiki')
    // 예전처럼 회의록 전역 검색으로 답해야 한다 — 프로젝트 선택 요구로 막히면 회귀다.
    expect(route.kind).not.toBe('clarify')
  })
})

describe('chat v2 router — 팀 추출은 등록된 팀 코드로만', () => {
  const withTeams = (codes: string[]) => ({ teamsFor: vi.fn<(projectId: string | null) => readonly RouteTeam[]>(() => asTeams(codes)) })

  it.each([
    [['Research', 'R&D', 'C++'], 'R&D 작업 현황 알려줘', 'R&D'],
    [['Research', 'R&D', 'C++'], 'C++ 작업 현황 알려줘', 'C++'],
    [['Research'], 'research 작업 현황 알려줘', 'Research'], // 대소문자 무시, 저장된 코드로 돌려준다
    [['ERP', 'ERP 운영'], 'ERP 운영 작업 현황 알려줘', 'ERP 운영'], // 최장 일치
  ])('%j 에서 %s → team=%s', (codes, message, team) => {
    const route = routeChatRequest(request(message, context('wbs')), NOW, withTeams(codes))
    if (route.kind !== 'tools') throw new Error(route.kind)
    expect(route.calls[0].args).toMatchObject({ team })
  })

  it.each([
    [['ERP', 'MES'], 'ERP MES 작업 현황 알려줘'], // 서로 다른 둘 — 모호
    [['팀A'], 'ERP 작업 현황 알려줘'], // 미등록 — 도구 실패(TOOL_FAILED) 대신 필터 없음
    [['ops', 'OPS'], 'OPS 작업 현황 알려줘'], // 대소문자만 다른 중복 — 모호
    [[], 'ERP 작업 현황 알려줘'], // 목록이 비면 추출 0
    [['ERP', 'MES'], 'ERP와 MES 작업 현황 알려줘'], // 조사가 붙은 코드도 모호성에는 센다
    [['ERP', 'MES'], 'ERP, MES 작업 알려줘'], // 구두점이 붙은 코드도
    [['ERP', 'ERP 운영'], 'ERP 운영팀 작업 현황 알려줘'], // 'ERP' 만 엄격 일치하지만 더 긴 'ERP 운영' 이 걸쳐 있다
  ])('%j 에서 "%s" 는 팀을 뽑지 않는다', (codes, message) => {
    const route = routeChatRequest(request(message, context('wbs')), NOW, withTeams(codes))
    if (route.kind !== 'tools') throw new Error(route.kind)
    expect(route.calls[0].args).not.toHaveProperty('team')
  })

  // 경계가 공백·끝뿐이면 조사·구두점이 붙은 코드를 못 보고, 남은 하나로 엉뚱한 부분집합을 거른다 — 모호성 판정은 느슨한
  // 경계(왼쪽은 글자·숫자만 아니면, 오른쪽은 영숫자만 아니면)로 한 번 더 센다. 조사 붙은 코드를 팀으로 뽑는 것('가공팀')은
  // SP8(이름·별칭 인식) 몫이다.
  it.each([
    [['ERP', 'MES'], 'ERP와 MES 작업 현황'],
    [['ERP', 'MES'], 'ERP, MES 작업'],
    [['Research', 'R&D'], 'Research와 R&D'],
    [['ERP', 'ERP 운영'], 'ERP 운영팀 현황'],
    [['ERP 운영', 'ERP'], 'ERP 운영팀 현황'], // 입력 순서와 무관
    // 왼쪽에 구두점이 붙은 언급도 센다
    [['ERP', 'MES'], '[MES]와 ERP 작업'],
    [['ERP', 'MES'], '"MES"와 ERP 작업 현황'],
    [['ERP', 'MES'], 'ERP 작업, (MES 포함)'],
    [['ERP', 'MES'], 'ERP 작업 현황/MES'],
  ])('teamFromCodes: %j 에서 "%s" 는 모호하다', (codes, message) => {
    expect(teamFromCodes(message, codes)).toBeUndefined()
  })

  it.each([
    [['ERP', 'MES'], 'ERP 현황', 'ERP'],
    [['ERP', 'ERP 운영'], 'ERP 운영 현황', 'ERP 운영'], // 느슨한 판정도 같은 자리에서 긴 코드를 먼저 잡는다
    [['ERP 운영', 'ERP'], 'ERP 운영 현황', 'ERP 운영'],
    [['ERP', 'ERP 운영'], 'ERP 현황', 'ERP'],
    [['ERP', 'MES'], 'ERP 지연 작업과 ERP의 산출물', 'ERP'], // 같은 코드가 조사와 함께 또 나와도 하나다
    [['R&D'], 'r&d 현황', 'R&D'],
    [['ERP', '가공'], 'ERP 추가공정 작업', 'ERP'], // 낱말 속 '가공'(추가공정)은 언급이 아니다
    [['ERP', 'MES'], 'ERP 작업 MESSAGE', 'ERP'], // 영단어 앞머리 'MES'(MESSAGE)도 언급이 아니다
  ])('teamFromCodes: %j 에서 "%s" → %s', (codes, message, team) => {
    expect(teamFromCodes(message, codes)).toBe(team)
  })

  it('옵션이 없으면 팀을 뽑지 않는다 — 원본 5팀을 기본값으로 되살리지 않는다', () => {
    const route = routeChatRequest(request('ERP 작업 현황 알려줘', context('wbs')), NOW)
    if (route.kind !== 'tools') throw new Error(route.kind)
    expect(route.calls[0].args).not.toHaveProperty('team')
  })

  it('페이지 필터가 메시지보다 우선이다(현행)', () => {
    const route = routeChatRequest(
      request('ERP 작업 현황 알려줘', context('wbs', { filters: { team: 'ZULU' } })), NOW, withTeams(['ERP']),
    )
    if (route.kind !== 'tools') throw new Error(route.kind)
    expect(route.calls[0].args).toMatchObject({ team: 'ZULU' })
  })

  it.each([
    ['weekly', 'Acme 금주 이슈 정리해줘', 'get_weekly_sheet'],
    ['attendance', 'Acme 오늘 연차인 사람', 'get_attendance'],
    ['minutes', 'Acme 회의록 찾아줘', 'search_minutes'],
    ['members', 'Acme 팀 구성원 알려줘', 'list_members'],
    ['members', 'Acme 워크로드 알려줘', 'get_member_workload'],
    ['kanban', 'Acme 칸반 보여줘', 'get_kanban_view'],
  ] as const)('%s 화면 "%s" 도 등록된 팀으로 뽑는다(%s)', (domain, message, tool) => {
    const route = routeChatRequest(request(message, context(domain)), NOW, withTeams(['Acme']))
    if (route.kind !== 'tools') throw new Error(route.kind)
    expect(route.calls.find(call => call.tool === tool)?.args).toMatchObject({ team: 'Acme' })
  })

  it('teamsFor 는 프로젝트 힌트로 부른다 — 프로젝트 화면은 그 pid, 전역 회의록은 null', () => {
    const project = withTeams(['팀A'])
    routeChatRequest(request('팀A 작업 현황 알려줘', context('wbs')), NOW, project)
    expect(project.teamsFor).toHaveBeenCalledTimes(1)
    expect(project.teamsFor).toHaveBeenCalledWith('p1')

    const global = withTeams(['팀A'])
    const route = routeChatRequest({
      projectId: null, message: '팀A 회의록 찾아줘', history: [],
      pageContext: { ...context('minutes'), projectId: null, pathname: '/minutes' },
    }, NOW, global)
    if (route.kind !== 'tools') throw new Error(route.kind)
    expect(global.teamsFor).toHaveBeenCalledTimes(1)
    expect(global.teamsFor).toHaveBeenCalledWith(null)
    expect(route.calls[0]).toMatchObject({ tool: 'search_minutes', args: { team: '팀A' } })
  })

  it('command·legacy·clarify 경로에서는 teamsFor 를 부르지 않는다', () => {
    const opts = withTeams(['ERP'])
    const command = routeChatRequest(request('이 작업 실적 80으로 올려줘', context('wbs')), NOW, opts)
    const legacy = routeChatRequest(
      request('도와줘', context('projects', { projectId: null, pathname: '/projects' })), NOW, opts,
    )
    const clarify = routeChatRequest(request('ERP 주간회의 참석자 알려줘', context('meetings')), NOW, opts)
    expect([command.kind, legacy.kind, clarify.kind]).toEqual(['command', 'legacy', 'clarify'])
    expect(opts.teamsFor).not.toHaveBeenCalled()
  })

  it('팀 목록 조회가 던지면 그대로 전파한다 — 빈 목록으로 삼키지 않는다', () => {
    const opts: RouteChatOptions = { teamsFor: () => { throw new Error('팀 목록을 불러오지 못했습니다.') } }
    expect(() => routeChatRequest(request('ERP 작업 현황 알려줘', context('wbs')), NOW, opts))
      .toThrow('팀 목록을 불러오지 못했습니다.')
  })

  describe('teamFromTeams — code ∪ name(SP4 §4.2.2)', () => {
    const RENAMED: RouteTeam[] = [{ code: 'OPS', name: '운영팀' }, { code: 'RES', name: '연구팀' }]
    it.each([
      ['운영팀 작업 현황 알려줘', 'OPS'],      // W27 — 새 이름으로
      ['OPS 작업 현황 알려줘', 'OPS'],         // W27 — code 로도
      ['ops 작업 현황 알려줘', 'OPS'],         // 대소문자 무시, 정규 code 를 돌려준다
      ['연구팀 진척', 'RES'],
    ])('"%s" → %s', (message, team) => {
      expect(teamFromTeams(message, RENAMED)).toBe(team)
    })
    it.each([
      [[{ code: 'OPS', name: '운영' }, { code: 'RUN', name: 'OPS' }], 'OPS 작업 현황 알려줘'],   // W28 — 한 팀의 code 가 다른 팀의 name
      [[{ code: 'OPS', name: 'OPS' }, { code: 'SUP', name: 'ops' }], 'ops 작업 현황 알려줘'],   // [RF1] 대소문자만 다른 이름
      [[{ code: 'A1', name: '데이터' }, { code: 'B2', name: '데이터' }], '데이터 작업 현황 알려줘'], // 같은 이름 두 팀
      [RENAMED, '운영팀과 연구팀 작업'],                                                       // 서로 다른 둘(조사)
    ])('%j 에서 "%s" 는 모호 — 뽑지 않는다', (teams, message) => {
      expect(teamFromTeams(message, teams)).toBeUndefined()
    })
    it('자기 code 와 같은 이름(개명 전·되돌린 이름)은 한 팀이라 모호가 아니다', () => {
      expect(teamFromTeams('OPS 현황', [{ code: 'OPS', name: 'OPS' }])).toBe('OPS')
    })
    it('라우터는 teamsFor 의 이름으로도 도구 인자를 채운다(W27)', () => {
      const route = routeChatRequest(request('운영팀 작업 현황 알려줘', context('wbs')), NOW, { teamsFor: () => RENAMED })
      if (route.kind !== 'tools') throw new Error(route.kind)
      expect(route.calls[0].args).toMatchObject({ team: 'OPS' })
    })
  })
})
