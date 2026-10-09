import { isWorkspaceAdmin, type AccountTarget, type Actor, type WorkspaceRole } from '@/lib/domain/authz'
import { fetchAllPages } from '@/lib/data/paging'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * 계정 관리 화면(/w/[slug]/admin/accounts) — 슬러그 워크스페이스의 관리자(플랫폼 관리자 포함, D22·§10.1 #9). 화면 안의 플랫폼 전용 조작
 * (setPlatformAdmin)은 actor.isSuperuser 일 때만 렌더하고 액션 가드는 그대로 requireSuperuser 다. 비밀번호 재설정·워크스페이스에서 제거는
 * 행마다 판정이 갈린다 — 순수 판정(domain/authz 의 passwordResetVerdict·memberRemovalVerdict)의 결과를 목록 행에 실어 내린다.
 */
export function canManageWorkspaceAccounts(actor: Actor | null, workspaceId: string): boolean {
  return !!workspaceId && isWorkspaceAdmin(actor, workspaceId)
}

type AdminClient = ReturnType<typeof createAdminClient>
/** `.in('user_id', …)` 한 번에 싣는 id 수 — uuid 100개가 주소 길이 한도 안이다 */
const ID_CHUNK = 100

/**
 * 대상 계정들의 등급 축(플랫폼 관리자 여부·**모든** 워크스페이스 소속) — 계정 조작 판정의 입력.
 * service_role 로 읽는다: 행위자가 속하지 않은 워크스페이스의 소속까지 봐야 "다른 워크스페이스에도 속한 계정" 을 가를 수 있다(세션 RLS 는
 * 자기 워크스페이스 행만 낸다 — 그걸로 판정하면 다른 소속이 없는 것처럼 보여 경계가 열린다). 그래서 이 값은 서버 안에서만 쓰고 판정 결과만 내린다.
 * 실패는 throw — '관리자가 아니다'·'다른 소속 없음' 으로 폴백하면 가드가 그 순간 사라진다. 소속은 끝까지 읽는다(잘린 목록 = 없는 소속).
 * 조회에 없는 id 도 결과에 싣는다(소속 0·플랫폼 관리자 아님) — 호출부가 not_member 로 판정한다.
 */
export async function loadAccountTargets(admin: AdminClient, userIds: readonly string[]): Promise<Map<string, AccountTarget>> {
  const ids = [...new Set(userIds)]
  const platform = new Set<string>()
  const roles = new Map<string, Map<string, WorkspaceRole>>(ids.map(id => [id, new Map()]))
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    const [pa, members] = await Promise.all([
      admin.from('platform_admins').select('user_id').in('user_id', chunk),
      fetchAllPages<{ user_id: string; workspace_id: string; role: WorkspaceRole }>('계정 소속', (from, to) => admin
        .from('workspace_members').select('user_id, workspace_id, role', { count: 'exact' })
        .in('user_id', chunk).order('user_id').order('workspace_id').range(from, to)),
    ])
    if (pa.error || !pa.data) throw new Error(`플랫폼 관리자 조회 실패: ${pa.error?.message ?? 'unknown'}`)
    for (const r of pa.data as Array<{ user_id: string }>) platform.add(r.user_id)
    for (const r of members) roles.get(r.user_id)?.set(r.workspace_id, r.role)
  }
  return new Map(ids.map(id => [id, { userId: id, isPlatformAdmin: platform.has(id), workspaceRoles: roles.get(id)! }]))
}
