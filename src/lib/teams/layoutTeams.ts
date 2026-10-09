import 'server-only'
// 범위 레이아웃 셋((global)·w/[slug]·p/[projectId])이 TeamsProvider 로 내리는 팀(SP4 B — 스펙 D19·Q23, 계획 P3).
// 비활성 팀도 함께 내린다 — 비활성 팀이 담당인 항목·회의록의 라벨(이름)을 풀기 위해서다. 선택지·필터·색을 활성으로 거르는 것은
// TeamsProvider 의 훅(useTeams·useTeamCodes)이 한다. 함수 이름의 active 는 옛 계약의 흔적이다 — 호출부(범위 레이아웃 셋)가 UI 위험
// 파일이라 이름은 그 파일들을 다음에 손댈 때 함께 바꾼다.
// 원천은 요청 범위 하나(src/lib/teams/source.ts — 세션 RLS, 같은 요청의 설정 조회와 캐시를 나눈다). 실패는 로그 + 빈 목록으로 셸을 그린다 —
// 설정·가져오기 같은 복구 화면까지 오류가 되지 않게(UI-2 계약, tests/ui/app-layout-teams.test.tsx). 팀으로 판정하는 화면은 자기 원천
// 호출에서 실패를 드러낸다(명단·개요는 던지고, 설정 팀 절은 고정 문구, 가져오기는 503). Next 제어 신호는 삼키지 않는다.
import { unstable_rethrow } from 'next/navigation'
import type { Team } from '@/lib/domain/teams'

export async function activeTeamsForLayout(read: () => Promise<Team[]>, tag: string): Promise<Team[]> {
  try {
    return await read()
  } catch (e) {
    unstable_rethrow(e)
    console.error(`[${tag}] 팀 조회 실패 — 팀 없이 그린다:`, e instanceof Error ? e.message : e)
    return []
  }
}
