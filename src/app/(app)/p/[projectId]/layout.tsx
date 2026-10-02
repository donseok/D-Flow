import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { getDisplayName } from '@/lib/auth'
import { isHiddenProject } from '@/lib/domain/authz'
import { workspaceRefById } from '@/lib/workspace/resolve'
import { listMyWorkspaces } from '@/lib/workspace/list'
import { loadShell, minimalShell } from '@/lib/shell/loadShell'
import { workspaceIconHref } from '@/lib/settings/displayBranding'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { teamsForProjectSync } from '@/lib/teams/master'
import { AppShell } from '@/components/app/AppShell'
import { ScopeProvider } from '@/components/app/ScopeContext'
import { ShellScope } from '@/components/app/ShellScope'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import type { Team } from '@/lib/domain/teams'

type Params = Promise<{ projectId: string }>

/** /p/* 는 그 프로젝트의 워크스페이스 마크(★8). 숨김 프로젝트는 아이콘도 내지 않는다(존재 은닉) */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const [{ projectId }, { actor }] = await Promise.all([params, getActorViewState()])
  if (!actor || isHiddenProject(actor, projectId)) return {}
  const wid = actor.projectWorkspace.get(projectId)
  if (!wid) return {}
  try { const icon = workspaceIconHref(await getWorkspaceConfig(wid)); return icon ? { icons: { icon } } : {} }
  catch (e) { console.error('[project layout] 아이콘 판독 실패:', e instanceof Error ? e.message : e); return {} }
}

/**
 * 프로젝트 범위 셸(스펙 §5.4.1). 존재 은닉(스펙 §3.2) — 내 워크스페이스에 없는 프로젝트(타 워크스페이스·미존재)는 404 이고, 그때는 셸 데이터
 * (워크스페이스 이름·프로젝트 목록·브랜드)도 조회하지 않는다. 같은 워크스페이스의 조회 전용(viewer)은 통과한다. 플랫폼 관리자도 없는 pid 는 404.
 * 권한 조회 실패(degraded)는 404 가 아니다 — 워크스페이스를 모르므로 내비 없는 최소 셸(열화 알림)로 그리고 service_role 팀 캐시를 읽지 않는다(fail-closed).
 * 워크스페이스 id 는 actor.projectWorkspace(조회 없음, D38), 슬러그·이름은 workspaceRefById(세션 RLS). 그 행이 안 보이면 최소 셸, 조회 오류는 오류 경계.
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  const [{ projectId }, { actor, degraded }, mine, userName] = await Promise.all([params, getActorViewState(), listMyWorkspaces(), getDisplayName()])
  if (!degraded && isHiddenProject(actor, projectId)) notFound()
  if (!mine.ok) throw new Error(`소속 목록을 불러오지 못했습니다: ${mine.error}`)
  const wid = actor?.projectWorkspace.get(projectId) ?? null
  const ref = wid ? await workspaceRefById(wid) : null
  if (ref && !ref.ok && ref.kind === 'unavailable') throw new Error(`워크스페이스를 조회하지 못했습니다: ${ref.error}`)
  if (!ref || !ref.ok) {
    if (ref) console.error('[project layout] 프로젝트의 워크스페이스 행이 보이지 않는다 — 내비 없이 그린다:', projectId)
    return (
      <ScopeProvider value={{ workspace: null, projectId }}>
        <TeamsProvider teams={[]}>
          <AppShell {...minimalShell({ scope: 'project', projectId, workspaces: mine.rows, userName, degraded: true })}>{children}</AppShell>
        </TeamsProvider>
      </ScopeProvider>
    )
  }
  const ws = ref.ws
  // 칩·비기록은 권한 조회와 무관한 실제 소속 목록으로 정한다(AA6) — 비소속인데 여기까지 왔으면 플랫폼 관리자 보기다(열화로 actor 가 없어도)
  const member = mine.rows.some((r) => r.id === ws.id)
  const viewingAsPlatformAdmin = !member
  const shell = await loadShell({ scope: 'project', ws, actor, degraded, projectId, viewingAsPlatformAdmin, workspaces: mine.rows, userName })
  let teams: Team[] = []
  if (actor) {
    try { teams = teamsForProjectSync(projectId).filter((t) => t.active) }
    catch (e) { console.error('[project layout] 팀 조회 실패 — 팀 없이 그린다:', e instanceof Error ? e.message : e) }
  }
  return (
    <ScopeProvider value={{ workspace: ws, projectId }}>
      <TeamsProvider teams={teams}>
        <ShellScope workspace={ws} projectId={projectId} projects={shell.projects.map((p) => ({ id: p.id, name: p.name }))} persist={member} />
        <AppShell {...shell}>{children}</AppShell>
      </TeamsProvider>
    </ScopeProvider>
  )
}
