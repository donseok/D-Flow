'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { getActor } from '@/lib/authz'
import { isWorkspaceMember } from '@/lib/domain/authz'
import { UUID_RE } from '@/lib/domain/validate'
import type { UiPrefs } from '@/lib/domain/types'
import { RETIRED_PREF_KEYS, mergePrefs, splitPrefs } from '@/lib/prefs/split'

/** 계정 범위 개인 설정(account_preferences 자기 행 — SP3b D9). 비로그인·행 없음은 {}. 표시용이라 조회 실패는 로그 + {} */
export async function getAccountPrefs(): Promise<UiPrefs> {
  // getSession 은 요청 단위 cache() — 레이아웃 렌더에서 다른 조회들과 세션 확인을 공유한다.
  const u = await getSession()
  if (!u) return {}
  const sb = await createServerClient()
  const { data, error } = await sb.from('account_preferences').select('prefs').eq('user_id', u.id).maybeSingle()
  if (error) { console.error('[getAccountPrefs] 조회 실패:', error.message); return {} }
  return mergePrefs((data?.prefs as Partial<UiPrefs>) ?? {}, {})
}

/** 워크스페이스 범위 개인 설정(user_preferences (user_id, workspace_id) 행). 워크스페이스 키만 돌려준다.
 *  비소속 워크스페이스는 RLS(own_user_preferences — is_ws_member)가 0행으로 돌려 {} 다 */
export async function getWorkspacePrefs(workspaceId: string): Promise<UiPrefs> {
  const u = await getSession()
  if (!u || typeof workspaceId !== 'string' || !UUID_RE.test(workspaceId)) return {}
  const sb = await createServerClient()
  const { data, error } = await sb.from('user_preferences').select('prefs').eq('user_id', u.id).eq('workspace_id', workspaceId).maybeSingle()
  if (error) { console.error('[getWorkspacePrefs] 조회 실패:', workspaceId, error.message); return {} }
  return mergePrefs({}, (data?.prefs as Partial<UiPrefs>) ?? {})
}

type Sb = Awaited<ReturnType<typeof createServerClient>>
/** 선행 조회 → 병합 → upsert. 선행 조회 실패면 저장 중단(덮어쓰기 방지 — 원칙 ②). 저장했으면 true */
async function mergeUpsert(sb: Sb, table: 'account_preferences' | 'user_preferences', key: { user_id: string; workspace_id?: string }, patch: Partial<UiPrefs>): Promise<boolean> {
  let q = sb.from(table).select('prefs').eq('user_id', key.user_id)
  if (key.workspace_id) q = q.eq('workspace_id', key.workspace_id)
  const { data, error: readErr } = await q.maybeSingle()
  if (readErr) { console.error(`[saveUiPrefs] ${table} 선행 조회 실패 — 저장 중단:`, readErr.message); return false }
  const merged = { ...((data?.prefs as Partial<UiPrefs>) ?? {}), ...patch }
  const { error } = await sb.from(table).upsert(
    { ...key, prefs: merged, updated_at: new Date().toISOString() },
    { onConflict: key.workspace_id ? 'user_id,workspace_id' : 'user_id' },
  )
  if (error) { console.error(`[saveUiPrefs] ${table} 저장 실패:`, error.message); return false }
  return true
}

/**
 * 개인 설정 부분 병합 저장. 계정 키 → account_preferences, 워크스페이스 키 → opts.workspaceId 행(소속일 때만 — 쿠키를 읽지 않는다).
 * 결과는 `{ ok }` 하나뿐이다(W10): 비로그인·workspaceId 없음·형식 밖·없는 워크스페이스·비소속·권한 조회 실패·저장 실패가 모두 같은
 * `{ ok: false }` 라 응답으로 워크스페이스의 존재를 가늠할 수 없다(사유는 서버 로그에만). 은퇴 키만 담긴 요청은 조용히 버리고 ok.
 */
export async function saveUiPrefs(patch: Partial<UiPrefs>, opts: { workspaceId?: string | null } = {}): Promise<{ ok: boolean }> {
  const u = await getSession()
  if (!u) return { ok: false }
  const { account, workspace, dropped } = splitPrefs(patch)
  const unknown = dropped.filter((k) => !(RETIRED_PREF_KEYS as readonly string[]).includes(k))
  if (unknown.length) console.error('[saveUiPrefs] 모르는 키·형식 밖 값 — 버린다:', unknown.join(','))
  const hasAccount = Object.keys(account).length > 0
  const hasWorkspace = Object.keys(workspace).length > 0
  if (!hasAccount && !hasWorkspace) return { ok: true }
  const sb = await createServerClient()
  let ok = true
  if (hasAccount) ok = await mergeUpsert(sb, 'account_preferences', { user_id: u.id }, account)
  if (!hasWorkspace) return { ok }
  const raw = opts.workspaceId
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    console.error('[saveUiPrefs] workspaceId 없음·형식 밖 — 워크스페이스 키를 버린다:', Object.keys(workspace).join(','))
    return { ok: false }
  }
  const wid = raw.toLowerCase()   // 소속 맵의 키는 DB 의 소문자 uuid — 대문자로 온 같은 id 를 비소속으로 보지 않게
  let member = false
  try { member = isWorkspaceMember(await getActor(), wid) } catch (e) {
    console.error('[saveUiPrefs] 권한 조회 실패 — 워크스페이스 키를 버린다:', e instanceof Error ? e.message : e)
    return { ok: false }
  }
  if (!member) { console.error('[saveUiPrefs] 소속이 아닌 워크스페이스 — 키를 버린다:', wid); return { ok: false } }
  const wsOk = await mergeUpsert(sb, 'user_preferences', { user_id: u.id, workspace_id: wid }, workspace)
  return { ok: ok && wsOk }
}

/** 프로젝트의 WBS 접힘 id 배열(행 없으면 null). 미로그인 시 null. */
export async function getWbsCollapse(projectId: string): Promise<string[] | null> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null
  const { data, error } = await sb
    .from('user_wbs_state').select('collapsed')
    .eq('user_id', u.user.id).eq('project_id', projectId).maybeSingle()
  // 표시용 조회 — 실패 시 접힘 상태만 기본값으로 복귀(데이터 손상 없음)이라 로깅 후 폴백 유지.
  if (error) console.error('[getWbsCollapse] 조회 실패:', error.message)
  return (data?.collapsed as string[]) ?? null
}

/** 프로젝트의 WBS 접힘 상태 upsert. 미로그인 시 no-op. */
export async function saveWbsCollapse(projectId: string, ids: string[]): Promise<void> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return
  const { error } = await sb.from('user_wbs_state').upsert(
    { user_id: u.user.id, project_id: projectId, collapsed: ids, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,project_id' },
  )
  if (error) console.error('[saveWbsCollapse] 저장 실패:', error.message)
}
