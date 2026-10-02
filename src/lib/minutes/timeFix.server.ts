import 'server-only'
import { resolveRequestCalendar } from '@/lib/calendar/load'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'
import { correctMinuteBodyTime, needsTimeFix, type MinuteTimeFix } from './timeFix'

/** 보정을 건너뛴 사유 — 화면이 경고 토스트로 보인다(업로드는 통과) */
export type TimeFixWarning = 'invalid_time' | 'calendar_unavailable'

/** 회의록 범위의 tz(스펙 SP5 D13 ④) — 프로젝트 회의록은 프로젝트, 무프로젝트는 워크스페이스. 실패는 throw(서울로 대체하지 않는다) */
export async function minuteScopeTimezone(
  scope: { projectId: string | null; workspaceId: string }, opts?: { client?: ConfigReadClient },
): Promise<string> {
  return (await resolveRequestCalendar({ projectId: scope.projectId, workspaceId: scope.workspaceId }, opts)).timezone
}

/**
 * 업로드·본문 교체의 녹취 보정 한 길(A-4 리뷰 N4) — 보정은 업로드를 막지 않는다. 보정 대상(서명 + 시간 줄)일 때만 범위 달력을 읽고,
 * 못 읽으면 보정만 건너뛰고 경고(원문 그대로 — 로그). 시각이 범위 밖이면 원문 그대로 + 경고. 서울·UTC 로 대체해 보정하지 않는다.
 */
export async function applyScopeTimeFix(
  bodyMd: string, scope: { projectId: string | null; workspaceId: string }, fallbackDate: string, opts?: { client?: ConfigReadClient },
): Promise<{ fix: MinuteTimeFix; warning?: TimeFixWarning }> {
  const body = bodyMd ?? ''
  if (!needsTimeFix(body)) return { fix: { body, corrected: false } }
  let timeZone: string
  try { timeZone = await minuteScopeTimezone(scope, opts) } catch (e) {
    console.error('[minutes] 녹취 보정 건너뜀 — 회의록 범위 달력을 읽지 못했다', { ...scope, cause: String(e) })
    return { fix: { body, corrected: false }, warning: 'calendar_unavailable' }
  }
  const fix = correctMinuteBodyTime(body, { timeZone, fallbackDate })
  return fix.skipped ? { fix, warning: fix.skipped } : { fix }
}
