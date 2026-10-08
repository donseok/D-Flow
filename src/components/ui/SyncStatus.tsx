'use client'

import { useSyncExternalStore, useCallback } from 'react'
import { Loader2, AlertCircle, WifiOff, Check, PencilLine } from 'lucide-react'
import { editSessionStore, type SyncSummary } from '@/lib/sync/editSession'

const SERVER_SUMMARY: SyncSummary = {
  connectionState: 'online', editingCount: 0, savingCount: 0, failedCount: 0, conflictCount: 0,
  outcomeUnknownCount: 0, lastSavedAt: null, needsAttentionCount: 0, isFullySynced: true,
}

export function useSyncStatus(): SyncSummary {
  const subscribe = useCallback((onStoreChange: () => void) => {
    return editSessionStore.subscribe(onStoreChange)
  }, [])

  const getSnapshot = useCallback(() => {
    return editSessionStore.getSummary()
  }, [])

  const getServerSnapshot = useCallback(() => {
    return SERVER_SUMMARY
  }, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function formatTime(timestamp: number | null, timeZone: string = 'UTC'): string {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(timestamp))
}

export function SyncStatus({ className = '', timeZone = 'UTC' }: { className?: string; timeZone?: string }) {
  const summary = useSyncStatus()

  // 1. 오프라인 상태
  if (summary.connectionState === 'offline') {
    const timeStr = formatTime(summary.lastSavedAt, timeZone)
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-1.5 text-xs text-neutral-weak ${className}`}
        title="오프라인 상태입니다"
      >
        <WifiOff size={14} className="text-neutral-weak" aria-hidden="true" />
        <span>연결 끊김{timeStr ? ` · 마지막 확인 ${timeStr}` : ''}</span>
      </div>
    )
  }

  // 2. 오류 / 충돌 / 확인 필요 상태
  if (summary.needsAttentionCount > 0) {
    return (
      <div
        role="status"
        aria-live="assertive"
        className={`flex items-center gap-1.5 text-xs font-medium text-warning ${className}`}
        title="저장되지 않았거나 충돌된 변경사항이 있습니다"
      >
        <AlertCircle size={14} className="text-warning shrink-0" aria-hidden="true" />
        <span>확인 필요 {summary.needsAttentionCount}</span>
      </div>
    )
  }

  // 3. 저장 중 상태
  if (summary.savingCount > 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-1.5 text-xs text-fg-secondary ${className}`}
      >
        <Loader2 size={13} className="animate-spin text-neutral-weak" aria-hidden="true" />
        <span>저장 중...</span>
      </div>
    )
  }

  // 4. 저장 전 초안 — 미저장이 남아 있는 동안은 '동기화됨'을 보이지 않는다(§5.8.3)
  if (summary.editingCount > 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-1.5 text-xs text-fg-secondary ${className}`}
        title="아직 저장하지 않은 편집이 있습니다"
      >
        <PencilLine size={13} className="text-neutral-weak" aria-hidden="true" />
        <span>저장 전 변경 {summary.editingCount}</span>
      </div>
    )
  }

  // 5. 동기화 완료 상태
  if (summary.isFullySynced && summary.lastSavedAt) {
    const timeStr = formatTime(summary.lastSavedAt, timeZone)
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-1.5 text-xs text-fg-muted ${className}`}
      >
        <Check size={13} className="text-success" aria-hidden="true" />
        <span>동기화됨{timeStr ? ` · ${timeStr}` : ''}</span>
      </div>
    )
  }

  return null
}
