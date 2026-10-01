import { createServerClient } from '@/lib/supabase/server'
import { fetchAllByKeyset, type PageResult } from '@/lib/data/paging'
import { getComputedWbs } from '@/lib/data/wbs'
import { DEFAULT_MILESTONE_KEYWORDS } from '@/lib/settings/defs/project'
import { listProjectsWithState } from '@/app/actions/project'
import { seoulToday } from '@/lib/domain/dates'
import { addDaysCal } from '@/lib/domain/dashboard'
import { activeCodes } from '@/lib/domain/teams'
import { projectTeams } from '@/lib/teams/source'
import type { PortfolioProjectInput } from '@/lib/domain/portfolio'
import type { SnapshotPoint } from '@/lib/domain/trend'
import { getActor } from '@/lib/authz'
import { canViewPortfolio } from '@/lib/authz/portfolioAccess'
import { personOf } from '@/lib/data/memberSelect'
import { compareKoreanName } from '@/lib/domain/nameSort'

/** 추세 화살표·지연 추세 신호에 충분한 스냅샷 창 — 전량 로드는 성능 예산 밖. */
const SNAPSHOT_WINDOW_DAYS = 60

/**
 * 포트폴리오 입력 일괄 로드 — 프로젝트 N개를 병렬로 읽는다(/projects 홈과 같은 패턴).
 * 개별 프로젝트 실패는 그 행만 degraded(items null)로 격리한다 — 한 프로젝트 장애로
 * 전사 화면을 죽이지 않되, 실패를 '데이터 없음'으로 위장하지 않는다(3원칙).
 * 호출 전제: canViewPortfolio 통과(슈퍼유저) — listProjectsWithState 의 canSeeProject 는
 * 슈퍼유저에게 비공개(0070) 포함 전체를 반환한다.
 */
export async function getPortfolioInputs(): Promise<{
  inputs: PortfolioProjectInput[]
  leadersDegraded: boolean
  listDegraded: boolean
}> {
  // 페이지의 redirect 는 UX 일 뿐 — 실제 방어선은 이 재검사다(getUsageDirectory 선례).
  if (!canViewPortfolio(await getActor())) {
    throw new Error('portfolio: 슈퍼유저 전용 조회입니다.')
  }
  const { projects, degraded: listDegraded } = await listProjectsWithState()
  const ids = projects.map(p => p.id)

  // PM(리더) = 명단의 프로젝트 관리자(access_role='admin', 활성 행·활성 인물 — 권한 축과 같다) — IN 한 방(getProjectsCompletion 선례).
  // 이름은 people 이 정본이라 임베드로 읽고, 정렬은 DB collation 대신 가나다순(compareKoreanName)으로 한다.
  // 표시 전용이라 실패해도 throw 하지 않지만, '리더 없음'으로 위장하지 않도록 플래그로 신호한다.
  const sb = await createServerClient()
  let leadersDegraded = false
  const leadersByProject = new Map<string, string[]>()
  if (ids.length) {
    const { data, error } = await sb
      .from('project_members')
      .select('project_id, people!inner(display_name, active)')
      .eq('access_role', 'admin')
      .eq('active', true)
      .eq('people.active', true)
      .in('project_id', ids)
    if (error) {
      console.error('[portfolio] 리더 조회 실패:', error.message)
      leadersDegraded = true
    }
    for (const r of data ?? []) {
      const name = personOf(r)?.display_name
      if (!name) continue
      const arr = leadersByProject.get(r.project_id as string) ?? []
      arr.push(name)
      leadersByProject.set(r.project_id as string, arr)
    }
    for (const arr of leadersByProject.values()) arr.sort(compareKoreanName)
  }

  // 진척 스냅샷(최근 60일) — 프로젝트 IN, 끝까지 읽는다(A2-1 리뷰 정확성 P2). 프로젝트당 하루 1행이 쌓이므로 17개 × 60일이면 한 응답(max_rows
  // 1000)을 넘는다 — 잘리면 최근 날짜가 빠진 채 추세 화살표가 조용히 낡은 시점으로 계산된다. 키는 PK (project_id, snap_date) 복합 키셋
  // (getComputedWbs 의 item_owners 와 같은 꼴 — 계획 P15). 실패·잘림·읽는 사이 변경은 로그만: 추세 화살표·지연 추세 신호가 비표기될 뿐
  // 합성되지 않는다(getSnapshots 의 '조용한 거짓 차트 금지' 관례와 같은 결). 일부만 읽은 행은 쓰지 않는다.
  const realToday = seoulToday()
  const snapshotsByProject = new Map<string, SnapshotPoint[]>()
  if (ids.length) {
    type SnapRow = { project_id: string; snap_date: string; actual_pct: unknown; planned_pct: unknown }
    const since = addDaysCal(realToday, -SNAPSHOT_WINDOW_DAYS)
    try {
      const rows = await fetchAllByKeyset<SnapRow>('[portfolio] 스냅샷', (r) => `${r.project_id}|${r.snap_date}`, (after, limit) => {
        const q = sb.from('wbs_progress_snapshots')
          .select('project_id, snap_date, actual_pct, planned_pct', { count: 'exact' })
          .gte('snap_date', since)
          .in('project_id', ids)
        return (after ? q.or(`project_id.gt.${after.project_id},and(project_id.eq.${after.project_id},snap_date.gt.${after.snap_date})`) : q)
          .order('project_id').order('snap_date').limit(limit) as unknown as PromiseLike<PageResult<SnapRow>>
      })
      // 프로젝트 안에서는 snap_date 오름차순으로 온다(키셋 정렬 = project_id, snap_date) — 추세 계산이 기대하는 순서
      for (const r of rows) {
        const arr = snapshotsByProject.get(r.project_id) ?? []
        arr.push({ date: r.snap_date, actual: Number(r.actual_pct), planned: Number(r.planned_pct) })
        snapshotsByProject.set(r.project_id, arr)
      }
    } catch (e) {
      console.error('[portfolio] 스냅샷 조회 실패(추세 화살표 비표기):', e instanceof Error ? e.message : e)
    }
  }

  const inputs = await Promise.all(projects.map(async (p): Promise<PortfolioProjectInput> => {
    const row = p as typeof p & { base_date?: string | null; is_private?: boolean }
    const base = {
      projectId: p.id, name: p.name,
      isPrivate: row.is_private === true,
      startDate: p.start_date ?? null, endDate: p.end_date ?? null,
      baseDate: row.base_date ?? null,
      leaders: leadersByProject.get(p.id) ?? [],
      snapshots: snapshotsByProject.get(p.id) ?? [],
      realToday,
    }
    // 팀과 WBS 를 함께 격리한다(SP4 A2 P19) — 팀 읽기가 try 밖이면 한 프로젝트의 실패로 전사 화면이 멈춘다. 팀은 getComputedWbs 안의
    // 팀 읽기와 같은 요청 캐시 키(projectTeams(pid) — 클라이언트 인자 없음)라 왕복이 늘지 않는다.
    try {
      const [teams, wbs] = await Promise.all([projectTeams(p.id), getComputedWbs(p.id)])
      return { ...base, teams: activeCodes(teams), today: wbs.today, items: wbs.items, milestoneKeywords: portfolioMilestoneKeywords() }
    } catch (e) {
      console.error(`[portfolio] 프로젝트 로드 실패 — 행을 degraded 로 표시: ${p.name}(${p.id})`, e)
      return { ...base, teams: [], today: realToday, items: null, milestoneKeywords: [] }
    }
  }))

  return { inputs, leadersDegraded, listDegraded }
}

/** §9 #16 기본값 — 워크스페이스 화면은 프로젝트별 설정을 읽지 않는다(개정 §2.1). 모든 프로젝트를 제품 기본 키워드로 판정한다.
 *  대안(프로젝트별 키워드·표시 제거)을 고르면 이 함수 하나가 바뀐다. */
export function portfolioMilestoneKeywords(): readonly string[] { return DEFAULT_MILESTONE_KEYWORDS }
