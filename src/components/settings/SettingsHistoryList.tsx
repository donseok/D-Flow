'use client'

import { useState, useTransition } from 'react'
import { listSettingsHistory, type SettingsHistoryResult, type SettingsHistoryScope } from '@/app/actions/settings'
import { stampIn } from '@/lib/domain/calendar'

const SOURCE: Record<string, string> = { edit: '직접 변경', create: '생성', copy: '복사', migration: '마이그레이션', internal: '시스템 변경' }
const formatValue = (value: unknown) => value === null ? '없음' : JSON.stringify(value, null, 2) ?? '없음'
const formatDate = (iso: string, timeZone: string) => Number.isNaN(new Date(iso).getTime()) ? '시각 확인 불가' : stampIn(timeZone, iso)

/** 이력은 읽기 전용이다. 커서(id)로 이전 20건씩 읽고, 원문 값은 접어서 보여준다. */
export function SettingsHistoryList({ scope, initial, timeZone }: {
  scope: SettingsHistoryScope; initial: SettingsHistoryResult
  /** 변경 시각을 찍을 시간대(그 범위의 calendar.timezone) — 서버가 내려준다 */
  timeZone: string
}) {
  const [rows, setRows] = useState(initial.ok ? initial.rows : [])
  const [nextBefore, setNextBefore] = useState(initial.ok ? initial.nextBefore : null)
  const [error, setError] = useState(initial.ok ? null : initial.error)
  const [pending, startTransition] = useTransition()

  function load(before?: number) {
    startTransition(async () => {
      try {
        const result = await listSettingsHistory(scope, before === undefined ? undefined : { before })
        if (!result.ok) { setError(result.error); return }
        setRows(current => before === undefined ? result.rows : [...current, ...result.rows])
        setNextBefore(result.nextBefore); setError(null)
      } catch {
        setError('설정 이력을 불러오지 못했습니다. 다시 시도하세요.')
      }
    })
  }

  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-delayed">{error}</p>}
    {!error && rows.length === 0 && <p className="text-sm text-ink-muted">설정 변경 기록이 없습니다.</p>}
    {rows.length > 0 && <ol className="divide-y divide-line">
      {rows.map(row => <li key={row.id} className="space-y-2 py-4 first:pt-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-sm text-ink">{row.key}</strong>
          <span className="text-xs text-ink-muted">개정 {row.revision} · {formatDate(row.changedAt, timeZone)}</span>
        </div>
        <p className="text-xs text-ink-muted">{row.changedByName} · {SOURCE[row.source] ?? row.source}{row.copiedFrom ? ` · 복사 원본 ${row.copiedFrom}` : ''}</p>
        <details className="rounded-lg bg-surface-2 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-ink">변경 전 → 변경 후</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><span className="text-ink-subtle">변경 전</span><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all text-ink">{formatValue(row.oldValue)}</pre></div>
            <div><span className="text-ink-subtle">변경 후</span><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all text-ink">{formatValue(row.newValue)}</pre></div>
          </div>
        </details>
      </li>)}
    </ol>}
    <div className="flex flex-wrap gap-2">
      {nextBefore !== null && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => load(nextBefore)}>이전 기록 더 보기</button>}
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => load()}>새로고침</button>
    </div>
  </div>
}
