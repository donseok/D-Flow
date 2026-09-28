'use server'
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adminFor } from '@/lib/supabase/adminFor'
import { getActorViewState, requireProjectAdmin, requireWorkspaceAdmin } from '@/lib/authz'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { ERR_DENIED } from '@/lib/authz/errors'
import { canSeeProject } from '@/lib/domain/authz'
import { isUuidLike, isValidDateRange } from '@/lib/domain/validate'
import { treeMaxDepth, validateLevelSettings } from '@/lib/domain/levelSettings'
import { validateStageCredits } from '@/lib/domain/stageCredits'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { refreshTeams } from '@/lib/teams/master'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { PROJECT_SETTINGS, SETTINGS_SCHEMA_VERSION, settingDef } from '@/lib/settings/registry'
import { allowedAndAvailable } from '@/lib/settings/validateConfig'
import { intersectEnabledWithAllowed } from '@/lib/modules/saveRule'
import { closeRequires } from '@/lib/modules/closure'
import { CORE, moduleDef } from '@/lib/modules/registry'
import { PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import { CONFIG_MESSAGES, ConfigUnavailableError, mapDbError } from '@/lib/settings/errors'

export async function listProjects() {
  return (await listProjectsWithState()).projects
}

/**
 * listProjects 와 같은 폴백을 하되 **실패했다는 사실을 함께 돌려준다**.
 *
 * `[]` 하나로는 "프로젝트가 없는 계정"과 "목록을 못 읽은 상태"가 구분되지 않는다.
 * REST 장애 때 화면이 후자를 전자로 그려 '첫 프로젝트를 만들어 보세요' 를
 * 띄웠다 — 데이터가 멀쩡한데 신규 가입자 화면처럼 보였다. 로그는 남았지만 표시가 없었다.
 */
export async function listProjectsWithState() {
  // 인증 재확인은 getActorViewState 안의 getUser 가 겸한다 — 별도 getSession 선행 게이트를
  // 두면 그 한 번의 왕복이 모든 호출부(레이아웃 포함)의 직렬 1단이 된다(2026-08-18 성능 감사).
  // 비로그인: actor 가 null(degraded=false)이고 fetchProjects 는 RLS(authenticated 읽기)로
  // 빈 배열이므로 종전의 { projects: [], degraded: false } 와 동일한 결과가 된다.
  // (조기 반환이 Promise.all 뒤로 옮겨져 버려지는 프라미스가 없다 — unhandled rejection 흡수 불필요.)
  const [{ data, error }, actorState] = await Promise.all([fetchProjects(), getActorViewState()])
  const actor = actorState.actor
  if (!actor && !actorState.degraded) return { projects: [] as ProjectRow[], degraded: false }
  // 순수 표시용 조회라 폴백([])을 유지한다 — throw 하면 (app)/layout.tsx 가 호출하므로
  // 프로젝트 목록 하나 깨진 것으로 앱 전 페이지가 에러 화면이 된다(로그인 후 아무 데도 못 감).
  // 이 목록의 '0건'을 근거로 쓰기/삭제를 판단하는 경로는 없어서(생성은 채번·중복검사에 쓰지 않음)
  // 데이터가 손상되지는 않는다. 대신 빈 사이드바의 원인이 사라지지 않도록 로그는 반드시 남긴다.
  if (error) console.error('[listProjects] 조회 실패:', error.message)
  // 비공개 프로젝트(0070)는 역할 보유자·슈퍼유저에게만. 권한 조회 실패(actor null)면
  // 비공개만 빠진 채 공개 목록은 유지된다 — fail-closed 이되 화면 전체를 죽이지 않는다.
  const visible = (data ?? []).filter(p => canSeeProject(actor, p))
  return { projects: visible, degraded: Boolean(error) }
}

type ProjectRow = NonNullable<Awaited<ReturnType<typeof fetchProjects>>['data']>[number]

// cache(): 레이아웃과 페이지(예: wiki)가 같은 요청에서 listProjectsWithState 를 각자 불러도
// projects 조회는 1회만 나간다. 'use server' 파일의 export 는 async 함수여야 하므로
// 모듈 내부 헬퍼에만 래핑한다.
const fetchProjects = cache(async () => {
  const sb = await createServerClient()
  return sb.from('projects').select('*').order('created_at', { ascending: false })
})

export interface CreateProjectInput {
  workspaceId: string; name: string; startDate: string | null; endDate: string | null; description: string | null
  levelLabels: string[]; copyFromProjectId?: string | null; commandId: string
}
export type CreateProjectResult =
  | { ok: true; projectId: string; status: 'applied' | 'duplicate' }
  | { ok: false; code: string; error: string; fieldErrors?: { key: string; message: string }[] }

const invalidInput = (error: string, fieldErrors?: { key: string; message: string }[]): CreateProjectResult =>
  ({ ok: false, code: 'CONFIG_INVALID', error, ...(fieldErrors ? { fieldErrors } : {}) })
const denied: CreateProjectResult = { ok: false, code: ERR_DENIED, error: ERR_DENIED }
/** 원인(DB 원문 포함)은 로그로, 사용자에게는 고정 문구만 — 표시 = 로깅(설정 액션의 unavailableLogged 와 같은 태도) */
function unavailableLogged(what: string, ctx: { workspaceId: string; copyFrom: string | null; commandId: string }, cause: string): CreateProjectResult {
  console.error(`[createProject] ${what} 실패`, { ...ctx, cause })
  return { ok: false, code: 'CONFIG_UNAVAILABLE', error: CONFIG_MESSAGES.CONFIG_UNAVAILABLE }
}

/** 생성 시점의 modules.enabled — 후보 ∩ (허용 ∩ env) 에서 requires 가 빠진 것을 뺀다. 자동 추가는 없다 */
function initialEnabled(candidate: readonly ModuleId[], allowed: readonly ModuleId[]): ModuleId[] {
  const chosen = intersectEnabledWithAllowed(candidate, allowed)
  const wsLayer = allowed.filter((id) => !PROJECT_TOGGLABLE.has(id))
  const closed = closeRequires(new Set<ModuleId>([...CORE, ...wsLayer, ...chosen]), (id) => moduleDef(id).requires)
  return chosen.filter((id) => closed.has(id))
}

/**
 * 프로젝트 생성(스펙 §3.3 W1) — 프로젝트 행과 필수 설정을 create_project_with_settings 한 트랜잭션으로 만든다. 보상 삭제가 없다.
 * 값 복사는 여기서 한다(DB 는 값 스키마를 모른다): 원본을 해석기로 읽어 set 키 전부를 넘기고, invalid 키가 있으면 거부한다(D29).
 * throw 하지 않는다 — 프로덕션 빌드는 서버 액션의 throw 문구를 클라이언트에 주지 않는다.
 */
export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const { workspaceId } = input ?? {}
  // 대상 워크스페이스가 비면 가드 전에 거부한다 — 가드는 null 을 슈퍼유저에게 통과시킨다.
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, code: ERR_WORKSPACE_REQUIRED, error: ERR_WORKSPACE_REQUIRED }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, code: g.error, error: g.error }
  if (typeof input.commandId !== 'string' || !isUuidLike(input.commandId)) return invalidInput(`${CONFIG_MESSAGES.CONFIG_INVALID}: 요청 번호`)
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return invalidInput('프로젝트명을 입력하세요.')
  if (!isValidDateRange(input.startDate || null, input.endDate || null)) return invalidInput('종료일은 시작일보다 빠를 수 없습니다.')
  const labels = settingDef('project', 'core.level_labels')!.parse(input.levelLabels)
  if (!labels.ok) return invalidInput(CONFIG_MESSAGES.CONFIG_INVALID, [{ key: 'core.level_labels', message: labels.error }])
  const copyFrom = input.copyFromProjectId ?? null
  if (copyFrom !== null && (typeof copyFrom !== 'string' || !isUuidLike(copyFrom))) return invalidInput(`${CONFIG_MESSAGES.CONFIG_INVALID}: copyFromProjectId`)

  const { admin } = adminFor({ workspaceId })
  const ctx = { workspaceId, copyFrom, commandId: input.commandId }
  const values: Record<string, unknown> = {}
  let allowed: ModuleId[]
  let candidate: ModuleId[] = settingDef('project', 'modules.enabled')!.default as ModuleId[]
  try {
    const ws = await getWorkspaceConfig(workspaceId, { client: admin })
    allowed = allowedAndAvailable(ws)
    if (copyFrom) {
      // 원본이 없거나 다른 워크스페이스면 똑같이 ERR_DENIED — 프로젝트 id 의 존재를 구분할 수 없게 한다.
      // RPC 도 막지만(COPY_SOURCE_FORBIDDEN) 값을 읽어 넘기기 전에 여기서 끊는다. 조회 실패는 '없음'이 아니다(3원칙 ①).
      const owner = await admin.from('projects').select('workspace_id').eq('id', copyFrom).maybeSingle()
      if (owner.error) return unavailableLogged('복사 원본 조회', ctx, owner.error.message)
      if ((owner.data as { workspace_id: string } | null)?.workspace_id !== workspaceId) return denied
      const src = await getProjectConfig(copyFrom, { client: admin })
      if (src.workspaceId !== workspaceId) return denied
      const broken: { key: string; message: string }[] = []
      for (const def of PROJECT_SETTINGS) {
        const s = src.keys[def.key]
        if (s.status === 'invalid') broken.push({ key: def.key, message: s.error })
        else if (s.status === 'set') values[def.key] = s.value
      }
      if (broken.length) return invalidInput('원본 프로젝트의 설정이 손상되어 복사할 수 없습니다.', broken)
      const srcEnabled = src.keys['modules.enabled']
      candidate = srcEnabled.status === 'set' || srcEnabled.status === 'default' ? srcEnabled.value : candidate
    }
  } catch (e) {
    if (e instanceof ConfigUnavailableError) return unavailableLogged('설정 판독', ctx, e.message)
    throw e
  }
  values['core.level_labels'] = labels.value                        // 복사에서도 라벨은 입력값(§7.5)
  values['modules.enabled'] = initialEnabled(candidate, allowed)    // 생성 때 늘 명시 기록(§3.6)

  const { data, error } = await admin.rpc('create_project_with_settings', {
    p_workspace_id: workspaceId, p_name: name, p_start_date: input.startDate || null, p_end_date: input.endDate || null,
    p_description: input.description?.trim() || null, p_values: values, p_copy_from: copyFrom,
    p_actor: g.actor.userId, p_command_id: input.commandId, p_schema_version: SETTINGS_SCHEMA_VERSION,
  })
  if (error) {
    const mapped = mapDbError(error)
    if (!mapped) return unavailableLogged('생성 RPC(표에 없는 DB 오류)', ctx, `${error.code ?? ''} ${error.message}`)
    // 같은 요청 번호에 다른 내용 — 모달이 새 번호를 발급하도록 코드를 따로 준다(문구는 표의 고정 문구)
    if (mapped.token === 'COMMAND_REUSED') return { ok: false, code: 'COMMAND_REUSED', error: mapped.message }
    return mapped.code === 'CONFIG_INVALID'
      ? invalidInput(mapped.message, mapped.fieldKey ? [{ key: mapped.fieldKey, message: mapped.message }] : undefined)
      : { ok: false, code: mapped.code, error: mapped.message }
  }
  const r = data as { status: 'applied' | 'duplicate'; project_id: string }
  // 팀 캐시가 새 프로젝트의 워크스페이스를 바로 알게 한다(SP2 16b) — refreshTeams 는 throw 하지 않는다.
  await refreshTeams()
  revalidatePath('/projects')
  return { ok: true, projectId: r.project_id, status: r.status }
}

export async function updateProject(
  projectId: string,
  fields: { name?: string; description?: string | null; start_date?: string | null; end_date?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const patch: Record<string, unknown> = {}
  if (fields.name !== undefined) {
    if (!fields.name.trim()) return { ok: false, error: '프로젝트명을 입력하세요' }
    patch.name = fields.name.trim()
  }
  if (fields.description !== undefined) patch.description = fields.description?.trim() || null
  if (fields.start_date !== undefined) patch.start_date = fields.start_date || null
  if (fields.end_date !== undefined) patch.end_date = fields.end_date || null
  if (Object.keys(patch).length === 0) return { ok: true }
  const sb = await createServerClient()
  // 날짜가 패치에 포함될 때만 범위 검증. 한쪽만 온 부분 패치는 DB 현재값과 병합해 비교(우회 방지).
  if ('start_date' in patch || 'end_date' in patch) {
    let start = patch.start_date as string | null | undefined
    let end = patch.end_date as string | null | undefined
    if (start === undefined || end === undefined) {
      const { data: cur, error: curErr } = await sb.from('projects').select('start_date,end_date').eq('id', projectId).single()
      // 현재값 조회 실패 시 검증 불가 — 통과시키지 않고 저장을 중단한다.
      if (curErr || !cur) return { ok: false, error: curErr?.message || '프로젝트를 찾을 수 없습니다.' }
      if (start === undefined) start = (cur.start_date as string | null) ?? null
      if (end === undefined) end = (cur.end_date as string | null) ?? null
    }
    if (!isValidDateRange(start, end)) return { ok: false, error: '종료일은 시작일보다 빠를 수 없습니다.' }
  }
  const { error } = await sb.from('projects').update(patch).eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/**
 * WBS 단계(레벨) 설정 변경 — 라벨 배열이 곧 깊이(labels.length = max_depth).
 * 기존 트리보다 얕게 줄이는 변경은 거부한다(깊은 노드가 라벨 범위 밖으로 유령이 된다).
 * project_settings 는 쓰기 정책이 없어(0058 — service_role 전용 관문) admin 클라이언트로 쓴다.
 */
export async function updateLevelSettings(projectId: string, labels: string[]): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  // 축소 검증용 선행 조회 — 실패하면 중단한다(검증 불가를 통과로 위장하지 않는다).
  const sb = await createServerClient()
  const { data: rows, error: rowsErr } = await sb.from('wbs_items').select('id,parent_id').eq('project_id', projectId)
  if (rowsErr || !rows) return { ok: false, error: rowsErr?.message || 'WBS 조회에 실패했습니다.' }

  const v = validateLevelSettings({ labels, currentTreeMaxDepth: treeMaxDepth(rows) })
  if (!v.ok) return { ok: false, error: v.error }

  // 행 없음 = 기본값 계약(0058)이라 기존 행이 없을 수 있다 — upsert.
  const admin = createAdminClient()
  const { error } = await admin.from('project_settings').upsert({
    project_id: projectId,
    level_labels: v.labels,
    max_depth: v.maxDepth,
    updated_at: new Date().toISOString(),
    updated_by: g.actor.userId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/**
 * 단계 전이 실적 크레딧 표(스펙 2026-09-15 §3.3·§5.1) — 관리자 전용. 검증 정본은 순수 함수(validateStageCredits)이고
 * 여기는 가드·저장만 한다. 저장은 소급하지 않는다 — 이미 기록된 actual_pct 는 그대로, 다음 단계 전이부터 새 값이 쓰인다.
 * project_settings 는 쓰기 정책이 없어(0058 — service_role 전용 관문) admin 클라이언트로 쓴다.
 */
export async function updateStageCredits(projectId: string, credits: unknown): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const v = validateStageCredits(credits)
  if (!v.ok) return { ok: false, error: v.error }
  const admin = createAdminClient()
  const { error } = await admin.from('project_settings').upsert({
    project_id: projectId,
    stage_credits: v.credits,
    updated_at: new Date().toISOString(),
    updated_by: g.actor.userId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/**
 * 저장된 엑셀 양식 비우기(Task 1b) — 관리자 전용. 손상된 양식(내보내기 422)이나 WBS 보다 얕은 양식(깊이 400)으로
 * 내보내기가 막힌 프로젝트를 푼다. 비우면 가져오기는 감지 결과로, 내보내기는 프로젝트 기본 레이아웃으로 돌아간다.
 * '{}' 가 "저장된 양식 없음"의 정본 값이다(0058 기본값·getProjectConfig 폴백과 같다). WBS 데이터는 건드리지 않는다.
 * project_settings 는 쓰기 정책이 없어(0058 — service_role 전용 관문) admin 클라이언트로 쓴다.
 */
export async function clearExcelProfile(projectId: string): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { error } = await admin.from('project_settings').upsert({
    project_id: projectId,
    excel_profile: {},
    updated_at: new Date().toISOString(),
    updated_by: g.actor.userId,
  })
  // 돌려주는 문구는 고정 — PostgREST 사유는 서버 로그에만(팀 목록 오류와 같은 처리).
  if (error) {
    console.error('[clearExcelProfile] 저장된 양식 비우기 실패:', error.message)
    return { ok: false, error: '저장된 양식을 비우지 못했습니다.' }
  }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/**
 * 비공개 전환(0070) — 프로젝트 관리자(워크스페이스 관리자 승계 포함, SP2 §4.1).
 * SP1 까지는 슈퍼유저 전용이었다(가시성은 전역 정책이라는 이유). SP2 에서 비공개가 가리는 범위가 그 워크스페이스 안으로
 * 좁혀졌고, 비공개 프로젝트도 워크스페이스 관리자에게는 보이므로(canSeeProject) 관리자가 잠가도 조직 차원에서 사라지지 않는다.
 */
export async function setProjectPrivacy(projectId: string, isPrivate: boolean): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  // projects 의 RLS update 정책과 무관하게 동작해야 하는 관리 쓰기 — admin client 로 쓰고
  // 가드(프로젝트 관리자)가 유일한 관문임을 명시한다(fail-closed). id 는 가드가 판정한 그 프로젝트다.
  const admin = createAdminClient()
  const { error } = await admin.from('projects').update({ is_private: isPrivate }).eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/** 공정율 기준일 설정. null이면 자동(오늘). 진척 산정 전체에 영향. */
export async function setBaseDate(projectId: string, baseDate: string | null): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { error } = await sb.from('projects').update({ base_date: baseDate || null }).eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

export async function addHoliday(projectId: string, date: string, name: string) {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) throw new Error(g.error)
  const sb = await createServerClient()
  const { error } = await sb
    .from('holidays')
    .upsert({ project_id: projectId, date, name }, { onConflict: 'project_id,date' })
  if (error) throw new Error(error.message)
  revalidatePath(`/p/${projectId}`, 'layout')
  after(() => recordProgressSnapshot(projectId))
}

export async function removeHoliday(projectId: string, date: string) {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) throw new Error(g.error)
  const sb = await createServerClient()
  const { error } = await sb
    .from('holidays')
    .delete()
    .eq('project_id', projectId)
    .eq('date', date)
  if (error) throw new Error(error.message)
  revalidatePath(`/p/${projectId}`, 'layout')
  after(() => recordProgressSnapshot(projectId))
}
