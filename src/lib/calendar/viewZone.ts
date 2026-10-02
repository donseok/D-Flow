// 전역 화면(세션 유일 워크스페이스 — requireModulePage(null, …) 경로)의 시간대(스펙 SP5 D36, 계획 D-21c, A-3 리뷰 수정 M3).
// 소속 워크스페이스가 하나면 그 calendar.timezone, 여럿이면 달력이 모두 같을 때 그 tz, 다르거나 없으면 제품 기본값 UTC — 화면이 그
// 이름을 적어 사실과 다르지 않게 한다(봇 스트림의 요청 범위 달력과 같은 resolveMemberWorkspacesCalendar). 워크스페이스 달력 손상은
// ok:false(UTC 로 대체하지 않는다). 설정 조회 실패는 ConfigUnavailableError throw 그대로 — 페이지의 error 경계가 받는다.
import 'server-only'
import type { Actor } from '@/lib/domain/authz'
import { DEFAULT_TIMEZONE } from '@/lib/domain/calendar'
import { resolveMemberWorkspacesCalendar } from '@/lib/calendar/load'
import { ConfigKeyError } from '@/lib/settings/errors'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'

export async function viewTimezone(
  actor: Actor | null, opts?: { client?: ConfigReadClient },
): Promise<{ ok: true; timeZone: string } | { ok: false; error: string; key: string }> {
  if (!actor) return { ok: true, timeZone: DEFAULT_TIMEZONE }
  try {
    return { ok: true, timeZone: (await resolveMemberWorkspacesCalendar([...actor.workspaceRoles.keys()], opts)).timezone }
  } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, error: e.message, key: e.key }
    throw e
  }
}
