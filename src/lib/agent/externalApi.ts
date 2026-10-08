import { NextResponse } from 'next/server'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { isProjectAdmin, isProjectMember, roleIn, type Actor } from '@/lib/domain/authz'
import { requireModule } from '@/lib/modules/gate'
import { actorFromCredential, credentialAllows, resolveCredential, type ResolvedCredential } from '@/lib/authz/credentials'

/**
 * 에이전트 작업 루프 외부 API 공용 헬퍼 — 스펙 §3.1.
 * 회의록 API(src/lib/minutes/externalApi.ts) 패턴을 따르되 env 축(AGENT_API_*)만 다르다.
 * resolveUserByEmail/AdminClient 는 그 모듈에서 import 해 재사용한다(수정 금지).
 */
/** 킬스위치는 AGENT_API_ENABLED 단독(계약 v2.0 §인증). 배포 전역 시크릿 인증은 SP7 에서 삭제됐다 — 자격증명은 integration_credentials 행뿐이다. */
export function agentApiEnabled(): boolean {
  return process.env.AGENT_API_ENABLED === 'true'
}

export const apiNotFound = () =>
  NextResponse.json({ error: 'Not Found' }, { status: 404 })
export const apiUnauthorized = () =>
  NextResponse.json({ error: '인증이 필요합니다.', code: 'unauthorized' }, { status: 401 })
export const apiBadRequest = (error: string) =>
  NextResponse.json({ error, code: 'validation_failed' }, { status: 400 })
export const apiFail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status })
export const apiInternalError = (error = '서버 오류가 발생했습니다.') =>
  NextResponse.json({ error, code: 'internal_error' }, { status: 500 })

/** agents 모듈이 켜진 프로젝트에서만 루프가 열린다(스펙 §1.1-2 — 원천은 modules.enabled 하나다, SP7 에서 등록 표를 지웠다).
 *  모듈 판정은 세션이 없으니 admin 으로(스펙 §4.2 에이전트 API 행). 판정 실패는 닫힘(requireModule 이 로그를 남긴다) */
export async function requireAgentProject(admin: AdminClient, projectId: string): Promise<boolean> {
  return (await requireModule({ projectId }, 'agents', { client: admin })).ok
}

/*
 * 판정 축 — actorFromCredential + roleIn: 세션 경로와 같은 판정(SP2 결정 8)을 자격증명 범위로 좁힌 스냅샷에서 한다(SP7 §5.1.3).
 * 워크스페이스 관리자 승계·활성 명단 행 권한은 그대로 읽되 플랫폼 관리자 승격은 없다. 자격증명의 워크스페이스·project_ids
 * 밖 프로젝트는 roleIn 이 null 이다(존재 은닉).
 */

/**
 * user_email 계정이 해당 프로젝트 멤버 이상인지(스펙 §3.1).
 * 보안 가드이므로 조회 실패는 false(fail-closed).
 */
export async function isAgentProjectMember(
  admin: AdminClient, userId: string, projectId: string, principal: AgentPrincipal,
): Promise<boolean> {
  try {
    return isProjectMember(await agentActorFromPrincipal(admin, userId, principal), projectId)
  } catch (e) {
    console.error('[agent-api] 멤버 판정 조회 실패(거절):', e instanceof Error ? e.message : e)
    return false
  }
}

/**
 * user_email 계정이 해당 프로젝트 관리자 이상(플랫폼·워크스페이스 관리자 포함)인지 — import·발행 같은
 * 구조 쓰기 엔드포인트의 관문(계약 §2.8).
 * 조회 실패는 throw — 호출 라우트의 try/catch 가 500 으로 답한다. false 로 위장하면
 * 조회 장애가 forbidden_role(403)로 둔갑해 "권한이 없다"는 거짓 진단을 남기기 때문이다.
 * 어느 경로로도 통과로 새지 않으므로 fail-closed 는 유지된다.
 */
export async function isAgentProjectAdmin(
  admin: AdminClient, userId: string, projectId: string, principal: AgentPrincipal,
): Promise<boolean> {
  return isProjectAdmin(await agentActorFromPrincipal(admin, userId, principal), projectId)   // throw → 라우트 try/catch 가 500(현 계약 유지)
}

/**
 * 프로젝트별 사용자 역할 조회 — 'superuser'|'admin'|'member'|null. 조회 전용(viewer)은 null 이다.
 * 보안 가드이므로 조회 실패는 null(fail-closed). 위장하지 않고 로깅한다.
 */
export async function agentMemberRole(
  admin: AdminClient, userId: string, projectId: string, principal: AgentPrincipal,
): Promise<'superuser' | 'admin' | 'member' | null> {
  try {
    return agentRoleFromActor(await agentActorFromPrincipal(admin, userId, principal), projectId)
  } catch (e) {
    console.error('[agent-api] 역할 조회 실패(거절):', e instanceof Error ? e.message : e)
    return null
  }
}

/** agentMemberRole 의 순수판 — 라우트가 이미 스냅샷을 가졌을 때 프로젝트마다 다시 조립하지 않는다(me 의 N+1). */
export function agentRoleFromActor(actor: Actor, projectId: string): 'superuser' | 'admin' | 'member' | null {
  const r = roleIn(actor, projectId)
  return r === 'viewer' ? null : r
}

export const AGENT_CONTRACT_VERSION = '2.4'

/** 에이전트 API 의 신원은 integration_credentials(kind='agent_runner') 행 하나뿐이다(SP7 §5.1.4 — 레거시 시크릿 principal 삭제). */
export type AgentPrincipal = {
  kind: 'pat'; runnerId: string; userId: string; userEmail: string
  scopes: string[]; projectId: string | null; runnerKind: 'user_pat' | 'runner'
  tokenExpiresAt: string
  /** 발급할 때 사람이 적은 이름과 조회 키(계약 2.4). /me 가 "이 키가 무엇인지" 알려 주는 데만 쓴다. */
  runnerName: string; tokenPrefix: string
  /** 현재 권한을 이 범위(워크스페이스·project_ids)로 좁힌다 — 필수. 자격증명 없는 principal 은 없다. */
  credential: ResolvedCredential
}

/** 항상 자격증명 범위로 좁힌 스냅샷 — 좁히지 않은 buildActor 폴백은 워크스페이스 격리를 우회하므로 두지 않는다. */
export async function agentActorFromPrincipal(admin: AdminClient, userId: string, principal: AgentPrincipal): Promise<Actor> {
  return actorFromCredential(admin, principal.credential, userId)
}

/**
 * 인증 리졸버 — 계약 v2.0 §인증. 반환이 NextResponse 면 그대로 응답한다.
 * 검사 순서(enabled→revoked→expires→hash)는 계약 고정이고 resolveCredential 이 지킨다. 실패 사유는 응답에서 구분하지 않는다(전부 401).
 * 원천은 integration_credentials 하나다 — 거기 없는 prefix 는 401 이며 옛 저장소(0003 의 러너 표)로 다시 인증하지 않는다.
 */
export async function resolveAgentPrincipal(
  req: Request, admin: AdminClient,
): Promise<AgentPrincipal | NextResponse> {
  const cred = await resolveCredential(req, admin, 'agent_runner')
  if (cred instanceof NextResponse) return cred
  if (!cred.ownerUserId) return apiUnauthorized()
  const { data: owner, error: ownerErr } = await admin.auth.admin.getUserById(cred.ownerUserId)
  if (ownerErr || !owner?.user?.email || owner.user.id !== cred.ownerUserId) {
    // 보안 가드 조회 실패 = 거부(fail-closed). 위장하지 않고 로깅.
    console.error('[agent-api] PAT 소유자 조회 실패(거절):', ownerErr?.message ?? '이메일 없음')
    return apiUnauthorized()
  }
  return {
    kind: 'pat', runnerId: cred.id, userId: cred.ownerUserId, userEmail: owner.user.email.toLowerCase(),
    scopes: [...cred.scopes], projectId: cred.projectIds?.length === 1 ? cred.projectIds[0] : null,
    runnerKind: 'user_pat', tokenExpiresAt: cred.expiresAt, runnerName: cred.name, tokenPrefix: cred.tokenPrefix,
    credential: cred,
  }
}

/**
 * 스코프 강제 — 부족 시 403 insufficient_scope.
 *
 * `work:report` 는 **폐지된 스코프**다(2026-08-25). claim 할 수 있으면 그 결과도 적을 수 있어야
 * 사이클이 완주되는데, claim 은 원래 무제한이라 보고만 따로 막는 건 실질 방어선이 아니었다
 * (본인 claim 건만 쓸 수 있다는 강제는 report 라우트의 claimed_by_user_id 판정이 이미 한다).
 * 신규 발급 토큰에는 붙지 않지만 **이미 발급된 토큰에는 남아 있으므로** work:claim 요구를
 * work:report 로도 충족시킨다 — 이 수용이 없으면 옛 토큰이 그날로 끊긴다.
 */
const LEGACY_EQUIVALENT = new Map<string, readonly string[]>([['work:claim', ['work:report']]])

export function requireScope(
  p: AgentPrincipal, scope: 'work:read' | 'work:claim',
): NextResponse | null {
  if (p.scopes.includes(scope)) return null
  if ((LEGACY_EQUIVALENT.get(scope) ?? []).some((alt) => p.scopes.includes(alt))) return null
  return apiFail(403, 'insufficient_scope', `이 작업에는 ${scope} 스코프가 필요합니다.`)
}

/** 자격증명의 project_ids 한정 — null 이면 그 워크스페이스의 전 프로젝트(워크스페이스·멤버십 게이트는 별도). */
export function patProjectAllowed(p: AgentPrincipal, projectId: string): boolean {
  return credentialAllows(p.credential, projectId)
}
