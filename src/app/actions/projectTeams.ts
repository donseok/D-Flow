'use server'

// 프로젝트 팀 관리(프로젝트 관리자) — 전역 팀(/admin/teams, 슈퍼유저)과 별개 스코프(0071).
// 회의록 시드 폴더는 만들지 않는다: 회의록·또박또박은 전역 팀 축이다(스펙 §5).
// 삭제 없음: 비활성화=삭제(전역 팀과 동일 관례).

import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { reservedTeamNames } from '@/lib/domain/teams'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { pickTeamColor, teamColorOfSlot } from '@/lib/domain/teamColor'
import { checkNewTeam, checkTeamCodeChange, checkTeamRename, newTeamCodeClash, newTeamNameClash, teamCodeClashError } from '@/lib/domain/teamName'
import {
  ERR_TEAM_CODE_CHANGE, ERR_TEAM_CODE_SCOPE_CONFLICT, ERR_TEAM_MERGE, ERR_TEAM_MERGE_PREVIEW, ERR_TEAM_MERGE_SAME, ERR_TEAM_MERGE_TARGET_INACTIVE,
  NOTICE_TEAM_CODE_PROFILE,
  TEAM_CODE_TOKENS, TEAM_MERGE_TOKENS, parseTeamMergeResult, parseTeamRefCounts, type TeamMergeSummary, type TeamRefCounts,
} from '@/lib/teams/teamOps'
import { swapExcelProfileTeamCode } from '@/lib/teams/excelProfileCode'
import { ERR_TEAM_ORDER_STALE, swapTeamOrder } from '@/lib/teams/swapOrder'
import { referencedCommonTeamCodes } from '@/lib/teams/referencedCommon'
import { failWith, rpcFailure, type OwnTokenTable } from '@/lib/errors/dbFail'
import { teamRootNameError } from '@/lib/minutes/teamRootErrors'
import { enqueueTeamRenameIndexChange } from '@/lib/ai/index/enqueueChange'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'
import { fill } from '@/lib/i18n/translate'
import { libText } from '@/lib/i18n/serverText'

/** notice — 성공했지만 사용자에게 알릴 것(코드 변경 뒤 엑셀 양식을 맞추지 못했다 등) */
export type ProjectTeamActionResult = { ok: true; notice?: string } | { ok: false; error: string }

// DB 원문은 로그로만(SP4 D21) — 응답에는 고정 문구. 'use server' 라 export 하지 않는다.
const ERR_TEAM_LOOKUP = 'err.couldNotVerifyTeam'
const ERR_TEAM_CREATE = 'err.couldNotCreateTeam'
const ERR_TEAM_UPDATE = 'err.couldNotUpdateTeam'
const ERR_TEAM_COLOR = 'err.colorCannotSelected'
const ERR_TEAM_NOT_OWN = 'srv.projectTeams.teamDoesNotBelongProject'
const ERR_TEAM_COPY = 'srv.projectTeams.couldNotConvertSharedTeams'
const ERR_COMMON_IN_USE = (t: ServerTranslate, code: string) =>
  fill(t('srv.projectTeams.projectAlreadyUsesSharedTeam'), { code })

/** 전용 팀 추가 — 이름(바꿀 수 있다)과 코드(식별자 — 바꾸려면 changeProjectTeamCode 한 길)를 따로 받는다. 코드를 비우면 이름에서 만든 기본값(defaultTeamCode) */
export async function addProjectTeam(projectId: string, name: string, code?: string | null): Promise<ProjectTeamActionResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  // 예약어는 그 프로젝트의 단계 이름·추가 축 이름까지(D38) — 설정을 못 읽으면 만들지 않는다(쓰기 전 선행 조회 실패는 중단, 3원칙 ②)
  let reserved: string[]
  try {
    const cfg = await getProjectConfig(projectId)
    reserved = reservedTeamNames({ levelLabels: valueOf(cfg, 'core.level_labels'), extraAxisLabel: valueOf(cfg, 'core.extra_axis_label') })
  } catch (e) {
    console.error('[projectTeams] 예약어 판정용 설정 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: t('srv.projectTeams.couldNotVerifyProjectSettings') }
  }
  const norm = checkNewTeam({ name, code, reserved })
  if (!norm.ok) return norm
  // requireProjectAdmin 이 통과했으면 roleIn 이 이미 projectWorkspace 에서 이 프로젝트를 찾은 뒤다
  // (domain/authz.ts roleIn ④) — 여기서 다시 없을 수 없다. projects 테이블을 별도 조회하지 않는다
  // (이 액션은 teams 테이블만 만진다는 계약, project-teams-actions.test.ts 의 fromCalls 가드).
  const workspaceId = g.actor.projectWorkspace.get(projectId)
  if (!workspaceId) return { ok: false, error: t('srv.projectTeams.couldNotVerifyProjectS') }
  const admin = createAdminClient()

  // 중복은 동일 프로젝트 내에서만 거부 — 전역·타 프로젝트 동명은 허용(복합 유니크와 일치). 같은 프로젝트 팀의 code·이름(개명 포함)과
  // 대소문자·전각만 다른 code 도 거부한다(개명 규칙 D37 의 대칭 — A2-1 리뷰 정확성 P3)
  const sib = await admin.from('teams').select('id, code, name').eq('project_id', projectId)
  if (sib.error) return { ok: false, error: failWith('projectTeams.add', sib.error, t(ERR_TEAM_LOOKUP)) }
  const siblings = (sib.data ?? []) as { id: string; code: string; name: string }[]
  if (siblings.some((s) => s.code === norm.code)) return { ok: false, error: fill(t('srv.projectTeams.teamAlreadyExistsProject'), { code: norm.code }) }
  const clash = newTeamCodeClash(norm.code, siblings)
  if (clash) return { ok: false, error: teamCodeClashError(norm.code, clash) }
  // 이름도 같은 프로젝트 다른 팀의 code·이름과 겹치면 거부한다 — 개명(checkTeamRename)과 같은 규칙
  const nameClash = newTeamNameClash(norm.name, norm.code, siblings)
  if (nameClash) return { ok: false, error: teamCodeClashError(norm.name, nameClash) }
  // 이 프로젝트가 이미 쓰는 공용 팀과 같은 code 의 전용 팀은 만들지 않는다(A2-1 리뷰 보안 P3 — 가져오기 Z4 와 같은 판정). 만들면 기존 공용
  // 참조(담당·명단·영역·초대)와 같은 code·다른 id 가 된다(D4 분열). 판정 조회 실패는 쓰기 전 선행 조회 실패라 중단한다(3원칙 ②)
  // 대소문자·전각·개명 이름만 다른 참조 중인 공용 팀도 겹침으로 거부한다(A2-2 리뷰 보안 P3 — 전용 qa 가 공용 QA 참조와 갈라진다)
  let referenced: Map<string, string>
  try {
    referenced = await referencedCommonTeamCodes({ projectId, workspaceId }, [norm.code])
  } catch (e) {
    return { ok: false, error: failWith('projectTeams.add 공용 팀 참조 조회', e, t(ERR_TEAM_LOOKUP)) }
  }
  const common = referenced.get(norm.code)
  if (common === norm.code) return { ok: false, error: ERR_COMMON_IN_USE(t, norm.code) }
  if (common) return { ok: false, error: teamCodeClashError(norm.code, common) }

  const max = await admin.from('teams')
    .select('sort_order').eq('project_id', projectId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) return { ok: false, error: failWith('projectTeams.add', max.error, t(ERR_TEAM_LOOKUP)) }
  const sortOrder = Number((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  const ins = await admin.from('teams')
    .insert({ code: norm.code, name: norm.name, sort_order: sortOrder, project_id: projectId, workspace_id: workspaceId, color: pickTeamColor(sortOrder) })
  if (ins.error) return { ok: false, error: failWith('projectTeams.add', ins.error, t(ERR_TEAM_CREATE)) }

  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true }
}

export async function updateProjectTeam(
  projectId: string, teamId: string,
  patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number; name?: string; colorSlot?: number; swapOrderWith?: string },
): Promise<ProjectTeamActionResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  // 순서 맞바꾸기(위·아래 단추) — 두 행을 한 액션에서 바꾸고 둘째가 실패하면 첫 행을 되돌린다(lib/teams/swapOrder)
  if (patch.swapOrderWith !== undefined) {
    if (typeof patch.swapOrderWith !== 'string' || !patch.swapOrderWith) return { ok: false, error: t(ERR_TEAM_NOT_OWN) }
    const sw = await swapTeamOrder(admin, { projectId }, teamId, patch.swapOrderWith)
    if (!sw.ok) {
      if (sw.kind === 'missing') return { ok: false, error: t(ERR_TEAM_NOT_OWN) }
      if (sw.kind === 'stale') return { ok: false, error: libText(t, ERR_TEAM_ORDER_STALE) }
      return { ok: false, error: failWith('projectTeams.swapOrder', sw.cause, t(ERR_TEAM_UPDATE)) }
    }
    revalidatePath('/(app)/p/[projectId]', 'layout')
    return { ok: true }
  }
  const row: Record<string, unknown> = {}
  let renamed = false
  if (typeof patch.active === 'boolean') row.active = patch.active
  if (typeof patch.progressVisible === 'boolean') row.progress_visible = patch.progressVisible
  if (typeof patch.sortOrder === 'number' && Number.isInteger(patch.sortOrder)) row.sort_order = patch.sortOrder
  if (patch.colorSlot !== undefined) {
    // 색은 테마 슬롯으로만 고른다(임의 hex 금지 — 다크 대비). 저장은 그 슬롯의 팔레트 hex(teamSlotIndex 가 되찾는다)
    const color = teamColorOfSlot(patch.colorSlot)
    if (!color) return { ok: false, error: t(ERR_TEAM_COLOR) }
    row.color = color
  }
  if (patch.name !== undefined) {
    // 개명(D37) — code 는 그대로. 예약어는 그 프로젝트의 단계 이름까지, 겹침은 그 프로젝트 전용 팀끼리. 선행 조회 실패는 중단(3원칙 ②)
    let reserved: string[]
    try {
      const cfg = await getProjectConfig(projectId)
      reserved = reservedTeamNames({ levelLabels: valueOf(cfg, 'core.level_labels'), extraAxisLabel: valueOf(cfg, 'core.extra_axis_label') })
    } catch (e) {
      return { ok: false, error: failWith('projectTeams.rename', e, t(ERR_TEAM_LOOKUP)) }
    }
    const sib = await admin.from('teams').select('id, code, name').eq('project_id', projectId)
    if (sib.error) return { ok: false, error: failWith('projectTeams.rename', sib.error, t(ERR_TEAM_LOOKUP)) }
    const siblings = (sib.data ?? []) as { id: string; code: string; name: string }[]
    const self = siblings.find((s) => s.id === teamId)
    if (!self) return { ok: false, error: t('srv.projectTeams.teamDoesNotBelongProject') }
    const checked = checkTeamRename({ name: patch.name, selfId: teamId, selfCode: self.code, siblings, reserved })
    if (!checked.ok) return checked
    row.name = checked.name
    renamed = checked.name !== self.name
  }
  if (Object.keys(row).length === 0) return { ok: false, error: t('err.nothingChange') }
  // .eq('project_id') 를 함께 건다 — 관리자 가드가 통과한 프로젝트의 행만 만진다(전역 행 오수정 차단).
  // .select('id') 로 영향 행을 확인한다 — 0행이면 조용한 no-op 을 성공으로 위장하지 않는다
  // (teams.ts updateTeam 과 대칭되는 방어, revokeProjectInvite 원조 관례).
  const upd = await admin.from('teams').update(row).eq('id', teamId).eq('project_id', projectId).select('id')
  if (upd.error) {
    // 개명이 회의록 팀 루트 이름 동기에서 막혔다(SP5 B2 — D52)
    const rootErr = teamRootNameError(upd.error)
    if (rootErr) return { ok: false, error: rootErr }
    return { ok: false, error: failWith('projectTeams.update', upd.error, t(ERR_TEAM_UPDATE)) }
  }
  if (!upd.data || upd.data.length === 0) return { ok: false, error: t('srv.projectTeams.teamDoesNotBelongProject') }
  // 색인 본문은 팀을 이름으로 적는다 — 이름이 바뀌었으면 그 팀의 작업·회의록을 다시 색인한다(실패는 개명을 막지 않는다)
  if (renamed) await enqueueTeamRenameIndexChange(teamId)
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true }
}

const ERR_ALREADY = 'srv.projectTeams.projectTeamsAlreadyDefined'
const ERR_NO_COMMON = 'srv.projectTeams.noSharedTeamsCopy'   // 스펙 §3.3 ⑦ "지금 문구" 그대로(액션 계약)
/** 전환 RPC 의 자기 토큰(SP4 D45 — 호출부 자기 매핑). 55P03(잠금 대기 상한)·40P01 은 rpcFailure 가 재시도 문구로 */
const CONVERT_TOKENS: OwnTokenTable = {
  TEAM_CONVERT_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: ERR_DENIED },
  PROJECT_NOT_FOUND: { status: 404, code: 'ERR_MISSING', message: ERR_MISSING },
}

/** '공용 팀 전환으로 시작' — 이 프로젝트가 상속하던 공용 팀을 같은 code·이름·색·순서·활성의 전용 팀으로 바꾸고, 그 프로젝트 안의 팀 연결
 *  (작업 담당·명단 팀·업무영역 팀·수락 전 초대)을 새 팀으로 옮긴다(전환 RPC — SP4 D54·T14). 되돌리지 않는다. 옛 '복사만'은 같은 code·다른 id
 *  두 벌을 만들어 담당 팀 멤버의 실적 저장이 서버에서 거부됐다(D4). 결과 계약 { ok, error } 그대로(§3.3 ⑦) */
export async function copyGlobalTeams(projectId: string): Promise<ProjectTeamActionResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const { data, error } = await createAdminClient().rpc('convert_inherited_teams', { p_actor: g.actor.userId, p_project_id: projectId })
  if (error) {
    const f = rpcFailure(error, CONVERT_TOKENS, t)
    if (!f) return { ok: false, error: failWith('projectTeams.convert', error, t(ERR_TEAM_COPY)) }
    console.error('[projectTeams.convert] 전환 거부:', f.token)
    return { ok: false, error: f.message }
  }
  const r = (data ?? null) as { status?: unknown; teams?: unknown } | null
  if (r?.status === 'already') return { ok: false, error: t(ERR_ALREADY) }
  if (r?.status !== 'converted' || typeof r.teams !== 'number') {
    return { ok: false, error: failWith('projectTeams.convert', new Error(`전환 결과의 모양이 기대와 다릅니다: ${JSON.stringify(data)}`), t(ERR_TEAM_COPY)) }
  }
  if (r.teams === 0) return { ok: false, error: t(ERR_NO_COMMON) }
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true }
}

/** 전용 팀의 코드 바꾸기(팀 유연화 2단계) — change_team_code RPC 한 길. RPC 가 프로젝트 관리자를 다시 판정하고 유일성·M1 불변식(이 프로젝트가
 *  쓰는 공용 팀과 같은 code 가 되지 않는다)을 DB 가 최종 판정한다. 그 팀 회의록의 사본 열(minutes.team_code)이 같은 트랜잭션에서 따라간다.
 *  예약어는 그 프로젝트의 단계 이름·추가 축 이름까지(새 팀과 같은 규칙 — D38). */
export async function changeProjectTeamCode(projectId: string, teamId: string, code: string): Promise<ProjectTeamActionResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (typeof teamId !== 'string' || !teamId) return { ok: false, error: t(ERR_TEAM_NOT_OWN) }
  let reserved: string[]
  try {
    const cfg = await getProjectConfig(projectId)
    reserved = reservedTeamNames({ levelLabels: valueOf(cfg, 'core.level_labels'), extraAxisLabel: valueOf(cfg, 'core.extra_axis_label') })
  } catch (e) {
    return { ok: false, error: failWith('projectTeams.changeCode', e, t(ERR_TEAM_LOOKUP)) }
  }
  const workspaceId = g.actor.projectWorkspace.get(projectId)
  if (!workspaceId) return { ok: false, error: t('srv.projectTeams.couldNotVerifyProjectS') }
  const admin = createAdminClient()
  const sib = await admin.from('teams').select('id, code, name').eq('project_id', projectId)
  if (sib.error) return { ok: false, error: failWith('projectTeams.changeCode', sib.error, t(ERR_TEAM_LOOKUP)) }
  const siblings = (sib.data ?? []) as { id: string; code: string; name: string }[]
  const self = siblings.find((s) => s.id === teamId)
  if (!self) return { ok: false, error: t(ERR_TEAM_NOT_OWN) }
  const checked = checkTeamCodeChange({ code, selfId: teamId, siblings, reserved })
  if (!checked.ok) return checked
  if (checked.unchanged) return { ok: false, error: t('err.sameCurrentCode') }
  // 이 프로젝트가 이미 쓰는 공용 팀과 같은 낱말의 code 로는 바꾸지 않는다(팀 추가와 같은 판정 — 대소문자·전각·개명 이름까지). 정확히 같은 code 는
  // DB 도 막지만(TEAM_CODE_SCOPE_CONFLICT) 낱말 겹침은 앱만 본다. 선행 조회 실패는 중단한다(3원칙 ②)
  let referenced: Map<string, string>
  try {
    referenced = await referencedCommonTeamCodes({ projectId, workspaceId }, [checked.code])
  } catch (e) {
    return { ok: false, error: failWith('projectTeams.changeCode 공용 팀 참조 조회', e, t(ERR_TEAM_LOOKUP)) }
  }
  const common = referenced.get(checked.code)
  if (common === checked.code) return { ok: false, error: libText(t, ERR_TEAM_CODE_SCOPE_CONFLICT) }
  if (common) return { ok: false, error: teamCodeClashError(checked.code, common) }
  const res = await admin.rpc('change_team_code', { p_actor: g.actor.userId, p_team_id: teamId, p_code: checked.code })
  if (res.error) {
    const f = rpcFailure(res.error, TEAM_CODE_TOKENS, t)
    if (!f) return { ok: false, error: failWith('projectTeams.changeCode', res.error, libText(t, ERR_TEAM_CODE_CHANGE)) }
    console.error('[projectTeams.changeCode] 코드 변경 거부:', f.token)
    return { ok: false, error: f.message }
  }
  // 이 프로젝트가 저장해 둔 엑셀 양식의 팀 열(옛 code)을 새 code 로 — 설정 쓰기는 따로 가는 길이라 원자적이지 않다(실패는 알림)
  const swap = await swapExcelProfileTeamCode(admin, { workspaceId, projectId }, { from: self.code, to: checked.code }, g.actor.userId)
  // 색인 본문은 팀을 '이름 (code)' 로 적는다 — 그 팀의 작업·회의록을 다시 색인한다(실패는 코드 변경을 막지 않는다)
  await enqueueTeamRenameIndexChange(teamId)
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return swap.failed > 0 ? { ok: true, notice: libText(t, NOTICE_TEAM_CODE_PROFILE) } : { ok: true }
}

export type ProjectTeamMergePreviewResult = { ok: true; counts: TeamRefCounts } | { ok: false; error: string }
export type ProjectTeamMergeResult = { ok: true; summary: TeamMergeSummary } | { ok: false; error: string }

/** 병합 미리보기 — 원본 팀을 가리키는 것의 건수(읽기 전용). 두 팀 모두 이 프로젝트의 전용 팀이어야 한다 */
export async function previewProjectTeamMerge(projectId: string, sourceId: string, targetId: string): Promise<ProjectTeamMergePreviewResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (typeof sourceId !== 'string' || !sourceId || typeof targetId !== 'string' || !targetId) return { ok: false, error: t(ERR_TEAM_NOT_OWN) }
  if (sourceId === targetId) return { ok: false, error: libText(t, ERR_TEAM_MERGE_SAME) }
  const admin = createAdminClient()
  const pair = await admin.from('teams').select('id, active').eq('project_id', projectId).in('id', [sourceId, targetId])
  if (pair.error) return { ok: false, error: failWith('projectTeams.mergePreview', pair.error, t(ERR_TEAM_LOOKUP)) }
  const rows = (pair.data ?? []) as { id: string; active: boolean }[]
  if (rows.length !== 2) return { ok: false, error: t(ERR_TEAM_NOT_OWN) }
  if (!rows.find((r) => r.id === targetId)?.active) return { ok: false, error: libText(t, ERR_TEAM_MERGE_TARGET_INACTIVE) }
  const res = await admin.rpc('team_reference_counts', { p_team_id: sourceId })
  if (res.error) return { ok: false, error: failWith('projectTeams.mergePreview', res.error, libText(t, ERR_TEAM_MERGE_PREVIEW)) }
  const counts = parseTeamRefCounts(res.data)
  // 모양이 다른 결과를 0건으로 위장하지 않는다(표시 = 로깅)
  if (!counts) return { ok: false, error: failWith('projectTeams.mergePreview', new Error(`건수 결과의 모양이 기대와 다릅니다: ${JSON.stringify(res.data)}`), libText(t, ERR_TEAM_MERGE_PREVIEW)) }
  return { ok: true, counts }
}

/** 다른 팀으로 합치기(전용 팀) — merge_teams RPC 한 트랜잭션: 원본 팀의 담당·명단·영역·회의록·회의록 폴더·수락 전 초대·연동 자격증명을 대상 팀으로
 *  옮기고 원본을 비활성으로 남긴다. 둘 다 가리키던 행은 대상 쪽 한 행만 남는다(주관·대표가 이긴다). 되돌릴 수 없다. RPC 가 프로젝트 관리자를 다시 판정한다. */
export async function mergeProjectTeams(projectId: string, sourceId: string, targetId: string): Promise<ProjectTeamMergeResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (typeof sourceId !== 'string' || !sourceId || typeof targetId !== 'string' || !targetId) return { ok: false, error: t(ERR_TEAM_NOT_OWN) }
  if (sourceId === targetId) return { ok: false, error: libText(t, ERR_TEAM_MERGE_SAME) }
  const admin = createAdminClient()
  // 쓰기 전 선행 조회 — 가드가 통과한 그 프로젝트의 전용 팀 둘이어야 한다(다른 범위의 팀 id 를 RPC 에 넘기지 않는다)
  const pair = await admin.from('teams').select('id, active').eq('project_id', projectId).in('id', [sourceId, targetId])
  if (pair.error) return { ok: false, error: failWith('projectTeams.merge', pair.error, t(ERR_TEAM_LOOKUP)) }
  const rows = (pair.data ?? []) as { id: string; active: boolean }[]
  if (rows.length !== 2) return { ok: false, error: t(ERR_TEAM_NOT_OWN) }
  if (!rows.find((r) => r.id === targetId)?.active) return { ok: false, error: libText(t, ERR_TEAM_MERGE_TARGET_INACTIVE) }
  const res = await admin.rpc('merge_teams', { p_actor: g.actor.userId, p_source_team_id: sourceId, p_target_team_id: targetId })
  if (res.error) {
    const f = rpcFailure(res.error, TEAM_MERGE_TOKENS, t)
    if (!f) return { ok: false, error: failWith('projectTeams.merge', res.error, libText(t, ERR_TEAM_MERGE)) }
    console.error('[projectTeams.merge] 병합 거부:', f.token)
    return { ok: false, error: f.message }
  }
  const summary = parseTeamMergeResult(res.data)
  if (!summary) return { ok: false, error: failWith('projectTeams.merge', new Error(`병합 결과의 모양이 기대와 다릅니다: ${JSON.stringify(res.data)}`), libText(t, ERR_TEAM_MERGE)) }
  // 옮겨 온 작업·회의록의 색인 본문(담당 팀 이름)을 다시 만든다 — 대상 팀이 이제 그 문서를 전부 가리킨다
  await enqueueTeamRenameIndexChange(targetId)
  revalidatePath('/(app)/p/[projectId]', 'layout')
  return { ok: true, summary }
}
