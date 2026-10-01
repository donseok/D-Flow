import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAdmin } from '@/lib/authz'
import { denyStatus, ERR_ANON, ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { validateProfile } from '@/lib/excel/profile'
import { parseWithProfile, linkByDepth, resolveLegacyLevelLabels } from '@/lib/excel/parseWithProfile'
import { splitLeafOwners } from '@/lib/excel/validate'
import { fetchAllByKeyset } from '@/lib/data/paging'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { ingestProject } from '@/lib/ai/ingest'
import { isUuidLike } from '@/lib/domain/agentWork'
import { compareProfiles } from '@/lib/domain/importWizard'
import type { Team } from '@/lib/domain/teams'
import { detectWorkbook } from '@/lib/excel/detect'
import { failWith, rpcFailure, type OwnTokenTable } from '@/lib/errors/dbFail'
import {
  CONFIG_MESSAGES, ConfigUnavailableError, ERR_COMMAND_REUSED, ERR_CONFIG_UNAVAILABLE, type ConfigCode, type DbErrorLike,
} from '@/lib/settings/errors'
import { getProjectConfig, type ProjectConfig } from '@/lib/settings/projectConfig'
import { validateProjectConfig } from '@/lib/settings/validateConfig'
import { writeProjectSettingsInternal } from '@/lib/settings/write'
import { ensureProjectTeams } from '@/lib/teams/register'
import { TeamsUnavailableError, projectOwnTeams, projectTeams } from '@/lib/teams/source'

/** replace 모드가 백업하지 않는 부수 효과를 명시 경고한다(B2 리뷰 이월).
 *  change_logs 는 wbs_items 의 on delete cascade 로 함께 지워지고(Q1 결정 — 백업은 트리뿐),
 *  holidays 는 replace_wbs 가 delete 하지 않고 upsert 만 한다(갱신되되 잔존 항목이 남을 수 있음). */
const REPLACE_WARNINGS = [
  '변경 이력(change_logs)은 백업에 포함되지 않으며 교체 시 함께 삭제되어 복구할 수 없습니다.',
  '휴일은 삭제되지 않고 갱신만 됩니다.',
]
/** 같은 명령 id 의 재전송이 이미 적용된 replace 를 만났다 — 이번 응답에는 백업이 없다(SP4 §4.4 #9·D50·K9) */
const DUPLICATE_REPLACE_WARNING =
  '이 실행은 이미 적용되어 있었습니다 — 교체 전 백업은 처음 응답에만 실렸습니다. 실행 전에 받은 백업 파일을 쓰세요.'

type ImportMode = 'append' | 'replace'

// 고정 문구 — DB 원문은 응답에 싣지 않는다(SP4 §4.7 — 원문은 failWith 가 로그로만)
const ERR_INPUT_MISSING = '파일/프로젝트/프로파일 누락'
const ERR_MODE = "mode는 'append' 또는 'replace' 여야 합니다"
const ERR_PROJECT_ID = '프로젝트 식별자 형식이 올바르지 않습니다'
const ERR_COMMAND_ID = '요청 번호(commandId)가 없거나 형식이 올바르지 않습니다 — 화면을 새로 고친 뒤 다시 실행하세요.'
const ERR_PROFILE_JSON = '프로파일 JSON 형식이 올바르지 않습니다'
const ERR_PROJECT_CONFIG = '프로젝트 설정을 확인할 수 없습니다.'
const ERR_PROFILE_MISMATCH =
  '저장된 엑셀 양식과 이 파일의 열 구조가 다릅니다 — 저장 양식으로 읽으면 값이 다른 열에서 읽힙니다. ' +
  '감지 결과로 가져오거나, 마법사에서 "저장된 양식 사용"을 직접 고른 뒤 실행하세요.'
const errProfileUnverifiable = (detail: string) =>
  `파일 구조를 감지하지 못해 저장된 엑셀 양식과 대조할 수 없습니다: ${detail} — 저장 양식으로 읽으려면 확인 후 다시 실행하세요.`
const ERR_LINK = '파일의 계층 구조에 오류가 있습니다 — 표시된 행을 고친 뒤 다시 실행하세요.'
const ERR_RECEIPT = '이전 실행 기록을 확인하지 못해 중단했습니다. 잠시 후 다시 시도하세요.'
const ERR_TEAMS = '팀 목록을 확인하지 못해 중단했습니다. 잠시 후 다시 시도하세요.'
const ERR_NEEDS_TEAMS = '등록되지 않은 팀이 있습니다 — 등록할지 확인한 뒤 다시 실행하세요.'
const ERR_TEAM_CODE = '팀 이름으로 쓸 수 없는 담당 팀이 있습니다 — 파일의 팀 이름을 고친 뒤 다시 실행하세요.'
const ERR_TEAM_CONVERT = '공용 팀을 이 프로젝트의 팀으로 전환하지 못해 가져오기를 멈췄습니다. 잠시 후 다시 시도하세요.'
const ERR_TEAM_REGISTER = '팀을 등록하지 못해 가져오기를 멈췄습니다. 잠시 후 다시 시도하세요.'
/** replace 백업을 읽지 못함 — 잘림·읽는 사이의 변경(count 불일치)·조회 오류 모두(SP4 D18·Q5) */
const ERR_BACKUP_FAILED = '교체 전 백업을 만들지 못해 가져오기를 멈췄습니다. 잠시 후 다시 시도하세요.'
const ERR_IMPORT = '가져오기를 처리하지 못했습니다. 잠시 후 다시 시도하세요.'

/** RPC 둘(import_wbs_cmd·convert_inherited_teams)의 자기 토큰(SP4 §4.4 #6·#8 — D45·T6). 그 밖은 rpcFailure 가 55P03(잠금 대기 상한)
 *  503 재시도·mapDbError(40P01 503)로 판정하고, 셋 다 아니면 로그 + 500 고정 문구다. 입력 토큰(IMPORT_INVALID_INPUT·
 *  TEAM_CONVERT_INVALID_INPUT·COMMAND_ID_REQUIRED — 22023)과 격리(*_ISOLATION — 25001)는 넣지 않는다: 라우트가 #1~#4 에서 먼저
 *  400 으로 거르므로 정상 경로에서 나지 않는다 */
const RPC_TOKENS: OwnTokenTable = {
  PROJECT_NOT_FOUND: { status: 404, code: 'ERR_MISSING', message: ERR_MISSING },
  IMPORT_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: ERR_DENIED },
  TEAM_CONVERT_FORBIDDEN: { status: 403, code: 'ERR_DENIED', message: ERR_DENIED },
  COMMAND_REUSED: { status: 422, code: 'COMMAND_REUSED', message: ERR_COMMAND_REUSED },
}

/** 실패 응답 하나의 꼴(SP4 §4.4 — { ok: false, code, error, retryable? }, 503 은 retryable). extra 는 그 실패의 자료(needsTeams·errors 등) */
function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, code, error: message, ...(status === 503 ? { retryable: true } : {}), ...extra }, { status })
}

/** 가드 거부 사유 → 응답 코드(상태는 denyStatus — 그 밖(권한 조회 실패)은 500) */
function guardCode(error: string): string {
  if (error === ERR_ANON) return 'ERR_ANON'
  if (error === ERR_DENIED) return 'ERR_DENIED'
  if (error === ERR_MISSING) return 'ERR_MISSING'
  return 'ERR_LOOKUP'
}

/** RPC 오류 → 자기 표·55P03·mapDbError 의 판정(rpcFailure — 계획 P4). 셋 다 아니면 로그 + 500 고정 문구(원문은 failWith 가 로그로만) */
function rpcFail(tag: string, err: DbErrorLike, fallbackCode: string, fallback: string): NextResponse {
  const f = rpcFailure(err, RPC_TOKENS)
  if (f) {
    if (f.status >= 500) console.error(`[${tag}] ${f.token} → ${f.status}`)
    return fail(f.status, f.code, f.message)
  }
  return fail(500, fallbackCode, failWith(tag, err, fallback))
}

/** import_wbs_cmd 의 결과 — {status:'applied', mode, count, command_id} | 저장 결과 || {status:'duplicate'}(SP4 §3.3). 모양이 다르면 null */
function importOutcome(data: unknown): { kind: 'applied' | 'duplicate'; mode: ImportMode; count: number } | null {
  const r = (typeof data === 'object' && data !== null ? data : {}) as { status?: unknown; mode?: unknown; count?: unknown }
  const kind = r.status === 'applied' || r.status === 'duplicate' ? r.status : null
  const mode = r.mode === 'append' || r.mode === 'replace' ? r.mode : null
  if (kind === null || mode === null || typeof r.count !== 'number') return null
  return { kind, mode, count: r.count }
}

/** 상속 중인 활성 공용 팀 — 409 확인 문구의 목록(SP4 §4.4 #6). 상속 프로젝트의 projectTeams 가 곧 그 워크스페이스의 공용 팀이다 */
function activeCommon(teams: readonly Team[]): { code: string; name: string }[] {
  return teams.filter((t) => t.active && t.projectId === null).map((t) => ({ code: t.code, name: t.name }))
}

/**
 * 임포트 마법사 2단계 — 실제 쓰기(SP4 §4.4). 같은 명령 id 를 두 번 보내도 한 벌만 적용된다 — import_wbs_cmd 가 항목·담당·휴일·영수증을
 * 한 트랜잭션에 쓰고 같은 명령의 재전송에는 저장된 결과를 돌려준다(D17). 미등록 팀은 늘 이 프로젝트의 전용 팀으로 등록하고, 공용 팀을
 * 상속하던 프로젝트는 먼저 전환한다(D4·D54). 판정 대상 프로젝트가 본문에 있어 폼을 먼저 읽는다 — 파싱·DB 접근은 가드 통과 후에만 한다.
 */
export async function POST(req: NextRequest) {
  // #1 폼·입력 검증 — 가드보다 먼저(agent-loop 교훈: 비 UUID 를 그대로 흘리면 가드·쿼리가 엉뚱한 에러로 새어나간다)
  const form = await req.formData()
  const file = form.get('file') as File | null
  const projectId = String(form.get('projectId') ?? '')
  const profileRaw = String(form.get('profile') ?? '')
  const mode = String(form.get('mode') ?? '')
  const commandId = String(form.get('commandId') ?? '')
  const saveProfile = form.get('saveProfile') === 'true'
  const registerTeams = form.get('registerTeams') === 'true'

  if (!file || !projectId || !profileRaw) return fail(400, 'INVALID_INPUT', ERR_INPUT_MISSING)
  if (mode !== 'append' && mode !== 'replace') return fail(400, 'INVALID_INPUT', ERR_MODE)
  if (!isUuidLike(projectId)) return fail(400, 'INVALID_INPUT', ERR_PROJECT_ID)
  // 명령 id 는 마법사가 실행 의도마다 뽑는다 — 없으면 재전송을 한 벌로 묶을 수 없다
  if (!isUuidLike(commandId)) return fail(400, 'COMMAND_ID_REQUIRED', ERR_COMMAND_ID)

  // #2 가드 — 401·403·404(타 워크스페이스·미존재 — 존재 은닉), 그 밖(권한 조회 실패)은 서버 사정이라 500
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return fail(denyStatus(g.error), guardCode(g.error), g.error)

  // #3 프로파일·설정·저장 양식 대조
  let profileJson: unknown
  try {
    profileJson = JSON.parse(profileRaw)
  } catch {
    return fail(400, 'INVALID_INPUT', ERR_PROFILE_JSON)
  }
  const validated = validateProfile(profileJson)
  if (!validated.ok) return fail(400, 'INVALID_INPUT', validated.error)
  const profile = validated.profile
  const buf = await file.arrayBuffer()

  // 저장 양식 대조(Task 1b) — 서버가 최종 관문이다(fail-closed). 저장 양식으로 읽는데(명시 플래그, 또는 좌표가 저장 양식과
  // 같은 프로파일) 파일 구조가 다르면 열이 밀려 오류 없이 틀린 값이 쓰인다. 마법사가 불일치를 보여 주고 사용자가 저장 양식을
  // 직접 고른 확인 플래그가 없으면 409 로 거부한다. 조회 실패는 대조 불가라 중단한다(에러 3원칙 ②).
  // 여기서 읽은 설정 팀이 #10 양식 저장 교차 검증의 기준 한쪽이다(SP4 §4.3 — Q36).
  let cfg: ProjectConfig
  try {
    cfg = await getProjectConfig(projectId)
  } catch (e) {
    if (e instanceof ConfigUnavailableError) return fail(503, 'CONFIG_UNAVAILABLE', failWith('import/execute 설정 조회', e, ERR_PROJECT_CONFIG))
    throw e
  }
  // 손상된(invalid) 저장 양식은 inspect 가 null 로 돌려줘 클라이언트가 쓸 수 없다 — 대조 대상이 아니다(손상 경고는 inspect 가 싣는다).
  const profileState = cfg.keys['wbs.excel_profile']
  const saved = profileState.status === 'set' && profileState.value !== null ? profileState.value : null
  if (saved !== null) {
    const usingSaved = form.get('useSavedProfile') === 'true' || compareProfiles(saved, profile) === null
    const confirmed = form.get('confirmProfileMismatch') === 'true'
    if (usingSaved && !confirmed) {
      const detected = detectWorkbook(buf)
      if (!detected.ok) return fail(409, 'PROFILE_MISMATCH', errProfileUnverifiable(detected.error), { profileMismatch: null })
      const profileMismatch = compareProfiles(saved, detected.result.profile)
      if (profileMismatch) return fail(409, 'PROFILE_MISMATCH', ERR_PROFILE_MISMATCH, { profileMismatch })
    }
  }

  // #4 파싱·링크 — 팀 등록보다 먼저 통과시킨다: 검증에 실패하는 요청은 아무 부수효과도 남기지 않아야 한다(리뷰 Minor)
  const parsed = parseWithProfile(buf, profile)
  if (!parsed.ok) return fail(400, 'INVALID_INPUT', parsed.error)
  const linked = linkByDepth(parsed.rows, { legacyLevelLabels: resolveLegacyLevelLabels(profile) })
  if (!linked.ok) return fail(400, 'LINK_ERRORS', ERR_LINK, { errors: linked.errors })

  // #5 영수증 선확인 — 관문이 아니라 최적화다. 같은 명령이 이미 적용됐으면(RLS 본인 행) 팀 등록·백업을 건너뛰고 RPC 의 판정을 받는다.
  // 거짓 양성(다른 내용으로 쓴 같은 id)은 RPC 가 COMMAND_REUSED, 거짓 음성(동시 재전송)은 RPC 가 duplicate 로 판정한다.
  const sb = await createServerClient()
  const receipt = await sb.from('command_receipts').select('command_id')
    .eq('actor', g.actor.userId).eq('command_id', commandId).eq('kind', 'wbs_import').maybeSingle()
  if (receipt.error) return fail(503, 'RECEIPT_UNAVAILABLE', failWith('import/execute 영수증 확인', receipt.error, ERR_RECEIPT))
  const replayed = receipt.data !== null

  const admin = createAdminClient()
  /** #6 이 등록을 확인한 팀(새로 만든 것 + 이미 있던 것) — #10 교차 검증 기준의 다른 한쪽 */
  const registered: string[] = []
  // #6 팀 대조·등록(D4·D54) — 트랜잭션 밖: 전환은 그 RPC 한 트랜잭션, 팀 행은 각자 커밋(실패해도 만든 팀은 남는다 — 지금과 같은 성질).
  // 같은 명령의 재시도·동시 재전송은 전환이 already, 등록이 "이미 있음 = 성공"이라 500 이 아니고 #8 에서 duplicate 를 받는다.
  if (!replayed) {
    let teamSets: [Team[], Team[]]
    try {
      teamSets = await Promise.all([projectTeams(projectId), projectOwnTeams(projectId)])
    } catch (e) {
      if (e instanceof TeamsUnavailableError) return fail(503, 'TEAMS_UNAVAILABLE', failWith('import/execute 팀 조회', e, ERR_TEAMS))
      throw e
    }
    const [teams, ownTeams] = teamSets
    // 등록 = 그 프로젝트가 쓰는 팀(비활성 포함) — 비활성 팀의 담당도 대조를 통과한다(지금과 같다)
    const known = new Set(teams.map((t) => t.code))
    const unknownTeams = [...new Set(parsed.rows.flatMap((r) => r.owners.map((o) => o.team)))].filter((t) => !known.has(t))
    if (unknownTeams.length > 0) {
      const inheritsCommon = ownTeams.length === 0
      if (!registerTeams) {
        return fail(409, 'NEEDS_TEAMS', ERR_NEEDS_TEAMS, {
          needsTeams: unknownTeams, inheritsCommon, commonTeams: inheritsCommon ? activeCommon(teams) : [],
        })
      }
      // 워크스페이스는 폼 값이 아니라 가드 결과다. 슈퍼유저는 미존재 pid 도 가드를 통과하므로 없으면 404
      const workspaceId = g.actor.projectWorkspace.get(projectId)
      if (!workspaceId) return fail(404, 'ERR_MISSING', ERR_MISSING)
      if (inheritsCommon) {
        // 첫 전용 팀이 생기면 상속하던 공용 팀이 그 프로젝트 화면에서 사라진다 — 먼저 같은 code·이름·색의 전용 팀으로 바꾸고
        // 그 프로젝트 안의 참조(담당·명단 팀·영역 팀·수락 전 초대)를 옮긴다(D54). converted·already 모두 성공이다
        const conv = await admin.rpc('convert_inherited_teams', { p_actor: g.actor.userId, p_project_id: projectId })
        if (conv.error) return rpcFail('import/execute 팀 전환', conv.error, 'TEAM_CONVERT_FAILED', ERR_TEAM_CONVERT)
        const status = (conv.data as { status?: unknown } | null)?.status
        if (status !== 'converted' && status !== 'already') {
          return fail(500, 'TEAM_CONVERT_FAILED', failWith('import/execute 팀 전환 결과', conv.data, ERR_TEAM_CONVERT))
        }
      }
      const ensured = await ensureProjectTeams({ projectId, workspaceId }, unknownTeams)
      if (!ensured.ok) {
        if (ensured.code === 'INVALID_TEAM_CODE') return fail(400, 'INVALID_TEAM_CODE', ERR_TEAM_CODE, { team: ensured.team })
        return fail(500, 'TEAM_REGISTER_FAILED', ERR_TEAM_REGISTER)
      }
      registered.push(...ensured.created, ...ensured.existing)
    }
  }

  // #7 replace 백업 — 끝까지 읽는다(D18·Q5 — 이 백업이 replace 가 지울 원본의 마지막 사본이다). 재전송(영수증 있음)은 이미 교체된
  // 트리라 읽지 않는다. 잘림·읽는 사이의 변경(count 불일치)·조회 오류는 RPC 를 부르지 않고 멈춘다
  let backup: { rows: unknown[]; generatedAt: string } | undefined
  if (mode === 'replace' && !replayed) {
    try {
      // 키셋(id 다음부터, K2) — offset 은 쪽 사이의 삽입(+삭제)에서 한 행을 두 번, 다른 한 행을 0번 읽고 행 수가 같아 통과한다
      const rows = await fetchAllByKeyset<Record<string, unknown>>('wbs_items 백업', (r) => String(r.id), (after, limit) => {
        const q = sb.from('wbs_items').select('*', { count: 'exact' }).eq('project_id', projectId)
        return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
      })
      backup = { rows, generatedAt: new Date().toISOString() }
    } catch (e) {
      return fail(500, 'BACKUP_FAILED', failWith('import/execute replace 백업', e, ERR_BACKUP_FAILED))
    }
  }

  // #8 가져오기 — 항목·담당·휴일·영수증이 한 트랜잭션(D17). p_actor 는 가드 결과(D51), RPC 가 행위자 등급을 다시 판정한다
  const { data, error } = await admin.rpc('import_wbs_cmd', {
    p_actor: g.actor.userId, p_project_id: projectId, p_mode: mode, p_items: splitLeafOwners(linked.items),
    p_holidays: parsed.holidays, p_command_id: commandId,
  })
  if (error) return rpcFail('import/execute 가져오기', error, 'IMPORT_FAILED', ERR_IMPORT)
  const outcome = importOutcome(data)
  if (!outcome) return fail(500, 'IMPORT_FAILED', failWith('import/execute 가져오기 결과', data, ERR_IMPORT))

  // #9 결과 종류 — duplicate 는 저장된 결과(건수·모드)다. 백업은 싣지 않는다(이번에 읽었어도 이미 교체된 트리다 — D50·K9)
  const duplicate = outcome.kind === 'duplicate'
  if (duplicate) backup = undefined
  const warnings = outcome.mode === 'replace' ? (duplicate ? [DUPLICATE_REPLACE_WARNING] : REPLACE_WARNINGS) : []

  // #10 양식 저장(W5, 설정의 별도 명령) — 중복이어도 요청이면 다시 돈다(같은 값이면 changed: 0). 실패해도 가져오기는 성공이고 사유를
  // 응답의 profileSave 경고로 싣는다(로그만 남기고 삼키지 않는다 — 3원칙 ①). 저장 전 교차 검증(양식의 팀 열 ⊆ 프로젝트 팀 —
  // SP4 §4.3)의 기준은 #3 의 설정 팀(활성) ∪ #6 의 등록 결과다 — 설정을 다시 읽으면 요청 범위 캐시가 방금 등록한 팀을 빼
  // 미등록 팀이 든 첫 가져오기의 양식 저장이 늘 실패한다(Q36).
  let profileSaved = false
  let profileSave: { ok: false; code: string; error: string } | undefined
  if (saveProfile) {
    const teamCodes = [...new Set([...cfg.teams.filter((t) => t.active).map((t) => t.code), ...registered])]
    const checked = validateProjectConfig({ 'wbs.excel_profile': profile }, { treeMaxDepth: null, teamCodes, allowed: [], prevEnabled: null })
    if (!checked.ok) {
      console.error('[import/execute] 양식 저장 교차 검증 실패:', checked.fieldErrors)
      profileSave = { ok: false, code: 'CONFIG_INVALID', error: CONFIG_MESSAGES.CONFIG_INVALID }
    } else {
      // 표에 없는 DB 오류는 throw 한다 — 가져오기는 이미 끝났으므로 500 으로 바꾸지 않고 같은 경고로 싣는다(원문은 failWith 가 로그로)
      const w = await writeProjectSettingsInternal(admin, projectId, { set: { 'wbs.excel_profile': profile } }, g.actor.userId)
        .catch((e: unknown) => ({ ok: false as const, code: 'CONFIG_UNAVAILABLE' as const, error: failWith('import/execute 양식 저장', e, ERR_CONFIG_UNAVAILABLE) }))
      if (w.ok) profileSaved = true
      else {
        console.error('[import/execute] 프로파일 저장 실패:', w.code, w.error)
        profileSave = { ok: false, code: w.code, error: Object.hasOwn(CONFIG_MESSAGES, w.code) ? CONFIG_MESSAGES[w.code as ConfigCode] : ERR_CONFIG_UNAVAILABLE }
      }
    }
  }

  // #11 진척 스냅샷(같은 날 upsert)·색인 — 결과 종류와 무관하게 늘 돈다(Q40: 둘 다 멱등이고, 첫 응답이 커밋 뒤·색인 전에 끊긴
  // 재전송에서도 색인이 빠지지 않는다). 색인은 베스트에포트(임베딩 키 없으면 자동 skip).
  await recordProgressSnapshot(projectId)
  let reindexed = 0
  try {
    reindexed = (await ingestProject(projectId)).count
  } catch (e) {
    console.error('[assistant] 임포트 후 색인 실패(무시):', e)
  }

  return NextResponse.json({
    ok: true,
    kind: outcome.kind,
    commandId,
    count: outcome.count,
    mode: outcome.mode,
    reindexed,
    ...(backup ? { backup } : {}),
    profileSaved,
    ...(profileSave ? { profileSave } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  })
}
