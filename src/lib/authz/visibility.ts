import { cache } from 'react'
import { createServerClient } from '../supabase/server'
import { getActorForView } from './index'
import { canSeeProject } from '../domain/authz'

/**
 * 현재 사용자에게 숨겨야 하는 비공개 프로젝트(0070) id 집합 — 회의록 달력·검색·탐색기처럼
 * 프로젝트 경계를 넘는 목록 표면이 항목 단위로 거를 때 쓴다.
 *
 * 비공개는 노출 억제(UI 숨김)지 RLS 경계가 아니다(설계 2026-08-10). 그래서 규칙은 하나다 — 포털(portal.ts visibleProjectIds)과 같다:
 * 명단 밖이면 숨기고, **조회가 실패하면 막는다(fail-closed)**. 예전에는 실패하면 빈 집합(= 전부 보임)으로 진행했다 —
 * 숨길 것을 못 숨기느니 막는다(UI-2a 최종 수정 FA1). 호출부는 던짐을 자기 실패 관례(null·빈 결과·500)로 돌려준다.
 * 권한 조회가 열화(actor null)면 비공개는 전부 숨는다(canSeeProject).
 */
export class HiddenProjectsUnavailableError extends Error {
  constructor() { super('비공개 프로젝트 판정을 하지 못했습니다') }
}

export const getHiddenProjectIds = cache(async (): Promise<ReadonlySet<string>> => {
  const sb = await createServerClient()
  const [{ data, error }, actor] = await Promise.all([
    sb.from('projects').select('id, is_private').eq('is_private', true),
    getActorForView(),
  ])
  if (error) {
    console.error('[getHiddenProjectIds] 비공개 프로젝트 조회 실패 — 막는다(fail-closed):', error.message)
    throw new HiddenProjectsUnavailableError()
  }
  return new Set((data ?? [])
    .filter(p => !canSeeProject(actor, p as { id: string; is_private?: boolean | null }))
    .map(p => p.id as string))
})
