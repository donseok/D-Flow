import { Activity, CalendarCheck, MousePointerClick, Users } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import { SESSION_GAP_MINUTES, type UsageSummary as Summary } from '@/lib/domain/usage'
import { t, type Locale } from '@/lib/i18n/dict'
import { intlLocale } from '@/lib/i18n/format'

function fmtDateTime(iso: string, timeZone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone, dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(iso))
}

/**
 * 요약 + 수집 상태.
 * '수집 상태'가 이 화면의 자기진단이다 — 비콘이 조용히 끊겨도 마지막 이벤트 시각이
 * 멈춘 채로 보이므로 "데이터 0"과 "수집 중단"이 구별된다.
 */
export function UsageSummary({ summary, days, sessions, timeZone, locale = 'ko' }: {
  summary: Summary; days: number; sessions: number; timeZone: string; locale?: Locale
}) {
  const n = String(days)
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t(locale, 'usage.summary.today')} value={summary.todayUsers} sub={t(locale, 'usage.summary.todaySub')} icon={CalendarCheck} tone="brand" />
        <KpiCard label={t(locale, 'usage.summary.active').replace('{n}', n)} value={summary.activeUsers} sub={t(locale, 'usage.summary.activeSub').replace('{n}', n)} icon={Users} tone="success" />
        <KpiCard label={t(locale, 'usage.summary.sessions').replace('{n}', n)} value={sessions.toLocaleString(intlLocale(locale))} sub={t(locale, 'usage.summary.sessionsSub').replace('{min}', String(SESSION_GAP_MINUTES))} icon={Activity} />
        <KpiCard label={t(locale, 'usage.summary.views').replace('{n}', n)} value={summary.totalEvents.toLocaleString(intlLocale(locale))} sub={t(locale, 'usage.summary.viewsSub')} icon={MousePointerClick} />
      </div>
      <p className="text-meta text-fg-muted">
        {summary.lastEventAt
          ? t(locale, 'usage.summary.lastEvent').replace('{at}', fmtDateTime(summary.lastEventAt, timeZone, locale))
          : t(locale, 'usage.summary.noEvent')}
      </p>
    </div>
  )
}
