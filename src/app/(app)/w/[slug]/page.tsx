import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { getMyWork, getProjectRows, getWorkspaceAnnouncements } from '@/lib/data/portal'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { HomeSections } from '@/components/portal/HomeSections'

export const metadata = { title: '홈' }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)

/** 워크스페이스 홈 v0(D20) — 섹션 셋. 포털 v1(요약 수치·위젯 레지스트리)은 UI-3 */
export default async function WorkspaceHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                   // 첫 await — 비소속 404
  const actor = scope.actor
  const now = new Date()                                                         // 세 섹션의 '오늘'이 한 순간을 본다(SP5 계획 P8 — 범위 tz 는 로더가 정한다)
  const [work, projects, announcements] = actor
    ? await Promise.all([
      getMyWork(scope.ws.id, actor, { limit: 20, now }),
      getProjectRows(scope.ws.id, actor, { status: 'active', limit: 20, now }),
      getWorkspaceAnnouncements(scope.ws.id, actor, { limit: 5, now }),
    ])
    : [null, null, null]                                                         // 열화 — 로더를 부르지 않고 섹션마다 실패를 보인다
  return (
    <PageFrame width="portal" header={<PageHeader title="홈" />}>
      <HomeSections slug={scope.ws.slug} work={work} projects={projects} announcements={announcements} />
    </PageFrame>
  )
}
