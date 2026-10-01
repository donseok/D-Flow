'use server'

// 프로젝트 팀 관리(프로젝트 관리자) — 전역 팀(/admin/teams, 슈퍼유저)과 별개 스코프(0071).
// 회의록 시드 폴더는 만들지 않는다: 회의록·또박또박은 전역 팀 축이다(스펙 §5).
// 삭제 없음: 비활성화=삭제(전역 팀과 동일 관례).

import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeNewTeamCode, reservedTeamNames } from '@/lib/domain/teams'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { pickTeamColor } from '@/lib/domain/teamColor'
import { refreshTeams } from '@/lib/teams/master'
import { workspaceTeams } from '@/lib/teams/source'
import { checkTeamRename } from '@/lib/domain/teamName'
import { failWith } from '@/lib/errors/dbFail'

export type ProjectTeamActionResult = { ok: true } | { ok: false; error: string }

// DB 원문은 로그로만(SP4 D21) — 응답에는 고정 문구. 'use server' 라 export 하지 않는다.
const ERR_TEAM_LOOKUP = '팀 정보를 확인하지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_TEAM_CREATE = '팀을 만들지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_TEAM_UPDATE = '팀을 수정하지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_TEAM_COPY = '공용 팀을 복사하지 못했습니다. 잠시 후 다시 시도하세요.'

export async function addProjectTeam(projectId: string, input: string): Promise<ProjectTeamActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  // 예약어는 그 프로젝트의 단계 이름·추가 축 이름까지(D38) — 설정을 못 읽으면 만들지 않는다(쓰기 전 선행 조회 실패는 중단, 3원칙 ②)
  let reserved: string[]
  try {
    const cfg = await getProjectConfig(projectId)
    reserved = reservedTeamNames({ levelLabels: valueOf(cfg, 'core.level_labels'), extraAxisLabel: valueOf(cfg, 'core.extra_axis_label') })
  } catch (e) {
    console.error('[projectTeams] 예약어 판정용 설정 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: '프로젝트 설정을 확인할 수 없어 팀을 만들지 않았습니다. 잠시 후 다시 시도하세요.' }
  }
  const norm = normalizeNewTeamCode(input, reserved)
  if (!norm.ok) return norm
  // requireProjectAdmin 이 통과했으면 roleIn 이 이미 projectWorkspace 에서 이 프로젝트를 찾은 뒤다
  // (domain/authz.ts roleIn ④) — 여기서 다시 없을 수 없다. projects 테이블을 별도 조회하지 않는다
  // (이 액션은 teams 테이블만 만진다는 계약, project-teams-actions.test.ts 의 fromCalls 가드).
  const workspaceId = g.actor.projectWorkspace.get(projectId)
  if (!workspaceId) return { ok: false, error: '프로젝트의 워크스페이스를 확인할 수 없습니다.' }
  const admin = createAdminClient()

  // 중복은 동일 프로젝트 내에서만 거부 — 전역·타 프로젝트 동명은 허용(복합 유니크와 일치).
  const dup = await admin.from('teams').select('id').eq('project_id', projectId).eq('code', norm.code).maybeSingle()
  if (dup.error) return { ok: false, error: failWith('projectTeams.add', dup.error, ERR_TEAM_LOOKUP) }
  if (dup.data) return { ok: false, error: `'${norm.code}' 팀이 이미 이 프로젝트에 있습니다.` }

  const max = await admin.from('teams')
    .select('sort_order').eq('project_id', projectId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) return { ok: false, error: failWith('projectTeams.add', max.error, ERR_TEAM_LOOKUP) }
  const sortOrder = Number((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  const ins = await admin.from('teams')
    .insert({ code: norm.code, name: norm.code, sort_order: sortOrder, project_id: projectId, workspace_id: workspaceId, color: pickTeamColor(sortOrder) })
  if (ins.error) return { ok: false, error: failWith('projectTeams.add', ins.error, ERR_TEAM_CREATE) }

  await refreshTeams()
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

export async function updateProjectTeam(
  projectId: string, teamId: string,
  patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number; name?: string },
): Promise<ProjectTeamActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const row: Record<string, unknown> = {}
  if (typeof patch.active === 'boolean') row.active = patch.active
  if (typeof patch.progressVisible === 'boolean') row.progress_visible = patch.progressVisible
  if (typeof patch.sortOrder === 'number' && Number.isInteger(patch.sortOrder)) row.sort_order = patch.sortOrder
  if (patch.name !== undefined) {
    // 개명(D37) — code 는 그대로. 예약어는 그 프로젝트의 단계 이름까지, 겹침은 그 프로젝트 전용 팀끼리. 선행 조회 실패는 중단(3원칙 ②)
    let reserved: string[]
    try {
      const cfg = await getProjectConfig(projectId)
      reserved = reservedTeamNames({ levelLabels: valueOf(cfg, 'core.level_labels'), extraAxisLabel: valueOf(cfg, 'core.extra_axis_label') })
    } catch (e) {
      return { ok: false, error: failWith('projectTeams.rename', e, ERR_TEAM_LOOKUP) }
    }
    const sib = await admin.from('teams').select('id, code, name').eq('project_id', projectId)
    if (sib.error) return { ok: false, error: failWith('projectTeams.rename', sib.error, ERR_TEAM_LOOKUP) }
    const siblings = (sib.data ?? []) as { id: string; code: string; name: string }[]
    const self = siblings.find((s) => s.id === teamId)
    if (!self) return { ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' }
    const checked = checkTeamRename({ name: patch.name, selfId: teamId, selfCode: self.code, siblings, reserved })
    if (!checked.ok) return checked
    row.name = checked.name
  }
  if (Object.keys(row).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }
  // .eq('project_id') 를 함께 건다 — 관리자 가드가 통과한 프로젝트의 행만 만진다(전역 행 오수정 차단).
  // .select('id') 로 영향 행을 확인한다 — 0행이면 조용한 no-op 을 성공으로 위장하지 않는다
  // (teams.ts updateTeam 과 대칭되는 방어, revokeProjectInvite 원조 관례).
  const upd = await admin.from('teams').update(row).eq('id', teamId).eq('project_id', projectId).select('id')
  if (upd.error) return { ok: false, error: failWith('projectTeams.update', upd.error, ERR_TEAM_UPDATE) }
  if (!upd.data || upd.data.length === 0) return { ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' }
  await refreshTeams()
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/** 전역 활성 팀을 프로젝트 팀으로 복사해 시작 — 프로젝트 팀 0개일 때만(1회성 시작 도구). */
export async function copyGlobalTeams(projectId: string): Promise<ProjectTeamActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  // addProjectTeam 과 같은 근거(roleIn ④) — projects 테이블을 따로 조회하지 않는다.
  const workspaceId = g.actor.projectWorkspace.get(projectId)
  if (!workspaceId) return { ok: false, error: '프로젝트의 워크스페이스를 확인할 수 없습니다.' }
  const admin = createAdminClient()
  const existing = await admin.from('teams').select('id').eq('project_id', projectId).limit(1).maybeSingle()
  if (existing.error) return { ok: false, error: failWith('projectTeams.copy', existing.error, ERR_TEAM_LOOKUP) }
  if (existing.data) return { ok: false, error: '이미 프로젝트 팀이 정의되어 있습니다.' }
  // 복사 원본은 이 프로젝트 워크스페이스의 공용 팀뿐이다 — 옛 teamsSync() 는 전 워크스페이스의 공용 팀을
  // 섞어 돌려줘 다른 워크스페이스의 팀 이름까지 이 프로젝트로 복사했다(SP2 §4.2).
  // 팀 원천 실패는 throw 한다 — '복사할 것이 없다'로 위장하지 않는다(요청 범위 원천, service_role 로 — SP4 A2).
  let globals
  try {
    globals = (await workspaceTeams(workspaceId, { client: admin })).filter(t => t.active)
  } catch (e) {
    console.error('[projectTeams] 공용 팀 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: '팀 기준정보를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.' }
  }
  // 공용 활성 팀 0개는 빈 DB 출발이면 '복사할 것이 없다' — 빈 insert 를
  // 성공으로 위장하지 않는다(호출부 토스트가 '복사했습니다'를 잘못 보여주는 사고 방지).
  if (globals.length === 0) return { ok: false, error: '복사할 전역 팀이 없습니다.' }
  const ins = await admin.from('teams').insert(globals.map(t => ({
    code: t.code, name: t.code, sort_order: t.sortOrder,
    progress_visible: t.progressVisible, project_id: projectId,
    workspace_id: workspaceId, color: pickTeamColor(t.sortOrder),
  })))
  if (ins.error) return { ok: false, error: failWith('projectTeams.copy', ins.error, ERR_TEAM_COPY) }
  await refreshTeams()
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}
