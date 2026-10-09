import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  MINUTES_ATTACHMENT_MAX_BYTES, MINUTES_ATTACHMENTS_MAX_COUNT, MINUTE_BODY_MAX,
} from '@/lib/domain/minutes'
import { projectTeams, workspaceTeams } from '@/lib/teams/source'
import { activeCodes } from '@/lib/domain/teams'
import { actorFromUser } from '@/lib/authz'
import { canSeeProject } from '@/lib/domain/authz'
import { workspacesWithModule } from '@/lib/modules/gate'
import {
  apiBadRequest, apiFail, apiInternalError, apiModuleDisabled, apiNotFound, isMinutesWorkspaceMember, isUuid, MINUTES_API_MAX_REQUEST_BYTES,
  apiProductName, resolveMinutesPrincipal, resolveUserByEmail, type AdminClient,
} from '@/lib/minutes/externalApi'
import { credentialAllows } from '@/lib/authz/credentials'

/**
 * GET /api/v1/minutes/meta?user_email=… — 구분·프로젝트(·회의) 목록 + 제한값. 계약 §5.2.
 * 또박또박이 teams 를 최상위 폴더명 자동 판정 기준으로 쓰므로(§0 D10) 하드코딩 없이 이 응답을 추종한다.
 *
 * SP2 §4.2 — 시크릿만으로는 호출자가 누구인지 모른다. 종전엔 전 워크스페이스의 프로젝트·팀을 내줬다.
 * user_email(필수)로 호출자를 정하고, 그 사람이 볼 수 있는 프로젝트(내 워크스페이스 ∩ canSeeProject)와
 * 그 사람 워크스페이스들의 활성 공용 팀만 싣는다. 없거나 모르는 이메일은 4xx — 전체 목록으로 되돌아가지 않는다.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let adminClient: AdminClient | undefined
  const getAdmin = () => {
    if (!adminClient) adminClient = createAdminClient()
    return adminClient
  }
  const principal = await resolveMinutesPrincipal(req, getAdmin)
  if (principal instanceof NextResponse) return principal

  const projectId = req.nextUrl.searchParams.get('project_id')
  if (projectId && !isUuid(projectId)) return apiBadRequest('project_id 형식이 올바르지 않습니다.')
  const userEmail = req.nextUrl.searchParams.get('user_email')?.trim() ?? ''
  if (!userEmail) return apiBadRequest('user_email 이 필요합니다.')

  try {
    const admin = getAdmin()
    // 계정·권한 조회 실패는 throw → 아래 catch 의 500(빈 목록으로 위장하지 않는다).
    const user = await resolveUserByEmail(admin, userEmail)
    if (!user) return apiFail(403, 'unknown_user', `해당 이메일의 ${await apiProductName(admin, principal.credential.workspaceId)} 사용자가 없습니다.`)

    // 범위는 자격증명 행의 워크스페이스 하나다(SP7 §5.1.3) — 호출자의 다른 소속 워크스페이스나 플랫폼 관리자의 전 워크스페이스로 넓히지 않는다.
    const wsId = principal.credential.workspaceId
    const isMember = await isMinutesWorkspaceMember(admin, wsId, user.id)
    if (!isMember) return apiFail(403, 'unknown_user', '해당 워크스페이스의 사용자가 아닙니다.')

    const actor = await actorFromUser(admin, user.id)
    const onWs = new Set(await workspacesWithModule([wsId], 'minutes_integration', { client: admin }))
    if (onWs.size === 0) return apiModuleDisabled()

    const { data: wsRow, error: wsErr } = await admin.from('workspaces').select('id, slug, name').eq('id', wsId).single()
    // 2차 필터 — 응답에 싣기 전에 행이 자격증명 워크스페이스의 것인지 다시 본다(DB 필터가 빠지는 회귀에도 남의 워크스페이스가 실리지 않게, fail-closed)
    if (wsErr || !wsRow || wsRow.id !== wsId) return apiInternalError()
    const workspaceInfo = { id: wsRow.id as string, slug: wsRow.slug as string, name: wsRow.name as string }

    const { data: prjRows, error: prjErr } = await admin.from('projects').select('id, name, is_private, workspace_id').eq('workspace_id', wsId).order('name')
    if (prjErr) return apiInternalError()
    // 2차 필터 — 행의 workspace_id 가 자격증명 워크스페이스이고(DB 필터와 별개로), 자격증명의 project_ids 한정 안이며, 호출자가 볼 수 있는 프로젝트만.
    // workspace_id 가 없는(모르는) 행도 뺀다(fail-closed).
    const projects = ((prjRows ?? []) as Array<{ id: string; name: string; is_private: boolean | null; workspace_id?: string | null }>)
      .filter(p => p.workspace_id === wsId && credentialAllows(principal.credential, p.id) && canSeeProject(actor, p))
      .map(p => ({ id: p.id, name: p.name }))

    let teams: string[]
    if (projectId) {
      if (!projects.some(p => p.id === projectId)) return apiNotFound()
      teams = activeCodes(await projectTeams(projectId, { client: admin }))
    } else {
      teams = activeCodes(await workspaceTeams(wsId, { client: admin }))
    }

    const body: Record<string, unknown> = {
      workspace: workspaceInfo,
      teams,
      projects,
      limits: {
        max_body_chars: MINUTE_BODY_MAX,
        max_request_bytes: MINUTES_API_MAX_REQUEST_BYTES,
        max_attachments: MINUTES_ATTACHMENTS_MAX_COUNT,
        max_attachment_bytes: MINUTES_ATTACHMENT_MAX_BYTES,
      },
    }

    // 회의 목록은 프로젝트 종속 — project_id 지정 시에만 포함(계약 §5.2)
    if (projectId) {
      const { data: meetings, error: mErr } = await admin.from('meetings')
        .select('id, project_id, title, meeting_date, category, recurrence').eq('project_id', projectId)
        .order('meeting_date', { ascending: false })
      if (mErr) { console.error('[minutes-api] 회의 목록 조회 실패:', mErr.message); return apiInternalError() }
      // 2차 필터 — 위에서 자격증명 범위로 확인한 프로젝트의 회의만 싣는다(DB 필터와 별개, fail-closed)
      body.meetings = ((meetings ?? []) as Record<string, unknown>[]).filter(m => m.project_id === projectId).map(m => ({
        id: m.id as string, title: m.title as string, date: m.meeting_date as string,
        // v2.5 — 또박또박 배지용. DB check 제약이 값 집합을 보장하므로 raw 전달로 충분.
        // 반복 회의는 시리즈 1행(첫 회차 date)만 나온다 — 전개하지 않는 현행 조회 유지.
        category: m.category as string, recurrence: m.recurrence as string,
      }))
    }

    return NextResponse.json(body)
  } catch (e) {
    console.error('[minutes-api] meta 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

// 미정의 메서드도 404 — 405 + Allow 응답이 비활성 라우트의 존재를 노출하지 않게(§3.4 존재 은닉 보강).
export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
