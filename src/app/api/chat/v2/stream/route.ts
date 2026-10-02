import { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api/http'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { createDefaultChatToolRegistry } from '@/lib/ai/chat/default-registry'
import { ChatToolGateUnavailableError, gateChatTools } from '@/lib/ai/chat/tool-modules'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import { validateChatProjectScope } from '@/lib/ai/chat/access-scope'
import { createChatNdjsonStream, orchestrateChatV2 } from '@/lib/ai/chat/orchestrator'
import {
  planWithConfiguredLlm,
  shouldAttemptPlan,
  validateToolPlan,
  type ToolPlan,
} from '@/lib/ai/chat/planner'
import { sanitizeChatRequestV2 } from '@/lib/ai/chat/protocol'
import { planningSignals, projectHint, routeChatRequest, type RouteTeam } from '@/lib/ai/chat/router'
import { teamViewOfScope } from '@/lib/domain/authz'
import { chatPlannerEnabled, chatV2Enabled } from '@/lib/modules/flags'
import { requireScopedSessionModule } from '@/lib/modules/scopedSession'
import { projectTeams, visibleTeams } from '@/lib/teams/source'

export const dynamic = 'force-dynamic'

const MAX_REQUEST_BYTES = 262_144
/** 범위 관문 거부의 기계 코드(모듈 꺼짐 밖) — 상태별 */
const SCOPE_CODE: Readonly<Record<number, string>> = { 400: 'WORKSPACE_REQUIRED', 401: 'UNAUTHENTICATED', 404: 'SCOPE_NOT_FOUND', 503: 'SCOPE_UNAVAILABLE' }

function requestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '')}`
}

/** Read-only NDJSON endpoint. Existing /api/chat and /api/chat/stream remain untouched. */
export async function POST(req: NextRequest) {
  // Explicit kill switch used by the client to fall back to the legacy text stream.
  if (!chatV2Enabled()) {
    return jsonError('새 챗봇 스트림이 비활성화되어 있습니다.', 501, 'CHAT_V2_DISABLED')
  }

  const user = await getSession()
  if (!user) return jsonError('인증이 필요합니다.', 401, 'UNAUTHENTICATED')

  // sanitize는 파싱 이후에야 상한을 적용하므로, 파싱 전 선언 크기로 리소스 소모형
  // 요청을 차단한다(리뷰 M-5). 256KB는 정상 상한(메시지 2k + 히스토리 12×4k자 한글
  // UTF-8 ≈ 150KB)에 여유를 둔 값이다.
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonError('요청 본문이 너무 큽니다.', 413, 'PAYLOAD_TOO_LARGE')
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonError('잘못된 JSON 요청입니다.', 400, 'INVALID_JSON')
  }
  const parsed = sanitizeChatRequestV2(raw)
  if (!parsed.ok) return jsonError(parsed.error.message, parsed.error.status, parsed.error.code)
  const request = parsed.value
  // chatbot 관문(스펙 §4.2 챗 위젯 행, P23) — 검증된 요청의 프로젝트(화면 문맥 우선)로. 스코프 검증(allowedProjectIds)은 아래지만,
  // 볼 수 없는 프로젝트면 설정 0행으로 닫혀 404 라 존재가 드러나지 않는다. env 501 은 위(클라이언트 강등 신호), 라우팅 501 강등은 아래다 —
  // 강등 경로도 설정을 한 번 읽는다(옛 챗도 같은 관문이라 꺼진 모듈이 강등으로 새지 않는다).
  // 관문이 스코프 검증(validateChatProjectScope) 앞이라, 허용 밖 프로젝트 힌트의 응답은 403 PROJECT_ACCESS_DENIED 가 아니라
  // 404 MODULE_DISABLED 가 된다(은닉 쪽 — 볼 수 없는 프로젝트의 설정은 0행이라 닫힌다). 과제 28 보고에 적는다.
  // 프로젝트 없는 질문은 요청의 워크스페이스(화면 문맥 우선 — 셸 범위, 소속 확인, D26)로, 둘 다 없으면 400 WORKSPACE_REQUIRED(추측하지 않는다).
  // 비소속·형식 밖·프로젝트와 다른 워크스페이스는 404 SCOPE_NOT_FOUND, 권한 조회 실패는 503.
  const mod = await requireScopedSessionModule({
    projectId: request.pageContext?.projectId ?? request.projectId,
    workspaceId: request.pageContext?.workspaceId ?? request.workspaceId,
  }, 'chatbot')
  if (!mod.ok) return jsonError(mod.error, mod.status, mod.error === ERR_MODULE_DISABLED ? 'MODULE_DISABLED' : SCOPE_CODE[mod.status] ?? 'SCOPE_UNAVAILABLE')
  const now = new Date()
  const plannedRoute = routeChatRequest(request, now)
  // Unsupported questions contain no v2 data and immediately fall back to the legacy bot. Keep this
  // before membership and project-scope I/O so an intentional fallback never touches Supabase
  // (위 모듈 관문의 설정 조회 하나만 앞선다 — P23).
  // 예외: 플래너 opt-in(§7.1)이 켜져 있고 게이트를 통과하면 제한된 도구 계획을 한 번 시도한다.
  const plannerEligible = plannedRoute.kind === 'legacy'
    && chatPlannerEnabled()
    && shouldAttemptPlan(planningSignals(request))
  if (plannedRoute.kind === 'legacy' && !plannerEligible) {
    return jsonError('기본 답변 경로로 전환합니다.', 501, 'CHAT_V2_UNSUPPORTED')
  }

  // 봇은 읽기 전용이고 실제 권한은 아래 capabilities + allowedProjectIds 가 결정한다. 그 스코프는
  // accessScope 가 buildActor 4축(플랫폼 관리자·워크스페이스·명단·프로젝트)으로 조립한다 — 권한 조회가
  // 실패하면 역할 없음으로 폴백하지 않고 503 으로 닫는다(fail-closed).
  const sb = await createServerClient()
  const scopeResolution = await createSupabaseAccessScopeResolver(sb).resolve(user.id)
  if (!scopeResolution.ok) {
    console.error('[chat-v2] 프로젝트 접근 범위 조회 실패:', scopeResolution.detail ?? scopeResolution.code)
    return jsonError('프로젝트 접근 범위를 확인하지 못했습니다.', 503, 'ACCESS_SCOPE_UNAVAILABLE')
  }
  const { allowedProjectIds, workspaceIds, isSuperuser, capabilities } = scopeResolution.scope
  const scope = validateChatProjectScope(request, allowedProjectIds)
  if (!scope.ok) return jsonError(scope.message, scope.status, scope.code)

  // 1차 라우팅(위)은 I/O 없는 게이트다 — 팀은 스코프를 안 뒤에만 알 수 있다. 도구 경로일 때만 팀(이름 포함 — 개명한 이름으로도
  // 부른다, SP4 §4.2.2)을 요청 범위 원천에서 먼저 읽고 다시 라우팅한다. 허용 밖 프로젝트(대화 상태의 옛 엔터티)는 팀을 읽지 않는다.
  let route = plannedRoute
  if (plannedRoute.kind === 'tools') {
    const pid = projectHint(request)
    let teams: readonly RouteTeam[]
    try {
      const rows = pid === null
        ? await visibleTeams(teamViewOfScope({ isSuperuser, workspaceIds, allowedProjectIds }), { client: sb })
        : new Set(allowedProjectIds).has(pid) ? (await projectTeams(pid, { client: sb })).filter((t) => t.active) : []
      teams = rows.map((t) => ({ code: t.code, name: t.name }))
    } catch (e) {
      // 팀 원천 실패 — 빈 목록으로 폴백하면 팀 질문이 필터 없이 조용히 답해진다(3원칙).
      console.error('[chat-v2] 팀 목록 조회 실패:', e instanceof Error ? e.message : e)
      return jsonError('팀 정보를 확인하지 못했습니다. 잠시 후 다시 시도하세요.', 503, 'TEAMS_UNAVAILABLE')
    }
    route = routeChatRequest(request, now, { teamsFor: () => teams })
  }

  const id = requestId()
  let gated: Awaited<ReturnType<typeof gateChatTools>>
  try {
    gated = await gateChatTools(createDefaultChatToolRegistry(sb), {
      projectId: scope.projectId, allowedProjectIds, workspaceIds, capabilities,
    })
  } catch (e) {
    // 워크스페이스 모듈 설정 조회 실패 — 그 워크스페이스만 빼고 답하면 팀 가시 범위의 전제가 깨져 담당 필터가 조용히 좁아진다(X2)
    if (!(e instanceof ChatToolGateUnavailableError)) throw e
    console.error('[chat-v2] 모듈 설정 조회 실패:', e.message, e.cause instanceof Error ? e.cause.message : e.cause)
    return jsonError('봇 설정을 확인하지 못했습니다. 잠시 후 다시 시도하세요.', 503, 'MODULES_UNAVAILABLE')
  }
  const registry = gated.registry

  // 플래너 경로: 계획 생성·검증에 실패하면 어떤 오류도 노출하지 않고 기존 501 폴백으로 수렴한다(§7.3).
  let plan: ToolPlan | undefined
  if (plannerEligible) {
    const allowedTools = registry.names()
    const rawPlan = await planWithConfiguredLlm(request, { allowedTools, now: now.toISOString() })
    const validated = validateToolPlan(rawPlan, { allowedTools, allowedProjectIds })
    if (!validated.ok) {
      console.warn('[chat-v2] 플래너 계획 기각 → 레거시 폴백:', validated.code)
      return jsonError('기본 답변 경로로 전환합니다.', 501, 'CHAT_V2_UNSUPPORTED')
    }
    plan = validated.plan
  }

  const events = orchestrateChatV2(request, {
    requestId: id,
    registry,
    now,
    route,
    ...(plan ? { plan } : {}),
    context: {
      userId: user.id,
      capabilities: gated.capabilities,
      allowedProjectIds,
      workspaceIds,
      isSuperuser,
      pageContext: request.pageContext ?? null,
      now: now.toISOString(),
      timezone: 'Asia/Seoul',
      signal: req.signal,
    },
  })
  return new Response(createChatNdjsonStream(events, { requestId: id, signal: req.signal }), {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': id,
    },
  })
}
