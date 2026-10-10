'use server'

import { getActorForView } from '@/lib/authz'
import { serverTranslator } from '@/lib/i18n/server'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { isProjectMember } from '@/lib/domain/authz'
import { requireModule } from '@/lib/modules/gate'
import { getSeatmap, type SeatmapOptions } from '@/lib/data/agentSeatmap'
import { SEATMAP_SCOPES, type Seatmap, type SeatmapScope } from '@/lib/domain/seatmap'
import { UUID_RE } from '@/lib/domain/validate'

/**
 * 좌석표 재조회(30초 폴링). 페이지와 같은 게이트를 다시 검사한다 — 액션은 URL 로도 불릴 수 있다.
 * projectId 가 있으면 프로젝트 스튜디오(/p/[id]/agents/office): 형식 검증 → 멤버 검증 → 그 층 하나만(멤버면 그 워크스페이스에 역할이 있다).
 * 없으면 전체 좌석표(/w/[slug]/agents): 인자 workspaceId 에 역할(canViewAgents) → 그 워크스페이스 층만(D21·D26).
 */
export async function refreshSeatmap(scope: SeatmapScope = 'mine', projectId?: string, workspaceId?: string): Promise<{ ok: true; seatmap: Seatmap } | { ok: false; error: string }> {
  const t = await serverTranslator()
  const actor = await getActorForView()
  if (!actor) return { ok: false, error: t('common.err.denied') }
  if (!SEATMAP_SCOPES.includes(scope)) return { ok: false, error: t('srv.agentSeatmap.scopeValueNotValid') } // 액션 인자는 클라이언트 입력이다
  const opts: SeatmapOptions = {}
  if (projectId !== undefined) {
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return { ok: false, error: t('srv.agentSeatmap.projectValueNotValid') }
    if (!isProjectMember(actor, projectId)) return { ok: false, error: t('common.err.denied') }
    opts.projectId = projectId
  } else {
    // 전체 좌석표 — 인자 워크스페이스(D26). 소속·역할이 없으면 존재를 드러내지 않고 같은 문구. 플랫폼 관리자는 canViewAgents 가 어떤
    // 값이든 통과시켜 형식 밖 값이 설정 조회(22P02)까지 가 로그에 실리므로 형식을 먼저 본다(U2a-4 리뷰 T5). 그 밖의 사람은 소속 맵 조회에서 끝난다
    if (typeof workspaceId !== 'string' || (actor.isSuperuser && !UUID_RE.test(workspaceId)) || !canViewAgents(actor, workspaceId)) {
      return { ok: false, error: t('common.err.denied') }
    }
    opts.workspaceId = workspaceId
  }
  // 프로젝트 층이면 그 프로젝트, 전체 좌석표면 인자 워크스페이스. 층 행은 getSeatmap 이 다시 거른다(seatmapFloorIds).
  // 권한 판정(가드)을 지난 뒤에 둔다 — 남의 프로젝트·워크스페이스·형식이 틀린 id 는 설정을 읽기 전에 기존 문구로 끝난다
  const mod = opts.projectId ? await requireModule({ projectId: opts.projectId }, 'agents') : await requireModule({ workspaceId: opts.workspaceId! }, 'agents')
  if (!mod.ok) return { ok: false, error: mod.error }
  try {
    return { ok: true, seatmap: await getSeatmap(actor, Date.now(), scope, { ...opts, t: await serverTranslator() }) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[seatmap] 재조회 실패:', msg)
    return { ok: false, error: t('srv.agentSeatmap.couldNotReloadSeatMap') }
  }
}
