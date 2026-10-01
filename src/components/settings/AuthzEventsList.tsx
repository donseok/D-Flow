'use client'

import { useState, useTransition } from 'react'
import { listAuthzEvents, type AuthzEventsResult } from '@/app/actions/authzEvents'
import { seoulStamp } from '@/lib/domain/dates'

const formatDate = (iso: string) => Number.isNaN(new Date(iso).getTime()) ? '시각 확인 불가' : seoulStamp(iso)

/** 권한 변경 이력(읽기 전용) — 커서(id)로 이전 20건씩 읽는다. 쓰기는 권한 RPC 안의 트리거가 한다. */
export function AuthzEventsList({ workspaceId, initial }: { workspaceId: string; initial: AuthzEventsResult }) {
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
        setError('권한 변경 이력을 불러오지 못했습니다. 다시 시도하세요.')
      }
    })
  }

  return <div className="space-y-4" data-authz-events>
    {error && <p role="alert" className="text-sm text-delayed">{error}</p>}
    {!error && rows.length === 0 && <p className="text-sm text-ink-muted">권한 변경 기록이 없습니다.</p>}
    {rows.length > 0 && <ol className="divide-y divide-line">
      {rows.map(row => <li key={row.id} className="space-y-1 py-3 first:pt-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-sm text-ink">{row.targetName}{row.projectName ? ` · ${row.projectName}` : ''}</strong>
          <span className="text-xs text-ink-muted">{formatDate(row.createdAt)}</span>
        </div>
        <p className="text-sm text-ink">{row.kindLabel} · {row.summary}</p>
        <p className="text-xs text-ink-muted">{row.actorName} · {row.causeLabel}</p>
      </li>)}
    </ol>}
    <div className="flex flex-wrap gap-2">
      {nextBefore !== null && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => load(nextBefore)}>이전 기록 더 보기</button>}
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => load()}>새로고침</button>
    </div>
  </div>
}
