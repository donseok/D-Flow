import { getActorViewState } from '@/lib/authz'
import { getDisplayName } from '@/lib/auth'
import { readCurrentWorkspace } from '@/lib/workspace/current'
import { listMyWorkspaces } from '@/lib/workspace/list'
import { loadShell, minimalShell } from '@/lib/shell/loadShell'
import { activeTeamsForWorkspacesSync } from '@/lib/teams/master'
import { AppShell } from '@/components/app/AppShell'
import { ScopeProvider } from '@/components/app/ScopeContext'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import type { Team } from '@/lib/domain/teams'

/**
 * (global) — 슬러그 없는 화면(/account·/admin/llm-config·/admin/ui-states). 쿠키 워크스페이스(dflow-ws)의 내비를 그리되 활성 항목이 없다(개정 §5.3.1).
 * 쿠키는 기본값 힌트일 뿐이다 — readCurrentWorkspace 가 소속을 다시 보고 위조·탈퇴·형식 밖이면 첫 소속으로 간다(플랫폼 관리자도 소속만).
 * ws.llm·ws.ui_states 의 href 는 절대 경로다. 소속 0 이면 내비 없이 계정 메뉴만. 소속 조회 오류는 던진다(소속 0 으로 위장하지 않는다).
 * 쿠키를 쓰지 않는다(ShellScope 를 그리지 않는다 — D3).
 */
export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  const [{ actor, degraded }, cur, mine, userName] = await Promise.all([getActorViewState(), readCurrentWorkspace(), listMyWorkspaces(), getDisplayName()])
  if (!cur.ok) throw new Error(`현재 워크스페이스를 불러오지 못했습니다: ${cur.error}`)
  if (!mine.ok) throw new Error(`소속 목록을 불러오지 못했습니다: ${mine.error}`)
  if (!cur.ws) {
    return (
      <ScopeProvider value={{ workspace: null, projectId: null }}>
        <TeamsProvider teams={[]}>
          <AppShell {...minimalShell({ scope: 'global', projectId: null, workspaces: [], userName, degraded })}>{children}</AppShell>
        </TeamsProvider>
      </ScopeProvider>
    )
  }
  const shell = await loadShell({ scope: 'global', ws: cur.ws, actor, degraded, viewingAsPlatformAdmin: false, workspaces: mine.rows, userName })
  let teams: Team[] = []
  if (actor) {
    try { teams = activeTeamsForWorkspacesSync([cur.ws.id]) }
    catch (e) { console.error('[global layout] 팀 조회 실패 — 팀 없이 그린다:', e instanceof Error ? e.message : e) }
  }
  return (
    <ScopeProvider value={{ workspace: cur.ws, projectId: null }}>
      <TeamsProvider teams={teams}><AppShell {...shell}>{children}</AppShell></TeamsProvider>
    </ScopeProvider>
  )
}
