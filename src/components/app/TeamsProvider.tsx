'use client'

// 팀 목록 컨텍스트 — 미제공 시 빈 목록. 팀은 범위 레이아웃 셋((global)·w/[slug]·p/[projectId])이 요청 범위 원천으로 주입한다(SP4 B).
// 주입 값은 비활성 팀을 포함한다 — 선택지·필터·색(useTeams·useTeamCodes·useTeamSlot)은 여기서 활성만 거르고, 비활성 팀은 라벨 해석
// (useTeamLabel)에만 쓴다. 비활성 팀이 담당인 항목·회의록도 code 가 아니라 이름으로 보이게 하려는 것이다.
import { createContext, useCallback, useContext, useMemo } from 'react'
import { activeCodes, type Team } from '@/lib/domain/teams'
import { teamSlotFor, type TeamSlotStyle } from '@/lib/domain/teamColor'
import { teamLabelLookupWithInactive } from '@/lib/domain/teamLabel'
import type { TeamCode } from '@/lib/domain/types'

const TeamsContext = createContext<readonly Team[]>([])

export function TeamsProvider({ teams, children }: { teams: readonly Team[]; children: React.ReactNode }) {
  return <TeamsContext.Provider value={teams}>{children}</TeamsContext.Provider>
}

/** 활성 팀(정렬됨) — progressVisible 등 팀 속성이 필요한 곳. */
export function useTeams(): readonly Team[] {
  const teams = useContext(TeamsContext)
  return useMemo(
    () => teams.filter(t => t.active).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'ko')),
    [teams],
  )
}

/** 활성 팀 코드(정렬됨) — 탭·필터·셀렉트 공용. */
export function useTeamCodes(): readonly TeamCode[] {
  const teams = useContext(TeamsContext)
  return useMemo(() => activeCodes(teams), [teams])
}

/** 팀 code → 화면 색 슬롯(SP4 D3) — 이 범위의 활성 팀으로 찾고 없으면 중립(공급자가 없는 화면도 중립) */
export function useTeamSlot(): (code: string) => TeamSlotStyle {
  const teams = useTeams()
  return useCallback((code: string) => teamSlotFor(code, teams), [teams])
}

/** 팀 code → 화면 라벨(팀 이름 — 같은 이름이 둘이면 `이름 (code)`). 화면이 바꿀 수 없는 code 대신 이름을 그리게 한다.
 *  이 범위의 활성 팀으로 먼저 찾고(선택지와 같은 글자), 없으면 비활성 팀의 이름이다. 둘 다 없으면(다른 범위의 전용 팀·공급자가 없는
 *  공유 화면) code 그대로다. 색 슬롯(useTeamSlot)은 활성 팀만 본다 — 비활성 팀은 이름은 보이되 색은 중립이다 */
export function useTeamLabel(): (code: string) => string {
  const all = useContext(TeamsContext)
  const active = useTeams()
  return useMemo(() => teamLabelLookupWithInactive(active, all.filter((t) => !t.active)), [active, all])
}
