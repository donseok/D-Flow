'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { adminFor } from '@/lib/supabase/adminFor'
import { requireProjectAdmin, requireProjectMember } from '@/lib/authz'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { weekKeyOf } from '@/lib/domain/calendar'
import { requireCalendar } from '@/lib/calendar/load'
import {
  isWeeklyCellKey, rowLabel, WEEKLY_CELL_LABEL, WEEKLY_CELL_MAX,
  type WeeklyCellEdit, type WeeklyCellKey,
} from '@/lib/domain/weeklySheet'
import {
  CARRY_SKIP, carryOverRows, seedOf,
  type CarryMapping, type CarryOverflow, type CarryPending,
} from '@/lib/domain/weeklyCarry'
import { isUuidLike, isValidIsoDate } from '@/lib/domain/validate'
import { findCarryOverSource, findWeeklyReportId } from '@/lib/data/weeklySheet'
import { getProjectConfig, type ConfigArea } from '@/lib/settings/projectConfig'
import { CONFIG_MESSAGES, ConfigKeyError, ConfigUnavailableError, ERR_CONFIG_UNAVAILABLE } from '@/lib/settings/errors'
import { failWith, rpcFailure, type OwnTokenTable } from '@/lib/errors/dbFail'
import { generateAnswer } from '@/lib/ai/llm'
import { aiAvailable } from '@/lib/modules/aiAvailable'
import { requireModule } from '@/lib/modules/gate'
import {
  buildWeeklyRewritePrompt, parseWeeklyRewriteResponse, WEEKLY_REWRITE_MAX_CELLS,
  WEEKLY_REWRITE_MAX_TOTAL_CHARS, WEEKLY_REWRITE_SYSTEM_PROMPT,
} from '@/lib/ai/weekly-rewrite'
import { carryCustomFields, parseFieldDefs, type CustomValues } from '@/lib/domain/customFields'
import { parseCustomValues } from '@/lib/domain/customFieldValues'

export interface WeeklyActionResult {
  ok: boolean
  error?: string
  gone?: boolean // 대상 행이 이미 삭제됨 — 재시도 무의미(클라이언트가 dirty 정리·행 제거)
}

// 배치는 단건과 시맨틱이 반대다 — 일부 행이 사라져도 살아있는 행 저장은 성공(ok:true).
// 그래서 단건 `gone:boolean`(저장 실패)과 혼동되지 않게 `goneRowIds:string[]`로 분리한다.
export interface WeeklyBatchResult {
  ok: boolean
  error?: string          // ok:false일 때만. 사람이 읽는 설명(고정 문구 — DB 원문은 로그로만)
  goneRowIds?: string[]   // ok:true여도 존재 가능 — 저장 시점 이미 삭제된 행(스킵됨). FE가 그 행만 정리
}

export interface WeeklyRewriteInput {
  rowId: string
  cellKey: WeeklyCellKey
  content: string
}

export interface WeeklyRewriteSuggestion extends WeeklyRewriteInput {
  original: string
}

export type WeeklyRewriteResult =
  | { ok: true; edits: WeeklyRewriteSuggestion[] }
  | { ok: false; error: string }

/** 주차 문서 생성 결과(스펙 D43). 이월 대기·넘침은 문서를 만들지 않고 화면의 매핑 창이 다시 고르게 한다(D31·Q37).
 *  가드·관문 거부는 code 에 그 문구를 싣는다(선례 createProject). */
export type CreateWeeklyResult =
  | { ok: true; reportId: string; status: 'created' | 'exists' }
  | { ok: false; code: 'CARRY_PENDING'; pending: CarryPending[]; overflow: CarryOverflow[] }
  | { ok: false; code: string; error: string; retryable?: boolean }

const CELL_MAX = WEEKLY_CELL_MAX // 셀 1개 상한(도메인 단일 출처)
const BATCH_MAX = 500         // 한 배치의 최대 edit 수(페이로드 크기 방어)
const BATCH_UPDATE_CONCURRENCY = 8 // 배치 저장의 행 update 동시 실행 수 — Micro 컴퓨트 풀을 배려한 상한
const TITLE_MAX = 200         // 시트 제목 상한
const WEEKLY_REWRITE_COOLDOWN_MS = 3_000 // Gemini 무료 RPM 보호 — 사용자·프로젝트별 호출 하한
const WEEKLY_REWRITE_GATE_MAX = 500
const weeklyRewriteInFlight = new Map<string, Promise<string | null>>()
const weeklyRewriteLastAttempt = new Map<string, number>()

// 고정 문구(D21 — DB 원문은 failWith 가 서버 로그로만 남긴다)
const ERR_WEEK_INPUT = '주차 시작일이 올바르지 않습니다.'
const ERR_MAPPING_INPUT = '이월 매핑이 올바르지 않습니다. 매핑 창을 다시 열어 고르세요.'
/** 영역 0개 — RPC 토큰 WEEKLY_AREAS_REQUIRED 의 표 문구(settings/errors)와 같다. weekly-create 테스트가 둘을 맞댄다 */
const ERR_AREAS_REQUIRED = '주간보고 영역을 먼저 설정하세요.'
const ERR_CARRY_SOURCE = '이월 원본을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_CREATE = '주차 시트를 만들지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_TITLE_SAVE = '제목을 저장하지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_CELL_SAVE = '셀을 저장하지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_SCOPE = '대상을 확인할 수 없어 저장을 중단했습니다.'
const ERR_REWRITE_TARGET = '선택한 셀을 확인할 수 없습니다.'
const ERR_ROW_GONE = '행이 삭제되어 저장할 수 없습니다.'

/** create_weekly_report 의 자기 토큰(P4·D45). 그 밖은 rpcFailure 가 55P03·mapDbError(40P01·WEEKLY_AREAS_REQUIRED)로 판정하고,
 *  셋 다 아니면 failWith 로그 + 고정 문구다 — 격리(WEEKLY_ISOLATION 25001)와 입력 토큰(WEEKLY_INVALID_INPUT·WEEKLY_SEED_INVALID 22023)은
 *  정상 경로에서 나지 않으므로(액션이 RPC 앞에서 주 날짜·매핑을 거르고 시드는 carryOverRows 가 만든다) 표에 넣지 않는다(T6) */
const CREATE_TOKENS: OwnTokenTable = {
  WEEKLY_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: ERR_DENIED },
  PROJECT_NOT_FOUND: { status: 404, code: 'ERR_MISSING', message: ERR_MISSING },
}

function rememberWeeklyRewriteAttempt(key: string, now: number) {
  if (!weeklyRewriteLastAttempt.has(key) && weeklyRewriteLastAttempt.size >= WEEKLY_REWRITE_GATE_MAX) {
    const oldest = weeklyRewriteLastAttempt.keys().next().value as string | undefined
    if (oldest) weeklyRewriteLastAttempt.delete(oldest)
  }
  // 기존 키도 맨 뒤로 옮겨 오래 활동하지 않은 사용자부터 제거되게 한다.
  weeklyRewriteLastAttempt.delete(key)
  weeklyRewriteLastAttempt.set(key, now)
}

/** 주간 화면 — 라우트 패턴 꼴(SP3b D8) */
function revalidateWeekly() {
  revalidatePath('/(app)/p/[projectId]/weekly', 'page')
}

/** 매핑의 모양만(Q37) — 원본 영역 id → 활성 영역 id | 'skip'. 대상의 뜻(활성 weekly_section 인가)은 carryOverRows 가 판정해
 *  다시 pending 으로 돌려준다(오류가 아니다) */
function isCarryMappingShape(v: unknown): v is CarryMapping {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.entries(v as Record<string, unknown>)
    .every(([k, t]) => isUuidLike(k) && typeof t === 'string' && (t === CARRY_SKIP || isUuidLike(t)))
}

/** 주차 문서 생성(스펙 §4.1.3·D43) — 행 생성은 RPC create_weekly_report 한 길(D22). 존재 확인·보상 삭제·세션 insert 가 없다:
 *  RPC 가 같은 잠금('weekly:' || project) 아래에서 '같은 주 문서 있음 → exists'·'활성 영역마다 1행'을 한 트랜잭션에 한다(D33).
 *  p_actor 는 가드 결과의 userId 다(D51 — RPC 가 등급을 다시 판정한다, D28). 이월 원본 조회 실패는 '원본 없음'과 구분해 중단한다(3원칙 ②). */
export async function createWeeklyReport(
  projectId: string, weekStartIso: string, carryOver: boolean, mapping?: CarryMapping,
): Promise<CreateWeeklyResult> {
  // 회차(주차 문서) 생성은 시트의 구조를 만드는 일이라 관리자 몫 — 셀 편집(멤버)과 급이 다르다.
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, code: g.error, error: g.error }
  const mod = await requireModule({ projectId }, 'weekly')                    // 스펙 §4.2 — 가드 뒤·입력 검증 앞(P17)
  if (!mod.ok) return { ok: false, code: mod.error, error: mod.error }
  if (typeof weekStartIso !== 'string' || !isValidIsoDate(weekStartIso)) return { ok: false, code: 'INVALID_INPUT', error: ERR_WEEK_INPUT }
  if (mapping !== undefined && !isCarryMappingShape(mapping)) return { ok: false, code: 'INVALID_INPUT', error: ERR_MAPPING_INPUT }

  let cfg: Awaited<ReturnType<typeof getProjectConfig>>
  try {
    cfg = await getProjectConfig(projectId)
  } catch (e) {
    if (e instanceof ConfigUnavailableError) {
      return { ok: false, code: 'CONFIG_UNAVAILABLE', error: failWith('weekly/create', e, ERR_CONFIG_UNAVAILABLE), retryable: true }
    }
    throw e
  }
  let weekStart: string
  try {
    // 주 키는 그 프로젝트 규칙의 키(SP5 P9) — 트리거(WEEK_KEY_INVALID)는 마지막 방어다(D8)
    weekStart = weekKeyOf(requireCalendar(cfg).weekStart, weekStartIso)
  } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, code: 'CONFIG_INVALID', error: `${CONFIG_MESSAGES[e.code]} (${e.key})` }
    throw e
  }
  const areas: ConfigArea[] = cfg.areas.weekly_section
  // 활성 영역 0개 — RPC 도 WEEKLY_AREAS_REQUIRED 로 막지만 부르기 전에 같은 문구로 답한다(임의 구분을 만들지 않는다, W1)
  if (!areas.some(a => a.active)) return { ok: false, code: 'CONFIG_REQUIRED', error: ERR_AREAS_REQUIRED }

  let seed: ReturnType<typeof seedOf> | null = null
  let carriedCustomRows: { areaId: string; custom: CustomValues }[] = []
  if (carryOver === true) {
    // 같은 주 문서가 이미 있으면(다른 관리자가 먼저 만들었다) 이월을 판정하지 않는다 — RPC 가 시드를 버리고 exists 를 돌려줄 문서에
    // 매핑 창을 띄우지 않는다(A1-4 리뷰 P7). 확인과 RPC 사이에 생긴 문서는 RPC 의 exists 가 그대로 받는다
    let existing: string | null
    try {
      existing = await findWeeklyReportId(projectId, weekStart)
    } catch (e) {
      return { ok: false, code: 'CARRY_SOURCE_UNAVAILABLE', error: failWith('weekly/create', e, ERR_CARRY_SOURCE), retryable: true }
    }
    let src: Awaited<ReturnType<typeof findCarryOverSource>> = null
    if (existing === null) {
      try {
        src = await findCarryOverSource(projectId, weekStart)
      } catch (e) {
        return { ok: false, code: 'CARRY_SOURCE_UNAVAILABLE', error: failWith('weekly/create', e, ERR_CARRY_SOURCE), retryable: true }
      }
    }
    if (src && src.rows.length > 0) {
      const fieldDefsState = cfg.keys ? cfg.keys['fields.weekly_row'] : undefined
      const fieldDefs = fieldDefsState && (fieldDefsState.status === 'set' || fieldDefsState.status === 'default') ? fieldDefsState.value : []
      const parsedDefs = parseFieldDefs('weekly_row', fieldDefs)
      const defs = parsedDefs.ok ? parsedDefs.value : []
      const carryFn = (prevCustom: unknown): CustomValues => {
        const parsed = parseCustomValues(prevCustom)
        return parsed.ok ? carryCustomFields(defs, parsed.value) : {}
      }
      const carried = carryOverRows(src.rows, areas, mapping, carryFn)
      if (!carried.ok) return { ok: false, code: 'CARRY_PENDING', pending: carried.pending, overflow: carried.overflow }
      seed = seedOf(carried.rows)
      carriedCustomRows = carried.rows
        .filter(r => r.custom && Object.keys(r.custom).length > 0)
        .map(r => ({ areaId: r.areaId, custom: r.custom as CustomValues }))
    }
  }

  const { admin } = adminFor({ projectId })
  const { data, error } = await admin.rpc('create_weekly_report', {
    p_actor: g.actor.userId, p_project_id: projectId, p_week_start: weekStart, p_seed: seed,
  })
  if (error) {
    const f = rpcFailure(error, CREATE_TOKENS)
    if (f) return { ok: false, code: f.code, error: f.message, ...(f.retryable ? { retryable: true } : {}) }
    return { ok: false, code: 'UNAVAILABLE', error: failWith('weekly/create', error, ERR_CREATE) }
  }
  const r = data as { status: 'created' | 'exists'; report_id: string }
  if (r.status === 'created' && carriedCustomRows.length > 0) {
    for (const item of carriedCustomRows) {
      await admin.from('weekly_report_rows')
        .update({ custom: item.custom })
        .eq('report_id', r.report_id)
        .eq('area_id', item.areaId)
    }
  }
  revalidateWeekly()
  return { ok: true, reportId: r.report_id, status: r.status }
}

/** 시트 제목 저장 — ''이면 화면이 기본 제목(프로젝트명+주차)을 합성한다. */
export async function saveWeeklyTitle(
  projectId: string, reportId: string, title: string,
): Promise<WeeklyActionResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'weekly')
  if (!mod.ok) return { ok: false, error: mod.error }
  const t = title.trim()
  if (t.length > TITLE_MAX) return { ok: false, error: `제목은 ${TITLE_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
  // 대상 회차가 판정 기준 프로젝트의 것인지 쿼리에 못 박는다 — 미결합 reportId 로 쓰면 A 의 멤버가 B 의 회차 제목을 고칠 수 있다.
  // updated_at 은 보내지 않는다 — before update 트리거(weekly_reports_touch)가 채우고 세션 열 권한은 title 뿐이다(Q13 — 보내면 42501).
  const { data, error } = await sb.from('weekly_reports')
    .update({ title: t })
    .eq('id', reportId).eq('project_id', projectId)
    .select('id')
  if (error) return { ok: false, error: failWith('weekly/title', error, ERR_TITLE_SAVE) }
  if (!data || data.length === 0) return { ok: false, error: '대상 회차를 찾을 수 없습니다.' }
  revalidateWeekly()
  return { ok: true }
}

/**
 * 주어진 행들이 **이 프로젝트** 소속인지와 그 행의 영역을 한 번에 읽는다 — 행의 project_id 로 거른다(임베드 없음, Q35).
 * 셀 저장은 rowId 만 받으므로 이 결합이 없으면 인자 projectId 로 가드를 통과한 뒤 남의 프로젝트 행을 쓸 수 있다.
 * 조회 실패는 쓰기 중단 사유다(3원칙 ②). 맵: 행 id → 영역 id(소속이 아닌 행은 없다).
 */
async function rowAreasInProject(
  sb: Awaited<ReturnType<typeof createServerClient>>, projectId: string, rowIds: string[],
): Promise<{ ok: true; areaOf: Map<string, string> } | { ok: false; error: string }> {
  const { data, error } = await sb.from('weekly_report_rows')
    .select('id, area_id')
    .in('id', rowIds)
    .eq('project_id', projectId)
  if (error) {
    console.error('[weekly] 대상 행 소속 확인 실패:', error.message)
    return { ok: false, error: ERR_SCOPE }
  }
  return { ok: true, areaOf: new Map((data ?? []).map(r => [r.id as string, r.area_id as string])) }
}

/**
 * 선택한 주간업무 셀을 AI가 다듬은 **미리보기**만 만든다.
 * 현재 로컬 입력(자동 저장 전 값 포함)은 클라이언트가 보내고, DB 조회는 프로젝트 소속 확인과
 * 영역 라벨에만 쓴다. 이 액션에서는 어떤 셀도 저장하지 않는다.
 */
export async function prepareWeeklyCellRewrite(
  projectId: string,
  inputs: WeeklyRewriteInput[],
): Promise<WeeklyRewriteResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'weekly')                    // 입력 검증 앞 — AI 판정(aiAvailable)은 그대로 뒤에 있다
  if (!mod.ok) return { ok: false, error: mod.error }
  if (!Array.isArray(inputs) || inputs.length === 0)
    return { ok: false, error: '다듬을 내용이 없습니다.' }
  if (inputs.length > WEEKLY_REWRITE_MAX_CELLS)
    return { ok: false, error: `한 번에 최대 ${WEEKLY_REWRITE_MAX_CELLS}개 셀까지 다듬을 수 있습니다.` }

  const addresses = new Set<string>()
  let totalChars = 0
  for (const input of inputs) {
    if (!input || typeof input.rowId !== 'string' || !input.rowId)
      return { ok: false, error: '잘못된 대상이 포함되어 있습니다.' }
    if (!isWeeklyCellKey(input.cellKey))
      return { ok: false, error: '잘못된 셀이 포함되어 있습니다.' }
    if (typeof input.content !== 'string' || !input.content.trim())
      return { ok: false, error: '빈 셀은 AI로 다듬을 수 없습니다.' }
    if (input.content.length > CELL_MAX)
      return { ok: false, error: `내용은 ${CELL_MAX}자 이하여야 합니다.` }
    const address = `${input.rowId}:${input.cellKey}`
    if (addresses.has(address))
      return { ok: false, error: '같은 셀이 중복으로 선택되었습니다.' }
    addresses.add(address)
    totalChars += input.content.length
  }
  if (totalChars > WEEKLY_REWRITE_MAX_TOTAL_CHARS)
    return { ok: false, error: '선택한 내용이 너무 깁니다. 범위를 나눠 다시 시도해 주세요.' }

  const sb = await createServerClient()
  const rowIds = [...new Set(inputs.map(input => input.rowId))]
  const scope = await rowAreasInProject(sb, projectId, rowIds)
  if (!scope.ok) return { ok: false, error: scope.error }
  if (rowIds.some(rowId => !scope.areaOf.has(rowId)))
    return { ok: false, error: ERR_REWRITE_TARGET }
  if (!(await aiAvailable({ projectId }, { module: 'weekly' })))
    return { ok: false, error: 'AI 를 사용할 수 없습니다. 관리자에게 AI 설정을 요청해 주세요.' }

  // 라벨 = 영역 이름(비활성이면 표지) — 행의 area_id 와 그 프로젝트의 주간 영역으로(지운 section·module 열을 읽지 않는다, Q35)
  const { data: areaRows, error: areaError } = await sb.from('project_areas')
    .select('id, name, active')
    .eq('project_id', projectId)
    .eq('kind', 'weekly_section')
  if (areaError || !areaRows) {
    if (areaError) console.error('[weekly] AI 재작성 대상 영역 조회 실패:', areaError.message)
    return { ok: false, error: ERR_REWRITE_TARGET }
  }
  const areas = areaRows as { id: string; name: string; active: boolean }[]
  const promptCells = inputs.map((input, index) => ({
    id: `c${index}`,
    section: rowLabel({ areaId: scope.areaOf.get(input.rowId) as string }, areas),
    field: WEEKLY_CELL_LABEL[input.cellKey],
    content: input.content,
  }))
  const prompt = buildWeeklyRewritePrompt(promptCells)
  const gateKey = `${g.actor.userId}:${projectId}`
  const exactRequestKey = `${gateKey}:${prompt}`
  let raw: string | null
  const running = weeklyRewriteInFlight.get(exactRequestKey)
  if (running) {
    raw = await running
  } else {
    const now = Date.now()
    if (now - (weeklyRewriteLastAttempt.get(gateKey) ?? 0) < WEEKLY_REWRITE_COOLDOWN_MS)
      return { ok: false, error: 'AI 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.' }
    rememberWeeklyRewriteAttempt(gateKey, now)
    const pending = generateAnswer(
      WEEKLY_REWRITE_SYSTEM_PROMPT,
      [{ role: 'user', content: prompt }],
      {
        timeoutMs: 15_000,
        maxOutputTokens: 8_192,
        allowModelFallback: false,
        retries: 0,
        retryRateLimit: false,
      },
    )
    weeklyRewriteInFlight.set(exactRequestKey, pending)
    try {
      raw = await pending
    } finally {
      if (weeklyRewriteInFlight.get(exactRequestKey) === pending)
        weeklyRewriteInFlight.delete(exactRequestKey)
    }
  }
  if (!raw)
    return { ok: false, error: 'AI가 내용을 다듬지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  const rewritten = parseWeeklyRewriteResponse(raw, promptCells)
  if (!rewritten)
    return { ok: false, error: 'AI 응답을 확인하지 못했습니다. 원문은 변경되지 않았습니다.' }

  return {
    ok: true,
    edits: inputs.map((input, index) => ({
      rowId: input.rowId,
      cellKey: input.cellKey,
      original: input.content,
      content: rewritten[index].content,
    })),
  }
}

/** 셀 저장 — 열 화이트리스트 강제(last-write-wins, 스펙 §2). updated_at 은 트리거(Q13). */
export async function saveWeeklyCell(
  projectId: string, rowId: string, cellKey: string, content: string,
): Promise<WeeklyActionResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'weekly')
  if (!mod.ok) return { ok: false, error: mod.error }
  if (!isWeeklyCellKey(cellKey)) return { ok: false, error: '잘못된 셀입니다.' }
  if (content.length > CELL_MAX) return { ok: false, error: `내용은 ${CELL_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
  const scope = await rowAreasInProject(sb, projectId, [rowId])
  if (!scope.ok) return { ok: false, error: scope.error }
  // 소속이 아니면 '행 없음'과 같은 취급 — 남의 프로젝트 행의 존재를 알려 주지 않는다.
  if (!scope.areaOf.has(rowId)) return { ok: false, error: ERR_ROW_GONE, gone: true }
  // updated_at 은 보내지 않는다 — weekly_report_rows_touch 트리거가 채우고 세션 열 권한은 내용 네 칸뿐이다(Q13 — 보내면 42501)
  const { data, error } = await sb.from('weekly_report_rows')
    .update({ [cellKey]: content })
    .eq('id', rowId)
    .select('id')
  if (error) return { ok: false, error: failWith('weekly/cell', error, ERR_CELL_SAVE) }
  if (!data || data.length === 0) return { ok: false, error: ERR_ROW_GONE, gone: true }
  // revalidate 불필요 — 셀 값은 클라이언트 상태 + Realtime으로 동기화(새로고침 시 서버 조회가 최신)
  return { ok: true }
}

/**
 * 멀티셀 배치 저장(붙여넣기/범위삭제/채우기/undo) — last-write-wins, no-revalidate.
 * 살아있는 행 저장은 성공하고 삭제된 행만 goneRowIds로 스킵한다(부분 실패 시맨틱, AC8.4).
 * 배치는 멱등(같은 배치 통째 재시도 안전) — DB 에러 시 청크 경계에서 중단하되 롤백은 하지 않는다.
 *
 * 왕복 구조: 같은 행의 여러 셀은 patch 하나로 합쳐 행당 1 update(같은 행의 셀들은 원자 반영),
 * 행 update 는 BATCH_UPDATE_CONCURRENCY 개씩 청크 병렬로 실행한다. dedupe 가 (행,셀)당 값을
 * 하나로 만들고 행 update 끼리는 서로 다른 행만 만지므로 실행 순서 의존이 없다(last-write-wins).
 */
export async function saveWeeklyCells(
  projectId: string,          // 권한 판정 기준·소속 확인(행의 project_id)
  edits: WeeklyCellEdit[],
): Promise<WeeklyBatchResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'weekly')
  if (!mod.ok) return { ok: false, error: mod.error }
  if (edits.length === 0) return { ok: true }                                             // no-op — DB 접근 없음
  if (edits.length > BATCH_MAX) return { ok: false, error: '한 번에 저장할 수 있는 셀 수를 초과했습니다.' } // dedupe 전 원본 길이 기준
  for (const e of edits) {
    if (!isWeeklyCellKey(e.cellKey)) return { ok: false, error: '잘못된 셀입니다.' }        // 구조 필드 차단(D1)
    if (e.content.length > CELL_MAX) return { ok: false, error: `내용은 ${CELL_MAX}자 이하여야 합니다.` }
    if (!e.rowId) return { ok: false, error: '잘못된 대상입니다.' }
  }

  // 방어적 dedupe — 같은 `${rowId}:${cellKey}`는 마지막이 이겨(last-wins) 적용값을 결정적으로.
  const deduped = new Map<string, WeeklyCellEdit>()
  for (const e of edits) deduped.set(`${e.rowId}:${e.cellKey}`, e)

  const sb = await createServerClient()
  // 배치 전체의 소속을 한 번에 확인한다(건별 왕복 회피). 소속 아닌 행은 삭제된 행과
  // 같은 취급으로 goneRowIds 에 넣어 스킵 — 부분 실패 시맨틱을 유지한다.
  const scope = await rowAreasInProject(sb, projectId, [...new Set([...deduped.values()].map(e => e.rowId))])
  if (!scope.ok) return { ok: false, error: scope.error }
  const goneRowIds: string[] = []
  // 행 단위 그룹핑 — 같은 행의 여러 cellKey 는 patch 하나로 합쳐 행당 1 update 로 보낸다.
  const patches = new Map<string, Record<string, string>>()
  for (const e of deduped.values()) {
    if (!scope.areaOf.has(e.rowId)) {
      if (!goneRowIds.includes(e.rowId)) goneRowIds.push(e.rowId)
      continue
    }
    const patch = patches.get(e.rowId)
    if (patch) patch[e.cellKey] = e.content
    else patches.set(e.rowId, { [e.cellKey]: e.content })
  }

  const rows = [...patches.entries()]
  for (let i = 0; i < rows.length; i += BATCH_UPDATE_CONCURRENCY) {
    const chunk = rows.slice(i, i + BATCH_UPDATE_CONCURRENCY)
    // 예외도 결과값으로 흡수해 Promise.all 이 거부되지 않게 한다 — 형제 update 의
    // unhandled rejection 없이 청크 전체가 정착한 뒤 순서대로 판정한다.
    const results = await Promise.all(chunk.map(async ([rowId, patch]) => {
      try {
        const { data, error } = await sb.from('weekly_report_rows')
          .update(patch)    // updated_at 없음 — 트리거가 채운다(Q13)
          .eq('id', rowId)
          .select('id')
        return { rowId, failure: (error ?? null) as unknown, gone: !error && (!data || data.length === 0) }
      } catch (e) {
        return { rowId, failure: e as unknown, gone: false }
      }
    }))
    for (const r of results) {
      // 진성 DB 에러 — 청크 경계에서 중단(비원자적, 재시도는 멱등). 원문은 로그로만(D21)
      if (r.failure !== null) return { ok: false, error: failWith('weekly/cells', r.failure, ERR_CELL_SAVE) }
      if (r.gone) goneRowIds.push(r.rowId)                            // 0행 영향(삭제된 행) — 스킵하고 계속(전체 실패 아님)
    }
  }
  // revalidate 안 함 — 행 update 하나가 그 행의 Realtime 이벤트 하나를 발생시켜 타 세션에 전파.
  return goneRowIds.length ? { ok: true, goneRowIds } : { ok: true }
}
