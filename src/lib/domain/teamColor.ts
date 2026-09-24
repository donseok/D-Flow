// 팀 색 순수 도메인 — JSX 없음. 칸반(도메인)·WBS·멤버 화면이 같은 슬롯을 쓴다.
import type { TeamCode } from './types'

/** 팀 색 슬롯 — 순번 팔레트 토큰 team-1..5(팀 색 컬럼화는 SP4).
 *  Tailwind JIT 가 읽도록 클래스는 리터럴로 둔다. */
const TEAM_SLOTS = [
  { fg: 'text-team-1', bar: 'bg-team-1', chip: 'bg-team-1-weak text-team-1' },
  { fg: 'text-team-2', bar: 'bg-team-2', chip: 'bg-team-2-weak text-team-2' },
  { fg: 'text-team-3', bar: 'bg-team-3', chip: 'bg-team-3-weak text-team-3' },
  { fg: 'text-team-4', bar: 'bg-team-4', chip: 'bg-team-4-weak text-team-4' },
  { fg: 'text-team-5', bar: 'bg-team-5', chip: 'bg-team-5-weak text-team-5' },
] as const

export type TeamSlotStyle = (typeof TEAM_SLOTS)[number]

/** 팀 틴트 — 코드 문자열의 안정 해시로 슬롯을 고른다(팀 이름에 색을 묶지 않는다). */
export function teamStyle(team: TeamCode): TeamSlotStyle {
  let h = 0
  for (const ch of team) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return TEAM_SLOTS[h % TEAM_SLOTS.length]
}
