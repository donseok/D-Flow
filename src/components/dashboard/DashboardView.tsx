import Link from 'next/link'
import { calendarOf } from '@/lib/domain/calendar'
import type { CalendarInput } from '@/lib/calendar/load'
import { ArrowRight, BarChart3 } from 'lucide-react'
import type { Announcement, ComputedItem, Meeting, MeetingException } from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import { buildTrend } from '@/lib/domain/trend'
import { milestoneTimeline } from '@/lib/domain/dashboard'
import { round1 } from '@/lib/domain/format'
import { overallProgress } from '@/lib/domain/rollup'
import type { DashboardIssue } from '@/lib/domain/issueDashboard'
import { announcementMilestones, mergeMilestonePoints } from '@/lib/domain/announcements'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { activeCodes, teamOrderMap } from '@/lib/domain/teams'
import { teamsForProjectSync } from '@/lib/teams/master'
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
import { seoulToday } from '@/lib/domain/dates'

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
  today = seoulToday(),
  calendar,
  snapshots,
  historyFailed,
  announcements,
  meetings,
  meetingExceptions,
  issues,
  currentUserId = null,
  canManage = false,
  canGenerateBrief = false,
  milestoneKeywords,
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate?: string | null
  endDate?: string | null
  today?: string
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
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  const hasWbs = items.length > 0
  const cal = calendarOf(calendar)
  // 전부 비었을 때만 화면 전체 빈 상태 — 실패한 데이터셋(null)은 '빈 것'이 아니다(그 자리에 오류가 보여야 한다).
  if (
    !hasWbs && issues !== null && announcements !== null && meetings !== null
    && issues.length === 0 && announcements.length === 0 && meetings.length === 0
  ) {
    return <EmptyState icon={BarChart3} title={tr('dash.emptyTitle')} description={tr('dash.emptyDesc')} />
  }

  // 팀 캐시(service_role)는 WBS 가 있을 때만 읽는다 — 팀별 진척·하위 활동 정렬 키 외에는 쓰지 않는다.
  const teams = hasWbs ? teamsForProjectSync(projectId) : []
  const wbs = hasWbs ? (() => {
    const { actual, planned } = overallProgress(items)
    const trend = buildTrend({
      items, snapshots, calendar: cal, startDate, endDate, today,
      opts: { subActTeamOrder: teamOrderMap(activeCodes(teams)) },
    })
    return { variance: round1(actual - planned), trend }
  })() : null
  // 마일스톤 = WBS 리프 + 마일스톤 일자를 체크한 공지(0091). 공지도 타임라인의 시계(today = base_date 우선)를
  // 쓴다 — 한 카드에서 오늘 선과 D-day 가 두 시계로 갈리지 않게. 경영진 요약의 '다음 마일스톤' 타일은 WBS 만(현행 유지).
  // WBS 가 없으면 공지 마일스톤만, 공지를 못 읽었으면 WBS 마일스톤만(공지 자리에 사유가 뜬다).
  const milestones = mergeMilestonePoints(
    hasWbs ? milestoneTimeline(items, today, milestoneKeywords) : [],
    announcements ? announcementMilestones(announcements, today) : [],
  )
  // 이중 시계 — WBS 진척은 today(base_date 우선), 회의·이슈는 실제 오늘(섹션 D~F 주석).
  const realToday = seoulToday()
  // 사유는 사전 문구 — 로더의 ERR_* 한국어 상수는 로그용이라 영어 화면에 그대로 싣지 않는다.
  const issuesError = <LoadErrorNotice message={tr('common.loadFailed.issues')} />

  return (
    <div className="space-y-5">
      {/* 게시중 공지 1건 — WBS 없이도 보인다(경영진 요약에서 분리). */}
      {announcements === null
        ? <LoadErrorNotice message={tr('common.loadFailed.announcements')} />
        : <AnnouncementStrip projectId={projectId} announcements={announcements} today={today} />}

      {/* A. 경영진 요약 — 게이지 + 신호등 3 + 리포트. WBS 가 없으면 그 자리에 WBS 화면 안내. */}
      {wbs ? (
        <ExecSummary
          items={items} projectId={projectId} projectName={projectName}
          projectDescription={projectDescription} startDate={startDate} endDate={endDate}
          today={today} canGenerateBrief={canGenerateBrief}
          milestoneKeywords={milestoneKeywords}
        />
      ) : (
        <section className="card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-ink-muted">{tr('dash.wbsEmpty')}</p>
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
          <TeamProgress items={items} teams={teams} />
        </>
      )}

      {/* D. 회의 일정(전폭) — 진척 다음에 '이번 주 무슨 회의가 있나'. 이슈 카드 사이에 끼우면
          맥락이 끊긴다는 사용자 피드백(2026-08-28)으로 이슈 섹션 위로 분리. 실행 큐가 오래 전폭이었듯
          날짜 셀 + 제목 행 목록은 전폭에 어울린다. 회의는 실제 달력이므로 실제 오늘 기준(base_date 금지). */}
      {meetings === null ? <LoadErrorNotice message={tr('common.loadFailed.meetings')} /> : (
        <MeetingSchedule projectId={projectId} meetings={meetings} exceptions={meetingExceptions} today={realToday}
          currentUserId={currentUserId} canManage={canManage} />
      )}

      {/* E. 이슈 — 좌: 이슈 현황(KPI·상태 분포·Mega별), 우: 등록·해결 추이(차트 + 최근 6주 표).
          추이 카드는 표로 높이를 채워 좌측과 균형을 맞춘다(차트만 두면 아래가 빈다 — 목업 B안에서 확인).
          이슈 0건이면 현황 카드 하나만 빈 상태로 — 빈 카드를 나란히 두지 않는다. 조회 실패면 카드 대신 사유. */}
      {issues === null ? issuesError : issues.length === 0 ? (
        <IssueStatusCard issues={issues} projectId={projectId} today={realToday} locale={locale} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <IssueStatusCard issues={issues} projectId={projectId} today={realToday} locale={locale} />
          <IssueTrendCard issues={issues} today={realToday} weekStart={cal.weekStart} locale={locale} />
        </div>
      )}

      {/* F. 조치(맨 아래, 사용자 요청 2026-08-28) — '지금 챙길 것'을 한 줄에: 좌 WBS 실행 큐(지연·임박·뒤처짐), 우 지연·임박 이슈.
          두 카드는 같은 문법(틴트 행 + 딥링크)이라 나란히 두면 한 번의 시선으로 스캔된다.
          시계가 다르다 — WBS 는 today(base_date 우선, 진척 산정과 동일), 이슈는 실제 오늘(달력 기한).
          WBS 가 없으면 이슈 큐가 전체 폭이다. 이슈 조회 실패 사유는 실행 큐 옆 자리를 채울 때만 여기 둔다 —
          WBS 가 없으면 바로 위 이슈 섹션(E)의 사유와 나란히 겹쳐 재시도 버튼·스크린리더 알림이 두 번이 된다. */}
      {(wbs || issues !== null) && (
        <div className={wbs ? 'grid gap-5 lg:grid-cols-2' : undefined}>
          {wbs && <RiskWorklist items={items} projectId={projectId} today={today} />}
          {issues === null ? issuesError
            : <IssueQueueCard issues={issues} projectId={projectId} today={realToday} locale={locale} />}
        </div>
      )}

    </div>
  )
}
