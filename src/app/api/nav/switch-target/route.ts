/**
 * 프로젝트 전환의 '같은 모듈 유지'(D41, 개정 §5.3.6) — 세션 라우트(읽기 전용). 대상의 모듈 집합은 effectiveModules 를 직접 받아(moduleSetFor 는
 * 실패를 core 로 위장한다) 판독 실패면 degraded 개요를 낸다 — '사용하지 않는 모듈'로 위장하지 않는다.
 * 숨김·미존재·내 워크스페이스 밖·명단 밖 비공개 대상은 같은 404(존재 은닉, 판정 W12·GG1 — 레이아웃 404 와 같은 판정자 isHiddenProject). href 는 switchTarget 이
 * 늘 /p/<대상>/… 로 만든다(path·query 는 모듈 조각·보기 키만 쓰인다).
 * 열화(권한 조회 실패)와 비공개 판정 실패는 숨김을 판정할 수 없으므로 대상의 모듈을 읽지 않고 개요로 보낸다 — 이동만 하고 쓰기는 없다, 개요 페이지가
 * (레이아웃이) 자기 판정을 한다. 비공개 판정은 권한 조회와 병렬(요청 캐시)이다.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { isHiddenProject } from '@/lib/domain/authz'
import { UUID_RE } from '@/lib/domain/validate'
import { effectiveModules } from '@/lib/modules/effective'
import { switchTarget } from '@/lib/nav/switchTarget'

export const dynamic = 'force-dynamic'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const pid = (sp.get('project') ?? '').toLowerCase()
  const path = sp.get('path') ?? ''
  const query = sp.get('query') ?? ''
  if (!UUID_RE.test(pid) || !path.startsWith('/') || path.length > 512 || query.length > 1024) return json({ error: 'bad_request' }, 400)
  // 판정자는 쿼리 오류만 로그한다 — 그 밖의 실패도 여기서 남기고(원칙 ①), Next 제어 신호는 삼키지 않는다(HH3)
  const hiddenOrNull = getHiddenProjectIds().catch((e: unknown) => {
    unstable_rethrow(e)
    console.error('[switch-target] 비공개 판정 실패 — 개요로:', e instanceof Error ? e.message : e)
    return null
  })
  const [{ actor, degraded }, hidden] = await Promise.all([getActorViewState(), hiddenOrNull])
  const overview = { href: `/p/${pid}/dashboard`, fallbackModule: null, degraded: true as const }
  if (degraded) return json(overview)
  if (!actor) return json({ error: 'unauthorized' }, 401)
  if (!hidden) return json(overview)   // 비공개 판정 실패(로그는 위) — 열화와 같이
  const workspaceId = actor.projectWorkspace.get(pid)
  if (!workspaceId || isHiddenProject(actor, pid, hidden)) return json({ error: 'not_found' }, 404)
  try {
    const targetModules = await effectiveModules({ workspaceId, projectId: pid })
    return json(switchTarget({ pathname: path, search: query, targetProjectId: pid, targetModules }))
  } catch (e) {
    console.error('[switch-target] 대상 모듈 판독 실패 — 개요로:', pid, e instanceof Error ? e.message : e)
    return json(overview)
  }
}
