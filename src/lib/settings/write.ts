/**
 * 서버 내부 쓰기(스펙 §3.3) — 세션 액션이 아닌 경로(가져오기 프로파일 저장 W5, 에이전트 레벨 시드 W6, Phase B 의 옛 에이전트 토글)의
 * 유일한 쓰기 함수. 서버가 계산한 저장 형태를 parse 만 거쳐 RPC 에 넘긴다(개정 §2.3.1 4단계 끝). 방금 읽은 revision 으로 CAS 하고
 * 충돌이면 한 번 다시 읽어 같은 명령 id 로 재시도한다. 교차 불변식(validateConfig)은 여기서 돌리지 않는다 — 호출부가 필요하면 먼저 돈다.
 * `project_settings` 는 revision 판독(select)뿐이다 — tests/invariants/settings-writes.test.ts 의 허용 목록(G1)과 읽기 전용 검사(G2)가 지킨다.
 * 워크스페이스 쪽(writeWorkspaceSettingsInternal)은 플랫폼 관리자의 워크스페이스 생성이 첫 값(허용 모듈·시간대)을 적는 한 길이다 — 같은 규칙으로
 * `workspace_settings` 는 revision 판독뿐이고, 호출자는 같은 불변식의 닫힌 목록(WORKSPACE_WRITE_CALLERS)에 있다.
 */
import { randomUUID } from 'node:crypto'
import type { AdminClient } from '@/lib/supabase/adminFor'
import { SETTINGS_SCHEMA_VERSION, settingDef } from './registry'
import { CONFIG_MESSAGES, ERR_CONFIG_UNAVAILABLE, ERR_EXPLICIT_UNSET, mapDbError, type ConfigCode } from './errors'

export interface SettingsChange { set?: Record<string, unknown>; unset?: string[] }
export type InternalWriteResult =
  | { ok: true; status: 'applied' | 'duplicate'; revision: number; commandId: string }
  | { ok: false; code: ConfigCode | 'ERR_DENIED'; error: string; fieldErrors?: { key: string; message: string }[] }

/** RPC 의 요약(command_digest)과 같은 입력 — unset 은 정렬·중복 제거 */
export function commandDigestInput(set: Record<string, unknown>, unset: string[]): { set: Record<string, unknown>; unset: string[] } {
  return { set, unset: [...new Set(unset)].sort() }
}

export async function writeProjectSettingsInternal(
  admin: AdminClient, projectId: string, change: SettingsChange, actorUserId: string | null,
): Promise<InternalWriteResult> {
  const rawSet = change.set ?? {}
  const unset = [...new Set(change.unset ?? [])].sort()
  const fieldErrors: { key: string; message: string }[] = []
  const set: Record<string, unknown> = {}
  for (const key of [...Object.keys(rawSet), ...unset]) {
    if (!settingDef('project', key)) return { ok: false, code: 'CONFIG_UNKNOWN_KEY', error: `${CONFIG_MESSAGES.CONFIG_UNKNOWN_KEY}: ${key}` }
  }
  for (const key of unset) if (key in rawSet) return { ok: false, code: 'CONFIG_INVALID', error: `${CONFIG_MESSAGES.CONFIG_INVALID}: ${key} — set 과 unset 에 같이 있습니다.` }
  // 늘 명시 키는 설정 액션과 같은 규칙 — RPC 도 같은 키를 거부한다(*_authz_carry ③ — CONFIG_INVALID:<키>). TS 는 같은 문구로 먼저 막는다
  for (const key of unset) {
    if (settingDef('project', key)!.explicit) return { ok: false, code: 'CONFIG_INVALID', error: `${CONFIG_MESSAGES.CONFIG_INVALID}: ${key} — ${ERR_EXPLICIT_UNSET}`, fieldErrors: [{ key, message: ERR_EXPLICIT_UNSET }] }
  }
  for (const [key, raw] of Object.entries(rawSet)) {
    const p = settingDef('project', key)!.parse(raw)
    if (p.ok) set[key] = p.value
    else fieldErrors.push({ key, message: p.error })
  }
  if (fieldErrors.length) return { ok: false, code: 'CONFIG_INVALID', error: CONFIG_MESSAGES.CONFIG_INVALID, fieldErrors }

  const commandId = randomUUID()
  const readRevision = async (): Promise<number | { ok: false; code: 'CONFIG_UNAVAILABLE'; error: string }> => {
    const { data, error } = await admin.from('project_settings').select('revision').eq('project_id', projectId).maybeSingle()
    if (error) {
      // 원인(DB 원문)은 로그로, 결과에는 고정 문구만 — 호출부가 응답에 그대로 실어도 원문이 새지 않는다
      console.error('[settings/write] revision 판독 실패', { projectId, cause: error.message })
      return { ok: false, code: 'CONFIG_UNAVAILABLE', error: ERR_CONFIG_UNAVAILABLE }
    }
    if (!data) return { ok: false, code: 'CONFIG_UNAVAILABLE', error: `${ERR_CONFIG_UNAVAILABLE} (설정 행 없음: ${projectId})` }
    return Number((data as { revision: number | string }).revision)
  }
  const digest = commandDigestInput(set, unset)
  for (let attempt = 0; attempt < 2; attempt++) {
    const rev = await readRevision()
    if (typeof rev !== 'number') return rev
    const { data, error } = await admin.rpc('apply_project_settings', {
      p_project_id: projectId, p_expected_revision: rev, p_command_id: commandId,
      p_set: digest.set, p_unset: digest.unset, p_actor: actorUserId, p_schema_version: SETTINGS_SCHEMA_VERSION, p_source: 'internal',
    })
    if (!error) {
      const r = data as { status: 'applied' | 'duplicate'; revision: number | string }
      return { ok: true, status: r.status, revision: Number(r.revision), commandId }
    }
    const mapped = mapDbError(error)
    if (mapped?.code === 'CONFIG_CONFLICT' && attempt === 0) continue        // 한 번만 다시 읽어 재시도
    if (!mapped) throw new Error(`[settings/write] 알 수 없는 DB 오류: ${error.message}`)   // 표에 없는 토큰은 드러낸다(500)
    return { ok: false, code: mapped.code, error: mapped.message }
  }
  throw new Error('[settings/write] unreachable')
}

/**
 * 워크스페이스 설정의 내부 쓰기 — 가드가 없다(호출부가 requireSuperuser·requireWorkspaceAdmin 뒤에 부른다, 호출자 닫힘).
 * 프로젝트 쪽과 같은 순서다: 모르는 키 거부 → 늘 명시 키의 unset 거부 → parse → 방금 읽은 revision 으로 CAS(충돌이면 한 번 다시 읽는다).
 * 표·RPC 이름을 리터럴로 두려고(게이트가 조립한 이름을 막는다) 프로젝트 함수와 본문을 나누지 않고 따로 적었다.
 */
export async function writeWorkspaceSettingsInternal(
  admin: AdminClient, workspaceId: string, change: SettingsChange, actorUserId: string | null,
): Promise<InternalWriteResult> {
  const rawSet = change.set ?? {}
  const unset = [...new Set(change.unset ?? [])].sort()
  const fieldErrors: { key: string; message: string }[] = []
  const set: Record<string, unknown> = {}
  for (const key of [...Object.keys(rawSet), ...unset]) {
    if (!settingDef('workspace', key)) return { ok: false, code: 'CONFIG_UNKNOWN_KEY', error: `${CONFIG_MESSAGES.CONFIG_UNKNOWN_KEY}: ${key}` }
  }
  for (const key of unset) if (key in rawSet) return { ok: false, code: 'CONFIG_INVALID', error: `${CONFIG_MESSAGES.CONFIG_INVALID}: ${key} — set 과 unset 에 같이 있습니다.` }
  for (const key of unset) {
    if (settingDef('workspace', key)!.explicit) return { ok: false, code: 'CONFIG_INVALID', error: `${CONFIG_MESSAGES.CONFIG_INVALID}: ${key} — ${ERR_EXPLICIT_UNSET}`, fieldErrors: [{ key, message: ERR_EXPLICIT_UNSET }] }
  }
  for (const [key, raw] of Object.entries(rawSet)) {
    const p = settingDef('workspace', key)!.parse(raw)
    if (p.ok) set[key] = p.value
    else fieldErrors.push({ key, message: p.error })
  }
  if (fieldErrors.length) return { ok: false, code: 'CONFIG_INVALID', error: CONFIG_MESSAGES.CONFIG_INVALID, fieldErrors }

  const commandId = randomUUID()
  const digest = commandDigestInput(set, unset)
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: row, error: readErr } = await admin.from('workspace_settings').select('revision').eq('workspace_id', workspaceId).maybeSingle()
    if (readErr) {
      // 원인(DB 원문)은 로그로, 결과에는 고정 문구만
      console.error('[settings/write] 워크스페이스 revision 판독 실패', { workspaceId, cause: readErr.message })
      return { ok: false, code: 'CONFIG_UNAVAILABLE', error: ERR_CONFIG_UNAVAILABLE }
    }
    if (!row) return { ok: false, code: 'CONFIG_UNAVAILABLE', error: `${ERR_CONFIG_UNAVAILABLE} (설정 행 없음: ${workspaceId})` }
    const { data, error } = await admin.rpc('apply_workspace_settings', {
      p_workspace_id: workspaceId, p_expected_revision: Number((row as { revision: number | string }).revision), p_command_id: commandId,
      p_set: digest.set, p_unset: digest.unset, p_actor: actorUserId, p_schema_version: SETTINGS_SCHEMA_VERSION, p_source: 'internal',
    })
    if (!error) {
      const r = data as { status: 'applied' | 'duplicate'; revision: number | string }
      return { ok: true, status: r.status, revision: Number(r.revision), commandId }
    }
    const mapped = mapDbError(error)
    if (mapped?.code === 'CONFIG_CONFLICT' && attempt === 0) continue        // 한 번만 다시 읽어 재시도
    if (!mapped) throw new Error(`[settings/write] 알 수 없는 DB 오류: ${error.message}`)   // 표에 없는 토큰은 드러낸다(500)
    return { ok: false, code: mapped.code, error: mapped.message }
  }
  throw new Error('[settings/write] unreachable')
}
