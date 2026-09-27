'use client'
// 승인 대기 큐 — 완료 보고(reported)가 올라온 주문을 카드로. 승인은 관리자 또는 서브트리 관리자
// (대상 리프의 strict 조상 중 담당자가 나, HubQueueEntry.canManage — 트랙 B, 2026-09-15). 단 비관리자는
// 자기 담당·자기 착수 항목의 완료를 승인하지 못한다(HubQueueEntry.canApprove — 제7부 AUTH-07a).
// 처리는 runHubProcessOp 1건으로 끝나고 응답의 허브로 화면을 바꾼다(§10·§11) — 재조회 요청 없음.
// 승인·반려는 카드가 보여 준 보고 id 를 싣는다 — 그 사이 재보고됐으면 서버가 stale 로 거부하고, 카드는 허브를
// 다시 읽어 새 보고를 보여 준다(H1 Task 11).
import { useState } from 'react'
import type { AgentHub, HubQueueEntry } from '@/lib/domain/agentHub'
import { runHubProcessOp, type HubProcessOp } from '@/app/actions/agentHub'
import { useLocale } from '@/components/providers/LocaleProvider'
import { NOTE_PLACEHOLDER, OP_LABEL, OP_TITLE } from './labels'

type Props = {
  queue: HubQueueEntry[]
  projectId: string
  isAdmin: boolean
  /** 처리 응답의 허브로 화면 교체. */
  onHub: (hub: AgentHub) => void
  /** 처리는 됐는데 재조회만 실패했을 때의 재시도(refreshAgentHub 1회). */
  onChanged: () => Promise<void> | void
}

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })

function QueueCard({ q, projectId, isAdmin, onHub, onChanged }: { q: HubQueueEntry } & Omit<Props, 'queue'>) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  const run = async (op: HubProcessOp) => {
    setBusy(true); setErr(null); setWarn(null)
    try {
      const r = await runHubProcessOp(projectId, op)
      if (!r.ok) {
        setErr(r.error)
        if (r.stale) await onChanged() // 새 보고를 보여 준다 — 쓰던 반려 사유는 그대로 둔다.
        return
      }
      if (r.warning) setWarn(r.warning)
      setRejecting(false); setNote('')
      if (r.hub) onHub(r.hub)
      else { setErr(r.hubError ?? '현황 재조회에 실패했습니다.'); await onChanged() }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <li data-queue-card={q.orderId} className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[11px] text-ink-muted">{q.code}</span>
          <span className="ml-2 text-sm font-semibold text-ink">{q.name}</span>
        </div>
        <span className="text-[11px] text-ink-subtle">{q.agent} · {when(q.reportedAt)} · {q.percent}%</span>
      </div>
      {q.summary && <p className="mt-1 whitespace-pre-wrap text-xs text-ink">{q.summary}</p>}
      {q.links.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2 text-[11px]">
          {q.links.map((l, i) => <li key={i}><a href={l.url} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">{l.label ?? l.url}</a></li>)}
        </ul>
      )}
      {(isAdmin || q.assigneeMine || q.canManage) ? (
        // 승인은 canApprove(관리자, 또는 자기 담당·자기 착수가 아닌 서브트리 관리자), 반려는 +담당자 본인도
        // (2026-09-14 §11, 2026-09-15 트랙 B). 담당자는 자기 완료 보고를 스스로 물릴 수 있다 — 분리 원칙은
        // 승인에만 걸린다(자기 완료를 자기가 승인 못 함, AUTH-07a).
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-2">
            {q.canApprove && (
              <button type="button" data-queue-approve disabled={busy} title={OP_TITLE.approve}
                onClick={() => { void run({ kind: 'approve', orderId: q.orderId, expectedReportId: q.reportId }) }} className="btn btn-primary h-8 px-3 text-xs">{OP_LABEL.approve}</button>
            )}
            <button type="button" data-queue-reject-open disabled={busy} aria-expanded={rejecting} title={OP_TITLE.reject}
              onClick={() => setRejecting(v => !v)} className="btn btn-ghost h-8 px-3 text-xs">{OP_LABEL.reject}</button>
          </div>
          {!q.canApprove && (
            <p className="text-[10px] text-ink-subtle">{t(q.canManage ? 'agent.queue.selfApprovalHint' : 'agent.queue.adminApprovesHint')}</p>
          )}
          {rejecting && (
            <div className="flex flex-col gap-1">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={NOTE_PLACEHOLDER.reject} className="app-input w-full text-xs" />
              <div>
                <button type="button" data-queue-reject disabled={busy || note.trim() === ''}
                  onClick={() => { void run({ kind: 'reject', orderId: q.orderId, note: note.trim(), expectedReportId: q.reportId }) }} className="btn btn-ghost h-8 px-3 text-xs">반려 확정</button>
              </div>
            </div>
          )}
        </div>
      ) : <p className="mt-2 text-[11px] text-ink-subtle">승인은 관리자가 합니다.</p>}
      {err && <p data-queue-error className="mt-1 text-[11px] text-accent-warning">{err}</p>}
      {warn && <p data-queue-warning className="mt-1 text-[11px] text-pending">{warn}</p>}
    </li>
  )
}

export function ApprovalQueue({ queue, ...rest }: Props) {
  return (
    <section aria-label="승인 대기" className="rounded-xl border border-line bg-surface p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">승인 대기 {queue.length > 0 && <span className="ml-1 tabular-nums text-ink">{queue.length}</span>}</h2>
      {queue.length === 0
        ? <p className="text-xs text-ink-muted">승인 대기 없음</p>
        : <ul className="space-y-2">{queue.map(q => <QueueCard key={q.orderId} q={q} {...rest} />)}</ul>}
    </section>
  )
}
