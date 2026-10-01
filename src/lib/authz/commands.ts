// 권한 쓰기 RPC 의 공용 조각(스펙 SP3a §6, 0012) — set_platform_admin·set_workspace_role·upsert_project_member_cmd 는
// 행위자(p_actor)와 명령 id(p_command_id)를 받아 권한 변경 이력(authz_events)에 남긴다. 호출은 서버 액션에서만 한다.
//
// 명령 id 는 호출마다 새로 만든다: 이 액션들은 화면이 재전송 키를 쥐지 않는다(권한이 바뀌지 않은 호출은 이력 행을 남기지
// 않으므로 재전송은 다시 실행돼도 안전한 멱등 쓰기다 — 스펙 §6 끝 문단).
import { ERR_DENIED } from '@/lib/authz/errors'
import { newUuid } from '@/lib/domain/uuid'

export const newAuthzCommandId = (): string => newUuid()

/** RPC 가 돌려주는 jsonb 의 모양 — 'duplicate' 는 같은 명령의 재전송이다(저장된 결과에 status 만 바뀐다). */
export interface AuthzCommandResult {
  status: 'applied' | 'duplicate'
  /** set_platform_admin·set_workspace_role: 영향받은 행 수. */
  matched?: number
  /** upsert_project_member_cmd: 명단 행 id. */
  memberId?: string
}

/** 모르는 모양이면 null — 호출부가 성공으로 보지 않고 실패로 올린다(3원칙: 모르면 unknown). */
export function parseAuthzResult(data: unknown): AuthzCommandResult | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  if (d.status !== 'applied' && d.status !== 'duplicate') return null
  const out: AuthzCommandResult = { status: d.status }
  if (d.matched !== undefined) {
    if (typeof d.matched !== 'number') return null
    out.matched = d.matched
  }
  if (d.member_id !== undefined) {
    if (typeof d.member_id !== 'string') return null
    out.memberId = d.member_id
  }
  return out
}

/**
 * 가드는 통과했는데 RPC 가 호출자 등급을 다시 보고 거부한 경우(AUTHZ_FORBIDDEN — 그 사이 권한이 바뀜)는 가드와 같은 문구.
 * 그 밖의 토큰은 null — 호출부가 자기 맥락의 문구를 고르고 원문은 로그에만 남긴다.
 */
export function authzCommandError(message: string): string | null {
  return message.includes('AUTHZ_FORBIDDEN') ? ERR_DENIED : null
}
