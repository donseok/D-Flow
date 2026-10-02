import { CalendarClock, CalendarCheck, CalendarRange } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getMyMeetings } from '@/lib/data/meetings'
import { expandMeetings, summarizeMeetings } from '@/lib/domain/meetings'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { adminProjectIds } from '@/lib/domain/authz'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MyMeetingsView } from '@/components/meetings/MyMeetingsView'
import { currentRuleDay, todayIn } from '@/lib/domain/calendar'
import { calendarViewOf, monthGridRange } from '@/lib/domain/attendance'
import { viewCalendar } from '@/lib/calendar/viewZone'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'

export default async function MyMeetingsPage() {
  await requireModulePage(null, 'meetings')   // 전역 경로 — 세션 유일 워크스페이스(스펙 §4.2 2행, P13). 목록의 행 거르기는 로더(getMyMeetings)
  // '오늘'·첫 열·쉬는 날 = 소속 워크스페이스 달력(viewTimezone 과 같은 판정 — 다르거나 없으면 제품 기본값, 계획 D-22b·M3).
  // 아래 Promise.all 의 getActorForView 는 요청 캐시라 같은 값
  const vc = await viewCalendar(await getActorForView())
  if (!vc.ok) return <ConfigLoadError error={vc.error} keyName={vc.key} kind="invalid" locale={await getServerLocale()} />
  const today = todayIn(vc.calendar.timezone, new Date())
  const [ty, tm] = today.split('-').map(Number)
  const [gs, ge] = monthGridRange(ty, tm - 1, currentRuleDay(vc.calendar.weekStart, today))
  const [res, m, user, locale] = await Promise.all([
    getMyMeetings(gs, ge),
    getActorForView(),
    getSession(),
    getServerLocale(),
  ])
  // 회의를 못 읽었으면 달력은 빈 채로 넘기되 뷰가 사유와 재시도를 띄운다(initialFailed) — 화면에서 실패를 알리는 것은 뷰다.
  // 히어로 KPI 자리는 지금 그려지지 않는다(PageHero 는 heroKpis 를 받기만 한다). 넘기는 값은 그 자리가 다시 그려질 때
  // 실패가 0 으로 보이지 않게 '—'(모름)로 맞춰 둔다. 실패 로그는 로더(getMyMeetings)가 남긴다.
  const meetings = res.ok ? res.meetings : []
  const exceptions = res.ok ? res.exceptions : []
  const mineOcc = expandMeetings(meetings.filter(x => x.isMine), exceptions, gs, ge)
  const { today: todayN, upcoming7d, total } = summarizeMeetings(mineOcc, today)
  const kpi = (n: number) => (res.ok ? n : '—')

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="MY MEETINGS"
        badge={<HeroBadge>My Meetings</HeroBadge>}
        title={t(locale, 'meet.myHeroTitle')}
        description={t(locale, 'meet.myHeroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TODAY" value={kpi(todayN)} sub={t(locale, 'meet.kpi.todaySub')} icon={CalendarCheck} tone="brand" />
            <KpiCard variant="hero" label="NEXT 7 DAYS" value={kpi(upcoming7d)} sub={t(locale, 'meet.kpi.upcomingSub')} icon={CalendarClock} tone="warning" />
            <KpiCard variant="hero" label="THIS MONTH" value={kpi(total)} sub={t(locale, 'meet.kpi.totalSub')} icon={CalendarRange} tone="success" />
          </>
        }
      />}
    >
      {/* 항목마다 프로젝트가 다른 전역 목록 — 전역 shim 대신 '내가 관리자인 프로젝트 집합'을 내려
          클라이언트가 열려 있는 회차의 프로젝트로 판정한다(서버 adminOrOwnerGate 와 같은 기준). */}
      <MyMeetingsView initialMeetings={meetings} initialExceptions={exceptions} initialFailed={!res.ok}
        todayIso={today} currentUserId={user?.id ?? null}
        adminProjectIds={adminProjectIds(m)} isSuperuser={m?.isSuperuser ?? false}
        calendar={calendarViewOf(vc.calendar)} />
    </ProjectPageShell>
  )
}
