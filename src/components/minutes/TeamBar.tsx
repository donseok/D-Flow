'use client'
import { useTeamSlot } from '@/components/app/TeamsProvider'

/**
 * 회의록 화면의 담당 팀 막대(SP5 B2 — D39 "팀 막대 패턴"). 목록·달력·탐색기·뷰어·공유 화면에 일곱 벌로 복제돼 있던 막대를 한 곳에 둔다.
 * 색은 그 범위의 팀 슬롯(category-N, 없으면 중립 — useTeamSlot), 글자는 채움 위 전경 토큰(text-category-fg). 라벨은 팀 code.
 * 모양 셋: cell(목록·탐색기 줄 — 고정 폭), tag(달력 칸 — 작게), pill(뷰어 머리 — 둥글게). 공유 화면처럼 공급자가 없으면 중립 색이다.
 */
const SHAPE = {
  cell: 'w-12 justify-center rounded-md px-1.5 py-0.5 text-meta',
  tag: 'items-center rounded px-1 py-px text-meta',
  pill: 'rounded-full px-2 py-0.5 text-meta',
  chip: 'justify-center rounded-md px-1.5 py-0.5 text-meta',
  label: 'rounded-md px-1.5 py-0.5 text-meta',
} as const

export function TeamBar({ code, shape = 'cell', title }: { code: string; shape?: keyof typeof SHAPE; title?: string }) {
  const slotOf = useTeamSlot()
  return (
    <span data-team-bar={code} title={title}
      className={`inline-flex shrink-0 font-bold text-category-fg ${SHAPE[shape]} ${slotOf(code).bar}`}>
      {code}
    </span>
  )
}
