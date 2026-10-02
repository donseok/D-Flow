import { getActorViewState } from '@/lib/authz'
import { getDisplayName } from '@/lib/auth'
import { readCurrentWorkspace } from '@/lib/workspace/current'
import { listMyWorkspaces } from '@/lib/workspace/list'
import { loadShell, minimalShell } from '@/lib/shell/loadShell'
import { activeTeamsForWorkspacesSync } from '@/lib/teams/master'
import { AppShell } from '@/components/app/AppShell'
import { ScopeProvider } from '@/components/app/ScopeContext'
import { ShellScope } from '@/components/app/ShellScope'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import type { Team } from '@/lib/domain/teams'

/**
 * (global) — 슬러그 없는 화면(/account·/admin/llm-config·/admin/ui-states). 쿠키 워크스페이스(dflow-ws)의 내비를 그리되 활성 항목이 없다(개정 §5.3.1).
 * 쿠키는 기본값 힌트일 뿐이다 — readCurrentWorkspace 가 소속을 다시 보고 위조·탈퇴·형식 밖이면 첫 소속으로 간다(플랫폼 관리자도 소속만).
 * ws.llm·ws.ui_states 의 href 는 절대 경로다. 소속 0 이면 내비 없이 계정 메뉴만. 소속 조회 오류는 던진다(소속 0 으로 위장하지 않는다).
 * 그 워크스페이스를 범위로 게시한다(<ShellScope persist={false}> — U2b-5 리뷰 수정 CC4): 게시가 없으면 프로젝트 없는 AI 질문이 400, 사용 기록이
 * 공백이었다(D26 은 UI-2b 뒤 프로젝트 없는 챗이 400 이 되지 않을 것을 전제한다). persist=false 라 쿠키·방문은 쓰지 않는다(D3 — 쓰는 곳은 범위
 * 레이아웃 하나). 게시하는 것은 이 레이아웃이 소속을 다시 본 값뿐이라 직전 범위가 새지 않는다(Z7 — 범위 레이아웃의 해제와 같은 커밋에 교체).
 * 소속 0 이면 게시하지 않는다(범위 없음 — AI 진입점은 AssistantChat 이 닫는다).
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
      <TeamsProvider teams={teams}>
        <ShellScope workspace={cur.ws} projectId={null} projects={shell.projects.map((p) => ({ id: p.id, name: p.name }))} persist={false} />
        <AppShell {...shell}>{children}</AppShell>
      </TeamsProvider>
    </ScopeProvider>
  )
}
