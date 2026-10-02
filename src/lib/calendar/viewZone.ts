// 워크스페이스 화면(/w/[slug]/… — 회의 일정·회의록·포트폴리오·에이전트 현황·전체 프로젝트)의 달력(스펙 SP5 D36, 계획 D-21c·D-22b).
// 화면이 워크스페이스 하나로 거르므로(UI-2 — 슬러그 워크스페이스) 달력 출처도 그 워크스페이스 하나다: calendar 세 키(tz·근무 요일·주 시작).
// 행위자의 소속 워크스페이스들로 정하지 않는다 — 그러면 두 워크스페이스 소속자가 /w/A/… 에서 A 의 달력 대신 다중 소속 폴백(UTC·일요일)을
// 본다(merge 뒤 판정, a6-fix-brief "rebase 때 반드시 할 것"). 그래서 '기준 시간대' 폴백 줄도 이 화면들에는 없다.
// 그 워크스페이스의 달력 손상은 ok:false(UTC 로 대체하지 않는다 — 페이지가 ConfigLoadError 로 사유를 그린다)·설정 조회 실패는
// ConfigUnavailableError throw 그대로(페이지의 error 경계). 워크스페이스 달력에는 날짜 예외가 없다(D36).
import 'server-only'
import type { RequestCalendar } from '@/lib/domain/calendar'
import { resolveRequestCalendar } from '@/lib/calendar/load'
import { ConfigKeyError } from '@/lib/settings/errors'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'

export type ViewCalendarResult = { ok: true; calendar: RequestCalendar } | { ok: false; error: string; key: string }

/** 화면 워크스페이스의 달력 한 벌 — 달력 화면(회의 일정·회의록)의 '오늘'·첫 열·쉬는 날 */
export async function viewCalendar(workspaceId: string, opts?: { client?: ConfigReadClient }): Promise<ViewCalendarResult> {
  try {
    return { ok: true, calendar: await resolveRequestCalendar({ projectId: null, workspaceId }, opts) }
  } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, error: e.message, key: e.key }
    throw e
  }
}

/** 화면 워크스페이스의 tz — 시각·'오늘'만 쓰는 화면(포트폴리오·에이전트 현황·전체 프로젝트). viewCalendar 와 같은 판정 */
export async function viewTimezone(
  workspaceId: string, opts?: { client?: ConfigReadClient },
): Promise<{ ok: true; timeZone: string } | { ok: false; error: string; key: string }> {
  const r = await viewCalendar(workspaceId, opts)
  return r.ok ? { ok: true, timeZone: r.calendar.timezone } : r
}
