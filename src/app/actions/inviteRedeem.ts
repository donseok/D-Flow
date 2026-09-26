'use server'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadInviteDomains } from '@/lib/data/inviteDomains'
import { personOf } from '@/lib/data/memberSelect'
import { hashInviteToken } from '@/lib/domain/inviteToken'
import { PERSON_INACTIVE, rosterTokenError } from '@/lib/domain/rosterErrors'
import {
  isAllowedInviteDomain, isInviteToken, inviteStatus, maskEmail, normalizeInviteEmail,
  validateSignupInput, type InviteStatus, type SignupInput,
} from '@/lib/domain/invites'

type AdminClient = ReturnType<typeof createAdminClient>
type AccessRole = 'admin' | 'member'

// 인증 게이트가 없는 공개 경로다(링크를 가진 사람이 곧 호출자). 방어선은 셋뿐이다:
// ① 토큰 형식 검증 ② 초대 행이 못 박은 이메일 ③ 소비 RPC 의 원자적 판정.
// 합류의 쓰기(소비·프로필·인물·워크스페이스 소속·명단·팀)는 전부 RPC consume_project_invite 한 트랜잭션이다 —
// 앱 계층에 흩뿌리면 부분 실패가 "소비된 초대 + 소속 없음" 을 남긴다.
// 사용자 문구는 계약서 §8 원문. 원시 Postgres/Supabase 메시지는 노출하지 않는다.
const E_NOT_FOUND = '초대를 찾을 수 없습니다.'
const E_UNUSABLE = '만료되었거나 사용할 수 없는 초대입니다.'
const E_LOOKUP = '초대를 확인할 수 없어 중단했습니다.'
const E_PERSON_LINKED = '이 이메일의 인물이 이미 다른 계정에 연결돼 있습니다. 관리자에게 문의해 주세요.'
/** 초대의 team_ids 는 FK 가 없다 — 발급 뒤 팀이 지워지면 트리거(PROJECT_MEMBER_TEAM_SCOPE)가 거부한다. 링크로는 고칠 수 없다. */
const E_INVITE_TEAM_GONE = '초대에 담긴 팀을 더 이상 쓸 수 없습니다. 관리자에게 초대 재발급을 요청해 주세요.'
const E_SIGNUP_FAILED = '가입 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
/** 비활성 인물·명단 행은 초대로 되살리지 않는다(0008 INVITE_INACTIVE) — 비활성화는 관리자의 결정이다. */
const E_INACTIVE = PERSON_INACTIVE

/**
 * 허용 도메인 재검사. 발급(createProjectInvite)이 통과시켰어도 그것은 발급 시점의 스냅샷일
 * 뿐이다 — 워크스페이스 관리자가 허용 도메인을 좁히거나 운영자가 INVITE_ALLOWED_DOMAINS 를 좁히면
 * (사고 대응 등) **이미 나간 초대**도 즉시 막혀야 한다. 그래서 소비 경로 셋(preview·redeemInvite·
 * redeemInviteWithSignup) 모두 매 호출마다 초대의 워크스페이스 설정(없으면 env)으로 다시 판정한다 —
 * 결과를 어디에도 캐시하지 않는다. 설정 조회 실패는 E_LOOKUP 으로 중단한다(fail-closed).
 */
async function domainStillAllowed(
  admin: AdminClient, workspaceId: string, rawEmail: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadInviteDomains(admin, workspaceId)
  if (!loaded.ok) return { ok: false, error: E_LOOKUP }
  return isAllowedInviteDomain(normalizeInviteEmail(rawEmail), loaded.domains) ? { ok: true } : { ok: false, error: E_UNUSABLE }
}

interface InviteRowRaw {
  workspace_id: string
  project_id: string
  email: string
  access_role: AccessRole | null
  expires_at: string
  revoked_at: string | null
  redeemed_at: string | null
}
const INVITE_COLS = 'workspace_id, project_id, email, access_role, expires_at, revoked_at, redeemed_at'

/** consume_project_invite 의 반환 행(0003). */
interface ConsumedInvite {
  workspace_id: string
  project_id: string
  member_id: string
}

/**
 * 토큰으로 초대 1행 — DB 에는 해시만 있으므로 해시로 찾는다. 조회 실패(E17)와 미존재(E1)를 구분한다 —
 * 조회 실패를 '없음'으로 위장하면 DB 장애가 곧 '만료된 링크' 안내가 된다.
 */
async function loadInvite<T>(
  admin: AdminClient, token: string, cols: string = INVITE_COLS,
): Promise<{ ok: true; invite: T } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('project_invites').select(cols).eq('token_hash', hashInviteToken(token)).maybeSingle()
  if (error) {
    // 토큰은 로그에 남기지 않는다.
    console.error('[inviteRedeem] 초대 조회 실패:', error.message)
    return { ok: false, error: E_LOOKUP }
  }
  if (!data) return { ok: false, error: E_NOT_FOUND }
  return { ok: true, invite: data as unknown as T }
}

/** 세션 조회 실패를 '비로그인'으로 폴백하지 않는다 — 이 판정이 합류 허용 여부를 가른다(fail-closed). */
async function currentUser(): Promise<
  { ok: true; user: Awaited<ReturnType<typeof getSession>> } | { ok: false; error: string }
> {
  try {
    return { ok: true, user: await getSession() }
  } catch (e) {
    console.error('[inviteRedeem] 세션 확인 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: E_LOOKUP }
  }
}

/**
 * 소비 + 합류 RPC 한 번. 검증(미사용·미취소·미만료·이메일 일치)과 소비가 단일 UPDATE 이고, 이어서 프로필·인물 연결·
 * 워크스페이스 소속·명단 upsert(권한은 올리기만)·팀 전개가 같은 트랜잭션이다(설계 P1).
 */
async function consumeInvite(
  admin: AdminClient, token: string, email: string, userId: string,
): Promise<{ ok: true; row: ConsumedInvite } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc('consume_project_invite', {
    p_token_hash: hashInviteToken(token), p_email: email, p_user: userId,
  })
  if (error) {
    console.error('[inviteRedeem] 초대 소비 실패:', error.message)
    // 같은 이메일의 인물이 다른 계정에 이미 연결돼 있다 — 사용자가 고칠 수 없고 관리자가 풀어야 한다.
    if (error.message.includes('PROJECT_INVITE_PERSON_LINKED')) return { ok: false, error: E_PERSON_LINKED }
    if (error.message.includes('PROJECT_MEMBER_TEAM_SCOPE')) return { ok: false, error: E_INVITE_TEAM_GONE }
    // 명단 트리거가 던진 나머지 토큰(워크스페이스 불일치·계정 없는 권한·비활성 INVITE_INACTIVE 등)은 명단 문구로. 모르는 오류(연결 등)만 조회 실패 문구.
    return { ok: false, error: rosterTokenError(error.message) ?? E_LOOKUP }
  }
  const rows = (data ?? []) as ConsumedInvite[]
  // 0행 = 만료·취소·이미 사용·이메일 불일치. 어느 쪽인지 알려주지 않는다(초대 존재 탐침 차단).
  if (rows.length === 0) return { ok: false, error: E_UNUSABLE }
  return { ok: true, row: rows[0] }
}

/**
 * 소비를 되돌린다(가입 경로의 보상 롤백 전용). RPC 는 원자적이라 보통은 되돌릴 것이 없지만, 커밋됐는데 응답만 깨진
 * 경우 1회용 링크가 아무도 쓰지 못한 채 타 버린다 — 되돌려야 같은 링크로 재시도할 수 있다.
 * 이번 가입이 만든 계정(redeemedBy)의 소비만 되돌린다 — 다른 계정이 정당하게 쓴 링크를 다시 열지 않는다.
 */
async function revertRedeem(admin: AdminClient, token: string, redeemedBy: string): Promise<boolean> {
  const { error } = await admin
    .from('project_invites').update({ redeemed_by: null, redeemed_at: null })
    .eq('token_hash', hashInviteToken(token)).eq('redeemed_by', redeemedBy)
  if (error) {
    console.error('[inviteRedeem] 소비 되돌리기 실패 — 초대가 사용됨으로 고착:', error.message)
    return false
  }
  return true
}

/**
 * 가입 경로 보상 롤백. 계정을 지우면 profiles·workspace_members 는 FK cascade 로 함께 사라지고,
 * 인물의 계정 연결은 set null 로 풀린다(연결이 풀리면 트리거가 그 인물의 권한도 내린다).
 *
 * 이미 소비한 초대가 있으면 **계정 삭제보다 먼저** 되돌린다 — 되돌려야 1회용 링크가 활성으로
 * 돌아와 사용자가 같은 메일로 재시도할 수 있다.
 *
 * 되돌리기가 실패해도 계정 삭제는 그대로 진행한다. 초대는 '사용됨'으로 고착되어 관리자가 다시
 * 발급해야 하지만, 유령 계정을 남기는 쪽이 더 나쁘다 — 그 계정은 워크스페이스 읽기 권한을 갖는다.
 */
async function rollbackSignup(
  admin: AdminClient, userId: string, consumedToken: string | null,
): Promise<void> {
  // 토큰 전문은 로그에 남기지 않는다. 고착된 초대는 redeemed_by 로 특정한다.
  if (consumedToken && !(await revertRedeem(admin, consumedToken, userId))) {
    console.error(
      `[inviteRedeem] 초대가 사용됨으로 고착 — 재발급 필요(redeemed_by=${userId} 로 조회)`,
    )
  }
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    console.error(`[inviteRedeem] 보상 롤백 실패(유령 계정 잔존 user_id=${userId}):`, error.message)
  }
}

export interface InvitePreview {
  projectName: string
  projectDescription: string | null
  /** 전체 주소는 노출하지 않는다 — 링크만 주운 사람에게 수신자를 알려주지 않기 위해. */
  maskedEmail: string
  status: InviteStatus
  /** 가입 폼 / 로그인 폼 분기용. */
  accountExists: boolean
  /** 합류하면 오를 팀 이름(초대에 담은 순서 — 첫 팀이 대표 후보). 빈 배열 = 팀 없이 명단에만 오른다. */
  teamNames: string[]
}

interface PreviewRowRaw {
  workspace_id: string
  email: string
  expires_at: string
  revoked_at: string | null
  redeemed_at: string | null
  team_ids: string[] | null
  projects: { name: string; description: string | null } | null
}

export async function getInvitePreview(
  token: string,
): Promise<{ ok: true; preview: InvitePreview } | { ok: false; error: string }> {
  if (!isInviteToken(token)) return { ok: false, error: E_NOT_FOUND }
  const admin = createAdminClient()
  // 반환 컬럼 화이트리스트 — projects 는 name/description 만(share 페이지 선례).
  const found = await loadInvite<PreviewRowRaw>(
    admin, token, 'workspace_id, email, expires_at, revoked_at, redeemed_at, team_ids, projects(name, description)',
  )
  if (!found.ok) return found
  const row = found.invite
  const status = inviteStatus(
    { expiresAt: row.expires_at, revokedAt: row.revoked_at, redeemedAt: row.redeemed_at },
    new Date(),
  )
  // 비활성 초대는 **상태만** 돌려준다. 이미 소비·취소·만료된 링크가 유출됐을 때 프로젝트명·
  // 수신자·계정 유무까지 딸려 나갈 이유가 없다. 화면도 이 상태에서는 안내 문구만 쓴다.
  if (status !== 'active') {
    return {
      ok: true,
      preview: {
        projectName: '', projectDescription: null, maskedEmail: '', status, accountExists: false, teamNames: [],
      },
    }
  }
  // 발급 시점엔 허용됐어도 현재 설정 기준으로 도메인이 막혔으면 사용 불가로 본다(좁힌 목록은
  // 이미 나간 초대도 즉시 막는다 — fail-closed). 여기서 걸러야 프로젝트명·계정 유무 조회로
  // 진행하지 않는다 — 비활성 초대와 같은 이유로 정보를 더 내주지 않는다.
  const domain = await domainStillAllowed(admin, row.workspace_id, row.email)
  if (!domain.ok) return domain

  const project = row.projects as unknown as { name: string; description: string | null } | null

  // 계정 유무는 폼 분기에만 쓰지만, 조회가 깨졌는데 '계정 없음'으로 폴백하면
  // 기존 사용자에게 가입 폼을 보여 주고 제출 뒤에야 실패한다. 여기서 중단한다.
  const { data: profile, error: profileErr } = await admin
    .from('profiles').select('user_id').eq('email', normalizeInviteEmail(row.email)).maybeSingle()
  if (profileErr) {
    console.error('[inviteRedeem] 계정 유무 조회 실패:', profileErr.message)
    return { ok: false, error: E_LOOKUP }
  }

  // team_ids(uuid[])는 임베드할 FK 가 없다 — 이름으로 푼다. 실패를 '팀 없는 초대'로 위장하지 않는다.
  // 발급 뒤 지워진 팀은 목록에서 빠진다(합류 시 RPC 가 E_INVITE_TEAM_GONE 으로 거부한다).
  const teamIds = Array.isArray(row.team_ids) ? row.team_ids : []
  let teamNames: string[] = []
  if (teamIds.length > 0) {
    const { data: teams, error: teamsErr } = await admin.from('teams').select('id, name').in('id', teamIds)
    if (teamsErr || !teams) {
      console.error('[inviteRedeem] 팀 조회 실패:', teamsErr?.message ?? 'unknown')
      return { ok: false, error: E_LOOKUP }
    }
    const nameBy = new Map((teams as Array<{ id: string; name: string }>).map(t => [t.id, t.name]))
    teamNames = teamIds.flatMap(id => (nameBy.has(id) ? [nameBy.get(id)!] : []))
  }

  return {
    ok: true,
    preview: {
      projectName: project?.name ?? '',
      projectDescription: project?.description ?? null,
      maskedEmail: maskEmail(row.email),
      status,
      accountExists: profile !== null,
      teamNames,
    },
  }
}

/**
 * 초대 화면 분기용 세션 상태. 세션이 있는 사람에게만 일치 여부를 알려준다.
 *
 * 마스킹 문자열끼리 비교하면 앞 2자와 길이만 남으므로 `hong.gd@`와 `hong.gs@`가 같은 값이 된다
 * — `이름.이니셜@` 같은 주소 관례에서 흔한 충돌이라 화면이 엉뚱한 폼을 띄운다. 판정은 서버가
 * 정규화된 원문끼리 하고 결과 불리언만 내려보낸다. 해시도 내려보내지 않는다(한 조직의 주소 공간은
 * 작아 역산된다).
 */
export async function getInviteSessionState(
  token: string,
): Promise<{ ok: true; authed: boolean; emailMatches: boolean } | { ok: false; error: string }> {
  if (!isInviteToken(token)) return { ok: false, error: E_NOT_FOUND }
  const s = await currentUser()
  if (!s.ok) return { ok: false, error: s.error }
  // 비로그인 호출자에게는 초대 이메일에 관한 어떤 정보도 주지 않는다 — 조회조차 하지 않는다.
  if (!s.user) return { ok: true, authed: false, emailMatches: false }

  const admin = createAdminClient()
  const found = await loadInvite<{ email: string }>(admin, token, 'email')
  if (!found.ok) return found
  const sessionEmail = normalizeInviteEmail(s.user.email ?? '')
  return {
    ok: true,
    authed: true,
    emailMatches: sessionEmail !== '' && sessionEmail === normalizeInviteEmail(found.invite.email),
  }
}

/** 권한 서열 — 초대는 기존 권한을 깎지 않는다(RPC 와 같은 admin > member > null). */
function accessRank(r: AccessRole | null): number {
  return r === 'admin' ? 2 : r === 'member' ? 1 : 0
}

/** 로그인 사용자 합류. 세션 이메일이 초대 이메일과 다르면 소비 전에 거부한다. */
export async function redeemInvite(
  token: string,
): Promise<{ ok: true; projectId: string; alreadyMember: boolean } | { ok: false; error: string }> {
  if (!isInviteToken(token)) return { ok: false, error: E_NOT_FOUND }
  const s = await currentUser()
  if (!s.ok) return { ok: false, error: s.error }
  if (!s.user) return { ok: false, error: '로그인이 필요합니다.' }
  const user = s.user

  const admin = createAdminClient()
  const found = await loadInvite<InviteRowRaw>(admin, token)
  if (!found.ok) return found
  const invite = found.invite

  // 허용 도메인 재검사 — domainStillAllowed 주석 참조.
  const domain = await domainStillAllowed(admin, invite.workspace_id, invite.email)
  if (!domain.ok) return domain

  const sessionEmail = normalizeInviteEmail(user.email ?? '')
  if (!sessionEmail || sessionEmail !== normalizeInviteEmail(invite.email)) {
    return { ok: false, error: '이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.' }
  }

  // 이미 같거나 높은 권한이 있으면 초대를 태우지 않는다 — 1회용이라 태워도 얻을 것이 없고, 링크만 소모된다.
  // 초대가 더 높은 권한(관리자)을 담았으면 소비해 올린다. 명단 행·인물이 비활성이면 초대로 되살리지 않는다 —
  // RPC 도 INVITE_INACTIVE 로 거부하지만(명단 행이 없는 비활성 인물은 거기서 걸린다), 알고 있으면 여기서 끊는다.
  // 선행 조회 실패는 중단(에러 처리 3원칙): 없다고 보고 진행하면 기존 상태를 모른 채 소비한다.
  const { data: existing, error: existingErr } = await admin
    .from('project_members').select('access_role, active, people!inner(user_id, active)')
    .eq('project_id', invite.project_id).eq('people.user_id', user.id)
    .maybeSingle()
  if (existingErr) {
    console.error('[redeemInvite] 기존 권한 조회 실패:', existingErr.message)
    return { ok: false, error: E_LOOKUP }
  }
  const pe = personOf(existing)
  if (existing && (!existing.active || !pe?.active)) return { ok: false, error: E_INACTIVE }
  const current = existing ? (existing.access_role as AccessRole | null) : null
  if (current && accessRank(current) >= accessRank(invite.access_role)) {
    return { ok: true, projectId: invite.project_id, alreadyMember: true }
  }

  const consumed = await consumeInvite(admin, token, sessionEmail, user.id)
  if (!consumed.ok) return consumed

  revalidatePath('/projects')
  return { ok: true, projectId: consumed.row.project_id, alreadyMember: false }
}

/**
 * 가입 + 합류. **이메일을 인자로 받지 않는다** — 서버가 초대 행의 이메일로만 계정을 만든다.
 * 클라이언트가 주소를 정할 수 있으면 링크 하나로 아무 계정이나 만들 수 있게 된다(설계 P1).
 */
export async function redeemInviteWithSignup(
  token: string, input: SignupInput,
): Promise<{ ok: true; projectId: string; email: string } | { ok: false; error: string }> {
  if (!isInviteToken(token)) return { ok: false, error: E_NOT_FOUND }
  const s = await currentUser()
  if (!s.ok) return { ok: false, error: s.error }
  if (s.user) return { ok: false, error: '이미 로그인되어 있습니다.' }

  const valid = validateSignupInput(input)
  if (!valid.ok) return { ok: false, error: valid.error }
  const name = input.name.trim()

  const admin = createAdminClient()
  const found = await loadInvite<InviteRowRaw>(admin, token)
  if (!found.ok) return found
  const invite = found.invite
  // 계정을 만들기 전에 한 번 거른다. 진짜 판정은 아래 소비 RPC 가 원자적으로 한다.
  const status = inviteStatus(
    { expiresAt: invite.expires_at, revokedAt: invite.revoked_at, redeemedAt: invite.redeemed_at },
    new Date(),
  )
  if (status !== 'active') return { ok: false, error: E_UNUSABLE }

  // 허용 도메인 재검사 — domainStillAllowed 주석 참조. 계정 생성 전에 막는다.
  const domain = await domainStillAllowed(admin, invite.workspace_id, invite.email)
  if (!domain.ok) return domain

  const email = normalizeInviteEmail(invite.email)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true, // SMTP 없이 즉시 로그인 가능하도록 확인 처리(accounts.ts 관례)
    user_metadata: { full_name: name },
  })
  if (createErr || !created?.user) {
    // 원인을 구분해 주면 '이 주소에 계정이 있는가'를 되묻는 탐침이 된다.
    return { ok: false, error: '이미 가입된 계정이거나 입력값을 확인해 주세요.' }
  }
  const userId = created.user.id

  // RPC 는 기존 프로필의 표시 이름을 유지하고, 없으면 이메일 로컬 파트로 만든다 — 가입 폼의 이름이 명단(인물)에
  // 오르려면 프로필을 먼저 넣어야 한다.
  const { error: profileErr } = await admin.from('profiles').insert({ user_id: userId, email, display_name: name })
  if (profileErr) {
    console.error('[redeemInviteWithSignup] 프로필 저장 실패:', profileErr.message)
    await rollbackSignup(admin, userId, null)
    return { ok: false, error: E_SIGNUP_FAILED }
  }

  const consumed = await consumeInvite(admin, token, email, userId)
  if (!consumed.ok) {
    // 소비 실패 = 이 계정이 존재할 근거가 없다. 유령 계정을 남기지 않는다.
    // 토큰을 함께 넘긴다 — RPC 가 실제로는 커밋됐는데 응답만 깨진 경우 행은 소비된 상태라
    // 되돌리지 않으면 1회용 링크가 아무도 쓰지 못한 채 타 버린다. 소비되지 않은 경우엔
    // where token_hash=? 업데이트가 null 을 다시 null 로 쓸 뿐이라 무해하다(멱등 no-op).
    // (그 드문 경우 RPC 가 만든 인물·명단 행은 계정 삭제의 set null 로 외부 인력 행으로 남는다 — 관리자가 정리한다.)
    await rollbackSignup(admin, userId, token)
    return consumed
  }

  revalidatePath('/projects')
  return { ok: true, projectId: consumed.row.project_id, email }
}
