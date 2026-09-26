import { notFound } from 'next/navigation'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import { getActorViewState } from '@/lib/authz'
import { isHiddenProject } from '@/lib/domain/authz'
import { teamsForProjectSync } from '@/lib/teams/master'

// 프로젝트 셸. 메뉴는 사이드바로 이동했고, 각 페이지가 자체 PageHero 를 렌더한다.
// TeamsProvider 중첩(안쪽 승리)으로 /p/ 하위의 useTeams/useTeamCodes 가 프로젝트 팀을 받는다 —
// 전역 화면(회의록·계정)은 (app)/layout 의 전역 Provider 그대로(스펙 §2).
export default async function ProjectLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const [{ projectId }, { actor, degraded }] = await Promise.all([params, getActorViewState()])
  // 존재 은닉(스펙 §3.2) — 내 워크스페이스에 없는 프로젝트(타 워크스페이스·미존재)는 404. 같은 워크스페이스의
  // 조회 전용(viewer)은 통과한다. 플랫폼 관리자도 없는 pid 는 404 — 페이지 스트리밍이 시작되면 404 가 빈 화면이
  // 되므로 레이아웃에서 먼저 가른다. 권한 조회 실패(degraded)는 404 가 아니다 — 장애를 '없는 프로젝트'로
  // 위장하지 않고 (app)/layout 의 열화 표시를 그대로 둔다(쓰기는 서버 액션 가드가 다시 막는다).
  // getActor 는 요청당 cache() 라 (app)/layout 과 같은 조립을 재사용한다.
  if (!degraded && isHiddenProject(actor, projectId)) notFound()
  // 여기까지 온 actor null 은 degraded 뿐이다 — 가시성을 모르므로 service_role 팀 캐시를 읽지 않는다(fail-closed,
  // members 페이지와 같은 결). 읽으면 타 워크스페이스 pid 의 팀이 TeamsProvider 페이로드로 나간다.
  const teams = actor ? teamsForProjectSync(projectId).filter(t => t.active) : []
  return (
    <TeamsProvider teams={teams}>
      <div className="h-full min-h-0 min-w-0">{children}</div>
    </TeamsProvider>
  )
}
