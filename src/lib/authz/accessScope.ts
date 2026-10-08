import { BOT_READ_CAPABILITIES, type BotReadCapability } from '@/lib/ai/tools/types'
import type { SupabaseServerClient } from '@/lib/repositories/supabase/common'
import { canSeeProject } from '@/lib/domain/authz'
import { buildActor } from './buildActor'

/**
 * 세션 사용자의 접근 범위 확정 — 설계 §19의 공유 authz 경계.
 * 챗봇 외 기능도 재사용할 수 있도록 ai/chat 밖에 둔다(리뷰 L-1).
 * MySQL 전환 시 이 Resolver 어댑터만 교체한다.
 */
export interface AccessScope {
  allowedProjectIds: string[]
  /** allowedProjectIds 각 프로젝트의 워크스페이스 — 프로젝트 하나로 좁힌 검색의 워크스페이스 범위를 여기서 확정한다(요청 값이 아니다). */
  projectWorkspace: Record<string, string>
  /** 소속 워크스페이스 — 프로젝트 축 없는 입력(회의록 담당 팀 등)을 호출자 범위로 좁히는 근거. */
  workspaceIds: string[]
  /** 플랫폼 관리자 — 워크스페이스 축 입력을 전 워크스페이스로 본다(멤버십 없는 관리자가 빈 범위가 되지 않게). */
  isSuperuser: boolean
  capabilities: readonly BotReadCapability[]
}

export type AccessScopeResolution =
  | { ok: true; scope: AccessScope }
  | { ok: false; code: 'ACCESS_SCOPE_UNAVAILABLE'; retryable: boolean; detail?: string }

/** Storage-neutral boundary; a MySQL adapter can implement the same contract. */
export interface AccessScopeResolver {
  resolve(userId: string): Promise<AccessScopeResolution>
}

/**
 * Supabase/RLS adapter. A healthy zero-row result stays distinct from a failed scope lookup.
 *
 * 스코프 = 내 워크스페이스의 프로젝트(buildActor 의 projectWorkspace — 플랫폼 관리자는 전부) 중
 * canSeeProject 를 통과한 것. 비공개 프로젝트(0070)는 명단 역할 보유자·워크스페이스 관리자·플랫폼 관리자에게만 —
 * 목록에선 숨겼는데 챗봇이 답하면 숨김이 무색해진다.
 */
export function createSupabaseAccessScopeResolver(
  client: SupabaseServerClient,
): AccessScopeResolver {
  return {
    async resolve(userId) {
      // 권한 4축과 비공개 플래그는 서로 독립 — 한 왕복으로 겹친다. buildActor 는 실패 시 throw 하므로
      // 결과로 감싸 Promise.all 이 다른 쪽을 기다리게 한다.
      const [actorRes, projRes] = await Promise.all([
        buildActor(client, userId).then(
          actor => ({ ok: true as const, actor }),
          (e: unknown) => ({ ok: false as const, detail: e instanceof Error ? e.message : String(e) }),
        ),
        client.from('projects').select('id, is_private'),
      ])
      // 권한 축을 못 읽으면 스코프 전체를 내지 않는다 — '역할 없음'으로 폴백하면 비공개 판정이 조용히 틀어진다.
      if (!actorRes.ok) {
        return { ok: false, code: 'ACCESS_SCOPE_UNAVAILABLE', retryable: true, detail: actorRes.detail }
      }
      if (projRes.error || !projRes.data) {
        return {
          ok: false,
          code: 'ACCESS_SCOPE_UNAVAILABLE',
          retryable: true,
          ...(projRes.error?.message ? { detail: projRes.error.message } : {}),
        }
      }
      const { actor } = actorRes
      const projects = new Map<string, { id: string; is_private?: boolean | null }>()
      for (const p of projRes.data as Array<{ id: unknown; is_private?: boolean | null }>) {
        if (typeof p.id === 'string' && p.id.length > 0) projects.set(p.id, { id: p.id, is_private: p.is_private })
      }
      // 비공개 플래그를 확인하지 못한 프로젝트(두 조회 사이 생성 등)는 넣지 않는다 — fail-closed.
      const allowedProjectIds = [...actor.projectWorkspace.keys()].filter(pid => {
        const project = projects.get(pid)
        return project ? canSeeProject(actor, project) : false
      })
      const projectWorkspace: Record<string, string> = {}
      for (const pid of allowedProjectIds) {
        const wid = actor.projectWorkspace.get(pid)
        if (typeof wid === 'string' && wid.length > 0) projectWorkspace[pid] = wid
      }
      return {
        ok: true,
        scope: {
          allowedProjectIds,
          projectWorkspace,
          workspaceIds: [...actor.workspaceRoles.keys()],
          isSuperuser: actor.isSuperuser,
          capabilities: [...BOT_READ_CAPABILITIES],
        },
      }
    },
  }
}
