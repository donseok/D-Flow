'use server'
// 플랫폼 관리자(슈퍼유저) 관리 화면의 조회 둘 — 목록과 이메일로 계정 찾기. 지정·해제는 새로 만들지 않는다:
// accounts.ts 의 setPlatformAdmin(requireSuperuser → RPC set_platform_admin — 행위자 재판정·명령 멱등·authz_events·마지막 한 명 트리거) 한 길이다.
// 계정을 여기서 만들지 않는다(설계 결정 A) — 없는 이메일은 화면이 멤버·초대 화면으로 안내한다.
import { requireSuperuser } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { canonicalEmail } from '@/lib/domain/email'
import { isWorkspaceAdminRole } from '@/lib/domain/authz'
import { serverTranslator } from '@/lib/i18n/server'

/** email·name 이 null = 프로필 행이 없다(계정 삭제 경합·시드). 행은 빼지 않는다 — 빼면 관리자 수가 틀린다 */
export interface PlatformAdminPerson { userId: string; email: string | null; name: string | null }
export interface PlatformAdminRow extends PlatformAdminPerson {
  grantedAt: string
  /** 지정한 사람. null = granted_by 가 비었다(첫 관리자 시드·지운 계정의 SET NULL) */
  grantedBy: PlatformAdminPerson | null
}
export interface PlatformAdminCandidate {
  userId: string; email: string; name: string
  isPlatformAdmin: boolean
  /** 소속 워크스페이스 — 지정 전 "이 사람이 맞나" 판단용 표시. 보관된 것도 싣고 archived 로 표시한다 */
  workspaces: { name: string; role: 'admin' | 'member'; archived: boolean }[]
}

/**
 * 플랫폼 관리자 전부(지정 일시 순). **조회 실패를 빈 목록으로 돌려주지 않는다** — '관리자 0명'은 오정보이고
 * 그걸 근거로 한 재지정 쓰기를 부른다(listAccounts 와 같은 원칙).
 */
export async function listPlatformAdmins(): Promise<{ ok: true; rows: PlatformAdminRow[] } | { ok: false; error: string }> {
  const t = await serverTranslator()
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const fail = (what: string, message: string | undefined) => {
    console.error(`[listPlatformAdmins] ${what} 조회 실패:`, message ?? 'unknown')
    return { ok: false as const, error: t('srv.platformAdmins.listFailed') }
  }
  const pa = await admin.from('platform_admins').select('user_id, granted_by, granted_at').order('granted_at').order('user_id')
  if (pa.error || !pa.data) return fail('플랫폼 관리자', pa.error?.message)
  const rows = pa.data as Array<{ user_id: string; granted_by: string | null; granted_at: string }>
  const ids = [...new Set(rows.flatMap((r) => (r.granted_by ? [r.user_id, r.granted_by] : [r.user_id])))]
  // 플랫폼 관리자는 몇 명뿐이다 — 한 번의 in 으로 읽는다(지정한 사람 포함)
  const pr = await admin.from('profiles').select('user_id, email, display_name').in('user_id', ids)
  if (pr.error || !pr.data) return fail('프로필', pr.error?.message)
  const by = new Map((pr.data as Array<{ user_id: string; email: string; display_name: string }>)
    .map((p) => [p.user_id, { userId: p.user_id, email: p.email, name: p.display_name }]))
  const person = (id: string): PlatformAdminPerson => by.get(id) ?? { userId: id, email: null, name: null }
  return {
    ok: true,
    rows: rows.map((r) => ({ ...person(r.user_id), grantedAt: r.granted_at, grantedBy: r.granted_by ? person(r.granted_by) : null })),
  }
}

/**
 * 이메일 완전 일치로 계정 하나를 찾는다(정규형 — 계정·프로필은 canonicalEmail 로 저장된다). 부분 검색은 하지 않는다.
 * 없으면 account: null. 조회 실패는 { ok: false } — '계정 없음'으로 위장하면 관리자가 없는 계정을 만들러 간다.
 */
export async function findAccountByEmail(
  email: string,
): Promise<{ ok: true; account: PlatformAdminCandidate | null } | { ok: false; error: string }> {
  const t = await serverTranslator()
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const canon = typeof email === 'string' ? canonicalEmail(email) : null
  if (!canon) return { ok: false, error: t('err.emailFormatNotValid') }
  const admin = createAdminClient()
  const fail = (what: string, message: string | undefined) => {
    console.error(`[findAccountByEmail] ${what} 조회 실패:`, message ?? 'unknown')
    return { ok: false as const, error: t('srv.platformAdmins.lookupFailed') }
  }
  // 같은 이메일 행이 둘이면 maybeSingle 이 오류를 낸다 — 고르지 않고 실패로 닫는다
  const pr = await admin.from('profiles').select('user_id, email, display_name').eq('email', canon).maybeSingle()
  if (pr.error) return fail('프로필', pr.error.message)
  if (!pr.data) return { ok: true, account: null }
  const p = pr.data as { user_id: string; email: string; display_name: string }
  const [pa, wm] = await Promise.all([
    admin.from('platform_admins').select('user_id').eq('user_id', p.user_id).maybeSingle(),
    admin.from('workspace_members').select('role, workspaces!inner(name, archived_at)').eq('user_id', p.user_id),
  ])
  if (pa.error) return fail('플랫폼 관리자', pa.error.message)
  if (wm.error || !wm.data) return fail('워크스페이스 소속', wm.error?.message)
  type W = { name: string; archived_at: string | null }
  const workspaces = (wm.data as unknown as Array<{ role: string; workspaces: W | W[] }>).map((m) => {
    const w = Array.isArray(m.workspaces) ? m.workspaces[0] : m.workspaces
    return { name: w.name, role: isWorkspaceAdminRole(m.role) ? 'admin' as const : 'member' as const, archived: w.archived_at !== null }
  })
  return { ok: true, account: { userId: p.user_id, email: p.email, name: p.display_name, isPlatformAdmin: !!pa.data, workspaces } }
}
