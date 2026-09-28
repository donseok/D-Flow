/**
 * 페이지 관문(스펙 §4.2 1·2행, D11) — page.tsx 첫머리(권한 redirect 다음, 데이터 로더·Promise.all 앞)에서 await 한다. 꺼지면 notFound().
 * 레이아웃에 넣지 않는다 — 레이아웃은 경로 조각을 모르고, 레이아웃의 notFound() 는 페이지 로더를 멈추지 못한다(E13).
 * scope 가 null 이면 대상 행이 없는 전역 페이지(/meetings·/minutes·/agents·/portfolio·/usage) — 세션 행위자의 유일 워크스페이스로 판정한다.
 * tests/invariants/module-page-gates.test.ts 가 src/app 의 모든 page.tsx 를 본다.
 */
import { notFound } from 'next/navigation'
import type { ModuleId } from './defaults'
import { requireModule, requireSessionModule, type ModuleScope } from './gate'

export async function requireModulePage(scope: ModuleScope | null, moduleId: ModuleId | readonly ModuleId[]): Promise<void> {
  const r = scope === null ? await requireSessionModule(null, moduleId) : await requireModule(scope, moduleId)
  if (!r.ok) notFound()
}
