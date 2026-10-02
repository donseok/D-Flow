// ============================================================================
// AI 브리핑 공용 데이터 로더(C3) — 주간 브리핑과 위험 AI 해설이 같은 소스를
// 각자 로드하지 않도록 대시보드 page.tsx 와 동일한 데이터 계층 호출을 1곳으로 모은다.
// 서버 액션 전용: 클라이언트 입력을 믿지 않고 항상 서버에서 재로드/재계산하는 진입점.
// getComputedWbs 는 부분 구조분해로만 소비한다(dependencies 등 확장 필드 비결합).
// 실패는 여기서 삼키지 않는다 — 호출측(액션)이 잡아 로깅 + 'unavailable' 강등한다.
// ============================================================================
import type { WorkCalendar } from '@/lib/domain/calendar'
import { getComputedWbs } from '@/lib/data/wbs'
import { getSnapshots } from '@/lib/data/snapshots'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getProjectMinuteSignals } from '@/lib/data/minutes'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { createServerClient } from '@/lib/supabase/server'
import { projectTeams } from '@/lib/teams/source'
import { activeCodes } from '@/lib/domain/teams'
import type { ComputedItem, Meeting, MeetingException, MinuteSignal, TeamCode } from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import { seoulToday } from '@/lib/domain/dates'

/** 위험 신호 탐지(회의 액션 경과)용 회의록 인사이트 창 — PPT 브리핑 팩트 전용 값(대시보드는 2026-08-28 이후 인사이트를 읽지 않는다). */
export const MINUTE_SIGNAL_FETCH = 30

export interface ProjectFactsSource {
  projectId: string
  projectName: string
  startDate: string | null
  endDate: string | null
  items: ComputedItem[]
  /** 그 프로젝트 달력(SP5) — 추세의 근무일 판정 */
  calendar: WorkCalendar
  /** getComputedWbs 의 '오늘'(projects.base_date 우선) — 진척·리스크 판정 기준일. */
  todayWbs: string
  /** 실제 오늘(Asia/Seoul) — 회의·회의록 경과일 기준(이중 시계 계약). */
  realToday: string
  snapshots: SnapshotPoint[]
  minuteSignals: MinuteSignal[]
  meetings: Meeting[]
  meetingExceptions: MeetingException[]
  /** 프로젝트 설정의 마일스톤 키워드(core.milestone_keywords). */
  milestoneKeywords: string[]
  /** 그 프로젝트의 활성 팀 코드(전용 팀, 없으면 그 워크스페이스의 공용 팀). */
  teams: TeamCode[]
}

/** 대시보드와 동일 소스 1회 병렬 로드. 프로젝트 행이 없으면(비멤버 RLS 포함) null. */
export async function loadProjectFacts(projectId: string): Promise<ProjectFactsSource | null> {
  const sb = await createServerClient()
  const [{ items, calendar, today }, snapRes, meetRes, minuteSignals, project, config] = await Promise.all([
    getComputedWbs(projectId),
    getSnapshots(projectId),
    getProjectMeetingData(projectId),
    getProjectMinuteSignals(projectId, MINUTE_SIGNAL_FETCH),
    sb.from('projects').select('name, start_date, end_date').eq('id', projectId).maybeSingle(),
    // 설정 행이 안 보이는 것(비멤버 RLS 0행)은 해석기에서 오류다 — 아래 '프로젝트 없음 → null' 판정을 먼저 하도록 결과로 받는다.
    getProjectConfig(projectId, { client: sb }).then((cfg) => ({ ok: true as const, cfg }), (e: unknown) => ({ ok: false as const, e })),
  ])
  if (project.error) throw new Error(`[projectFacts] 프로젝트 조회 실패: ${project.error.message}`)
  if (!project.data) return null
  if (!config.ok) throw config.e
  // 진척 이력·회의 실패를 '0건'으로 브리핑하지 않는다 — 호출측이 'unavailable' 로 강등한다.
  if (!snapRes.ok) throw new Error('[projectFacts] ' + snapRes.error)
  if (!meetRes.ok) throw new Error('[projectFacts] ' + meetRes.error)
  // 팀은 프로젝트 행을 RLS 로 확인한 뒤에 같은 세션으로 읽는다. 원천 실패는 throw — 호출측이 'unavailable' 로 강등한다.
  const teams = activeCodes(await projectTeams(projectId, { client: sb }))
  return {
    projectId,
    projectName: (project.data.name as string) ?? '',
    startDate: (project.data.start_date as string | null) ?? null,
    endDate: (project.data.end_date as string | null) ?? null,
    items,
    calendar,
    todayWbs: today,
    realToday: seoulToday(),
    snapshots: snapRes.rows,
    minuteSignals,
    meetings: meetRes.meetings,
    meetingExceptions: meetRes.exceptions,
    milestoneKeywords: valueOf(config.cfg, 'core.milestone_keywords'),
    teams,
  }
}
