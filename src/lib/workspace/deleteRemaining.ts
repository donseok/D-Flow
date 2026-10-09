// 워크스페이스 삭제가 거부됐을 때 "무엇이 남아 있는지" — delete_empty_workspace RPC(0055)의 remaining(표 이름 → 행 수)을 화면의 항목으로 바꾼다. 순수.
// RPC 는 workspaces 를 참조하는 표를 카탈로그에서 훑으므로 이 표에 없는 이름도 올 수 있다(새로 생긴 참조 표) — 그때는 'other' 로 묶고 표 이름을 함께 보인다
// (플랫폼 관리자의 화면이다 — 무엇이 막는지 알아야 치울 수 있다). 문구는 사전(platform.ws.remaining.<key>).

/** 화면이 이름을 아는 항목 — 보이는 순서대로 */
export const WORKSPACE_REMAINING_KEYS = [
  'projects', 'members', 'people', 'teams', 'minutes', 'minute_folders', 'invites', 'credentials',
  'notifications', 'ai_index', 'agent_watchers', 'receipts', 'files',
] as const
export type WorkspaceRemainingKey = (typeof WORKSPACE_REMAINING_KEYS)[number]
export interface WorkspaceRemainingItem {
  key: WorkspaceRemainingKey | 'other'
  count: number
  /** key 가 other 일 때만 — 표 이름(영문 식별자) */
  table?: string
}

const TABLE_KEY: Readonly<Record<string, WorkspaceRemainingKey>> = {
  projects: 'projects',
  workspace_members: 'members',
  people: 'people',
  teams: 'teams',
  minutes: 'minutes',
  minute_folders: 'minute_folders',
  project_invites: 'invites',
  integration_credentials: 'credentials',
  notification_events: 'notifications',
  ai_documents: 'ai_index',
  ai_index_jobs: 'ai_index',
  agent_watchers: 'agent_watchers',
  command_receipts: 'receipts',
  'storage.objects': 'files',
}
/** 표 이름으로 화면에 내보낼 만한 글자만(영소문자·숫자·밑줄·점) — 그 밖의 값은 버린다 */
const TABLE_NAME = /^[a-z_][a-z0-9_.]{0,62}$/

/**
 * RPC 의 remaining → 화면 항목. 아는 표는 항목 순서대로(같은 항목의 표는 합친다), 모르는 표는 그 뒤에 이름 순으로.
 * 형태가 어긋난 값(객체가 아님·음수·수가 아님)은 null — 호출부는 "남은 것 없음"으로 읽지 않고 실패로 다룬다.
 */
export function workspaceRemainingItems(raw: unknown): WorkspaceRemainingItem[] | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const known = new Map<WorkspaceRemainingKey, number>()
  const other: WorkspaceRemainingItem[] = []
  for (const [table, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
    if (value === 0) continue
    const key = Object.hasOwn(TABLE_KEY, table) ? TABLE_KEY[table] : null
    if (key) known.set(key, (known.get(key) ?? 0) + value)
    else if (TABLE_NAME.test(table)) other.push({ key: 'other', count: value, table })
    else return null
  }
  other.sort((a, b) => a.table!.localeCompare(b.table!))
  return [...WORKSPACE_REMAINING_KEYS.filter((k) => known.has(k)).map((k) => ({ key: k, count: known.get(k)! })), ...other]
}
