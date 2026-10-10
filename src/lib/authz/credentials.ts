import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { type CredentialKind, hashMatches } from '@/lib/agent/token'
import { parseCredentialPrefix, tokenUsable } from '@/lib/domain/agentToken'
import { isProjectAdmin, isProjectMember, type Actor, type ProjectRole, type WorkspaceRole } from '@/lib/domain/authz'
import { UUID_RE } from '@/lib/domain/validate'
import { buildActor } from './buildActor'
import { requireModule } from '@/lib/modules/gate'
import { agentApiEnabled, minutesApiEnabled } from '@/lib/modules/flags'
import { noteRateFailureFor, rateLimitedFor, rateLimitedResponse } from '@/lib/http/rateLimit'

export type { CredentialKind } from '@/lib/agent/token'

/** SP7 §5.1.3. 평문 토큰과 해시는 호출부에 반환하지 않는다. */
export interface ResolvedCredential {
  id: string
  workspaceId: string
  kind: CredentialKind
  name: string
  tokenPrefix: string
  expiresAt: string
  scopes: readonly string[]
  projectIds: readonly string[] | null
  defaultProjectId: string | null
  defaultTeamId: string | null
  teamMap: Readonly<Record<string, string>>
  ownerUserId: string | null
}

type CredentialScope = Pick<ResolvedCredential, 'workspaceId' | 'projectIds'>
type Db = Pick<SupabaseClient, 'from'>

export interface CredentialTeamCandidate {
  id: string
  code: string
  active: boolean
}

/** 프로젝트/워크스페이스에 맞춰 읽은 후보 팀만 받는다. 명시된 매핑 실패는 폴백하지 않는다.
 *  요청이 team 을 보내지 않았으면(빈 값 — 0052) 매핑·code 일치를 건너뛰고 자격증명의 기본 팀, 그것도 없거나 이 범위의 팀이 아니면
 *  팀 없음({ teamId: null })이다. 기본 팀이 비활성이면 지금처럼 inactive(조용히 팀 없음으로 내리지 않는다 — 설정을 고치라는 신호).
 *  team 을 **명시했는데** 맞는 팀이 없을 때의 결과는 그대로다: 기본 팀이 이 범위에 있으면 그 팀, 없으면 not_found(400). */
export function resolveCredentialTeam(
  cred: Pick<ResolvedCredential, 'teamMap' | 'defaultTeamId'>,
  payloadTeam: string,
  teams: readonly CredentialTeamCandidate[],
): { ok: true; teamId: string | null } | { ok: false; reason: 'inactive' | 'not_found' } {
  const name = payloadTeam.trim()
  const choose = (team: CredentialTeamCandidate | undefined) => {
    if (!team) return { ok: false, reason: 'not_found' } as const
    if (!team.active) return { ok: false, reason: 'inactive' } as const
    return { ok: true, teamId: team.id } as const
  }
  if (name === '') {
    const fallback = teams.find(team => team.id === cred.defaultTeamId)
    return fallback ? choose(fallback) : { ok: true, teamId: null }
  }
  if (Object.hasOwn(cred.teamMap, name)) {
    return choose(teams.find(team => team.id === cred.teamMap[name]))
  }
  const matches = teams.filter(team => team.code === name)
  // 후보가 모호하면 배열 순서로 임의 귀속시키지 않는다.
  if (matches.length > 1) return { ok: false, reason: 'not_found' }
  if (matches.length === 1) return choose(matches[0])
  return choose(teams.find(team => team.id === cred.defaultTeamId))
}

/** null은 해당 워크스페이스의 모든 프로젝트. 워크스페이스 검사는 narrowActor에서 한다. */
export function credentialAllows(cred: Pick<ResolvedCredential, 'projectIds'>, projectId: string): boolean {
  return cred.projectIds === null || cred.projectIds.includes(projectId)
}

/** 현재 멤버십 ∩ 자격증명 범위. 플랫폼 관리자 권한으로 멤버십을 대신하지 않는다. */
export function narrowActor(actor: Actor, cred: CredentialScope): Actor {
  const workspaceRoles = new Map<string, WorkspaceRole>()
  const projectWorkspace = new Map<string, string>()
  const projectRoles = new Map<string, ProjectRole>()
  const memberIds = new Map<string, string>()
  const rosterTeams = new Map<string, { teamIds: readonly string[]; teamCodes: readonly string[] }>()
  const wsRole = actor.workspaceRoles.get(cred.workspaceId)
  if (wsRole !== undefined) {
    workspaceRoles.set(cred.workspaceId, wsRole)
    for (const [pid, wid] of actor.projectWorkspace) {
      if (wid !== cred.workspaceId || !credentialAllows(cred, pid)) continue
      projectWorkspace.set(pid, wid)
      const role = actor.projectRoles.get(pid)
      if (role !== undefined) projectRoles.set(pid, role)
      const memberId = actor.memberIds.get(pid)
      if (memberId !== undefined) memberIds.set(pid, memberId)
      const teams = actor.rosterTeams.get(pid)
      if (teams !== undefined) rosterTeams.set(pid, { teamIds: [...teams.teamIds], teamCodes: [...teams.teamCodes] })
    }
  }
  return { userId: actor.userId, isSuperuser: false, workspaceRoles, projectWorkspace, projectRoles, memberIds, rosterTeams }
}

const unavailable = () => NextResponse.json({ error: 'Not Found' }, { status: 404 })
const unauthorized = () => NextResponse.json({ error: '인증이 필요합니다.', code: 'unauthorized' }, { status: 401 })
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string')
const nullableUuid = (value: unknown) => value === null || uuid(value)

/** DB 손상/잘못된 응답 모양도 권한 확대(null 전체 범위 등)로 폴백하지 않는다. */
function resolvedRow(value: unknown, kind: CredentialKind, prefix: string): ResolvedCredential | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!uuid(row.id) || !uuid(row.workspace_id) || row.kind !== kind || row.token_prefix !== prefix ||
    typeof row.name !== 'string' || typeof row.expires_at !== 'string' ||
    !strings(row.scopes) || !(row.project_ids === null || (strings(row.project_ids) && row.project_ids.every(uuid))) ||
    !nullableUuid(row.default_project_id) || !nullableUuid(row.default_team_id) || !nullableUuid(row.owner_user_id) ||
    !row.team_map || typeof row.team_map !== 'object' || Array.isArray(row.team_map) ||
    !Object.values(row.team_map).every(uuid)) return null
  if (kind === 'agent_runner' ? row.owner_user_id === null : row.owner_user_id !== null) return null
  if (kind === 'minutes_api' && row.scopes.length !== 0) return null
  if (kind === 'agent_runner' && (row.default_team_id !== null || Object.keys(row.team_map).length !== 0)) return null
  const projectIds = row.project_ids as string[] | null
  if (row.default_project_id !== null && projectIds !== null && !projectIds.includes(row.default_project_id as string)) return null
  return {
    id: row.id, workspaceId: row.workspace_id, kind, name: row.name, tokenPrefix: prefix,
    expiresAt: row.expires_at, scopes: [...row.scopes], projectIds: projectIds === null ? null : [...projectIds],
    defaultProjectId: row.default_project_id as string | null, defaultTeamId: row.default_team_id as string | null,
    teamMap: Object.fromEntries(Object.entries(row.team_map)), ownerUserId: row.owner_user_id as string | null,
  }
}

/** §5.1.3: 킬스위치 → Bearer → 조회 → enabled/revoked/expires → hash. 실패 사유는 전부 401.
 *  요청 제한(src/lib/http/rateLimit.ts 'apiCredential'): 같은 IP 의 인증 실패가 한도를 채우면 토큰을 **확인하지 않고** 429 + Retry-After 다
 *  (확인한 뒤 가르면 429/200 의 차이가 토큰의 유효 여부를 드러낸다). 세는 것은 토큰이 틀린 실패뿐이다 — 성공과 조회 장애는 세지 않는다. */
export async function resolveCredential(req: Request, admin: Db, kind: CredentialKind): Promise<ResolvedCredential | NextResponse> {
  if (kind !== 'agent_runner' && kind !== 'minutes_api') return unauthorized()
  if (!(kind === 'minutes_api' ? minutesApiEnabled() : agentApiEnabled())) return unavailable()
  const wait = rateLimitedFor('apiCredential', req.headers)
  if (wait > 0) return rateLimitedResponse(wait)
  const denied = () => { noteRateFailureFor('apiCredential', req.headers); return unauthorized() }
  const header = req.headers.get('authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const prefix = bearer ? parseCredentialPrefix(bearer, kind) : null
  if (!bearer || !prefix) return denied()
  let cred: ResolvedCredential
  try {
    const { data, error } = await admin.from('integration_credentials')
      .select('id, workspace_id, kind, name, token_prefix, token_hash, scopes, project_ids, default_project_id, default_team_id, team_map, owner_user_id, enabled, revoked_at, expires_at, workspaces(archived_at)')
      .eq('token_prefix', prefix).eq('kind', kind).maybeSingle()
    if (error) {
      console.error('[credentials] 자격증명 조회 실패(거절)')
      return unauthorized()
    }
    const row = data as Record<string, unknown> | null
    if (!row || typeof row.enabled !== 'boolean' || !(row.revoked_at === null || typeof row.revoked_at === 'string') ||
      typeof row.expires_at !== 'string' || !tokenUsable({ enabled: row.enabled, revoked_at: row.revoked_at, expires_at: row.expires_at }).ok ||
      !hashMatches(bearer, row.token_hash as string)) return denied()
    const resolved = resolvedRow(row, kind, prefix)
    if (!resolved) return unauthorized()
    // 보관된 워크스페이스(0056)의 자격증명은 인증 단계에서 거부한다 — 토큰은 폐기하지 않으므로 복원하면 다시 동작한다.
    // 토큰은 맞았으므로 실패 횟수로 세지 않고(요청 제한은 틀린 토큰만 센다), 응답은 다른 인증 실패와 같은 401 이다(보관 사실을 알리지 않는다).
    // 보관 시각을 읽지 못했으면(임베드 없음·null·archived_at 없음) 보관으로 본다 — 인증은 모르면 닫는다(fail-closed).
    const e = row.workspaces as { archived_at?: unknown } | Array<{ archived_at?: unknown }> | null | undefined
    const w = Array.isArray(e) ? e[0] : e
    if (!w || w.archived_at !== null) return unauthorized()
    cred = resolved
  } catch {
    console.error('[credentials] 자격증명 조회 예외(거절)')
    return unauthorized()
  }
  // 응답 종료 뒤 버려질 수 있는 미대기 Promise를 만들지 않는다. 갱신 실패는 인증 결과를 바꾸지 않는다.
  try {
    const { error } = await admin.from('integration_credentials')
      .update({ last_used_at: new Date().toISOString() }).eq('id', cred.id).eq('workspace_id', cred.workspaceId)
    if (error) console.error('[credentials] last_used_at 갱신 실패')
  } catch {
    console.error('[credentials] last_used_at 갱신 예외')
  }
  return cred
}

/** PAT는 토큰 소유자 본인만 사용한다. 회의록 자격증명은 해석된 payload 사용자의 현재 권한을 쓴다. */
export async function actorFromCredential(admin: Db, cred: ResolvedCredential, userId: string): Promise<Actor> {
  if (cred.kind === 'agent_runner' && cred.ownerUserId !== userId) throw new Error('토큰 소유자와 사용자가 다릅니다.')
  return narrowActor(await buildActor(admin, userId), cred)
}

/** 기존 PAT의 work:report 호환은 유지하되 요청 가능한 스코프는 두 개뿐이다. */
export function credentialHasScope(cred: Pick<ResolvedCredential, 'kind' | 'scopes'>, scope: 'work:read' | 'work:claim'): boolean {
  if (cred.kind !== 'agent_runner' || (scope !== 'work:read' && scope !== 'work:claim')) return false
  return cred.scopes.includes(scope) || (scope === 'work:claim' && cred.scopes.includes('work:report'))
}

/** 에이전트 라우트가 재사용할 권한 관문: 토큰 범위 ∩ 현재 권한 ∩ 자원 범위 ∩ 활성 모듈. */
export async function authorizeAgentCredentialProject(
  admin: Db, cred: ResolvedCredential, projectId: string, scope: 'work:read' | 'work:claim',
  opts: { requireAdmin?: boolean } = {},
): Promise<Actor | NextResponse> {
  if (cred.kind !== 'agent_runner' || !cred.ownerUserId) return unauthorized()
  if (!credentialHasScope(cred, scope)) {
    return NextResponse.json({ code: 'insufficient_scope', error: `이 작업에는 ${scope} 스코프가 필요합니다.` }, { status: 403 })
  }
  if (!credentialAllows(cred, projectId)) return unavailable()
  // 호출부가 전달한 이메일/사용자 ID 대신 토큰 소유자의 현재 권한을 사용한다.
  const actor = await actorFromCredential(admin, cred, cred.ownerUserId)
  if (!(opts.requireAdmin ? isProjectAdmin(actor, projectId) : isProjectMember(actor, projectId))) return unavailable()
  if (!(await requireModule({ projectId }, 'agents', { client: admin })).ok) return unavailable()
  return actor
}
