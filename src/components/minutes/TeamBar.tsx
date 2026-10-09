'use client'
import { createContext, useContext } from 'react'
import { useTeamLabel, useTeamSlot } from '@/components/app/TeamsProvider'

/** 회의록 화면이 아는 팀 이름(code → 라벨) — 프로젝트를 고른 회의록 화면의 담당 선택지는 그 프로젝트의 전용 팀이라 워크스페이스 범위
 *  공급자(공용 팀)에는 없다. 화면이 선택지로 이 값을 내려 주면 막대가 그 이름을 쓴다. 모르는 code 는 undefined(공급자·code 로 물러난다) */
const TeamBarLabels = createContext<((code: string) => string | undefined) | null>(null)
export const TeamBarLabelsProvider = TeamBarLabels.Provider

/**
 * 회의록 화면의 담당 팀 막대(SP5 B2 — D39 "팀 막대 패턴"). 목록·달력·탐색기·뷰어·공유 화면에 일곱 벌로 복제돼 있던 막대를 한 곳에 둔다.
 * 색은 그 범위의 팀 슬롯(category-N, 없으면 중립 — useTeamSlot), 글자는 채움 위 전경 토큰(text-category-fg). 라벨은 팀 이름이다
 * (useTeamLabel — 그 범위에 없는 팀·공급자가 없는 공유 화면은 code 그대로). 회의록 화면은 담당 선택지의 이름을
 * TeamBarLabelsProvider 로 내려 준다(고른 프로젝트의 전용 팀까지 안다). code 는 data-team-bar(선택자·색)로만 남는다.
 * 이름은 길 수 있다(40자) — 모양마다 상한 폭을 두고 줄이며 title 로 전부 보인다(호출부 title 이 있으면 그쪽이 이긴다).
 * 모양 셋: cell(목록·탐색기 줄 — 폭 상한), tag(달력 칸 — 작게), pill(뷰어 머리 — 둥글게). 공유 화면처럼 공급자가 없으면 중립 색이다.
 */
const SHAPE = {
  cell: 'min-w-12 max-w-[7rem] justify-center rounded-md px-1.5 py-0.5 text-meta',
  tag: 'max-w-[5rem] items-center rounded px-1 py-px text-meta',
  pill: 'max-w-[14rem] rounded-full px-2 py-0.5 text-meta',
  chip: 'max-w-[7rem] justify-center rounded-md px-1.5 py-0.5 text-meta',
  label: 'max-w-[14rem] rounded-md px-1.5 py-0.5 text-meta',
} as const

export function TeamBar({ code, shape = 'cell', title }: { code: string; shape?: keyof typeof SHAPE; title?: string }) {
  const slotOf = useTeamSlot()
  const labelOf = useTeamLabel()
  const scoped = useContext(TeamBarLabels)
  const text = scoped?.(code) ?? labelOf(code)
  return (
    <span data-team-bar={code} title={title ?? text}
      className={`inline-flex shrink-0 font-bold text-category-fg ${SHAPE[shape]} ${slotOf(code).bar}`}>
      <span className="truncate">{text}</span>
    </span>
  )
}
