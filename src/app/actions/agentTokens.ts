'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { agentApiEnabled } from '@/lib/agent/externalApi'
import { generateAgentToken } from '@/lib/agent/token'
import { requireModule } from '@/lib/modules/gate'
import { isUuidLike } from '@/lib/domain/agentWork'
import { serverTranslator } from '@/lib/i18n/server'
import { fill } from '@/lib/i18n/translate'
import { denied } from '@/lib/i18n/serverText'

/**
 * PAT 발급·관리 — 계약 v2.0. 발급도 킬스위치(AGENT_API_ENABLED) 뒤(§2.1).
 * work:report 스코프는 **폐지**됐다(2026-08-25) — claim 할 수 있으면 그 결과도 적을 수 있어야
 * 사이클이 완주되고, claim 이 원래 무제한이라 보고만 따로 막는 건 실질 방어선이 아니었다
 * (본인 claim 건만 쓸 수 있다는 강제는 report 라우트의 claimed_by_user_id 판정이 한다 §2.3).
 * 그래서 발급 가능 스코프에서 뺀다. 이미 발급된 토큰의 work:report 는 서버 판정부가
 * work:claim 과 동등하게 수용한다(externalApi.requireScope) — 옛 토큰을 끊지 않기 위해서다.
 * integration_credentials 는 RLS 정책 0 — 이 액션이 유일한 관문이다(fail-closed).
 */

const SELF_ISSUE_SCOPES = new Set(['work:read', 'work:claim'])
const MAX_EXPIRES_DAYS = 180
const NAME_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣 ._-]{0,63}$/

async function sessionUserId(): Promise<string | null> {
  const sb = await createServerClient()
  const { data, error } = await sb.auth.getUser()
  if (error || !data?.user) return null
  return data.user.id
}

export async function createAgentToken(input: {
  name: string; workspaceId?: string; projectIds?: string[] | null; projectId?: string | null; scopes: string[]; expiresDays: number
}): Promise<{ ok: true; token: string; prefix: string } | { ok: false; error: string }> {
  const t = await serverTranslator()
  if (!agentApiEnabled()) return { ok: false, error: t('srv.agentTokens.agentApiOffTokensCannot') }
  const uid = await sessionUserId()
  if (!uid) return { ok: false, error: t('common.err.signIn') }
  if (!input || typeof input.name !== 'string' || !Array.isArray(input.scopes)) return { ok: false, error: t('err.invalidRequest') }
  const name = input.name.trim()
  if (!NAME_RE.test(name)) return { ok: false, error: t('srv.agentTokens.nameFormatNotValid') }
  if (input.workspaceId !== undefined && (typeof input.workspaceId !== 'string' || !isUuidLike(input.workspaceId))) return { ok: false, error: t('err.invalidWorkspace') }
  const projectIds = input.projectIds !== undefined ? input.projectIds : input.projectId ? [input.projectId] : null
  if (projectIds !== null && (!Array.isArray(projectIds) || projectIds.length === 0 || projectIds.some(id => typeof id !== 'string' || !isUuidLike(id)))) return { ok: false, error: t('srv.agentTokens.invalidProject') }
  if (input.scopes.length === 0) return { ok: false, error: t('srv.agentTokens.selectLeastOneScope') }
  for (const s of input.scopes) {
    if (!SELF_ISSUE_SCOPES.has(s)) return { ok: false, error: fill(t('srv.agentTokens.notKnownScope'), { s }) }
  }
  const days = input.expiresDays
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRES_DAYS) {
    return { ok: false, error: fill(t('srv.agentTokens.expiryMust1Days'), { maxExpiresDays: MAX_EXPIRES_DAYS }) }
  }

  const admin = createAdminClient()
  // 보관된 워크스페이스(0056)의 소속은 세지 않는다 — 세면 "활성 하나 + 보관 하나"인 사람이 워크스페이스를 고르라는 거부를 받는다(그 워크스페이스는 보이지도 않는다).
  // 보관된 워크스페이스를 직접 지정한 발급은 아래 모듈 관문(워크스페이스 설정 해석기)이 닫는다. 상한은 "둘 이상인가"만 가리면 되지만 보관분을 걸러 낸 뒤에 세야 해서 넉넉히 읽는다
  let workspaceMemberships = admin.from('workspace_members').select('workspace_id, workspaces(archived_at)').eq('user_id', uid)
  if (input.workspaceId) workspaceMemberships = workspaceMemberships.eq('workspace_id', input.workspaceId)
  const { data: allRows, error: membershipErr } = await workspaceMemberships.limit(50)
  if (membershipErr) return { ok: false, error: t('srv.agentTokens.couldNotVerifyWorkspaceMembership') }
  const rows = ((allRows ?? []) as Array<{ workspace_id: unknown; workspaces?: unknown }>).filter((row) => {
    if (!Object.hasOwn(row, 'workspaces')) return true   // 임베드를 싣지 않는 응답(테스트 대역) — 보관 판정은 모듈 관문이 다시 한다
    const e = row.workspaces as { archived_at?: unknown } | Array<{ archived_at?: unknown }> | null
    const w = Array.isArray(e) ? e[0] : e
    return !!w && w.archived_at === null
  })
  if (!rows || rows.length !== 1 || typeof rows[0].workspace_id !== 'string' || !rows[0].workspace_id) return { ok: false, error: t('srv.agentTokens.selectOneWorkspaceBelong') }
  const workspaceId = rows[0].workspace_id as string
  const gate = await requireModule({ workspaceId }, 'agents', { client: admin })
  if (!gate.ok) return denied(gate)
  // DB 트리거가 프로젝트 소속과 현재 소유자 멤버십을 다시 검사한다.
  const allowedProjects = projectIds === null ? null : [...new Set(projectIds)]
  const { token, prefix, hash } = generateAgentToken()
  const { data, error } = await admin.from('integration_credentials').insert({
    workspace_id: workspaceId, name, kind: 'agent_runner', owner_user_id: uid, token_prefix: prefix, token_hash: hash,
    project_ids: allowedProjects, default_project_id: allowedProjects?.length === 1 ? allowedProjects[0] : null, scopes: [...new Set(input.scopes)],
    expires_at: new Date(Date.now() + days * 86400_000).toISOString(), created_by: uid,
  }).select('id')
  if (error) {
    // unique(owner_user_id, name) 충돌 등 — DB 메시지를 위장하지 않는다(표시=로깅).
    return { ok: false, error: fill(t('srv.agentTokens.couldNotIssueToken'), { message: error.message }) }
  }
  if (!data || data.length === 0) return { ok: false, error: t('srv.agentTokens.couldNotIssueToken2') }
  revalidatePath('/account')
  return { ok: true, token, prefix } // 평문은 이 응답이 유일하다 — 저장·로깅 금지.
}

export async function revokeAgentToken(runnerId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await serverTranslator()
  if (!isUuidLike(runnerId)) return { ok: false, error: t('err.invalidRequest') }
  const uid = await sessionUserId()
  if (!uid) return { ok: false, error: t('common.err.signIn') }
  const admin = createAdminClient()
  const { data, error } = await admin.from('integration_credentials')
    .update({ revoked_at: new Date().toISOString(), enabled: false })
    .eq('id', runnerId).eq('owner_user_id', uid).eq('kind', 'agent_runner') // 본인 소유만 — 소유자 한정이 곧 권한 판정
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: t('srv.agentTokens.tokenNotFound') }
  revalidatePath('/account')
  return { ok: true }
}

export async function listMyAgentTokens(): Promise<
  | { ok: true; tokens: Array<{ id: string; name: string; token_prefix: string; scopes: string[]; workspace_id: string; project_ids: string[] | null; project_id: string | null; expires_at: string; revoked_at: string | null; last_seen_at: string | null }> }
  | { ok: false; error: string }
> {
  const t = await serverTranslator()
  const uid = await sessionUserId()
  if (!uid) return { ok: false, error: t('common.err.signIn') }
  const admin = createAdminClient()
  // token_hash 는 어떤 경로로도 반환하지 않는다.
  const { data, error } = await admin.from('integration_credentials')
    .select('id, workspace_id, name, token_prefix, scopes, project_ids, expires_at, revoked_at, last_used_at')
    .eq('owner_user_id', uid).eq('kind', 'agent_runner').order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, tokens: (data ?? []).map(r => ({ ...r, project_id: r.project_ids?.length === 1 ? r.project_ids[0] : null, last_seen_at: r.last_used_at })) as never }
}
