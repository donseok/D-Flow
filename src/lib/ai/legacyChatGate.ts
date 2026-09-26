import { NextResponse } from 'next/server'
import { listProjectsWithState } from '@/app/actions/project'

/**
 * 레거시 챗 라우트(/api/chat·/api/chat/stream·/api/chat/context)의 projectId 관문 — v2 의 validateChatProjectScope 자리.
 * 본문·쿼리의 projectId 는 클라이언트 입력이다. 호출자가 볼 수 있는 프로젝트(RLS + canSeeProject 목록)에 없으면 404(다른 워크스페이스·
 * 없는 프로젝트를 구별하지 않는다), 목록을 못 읽었으면 500 — '없는 프로젝트'로 위장하지 않는다. 이 관문 없이 흘려보내면 세션 조회는
 * RLS 로 비어 오류 없이 지나가고, service_role 팀 캐시(담당 팀 코드)와 자가 치유 색인(admin upsert)이 다른 워크스페이스 프로젝트에
 * 닿는다(api/export 와 같은 판정). 통과면 null.
 */
export async function legacyChatProjectGate(projectId: string | null): Promise<NextResponse | null> {
  if (!projectId) return null
  const { projects, degraded } = await listProjectsWithState()
  if ((projects as Array<{ id: string }>).some(p => p.id === projectId)) return null
  if (degraded) return NextResponse.json({ error: '프로젝트 목록을 확인할 수 없습니다.' }, { status: 500 })
  return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
}
