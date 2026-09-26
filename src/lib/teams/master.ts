import 'server-only'

// ============================================================================
// 팀 기준정보 런타임 캐시 — lib/ai/llm-override.ts 와 동일한 검증된 패턴.
// 동기 소비처(레이아웃·AI 도구·레포 매핑)가 많아 동기 접근자 + TTL 백그라운드 갱신.
// service_role 로 읽는 이유: 캐시는 프로세스 전역이라 사용자 세션 컨텍스트가 없다(읽기 전용 select).
// 캐시는 전 워크스페이스의 팀과 프로젝트→워크스페이스 매핑을 담는다 — 한 워크스페이스·프로젝트로 좁히는 것은 접근자의
// 몫이다(SP2 §4.2). 워크스페이스를 가리지 않는 접근자는 두지 않는다 — 워크스페이스는 대상 행이나 actor 에서 온다.
// ============================================================================

import type { TeamView } from '@/lib/domain/authz'
import {
  activeCodes, activeTeamsForWorkspaces, resolveTeamsForProject, teamCodesVisibleTo, type Team,
} from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'
import { createAdminClient } from '@/lib/supabase/admin'

const TTL_MS = 60_000
const LOAD_TIMEOUT_MS = 3_000
/** 로드 실패 후 재시도 간격 — 실패에 TTL 전체를 물리면 stale 구간이 불필요하게 길어진다. */
const RETRY_MS = 10_000

interface Snapshot {
  teams: readonly Team[]
  /** projectId → workspaceId(projects 전체). 프로젝트 폴백을 그 워크스페이스의 공용 팀으로 좁히는 근거. */
  projectWorkspace: ReadonlyMap<string, string>
}

let cache: Snapshot = { teams: [], projectWorkspace: new Map() }
/** 한 번이라도 DB 로드에 성공했는가 — 실패 시 '직전 유효값 보존 vs 빈 목록'을 가르는 기준. */
let everLoaded = false
let nextRefreshAt = 0
/** 로드 직렬화 큐 — 동시 로드가 끝나는 순서에 따라 옛 스냅샷이 캐시를 덮는 것을 막는다. */
let queue: Promise<unknown> = Promise.resolve()
let background: Promise<unknown> | null = null

/** 팀과 프로젝트→워크스페이스 매핑을 한 로드로 읽는다 — 어느 쪽이 실패해도 로드 실패다(반쪽 스냅샷을 싣지 않는다). */
async function fetchSnapshot(): Promise<Snapshot> {
  const admin = createAdminClient()
  // 두 쿼리 모두 count 로 잘림(PostgREST max_rows)을 잡는다 — 빠진 팀은 화면·검증에서 조용히 사라지고, 빠진 프로젝트는
  // '존재하지 않는 프로젝트'로 읽혀 그 프로젝트의 팀이 빈 목록이 된다.
  const [teamsRes, projectsRes] = await Promise.all([
    admin
      .from('teams')
      .select('id, code, sort_order, active, progress_visible, project_id, workspace_id', { count: 'exact' })
      .order('sort_order')
      .order('code'),
    admin.from('projects').select('id, workspace_id', { count: 'exact' }),
  ])
  const teamRows = completeRows('teams', teamsRes)
  const projectRows = completeRows('projects', projectsRes)
  const projectWorkspace = new Map<string, string>()
  for (const r of projectRows) {
    // workspace_id 는 not null(0003)이다 — 없으면 select 누락 같은 결함이라 로드 실패로 올린다.
    if (typeof r.id !== 'string' || typeof r.workspace_id !== 'string' || r.workspace_id === '') {
      throw new Error('projects 행에 workspace_id 가 없습니다')
    }
    projectWorkspace.set(r.id, r.workspace_id)
  }
  return { teams: toTeams(teamRows), projectWorkspace }
}

/** 조회 결과의 행 전체 — 오류이거나, count 가 없거나(잘림을 확인할 수 없다), 행 수와 count 가 다르면(잘렸다) throw. */
function completeRows(
  table: string,
  res: { data: unknown[] | null; error: { message: string } | null; count: number | null },
): Array<Record<string, unknown>> {
  if (res.error) throw new Error(`${table} 조회 실패: ${res.error.message}`)
  const rows = (res.data ?? []) as Array<Record<string, unknown>>
  if (res.count === null) throw new Error(`${table} 행 수(count)를 받지 못해 잘림을 확인할 수 없습니다`)
  if (res.count !== rows.length) throw new Error(`${table} 가 잘려 왔습니다(${rows.length}/${res.count})`)
  return rows
}

function toTeams(rows: Array<Record<string, unknown>>): readonly Team[] {
  // workspace_id 는 not null(0003)이다 — 없으면 select 누락 같은 결함이라 로드 실패로 올린다.
  // 워크스페이스를 모르는 팀을 캐시에 넣으면 워크스페이스 접근자가 그 팀을 조용히 빠뜨린다.
  if (rows.some(r => typeof r.workspace_id !== 'string' || r.workspace_id === '')) {
    throw new Error('teams 행에 workspace_id 가 없습니다')
  }
  const teams = rows
    .filter(r => typeof r.code === 'string' && (r.code as string).trim() !== '')
    .map(r => ({
      id: String(r.id),
      code: (r.code as string).trim(),
      sortOrder: Number(r.sort_order ?? 0),
      active: r.active !== false,
      progressVisible: r.progress_visible !== false,
      projectId: (r.project_id as string | null) ?? null,
      workspaceId: r.workspace_id as string,
    }))
  return teams
}

/** 남은 타이머는 반드시 해제한다 — 안 하면 Node 프로세스가 타임아웃까지 종료되지 않는다. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`팀 마스터 로드 ${ms}ms 초과`)), ms)
  })
  return Promise.race([promise, guard]).finally(() => { if (timer) clearTimeout(timer) })
}

/** 성공하면 캐시 교체 후 true. 절대 throw 하지 않는다(큐가 실패로 고착되지 않도록). */
async function load(): Promise<boolean> {
  try {
    cache = await withTimeout(fetchSnapshot(), LOAD_TIMEOUT_MS)
    everLoaded = true
    nextRefreshAt = Date.now() + TTL_MS
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 직전 유효값을 버리지 않는다 — DB 순단 한 번으로 팀 목록이 빈 목록으로 되돌아가면
    // 관리자가 추가한 팀이 화면·검증에서 조용히 사라진다.
    // 최초 로드 전에는 접근자가 throw 한다(snapshotSync) — 호출부가 오류로 올리고, RETRY_MS 뒤 다음 접근이 다시 읽는다.
    if (!everLoaded) console.error('[teams] 최초 팀 마스터 로드 실패 — 다음 로드 성공까지 접근자가 오류를 낸다:', message)
    else console.error('[teams] 팀 마스터 갱신 실패 — 직전 값을 유지합니다:', message)
    nextRefreshAt = Date.now() + RETRY_MS
    return false
  }
}

/** DB 즉시 재조회 + 캐시 교체. 팀 관리 액션 저장·프로젝트 생성 후 await 한다(새 프로젝트의 워크스페이스를 바로 알게).
 *  진행 중 로드에 편승하지 않고 큐에 이어 붙이는 이유는 llm-override 의 동명 함수 주석 참조
 *  (편승하면 저장 직후 캐시가 옛 값으로 확정된 채 TTL 을 탄다). */
export function refreshTeams(): Promise<boolean> {
  const next = queue.then(load, load)
  queue = next.then(() => {}, () => {})
  return next
}

/** 전체 스냅샷(공용+프로젝트 팀, 비활성 포함). 내부용 — 외부는 아래 스코프 접근자를 쓴다.
 *  캐시를 한 번도 채우지 못했으면 throw 한다 — 조회 실패를 "팀 없음"으로 위장하지 않는다(에러 3원칙).
 *  정상 로드 뒤의 갱신 실패는 직전 값을 그대로 쓴다(stale ≠ 실패, load 주석 참조). */
function snapshotSync(): Snapshot {
  if (!background && Date.now() >= nextRefreshAt) {
    background = refreshTeams().catch(() => false).finally(() => { background = null })
  }
  if (!everLoaded) throw new Error('팀 마스터를 아직 불러오지 못했습니다.')
  return cache
}

/** 한 워크스페이스의 공용 팀(비활성 포함). 다른 워크스페이스 팀·프로젝트 팀은 없다. 로드 전이면 throw(snapshotSync). */
export function teamsForWorkspaceSync(workspaceId: string): readonly Team[] {
  return snapshotSync().teams.filter(t => t.projectId === null && t.workspaceId === workspaceId)
}

/** 활성 팀 코드(정렬됨) — 한 워크스페이스의 공용 팀만. 실패 의미는 teamsForWorkspaceSync 와 같다. */
export function activeTeamCodesForWorkspaceSync(workspaceId: string): TeamCode[] {
  return activeCodes(teamsForWorkspaceSync(workspaceId))
}

/** 여러 워크스페이스의 활성 공용 팀(코드 중복은 첫 것만) — 앱 레이아웃 TeamsProvider 용. 워크스페이스는 actor 에서 온다. */
export function activeTeamsForWorkspacesSync(workspaceIds: Iterable<string>): Team[] {
  return activeTeamsForWorkspaces(snapshotSync().teams, workspaceIds)
}

/** 조회자가 볼 수 있는 활성 팀 코드 — 회의록 담당 필터·검증(채팅·외부 GET·봇). view 는 domain/authz 의
 *  teamViewOf(actor, …)·teamViewOfScope(accessScope) 로만 만든다 — 호출부가 { all: true } 를 짓지 않는다. */
export function activeTeamCodesVisibleToSync(view: TeamView): TeamCode[] {
  return teamCodesVisibleTo(snapshotSync().teams, view)
}

/** 프로젝트 화면용 — 프로젝트 행 있으면 그것만, 없으면 그 프로젝트 워크스페이스의 공용 팀(비활성 포함).
 *  로드 전이면 throw, 로드는 됐는데 모르는 pid(존재하지 않는 프로젝트)면 빈 목록 — 둘을 구분한다. */
export function teamsForProjectSync(projectId: string): readonly Team[] {
  const snap = snapshotSync()
  return resolveTeamsForProject(snap.teams, projectId, snap.projectWorkspace.get(projectId) ?? null)
}

/** 폴백 없는 프로젝트 행 원본(비활성 포함) — 설정 화면의 "공용 상속 중" 판정·목록용. */
export function projectTeamRowsSync(projectId: string): readonly Team[] {
  return snapshotSync().teams.filter(t => t.projectId === projectId)
}

/** 프로젝트가 속한 워크스페이스의 공용 팀(비활성 포함, 전용 팀 유무와 무관) — 설정 화면의 "상속할 공용 팀이 있는가" 판정용.
 *  모르는 pid 는 빈 목록. */
export function workspaceTeamsForProjectSync(projectId: string): readonly Team[] {
  const snap = snapshotSync()
  const workspaceId = snap.projectWorkspace.get(projectId)
  return workspaceId ? snap.teams.filter(t => t.projectId === null && t.workspaceId === workspaceId) : []
}

export function activeTeamCodesForProjectSync(projectId: string): TeamCode[] {
  return activeCodes(teamsForProjectSync(projectId))
}

export function isRegisteredTeamCodeForProject(code: string, projectId: string): boolean {
  return teamsForProjectSync(projectId).some(t => t.code === code)
}

export function isActiveTeamCodeForProject(code: string, projectId: string): boolean {
  return teamsForProjectSync(projectId).some(t => t.active && t.code === code)
}

// 모듈 초기화에서 최초 1회를 await 한다. lazy 면 콜드스타트 인스턴스의 첫 요청들이
// 빈 팀 목록으로 렌더된다(관리자가 추가한 팀이 순간적으로 사라져 보임).
await refreshTeams()
