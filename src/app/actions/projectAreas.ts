'use server'
// 담당 영역 관리(프로젝트 관리자) — project_areas + area_teams. 소비처(주간보고 구분·이슈 영역)는 SP4/SP5.
// 삭제 없음: 데이터가 달릴 영역이라 비활성(active=false)이 삭제다(스펙 §2.3.5). code 는 불변(트리거 project_areas_guard).
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/validate'
import {
  AREA_KINDS, ERR_AREA_CODE_IMMUTABLE, validateArea,
  type AreaInput, type AreaKind, type AreaTeamKind,
} from '@/lib/domain/areas'

export interface AreaRow {
  id: string
  kind: AreaKind
  code: string
  name: string
  sortOrder: number
  active: boolean
  teams: { teamId: string; kind: AreaTeamKind }[]
}

const ERR_BAD_REQUEST = '잘못된 요청입니다.'
const ERR_NOT_FOUND = '이 프로젝트의 영역이 아니거나 존재하지 않습니다.'
const ERR_TEAM_SCOPE = '이 프로젝트에서 쓸 수 없는 팀입니다.'
const dupCode = (code: string) => `'${code}' 코드가 이미 있습니다.`

type DbError = { code?: string; message: string }
/** 쓰기 오류 → 화면 문구. 트리거 메시지는 경쟁 조건(사전검사 뒤 다른 창이 바꾼 경우)에서만 여기까지 온다. */
function writeError(e: DbError, code: string): string {
  if (e.message.includes('PROJECT_AREA_CODE_IMMUTABLE')) return ERR_AREA_CODE_IMMUTABLE
  if (e.message.includes('AREA_TEAM_SCOPE')) return ERR_TEAM_SCOPE
  if (e.code === '23505') return dupCode(code)
  return `영역 저장 실패: ${e.message}`
}

export async function listAreas(
  projectId: string, kind: AreaKind,
): Promise<{ ok: true; areas: AreaRow[] } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!(AREA_KINDS as readonly string[]).includes(kind)) return { ok: false, error: ERR_BAD_REQUEST }
  const { data, error } = await createAdminClient().from('project_areas')
    .select('id, kind, code, name, sort_order, active, area_teams(team_id, kind)')
    .eq('project_id', projectId).eq('kind', kind)
    .order('sort_order').order('code')
  if (error) return { ok: false, error: `영역을 불러오지 못했습니다: ${error.message}` }
  type Raw = { id: string; kind: AreaKind; code: string; name: string; sort_order: number; active: boolean
    area_teams: { team_id: string; kind: AreaTeamKind }[] | null }
  return { ok: true, areas: ((data ?? []) as Raw[]).map(r => ({
    id: r.id, kind: r.kind, code: r.code, name: r.name, sortOrder: r.sort_order, active: r.active,
    teams: (r.area_teams ?? []).map(t => ({ teamId: t.team_id, kind: t.kind })),
  })) }
}

/**
 * 추가·수정(비활성화 포함) 한 입구. area_teams 는 원하는 목록을 먼저 upsert 하고 목록 밖을 지운다 —
 * 삭제 후 삽입 순서면 삽입 실패 때 담당 팀이 비어 버린다. 두 문장이라 원자적이지는 않다(실패는 그대로 보고).
 */
export async function upsertArea(
  projectId: string, input: AreaInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  // 서버 액션 입력은 타입을 믿지 않는다.
  if (!input || typeof input.code !== 'string' || typeof input.name !== 'string'
      || typeof input.active !== 'boolean' || !Array.isArray(input.teams)
      || (input.id !== undefined && (typeof input.id !== 'string' || !isUuidLike(input.id)))
      || !input.teams.every(t => t && typeof t.teamId === 'string' && isUuidLike(t.teamId))) {
    return { ok: false, error: ERR_BAD_REQUEST }
  }
  const admin = createAdminClient()

  const existing = await admin.from('project_areas').select('id, kind, code')
    .eq('project_id', projectId).eq('kind', input.kind)
  if (existing.error) return { ok: false, error: `영역 조회 실패: ${existing.error.message}` }
  const rows = (existing.data ?? []) as { id: string; kind: AreaKind; code: string }[]
  if (input.id) {
    const cur = rows.find(r => r.id === input.id)
    if (!cur) return { ok: false, error: ERR_NOT_FOUND }
    if (cur.code !== input.code.trim()) return { ok: false, error: ERR_AREA_CODE_IMMUTABLE }
  }
  const v = validateArea(input, rows)
  if (!v.ok) return v
  const a = v.value

  let areaId: string
  if (a.id) {
    // code 는 보내지 않는다. 이 프로젝트 행만 — 0행이면 조용한 no-op 을 성공으로 위장하지 않는다.
    const upd = await admin.from('project_areas')
      .update({ name: a.name, sort_order: a.sortOrder, active: a.active })
      .eq('id', a.id).eq('project_id', projectId).select('id')
    if (upd.error) return { ok: false, error: writeError(upd.error, a.code) }
    if (!upd.data || (upd.data as unknown[]).length === 0) return { ok: false, error: ERR_NOT_FOUND }
    areaId = a.id
  } else {
    const ins = await admin.from('project_areas')
      .insert({ project_id: projectId, kind: a.kind, code: a.code, name: a.name, sort_order: a.sortOrder, active: a.active })
      .select('id').single()
    if (ins.error) return { ok: false, error: writeError(ins.error, a.code) }
    areaId = (ins.data as { id: string }).id
  }

  const teamFail = (e: DbError) => ({
    ok: false as const,
    error: `영역은 저장했지만 담당 팀을 저장하지 못했습니다: ${e.message.includes('AREA_TEAM_SCOPE') ? ERR_TEAM_SCOPE : e.message}`,
  })
  if (a.teams.length > 0) {
    const up = await admin.from('area_teams')
      .upsert(a.teams.map(t => ({ area_id: areaId, team_id: t.teamId, kind: t.kind })), { onConflict: 'area_id,team_id' })
    if (up.error) return teamFail(up.error)
  }
  let del = admin.from('area_teams').delete().eq('area_id', areaId)
  if (a.teams.length > 0) del = del.not('team_id', 'in', `(${a.teams.map(t => t.teamId).join(',')})`)
  const d = await del
  if (d.error) return teamFail(d.error)

  revalidatePath(`/p/${projectId}/settings`)
  return { ok: true, id: areaId }
}
