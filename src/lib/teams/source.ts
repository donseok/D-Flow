import 'server-only'

// 요청 범위 팀 원천(스펙 §4.2.1, D19·D36) — 옛 프로세스 전역 팀 캐시(lib/teams/master.ts, SP4 B 에서 삭제)의 후계.
// 원천은 프로젝트 설정 해석기의 팀(getProjectConfig(pid).teams — 그 워크스페이스 공용 ∪ 그 프로젝트 전용, 같은 요청의 설정 조회와
// 왕복을 나눈다)이고, 노출 규칙은 기존 순수 함수 resolveTeamsForProject("전용 팀이 하나라도(비활성 포함) 있으면 그것만, 없으면 공용")
// 그대로다 — 규칙을 새로 만들지 않아 화면마다 다른 팀이 보이지 않는다. 캐시는 요청 범위 react cache 하나 — 모듈 수준 상태를 두지 않는다
// (tests/settings/project-isolation.test.ts). 세션 없는 경로(워커·봇 잡·외부 API)는 { client: adminFor(…).admin } 을 넘긴다.
// 조회 실패는 TeamsUnavailableError — 빈 목록으로 위장하지 않는다(3원칙 ①). 원인(DB 원문 포함)은 cause 에만 둔다.
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAllByKeyset } from '@/lib/data/paging'
import type { TeamView } from '@/lib/domain/authz'
import { resolveTeamsForProject, teamsVisibleTo, type Team } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'
import { getProjectConfig, type ConfigReadClient, type ProjectConfig } from '@/lib/settings/projectConfig'

export class TeamsUnavailableError extends Error {
  readonly code = 'TEAMS_UNAVAILABLE' as const
  constructor(message = '팀 목록을 불러오지 못했습니다.', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TeamsUnavailableError'
  }
}

type SourceOpts = { client?: ConfigReadClient }

/** 표시·대조 순서 — activeCodes 와 같은 (sortOrder, code ko), 동률이면 id(결정적) */
function byDisplayOrder(a: Team, b: Team): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'ko') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

async function configOf(projectId: string, opts?: SourceOpts): Promise<ProjectConfig> {
  try {
    return await getProjectConfig(projectId, opts)
  } catch (e) {
    throw new TeamsUnavailableError(`프로젝트 팀을 불러오지 못했습니다: ${projectId}`, { cause: e })
  }
}

/** 해석기의 팀(ConfigTeam)은 워크스페이스가 그 프로젝트의 워크스페이스 하나다 — Team 의 workspaceId 를 채운다 */
const teamsOf = (cfg: ProjectConfig): Team[] => cfg.teams.map((t) => ({ ...t, workspaceId: cfg.workspaceId }))

/** 그 프로젝트가 쓰는 팀(비활성 포함) — 전용 팀이 하나라도 있으면 그것만, 없으면 그 워크스페이스의 공용 팀 */
export async function projectTeams(projectId: string, opts?: SourceOpts): Promise<Team[]> {
  const cfg = await configOf(projectId, opts)
  return resolveTeamsForProject(teamsOf(cfg), projectId, cfg.workspaceId).sort(byDisplayOrder)
}

/** 그 프로젝트의 전용 팀만(비활성 포함) — 가져오기의 상속 판정(0개 = 공용 팀 상속)·설정 화면 */
export async function projectOwnTeams(projectId: string, opts?: SourceOpts): Promise<Team[]> {
  const cfg = await configOf(projectId, opts)
  return teamsOf(cfg).filter((t) => t.projectId === projectId).sort(byDisplayOrder)
}

const TEAM_COLS = 'id, code, name, color, sort_order, active, progress_visible, project_id, workspace_id'

/** teams 행 → Team(공용 팀·가시 범위 공용). 모든 열이 not null(0003) — 빠지면 select 누락 같은 결함이라 throw.
 *  code 는 앞뒤 공백을 걷고, 걷은 뒤 빈 code 의 행은 팀이 아니다(null — 옛 팀 캐시와 같은 정리, A2-1 리뷰 정확성 P3). 모든 쓰기 경로가
 *  normalizeNewTeamCode 로 trim 하므로 정상 데이터에서는 같다 — 직접 SQL·옛 시드로 생긴 행이 화면과 다른 문자열로 대조되지 않게 한다 */
function teamFromRow(r: Record<string, unknown>): Team | null {
  if (typeof r.id !== 'string' || typeof r.code !== 'string' || typeof r.name !== 'string' || typeof r.color !== 'string'
      || typeof r.workspace_id !== 'string' || (r.project_id !== null && r.project_id !== undefined && typeof r.project_id !== 'string')) {
    throw new TeamsUnavailableError('팀 행의 모양이 기대와 다릅니다(select 누락)')
  }
  const code = r.code.trim()
  if (code === '') return null
  return {
    id: r.id, code, name: r.name, color: r.color, sortOrder: Number(r.sort_order ?? 0),
    active: r.active !== false, progressVisible: r.progress_visible !== false,
    projectId: typeof r.project_id === 'string' ? r.project_id : null, workspaceId: r.workspace_id,
  }
}
const teamsFromRows = (rows: Array<Record<string, unknown>>): Team[] => rows.map(teamFromRow).filter((t): t is Team => t !== null)

const loadWorkspaceTeams = cache(async (workspaceId: string, client: ConfigReadClient | undefined): Promise<Team[]> => {
  const sb = client ?? (await createServerClient())
  let rows: Array<Record<string, unknown>>
  try {
    // 공용 팀은 지우지 않고 쌓인다 — 한 응답의 max_rows 에서 잘리지 않게 끝까지 읽는다. 키는 바뀌지 않는 id(키셋 — 계획 P15·A2-1 리뷰
    // 정확성 P3): offset 은 정렬 앞 키(sort_order)를 바꾸는 순서 변경이 쪽 사이에 끼면 한 행 중복·한 행 누락이 count 를 통과한다. 표시 순은 아래 정렬
    rows = await fetchAllByKeyset<Record<string, unknown>>('공용 팀', (r) => String(r.id), (after, limit) => {
      const q = sb.from('teams').select(TEAM_COLS, { count: 'exact' }).eq('workspace_id', workspaceId).is('project_id', null)
      return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
    })
  } catch (e) {
    throw new TeamsUnavailableError(`공용 팀을 불러오지 못했습니다: ${workspaceId}`, { cause: e })
  }
  return teamsFromRows(rows).sort(byDisplayOrder)
})

/** 한 워크스페이스의 공용 팀(비활성 포함 — 화면이 활성을 거른다). 다른 워크스페이스 팀·프로젝트 전용 팀은 없다 */
export function workspaceTeams(workspaceId: string, opts?: SourceOpts): Promise<Team[]> {
  return loadWorkspaceTeams(workspaceId, opts?.client)
}

/** 가시 범위의 활성 팀(스펙 §4.2.1 — 회의록 담당 필터·챗·외부 회의록 API·봇 이름 매칭). 규칙은 순수 teamsVisibleTo 그대로다.
 *  view 가 여는 범위(보이는 워크스페이스의 공용 ∪ 보이는 프로젝트의 전용)만 질의로 좁혀 id 키셋으로 끝까지 읽고(P15 — 팀은 지우지 않고
 *  프로젝트마다 전환 복사가 생긴다) 메모리에서 같은 규칙으로 다시 거른다. 질의를 좁히는 이유(A2-1 리뷰 보안 P3): 세션 없는 경로가
 *  { client: admin } 을 넘기면 RLS 가 없어 다른 테넌트의 팀까지 매 요청 읽었고, 쪽이 나뉘면 다른 워크스페이스의 팀 생성이 이 요청의
 *  count 대조를 깨 500 이 됐다. 플랫폼 관리자(view.all)는 전부다. 조회 실패·잘림·읽는 사이 변경은 TeamsUnavailableError(빈 목록으로 위장하지 않는다). */
export async function visibleTeams(view: TeamView, opts?: SourceOpts): Promise<Team[]> {
  let scope: string | null = null
  if (!view.all) {
    const ws = [...view.workspaceIds]
    const ps = [...view.projectIds]
    if (ws.length === 0 && ps.length === 0) return []
    scope = [
      ...(ws.length ? [`and(project_id.is.null,workspace_id.in.(${ws.join(',')}))`] : []),
      ...(ps.length ? [`project_id.in.(${ps.join(',')})`] : []),
    ].join(',')
  }
  try {
    const sb = opts?.client ?? (await createServerClient())
    const rows = await fetchAllByKeyset<Record<string, unknown>>('[teams] 가시 범위', (r) => String(r.id), (after, limit) => {
      const base = sb.from('teams').select(TEAM_COLS, { count: 'exact' }).eq('active', true)
      const q = scope ? base.or(scope) : base
      return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
    })
    return teamsVisibleTo(teamsFromRows(rows), view)
  } catch (e) {
    throw new TeamsUnavailableError('볼 수 있는 팀 목록을 불러오지 못했습니다.', { cause: e })
  }
}

/** visibleTeams 의 code(activeCodes 순, 중복 없음) */
export async function teamCodesVisibleTo(view: TeamView, opts?: SourceOpts): Promise<TeamCode[]> {
  return (await visibleTeams(view, opts)).map((t) => t.code)
}
