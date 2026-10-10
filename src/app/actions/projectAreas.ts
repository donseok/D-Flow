'use server'
// 담당 영역 관리(프로젝트 관리자) — 저장은 RPC upsert_project_area 한 길이다(스펙 §4.1.3·D22·D27): 영역과 영역-팀을 한 트랜잭션에
// 맞추고, 주간 영역이 활성이면 이번 주 이후 문서에 그 영역의 행을 만든다(과거 주차는 그대로 — W17). 세션 쓰기 정책은 없다(D27).
// 이 RPC 는 service_role DEFINER 라 RLS 가 빠진다 — p_actor(가드 결과)로 프로젝트 관리자 등급을 RPC 안에서 다시 판정한다(D28·D51,
// 감사 문서 docs/sp2-admin-client-audit.md 의 'DEFINER RPC 가 등급을 다시 판정하는 경로').
// 삭제 없음: 데이터가 달린 영역이라 비활성(active=false)이 삭제다. code·kind·project_id 는 불변(트리거 project_areas_guard — D46).
// 모듈 관문 없음(매니페스트 null — D25): 영역 추가·재활성은 주간 모듈이 꺼져 있어도 행을 만든다(다시 켰을 때 행이 있어야 한다).
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { adminFor } from '@/lib/supabase/adminFor'
import { isUuidLike } from '@/lib/domain/validate'
import { todayIn, weekKeyOf } from '@/lib/domain/calendar'
import { requireCalendar } from '@/lib/calendar/load'
import { resolveTeamsForProject } from '@/lib/domain/teams'
import {
  ERR_AREA_CODE_IMMUTABLE, ERR_ISSUE_AREA_CODE, validateArea,
  type AreaInput,
} from '@/lib/domain/areas'
import { getProjectConfig, type ProjectConfig } from '@/lib/settings/projectConfig'
import { configText, CONFIG_MESSAGES, ConfigKeyError, ConfigUnavailableError, ERR_CONFIG_UNAVAILABLE } from '@/lib/settings/errors'
import { failWith, rpcFailure, tokenTable, type OwnTokenKeys } from '@/lib/errors/dbFail'
import { enqueueWeeklyAreaIndexChange } from '@/lib/ai/index/enqueueChange'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'
import { fill } from '@/lib/i18n/translate'

/** 저장 결과 — rowsAdded 는 RPC 가 이번 주 이후 문서에 새로 만든 주간 행 수(비활성·이슈 영역은 0) */
export type UpsertAreaResult =
  | { ok: true; id: string; status: 'created' | 'updated'; rowsAdded: number }
  | { ok: false; code: string; error: string; retryable?: boolean }

const ERR_BAD_REQUEST = 'err.invalidRequest'
const ERR_NOT_FOUND = 'srv.projectAreas.areaDoesNotBelongProject'
const ERR_TEAM_SCOPE = 'err.teamCannotUsedProject'
const ERR_KIND_IMMUTABLE = 'srv.projectAreas.areaKindCannotChanged'
const ERR_PROJECT_IMMUTABLE = 'srv.projectAreas.areaCannotMovedAnotherProject'
const ERR_SAVE = 'srv.projectAreas.couldNotSaveArea'
const dupCode = (tr: ServerTranslate, code: string) => fill(tr('err.codeAlreadyExists'), { code })

/** upsert_project_area 의 자기 토큰(D45 — 재검토 T6). 입력 토큰 AREA_INVALID_INPUT(22023)은 넣지 않는다 — 모양 검사·validateArea 가
 *  RPC 앞에서 같은 것을 거르므로 나면 결함이다(failWith 로그 + 일반 문구). 40P01·55P03 은 rpcFailure 가 503 재시도로 판정한다 */
const AREA_TOKENS: OwnTokenKeys = {
  AREA_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: ERR_DENIED },
  PROJECT_NOT_FOUND: { status: 404, code: 'ERR_MISSING', message: ERR_MISSING },
  AREA_NOT_FOUND: { status: 404, code: 'ERR_MISSING', key: ERR_NOT_FOUND },
  PROJECT_AREA_KIND_IMMUTABLE: { status: 400, code: 'INVALID_INPUT', key: ERR_KIND_IMMUTABLE },
  PROJECT_AREA_CODE_IMMUTABLE: { status: 400, code: 'INVALID_INPUT', message: ERR_AREA_CODE_IMMUTABLE },
  PROJECT_AREA_PROJECT_IMMUTABLE: { status: 400, code: 'INVALID_INPUT', key: ERR_PROJECT_IMMUTABLE },
  AREA_TEAM_SCOPE: { status: 400, code: 'INVALID_INPUT', key: ERR_TEAM_SCOPE },
  // 같은 code 의 전용 팀이 있는 공용 팀을 새로 붙일 때(*_command_receipts ⑤′ — 전환 뒤 오래된 폼). 이미 배정된 행의 재저장은 통과한다
  TEAM_SCOPE_PROJECT_OWNED: { status: 400, code: 'INVALID_INPUT', key: ERR_TEAM_SCOPE },
  AREA_CODE_INVALID: { status: 400, code: 'INVALID_INPUT', message: ERR_ISSUE_AREA_CODE },
  PROJECT_AREA_CODE_INVALID: { status: 400, code: 'INVALID_INPUT', message: ERR_ISSUE_AREA_CODE },
}

/**
 * 이 영역에 걸 수 있는 팀 id — 편집기 선택지와 같은 집합(스펙 §4.1.8, 재검토 A F-5): 그 프로젝트의 팀 ∪ 이 영역에 이미 배정된 팀.
 * 프로젝트의 팀은 resolveTeamsForProject 규칙 그대로다(전용 팀이 하나라도(비활성 포함) 있으면 전용만, 없으면 그 워크스페이스 공용) —
 * 해석기의 팀 목록이 그 워크스페이스 공용 ∪ 이 프로젝트 전용이라 그 위에 규칙만 얹는다. 팀 원천 모듈의 projectTeams(과제 27 —
 * src/lib/teams/source.ts)와 같은 규칙이므로 그 모듈이 생겨도 이 자리는 그대로 둔다.
 * DB 가드(area_teams_guard)는 같은 워크스페이스 공용 팀을 늘 허용한다 — "전용 팀이 있으면 공용 제외"는 앱 계층의 몫이다(0003).
 * 그래서 전환 전에 연 낡은 화면이 공용 팀 id 를 보내도 같은 code 의 공용·전용 팀이 한 영역에 함께 걸리지 않게 여기서 막는다.
 * 기존 배정은 종류와 무관하게 그 id 의 영역에서 읽는다(종류를 바꾸려는 요청은 RPC 가 PROJECT_AREA_KIND_IMMUTABLE 로 판정한다).
 */
function assignableTeamIds(cfg: ProjectConfig, areaId: string | undefined): Set<string> {
  const teams = resolveTeamsForProject(cfg.teams.map(t => ({ ...t, workspaceId: cfg.workspaceId })), cfg.projectId, cfg.workspaceId)
  const ids = new Set(teams.map(t => t.id))
  const current = areaId ? [...cfg.areas.weekly_section, ...cfg.areas.issue_area].find(a => a.id === areaId) : undefined
  for (const t of current?.teams ?? []) ids.add(t.teamId)
  return ids
}

/**
 * 추가·수정(비활성화 포함) 한 입구 — RPC upsert_project_area(스펙 §3.2·§4.1.3). 순서: 가드 → 입력 모양 → validateArea → 팀 범위(선행 조회)
 * → RPC. code 중복은 DB 유일 제약(23505)이 판정한다 — 다른 창이 먼저 만든 경합도 같은 문구다. p_from_week = 그 프로젝트 tz·주 규칙의
 * 이번 주 키(SP5 D34). 이슈 영역(kind issue_area)도 같은 길이다(SP5 — RPC 가 그 종류에는 행을 만들지 않는다).
 */
export async function upsertArea(projectId: string, input: AreaInput): Promise<UpsertAreaResult> {
  const tr = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, code: g.error, error: g.error }
  // 서버 액션 입력은 타입을 믿지 않는다.
  if (!input || typeof input.code !== 'string' || typeof input.name !== 'string'
      || typeof input.active !== 'boolean' || !Array.isArray(input.teams)
      || (input.id !== undefined && (typeof input.id !== 'string' || !isUuidLike(input.id)))
      || !input.teams.every(t => t && typeof t.teamId === 'string' && isUuidLike(t.teamId))) {
    return { ok: false, code: 'INVALID_INPUT', error: tr(ERR_BAD_REQUEST) }
  }
  const v = validateArea(input, [])
  if (!v.ok) return { ok: false, code: 'INVALID_INPUT', error: v.error }
  const a = v.value

  let cfg: ProjectConfig
  try {
    cfg = await getProjectConfig(projectId)
  } catch (e) {
    if (e instanceof ConfigUnavailableError) {
      return { ok: false, code: 'CONFIG_UNAVAILABLE', error: failWith('areas/upsert', e, configText(tr, ERR_CONFIG_UNAVAILABLE)), retryable: true }
    }
    throw e
  }
  let fromWeek: string
  try {
    // 이번 주 이후 문서에 행을 만든다 — '이번 주'는 그 프로젝트의 tz·주 규칙으로(SP5 D34, 옛 '서울 기준 이번 주 월요일')
    const cal = requireCalendar(cfg)
    fromWeek = weekKeyOf(cal.weekStart, todayIn(cal.timezone, new Date()))
  } catch (e) {
    if (e instanceof ConfigKeyError) return { ok: false, code: 'CONFIG_INVALID', error: `${configText(tr, CONFIG_MESSAGES[e.code])} (${e.key})` }
    throw e
  }
  const allowed = assignableTeamIds(cfg, a.id)
  if (a.teams.some(t => !allowed.has(t.teamId))) return { ok: false, code: 'INVALID_INPUT', error: tr(ERR_TEAM_SCOPE) }

  const { admin } = adminFor({ projectId })
  const { data, error } = await admin.rpc('upsert_project_area', {
    p_actor: g.actor.userId,
    p_project_id: projectId,
    p_area: { ...(a.id ? { id: a.id } : {}), kind: a.kind, code: a.code, name: a.name, sort_order: a.sortOrder, active: a.active },
    p_teams: a.teams.map(t => ({ team_id: t.teamId, kind: t.kind })),
    p_from_week: fromWeek,
  })
  if (error) {
    const f = rpcFailure(error, tokenTable(AREA_TOKENS, tr), tr)
    if (f) return { ok: false, code: f.code, error: f.message, ...(f.retryable ? { retryable: true } : {}) }
    if (error.code === '23505') return { ok: false, code: 'INVALID_INPUT', error: dupCode(tr, a.code) }
    return { ok: false, code: 'UNAVAILABLE', error: failWith('areas/upsert', error, tr(ERR_SAVE)) }
  }
  const r = data as { status: 'created' | 'updated'; area_id: string; rows_added: number }
  // 주간 영역의 이름이 바뀌면 그 영역의 행이 든 주간 문서의 색인 본문(행 머리의 영역 이름)이 낡는다 — 그 문서들을 다시 색인한다.
  // 이전 이름은 RPC 앞에서 읽은 설정이다: 그 사이 다른 창이 같은 영역의 이름을 바꿨다면 여기서는 "안 바뀜"으로 보일 수 있다(그 창의 저장이
  // 자기 몫의 재색인을 건다 — 두 저장이 엇갈려 마지막 이름이 색인에 안 실리는 좁은 틈은 남는다). 이슈 영역은 주간 색인 본문에 없다.
  const before = a.kind === 'weekly_section' && a.id ? cfg.areas.weekly_section.find(x => x.id === a.id) : undefined
  if (r.status === 'updated' && before && before.name !== a.name) await enqueueWeeklyAreaIndexChange(projectId, r.area_id)
  revalidatePath('/(app)/p/[projectId]/settings', 'page')
  revalidatePath('/(app)/p/[projectId]/weekly', 'page')
  return { ok: true, id: r.area_id, status: r.status, rowsAdded: Number(r.rows_added) || 0 }
}
