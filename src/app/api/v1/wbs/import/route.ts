import { createHash } from 'node:crypto'
import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound,
  isAgentProjectAdmin, isAgentProjectMember, requireAgentProject, requireScope, resolveAgentPrincipal, patProjectAllowed,
} from '@/lib/agent/externalApi'
import { isUuidLike } from '@/lib/domain/agentWork'
import { runWbsImport, validateLevels, type ImportNode, type LevelDecl } from '@/lib/agent/wbsImport'
import { emitNotification } from '@/lib/notify/emit'

/** POST /api/v1/wbs/import — export JSON 모듈별 upsert 업로드(§2.6). PAT 전용·관리자 전용. */
export const dynamic = 'force-dynamic'

const MAX_NODES = 1000

function computeImportDigest(params: {
  projectId: string
  module: string
  levels: LevelDecl[] | null
  attachRef: string | null
  nodes: unknown[]
}): string {
  const jsonStr = JSON.stringify({
    project_id: params.projectId,
    module: params.module,
    levels: params.levels,
    attach_ref: params.attachRef,
    nodes: params.nodes,
  })
  return createHash('sha256').update(jsonStr, 'utf8').digest('hex')
}

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = raw as Record<string, unknown>
  const projectId = typeof b.project_id === 'string' ? b.project_id : ''
  const module_ = typeof b.module === 'string' ? b.module.trim() : ''
  if (!isUuidLike(projectId)) return apiBadRequest('project_id가 필요합니다.')
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(module_)) return apiBadRequest('module 형식이 올바르지 않습니다.')
  if (!Array.isArray(b.nodes) || b.nodes.length === 0) return apiBadRequest('nodes가 필요합니다.')
  if (b.nodes.length > MAX_NODES) return apiBadRequest(`nodes는 ${MAX_NODES}건 이하여야 합니다.`)

  const rawCommandId = (typeof b.command_id === 'string' ? b.command_id : null) ?? req.headers.get('x-command-id')
  let commandId: string | null = null
  if (rawCommandId !== null && rawCommandId !== '') {
    if (!isUuidLike(rawCommandId)) return apiBadRequest('command_id 형식이 올바르지 않습니다.')
    commandId = rawCommandId
  }

  // v2.2(nlevel) — 구조 검증은 인증 전(순수), DB 대조는 인증 후. 스펙 §import 계약 v2.2.
  const attachRef = typeof b.attach_ref === 'string' ? b.attach_ref.trim() : ''
  let levels: LevelDecl[] | null = null
  if (b.levels !== undefined) {
    const v = validateLevels(b.levels)
    if ('error' in v) return apiBadRequest(`levels 검증 실패: ${v.error}`)
    levels = v.levels
  }
  if (attachRef && !levels) return apiBadRequest('attach_ref 업로드(PL)는 levels 가 필수입니다.')

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    const scopeErr = requireScope(principal, 'work:claim')
    if (scopeErr) return scopeErr
    if (!patProjectAllowed(principal, projectId)) return apiNotFound()
    if (!(await requireAgentProject(admin, projectId, principal))) return apiNotFound()
    // 비멤버는 404(존재 은닉, 계약 §인증 — "PAT principal 은 멤버십 없으면 404"). 관리자 판정보다 먼저 —
    // 아니면 완전 비멤버가 관리자 판정에서 403 forbidden_role 을 받아 "프로젝트가 존재한다"가 샌다.
    if (!(await isAgentProjectMember(admin, principal.userId, projectId, principal))) return apiNotFound()
    // import = 구조 쓰기 + 자동 발행 트리거 — 발행과 같은 관리자 전용(§2.8). member 는 403.
    // 판정은 isAgentProjectAdmin 한 곳 — 조회 실패는 헬퍼가 throw 해 아래 catch 가 500 으로 답한다.
    if (!(await isAgentProjectAdmin(admin, principal.userId, projectId, principal))) {
      return apiFail(403, 'forbidden_role', '프로젝트 관리자만 업로드할 수 있습니다.')
    }

    // 멱등성 영수증 선확인 (command_id 가 있는 경우)
    let digest: string | null = null
    if (commandId) {
      digest = computeImportDigest({
        projectId,
        module: module_,
        levels,
        attachRef: attachRef || null,
        nodes: b.nodes as unknown[],
      })

      const { data: receipt, error: receiptErr } = await admin
        .from('command_receipts')
        .select('command_digest, result')
        .eq('actor', principal.userId)
        .eq('command_id', commandId)
        .eq('kind', 'wbs_import')
        .maybeSingle()

      if (receiptErr) {
        console.error('[wbs-import] 영수증 선확인 실패:', receiptErr.message)
        return apiInternalError('영수증 확인에 실패했습니다.')
      }

      if (receipt) {
        if (receipt.command_digest !== digest) {
          return apiFail(409, 'command_reused', '이미 사용된 명령 ID입니다.')
        }
        const savedResult = receipt.result as Record<string, unknown>
        return NextResponse.json({
          ...savedResult,
          status: 'duplicate',
        })
      }
    }

    // 실행 코어 공유 — 웹 업로드 액션과 같은 시퀀스(runWbsImport). 여기서 재구현하지 않는다.
    const result = await runWbsImport(admin, {
      projectId, module: module_, actorUserId: principal.userId,
      levels, attachRef: attachRef || null, nodes: b.nodes as ImportNode[],
    })
    if (!result.ok) {
      // apply_failed 는 종전대로 409, 나머지 계약 위반은 400.
      return apiFail(result.code === 'apply_failed' ? 409 : 400, result.code, result.message)
    }

    const responsePayload = {
      ok: true, upserted: result.upserted, skipped: result.skipped,
      unmatched_assignees: result.unmatched, non_leaf_skipped: result.nonLeafSkipped,
      orders_created: result.ordersCreated,
    }

    // 멱등성 영수증 기록
    if (commandId && digest) {
      let workspaceId: string | null = principal.credential?.workspaceId ?? null
      if (!workspaceId) {
        const { data: pRow } = await admin
          .from('projects')
          .select('workspace_id')
          .eq('id', projectId)
          .maybeSingle()
        workspaceId = (pRow as { workspace_id: string } | null)?.workspace_id ?? null
      }

      if (workspaceId) {
        const { error: insErr } = await admin.from('command_receipts').insert({
          actor: principal.userId,
          command_id: commandId,
          kind: 'wbs_import',
          workspace_id: workspaceId,
          project_id: projectId,
          command_digest: digest,
          result: responsePayload,
        })
        if (insErr) {
          // 동시 요청 경합 시 23505 unique_violation
          if (insErr.code === '23505') {
            const { data: rec } = await admin
              .from('command_receipts')
              .select('command_digest, result')
              .eq('actor', principal.userId)
              .eq('command_id', commandId)
              .eq('kind', 'wbs_import')
              .maybeSingle()
            if (rec && rec.command_digest === digest) {
              return NextResponse.json({
                ...(rec.result as Record<string, unknown>),
                status: 'duplicate',
              })
            }
          }
          console.error('[wbs-import] 영수증 저장 실패:', insErr.message)
        }
      }
    }

    // 실행자에게 업로드 결과 통지 — 응답 확정 후 실행(after), 본 응답을 막지 않음.
    if (principal.userId) {
      const notifyUserId = principal.userId
      after(() => emitNotification({
        type: 'system.import_result',
        projectId,
        entityType: 'wbs_import',
        payload: {
          title: 'WBS 업로드',
          detail: `upserted ${result.upserted}건, 담당자 미매칭 ${result.unmatched.length}건`,
          href: `/p/${projectId}/wbs`,
        },
        recipientUserIds: [notifyUserId],
      }).catch(() => {
        // 알림 실패는 로깅만 하고 본 응답에 영향을 주지 않음(emitNotification 내부에서 로깅)
      }))
    }

    return NextResponse.json(responsePayload)
  } catch (e) {
    console.error('[wbs-import] 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = () => apiFail(404, 'not_found', 'Not Found')
export const PUT = GET
export const DELETE = GET
export const PATCH = GET
export const OPTIONS = GET
