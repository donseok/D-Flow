import type { StageCode } from './stageLabels'

export type BulkFieldMode<T> = { mode: 'unchanged' } | { mode: 'set'; value: T } | { mode: 'clear' }
export interface WbsBulkChanges {
  plannedStart?: BulkFieldMode<string>
  plannedEnd?: BulkFieldMode<string>
  deliverable?: BulkFieldMode<string>
  biz?: BulkFieldMode<string>
  stage?: BulkFieldMode<StageCode | 'none'>
  assigneeMemberId?: BulkFieldMode<string>
  teamCode?: BulkFieldMode<string>
}
export interface WbsBulkTarget { id: string; updatedAt: string | null }
export interface WbsBulkSnapshotRow extends WbsBulkTarget {
  name: string; plannedStart: string | null; plannedEnd: string | null
  deliverable: string | null; biz: string | null; stage: string | null
  assigneeMemberId: string | null; teamCode: string | null
}
export interface WbsBulkFailedItem {
  itemId: string; name?: string
  reason: 'permission' | 'conflict' | 'validation' | 'unknown'
  message: string
}
export interface WbsBulkResult { ok: boolean; error?: string; total: number; succeeded: string[]; failed: WbsBulkFailedItem[] }
