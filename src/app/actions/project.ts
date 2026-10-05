'use server'
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adminFor } from '@/lib/supabase/adminFor'
import { getActorViewState, requireProjectAdmin, requireWorkspaceAdmin } from '@/lib/authz'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { ERR_DENIED } from '@/lib/authz/errors'
import { canSeeProject } from '@/lib/domain/authz'
import { isUuidLike, isValidDateRange, isValidIsoDate } from '@/lib/domain/validate'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { failWith } from '@/lib/errors/dbFail'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { PROJECT_SETTINGS, SETTINGS_SCHEMA_VERSION, settingDef, valueOf, type WorkspaceSettingKey } from '@/lib/settings/registry'
import { copyWeekStartRules } from '@/lib/settings/defs/project'
import type { WeekStartRule } from '@/lib/domain/calendar'
import { ERR_MODULES_ALLOWED_BROKEN, workspaceAllowed } from '@/lib/settings/validateConfig'
import { intersectEnabledWithAllowed } from '@/lib/modules/saveRule'
import { closeRequires } from '@/lib/modules/closure'
import { CORE, moduleDef } from '@/lib/modules/registry'
import { PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import { planProjectFormCopy, copyProjectFormFiles, discardProjectFormCopy, type FormCopyPlan } from '@/lib/report/forms/copyProjectTemplates'
import { CONFIG_MESSAGES, ConfigKeyError, ConfigUnavailableError, kindOfCode, mapDbError } from '@/lib/settings/errors'

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

const invalidInput = (message: string, fieldErrors?: { key: string; message: string }[]): CreateProjectResult =>
  ({ ok: false, code: 'CONFIG_INVALID', error: message, ...(fieldErrors ? { fieldErrors } : {}) })
/** 프로젝트 관리 쓰기의 DB 오류 — 원문은 failWith 가 로그로만(SP4 B 최종 리뷰 관찰 — D21) */
const ERR_PROJECT_LOOKUP = '프로젝트를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.'
const ERR_PROJECT_SAVE = '프로젝트를 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.'
const denied: CreateProjectResult = { ok: false, code: ERR_DENIED, error: ERR_DENIED }
export type CopySourceResult =
  | { ok: true; levelLabels: string[] }
  | { ok: false; error: string; fieldErrors?: { key: string; message: string }[] }

/** 복사 선택 직후 원본을 검증해 단계 라벨과 손상 키를 화면에 보여준다. 생성 시에도 다시 검증한다. */
export async function getProjectCopySource(workspaceId: string, projectId: string): Promise<CopySourceResult> {
  if (!workspaceId || !isUuidLike(projectId)) return { ok: false, error: CONFIG_MESSAGES.CONFIG_INVALID }
  const guard = await requireWorkspaceAdmin(workspaceId)
  if (!guard.ok) return { ok: false, error: guard.error }
  const { admin } = adminFor({ workspaceId })
  const owner = await admin.from('projects').select('workspace_id').eq('id', projectId).maybeSingle()
  if (owner.error) {
    console.error('[getProjectCopySource] 원본 조회 실패', { workspaceId, projectId, cause: owner.error.message })
    return { ok: false, error: CONFIG_MESSAGES.CONFIG_UNAVAILABLE }
  }
  if ((owner.data as { workspace_id: string } | null)?.workspace_id !== workspaceId) return { ok: false, error: ERR_DENIED }
  try {
    const source = await getProjectConfig(projectId, { client: admin })
    if (source.workspaceId !== workspaceId) return { ok: false, error: ERR_DENIED }
    if (source.schemaAhead) return { ok: false, error: '원본 프로젝트의 설정이 이 서버보다 새 버전이라 복사할 수 없습니다.',
      fieldErrors: source.unknownKeys.map(key => ({ key, message: '이 서버가 모르는 설정 항목입니다.' })) }
    const broken = PROJECT_SETTINGS.flatMap(def => {
      const state = source.keys[def.key]
      return state.status === 'invalid' ? [{ key: def.key, message: state.error }] : []
    })
    if (broken.length) return { ok: false, error: '원본 프로젝트의 설정이 손상되어 복사할 수 없습니다.', fieldErrors: broken }
    const labels = source.keys['core.level_labels']
    return { ok: true, levelLabels: labels.status === 'set' || labels.status === 'default' ? labels.value : [] }
  } catch (error) {
    if (!(error instanceof ConfigUnavailableError)) throw error
    console.error('[getProjectCopySource] 설정 조회 실패', { workspaceId, projectId, cause: error.message })
    return { ok: false, error: CONFIG_MESSAGES.CONFIG_UNAVAILABLE }
  }
}
/** 원인(DB 원문 포함)은 로그로, 사용자에게는 고정 문구만 — 표시 = 로깅(설정 액션의 unavailableLogged 와 같은 태도) */
function unavailableLogged(what: string, ctx: { workspaceId: string; copyFrom: string | null; commandId: string }, cause: string): CreateProjectResult {
  console.error(`[createProject] ${what} 실패`, { ...ctx, cause })
  return { ok: false, code: 'CONFIG_UNAVAILABLE', error: CONFIG_MESSAGES.CONFIG_UNAVAILABLE }
}

/** 생성 시점의 modules.enabled — 후보 ∩ 워크스페이스 허용에서 requires 가 빠진 것을 뺀다. 자동 추가는 없다.
 *  env 는 보지 않는다(스펙 §4.1 — 런타임이 닫는다). 보면 플래그 없는 배포에서 만든 프로젝트에 허용된 모듈이 빠진 채 명시 기록된다 */
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
  // 한쪽만 있어도 형식·실재를 본다 — 그냥 넘기면 RPC 의 22008(표에 없는 토큰)이 '설정을 불러오지 못해'로 나간다
  if ([input.startDate, input.endDate].some((d) => d && (typeof d !== 'string' || !isValidIsoDate(d)))) return invalidInput('날짜 형식이 올바르지 않습니다.')
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
  let sourceRevision: number | null = null
  let srcWeekStart: WeekStartRule[] | null = null
  try {
    const ws = await getWorkspaceConfig(workspaceId, { client: admin })
    allowed = workspaceAllowed(ws)                                   // 손상이면 ConfigKeyError — 아래 catch 가 결과로 바꾼다
    if (copyFrom) {
      // 원본이 없거나 다른 워크스페이스면 똑같이 ERR_DENIED — 프로젝트 id 의 존재를 구분할 수 없게 한다.
      // RPC 도 막지만(COPY_SOURCE_FORBIDDEN) 값을 읽어 넘기기 전에 여기서 끊는다. 조회 실패는 '없음'이 아니다(3원칙 ①).
      const owner = await admin.from('projects').select('workspace_id').eq('id', copyFrom).maybeSingle()
      if (owner.error) return unavailableLogged('복사 원본 조회', ctx, owner.error.message)
      if ((owner.data as { workspace_id: string } | null)?.workspace_id !== workspaceId) return denied
      const src = await getProjectConfig(copyFrom, { client: admin })
      if (src.workspaceId !== workspaceId) return denied
      sourceRevision = src.revision
      // 원본이 이 서버보다 새 세대면 거부(D29) — 모르는 키는 조용히 빠지고 세대 1 로 저장된다. 모르는 키가 없어도(기존 키의 모양만 바뀐 세대) 거부한다.
      // DB 는 원본 세대를 보지 않는다(copy_project_config 는 values 를 다루지 않는다) — 세대 2 배포를 되돌린 뒤 도는 이 코드가 막아야 한다
      if (src.schemaAhead) {
        return invalidInput('원본 프로젝트의 설정이 이 서버보다 새 버전이라 복사할 수 없습니다.', src.unknownKeys.length
          ? src.unknownKeys.map((key) => ({ key, message: '이 서버가 모르는 설정 항목입니다.' }))
          : [{ key: 'schema_version', message: `원본 설정은 세대 ${src.schemaVersion} 이고 이 서버는 세대 ${SETTINGS_SCHEMA_VERSION} 까지 읽습니다.` }])
      }
      const broken: { key: string; message: string }[] = []
      for (const def of PROJECT_SETTINGS) {
        const s = src.keys[def.key]
        if (s.status === 'invalid') broken.push({ key: def.key, message: s.error })
        else if (s.status === 'set') values[def.key] = s.value
      }
      if (broken.length) return invalidInput('원본 프로젝트의 설정이 손상되어 복사할 수 없습니다.', broken)
      const sw = src.keys['calendar.week_start']
      srcWeekStart = sw.status === 'set' || sw.status === 'default' ? sw.value : null
      const srcEnabled = src.keys['modules.enabled']
      candidate = srcEnabled.status === 'set' || srcEnabled.status === 'default' ? srcEnabled.value : candidate
    }
    // SP5 A — 생성 시 복사(seedFrom, 상속 아님 — 개정 §4.2.2·§2.8.7). 복사면 원본의 set 값이 위에서 먼저 들어 있다 — 주 시작만 원본 마지막 규칙의
    // 요일 하나로(전환 이력은 옮기지 않는다). 워크스페이스 값이 손상이면 valueOf 가 ConfigKeyError — 아래 catch 가 결과로 바꾼다(아무것도 만들지 않는다)
    if (srcWeekStart) values['calendar.week_start'] = copyWeekStartRules(srcWeekStart)
    for (const def of PROJECT_SETTINGS) {
      if (!def.seedFrom || def.key in values) continue
      const wsValue = valueOf(ws, def.seedFrom.key as WorkspaceSettingKey)
      values[def.key] = def.seedFrom.map ? def.seedFrom.map(wsValue) : wsValue
    }
  } catch (e) {
    if (e instanceof ConfigUnavailableError) return unavailableLogged('설정 판독', ctx, e.message)
    // 키 손상(지금은 워크스페이스 modules.allowed 뿐) — throw 대신 결과(스펙 §3.3·§2.1). core 만 켠 채 만들지 않는다:
    // 비core 가 전부 빠진 modules.enabled 가 명시 기록되는 조용한 갈림이 된다
    if (e instanceof ConfigKeyError) {
      console.error('[createProject] 설정 키 손상', { ...ctx, key: e.key, code: e.code })
      const message = e.key === 'modules.allowed' ? ERR_MODULES_ALLOWED_BROKEN : `${CONFIG_MESSAGES[e.code]} (${e.key})`
      return invalidInput(message, [{ key: e.key, message }])
    }
    throw e
  }
  values['core.level_labels'] = labels.value                        // 복사에서도 라벨은 입력값(§7.5)
  values['modules.enabled'] = initialEnabled(candidate, allowed)    // 생성 때 늘 명시 기록(§3.6)

  const request = {
    name, start_date: input.startDate || null, end_date: input.endDate || null,
    description: input.description?.trim() || null, values, copy_from: copyFrom,
  }
  const lookupReceipt = async () => {
    const receipt = await admin.rpc('get_project_creation_receipt', {
      p_workspace_id: workspaceId, p_actor: g.actor.userId, p_command_id: input.commandId, p_request: request,
    })
    if (receipt.data && (!isUuidLike(receipt.data.project_id) || receipt.data.status !== 'duplicate')) {
      throw new Error('생성 영수증 응답을 확인하지 못했습니다.')
    }
    return receipt
  }
  const finish = (r: { status: 'applied' | 'duplicate'; project_id: string }): CreateProjectResult => {
    revalidatePath('/(app)/w/[slug]', 'layout')
    return { ok: true, projectId: r.project_id, status: r.status }
  }
  let copies: FormCopyPlan | null = null
  if (copyFrom) {
    try {
      copies = await planProjectFormCopy(admin, workspaceId, copyFrom, values)
      if (copies.manifest.length) {
        const receipt = await lookupReceipt()
        if (receipt.error) {
          const mapped = mapDbError(receipt.error)
          if (mapped?.token === 'COMMAND_REUSED') return { ok: false, code: 'COMMAND_REUSED', error: mapped.message }
          return unavailableLogged('생성 영수증 조회', ctx, receipt.error.message)
        }
        if (receipt.data) return finish(receipt.data)
      }
      await copyProjectFormFiles(admin, copies)
    } catch (cause) {
      if (copies) console.error('[createProject] 양식 복사 실패', { ...ctx, destinationId: copies.projectId, paths: copies.paths })
      return unavailableLogged('양식 복사', ctx, cause instanceof Error ? cause.message : String(cause))
    }
  }
  // Spread precedes p_actor so no derived copy envelope can replace the guarded actor.
  const invokeCreate = async () => admin.rpc('create_project_with_settings', {
    ...(copies ? { p_destination_id: copies.projectId, p_source_revision: sourceRevision, p_form_manifest: copies.manifest } : {}),
    p_workspace_id: workspaceId, p_name: name, p_start_date: input.startDate || null, p_end_date: input.endDate || null,
    p_description: input.description?.trim() || null, p_values: values, p_copy_from: copyFrom,
    p_actor: g.actor.userId, p_command_id: input.commandId, p_schema_version: SETTINGS_SCHEMA_VERSION,
  })
  let response: Awaited<ReturnType<typeof invokeCreate>>
  try { response = await invokeCreate() }
  catch (cause) { response = { data: null, error: { code: '', message: cause instanceof Error ? cause.message : String(cause) } } as typeof response }
  const { data } = response
  const validResult = data && isUuidLike(data.project_id) && ['applied', 'duplicate'].includes(data.status)
  const error = response.error ?? (validResult ? null : { code: '', message: '생성 응답을 확인하지 못했습니다.' })
  if (copies?.paths.length) {
    try {
      if (error && !/^[0-9A-Z]{5}$/.test(error.code ?? '')) {
        // A transport failure does not prove rollback. Wait for the same command's receipt.
        const receipt = await lookupReceipt()
        if (receipt.error) {
          const mapped = mapDbError(receipt.error)
          if (mapped?.token === 'COMMAND_REUSED') {
            await discardProjectFormCopy(admin, copies)
            return { ok: false, code: 'COMMAND_REUSED', error: mapped.message }
          }
          console.error('[createProject] 양식 복사 결과 확인 필요', { ...ctx, destinationId: copies.projectId, paths: copies.paths })
          return unavailableLogged('생성 결과 확인', ctx, receipt.error.message)
        }
        if (receipt.data) {
          if (receipt.data.project_id !== copies.projectId) await discardProjectFormCopy(admin, copies)
          return finish({ ...receipt.data, status: receipt.data.project_id === copies.projectId ? 'applied' : 'duplicate' })
        }
      }
      if (error || data?.project_id !== copies.projectId) await discardProjectFormCopy(admin, copies)
    } catch (cause) {
      console.error('[createProject] 양식 복사 결과 확인 필요', { ...ctx, destinationId: copies.projectId, paths: copies.paths })
      return unavailableLogged('양식 복사 정리/확인', ctx, cause instanceof Error ? cause.message : String(cause))
    }
  }
  if (error) {
    const mapped = mapDbError(error)
    if (!mapped) return unavailableLogged('생성 RPC(표에 없는 DB 오류)', ctx, `${error.code ?? ''} ${error.message}`)
    // 같은 요청 번호에 다른 내용 — 모달이 새 번호를 발급하도록 코드를 따로 준다(문구는 표의 고정 문구)
    if (mapped.token === 'COMMAND_REUSED') return { ok: false, code: 'COMMAND_REUSED', error: mapped.message }
    const k = kindOfCode(mapped.code)
    if (k.kind === 'unavailable' || k.kind === 'schema_ahead') console.error('[createProject] RPC 거부', { ...ctx, token: mapped.token })   // 교착·배포 엇갈림 — 횟수·명령 id 는 로그에만
    return mapped.code === 'CONFIG_INVALID'
      ? invalidInput(mapped.message, mapped.fieldKey ? [{ key: mapped.fieldKey, message: mapped.message }] : undefined)
      : { ok: false, code: mapped.code, error: mapped.message }
  }
  const r = data as { status: 'applied' | 'duplicate'; project_id: string }
  return finish(r)
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
      if (curErr) return { ok: false, error: failWith('updateProject', curErr, ERR_PROJECT_LOOKUP) }
      if (!cur) return { ok: false, error: '프로젝트를 찾을 수 없습니다.' }
      if (start === undefined) start = (cur.start_date as string | null) ?? null
      if (end === undefined) end = (cur.end_date as string | null) ?? null
    }
    if (!isValidDateRange(start, end)) return { ok: false, error: '종료일은 시작일보다 빠를 수 없습니다.' }
  }
  const { error } = await sb.from('projects').update(patch).eq('id', projectId)
  if (error) return { ok: false, error: failWith('updateProject', error, ERR_PROJECT_SAVE) }
  revalidatePath('/(app)/w/[slug]', 'layout')
  revalidatePath('/(app)/p/[projectId]', 'layout')
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
  if (error) return { ok: false, error: failWith('setProjectPrivacy', error, ERR_PROJECT_SAVE) }
  revalidatePath('/(app)/w/[slug]', 'layout')
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true }
}

/** 공정율 기준일 설정. null이면 자동(오늘). 진척 산정 전체에 영향. */
export async function setBaseDate(projectId: string, baseDate: string | null): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { error } = await sb.from('projects').update({ base_date: baseDate || null }).eq('id', projectId)
  if (error) return { ok: false, error: failWith('setBaseDate', error, ERR_PROJECT_SAVE) }
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true }
}

export type HolidayWriteResult = { ok: true } | { ok: false; error: string }
const ERR_HOLIDAY_INPUT = '날짜와 종류(휴무·근무)를 확인하세요.'
const ERR_HOLIDAY_SAVE = '날짜 예외를 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.'
const ERR_HOLIDAY_REMOVE = '날짜 예외를 지우지 못했습니다. 잠시 뒤 다시 시도하세요.'

/**
 * 날짜 예외(스펙 D7) — kind 'off'(휴무)·'work'(비근무 요일의 근무). 쓰기 길은 지금처럼 세션 클라이언트 + RLS admin_write_holidays(관리자)이고
 * 새 RPC 를 두지 않는다 — DB 의 kind check 가 값을 지킨다. 같은 날짜는 한 행이라(PK) 종류를 바꾸면 그 행이 갱신된다.
 * 결과형이다(SP5 과제 25) — 예전의 throw 는 DB 원문을 화면 토스트까지 실었다(SP4 failWith 규칙).
 */
export async function addHoliday(projectId: string, date: string, name: string, kind: 'off' | 'work'): Promise<HolidayWriteResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (typeof date !== 'string' || !isValidIsoDate(date) || (kind !== 'off' && kind !== 'work')) return { ok: false, error: ERR_HOLIDAY_INPUT }
  const label = typeof name === 'string' ? name.trim() : ''
  const sb = await createServerClient()
  const { error } = await sb.from('holidays').upsert({ project_id: projectId, date, name: label, kind }, { onConflict: 'project_id,date' })
  if (error) return { ok: false, error: failWith('addHoliday', error, ERR_HOLIDAY_SAVE) }
  revalidatePath('/(app)/p/[projectId]', 'layout')
  after(() => recordProgressSnapshot(projectId))
  return { ok: true }
}

export async function removeHoliday(projectId: string, date: string): Promise<HolidayWriteResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (typeof date !== 'string' || !isValidIsoDate(date)) return { ok: false, error: ERR_HOLIDAY_INPUT }
  const sb = await createServerClient()
  const { error } = await sb.from('holidays').delete().eq('project_id', projectId).eq('date', date)
  if (error) return { ok: false, error: failWith('removeHoliday', error, ERR_HOLIDAY_REMOVE) }
  revalidatePath('/(app)/p/[projectId]', 'layout')
  after(() => recordProgressSnapshot(projectId))
  return { ok: true }
}
