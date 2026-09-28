// 초대 허용 도메인 조회 — 발급(createProjectInvite)과 소비 경로 셋(inviteRedeem)이 같은 판정을 쓴다. 워크스페이스 해석기를 읽는다(R7).
// 서비스 롤 클라이언트를 호출부에서 받는다: 초대 링크 소비는 인증 게이트가 없는 공개 경로라 세션 RLS 로는 읽을 수 없다.
// 조회 실패·손상은 ok:false — 보안 가드라 fail-closed(env 로 넓히지 않는다). 명시 [] 는 초대 불가이고 미설정만 배포 기본값(env)으로 간다(D40).
import type { InviteDomainSource } from '@/lib/domain/invites'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'

/**
 * 그 워크스페이스의 허용 도메인과 그 출처. 출처는 거부 문구가 고칠 곳(워크스페이스 설정 / env / 둘 다)을 가리키게 하려고 돌려준다.
 * 워크스페이스가 env 보다 좁게 정해 둔 목록을 DB 장애·손상이 조용히 넓히면 안 되므로 그때는 env 로 가지 않고 중단한다.
 * 매 호출마다 읽는다 — 관리자가 목록을 좁히면 이미 나간 초대도 즉시 막혀야 한다.
 */
export async function loadInviteDomains(
  admin: ConfigReadClient, workspaceId: string,
): Promise<{ ok: true; domains: string[]; source: InviteDomainSource } | { ok: false }> {
  let state
  try {
    state = (await getWorkspaceConfig(workspaceId, { client: admin })).keys['invites.allowed_domains']
  } catch (e) {
    if (e instanceof ConfigUnavailableError) {
      console.error('[inviteDomains] 워크스페이스 설정 조회 실패:', e.message)
      return { ok: false }
    }
    throw e
  }
  if (state.status === 'set') return { ok: true, domains: state.value, source: 'workspace' }
  if (state.status === 'default') return { ok: true, domains: state.value, source: state.from === 'deploy' ? 'env' : 'product' }
  // invalid(손상) — 해석기가 이미 로그를 남겼다. required_missing 은 이 키에 없다
  return { ok: false }
}
