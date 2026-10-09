import { redirect, unstable_rethrow } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { isHiddenProject } from '@/lib/domain/authz'
import { canManageWorkspaces } from '@/lib/authz/platformWorkspacesAccess'
import { BRAND } from '@/lib/branding'
import { readCurrentWorkspace } from '@/lib/workspace/current'
import { resolveStartPath } from '@/lib/workspace/startPage'
import { getWorkspacePrefs } from '@/app/actions/preferences'
import { NoWorkspaceView } from '@/components/workspace/NoWorkspaceView'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { getServerLocale } from '@/lib/i18n/server'

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
  if (!cur.ws) return <NoWorkspaceView isPlatformAdmin={canManageWorkspaces(actor)} locale={await getServerLocale()} />
  const ws = cur.ws
  // 비공개 판정 실패는 '숨김 판정 불가'다 — 최근 프로젝트를 고르지 않는다. 판정자는 쿼리 오류만 로그하므로 여기서도 남기고(원칙 ①),
  // Next 제어 신호는 삼키지 않는다(HH3). 선호 조회와 병렬(직렬 왕복 없음)
  const [prefs, hidden] = await Promise.all([getWorkspacePrefs(ws.id), getHiddenProjectIds().catch((e: unknown) => {
    unstable_rethrow(e)
    console.error('[root] 비공개 판정 실패 — 최근 프로젝트를 고르지 않고 홈으로:', e instanceof Error ? e.message : e)
    return null
  })])
  // 그 워크스페이스의 프로젝트 중 레이아웃이 404 로 숨기지 않는 것(조회 전용 포함 — 같은 판정자 isHiddenProject, 명단 밖 비공개 제외 GG1).
  // 열화·비공개 판정 실패면 판정 불가 → 홈
  redirect(resolveStartPath(ws, prefs, (pid) => !!actor && !!hidden && actor.projectWorkspace.get(pid) === ws.id && !isHiddenProject(actor, pid, hidden)))
}
