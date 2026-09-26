'use server'

// 공용 팀 기준정보 관리 — 추가/활성 토글/정렬/진척표시. 공용 팀은 그 워크스페이스의 전 프로젝트가 공유하는
// 기준정보라 프로젝트 관리자가 아니라 그 워크스페이스의 관리자가 손댄다(SP2 §4.1 — SP1 까지는 슈퍼유저 전용).
// 삭제는 없다: 비활성화(active=false)가 삭제다(데이터 보존, 사용자 결정 2026-07-24).
// 쓰기 후 refreshTeams()로 인메모리 캐시를 즉시 갱신한다(LLM 설정 액션과 동일 관례).

import { revalidatePath } from 'next/cache'
import { getActor, requireWorkspaceAdmin } from '@/lib/authz'
import { ERR_ANON, ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { createAdminClient } from '@/lib/supabase/admin'
import { adminFor } from '@/lib/supabase/adminFor'
import { normalizeNewTeamCode } from '@/lib/domain/teams'
import { pickTeamColor } from '@/lib/domain/teamColor'
import { refreshTeams } from '@/lib/teams/master'

export type TeamActionResult = { ok: true } | { ok: false; error: string }

/** 팀 추가 — teams insert + 자동 편철용 시드 루트 폴더(created_by null) 생성 + 캐시 즉시 갱신. */
export async function addTeam(workspaceId: string, input: string): Promise<TeamActionResult> {
  // 대상 워크스페이스가 비면 가드 전에 거부한다 — 가드는 null 을 슈퍼유저에게 통과시킨다.
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, error: ERR_WORKSPACE_REQUIRED }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, error: g.error }
  const norm = normalizeNewTeamCode(input)
  if (!norm.ok) return norm
  const admin = createAdminClient()

  // 0071: 전역·프로젝트 행이 같은 code 를 가질 수 있다. 이 화면은 전역 행만 다루므로
  // project_id is null 로 고정 — 안 고정하면 어느 프로젝트가 같은 code 를 쓰는 순간
  // "이미 존재합니다"로 전역 생성이 오차단된다(임의 행을 잡는 사례).
  // workspace_id 도 함께 건다(0003) — 다른 워크스페이스의 동명 전역 팀을 오탐하지 않는다.
  const dup = await admin.from('teams').select('id').eq('code', norm.code).is('project_id', null)
    .eq('workspace_id', workspaceId).maybeSingle()
  if (dup.error) return { ok: false, error: `팀 조회 실패: ${dup.error.message}` }
  if (dup.data) return { ok: false, error: `'${norm.code}' 팀이 이미 존재합니다.` }

  // 정렬 순번도 워크스페이스별로 잰다 — 안 그러면 다른 워크스페이스의 순번을 이어받는다.
  const max = await admin.from('teams')
    .select('sort_order').is('project_id', null).eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) return { ok: false, error: `팀 조회 실패: ${max.error.message}` }
  const sortOrder = Number((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  const ins = await admin.from('teams')
    .insert({ code: norm.code, name: norm.code, sort_order: sortOrder, workspace_id: workspaceId, color: pickTeamColor(sortOrder) })
  if (ins.error) return { ok: false, error: `팀 생성 실패: ${ins.error.message}` }

  // 자동 편철 앵커(0043 계약): 팀코드 동명 시드 루트 폴더. 실패해도 팀은 유지하되 관리자에게
  // 표시한다(편철은 미분류 폴백이라 치명적이진 않지만 조용히 넘기지 않는다 — 에러 3원칙).
  // 0071 이후 project_id 로도 스코프해야 한다 — 안 하면 어느 프로젝트가 같은 이름의 프로젝트
  // 루트 폴더를 먼저 만들었을 때 그 행을 "이미 있다"로 오인해 전역 루트 시드 생성이 스킵된다.
  // workspace_id 도 건다(0006) — 다른 워크스페이스의 동명 루트를 "이미 있다"로 오인하지 않는다.
  const seed = await admin.from('minute_folders')
    .select('id').is('parent_id', null).is('created_by', null).is('project_id', null).eq('name', norm.code)
    .eq('workspace_id', workspaceId).maybeSingle()
  let seedError: string | null = seed.error ? seed.error.message : null
  if (!seed.error && !seed.data) {
    // 미지정 루트는 워크스페이스별이다(0006) — 트리거가 채울 부모·프로젝트가 없으니 명시한다.
    const folder = await admin.from('minute_folders')
      .insert({ name: norm.code, parent_id: null, created_by: null, project_id: null, workspace_id: workspaceId, sort: 100 + sortOrder })
    if (folder.error) seedError = folder.error.message
  }

  await refreshTeams()
  revalidatePath('/admin/teams')
  if (seedError) {
    console.error('[teams] 시드 폴더 생성 실패:', seedError)
    return { ok: false, error: `팀은 생성됐지만 회의록 기본 폴더 생성에 실패했습니다: ${seedError}` }
  }
  return { ok: true }
}

/** 활성/진척현황 표시/정렬 변경. */
export async function updateTeam(
  id: string,
  patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number },
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
  if (Object.keys(row).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }
  // .is('project_id', null)·.eq('workspace_id') 를 함께 건다 — 가드가 판정한 그 워크스페이스의 공용 행만 만진다
  // (조회와 쓰기 사이에 행이 바뀌어도 판정 밖의 행을 건드리지 않는다; projectTeams.ts 의 updateProjectTeam 과 대칭).
  // .select('id') 로 영향 행을 확인한다 — 필터에 걸린 0행 update 가 조용히 ok:true 로 위장하지 않게
  // (조용한 no-op 금지 관례, revokeProjectInvite 와 동일).
  const upd = await admin.from('teams').update(row).eq('id', id).is('project_id', null)
    .eq('workspace_id', target.workspace_id).select('id')
  if (upd.error) return { ok: false, error: `팀 수정 실패: ${upd.error.message}` }
  if (!upd.data || upd.data.length === 0) return { ok: false, error: '전역 팀이 아니거나 존재하지 않습니다.' }
  await refreshTeams()
  revalidatePath('/admin/teams')
  return { ok: true }
}

/** 관리 화면 목록(비활성 포함) — 페이지 서버 컴포넌트 전용. 그 워크스페이스의 공용 팀만. */
export async function listTeamsAdmin(workspaceId: string): Promise<
  Array<{ id: string; code: string; sortOrder: number; active: boolean; progressVisible: boolean }>
> {
  const g = typeof workspaceId === 'string' && workspaceId
    ? await requireWorkspaceAdmin(workspaceId)
    : { ok: false as const, error: ERR_WORKSPACE_REQUIRED }
  // 반환 타입에 에러 채널이 없어 빈 목록으로 폴백하되, 사유는 로그에 남긴다(표시 = 로깅).
  if (!g.ok) {
    console.error('[teams] 관리 목록 거부:', g.error)
    return []
  }
  // 스코프를 정한 service_role 클라이언트 — 아래 필터가 쓰는 workspaceId 가 가드가 판정한 그 값이다.
  const { admin } = adminFor({ workspaceId })
  // 공용 팀 관리 화면 — project_id is null 로 고정해 프로젝트 팀(0071)이 섞여 들어오지 않게 하고,
  // workspace_id 로 좁혀 다른 워크스페이스의 공용 팀이 보이지 않게 한다(SP2 §4.2 — 종전엔 전 워크스페이스가 섞였다).
  const { data, error } = await admin.from('teams')
    .select('id, code, sort_order, active, progress_visible')
    .is('project_id', null)
    .eq('workspace_id', workspaceId)
    .order('sort_order').order('code')
  if (error) {
    console.error('[teams] 관리 목록 조회 실패:', error.message)
    return []
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    code: String(r.code),
    sortOrder: Number(r.sort_order ?? 0),
    active: r.active !== false,
    progressVisible: r.progress_visible !== false,
  }))
}
