// 팀 코드 변경·병합 RPC(change_team_code·merge_teams·team_reference_counts)의 결과·오류를 앱의 말로 옮기는 순수 도우미.
// 공용 팀 액션(actions/teams.ts)과 전용 팀 액션(actions/projectTeams.ts)이 같은 표·같은 문구를 쓴다 — RPC 호출 자체는 각 액션에 둔다
// (p_actor 가 그 액션의 가드 결과에서 바로 와야 한다 — tests/invariants/rpc-actor-source).
// DB 원문은 응답에 싣지 않는다(SP4 D21) — 토큰 표에 없는 오류는 호출부가 failWith 로 로그 + 고정 문구를 낸다.
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import type { OwnTokenTable } from '@/lib/errors/dbFail'

export const ERR_TEAM_CODE_TAKEN = '같은 범위에 그 코드를 쓰는 팀이 이미 있습니다.'
export const ERR_TEAM_CODE_SCOPE_CONFLICT =
  '그 코드는 쓸 수 없습니다 — 프로젝트 팀과 그 프로젝트가 쓰고 있는 공용 팀의 코드가 같아져 담당·명단이 두 팀으로 갈라집니다.'
export const ERR_TEAM_CODE_INVALID = '팀 코드는 1~20자이고 줄바꿈·탭을 쓸 수 없습니다.'
export const ERR_TEAM_CODE_CHANGE = '팀 코드를 바꾸지 못했습니다. 잠시 후 다시 시도하세요.'
/** 코드는 바뀌었고 저장해 둔 엑셀 양식의 팀 열만 따라가지 못했다 — 실패가 아니라 알림이다 */
export const NOTICE_TEAM_CODE_PROFILE =
  '팀 코드는 바꿨지만 저장해 둔 엑셀 양식의 팀 열을 새 코드로 맞추지 못한 프로젝트가 있습니다. 그 프로젝트는 가져오기 화면에서 양식을 다시 저장하세요.'

/** change_team_code 의 자기 토큰(SP4 D45 — 호출부 자기 매핑). 55P03(잠금 대기 상한)·40P01 은 rpcFailure 가 재시도 문구로 */
export const TEAM_CODE_TOKENS: OwnTokenTable = {
  TEAM_CODE_CHANGE_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: ERR_DENIED },
  TEAM_NOT_FOUND: { status: 404, code: 'ERR_MISSING', message: ERR_MISSING },
  TEAM_CODE_TAKEN: { status: 409, code: 'TEAM_CODE_TAKEN', message: ERR_TEAM_CODE_TAKEN },
  TEAM_CODE_SCOPE_CONFLICT: { status: 409, code: 'TEAM_CODE_SCOPE_CONFLICT', message: ERR_TEAM_CODE_SCOPE_CONFLICT },
  TEAM_CODE_INVALID: { status: 400, code: 'TEAM_CODE_INVALID', message: ERR_TEAM_CODE_INVALID },
}

export const ERR_TEAM_MERGE_SAME = '같은 팀으로는 합칠 수 없습니다.'
export const ERR_TEAM_MERGE_SCOPE = '같은 범위의 팀끼리만 합칠 수 있습니다.'
export const ERR_TEAM_MERGE_TARGET_INACTIVE = '비활성화된 팀으로는 합칠 수 없습니다. 합칠 대상 팀을 먼저 활성화하세요.'
export const ERR_TEAM_MERGE_SCOPE_CONFLICT =
  '합칠 수 없습니다 — 원본 팀을 쓰는 프로젝트에 대상 팀과 코드가 같은 프로젝트 팀이 있습니다. 그 프로젝트의 팀 코드를 먼저 바꾸세요.'
export const ERR_TEAM_MERGE_ROOT_NAME =
  '대상 팀 이름과 같은 회의록 최상위 폴더가 이미 있어 합치지 못했습니다. 그 폴더의 이름을 먼저 바꾸세요.'
export const ERR_TEAM_MERGE_FOLDER = '회의록 폴더 이름이 너무 많이 겹쳐 합치지 못했습니다. 겹치는 폴더의 이름을 먼저 바꾸세요.'
export const ERR_TEAM_MERGE = '팀을 합치지 못했습니다. 잠시 후 다시 시도하세요.'
export const ERR_TEAM_MERGE_PREVIEW = '합칠 때의 영향을 확인하지 못했습니다. 잠시 후 다시 시도하세요.'

/** merge_teams 의 자기 토큰. TEAM_SCOPE_PROJECT_OWNED 는 RPC 의 사전 판정을 지나 M1 가드가 직접 막은 경우(경합)다 — 같은 문구 */
export const TEAM_MERGE_TOKENS: OwnTokenTable = {
  TEAM_MERGE_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: ERR_DENIED },
  TEAM_NOT_FOUND: { status: 404, code: 'ERR_MISSING', message: ERR_MISSING },
  TEAM_MERGE_SAME_TEAM: { status: 400, code: 'TEAM_MERGE_SAME_TEAM', message: ERR_TEAM_MERGE_SAME },
  TEAM_MERGE_SCOPE_MISMATCH: { status: 400, code: 'TEAM_MERGE_SCOPE_MISMATCH', message: ERR_TEAM_MERGE_SCOPE },
  TEAM_MERGE_TARGET_INACTIVE: { status: 409, code: 'TEAM_MERGE_TARGET_INACTIVE', message: ERR_TEAM_MERGE_TARGET_INACTIVE },
  TEAM_MERGE_SCOPE_CONFLICT: { status: 409, code: 'TEAM_MERGE_SCOPE_CONFLICT', message: ERR_TEAM_MERGE_SCOPE_CONFLICT },
  TEAM_SCOPE_PROJECT_OWNED: { status: 409, code: 'TEAM_MERGE_SCOPE_CONFLICT', message: ERR_TEAM_MERGE_SCOPE_CONFLICT },
  TEAM_ROOT_NAME_CONFLICT: { status: 409, code: 'TEAM_ROOT_NAME_CONFLICT', message: ERR_TEAM_MERGE_ROOT_NAME },
  TEAM_MERGE_FOLDER_CONFLICT: { status: 409, code: 'TEAM_MERGE_FOLDER_CONFLICT', message: ERR_TEAM_MERGE_FOLDER },
}

/** 한 팀을 가리키는 것의 건수(team_reference_counts) — 병합 미리보기. 초대는 수락 전 것만 */
export interface TeamRefCounts {
  itemOwners: number
  memberTeams: number
  areaTeams: number
  minutes: number
  minuteFolders: number
  invites: number
  credentials: number
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

/** RPC 의 jsonb → 건수. 모양이 다르면 null — 호출부가 오류로 올린다(0 으로 위장하지 않는다) */
export function parseTeamRefCounts(data: unknown): TeamRefCounts | null {
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  const out = {
    itemOwners: count(r.item_owners), memberTeams: count(r.project_member_teams), areaTeams: count(r.area_teams),
    minutes: count(r.minutes), minuteFolders: count(r.minute_folders), invites: count(r.invites), credentials: count(r.credentials),
  }
  return Object.values(out).some((v) => v === null) ? null : (out as TeamRefCounts)
}

export const totalTeamRefs = (c: TeamRefCounts): number =>
  c.itemOwners + c.memberTeams + c.areaTeams + c.minutes + c.minuteFolders + c.invites + c.credentials

/** 병합 결과 요약 — 옮긴 건수와, 원본·대상을 둘 다 가리켜 한 행으로 줄인 건수(deduped) */
export interface TeamMergeSummary {
  moved: { itemOwners: number; memberTeams: number; areaTeams: number; minutes: number; invites: number; credentials: number }
  deduped: { itemOwners: number; memberTeams: number; areaTeams: number }
  /** 회의록 폴더 — 이름이 겹쳐 '이름 (원본 팀 이름)' 으로 바꿔 옮긴 하위 폴더 수 */
  foldersRenamed: number
  /** 병합 뒤 원본을 아직 가리키는 것의 합 — 0 이어야 한다 */
  sourceRefsLeft: number
}

export function parseTeamMergeResult(data: unknown): TeamMergeSummary | null {
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  if (r.status !== 'merged') return null
  const moved = (r.moved ?? null) as Record<string, unknown> | null
  const dedup = (r.deduped ?? null) as Record<string, unknown> | null
  const folders = (r.folders ?? null) as Record<string, unknown> | null
  const left = parseTeamRefCounts(r.source_references)
  if (!moved || !dedup || !folders || !left) return null
  const m = {
    itemOwners: count(moved.item_owners), memberTeams: count(moved.project_member_teams), areaTeams: count(moved.area_teams),
    minutes: count(moved.minutes), invites: count(moved.invites), credentials: count(moved.credentials),
  }
  const d = { itemOwners: count(dedup.item_owners), memberTeams: count(dedup.project_member_teams), areaTeams: count(dedup.area_teams) }
  const renamed = count(folders.renamed)
  if ([...Object.values(m), ...Object.values(d), renamed].some((v) => v === null)) return null
  return {
    moved: m as TeamMergeSummary['moved'], deduped: d as TeamMergeSummary['deduped'],
    foldersRenamed: renamed as number, sourceRefsLeft: totalTeamRefs(left),
  }
}
