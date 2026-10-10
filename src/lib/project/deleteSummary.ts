// 프로젝트 삭제(0058) — project_delete_summary·delete_project 가 돌려주는 jsonb 의 판독. 순수 모듈(화면·액션·테스트가 같이 쓴다).
// 모르는 모양은 지어내지 않는다 — 건수 하나라도 읽지 못하면 null 이고 호출부는 삭제를 열지 않는다(조회 실패를 "0건"으로 위장하지 않는다).

/** 함께 지워지는 것의 건수 — 키는 RPC 의 removed 와 같다(표시 순서도 이 순서) */
export const PROJECT_DELETE_COUNT_KEYS = [
  'wbs_items', 'issues', 'weekly_reports', 'meetings', 'wiki_items', 'wiki_topics', 'announcements', 'attendance_records',
  'project_members', 'teams', 'form_templates', 'attachments',
] as const
export type ProjectDeleteCountKey = (typeof PROJECT_DELETE_COUNT_KEYS)[number]
export type ProjectDeleteCounts = Record<ProjectDeleteCountKey, number>

export interface ProjectDeleteSummary {
  /** 삭제를 막는 회의록 수(보관된 것 포함) — 0 이어야 지울 수 있다 */
  minutes: number
  /** 그 가운데 보관된 회의록 — 옮길 수 없다 */
  minutesArchived: number
  counts: ProjectDeleteCounts
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null)

/** removed({표: 건수}) → 건수 표. 키가 하나라도 빠지거나 수가 아니면 null */
export function readProjectDeleteCounts(raw: unknown): ProjectDeleteCounts | null {
  const o = obj(raw)
  if (!o) return null
  const out = {} as ProjectDeleteCounts
  for (const key of PROJECT_DELETE_COUNT_KEYS) {
    const n = count(o[key])
    if (n === null) return null
    out[key] = n
  }
  return out
}

/** project_delete_summary 의 결과 → 요약. 읽지 못하면 null */
export function readProjectDeleteSummary(raw: unknown): ProjectDeleteSummary | null {
  const o = obj(raw)
  if (!o) return null
  const minutes = count(o.minutes)
  const minutesArchived = count(o.minutes_archived)
  const counts = readProjectDeleteCounts(o.removed)
  if (minutes === null || minutesArchived === null || counts === null || minutesArchived > minutes) return null
  return { minutes, minutesArchived, counts }
}

/** 프로젝트 파일이 놓이는 버킷 — 경로는 넷 모두 ws/<wid>/p/<pid>/… (src/lib/domain/storagePath.ts, 양식은 actions/formTemplates.ts) */
export const PROJECT_FILE_BUCKETS = ['deliverables', 'issue-attachments', 'minutes', 'form-templates'] as const
export type ProjectFileBucket = (typeof PROJECT_FILE_BUCKETS)[number]

/**
 * delete_project 의 referenced({버킷: 삭제 뒤에도 그 접두 아래 경로를 가리키는 행 수}) → 정리해도 되는 버킷.
 * 다른 프로젝트로 옮긴 회의록의 첨부는 경로가 옛 프로젝트 접두에 남는다 — 가리키는 행이 남은 버킷은 건드리지 않는다.
 * 읽지 못한 버킷도 건드리지 않는다(모르면 지우지 않는다).
 */
export function purgeableBuckets(referenced: unknown): { purge: ProjectFileBucket[]; kept: ProjectFileBucket[]; unknown: ProjectFileBucket[] } {
  const o = obj(referenced)
  const purge: ProjectFileBucket[] = []
  const kept: ProjectFileBucket[] = []
  const unknown: ProjectFileBucket[] = []
  for (const bucket of PROJECT_FILE_BUCKETS) {
    const n = o ? count(o[bucket]) : null
    if (n === null) unknown.push(bucket)
    else if (n === 0) purge.push(bucket)
    else kept.push(bucket)
  }
  return { purge, kept, unknown }
}
