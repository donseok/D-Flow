import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  MINUTE_ATTACHMENT_MAX, MINUTE_ATTACHMENTS_MAX_COUNT, MINUTE_BODY_MAX,
} from '@/lib/domain/minutes'
import { workspaceTeams } from '@/lib/teams/source'
import { activeCodes } from '@/lib/domain/teams'
import { actorFromUser } from '@/lib/authz'
import { canSeeProject } from '@/lib/domain/authz'
import { fetchAllPages } from '@/lib/data/paging'
import { BRAND } from '@/lib/branding'
import { workspacesWithModule } from '@/lib/modules/gate'
import {
  apiBadRequest, apiFail, apiInternalError, apiModuleDisabled, apiNotFound, gateMinutesApi, isUuid, MINUTES_API_MAX_REQUEST_BYTES,
  resolveUserByEmail,
} from '@/lib/minutes/externalApi'

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
  const gate = gateMinutesApi(req)
  if (gate) return gate

  const projectId = req.nextUrl.searchParams.get('project_id')
  if (projectId && !isUuid(projectId)) return apiBadRequest('project_id 형식이 올바르지 않습니다.')
  const userEmail = req.nextUrl.searchParams.get('user_email')?.trim() ?? ''
  if (!userEmail) return apiBadRequest('user_email 이 필요합니다.')

  try {
    const admin = createAdminClient()
    // 계정·권한 조회 실패는 throw → 아래 catch 의 500(빈 목록으로 위장하지 않는다).
    const user = await resolveUserByEmail(admin, userEmail)
    if (!user) return apiFail(403, 'unknown_user', `해당 이메일의 ${BRAND.productName} 사용자가 없습니다.`)
    const actor = await actorFromUser(admin, user.id)
    // 목록형 — minutes_integration 이 허용된 워크스페이스의 프로젝트·팀만(스펙 §4.2·§4.3). 하나도 없으면 닫는다(409)
    const actorWs = [...new Set([...actor.workspaceRoles.keys(), ...actor.projectWorkspace.values()])]
    const onWs = new Set(await workspacesWithModule(actorWs, 'minutes_integration', { client: admin }))
    if (onWs.size === 0) return apiModuleDisabled()

    // 후보 = 스냅샷의 프로젝트(내 워크스페이스들의 프로젝트, 플랫폼 관리자는 전부). 프로젝트 id 목록을 .in() 으로 싣지 않는다 —
    // URL 이 프로젝트 수에 비례해 늘어 약 205개부터 게이트웨이가 414 로 거절한다(GET 목록 listScope 와 같은 이유). 워크스페이스로
    // 좁혀 max_rows 이하 페이지로 끝까지 읽고, 응답 행은 스냅샷 키와 canSeeProject 로 한 번 더 거른다 — 필터가 빠지는 회귀가 생겨도
    // 남의 워크스페이스 프로젝트가 실리지 않게.
    let projects: Array<{ id: string; name: string }> = []
    if (actor.projectWorkspace.size > 0) {
      const workspaceIds = [...actor.workspaceRoles.keys()]
      let rows: Array<{ id: string; name: string; is_private: boolean | null }>
      try {
        rows = await fetchAllPages('projects', (from, to) => {
          const q = admin.from('projects').select('id, name, is_private', { count: 'exact' })
          return (actor.isSuperuser ? q : q.in('workspace_id', workspaceIds)).order('name').order('id').range(from, to)
        })
      } catch (e) {
        console.error('[minutes-api] 프로젝트 목록 조회 실패:', e instanceof Error ? e.message : e)
        return apiInternalError()
      }
      projects = rows
        .filter(p => actor.projectWorkspace.has(p.id) && canSeeProject(actor, p) && onWs.has(actor.projectWorkspace.get(p.id)!))
        .map(p => ({ id: p.id, name: p.name }))
    }
    // 회의 목록은 볼 수 있는 프로젝트일 때만 — 다른 워크스페이스·비공개 프로젝트는 존재를 드러내지 않는다(404).
    if (projectId && !projects.some(p => p.id === projectId)) return apiNotFound()

    // 호출자가 속한 워크스페이스들의 활성 공용 팀 합집합(첫 등장 순서 유지). 세션이 없으므로 service_role 로 읽는다.
    // 팀 원천 실패는 throw → 500.
    const wsIds = [...actor.workspaceRoles.keys()].filter((w) => onWs.has(w))
    const perWs = await Promise.all(wsIds.map((wid) => workspaceTeams(wid, { client: admin })))
    const teams = [...new Set(perWs.flatMap((rows) => activeCodes(rows)))]

    const body: Record<string, unknown> = {
      teams,
      projects,
      limits: {
        max_body_chars: MINUTE_BODY_MAX,
        max_request_bytes: MINUTES_API_MAX_REQUEST_BYTES,
        max_attachments: MINUTE_ATTACHMENTS_MAX_COUNT,
        max_attachment_bytes: MINUTE_ATTACHMENT_MAX,
      },
    }

    // 회의 목록은 프로젝트 종속 — project_id 지정 시에만 포함(계약 §5.2)
    if (projectId) {
      const { data: meetings, error: mErr } = await admin.from('meetings')
        .select('id, title, meeting_date, category, recurrence').eq('project_id', projectId)
        .order('meeting_date', { ascending: false })
      if (mErr) { console.error('[minutes-api] 회의 목록 조회 실패:', mErr.message); return apiInternalError() }
      body.meetings = ((meetings ?? []) as Record<string, unknown>[]).map(m => ({
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
