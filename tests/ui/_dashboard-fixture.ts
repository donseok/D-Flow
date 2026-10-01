// DashboardView 최소 props — 항목 0·공지 1·회의 1·이슈 1(전부 비면 화면 전체 빈 상태라 카드가 안 그려진다). 교차 모듈 표시(P20) 시험용
import type { ComponentProps } from 'react'
import type { DashboardView } from '@/components/dashboard/DashboardView'
import type { Announcement, Meeting } from '@/lib/domain/types'
import type { DashboardIssue } from '@/lib/domain/issueDashboard'

type Props = ComponentProps<typeof DashboardView>
export const DASH_ISSUE: DashboardIssue = {
  id: 'i1', issueNo: 1, piIssueCode: null, megaCode: null, title: '접속 오류', status: 'open', severity: 'high',
  dueDate: '2026-09-20', resolvedAt: null, createdAt: '2026-09-01T00:00:00+00:00',
}
export const DASH_ANN: Announcement = {
  id: 'a1', projectId: 'p1', title: '킥오프 안내', body: '', category: 'general', isPinned: false,
  publishFrom: null, publishTo: null, milestoneDate: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
}
export const DASH_MEETING: Meeting = {
  id: 'm1', projectId: 'p1', title: '주간 회의', meetingDate: '2026-09-28', startTime: null, endTime: null, location: null,
  category: 'routine', body: '', recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null,
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', attendeeIds: [],
}
export function dashboardProps(over: Partial<Props> = {}): Props {
  return {
    items: [], projectId: 'p1', projectName: 'Acme', today: '2026-09-27', snapshots: [], historyFailed: false,
    announcements: [DASH_ANN], meetings: [DASH_MEETING], meetingExceptions: [], issues: [DASH_ISSUE], milestoneKeywords: [],
    modules: { issues: true, announcements: true, meetings: true }, minutesHref: null,
    ...over,
  }
}
