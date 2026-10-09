'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import type { UsageUserRow } from '@/lib/domain/usage'
import { WORKSPACE_ROLE_LABEL_KEY } from '@/lib/domain/authz'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { Locale } from '@/lib/i18n/dict'
import { intlLocale } from '@/lib/i18n/format'

function fmtDate(iso: string | null, timeZone: string, locale: Locale): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone, dateStyle: 'medium' }).format(new Date(iso))
}

const USER_PAGE_SIZE = 15

/**
 * 사용자 현황 — 계정 기준이라 활동이 0인 휴면 계정도 표시된다.
 * last_sign_in_at 은 수집 시작 이전까지 소급되므로 배포 첫날부터 채워진다.
 */
export function UsageUserTable({ rows, days, timeZone }: { rows: UsageUserRow[]; days: number; timeZone: string }) {
  const { t, locale } = useLocale()
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(rows.length / USER_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * USER_PAGE_SIZE
  const visibleRows = rows.slice(pageStart, pageStart + USER_PAGE_SIZE)

  useEffect(() => {
    setPage(current => Math.min(current, pageCount))
  }, [pageCount])

  return (
    <SectionCard title={t('usage.users.title')} icon={Users}
      actions={<span className="badge bg-action-soft text-action">{t('usage.users.count').replace('{n}', String(rows.length))}</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-semibold text-fg-muted">
              <th className="py-2 pr-3 text-left">{t('usage.users.colName')}</th>
              <th className="py-2 pr-3 text-left">{t('usage.users.colEmail')}</th>
              <th className="py-2 pr-3 text-left">{t('usage.users.colTeam')}</th>
              <th className="py-2 pr-3 text-left">{t('usage.users.colRole')}</th>
              <th className="py-2 pr-3 text-left">{t('usage.users.colJoined')}</th>
              <th className="py-2 pr-3 text-left">{t('usage.users.colLastSignIn')}</th>
              <th className="py-2 pr-3 text-left">{t('usage.users.colLastActivity')}</th>
              <th className="py-2 pr-3 text-right">{t('usage.users.colViews').replace('{n}', String(days))}</th>
              <th className="py-2 pr-3 text-right">{t('usage.users.colVisitDays')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(r => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="py-2 pr-3 font-medium text-fg">{r.name}</td>
                <td className="py-2 pr-3 text-fg-secondary">{r.email}</td>
                <td className="py-2 pr-3 text-fg-secondary">{r.teamLabel ?? r.teamCode ?? '—'}</td>
                <td className="py-2 pr-3 text-fg-secondary">{r.role ? t(WORKSPACE_ROLE_LABEL_KEY[r.role]) : '—'}</td>
                <td className="py-2 pr-3 tabular-nums text-fg-secondary">{fmtDate(r.createdAt, timeZone, locale)}</td>
                <td className="py-2 pr-3 tabular-nums text-fg-secondary">{fmtDate(r.lastSignInAt, timeZone, locale)}</td>
                <td className="py-2 pr-3 tabular-nums text-fg-secondary">{fmtDate(r.lastActivityAt, timeZone, locale)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg">{r.events.toLocaleString(intlLocale(locale))}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-fg">{r.activeDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > USER_PAGE_SIZE && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-fg-secondary">
          <span className="tabular-nums">
            {t('usage.users.range').replace('{from}', String(pageStart + 1)).replace('{to}', String(Math.min(pageStart + USER_PAGE_SIZE, rows.length))).replace('{total}', String(rows.length))}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="btn btn-ghost inline-flex items-center gap-1 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('usage.users.prevAria')}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              {t('usage.prev')}
            </button>
            <span className="tabular-nums px-1">{currentPage} / {pageCount}</span>
            <button
              type="button"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage === pageCount}
              className="btn btn-ghost inline-flex items-center gap-1 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('usage.users.nextAria')}
            >
              {t('usage.next')}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
