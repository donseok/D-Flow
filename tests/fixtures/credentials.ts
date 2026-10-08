// 외부 API 테스트 공용 자격증명 fixture — 인증 원천은 integration_credentials 행 하나뿐이다(SP7 §5.1.4).
// resolveCredential 은 이 표를 두 번 읽는다: prefix 조회(maybeSingle) → last_used_at 갱신(update). 큐 목에는 queue() 두 응답을 싣는다.
// 행은 resolvedRow 의 모양 검사를 통과해야 한다 — id·workspace_id·owner_user_id·project_ids 는 UUID 여야 한다.
import { generateCredentialToken, type CredentialKind } from '@/lib/agent/token'
import type { AgentPrincipal } from '@/lib/agent/externalApi'
import type { ResolvedCredential } from '@/lib/authz/credentials'

/** 자격증명이 묶인 워크스페이스 — actor fixture 의 소속 워크스페이스와 같아야 narrowActor 가 프로젝트를 남긴다. */
export const CRED_WS = '5a000000-0000-4000-8000-000000000001'
/** agent_runner 자격증명의 소유자(= 요청의 신원). auth.admin.getUserById 목이 같은 id 를 돌려줘야 한다. */
export const CRED_OWNER = '5a000000-0000-4000-8000-0000000000a1'
export const CRED_OWNER_EMAIL = 'dev@example.com'
export const CRED_ID = '5a000000-0000-4000-8000-0000000000c1'

type Resp = { data?: unknown; error?: { message: string } | null }

export interface CredentialRow {
  id: string; workspace_id: string; kind: CredentialKind; name: string
  token_prefix: string; token_hash: string; scopes: string[]
  project_ids: string[] | null; default_project_id: string | null; default_team_id: string | null
  team_map: Record<string, string>; owner_user_id: string | null
  enabled: boolean; revoked_at: string | null; expires_at: string
}

export interface TestCredential {
  /** 평문 토큰 — Authorization: Bearer 뒤에 싣는다. */
  token: string
  prefix: string
  row: CredentialRow
  /** 이 행을 고쳐 쓴 변형(토큰은 같다) — 스코프 부족·프로젝트 한정·회수 케이스용. */
  with(over: Partial<CredentialRow>): TestCredential
  /** 테이블 큐 목의 integration_credentials 응답 2건(조회 → last_used_at 갱신). */
  queue(): Resp[]
}

function build(token: { token: string; prefix: string }, row: CredentialRow): TestCredential {
  return {
    token: token.token, prefix: token.prefix, row,
    with: (over) => build(token, { ...row, ...over }),
    queue: () => [{ data: row }, { data: null }],
  }
}

/** 에이전트 API(PAT) 자격증명 — 기본은 CRED_WS 의 전 프로젝트, 스코프 work:read·work:claim. */
export function agentCredential(over: Partial<CredentialRow> = {}): TestCredential {
  const t = generateCredentialToken('agent_runner')
  return build(t, {
    id: CRED_ID, workspace_id: CRED_WS, kind: 'agent_runner', name: 'test-pat',
    token_prefix: t.prefix, token_hash: t.hash, scopes: ['work:read', 'work:claim'],
    project_ids: null, default_project_id: null, default_team_id: null, team_map: {},
    owner_user_id: CRED_OWNER, enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
    ...over,
  })
}

/** 회의록 연동 자격증명 — 소유자·스코프가 없다(resolvedRow 가 강제). 기본은 CRED_WS 의 전 프로젝트. */
export function minutesCredential(over: Partial<CredentialRow> = {}): TestCredential {
  const t = generateCredentialToken('minutes_api')
  return build(t, {
    id: CRED_ID, workspace_id: CRED_WS, kind: 'minutes_api', name: 'test-minutes',
    token_prefix: t.prefix, token_hash: t.hash, scopes: [],
    project_ids: null, default_project_id: null, default_team_id: null, team_map: {},
    owner_user_id: null, enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
    ...over,
  })
}

/** auth.admin.getUserById 목 — agent_runner 소유자 해석용. */
export function ownerLookup(id: string = CRED_OWNER, email: string = CRED_OWNER_EMAIL) {
  return async () => ({ data: { user: { id, email } }, error: null })
}

/** 행 → resolveCredential 이 돌려주는 모양(camelCase). 리졸버를 거치지 않고 principal 을 직접 만드는 단위 테스트용. */
export function resolvedCredential(row: CredentialRow): ResolvedCredential {
  return {
    id: row.id, workspaceId: row.workspace_id, kind: row.kind, name: row.name, tokenPrefix: row.token_prefix,
    expiresAt: row.expires_at, scopes: [...row.scopes], projectIds: row.project_ids === null ? null : [...row.project_ids],
    defaultProjectId: row.default_project_id, defaultTeamId: row.default_team_id, teamMap: { ...row.team_map },
    ownerUserId: row.owner_user_id,
  }
}

/** resolveAgentPrincipal 이 이 자격증명으로 만드는 principal — 소유자가 신원이다. */
export function agentPrincipal(cred: TestCredential, email: string = CRED_OWNER_EMAIL): AgentPrincipal {
  const c = resolvedCredential(cred.row)
  if (!c.ownerUserId) throw new Error('agent_runner 자격증명에는 소유자가 있어야 한다')
  return {
    kind: 'pat', runnerId: c.id, userId: c.ownerUserId, userEmail: email, scopes: [...c.scopes],
    projectId: c.projectIds?.length === 1 ? c.projectIds[0] : null, runnerKind: 'user_pat',
    tokenExpiresAt: c.expiresAt, runnerName: c.name, tokenPrefix: c.tokenPrefix, credential: c,
  }
}
