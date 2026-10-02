import { cache } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { createServerClient } from '../supabase/server'
import { getActorForView } from './index'
import { canSeeProject, type HiddenProjectIds } from '../domain/authz'
import { fetchAllPages } from '../data/paging'

/**
 * 현재 사용자에게 숨겨야 하는 비공개 프로젝트(0070) id 집합 — 회의록 달력·검색·탐색기처럼
 * 프로젝트 경계를 넘는 목록 표면이 항목 단위로 거를 때 쓴다.
 *
 * 비공개는 노출 억제(UI 숨김)지 RLS 경계가 아니다(설계 2026-08-10). 그래서 규칙은 하나다 — 포털(portal.ts visibleProjectIds)과 같다:
 * 명단 밖이면 숨기고, **조회가 실패하면 막는다(fail-closed)**. 예전에는 실패하면 빈 집합(= 전부 보임)으로 진행했다 —
 * 숨길 것을 못 숨기느니 막는다(UI-2a 최종 수정 FA1). 호출부는 던짐을 자기 실패 관례(null·빈 결과·500)로 돌려준다.
 * 권한 조회가 열화(actor null)면 비공개는 전부 숨는다(canSeeProject).
 * 끝까지 읽는다(HH1) — 한 응답은 max_rows 에서 오류 없이 잘리고, 잘린 첫 묶음만 집합에 넣으면 나머지 비공개가 명단 밖 사람에게 열린다(fail-open).
 * buildActor·포털 visibleProjectIds 와 같이 id 정렬 페이지 + count 총합 대조(fetchAllPages)이고, 어긋나면 판정 실패로 던진다.
 * 돌려주는 값은 브랜드 타입 HiddenProjectIds 다 — 그 값을 만드는 곳은 여기 하나다(HH2, isHiddenProject 의 셋째 인자).
 */
export class HiddenProjectsUnavailableError extends Error {
  constructor() { super('비공개 프로젝트 판정을 하지 못했습니다') }
}

export const getHiddenProjectIds = cache(async (): Promise<HiddenProjectIds> => {
  const sb = await createServerClient()
  const [rows, actor] = await Promise.all([
    fetchAllPages<{ id: string; is_private: boolean | null }>('비공개 프로젝트', (from, to) => sb.from('projects')
      .select('id, is_private', { count: 'exact' }).eq('is_private', true).order('id').range(from, to))
      .catch((e: unknown) => {
        unstable_rethrow(e)   // Next 제어 신호는 판정 실패로 바꾸지 않는다(HH3 과 같은 이유)
        console.error('[getHiddenProjectIds] 비공개 프로젝트 조회 실패 — 막는다(fail-closed):', e instanceof Error ? e.message : e)
        throw new HiddenProjectsUnavailableError()
      }),
    getActorForView(),
  ])
  return new Set(rows.filter(p => !canSeeProject(actor, p)).map(p => p.id)) as ReadonlySet<string> as HiddenProjectIds
})
