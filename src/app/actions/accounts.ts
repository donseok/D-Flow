'use server'
// 계정 관리 — 생성·워크스페이스 등급·목록은 그 워크스페이스의 관리자, 비밀번호 초기화·플랫폼 관리자 지정은 슈퍼유저 전용
// (SP2 §4.1·D1 — 계정 비밀번호는 여러 워크스페이스에 걸친 전역 자원). 0003 이후 계정 = auth.users + profiles + workspace_members + people(연결),
// 프로젝트 권한 = 명단 행 access_role(RPC upsert_project_member_cmd 로만 쓴다). 옛 전역 소속·프로젝트 역할 표는 0003 에서 폐지됐다.
import { revalidatePath } from 'next/cache'
import { requireProjectMember, requireSuperuser, requireWorkspaceAdmin } from '@/lib/authz'
import { ERR_MISSING } from '@/lib/authz/errors'
import { authzCommandError, newAuthzCommandId, parseAuthzResult } from '@/lib/authz/commands'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { createAdminClient } from '@/lib/supabase/admin'
import { listProfiles } from '@/lib/data/accounts'
import { UUID_RE } from '@/lib/domain/validate'
import { canonicalEmail } from '@/lib/domain/email'
import { compareKoreanName } from '@/lib/domain/nameSort'
import { isValidPassword, parseBulkAccounts } from '@/lib/domain/accounts'
import { rosterWriteError } from '@/lib/domain/rosterErrors'
import { ACCESS_ROLE, WORKSPACE_ROLE } from '@/lib/domain/authz'

type AdminClient = ReturnType<typeof createAdminClient>
type WorkspaceRole = 'admin' | 'member'
type AccessRole = 'admin' | 'member'

export interface AccountRow {
  id: string
  email: string
  /** profiles.display_name — 비어 있을 수 없다(가입 시 이메일 로컬 파트로 채운다). */
  name: string
  /** 조회 대상 프로젝트가 속한 워크스페이스에서의 등급. null = 그 워크스페이스 소속 아님. */
  workspaceRole: WorkspaceRole | null
  isPlatformAdmin: boolean
  /** 조회 대상 프로젝트의 권한(활성 명단 행의 access_role). null = 조회 전용. */
  accessRole: AccessRole | null
  createdAt: string
}

export interface AccountInput {
  email: string
  password: string
  name: string | null
  /** 새 계정의 워크스페이스 등급. 워크스페이스는 createAccount 의 workspaceId 입력(그 워크스페이스의 관리자 가드). */
  workspaceRole: WorkspaceRole
  /** 권한을 줄 프로젝트. accessRole 과 짝 — 둘 다 있어야 명단 행을 만든다. */
  projectId?: string | null
  /** 그 프로젝트의 권한. null·생략 = 조회 전용으로 시작(명단 행 없음, 설계 D7). */
  accessRole?: AccessRole | null
}

export interface AccountActionResult {
  ok: boolean
  error?: string
}

export interface BulkResultRow {
  lineNo: number
  email: string
  ok: boolean
  error?: string
}

const ERR_LOOKUP = '권한을 확인할 수 없어 중단했습니다.'
const ERR_WS_ROLE = '알 수 없는 워크스페이스 권한'
const ERR_ACCESS = '알 수 없는 권한'
const ERR_PERSON_LINKED = '이미 다른 계정에 연결된 사람입니다.'
/** 비활성 인물·명단 행은 계정 생성으로 되살리지 않는다(0008 INVITE_INACTIVE 와 같은 규칙) — 호출자는 워크스페이스 관리자라 조치를 안내한다. */
const ERR_INACTIVE = '이 인원(또는 명단 행)이 비활성 상태입니다. 명단에서 재활성화한 뒤 다시 시도하세요.'
const ERR_LIST = '계정 권한 정보를 불러오지 못했습니다.'
const ERR_SELF_PLATFORM = '본인의 플랫폼 관리자 권한은 스스로 해제할 수 없습니다. 다른 슈퍼유저에게 요청하세요.'

function isWorkspaceRole(v: unknown): v is WorkspaceRole {
  return v === WORKSPACE_ROLE.admin || v === WORKSPACE_ROLE.member
}

/**
 * 계정 ↔ 인물 연결. (워크스페이스, 이메일)로 인물을 찾아 미연결이면 잇고, 없으면 만든다.
 * 부분 유니크 people_ws_email_uidx 는 PostgREST upsert(onConflict)의 대상이 될 수 없어(42P10) select-then-write 다.
 * 연결은 user_id 가 아직 null 일 때만 — 조건부 update 가 0행이면 그 사이 다른 계정이 이었다는 뜻이라 덮어쓰지 않는다.
 * 비활성 인물이면 거부한다(되살리지도, 비활성인 채 잇지도 않는다) — 헬퍼·buildActor 는 인물이 활성일 때만 권한을 인정하므로
 * 그대로 이으면 준 권한이 무효인데 '생성 성공' 으로 보고되고, 되살리면 관리자의 비활성화를 부수효과로 뒤집는다.
 * consume_project_invite 의 INVITE_INACTIVE(0008)와 같은 규칙 — 명단에서 재활성화한 뒤 다시 만든다.
 * insert 의 유니크 위반(경합)은 조용히 재시도하지 않고 오류로 돌린다.
 */
async function linkOrCreatePerson(
  admin: AdminClient, workspaceId: string, userId: string, email: string, displayName: string,
): Promise<{ ok: true; personId: string; created: boolean } | { ok: false; error: string }> {
  const { data: found, error: findErr } = await admin
    .from('people').select('id, user_id, active').eq('workspace_id', workspaceId).eq('email', email).maybeSingle()
  if (findErr) {
    console.error('[createAccount] 인물 조회 실패:', findErr.message)
    return { ok: false, error: '인물 정보를 확인할 수 없어 중단했습니다.' }
  }
  if (found) {
    if (found.user_id !== null) return { ok: false, error: ERR_PERSON_LINKED }
    // 비활성 인물은 계정을 이으면서 되살리지 않는다 — consume_project_invite 의 INVITE_INACTIVE(0008)와 같은 규칙.
    // 비활성화는 관리자의 결정이라 계정 생성의 부수효과로 뒤집히면 안 된다. 명단에서 재활성화한 뒤 다시 만든다.
    if (found.active === false) return { ok: false, error: ERR_INACTIVE }
    const { data: linked, error: linkErr } = await admin
      .from('people').update({ user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', found.id as string).is('user_id', null)
      .select('id')
    if (linkErr) {
      console.error('[createAccount] 인물 연결 실패:', linkErr.message)
      return { ok: false, error: '인물에 계정을 연결하지 못했습니다.' }
    }
    if (!linked || linked.length === 0) return { ok: false, error: ERR_PERSON_LINKED }
    return { ok: true, personId: found.id as string, created: false }
  }
  const { data: inserted, error: insErr } = await admin
    .from('people').insert({ workspace_id: workspaceId, display_name: displayName, email, user_id: userId })
    .select('id').single()
  if (insErr || !inserted) {
    if (insErr?.code === '23505') return { ok: false, error: '같은 이메일의 사람이 방금 등록됐습니다. 다시 시도하세요.' }
    console.error('[createAccount] 인물 저장 실패:', insErr?.message ?? 'unknown')
    return { ok: false, error: '인물 정보를 저장하지 못했습니다.' }
  }
  return { ok: true, personId: inserted.id as string, created: true }
}

/**
 * 보상 롤백. 이 호출이 만든 인물 행을 먼저 지운다 — 계정 삭제의 FK(set null)는 인물 행을 외부 인력으로 남겨
 * 같은 이메일을 붙잡는다. 계정을 지우면 profiles·workspace_members 는 cascade 로 사라진다.
 * 롤백까지 실패하면 유령 계정이 남고, 관리자가 같은 이메일로 재시도할 때 '이미 존재'로만 튕긴다 — 흔적을 남긴다.
 */
async function rollbackAccount(admin: AdminClient, userId: string, createdPersonId: string | null): Promise<void> {
  if (createdPersonId) {
    const { error } = await admin.from('people').delete().eq('id', createdPersonId)
    if (error) console.error(`[createAccount] 인물 롤백 실패(person_id=${createdPersonId}):`, error.message)
  }
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) console.error(`[createAccount] 보상 롤백 실패(유령 계정 잔존 user_id=${userId}):`, error.message)
}

/**
 * 게이트/클라이언트 생성 이후 단건 생성 — bulk 에서 재사용(게이트 재검사 없음).
 * 이미 있는 이메일은 createUser 가 거부한다 — 기존 계정의 비밀번호·표시 이름을 덮는 분기가 없다. 그래서 워크스페이스
 * 관리자에게 열려도 다른 워크스페이스 소속 계정을 가로채는 길이 되지 않는다(기존 계정의 합류는 초대 경로).
 */
async function createOne(
  admin: AdminClient, workspaceId: string, input: AccountInput, grantedBy: string,
): Promise<AccountActionResult> {
  // 계정·프로필·인물 이메일은 초대와 같은 정규형(local@ASCII 호스트) — GoTrue 는 유니코드 호스트를 받지 않고, 인물 매치도 이 값이다(P-1)
  const email = typeof input.email === 'string' ? canonicalEmail(input.email) : null
  if (!email) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  if (!isValidPassword(input.password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  if (!isWorkspaceRole(input.workspaceRole)) return { ok: false, error: ERR_WS_ROLE }
  const accessRole = input.accessRole ?? null
  if (accessRole !== null && accessRole !== ACCESS_ROLE.admin && accessRole !== ACCESS_ROLE.member) return { ok: false, error: ERR_ACCESS }
  if (accessRole && !input.projectId) return { ok: false, error: '권한을 줄 프로젝트를 지정하세요.' }

  const givenName = typeof input.name === 'string' ? input.name.trim() : ''
  const displayName = givenName || email.split('@')[0]

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true, // SMTP 없이 즉시 로그인 가능하도록 확인 처리
    user_metadata: givenName ? { full_name: givenName } : {},
  })
  if (createErr || !created?.user) return { ok: false, error: createErr?.message ?? '계정 생성 실패' }
  const userId = created.user.id

  let createdPersonId: string | null = null
  const fail = async (error: string): Promise<AccountActionResult> => {
    await rollbackAccount(admin, userId, createdPersonId)
    return { ok: false, error }
  }

  const { error: profileErr } = await admin.from('profiles').insert({ user_id: userId, email, display_name: displayName })
  if (profileErr) {
    console.error('[createAccount] 프로필 저장 실패:', profileErr.message)
    return fail('계정 프로필을 저장하지 못했습니다.')
  }

  // 워크스페이스 소속 없는 계정은 어떤 프로젝트도 볼 수 없는 유령이다 — 실패하면 전체를 되돌린다.
  const { error: wsErr } = await admin.from('workspace_members').insert({
    workspace_id: workspaceId, user_id: userId, role: input.workspaceRole, invited_by: grantedBy,
  })
  if (wsErr) {
    console.error('[createAccount] 워크스페이스 소속 저장 실패:', wsErr.message)
    return fail('워크스페이스 소속을 저장하지 못했습니다.')
  }

  const person = await linkOrCreatePerson(admin, workspaceId, userId, email, displayName)
  if (!person.ok) return fail(person.error)
  if (person.created) createdPersonId = person.personId

  if (input.projectId && accessRole) {
    // 이은 기존 인물에 그 프로젝트의 비활성 명단 행이 있으면 RPC 는 권한 칸만 쓰고 active=false 를 유지한다(active 키를 보내지
    // 않는다) — 무효인 권한을 '생성 성공' 으로 보고하게 된다. 되살리지도 않는다(0008 INVITE_INACTIVE 와 같은 규칙).
    // 새로 만든 인물은 명단 행이 있을 수 없어 조회하지 않는다. 선행 조회 실패는 중단(3원칙 ②).
    // fail() 의 계정 삭제가 FK(on delete set null)로 이 호출의 인물 연결도 푼다.
    if (!person.created) {
      const { data: row, error: rowErr } = await admin
        .from('project_members').select('active')
        .eq('project_id', input.projectId).eq('person_id', person.personId).maybeSingle()
      if (rowErr) {
        console.error('[createAccount] 명단 행 조회 실패:', rowErr.message)
        return fail('명단 정보를 확인할 수 없어 중단했습니다.')
      }
      if (row && (row as { active: boolean }).active === false) return fail(ERR_INACTIVE)
    }
    // 권한 없는 계정을 '만들어졌다'고 보고하면 관리자는 권한이 있다고 믿는다 — 실패하면 전체를 되돌린다.
    const { error: rpcErr } = await admin.rpc('upsert_project_member_cmd', {
      p_command_id: newAuthzCommandId(), p_actor: grantedBy, p_project_id: input.projectId, p_person: { id: person.personId },
      p_member: { access_role: accessRole }, p_team_ids: null,
    })
    if (rpcErr) return fail(rosterWriteError(rpcErr))
  }
  return { ok: true }
}

/** 워크스페이스 입력 확인 — 가드는 null 을 슈퍼유저에게 통과시키므로 가드 전에 거부한다. */
function isWorkspaceIdInput(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * 권한을 줄 프로젝트가 그 워크스페이스의 것인가(액터 스냅샷 — 슈퍼유저는 전 프로젝트, 그 외는 내 워크스페이스 프로젝트).
 * 쓰기 전에 끊는다: 안 그러면 다른 워크스페이스 프로젝트가 createUser·소속·인물까지 간 뒤 RPC 에서야 거부돼 계정이
 * 생겼다 지워지고, RPC 의 '없음'/'거부' 차이로 다른 워크스페이스 프로젝트의 존재가 샌다. 모르는 id 도 같은 ERR_MISSING.
 */
function projectInWorkspace(actor: { projectWorkspace: ReadonlyMap<string, string> }, projectId: string, workspaceId: string): boolean {
  return actor.projectWorkspace.get(projectId) === workspaceId
}

export async function createAccount(input: AccountInput & { workspaceId: string }): Promise<AccountActionResult> {
  const workspaceId = input?.workspaceId
  if (!isWorkspaceIdInput(workspaceId)) return { ok: false, error: ERR_WORKSPACE_REQUIRED }
  // 계정 생성은 그 워크스페이스의 관리자(SP2 §4.1 — SP1 까지는 슈퍼유저 전용).
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  if (input.projectId && !projectInWorkspace(g.actor, input.projectId, workspaceId)) return { ok: false, error: ERR_MISSING }
  const res = await createOne(createAdminClient(), workspaceId, input, g.actor.userId)
  if (res.ok) {
    revalidatePath('/(app)/w/[slug]/admin/accounts', 'page')
    if (input.projectId) revalidatePath(`/p/${input.projectId}/members`)
  }
  return res
}

/** 한 줄 = 계정 하나. 워크스페이스 등급은 member, 행의 권한은 projectId 프로젝트의 권한('viewer' = 명단 없이 조회 전용). */
export async function bulkCreateAccounts(
  workspaceId: string, text: string, projectId: string,
): Promise<{ ok: boolean; error?: string; results: BulkResultRow[] }> {
  if (!isWorkspaceIdInput(workspaceId)) return { ok: false, error: ERR_WORKSPACE_REQUIRED, results: [] }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error, results: [] }
  if (projectId && !projectInWorkspace(g.actor, projectId, workspaceId)) return { ok: false, error: ERR_MISSING, results: [] }
  const lines = parseBulkAccounts(typeof text === 'string' ? text : '')
  if (lines.length === 0) return { ok: false, error: '처리할 행이 없습니다.', results: [] }

  const admin = createAdminClient()
  const results: BulkResultRow[] = []
  for (const line of lines) {
    if (!line.ok) {
      results.push({ lineNo: line.lineNo, email: line.email ?? line.raw, ok: false, error: line.error })
      continue
    }
    const res = await createOne(admin, workspaceId, {
      email: line.email!, password: line.password!, name: line.name ?? null, workspaceRole: WORKSPACE_ROLE.member,
      projectId, accessRole: line.role === 'viewer' ? null : line.role!,
    }, g.actor.userId)
    results.push({ lineNo: line.lineNo, email: line.email!, ok: res.ok, error: res.error })
  }
  revalidatePath('/(app)/w/[slug]/admin/accounts', 'page')
  revalidatePath(`/p/${projectId}/members`)
  return { ok: true, results }
}

/**
 * 대상 계정이 나보다 높거나 같은 등급이면 슈퍼유저만 손댈 수 있다.
 *
 * 이 검사가 없으면 어느 한 프로젝트의 관리자가 **상위 등급 계정의 비밀번호를 초기화해
 * 그 계정으로 로그인**할 수 있고, 관리자 슬롯 규칙이 통째로 우회된다. 등급 경계는 계정 조작
 * 경로에서도 지켜져야 한다. 현 게이트(슈퍼유저 전용)에서는 단락 통과 — 정책이 다시 느슨해질 때를 위한 것이다.
 *
 * 조회 실패는 거부다 — '관리자가 아니다'로 폴백하면 가드가 그 순간 사라진다.
 */
async function assertCanTouchAccount(
  admin: AdminClient, targetUserId: string, callerIsSuperuser: boolean,
): Promise<AccountActionResult> {
  if (callerIsSuperuser) return { ok: true }

  const [platform, wsAdmin, projectAdmin] = await Promise.all([
    admin.from('platform_admins').select('user_id').eq('user_id', targetUserId).maybeSingle(),
    admin.from('workspace_members').select('workspace_id').eq('user_id', targetUserId).eq('role', WORKSPACE_ROLE.admin).limit(1),
    admin.from('project_members').select('id, people!inner(user_id)')
      .eq('people.user_id', targetUserId).eq('access_role', ACCESS_ROLE.admin).limit(1),
  ])
  if (platform.error || wsAdmin.error || projectAdmin.error || !wsAdmin.data || !projectAdmin.data) {
    console.error('[assertCanTouchAccount] 대상 등급 조회 실패:',
      platform.error?.message ?? wsAdmin.error?.message ?? projectAdmin.error?.message ?? 'unknown')
    return { ok: false, error: ERR_LOOKUP }
  }
  if (platform.data) return { ok: false, error: '슈퍼유저 계정은 슈퍼유저만 변경할 수 있습니다.' }
  // 관리자끼리도 서로의 계정을 만지지 못하게 한다 — 동급 탈취로 권한 경계가 흐려진다.
  if (wsAdmin.data.length > 0 || projectAdmin.data.length > 0) {
    return { ok: false, error: '관리자 계정은 슈퍼유저만 변경할 수 있습니다.' }
  }
  return { ok: true }
}

export async function resetPassword(userId: string, password: string): Promise<AccountActionResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  if (!isValidPassword(password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  const admin = createAdminClient()
  // 비밀번호 초기화는 그 계정으로 로그인할 수 있게 만드는 조작이다 —
  // 게이트가 슈퍼유저 전용이 된 뒤에도 등급 경계 검사는 남긴다.
  const allowed = await assertCanTouchAccount(admin, userId, g.actor.isSuperuser)
  if (!allowed.ok) return allowed
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * 플랫폼 관리자(슈퍼유저) 지정·해제. 마지막 한 명은 해제하지 못한다 — 판정은 DB 트리거(platform_admins_keep_last, 0011)가
 * advisory 잠금 아래에서 한다. 앱이 먼저 세면 두 슈퍼유저가 서로를 동시에 해제할 때 둘 다 통과한다(setWorkspaceRole 관례).
 */
export async function setPlatformAdmin(userId: string, value: boolean): Promise<AccountActionResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  // 본인 해제는 다른 슈퍼유저가 한다 — 한 번의 클릭으로 자기 관리 화면에서 잠기는 사고를 막는다(마지막 한 명 검사와 별개).
  if (!value && userId === g.actor.userId) return { ok: false, error: ERR_SELF_PLATFORM }
  if (typeof value !== 'boolean') return { ok: false, error: '지정 여부가 올바르지 않습니다.' }
  const admin = createAdminClient()
  // 실패 로그의 머리 — 어느 계정의 실패인지. userId 는 액션 인자라 형식이 보장되지 않는다: UUID 꼴일 때만 찍는다.
  const head = `[setPlatformAdmin user=${UUID_RE.test(userId) ? userId : '(id 아님)'}]`

  // 지정·해제 모두 RPC 한 번 — 행위자·명령 id 가 권한 변경 이력(authz_events)에 남는다. 마지막 한 명 보호는 그 안의 트리거가 한다.
  const { data, error } = await admin.rpc('set_platform_admin', {
    p_actor: g.actor.userId, p_target: userId, p_grant: value, p_command_id: newAuthzCommandId(),
  })
  if (error) {
    if (error.message.includes('PLATFORM_LAST_ADMIN')) {
      return { ok: false, error: '마지막 슈퍼유저(플랫폼 관리자)는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.' }
    }
    const denied = authzCommandError(error.message)
    if (denied) return { ok: false, error: denied }
    console.error(`${head} ${value ? '지정' : '해제'} 실패:`, error.message)
    return { ok: false, error: value ? '슈퍼유저로 지정하지 못했습니다.' : '슈퍼유저를 해제하지 못했습니다.' }
  }
  const result = parseAuthzResult(data)
  if (!result) {
    console.error(`${head} RPC 결과를 읽지 못했다:`, data)
    return { ok: false, error: value ? '슈퍼유저로 지정하지 못했습니다.' : '슈퍼유저를 해제하지 못했습니다.' }
  }
  // 해제의 0행 = 이미 슈퍼유저가 아니다. 조용한 no-op 을 성공으로 보고하지 않는다. (지정의 0행은 이미 지정된 것 — 멱등)
  if (!value && result.matched === 0) return { ok: false, error: '슈퍼유저가 아닌 계정입니다.' }
  revalidatePath('/(app)/w/[slug]/admin/accounts', 'page')
  return { ok: true }
}

/**
 * 워크스페이스 등급 변경. 그 워크스페이스의 관리자(SP2 §4.1). 마지막 관리자의 강등은
 * 트리거(workspace_members_keep_last_admin)가 거부한다 — 앱이 먼저 세지 않는다(경합에 안전한 쪽이 DB).
 */
export async function setWorkspaceRole(
  workspaceId: string, userId: string, role: WorkspaceRole,
): Promise<AccountActionResult> {
  if (!isWorkspaceIdInput(workspaceId)) return { ok: false, error: ERR_WORKSPACE_REQUIRED }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!isWorkspaceRole(role)) return { ok: false, error: ERR_WS_ROLE }
  const { data, error } = await createAdminClient().rpc('set_workspace_role', {
    p_actor: g.actor.userId, p_workspace_id: workspaceId, p_target: userId, p_role: role, p_command_id: newAuthzCommandId(),
  })
  if (error) {
    if (error.message.includes('WORKSPACE_LAST_ADMIN')) {
      return { ok: false, error: '워크스페이스의 마지막 관리자는 강등할 수 없습니다. 다른 관리자를 먼저 지정하세요.' }
    }
    const denied = authzCommandError(error.message)
    if (denied) return { ok: false, error: denied }
    console.error('[setWorkspaceRole] 변경 실패:', error.message)
    return { ok: false, error: '워크스페이스 권한을 바꾸지 못했습니다.' }
  }
  const result = parseAuthzResult(data)
  if (!result) {
    console.error('[setWorkspaceRole] RPC 결과를 읽지 못했다:', data)
    return { ok: false, error: '워크스페이스 권한을 바꾸지 못했습니다.' }
  }
  // 0행 = 소속 아님. 조용한 no-op 을 성공으로 보고하지 않는다.
  if (result.matched === 0) return { ok: false, error: '이 워크스페이스에 소속되지 않은 계정입니다.' }
  revalidatePath('/(app)/w/[slug]/admin/accounts', 'page')
  return { ok: true }
}

/**
 * 계정 목록. **권한 거부·조회 실패를 빈 배열로 돌려주지 않는다** — 이 화면은 그 자체가 권한 정보라
 * '계정 0개'·'관리자 0명'이 곧 오정보가 되고, 관리자가 그걸 근거로 권한을 다시 부여하는 쓰기까지 유발한다.
 * workspaceId 는 조회 대상 프로젝트의 워크스페이스 — 화면의 워크스페이스 등급 변경(setWorkspaceRole)이 쓴다.
 * 판정은 그 워크스페이스의 관리자. 프로젝트 가드를 먼저 걸어 타 워크스페이스·미존재 프로젝트를 404 로 숨긴 뒤,
 * 그 프로젝트의 워크스페이스(액터 스냅샷)로 워크스페이스 가드를 건다 — DB 조회는 두 가드를 넘은 뒤에만.
 */
export async function listAccounts(
  projectId: string,
): Promise<{ ok: true; rows: AccountRow[]; workspaceId: string } | { ok: false; error: string }> {
  const deny = (error: string) => {
    console.error('[listAccounts] 게이트 거부:', error, 'projectId=', projectId)
    return { ok: false as const, error }
  }
  const pg = await requireProjectMember(projectId)
  if (!pg.ok) return deny(pg.error)
  // 슈퍼유저는 roleIn 이 프로젝트 존재 전에 통과시킨다 — 스냅샷에 없으면(미존재) 여기서 404.
  const workspaceId = pg.actor.projectWorkspace.get(projectId)
  if (!workspaceId) return deny(ERR_MISSING)
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return deny(g.error)
  const admin = createAdminClient()
  const fail = (what: string, message: string | undefined) => {
    console.error(`[listAccounts] ${what} 조회 실패:`, message ?? 'unknown')
    return { ok: false as const, error: ERR_LIST }
  }

  let profiles
  try {
    profiles = await listProfiles(admin)
  } catch (e) {
    return fail('프로필', e instanceof Error ? e.message : String(e))
  }
  const [platform, wsMembers, roster] = await Promise.all([
    admin.from('platform_admins').select('user_id'),
    admin.from('workspace_members').select('user_id, role').eq('workspace_id', workspaceId),
    admin.from('project_members').select('access_role, active, people!inner(user_id, active)').eq('project_id', projectId),
  ])
  if (platform.error || !platform.data) return fail('플랫폼 관리자', platform.error?.message)
  if (wsMembers.error || !wsMembers.data) return fail('워크스페이스 소속', wsMembers.error?.message)
  if (roster.error || !roster.data) return fail('명단 권한', roster.error?.message)

  const platformIds = new Set((platform.data as Array<{ user_id: string }>).map(r => r.user_id))
  const wsRoleBy = new Map((wsMembers.data as Array<{ user_id: string; role: WorkspaceRole }>).map(r => [r.user_id, r.role]))
  // 권한은 buildActor 와 같은 기준 — 명단 행·인물 둘 다 활성일 때만 유효하다.
  const accessBy = new Map<string, AccessRole>()
  for (const r of roster.data as unknown as Array<{
    access_role: AccessRole | null; active: boolean
    people: { user_id: string | null; active: boolean } | Array<{ user_id: string | null; active: boolean }>
  }>) {
    const pe = Array.isArray(r.people) ? r.people[0] : r.people
    if (pe?.user_id && r.access_role && r.active && pe.active) accessBy.set(pe.user_id, r.access_role)
  }

  // profiles 는 플랫폼 전체다. 그 워크스페이스 소속·이 프로젝트 명단 계정만 보인다 — 다른 워크스페이스 사람의 이메일이 새지 않게(SP2 격리).
  // 플랫폼 관리자도 같다: 이 목록은 /w/<slug>/admin/accounts(그 워크스페이스 화면)의 것이다(SP3b D21·D22, U2a-4 리뷰 T4).
  const visible = profiles.filter(p => wsRoleBy.has(p.userId) || accessBy.has(p.userId))
  const rows = visible
    .map<AccountRow>(p => ({
      id: p.userId,
      email: p.email,
      name: p.displayName,
      workspaceRole: wsRoleBy.get(p.userId) ?? null,
      // 플랫폼 관리자 여부는 플랫폼 관리자에게만 낸다 — 워크스페이스 관리자가 이 액션을 직접 불러도 행별 플래그를 받지 않는다(U2a-5 S4)
      isPlatformAdmin: g.actor.isSuperuser && platformIds.has(p.userId),
      accessRole: accessBy.get(p.userId) ?? null,
      createdAt: p.createdAt,
    }))
    // 계정 표에 '이름' 열이 있으므로 이름 가나다순으로 보여준다. 같은 이름 안에서는 이메일순.
    .sort((a, b) => compareKoreanName(a.name, b.name) || a.email.localeCompare(b.email))
  return { ok: true, rows, workspaceId }
}
