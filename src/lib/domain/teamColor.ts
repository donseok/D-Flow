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

/** `teams.color`(0003, hex, not null) 배정용 팔레트 — TEAM_SLOTS 의 team-1..5 토큰과 같은 hex 값
 *  (src/app/globals.css `--color-team-1..5`). SP1 은 화면 틴트는 그대로 두고(teamStyle 유지),
 *  DB 컬럼만 팀 생성 시 이 팔레트에서 순번으로 배정한다(소비처 교체는 SP3/SP4). */
export const TEAM_PALETTE = ['#4f46e5', '#0276a8', '#7c3aed', '#a65b00', '#0f766e'] as const

/** 정렬순번으로 팔레트에서 색을 고른다 — 순번이 팔레트 길이를 넘으면 순환. */
export function pickTeamColor(sortOrder: number): string {
  return TEAM_PALETTE[((sortOrder % TEAM_PALETTE.length) + TEAM_PALETTE.length) % TEAM_PALETTE.length]
}
