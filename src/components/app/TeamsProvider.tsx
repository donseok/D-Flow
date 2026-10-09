'use client'

// 활성 팀 목록 컨텍스트 — 미제공 시 빈 목록. 팀은 범위 레이아웃 셋((global)·w/[slug]·p/[projectId])이 요청 범위 원천으로 주입한다(SP4 B).
import { createContext, useCallback, useContext, useMemo } from 'react'
import { activeCodes, type Team } from '@/lib/domain/teams'
import { teamSlotFor, type TeamSlotStyle } from '@/lib/domain/teamColor'
import { teamLabelLookup } from '@/lib/domain/teamLabel'
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
 *  이 범위의 활성 팀으로 찾고 없으면(비활성 팀 담당·공급자가 없는 공유 화면) code 그대로다 — 색 슬롯(useTeamSlot)과 같은 목록 */
export function useTeamLabel(): (code: string) => string {
  const teams = useTeams()
  return useMemo(() => teamLabelLookup(teams), [teams])
}
