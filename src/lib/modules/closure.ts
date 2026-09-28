// requires 닫힘(정본 §3.2.3) — 뺄 뿐 더하지 않는다. 순수. 레지스트리를 import 하지 않고 requiresOf 를 받는다(saveRule·effective 가 같은 함수를 쓴다).
import type { ModuleId } from './defaults'

export function closeRequires(ids: ReadonlySet<ModuleId>, requiresOf: (id: ModuleId) => readonly ModuleId[]): ReadonlySet<ModuleId> {
  const out = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    for (const id of out) {
      if (requiresOf(id).some((r) => !out.has(r))) { out.delete(id); changed = true }
    }
  }
  return out
}

/** 닫힘에서 빠질 모듈과 그 이유 — 저장 검증이 "칸반은 WBS 모듈이 필요합니다" 류 문구를 만들 때 쓴다 */
export function missingRequires(ids: ReadonlySet<ModuleId>, requiresOf: (id: ModuleId) => readonly ModuleId[]): { id: ModuleId; missing: ModuleId[] }[] {
  const closed = closeRequires(ids, requiresOf)
  const out: { id: ModuleId; missing: ModuleId[] }[] = []
  for (const id of ids) {
    if (closed.has(id)) continue
    out.push({ id, missing: requiresOf(id).filter((r) => !closed.has(r)) })
  }
  return out
}
