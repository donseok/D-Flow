import type { IssueAreaRef } from '@/lib/domain/issueAreas'
import Link from 'next/link'
import { calendarOf } from '@/lib/domain/calendar'
import type { CalendarInput } from '@/lib/calendar/load'
import { ArrowRight, BarChart3 } from 'lucide-react'
import type { Announcement, ComputedItem, Meeting, MeetingException } from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import { buildTrend } from '@/lib/domain/trend'
import { milestoneTimeline, varianceOrNull, type DashboardThresholds } from '@/lib/domain/dashboard'
import { overallProgress } from '@/lib/domain/rollup'
import type { DashboardIssue } from '@/lib/domain/issueDashboard'
import { announcementMilestones, mergeMilestonePoints } from '@/lib/domain/announcements'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'
import { t} from '@/lib/i18n/dict'
import { activeCodes, teamOrderMap } from '@/lib/domain/teams'
import { projectTeams } from '@/lib/teams/source'
import { ExecSummary } from './ExecSummary'
import { AnnouncementStrip } from './AnnouncementStrip'
import { TrendChart } from './TrendChart'
import { SpiPanel } from './SpiPanel'
import { MilestoneTimeline } from './MilestoneTimeline'
import { MeetingSchedule } from './MeetingSchedule'
import { RiskWorklist } from './RiskWorklist'
import { TeamProgress } from './TeamProgress'
import { IssueStatusCard } from './IssueStatusCard'
import { IssueTrendCard } from './IssueTrendCard'
import { IssueQueueCard } from './IssueQueueCard'
import type { IssueStatusDef, MeetingCategoryDef, SeverityDef } from '@/lib/settings/vocab'

/** 경영진·관리자 대시보드 — 읽기 순서(2026-08-28 재배치): 어디까지 왔나(요약·마일스톤·S-Curve·팀별)
 *  → 앞으로 뭐가 있나(회의) → 이슈가 어떤 상태인가(현황·추이) → 맨 아래 조치 큐(WBS 큐·이슈 큐, 사용자 요청).
 *  모든 집계는 도메인 함수가 담당하고 여기서는 조립만 한다.
 *  WBS 가 비어도 회의·이슈·공지는 그린다 — WBS 카드(요약·S-Curve·팀별·실행 큐)만 빠지고 그 자리에 안내 카드를 둔다.
 *  조회 실패(null·historyFailed)는 빈 데이터로 치지 않는다 — 그 위젯 자리에 사유를 둔다(에러 처리 3원칙 ①). */
export async function DashboardView({
  items,
  projectId,
  projectName,
  projectDescription = null,
  startDate = null,
  endDate = null,
  today,
  realToday,
  calendar,
  snapshots,
  historyFailed,
  announcements,
  meetings,
  meetingExceptions,
  issues,
  issueAreas,
  currentUserId = null,
  canManage = false,
  canGenerateBrief = false,
  milestoneKeywords,
  topLevelLabel = null,
  modules,
  minutesHref,
  meetingCategories,
  issueSeverities,
  issueStatuses,
  thresholds,
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate?: string | null
  endDate?: string | null
  /** 공정율 기준일(base_date 우선 — getComputedWbs 의 today). 서버 컴포넌트가 스스로 '오늘'을 만들지 않는다(SP5 계획 D-22c) */
  today: string
  /** 실제 오늘(그 프로젝트 tz 의 todayIn) — 회의·이슈의 시계 */
  realToday: string
  /** 프로젝트 달력(직렬화 꼴) — 계획 곡선의 근무일·이슈 추이의 주 시작(SP5 A) */
  calendar: CalendarInput
  snapshots: SnapshotPoint[]
  /** 진척 이력(getSnapshots) 조회 실패 — S-Curve 가 이력 0건으로 추세선을 합성하지 않게 한다. */
  historyFailed: boolean
  /** null = 조회 실패 — 공지 스트립 자리에 사유, 타임라인은 공지 마일스톤 없이. */
  announcements: Announcement[] | null
  /** null = 조회 실패 — 회의 일정 자리에 사유. */
  meetings: Meeting[] | null
  meetingExceptions: MeetingException[]
  /** 이슈 현황 카드용 슬라이스(page.tsx 의 getIssuesForDashboard). null = 조회 실패 — 카드 대신 사유를 보인다. */
  issueAreas: readonly IssueAreaRef[]
  issues: DashboardIssue[] | null
  /** 회의 카드에서 작성자 본인/프로젝트 관리자 이상에게 수정·삭제를 열기 위한 식별자. */
  currentUserId?: string | null
  /** 이 프로젝트 관리자 이상(isProjectAdmin) — 회의 상세에서 남의 회의 수정·취소. 기본 false = fail-closed. */
  canManage?: boolean
  /** AI 브리핑(PPT 리포트 ai=1) 생성 권한 = isProjectAdmin(actor, projectId). ensureProjectBriefAction 의
   *  requireProjectAdmin 과 같은 판정. 기본 false = fail-closed. */
  canGenerateBrief?: boolean
  /** 프로젝트 설정(project_settings)의 마일스톤 키워드 — page.tsx 가 getProjectConfig 로 주입. */
  milestoneKeywords: readonly string[]
  /** 1레벨 단계 이름(core.level_labels 첫 값) — 보고서 모달 문구용. 손상이면 null(중립 문구로 그린다) */
  topLevelLabel?: string | null
  /** 교차 모듈 표시(P20) — 꺼진 모듈의 카드는 그리지 않는다(실패 표시로도 남기지 않는다). 판정 실패는 page 가 core 만 = 전부 false */
  modules: { issues: boolean; announcements: boolean; meetings: boolean }
  /** 회의 카드 머리의 '이 프로젝트 회의록'(D53) — 회의록 모듈이 꺼졌거나 슬러그를 모르면 null */
  minutesHref: string | null
  /** 이 프로젝트의 회의 범주·이슈 심각도(설정 어휘) — 키가 손상이면 page 가 위에 사유를 띄우고 빈 목록(라벨 = code) */
  meetingCategories: readonly MeetingCategoryDef[]
  issueSeverities: readonly SeverityDef[]
  /** 이 프로젝트의 이슈 표시 상태(설정 workflow.issue_statuses) — 이슈 현황 카드의 범주 이름·색. 손상·미전달이면 제품 기본 이름 */
  issueStatuses?: readonly IssueStatusDef[]
  /** 이 프로젝트의 판정 기준(설정 dashboard.due_soon_days·dashboard.delayed_red_count) — 미전달이면 제품 기본값(7일·4건) */
  thresholds?: DashboardThresholds
}) {
  const tr = t

  const hasWbs = items.length > 0
  const cal = calendarOf(calendar)
  // 전부 비었을 때만 화면 전체 빈 상태 — 실패한 데이터셋(null)은 '빈 것'이 아니다(그 자리에 오류가 보여야 한다).
  // 꺼진 모듈(P20)은 그리지 않으므로 빈 것으로 본다.
  const emptyOrOff = (on: boolean, rows: readonly unknown[] | null) => !on || (rows !== null && rows.length === 0)
  if (
    !hasWbs && emptyOrOff(modules.issues, issues) && emptyOrOff(modules.announcements, announcements)
    && emptyOrOff(modules.meetings, meetings)
  ) {
    // 빈 화면에서 다음 행동을 고를 수 있게 작업 계획으로 가는 버튼을 둔다 — 추가·가져오기 권한은 그 화면이 가른다(조회 전용은 표만 본다)
    return (
      <EmptyState icon={BarChart3} title={tr('dash.emptyTitle')} description={tr('dash.emptyDesc')}
        action={<Link href={`/p/${projectId}/wbs`} data-dash-empty-wbs className="btn btn-primary">{tr('dash.emptyGoWbs')} <ArrowRight className="h-4 w-4" /></Link>} />
    )
  }

  // 팀(요청 범위 원천 — 페이지의 설정 조회와 같은 요청 캐시)은 WBS 가 있을 때만 읽는다 — 팀별 진척·하위 활동 정렬 키 외에는 쓰지 않는다.
  // 실패는 던진다(대시보드 오류 경계) — 정렬 키 없이 그리면 하위 활동 순서가 조용히 바뀐다
  const teams = hasWbs ? await projectTeams(projectId) : []
  const wbs = hasWbs ? (() => {
    const { actual, planned } = overallProgress(items)
    const trend = buildTrend({
      items, snapshots, calendar: cal, startDate, endDate, today,
      opts: { subActTeamOrder: teamOrderMap(activeCodes(teams)) },
    })
    // 계획이 0 이면 편차는 null — SPI 카드가 SPI 와 같은 '—' 로 보인다(BUG-34)
    return { variance: varianceOrNull(actual, planned), trend }
  })() : null
  // 마일스톤 = WBS 리프 + 마일스톤 일자를 체크한 공지(0091). 공지도 타임라인의 시계(today = base_date 우선)를
  // 쓴다 — 한 카드에서 오늘 선과 D-day 가 두 시계로 갈리지 않게. 경영진 요약의 '다음 마일스톤' 타일은 WBS 만(현행 유지).
  // WBS 가 없으면 공지 마일스톤만, 공지를 못 읽었으면 WBS 마일스톤만(공지 자리에 사유가 뜬다).
  const milestones = mergeMilestonePoints(
    hasWbs ? milestoneTimeline(items, today, milestoneKeywords) : [],
    modules.announcements && announcements ? announcementMilestones(announcements, today) : [],
  )
  // 이중 시계 — WBS 진척은 today(base_date 우선), 회의·이슈는 실제 오늘(realToday — 페이지가 프로젝트 tz 로 내린다, 섹션 D~F 주석).
  // 사유는 사전 문구 — 로더의 ERR_* 상수는 로그용이라 화면에 그대로 싣지 않는다.
  const issuesError = <LoadErrorNotice message={tr('common.loadFailed.issues')} />

  return (
    <div className="space-y-5">
      {/* 게시중 공지 1건 — WBS 없이도 보인다(경영진 요약에서 분리). */}
      {modules.announcements && (announcements === null
        ? <LoadErrorNotice message={tr('common.loadFailed.announcements')} />
        : <AnnouncementStrip projectId={projectId} announcements={announcements} today={today} />)}

      {/* A. 경영진 요약 — 게이지 + 신호등 3 + 리포트. WBS 가 없으면 그 자리에 WBS 화면 안내. */}
      {wbs ? (
        <ExecSummary
          items={items} projectId={projectId} projectName={projectName}
          projectDescription={projectDescription} startDate={startDate} endDate={endDate}
          today={today} canGenerateBrief={canGenerateBrief}
          milestoneKeywords={milestoneKeywords} topLevelLabel={topLevelLabel} thresholds={thresholds}
        />
      ) : (
        <section className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-fg-secondary">{tr('dash.wbsEmpty')}</p>
          <Link href={`/p/${projectId}/wbs`} className="btn btn-ghost h-8 shrink-0 px-3 text-xs">
            {tr('nav.wbs')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      )}

      {/* B. 마일스톤 여정 — 항상(WBS 가 없으면 공지 마일스톤만) */}
      <MilestoneTimeline points={milestones} startDate={startDate} endDate={endDate} today={today} />

      {wbs && (
        <>
          {/* C. 진척현황 — S-Curve + SPI/velocity. lg부터 2열 — xl(1280px) 기준이면 배율 확대
              노트북에서 세로로 쌓여 페이지 스크롤이 길어진다(사용자 요청 2026-07-19). */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TrendChart model={wbs.trend} today={today} historyFailed={historyFailed} />
            <SpiPanel model={wbs.trend} variance={wbs.variance} historyFailed={historyFailed} />
          </div>

          {/* 팀별 진척 — 실행 큐로 내려가기 전에 팀 단위 진행 현황을 한눈에 */}
          <TeamProgress items={items} teams={teams} teamSettingsHref={canManage ? `/p/${projectId}/settings#project-team` : null} />
        </>
      )}

      {/* D. 회의 일정(전폭) — 진척 다음에 '이번 주 무슨 회의가 있나'. 이슈 카드 사이에 끼우면
          맥락이 끊긴다는 사용자 피드백(2026-08-28)으로 이슈 섹션 위로 분리. 실행 큐가 오래 전폭이었듯
          날짜 셀 + 제목 행 목록은 전폭에 어울린다. 회의는 실제 달력이므로 실제 오늘 기준(base_date 금지). */}
      {modules.meetings && (meetings === null ? <LoadErrorNotice message={tr('common.loadFailed.meetings')} /> : (
        <MeetingSchedule projectId={projectId} meetings={meetings} exceptions={meetingExceptions} today={realToday}
          currentUserId={currentUserId} canManage={canManage} minutesHref={minutesHref} categories={meetingCategories} />
      ))}

      {/* E. 이슈 — 좌: 이슈 현황(KPI·상태 분포·Mega별), 우: 등록·해결 추이(차트 + 최근 6주 표).
          추이 카드는 표로 높이를 채워 좌측과 균형을 맞춘다(차트만 두면 아래가 빈다 — 목업 B안에서 확인).
          이슈 0건이면 현황 카드 하나만 빈 상태로 — 빈 카드를 나란히 두지 않는다. 조회 실패면 카드 대신 사유. */}
      {modules.issues && (issues === null ? issuesError : issues.length === 0 ? (
        <IssueStatusCard areas={issueAreas} issues={issues} projectId={projectId} today={realToday} timeZone={cal.timezone} severities={issueSeverities} statuses={issueStatuses} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <IssueStatusCard areas={issueAreas} issues={issues} projectId={projectId} today={realToday} timeZone={cal.timezone} severities={issueSeverities} statuses={issueStatuses} />
          <IssueTrendCard issues={issues} today={realToday} weekStart={cal.weekStart} timeZone={cal.timezone} />
        </div>
      ))}

      {/* F. 조치(맨 아래, 사용자 요청 2026-08-28) — '지금 챙길 것'을 한 줄에: 좌 WBS 실행 큐(지연·임박·뒤처짐), 우 지연·임박 이슈.
          두 카드는 같은 문법(틴트 행 + 딥링크)이라 나란히 두면 한 번의 시선으로 스캔된다.
          시계가 다르다 — WBS 는 today(base_date 우선, 진척 산정과 동일), 이슈는 실제 오늘(달력 기한).
          WBS 가 없으면 이슈 큐가 전체 폭이다. 이슈 조회 실패 사유는 실행 큐 옆 자리를 채울 때만 여기 둔다 —
          WBS 가 없으면 바로 위 이슈 섹션(E)의 사유와 나란히 겹쳐 재시도 버튼·스크린리더 알림이 두 번이 된다. */}
      {(wbs || (modules.issues && issues !== null)) && (
        <div className={wbs && modules.issues ? 'grid gap-5 lg:grid-cols-2' : undefined}>
          {wbs && <RiskWorklist items={items} projectId={projectId} today={today} thresholds={thresholds} />}
          {modules.issues && (issues === null ? issuesError
            : <IssueQueueCard issues={issues} projectId={projectId} today={realToday} severities={issueSeverities} dueSoonDays={thresholds?.dueSoonDays} />)}
        </div>
      )}

    </div>
  )
}
