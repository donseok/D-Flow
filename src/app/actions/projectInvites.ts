'use server'
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin, requireWorkspaceAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadInviteDomains } from '@/lib/data/inviteDomains'
import { projectTeams } from '@/lib/teams/source'
import type { Team } from '@/lib/domain/teams'
import { ACCESS_ROLE, isAdminAccessRole } from '@/lib/domain/authz'
import { displayNameFrom } from '@/lib/domain/display-name'
import { hashInviteToken } from '@/lib/domain/inviteToken'
import { getTransport } from '@/lib/mail/transport'
import { renderInviteMail } from '@/lib/mail/projectInvite'
import { loadDisplayBranding } from '@/lib/settings/displayBranding'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { projectTimezone } from '@/lib/calendar/load'
import {
  DEFAULT_INVITE_DAYS, inviteStatus, canonicalInviteEmail, isAllowedInviteDomain, normalizeInviteDays,
  normalizeInviteEmail, type InviteDomainSource, type InviteStatus,
} from '@/lib/domain/invites'

type AdminClient = ReturnType<typeof createAdminClient>
type AccessRole = 'admin' | 'member'

// 사용자에게 나가는 문구는 설계 §8 표의 원문이다. 원시 Postgres/Supabase 메시지를 그대로
// 올리지 않는다 — 초대 표면은 비로그인 경로와 맞닿아 있어 내부 구조를 흘리면 안 된다.
const ERR_LOOKUP = '초대를 확인할 수 없어 중단했습니다.'
const ERR_EMAIL = '이메일 형식을 확인해 주세요.'
const ERR_TEAM = '알 수 없는 팀입니다.'
const ERR_ACCESS = '알 수 없는 권한입니다.'
const ERR_ADMIN_INVITE = '관리자 권한 초대는 워크스페이스 관리자만 발급할 수 있습니다.'
const ERR_DAYS = '유효기간은 1~30일 사이여야 합니다.'
const ERR_DUP = '이 주소로 발급한 초대가 아직 유효합니다. 취소 후 다시 보내세요.'
/** 만료분만 남아 부분 유니크를 막고 있는 경우. 관리자가 취소 버튼을 눌러야 길이 열린다. */
const ERR_DUP_EXPIRED = '이 주소로 발급한 초대가 남아 있습니다. 목록에서 취소한 뒤 다시 보내세요.'
const ERR_REVOKE = '취소할 수 있는 초대가 아닙니다.'
const ERR_APP_URL = '앱 주소가 설정되지 않아 초대 링크를 만들 수 없습니다.'
const ERR_INIT = '연결 초기화 설정을 확인하세요.'

/** 도메인 거부 문구는 실제 판정에 쓰인 목록으로 조립한다 — 하드코딩하면 다른 도메인을
 *  설정한 배포에서 관리자가 "무엇을 넣어야 하는지" 거짓 안내를 받는다.
 *  목록이 비어 있으면 어떤 주소도 통과할 수 없으므로 고칠 곳을 안내한다(fail-closed) — 워크스페이스 설정이 명시 [] 면 그 설정을,
 *  env 가 있는데 쓸 항목이 없으면 env 를, 둘 다 없으면(제품 기본값) 둘 다를 가리킨다.
 *  ('*' 이면 도메인 검사를 통과하므로 이 문구에 '@*' 가 나올 일은 없다.) */
function domainError(domains: string[], source: InviteDomainSource): string {
  if (domains.length === 0 && source === 'workspace') {
    return '워크스페이스 초대 허용 도메인 설정에 쓸 수 있는 항목이 없어 초대할 수 없습니다. 워크스페이스 관리자에게 설정 확인을 요청하세요.'
  }
  if (domains.length === 0 && source === 'env') return '초대 허용 도메인이 설정되지 않아 초대할 수 없습니다. 운영자에게 INVITE_ALLOWED_DOMAINS 설정을 요청하세요.'
  if (domains.length === 0) return '초대 허용 도메인이 없어 초대할 수 없습니다. 워크스페이스 설정에서 허용 도메인을 정하거나 운영자에게 INVITE_ALLOWED_DOMAINS 설정을 요청하세요.'
  return `허용된 이메일 도메인(${domains.map((d) => `@${d}`).join(', ')})으로만 초대할 수 있습니다.`
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 초대 행 조회 열. DB 에는 토큰 해시만 있고(0003), 그 해시도 싣지 않는다 — 조회 키라 RSC 페이로드로 흘릴 이유가 없다. */
const INVITE_COLUMNS = 'id, email, access_role, role_label, team_ids, created_at, expires_at, revoked_at, redeemed_at'

export interface InviteRow {
  id: string
  email: string
  /** 합류하면 받을 권한. null = 조회 전용으로 명단에만 오른다. */
  accessRole: AccessRole | null
  roleLabel: string | null
  /** 합류하면 오를 팀 코드(초대에 담은 순서 — 첫 팀이 대표 후보). */
  teamCodes: string[]
  status: InviteStatus
  expiresAt: string
  createdAt: string
  redeemedAt: string | null
  /** 서버가 조립한 초대 링크. **발급 응답에서만** 채운다 — DB 에는 토큰 해시만 있어 목록에서는 링크를 다시
   *  만들 수 없다(목록은 항상 null, 화면 문구 "링크는 발급 시 한 번만 표시됩니다"). */
  url: string | null
}

export interface CreateInviteInput {
  email: string
  /** 합류 시 권한. 'admin' 은 슈퍼유저만 발급한다(SP2 에서 워크스페이스 관리자). */
  accessRole: AccessRole | null
  roleLabel?: string | null
  /** 이 프로젝트의 활성 팀 id — 첫 원소가 대표 팀 후보(합류 시 대표 팀이 아직 없을 때만). 빈 배열 = 팀 없음. */
  teamIds: string[]
  days?: number
}

export interface CreateInviteResult {
  ok: true
  row: InviteRow
  url: string
  mailed: boolean
  mailError?: string
  /** 이미 계정이 있는 주소인가(있으면 링크가 '로그인하고 합류' 경로가 된다).
   *  확인 자체가 실패하면 null — 발급을 막을 사유는 아니지만 없는 사실을 지어내지도 않는다. */
  alreadyAccount: boolean | null
}

/**
 * 초대 링크의 절대 origin. 상대 경로 링크는 메일에서 무의미하고, 틀린 origin 의 링크는
 * 발송된 뒤에 회수할 수 없다 — 미설정이면 초대를 만들지 않는다(fail-closed, 설계 §5-1.2).
 * meetingNotify 의 VERCEL_* 폴백은 쓰지 않는다: 그 주소는 배포마다 달라져 1회용 링크와 맞지 않는다.
 */
function inviteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

/** SMTP 원문 에러에는 계정·호스트 정보가 섞인다(meetingNotify 와 같은 이유). */
function toMailMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code
  if (code === 'EAUTH') return '메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.'
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') {
    return '메일 서버에 연결하지 못했습니다.'
  }
  return '메일 발송 중 오류가 발생했습니다.'
}

type RawInvite = {
  id: unknown; email: unknown; access_role: unknown; role_label: unknown; team_ids: unknown
  created_at: unknown; expires_at: unknown; revoked_at: unknown; redeemed_at: unknown
}

function toInviteRow(r: RawInvite, teamCodes: string[], url: string | null, now: Date): InviteRow {
  const expiresAt = String(r.expires_at)
  const revokedAt = (r.revoked_at as string | null) ?? null
  const redeemedAt = (r.redeemed_at as string | null) ?? null
  const status = inviteStatus({ expiresAt, revokedAt, redeemedAt }, now)
  return {
    id: String(r.id),
    email: String(r.email),
    accessRole: (r.access_role as AccessRole | null) ?? null,
    roleLabel: (r.role_label as string | null) ?? null,
    teamCodes,
    status,
    expiresAt,
    createdAt: String(r.created_at),
    redeemedAt,
    // 쓸 수 없는 링크는 싣지 않는다(발급 직후엔 active 다).
    url: status === 'active' ? url : null,
  }
}

/**
 * 프로젝트의 초대 목록(최신순).
 *
 * 조회 실패를 빈 목록으로 위장하지 않는다 — '초대 0건'은 관리자가 "아직 안 보냈구나"로 읽고
 * 같은 주소로 다시 발급하게 만드는 오정보다(그리고 부분 유니크에 막혀 이유 없이 실패한다).
 */
export async function listProjectInvites(
  projectId: string,
): Promise<{ ok: true; rows: InviteRow[] } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  let admin: AdminClient
  try {
    admin = createAdminClient()
  } catch (e) {
    console.error('[listProjectInvites] admin client 생성 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_INIT }
  }

  const { data, error } = await admin
    .from('project_invites')
    .select(INVITE_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error || !data) {
    console.error('[listProjectInvites] 조회 실패:', error?.message ?? 'unknown')
    return { ok: false, error: ERR_LOOKUP }
  }
  const invites = data as unknown as RawInvite[]

  // team_ids(uuid[])는 임베드할 FK 가 없다 — 한 번에 모아 코드로 푼다. 실패는 목록 실패다(팀 없는 초대로 위장하지 않는다).
  const teamIds = [...new Set(invites.flatMap(r => (Array.isArray(r.team_ids) ? (r.team_ids as string[]) : [])))]
  const codeBy = new Map<string, string>()
  if (teamIds.length > 0) {
    const { data: teams, error: teamsErr } = await admin.from('teams').select('id, code').in('id', teamIds)
    if (teamsErr || !teams) {
      console.error('[listProjectInvites] 팀 조회 실패:', teamsErr?.message ?? 'unknown')
      return { ok: false, error: ERR_LOOKUP }
    }
    for (const t of teams as Array<{ id: string; code: string }>) codeBy.set(t.id, t.code)
  }

  const now = new Date()
  const rows = invites.map(r => {
    const ids = Array.isArray(r.team_ids) ? (r.team_ids as string[]) : []
    return toInviteRow(r, ids.flatMap(id => (codeBy.has(id) ? [codeBy.get(id)!] : [])), null, now)
  })
  return { ok: true, rows }
}

/**
 * 초대 발급 + 메일 발송.
 *
 * 메일 실패는 초대를 무효화하지 않는다 — 링크는 이미 유효하고, 관리자가 복사해 전달하면
 * 그만이다. 발송 실패를 이유로 행을 지우면 관리자에게는 '아무 일도 없었다'로 보이지만
 * 실제로는 메일이 이미 나갔을 수도 있다(SMTP 는 부분 성공을 낸다).
 */
export async function createProjectInvite(
  projectId: string, input: CreateInviteInput,
): Promise<CreateInviteResult | { ok: false; error: string }> {
  // 모든 초대는 프로젝트 관리자 가드를 먼저 — 타 워크스페이스·미존재 프로젝트의 존재 은닉(404)이 여기서 끝난다.
  const accessRole = input?.accessRole ?? null
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  // 관리자 초대는 관리자 슬롯을 여는 경로 — 프로젝트 관리자 가드만으로 열리면 '관리자가 관리자를 늘린다'.
  // 그 프로젝트가 속한 워크스페이스의 관리자만 발급한다(위 가드를 통과했으니 projectWorkspace 에 키가 있다).
  if (isAdminAccessRole(accessRole)) {
    const w = await requireWorkspaceAdmin(g.actor.projectWorkspace.get(projectId) ?? null)
    if (!w.ok) return { ok: false, error: w.error }
  }

  // 입력 검증 → origin 확인까지는 DB 를 건드리지 않는다. 어차피 만들 수 없는 초대라면
  // 흔적도 남기지 않는 편이 낫다. 서버 액션 입력은 형상부터 믿지 않는다.
  if (!input || typeof input !== 'object') return { ok: false, error: ERR_EMAIL }
  if (accessRole !== null && accessRole !== ACCESS_ROLE.admin && accessRole !== ACCESS_ROLE.member) return { ok: false, error: ERR_ACCESS }
  // 행·판정·발송·계정 이메일에 쓰는 한 문자열(local@ASCII 호스트). 형식·로컬 파트 atext·호스트 형태를 못 지나면 null —
  // 발송기가 다른 수신자로 다시 읽거나 가입(GoTrue)이 받지 않는 주소를 행으로 남기지 않는다.
  const email = canonicalInviteEmail(typeof input.email === 'string' ? input.email : '')
  if (!email) return { ok: false, error: ERR_EMAIL }
  // 팀은 이 프로젝트에서 고를 수 있는 활성 팀만(resolveTeamsForProject 규칙) — 트리거가 워크스페이스 범위를 다시 본다.
  if (!Array.isArray(input.teamIds)) return { ok: false, error: ERR_TEAM }
  // 팀은 요청 범위 원천에서(SP4 A2). 조회 실패는 쓰기 전 선행 조회 실패라 중단한다(3원칙 ②) — 빈 목록으로 두면 고른 팀이 전부 '없는 팀'이 된다
  let selectable: Team[]
  try {
    selectable = (await projectTeams(projectId)).filter(t => t.active)
  } catch (e) {
    console.error('[createProjectInvite] 팀 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_LOOKUP }
  }
  const teams = [...new Set(input.teamIds)].map(id => selectable.find(t => t.id === id))
  if (teams.some(t => !t)) return { ok: false, error: ERR_TEAM }
  const teamIds = teams.map(t => t!.id)
  const teamCodes = teams.map(t => t!.code)
  const teamNames = teams.map(t => t!.name)
  const roleLabel = typeof input.roleLabel === 'string' && input.roleLabel.trim() ? input.roleLabel.trim() : null
  const days = normalizeInviteDays(input.days ?? DEFAULT_INVITE_DAYS)
  if (days === null) return { ok: false, error: ERR_DAYS }

  const origin = inviteOrigin()
  if (!origin) return { ok: false, error: ERR_APP_URL }

  let admin: AdminClient
  try {
    admin = createAdminClient()
  } catch (e) {
    console.error('[createProjectInvite] admin client 생성 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_INIT }
  }

  // 메일 제목·본문의 프로젝트명과 초대 행의 워크스페이스. 쓰기 전 선행 조회이므로 실패는 중단이다(3원칙 ②).
  const { data: project, error: projectErr } = await admin
    .from('projects').select('name, workspace_id').eq('id', projectId).maybeSingle()
  if (projectErr) {
    console.error('[createProjectInvite] 프로젝트 조회 실패:', projectErr.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!project) return { ok: false, error: '프로젝트를 찾을 수 없습니다.' }

  // 허용 도메인은 그 워크스페이스 설정(비었으면 env) — 설정을 읽어야 하므로 DB 에 닿은 뒤지만, 계정 유무·중복 조회와
  // insert 보다는 먼저 막는다. 설정 조회 실패는 보안 가드라 발급 중단(fail-closed).
  const loaded = await loadInviteDomains(admin, project.workspace_id as string)
  if (!loaded.ok) return { ok: false, error: ERR_LOOKUP }
  if (!isAllowedInviteDomain(email, loaded.domains)) return { ok: false, error: domainError(loaded.domains, loaded.source) }

  // 기존 계정이 있으면 링크가 '로그인하고 합류' 경로가 된다 — 발급을 막지는 않고 안내만 한다.
  const alreadyAccount = await hasAccount(admin, email)

  const now = new Date()
  const dup = await checkBlockingInvites(admin, projectId, email, now)
  if (!dup.ok) return dup

  // 평문 토큰은 링크 조립에만 쓰고 저장하지 않는다 — 여기서 만들어 응답과 메일로만 나간다.
  const token = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + days * DAY_MS).toISOString()
  const { data: inserted, error: insErr } = await admin
    .from('project_invites')
    .insert({
      project_id: projectId, workspace_id: project.workspace_id as string, email,
      access_role: accessRole, role_label: roleLabel, team_ids: teamIds.length > 0 ? teamIds : null,
      token_hash: hashInviteToken(token), created_by: g.actor.userId, expires_at: expiresAt,
    })
    .select(INVITE_COLUMNS)
    .single()
  if (insErr || !inserted) {
    // 부분 유니크 위반 = 위 확인과 insert 사이에 다른 관리자가 먼저 발급했다는 뜻이다.
    if ((insErr as { code?: string } | null)?.code === '23505') return { ok: false, error: ERR_DUP }
    // 트리거(project_invites_guard)의 2차 판정 — 가드와 엇갈리면 DB 판정을 문구로.
    if (insErr?.message.includes('PROJECT_INVITE_ADMIN_FORBIDDEN')) return { ok: false, error: ERR_ADMIN_INVITE }
    if (insErr?.message.includes('PROJECT_INVITE_TEAM_SCOPE') || insErr?.message.includes('TEAM_SCOPE_PROJECT_OWNED')) {
      return { ok: false, error: ERR_TEAM }   // 둘째는 같은 code 의 전용 팀이 있는 공용 팀(*_command_receipts ⑤′) — 팀 캐시가 전환 직후 낡았을 때
    }
    // 토큰은 로그에 남기지 않는다 — 로그 열람 권한이 곧 가입 자격이 되어서는 안 된다.
    console.error('[createProjectInvite] 저장 실패:', insErr?.message ?? 'unknown')
    return { ok: false, error: '초대를 저장하지 못했습니다.' }
  }

  const url = `${origin}/invite/${token}`
  const row = toInviteRow(inserted as unknown as RawInvite, teamCodes, url, now)
  const mail = await sendInviteMail(admin, {
    to: email, projectId, projectName: String(project.name ?? ''), workspaceId: project.workspace_id as string,
    inviterId: g.actor.userId, url, expiresAt,
    // 메일에는 팀의 표시 이름(개명 — SP4 D37)을 싣는다
    teamNames,
  })

  revalidatePath(`/p/${projectId}/members`)
  revalidatePath(`/p/${projectId}/settings`)
  return { ok: true, row, url, alreadyAccount, ...mail }
}

/**
 * 부분 유니크(redeemed_at is null and revoked_at is null)를 막고 있는 초대가 있으면 거부한다.
 *
 * 유니크는 만료 여부를 보지 않으므로 만료된 초대도 여전히 길을 막는다. 그렇다고 여기서
 * 자동으로 소프트 취소하지는 않는다 — 아무도 취소하지 않은 초대가 목록에 영구히 '취소됨'으로
 * 남으면, "누가 언제 무엇을 취소했나"를 근거로 삼는 소프트 취소의 의미(설계 P5)가 깎인다.
 * 치우는 일은 관리자의 명시적 취소로만 한다(취소 버튼은 만료 행에도 동작한다 —
 * revokeProjectInvite 참조). 그래서 문구도 활성/만료를 구분해 다음 행동을 정확히 알려준다.
 */
async function checkBlockingInvites(
  admin: AdminClient, projectId: string, email: string, now: Date,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('project_invites')
    .select('id, expires_at, revoked_at, redeemed_at')
    .eq('project_id', projectId).eq('email', email)
    .is('redeemed_at', null).is('revoked_at', null)
  if (error || !data) {
    // 확인이 안 되면 발급하지 않는다 — 중복 판정 없이 insert 하면 유니크 위반만 남고
    // 관리자에게는 원인 없는 실패로 보인다(3원칙 ②).
    console.error('[createProjectInvite] 중복 초대 조회 실패:', error?.message ?? 'unknown')
    return { ok: false, error: ERR_LOOKUP }
  }
  if (data.length === 0) return { ok: true }

  const hasActive = data.some(r => inviteStatus({
    expiresAt: String(r.expires_at),
    revokedAt: (r.revoked_at as string | null) ?? null,
    redeemedAt: (r.redeemed_at as string | null) ?? null,
  }, now) === 'active')
  return { ok: false, error: hasActive ? ERR_DUP : ERR_DUP_EXPIRED }
}

/** 이미 계정이 있는 주소인가 — profiles(email) 단건. 확인 실패는 null(발급을 막을 사유가 아니다, 표시 = 로깅). */
async function hasAccount(admin: AdminClient, email: string): Promise<boolean | null> {
  const { data, error } = await admin.from('profiles').select('user_id').eq('email', email).maybeSingle()
  if (error) {
    console.error('[createProjectInvite] 계정 존재 확인 실패:', error.message)
    return null
  }
  return data !== null
}

/** 초대 메일 1통. 실패는 결과에 담아 올린다 — 초대 자체는 이미 유효하다. */
async function sendInviteMail(
  admin: AdminClient,
  i: { to: string; projectId: string; projectName: string; workspaceId: string; inviterId: string; url: string; expiresAt: string; teamNames: string[] },
): Promise<{ mailed: boolean; mailError?: string }> {
  const branding = await loadDisplayBranding(i.workspaceId, admin)
  const transport = getTransport(branding.mailFromName)
  if (!transport.ok) return { mailed: false, mailError: transport.error }

  // 초대한 사람의 이름·주소는 본문 한 줄과 Reply-To 에만 쓰인다. 못 읽어도 발송은 계속한다.
  let inviterName: string | null = null
  let inviterEmail: string | null = null
  const { data: inviter, error: inviterErr } = await admin.auth.admin.getUserById(i.inviterId)
  if (inviterErr || !inviter?.user) {
    console.error('[createProjectInvite] 초대자 정보 조회 실패:', inviterErr?.message ?? 'unknown')
  } else {
    inviterName = displayNameFrom(inviter.user.user_metadata, inviter.user.email)
    inviterEmail = inviter.user.email ?? null
  }

  // 만료 시각의 tz — 초대는 이미 저장됐으므로 달력을 못 읽어도 메일은 보낸다. 대신 UTC 로 찍고 꼬리에 'UTC' 라고 적는다(라벨이 사실)
  let timeZone = 'UTC'
  try { timeZone = projectTimezone(await getProjectConfig(i.projectId, { client: admin })) } catch (e) {
    console.error('[createProjectInvite] 프로젝트 달력 판독 실패 — 만료 시각을 UTC 로 표기한다', { projectId: i.projectId, cause: String(e) })
  }
  const { subject, html, text } = renderInviteMail({
    projectName: i.projectName, productName: branding.productName,
    inviterName, url: i.url, expiresAt: i.expiresAt, teamNames: i.teamNames, timeZone,
  })
  try {
    const { rejected } = await transport.send({
      to: [i.to], replyTo: inviterEmail, subject, html, text,
    })
    if (rejected.some(r => normalizeInviteEmail(r) === i.to)) {
      return { mailed: false, mailError: '메일 서버가 수신 주소를 거부했습니다.' }
    }
    return { mailed: true }
  } catch (e) {
    console.error('[createProjectInvite] 메일 발송 실패:', e)
    return { mailed: false, mailError: toMailMessage(e) }
  }
}

/**
 * 소프트 취소. 행을 지우지 않는다 — "누가 만든 어떤 초대로 누가 언제 들어왔나"가
 * 사고 때 되짚을 유일한 근거다(설계 P5).
 *
 * update 에 .select('id') 를 붙여 영향 행 수를 확인한다. 붙이지 않으면 0행(다른 프로젝트의
 * 초대·이미 합류·이미 취소)과 1행이 구분되지 않아 조용한 no-op 이 성공으로 보고된다.
 */
export async function revokeProjectInvite(
  projectId: string, inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  let admin: AdminClient
  try {
    admin = createAdminClient()
  } catch (e) {
    console.error('[revokeProjectInvite] admin client 생성 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_INIT }
  }

  const { data, error } = await admin
    .from('project_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    // project_id 조건이 곧 권한 경계다 — 게이트는 이 프로젝트의 관리자임만 확인한다.
    .eq('project_id', projectId)
    // 만료 행도 취소 가능(재발급 경로) — expires_at 조건을 일부러 걸지 않는다.
    // 만료분이 부분 유니크를 막고 있으므로, 취소할 수 없으면 같은 주소로 다시 보낼 길이 없다.
    .is('redeemed_at', null)
    .is('revoked_at', null)
    .select('id')
  if (error) {
    console.error('[revokeProjectInvite] 취소 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!data || data.length === 0) return { ok: false, error: ERR_REVOKE }

  revalidatePath(`/p/${projectId}/members`)
  revalidatePath(`/p/${projectId}/settings`)
  return { ok: true }
}
