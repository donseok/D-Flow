// 설정 이력 읽기(D24). 받은 클라이언트로 읽는다 — 화면은 세션(RLS read 정책이 스코프를 좁힌다), 설정 액션의 재기준 판독(changedKeysSince)은
// service_role(가드 뒤, RLS 없음)이다. 두 이력 표 이름은 src 에서는 이 파일에만 있고 접근은 from(table).select 뿐이다(settings-writes 허용 목록 G1·읽기 전용 G2).
import type { ConfigReadClient } from './projectConfig'

export type HistoryScope = { projectId: string } | { workspaceId: string }
export interface SettingsHistoryRow {
  id: number; revision: number; key: string; oldValue: unknown; newValue: unknown
  source: 'edit' | 'create' | 'copy' | 'migration' | 'internal'
  commandId: string; changedBy: string | null; changedAt: string; copiedFrom: string | null
}
export const HISTORY_PAGE = 20
const HISTORY_MAX = 100

type Row = { id: number | string; revision: number | string; key: string; old_value: unknown; new_value: unknown; source: SettingsHistoryRow['source']
  command_id: string; changed_by: string | null; changed_at: string; copied_from?: string | null }

function tableOf(scope: HistoryScope): { table: 'project_settings_history' | 'workspace_settings_history'; column: 'project_id' | 'workspace_id'; id: string } {
  return 'projectId' in scope
    ? { table: 'project_settings_history', column: 'project_id', id: scope.projectId }
    : { table: 'workspace_settings_history', column: 'workspace_id', id: scope.workspaceId }
}
const toRow = (r: Row): SettingsHistoryRow => ({
  id: Number(r.id), revision: Number(r.revision), key: r.key, oldValue: r.old_value, newValue: r.new_value, source: r.source,
  commandId: r.command_id, changedBy: r.changed_by, changedAt: r.changed_at, copiedFrom: r.copied_from ?? null,
})
const COLS = 'id, revision, key, old_value, new_value, source, command_id, changed_by, changed_at, copied_from'
const WS_COLS = 'id, revision, key, old_value, new_value, source, command_id, changed_by, changed_at'

export async function listHistory(client: ConfigReadClient, scope: HistoryScope, opts: { limit?: number; before?: number } = {}) {
  const { table, column, id } = tableOf(scope)
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? HISTORY_PAGE)), HISTORY_MAX)
  let q = client.from(table).select(table === 'project_settings_history' ? COLS : WS_COLS).eq(column, id)
  if (opts.before !== undefined) q = q.lt('id', opts.before)
  const { data, error } = await q.order('id', { ascending: false }).limit(limit + 1)
  if (error) return { ok: false as const, error: `이력 조회 실패: ${error.message}` }
  const rows = ((data ?? []) as unknown as Row[]).map(toRow)
  const page = rows.slice(0, limit)
  return { ok: true as const, rows: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null }
}

/** 결과 불명(네트워크 끊김) 뒤 재조회 — 자기(changed_by) 명령만 본다. 없으면 unknown(다시 보내면 RPC 가 duplicate 로 잡는다) */
export async function findCommandOutcome(client: ConfigReadClient, scope: HistoryScope, commandId: string, actorUserId: string) {
  const { table, column, id } = tableOf(scope)
  const { data, error } = await client.from(table).select('revision').eq(column, id).eq('command_id', commandId).eq('changed_by', actorUserId).order('id', { ascending: false }).limit(1)
  if (error) return { ok: false as const, error: `명령 조회 실패: ${error.message}` }
  const rows = (data ?? []) as { revision: number | string }[]
  return { ok: true as const, outcome: rows.length ? { status: 'applied' as const, revision: Number(rows[0].revision) } : { status: 'unknown' as const } }
}

/** 재기준 판독의 행 한도 — PostgREST max_rows(supabase/config.toml)도 1000 이라 limit 만 올려서는 끝까지 읽히지 않는다 */
const CHANGED_KEYS_LIMIT = HISTORY_MAX * 10

/** 자동 재기준(개정 §2.3.1 ⑦) — expectedRevision 뒤에 바뀐 키 집합. 최신 순으로 잘리므로 빠지는 쪽은 expectedRevision 바로 뒤의
 *  가장 오래된 변경이다 — truncated 면 '겹침 없음'을 판정할 수 없다(호출부가 재기준하지 않고 conflict 로 멈춘다, 3원칙 ②) */
export async function changedKeysSince(client: ConfigReadClient, scope: HistoryScope, revision: number) {
  const { table, column, id } = tableOf(scope)
  const { data, error } = await client.from(table).select('key').eq(column, id).gt('revision', revision).order('id', { ascending: false }).limit(CHANGED_KEYS_LIMIT)
  if (error) return { ok: false as const, error: `이력 조회 실패: ${error.message}` }
  const rows = (data ?? []) as { key: string }[]
  return { ok: true as const, keys: [...new Set(rows.map((r) => r.key))], truncated: rows.length >= CHANGED_KEYS_LIMIT }
}
