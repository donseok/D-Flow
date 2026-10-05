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
import { normalizeNewTeamCode } from '@/lib/domain/teams'
import { EXCEL_HEADER_WORDS } from '@/lib/excel/headerWords'
import { pickTeamColor } from '@/lib/domain/teamColor'
import { checkTeamRename, newTeamCodeClash, teamCodeClashError } from '@/lib/domain/teamName'
import { failWith } from '@/lib/errors/dbFail'
import { teamRootNameError } from '@/lib/minutes/teamRootErrors'

export type TeamActionResult = { ok: true } | { ok: false; error: string }

// DB 원문은 로그로만(SP4 D21) — 응답에는 고정 문구. 'use server' 라 export 하지 않는다.
const ERR_TEAM_LOOKUP = '팀 정보를 확인하지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_TEAM_CREATE = '팀을 만들지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_TEAM_UPDATE = '팀을 수정하지 못했습니다. 잠시 후 다시 시도하세요.'

// 'use server' 모듈이라 export 하지 않는다(비동기 함수만 내보낼 수 있다). PostgREST 원문은 로그에만 남긴다.
const ERR_TEAMS_LIST = '팀 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'

/** 팀 추가 — create_team RPC 한 트랜잭션(SP5 B2 — D50): 공용 팀 + (teams 모드면) 회의록 팀 루트. 실패하면 둘 다 없다.
 *  공용 팀의 세션 INSERT 정책은 0024 가 지웠다 — 공용 팀은 이 길로만 생긴다(team-create-path 불변식). */
export async function addTeam(workspaceId: string, input: string): Promise<TeamActionResult> {
  // 대상 워크스페이스가 비면 가드 전에 거부한다 — 가드는 null 을 슈퍼유저에게 통과시킨다.
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, error: ERR_WORKSPACE_REQUIRED }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  // 공용 팀은 여러 프로젝트에 걸려 단계 이름이 하나로 정해지지 않는다 — 엑셀 머리 낱말만 예약어로 본다(SP4 D38·K14)
  const norm = normalizeNewTeamCode(input, EXCEL_HEADER_WORDS)
  if (!norm.ok) return norm
  const admin = createAdminClient()

  // 0071: 전역·프로젝트 행이 같은 code 를 가질 수 있다. 이 화면은 전역 행만 다루므로
  // project_id is null 로 고정 — 안 고정하면 어느 프로젝트가 같은 code 를 쓰는 순간
  // "이미 존재합니다"로 전역 생성이 오차단된다(임의 행을 잡는 사례).
  // workspace_id 도 함께 건다(0003) — 다른 워크스페이스의 동명 전역 팀을 오탐하지 않는다.
  // 같은 워크스페이스 공용 팀의 code·이름(개명 포함)과 대소문자·전각만 다른 code 도 거부한다(개명 규칙 D37 의 대칭 — A2-1 리뷰 정확성 P3)
  const sib = await admin.from('teams').select('id, code, name').is('project_id', null).eq('workspace_id', workspaceId)
  if (sib.error) return { ok: false, error: failWith('teams.add', sib.error, ERR_TEAM_LOOKUP) }
  const siblings = (sib.data ?? []) as { id: string; code: string; name: string }[]
  if (siblings.some((s) => s.code === norm.code)) return { ok: false, error: `'${norm.code}' 팀이 이미 존재합니다.` }
  const clash = newTeamCodeClash(norm.code, siblings)
  if (clash) return { ok: false, error: teamCodeClashError(norm.code, clash) }

  // 정렬 순번도 워크스페이스별로 잰다 — 안 그러면 다른 워크스페이스의 순번을 이어받는다.
  const max = await admin.from('teams')
    .select('sort_order').is('project_id', null).eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) return { ok: false, error: failWith('teams.add', max.error, ERR_TEAM_LOOKUP) }
  const sortOrder = Number((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  // 팀 + 루트를 한 트랜잭션으로(루트 이름 = 팀 이름 — 새 팀은 code 를 이름으로 시작한다). RPC 가 워크스페이스 관리자를 다시 판정하고,
  // 설정 행을 FOR SHARE 로 잡아 최상위 폴더 모드를 읽는다(custom 모드면 루트를 만들지 않는다)
  const ins = await admin.rpc('create_team', {
    p_actor: g.actor.userId, p_workspace_id: workspaceId, p_code: norm.code, p_name: norm.code,
    p_color: pickTeamColor(sortOrder), p_sort_order: sortOrder,
  })
  if (ins.error) {
    const rootErr = teamRootNameError(ins.error)
    if (rootErr) return { ok: false, error: rootErr }
    if (ins.error.code === '23505') return { ok: false, error: `'${norm.code}' 팀이 이미 존재합니다.` }   // 판정과 생성 사이의 경합
    return { ok: false, error: failWith('teams.add', ins.error, ERR_TEAM_CREATE) }
  }

  revalidatePath('/(app)/w/[slug]/admin/teams', 'page')
  return { ok: true }
}

/** 활성/진척현황 표시/정렬 변경. */
export async function updateTeam(
  id: string,
  patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number; name?: string },
): Promise<TeamActionResult> {
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
  const row: Record<string, unknown> = {}
  if (typeof patch.active === 'boolean') row.active = patch.active
  if (typeof patch.progressVisible === 'boolean') row.progress_visible = patch.progressVisible
  if (typeof patch.sortOrder === 'number' && Number.isInteger(patch.sortOrder)) row.sort_order = patch.sortOrder
  if (patch.name !== undefined) {
    // 개명(D37) — 공용 팀은 머리 낱말만 예약어(여러 프로젝트에 걸려 단계 이름이 하나로 정해지지 않는다 — K14), 겹침은 그 워크스페이스 공용 팀끼리
    const sib = await admin.from('teams').select('id, code, name').is('project_id', null).eq('workspace_id', target.workspace_id)
    if (sib.error) return { ok: false, error: failWith('teams.rename', sib.error, ERR_TEAM_LOOKUP) }
    const siblings = (sib.data ?? []) as { id: string; code: string; name: string }[]
    const self = siblings.find((s) => s.id === id)
    if (!self) return { ok: false, error: '전역 팀이 아니거나 존재하지 않습니다.' }
    const checked = checkTeamRename({ name: patch.name, selfId: id, selfCode: self.code, siblings, reserved: EXCEL_HEADER_WORDS })
    if (!checked.ok) return checked
    row.name = checked.name
  }
  if (Object.keys(row).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }
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
    return { ok: false, error: failWith('teams.update', upd.error, ERR_TEAM_UPDATE) }
  }
  if (!upd.data || upd.data.length === 0) return { ok: false, error: '전역 팀이 아니거나 존재하지 않습니다.' }
  revalidatePath('/(app)/w/[slug]/admin/teams', 'page')
  return { ok: true }
}

/** 관리 화면 목록(비활성 포함) — 페이지 서버 컴포넌트 전용. 그 워크스페이스의 공용 팀만.
 *  거부·조회 실패는 빈 목록이 아니라 오류다 — 빈 목록이면 화면이 'TEAMS 0' 을 사실처럼 그린다(표시 = 로깅). */
export async function listTeamsAdmin(workspaceId: string): Promise<
  | { ok: true; rows: Array<{ id: string; code: string; name: string; color: string; sortOrder: number; active: boolean; progressVisible: boolean }> }
  | { ok: false; error: string }
> {
  // 대상 워크스페이스가 비면 가드 전에 거부한다(가드는 null 을 슈퍼유저에게 통과시킨다). g 는 가드 결과만 담는다 — 원문 가드(no-raw-db-errors)가
  // 이 파일의 g.error 를 가드 출처로 판정한다(SP4 A2 에서 가드 대상이 되며 삼항의 리터럴 대안을 분기로 뺐다 — 동작 그대로)
  if (typeof workspaceId !== 'string' || !workspaceId) {
    console.error('[teams] 관리 목록 거부:', ERR_WORKSPACE_REQUIRED)
    return { ok: false, error: ERR_WORKSPACE_REQUIRED }
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
    return { ok: false, error: ERR_TEAMS_LIST }
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
