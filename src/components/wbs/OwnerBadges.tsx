'use client'
// 담당 표지(●주관·△지원) — 서버 컴포넌트(개요의 DelayAging·VarianceRanking)도 그리므로 클라이언트 경계로 둔다(SP4 P2):
// 팀 색·이름은 범위 레이아웃의 TeamsProvider 에서 온다(useTeamSlot·useTeamLabel — 목록 밖 팀은 중립 색·code 그대로). shared.tsx 가 다시 내보낸다.
// 글자는 팀 이름이다(code 는 바꿀 수 없어 이름을 바꿔도 옛 글자가 남는다) — 긴 이름은 줄이고 title 로 전부 보인다.
import type { ComputedItem } from '@/lib/domain/types'
import { useTeamLabel, useTeamSlot } from '@/components/app/TeamsProvider'
import { useLocale } from '@/components/providers/LocaleProvider'

export function OwnerBadges({
  owners,
  nowrap = false,
}: {
  owners: ComputedItem['owners']
  nowrap?: boolean
}) {
  const slotOf = useTeamSlot()
  const labelOf = useTeamLabel()
  const { t } = useLocale()
  if (!owners.length) return <span className="text-fg-muted">-</span>
  return (
    <div className={`flex items-center gap-x-1.5 gap-y-0.5 overflow-hidden ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}>
      {owners.map(o => (
        <span
          key={o.team + o.kind}
          className={`inline-flex min-w-0 max-w-full items-center gap-0.5 font-semibold leading-none ${nowrap ? 'shrink-0' : ''}`}
          style={{ fontSize: 'var(--wbs-owner-font, 12px)' }}
          title={t(o.kind === 'primary' ? 'wbs.ownerTitlePrimary' : 'wbs.ownerTitleSupport').replace('{team}', labelOf(o.team))}
        >
          <span
            className={`${slotOf(o.team).fg} ${o.kind === 'support' ? 'opacity-60' : ''} shrink-0 leading-none`}
            style={{ fontSize: 'var(--wbs-owner-mark-font, 9px)' }}
          >
            {o.kind === 'primary' ? '●' : '△'}
          </span>
          <span className="max-w-[10rem] truncate text-fg-secondary">{labelOf(o.team)}</span>
        </span>
      ))}
    </div>
  )
}
