import { createServerClient } from '@/lib/supabase/server'
import { computeTree, overallProgress } from '@/lib/domain/rollup'
import type { SnapshotPoint } from '@/lib/domain/trend'
import type { ComputedItem, WbsRow } from '@/lib/domain/types'
import { seoulToday } from '@/lib/domain/dates'
import { activeCodes, teamOrderMap } from '@/lib/domain/teams'
import { fetchAllByKeyset } from '@/lib/data/paging'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { requireCalendar } from '@/lib/calendar/load'
import { projectTeams } from '@/lib/teams/source'

type Sb = Awaited<ReturnType<typeof createServerClient>>

export const ERR_SNAPSHOTS_LOAD = '진척 이력을 불러오지 못했습니다.'

/** 진척 스냅샷 조회(날짜 오름차순). numeric 컬럼은 문자열로 올 수 있어 Number 변환. */
export async function getSnapshots(
  projectId: string,
): Promise<{ ok: true; rows: SnapshotPoint[] } | { ok: false; error: string }> {
  // 끝까지 읽는다(SP4 A2) — 날짜 오름차순 한 번이면 1,000일 뒤의 최근 이력이 잘린다. 키는 PK 의 snap_date(프로젝트 안에서 유일).
  // 실패를 결과로 돌려준다 — 추세선을 합성하지 않게 화면이 이력 실패를 안다. ('이력 0건'으로 위장하면 buildTrend 가 (축 시작,0)→(오늘,실적)
  //  선을 합성해 정상 차트처럼 보인다. throw 하지 않는 이유: 같은 페이지의 다른 카드까지 동반 사망한다.)
  try {
    const sb = await createServerClient()
    const data = await fetchAllByKeyset<Record<string, unknown>>('[getSnapshots] wbs_progress_snapshots', (r) => String(r.snap_date), (after, limit) => {
      const q = sb.from('wbs_progress_snapshots').select('snap_date, actual_pct, planned_pct', { count: 'exact' }).eq('project_id', projectId)
      return (after ? q.gt('snap_date', String(after.snap_date)) : q).order('snap_date').limit(limit)
    })
    return { ok: true, rows: data.map((r) => ({ date: r.snap_date as string, actual: Number(r.actual_pct), planned: Number(r.planned_pct) })) }
  } catch (e) {
    console.error('[getSnapshots] 진척 스냅샷 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_SNAPSHOTS_LOAD }
  }
}

/** 오늘(KST)의 전체 실적/계획%를 upsert. 본 작업을 실패시키지 않도록 오류는 삼키고 로그만 남긴다.
 *  실적 롤업은 날짜와 무관하고 계획%만 날짜 함수이므로, base_date와 무관하게 항상 실제 오늘로 계산한다.
 *  page 의 after() 안에서는 cookies() 호출이 불가 — 그 경로는 client 를 밖에서 만들어 넘긴다. */
/** 오늘자 스냅샷 1행을 덮어쓴다. 실패는 로그만 남긴다 — 보험 기록이 본 화면을 죽이면 안 된다. */
async function upsertSnapshot(sb: Sb, projectId: string, today: string, actual: number, planned: number) {
  const { error } = await sb.from('wbs_progress_snapshots').upsert(
    { project_id: projectId, snap_date: today, actual_pct: actual, planned_pct: planned, updated_at: new Date().toISOString() },
    { onConflict: 'project_id,snap_date' },
  )
  // 42501(RLS 거부)은 게스트(비멤버) 조회 시 예상 가능한 소음이라 로그를 생략한다.
  if (error && error.code !== '42501') console.error('[snapshot] upsert 실패(무시):', error.message)
}

export async function recordProgressSnapshot(
  projectId: string,
  client?: Sb,
  /**
   * 호출부가 **같은 요청에서 이미 계산한** 트리. 넘기면 wbs_items 전량 재조회와 computeTree 가
   * 한 번씩 사라진다 — 대시보드는 지금까지 같은 계산을 요청마다 두 번 했다.
   * `today` 는 그 트리를 계산한 기준일이다. 스냅샷은 '오늘'의 기록이므로 기준일이 오늘과
   * 다르면(프로젝트에 base_date 가 설정된 경우) 재사용하지 않고 종전 경로로 직접 계산한다.
   */
  precomputed?: { roots: ComputedItem[]; today: string },
): Promise<void> {
  try {
    const sb = client ?? (await createServerClient())
    const todayNow = seoulToday()
    if (precomputed && precomputed.today === todayNow) {
      const { actual, planned } = overallProgress(precomputed.roots)
      await upsertSnapshot(sb, projectId, todayNow, actual, planned)
      return
    }
    // 재계산 경로도 끝까지(SP4 A2 §4.6 — 잘린 트리의 공정율을 오늘 값으로 남기지 않는다). 실패는 아래 catch 가 로그만(보험 기록).
    // 팀 순서는 받은 클라이언트로 읽는다 — 에이전트 라우트는 service_role 을 넘긴다(세션이 없으면 cookies() 도 없다).
    // 휴일은 달력 로더(설정 해석기)가 끝까지 + kind — 실패·손상 키는 아래 catch 가 로그만.
    const [items, cfg, teams] = await Promise.all([
      fetchAllByKeyset<Record<string, unknown>>('[snapshot] wbs_items', (r) => String(r.id), (after, limit) => {
        const q = sb.from('wbs_items')
          .select('id, parent_id, code, sort_order, name, planned_start, planned_end, weight, actual_pct, is_owner_split', { count: 'exact' })
          .eq('project_id', projectId)
        return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
      }),
      getProjectConfig(projectId, { client: sb }),
      projectTeams(projectId, { client: sb }),
    ])
    if (!items.length) return
    const rows: WbsRow[] = items.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      parentId: (r.parent_id as string) ?? null,
      code: r.code as string,
      sortOrder: r.sort_order as number,
      name: r.name as string,
      biz: null,
      deliverable: null,
      plannedStart: (r.planned_start as string) ?? null,
      plannedEnd: (r.planned_end as string) ?? null,
      weight: (r.weight as number) ?? null,
      actualPct: (r.actual_pct as number) ?? null,
      owners: [],
      isOwnerSplit: r.is_owner_split === true,
    }))
    const holidays = new Set(requireCalendar(cfg).offDates)
    const opts = { subActTeamOrder: teamOrderMap(activeCodes(teams)) }
    const { actual, planned } = overallProgress(computeTree(rows, todayNow, holidays, opts))
    await upsertSnapshot(sb, projectId, todayNow, actual, planned)
  } catch (e) {
    console.error('[snapshot] 진척 스냅샷 기록 실패(무시):', e)
  }
}
