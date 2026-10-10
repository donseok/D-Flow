/**
 * 꺼진 모듈 화면의 안내(BUG-22) — 세션 라우트(읽기 전용). 모듈이 꺼진 화면은 페이지 관문이 notFound() 로 닫는다(없는 화면과 같은 404 — 존재 은닉).
 * 그 404 화면(src/app/not-found.tsx)이 이 라우트에 자기 주소를 물어, **그 범위를 볼 수 있는 사람에게만** "이 기능은 꺼져 있습니다"로 바꿔 보인다.
 * 페이지의 응답(상태·notFound 표지)은 그대로다 — 액션·API 의 ERR_MODULE_DISABLED 동작도 바꾸지 않는다.
 *
 * 정보 노출: 답은 둘뿐이다 — { off: false }(그 밖의 전부) 와 { off: true, … }. off:true 는 아래를 모두 지난 때만이다.
 *  - 프로젝트 화면: 레이아웃과 같은 판정자(isHiddenProject + getHiddenProjectIds)로 **보이는 프로젝트**(같은 워크스페이스·명단 밖 비공개 아님)
 *  - 워크스페이스 화면: 그 워크스페이스의 소속(workspaceRoleIn — 보관된 워크스페이스는 없음)
 *  - 그 모듈이 실제로 꺼짐(effectiveModules 에 없음). 판독 실패·열화·비로그인·없는 주소·권한 없음은 전부 { off: false } — 평범한 404 와 구별되지 않는다.
 * 보이는 프로젝트의 구성원은 내비에서 이미 어느 메뉴가 없는지 본다 — 이 답이 더 알려 주는 것은 없다.
 * 설정 링크는 고칠 수 있는 사람에게만: 프로젝트에서 끈 모듈 = 프로젝트 관리자, 워크스페이스에서 허용하지 않은 모듈 = 워크스페이스 관리자.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { isHiddenProject, isProjectAdmin, isWorkspaceAdmin, workspaceRoleIn } from '@/lib/domain/authz'
import { effectiveModules } from '@/lib/modules/effective'
import { moduleOfPath } from '@/lib/modules/pathModule'
import { resolveWorkspaceBySlug, workspaceRefById } from '@/lib/workspace/resolve'

export const dynamic = 'force-dynamic'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const NO = { off: false as const }

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') ?? ''
  if (!path.startsWith('/') || path.length > 512) return json({ error: 'bad_request' }, 400)
  const target = moduleOfPath(path)
  if (!target) return json(NO)
  try {
    const { actor, degraded } = await getActorViewState()
    if (degraded || !actor) return json(NO)
    let workspaceId: string, slug: string, projectId: string | null = null
    if (target.scope === 'project') {
      const wid = actor.projectWorkspace.get(target.projectId)
      if (!wid || isHiddenProject(actor, target.projectId, await getHiddenProjectIds())) return json(NO)
      const ref = await workspaceRefById(wid)
      if (!ref.ok) return json(NO)
      workspaceId = wid; slug = ref.ws.slug; projectId = target.projectId
    } else {
      const ref = await resolveWorkspaceBySlug(target.slug)
      if (!ref.ok || workspaceRoleIn(actor, ref.ws.id) === null) return json(NO)
      workspaceId = ref.ws.id; slug = ref.ws.slug
    }
    const workspaceSet = await effectiveModules({ workspaceId })
    // 워크스페이스 층에서 이미 없으면 워크스페이스가 허용하지 않은 것이다(프로젝트 설정으로는 켤 수 없다)
    if (!workspaceSet.has(target.moduleId)) {
      return json({ off: true, layer: 'workspace', module: target.moduleId,
        settingsHref: isWorkspaceAdmin(actor, workspaceId) ? `/w/${encodeURIComponent(slug)}/settings#workspace-modules` : null })
    }
    if (!projectId) return json(NO)                                   // 워크스페이스 화면인데 모듈은 켜져 있다 — 다른 이유의 404
    const projectSet = await effectiveModules({ workspaceId, projectId })
    if (projectSet.has(target.moduleId)) return json(NO)              // 켜져 있다 — 다른 이유의 404(없는 하위 주소 등)
    return json({ off: true, layer: 'project', module: target.moduleId,
      settingsHref: isProjectAdmin(actor, projectId) ? `/p/${projectId}/settings#project-modules` : null })
  } catch (e) {
    unstable_rethrow(e)
    // 판독 실패는 "꺼짐"으로 단정하지 않는다 — 원인은 로그, 화면은 평범한 404 그대로
    console.error('[module-off] 판정 실패 — 안내 없이 404 그대로:', e instanceof Error ? e.message : e)
    return json(NO)
  }
}
