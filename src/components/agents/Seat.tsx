// src/components/agents/Seat.tsx
'use client'
import type { Seat } from '@/lib/domain/seatmap'
import type { AnimName, SeatState } from '@/lib/domain/seatState'
import { ageLabel } from '@/lib/domain/seatmap'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Sprite } from './Sprite'
import { PhaseBadge } from './PhaseBadge'
import { ChatBubble, seatSpeech, useOfficeChatter } from './SeatSpeech'
import { SeatOpsBar, type SeatOpHandler } from './SeatOpsBar'
import { OwnerTag, ownerLabel } from './OwnerTag'
import { fill, type Translate } from './labelKeys'
import { IconBlocked, IconDependency, IconDone, IconOffline, IconRejected, IconStale, IconWait } from './icons'
import css from './seatmap.module.css'

/** 좌석 상태 이름의 사전 키 — 그리는 자리에서 t(STATE_LABEL[state]) 로 읽는다. */
export const STATE_LABEL: Record<SeatState, DictKey> = {
  ACTIVE: 'agents.state.active', STALE: 'agents.state.stale', OFFLINE: 'agents.state.offline', BLOCKED: 'agents.state.blocked', REJECTED: 'agents.state.rejected',
  WAIT: 'agents.state.wait', READY: 'agents.state.ready', DONE: 'agents.state.done',
}

export function seatMetaLine(seat: Seat, nowMs: number, t: Translate): string {
  const who = seat.agent ?? '—'
  switch (seat.state) {
    case 'ACTIVE': case 'REJECTED': return `${who} · ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'STALE': return fill(t('agents.meta.stale'), { who, age: ageLabel(seat.lastSignalAt, nowMs) })
    case 'OFFLINE': return fill(t('agents.meta.offline'), { step: seat.phase, age: ageLabel(seat.lastSignalAt, nowMs) })
    case 'BLOCKED': return fill(t('agents.meta.blocked'), { who })
    case 'WAIT': return t('agents.state.wait')
    case 'READY': return seat.waitReason?.label ?? t('agents.meta.notStarted') // 짧은 라벨만 — 전문은 상세 패널(착수 대기 사유 스펙 §4)
    default: return t('agents.state.done')
  }
}

/** 상태 표지 — 아이콘 I1. 옛 판의 글자 배지(`!` · `?` · "끊김")를 대신한다. */
const MARK: Partial<Record<SeatState, () => React.JSX.Element>> = {
  STALE: IconStale, OFFLINE: IconOffline, BLOCKED: IconBlocked, WAIT: IconWait, REJECTED: IconRejected, DONE: IconDone,
}
const HAS_BAR: readonly SeatState[] = ['ACTIVE', 'STALE', 'REJECTED', 'BLOCKED', 'OFFLINE']

export function SeatMark({ state, anim }: { state: SeatState; anim?: AnimName }) {
  const { t } = useLocale()
  // 선행 대기는 상태가 READY 라 상태 표로는 못 가른다 — 좌석 그림(waiting)을 따라 표지를 단다.
  if (anim === 'waiting') {
    return <span className={css.mark} data-mark="waiting" title={t('agents.mark.waiting')}><IconDependency /></span>
  }
  const Icon = MARK[state]
  if (!Icon) return null
  return <span className={css.mark} data-mark={state} title={t(STATE_LABEL[state])}><Icon /></span>
}

/** 캐릭터 머리 위 — 보고·한마디가 있으면 말풍선, 없으면 단계 말풍선(에이전트 보기와 같은 규칙). */
function SeatHead({ seat, nowMs }: { seat: Seat; nowMs: number }) {
  const say = seatSpeech(seat, nowMs, useOfficeChatter())
  return say ? <ChatBubble key={say.text} {...say} className="block w-max max-w-[168px]" /> : <PhaseBadge seat={seat} />
}

export function SeatCard({ seat, side, selected, nowMs, busy, onSelect, onOp }: {
  seat: Seat; side: 'left' | 'right'; selected: boolean; nowMs: number
  /** 이 좌석의 op 가 서버에 가 있는 동안 참 — 결재 바를 잠근다. */
  busy: boolean
  onSelect: (orderId: string) => void
  onOp: SeatOpHandler
}) {
  const { t } = useLocale()
  const owner = ownerLabel(seat, t)
  return (
    <div className={`${css.seat} ${side === 'left' ? css.seatLeft : css.seatRight}`}>
      <div className={css.chair}>
        <span className={css.phaseSlot}><SeatHead seat={seat} nowMs={nowMs} /></span>
        <Sprite character={seat.character} anim={seat.anim} />
      </div>
      <div className={css.desk} data-state={seat.state} data-rejected={seat.rejected ? '1' : undefined}
        data-selected={selected ? '1' : undefined} data-owner={owner?.kind}>
        <button
          type="button" className={css.deskPick}
          aria-pressed={selected} aria-label={`${seat.code} ${seat.name} ${t(STATE_LABEL[seat.state])}`}
          onClick={() => onSelect(seat.orderId)}
        >
          <span className={css.deskTop}>
            <span className={css.deskId}>{seat.code}</span>
            {owner && <OwnerTag owner={owner} />}
            <SeatMark state={seat.state} anim={seat.anim} />
          </span>
          <span className={css.deskName}>{seat.name}</span>
          <span className={css.deskMeta}>{seatMetaLine(seat, nowMs, t)}</span>
          {seat.state === 'BLOCKED' && seat.note && <span className={css.note}>{seat.note}</span>}
          {HAS_BAR.includes(seat.state) && <span className={css.bar}><i style={{ width: `${seat.progress}%` }} /></span>}
        </button>
        <SeatOpsBar seat={seat} busy={busy} onOp={onOp} />
      </div>
    </div>
  )
}
