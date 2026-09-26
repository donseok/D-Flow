// presence 토픽 규약(SP2 §3.3) — realtime.messages 정책(0007)이 같은 정규식으로 pid 를 뽑아 can_read_project 로 판정한다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_KEY = /^[a-z0-9-]{1,40}$/
export const PRESENCE_TOPIC_RE =
  /^project-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?:presence-[a-z0-9-]{1,40}|weekly-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-presence)$/

export function pagePresenceTopic(projectId: string, pageKey: string): string {
  if (!UUID.test(projectId) || !PAGE_KEY.test(pageKey)) throw new Error('presence 토픽 입력이 올바르지 않습니다.')
  return `project-${projectId.toLowerCase()}-presence-${pageKey}`
}

export function weeklyPresenceTopic(projectId: string, reportId: string): string {
  if (!UUID.test(projectId) || !UUID.test(reportId)) throw new Error('presence 토픽 입력이 올바르지 않습니다.')
  return `project-${projectId.toLowerCase()}-weekly-${reportId.toLowerCase()}-presence`
}
