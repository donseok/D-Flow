import { redirect } from 'next/navigation'
import { requireModulePage } from '@/lib/modules/pageGate'

/**
 * 프로젝트 뿌리 경로(/p/{id}) — 북마크·공유 링크가 404 가 되지 않게 그 프로젝트의 기본 화면(개요)으로 보낸다(BUG-19).
 * 개요(dashboard)는 core 모듈이라 꺼질 수 없다 — 내비의 첫 항목(p.overview)과 같은 화면이다. 설정을 읽지 않는다.
 * 없는 프로젝트·다른 워크스페이스·명단 밖 비공개는 다른 프로젝트 화면과 같은 404 다: 레이아웃의 판정에 더해, 병렬로 도는 이 페이지도
 * 같은 관문(requireModulePage — 숨김 재판정)을 먼저 지난다. 그래야 redirect 응답이 "있는 프로젝트"의 오라클이 되지 않는다.
 */
export default async function ProjectRootPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'dashboard')
  redirect(`/p/${projectId}/dashboard`)
}
