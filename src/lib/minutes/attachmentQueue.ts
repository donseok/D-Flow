/** SP5 B3 과제 8: 첨부 패널의 업로드 대기열 — 순수 상태 전이. 화면(MinuteAttachmentsPanel)은 이 함수들로만 상태를 바꾼다.
 *  대기(pending) → 전송(uploading) → 확정(recording) → 끝(대기열에서 빠지고 목록 새로고침) / 실패(failed).
 *  실패만 재시도한다 — 재시도는 새 stamped 경로로 다시 올린다(같은 경로 재사용·upsert 없음, 0021 중복 가드). */
import { attachmentRejection, type AttachmentPolicy, type AttachmentRejection } from './attachmentPolicy'

export type QueueStatus = 'pending' | 'uploading' | 'recording' | 'failed'
export interface QueueItem {
  key: string
  fileName: string
  size: number
  status: QueueStatus
  /** 실패 사유 — 사전 거부는 rejection 코드, 서버·저장소 실패는 문구. */
  rejection?: AttachmentRejection
  error?: string
  /** 사전 거부(정책 위반)는 같은 파일로 재시도해도 같은 결과라 재시도를 열지 않는다. */
  retryable?: boolean
}

/** 이미 확정된 활성 첨부 + 대기열에서 아직 실패하지 않은 항목 — 사전 확인의 '사용 중' 몫. */
export function reservedUsage(
  active: ReadonlyArray<{ size: number | null }>,
  queue: ReadonlyArray<QueueItem>,
): { count: number; bytes: number } {
  const live = queue.filter(q => q.status !== 'failed')
  return {
    count: active.length + live.length,
    bytes: active.reduce((s, f) => s + (f.size ?? 0), 0) + live.reduce((s, q) => s + q.size, 0),
  }
}

/** 새로 고른 파일들을 대기열에 넣는다. 정책 위반은 그 자리에서 실패(재시도 없음)로 넣고, 통과분만 예약 몫에 더한다. */
export function enqueue(
  policy: AttachmentPolicy,
  active: ReadonlyArray<{ size: number | null }>,
  queue: ReadonlyArray<QueueItem>,
  files: ReadonlyArray<{ key: string; name: string; size: number }>,
): QueueItem[] {
  const next = [...queue]
  for (const f of files) {
    const rejection = attachmentRejection(policy, { fileName: f.name, size: f.size }, reservedUsage(active, next))
    next.push(rejection
      ? { key: f.key, fileName: f.name, size: f.size, status: 'failed', rejection, retryable: false }
      : { key: f.key, fileName: f.name, size: f.size, status: 'pending' })
  }
  return next
}

export function setStatus(queue: ReadonlyArray<QueueItem>, key: string, status: QueueStatus, error?: string): QueueItem[] {
  return queue.map(q => q.key !== key ? q : status === 'failed'
    ? { ...q, status, error, rejection: undefined, retryable: true }
    : { key: q.key, fileName: q.fileName, size: q.size, status })
}

/** 재시도 — 실패이면서 재시도 가능한 항목만 대기로 되돌린다. 정책 한도는 다시 본다(그 사이 다른 첨부가 늘었을 수 있다). */
export function retry(
  policy: AttachmentPolicy,
  active: ReadonlyArray<{ size: number | null }>,
  queue: ReadonlyArray<QueueItem>,
  key: string,
): QueueItem[] {
  const item = queue.find(q => q.key === key)
  if (!item || item.status !== 'failed' || !item.retryable) return [...queue]
  const others = queue.filter(q => q.key !== key)
  const rejection = attachmentRejection(policy, { fileName: item.fileName, size: item.size }, reservedUsage(active, others))
  return queue.map(q => q.key !== key ? q : rejection
    ? { ...q, rejection, error: undefined, retryable: false }
    : { key: q.key, fileName: q.fileName, size: q.size, status: 'pending' })
}

/** 대기열에서 뺀다 — 성공·취소(대기)·실패 닫기. 전송·확정 중 항목은 빼지 않는다(객체·행 결과를 모른 채 잃는다). */
export function drop(queue: ReadonlyArray<QueueItem>, key: string, opts: { force?: boolean } = {}): QueueItem[] {
  return queue.filter(q => q.key !== key || (!opts.force && (q.status === 'uploading' || q.status === 'recording')))
}

export function nextPending(queue: ReadonlyArray<QueueItem>): QueueItem | null {
  return queue.some(q => q.status === 'uploading' || q.status === 'recording') ? null : queue.find(q => q.status === 'pending') ?? null
}

/** 사람이 읽는 용량 — 1024 단위, 소수 한 자리(바이트는 정수). */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`
}

const PREVIEW_EXT = new Set(['png', 'jpg', 'gif', 'webp', 'pdf'])
/** 미리보기 버튼을 그릴지 — 확장자만 보는 화면 힌트. 실제 허용은 서버가 정책·객체 MIME 으로 다시 판정한다. */
export function mayPreview(policy: Pick<AttachmentPolicy, 'previewEnabled'> | null, fileName: string): boolean {
  if (!policy?.previewEnabled) return false
  return PREVIEW_EXT.has(/\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase() ?? '')
}
