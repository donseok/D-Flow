// no-runtime-constants 허용 목록(정본 §6.5.2) — 파일마다 걸린 패턴과 지우는 SP. SP4(양식·주간·팀)·SP5(어휘·달력·이슈 영역)가 항목을 지우고
// SP5 done_when 에서 이 목록이 빈다. 새 파일은 여기 오르지 못한다 — 설정 레지스트리를 읽어야 한다.
export type RuntimeConstantPattern =
  | 'DEFAULT_TEAMS' | 'WEEKLY_SECTIONS' | 'WEEKLY_TEAM_SECTIONS' | 'FALLBACK_SECTION' | 'ISSUE_MEGA_AREAS' | 'LEGACY_EXCEL_PROFILE_V1' | 'LEGACY_LABEL_ABBR'
  | 'ATTENDANCE_TYPES' | 'MEETING_CATEGORIES' | 'ISSUE_SEVERITIES' | 'Asia/Seoul' | '+09:00' | '9 * 3600_000' | 'RESERVED_TEAM_NAMES'

// SP4 A1 이 지운 주간 상수(WEEKLY_SECTIONS·WEEKLY_TEAM_SECTIONS·FALLBACK_SECTION)는 허용 항목 없이 패턴만 남는다 — 재도입을 막는 영구 가드(스펙 §4.8)
export const PATTERNS: Record<RuntimeConstantPattern, RegExp> = {
  DEFAULT_TEAMS: /\bDEFAULT_TEAMS\b/, WEEKLY_SECTIONS: /\bWEEKLY_SECTIONS\b/, WEEKLY_TEAM_SECTIONS: /\bWEEKLY_TEAM_SECTIONS\b/,
  FALLBACK_SECTION: /\bFALLBACK_SECTION\b/,
  ISSUE_MEGA_AREAS: /\bISSUE_MEGA_AREAS\b/, LEGACY_EXCEL_PROFILE_V1: /\bLEGACY_EXCEL_PROFILE_V1\b/, LEGACY_LABEL_ABBR: /\bLEGACY_LABEL_ABBR\b/,
  ATTENDANCE_TYPES: /\bATTENDANCE_TYPES\b/, MEETING_CATEGORIES: /\bMEETING_CATEGORIES\b/, ISSUE_SEVERITIES: /\bISSUE_SEVERITIES\b/,
  'Asia/Seoul': /Asia\/Seoul/, '+09:00': /\+09:00/, '9 * 3600_000': /9 \* 3600_000/,
  // SP4 A2 가 지운 손 베낀 팀 예약어 — 머리 낱말 단일 출처(src/lib/excel/headerWords.ts)에서 파생한다. 허용 항목 없음 = 영구 가드(D38)
  RESERVED_TEAM_NAMES: /\bRESERVED_TEAM_NAMES\b/,
}

/** 파일 → { patterns, removedBy } */
export const ALLOW: Record<string, { patterns: RuntimeConstantPattern[]; removedBy: 'SP4' | 'SP5' | 'SP5b' | 'SP6' }> = {
  // ISSUE_MEGA_AREAS(이슈 영역 — SP5 Phase B 가 project_areas(issue_area) 로)
  'src/components/dashboard/IssueStatusCard.tsx': { patterns: ['ISSUE_MEGA_AREAS'], removedBy: 'SP5' },
  'src/components/issues/IssueAnalysisModal.tsx': { patterns: ['ISSUE_MEGA_AREAS'], removedBy: 'SP5' },
  'src/components/issues/IssueModals.tsx': { patterns: ['ISSUE_MEGA_AREAS', 'ISSUE_SEVERITIES'], removedBy: 'SP5' },
  'src/components/issues/IssuesView.tsx': { patterns: ['ISSUE_MEGA_AREAS', 'ISSUE_SEVERITIES'], removedBy: 'SP5' },
  'src/lib/ai/minute-issue-draft.ts': { patterns: ['ISSUE_MEGA_AREAS'], removedBy: 'SP5' },
  'src/lib/domain/issueAnalysis.ts': { patterns: ['ISSUE_MEGA_AREAS'], removedBy: 'SP5' },
  'src/lib/domain/issueDashboard.ts': { patterns: ['ISSUE_MEGA_AREAS'], removedBy: 'SP5' },
  'src/lib/report/issues/model.ts': { patterns: ['ISSUE_MEGA_AREAS'], removedBy: 'SP5' },
  'src/lib/report/issues/processSlideRenderer.ts': { patterns: ['ISSUE_MEGA_AREAS'], removedBy: 'SP5' },
  'src/lib/report/issues/storedRun.ts': { patterns: ['ISSUE_MEGA_AREAS', 'ISSUE_SEVERITIES'], removedBy: 'SP5' },
  // LEGACY_EXCEL_PROFILE_V1(원본 양식 — SP4 표준 레이아웃으로)
  'src/lib/excel/profile.ts': { patterns: ['LEGACY_EXCEL_PROFILE_V1'], removedBy: 'SP4' },
  // LEGACY_LABEL_ABBR(단계 약어 — SP4)
  'src/components/wbs/shared.tsx': { patterns: ['LEGACY_LABEL_ABBR'], removedBy: 'SP4' },
  // 어휘(근태 유형·회의 범주·이슈 심각도 — SP5 Phase B)
  'src/components/attendance/AttendanceView.tsx': { patterns: ['ATTENDANCE_TYPES'], removedBy: 'SP5' },
  'src/lib/ai/tools/attendance.ts': { patterns: ['ATTENDANCE_TYPES'], removedBy: 'SP5' },
  'src/lib/domain/attendance.ts': { patterns: ['ATTENDANCE_TYPES'], removedBy: 'SP5' },
  'src/app/actions/meetings.ts': { patterns: ['MEETING_CATEGORIES'], removedBy: 'SP5' },
  'src/components/meetings/MeetingFormModal.tsx': { patterns: ['MEETING_CATEGORIES'], removedBy: 'SP5' },
  'src/lib/domain/meetings.ts': { patterns: ['MEETING_CATEGORIES', '+09:00'], removedBy: 'SP5' },
  'src/lib/minutes/externalApi.ts': { patterns: ['MEETING_CATEGORIES'], removedBy: 'SP5' },
  'src/app/actions/issues.ts': { patterns: ['ISSUE_SEVERITIES'], removedBy: 'SP5' },
  'src/lib/domain/issues.ts': { patterns: ['ISSUE_SEVERITIES'], removedBy: 'SP5' },
  // 시간대·고정 오프셋(SP5 Phase A calendar.timezone)
  'src/app/api/chat/v2/stream/route.ts': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/agent-hub/AgentHubView.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/agent-hub/ApprovalQueue.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/agents/SeatmapView.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/chat/AssistantChat.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/chat/BotPageContextProvider.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/settings/ProjectInviteManager.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/usage/UsageEventLog.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/usage/UsageSummary.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/usage/UsageUserTable.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/components/wiki/WikiShared.tsx': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/lib/ai/chat/planner.ts': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/lib/ai/chat/protocol.ts': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/lib/ai/tools/types.ts': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/lib/domain/announcements.ts': { patterns: ['+09:00'], removedBy: 'SP5' },
  'src/lib/domain/dates.ts': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/lib/report/issues/deckPlan.ts': { patterns: ['Asia/Seoul'], removedBy: 'SP5' },
  'src/lib/data/usage.ts': { patterns: ['+09:00'], removedBy: 'SP5' },
  'src/lib/domain/officeChatter.ts': { patterns: ['9 * 3600_000'], removedBy: 'SP5' },
  'src/lib/report/weekly.ts': { patterns: ['9 * 3600_000'], removedBy: 'SP5' },
}
