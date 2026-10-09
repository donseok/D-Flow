'use server'
// 플랫폼 관리 — 워크스페이스 목록·생성(개정 §5.3.1·§5.3.2, §2.2 "새 워크스페이스의 허용 모듈은 플랫폼 관리자가 고른다").
// 지금까지 워크스페이스는 scripts/dev-bootstrap.mjs 와 E2E 스크립트의 service_role insert 로만 생겼다 — 이 액션이 앱 안의 첫 생성 경로다.
// 두 액션 모두 requireSuperuser(플랫폼 가드 닫힌 목록 — tests/invariants/platform-guards.test.ts). 워크스페이스가 아직 없거나 전부를 보는 화면이라
// 스코프를 정할 id 가 없다 → service_role 클라이언트를 직접 만든다(docs/sp2-admin-client-audit.md '플랫폼').
// DB 오류 원문은 로그로만 남기고 응답에는 사유 코드와 고정 문구만 싣는다(문구는 화면이 사전에서 고른다).
import { revalidatePath } from 'next/cache'
import { requireSuperuser } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/data/paging'
import { failWith } from '@/lib/errors/dbFail'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { writeWorkspaceSettingsInternal } from '@/lib/settings/write'
import { checkWorkspaceCreate, type WorkspaceCreateField, type WorkspaceCreateInputCode } from '@/lib/workspace/createInput'
import type { ModuleId } from '@/lib/modules/defaults'

type AdminClient = ReturnType<typeof createAdminClient>

export interface PlatformWorkspaceRow {
  id: string
  slug: string
  name: string
  createdAt: string
  memberCount: number
  projectCount: number
  /** 허용 모듈(비core). null = 설정을 읽지 못했거나 저장값이 손상 — 화면은 '확인 불가'로 그린다(빈 목록으로 위장하지 않는다) */
  allowedModules: ModuleId[] | null
}
export type PlatformWorkspaceListResult = { ok: true; rows: PlatformWorkspaceRow[] } | { ok: false; error: string }

/** 생성 거부 사유 — 입력 검증 코드 + 서버만 아는 사유. 문구는 사전(platform.ws.err.<code>) */
export type PlatformWorkspaceCreateCode =
  | WorkspaceCreateInputCode | 'denied' | 'slug_taken' | 'admin_not_found' | 'lookup_failed' | 'create_failed' | 'cleanup_failed'
export type PlatformWorkspaceCreateResult =
  | { ok: true; workspace: { id: string; slug: string; name: string } }
  | { ok: false; code: PlatformWorkspaceCreateCode; field: WorkspaceCreateField | null; error?: string }

const ERR_LIST = '워크스페이스 목록을 불러오지 못했습니다.'
const UNIQUE_VIOLATION = '23505'

/** 모든 워크스페이스(플랫폼 관리자 전용). 멤버·프로젝트 수는 행을 끝까지 읽어 센다(fetchAllPages — 서버 상한에 잘린 수를 사실처럼 내지 않는다) */
export async function listPlatformWorkspaces(): Promise<PlatformWorkspaceListResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  try {
    const [workspaces, members, projects] = await Promise.all([
      fetchAllPages<{ id: string; slug: string; name: string; created_at: string }>('워크스페이스', (from, to) =>
        admin.from('workspaces').select('id, slug, name, created_at', { count: 'exact' }).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      fetchAllPages<{ workspace_id: string }>('워크스페이스 멤버', (from, to) =>
        admin.from('workspace_members').select('workspace_id', { count: 'exact' }).order('workspace_id', { ascending: true }).order('user_id', { ascending: true }).range(from, to)),
      fetchAllPages<{ workspace_id: string }>('프로젝트', (from, to) =>
        admin.from('projects').select('workspace_id', { count: 'exact' }).order('id', { ascending: true }).range(from, to)),
    ])
    const tally = (rows: { workspace_id: string }[]) => {
      const m = new Map<string, number>()
      for (const r of rows) m.set(r.workspace_id, (m.get(r.workspace_id) ?? 0) + 1)
      return m
    }
    const memberCount = tally(members)
    const projectCount = tally(projects)
    // 허용 모듈은 해석기(설정 표의 유일한 읽기 경로)로 읽는다. 한 워크스페이스의 설정이 손상돼도 목록 전체를 막지 않고 그 칸만 null 로 표시한다
    const allowed = await Promise.all(workspaces.map(async (w): Promise<ModuleId[] | null> => {
      try {
        const key = (await getWorkspaceConfig(w.id, { client: admin })).keys['modules.allowed']
        return key.status === 'set' || key.status === 'default' ? [...key.value] : null
      } catch (e) {
        console.error('[platformWorkspaces] 허용 모듈 판독 실패', { workspaceId: w.id, cause: e instanceof Error ? e.message : e })
        return null
      }
    }))
    return {
      ok: true,
      rows: workspaces.map((w, i) => ({
        id: w.id, slug: w.slug, name: w.name, createdAt: w.created_at,
        memberCount: memberCount.get(w.id) ?? 0, projectCount: projectCount.get(w.id) ?? 0, allowedModules: allowed[i],
      })),
    }
  } catch (e) {
    return { ok: false, error: failWith('platformWorkspaces', e, ERR_LIST) }
  }
}

/**
 * 만든 워크스페이스를 되돌린다(보상). 멤버십·인물·설정 행은 FK cascade 로 함께 사라진다(0003·0012).
 * 한계: 이 삭제 자체가 실패하면 관리자 없는 워크스페이스 행이 남는다 — 목록 화면에 멤버 0 으로 보이고 같은 slug 재시도는 '이미 사용 중'이 된다.
 * 그때는 cleanup_failed 로 알리고 로그에 id 를 남긴다. 한 문장으로 묶으려면 DEFINER RPC(create_workspace_with_admin)가 필요하다 —
 * 이 작업은 스키마를 바꾸지 않으므로 순서(설정 쓰기를 맨 뒤에)와 보상으로 둔다.
 */
async function removeWorkspace(admin: AdminClient, workspaceId: string): Promise<boolean> {
  const { error } = await admin.from('workspaces').delete().eq('id', workspaceId)
  if (error) console.error(`[createPlatformWorkspace] 보상 삭제 실패(workspace_id=${workspaceId}):`, error.message)
  return !error
}

/**
 * 워크스페이스 생성 — 행 + 첫 관리자 멤버십 + 그 관리자의 인물 행 + 허용 모듈(·시간대) 설정.
 * 순서: ① 입력 검증 ② 첫 관리자 계정 확인(없으면 아무것도 만들지 않는다 — 계정을 여기서 만들지 않는다) ③ slug 중복 확인
 * ④ 워크스페이스 행 ⑤ 멤버십 ⑥ 인물 ⑦ 설정(RPC 한 길 — 이력이 생기는 마지막 단계). ⑤~⑦ 이 실패하면 ④ 를 지운다(removeWorkspace).
 */
export async function createPlatformWorkspace(input: unknown): Promise<PlatformWorkspaceCreateResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, code: 'denied', field: null, error: g.error }
  const checked = checkWorkspaceCreate(input)
  if (!checked.ok) return { ok: false, code: checked.code, field: checked.field }
  const { name, slug, adminEmail, modules, timezone } = checked.value
  const actorId = g.actor.userId
  const admin = createAdminClient()

  // ② 첫 관리자 — 이메일을 주면 그 계정, 비우면 만드는 사람 자신. 조회 실패는 '없음'으로 바꾸지 않고 멈춘다
  const profileQuery = admin.from('profiles').select('user_id, email, display_name')
  const { data: profile, error: profileErr } = await (adminEmail ? profileQuery.eq('email', adminEmail) : profileQuery.eq('user_id', actorId)).maybeSingle()
  if (profileErr) {
    console.error('[createPlatformWorkspace] 첫 관리자 계정 조회 실패:', profileErr.message)
    return { ok: false, code: 'lookup_failed', field: 'adminEmail' }
  }
  if (!profile) return { ok: false, code: 'admin_not_found', field: 'adminEmail' }
  const owner = profile as { user_id: string; email: string; display_name: string }

  // ③ slug 중복 — 사람이 읽을 사유를 먼저 낸다. 경합은 ④ 의 유니크 위반이 최종 판정이다
  const { data: taken, error: takenErr } = await admin.from('workspaces').select('id').eq('slug', slug).maybeSingle()
  if (takenErr) {
    console.error('[createPlatformWorkspace] slug 조회 실패:', takenErr.message)
    return { ok: false, code: 'lookup_failed', field: 'slug' }
  }
  if (taken) return { ok: false, code: 'slug_taken', field: 'slug' }

  // ④ 워크스페이스 행 — 설정 행은 트리거가 만든다(0012 ensure_workspace_settings_row)
  const { data: created, error: createErr } = await admin.from('workspaces').insert({ slug, name, created_by: actorId }).select('id').single()
  if (createErr || !created) {
    if (createErr?.code === UNIQUE_VIOLATION) return { ok: false, code: 'slug_taken', field: 'slug' }
    console.error('[createPlatformWorkspace] 워크스페이스 저장 실패:', createErr?.message ?? '행 없음')
    return { ok: false, code: 'create_failed', field: null }
  }
  const workspaceId = (created as { id: string }).id
  const undo = async (step: string, cause: unknown): Promise<PlatformWorkspaceCreateResult> => {
    console.error(`[createPlatformWorkspace] ${step} 실패 — 워크스페이스를 되돌린다:`, cause)
    return { ok: false, code: (await removeWorkspace(admin, workspaceId)) ? 'create_failed' : 'cleanup_failed', field: null }
  }

  // ⑤ 첫 관리자 멤버십 — 관리자 없는 워크스페이스는 설정·초대를 할 사람이 없다
  const { error: memberErr } = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: owner.user_id, role: 'admin', invited_by: actorId })
  if (memberErr) return undo('멤버십 저장', memberErr.message)

  // ⑥ 인물 원장 — 새 워크스페이스라 같은 이메일의 기존 인물이 없다(조회 없이 insert). 명단·담당자 지정이 이 행을 가리킨다
  // 인물 이름은 앞뒤 공백이 없어야 한다(0003 people.display_name check) — 프로필 쪽 check 는 '비지 않음'뿐이라 여기서 다듬는다
  const { error: personErr } = await admin.from('people').insert({ workspace_id: workspaceId, email: owner.email, display_name: owner.display_name.trim(), user_id: owner.user_id })
  if (personErr) return undo('인물 저장', personErr.message)

  // ⑦ 설정 — 허용 모듈은 늘 명시로 적는다(빈 배열 = core 만). 시간대는 줬을 때만(비우면 제품 기본값 — 설정 화면이 브라우저 시간대를 제안한다)
  const set: Record<string, unknown> = { 'modules.allowed': modules }
  if (timezone) set['calendar.timezone'] = timezone
  let written: Awaited<ReturnType<typeof writeWorkspaceSettingsInternal>>
  try {
    written = await writeWorkspaceSettingsInternal(admin, workspaceId, { set }, actorId)
  } catch (e) {
    return undo('설정 저장', e instanceof Error ? e.message : e)
  }
  if (!written.ok) return undo('설정 저장', `${written.code}: ${written.error}`)

  // 목록 화면과, 만든 사람이 첫 관리자일 때 바뀌는 전환기 목록(레이아웃 데이터)을 함께 새로 읽게 한다
  revalidatePath('/', 'layout')
  return { ok: true, workspace: { id: workspaceId, slug, name } }
}
