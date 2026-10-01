import { redirect } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { isHiddenProject } from '@/lib/domain/authz'
import { BRAND } from '@/lib/branding'
import { readCurrentWorkspace } from '@/lib/workspace/current'
import { resolveStartPath } from '@/lib/workspace/startPage'
import { getWorkspacePrefs } from '@/app/actions/preferences'
import { NoWorkspaceView } from '@/components/workspace/NoWorkspaceView'
import { StatusMessage } from '@/components/ui/StatusMessage'

/** 루트 리졸버(D44, §5.3) — 현재 워크스페이스(쿠키 → 첫 소속)의 시작 화면으로. 소속 0 은 안내, 조회 오류는 오류 화면(위장 금지) */
export default async function Root() {
  const [cur, { actor }] = await Promise.all([readCurrentWorkspace(), getActorViewState()])
  if (!cur.ok) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-4 px-4">
        <h1 className="text-title text-fg">{BRAND.productName}</h1>
        <StatusMessage kind="partial_error" blocking title="워크스페이스 정보를 불러오지 못했습니다" detail="잠시 뒤 새로고침하세요. 계속되면 관리자에게 알려 주세요." />
      </main>
    )
  }
  if (!cur.ws) return <NoWorkspaceView isPlatformAdmin={actor?.isSuperuser === true} />
  const ws = cur.ws
  const prefs = await getWorkspacePrefs(ws.id)
  // 그 워크스페이스의 프로젝트 중 레이아웃이 404 로 숨기지 않는 것(조회 전용 포함 — isHiddenProject 와 같은 축). 열화면 판정 불가 → 홈
  redirect(resolveStartPath(ws, prefs, (pid) => !!actor && actor.projectWorkspace.get(pid) === ws.id && !isHiddenProject(actor, pid)))
}
