import type { Parsed } from '@/lib/settings/def'

/** Stable ids keep values attached to an item when its name or position changes. */
export interface WeeklyColumn { id: string; label: string; carryOver: boolean }
export const WEEKLY_COLUMNS_MAX = 12
export const DEFAULT_WEEKLY_COLUMNS: WeeklyColumn[] = [
  { id: 'content', label: '내용', carryOver: true },
  { id: 'issue', label: '이슈 및 주요 이벤트', carryOver: true },
]
export function parseWeeklyColumns(raw: unknown): Parsed<WeeklyColumn[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > WEEKLY_COLUMNS_MAX)
    return { ok: false, error: `항목은 1~${WEEKLY_COLUMNS_MAX}개로 구성해 주세요.` }
  const ids = new Set<string>(), labels = new Set<string>()
  const value: WeeklyColumn[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(k => !['id', 'label', 'carryOver'].includes(k))
      || typeof item.id !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(item.id) || ids.has(item.id)
      || typeof item.label !== 'string' || !item.label.trim() || Array.from(item.label.trim()).length > 40
      || typeof item.carryOver !== 'boolean') return { ok: false, error: '항목 이름은 1~40자이며 항목 ID는 고유해야 합니다.' }
    const label = item.label.trim()
    if (labels.has(label)) return { ok: false, error: '항목 이름이 중복됩니다.' }
    ids.add(item.id); labels.add(label)
    value.push({ id: item.id, label, carryOver: item.carryOver })
  }
  return { ok: true, value }
}
export type WeeklyColumnKey = `this_${string}` | `next_${string}`
export function weeklyColumnKeys(columns: readonly WeeklyColumn[]): WeeklyColumnKey[] {
  return (['this', 'next'] as const).flatMap(side => columns.map(c => `${side}_${c.id}` as WeeklyColumnKey))
}
export function weeklyColumnLabels(columns: readonly WeeklyColumn[]): Record<WeeklyColumnKey, string> {
  return Object.fromEntries((['this', 'next'] as const).flatMap(side => columns.map(c => [
    `${side}_${c.id}`, `${side === 'this' ? '금주실적' : '차주계획'} ${c.label}`,
  ]))) as Record<WeeklyColumnKey, string>
}
/** Read JSON values defensively; never spread structural columns supplied by a payload. */
export function weeklyValues(raw: unknown): Partial<Record<WeeklyColumnKey, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => /^(this|next)_[a-z][a-z0-9_]{0,31}$/.test(k) && typeof v === 'string'))
}
