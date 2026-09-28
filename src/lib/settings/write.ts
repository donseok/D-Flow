/**
 * 서버 내부 쓰기(스펙 §3.3) — 세션 액션이 아닌 경로(가져오기 프로파일 저장 W5, 에이전트 레벨 시드 W6, Phase B 의 옛 에이전트 토글)의
 * 유일한 쓰기 함수. 서버가 계산한 저장 형태를 parse 만 거쳐 RPC 에 넘긴다(개정 §2.3.1 4단계 끝). 방금 읽은 revision 으로 CAS 하고
 * 충돌이면 한 번 다시 읽어 같은 명령 id 로 재시도한다. 교차 불변식(validateConfig)은 여기서 돌리지 않는다 — 호출부가 필요하면 먼저 돈다.
 * `from('project_settings')` 는 revision 판독뿐이다(tests/invariants/settings-writes.test.ts 허용 목록).
 */
import { randomUUID } from 'node:crypto'
import type { AdminClient } from '@/lib/supabase/adminFor'
import { SETTINGS_SCHEMA_VERSION, settingDef } from './registry'
import { CONFIG_MESSAGES, ERR_CONFIG_UNAVAILABLE, mapDbError, type ConfigCode } from './errors'

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
