import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, isAgentProjectMember, patProjectAllowed,
  requireAgentProject, requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'
import { resolveReader } from '@/lib/agent/routeShared'
import { getProjectConfig, levelDepthOf } from '@/lib/settings/projectConfig'
import { CONFIG_MESSAGES, configStatus } from '@/lib/settings/errors'

/**
 * GET /api/v1/wbs/structure?project_id=&max_depth= — 프로젝트 levels 정본 + 얕은 노드 조회.
 * PL 스킬(dflow-wbs-nlevel)의 서버 직조회 원천 — 시스템 키·attach 부착점을 이름으로 고르게
 * 한다(스펙 §import 계약 v2.2). 읽기 전용이라 멤버면 통과(비멤버 404 존재 은닉). 레거시 시크릿은 user_email 로 신원을 준다.
 * max_depth 는 0-base 트리 깊이 상한(기본 1 = Phase·System 두 층).
 */
export const dynamic = 'force-dynamic'

const MAX_DEPTH_CAP = 9 // levels 상한(10층)의 0-base 최심

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('project_id') ?? ''
  if (!projectId || !isUuidLike(projectId)) return apiBadRequest('project_id가 필요합니다.')
  const rawDepth = req.nextUrl.searchParams.get('max_depth')
  const maxDepth = rawDepth === null ? 1 : Number.parseInt(rawDepth, 10)
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DEPTH_CAP) {
    return apiBadRequest(`max_depth 는 0~${MAX_DEPTH_CAP} 정수여야 합니다.`)
  }
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'pat') {
      const scopeErr = requireScope(principal, 'work:read')
      if (scopeErr) return scopeErr
      if (!patProjectAllowed(principal, projectId)) return apiNotFound()
    }
    // 레거시도 신원(user_email)을 받아 PAT 와 같은 멤버십 판정을 한다 — 시크릿만으로는 워크스페이스 경계가 없다.
    const reader = await resolveReader(req, admin, principal)
    if (!reader.ok) return reader.res
    if (!(await requireAgentProject(admin, projectId, principal))) return apiNotFound()
    if (!(await isAgentProjectMember(admin, reader.userId, projectId, principal))) {
      return apiNotFound() // 비멤버 404 — 존재 은닉 관례(§2.2)
    }

    // levels 정본 — 해석기. 필수 라벨이 없으면(정상 경로로는 불가) null 로 그대로 노출한다(기본값 위장 금지). 조회 실패는 500.
    // 저장값 손상(invalid)은 '없음'과 다르다 — null 로 합치지 않고 422 로 멈춘다(스펙 §3.5). 원인 키는 로그에.
    let levels: string[] | null = null
    let levelDepth: number | null = null
    try {
      const pc = await getProjectConfig(projectId, { client: admin })
      const state = pc.keys['core.level_labels']
      if (state.status === 'invalid') {
        console.error('[wbs-structure] 설정 손상:', { projectId, key: 'core.level_labels', error: state.error })
        return apiFail(configStatus('CONFIG_INVALID'), 'config_invalid', CONFIG_MESSAGES.CONFIG_INVALID)
      }
      // 깊이 = 단계 이름 수(§9 #1) — 규칙은 levelDepthOf 한 곳(대안으로 바꿀 때 여기를 따로 고치지 않게). 필수 라벨 없음은 null
      if (state.status === 'set') { levels = state.value; levelDepth = levelDepthOf(pc) }
    } catch (e) {
      console.error('[wbs-structure] 설정 조회 실패:', e instanceof Error ? e.message : e)
      return apiInternalError()
    }

    const { data: rows, error: rowsErr } = await admin
      .from('wbs_items')
      .select('id, parent_id, name, external_ref, level_idx, sort_order')
      .eq('project_id', projectId)
    if (rowsErr) {
      console.error('[wbs-structure] WBS 조회 실패:', rowsErr.message)
      return apiInternalError()
    }
    type Row = { id: string; parent_id: string | null; name: string; external_ref: string | null; level_idx: number | null; sort_order: number }
    const all = (rows ?? []) as Row[]
    const byId = new Map(all.map(r => [r.id, r]))
    // 깊이 계산 — 고아는 루트 취급, 순환은 방문 표시로 끊는다(domain/levelSettings.treeMaxDepth 와 동일 규칙).
    const depthOf = new Map<string, number>()
    const resolve = (id: string): number => {
      const known = depthOf.get(id)
      if (known !== undefined) return known
      depthOf.set(id, 0)
      const p = byId.get(id)?.parent_id
      const d = p != null && byId.has(p) ? resolve(p) + 1 : 0
      depthOf.set(id, d)
      return d
    }
    const nodes = all
      .map(r => ({ row: r, depth: resolve(r.id) }))
      .filter(n => n.depth <= maxDepth)
      .sort((a, b) => a.depth - b.depth || a.row.sort_order - b.row.sort_order)
      .map(({ row, depth }) => ({
        id: row.id,
        external_ref: row.external_ref,
        name: row.name,
        parent_external_ref: row.parent_id ? byId.get(row.parent_id)?.external_ref ?? null : null,
        depth,
        level_idx: row.level_idx,
      }))

    return NextResponse.json({
      ok: true,
      levels,
      max_depth: levelDepth,
      nodes,
    })
  } catch (e) {
    console.error('[wbs-structure] 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
