/**
 * approved 주문이 있는 WBS 항목 id(SP5b D21 — 선행 판정의 승인 주문 축). WBS 화면의 상세 패널이 claim 게이트(loadDependsInfo)와 같은 입력으로
 * "시작 가능"을 말하게 한다. 세션 클라이언트(RLS 읽기 — 멤버면 주문을 읽는다). agents 모듈이 꺼진 프로젝트는 호출부가 부르지 않는다
 * (꺼진 모듈의 표를 읽지 않는다 — D21). 조회 실패는 null — 호출부는 승인 축 없이(false) 그리고 로그를 남긴다(표시 = 로깅).
 */
import { createServerClient } from '@/lib/supabase/server'

export async function getApprovedItemIds(projectId: string): Promise<string[] | null> {
  const sb = await createServerClient()
  const ids: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('agent_work_orders').select('wbs_item_id')
      .eq('project_id', projectId).eq('status', 'approved').not('wbs_item_id', 'is', null).order('id').range(from, from + 999)
    if (error) {
      console.error('[approvedItems] 승인 주문 조회 실패:', error.message)
      return null
    }
    const page = (data ?? []) as { wbs_item_id: string }[]
    ids.push(...page.map((r) => r.wbs_item_id))
    if (page.length < 1000) return [...new Set(ids)]
  }
}
