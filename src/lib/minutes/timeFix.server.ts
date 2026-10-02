import 'server-only'
import { resolveRequestCalendar } from '@/lib/calendar/load'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'

/** 회의록 범위의 tz(스펙 SP5 D13 ④) — 프로젝트 회의록은 프로젝트, 무프로젝트는 워크스페이스. 실패는 throw(서울로 대체하지 않는다) */
export async function minuteScopeTimezone(
  scope: { projectId: string | null; workspaceId: string }, opts?: { client?: ConfigReadClient },
): Promise<string> {
  return (await resolveRequestCalendar({ projectId: scope.projectId, workspaceId: scope.workspaceId }, opts)).timezone
}
