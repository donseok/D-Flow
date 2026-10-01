import 'server-only'

// 요청 범위 팀 원천(스펙 §4.2.1, D19·D36) — 옛 프로세스 전역 팀 캐시(lib/teams/master.ts, SP4 B 에서 삭제)의 후계.
// 원천은 프로젝트 설정 해석기의 팀(getProjectConfig(pid).teams — 그 워크스페이스 공용 ∪ 그 프로젝트 전용, 같은 요청의 설정 조회와
// 왕복을 나눈다)이고, 노출 규칙은 기존 순수 함수 resolveTeamsForProject("전용 팀이 하나라도(비활성 포함) 있으면 그것만, 없으면 공용")
// 그대로다 — 규칙을 새로 만들지 않아 화면마다 다른 팀이 보이지 않는다. 캐시는 요청 범위 react cache 하나 — 모듈 수준 상태를 두지 않는다
// (tests/settings/project-isolation.test.ts). 세션 없는 경로(워커·봇 잡·외부 API)는 { client: adminFor(…).admin } 을 넘긴다.
// 조회 실패는 TeamsUnavailableError — 빈 목록으로 위장하지 않는다(3원칙 ①). 원인(DB 원문 포함)은 cause 에만 둔다.
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/data/paging'
import { resolveTeamsForProject, type Team } from '@/lib/domain/teams'
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

function teamFromRow(r: Record<string, unknown>): Team {
  if (typeof r.id !== 'string' || typeof r.code !== 'string' || typeof r.name !== 'string' || typeof r.color !== 'string'
      || typeof r.workspace_id !== 'string') {
    throw new TeamsUnavailableError('공용 팀 행의 모양이 기대와 다릅니다(select 누락)')
  }
  return {
    id: r.id, code: r.code, name: r.name, color: r.color, sortOrder: Number(r.sort_order ?? 0),
    active: r.active !== false, progressVisible: r.progress_visible !== false, projectId: null, workspaceId: r.workspace_id,
  }
}

const loadWorkspaceTeams = cache(async (workspaceId: string, client: ConfigReadClient | undefined): Promise<Team[]> => {
  const sb = client ?? (await createServerClient())
  let rows: Array<Record<string, unknown>>
  try {
    // 공용 팀은 지우지 않고 쌓인다 — 한 응답의 max_rows 에서 잘리지 않게 끝까지 읽는다(유일 키 id 로 정렬을 끝낸다)
    rows = await fetchAllPages<Record<string, unknown>>('공용 팀', (from, to) => sb.from('teams')
      .select('id, code, name, color, sort_order, active, progress_visible, project_id, workspace_id', { count: 'exact' })
      .eq('workspace_id', workspaceId).is('project_id', null)
      .order('sort_order').order('code').order('id')
      .range(from, to))
  } catch (e) {
    throw new TeamsUnavailableError(`공용 팀을 불러오지 못했습니다: ${workspaceId}`, { cause: e })
  }
  return rows.map(teamFromRow).sort(byDisplayOrder)
})

/** 한 워크스페이스의 공용 팀(비활성 포함 — 화면이 활성을 거른다). 다른 워크스페이스 팀·프로젝트 전용 팀은 없다 */
export function workspaceTeams(workspaceId: string, opts?: SourceOpts): Promise<Team[]> {
  return loadWorkspaceTeams(workspaceId, opts?.client)
}
