'use server'
// 플랫폼 관리 — 워크스페이스 목록·생성(개정 §5.3.1·§5.3.2, §2.2 "새 워크스페이스의 허용 모듈은 플랫폼 관리자가 고른다").
// 지금까지 워크스페이스는 scripts/dev-bootstrap.mjs 와 E2E 스크립트의 service_role insert 로만 생겼다 — 이 액션이 앱 안의 첫 생성 경로다.
// 생성은 create_workspace_with_admin RPC 한 번이다(0054 — 등급을 RPC 안에서 다시 판정한다. 액션 가드와 두 관문).
// 두 액션 모두 requireSuperuser(플랫폼 가드 닫힌 목록 — tests/invariants/platform-guards.test.ts). 워크스페이스가 아직 없거나 전부를 보는 화면이라
// 스코프를 정할 id 가 없다 → service_role 클라이언트를 직접 만든다(docs/sp2-admin-client-audit.md '플랫폼').
// DB 오류 원문은 로그로만 남기고 응답에는 사유 코드와 고정 문구만 싣는다(문구는 화면이 사전에서 고른다).
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireSuperuser } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/data/paging'
import { failWith } from '@/lib/errors/dbFail'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { SETTINGS_SCHEMA_VERSION, settingDef } from '@/lib/settings/registry'
import { checkWorkspaceCreate, type WorkspaceCreateField, type WorkspaceCreateInputCode } from '@/lib/workspace/createInput'
import type { ModuleId } from '@/lib/modules/defaults'

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
  | WorkspaceCreateInputCode | 'denied' | 'slug_taken' | 'admin_not_found' | 'lookup_failed' | 'create_failed'
export type PlatformWorkspaceCreateResult =
  | { ok: true; workspace: { id: string; slug: string; name: string } }
  | { ok: false; code: PlatformWorkspaceCreateCode; field: WorkspaceCreateField | null; error?: string }

const ERR_LIST = '워크스페이스 목록을 불러오지 못했습니다.'
const FORBIDDEN = '42501'

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
 * 설정 값을 레지스트리의 parse 로 저장 형태로 바꾼다 — 설정 RPC 는 값을 검사하지 않는다(검사는 앱의 레지스트리 한 곳).
 * 모르는 키·검사에 걸린 값이 하나라도 있으면 null 을 돌려주고 호출부는 아무것도 만들지 않는다(원인은 로그로).
 */
function parseWorkspaceValues(raw: Record<string, unknown>): Record<string, unknown> | null {
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const def = settingDef('workspace', key)
    const parsed = def?.parse(value)
    if (!parsed?.ok) {
      console.error('[createPlatformWorkspace] 설정 값 검사 실패', { key, cause: parsed ? parsed.error : '모르는 키' })
      return null
    }
    values[key] = parsed.value
  }
  return values
}

/** 생성 RPC 의 사유 토큰 → 응답 코드. 표에 없는 오류는 create_failed(원문은 로그로만) */
function createFailure(error: { code?: string; message: string }): PlatformWorkspaceCreateResult {
  if (error.message.includes('WORKSPACE_SLUG_TAKEN')) return { ok: false, code: 'slug_taken', field: 'slug' }
  if (error.message.includes('WORKSPACE_ADMIN_NOT_FOUND')) return { ok: false, code: 'admin_not_found', field: 'adminEmail' }
  if (error.code === FORBIDDEN && error.message.includes('AUTHZ_FORBIDDEN')) return { ok: false, code: 'denied', field: null }
  console.error('[createPlatformWorkspace] 워크스페이스 생성 실패:', error.code ?? '', error.message)
  return { ok: false, code: 'create_failed', field: null }
}

/**
 * 워크스페이스 생성 — 행 + 첫 관리자 멤버십 + 그 관리자의 인물 행 + 허용 모듈(·시간대·초대 허용 도메인) 설정.
 * 순서: ① 입력 검증 ② 첫 관리자 계정 확인(이메일 → 계정 id. 없으면 아무것도 만들지 않는다 — 계정을 여기서 만들지 않는다)
 * ③ 설정 값 검사(레지스트리 parse) ④ create_workspace_with_admin RPC 한 번(0054 — 네 쓰기가 한 트랜잭션이라 실패하면 아무것도 남지 않는다.
 * 예전의 "만든 행을 지우는 보상"은 그 삭제가 실패하면 관리자 없는 워크스페이스가 남았다). slug 중복·첫 관리자 없음·등급은 RPC 가 다시 판정한다.
 */
export async function createPlatformWorkspace(input: unknown): Promise<PlatformWorkspaceCreateResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, code: 'denied', field: null, error: g.error }
  const checked = checkWorkspaceCreate(input)
  if (!checked.ok) return { ok: false, code: checked.code, field: checked.field }
  const { name, slug, adminEmail, modules, timezone, inviteDomains } = checked.value
  const admin = createAdminClient()

  // ② 첫 관리자 — 이메일을 주면 그 계정, 비우면 만드는 사람 자신. 조회 실패는 '없음'으로 바꾸지 않고 멈춘다
  const profileQuery = admin.from('profiles').select('user_id')
  const { data: profile, error: profileErr } = await (adminEmail ? profileQuery.eq('email', adminEmail) : profileQuery.eq('user_id', g.actor.userId)).maybeSingle()
  if (profileErr) {
    console.error('[createPlatformWorkspace] 첫 관리자 계정 조회 실패:', profileErr.message)
    return { ok: false, code: 'lookup_failed', field: 'adminEmail' }
  }
  if (!profile) return { ok: false, code: 'admin_not_found', field: 'adminEmail' }

  // ③ 설정 — 허용 모듈은 늘 명시로 적는다(빈 배열 = core 만). 시간대는 줬을 때만(비우면 제품 기본값 — 설정 화면이 브라우저 시간대를 제안한다)
  const set: Record<string, unknown> = { 'modules.allowed': modules }
  if (timezone) set['calendar.timezone'] = timezone
  // 초대 허용 도메인 — 생성 폼에서 명시로 적었을 때만. 적지 않으면 미설정으로 남는다(정책 기본값은 초대 불가 — 첫 초대 전에 워크스페이스 설정에서 정한다)
  if (inviteDomains) set['invites.allowed_domains'] = inviteDomains
  const values = parseWorkspaceValues(set)
  if (!values) return { ok: false, code: 'create_failed', field: null }

  // ④ 한 트랜잭션 — 워크스페이스·멤버십·인물·설정(설정 값은 RPC 안에서 apply_workspace_settings 가 쓴다 — 설정 쓰기 한 길)
  const { data, error } = await admin.rpc('create_workspace_with_admin', {
    p_actor: g.actor.userId, p_slug: slug, p_name: name, p_admin_user_id: (profile as { user_id: string }).user_id,
    p_values: values, p_command_id: randomUUID(), p_schema_version: SETTINGS_SCHEMA_VERSION,
  })
  if (error) return createFailure(error)
  const workspaceId = (data as { workspace_id?: string } | null)?.workspace_id
  if (!workspaceId) {
    // 성공인데 id 가 없다 — 만든 것을 '없음'으로 위장하지 않는다(목록 화면에서 확인하게 실패로 알린다)
    console.error('[createPlatformWorkspace] RPC 가 워크스페이스 id 를 돌려주지 않았다')
    return { ok: false, code: 'create_failed', field: null }
  }

  // 목록 화면과, 만든 사람이 첫 관리자일 때 바뀌는 전환기 목록(레이아웃 데이터)을 함께 새로 읽게 한다
  revalidatePath('/', 'layout')
  return { ok: true, workspace: { id: workspaceId, slug, name } }
}
