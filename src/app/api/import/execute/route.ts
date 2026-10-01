import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAdmin, requireWorkspaceAdmin } from '@/lib/authz'
import { denyStatus, ERR_MISSING } from '@/lib/authz/errors'
import { validateProfile } from '@/lib/excel/profile'
import { parseWithProfile, linkByDepth, resolveLegacyLevelLabels } from '@/lib/excel/parseWithProfile'
import { splitLeafOwners } from '@/lib/excel/validate'
import { projectTeamRowsSync, teamsForProjectSync } from '@/lib/teams/master'
import { addTeam } from '@/app/actions/teams'
import { addProjectTeam } from '@/app/actions/projectTeams'
import { fetchAllPages } from '@/lib/data/paging'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { ingestProject } from '@/lib/ai/ingest'
import { isUuidLike } from '@/lib/domain/agentWork'
import { compareProfiles } from '@/lib/domain/importWizard'
import { detectWorkbook } from '@/lib/excel/detect'
import { CONFIG_MESSAGES, ConfigUnavailableError, ERR_CONFIG_UNAVAILABLE, type ConfigCode } from '@/lib/settings/errors'
import { getProjectConfig, type ProjectConfig } from '@/lib/settings/projectConfig'
import { writeProjectSettingsInternal } from '@/lib/settings/write'

/** replace 모드가 백업하지 않는 부수 효과를 명시 경고한다(B2 리뷰 이월).
 *  change_logs 는 wbs_items 의 on delete cascade 로 함께 지워지고(Q1 결정 — 백업은 트리뿐),
 *  holidays 는 replace_wbs 가 delete 하지 않고 upsert 만 한다(갱신되되 잔존 항목이 남을 수 있음). */
const REPLACE_WARNINGS = [
  '변경 이력(change_logs)은 백업에 포함되지 않으며 교체 시 함께 삭제되어 복구할 수 없습니다.',
  '휴일은 삭제되지 않고 갱신만 됩니다.',
]

type ImportMode = 'append' | 'replace'

const ERR_PROFILE_MISMATCH =
  '저장된 엑셀 양식과 이 파일의 열 구조가 다릅니다 — 저장 양식으로 읽으면 값이 다른 열에서 읽힙니다. ' +
  '감지 결과로 가져오거나, 마법사에서 "저장된 양식 사용"을 직접 고른 뒤 실행하세요.'
const errProfileUnverifiable = (detail: string) =>
  `파일 구조를 감지하지 못해 저장된 엑셀 양식과 대조할 수 없습니다: ${detail} — 저장 양식으로 읽으려면 확인 후 다시 실행하세요.`
/** replace 백업을 읽지 못함 — 잘림·읽는 사이의 변경(count 불일치)·조회 오류 모두. 원인은 로그로만(에러 3원칙). */
const ERR_BACKUP_FAILED = '교체 전 백업을 만들지 못해 가져오기를 멈췄습니다. 잠시 후 다시 시도하세요.'

/**
 * 임포트 마법사 2단계 — 실제 쓰기(§6.6). append 는 기존 import_wbs 와 동일하게 삽입만,
 * replace 는 백업 선행 후 전체 교체(§6.6-2). 팀 부트스트랩(§10.3)은 이 라우트가 유일한 진입점이다.
 * 판정 대상 프로젝트가 본문에 있어 폼을 먼저 읽는다 — 파싱·DB 접근은 가드 통과 후에만 한다.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File | null
  const projectId = String(form.get('projectId') ?? '')
  const profileRaw = String(form.get('profile') ?? '')
  const mode = String(form.get('mode') ?? '')
  const saveProfile = form.get('saveProfile') === 'true'
  const registerTeams = form.get('registerTeams') === 'true'

  if (!file || !projectId || !profileRaw) {
    return NextResponse.json({ error: '파일/프로젝트/프로파일 누락' }, { status: 400 })
  }
  if (mode !== 'append' && mode !== 'replace') {
    return NextResponse.json({ error: "mode는 'append' 또는 'replace' 여야 합니다" }, { status: 400 })
  }
  // agent-loop 교훈 — 비 UUID 를 그대로 흘리면 가드·쿼리가 엉뚱한 에러로 새어나간다. 가드보다 먼저 막는다.
  if (!isUuidLike(projectId)) {
    return NextResponse.json({ error: '프로젝트 식별자 형식이 올바르지 않습니다' }, { status: 400 })
  }

  const g = await requireProjectAdmin(projectId)
  // 가드 실패 → 401·403·404(타 워크스페이스·미존재 — 존재 은닉), 그 밖(권한 조회 실패)은 서버 사정이라 500(재시도 가능).
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: denyStatus(g.error) })

  let profileJson: unknown
  try {
    profileJson = JSON.parse(profileRaw)
  } catch {
    return NextResponse.json({ error: '프로파일 JSON 형식이 올바르지 않습니다' }, { status: 400 })
  }
  const validated = validateProfile(profileJson)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
  const profile = validated.profile
  const buf = await file.arrayBuffer()

  // 저장 양식 대조(Task 1b) — 서버가 최종 관문이다(fail-closed). 저장 양식으로 읽는데(명시 플래그, 또는 좌표가 저장 양식과
  // 같은 프로파일) 파일 구조가 다르면 열이 밀려 오류 없이 틀린 값이 쓰인다. 마법사가 불일치를 보여 주고 사용자가 저장 양식을
  // 직접 고른 확인 플래그가 없으면 409 로 거부한다. 조회 실패는 대조 불가라 중단한다(에러 3원칙 ②).
  let cfg: ProjectConfig
  try { cfg = await getProjectConfig(projectId) } catch (e) {
    // 본문은 고정 문구 — PostgREST 사유(e.message)는 서버 로그에만 남긴다.
    if (e instanceof ConfigUnavailableError) { console.error('[import/execute] 프로젝트 설정 조회 실패 — 저장 양식 대조 불가, 중단:', e.message); return NextResponse.json({ error: '프로젝트 설정을 확인할 수 없습니다.' }, { status: 503 }) }
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
      if (!detected.ok) {
        return NextResponse.json(
          { code: 'PROFILE_MISMATCH', profileMismatch: null, error: errProfileUnverifiable(detected.error) }, { status: 409 })
      }
      const profileMismatch = compareProfiles(saved, detected.result.profile)
      if (profileMismatch) {
        return NextResponse.json({ code: 'PROFILE_MISMATCH', profileMismatch, error: ERR_PROFILE_MISMATCH }, { status: 409 })
      }
    }
  }

  const parsed = parseWithProfile(buf, profile)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 구조 검증(linkByDepth) 을 팀 부트스트랩보다 먼저 통과시킨다(리뷰 Minor). 원래 순서는 팀 등록이
  // 먼저라 링킹이 400 으로 실패해도 전역 팀 마스터에 이미 등록된 팀이 남는 부수효과가 있었다 — 검증에
  // 실패하는 요청은 아무 부수효과도 남기지 않아야 한다.
  const linked = linkByDepth(parsed.rows, { legacyLevelLabels: resolveLegacyLevelLabels(profile) })
  if (!linked.ok) return NextResponse.json({ errors: linked.errors }, { status: 400 })

  // 팀 마스터 대조(§10.3) — 대조 기준도 등록 스코프도 프로젝트 팀 정의 여부를 따른다(0071).
  const projectDefined = projectTeamRowsSync(projectId).length > 0
  const registered = new Set(teamsForProjectSync(projectId).map(t => t.code))
  const unknownTeams = [...new Set(parsed.rows.flatMap(r => r.owners.map(o => o.team)))]
    .filter(t => !registered.has(t))

  if (unknownTeams.length > 0) {
    if (!registerTeams) {
      return NextResponse.json({ needsTeams: unknownTeams, scope: projectDefined ? 'project' : 'global' }, { status: 409 })
    }
    if (projectDefined) {
      // 프로젝트 팀으로 등록 — 라우트 상단 가드(관리자)로 충분, 시드 폴더 없음(addProjectTeam 계약).
      for (const team of unknownTeams) {
        const added = await addProjectTeam(projectId, team)
        if (!added.ok) {
          return NextResponse.json({ error: `팀 등록 실패: ${team} — ${added.error}` }, { status: 500 })
        }
      }
    } else {
      // 공용 팀 상속 프로젝트 — 공용 팀 등록은 그 프로젝트가 속한 워크스페이스의 관리자만(SP2 §4.1).
      // 상단 가드를 통과한 비슈퍼유저라면 projectWorkspace 에 키가 있다. 슈퍼유저는 미존재 pid 도 통과하므로 없으면 404.
      const workspaceId = g.actor.projectWorkspace.get(projectId) ?? null
      const wa = await requireWorkspaceAdmin(workspaceId)
      if (!wa.ok) {
        const status = denyStatus(wa.error)
        return NextResponse.json({ error: status === 403 ? '팀 등록은 워크스페이스 관리자 권한' : wa.error }, { status })
      }
      if (!workspaceId) return NextResponse.json({ error: ERR_MISSING }, { status: 404 })
      for (const team of unknownTeams) {
        const added = await addTeam(workspaceId, team)
        if (!added.ok) {
          return NextResponse.json({ error: `팀 등록 실패: ${team} — ${added.error}` }, { status: 500 })
        }
      }
    }
  }

  const items = splitLeafOwners(linked.items)

  const sb = await createServerClient()
  let count: number
  let backup: { rows: unknown[]; generatedAt: string } | undefined
  const warnings: string[] = []

  if (mode === 'replace') {
    // 백업 먼저(§6.6-2, Q1: wbs_items 전 컬럼만 — change_logs 는 대상 아님). 실패 시 RPC 를 호출하지 않고 중단한다.
    // 끝까지 읽는다(SP4 D18·Q5) — 한 응답은 max_rows(1000)에서 조용히 잘리는데 이 백업이 바로 뒤 replace 가 지울 원본의 유일한 사본이다.
    // 잘림·읽는 사이의 변경(count 불일치)·조회 오류는 모두 중단이다 — 원문은 로그로만, 응답은 고정 문구.
    let backupRows: Record<string, unknown>[]
    try {
      backupRows = await fetchAllPages<Record<string, unknown>>('wbs_items 백업', (from, to) => sb
        .from('wbs_items').select('*', { count: 'exact' }).eq('project_id', projectId).order('id').range(from, to))
    } catch (e) {
      console.error('[import/execute] replace 백업 읽기 실패 — RPC 미호출:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: ERR_BACKUP_FAILED }, { status: 500 })
    }
    backup = { rows: backupRows, generatedAt: new Date().toISOString() }
    warnings.push(...REPLACE_WARNINGS)

    const { data, error } = await sb.rpc('replace_wbs', {
      p_project_id: projectId, p_items: items, p_holidays: parsed.holidays,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    count = typeof data === 'number' ? data : items.length
  } else {
    const { data, error } = await sb.rpc('import_wbs', {
      p_project_id: projectId, p_items: items, p_holidays: parsed.holidays,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    count = typeof data === 'number' ? data : items.length
  }

  // 프로파일 저장(W5) — 서버 내부 쓰기 한 함수(parse·revision CAS·이력). 실패해도 가져오기는 성공이지만 사유를 응답에 싣는다
  // (로그만 남기고 삼키지 않는다 — 3원칙 ①). 응답에는 코드의 고정 문구만 — 원인(DB 원문 포함)은 로그에만.
  let profileSaved = false
  let profileSave: { ok: false; code: string; error: string } | undefined
  if (saveProfile) {
    const admin = createAdminClient()
    // 표에 없는 DB 오류는 throw 한다 — 가져오기는 이미 끝났으므로 500 으로 바꾸지 않고 같은 경고로 싣는다.
    const w = await writeProjectSettingsInternal(admin, projectId, { set: { 'wbs.excel_profile': profile } }, g.actor.userId)
      .catch((e: unknown) => ({ ok: false as const, code: 'CONFIG_UNAVAILABLE' as const, error: e instanceof Error ? e.message : String(e) }))
    if (w.ok) profileSaved = true
    else {
      console.error('[import/execute] 프로파일 저장 실패:', w.code, w.error)
      profileSave = { ok: false, code: w.code, error: Object.hasOwn(CONFIG_MESSAGES, w.code) ? CONFIG_MESSAGES[w.code as ConfigCode] : ERR_CONFIG_UNAVAILABLE }
    }
  }

  // 임포트는 실적·계획 전면 교체(또는 신규 반영) — 즉시 스냅샷 기록(라우트라 await로 충분).
  await recordProgressSnapshot(projectId)

  // 임포트 성공 후 AI 어시스턴트 의미검색 색인 갱신(베스트에포트 — 임베딩 키 없으면 자동 skip).
  let reindexed = 0
  try {
    reindexed = (await ingestProject(projectId)).count
  } catch (e) {
    console.error('[assistant] 임포트 후 색인 실패(무시):', e)
  }

  return NextResponse.json({
    ok: true,
    count,
    mode: mode as ImportMode,
    reindexed,
    ...(backup ? { backup } : {}),
    profileSaved,
    ...(profileSave ? { profileSave } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  })
}
