import { josa } from '@/lib/i18n/particle'
import type { createServerClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import { MINUTE_FOLDER_DEPTH_MAX, NO_TEAM } from '@/lib/domain/minutes'
import type { MinuteFolderKind, TeamCode } from '@/lib/domain/types'
import { parseFolderPathValue } from '@/lib/minutes/externalApi'
import { folderKindOf } from '@/lib/minutes/folderRow'
import type { RootFoldersSetting } from '@/lib/minutes/rootFolders'
import { teamForCode } from '@/lib/minutes/teamResolve'

type DbClient = Awaited<ReturnType<typeof createServerClient>> | ReturnType<typeof createAdminClient>

/** 스냅샷 열 — 종류·팀(SP5 B2). 팀 루트의 팀 code·소속(전용/공용)은 조인으로 — 같은 범위에 같은 code 의 전용·공용 팀 루트가
 *  함께 있으면 전용을 고른다(code 단위 규칙, D18) */
const SNAPSHOT_COLS = 'id, name, parent_id, created_by, project_id, workspace_id, kind, team_id, team:teams(code, project_id)'

/** 담당 팀(code)의 팀 루트 폴더 id — 신규 회의록 자동 편철용(SP5 B2: kind = team_root 의 team_id).
 *  조회 실패·폴더 부재는 null(미분류 폴백)로 로그만 남긴다 — 편철이 등록 자체를 막으면 안 됨.
 *  projectId(0076) — null 은 미지정 트리, uuid 는 그 프로젝트 전용 트리의 루트다.
 *  workspaceId(0006) — 미지정 트리는 워크스페이스마다 따로 있다. 읽기만 한다(세션 클라이언트) — 지연 생성은 ensureTeamRoot. */
export async function resolveTeamRootFolderId(
  sb: DbClient, teamCode: TeamCode, projectId: string | null, workspaceId: string,
): Promise<string | null> {
  let q = sb.from('minute_folders').select(SNAPSHOT_COLS).eq('kind', 'team_root').eq('workspace_id', workspaceId)
  q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
  const { data, error } = await q
  if (error) {
    console.error('[minutes] 팀 루트 폴더 조회 실패(미분류 폴백):', error.message)
    return null
  }
  const snap = buildFolderSnapshot(((data ?? []) as Array<Record<string, unknown>>).map(folderRowOf))
  return seedRootIdOf(snap, { projectId, workspaceId }, teamCode)
}

/* ── 폴더 스냅샷 ─────────────────────────────────────────────────────────────
 * minute_folders 는 작은 테이블이라 한 번에 읽어 인메모리로 걸어 다니는 편이
 * 경로 해석(N단 왕복)·역해석·배치 재편철(200건) 모두에서 압도적으로 싸다.
 * actions/minutes.ts 의 loadFolders 도 같은 전략이다.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FolderRow {
  id: string
  name: string
  parentId: string | null
  createdBy: string | null
  projectId: string | null   // 0076: null = 미지정 영역
  workspaceId: string        // 0006: 미지정 영역은 워크스페이스마다 따로다
  /** SP5 B2 — 없으면 일반 폴더 */
  kind?: MinuteFolderKind
  /** team_root 의 팀 code(조인) — 못 읽으면 null(그 루트는 code 로 찾지 않는다) */
  teamCode?: string | null
  /** team_root 의 팀이 전용 팀인가(조인한 팀의 project_id 가 있음) — 같은 범위·같은 code 의 전용·공용 루트 중 전용을 고른다 */
  teamOwned?: boolean
}

export interface FolderSnapshot {
  byId: Map<string, FolderRow>
  /** `${parentId} ${name}` → id. parentId 는 uuid(공백 없음)라 구분자 충돌이 없다. */
  byParentName: Map<string, string>
  /** 팀 루트(kind = team_root) `rootKey(projectId, workspaceId, 팀 code)` → id. 프로젝트 루트는 프로젝트로,
   *  미지정 루트는 워크스페이스로 가른다(0076·0006). 이름(= 팀 이름)이 아니라 팀 code 로 찾는다(SP5 B2). */
  seedRoots: Map<string, string>
  /** 지정 루트(kind = custom_root) `rootKey(projectId, workspaceId, 이름)` → id — custom 모드 정규화(v2.9) */
  customRoots: Map<string, string>
}

const childKey = (parentId: string, name: string) => `${parentId} ${name}`

/** 루트 키 — 프로젝트 루트는 프로젝트로, 미지정 루트는 워크스페이스로 가른다(id 는 uuid 라 공백 없음). */
const rootKey = (projectId: string | null, workspaceId: string | null, name: string) =>
  projectId ? `p:${projectId} ${name}` : `w:${workspaceId ?? '-'} ${name}`

/** 한 범위(프로젝트, 미지정이면 워크스페이스)의 팀 루트 id — 없으면 null. 키 형식은 이 모듈만 안다. */
export function seedRootIdOf(
  snap: FolderSnapshot, scope: { projectId: string | null; workspaceId: string }, teamCode: string,
): string | null {
  return snap.seedRoots.get(rootKey(scope.projectId, scope.workspaceId, teamCode)) ?? null
}

/** 스냅샷 행 — 조인한 팀(code·project_id)을 펼친다 */
function folderRowOf(r: Record<string, unknown>): FolderRow {
  const kind = folderKindOf(r.kind)
  const team = (Array.isArray(r.team) ? r.team[0] : r.team) as { code?: unknown; project_id?: unknown } | null | undefined
  const code = kind === 'team_root' && typeof team?.code === 'string' && team.code.trim() !== '' ? team.code.trim() : null
  return {
    id: r.id as string,
    name: r.name as string,
    parentId: (r.parent_id as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    workspaceId: r.workspace_id as string,
    kind,
    teamCode: code,
    teamOwned: code !== null && typeof team?.project_id === 'string',
  }
}

export function buildFolderSnapshot(rows: readonly FolderRow[]): FolderSnapshot {
  const snap: FolderSnapshot = { byId: new Map(), byParentName: new Map(), seedRoots: new Map(), customRoots: new Map() }
  for (const r of rows) addToFolderSnapshot(snap, r)
  return snap
}

export function addToFolderSnapshot(snap: FolderSnapshot, row: FolderRow): void {
  snap.byId.set(row.id, row)
  if (row.parentId !== null) {
    snap.byParentName.set(childKey(row.parentId, row.name), row.id)
    return
  }
  if (row.kind === 'team_root' && row.teamCode) {
    const key = rootKey(row.projectId, row.workspaceId, row.teamCode)
    const had = snap.seedRoots.get(key)
    // 같은 범위·같은 code 의 전용·공용 루트가 함께 있으면 전용(code 단위 규칙) — 공용이 이미 있으면 전용이 덮고, 전용이 있으면 공용은 넘긴다
    if (!had || (row.teamOwned && !snap.byId.get(had)?.teamOwned)) snap.seedRoots.set(key, row.id)
  } else if (row.kind === 'custom_root') {
    snap.customRoots.set(rootKey(row.projectId, row.workspaceId, row.name), row.id)
  }
}

/** 전량 로드. 실패는 null(fail-loud 로그) — 호출부가 '폴더 없음'과 구분해 처리한다. */
export async function loadFolderSnapshot(sb: DbClient): Promise<FolderSnapshot | null> {
  const { data, error } = await sb.from('minute_folders').select(SNAPSHOT_COLS)
  if (error) {
    console.error('[minutes] 폴더 스냅샷 로드 실패:', error.message)
    return null
  }
  return buildFolderSnapshot(((data ?? []) as Array<Record<string, unknown>>).map(folderRowOf))
}

/** 폴더 id → root-first 경로. 미분류(null)·끊긴 체인은 null. 순환은 가드로 끊는다.
 *  segment 'api'(기본) — 외부 계약·재편철의 경로 언어: 팀 루트는 **팀 code** 로 적는다(v2.8 의 path[0] = team 규약 그대로 —
 *  SP5 B2 이후 루트 이름은 팀 이름이라 이름을 그대로 내면 재전송·재편철이 한 칸 내림(②)으로 루트를 겹친다). 팀을 못 읽은 팀 루트는 null.
 *  segment 'display' — 화면 breadcrumb: 폴더 이름 그대로(팀 루트 = 팀 이름). */
export function folderPathOfSnapshot(
  snap: FolderSnapshot, folderId: string | null, segment: 'api' | 'display' = 'api',
): string[] | null {
  if (!folderId) return null
  const out: string[] = []
  const seen = new Set<string>()
  let cur: string | null = folderId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const node = snap.byId.get(cur)
    if (!node) return null                       // 끊긴 체인 — 추측하지 않는다
    if (segment === 'api' && node.kind === 'team_root') {
      if (!node.teamCode) return null            // 팀을 못 읽었다 — 이름으로 대신하지 않는다
      out.unshift(node.teamCode)
    } else {
      out.unshift(node.name)
    }
    cur = node.parentId
  }
  return out.length > 0 ? out : null
}

/** folderId 와 그 조상 전부의 id 집합(자기 자신 포함). 순환·끊긴 체인은 거기서 끊는다.
 *  배치의 **조상 규칙**(결정 §2-J) 판정용 — 현재 위치가 목표 경로의 조상이면 더 깊게 넣는 것이
 *  사람의 정리를 훼손하지 않으므로 이동한다. */
export function ancestorIdsOf(snap: FolderSnapshot, folderId: string | null): Set<string> {
  const out = new Set<string>()
  let cur: string | null = folderId
  while (cur && !out.has(cur)) {
    out.add(cur)
    cur = snap.byId.get(cur)?.parentId ?? null
  }
  return out
}

/** 응답 에코(§3.3)용 역해석 단건 — folder_path 를 받지 않은 재전송·skip 응답에서 쓴다(팀 루트 = 팀 code).
 *  'display' 는 뷰어 breadcrumb(폴더 이름). */
export async function folderPathOf(
  sb: DbClient, folderId: string | null, segment: 'api' | 'display' = 'api',
): Promise<string[] | null> {
  if (!folderId) return null
  const snap = await loadFolderSnapshot(sb)
  return snap ? folderPathOfSnapshot(snap, folderId, segment) : null
}

/* ── folder_path 편철 (계약 v2.3 §3.2) ───────────────────────────────────────── */

export type FolderPathNormalized =
  | { ok: true; path: string[]; truncated: boolean }
  | { ok: false; error: string; reason: string }

/**
 * §3.2 정규화 — 또박또박 폴더 구조는 자유라 루트명이 팀코드가 아닐 수 있다.
 *
 *   ① path[0] === team              → path 그대로
 *   ② path[0] ∉ 활성 팀코드          → [team, ...path] (한 칸 내림)
 *   ③ path[0] ∈ 활성 팀코드(타 팀)    → 거절
 *   ④ 정규화 후 깊이 5 초과분은 절단
 *
 * 결과 경로의 **첫 세그먼트는 항상 teamCode** 다 — 외부 API 는 루트를 만들지 않는다(C2).
 *
 * ⚠️ ①에 팀코드 캐시 조회를 넣지 말 것. path[0] === team 이면 그 팀 루트로 편철하는 것이
 *    정의상 맞고, 넣으면 해롭다: 관리자가 팀을 비활성화하면 team_code='MDM' 인 기존 전송분의
 *    배치 재편철이 ①에서 탈락해 ②로 떨어져 ["MDM","MDM","품질"]처럼 루트 세그먼트가
 *    중복된다. minute_folders_child_name_uniq 는 부분 인덱스라 이를 막지 못한다(C3).
 *
 * ⚠️ 캐시 stale 시 degrade 방향을 뒤집지 말 것 — 캐시에 없는 값은 ②(자유 폴더 취급)로
 *    빠지지 ③(거절)으로 가지 않는다. "모르는 값은 거절"이 아니라 "모르는 값은 자유 폴더".
 */
export function normalizeFolderPath(
  teamCode: TeamCode,
  path: readonly string[],
  activeTeamCodes: readonly string[],
): FolderPathNormalized {
  // [] = 명시적 '폴더 없음' → 팀 루트. 키 부재(=기존 위치 유지)와는 호출부가 구분한다.
  if (path.length === 0) return { ok: true, path: [teamCode], truncated: false }

  let normalized: string[]
  if (path[0] === teamCode) {
    normalized = [...path]                                   // ① 단독 조건 — 캐시 무관
  } else if (!activeTeamCodes.includes(path[0])) {
    normalized = [teamCode, ...path]                         // ② 한 칸 내림
  } else {
    // ③ 조용히 한쪽을 따르면 목록 필터(?team=)와 폴더 위치가 어긋난다
    return {
      ok: false,
      error: `folder_path의 최상위 ${josa(`'${path[0]}'`, '이/가')} 담당 ${josa(`'${teamCode}'`, '과/와')} 다른 팀입니다.`,
      reason: `validation_failed: folder_path 최상위가 다른 팀(${path[0]})입니다.`,
    }
  }

  const truncated = normalized.length > MINUTE_FOLDER_DEPTH_MAX
  return {
    ok: true,
    path: truncated ? normalized.slice(0, MINUTE_FOLDER_DEPTH_MAX) : normalized,
    truncated,
  }
}

export type ResolveFolderPathResult =
  | {
      ok: true
      /** 확보된 폴더 id. complete 가 false 면 목표 경로의 **조상**이다. */
      folderId: string
      /** folderId 가 실제로 있는 경로 — 등록 응답 에코(§3.3)는 **이것**을 쓴다(진실된 위치). */
      resolvedPath: string[]
      /** 목표 경로 전체 — 절단·한 칸 내림이 반영된 결과. 배치의 `to` 는 이것을 쓴다. */
      targetPath: string[]
      /** folderId 가 targetPath 의 끝인가. */
      complete: boolean
      /** complete 가 false 인 이유가 **생성 실패**인가(false = dry run 미생성). */
      failed: boolean
      /** 깊이 5 초과로 절단됐는가(§3.2-4). */
      truncated: boolean
    }
  | {
      ok: false
      /** no_team_root = §3.2-5 팀 루트 부재·지연 생성 실패. unmatched_root = custom 모드에서 path[0] 이 지정 루트가 아님(v2.9).
       *  처리는 호출자가 정한다(등록=미분류 폴백 / 배치=failed). */
      kind: 'no_team_root' | 'unmatched_root' | 'validation_failed'
      /** POST /minutes 400 본문용 한국어 메시지. */
      error: string
      /** 배치 응답 results[].reason 문자열(§8.2 요건 11). */
      reason: string
    }

/** 부모 아래 자식 폴더 생성 — 실패는 null(호출부가 흡수).
 *
 *  C3: minute_folders_child_name_uniq 는 부분 인덱스(where parent_id is not null)라
 *  ON CONFLICT 가 conflict 대상 추론에 실패해 42P10 이 된다. 그래서 insert → 23505 면
 *  재조회로 동시 전송 경합을 흡수한다(minutes upsert 가 쓰는 것과 같은 우회).
 *  C4: created_by 는 전송 사용자 id(작성자) — 폴더 종류는 kind 가 정한다(SP5 B2).
 *  projectId(0076) — 부모와 같은 프로젝트(자식 project_id = 부모 project_id 불변식). */
async function createChildFolder(
  sb: DbClient, parentId: string, name: string, actorId: string, projectId: string | null,
): Promise<string | null> {
  const { data, error } = await sb.from('minute_folders')
    .insert({ name, parent_id: parentId, created_by: actorId, project_id: projectId })
    .select('id').single()
  if (!error && data) return (data as { id: string }).id
  if (error?.code === '23505') {
    const { data: raced, error: reErr } = await sb.from('minute_folders')
      .select('id').eq('parent_id', parentId).eq('name', name).maybeSingle()
    if (!reErr && raced) return (raced as { id: string }).id
    console.error(`[minutes] 폴더 경합 재조회 실패(${name}):`, reErr?.message ?? 'no row')
    return null
  }
  console.error(`[minutes] 폴더 생성 실패(${name}):`, error?.message ?? 'no row')
  return null
}

/** 최상위 루트 한 행 생성(service_role 필수 — 세션은 종류 가드가 일반 폴더만 허용한다, 0024) — 23505 는 동시 생성 경합이면
 *  재조회로 흡수하고, 같은 범위의 다른 루트가 이름을 쓰고 있으면 null(미분류 폴백). 실패는 null + 로그 */
async function insertRoot(
  sb: DbClient,
  row: { name: string; projectId: string | null; workspaceId: string; kind: 'team_root' | 'custom_root'; teamId: string | null },
  reread: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<string | null> {
  const { data, error } = await sb.from('minute_folders')
    .insert({ name: row.name, parent_id: null, created_by: null, project_id: row.projectId, workspace_id: row.workspaceId,
      kind: row.kind, team_id: row.teamId, sort: 100 })
    .select('id').single()
  if (!error && data) return (data as { id: string }).id
  if (error?.code === '23505') {
    const { data: raced, error: reErr } = await reread()
    if (!reErr && raced) return (raced as { id: string }).id
  }
  console.error(`[minutes] 최상위 폴더 생성 실패(${row.kind} ${row.name}):`, error?.message ?? 'no row')
  return null
}

/** 팀 루트 지연 보장(SP5 B2 — D50 ④ 지연 수렴 포함) — 그 범위에서 code 단위로 고른 **활성** 팀의 루트를 만든다(이름 = 팀 이름).
 *  teams 모드의 편철·업로드 경로만 부른다(custom 모드의 새 팀은 루트를 만들지 않는다). admin 클라이언트 필수.
 *  팀 조회 실패·팀 없음·비활성은 null(호출부 미분류 폴백). 스냅샷 반영용 행을 돌려준다. */
export async function ensureTeamRoot(
  sb: DbClient, scope: { projectId: string | null; workspaceId: string }, teamCode: TeamCode,
): Promise<FolderRow | null> {
  let tq = sb.from('teams').select('id, code, name, project_id, active').eq('workspace_id', scope.workspaceId).eq('code', teamCode)
  tq = scope.projectId ? tq.or(`project_id.is.null,project_id.eq.${scope.projectId}`) : tq.is('project_id', null)
  const { data: rows, error: tErr } = await tq
  if (tErr) {
    console.error(`[minutes] 팀 루트 보장 — 팀 조회 실패(${teamCode}):`, tErr.message)
    return null
  }
  const teams = ((rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: r.id as string, code: String(r.code).trim(), name: String(r.name).trim(),
    projectId: (r.project_id as string | null) ?? null, active: r.active !== false,
  }))
  const team = teamForCode(teams, scope, teamCode)
  if (!team || !team.active) return null
  const reread = () => {
    let q = sb.from('minute_folders').select('id').eq('kind', 'team_root').eq('team_id', team.id).eq('workspace_id', scope.workspaceId)
    q = scope.projectId ? q.eq('project_id', scope.projectId) : q.is('project_id', null)
    return q.maybeSingle()
  }
  const id = await insertRoot(sb, { name: team.name, projectId: scope.projectId, workspaceId: scope.workspaceId, kind: 'team_root', teamId: team.id }, reread)
  return id ? { id, name: team.name, parentId: null, createdBy: null, projectId: scope.projectId, workspaceId: scope.workspaceId,
    kind: 'team_root', teamCode, teamOwned: team.projectId !== null } : null
}

/** 지정 루트(custom_root) 지연 보장 — custom 모드에서 path[0] 이 설정 names 에 있는데 그 범위에 루트가 아직 없을 때(v2.9). admin 필수 */
async function ensureCustomRoot(
  sb: DbClient, scope: { projectId: string | null; workspaceId: string }, name: string,
): Promise<FolderRow | null> {
  const reread = () => {
    let q = sb.from('minute_folders').select('id').eq('kind', 'custom_root').eq('name', name).eq('workspace_id', scope.workspaceId)
    q = scope.projectId ? q.eq('project_id', scope.projectId) : q.is('project_id', null)
    return q.maybeSingle()
  }
  const id = await insertRoot(sb, { name, projectId: scope.projectId, workspaceId: scope.workspaceId, kind: 'custom_root', teamId: null }, reread)
  return id ? { id, name, parentId: null, createdBy: null, projectId: scope.projectId, workspaceId: scope.workspaceId, kind: 'custom_root' } : null
}

/**
 * folder_path → 편철 대상 폴더 id (§3.2). 팀 루트 아래에 같은 폴더 트리를 만들어 편철한다.
 *
 * POST /minutes(등록)와 POST /minutes/folder(배치 재편철)가 **공유**한다 — 별도 구현을 만들면
 * 마이그레이션 결과와 이후 전송 결과가 어긋난다(§8.2 요건 1).
 *
 * ⚠️ teamCode 는 **필수·구체값**이다. 배치의 items[].team 이 선택인 것은 배치 라우트의 책임 —
 *    라우트가 먼저 team 을 확정한 뒤 확정값으로 이 함수를 부른다. 여기에 teamCode 옵션 분기를
 *    만들지 말 것(두 번째 정규화 구현이 생기는 통로다).
 *
 * rootMode(SP5 B2 — 계약 v2.9): 없거나 teams 면 v2.8 정규화 그대로(팀 루트 = 팀 code 로 찾는다). custom 이면 path[0] 이 그 범위의
 * 지정 루트 이름이거나 설정 names 에 있을 때만 그 아래로 편철하고(②·③ 없음), 아니면 unmatched_root(호출부가 미분류로 저장).
 */
export async function resolveFolderPath(
  sb: DbClient,
  teamCode: TeamCode,
  path: readonly string[],
  opts: {
    actorId: string
    activeTeamCodes: readonly string[]
    /** 배치가 미리 읽어 둔 스냅샷 — 항목당 왕복을 없앤다. 생성분은 여기 반영돼 다음 항목이 재사용한다. */
    snapshot?: FolderSnapshot
    /** false = 폴더를 만들지 않는다(dry run). 없는 경로는 complete:false·failed:false 로 보고. */
    create?: boolean
    /** 0076 — null 은 미지정 트리, uuid 는 그 프로젝트 전용 트리. 필수라 전 호출부가
     *  스코프를 명시하게 강제한다. */
    projectId: string | null
    /** 0006 — 루트를 고르는 워크스페이스. 없으면 루트를 고르지 않는다(no_team_root — 다른 워크스페이스 루트에 편철하지 않는다).
     *  프로젝트 루트의 지연 생성도 이 워크스페이스의 팀으로 고른다. */
    workspaceId: string | null
    /** 워크스페이스의 최상위 폴더 모드(minutes.root_folders) — 없으면 teams(v2.8) */
    rootMode?: RootFoldersSetting
  },
): Promise<ResolveFolderPathResult> {
  const parsed = parseFolderPathValue(path)
  if (!parsed.ok) return { ok: false, kind: 'validation_failed', error: parsed.error, reason: parsed.reason }
  if (opts.rootMode?.mode === 'custom') return resolveCustomFolderPath(sb, parsed.path, { ...opts, names: opts.rootMode.names })
  // 팀 없는 회의록(0052)은 teams 모드에서 편철할 팀 루트가 없다 — 정규화(팀 code 를 경로 머리에 붙인다)에 빈 값을 넣지 않고 여기서 끝낸다.
  // 등록은 미분류로 저장하고 배치는 failed(no_team_root)로 보고한다(호출부의 기존 no_team_root 처리 그대로). custom 모드는 위에서 팀과 무관하게 편철한다
  if (teamCode === NO_TEAM) {
    return { ok: false, kind: 'no_team_root', error: '팀 없는 회의록은 팀 폴더에 편철하지 않습니다.', reason: 'no_team_root' }
  }
  const norm = normalizeFolderPath(teamCode, parsed.path, opts.activeTeamCodes)
  if (!norm.ok) return { ok: false, kind: 'validation_failed', error: norm.error, reason: norm.reason }

  const snap = opts.snapshot ?? await loadFolderSnapshot(sb)
  // 프로젝트 루트는 프로젝트로 찾는다(키에 워크스페이스가 없다). 미지정 루트와 지연 생성(팀 조회)에는 워크스페이스가 필요하다
  if (!opts.projectId && !opts.workspaceId) console.error('[minutes] 미지정 트리 해석에 workspaceId 가 없다 — 루트를 고르지 않는다')
  let rootId = opts.projectId || opts.workspaceId
    ? snap?.seedRoots.get(rootKey(opts.projectId, opts.workspaceId, teamCode)) ?? null
    : null
  const scope = opts.workspaceId ? { projectId: opts.projectId, workspaceId: opts.workspaceId } : null
  // snap 을 앞세운다 — loadFolderSnapshot 실패(null)면 조회 자체가 실패한 것이라 지연 생성도
  // 하지 않는다(쓰기 전 선행 조회 실패는 중단). snap 이 있어야만 아래 addToFolderSnapshot(snap, …)
  // 의 "rootId 가 있으면 snap 도 있다" 불변식이 성립한다. 미지정 트리의 지연 생성은 D50 ④ 지연 수렴(teams 모드에 루트 없는 활성 공용 팀)
  if (snap && scope && !rootId && opts.create !== false && opts.activeTeamCodes.includes(teamCode)) {
    const root = await ensureTeamRoot(sb, scope, teamCode)
    if (root) {
      rootId = root.id
      addToFolderSnapshot(snap, root)
    }
  }
  if (!rootId) {
    // §3.2-5. 스냅샷 로드 실패면 위에서 이미 로그가 남는다
    return {
      ok: false,
      kind: 'no_team_root',
      error: `담당 '${teamCode}'의 기본 폴더가 없습니다.`,
      reason: 'no_team_root',
    }
  }
  return walkFolderPath(sb, snap!, rootId, norm.path, norm.truncated, opts)
}

/** custom 모드 정규화(v2.9) — path[0] 이 그 범위의 지정 루트(또는 설정 names — 없으면 만든다)일 때만 그 아래로. 깊이 절단은 v2.8 그대로 */
async function resolveCustomFolderPath(
  sb: DbClient, path: readonly string[],
  opts: { actorId: string; snapshot?: FolderSnapshot; create?: boolean; projectId: string | null; workspaceId: string | null; names: readonly string[] },
): Promise<ResolveFolderPathResult> {
  const unmatched = (why: string): ResolveFolderPathResult =>
    ({ ok: false, kind: 'unmatched_root', error: `folder_path 의 최상위가 지정 폴더가 아닙니다: ${why}`, reason: 'unmatched_root' })
  if (path.length === 0) return unmatched('(빈 경로)')
  const snap = opts.snapshot ?? await loadFolderSnapshot(sb)
  if (!snap || !opts.workspaceId) {
    if (!opts.workspaceId) console.error('[minutes] 폴더 경로 해석에 workspaceId 가 없다 — 루트를 고르지 않는다')
    return { ok: false, kind: 'no_team_root', error: '최상위 폴더를 확인하지 못했습니다.', reason: 'no_team_root' }
  }
  const scope = { projectId: opts.projectId, workspaceId: opts.workspaceId }
  const head = path[0]
  let rootId = snap.customRoots.get(rootKey(scope.projectId, scope.workspaceId, head)) ?? null
  if (!rootId && opts.create !== false && opts.names.includes(head)) {
    const root = await ensureCustomRoot(sb, scope, head)
    if (root) { rootId = root.id; addToFolderSnapshot(snap, root) }
  }
  if (!rootId) return unmatched(head)
  const truncated = path.length > MINUTE_FOLDER_DEPTH_MAX
  return walkFolderPath(sb, snap, rootId, truncated ? path.slice(0, MINUTE_FOLDER_DEPTH_MAX) : [...path], truncated, opts)
}

/** 루트 아래로 경로를 걸어 내려가며 없는 폴더를 만든다(두 모드 공용) */
async function walkFolderPath(
  sb: DbClient, snap: FolderSnapshot, rootId: string, target: string[], truncated: boolean,
  opts: { actorId: string; create?: boolean; projectId: string | null },
): Promise<ResolveFolderPathResult> {
  const create = opts.create !== false
  const base = { targetPath: target, truncated } as const
  let cur = rootId
  const resolvedPath = [target[0]]
  for (const name of target.slice(1)) {
    const hit = snap.byParentName.get(childKey(cur, name))
    if (hit) { cur = hit; resolvedPath.push(name); continue }
    // dry run — 만들지 않고 "여기까지만 실재한다"를 보고한다(쓰기 0).
    if (!create) return { ok: true, ...base, folderId: cur, resolvedPath, complete: false, failed: false }
    const created = await createChildFolder(sb, cur, name, opts.actorId, opts.projectId)
    // 생성 실패는 조상까지만 편철 — 등록 자체를 막지 않는다. 배치는 이걸 failed 로 읽는다.
    if (!created) return { ok: true, ...base, folderId: cur, resolvedPath, complete: false, failed: true }
    addToFolderSnapshot(snap, {
      id: created, name, parentId: cur, createdBy: opts.actorId, projectId: opts.projectId,
      workspaceId: snap.byId.get(cur)!.workspaceId,   // 트리거가 부모에서 채운 값과 같다
      kind: 'user',
    })
    cur = created
    resolvedPath.push(name)
  }
  return { ok: true, ...base, folderId: cur, resolvedPath, complete: true, failed: false }
}

/** 프로젝트 이동 후 폴더 추종 — 같은 경로를 새 프로젝트 트리에 확보해 folder_id 만 바꾼다.
 *  실패해도 프로젝트 이동 자체를 되돌리지 않는다(편철은 등록·이동을 막지 않는다).
 *  updateMinuteMeta·assignMinutesProject 가 프로젝트가 실제로 바뀐 뒤에만 부른다.
 *  회의록 team_id 는 프로젝트 변경을 본 메아리 트리거가 새 범위로 다시 해석한다(SP5 B2 — S13). 경로의 팀 루트 칸은 팀 code 라
 *  새 범위에서도 같은 code 단위 규칙으로 루트를 고른다. custom 모드에서는 워크스페이스 폴더(project_id null)를 그대로 둔다(개정 §4.7 표). */
export async function refileMinuteAfterProjectChange(
  admin: DbClient,
  args: {
    minuteId: string
    teamCode: TeamCode
    oldFolderId: string | null
    newProjectId: string | null
    actorId: string
    activeTeamCodes: readonly string[]
    /** 배치가 미리 읽어 둔 스냅샷 — 건별 로드를 없앤다. resolveFolderPath 가 생성분을
     *  이 스냅샷에 반영하므로 다음 항목이 재사용한다(assignMinutesProject 200건 상한). */
    snapshot?: FolderSnapshot
    /** 워크스페이스의 최상위 폴더 모드 — 없으면 teams */
    rootMode?: RootFoldersSetting
  },
): Promise<void> {
  if (!args.oldFolderId) return                       // 미분류는 미분류로 남긴다(추측 금지)
  const snap = args.snapshot ?? await loadFolderSnapshot(admin)
  if (!snap) return                                    // 실패 로그는 loadFolderSnapshot 이 남김
  const old = snap.byId.get(args.oldFolderId)
  if (args.rootMode?.mode === 'custom' && old && old.projectId === null) return   // 워크스페이스 폴더는 유지
  const oldPath = folderPathOfSnapshot(snap, args.oldFolderId)
  if (!oldPath) return                                 // 끊긴 체인·팀을 못 읽은 루트 — 건드리지 않는다
  // 회의록의 워크스페이스 = 옛 폴더의 워크스페이스(RPC 가 폴더·회의록 워크스페이스 일치를 강제한다, 0006).
  // 미지정으로 옮길 때 그 워크스페이스의 미지정 트리에서 해석한다.
  const res = await resolveFolderPath(admin, args.teamCode, oldPath, {
    actorId: args.actorId, activeTeamCodes: args.activeTeamCodes,
    snapshot: snap, projectId: args.newProjectId,
    workspaceId: snap.byId.get(args.oldFolderId)!.workspaceId, rootMode: args.rootMode,
  })
  const folderId = res.ok ? res.folderId : null        // no_team_root·unmatched_root → 미분류 강등
  // updated_at 무접촉 — 편철 정리가 외부 연동 GET 에 '방금 수정됨'으로 비치면 안 된다(0043 규칙)
  // .eq('folder_id', args.oldFolderId) 는 compare-and-set — 이 값을 읽은 뒤 다른 요청이
  // 같은 회의록을 명시적으로 다른 폴더로 옮겼으면 0행 매치라 그 선택을 덮지 않는다.
  // args.oldFolderId 는 이 지점에서 이미 non-null(위에서 null 은 조기 반환).
  const { data, error } = await admin.from('minutes')
    .update({ folder_id: folderId })
    .eq('id', args.minuteId)
    .eq('folder_id', args.oldFolderId)
    .select('id')
  if (error) {
    console.error('[minutes] 프로젝트 이동 재편철 실패:', args.minuteId, error.message)
  } else if (!data || data.length === 0) {
    // no-op 은 정상 동작이다 — 동시 명시 이동이 우선이라 침묵하지 않고 정보만 남긴다.
    console.info('[minutes] 재편철 건너뜀(동시 이동 감지):', args.minuteId)
  }
}
