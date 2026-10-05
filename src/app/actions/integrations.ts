'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspaceAdmin } from '@/lib/authz'
import { requireModule } from '@/lib/modules/gate'
import { generateCredentialToken } from '@/lib/agent/token'
import { UUID_RE } from '@/lib/domain/validate'

const MAX_EXPIRES_DAYS = 365
const NAME_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣 ._-]{0,63}$/

export interface WorkspaceCredentialItem {
  id: string
  workspace_id: string
  kind: 'minutes_api' | 'agent_runner'
  name: string
  token_prefix: string
  scopes: string[]
  project_ids: string[] | null
  default_project_id: string | null
  default_team_id: string | null
  team_map: Record<string, string>
  owner_user_id: string | null
  owner_name: string | null
  owner_email: string | null
  enabled: boolean
  revoked_at: string | null
  expires_at: string
  last_used_at: string | null
  created_at: string
  created_by: string | null
}

/**
 * 워크스페이스 관리자 전용 회의록 연동 자격증명(minutes_api) 발급.
 * 계약: docs/superpowers/specs/2026-09-23-generic-platform-design.md §5.1.5
 */
export async function createMinutesApiCredential(input: {
  workspaceId: string
  name: string
  projectIds?: string[] | null
  defaultProjectId?: string | null
  defaultTeamId?: string | null
  teamMap?: Record<string, string>
  expiresDays: number
}): Promise<{ ok: true; token: string; prefix: string } | { ok: false; error: string }> {
  if (!input || typeof input.workspaceId !== 'string' || !UUID_RE.test(input.workspaceId)) {
    return { ok: false, error: '잘못된 워크스페이스입니다.' }
  }

  const guard = await requireWorkspaceAdmin(input.workspaceId)
  if (!guard.ok) return { ok: false, error: guard.error }

  const admin = createAdminClient()
  const modGate = await requireModule({ workspaceId: input.workspaceId }, 'minutes_integration', { client: admin })
  if (!modGate.ok) return { ok: false, error: '이 워크스페이스에서 회의록 연동이 꺼져 있습니다.' }

  if (typeof input.name !== 'string') return { ok: false, error: '이름을 입력하세요.' }
  const trimmedName = input.name.trim()
  if (!NAME_RE.test(trimmedName)) return { ok: false, error: '이름 형식이 올바르지 않습니다(1~64자).' }

  let projectIds: string[] | null = null
  if (input.projectIds !== undefined && input.projectIds !== null) {
    if (!Array.isArray(input.projectIds) || input.projectIds.some(id => typeof id !== 'string' || !UUID_RE.test(id))) {
      return { ok: false, error: '프로젝트 형식이 올바르지 않습니다.' }
    }
    projectIds = input.projectIds.length > 0 ? [...new Set(input.projectIds)] : null
  }

  let defaultProjectId: string | null = null
  if (input.defaultProjectId) {
    if (typeof input.defaultProjectId !== 'string' || !UUID_RE.test(input.defaultProjectId)) {
      return { ok: false, error: '기본 프로젝트 형식이 올바르지 않습니다.' }
    }
    if (projectIds !== null && !projectIds.includes(input.defaultProjectId)) {
      return { ok: false, error: '기본 프로젝트는 허용된 프로젝트 목록에 포함되어야 합니다.' }
    }
    defaultProjectId = input.defaultProjectId
  }

  let defaultTeamId: string | null = null
  if (input.defaultTeamId) {
    if (typeof input.defaultTeamId !== 'string' || !UUID_RE.test(input.defaultTeamId)) {
      return { ok: false, error: '기본 팀 형식이 올바르지 않습니다.' }
    }
    defaultTeamId = input.defaultTeamId
  }

  const teamMap: Record<string, string> = {}
  if (input.teamMap && typeof input.teamMap === 'object' && !Array.isArray(input.teamMap)) {
    for (const [key, val] of Object.entries(input.teamMap)) {
      const code = key.trim()
      if (!code) continue
      if (typeof val !== 'string' || !UUID_RE.test(val)) {
        return { ok: false, error: `팀 매핑(${code})의 팀 ID 형식이 올바르지 않습니다.` }
      }
      teamMap[code] = val
    }
  }

  const days = input.expiresDays
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRES_DAYS) {
    return { ok: false, error: `만료 기간은 1~${MAX_EXPIRES_DAYS}일입니다.` }
  }

  const { token, prefix, hash } = generateCredentialToken('minutes_api')

  const { data, error } = await admin.from('integration_credentials').insert({
    workspace_id: input.workspaceId,
    kind: 'minutes_api',
    name: trimmedName,
    token_prefix: prefix,
    token_hash: hash,
    scopes: [],
    project_ids: projectIds,
    default_project_id: defaultProjectId,
    default_team_id: defaultTeamId,
    team_map: teamMap,
    owner_user_id: null,
    enabled: true,
    expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
    created_by: guard.actor.userId,
  }).select('id')

  if (error) {
    return { ok: false, error: `자격증명 발급 실패: ${error.message}` }
  }
  if (!data || data.length === 0) return { ok: false, error: '자격증명 발급 실패(0행 반환)' }

  revalidatePath('/w/[slug]/settings/integrations', 'page')
  return { ok: true, token, prefix }
}

/**
 * 워크스페이스 관리자 전용 자격증명(minutes_api 및 agent_runner) 회수.
 */
export async function revokeIntegrationCredential(
  credentialId: string,
  workspaceId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!UUID_RE.test(credentialId) || !UUID_RE.test(workspaceId)) {
    return { ok: false, error: '잘못된 요청입니다.' }
  }

  const guard = await requireWorkspaceAdmin(workspaceId)
  if (!guard.ok) return { ok: false, error: guard.error }

  const admin = createAdminClient()
  const { data, error } = await admin.from('integration_credentials')
    .update({ revoked_at: new Date().toISOString(), enabled: false })
    .eq('id', credentialId)
    .eq('workspace_id', workspaceId)
    .select('id')

  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: '대상 자격증명을 찾을 수 없습니다.' }

  revalidatePath('/w/[slug]/settings/integrations', 'page')
  return { ok: true }
}

/**
 * 워크스페이스 관리자 전용 자격증명 목록 조회 (minutes_api + agent_runner).
 */
export async function listWorkspaceCredentials(
  workspaceId: string,
): Promise<{ ok: true; credentials: WorkspaceCredentialItem[] } | { ok: false; error: string }> {
  if (!UUID_RE.test(workspaceId)) {
    return { ok: false, error: '잘못된 워크스페이스입니다.' }
  }

  const guard = await requireWorkspaceAdmin(workspaceId)
  if (!guard.ok) return { ok: false, error: guard.error }

  const admin = createAdminClient()
  const { data, error } = await admin.from('integration_credentials')
    .select('id, workspace_id, kind, name, token_prefix, scopes, project_ids, default_project_id, default_team_id, team_map, owner_user_id, enabled, revoked_at, expires_at, last_used_at, created_at, created_by')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) return { ok: false, error: error.message }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const ownerIds = [...new Set(rows.map(r => r.owner_user_id).filter(Boolean))] as string[]
  const ownerProfiles = new Map<string, { displayName: string | null; email: string | null }>()

  if (ownerIds.length > 0) {
    const { data: profs } = await admin.from('profiles')
      .select('user_id, display_name, email')
      .in('user_id', ownerIds)
    for (const p of profs ?? []) {
      ownerProfiles.set(p.user_id, { displayName: p.display_name, email: p.email })
    }
  }

  const credentials: WorkspaceCredentialItem[] = rows.map(r => {
    const ownerId = (r.owner_user_id as string) || null
    const prof = ownerId ? ownerProfiles.get(ownerId) : null
    return {
      id: r.id as string,
      workspace_id: r.workspace_id as string,
      kind: r.kind as 'minutes_api' | 'agent_runner',
      name: r.name as string,
      token_prefix: r.token_prefix as string,
      scopes: (r.scopes as string[]) ?? [],
      project_ids: (r.project_ids as string[] | null) ?? null,
      default_project_id: (r.default_project_id as string | null) ?? null,
      default_team_id: (r.default_team_id as string | null) ?? null,
      team_map: (r.team_map as Record<string, string>) ?? {},
      owner_user_id: ownerId,
      owner_name: prof?.displayName ?? null,
      owner_email: prof?.email ?? null,
      enabled: r.enabled as boolean,
      revoked_at: (r.revoked_at as string | null) ?? null,
      expires_at: r.expires_at as string,
      last_used_at: (r.last_used_at as string | null) ?? null,
      created_at: r.created_at as string,
      created_by: (r.created_by as string | null) ?? null,
    }
  })

  return { ok: true, credentials }
}
