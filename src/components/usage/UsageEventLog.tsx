'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ScrollText, X } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import { MiniEmpty } from '@/components/dashboard/bits'
import { menuLabel } from '@/lib/domain/usageMenu'
import { usageHref } from '@/lib/domain/usage'
import type { UsageEventRow } from '@/lib/data/usage'
import { t} from '@/lib/i18n/dict'
import { KO_LOCALE } from '@/lib/i18n/format'

function fmtDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(KO_LOCALE, {
    timeZone, dateStyle: 'short', timeStyle: 'medium',
  }).format(new Date(iso))
}

const EVENT_PAGE_SIZE = 20

/**
 * 접속 로그 — 최신순. 상한에 걸리면 그 사실을 화면에 밝힌다(잘린 목록을 전부처럼 보이지 않게).
 * 필터는 searchParams 기반 링크로 유지하고, 긴 목록의 페이지 이동만 클라이언트 상태로 처리한다.
 */
export function UsageEventLog({ base, events, names, limit, menus, filter, timeZone }: {
  /** 필터 링크의 경로 — 범위의 사용 현황 주소(/w/<slug>/usage) */
  base: string
  events: UsageEventRow[]
  names: Map<string, string>
  limit: number
  /** 이 기간에 실제로 기록이 있는 메뉴 키(사용량 순) — 없는 메뉴로 필터를 걸 수 없게 한다. */
  menus: string[]
  filter: { days: number; user?: string; menu?: string }
  /** 시각을 찍을 시간대(IANA) — 서버가 내려준다(기본값 없음) */
  timeZone: string
}) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(events.length / EVENT_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * EVENT_PAGE_SIZE
  const visibleEvents = events.slice(pageStart, pageStart + EVENT_PAGE_SIZE)

  useEffect(() => {
    setPage(current => Math.min(current, pageCount))
  }, [pageCount])

  const translate = t
  const chip = (active: boolean) =>
    `chip ${active ? 'bg-action text-action-fg' : 'text-fg-secondary transition hover:text-fg'}`

  return (
    <SectionCard title={translate('usage.log.title')} icon={ScrollText}
      actions={events.length >= limit
        ? <span className="badge bg-pending-weak text-pending">{translate('usage.log.capped').replace('{n}', String(limit))}</span>
        : <span className="badge bg-action-soft text-action">{translate('usage.log.count').replace('{n}', String(events.length))}</span>}>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Link href={usageHref(base, filter, { menu: undefined })} className={chip(!filter.menu)}>{translate('usage.log.allMenus')}</Link>
        {menus.map(k => (
          <Link key={k} href={usageHref(base, filter, { menu: k })} className={chip(filter.menu === k)}>
            {menuLabel(k, translate)}
          </Link>
        ))}
        {filter.user && (
          <Link href={usageHref(base, filter, { user: undefined })}
            className="chip ml-auto bg-action-soft text-action transition hover:bg-action hover:text-action-fg">
            {names.get(filter.user) ?? translate('usage.unknown')} <X className="ml-1 h-3 w-3" />
          </Link>
        )}
      </div>
      {events.length === 0 ? (
        <MiniEmpty text={filter.user || filter.menu
          ? translate('usage.log.emptyFiltered')
          : translate('usage.log.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-semibold text-fg-muted">
                <th className="py-2 pr-3 text-left">{translate('usage.log.colTime')}</th>
                <th className="py-2 pr-3 text-left">{translate('usage.log.colUser')}</th>
                <th className="py-2 pr-3 text-left">{translate('usage.log.colMenu')}</th>
                <th className="py-2 pr-3 text-left">{translate('usage.log.colPath')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map(e => (
                <tr key={e.id} className="border-b border-border/60">
                  <td className="py-2 pr-3 tabular-nums text-fg-secondary">{fmtDateTime(e.occurredAt, timeZone)}</td>
                  {/* 계정 목록에 없는 id 는 이름을 지어내지 않는다. 이름 클릭 = 그 사용자로 필터. */}
                  <td className="py-2 pr-3 text-fg">
                    <Link href={usageHref(base, filter, { user: e.userId })} className="transition hover:text-action hover:underline">
                      {names.get(e.userId) ?? translate('usage.unknown')}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-fg-secondary">{menuLabel(e.menuKey, translate)}</td>
                  <td className="py-2 pr-3 font-mono text-meta text-fg-muted">{e.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {events.length > EVENT_PAGE_SIZE && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-fg-secondary">
          <span className="tabular-nums">
            {translate('usage.log.range').replace('{from}', String(pageStart + 1)).replace('{to}', String(Math.min(pageStart + EVENT_PAGE_SIZE, events.length))).replace('{total}', String(events.length))}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="btn btn-ghost inline-flex items-center gap-1 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={translate('usage.log.prevAria')}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              {translate('usage.prev')}
            </button>
            <span className="tabular-nums px-1">{currentPage} / {pageCount}</span>
            <button
              type="button"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage === pageCount}
              className="btn btn-ghost inline-flex items-center gap-1 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={translate('usage.log.nextAria')}
            >
              {translate('usage.next')}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
