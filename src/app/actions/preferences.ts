'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { getActor } from '@/lib/authz'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { hasWorkspaceMembership, isHiddenProject, type Actor } from '@/lib/domain/authz'
import { UUID_RE } from '@/lib/domain/validate'
import type { UiPrefs } from '@/lib/domain/types'
import { RECENT_MAX, RETIRED_PREF_KEYS, mergePrefs, pushRecent, splitPrefs } from '@/lib/prefs/split'

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
async function mergeUpsert(
  sb: Sb, table: 'account_preferences' | 'user_preferences', key: { user_id: string; workspace_id?: string }, patch: Partial<UiPrefs>,
  after?: (merged: Partial<UiPrefs>) => Partial<UiPrefs>,
): Promise<boolean> {
  let q = sb.from(table).select('prefs').eq('user_id', key.user_id)
  if (key.workspace_id) q = q.eq('workspace_id', key.workspace_id)
  const { data, error: readErr } = await q.maybeSingle()
  if (readErr) { console.error(`[saveUiPrefs] ${table} 선행 조회 실패 — 저장 중단:`, readErr.message); return false }
  const base = { ...((data?.prefs as Partial<UiPrefs>) ?? {}), ...patch }
  const merged = after ? after(base) : base
  const { error } = await sb.from(table).upsert(
    { ...key, prefs: merged, updated_at: new Date().toISOString() },
    { onConflict: key.workspace_id ? 'user_id,workspace_id' : 'user_id' },
  )
  if (error) { console.error(`[saveUiPrefs] ${table} 저장 실패:`, error.message); return false }
  return true
}

/**
 * 개인 설정 부분 병합 저장. 계정 키 → account_preferences, 워크스페이스 키 → opts.workspaceId 행(실제 소속일 때만 — 플랫폼 관리자 승계로 비소속
 * 워크스페이스에 본인 행을 만들지 않는다(AA6). 쿠키를 읽지 않는다). 워크스페이스 판정이 거부면 같은 요청의 계정 키도 쓰지 않는다(전부 아니면 전무).
 * 값 검사·상한은 splitPrefs(notifRead 는 받지 않는다). recentProjects 도 클라이언트 쓰기 키가 아니다 — 쓰기 주체는 visits 하나(AA7).
 * 결과는 `{ ok }` 하나뿐이다(W10): 비로그인·workspaceId 없음·형식 밖·없는 워크스페이스·비소속·권한 조회 실패·저장 실패가 모두 같은
 * `{ ok: false }` 라 응답으로 워크스페이스의 존재를 가늠할 수 없다(사유는 서버 로그에만). 은퇴 키만 담긴 요청은 조용히 버리고 ok.
 */
export async function saveUiPrefs(patch: Partial<UiPrefs>, opts: { workspaceId?: string | null; visits?: unknown } = {}): Promise<{ ok: boolean }> {
  const u = await getSession()
  if (!u) return { ok: false }
  const { account, workspace, dropped } = splitPrefs(patch)
  // 최근 방문은 서버가 거른 visits 로만 쓴다 — 클라이언트 목록으로 서버 목록을 덮지 않는다(Y1·AA7). 읽기·병합 목록에는 남는다
  if (workspace.recentProjects !== undefined) {
    delete workspace.recentProjects
    console.error('[saveUiPrefs] 클라이언트가 보낸 recentProjects — 버린다(쓰기 주체는 visits)')
  }
  const unknown = dropped.filter((k) => !(RETIRED_PREF_KEYS as readonly string[]).includes(k))
  // 키 이름은 요청자가 정한다 — 개수와 앞 몇 개(길이 절단)만 남긴다(로그 범람 방지, Y4)
  if (unknown.length) {
    console.error(`[saveUiPrefs] 모르는 키·형식 밖 값 — 버린다(${unknown.length}개):`,
      unknown.slice(0, LOG_KEYS_MAX).map((k) => k.slice(0, LOG_KEY_LEN)).join(',') + (unknown.length > LOG_KEYS_MAX ? ',…' : ''))
  }
  const hasAccount = Object.keys(account).length > 0
  const rawVisits = Array.isArray(opts.visits) ? opts.visits.slice(-RECENT_MAX) : []
  const hasWorkspace = Object.keys(workspace).length > 0 || rawVisits.length > 0
  if (!hasAccount && !hasWorkspace) return { ok: true }
  // 워크스페이스 키가 있으면 판정을 먼저 한다 — 거부면 계정 키도 쓰지 않는다(전부 아니면 전무: 섞인 요청이 '저장 실패' 응답과
  // 부분 저장으로 갈리지 않게, Y4). 지금 클라이언트는 두 큐를 나눠 섞인 요청을 보내지 않는다
  let wid: string | null = null
  let visits: string[] = []
  if (hasWorkspace) {
    const raw = opts.workspaceId
    if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
      console.error('[saveUiPrefs] workspaceId 없음·형식 밖 — 저장하지 않는다:', Object.keys(workspace).join(','))
      return { ok: false }
    }
    wid = raw.toLowerCase()   // 소속 맵의 키는 DB 의 소문자 uuid — 대문자로 온 같은 id 를 비소속으로 보지 않게
    let actor: Actor | null = null
    try { actor = await getActor() } catch (e) {
      console.error('[saveUiPrefs] 권한 조회 실패 — 저장하지 않는다:', e instanceof Error ? e.message : e)
      return { ok: false }
    }
    if (!hasWorkspaceMembership(actor, wid)) { console.error('[saveUiPrefs] 소속이 아닌 워크스페이스 — 저장하지 않는다:', wid); return { ok: false } }
    // 방문은 프로젝트 화면과 같은 판정자로 거른다(GG1 — 명단 밖 비공개 포함). 그 판정이 실패하면 쓰기 전 선행 판정 실패 — 중단한다(원칙 ②)
    let hidden: ReadonlySet<string> = new Set()
    if (rawVisits.length) {
      try { hidden = await getHiddenProjectIds() } catch {
        console.error('[saveUiPrefs] 비공개 판정 실패 — 저장하지 않는다')
        return { ok: false }
      }
    }
    visits = visitsIn(actor, wid, rawVisits, hidden)
  }
  const sb = await createServerClient()
  let ok = true
  if (hasAccount) ok = await mergeUpsert(sb, 'account_preferences', { user_id: u.id }, account)
  if (wid && (Object.keys(workspace).length > 0 || visits.length > 0)) {
    // 방문은 선행 조회한 행의 최근 방문 앞에 차례로 넣는다(Y1) — 같은 병합 안이라 즐겨찾기 패치와 경합하지 않는다. 선행 조회 실패면 mergeUpsert 가 중단한다
    const now = new Date().toISOString()
    const applyVisits = visits.length ? (m: Partial<UiPrefs>) => ({
      ...m,
      recentProjects: visits.reduce((list, id) => pushRecent(list, id, now), splitPrefs({ recentProjects: m.recentProjects }).workspace.recentProjects ?? []),
    }) : undefined
    ok = (await mergeUpsert(sb, 'user_preferences', { user_id: u.id, workspace_id: wid }, workspace, applyVisits)) && ok
  }
  return { ok }
}

/** 방문 id 중 그 워크스페이스에서 볼 수 있는 프로젝트만(소문자 uuid) — 다른 워크스페이스·숨김(명단 밖 비공개 포함)·모르는 id·형식 밖은 버리고 개수만 로그 */
function visitsIn(actor: Actor | null, wid: string, raw: unknown[], hidden: ReadonlySet<string>): string[] {
  const out: string[] = []
  let dropped = 0
  for (const v of raw) {
    const id = typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null
    if (id && actor && !isHiddenProject(actor, id, hidden) && actor.projectWorkspace.get(id) === wid) out.push(id); else dropped += 1
  }
  if (dropped) console.error(`[saveUiPrefs] 그 워크스페이스에서 볼 수 없는 방문 — 버린다(${dropped}개)`)
  return out
}
const LOG_KEYS_MAX = 5
const LOG_KEY_LEN = 40

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
