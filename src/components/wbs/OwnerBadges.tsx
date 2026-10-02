'use client'
// 담당 표지(●주관·△지원) — 서버 컴포넌트(개요의 DelayAging·VarianceRanking)도 그리므로 클라이언트 경계로 둔다(SP4 P2):
// 팀 색은 범위 레이아웃의 TeamsProvider 에서 온다(useTeamSlot — 목록 밖 팀은 중립). shared.tsx 가 다시 내보낸다.
import type { ComputedItem } from '@/lib/domain/types'
import { useTeamSlot } from '@/components/app/TeamsProvider'

export function OwnerBadges({
  owners,
  nowrap = false,
}: {
  owners: ComputedItem['owners']
  nowrap?: boolean
}) {
  const slotOf = useTeamSlot()
  if (!owners.length) return <span className="text-ink-subtle">-</span>
  return (
    <div className={`flex items-center gap-x-1.5 gap-y-0.5 overflow-hidden ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}>
      {owners.map(o => (
        <span
          key={o.team + o.kind}
          className={`inline-flex items-center gap-0.5 font-semibold leading-none ${nowrap ? 'shrink-0' : ''}`}
          style={{ fontSize: 'var(--wbs-owner-font, 10.5px)' }}
          title={o.kind === 'primary' ? `${o.team} 주관` : `${o.team} 지원`}
        >
          <span
            className={`${slotOf(o.team).fg} ${o.kind === 'support' ? 'opacity-60' : ''} leading-none`}
            style={{ fontSize: 'var(--wbs-owner-mark-font, 9px)' }}
          >
            {o.kind === 'primary' ? '●' : '△'}
          </span>
          <span className="text-ink-muted">{o.team}</span>
        </span>
      ))}
    </div>
  )
}
