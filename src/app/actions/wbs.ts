'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { ERR_MISSING } from '@/lib/authz/errors'
import { isProjectAdmin } from '@/lib/domain/authz'
import { actorTeamIdsFor } from '@/lib/domain/permissions'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { enqueueIndexChange } from '@/lib/ai/index/enqueueChange'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import type { DependencyType, OwnerKind, TeamCode } from '@/lib/domain/types'
import { personOf, primaryTeamCode } from '@/lib/data/memberSelect'
import { subActName } from '@/lib/domain/subact'
import { workingDaysBetween, type WorkCalendar } from '@/lib/domain/calendar'
import { requireCalendar } from '@/lib/calendar/load'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { AGENT_TAG } from '@/lib/domain/seatmap'
import { AGENT_HELD_ORDER_STATUSES, stageLockedForHuman } from '@/lib/domain/agentWork'
import { DEFAULT_APPROVAL_STEPS, actualHundredBlocked } from '@/lib/domain/approvalSteps'
import { failWith } from '@/lib/errors/dbFail'
import { WBS_ACTION_ERRORS as E } from '@/lib/wbs/actionErrors'
import { CONFIG_MESSAGES, ConfigKeyError, ConfigUnavailableError, dbToken } from '@/lib/settings/errors'
import { projectTeams } from '@/lib/teams/source'
import { teamNameKey } from '@/lib/domain/teamName'

/** 변경 이력 작성자의 이 프로젝트 권한 — 명단 access_role, 활성 명단 행이 없으면 viewer. */
export type ChangeActorRole = 'admin' | 'member' | 'viewer'

export interface ChangeLogEntry {
  id: number
  field: string
  oldValue: string | null
  newValue: string | null
  at: string
  actorTeam: TeamCode | null
  actorRole: ChangeActorRole | null
}

type ChangeLogActor = { team: TeamCode | null; role: ChangeActorRole }

/**
 * 변경 이력 작성자 라벨 재료 — userId → { 대표 팀 code, 프로젝트 역할 }.
 * 표시 전용이라 실패는 로깅 후 빈 맵(라벨만 비고 이력은 보인다). 역할은 명단 access_role 이고
 * 활성 명단 행이 없으면 'viewer' — buildActor 의 projectRoles 와 같은 축(활성 행·활성 인물만)이다.
 */
async function changeLogActors(
  sb: Awaited<ReturnType<typeof createServerClient>>, itemId: string, userIds: string[],
): Promise<Map<string, ChangeLogActor>> {
  const actorMap = new Map<string, ChangeLogActor>()
  if (!userIds.length) return actorMap
  const [prof, item] = await Promise.all([
    sb.from('profiles').select('user_id, display_name').in('user_id', userIds),
    sb.from('wbs_items').select('project_id').eq('id', itemId).maybeSingle(),
  ])
  if (prof.error) console.error('[getChangeLogs] 작성자 계정 조회 실패:', prof.error.message)
  for (const p of (prof.data ?? []) as Array<{ user_id: string }>) actorMap.set(p.user_id, { team: null, role: 'viewer' })
  if (item.error) console.error('[getChangeLogs] 항목 프로젝트 조회 실패:', item.error.message)
  const projectId = (item.data?.project_id as string | null | undefined) ?? null
  if (!projectId) return actorMap
  const { data: roster, error: rosterErr } = await sb
    .from('project_members')
    .select('access_role, people!inner(user_id, active), project_member_teams(is_primary, teams(code))')
    .eq('project_id', projectId).eq('active', true)
    .in('people.user_id', userIds).eq('people.active', true)
  if (rosterErr) console.error('[getChangeLogs] 작성자 명단 조회 실패:', rosterErr.message)
  for (const r of (roster ?? []) as Array<Record<string, unknown>>) {
    const uid = personOf(r)?.user_id
    if (!uid) continue
    actorMap.set(uid, {
      team: primaryTeamCode(r.project_member_teams),
      role: (r.access_role as 'admin' | 'member' | null) ?? 'viewer',
    })
  }
  return actorMap
}

/** 항목의 변경 이력 조회 — 실적%/가중치 편집 시 기록된 change_logs를 최신순으로.
 *  작성자 라벨은 저장값이 아니라 조회 시점에 계산한다 — profiles(알려진 계정) + 그 항목 프로젝트의
 *  활성 명단 행(대표 팀 code, access_role). 명단 행이 없는 계정은 조회 전용('viewer'). */
export async function getChangeLogs(itemId: string): Promise<ChangeLogEntry[]> {
  // 서버 액션 직접 호출에 대비한 인증 재확인(RLS와 이중 방어). 반환 타입에 에러 채널이 없어
  // listProjects 와 같은 관례로 빈 목록을 돌려주되, 조회 실패와 구분되도록 사유를 로그에 남긴다.
  if (!(await getSession())) {
    console.error('[getChangeLogs] 비로그인 호출 — 빈 이력 반환')
    return []
  }
  const sb = await createServerClient()
  // 표시 전용 조회 — 실패해도 빈 이력으로 폴백하되(화면은 비어도 안전), 원인은 로그에 남긴다.
  const { data: logs, error: logErr } = await sb
    .from('change_logs')
    .select('id, field, old_value, new_value, at, user_id')
    .eq('wbs_item_id', itemId)
    .order('at', { ascending: false })
    .limit(50)
  if (logErr) console.error('[getChangeLogs] 변경 이력 조회 실패:', logErr.message)
  if (!logs?.length) return []

  const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean) as string[])]
  const actorMap = await changeLogActors(sb, itemId, userIds)

  return logs.map(l => {
    const actor = l.user_id ? actorMap.get(l.user_id as string) : undefined
    return {
      id: l.id as number,
      field: l.field as string,
      oldValue: (l.old_value as string) ?? null,
      newValue: (l.new_value as string) ?? null,
      at: l.at as string,
      actorTeam: actor?.team ?? null,
      actorRole: actor?.role ?? null,
    }
  })
}

/** 에이전트 관할 작업의 수기 실적 100 잠금 문구 — 앱 판정과 DB 가드(0011 WORKFLOW_ACTUAL_LOCKED)가 같은 문구를 쓴다.
 *  'use server' 파일이라 export 하지 않는다. */
const ACTUAL_LOCKED_MSG = '완료는 승인 버튼으로 처리합니다 — 에이전트 관할 작업(위임됨·작업 중·검수 대기)은 99% 까지 입력할 수 있습니다. 직접 완료하려면 위임을 끄세요.'
/** 잠금 거부 — 두 자리(앱 판정·DB 가드)가 같은 결과를 낸다. code 는 화면이 사전 문구(wbs.actualLocked)를 고르는 사유다:
 *  문구를 그대로 그리면 영어 화면에 한국어 토스트가 뜬다. 문구는 챗봇 등 code 를 모르는 호출부를 위해 그대로 싣는다. */
const ACTUAL_LOCKED = { ok: false, error: ACTUAL_LOCKED_MSG, code: 'actual_locked' } as const

// DB 원문은 로그로만(SP4 D21) — 응답에는 기능별 고정 문구. 실적·가중치·Phase 추가(updateActual·updateWeight·addWbsItem)가 쓰는 문구는
// src/lib/wbs/actionErrors.ts 의 상수이고 화면(WBS 시트·칸반 토스트)이 사전 키로 바꿔 그린다(SP4 B — D21·D52). 나머지 상수는 아직 사전 매핑 밖이다.
const ERR_ITEM_LOOKUP = E.itemLookup
const ERR_CHILD_LOOKUP = E.childLookup
const ERR_OWNER_LOOKUP = E.ownerLookup
const ERR_ORDER_LOOKUP = E.orderLookup
const ERR_SIBLING_LOOKUP = E.siblingLookup
const ERR_TEAM_LOOKUP = '담당 팀을 확인하지 못했습니다 — 잠시 후 다시 시도하세요.'
const ERR_DEP_LOOKUP = '의존성을 확인하지 못했습니다 — 잠시 후 다시 시도하세요.'
const ERR_TASK_LOOKUP = '작업을 불러오지 못했습니다 — 잠시 후 다시 시도하세요.'
const ERR_CALENDAR_LOOKUP = '근무일 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_SAVE = E.save
const ERR_ADD = E.add
const ERR_DELETE = '삭제하지 못했습니다 — 잠시 후 다시 시도하세요.'
const ERR_MOVE = '순서를 바꾸지 못했습니다 — 잠시 후 다시 시도하세요.'
const ERR_MOVE_DENIED = '순서 변경 실패: 저장 권한이 없습니다(관리자만 가능)'
// "그새 바뀜"(SPU1, 개정 §5.8) — 값 비교가 어울리지 않는 조작(순서·의존성)이 conflict 와 함께 싣는 문구. 화면은 사전 문구로 알리고 다시 읽는다.
const ERR_MOVE_STALE = '그새 다른 사용자가 순서를 바꿨습니다. 옮기지 않았습니다 — 최신 순서를 확인하세요.'
const ERR_DEP_EXISTS = '이미 연결된 선행 작업입니다'
const ERR_DEP_GONE = '이미 삭제된 연결입니다.'

/** 실적% 입력 — 말단(자식 없는) 항목만. level 은 보지 않는다: 롤업(computeNode)이 자식 유무로
 *  말단을 판정하므로, 자식 없는 Task/Phase 도 자기 actual_pct 가 그대로 상위로 올라간다.
 *  UI 게이트 canEditActual 과 동일 불변식. */
export async function updateActual(
  itemId: string,
  newPct: number,
  expectedCurrent?: number | null,
): Promise<{ ok: boolean; error?: string; conflict?: boolean; latest?: number | null; code?: 'actual_locked' | 'approval_required' }> {
  if (!Number.isFinite(newPct) || newPct < 0 || newPct > 100) return { ok: false, error: E.range }
  // projectId 를 인자로 받지 않으므로 판정 전에 대상 행에서 읽는다 — 조회 실패는 쓰기 중단 사유.
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  // PGRST116 = 0행(항목 없음). 그 외 에러는 진성 조회 실패이므로 '항목 없음'으로 위장하지 않고 그대로 알린다.
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('id, actual_pct, project_id, dev_workflow, tags, stage, review_steps').eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: failWith('wbs.updateActual', itemErr, ERR_ITEM_LOOKUP) }
  if (!item) return { ok: false, error: E.itemMissing }
  // 자식이 있으면 롤업 부모 — 직접 입력한 값은 화면에도 엑셀에도 안 나오므로 거부한다.
  // 조회 실패를 '자식 없음'으로 오인하면 롤업 부모에 실적%가 박혀 화면엔 안 보이는 유령 값이 남는다 → 실패는 거부.
  const { data: child, error: childErr } = await sb.from('wbs_items').select('id').eq('parent_id', itemId).limit(1).maybeSingle()
  if (childErr) return { ok: false, error: failWith('wbs.updateActual', childErr, ERR_CHILD_LOOKUP) }
  if (child) return { ok: false, error: E.hasChildren }

  // 관리자 이상은 담당 무관 전체 허용. 멤버는 자기 팀이 담당인 항목만.
  if (!isProjectAdmin(g.actor, found.projectId)) {
    // 팀이 없는 멤버는 item_owners 에 걸릴 수 없다 — 조회 없이 거부(fail-closed).
    const myTeamIds = actorTeamIdsFor(g.actor, found.projectId!)
    if (myTeamIds.length === 0) return { ok: false, error: E.notOwner }
    // 권한 가드 — 조회 실패를 '담당 아님'이 아니라 통과로 흘려보내면 안 된다. 실패 = 거부(fail-closed).
    const { data: owner, error: ownerErr } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId).in('team_id', myTeamIds).limit(1).maybeSingle()
    if (ownerErr) return { ok: false, error: failWith('wbs.updateActual', ownerErr, ERR_OWNER_LOOKUP) }
    if (!owner) return { ok: false, error: E.notOwner }
  }

  // D7(스펙 2026-09-15 §3.6) — 에이전트 관할 작업(잠금: 위임됨 ∨ 주문 claimed·reported)의 100 은 승인 버튼으로만.
  // 에이전트 API 가 progress 를 99 로 막는 규칙과 같다(2026-08-25 드롭다운 우회 사고 재발 방지). ready 는 dev_workflow
  // 리프마다 상주하므로 잠금이 아니다 — 사람이 직접 하는 Task 는 100 을 넣을 수 있다. 권한 판정 뒤에 둬 잠금 여부를 흘리지 않는다.
  // SP5b(D14) — 순서는 DB guard_workflow_actual 과 같다: im ∧ 유효 단계 ≥2 → 잠금(위임·점유) → xx 아님 ∧ 유효 단계 ≥2(actualHundredBlocked).
  const flags = item as { dev_workflow?: boolean | null; tags?: string[] | null; stage?: string | null; review_steps?: string[] | null }
  if (newPct > 99) {
    const stage = flags.stage ?? null
    const reviewSteps = flags.review_steps ?? null
    const devWorkflow = flags.dev_workflow === true
    let locked = false
    if (devWorkflow) {
      const delegated = (flags.tags ?? []).includes(AGENT_TAG)
      let heldStatus: string | null = null
      if (!delegated) {
        // 쓰기 전 선행 조회 — 실패는 거부(3원칙). 모르는 채로 100 을 쓰면 승인 우회가 된다.
        const { data: held, error: heldErr } = await sb
          .from('agent_work_orders').select('status').eq('wbs_item_id', itemId)
          .in('status', [...AGENT_HELD_ORDER_STATUSES]).limit(1).maybeSingle()
        if (heldErr) return { ok: false, error: failWith('wbs.updateActual', heldErr, ERR_ORDER_LOOKUP) }
        heldStatus = (held as { status: string } | null)?.status ?? null
      }
      locked = stageLockedForHuman({ delegated, orderStatus: heldStatus })
    }
    // 설정(승인 단계)을 읽어야 하는 판정은 DB 가드(guard_workflow_actual — 이 쓰기가 JWT 경로라 반드시 돈다)가 같은 문구(WORKFLOW_APPROVAL_REQUIRED)로
    // 막는다. 앱은 행 값만으로 되는 판정(잠금·스냅샷 단계 수)을 먼저 해 흔한 거부를 쓰기 전에 돌려준다 — 기본 설정으로 판정하면 1단계라 통과다.
    const approvalSteps = DEFAULT_APPROVAL_STEPS
    const blocked = actualHundredBlocked({ devWorkflow, locked, stage, reviewSteps, approvalSteps })
    if (blocked === 'locked') return ACTUAL_LOCKED
    // SP5b(D14): 유효 승인 단계 ≥2 — 단계 승인으로만 완료한다. DB 가드(WORKFLOW_APPROVAL_REQUIRED)와 같은 결과
    if (blocked === 'approval_required') return { ok: false, error: E.approvalRequired, code: 'approval_required' }
  }

  const old = item.actual_pct
  // 낙관적 잠금: 편집 시작 시 본 값과 DB 현재값이 다르면 그새 다른 사용자가 바꾼 것.
  // 충돌은 서버의 현재 값(latest)을 같이 돌려준다 — 화면이 내 값과 나란히 보이고 고르게 한다(개정 §5.8, Q05)
  if (expectedCurrent !== undefined && Number(old ?? 0) !== Number(expectedCurrent ?? 0)) {
    return { ok: false, conflict: true, error: E.conflict, latest: old == null ? null : Number(old) }
  }
  if (Number(old) === newPct) return { ok: true }
  // .select() 필수 — RLS 가 행을 가리면 supabase-js 는 error 없이 0행을 돌려준다.
  // 그대로 두면 저장 실패가 "저장됨" 토스트로 둔갑한다.
  const { data: updated, error: upErr } = await sb
    .from('wbs_items')
    .update({ actual_pct: newPct, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .select('id')
  if (upErr) {
    // 앱 잠금 판정과 이 쓰기 사이에 주문이 claim 되면 DB 가드(0011 guard_workflow_actual)가 막는다 — 같은 문구로.
    // — 첫 낱말로 판정한다(부분 문자열로 뜻을 뽑지 않는다, D21)
    if (dbToken(upErr.message) === 'WORKFLOW_ACTUAL_LOCKED') return ACTUAL_LOCKED
    if (dbToken(upErr.message) === 'WORKFLOW_APPROVAL_REQUIRED') return { ok: false, error: E.approvalRequired, code: 'approval_required' }
    return { ok: false, error: failWith('wbs.updateActual', upErr, ERR_SAVE) }
  }
  if (!updated?.length) return { ok: false, error: E.noWritePermission }

  // 본 저장은 이미 성공했다 — 이력 기록 실패로 되돌리지는 않되, 조용히 삼키지도 않는다(감사 추적 유실 원인 기록).
  const { error: logInsErr } = await sb.from('change_logs').insert({
    user_id: g.actor.userId, wbs_item_id: itemId, field: 'actual_pct',
    old_value: old == null ? null : String(old), new_value: String(newPct),
  })
  if (logInsErr) console.error('[updateActual] 변경 이력 기록 실패:', logInsErr.message)
  await enqueueIndexChange({ domain: 'wbs', projectId: item.project_id, entityId: itemId })
  revalidatePath('/(app)/p/[projectId]', 'layout')
  after(() => recordProgressSnapshot(item.project_id))
  return { ok: true }
}

export async function updateWeight(
  itemId: string,
  weight: number | null,
  expectedCurrent?: number | null,
): Promise<{ ok: boolean; error?: string; conflict?: boolean; latest?: number | null }> {
  // isFinite: Infinity는 JSON 직렬화에서 null(균등)로 둔갑해 이력과 어긋나므로 차단
  if (weight != null && (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0)) {
    return { ok: false, error: E.weightMin }
  }
  // 가중치는 구조/롤업에 영향 → 프로젝트 관리자 이상만 허용
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('id, weight, project_id').eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: failWith('wbs.updateWeight', itemErr, ERR_ITEM_LOOKUP) } // 실패를 '항목 없음'으로 위장 금지
  if (!item) return { ok: false, error: E.itemMissing }

  const old = item.weight
  // 낙관적 잠금: 편집 시작 시 값과 DB 현재값이 다르면 충돌(null=균등도 구분).
  if (expectedCurrent !== undefined) {
    const a = old == null ? null : Number(old)
    const b = expectedCurrent == null ? null : Number(expectedCurrent)
    if (a !== b) return { ok: false, conflict: true, error: E.conflict, latest: a }
  }
  if (Number(old ?? NaN) === Number(weight ?? NaN) && (old == null) === (weight == null)) return { ok: true }
  const { error: upErr } = await sb.from('wbs_items').update({ weight, updated_at: new Date().toISOString() }).eq('id', itemId)
  if (upErr) return { ok: false, error: failWith('wbs.updateWeight', upErr, ERR_SAVE) }

  const { error: logInsErr } = await sb.from('change_logs').insert({
    user_id: g.actor.userId, wbs_item_id: itemId, field: 'weight',
    old_value: old == null ? null : String(old), new_value: weight == null ? null : String(weight),
  })
  if (logInsErr) console.error('[updateWeight] 변경 이력 기록 실패:', logInsErr.message) // 본 저장은 성공 — 이력만 유실
  revalidatePath('/(app)/p/[projectId]', 'layout')
  after(() => recordProgressSnapshot(item.project_id))
  return { ok: true }
}

/** 셀 값의 현재 서버 값 — 저장 응답을 잃었을 때(개정 §5.8.1 OutcomeUnknown, Q10) 반영 여부를 가리는 읽기다. 무조건 다시 보내지 않고
 *  이 값과 내 값·편집 시작 값을 견준다(classifyCasOutcome). 세션 RLS 로 읽는다 — 못 읽는 행은 '없음'이 아니라 실패다. */
export async function getWbsCellSnapshot(
  itemId: string,
): Promise<{ ok: true; actualPct: number | null; weight: number | null; custom: unknown } | { ok: false; error: string }> {
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { data, error } = await sb.from('wbs_items').select('id, actual_pct, weight, custom').eq('id', itemId).maybeSingle()
  if (error) return { ok: false, error: failWith('wbs.getWbsCellSnapshot', error, ERR_ITEM_LOOKUP) }
  if (!data) return { ok: false, error: E.itemMissing }
  const row = data as { actual_pct: number | string | null; weight: number | string | null; custom: unknown }
  return {
    ok: true,
    actualPct: row.actual_pct == null ? null : Number(row.actual_pct),
    weight: row.weight == null ? null : Number(row.weight),
    custom: row.custom ?? {},
  }
}

/* ── 수동 WBS 트리 편집 (구조·일정) — 모두 프로젝트 관리자 이상 전용, change_logs 기록 ── */

type Sb = Awaited<ReturnType<typeof createServerClient>>

/** 말단이던 항목이 첫 자식을 얻어 롤업 부모가 될 때, 직접 입력돼 있던 실적%를 지운다.
 *  남겨 두면 롤업이 가려 화면엔 안 보이지만, 그 자식을 나중에 지우는 순간 옛 값이 되살아난다
 *  (rollup: 자식 없으면 actualPct ?? 0). UI 경고(willDiscardActual)가 약속한 "대체됨"을 실제로 이행한다.
 *  베스트에포트 — 이미 성공한 자식 추가를 되돌리지는 않되, 실패를 change_logs 에 성공으로 남기지도 않는다. */
async function discardRolledUpActual(
  sb: Sb, parentId: string, projectId: string, userId: string | undefined,
): Promise<void> {
  // project_id 동시 확인 — 호출자가 넘긴 parentId 가 다른 프로젝트 행이면 남의 실적을 지우게 된다.
  // 조회 실패 시엔 지우지 않는다(파괴적 쓰기를 추측으로 하지 않음). 자식 추가는 이미 커밋됐으므로 되돌리지 못하고,
  // 부모에 옛 실적%가 남아 나중에 되살아날 수 있으니 원인을 반드시 로그로 남긴다.
  const { data: parent, error: parentErr } = await sb
    .from('wbs_items').select('actual_pct').eq('id', parentId).eq('project_id', projectId).maybeSingle()
  if (parentErr) {
    console.error('[discardRolledUpActual] 부모 실적% 조회 실패 — 정리를 건너뜁니다:', parentErr.message)
    return
  }
  const old = parent?.actual_pct
  if (old == null) return
  const { data: cleared, error } = await sb
    .from('wbs_items')
    .update({ actual_pct: null, updated_at: new Date().toISOString() })
    .eq('id', parentId)
    .select('id')
  // 정리에 실패하면 부모에 옛 실적%가 남아 자식이 지워지는 순간 되살아난다 — 조용히 삼키지 않고 원인을 남긴다.
  if (error) {
    console.error(`[discardRolledUpActual] 부모(${parentId}) 실적% 정리 실패 — 옛 값이 남습니다:`, error.message)
    return
  }
  // RLS 차단은 error 없이 0행으로 온다 — 실제로 지워지지 않았으므로 이력도 남기지 않는다.
  if (!cleared?.length) {
    console.error(`[discardRolledUpActual] 부모(${parentId}) 실적% 정리 0행(RLS 차단 추정) — 옛 값이 남습니다`)
    return
  }
  await sb.from('change_logs').insert({
    user_id: userId, wbs_item_id: parentId, field: 'actual_pct', old_value: String(old), new_value: null,
  })
}

/** 하위(또는 루트 Phase) 항목 추가. 깊이는 parentId 기준 트리에서 파생되며 여기서는 결정하지 않는다. */
export async function addWbsItem(
  projectId: string, parentId: string | null, name: string,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!name.trim()) return { ok: false, error: E.nameRequired }
  const sb = await createServerClient()
  let q = sb.from('wbs_items').select('sort_order, is_owner_split').eq('project_id', projectId)
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null)
  // 형제 조회 실패를 '형제 0개'로 오인하면 (1) sort_order 가 1로 충돌하고 (2) 아래에서 '첫 자식'으로 착각해
  // 부모의 직접 입력 실적%를 지운다. 둘 다 되돌릴 수 없으니 쓰기 전에 중단한다.
  const { data: sibs, error: sibErr } = await q
  if (sibErr || !sibs) return { ok: false, error: failWith('wbs.addWbsItem', sibErr ?? '형제 목록 없음', ERR_SIBLING_LOOKUP) }
  // addSubAct 가드 ①의 대칭 — 부모의 기존 자식에 SUB-ACT 가 섞여 있으면 일반 항목을 추가할 수 없다.
  // 혼재 형제 집합은 tree.ts 의 팀 정렬 분기(형제 중 isOwnerSplit 존재)와 엑셀 라운드트립(sub-act 접기)
  // 계약을 둘 다 깬다(Task 9 리뷰 발견). 기존 자식이 전부 일반 항목이거나 없으면 영향 없음.
  if (parentId && sibs.some(s => s.is_owner_split === true)) {
    return { ok: false, error: E.subActSibling }
  }
  const nextOrder = sibs.reduce((mx, r) => Math.max(mx, Number(r.sort_order) || 0), 0) + 1
  const trimmedName = name.trim()
  const code = trimmedName.split(/[.\s]/)[0] || trimmedName
  const { data, error } = await sb
    .from('wbs_items')
    .insert({ project_id: projectId, parent_id: parentId, code, sort_order: nextOrder, name: trimmedName })
    .select('id')
    .single()
  if (error) return { ok: false, error: failWith('wbs.addWbsItem', error, ERR_ADD) }
  const { error: logInsErr } = await sb.from('change_logs').insert({ user_id: g.actor.userId, wbs_item_id: data.id, field: 'created', old_value: null, new_value: trimmedName })
  if (logInsErr) console.error('[addWbsItem] 변경 이력 기록 실패:', logInsErr.message) // 항목 생성은 성공 — 이력만 유실
  await enqueueIndexChange({ domain: 'wbs', projectId: projectId, entityId: data.id as string })
  // 부모가 방금 말단에서 롤업 부모로 바뀌었다면 남아 있던 직접 입력 실적%를 정리(sibs 는 위에서 검증된 실제 형제 목록).
  if (parentId && sibs.length === 0) await discardRolledUpActual(sb, parentId, projectId, g.actor.userId)
  revalidatePath('/(app)/p/[projectId]', 'layout')
  after(() => recordProgressSnapshot(projectId))
  return { ok: true, id: data.id as string }
}

/** ACT(자식 있는/없는 활동) 하위에 담당 팀별 SUB-ACT(활동 자식) 1개 추가 — 프로젝트 관리자 전용.
 *  임포트 분리(splitLeafOwners)와 같은 모양을 손으로 재현한다:
 *   - is_owner_split=true, 이름 "{ACT명} ({팀} 주관/지원)", 코드·계획일정·biz·산출물 상속, 가중치 균등, 실적 0(=null).
 *   - 담당 1팀(item_owners) 필수 — 없으면 팀 배지가 없고 정렬 맨 뒤, 팀 편집자가 실적% 입력 불가.
 *   - 부모 ACT 에도 그 팀 담당 표기를 넣어 엑셀 내보내기→재임포트 라운드트립에서 SUB-ACT 가 사라지지 않게 한다.
 *  판별은 레벨이 아니라 플래그로 한다(스펙 §5.2) — 대상은 리프여야 하고(기존 SUB-ACT 형제에 추가하는
 *  경로는 예외), 대상 자신이 SUB-ACT면 거부(1단계 제한 유지, 엑셀 3단 형식 보존). */
export async function addSubAct(
  actId: string, team: TeamCode, kind: OwnerKind,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  // actId 는 wbs_items.id — 판정 대상 프로젝트를 그 행에서 읽는다.
  const found = await resolveProjectId('wbs_items', actId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()

  const { data: act, error: actErr } = await sb
    .from('wbs_items')
    .select('id, project_id, code, name, biz, deliverable, planned_start, planned_end, is_owner_split')
    .eq('id', actId).single()
  if (actErr && actErr.code !== 'PGRST116') return { ok: false, error: failWith('wbs.addSubAct', actErr, ERR_ITEM_LOOKUP) } // 0행(PGRST116)만 '항목 없음'
  if (!act) return { ok: false, error: '항목 없음' }
  // 가드 ②: 대상 자신이 SUB-ACT면 거부 — 1단계 제한(엑셀 3단 형식 보존).
  if (act.is_owner_split) return { ok: false, error: 'SUB-ACT 아래에는 추가할 수 없습니다' }

  // 형제(기존 SUB-ACT) 조회 — 가드 ①(리프 판정) + 중복 팀 방지 + sort_order 채번.
  // 조회 실패를 '형제 0개'로 오인하면 가드 ①이 오통과하고, sort_order 충돌 + 중복 팀 검사 무력화 +
  // '첫 SUB-ACT' 오판으로 ACT 의 직접 입력 실적%까지 지운다. 쓰기 전에 중단한다.
  const { data: sibs, error: sibErr } = await sb.from('wbs_items').select('id, sort_order, is_owner_split').eq('parent_id', actId)
  if (sibErr || !sibs) return { ok: false, error: failWith('wbs.addSubAct', sibErr ?? '형제 목록 없음', ERR_SIBLING_LOOKUP) }
  // 가드 ①: 대상은 리프여야 한다 — 자식이 있으면 거부한다. 단, 자식 전원이 SUB-ACT면 예외 허용
  // (기존 SUB-ACT 형제에 새 팀을 추가하는 정상 경로).
  if (sibs.length > 0 && !sibs.every(s => s.is_owner_split === true)) {
    return { ok: false, error: 'SUB-ACT가 아닌 하위 항목이 있는 곳에는 추가할 수 없습니다' }
  }

  // 팀 코드 → teams.id — 이 프로젝트에서 고를 수 있는 팀(projectTeams 의 활성 팀: 전용 팀이 하나라도 있으면 그것만, 없으면 그 워크스페이스의
  // 공용 팀)에서만 고른다. 명단(checkRosterTeams)·초대·영역과 같은 원천이고 화면의 선택지(useTeamCodes — 같은 팀의 활성 code)와도 같다(A2 최종
  // 리뷰 보안 P3 — FF1). 예전에는 정확한 code 로 teams 를 읽고 전용 팀이 없으면 공용 팀으로 폴백해, 전용 팀 'QA' 가 있는 프로젝트에 서버 액션을
  // 직접 불러 공용 'qa'(같은 낱말의 두 팀)나 목록 밖 공용 팀을 담당으로 붙일 수 있었다 — DB(0016 M1)는 정확히 같은 code 의 전용 팀만 막고 범위
  // 가드(0009)는 같은 워크스페이스 공용 팀을 허용한다. 가져오기 RPC 의 공용 폴백은 라우트가 참조 판정(Z4)·등록으로 먼저 거른 뒤라 이 길과 다르다.
  // 워크스페이스는 원천이 그 프로젝트의 설정 행에서 정한다(다른 워크스페이스의 같은 code 팀은 후보가 아니다). 조회 실패는 '팀 없음'으로 위장하지 않는다.
  let choices: Awaited<ReturnType<typeof projectTeams>>
  try {
    choices = (await projectTeams(act.project_id as string)).filter(t => t.active)
  } catch (e) {
    return { ok: false, error: failWith('wbs.addSubAct', e, ERR_TEAM_LOOKUP) }
  }
  const teamRow = choices.find(t => t.code === team)
  if (!teamRow) {
    // 정규화 키(NFKC·소문자)만 같은 낱말은 그 팀으로 바꿔 쓰지 않고 거절한다 — 고를 팀을 알려 준다
    const key = typeof team === 'string' ? teamNameKey(team) : ''
    const near = key ? choices.find(t => teamNameKey(t.code) === key || teamNameKey(t.name) === key) : undefined
    return { ok: false, error: near ? `'${near.code}' 팀과 같은 낱말입니다 — 그 팀을 고르세요.` : '이 프로젝트에서 고를 수 있는 담당 팀이 아닙니다' }
  }
  const teamId = teamRow.id

  const sibIds = sibs.map(s => s.id as string)
  if (sibIds.length) {
    const { data: dup, error: dupErr } = await sb
      .from('item_owners').select('wbs_item_id').eq('team_id', teamId).in('wbs_item_id', sibIds).limit(1).maybeSingle()
    if (dupErr) return { ok: false, error: failWith('wbs.addSubAct', dupErr, ERR_TEAM_LOOKUP) } // 실패 = 거부(중복 SUB-ACT 생성 방지)
    if (dup) return { ok: false, error: '이미 해당 팀의 SUB-ACT가 있습니다' }
  }
  const nextOrder = sibs.reduce((mx, r) => Math.max(mx, Number(r.sort_order) || 0), 0) + 1

  const name = subActName(act.name as string, team, kind)
  // 가드 ③: is_owner_split=true 가 판별의 진실(level 컬럼은 더 이상 쓰지 않는다 — 컬럼 자체는 Task 5에서 drop).
  const { data: inserted, error: insErr } = await sb
    .from('wbs_items')
    .insert({
      project_id: act.project_id, parent_id: actId, is_owner_split: true, code: act.code,
      sort_order: nextOrder, name, biz: act.biz, deliverable: act.deliverable,
      planned_start: act.planned_start, planned_end: act.planned_end, weight: null, actual_pct: null,
    })
    .select('id').single()
  if (insErr || !inserted) return { ok: false, error: failWith('wbs.addSubAct', insErr ?? '추가 결과 없음', ERR_ADD) }
  const newId = inserted.id as string

  const { error: ownErr } = await sb.from('item_owners').insert({ wbs_item_id: newId, team_id: teamId, kind })
  if (ownErr) {
    // 담당 없는 고아 SUB-ACT 를 남기지 않도록 방금 만든 행 정리 후 실패 반환.
    await sb.from('wbs_items').delete().eq('id', newId)
    return { ok: false, error: failWith('wbs.addSubAct', ownErr, ERR_ADD) }
  }

  // 부모 ACT 에 담당 팀 표기 보강(라운드트립 안정용) — 이미 있으면 그대로 둔다. 베스트에포트.
  // 선행 조회 없이 바로 insert 한다: PK 가 (wbs_item_id, team_id) 라 '이미 있음'은 DB 가 23505 로 막아 준다
  // (= 중복은 정상 경로). 조회로 미리 거르면 조회 실패 시 보강 자체가 누락돼 라운드트립에서 SUB-ACT 가 사라진다.
  // SUB-ACT 는 이미 커밋됐으므로 여기서 실패해도 액션을 되돌리지 않고 로그만 남긴다.
  const { error: parentOwnerErr } = await sb.from('item_owners').insert({ wbs_item_id: actId, team_id: teamId, kind })
  if (parentOwnerErr && parentOwnerErr.code !== '23505') {
    console.error('[addSubAct] 부모 ACT 담당 표기 보강 실패:', parentOwnerErr.message)
  }

  const { error: logInsErr } = await sb.from('change_logs').insert({ user_id: g.actor.userId, wbs_item_id: newId, field: 'created', old_value: null, new_value: name })
  if (logInsErr) console.error('[addSubAct] 변경 이력 기록 실패:', logInsErr.message) // SUB-ACT 생성은 성공 — 이력만 유실
  await enqueueIndexChange({ domain: 'wbs', projectId: act.project_id as string, entityId: newId })
  // 첫 SUB-ACT 면 ACT 가 방금 롤업 부모가 된 것 — 직접 입력돼 있던 실적%를 정리(sibIds 는 위에서 검증된 실제 형제 목록).
  if (sibIds.length === 0) await discardRolledUpActual(sb, actId, act.project_id as string, g.actor.userId)
  revalidatePath('/(app)/p/[projectId]', 'layout')
  after(() => recordProgressSnapshot(act.project_id))
  return { ok: true, id: newId }
}

type WbsFieldValues = { name?: string; plannedStart?: string | null; plannedEnd?: string | null; deliverable?: string | null; biz?: string | null }
type WbsFieldKey = keyof WbsFieldValues
/** 화면 값의 저장 꼴 — 이름은 다듬고, 나머지는 빈 값을 null 로(아래 patch 가 쓰는 꼴과 같다) */
const fieldStored = (key: WbsFieldKey, v: string | null | undefined): string | null =>
  key === 'plannedStart' || key === 'plannedEnd' ? (v || null) : key === 'name' ? (v ?? '').trim() : (v?.trim() || null)

/** 이름·계획일자·산출물·Biz 편집. 시작>종료 거부, 변경분만 기록.
 *  expected(SPU1, 개정 §5.8 — 무통보 덮어쓰기 0건): 폼을 열 때 본 값. 그새 서버 값이 달라진 칸은 — 내가 고치지 않은 칸이면 건드리지 않고
 *  (남의 변경을 낡은 폼 값으로 되돌리지 않는다), 내가 고친 칸이면 쓰지 않고 충돌과 그 현재 값(latest)을 돌려준다. 없으면 옛 무조건 저장이다. */
export async function updateWbsFields(
  itemId: string,
  input: WbsFieldValues,
  expected?: WbsFieldValues,
): Promise<{ ok: boolean; error?: string; conflict?: boolean; latest?: WbsFieldValues }> {
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  // 아래 patch/logs 가 이 현재값과의 diff 로 만들어진다 — 조회 실패를 '항목 없음'으로 위장하면 안 되고,
  // 빈 현재값으로 진행하면 변경 없는 필드까지 덮어쓰고 이력의 old_value 도 거짓이 된다. 실패 = 중단.
  const { data: item, error: itemErr } = await sb
    .from('wbs_items')
    .select('id, project_id, name, planned_start, planned_end, deliverable, biz')
    .eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: failWith('wbs.updateWbsFields', itemErr, ERR_ITEM_LOOKUP) }
  if (!item) return { ok: false, error: '항목 없음' }

  const fields: WbsFieldValues = { ...input }
  if (expected) {
    const current: Record<WbsFieldKey, string | null> = {
      name: item.name, plannedStart: item.planned_start, plannedEnd: item.planned_end, deliverable: item.deliverable, biz: item.biz,
    }
    const latest: Record<string, string | null> = {}
    for (const key of Object.keys(current) as WbsFieldKey[]) {
      if (input[key] === undefined || expected[key] === undefined) continue
      const seen = fieldStored(key, expected[key])
      if (current[key] === seen) continue                      // 내가 본 값 그대로다
      const mine = fieldStored(key, input[key])
      if (mine === seen || mine === current[key]) delete fields[key]   // 내가 고치지 않은 칸(또는 이미 같은 값) — 남의 변경을 둔다
      else latest[key] = current[key]
    }
    if (Object.keys(latest).length > 0) return { ok: false, conflict: true, error: E.conflict, latest: latest as WbsFieldValues }
  }

  const patch: Record<string, unknown> = {}
  const logs: { field: string; old: string | null; new: string | null }[] = []
  if (fields.name !== undefined) {
    if (!fields.name.trim()) return { ok: false, error: '이름을 입력하세요' }
    if (fields.name.trim() !== item.name) { patch.name = fields.name.trim(); logs.push({ field: 'name', old: item.name, new: fields.name.trim() }) }
  }
  const ns = fields.plannedStart === undefined ? undefined : (fields.plannedStart || null)
  const ne = fields.plannedEnd === undefined ? undefined : (fields.plannedEnd || null)
  const finalStart = ns === undefined ? item.planned_start : ns
  const finalEnd = ne === undefined ? item.planned_end : ne
  if (finalStart && finalEnd && finalStart > finalEnd) return { ok: false, error: '시작일이 종료일보다 늦습니다' }
  if ((ns !== undefined || ne !== undefined) && (!finalStart || !finalEnd)) {
    const { data: linked, error: linkedErr } = await sb
      .from('task_dependencies')
      .select('id')
      .or(`predecessor_id.eq.${itemId},successor_id.eq.${itemId}`)
      .limit(1)
      .maybeSingle()
    if (linkedErr) return { ok: false, error: failWith('wbs.updateWbsFields', linkedErr, ERR_DEP_LOOKUP) }
    if (linked) return { ok: false, error: '의존성이 연결된 작업의 계획일은 비울 수 없습니다. 연결을 먼저 삭제하세요.' }
  }
  if (ns !== undefined && ns !== item.planned_start) { patch.planned_start = ns; logs.push({ field: 'planned_start', old: item.planned_start, new: ns }) }
  if (ne !== undefined && ne !== item.planned_end) { patch.planned_end = ne; logs.push({ field: 'planned_end', old: item.planned_end, new: ne }) }
  if (fields.deliverable !== undefined) {
    const v = fields.deliverable?.trim() || null
    if (v !== item.deliverable) { patch.deliverable = v; logs.push({ field: 'deliverable', old: item.deliverable, new: v }) }
  }
  if (fields.biz !== undefined) {
    const v = fields.biz?.trim() || null
    if (v !== item.biz) { patch.biz = v; logs.push({ field: 'biz', old: item.biz, new: v }) }
  }
  if (Object.keys(patch).length === 0) return { ok: true }
  patch.updated_at = new Date().toISOString()
  const { error } = await sb.from('wbs_items').update(patch).eq('id', itemId)
  if (error) return { ok: false, error: failWith('wbs.updateWbsFields', error, ERR_SAVE) }
  await enqueueIndexChange({ domain: 'wbs', projectId: item.project_id, entityId: itemId })
  if (logs.length) {
    const { error: logInsErr } = await sb.from('change_logs').insert(logs.map(l => ({ user_id: g.actor.userId, wbs_item_id: itemId, field: l.field, old_value: l.old, new_value: l.new })))
    if (logInsErr) console.error('[updateWbsFields] 변경 이력 기록 실패:', logInsErr.message) // 본 저장은 성공 — 이력만 유실
  }
  revalidatePath('/(app)/p/[projectId]', 'layout')
  after(() => recordProgressSnapshot(item.project_id))
  return { ok: true }
}

/** 선행→후행 작업 의존성 추가 — 기준 계획은 바꾸지 않고 예상 일정 계산에 사용한다.
 *  같은 연결이 이미 있으면(화면이 연 뒤 다른 사람이 먼저 이었다) 다시 쓰지 않고 conflict 로 알린다(SPU1, 개정 §5.8) — 값을 덮는 조작이 아니라
 *  기대값 대조 대신 DB 유일 제약(23505)이 가린다. 화면은 실패로 그리지 않고 다시 읽어 그 연결을 보인다. */
export async function addTaskDependency(
  projectId: string,
  predecessorId: string,
  successorId: string,
  type: DependencyType,
  lagDays = 0,
): Promise<{ ok: boolean; error?: string; id?: string; conflict?: boolean }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!projectId || !predecessorId || !successorId) return { ok: false, error: '연결할 작업을 선택하세요' }
  if (predecessorId === successorId) return { ok: false, error: '같은 작업끼리는 연결할 수 없습니다' }
  if (type !== 'FS' && type !== 'SS') return { ok: false, error: '지원하지 않는 의존성 유형입니다' }
  if (!Number.isInteger(lagDays) || lagDays < 0 || lagDays > 365) {
    return { ok: false, error: '대기일은 0~365일의 정수로 입력하세요' }
  }

  const sb = await createServerClient()
  const { data: endpoints, error: endpointErr } = await sb
    .from('wbs_items')
    .select('id, project_id, planned_start, planned_end')
    .in('id', [predecessorId, successorId])
  if (endpointErr) return { ok: false, error: failWith('wbs.addTaskDependency', endpointErr, ERR_TASK_LOOKUP) }
  if (!endpoints || endpoints.length !== 2) return { ok: false, error: '연결할 작업을 찾을 수 없습니다' }
  if (endpoints.some(item => item.project_id !== projectId)) {
    return { ok: false, error: '같은 프로젝트의 작업끼리만 연결할 수 있습니다' }
  }
  if (endpoints.some(item => !item.planned_start || !item.planned_end)) {
    return { ok: false, error: '계획 시작일과 종료일이 있는 작업만 연결할 수 있습니다' }
  }
  if (endpoints.some(item => item.planned_start > item.planned_end)) {
    return { ok: false, error: '시작일이 종료일보다 늦은 작업은 연결할 수 없습니다' }
  }
  // 근무일 판정은 프로젝트 달력(근무 요일 + 휴무·특정일 근무 — SP5 D11). 손상 키·조회 실패는 기본 달력으로 잇지 않는다([RF4])
  let calendar: WorkCalendar
  try {
    calendar = requireCalendar(await getProjectConfig(projectId))
  } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, error: `${CONFIG_MESSAGES[e.code]} (${e.key})` }   // 손상 키 이름이 든 고정 문구(CONFIG_INVALID)
    if (e instanceof ConfigUnavailableError) {
      console.error('[wbs/dependency] 달력 조회 실패', { projectId, cause: e.message })
      return { ok: false, error: ERR_CALENDAR_LOOKUP }
    }
    throw e
  }
  if (endpoints.some(item => workingDaysBetween(item.planned_start, item.planned_end, calendar) === 0)) {
    return { ok: false, error: '계획 기간에 근무일이 없는 작업은 연결할 수 없습니다' }
  }

  // 앱에서도 순환을 선제 차단해 DB 제약의 원문 오류 대신 사용자가 이해할 메시지를 준다.
  const { data: existing, error: dependencyErr } = await sb
    .from('task_dependencies')
    .select('predecessor_id, successor_id')
    .eq('project_id', projectId)
  if (dependencyErr) return { ok: false, error: failWith('wbs.addTaskDependency', dependencyErr, ERR_DEP_LOOKUP) }
  const nextById = new Map<string, string[]>()
  for (const dep of existing ?? []) {
    const arr = nextById.get(dep.predecessor_id as string) ?? []
    arr.push(dep.successor_id as string)
    nextById.set(dep.predecessor_id as string, arr)
  }
  const seen = new Set<string>()
  const stack = [successorId]
  while (stack.length) {
    const id = stack.pop()!
    if (id === predecessorId) return { ok: false, error: '순환 의존성은 등록할 수 없습니다' }
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(nextById.get(id) ?? []))
  }

  const { data: inserted, error } = await sb
    .from('task_dependencies')
    .insert({
      project_id: projectId,
      predecessor_id: predecessorId,
      successor_id: successorId,
      dependency_type: type,
      lag_days: lagDays,
    })
    .select('id')
    .single()
  if (error?.code === '23505') return { ok: false, conflict: true, error: ERR_DEP_EXISTS }
  if (error) return { ok: false, error: failWith('wbs.addTaskDependency', error, ERR_ADD) }

  const { error: logErr } = await sb.from('change_logs').insert({
    user_id: g.actor.userId,
    wbs_item_id: successorId,
    field: 'dependency',
    old_value: null,
    new_value: `${predecessorId}|${type}|${lagDays}`,
  })
  if (logErr) console.error('[addTaskDependency] 변경 이력 기록 실패:', logErr.message)
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true, id: inserted.id as string }
}

/** 작업 의존성 삭제 — 프로젝트 관리자 이상 전용.
 *  이미 지워진 연결이면(화면이 연 뒤 다른 사람이 먼저 지웠다) 실패로 위장하지 않고 conflict 로 알린다(SPU1, 개정 §5.8) — 화면이 다시 읽는다.
 *  조회 실패(ERR_LOOKUP)는 '없음'으로 읽지 않는다. */
export async function removeTaskDependency(
  dependencyId: string,
): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
  const found = await resolveProjectId('task_dependencies', dependencyId)
  // 행이 없다(또는 RLS 가 가린다) — 볼 수 없는 사람에게도 같은 답이라 존재를 흘리지 않는다
  if (!found.ok) return found.error === ERR_MISSING ? { ok: false, conflict: true, error: ERR_DEP_GONE } : { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { data: dependency, error: findErr } = await sb
    .from('task_dependencies')
    .select('id, project_id, predecessor_id, successor_id, dependency_type, lag_days')
    .eq('id', dependencyId)
    .single()
  if (findErr?.code === 'PGRST116') return { ok: false, conflict: true, error: ERR_DEP_GONE }   // 소속 확인과 이 읽기 사이에 지워졌다
  if (findErr || !dependency) return { ok: false, error: failWith('wbs.removeTaskDependency', findErr ?? '의존성 없음', ERR_DEP_LOOKUP) }

  const { data: deleted, error } = await sb
    .from('task_dependencies')
    .delete()
    .eq('id', dependencyId)
    .select('id')
  if (error) return { ok: false, error: failWith('wbs.removeTaskDependency', error, ERR_DELETE) }
  if (!deleted?.length) {
    // 0행은 둘 중 하나다 — 읽기와 삭제 사이에 남이 지웠거나(그새 바뀜), RLS 가 막았거나. 다시 읽어 가린다(읽기 실패는 어느 쪽으로도 단정하지 않는다)
    const { data: still, error: stillErr } = await sb.from('task_dependencies').select('id').eq('id', dependencyId).maybeSingle()
    if (stillErr) return { ok: false, error: failWith('wbs.removeTaskDependency', stillErr, ERR_DEP_LOOKUP) }
    return still ? { ok: false, error: '삭제 권한이 없습니다' } : { ok: false, conflict: true, error: ERR_DEP_GONE }
  }

  const { error: logErr } = await sb.from('change_logs').insert({
    user_id: g.actor.userId,
    wbs_item_id: dependency.successor_id,
    field: 'dependency',
    old_value: `${dependency.predecessor_id}|${dependency.dependency_type}|${dependency.lag_days}`,
    new_value: null,
  })
  if (logErr) console.error('[removeTaskDependency] 변경 이력 기록 실패:', logErr.message)
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true }
}

/** 산출물 텍스트만 편집 — 산출물 첨부와 동일 권한(관리자 이상은 전체, 멤버는 자기 팀 담당 항목만).
 *  이름·일정·구조는 거버넌스라 관리자 전용(updateWbsFields)으로 분리 유지. 진척 무관 → 스냅샷 생략. */
export async function updateDeliverable(
  itemId: string,
  deliverable: string | null,
  /** 편집을 열 때 본 값(SPU1) — 서버 값이 그새 달라졌으면 쓰지 않고 충돌과 그 값(latest)을 돌려준다 */
  expected?: string | null,
): Promise<{ ok: boolean; error?: string; conflict?: boolean; latest?: string | null }> {
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb
    .from('wbs_items').select('id, project_id, deliverable').eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: failWith('wbs.updateDeliverable', itemErr, ERR_ITEM_LOOKUP) }
  if (!item) return { ok: false, error: '항목 없음' }
  // 권한 — 관리자 아니면 담당팀만(item_owners). attachments.canAttach 와 같은 판정.
  if (!isProjectAdmin(g.actor, found.projectId)) {
    const myTeamIds = actorTeamIdsFor(g.actor, found.projectId!) // 팀 없는 멤버는 담당이 될 수 없다
    if (myTeamIds.length === 0) return { ok: false, error: '담당 작업이 아닙니다.' }
    const { data: own, error: ownErr } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId).in('team_id', myTeamIds).limit(1).maybeSingle()
    if (ownErr) return { ok: false, error: failWith('wbs.updateDeliverable', ownErr, ERR_OWNER_LOOKUP) } // 실패를 '담당 아님'으로도, 통과로도 위장하지 않는다
    if (!own) return { ok: false, error: '담당 작업이 아닙니다.' }
  }
  const v = deliverable?.trim() || null
  if (v === item.deliverable) return { ok: true }
  if (expected !== undefined && (expected?.trim() || null) !== item.deliverable) return { ok: false, conflict: true, error: E.conflict, latest: item.deliverable }
  const { error } = await sb.from('wbs_items').update({ deliverable: v, updated_at: new Date().toISOString() }).eq('id', itemId)
  if (error) return { ok: false, error: failWith('wbs.updateDeliverable', error, ERR_SAVE) }
  await enqueueIndexChange({ domain: 'wbs', projectId: item.project_id, entityId: itemId })
  const { error: logErr } = await sb.from('change_logs').insert({ user_id: g.actor.userId, wbs_item_id: itemId, field: 'deliverable', old_value: item.deliverable, new_value: v })
  if (logErr) console.error('[updateDeliverable] 변경 이력 기록 실패:', logErr.message) // 본 저장은 성공 — 이력만 유실
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true }
}

/** 항목 삭제(하위·담당·이력 cascade). */
export async function deleteWbsItem(itemId: string): Promise<{ ok: boolean; error?: string }> {
  // resolveProjectId 가 존재 확인(없으면 ok:false)과 project_id 조회를 이미 끝냈다 —
  // 같은 행을 다시 읽을 이유가 없어 재조회 없이 그 값을 쓴다.
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const projectId = found.projectId
  // wbs_items.project_id 는 NOT NULL 이지만 resolveProjectId 타입이 nullable(minutes 공용)이라
  // 여기서 좁힌다 — 모르면 중단(fail-closed).
  if (!projectId) return { ok: false, error: '프로젝트 확인 실패' }
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { error } = await sb.from('wbs_items').delete().eq('id', itemId)
  if (error) return { ok: false, error: failWith('wbs.deleteWbsItem', error, ERR_DELETE) }
  await enqueueIndexChange({ domain: 'wbs', projectId: projectId, entityId: itemId, operation: 'delete' })
  revalidatePath('/(app)/p/[projectId]', 'layout')
  after(() => recordProgressSnapshot(projectId))
  return { ok: true }
}

/** 화면이 본 항목의 자리 — 부모·자기 sort_order·맞바꿀 이웃(sort_order 순서의 바로 위/아래, 경계면 null). 전부 기존 열이다 */
type WbsMoveExpected = { parentId: string | null; sortOrder: number; neighborId?: string | null }
type WbsMoveResult = { ok: boolean; error?: string; conflict?: boolean; latest?: { parentId: string | null; sortOrder: number; neighborId: string | null } }

/** 형제 내 순서 이동(위/아래) — 인접 형제와 sort_order 교환.
 *  expected(SPU1, 개정 §5.8 — 무통보 덮어쓰기 0건): 화면이 본 자리. 그새 이 항목이 옮겨졌거나(부모·sort_order) 맞바꿀 이웃이 달라졌으면
 *  옮기지 않고 conflict 와 서버의 현재 자리(latest)를 돌려준다 — 낡은 화면의 '위로'가 남이 정리한 순서를 뒤섞지 않는다. 교환의 두 update 도
 *  읽은 sort_order 를 조건으로 써 읽기와 쓰기 사이의 끼어들기를 0행으로 잡는다. 없으면 옛 무조건 교환이다. */
export async function moveWbsItem(itemId: string, dir: 'up' | 'down', expected?: WbsMoveExpected): Promise<WbsMoveResult> {
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectAdmin(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (expected !== undefined && (
    typeof expected !== 'object' || expected === null || !Number.isFinite(Number(expected.sortOrder))
    || (expected.parentId !== null && typeof expected.parentId !== 'string')
    || (expected.neighborId != null && typeof expected.neighborId !== 'string')
  )) return { ok: false, error: '잘못된 요청입니다.' }
  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('id, project_id, parent_id, sort_order').eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: failWith('wbs.moveWbsItem', itemErr, ERR_ITEM_LOOKUP) }
  if (!item) return { ok: false, error: '항목 없음' }
  let q = sb.from('wbs_items').select('id, sort_order').eq('project_id', item.project_id)
  q = item.parent_id ? q.eq('parent_id', item.parent_id) : q.is('parent_id', null)
  // 형제 조회 실패를 빈 목록으로 폴백하면 idx=-1 이 되어 "경계라 무시"(ok:true) 경로로 빠진다 —
  // 아무것도 안 하고 이동 성공으로 위장하게 되므로 실패를 그대로 알린다.
  // 같은 sort_order 는 id 로 가른다 — 화면(moveExpectation)이 같은 규칙으로 이웃을 고르므로 동률에서도 본 이웃과 서버의 이웃이 같다.
  const { data: sibs, error: sibErr } = await q.order('sort_order', { ascending: true }).order('id', { ascending: true })
  if (sibErr || !sibs) return { ok: false, error: failWith('wbs.moveWbsItem', sibErr ?? '형제 목록 없음', ERR_SIBLING_LOOKUP) }
  const arr = sibs
  const idx = arr.findIndex(s => s.id === itemId)
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1
  const neighbor = idx < 0 || swapIdx < 0 || swapIdx >= arr.length ? null : arr[swapIdx]
  const stale = (): WbsMoveResult => ({
    ok: false, conflict: true, error: ERR_MOVE_STALE,
    latest: { parentId: (item.parent_id as string | null) ?? null, sortOrder: Number(item.sort_order), neighborId: (neighbor?.id as string | undefined) ?? null },
  })
  if (expected && (
    ((item.parent_id as string | null) ?? null) !== expected.parentId || Number(item.sort_order) !== Number(expected.sortOrder)
    || (expected.neighborId !== undefined && ((neighbor?.id as string | undefined) ?? null) !== expected.neighborId)
  )) return stale()
  if (!neighbor) return { ok: true } // 경계는 무시
  const a = arr[idx], b = neighbor
  /** 조건부 교환이 0행일 때 — 그 행을 다시 읽어 '그새 바뀜'(conflict)과 RLS 차단을 가린다. 읽기 실패는 어느 쪽으로도 단정하지 않는다 */
  const zeroRows = async (row: { id: unknown; sort_order: unknown }): Promise<WbsMoveResult> => {
    if (!expected) return { ok: false, error: ERR_MOVE_DENIED }
    const { data: now, error: nowErr } = await sb.from('wbs_items').select('id, sort_order').eq('id', row.id as string).maybeSingle()
    if (nowErr) return { ok: false, error: failWith('wbs.moveWbsItem', nowErr, ERR_ITEM_LOOKUP) }
    return !now || Number(now.sort_order) !== Number(row.sort_order) ? stale() : { ok: false, error: ERR_MOVE_DENIED }
  }
  // 교환은 두 번의 update — 트랜잭션이 아니라 한쪽만 성공하면 sort_order 가 중복된 채 커밋된다.
  // .select('id') 필수: RLS 차단은 error 없이 0행으로 오므로 0행도 실패로 잡아야 한다.
  let upA = sb.from('wbs_items').update({ sort_order: b.sort_order }).eq('id', a.id)
  if (expected) upA = upA.eq('sort_order', a.sort_order)
  const { data: movedA, error: swapAErr } = await upA.select('id')
  if (swapAErr) return { ok: false, error: failWith('wbs.moveWbsItem', swapAErr, ERR_MOVE) }
  if (!movedA?.length) return zeroRows(a)
  let upB = sb.from('wbs_items').update({ sort_order: a.sort_order }).eq('id', b.id)
  if (expected) upB = upB.eq('sort_order', b.sort_order)
  const { data: movedB, error: swapBErr } = await upB.select('id')
  if (swapBErr || !movedB?.length) {
    // a 만 바뀌어 두 형제의 sort_order 가 중복된 상태 — '실패'라고 알리려면 데이터도 원래대로 돌려놔야 한다.
    // 보상마저 실패하면 중복이 남으므로(정렬이 흔들림) 원인을 반드시 로그에 남긴다.
    const { data: rolledBack, error: rollbackErr } = await sb
      .from('wbs_items').update({ sort_order: a.sort_order }).eq('id', a.id).select('id')
    if (rollbackErr || !rolledBack?.length) {
      console.error(
        `[moveWbsItem] 보상 롤백 실패 — sort_order 중복 잔존(item=${a.id}, sort_order=${String(b.sort_order)}):`,
        rollbackErr?.message ?? '0행(RLS 차단 추정)',
      )
    }
    return swapBErr ? { ok: false, error: failWith('wbs.moveWbsItem', swapBErr, ERR_MOVE) } : zeroRows(b)
  }
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true }
}
