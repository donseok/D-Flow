// 저장 규칙(개정 §2.7.3 세 갈래)과 modules.enabled 검사(개정 §2.7.2) — validateConfig(설정 저장)와 createProject 복사가 같은 함수를 쓴다.
import type { Parsed } from '@/lib/settings/def'
import { CORE_MODULES, PROJECT_TOGGLABLE, type ModuleId } from './defaults'
import { missingRequires } from './closure'
import { moduleDef } from './registry'

export type ModuleKeyRule = 'always' | 'prepared' | 'not_allowed'

/** 키 소유 모듈의 상태 → 저장 허용. enabled 가 null 이면 워크스페이스 층(프로젝트 토글 없음).
 *  env 가용은 호출자가 allowed 를 만들 때 이미 걸러 넘긴다(허용 ∧ env 가용 = allowed — validateConfig 의 availableOf). */
export function moduleKeyRule(input: { module: ModuleId; allowed: ReadonlySet<ModuleId>; enabled: ReadonlySet<ModuleId> | null }): ModuleKeyRule {
  const { module, allowed, enabled } = input
  if (CORE_MODULES.includes(module)) return 'always'
  if (!allowed.has(module)) return 'not_allowed'
  if (enabled === null || !PROJECT_TOGGLABLE.has(module) || enabled.has(module)) return 'always'
  return 'prepared'
}

/** 복사 경로 — 원본의 enabled 를 대상 워크스페이스의 allowed 와 교집합(순서 유지) */
export function intersectEnabledWithAllowed(enabled: readonly ModuleId[], allowed: readonly ModuleId[]): ModuleId[] {
  return enabled.filter((id) => allowed.includes(id))
}

/**
 * modules.enabled 의 세 검사 — 원소는 PROJECT_TOGGLABLE·유일, 새로 추가된 id(next − prev)는 allowed 에 속함(allowed 는 워크스페이스
 * 허용 그대로 — env 무관, 스펙 §4.1), requires 닫힘은
 * CORE ∪ (allowed 의 워크스페이스 층) ∪ (next ∩ allowed) 안에서 본다. prev 가 null 이면 생성(전부 새 id). 자동 추가는 하지 않는다.
 */
export function checkEnabledModules(input: { next: readonly ModuleId[]; prev: readonly ModuleId[] | null; allowed: readonly ModuleId[] }): Parsed<ModuleId[]> {
  const { next, prev, allowed } = input
  for (const id of next) {
    if (!PROJECT_TOGGLABLE.has(id)) return { ok: false, error: `프로젝트에서 켜고 끌 수 없는 모듈입니다: ${id}` }
  }
  if (new Set(next).size !== next.length) return { ok: false, error: '모듈이 중복됩니다.' }
  const added = next.filter((id) => !(prev ?? []).includes(id))
  const notAllowed = added.filter((id) => !allowed.includes(id))
  if (notAllowed.length) return { ok: false, error: `워크스페이스가 허용하지 않은 모듈입니다: ${notAllowed.join(', ')}` }
  const wsLayer = allowed.filter((id) => !PROJECT_TOGGLABLE.has(id))
  const candidate = new Set<ModuleId>([...CORE_MODULES, ...wsLayer, ...intersectEnabledWithAllowed(next, allowed)])
  const missing = missingRequires(candidate, (id) => moduleDef(id).requires).filter((m) => next.includes(m.id))
  if (missing.length) {
    return { ok: false, error: missing.map((m) => `${m.id} 모듈은 ${m.missing.join(', ')} 모듈이 필요합니다`).join('; ') }
  }
  return { ok: true, value: [...next] }
}
