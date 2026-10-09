// src/components/agents/SeatOpsBar.tsx
'use client'
import type { Seat } from '@/lib/domain/seatmap'
import { useLocale } from '@/components/providers/LocaleProvider'
import { opsFor, type SeatOpKind } from './seatOps'
import { OP_LABEL_KEY, fill, opWhyText } from './labelKeys'
import { IconApprove, IconReject, IconResume, IconRework, IconStop, IconUnapprove } from './icons'
import css from './seatmap.module.css'

const OP_ICON: Record<SeatOpKind, () => React.JSX.Element> = {
  approve: IconApprove, reject: IconReject, unapprove: IconUnapprove, rework: IconRework, stop: IconStop,
  resume: IconResume,
}

export interface SeatOpHandler {
  /** 누른 op 를 실행한다. 사유가 필요한 op 는 곧바로 실행하지 않고 상세 패널의 사유 입력을 연다. */
  (seat: Seat, kind: SeatOpKind): void
}

/**
 * 좌석 위 결재 바 — 늘 보인다. display 를 토글해 꺼내지 않는다(globals.css 안전망에 진다).
 * op 가 없는 좌석(빈자리)에는 아예 그리지 않는다.
 */
export function SeatOpsBar({ seat, busy, onOp }: { seat: Seat; busy: boolean; onOp: SeatOpHandler }) {
  const { t } = useLocale()
  const ops = opsFor(seat)
  if (ops.length === 0) return null
  return (
    <div className={css.seatOps} role="group" aria-label={fill(t('agents.op.barAria'), { code: seat.code })}>
      {ops.map(({ spec, allowed, why }) => {
        const Icon = OP_ICON[spec.kind]
        return (
          <button key={spec.kind} type="button" className={css.opMini} data-op={spec.kind} data-seat-op={spec.kind}
            disabled={!allowed || busy} title={busy ? t('agents.op.busy') : opWhyText(spec.kind, why, t)}
            aria-label={`${seat.code} ${t(OP_LABEL_KEY[spec.kind])}`}
            onClick={() => onOp(seat, spec.kind)}>
            <Icon />{t(OP_LABEL_KEY[spec.kind])}
          </button>
        )
      })}
    </div>
  )
}
