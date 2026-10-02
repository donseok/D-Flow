import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BRAND } from '@/lib/branding'
import { getActorViewState } from '@/lib/authz'
import { getDisplayName } from '@/lib/auth'
import { workspaceRoleIn } from '@/lib/domain/authz'
import { resolveWorkspaceBySlug } from '@/lib/workspace/resolve'
import { listMyWorkspaces } from '@/lib/workspace/list'
import { loadShell } from '@/lib/shell/loadShell'
import { displayBranding, workspaceIconHref } from '@/lib/settings/displayBranding'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { activeTeamsForWorkspacesSync } from '@/lib/teams/master'
import { AppShell } from '@/components/app/AppShell'
import { ScopeProvider } from '@/components/app/ScopeContext'
import { ShellScope } from '@/components/app/ShellScope'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import type { Team } from '@/lib/domain/teams'

type Params = Promise<{ slug: string }>

/** 제목 템플릿 '{화면} · {워크스페이스} | {제품}', 마크가 있으면 아이콘(S-6 — 메타데이터가 루트 파일 아이콘을 덮는다, C 실측) — V6·V7.
 *  레이아웃과 같은 은닉 판정을 거친다 — 404 가 될 워크스페이스의 이름을 제목으로 내지 않는다 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const [lookup, { actor, degraded }] = await Promise.all([resolveWorkspaceBySlug(slug), getActorViewState()])
  if (!lookup.ok || (!degraded && workspaceRoleIn(actor, lookup.ws.id) === null)) return {}
  let productName: string = BRAND.productName, icon: string | null = null
  try { const c = await getWorkspaceConfig(lookup.ws.id); productName = displayBranding(c).productName; icon = workspaceIconHref(c) }
  catch (e) { console.error('[workspace layout] 브랜딩 판독 실패:', e instanceof Error ? e.message : e) }
  return { title: { template: `%s · ${lookup.ws.name} | ${productName}`, default: `${lookup.ws.name} | ${productName}` }, ...(icon ? { icons: { icon } } : {}) }
}

/**
 * 워크스페이스 범위 셸(스펙 §5.4.1, D2·D7) — 1차 병렬(권한·슬러그·소속·이름) 뒤 존재 은닉을 끝내고 나서만 2차(loadShell)를 부른다.
 * 미존재·형식 밖·비소속(RLS 0행) 또는 (열화가 아니고) 역할 없음 → 404. 슬러그·소속 조회 오류 → 던진다((app)/error.tsx — 404 로 위장하지 않는다).
 * 페이지는 자기 첫 await(loadWorkspaceScope)로 다시 본다(E19 — 레이아웃 404 는 페이지 로더를 멈추지 못한다).
 * 플랫폼 관리자가 소속이 아닌 워크스페이스를 보면 칩을 달고, 현재 워크스페이스 쿠키·최근 방문은 쓰지 않는다(persist=false).
 */
export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  const { slug } = await params
  const [{ actor, degraded }, lookup, mine, userName] = await Promise.all([getActorViewState(), resolveWorkspaceBySlug(slug), listMyWorkspaces(), getDisplayName()])
  if (!lookup.ok) {
    if (lookup.kind === 'missing') notFound()
    throw new Error(`워크스페이스를 조회하지 못했습니다: ${lookup.error}`)
  }
  if (!mine.ok) throw new Error(`소속 목록을 불러오지 못했습니다: ${mine.error}`)
  const ws = lookup.ws
  const role = actor ? workspaceRoleIn(actor, ws.id) : null
  if (!degraded && role === null) notFound()
  // 칩·비기록은 권한 조회와 무관한 실제 소속 목록으로 정한다(AA6) — 비소속인데 여기까지 왔으면 플랫폼 관리자 보기다(열화로 actor 가 없어도)
  const member = mine.rows.some((r) => r.id === ws.id)
  const viewingAsPlatformAdmin = !member
  const shell = await loadShell({ scope: 'workspace', ws, actor, degraded, viewingAsPlatformAdmin, workspaces: mine.rows, userName })
  let teams: Team[] = []
  if (actor) {
    try { teams = activeTeamsForWorkspacesSync([ws.id]) }
    catch (e) { console.error('[workspace layout] 팀 조회 실패 — 팀 없이 그린다:', e instanceof Error ? e.message : e) }
  }
  return (
    <ScopeProvider value={{ workspace: ws, projectId: null }}>
      <TeamsProvider teams={teams}>
        <ShellScope workspace={ws} projectId={null} projects={shell.projects.map((p) => ({ id: p.id, name: p.name }))} persist={member} />
        <AppShell {...shell}>{children}</AppShell>
      </TeamsProvider>
    </ScopeProvider>
  )
}
