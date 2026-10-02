/**
 * 프로젝트 설정 해석기(개정 §2.5, 스펙 §3.5) — 옛 데이터 계층 로더(data/projectConfig.ts, 과제 27 에서 삭제)의 후계.
 * 조회는 셋(설정 행 ⨝ projects, 영역 ⨝ 영역-팀, 팀). 설정 행 0행·조회 오류는 ConfigUnavailableError — 기본값으로 풀지 않는다.
 * 세션 없는 경로(외부 API·워커·봇 잡)는 { client: adminFor({ projectId }).admin } 을 넘긴다 — 쿠키 없는 RLS 클라이언트는 0행을 받는다.
 * 캐시는 요청 범위의 react cache 하나(키 = projectId, client). 모듈 수준 Map·전역 캐시를 두지 않는다(project-isolation 테스트).
 * 이 파일은 @/lib/modules 의 값을 import 하지 않는다(타입만 — tests/modules/registry.test.ts).
 */
import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import type { AreaKind, AreaTeamKind } from '@/lib/domain/areas'
import { PROJECT_SETTINGS, SETTINGS_SCHEMA_VERSION, valueOf, type ProjectSettingKey, type ProjectSettingValue } from './registry'
import { ConfigUnavailableError } from './errors'
import { isRecord, resolveKeys, type KeyState } from './resolve'

export type ConfigReadClient = Pick<SupabaseClient, 'from'>
export type { KeyState }

export interface ConfigArea {
  id: string; kind: AreaKind; code: string; name: string; sortOrder: number; active: boolean
  teams: { teamId: string; kind: AreaTeamKind }[]
}
export interface ConfigTeam {
  id: string; code: string; name: string; sortOrder: number; active: boolean; color: string; progressVisible: boolean
  projectId: string | null          // null = 워크스페이스 공용 팀
}
export interface ProjectConfig {
  projectId: string; workspaceId: string
  revision: number; schemaVersion: number; schemaAhead: boolean
  keys: { [K in ProjectSettingKey]: KeyState<ProjectSettingValue<K>> }
  unknownKeys: string[]                                          // 롤백 잔여 등. 읽기에서 무시, 진단에 노출
  areas: { weekly_section: ConfigArea[]; issue_area: ConfigArea[] }
  teams: ConfigTeam[]
}

type SettingsRow = { project_id: string; values: unknown; revision: number | string; schema_version: number; projects: { workspace_id: string } | null }
type AreaRow = { id: string; kind: AreaKind; code: string; name: string; sort_order: number; active: boolean; area_teams: { team_id: string; kind: AreaTeamKind }[] | null }
type TeamRow = { id: string; code: string; name: string; sort_order: number; active: boolean; color: string; progress_visible: boolean; project_id: string | null }

async function load(projectId: string, client: ConfigReadClient | undefined): Promise<ProjectConfig> {
  const sb = client ?? (await createServerClient())
  const s = await sb.from('project_settings')
    .select('project_id, values, revision, schema_version, projects!inner(workspace_id)')
    .eq('project_id', projectId).maybeSingle()
  if (s.error) throw new ConfigUnavailableError(`프로젝트 설정 조회 실패: ${s.error.message}`, { cause: s.error })
  const row = s.data as unknown as SettingsRow | null
  // 행 존재는 0012 ⑨ 의 트리거가 보장한다 — 0행 = 권한 밖 조회이거나 잘못된 클라이언트(fail-closed)
  if (!row || !row.projects?.workspace_id) throw new ConfigUnavailableError(`프로젝트 설정 행이 없습니다: ${projectId}`)
  // 객체가 아닌 values 를 {} 로 풀면 전 키가 조용히 기본값이 된다 — 읽기 실패로 멈춘다(3원칙 ①)
  if (!isRecord(row.values)) throw new ConfigUnavailableError(`프로젝트 설정 values 가 객체가 아닙니다: ${projectId}`)
  const values = row.values
  const workspaceId = row.projects.workspace_id
  const [a, t] = await Promise.all([
    sb.from('project_areas').select('id, kind, code, name, sort_order, active, area_teams(team_id, kind)')
      .eq('project_id', projectId).order('sort_order'),
    sb.from('teams').select('id, code, name, sort_order, active, color, progress_visible, project_id', { count: 'exact' })
      .eq('workspace_id', workspaceId).or(`project_id.is.null,project_id.eq.${projectId}`).order('sort_order'),
  ])
  if (a.error) throw new ConfigUnavailableError(`영역 조회 실패: ${a.error.message}`, { cause: a.error })
  if (t.error) throw new ConfigUnavailableError(`팀 조회 실패: ${t.error.message}`, { cause: t.error })
  // 한 응답은 max_rows(1000)에서 조용히 잘린다 — 공용 팀은 지워지지 않고 쌓이므로 잘린 목록이 "팀 없음"(거짓 미등록 409·상속 오판)으로 흐르지 않게
  // 총합과 대조해 멈춘다(A1-5 R4, 3원칙 ①). PostgREST 는 count 를 요청하면 늘 돌려준다 — 없을 때(가짜 클라이언트)는 대조하지 않는다
  if (typeof t.count === 'number' && t.count !== (t.data ?? []).length) {
    throw new ConfigUnavailableError(`팀 목록이 잘렸습니다(${(t.data ?? []).length}/${t.count}건): ${projectId}`)
  }

  const { keys, unknownKeys } = resolveKeys({ scope: 'project', id: projectId, values, defs: PROJECT_SETTINGS })
  const areas: ProjectConfig['areas'] = { weekly_section: [], issue_area: [] }
  for (const r of (a.data ?? []) as unknown as AreaRow[]) {
    const area: ConfigArea = { id: r.id, kind: r.kind, code: r.code, name: r.name, sortOrder: r.sort_order, active: r.active,
      teams: (r.area_teams ?? []).map((x) => ({ teamId: x.team_id, kind: x.kind })) }
    if (r.kind in areas) areas[r.kind].push(area)
  }
  const schemaVersion = Number(row.schema_version)
  return {
    projectId, workspaceId,
    revision: Number(row.revision), schemaVersion, schemaAhead: schemaVersion > SETTINGS_SCHEMA_VERSION,
    keys: keys as ProjectConfig['keys'], unknownKeys, areas,
    // code 는 앞뒤 공백을 걷고 빈 code 행은 팀이 아니다 — 팀 원천(teams/source.ts teamFromRow)·옛 팀 캐시와 같은 정리(A2-1 리뷰 정확성 P3)
    teams: ((t.data ?? []) as unknown as TeamRow[]).filter((r) => r.code.trim() !== '').map((r) => ({
      id: r.id, code: r.code.trim(), name: r.name, sortOrder: r.sort_order, active: r.active, color: r.color, progressVisible: r.progress_visible, projectId: r.project_id,
    })),
  }
}

const loadCached = cache(load)
export function getProjectConfig(projectId: string, opts?: { client?: ConfigReadClient }): Promise<ProjectConfig> {
  return loadCached(projectId, opts?.client)
}

/** 옛 maxDepth 의 후계 — 최대 깊이 = 단계 이름 수(§9 #1 기본값). 대안(제한 없음)을 고르면 이 함수 하나만 바뀐다 */
export function levelDepthOf(cfg: ProjectConfig): number {
  return valueOf(cfg, 'core.level_labels').length
}
