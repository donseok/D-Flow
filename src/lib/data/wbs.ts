import { cache } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { computeTree } from '@/lib/domain/rollup'
import { computeCompletionMap, type ProjectCompletion } from '@/lib/domain/project-status'
import { teamOrderMap } from '@/lib/domain/teams'
import { projectTeams } from '@/lib/teams/source'
import type { WbsRow, ComputedItem, TeamCode, OwnerKind, TaskDependency } from '@/lib/domain/types'
import { mergeSpecDepends } from '@/lib/domain/mergeDependencies'
import { AGENT_TAG } from '@/lib/domain/seatmap'
import { fetchAllByKeyset } from '@/lib/data/paging'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { requireCalendar } from '@/lib/calendar/load'
import { todayIn, type WorkCalendar } from '@/lib/domain/calendar'

// 같은 요청 내 layout+page 중복 호출을 1회로 dedupe(React cache).
export const getComputedWbs = cache(async (
  projectId: string,
): Promise<{
  items: ComputedItem[]
  dependencies: TaskDependency[]
  /**
   * 해석 못 한 선행 ref — 후행 항목 id → ref 목록. @see mergeSpecDepends
   * Map 이 아니라 평범한 객체다 — 이 값은 RSC 경계를 넘어 클라이언트 컴포넌트로 간다.
   */
  unresolvedDepends: Record<string, string[]>
  /** 휴무(kind='off') 날짜 오름차순 — 내보내기(off 만, D7)·옛 소비처용. 근무 예외는 calendar.workDates */
  holidays: string[]
  /** 이 프로젝트의 달력(근무 요일·날짜 예외·주 규칙·tz) — 과제 16 이 계산에 쓴다 */
  calendar: WorkCalendar
  today: string
}> => {
  const sb = await createServerClient()
  // 데이터 손실 경로(SP4 D18·Q5) — 두 표는 끝까지 읽는다(fetchAllByKeyset: 바뀌지 않는 키 다음부터 + count 대조). 한 응답은 max_rows(1000)
  // 에서 조용히 잘리고, 잘린 item_owners 는 Excel 의 ●/△ 로 나가 replace 로 되돌아오면 담당이 영구히 사라진다. item_owners 는 이 프로젝트
  // 항목의 담당만 읽는다(wbs_items!inner) — 전 프로젝트의 담당을 읽으면 1,000행에 먼저 닿는다. 쪽 키는 wbs_items id, item_owners 는 PK
  // (wbs_item_id, team_id) — sort_order 로 쪽을 나누면 쪽 사이의 형제 이동 한 번이 중복 1 + 누락 1 을 만들고 행 수가 같아 통과한다(K1).
  // 형제 정렬은 computeTree 가 sortOrder 로 한다(동률은 입력 순 = id 순). 잘림·count 불일치·조회 오류는 throw — 아래 세 표와 같은 취급.
  // task_dependencies 도 끝까지(SP4 A2 — 키는 PK 의 id), 휴일은 달력 로더(getProjectConfig — 같은 요청의 react cache)가 끝까지, 팀 정렬은 요청 범위 원천(projectTeams — 같은 요청의 설정 조회와 캐시를 나눈다).
  const [items, ownerRows, cfg, { data: proj, error: projErr }, dependencyRows, teams] = await Promise.all([
    fetchAllByKeyset<Record<string, unknown>>('[getComputedWbs] wbs_items', (r) => String(r.id), (after, limit) => {
      const q = sb.from('wbs_items').select('*', { count: 'exact' }).eq('project_id', projectId)
      return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
    }),
    fetchAllByKeyset<Record<string, unknown>>('[getComputedWbs] item_owners', (r) => `${r.wbs_item_id}|${r.team_id}`, (after, limit) => {
      const q = sb.from('item_owners').select('wbs_item_id, team_id, kind, teams(code), wbs_items!inner(project_id)', { count: 'exact' })
        .eq('wbs_items.project_id', projectId)
      // 복합 키 다음: (wbs_item_id, team_id) > (a, b) — 두 값은 uuid 라 or 문법의 구분자(, . ())를 담지 않는다
      return (after ? q.or(`wbs_item_id.gt.${after.wbs_item_id},and(wbs_item_id.eq.${after.wbs_item_id},team_id.gt.${after.team_id})`) : q)
        .order('wbs_item_id').order('team_id').limit(limit)
    }),
    getProjectConfig(projectId),
    sb.from('projects').select('base_date').eq('id', projectId).maybeSingle(),
    fetchAllByKeyset<Record<string, unknown>>('[getComputedWbs] task_dependencies', (r) => String(r.id), (after, limit) => {
      const q = sb.from('task_dependencies')
        .select('id, project_id, predecessor_id, successor_id, dependency_type, lag_days', { count: 'exact' })
        .eq('project_id', projectId)
      return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
    }),
    // 팀 원천 실패(TeamsUnavailableError)는 그대로 올린다 — 데이터 로더라 화면의 오류 경계가 받는다(빈 순서로 위장하지 않는다, 계획 P4)
    projectTeams(projectId),
  ])

  // 핵심 조회 실패를 '없음'으로 폴백하면 화면이 비는 게 아니라 '조용히 틀린 화면/숫자'가 된다.
  // - wbs_items: 빈 트리 → 대시보드가 'WBS 데이터 없음' EmptyState를 띄워 운영 데이터 위 재임포트를 유도한다(최악).
  // - item_owners: 담당 배지·행 분리가 사라져 팀 편집 권한이 회수된 것처럼 보인다.
  //   (wbs_items·item_owners·task_dependencies 는 위의 fetchAllByKeyset 이 잘림·오류에서 throw 한다)
  // - holidays: 달력 로더(getProjectConfig)가 끝까지 읽고 실패면 ConfigUnavailableError 를 던진다 — '공휴일 없음'으로 위장하지 않는다.
  // - projects.base_date: 기준일이 조용히 오늘로 바뀌어 전 지표(계획%·지연 판정·PPT·봇 답변)가 어긋난다.
  // - task_dependencies: 연결선·지연 전파·크리티컬 패스가 모두 사라져 "의존성 없음"으로 오인된다.
  // 계산 결과가 알림/리포트/임베딩 쓰기로도 흘러가므로, 에러 바운더리('문제가 발생했습니다')가 조용한 오염보다 안전하다.
  if (projErr) throw new Error(`[getComputedWbs] projects 조회 실패: ${projErr.message}`)

  const ownerMap = new Map<string, { team: TeamCode; kind: OwnerKind }[]>()
  ownerRows.forEach((o: Record<string, unknown>) => {
    const team = o.teams as { code: TeamCode } | { code: TeamCode }[] | null
    const code = (Array.isArray(team) ? team[0]?.code : team?.code) as TeamCode | undefined
    if (!code) return
    const wbsItemId = o.wbs_item_id as string
    const arr = ownerMap.get(wbsItemId) ?? []
    arr.push({ team: code, kind: o.kind as OwnerKind })
    ownerMap.set(wbsItemId, arr)
  })
  // DB가 순서를 보장하지 않으므로 표시 순서를 고정: 주관 먼저, 팀은 그 프로젝트 팀의 sort_order(비활성 포함 — 기존 데이터 정렬 안정).
  // (담당별 행 분리 UI에서 순서가 요청마다 바뀌면 같은 항목의 행 배치가 흔들린다.)
  const teamOrder = teamOrderMap(teams.map(t => t.code))
  const rank = (t: TeamCode) => teamOrder.get(t) ?? Number.MAX_SAFE_INTEGER
  ownerMap.forEach(arr =>
    arr.sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'primary' ? -1 : 1) || rank(a.team) - rank(b.team),
    ),
  )

  const rows: WbsRow[] = items.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    parentId: r.parent_id as string | null,
    code: r.code as string,
    sortOrder: r.sort_order as number,
    name: r.name as string,
    biz: (r.biz as string) ?? null,
    deliverable: (r.deliverable as string) ?? null,
    plannedStart: (r.planned_start as string) ?? null,
    plannedEnd: (r.planned_end as string) ?? null,
    weight: (r.weight as number) ?? null,
    actualPct: (r.actual_pct as number) ?? null,
    owners: ownerMap.get(r.id as string) ?? [],
    isOwnerSplit: r.is_owner_split === true,
    stage: (r.stage as string | null) ?? null, // spec 선행 충족 판정 재료 — claim 게이트와 같은 식을 쓴다
    assigneeMemberId: (r.assignee_member_id as string | null) ?? null,
    // 실시간 broadcast 의 순서 판정 기준(0098). select('*') 가 이미 싣고 있다.
    updatedAt: (r.updated_at as string | null) ?? null,
    // 「단계」 컬럼 표시 조건(D9) — 위임 태그. select('*') 가 tags 를 이미 싣는다.
    agentDelegated: Array.isArray(r.tags) && (r.tags as unknown[]).includes(AGENT_TAG),
    // 선행 기준 final 의 실적 축(SP5b D21) — select('*') 가 dev_workflow 를 이미 싣는다
    devWorkflow: r.dev_workflow === true,
  }))

  // 달력 키가 손상이면 ConfigKeyError — 에러 바운더리가 그 화면을 멈춘다(기본 달력으로 계획%를 내지 않는다, [RF4])
  const calendar = requireCalendar(cfg)
  const manualDependencies: TaskDependency[] = dependencyRows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    predecessorId: r.predecessor_id as string,
    successorId: r.successor_id as string,
    type: r.dependency_type as TaskDependency['type'],
    lagDays: Number(r.lag_days) || 0,
    origin: 'manual', // task_dependencies 실제 행 — depends 합성 행은 mergeSpecDepends 가 붙인다
  }))
  // wbs.md import 로 들어온 선행(wbs_items.depends)을 같은 배열로 끌어올린다.
  // 두 축은 뜻이 같은데 소비처가 task_dependencies 만 봐서, 정작 에이전트를 막는 관계가
  // 간트·크리티컬 패스·지연 전파 어디에도 안 나타났다.
  const { dependencies, unresolvedDepends } = (() => {
    const merged = mergeSpecDepends(
      manualDependencies,
      items.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        projectId: r.project_id as string,
        externalRef: (r.external_ref as string | null) ?? null,
        depends: (r.depends as string[] | null) ?? null,
      })),
    )
    return { dependencies: merged.dependencies, unresolvedDepends: Object.fromEntries(merged.unresolvedBySuccessorId) }
  })()
  // base_date(공정율 기준일)가 설정돼 있으면 그 날짜로, 없으면 그 프로젝트 tz 의 오늘(자동)로 산정(SP5 계획 D-22d)
  const today = (proj as { base_date: string | null } | null)?.base_date ?? todayIn(calendar.timezone, new Date())
  return {
    items: computeTree(rows, today, calendar, { subActTeamOrder: teamOrder }),
    dependencies,
    unresolvedDepends,
    holidays: [...calendar.offDates].sort(),
    calendar,
    today,
  }
})

// 사이드바용 경량 완료율 맵 — 볼 수 있는 프로젝트 전체를 키셋으로 끝까지(트리 로드 없이).
// 반환 null = 조회 실패. 빈 맵({})과 반드시 구분해야 한다 — 빈 맵은 'WBS가 없는 프로젝트'라는 정상 상태이고,
// 실패를 그것과 같게 취급하면 종료일 지난 미완 프로젝트가 '완료' 배지로 둔갑한다(projectLifecycleStatus).
// 한 응답은 max_rows(1000)에서 잘린다 — 잘린 맵은 실패와 같은 결과(뒤 프로젝트의 미완 항목이 빠진 '완료')라 끝까지 읽고,
// 잘림·읽는 사이 변경·조회 오류는 모두 null + 로그다(SP4 A2 §4.6). 키는 바뀌지 않는 id(P15).
// 인자를 받지 않는다(2026-08-18 성능 감사): 레이아웃의 첫 Promise.all 에 병합한다. wbs_items 의 읽기 정책이 볼 수 있는 프로젝트로
// 좁힌다(0006 격리 — 전체 개방이 아니다). 소비처는 가시 프로젝트 id 로만 lookup 한다.
// cache() 키도 무인자라 레이아웃·페이지가 같은 요청에서 불러도 1회만 실행된다.
export const getProjectsCompletion = cache(
  async (): Promise<Record<string, ProjectCompletion> | null> => {
    try {
      const sb = await createServerClient()
      const rows = await fetchAllByKeyset<Record<string, unknown>>('[getProjectsCompletion] wbs_items', (r) => String(r.id), (after, limit) => {
        const q = sb.from('wbs_items').select('id, parent_id, project_id, actual_pct', { count: 'exact' })
        return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
      })
      return computeCompletionMap(rows.map(r => ({
        id: r.id as string,
        parentId: (r.parent_id as string | null) ?? null,
        projectId: r.project_id as string,
        actualPct: (r.actual_pct as number | null) ?? null,
      })))
    } catch (e) {
      // Next 의 제어 신호(정적 생성 시도에서 cookies() 가 던지는 동적 사용 신호 등)는 실패가 아니다 — 다시 던져 Next 가 라우트를 동적으로
      // 판정하게 둔다. 삼키면 빌드 로그에 거짓 "조회 실패"가 남았다(클라이언트 생성이 try 안으로 들어온 뒤 — A2 최종 리뷰 완료 P2-2, FF4)
      unstable_rethrow(e)
      // 표시 전용이라 throw하지 않는다 — 앱 루트 layout에서 호출되므로 throw하면 배지 하나 때문에 모든 페이지가 에러 화면이 된다.
      console.error('[getProjectsCompletion] 조회 실패:', e instanceof Error ? e.message : e)
      return null
    }
  },
)
