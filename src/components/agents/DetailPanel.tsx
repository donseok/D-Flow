'use client'
import Link from 'next/link'
import type { Seat } from '@/lib/domain/seatmap'
import { ageLabel } from '@/lib/domain/seatmap'
import { STATE_LABEL } from './Seat'
import { useLocale } from '@/components/providers/LocaleProvider'
import { opsFor, opSpec, type SeatOpKind } from './seatOps'
import { OP_LABEL_KEY, OP_TITLE_KEY, fill, opWhyText, type Translate } from './labelKeys'
import { IconApprove, IconReject, IconResume, IconRework, IconStop, IconUnapprove } from './icons'
import css from './seatmap.module.css'

const LADDER: Array<{ phase: string; pct: number }> = [
  { phase: 'design', pct: 25 }, { phase: 'build', pct: 60 }, { phase: 'verify', pct: 85 }, { phase: 'reported', pct: 100 }, { phase: 'merged', pct: 100 },
]

const OP_ICON: Record<SeatOpKind, () => React.JSX.Element> = {
  approve: IconApprove, reject: IconReject, unapprove: IconUnapprove, rework: IconRework, stop: IconStop,
  resume: IconResume,
}

function ladderPhase(seat: Seat): string {
  if (seat.state === 'WAIT') return 'reported'
  if (seat.state === 'DONE') return 'merged'
  if (seat.phase === 'blocked' || seat.phase === 'rejected') return seat.progress < 25 ? 'design' : seat.progress < 60 ? 'build' : 'verify'
  if (seat.phase === 'refactor') return 'verify' // 사다리는 다섯 칸(스펙 §5); refactor 는 verify 칸에 놓는다
  return seat.phase
}

/** 사유를 받거나(반려·재작업) 한 번 확인받아야(중단) 확정되는 op 의 입력 상태 — 정본은 SeatmapView 가 쥔다(30초 폴링이 작성 중인 글을 지우지 않게). */
export interface NoteDraft { orderId: string; kind: SeatOpKind; text: string }

/** 모달 머리에 쓰는 한 줄 — 층 · 구역 · 주문 8자리. */
export function seatEyebrow(floorName: string, zoneLabel: string, seat: Seat, t: Translate): string {
  return `${floorName} · ${zoneLabel} · ${fill(t('agents.detail.order'), { id: seat.id8 })}`
}

export function DetailPanel({ seat, floorName = '', zoneLabel = '', nowMs, busy, note, opError, onOp, onNoteChange, onNoteConfirm, onNoteCancel, onClose }: {
  seat: Seat | null; floorName?: string; zoneLabel?: string; nowMs: number
  busy: boolean
  note: NoteDraft | null
  opError: string | null
  onOp: (seat: Seat, kind: SeatOpKind) => void
  onNoteChange: (text: string) => void
  onNoteConfirm: () => void
  onNoteCancel: () => void
  /** 있으면 카드 오른쪽 위에 닫기 버튼을 그린다. */
  onClose?: () => void
}) {
  const { t } = useLocale()
  if (!seat) return null
  const now = ladderPhase(seat)
  const idx = LADDER.findIndex(l => l.phase === now)
  const hbBad = seat.state === 'STALE' || seat.state === 'OFFLINE'
  const showSignal = !['READY', 'DONE', 'WAIT'].includes(seat.state)
  const ops = opsFor(seat)
  const draft = note && note.orderId === seat.orderId ? note : null
  const draftSpec = draft ? opSpec(draft.kind) : null
  const draftLabel = draft ? t(OP_LABEL_KEY[draft.kind]) : ''
  const noteReady = (draft?.text ?? '').trim().length > 0
  return (
    <div className={css.panel} data-panel="" aria-live="polite">
      <div className={css.panelHead}>
        <div className={css.eyebrow}>{floorName} · {zoneLabel} · {fill(t('agents.detail.order'), { id: seat.id8 })}</div>
        {onClose && (
          <button type="button" className={css.panelClose} data-panel-close="" aria-label={t('common.close')} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>
      <h3>{seat.code}</h3>
      <p className={css.task}>{seat.name}</p>
      <span className={css.pill} data-state={seat.state}>{t(STATE_LABEL[seat.state])}</span>
      {seat.state === 'READY' && seat.waitReason && (
        <p className={css.waitReason} data-wait-reason={seat.waitReason.kind}><b>{seat.waitReason.label}</b> · {seat.waitReason.text}</p>
      )}
      <ul className={css.ladder} aria-label="Phase">
        {LADDER.map((l, i) => (
          <li key={l.phase}
            data-done={seat.state !== 'READY' && (i < idx || (i === idx && (seat.state === 'WAIT' || seat.state === 'DONE'))) ? '1' : undefined}
            data-now={seat.state !== 'READY' && i === idx && seat.state !== 'WAIT' && seat.state !== 'DONE' ? '1' : undefined}
            data-bad={seat.rejected && i === idx ? '1' : undefined}>
            {l.phase}<br /><b>{l.pct}</b>
          </li>
        ))}
      </ul>
      <dl className={css.facts}>
        <dt>{t('agents.detail.agent')}</dt><dd>{seat.agent ?? '—'}</dd>
        <dt>{t('agents.detail.progress')}</dt><dd>{seat.progress}%</dd>
        <dt>{t('agents.detail.lastSignal')}</dt><dd className={hbBad ? css.factBad : ''}>{showSignal ? ageLabel(seat.lastSignalAt, nowMs, t) : '—'}</dd>
        <dt>heartbeat</dt><dd>{seat.heartbeatAt ? `${ageLabel(seat.heartbeatAt, nowMs, t)} · ${seat.heartbeatPhase ?? '—'}` : t('agents.detail.noHeartbeat')}</dd>
        {seat.resumeRequestedAt && (
          <>
            <dt>{t('agents.detail.resumeRequested')}</dt>
            <dd data-resume-requested="">
              {fill(t('agents.detail.resumeBy'), { age: ageLabel(seat.resumeRequestedAt, nowMs, t), host: seat.resumeRequestedHost ?? t('agents.detail.hostUnknown') })}
            </dd>
          </>
        )}
      </dl>
      {seat.state === 'BLOCKED' && seat.note && <p className={css.quote}>{seat.note}</p>}
      {seat.rejected && <p className={css.quote}>{fill(t('agents.detail.rejectNote'), { note: seat.reviewNote ?? t('agents.detail.noteNone') })}</p>}

      {/* 결재 — 좌석 위 결재 바와 같은 op 표를 큰 버튼으로. 사유가 필요한 op 는 아래 입력이 열린다. */}
      <div className={css.acts} role="group" aria-label={t('agents.detail.opsAria')}>
        {ops.length === 0
          ? <span className={css.actNone}>{t('agents.detail.noOps')}</span>
          : ops.map(({ spec, allowed, why }) => {
            const Icon = OP_ICON[spec.kind]
            return (
              <button key={spec.kind} type="button" className={css.act} data-op={spec.kind} data-panel-op={spec.kind}
                disabled={!allowed || busy} title={busy ? t('agents.op.busy') : opWhyText(spec.kind, why, t)}
                onClick={() => onOp(seat, spec.kind)}>
                <Icon />{t(OP_LABEL_KEY[spec.kind])}
              </button>
            )
          })}
      </div>
      {/* 확인이 필요한 op(중단) — 사유 입력과 같은 자리에서 한 번 더 묻는다. 브라우저 confirm() 은 쓰지 않는다. */}
      {draft && draftSpec?.needsConfirm && (
        <div className={css.noteBox} data-confirm="" data-op-confirm-box={draft.kind}>
          <p className={css.confirmText}>{fill(t('agents.op.confirmAsk'), { label: draftLabel, title: t(OP_TITLE_KEY[draft.kind]) })}</p>
          <div className={css.noteRow}>
            <button type="button" className={css.act} data-op={draft.kind} data-op-confirm=""
              disabled={busy} onClick={onNoteConfirm}>
              {fill(t('agents.op.confirmGo'), { label: draftLabel })}
            </button>
            <button type="button" className={css.act} data-op-cancel="" onClick={onNoteCancel}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      {draft && !draftSpec?.needsConfirm && (
        <div className={css.noteBox}>
          <label htmlFor="seat-op-note">{fill(t('agents.detail.noteLabel'), { label: draftLabel })}</label>
          <textarea id="seat-op-note" data-op-note="" rows={2} value={draft.text}
            placeholder={t('agents.detail.notePlaceholder')}
            onChange={e => onNoteChange(e.target.value)} />
          <div className={css.noteRow}>
            <button type="button" className={css.act} data-op={draft.kind} data-op-confirm=""
              disabled={!noteReady || busy} onClick={onNoteConfirm}>
              {fill(t('agents.op.confirmGo'), { label: draftLabel })}
            </button>
            <button type="button" className={css.act} data-op-cancel="" onClick={onNoteCancel}>{t('common.cancel')}</button>
            <span className={css.noteHint}>{noteReady ? t('agents.detail.noteReady') : t('agents.detail.noteEmpty')}</span>
          </div>
        </div>
      )}
      {opError && <p className={css.opError} data-op-error="">{opError}</p>}

      <div className={css.actions}>
        <Link href={`/p/${seat.projectId}/wbs`}>{t('agents.detail.openWbs')}</Link>
      </div>
    </div>
  )
}
