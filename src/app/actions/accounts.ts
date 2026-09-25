'use server'
// 계정 관리(슈퍼유저 전용, 2026-08-20 결정). 0003 이후 계정 = auth.users + profiles + workspace_members + people(연결),
// 프로젝트 권한 = 명단 행 access_role(RPC upsert_project_member 로만 쓴다). 옛 전역 소속·프로젝트 역할 표는 0003 에서 폐지됐다.
import { revalidatePath } from 'next/cache'
import { requireSuperuser } from '@/lib/authz'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { createAdminClient } from '@/lib/supabase/admin'
import { listProfiles } from '@/lib/data/accounts'
import { isValidEmail } from '@/lib/domain/validate'
import { compareKoreanName } from '@/lib/domain/nameSort'
import { isValidPassword, parseBulkAccounts } from '@/lib/domain/accounts'
import { rosterWriteError } from '@/lib/domain/rosterErrors'

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
  /** 새 계정의 워크스페이스 등급. 워크스페이스는 액터의 유일 소속(resolveSoleWorkspaceId) — 입력으로 받지 않는다(SP2). */
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
const ERR_LIST = '계정 권한 정보를 불러오지 못했습니다.'

function isWorkspaceRole(v: unknown): v is WorkspaceRole {
  return v === 'admin' || v === 'member'
}

/**
 * 계정 ↔ 인물 연결. (워크스페이스, 이메일)로 인물을 찾아 미연결이면 잇고, 없으면 만든다.
 * 부분 유니크 people_ws_email_uidx 는 PostgREST upsert(onConflict)의 대상이 될 수 없어(42P10) select-then-write 다.
 * 연결은 user_id 가 아직 null 일 때만 — 조건부 update 가 0행이면 그 사이 다른 계정이 이었다는 뜻이라 덮어쓰지 않는다.
 * 비활성 인물이면 연결하면서 되살린다 — 헬퍼·buildActor 는 인물이 활성일 때만 권한을 인정하므로, 그대로 두면 이어서 준 권한이
 * 무효인데 '생성 성공' 으로 보고된다. consume_project_invite 의 재활성화와 같은 규칙(service_role 이라 people.active 컬럼 권한을 넘는다).
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
    const patch: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() }
    if (found.active === false) patch.active = true
    const { data: linked, error: linkErr } = await admin
      .from('people').update(patch)
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

/** 게이트/클라이언트 생성 이후 단건 생성 — bulk 에서 재사용(게이트 재검사 없음). */
async function createOne(
  admin: AdminClient, workspaceId: string, input: AccountInput, grantedBy: string,
): Promise<AccountActionResult> {
  if (typeof input.email !== 'string' || !isValidEmail(input.email)) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  if (!isValidPassword(input.password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  if (!isWorkspaceRole(input.workspaceRole)) return { ok: false, error: ERR_WS_ROLE }
  const accessRole = input.accessRole ?? null
  if (accessRole !== null && accessRole !== 'admin' && accessRole !== 'member') return { ok: false, error: ERR_ACCESS }
  if (accessRole && !input.projectId) return { ok: false, error: '권한을 줄 프로젝트를 지정하세요.' }

  const email = input.email.trim().toLowerCase()   // profiles·people 의 check(email = lower(btrim(email)))
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
    // 권한 없는 계정을 '만들어졌다'고 보고하면 관리자는 권한이 있다고 믿는다 — 실패하면 전체를 되돌린다.
    const { error: rpcErr } = await admin.rpc('upsert_project_member', {
      p_actor: grantedBy, p_project_id: input.projectId, p_person: { id: person.personId },
      p_member: { access_role: accessRole }, p_team_ids: null,
    })
    if (rpcErr) return fail(rosterWriteError(rpcErr))
  }
  return { ok: true }
}

export async function createAccount(input: AccountInput): Promise<AccountActionResult> {
  // 계정 관리는 슈퍼유저 전용(2026-08-20 결정 — 종전 설계 D7 '관리자도 생성 가능'을 대체).
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const ws = resolveSoleWorkspaceId(g.actor)
  if (!ws.ok) return { ok: false, error: ws.error }
  const res = await createOne(createAdminClient(), ws.workspaceId, input, g.actor.userId)
  if (res.ok) {
    revalidatePath('/admin/accounts')
    if (input.projectId) revalidatePath(`/p/${input.projectId}/members`)
  }
  return res
}

/** 한 줄 = 계정 하나. 워크스페이스 등급은 member, 행의 권한은 projectId 프로젝트의 권한('viewer' = 명단 없이 조회 전용). */
export async function bulkCreateAccounts(
  text: string, projectId: string,
): Promise<{ ok: boolean; error?: string; results: BulkResultRow[] }> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error, results: [] }
  const ws = resolveSoleWorkspaceId(g.actor)
  if (!ws.ok) return { ok: false, error: ws.error, results: [] }
  const lines = parseBulkAccounts(typeof text === 'string' ? text : '')
  if (lines.length === 0) return { ok: false, error: '처리할 행이 없습니다.', results: [] }

  const admin = createAdminClient()
  const results: BulkResultRow[] = []
  for (const line of lines) {
    if (!line.ok) {
      results.push({ lineNo: line.lineNo, email: line.email ?? line.raw, ok: false, error: line.error })
      continue
    }
    const res = await createOne(admin, ws.workspaceId, {
      email: line.email!, password: line.password!, name: line.name ?? null, workspaceRole: 'member',
      projectId, accessRole: line.role === 'viewer' ? null : line.role!,
    }, g.actor.userId)
    results.push({ lineNo: line.lineNo, email: line.email!, ok: res.ok, error: res.error })
  }
  revalidatePath('/admin/accounts')
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
    admin.from('workspace_members').select('workspace_id').eq('user_id', targetUserId).eq('role', 'admin').limit(1),
    admin.from('project_members').select('id, people!inner(user_id)')
      .eq('people.user_id', targetUserId).eq('access_role', 'admin').limit(1),
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
 * 플랫폼 관리자(슈퍼유저) 지정·해제. 마지막 한 명은 해제하지 못한다 — 전원이 전역 관리에서 잠기면
 * 복구 경로가 DB 직접 수정뿐이다. 조회 실패를 '0명'으로 폴백하면 가드가 무력화되므로 실패는 곧 거부(fail-closed).
 */
export async function setPlatformAdmin(userId: string, value: boolean): Promise<AccountActionResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  if (typeof value !== 'boolean') return { ok: false, error: '지정 여부가 올바르지 않습니다.' }
  const admin = createAdminClient()

  if (!value) {
    const { data, error } = await admin.from('platform_admins').select('user_id')
    if (error || !data) {
      console.error('[setPlatformAdmin] 플랫폼 관리자 목록 조회 실패:', error?.message ?? 'unknown')
      return { ok: false, error: '슈퍼유저 목록을 확인할 수 없어 변경을 중단했습니다. 잠시 후 다시 시도하세요.' }
    }
    const ids = (data as Array<{ user_id: string }>).map(r => r.user_id)
    if (ids.includes(userId) && ids.length <= 1) {
      return { ok: false, error: '마지막 슈퍼유저(플랫폼 관리자)는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.' }
    }
    const { error: delErr } = await admin.from('platform_admins').delete().eq('user_id', userId)
    if (delErr) {
      console.error('[setPlatformAdmin] 해제 실패:', delErr.message)
      return { ok: false, error: '슈퍼유저를 해제하지 못했습니다.' }
    }
  } else {
    const { error: insErr } = await admin.from('platform_admins').upsert(
      { user_id: userId, granted_by: g.actor.userId }, { onConflict: 'user_id', ignoreDuplicates: true },
    )
    if (insErr) {
      console.error('[setPlatformAdmin] 지정 실패:', insErr.message)
      return { ok: false, error: '슈퍼유저로 지정하지 못했습니다.' }
    }
  }
  revalidatePath('/admin/accounts')
  return { ok: true }
}

/**
 * 워크스페이스 등급 변경. 슈퍼유저 전용(SP2 에서 requireWorkspaceAdmin). 마지막 관리자의 강등은
 * 트리거(workspace_members_keep_last_admin)가 거부한다 — 앱이 먼저 세지 않는다(경합에 안전한 쪽이 DB).
 */
export async function setWorkspaceRole(
  workspaceId: string, userId: string, role: WorkspaceRole,
): Promise<AccountActionResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  if (!isWorkspaceRole(role)) return { ok: false, error: ERR_WS_ROLE }
  const { data, error } = await createAdminClient()
    .from('workspace_members').update({ role })
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .select('user_id')
  if (error) {
    if (error.message.includes('WORKSPACE_LAST_ADMIN')) {
      return { ok: false, error: '워크스페이스의 마지막 관리자는 강등할 수 없습니다. 다른 관리자를 먼저 지정하세요.' }
    }
    console.error('[setWorkspaceRole] 변경 실패:', error.message)
    return { ok: false, error: '워크스페이스 권한을 바꾸지 못했습니다.' }
  }
  // 0행 = 소속 아님. 조용한 no-op 을 성공으로 보고하지 않는다.
  if (!data || data.length === 0) return { ok: false, error: '이 워크스페이스에 소속되지 않은 계정입니다.' }
  revalidatePath('/admin/accounts')
  return { ok: true }
}

/**
 * 계정 목록. **권한 거부·조회 실패를 빈 배열로 돌려주지 않는다** — 이 화면은 그 자체가 권한 정보라
 * '계정 0개'·'관리자 0명'이 곧 오정보가 되고, 관리자가 그걸 근거로 권한을 다시 부여하는 쓰기까지 유발한다.
 * workspaceId 는 조회 대상 프로젝트의 워크스페이스 — 화면의 워크스페이스 등급 변경(setWorkspaceRole)이 쓴다.
 */
export async function listAccounts(
  projectId: string,
): Promise<{ ok: true; rows: AccountRow[]; workspaceId: string } | { ok: false; error: string }> {
  const g = await requireSuperuser()
  if (!g.ok) {
    console.error('[listAccounts] 게이트 거부:', g.error, 'projectId=', projectId)
    return { ok: false, error: g.error }
  }
  const admin = createAdminClient()
  const fail = (what: string, message: string | undefined) => {
    console.error(`[listAccounts] ${what} 조회 실패:`, message ?? 'unknown')
    return { ok: false as const, error: ERR_LIST }
  }

  const { data: project, error: projectErr } = await admin
    .from('projects').select('workspace_id').eq('id', projectId).maybeSingle()
  if (projectErr) return fail('프로젝트', projectErr.message)
  if (!project) return { ok: false, error: '프로젝트를 찾을 수 없습니다.' }
  const workspaceId = project.workspace_id as string

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

  const rows = profiles
    .map<AccountRow>(p => ({
      id: p.userId,
      email: p.email,
      name: p.displayName,
      workspaceRole: wsRoleBy.get(p.userId) ?? null,
      isPlatformAdmin: platformIds.has(p.userId),
      accessRole: accessBy.get(p.userId) ?? null,
      createdAt: p.createdAt,
    }))
    // 계정 표에 '이름' 열이 있으므로 이름 가나다순으로 보여준다. 같은 이름 안에서는 이메일순.
    .sort((a, b) => compareKoreanName(a.name, b.name) || a.email.localeCompare(b.email))
  return { ok: true, rows, workspaceId }
}
