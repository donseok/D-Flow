'use client'

import { useState, useTransition } from 'react'
import { listAuthzEvents, type AuthzEventsResult } from '@/app/actions/authzEvents'
import { stampIn } from '@/lib/domain/calendar'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'

type T = (k: DictKey) => string

const formatDate = (iso: string, timeZone: string, t: T) => Number.isNaN(new Date(iso).getTime()) ? t('settings.log.badTime') : stampIn(timeZone, iso)

/** 권한 변경 이력(읽기 전용) — 커서(id)로 이전 20건씩 읽는다. 쓰기는 권한 RPC 안의 트리거가 한다. */
export function AuthzEventsList({ workspaceId, initial, timeZone }: {
  workspaceId: string; initial: AuthzEventsResult
  /** 변경 시각을 찍을 시간대(워크스페이스 calendar.timezone) — 서버가 내려준다 */
  timeZone: string
}) {
  const { t } = useLocale()
  const [rows, setRows] = useState(initial.ok ? initial.rows : [])
  const [nextBefore, setNextBefore] = useState(initial.ok ? initial.nextBefore : null)
  const [error, setError] = useState(initial.ok ? null : initial.error)
  const [pending, startTransition] = useTransition()

  function load(before?: number) {
    startTransition(async () => {
      try {
        const result = await listAuthzEvents(workspaceId, before === undefined ? undefined : { before })
        if (!result.ok) { setError(result.error); return }
        setRows(current => before === undefined ? result.rows : [...current, ...result.rows])
        setNextBefore(result.nextBefore); setError(null)
      } catch {
        setError(t('settings.authzLog.loadFailed'))
      }
    })
  }

  return <div className="space-y-4" data-authz-events>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!error && rows.length === 0 && <p className="text-sm text-fg-secondary">{t('settings.authzLog.empty')}</p>}
    {rows.length > 0 && <ol className="divide-y divide-border">
      {rows.map(row => <li key={row.id} className="space-y-1 py-3 first:pt-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-sm text-fg">{row.targetName}{row.projectName ? ` · ${row.projectName}` : ''}</strong>
          <span className="text-xs text-fg-secondary">{formatDate(row.createdAt, timeZone, t)}</span>
        </div>
        <p className="text-sm text-fg">{row.kindLabel} · {row.summary}</p>
        <p className="text-xs text-fg-secondary">{row.actorName} · {row.causeLabel}</p>
      </li>)}
    </ol>}
    <div className="flex flex-wrap gap-2">
      {nextBefore !== null && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => load(nextBefore)}>{t('settings.log.more')}</button>}
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => load()}>{t('settings.log.refresh')}</button>
    </div>
  </div>
}
