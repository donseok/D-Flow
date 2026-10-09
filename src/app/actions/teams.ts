'use server'

// 공용 팀 기준정보 관리 — 추가/활성 토글/정렬/진척표시. 공용 팀은 그 워크스페이스의 전 프로젝트가 공유하는
// 기준정보라 프로젝트 관리자가 아니라 그 워크스페이스의 관리자가 손댄다(SP2 §4.1 — SP1 까지는 슈퍼유저 전용).
// 삭제는 없다: 비활성화(active=false)가 삭제다(데이터 보존, 사용자 결정 2026-07-24).

import { revalidatePath } from 'next/cache'
import { getActor, requireWorkspaceAdmin } from '@/lib/authz'
import { ERR_ANON, ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { createAdminClient } from '@/lib/supabase/admin'
import { adminFor } from '@/lib/supabase/adminFor'
import { EXCEL_HEADER_WORDS } from '@/lib/excel/headerWords'
import { pickTeamColor, teamColorOfSlot } from '@/lib/domain/teamColor'
import { checkNewTeam, checkTeamCodeChange, checkTeamRename, newTeamCodeClash, newTeamNameClash, teamCodeClashError } from '@/lib/domain/teamName'
import { ERR_TEAM_ORDER_STALE, swapTeamOrder } from '@/lib/teams/swapOrder'
import { failWith, rpcFailure } from '@/lib/errors/dbFail'
import {
  ERR_TEAM_CODE_CHANGE, ERR_TEAM_MERGE, ERR_TEAM_MERGE_PREVIEW, ERR_TEAM_MERGE_SAME, ERR_TEAM_MERGE_TARGET_INACTIVE, NOTICE_TEAM_CODE_PROFILE,
  TEAM_CODE_TOKENS, TEAM_MERGE_TOKENS, parseTeamMergeResult, parseTeamRefCounts, type TeamMergeSummary, type TeamRefCounts,
} from '@/lib/teams/teamOps'
import { swapExcelProfileTeamCode } from '@/lib/teams/excelProfileCode'
import { teamRootNameError } from '@/lib/minutes/teamRootErrors'
import { enqueueTeamRenameIndexChange } from '@/lib/ai/index/enqueueChange'
import { serverTranslator } from '@/lib/i18n/server'
import { fill } from '@/lib/i18n/translate'
import { libText } from '@/lib/i18n/serverText'

/** notice — 성공했지만 사용자에게 알릴 것(코드 변경 뒤 엑셀 양식을 맞추지 못한 프로젝트가 있다 등) */
export type TeamActionResult = { ok: true; notice?: string } | { ok: false; error: string }

// DB 원문은 로그로만(SP4 D21) — 응답에는 고정 문구. 'use server' 라 export 하지 않는다.
const ERR_TEAM_LOOKUP = 'err.couldNotVerifyTeam'
const ERR_TEAM_CREATE = 'err.couldNotCreateTeam'
const ERR_TEAM_UPDATE = 'err.couldNotUpdateTeam'
const ERR_TEAM_COLOR = 'err.colorCannotSelected'
const ERR_TEAM_NOT_COMMON = 'srv.teams.notSharedTeamDoesNot'

// 'use server' 모듈이라 export 하지 않는다(비동기 함수만 내보낼 수 있다). PostgREST 원문은 로그에만 남긴다.
const ERR_TEAMS_LIST = 'err.couldNotLoadTeamList'

/** 팀 추가 — create_team RPC 한 트랜잭션(SP5 B2 — D50): 공용 팀 + (teams 모드면) 회의록 팀 루트. 실패하면 둘 다 없다.
 *  공용 팀의 세션 INSERT 정책은 0024 가 지웠다 — 공용 팀은 이 길로만 생긴다(team-create-path 불변식).
 *  이름(바꿀 수 있다)과 코드(식별자 — 엑셀·가져오기·필터. 바꾸려면 changeTeamCode 한 길)를 따로 받는다. 코드를 비우면 이름에서 만든 기본값
 *  (defaultTeamCode — 화면이 미리 보여 준 그 값)이다. 예전에는 한 입력이 둘 다였다 — 이름의 오타가 영구 코드가 됐다. */
export async function addTeam(workspaceId: string, name: string, code?: string | null): Promise<TeamActionResult> {
  const t = await serverTranslator()
  // 대상 워크스페이스가 비면 가드 전에 거부한다 — 가드는 null 을 슈퍼유저에게 통과시킨다.
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, error: libText(t, ERR_WORKSPACE_REQUIRED) }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  // 공용 팀은 여러 프로젝트에 걸려 단계 이름이 하나로 정해지지 않는다 — 엑셀 머리 낱말만 예약어로 본다(SP4 D38·K14)
  const norm = checkNewTeam({ name, code, reserved: EXCEL_HEADER_WORDS })
  if (!norm.ok) return norm
  const admin = createAdminClient()

  // 0071: 전역·프로젝트 행이 같은 code 를 가질 수 있다. 이 화면은 전역 행만 다루므로
  // project_id is null 로 고정 — 안 고정하면 어느 프로젝트가 같은 code 를 쓰는 순간
  // "이미 존재합니다"로 전역 생성이 오차단된다(임의 행을 잡는 사례).
  // workspace_id 도 함께 건다(0003) — 다른 워크스페이스의 동명 전역 팀을 오탐하지 않는다.
  // 같은 워크스페이스 공용 팀의 code·이름(개명 포함)과 대소문자·전각만 다른 code 도 거부한다(개명 규칙 D37 의 대칭 — A2-1 리뷰 정확성 P3)
  const sib = await admin.from('teams').select('id, code, name').is('project_id', null).eq('workspace_id', workspaceId)
  if (sib.error) return { ok: false, error: failWith('teams.add', sib.error, t(ERR_TEAM_LOOKUP)) }
  const siblings = (sib.data ?? []) as { id: string; code: string; name: string }[]
  if (siblings.some((s) => s.code === norm.code)) return { ok: false, error: fill(t('srv.teams.teamAlreadyExists'), { code: norm.code }) }
  const clash = newTeamCodeClash(norm.code, siblings)
  if (clash) return { ok: false, error: teamCodeClashError(norm.code, clash) }
  // 이름도 같은 범위 다른 팀의 code·이름과 겹치면 거부한다 — 개명(checkTeamRename)과 같은 규칙
  const nameClash = newTeamNameClash(norm.name, norm.code, siblings)
  if (nameClash) return { ok: false, error: teamCodeClashError(norm.name, nameClash) }

  // 정렬 순번도 워크스페이스별로 잰다 — 안 그러면 다른 워크스페이스의 순번을 이어받는다.
  const max = await admin.from('teams')
    .select('sort_order').is('project_id', null).eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) return { ok: false, error: failWith('teams.add', max.error, t(ERR_TEAM_LOOKUP)) }
  const sortOrder = Number((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  // 팀 + 루트를 한 트랜잭션으로(루트 이름 = 팀 이름). RPC 가 워크스페이스 관리자를 다시 판정하고,
  // 설정 행을 FOR SHARE 로 잡아 최상위 폴더 모드를 읽는다(custom 모드면 루트를 만들지 않는다)
  const ins = await admin.rpc('create_team', {
    p_actor: g.actor.userId, p_workspace_id: workspaceId, p_code: norm.code, p_name: norm.name,
    p_color: pickTeamColor(sortOrder), p_sort_order: sortOrder,
  })
  if (ins.error) {
    const rootErr = teamRootNameError(ins.error)
    if (rootErr) return { ok: false, error: rootErr }
    if (ins.error.code === '23505') return { ok: false, error: fill(t('srv.teams.teamAlreadyExists'), { code: norm.code }) }   // 판정과 생성 사이의 경합
    return { ok: false, error: failWith('teams.add', ins.error, t(ERR_TEAM_CREATE)) }
  }

  revalidatePath('/(app)/w/[slug]/admin/teams', 'page')
  return { ok: true }
}

/** 활성/진척현황 표시/정렬/이름/색 변경. colorSlot 은 테마 슬롯 번호(1~8 — 임의 hex 는 받지 않는다), swapOrderWith 는 순서를 맞바꿀
 *  같은 워크스페이스 공용 팀의 id(위·아래 단추 — 두 행을 한 액션에서 바꾸고 실패하면 되돌린다, lib/teams/swapOrder). */
export async function updateTeam(
  id: string,
  patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number; name?: string; colorSlot?: number; swapOrderWith?: string },
): Promise<TeamActionResult> {
  const t = await serverTranslator()
  // 인증을 행 조회보다 먼저 — 비로그인 호출자가 ERR_MISSING(없는 id)과 ERR_ANON(있는 id)으로 팀 id 존재를 가려내지 못하게.
  let actor
  try {
    actor = await getActor()
  } catch {
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!actor) return { ok: false, error: ERR_ANON }
  // 판정 대상 워크스페이스는 행에서 읽는다(id 만 받는 액션). 쓰기 전 선행 조회라 실패는 중단(3원칙 ②),
  // 없거나 프로젝트 팀(0071 — 프로젝트 관리 화면 몫)이면 이 화면의 대상이 아니다(존재 은닉).
  const admin = createAdminClient()
  const found = await admin.from('teams').select('workspace_id, project_id').eq('id', id).maybeSingle()
  if (found.error) {
    console.error('[teams] 수정 대상 조회 실패:', found.error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  const target = found.data as { workspace_id: string | null; project_id: string | null } | null
  if (!target || target.project_id !== null || !target.workspace_id) return { ok: false, error: ERR_MISSING }
  const g = await requireWorkspaceAdmin(target.workspace_id)
  if (!g.ok) return { ok: false, error: g.error }
  if (patch.swapOrderWith !== undefined) {
    if (typeof patch.swapOrderWith !== 'string' || !patch.swapOrderWith) return { ok: false, error: t(ERR_TEAM_NOT_COMMON) }
    const sw = await swapTeamOrder(admin, { workspaceId: target.workspace_id, projectId: null }, id, patch.swapOrderWith)
    if (!sw.ok) {
      if (sw.kind === 'missing') return { ok: false, error: t(ERR_TEAM_NOT_COMMON) }
      if (sw.kind === 'stale') return { ok: false, error: libText(t, ERR_TEAM_ORDER_STALE) }
      return { ok: false, error: failWith('teams.swapOrder', sw.cause, t(ERR_TEAM_UPDATE)) }
    }
    revalidatePath('/(app)/w/[slug]/admin/teams', 'page')
    return { ok: true }
  }
  const row: Record<string, unknown> = {}
  let renamed = false
  if (typeof patch.active === 'boolean') row.active = patch.active
  if (typeof patch.progressVisible === 'boolean') row.progress_visible = patch.progressVisible
  if (typeof patch.sortOrder === 'number' && Number.isInteger(patch.sortOrder)) row.sort_order = patch.sortOrder
  if (patch.colorSlot !== undefined) {
    // 색은 테마 슬롯으로만 고른다 — 슬롯의 팔레트 hex 를 기존 color 열에 저장하고 화면이 그 자리로 슬롯을 되찾는다(teamSlotIndex)
    const color = teamColorOfSlot(patch.colorSlot)
    if (!color) return { ok: false, error: t(ERR_TEAM_COLOR) }
    row.color = color
  }
  if (patch.name !== undefined) {
    // 개명(D37) — 공용 팀은 머리 낱말만 예약어(여러 프로젝트에 걸려 단계 이름이 하나로 정해지지 않는다 — K14), 겹침은 그 워크스페이스 공용 팀끼리
    const sib = await admin.from('teams').select('id, code, name').is('project_id', null).eq('workspace_id', target.workspace_id)
    if (sib.error) return { ok: false, error: failWith('teams.rename', sib.error, t(ERR_TEAM_LOOKUP)) }
    const siblings = (sib.data ?? []) as { id: string; code: string; name: string }[]
    const self = siblings.find((s) => s.id === id)
    if (!self) return { ok: false, error: t('srv.teams.notSharedTeamDoesNot') }
    const checked = checkTeamRename({ name: patch.name, selfId: id, selfCode: self.code, siblings, reserved: EXCEL_HEADER_WORDS })
    if (!checked.ok) return checked
    row.name = checked.name
    renamed = checked.name !== self.name
  }
  if (Object.keys(row).length === 0) return { ok: false, error: t('err.nothingChange') }
  // .is('project_id', null)·.eq('workspace_id') 를 함께 건다 — 가드가 판정한 그 워크스페이스의 공용 행만 만진다
  // (조회와 쓰기 사이에 행이 바뀌어도 판정 밖의 행을 건드리지 않는다; projectTeams.ts 의 updateProjectTeam 과 대칭).
  // .select('id') 로 영향 행을 확인한다 — 필터에 걸린 0행 update 가 조용히 ok:true 로 위장하지 않게
  // (조용한 no-op 금지 관례, revokeProjectInvite 와 동일).
  const upd = await admin.from('teams').update(row).eq('id', id).is('project_id', null)
    .eq('workspace_id', target.workspace_id).select('id')
  if (upd.error) {
    // 개명이 회의록 팀 루트 이름 동기에서 막혔다(SP5 B2 — D52)
    const rootErr = teamRootNameError(upd.error)
    if (rootErr) return { ok: false, error: rootErr }
    return { ok: false, error: failWith('teams.update', upd.error, t(ERR_TEAM_UPDATE)) }
  }
  if (!upd.data || upd.data.length === 0) return { ok: false, error: t('srv.teams.notSharedTeamDoesNot') }
  // 색인 본문은 팀을 이름으로 적는다 — 이름이 바뀌었으면 그 팀의 작업·회의록을 다시 색인한다(실패는 개명을 막지 않는다)
  if (renamed) await enqueueTeamRenameIndexChange(id)
  revalidatePath('/(app)/w/[slug]/admin/teams', 'page')
  return { ok: true }
}

/** 관리 화면 목록(비활성 포함) — 페이지 서버 컴포넌트 전용. 그 워크스페이스의 공용 팀만.
 *  거부·조회 실패는 빈 목록이 아니라 오류다 — 빈 목록이면 화면이 'TEAMS 0' 을 사실처럼 그린다(표시 = 로깅). */
export async function listTeamsAdmin(workspaceId: string): Promise<
  | { ok: true; rows: Array<{ id: string; code: string; name: string; color: string; sortOrder: number; active: boolean; progressVisible: boolean }> }
  | { ok: false; error: string }
> {
  const t = await serverTranslator()
  // 대상 워크스페이스가 비면 가드 전에 거부한다(가드는 null 을 슈퍼유저에게 통과시킨다). g 는 가드 결과만 담는다 — 원문 가드(no-raw-db-errors)가
  // 이 파일의 g.error 를 가드 출처로 판정한다(SP4 A2 에서 가드 대상이 되며 삼항의 리터럴 대안을 분기로 뺐다 — 동작 그대로)
  if (typeof workspaceId !== 'string' || !workspaceId) {
    console.error('[teams] 관리 목록 거부:', libText(t, ERR_WORKSPACE_REQUIRED))
    return { ok: false, error: libText(t, ERR_WORKSPACE_REQUIRED) }
  }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) {
    console.error('[teams] 관리 목록 거부:', g.error)
    return { ok: false, error: g.error }
  }
  // 스코프를 정한 service_role 클라이언트 — 아래 필터가 쓰는 workspaceId 가 가드가 판정한 그 값이다.
  const { admin } = adminFor({ workspaceId })
  // 공용 팀 관리 화면 — project_id is null 로 고정해 프로젝트 팀(0071)이 섞여 들어오지 않게 하고,
  // workspace_id 로 좁혀 다른 워크스페이스의 공용 팀이 보이지 않게 한다(SP2 §4.2 — 종전엔 전 워크스페이스가 섞였다).
  const { data, error } = await admin.from('teams')
    .select('id, code, name, color, sort_order, active, progress_visible')
    .is('project_id', null)
    .eq('workspace_id', workspaceId)
    .order('sort_order').order('code')
  if (error) {
    console.error('[teams] 관리 목록 조회 실패:', error.message)
    return { ok: false, error: t(ERR_TEAMS_LIST) }
  }
  return {
    ok: true,
    rows: (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      color: String(r.color),
      sortOrder: Number(r.sort_order ?? 0),
      active: r.active !== false,
      progressVisible: r.progress_visible !== false,
    })),
  }
}

/** 코드 바꾸기(팀 유연화 2단계) — change_team_code RPC 한 길. code 는 그 RPC 안에서만 바뀐다(teams_guard). RPC 가 워크스페이스 관리자를
 *  다시 판정하고, 유일성·"프로젝트가 쓰는 공용 팀과 그 프로젝트 전용 팀의 code 가 같아지는 일"을 DB 가 최종 판정한다. 같은 트랜잭션에서
 *  그 팀 회의록의 사본 열(minutes.team_code)이 따라간다. 여기서는 형식·예약어·같은 범위 겹침을 사람이 읽을 문구로 먼저 거른다.
 *  엑셀로 내보낸 옛 파일의 팀 열·세부업무 이름·변경 이력의 옛 code 는 그대로 남는다(화면이 바꾸기 전에 알린다). */
export async function changeTeamCode(workspaceId: string, teamId: string, code: string): Promise<TeamActionResult> {
  const t = await serverTranslator()
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, error: libText(t, ERR_WORKSPACE_REQUIRED) }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  if (typeof teamId !== 'string' || !teamId) return { ok: false, error: t(ERR_TEAM_NOT_COMMON) }
  const admin = createAdminClient()
  // 쓰기 전 선행 조회 — 실패는 중단(3원칙 ②). 가드가 판정한 그 워크스페이스의 공용 팀만 본다
  const sib = await admin.from('teams').select('id, code, name').is('project_id', null).eq('workspace_id', workspaceId)
  if (sib.error) return { ok: false, error: failWith('teams.changeCode', sib.error, t(ERR_TEAM_LOOKUP)) }
  const siblings = (sib.data ?? []) as { id: string; code: string; name: string }[]
  const self = siblings.find((s) => s.id === teamId)
  if (!self) return { ok: false, error: t(ERR_TEAM_NOT_COMMON) }
  const checked = checkTeamCodeChange({ code, selfId: teamId, siblings, reserved: EXCEL_HEADER_WORDS })
  if (!checked.ok) return checked
  if (checked.unchanged) return { ok: false, error: t('err.sameCurrentCode') }
  const res = await admin.rpc('change_team_code', { p_actor: g.actor.userId, p_team_id: teamId, p_code: checked.code })
  if (res.error) {
    const f = rpcFailure(res.error, TEAM_CODE_TOKENS, t)
    if (!f) return { ok: false, error: failWith('teams.changeCode', res.error, libText(t, ERR_TEAM_CODE_CHANGE)) }
    console.error('[teams.changeCode] 코드 변경 거부:', f.token)
    return { ok: false, error: f.message }
  }
  // 저장해 둔 엑셀 양식의 팀 열(옛 code)을 새 code 로 — 이 공용 팀을 상속하는 프로젝트들. 설정 쓰기는 따로 가는 길이라 원자적이지 않다(실패는 알림)
  const swap = await swapExcelProfileTeamCode(admin, { workspaceId, projectId: null }, { from: self.code, to: checked.code }, g.actor.userId)
  // 색인 본문은 팀을 '이름 (code)' 로 적는다 — 그 팀의 작업·회의록을 다시 색인한다(실패는 코드 변경을 막지 않는다)
  await enqueueTeamRenameIndexChange(teamId)
  revalidatePath('/(app)/w/[slug]/admin/teams', 'page')
  return swap.failed > 0 ? { ok: true, notice: libText(t, NOTICE_TEAM_CODE_PROFILE) } : { ok: true }
}

export type TeamMergePreviewResult = { ok: true; counts: TeamRefCounts } | { ok: false; error: string }
export type TeamMergeResult = { ok: true; summary: TeamMergeSummary } | { ok: false; error: string }

/** 병합 미리보기 — 원본 팀을 가리키는 것의 건수(읽기 전용). 두 팀 모두 그 워크스페이스의 공용 팀이어야 한다 */
export async function previewTeamMerge(workspaceId: string, sourceId: string, targetId: string): Promise<TeamMergePreviewResult> {
  const t = await serverTranslator()
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, error: libText(t, ERR_WORKSPACE_REQUIRED) }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  if (typeof sourceId !== 'string' || !sourceId || typeof targetId !== 'string' || !targetId) return { ok: false, error: t(ERR_TEAM_NOT_COMMON) }
  if (sourceId === targetId) return { ok: false, error: libText(t, ERR_TEAM_MERGE_SAME) }
  const admin = createAdminClient()
  const pair = await admin.from('teams').select('id, active').is('project_id', null).eq('workspace_id', workspaceId).in('id', [sourceId, targetId])
  if (pair.error) return { ok: false, error: failWith('teams.mergePreview', pair.error, t(ERR_TEAM_LOOKUP)) }
  const rows = (pair.data ?? []) as { id: string; active: boolean }[]
  if (rows.length !== 2) return { ok: false, error: t(ERR_TEAM_NOT_COMMON) }
  if (!rows.find((r) => r.id === targetId)?.active) return { ok: false, error: libText(t, ERR_TEAM_MERGE_TARGET_INACTIVE) }
  const res = await admin.rpc('team_reference_counts', { p_team_id: sourceId })
  if (res.error) return { ok: false, error: failWith('teams.mergePreview', res.error, libText(t, ERR_TEAM_MERGE_PREVIEW)) }
  const counts = parseTeamRefCounts(res.data)
  // 모양이 다른 결과를 0건으로 위장하지 않는다(표시 = 로깅)
  if (!counts) return { ok: false, error: failWith('teams.mergePreview', new Error(`건수 결과의 모양이 기대와 다릅니다: ${JSON.stringify(res.data)}`), libText(t, ERR_TEAM_MERGE_PREVIEW)) }
  return { ok: true, counts }
}

/** 다른 팀으로 합치기 — merge_teams RPC 한 트랜잭션: 원본 팀의 담당·명단·영역·회의록·회의록 폴더·수락 전 초대·연동 자격증명을 대상 팀으로 옮기고
 *  원본을 비활성으로 남긴다(비활성화 = 삭제). 둘 다 가리키던 행은 대상 쪽 한 행만 남는다(주관·대표가 이긴다). 되돌릴 수 없다.
 *  RPC 가 워크스페이스 관리자를 다시 판정한다. */
export async function mergeTeams(workspaceId: string, sourceId: string, targetId: string): Promise<TeamMergeResult> {
  const t = await serverTranslator()
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, error: libText(t, ERR_WORKSPACE_REQUIRED) }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  if (typeof sourceId !== 'string' || !sourceId || typeof targetId !== 'string' || !targetId) return { ok: false, error: t(ERR_TEAM_NOT_COMMON) }
  if (sourceId === targetId) return { ok: false, error: libText(t, ERR_TEAM_MERGE_SAME) }
  const admin = createAdminClient()
  // 쓰기 전 선행 조회 — 가드가 판정한 그 워크스페이스의 공용 팀 둘이어야 한다(다른 범위의 팀 id 를 RPC 에 넘기지 않는다)
  const pair = await admin.from('teams').select('id, active').is('project_id', null).eq('workspace_id', workspaceId).in('id', [sourceId, targetId])
  if (pair.error) return { ok: false, error: failWith('teams.merge', pair.error, t(ERR_TEAM_LOOKUP)) }
  const rows = (pair.data ?? []) as { id: string; active: boolean }[]
  if (rows.length !== 2) return { ok: false, error: t(ERR_TEAM_NOT_COMMON) }
  if (!rows.find((r) => r.id === targetId)?.active) return { ok: false, error: libText(t, ERR_TEAM_MERGE_TARGET_INACTIVE) }
  const res = await admin.rpc('merge_teams', { p_actor: g.actor.userId, p_source_team_id: sourceId, p_target_team_id: targetId })
  if (res.error) {
    const f = rpcFailure(res.error, TEAM_MERGE_TOKENS, t)
    if (!f) return { ok: false, error: failWith('teams.merge', res.error, libText(t, ERR_TEAM_MERGE)) }
    console.error('[teams.merge] 병합 거부:', f.token)
    return { ok: false, error: f.message }
  }
  const summary = parseTeamMergeResult(res.data)
  if (!summary) return { ok: false, error: failWith('teams.merge', new Error(`병합 결과의 모양이 기대와 다릅니다: ${JSON.stringify(res.data)}`), libText(t, ERR_TEAM_MERGE)) }
  // 옮겨 온 작업·회의록의 색인 본문(담당 팀 이름)을 다시 만든다 — 대상 팀이 이제 그 문서를 전부 가리킨다
  await enqueueTeamRenameIndexChange(targetId)
  revalidatePath('/(app)/w/[slug]/admin/teams', 'page')
  return { ok: true, summary }
}
