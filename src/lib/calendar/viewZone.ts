// 전역 화면(세션 유일 워크스페이스 — requireModulePage(null, …) 경로)의 시간대(스펙 SP5 D36, 계획 D-21c, A-3 리뷰 수정 M3).
// 소속 워크스페이스가 하나면 그 calendar.timezone, 여럿이면 달력이 모두 같을 때 그 tz, 다르거나 없으면 제품 기본값 UTC — 화면이 그
// 사실을 적어 다르지 않게 한다(봇 스트림의 요청 범위 달력과 같은 판정). 하나뿐인 소속의 달력 손상은
// ok:false(UTC 로 대체하지 않는다)·설정 조회 실패는 ConfigUnavailableError throw 그대로(페이지의 error 경계). 여럿 중 하나의 실패는
// '다름' — UTC + 로그(A-4 리뷰 N2). 결과의 basis 가 differs·unreadable 이면 페이지가 ViewBasisNotice 로 '기준 시간대' 한 줄을 그린다(A-5 리뷰 O2).
import 'server-only'
import type { Actor } from '@/lib/domain/authz'
import type { RequestCalendar } from '@/lib/domain/calendar'
import { DEFAULT_REQUEST_CALENDAR, resolveMemberWorkspacesCalendarBasis, type MemberCalendarBasis } from '@/lib/calendar/load'
import { ConfigKeyError } from '@/lib/settings/errors'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'

export async function viewTimezone(
  actor: Actor | null, opts?: { client?: ConfigReadClient },
): Promise<{ ok: true; timeZone: string; basis: MemberCalendarBasis } | { ok: false; error: string; key: string }> {
  const r = await viewCalendar(actor, opts)
  return r.ok ? { ok: true, timeZone: r.calendar.timezone, basis: r.basis } : r
}

/** viewTimezone 과 같은 판정의 달력 한 벌(tz·근무 요일·주 규칙) — 전역 달력 화면(내 회의·회의록)의 첫 열·쉬는 날(과제 24).
 *  워크스페이스 달력에는 날짜 예외가 없다(D36) */
export async function viewCalendar(
  actor: Actor | null, opts?: { client?: ConfigReadClient },
): Promise<{ ok: true; calendar: RequestCalendar; basis: MemberCalendarBasis } | { ok: false; error: string; key: string }> {
  if (!actor) return { ok: true, calendar: DEFAULT_REQUEST_CALENDAR, basis: 'none' }
  try {
    return { ok: true, ...await resolveMemberWorkspacesCalendarBasis([...actor.workspaceRoles.keys()], opts) }
  } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, error: e.message, key: e.key }
    throw e
  }
}
