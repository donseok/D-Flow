import { getSession } from '@/lib/auth'
import { displayNameFrom } from '@/lib/domain/display-name'
import { listProjectsWithState } from '@/app/actions/project'
import { AccountView } from '@/components/account/AccountView'
import { listMyWorkspaces } from '@/lib/workspace/list'
import { readCurrentWorkspace } from '@/lib/workspace/current'
import { getAccountPrefs, getWorkspacePrefs } from '@/app/actions/preferences'
import { loadWorkspaceNotifyOff } from '@/lib/notify/workspaceOff'

export const dynamic = 'force-dynamic'

/**
 * 내 계정 — 프로필·비밀번호 변경·PAT 발급/관리(결정 D). 비로그인은 middleware 가 /login 으로
 * 리다이렉트하므로 여기서 별도 가드는 두지 않는다((app) 레이아웃 관례).
 */
export default async function AccountPage() {
  const [user, projectState, cur, acc, workspaceMemberships] = await Promise.all([getSession(), listProjectsWithState(), readCurrentWorkspace(),
    // 알림 토글이 지금 값을 그린다 — 조회 실패를 기본값으로 위장하지 않는다(null 로 내려 그 절만 닫는다)
    getAccountPrefs({ strict: true }).catch((e: unknown) => { console.error('[account] 계정 선호 조회 실패:', e); return null }),
    listMyWorkspaces(),
  ])
  if (!cur.ok) console.error('[account] 현재 워크스페이스 조회 실패:', cur.error)
  const ws = cur.ok ? cur.ws : null
  const wsPrefs = ws ? await getWorkspacePrefs(ws.id, { strict: true }).catch((e: unknown) => {
    console.error('[account] 워크스페이스 선호 조회 실패:', e)
    return null
  }) : {}
  // 소속 워크스페이스가 정책으로 끈 알림 유형 — 소속 목록을 못 읽었으면 표시하지 않는다(목록 조회가 이미 로그를 남겼다)
  const workspaceOff = workspaceMemberships.ok ? await loadWorkspaceNotifyOff(workspaceMemberships.rows) : {}
  const email = user?.email ?? null
  const displayName = user ? displayNameFrom(user.user_metadata, user.email) : null

  return (
    <AccountView
      email={email}
      displayName={displayName}
      projects={projectState.projects.map(p => ({ id: p.id, name: p.name, workspace_id: p.workspace_id }))}
      tokenWorkspaces={workspaceMemberships.ok ? workspaceMemberships.rows.map(w => ({ id: w.id, name: w.name })) : []}
      tokenWorkspaceError={!workspaceMemberships.ok}
      currentWorkspace={ws ? { id: ws.id, name: ws.name } : null}
      currentWorkspaceError={!cur.ok || wsPrefs === null}
      startPage={wsPrefs?.startPage ?? null}
      projectsView={acc?.projectsView === 'cards' ? 'cards' : 'rows'}
      notif={acc ? (acc.notif ?? {}) : null}
      workspaceOff={workspaceOff}
    />
  )
}
