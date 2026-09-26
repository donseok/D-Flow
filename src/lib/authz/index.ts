import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '../supabase/server'
import { roleIn, workspaceAdminVerdict, type Actor, type ProjectRole } from '../domain/authz'
import { buildActor } from './buildActor'
import { readScope, type ProjectScopedTable, type ScopeResult } from './scope'
// 사유 문자열과 HTTP 매핑(denyStatus)의 정본은 순수 모듈 ./errors 다 — 이 모듈은 테스트
// 37곳이 통째로 vi.mock 하므로, 라우트가 여기서 denyStatus 를 가져가면 모킹 문맥에서 터진다.
import { ERR_LOOKUP, ERR_DENIED, ERR_ANON, ERR_MISSING } from './errors'

export type { Actor, ProjectRole, ProjectScopedTable, ScopeResult }

export type GuardResult = { ok: true; actor: Actor } | { ok: false; error: string }

/**
 * 로그인 사용자의 권한 스냅샷을 조립한다. 비로그인은 null.
 *
 * 조회 실패는 throw 한다 — '역할 없음'으로 폴백하면 그 순간 전원이 조회 전용으로
 * 보이고(운영 마비), 반대로 관대하게 폴백하면 가드가 통째로 뚫린다. 어느 쪽도 조용해서는 안 된다.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const sb = await createServerClient()
  // getUser() 가 아니라 getClaims() — 미들웨어(src/middleware.ts)와 같은 근거. 이 프로젝트의 JWT 는 비대칭 서명(ES256)이라
  // getClaims() 는 JWKS(auth-js 전역 캐시)로 로컬 서명·만료 검증만 하고 끝난다. getUser() 는 가드마다 GoTrue /auth/v1/user
  // 왕복(0.1초 안팎)을 강제했고, 서버 액션은 요청 하나가 곧 가드 하나라 그 비용이 클릭마다 그대로 붙었다
  // (2026-09-14 허브 체크 지연 개선). 세션이 없거나 토큰이 무효·만료(갱신 실패)면 claims 가 없다 → 비로그인(null).
  // 권한 축(워크스페이스·명단)은 캐시하지 않고 매번 새로 읽는다 — 멤버에서 빠진 사람이 TTL 동안 남는 일이 없게.
  const { data } = await sb.auth.getClaims()
  const userId = data?.claims?.sub
  if (!userId) return null
  // 4축(플랫폼 관리자·워크스페이스·프로젝트·명단)은 buildActor 가 병렬로 읽는다 — actorFromUser 와 같은 조립.
  // cache() 래핑: 같은 요청 안에서 레이아웃·페이지·가드가 각자 getActor 를 불러도 1회만 완주한다.
  return buildActor(sb, userId)
})

/**
 * 세션 없이 특정 사용자의 Actor 를 조립한다 — 외부 API·배치처럼 service_role 클라이언트로 판정하는 경로(SP7)용.
 * admin 클라이언트는 RLS 를 우회하므로 user_id 필터가 전부다 — buildActor 가 모든 축에 명시 필터를 건다.
 */
export async function actorFromUser(admin: Pick<SupabaseClient, 'from'>, userId: string): Promise<Actor> {
  return buildActor(admin, userId)
}

/**
 * 화면 계층용 — getActor 의 throw 를 삼키고 **조회 전용(null)** 으로 열화한다.
 *
 * 레이아웃·페이지에서 getActor() 를 그대로 부르면 권한 축 조회 실패 한 번이
 * 인증 영역 전체를 500 으로 만든다(0052 롤백 직후가 가장 현실적인 트리거 —
 * 테이블이 사라져 모든 요청이 PGRST205 로 실패한다). listProjects 가 이미
 * 같은 판단으로 [] 폴백을 택했고, 이 함수는 그 예방책을 권한 축에도 맞춘다.
 *
 * fail-closed 는 유지된다 — null 은 어포던스 0(조회 전용)이며, 쓰기는 서버 액션의
 * 가드가 다시 판정해 거부한다. 실패 사실은 로그로 남긴다(표시 = 로깅).
 */
export async function getActorForView(): Promise<Actor | null> {
  return (await getActorViewState()).actor
}

/**
 * getActorForView 와 같은 열화를 하되 **실패했다는 사실을 함께 돌려준다**.
 *
 * `actor: null` 하나로는 "권한이 없는 사람"과 "권한을 못 읽은 상태"가 구분되지 않는다.
 * 화면은 그 둘을 똑같이 '게스트'로 그렸고, REST 장애 때 전 사용자가 게스트 +
 * '등록된 프로젝트 없음' 으로 보였다. 로그인 실패로 오인돼 원인 추적이 늦어졌다.
 * 에러 처리 3원칙의 '표시 = 로깅' 중 로깅만 있고 표시가 없던 자리다.
 *
 * fail-closed 는 그대로다 — degraded 여도 어포던스는 0이고 쓰기는 서버 액션 가드가 다시 막는다.
 * 달라지는 건 화면이 이 상태를 **정상인 척하지 않는다**는 것뿐이다.
 */
export async function getActorViewState(): Promise<{ actor: Actor | null; degraded: boolean }> {
  try {
    return { actor: await getActor(), degraded: false }
  } catch (e) {
    // Next 의 제어 흐름 예외는 예외가 아니라 신호다 — 삼키면 정적/동적 판정과 리다이렉트가 깨진다.
    // cookies() 는 정적 렌더 중 DYNAMIC_SERVER_USAGE 를 던져 "이 라우트는 동적"임을 알린다.
    if (isFrameworkSignal(e)) throw e
    console.error('[getActorForView] 권한 조회 실패 — 조회 전용으로 열화:', e instanceof Error ? e.message : e)
    return { actor: null, degraded: true }
  }
}

/** Next 가 제어 흐름에 쓰는 예외(동적 사용·redirect·notFound·요청 취소)인지. */
function isFrameworkSignal(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest
  if (typeof digest === 'string'
    && (digest === 'DYNAMIC_SERVER_USAGE'
      || digest === 'NEXT_NOT_FOUND'
      || digest.startsWith('NEXT_REDIRECT')
      || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'))) return true
  // 프리렌더 중단·요청 취소도 우리 에러가 아니다.
  return e instanceof Error && (e.name === 'DynamicServerError' || e.name === 'AbortError')
}

/** getActor 의 throw 를 GuardResult 로 감싼다 — 액션은 예외가 아니라 결과로 응답한다. */
async function actorOrError(): Promise<GuardResult> {
  let actor: Actor | null
  try {
    actor = await getActor()
  } catch {
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!actor) return { ok: false, error: ERR_ANON }
  return { ok: true, actor }
}

/** 전역 관리(프로젝트 생성·삭제, 관리자 지정, 팀 기준정보, LLM 설정, 봇 재색인). */
export async function requireSuperuser(): Promise<GuardResult> {
  const r = await actorOrError()
  if (!r.ok) return r
  return r.actor.isSuperuser ? r : { ok: false, error: ERR_DENIED }
}

/** 해당 프로젝트의 관리자 이상(워크스페이스 관리자 승계 포함). 타 워크스페이스·미존재는 ERR_MISSING(404). */
export async function requireProjectAdmin(projectId: string | null): Promise<GuardResult> {
  const r = await actorOrError(); if (!r.ok) return r
  const role = roleIn(r.actor, projectId)
  if (role === null) return { ok: false, error: ERR_MISSING }     // 타 워크스페이스·미존재 — 존재 은닉(404)
  return role === 'superuser' || role === 'admin' ? r : { ok: false, error: ERR_DENIED }
}

/** 해당 프로젝트의 멤버 이상. 타 워크스페이스·미존재는 ERR_MISSING(404). */
export async function requireProjectMember(projectId: string | null): Promise<GuardResult> {
  const r = await actorOrError(); if (!r.ok) return r
  const role = roleIn(r.actor, projectId)
  if (role === null) return { ok: false, error: ERR_MISSING }     // 타 워크스페이스·미존재 — 존재 은닉(404)
  return role === 'superuser' || role === 'admin' || role === 'member' ? r : { ok: false, error: ERR_DENIED }
}

/** 워크스페이스 관리(프로젝트 생성·공용 팀·계정·워크스페이스 역할). 비소속은 ERR_MISSING(404), 멤버는 ERR_DENIED. */
export async function requireWorkspaceAdmin(workspaceId: string | null): Promise<GuardResult> {
  const r = await actorOrError(); if (!r.ok) return r
  const v = workspaceAdminVerdict(r.actor, workspaceId)
  if (v === 'missing') return { ok: false, error: ERR_MISSING }  // 비소속 워크스페이스 — 존재 은닉(404)
  return v === 'ok' ? r : { ok: false, error: ERR_DENIED }
}

/**
 * 대상 행의 프로젝트·워크스페이스를 세션 클라이언트로 읽는다. projectId 를 인자로 받지 않는 액션이 판정 전에 쓴다.
 * 조회 실패는 ERR_LOOKUP(판정 불가 — 호출부 fallback 500), 행이 없거나 RLS 가 가리면 ERR_MISSING(404)이다.
 * minutes.project_id 는 nullable 이므로 ok:true 이면서 projectId 가 null 일 수 있다 — 호출부가 그 분기를 명시적으로 처리해야 한다.
 */
export async function resolveScope(table: ProjectScopedTable, id: string): Promise<ScopeResult> {
  return readScope(await createServerClient(), table, id, 'resolveScope')
}

/** 기존 호출부 호환용 — resolveScope 의 프로젝트만. 실패 사유(ERR_LOOKUP·ERR_MISSING)는 그대로 넘긴다. */
export async function resolveProjectId(
  table: ProjectScopedTable, id: string,
): Promise<{ ok: true; projectId: string | null } | { ok: false; error: string }> {
  const r = await resolveScope(table, id)
  return r.ok ? { ok: true, projectId: r.projectId } : r
}
