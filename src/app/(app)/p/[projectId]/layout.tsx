import { notFound } from 'next/navigation'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import { getActorViewState } from '@/lib/authz'
import { roleIn } from '@/lib/domain/authz'
import { teamsForProjectSync } from '@/lib/teams/master'

// 프로젝트 셸. 메뉴는 사이드바로 이동했고, 각 페이지가 자체 PageHero 를 렌더한다.
// TeamsProvider 중첩(안쪽 승리)으로 /p/ 하위의 useTeams/useTeamCodes 가 프로젝트 팀을 받는다 —
// 전역 화면(회의록·계정)은 (app)/layout 의 전역 Provider 그대로(스펙 §2).
export default async function ProjectLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const [{ projectId }, { actor, degraded }] = await Promise.all([params, getActorViewState()])
  // 존재 은닉(스펙 §3.2) — 내 워크스페이스에 없는 프로젝트(타 워크스페이스·미존재)는 404. 같은 워크스페이스의
  // 조회 전용(viewer)은 통과한다. 권한 조회 실패(degraded)는 404 가 아니다 — 장애를 '없는 프로젝트'로
  // 위장하지 않고 (app)/layout 의 열화 표시를 그대로 둔다(쓰기는 서버 액션 가드가 다시 막는다).
  // getActor 는 요청당 cache() 라 (app)/layout 과 같은 조립을 재사용한다.
  if (!degraded && roleIn(actor, projectId) === null) notFound()
  const teams = teamsForProjectSync(projectId).filter(t => t.active)
  return (
    <TeamsProvider teams={teams}>
      <div className="h-full min-h-0 min-w-0">{children}</div>
    </TeamsProvider>
  )
}
