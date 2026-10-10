import { Activity, CalendarCheck, MousePointerClick, Users } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import { SESSION_GAP_MINUTES, type UsageSummary as Summary } from '@/lib/domain/usage'
import { t} from '@/lib/i18n/dict'
import { KO_LOCALE } from '@/lib/i18n/format'

function fmtDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(KO_LOCALE, {
    timeZone, dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(iso))
}

/**
 * 요약 + 수집 상태.
 * '수집 상태'가 이 화면의 자기진단이다 — 비콘이 조용히 끊겨도 마지막 이벤트 시각이
 * 멈춘 채로 보이므로 "데이터 0"과 "수집 중단"이 구별된다.
 */
export function UsageSummary({ summary, days, sessions, timeZone }: {
  summary: Summary; days: number; sessions: number; timeZone: string;
}) {
  const n = String(days)
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t('usage.summary.today')} value={summary.todayUsers} sub={t('usage.summary.todaySub')} icon={CalendarCheck} tone="brand" />
        <KpiCard label={t('usage.summary.active').replace('{n}', n)} value={summary.activeUsers} sub={t('usage.summary.activeSub').replace('{n}', n)} icon={Users} tone="success" />
        <KpiCard label={t('usage.summary.sessions').replace('{n}', n)} value={sessions.toLocaleString(KO_LOCALE)} sub={t('usage.summary.sessionsSub').replace('{min}', String(SESSION_GAP_MINUTES))} icon={Activity} />
        <KpiCard label={t('usage.summary.views').replace('{n}', n)} value={summary.totalEvents.toLocaleString(KO_LOCALE)} sub={t('usage.summary.viewsSub')} icon={MousePointerClick} />
      </div>
      <p className="text-meta text-fg-muted">
        {summary.lastEventAt
          ? t('usage.summary.lastEvent').replace('{at}', fmtDateTime(summary.lastEventAt, timeZone))
          : t('usage.summary.noEvent')}
      </p>
    </div>
  )
}
