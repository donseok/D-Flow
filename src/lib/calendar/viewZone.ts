// 전역 화면(세션 유일 워크스페이스 — requireModulePage(null, …) 경로)의 시간대(스펙 SP5 D36, 계획 D-21c).
// 유일한 워크스페이스가 있으면 그 calendar.timezone, 없거나 여럿이면(플랫폼 관리자 등) 제품 기본값 UTC — 화면이 그 이름을 적어
// 사실과 다르지 않게 한다. 워크스페이스 달력 손상은 ok:false(UTC 로 대체하지 않는다). 설정 조회 실패는 ConfigUnavailableError
// throw 그대로 — 페이지의 error 경계가 받는다.
import 'server-only'
import type { Actor } from '@/lib/domain/authz'
import { DEFAULT_TIMEZONE } from '@/lib/domain/calendar'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'
import { pickCalendar } from '@/lib/settings/pick'

export async function viewTimezone(
  actor: Actor | null, opts?: { client?: ConfigReadClient },
): Promise<{ ok: true; timeZone: string } | { ok: false; error: string; key: string }> {
  if (!actor) return { ok: true, timeZone: DEFAULT_TIMEZONE }
  const sole = resolveSoleWorkspaceId(actor)
  if (!sole.ok) return { ok: true, timeZone: DEFAULT_TIMEZONE }
  const p = pickCalendar(await getWorkspaceConfig(sole.workspaceId, opts))
  return p.ok ? { ok: true, timeZone: p.calendar.timezone } : { ok: false, error: p.error, key: p.key }
}
