// 초대 허용 도메인 조회 — 발급(createProjectInvite)과 소비 경로 셋(inviteRedeem)이 같은 판정을 쓴다.
// 서비스 롤 클라이언트를 호출부에서 받는다: 초대 링크 소비는 인증 게이트가 없는 공개 경로라 세션 RLS 로는 읽을 수 없다.
// 스코프는 인자의 워크스페이스 id 하나(초대 행·프로젝트 행이 정한 값)로만 좁힌다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveInviteDomains } from '@/lib/domain/invites'

/**
 * 그 워크스페이스의 허용 도메인(설정이 비었거나 행이 없으면 env INVITE_ALLOWED_DOMAINS).
 * 조회 실패는 `ok: false` — 보안 가드라 fail-closed: 호출부는 발급·수락을 중단한다. env 로 폴백하지 않는다
 * (워크스페이스가 env 보다 좁게 설정해 둔 목록을 DB 장애가 조용히 넓히면 안 된다).
 * 매 호출마다 읽는다 — 관리자가 목록을 좁히면 이미 나간 초대도 즉시 막혀야 한다.
 */
export async function loadInviteDomains(
  admin: SupabaseClient, workspaceId: string,
): Promise<{ ok: true; domains: string[] } | { ok: false }> {
  const { data, error } = await admin
    .from('workspace_settings').select('allowed_domains').eq('workspace_id', workspaceId).maybeSingle()
  if (error) {
    console.error('[inviteDomains] 워크스페이스 설정 조회 실패:', error.message)
    return { ok: false }
  }
  const row = data as { allowed_domains: string[] | null } | null
  return { ok: true, domains: resolveInviteDomains(row?.allowed_domains ?? null, process.env.INVITE_ALLOWED_DOMAINS) }
}
