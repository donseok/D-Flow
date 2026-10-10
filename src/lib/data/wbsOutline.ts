import 'server-only'
// 개요 번호의 서버 쪽 계산(BUG-05) — 계산된 트리(getComputedWbs)가 없는 자리(전역 검색)가 표의 번호 열과 같은 번호를 보이게 한다.
// 번호에 필요한 열만 읽는다(구조·형제 순서). 담당 분리 행(sub-act)이 있을 때만 그 형제 순서의 재료(담당·팀 순서)를 더 읽는다 —
// 표의 정렬(tree.ts buildTree)과 같은 입력이어야 같은 번호가 나온다.
import { fetchAllByKeyset } from '@/lib/data/paging'
import { outlineNumbersOfRows, type OutlineRow } from '@/lib/domain/wbsDerived'
import { teamOrderMap } from '@/lib/domain/teams'
import { projectTeams } from '@/lib/teams/source'
import type { OwnerKind, TeamCode } from '@/lib/domain/types'
import type { createServerClient } from '@/lib/supabase/server'

type Client = Awaited<ReturnType<typeof createServerClient>>
type Row = Record<string, unknown>

/**
 * 그 프로젝트 항목의 개요 번호(id → '1.2.1'). 끝까지 읽는다(키셋 — 잘린 목록으로 매긴 번호는 조용히 틀린다).
 * throw: 조회 오류·잘림·팀 원천 실패. 부르는 쪽이 번호 없이 보일지 정한다 — 틀린 번호를 보이지 않는다.
 */
export async function loadOutlineNumbers(sb: Client, projectId: string): Promise<Map<string, string>> {
  const items = await fetchAllByKeyset<Row>('[loadOutlineNumbers] wbs_items', (r) => String(r.id), (after, limit) => {
    const q = sb.from('wbs_items').select('id, parent_id, sort_order, is_owner_split', { count: 'exact' }).eq('project_id', projectId)
    return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
  })
  const owners = new Map<string, { team: TeamCode; kind: OwnerKind }[]>()
  let teamOrder: ReadonlyMap<string, number> = new Map()
  if (items.some((r) => r.is_owner_split === true)) {
    // getComputedWbs 와 같은 읽기 — 담당 분리 형제는 주관 팀의 순서로 놓인다
    const [ownerRows, teams] = await Promise.all([
      fetchAllByKeyset<Row>('[loadOutlineNumbers] item_owners', (r) => `${r.wbs_item_id}|${r.team_id}`, (after, limit) => {
        const q = sb.from('item_owners').select('wbs_item_id, team_id, kind, teams(code), wbs_items!inner(project_id)', { count: 'exact' })
          .eq('wbs_items.project_id', projectId)
        return (after ? q.or(`wbs_item_id.gt.${after.wbs_item_id},and(wbs_item_id.eq.${after.wbs_item_id},team_id.gt.${after.team_id})`) : q)
          .order('wbs_item_id').order('team_id').limit(limit)
      }),
      projectTeams(projectId),
    ])
    teamOrder = teamOrderMap(teams.map((t) => t.code))
    const rank = (t: TeamCode) => teamOrder.get(t) ?? Number.MAX_SAFE_INTEGER
    for (const o of ownerRows) {
      const team = o.teams as { code: TeamCode } | { code: TeamCode }[] | null
      const code = Array.isArray(team) ? team[0]?.code : team?.code
      if (!code) continue
      const list = owners.get(o.wbs_item_id as string) ?? []
      list.push({ team: code, kind: o.kind as OwnerKind })
      owners.set(o.wbs_item_id as string, list)
    }
    owners.forEach((arr) => arr.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'primary' ? -1 : 1) || rank(a.team) - rank(b.team)))
  }
  const rows: OutlineRow[] = items.map((r) => ({
    id: r.id as string, parentId: (r.parent_id as string | null) ?? null, sortOrder: r.sort_order as number,
    isOwnerSplit: r.is_owner_split === true, owners: owners.get(r.id as string) ?? [],
  }))
  return outlineNumbersOfRows(rows, { subActTeamOrder: teamOrder })
}
