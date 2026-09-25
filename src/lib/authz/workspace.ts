// 쓰기 대상 워크스페이스 결정 — 순수(IO 없음). 스펙 SP1 §5.3.
// SP1 에는 워크스페이스 선택 화면이 없다. 액터의 소속이 정확히 1개일 때만 그 워크스페이스를 쓰고, 0개·2개 이상이면 거부한다 —
// 여럿 중 하나를 조용히 고르면 계정·프로젝트·공용 팀이 엉뚱한 워크스페이스에 생긴다(SP2 가 선택 UI 를 준다).
// 플랫폼 관리자도 부트스트랩이 워크스페이스 관리자로 넣으므로 정상 경로에서 0개는 나오지 않는다.
// index.ts(가드)와 분리한 이유: index.ts 는 테스트가 통째로 vi.mock 하는 모듈이라 순수 함수를 거기 두면 모킹 문맥에서 사라진다.
import type { Actor } from '@/lib/domain/authz'

export const ERR_NO_WORKSPACE = '워크스페이스에 소속돼 있지 않습니다.'
export const ERR_WORKSPACE_REQUIRED = '워크스페이스를 지정해야 합니다.'

export function resolveSoleWorkspaceId(
  actor: Actor,
): { ok: true; workspaceId: string } | { ok: false; error: string } {
  const ids = [...actor.workspaceRoles.keys()]
  if (ids.length === 1) return { ok: true, workspaceId: ids[0] }
  return { ok: false, error: ids.length === 0 ? ERR_NO_WORKSPACE : ERR_WORKSPACE_REQUIRED }
}
