import 'server-only'

// ============================================================================
// 팀 기준정보 런타임 캐시 — lib/ai/llm-override.ts 와 동일한 검증된 패턴.
// 동기 소비처(레이아웃·AI 도구·레포 매핑)가 많아 동기 접근자 + TTL 백그라운드 갱신.
// service_role 로 읽는 이유: 캐시는 프로세스 전역이라 사용자 세션 컨텍스트가 없다(읽기 전용 select).
// 캐시는 전 워크스페이스의 팀을 담는다 — 한 워크스페이스로 좁히는 것은 접근자의 몫이다(teamsForWorkspaceSync, SP2 §4.2).
// ============================================================================

import { activeCodes, resolveTeamsForProject, type Team } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'
import { createAdminClient } from '@/lib/supabase/admin'

const TTL_MS = 60_000
const LOAD_TIMEOUT_MS = 3_000
/** 로드 실패 후 재시도 간격 — 실패에 TTL 전체를 물리면 stale 구간이 불필요하게 길어진다. */
const RETRY_MS = 10_000

let cache: readonly Team[] = []
/** 한 번이라도 DB 로드에 성공했는가 — 실패 시 '직전 유효값 보존 vs 빈 목록'을 가르는 기준. */
let everLoaded = false
let nextRefreshAt = 0
/** 로드 직렬화 큐 — 동시 로드가 끝나는 순서에 따라 옛 스냅샷이 캐시를 덮는 것을 막는다. */
let queue: Promise<unknown> = Promise.resolve()
let background: Promise<unknown> | null = null

async function fetchTeams(): Promise<readonly Team[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('teams')
    .select('id, code, sort_order, active, progress_visible, project_id, workspace_id')
    .order('sort_order')
    .order('code')
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Array<Record<string, unknown>>
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
    cache = await withTimeout(fetchTeams(), LOAD_TIMEOUT_MS)
    everLoaded = true
    nextRefreshAt = Date.now() + TTL_MS
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 직전 유효값을 버리지 않는다 — DB 순단 한 번으로 팀 목록이 빈 목록으로 되돌아가면
    // 관리자가 추가한 팀이 화면·검증에서 조용히 사라진다.
    if (!everLoaded) console.error('[teams] 최초 팀 마스터 로드 실패 — 빈 목록으로 기동:', message)
    else console.error('[teams] 팀 마스터 갱신 실패 — 직전 값을 유지합니다:', message)
    nextRefreshAt = Date.now() + RETRY_MS
    return false
  }
}

/** DB 즉시 재조회 + 캐시 교체. 팀 관리 액션 저장 후 await 한다.
 *  진행 중 로드에 편승하지 않고 큐에 이어 붙이는 이유는 llm-override 의 동명 함수 주석 참조
 *  (편승하면 저장 직후 캐시가 옛 값으로 확정된 채 TTL 을 탄다). */
export function refreshTeams(): Promise<boolean> {
  const next = queue.then(load, load)
  queue = next.then(() => {}, () => {})
  return next
}

/** 전체 캐시(전역+프로젝트, 비활성 포함). 내부용 — 외부는 아래 스코프 접근자를 쓴다. */
function allTeamsSync(): readonly Team[] {
  if (!background && Date.now() >= nextRefreshAt) {
    background = refreshTeams().catch(() => false).finally(() => { background = null })
  }
  return cache
}

/** 전역 팀(비활성 포함) — 회의록·또박또박·계정 등 프로젝트 축 없는 화면의 유일한 소스.
 *  프로젝트 팀은 여기 절대 섞이지 않는다(스펙 봉쇄 지점).
 *  ⚠️ 전 워크스페이스의 공용 팀이 섞여 있다 — 검증 전용으로 남긴 옛 접근자다. 새 코드는 teamsForWorkspaceSync 를
 *  쓴다(남은 호출처는 actions/minutes.ts 등 — Task 16 이 옮긴다, 캐시 구조는 SP4 R10). */
export function teamsSync(): readonly Team[] {
  return allTeamsSync().filter(t => t.projectId === null)
}

/** 활성 팀 코드(정렬됨) — 탭·필터·검증 공용(전역 전용). */
export function activeTeamCodesSync(): TeamCode[] {
  return activeCodes(teamsSync())
}

/** 비활성 포함 등록 여부(전역 전용) — 기존 데이터 표시·시드 폴더 앵커 보호·엑셀 임포트 검증용. */
export function isRegisteredTeamCode(code: string): boolean {
  return teamsSync().some(t => t.code === code)
}

/** 활성 팀 여부(전역 전용) — 신규 입력 검증용(비활성 팀으로의 새 등록은 거부). */
export function isActiveTeamCode(code: string): boolean {
  return teamsSync().some(t => t.active && t.code === code)
}

/** 한 워크스페이스의 공용 팀(비활성 포함) — teamsSync 의 워크스페이스판. 다른 워크스페이스 팀·프로젝트 팀은 없다.
 *  캐시를 한 번도 채우지 못했으면 throw 한다 — 조회 실패를 "팀 없음"으로 위장하지 않는다(에러 3원칙).
 *  정상 로드 뒤의 갱신 실패는 직전 값을 그대로 쓴다(stale ≠ 실패, load 주석 참조). */
export function teamsForWorkspaceSync(workspaceId: string): readonly Team[] {
  const all = allTeamsSync()
  if (!everLoaded) throw new Error('팀 마스터를 아직 불러오지 못했습니다.')
  return all.filter(t => t.projectId === null && t.workspaceId === workspaceId)
}

/** 활성 팀 코드(정렬됨) — 한 워크스페이스의 공용 팀만. 실패 의미는 teamsForWorkspaceSync 와 같다. */
export function activeTeamCodesForWorkspaceSync(workspaceId: string): TeamCode[] {
  return activeCodes(teamsForWorkspaceSync(workspaceId))
}

/** 프로젝트 화면용 — 프로젝트 행 있으면 그것만, 없으면 전역 폴백(비활성 포함). */
export function teamsForProjectSync(projectId: string): readonly Team[] {
  return resolveTeamsForProject(allTeamsSync(), projectId)
}

/** 폴백 없는 프로젝트 행 원본(비활성 포함) — 설정 화면의 "전역 상속 중" 판정·목록용. */
export function projectTeamRowsSync(projectId: string): readonly Team[] {
  return allTeamsSync().filter(t => t.projectId === projectId)
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
