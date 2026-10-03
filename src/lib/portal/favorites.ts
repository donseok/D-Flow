import { FAVORITES_MAX } from '@/lib/prefs/split'
/** 상한에서 새 별을 조용히 버리지 않고 켜기를 거부한다. 끄기는 항상 허용한다. */
export function toggleFavorite(list: readonly string[], id: string, max = FAVORITES_MAX): { ok: true; next: string[] } | { ok: false; reason: 'max' } {
  if (list.includes(id)) return { ok: true, next: list.filter(x => x !== id) }
  if (list.length >= max) return { ok: false, reason: 'max' }
  return { ok: true, next: [...list, id] }
}
