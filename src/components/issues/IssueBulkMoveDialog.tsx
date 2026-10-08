'use client'
// 이슈 일괄 상태 이동(SPU3 이월 — 개정 §6.2 SPU3 "범주를 넘는 이슈 일괄 상태 이동은 대량 변경의 항목별 결과로", UX-08·D6-§8-bulk).
// 미리보기(옮길 수 있는 건·없는 건) → 실행 → 항목별 결과 → 실패한 건만 다시 시도. 서버는 건마다 updateIssueProgress 를 탄다
// (새 일괄 RPC 없음 — 가드·모듈 관문·전이 판정·이력이 한 건 이동과 같다).
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, CircleSlash, RotateCw, TriangleAlert } from 'lucide-react'
import { updateIssueProgress } from '@/app/actions/issues'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { IssueStatusPill } from '@/components/ui/StatusPill'
import { issueStatusCode, planBulkMove, runBulkMove, type BulkMoveBlockReason } from '@/lib/domain/issueBoard'
import type { Issue } from '@/lib/domain/issues'
import { activeVocab, vocabLabel, type IssueStatusDef } from '@/lib/settings/vocab'

type RowResult = { state: 'ok' } | { state: 'failed'; message: string } | { state: 'skipped'; reason: BulkMoveBlockReason }

export function IssueBulkMoveDialog({
  open, onClose, selectedIds, issues, statuses,
}: {
  open: boolean
  /** ran = 한 번이라도 실행했다 — 호출부가 선택을 비울지 정한다(취소는 선택을 남긴다) */
  onClose: (ran: boolean) => void
  /** 고른 이슈 id — 열 때의 선택을 그대로 쓴다 */
  selectedIds: readonly string[]
  /** 최신 이슈 목록 — 재시도는 여기서 그 이슈의 지금 상태를 다시 읽는다(충돌 뒤 낡은 기준으로 다시 보내지 않게) */
  issues: readonly Issue[]
  statuses: readonly IssueStatusDef[]
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [target, setTarget] = useState('')
  const [results, setResults] = useState<Record<string, RowResult> | null>(null)
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null)
  // 열 때마다 처음부터 — 지난 실행의 결과가 다른 선택에 남지 않게
  useEffect(() => { if (open) { setTarget(''); setResults(null); setRunning(null) } }, [open])

  const byId = useMemo(() => new Map(issues.map(i => [i.id, i])), [issues])
  const selected = useMemo(() => selectedIds.flatMap(id => byId.get(id) ?? []), [selectedIds, byId])
  const plan = useMemo(() => (target ? planBulkMove(statuses, selected, target) : null), [statuses, selected, target])
  const label = (code: string) => vocabLabel('workflow.issue_statuses', statuses, code, t)
  const reasonText = (reason: BulkMoveBlockReason) => t(reason === 'same' ? 'issue.bulk.reason.same' : 'issue.bulk.reason.not_allowed')
  const failedIds = results ? Object.entries(results).filter(([, r]) => r.state === 'failed').map(([id]) => id) : []
  const count = (state: RowResult['state']) => (results ? Object.values(results).filter(r => r.state === state).length : 0)

  async function send(batch: Issue[], base: Record<string, RowResult>) {
    setRunning({ done: 0, total: batch.length })
    const outcomes = await runBulkMove(batch, target, updateIssueProgress, done => setRunning({ done, total: batch.length }))
    const next = { ...base }
    for (const o of outcomes) {
      next[o.issueId] = o.ok ? { state: 'ok' } : { state: 'failed', message: o.error ?? t('issue.bulk.noResponse') }
    }
    setResults(next)
    setRunning(null)
    // 성공분을 목록에 반영하고, 충돌 건은 최신 상태를 받아 재시도 기준을 맞춘다
    router.refresh()
  }

  function run() {
    if (!plan || running) return
    const base: Record<string, RowResult> = {}
    for (const b of plan.blocked) base[b.issue.id] = { state: 'skipped', reason: b.reason }
    void send(plan.movable, base)
  }

  /** 실패한 건만 다시 보낸다 — 성공·건너뜀은 손대지 않는다. 그 사이 상태가 바뀐 건은 지금 상태로 다시 판정한다 */
  function retryFailed() {
    if (!results || running) return
    const base = { ...results }
    const batch: Issue[] = []
    for (const id of failedIds) {
      const latest = byId.get(id)
      if (!latest) { base[id] = { state: 'failed', message: t('issue.bulk.gone') }; continue }
      const again = planBulkMove(statuses, [latest], target)
      if (again.movable.length) batch.push(latest)
      else if (again.blocked[0].reason === 'same') base[id] = { state: 'ok' }          // 응답만 잃고 저장은 된 경우
      else base[id] = { state: 'failed', message: reasonText('not_allowed') }
    }
    if (batch.length === 0) { setResults(base); return }
    void send(batch, base)
  }

  const rows = results
    ? selected.filter(i => results[i.id]).map(i => ({ issue: i, result: results[i.id] }))
    : plan
      ? [...plan.movable.map(i => ({ issue: i, result: null })), ...plan.blocked.map(b => ({ issue: b.issue, result: { state: 'skipped' as const, reason: b.reason } }))]
      : []

  return (
    <Modal
      open={open}
      onClose={() => { if (!running) onClose(results !== null) }}
      eyebrow={t('issue.bulk.selected').replace('{n}', String(selected.length))}
      title={t('issue.bulk.title')}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {running && <span role="status" className="mr-auto text-xs text-fg-secondary">{t('issue.bulk.running').replace('{done}', String(running.done)).replace('{total}', String(running.total))}</span>}
          <button type="button" className="btn btn-ghost text-xs" disabled={!!running} onClick={() => onClose(results !== null)}>{t(results ? 'issue.bulk.close' : 'issue.bulk.cancel')}</button>
          {results ? failedIds.length > 0 && (
            <button type="button" className="btn btn-primary inline-flex items-center gap-1.5 text-xs" disabled={!!running} onClick={retryFailed} data-testid="issue-bulk-retry">
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              {t('issue.bulk.retryFailed').replace('{n}', String(failedIds.length))}
            </button>
          ) : (
            <button type="button" className="btn btn-primary text-xs" disabled={!!running || !plan || plan.movable.length === 0} onClick={run} data-testid="issue-bulk-run">
              {t('issue.bulk.run').replace('{n}', String(plan?.movable.length ?? 0))}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('issue.bulk.target')}</span>
          <select className="app-input" value={target} disabled={!!running || !!results} onChange={e => setTarget(e.target.value)} data-testid="issue-bulk-target">
            <option value="">{t('issue.bulk.targetPlaceholder')}</option>
            {activeVocab(statuses).map(d => <option key={d.code} value={d.code}>{label(d.code)}</option>)}
          </select>
        </label>

        {plan && !results && (
          <p role="status" data-testid="issue-bulk-preview" className="text-sm text-fg">
            {t('issue.bulk.previewMovable').replace('{n}', String(plan.movable.length)).replace('{status}', label(target))}
            {plan.blocked.length > 0 && <> <span className="text-fg-secondary">{t('issue.bulk.previewBlocked').replace('{n}', String(plan.blocked.length))}</span></>}
          </p>
        )}
        {results && (
          <p role="status" data-testid="issue-bulk-summary" className="text-sm font-medium text-fg">
            {t('issue.bulk.resultSummary').replace('{ok}', String(count('ok'))).replace('{fail}', String(count('failed'))).replace('{skip}', String(count('skipped')))}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-subtle text-left text-xs font-semibold text-fg-muted">
                  <th className="px-2.5 py-2">{t('issue.bulk.col.issue')}</th>
                  <th className="px-2.5 py-2">{t('issue.bulk.col.current')}</th>
                  <th className="px-2.5 py-2">{t('issue.bulk.col.result')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ issue, result }) => (
                  <tr key={issue.id} data-bulk-row={issue.id} data-bulk-state={result?.state ?? 'movable'} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-2.5 py-2">
                      <span className="font-semibold tabular-nums text-fg">{issue.code}</span>
                      <span className="mt-0.5 block break-words text-fg-secondary">{issue.title}</span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2">
                      <IssueStatusPill category={issue.status} code={issueStatusCode(issue)} defs={statuses} />
                    </td>
                    <td className="px-2.5 py-2">
                      {result === null && <span className="text-fg-secondary">{t('issue.bulk.result.willMove').replace('{status}', label(target))}</span>}
                      {result?.state === 'ok' && <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{t('issue.bulk.result.ok')}</span>}
                      {result?.state === 'skipped' && <span className="inline-flex items-start gap-1 text-fg-muted"><CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t('issue.bulk.result.skipped')} — {reasonText(result.reason)}</span>}
                      {result?.state === 'failed' && <span className="inline-flex items-start gap-1 text-danger"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t('issue.bulk.result.failed')} — {result.message}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}
