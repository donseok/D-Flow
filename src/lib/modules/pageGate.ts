/**
 * 페이지 관문(스펙 §4.2 1·2행, D11) — page.tsx 첫머리(권한 redirect 다음, 데이터 로더·Promise.all 앞)에서 await 한다. 꺼지면 notFound().
 * 레이아웃에 넣지 않는다 — 레이아웃은 경로 조각을 모르고, 레이아웃의 notFound() 는 페이지 로더를 멈추지 못한다(E13).
 * scope 가 null 이면 범위를 모른다 — core 모듈만 통과하고 나머지는 notFound 다(SP7 — 행위자의 소속 워크스페이스로 짐작하지 않는다. 페이지 호출부는
 * 없다 — 전역 페이지는 SP3b UI-2a 에서 /w/[slug]/** 로 옮겨 { workspaceId } 를 넘기고, module-page-gates 불변식이 행 없는 페이지에 { workspaceId } 를 요구한다).
 * tests/invariants/module-page-gates.test.ts 가 src/app 의 모든 page.tsx 를 본다.
 *
 * 프로젝트 범위({ projectId })는 모듈 판정과 함께 **프로젝트 화면 숨김을 다시 판정한다**(UI-2b 최종 리뷰 GG1). 레이아웃의 notFound 는 병렬 렌더되는
 * 페이지 로더를 멈추지 못해 404 응답의 RSC 페이로드에 본문이 실린다(라이브 확인: 명단 밖 멤버의 /p/<비공개>/wbs 404 HTML 에 WBS 행). 모든 프로젝트
 * 페이지가 로더보다 먼저 부르는 이 관문이 그 재판정 자리다. 판정자는 레이아웃과 같다(isHiddenProject + getHiddenProjectIds — 요청 캐시라 레이아웃과
 * 왕복을 나누고, 모듈 판정과 병렬이다). 숨김 → notFound(모듈 꺼짐과 같은 404 — 존재 오라클 없음), 판정 실패 → 던짐(오류 경계),
 * 열화 → 공개면 통과(레이아웃의 최소 셸과 같다), 비공개면 명단을 모르므로 던진다.
 */
import { notFound } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { isHiddenProject } from '@/lib/domain/authz'
import type { ModuleId } from './defaults'
import { requireModule, requireSessionModule, type ModuleScope } from './gate'

export async function requireModulePage(scope: ModuleScope | null, moduleId: ModuleId | readonly ModuleId[]): Promise<void> {
  if (scope !== null && 'projectId' in scope) {
    const [r, hidden] = await Promise.all([requireModule(scope, moduleId), projectPageHidden(scope.projectId)])
    if (hidden || !r.ok) notFound()
    return
  }
  const r = scope === null ? await requireSessionModule(null, moduleId) : await requireModule(scope, moduleId)
  if (!r.ok) notFound()
}

/** 프로젝트 화면 숨김(레이아웃과 같은 판정자). 비공개 판정 실패·열화의 비공개는 던진다 — 404 로 위장하지 않는다 */
async function projectPageHidden(projectId: string): Promise<boolean> {
  const [{ actor, degraded }, hidden] = await Promise.all([getActorViewState(), getHiddenProjectIds()])
  if (degraded) {
    if (hidden.has(projectId)) throw new Error('권한 조회가 실패해 비공개 프로젝트의 명단을 판정하지 못했습니다')
    return false
  }
  return isHiddenProject(actor, projectId, hidden)
}
