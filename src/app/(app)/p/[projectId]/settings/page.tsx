import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Upload, CalendarDays, Settings, Shield, ListTree, Info, RefreshCw, Lock, Sparkles, Cpu, ArrowUpRight, Users, Bot, LayoutList, History, Paperclip, FolderInput } from 'lucide-react'
import { listSettingsHistory } from '@/app/actions/settings'
import { SettingsHistoryList } from '@/components/settings/SettingsHistoryList'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { ProjectSetupChecklist } from '@/components/settings/ProjectSetupChecklist'
import { loadProjectSetupSteps } from '@/lib/data/projectSetup'
import { listProjects } from '@/app/actions/project'
import { getLlmConfig } from '@/app/actions/llmConfig'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { projectOwnTeams, projectTeams, workspaceTeams } from '@/lib/teams/source'
import { areaTeamOptions } from '@/lib/domain/areas'
import { ProjectTeamsManager } from '@/components/settings/ProjectTeamsManager'
import { ProjectAreasManager } from '@/components/settings/ProjectAreasManager'
import { CustomFieldsSettings } from '@/components/settings/CustomFieldsSettings'
import { FIELD_ENTITIES, type FieldEntity, type FieldDef } from '@/lib/domain/customFields'
import { IssuePolicyEditor } from '@/components/settings/IssuePolicyEditor'
import { AttachmentPolicyEditor } from '@/components/settings/AttachmentPolicyEditor'
import { MinutesAutoFileEditor } from '@/components/settings/MinutesAutoFileEditor'
import { FormTemplatesManager, type FormKindState } from '@/components/settings/FormTemplatesManager'
import { FORM_SETTING_MODULE } from '@/lib/settings/defs/forms'
import type { FormKind } from '@/lib/report/engine/types'
import { VocabEditor } from '@/components/settings/VocabEditor'
import type { VocabEntry, VocabKey } from '@/lib/settings/vocab'
import type { AttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import { moduleState, requireModule } from '@/lib/modules/gate'
import { issueCodeYear, type IdPolicy } from '@/lib/issues/idPolicy'
import type { IssueAnalysisSetting } from '@/lib/settings/defs/project'
import { LevelSettingsManager } from '@/components/settings/LevelSettingsManager'
import { ExtraAxisLabelEditor } from '@/components/settings/ExtraAxisLabelEditor'
import { MilestoneKeywordsEditor } from '@/components/settings/MilestoneKeywordsEditor'
import { StageCreditSlider } from '@/components/settings/StageCreditSlider'
import type { ProjectSettingValue } from '@/lib/settings/registry'
import { StageLabelsEditor } from '@/components/settings/StageLabelsEditor'
import { ApprovalStepsEditor } from '@/components/settings/ApprovalStepsEditor'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pick, pickCalendar } from '@/lib/settings/pick'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { ConfigStateNotice } from '@/components/settings/ConfigStateNotice'
import { PageHeader } from '@/components/app/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { ProjectInfoEditButton } from '@/components/settings/ProjectInfoEditButton'
import { ProjectPrivacyToggle } from '@/components/settings/ProjectPrivacyToggle'
import { ScheduleManager } from '@/components/settings/ScheduleManager'
import { ReindexButton } from '@/components/settings/ReindexButton'
import { ExportExcelButton } from '@/components/settings/ExportExcelButton'
import type { ExportLayout } from '@/components/settings/exportLayout'
import { latestKeyChange } from '@/lib/settings/history'
import { todayIn, ymdIn } from '@/lib/domain/calendar'
import { CalendarSettingsPanel } from '@/components/settings/CalendarSettingsPanel'
import { calendarFieldOf } from '@/lib/settings/calendarField'
import { createServerClient } from '@/lib/supabase/server'
import { ClearExcelProfileButton } from '@/components/settings/ClearExcelProfileButton'
import { assistantIndexStatus, type IndexStatus } from '@/lib/ai/health'
import { t, type DictKey} from '@/lib/i18n/dict'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { requireModulePage } from '@/lib/modules/pageGate'
import { ModuleToggleEditor } from '@/components/settings/ModuleToggleEditor'
import { ViewsDefaultEditor } from '@/components/settings/ViewsDefaultEditor'
import { MODULES } from '@/lib/modules/registry'
import { PROJECT_TOGGLABLE } from '@/lib/modules/defaults'
import { MODULE_LABEL_KEY } from '@/lib/modules/labels'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { manageableWorkspaceLinks } from '@/lib/settings/workspaceLinks'

const FORM_KIND_LABEL: Record<FormKind, DictKey> = {
  weekly_report_pptx: 'pages.projSettings.formKind.weekly_report_pptx', weekly_report_xlsx: 'pages.projSettings.formKind.weekly_report_xlsx',
  issue_analysis_pptx: 'pages.projSettings.formKind.issue_analysis_pptx', wbs_export_xlsx: 'pages.projSettings.formKind.wbs_export_xlsx',
}

type ProjectRow = {
  id: string
  name: string
  description?: string | null
  start_date: string | null
  end_date: string | null
  base_date?: string | null
  created_at?: string | null
  is_private?: boolean | null
}

/** AI 어시스턴트 색인 신선도 → 배지 라벨/색상. 무신호 실패(키 미설정·마이그레이션 미적용·stale)를 가시화. */
function assistantBadge(s: IndexStatus): { label: string; cls: string } {
  switch (s.freshness) {
    case 'fresh':
      return { label: `${t('settings.badgeFresh')} · ${s.indexed}${t('settings.badgeFreshUnit')}`, cls: 'bg-success-weak text-success' }
    case 'stale':
      return { label: t('settings.badgeStale'), cls: 'bg-pending-weak text-pending' }
    case 'schema_missing':
      return { label: t('settings.badgePreparing'), cls: 'bg-danger-weak text-danger' }
    case 'disabled':
      return { label: t('settings.badgeDisabled'), cls: 'bg-pending-weak text-pending' }
    case 'empty':
      return { label: t('settings.badgeEmpty'), cls: 'bg-pending-weak text-pending' }
    default:
      return { label: t('settings.badgeUnknown'), cls: 'bg-pending-weak text-pending' }
  }
}

/**
 * 서버 전역 LLM 설정의 현재 상태 → 배지 라벨/색상.
 * 관리자에게만 호출한다(getLlmConfig 는 관리자 게이트가 있어 비관리자에겐 error 를 돌려준다).
 * 조회가 실패하면 '환경변수 기본값'으로 추측하지 않고 '확인 불가'로 드러낸다 —
 * 실제로 '선택 안함'인 서버를 env 로 표시하면 관리자가 상태를 오판한다.
 */
async function llmBadge(): Promise<{ label: string; cls: string }> {
  const unknown = { label: t('settings.llmBadgeUnknown'), cls: 'bg-pending-weak text-pending' }
  const env = { label: t('settings.llmBadgeEnv'), cls: 'bg-action-soft text-action' }
  try {
    const cfg = await getLlmConfig()
    if ('error' in cfg) return unknown
    if (cfg.mode === 'none') return { label: t('settings.llmBadgeNone'), cls: 'bg-pending-weak text-pending' }
    if (cfg.mode === 'profile') {
      const name = cfg.profiles.find(p => p.id === cfg.active_profile_id)?.name
      // 활성 프로필이 삭제된 dangling 상태에서 서버는 env 로 폴백한다 — 화면도 같은 값을 보여야 한다.
      return name ? { label: `${t('settings.llmBadgeProfilePrefix')}${name}`, cls: 'bg-success-weak text-success' } : env
    }
    return env
  } catch (e) {
    console.error('[settings] LLM 설정 조회 실패 — 배지만 degrade:', e)
    return unknown
  }
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3.5 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-32 shrink-0 text-meta font-semibold text-fg-muted sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm leading-6 text-fg">{children}</dd>
    </div>
  )
}

/** 팀 절·업무영역 편집기가 쓰는 팀(SP4 §4.2.1 — 요청 범위 원천, D19). 전용·노출 팀은 같은 요청의 설정 조회(getProjectConfig 캐시)와
 *  왕복을 나누고 공용 팀만 한 번 더 읽는다. 조회 실패는 빈 목록으로 위장하지 않는다 — 원인은 로그, 화면은 고정 문구(에러 3원칙 ①). */
async function loadTeams(projectId: string, workspaceId: string) {
  try {
    const [own, visible, common] = await Promise.all([projectOwnTeams(projectId), projectTeams(projectId), workspaceTeams(workspaceId)])
    return { ok: true as const, own, visible, common }
  } catch (e) {
    console.error('[settings] 팀 원천 조회 실패 — 팀 절·업무영역 편집기 대신 안내:', e)
    return { ok: false as const }
  }
}

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'settings')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const ERR_TEAMS_UI = t('pages.projSettings.teamsLoadFailed')
  // WBS 트리는 읽지 않는다 — 트리에서 쓰던 표시용 스탯(과업 수 KPI)을 머리 교체(SP3b UI-3 — PageHeader)와 함께 지웠다.
  // 날짜 예외는 설정 해석기(pc.cfg.holidays)가 읽는다.
  const [projects, actor] = await Promise.all([
    listProjects(),
    getActorForView(),
  ])
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  const isAdmin = isProjectAdmin(actor, projectId)
  // 설정은 프로젝트 관리자 전용(2026-08-20 결정) — 사이드바 숨김과 같은 판정(isProjectAdmin).
  // actor null(권한 조회 실패 포함)도 거부다 — fail-closed.
  if (!isAdmin) redirect(`/p/${projectId}/dashboard`)
  const workspaceId = actor?.projectWorkspace.get(projectId)
  const workspaceLink = workspaceId ? (await manageableWorkspaceLinks(actor, workspaceId))[0] : null
  const isSuperuser = actor?.isSuperuser === true
  const canMutate = isAdmin
  // 위 Promise.all 에 합류시키지 않는다 — 슈퍼유저에게만 필요한 부가 정보이고,
  // 이 조회의 실패가 페이지 본체(임포트·일정 등)를 막으면 안 된다(배지 degrade 로 흡수).
  // 권한·초대 관리는 팀 구성 페이지로 이동했다(2026-08-20 화면 통합).
  const llm = isSuperuser ? await llmBadge() : null
  // 단계·크레딧·양식 편집의 초기값 — 조회 실패면 세 편집기 대신 오류 상태 하나를 그린다(잘못된 초기값으로 저장하면 설정을 덮는다).
  // 나머지 절(팀·영역·일정·색인)은 그대로 그린다.
  const pc = await loadProjectConfigForPage(projectId)
  // 팀 원천(D19) — 해석기와 같은 조회라 설정 조회가 실패하면 팀도 읽을 수 없다. 그때는 머리의 오류 상태와 팀 절의 안내만 그린다
  const teams = pc.ok ? await loadTeams(projectId, pc.cfg.workspaceId) : { ok: false as const }
  const labels = pc.ok ? pick(pc.cfg, 'core.level_labels') : null
  // 추가 축 이름 — 손상 값도 편집기를 그린다(복구 경로)
  const extraAxisState = pc.ok ? pc.cfg.keys['core.extra_axis_label'] : null
  const credits = pc.ok ? pick(pc.cfg, 'workflow.stage_credits') : null
  // 크레딧 정책(SP5b) — 손상이면 슬라이더는 기본 정책으로 시작하고 저장 때 서버 교차 검사가 막는다(손상 값과의 조합을 추측하지 않는다)
  const creditPolicy = pc.ok ? pick(pc.cfg, 'workflow.credit_policy') : null
  // 에이전트 관문 상태는 크레딧 편집기 안내에만 쓴다. 켜기·중지는 위의 모듈 편집기가 맡는다.
  const agentsGate = await requireModule({ projectId }, 'agents')
  const agentsOn = agentsGate.ok
  // 작업 계획 기본 보기 편집기(views.default)의 보드 항목 — 칸반이 effective 일 때만 고를 수 있다(D43). 저장 때 서버가 다시 판정한다
  const kanbanOn = (await requireModule({ projectId }, 'kanban')).ok
  let workspaceModules: Awaited<ReturnType<typeof getWorkspaceConfig>> | null = null
  let workspaceModulesError: string | null = null
  if (pc.ok) {
    try { workspaceModules = await getWorkspaceConfig(pc.cfg.workspaceId) }
    catch (error) { console.error('[settings] 모듈 허용 목록 조회 실패:', error); workspaceModulesError = t('pages.projSettings.wsModulesLoadFailed') }
  }
  // 저장된 양식이 있거나 손상이면 비우기 버튼 — 손상된 양식을 푸는 것이 이 버튼의 원래 목적이다.
  const profileState = pc.ok ? pc.cfg.keys['wbs.excel_profile'] : null
  const hasProfile = profileState !== null && (profileState.status === 'invalid' || (profileState.status === 'set' && profileState.value !== null))
  // 내보내기 표기(SP4 D48) — 저장 양식이 있으면 그 키의 최신 저장 날짜, 없으면 표준. 손상·설정 조회 실패면 표기하지 않는다(모르는 것을
  // 말하지 않는다 — 손상은 아래 '저장된 양식 비우기'가 안내한다). 이력 조회 실패는 날짜 미상 + 로그(표준으로 위장하지 않는다).
  // 프로젝트 달력(이력 시각·저장 날짜의 tz). 손상이면 이력 칸에만 사유를 그린다 — 달력을 고치는 화면이 이 페이지라 전체를 막지 않는다(계획 D-21a)
  const historyCal = pc.ok ? pickCalendar(pc.cfg) : null
  let exportLayout: ExportLayout | null = null
  if (profileState?.status === 'set' && profileState.value !== null) {
    const h = await latestKeyChange(await createServerClient(), { projectId }, 'wbs.excel_profile')
    if (!h.ok) console.error('[settings] 저장 양식 이력 조회 실패:', h.error)
    // 출처 — 엑셀 양식을 설정 내부 쓰기('internal')로 저장하는 길은 가져오기 마법사뿐이다(api/import/execute #10). 복사·이행·모름이면 출처를 적지 않는다
    // 저장 날짜 = 프로젝트 tz 의 날짜 — 달력이 손상이면 날짜 미상(null, 사유는 이력 칸이 보인다)
    const savedTz = historyCal?.ok ? historyCal.calendar.timezone : null
    exportLayout = { kind: 'saved', savedAt: h.ok && h.changedAt && savedTz ? ymdIn(savedTz, new Date(h.changedAt)) : null, viaWizard: h.ok && h.source === 'internal' }
  } else if (profileState !== null && profileState.status !== 'invalid') {
    exportLayout = { kind: 'standard' }
  }
  // 세 편집기의 저장 CAS(expectedRevision). 조회 실패면 편집기를 그리지 않으므로 쓰이지 않는다 — -1 은 액션이 형식 오류로 거부한다.
  const revision = pc.ok ? pc.cfg.revision : -1
  const issuesGate = pc.ok ? await requireModule({ projectId }, 'issues') : { ok: false as const, error: 'unavailable' }
  const analysisState = pc.ok ? await moduleState({ projectId }, 'issue_analysis') : 'unknown'
  const issuePolicy = pc.ok ? pick(pc.cfg, 'issues.id_policy') : null
  const issueAnalysis = pc.ok ? pick(pc.cfg, 'issues.analysis') : null
  // 회의록 첨부 정책(SP5 B3 과제9) — 회의록은 워크스페이스 모듈이라 워크스페이스로 관문을 본다. 손상 값도 편집기를 그린다(복구 경로).
  const minutesGate = pc.ok ? await requireModule({ workspaceId: pc.cfg.workspaceId }, 'minutes') : { ok: false as const, error: 'unavailable' }
  const attachmentPolicy = pc.ok ? pick(pc.cfg, 'minutes.attachments') : null
  // 외부 업로드의 폴더 자동 편철(minutes.auto_file_by_path) — 같은 '회의록' 범주. 손상 값도 스위치를 그린다(다시 저장해 고친다)
  const autoFile = pc.ok ? pick(pc.cfg, 'minutes.auto_file_by_path') : null
  // 용어·분류(SP5 B4 묶음4) — 모듈이 켜진 키만. 손상 값도 편집기를 그린다(복구 경로). 판정 실패(unknown)는 그리지 않는다(fail-closed)
  const [attendanceState, meetingsState] = pc.ok
    ? await Promise.all([moduleState({ projectId }, 'attendance'), moduleState({ projectId }, 'meetings')])
    : ['unknown', 'unknown'] as const
  const vocabKeys: VocabKey[] = pc.ok ? [
    ...(attendanceState === 'on' ? ['attendance.types' as const] : []),
    ...(meetingsState === 'on' ? ['meetings.categories' as const] : []),
    ...(issuesGate.ok ? ['issues.severities' as const] : []),
    ...(issuesGate.ok && analysisState === 'on' ? ['issues.sources' as const, 'issues.cause_categories' as const] : []),
  ] : []
  const fieldModules = pc.ok ? await Promise.all([moduleState({ projectId }, 'wbs'), moduleState({ projectId }, 'issues'), moduleState({ projectId }, 'weekly')]) : ['unknown', 'unknown', 'unknown'] as const
  const fieldStates = pc.ok ? Object.fromEntries(FIELD_ENTITIES.map((entity, i) => {
    const st = pc.cfg.keys[`fields.${entity}`]
    return [entity, { enabled: fieldModules[i] === 'on', value: st.status === 'set' || st.status === 'default' ? st.value : null,
      error: fieldModules[i] === 'unknown' ? t('pages.projSettings.moduleStateUnknown') : st.status === 'invalid' ? st.error : undefined }]
  })) as Record<FieldEntity, { value: readonly FieldDef[] | null; error?: string; enabled: boolean }> : null
  const timezoneState = pc.ok ? pc.cfg.keys['calendar.timezone'] : null
  const issueYear = timezoneState && (timezoneState.status === 'set' || timezoneState.status === 'default')
    ? issueCodeYear(timezoneState.value, new Date()) : null
  // 달력 편집기(스펙 §5.1 A) — 달력 키가 손상이어도 편집기는 그린다(복구 경로). '오늘'(예정 전환·현재 규칙)은 tz 가 유효할 때만
  const calendarFields = pc.ok ? {
    timezone: calendarFieldOf(pc.cfg.keys['calendar.timezone']),
    workingDays: calendarFieldOf(pc.cfg.keys['calendar.working_days']),
    weekStart: calendarFieldOf(pc.cfg.keys['calendar.week_start']),
  } : null
  const calendarToday = calendarFields?.timezone.value ? todayIn(calendarFields.timezone.value, new Date()) : null

  // 양식(SP6) — 모듈이 켜진 종류만. 목록 조회가 실패하면 섹션을 그리지 않는다(없음으로 위장 금지).
  let formKinds: FormKindState[] | null = null
  // 양식 섹션은 부가 화면이다 — 조회 중 예외도 설정 페이지 전체를 막지 않고 섹션만 그리지 않는다(로그는 남긴다).
  try {
    if (isAdmin && pc.ok) {
      const kindIds = Object.keys(FORM_SETTING_MODULE) as FormKind[]
      const states = await Promise.all(kindIds.map((k) => moduleState({ projectId }, FORM_SETTING_MODULE[k])))
      const enabled = kindIds.filter((_, i) => states[i] === 'on')
      if (enabled.length) {
        const { data: rows, error: rowsErr } = await (await createServerClient()).from('form_templates')
          .select('id, form_kind, file_name, size_bytes, version, active, created_at, placeholders')
          .eq('project_id', projectId).in('form_kind', enabled).order('version', { ascending: false })
        if (rowsErr) console.error('[settings] 양식 목록 조회 실패:', rowsErr.message)
        else {
          formKinds = enabled.map((kind) => {
            const st = pc.cfg.keys[`forms.${kind}` as const]
            const ok = st.status === 'set' || st.status === 'default'
            return {
              kind, label: t(FORM_KIND_LABEL[kind]),
              setting: ok ? st.value as FormKindState['setting'] : null,
              templates: (rows ?? []).filter((r) => r.form_kind === kind).map((r) => {
                const issues = (r.placeholders as { issues?: { severity?: string }[] } | null)?.issues ?? []
                return {
                  id: r.id as string, version: r.version as number, fileName: r.file_name as string, sizeBytes: r.size_bytes as number,
                  active: !!r.active, createdAt: r.created_at as string,
                  errors: issues.filter((i) => i.severity === 'error').length, warnings: issues.filter((i) => i.severity === 'warning').length,
                }
              }),
            }
          })
        }
      }
    }
  } catch (e) {
    console.error('[settings] 양식 섹션 로드 실패:', e instanceof Error ? e.message : String(e))
    formKinds = null
  }

  // 준비 체크리스트(첫 사용 흐름)의 단계 상태 — 이 화면은 위에서 프로젝트 관리자임을 확인했다(로더의 전제). 설정은 이미 읽은 해석기 결과를 넘긴다.
  // 주간보고가 꺼져 있으면(판정 실패 포함 — fieldModules 의 'unknown') 업무영역 단계는 내지 않는다
  const setupSteps = pc.ok ? await loadProjectSetupSteps(pc.cfg, {
    project: project ? { name: project.name ?? null, startDate: project.start_date ?? null, endDate: project.end_date ?? null } : null,
    weeklyEnabled: fieldModules[2] === 'on',
  }) : null
  const assistantIndex = await assistantIndexStatus(projectId)
  const settingsHistory = await listSettingsHistory({ projectId })

  const scheduleLabel =
    project?.start_date || project?.end_date
      ? `${fmtDate(project?.start_date ?? null)} – ${fmtDate(project?.end_date ?? null)}`
      : t('settings.tbd')

  return (
    // 머리 하나(PageHeader — 개정 §5.9.3, SP3b 스펙 §6.4). 일정은 meta 로, 과업 수·기준일 KPI 카드는 지웠다(기준일은 '달력' 범주에 있다)
    <ProjectPageShell
      hero={<PageHeader title={t('pages.projSettings.title')}
        meta={`${project?.name ?? t('settings.projectFallback')} · ${scheduleLabel}`} />}
    >
      {/* 준비 체크리스트 — 단계의 완료는 실제 상태(setupSteps). 설정을 못 읽었으면 그리지 않는다(아래 편집기 자리의 오류 상태가 알린다) */}
      {actor && setupSteps && <ProjectSetupChecklist key={`${actor.userId}:${projectId}`} projectId={projectId} userId={actor.userId} steps={setupSteps} />}
      <SettingsShell items={[
        { id: 'project-general', label: t('pages.settingsNav.general') }, { id: 'project-modules', label: t('pages.projSettings.nav.modules') },
        ...(isAdmin ? [{ id: 'project-team', label: t('pages.projSettings.nav.team') }] : []),
        ...(isAdmin && issuesGate.ok ? [{ id: 'project-issues', label: t('pages.projSettings.nav.issues') }] : []),
        ...(isAdmin && pc.ok && minutesGate.ok ? [{ id: 'project-minutes', label: t('pages.settingsNav.minutes') }] : []),
        ...(isAdmin && vocabKeys.length ? [{ id: 'project-vocab', label: t('settings.vocab.section') }] : []),
        ...(isAdmin && formKinds ? [{ id: 'project-forms', label: t('pages.projSettings.nav.forms') }] : []),
        ...(isAdmin && pc.ok ? [{ id: 'project-fields', label: t('pages.projSettings.nav.fields') }] : []), { id: 'project-status', label: t('pages.projSettings.nav.status') },
        { id: 'project-calendar', label: t('pages.settingsNav.calendar') }, { id: 'project-history', label: t('pages.settingsNav.history') },
      ]}>
      <div className="space-y-5">
        {!pc.ok && <ConfigLoadError error={pc.error} />}
        {/* ════ 일반 — 정보·단계·공개 범위·데이터·AI ════ */}
        <div id="project-general" className="scroll-mt-24 space-y-5">
        {/* ── 기본 정보 ── */}
        <SectionCard
          searchText="project name description start date end date 프로젝트 이름 설명 기간 마일스톤 키워드"
          title={t('settings.coreInfoTitle')}
          icon={Info}
          actions={canMutate && project ? (
            <ProjectInfoEditButton
              projectId={projectId}
              name={project.name}
              description={project.description ?? null}
              startDate={project.start_date ?? null}
              endDate={project.end_date ?? null}
            />
          ) : undefined}
        >
        {workspaceLink && (
          <Link href={`/w/${encodeURIComponent(workspaceLink.slug)}/settings`} className="mb-4 inline-flex text-sm font-medium text-action hover:underline">
            {t('pages.projSettings.wsSettingsLink').replace('{name}', () => workspaceLink.name)}
          </Link>
        )}
        <dl className="-mt-1">
          <InfoRow label={t('settings.projectName')}>
            <span className="font-semibold">{project?.name ?? t('settings.unassigned')}</span>
          </InfoRow>
          <InfoRow label={t('settings.description')}>
            {project?.description?.trim() || (
              <span className="text-fg-muted">{t('settings.noDescription')}</span>
            )}
          </InfoRow>
          <InfoRow label={t('settings.startDate')}>
            <span className="tabular-nums">{project?.start_date ? fmtDate(project.start_date) : t('settings.tbd')}</span>
          </InfoRow>
          <InfoRow label={t('settings.endDate')}>
            <span className="tabular-nums">{project?.end_date ? fmtDate(project.end_date) : t('settings.tbd')}</span>
          </InfoRow>
        </dl>
        {pc.ok && <div className="mt-6 border-t border-border pt-5">
          <MilestoneKeywordsEditor projectId={projectId} revision={pc.cfg.revision}
            initial={pc.cfg.keys['core.milestone_keywords'].status === 'set' || pc.cfg.keys['core.milestone_keywords'].status === 'default' ? pc.cfg.keys['core.milestone_keywords'].value : []}
            source={pc.cfg.keys['core.milestone_keywords'].status === 'set' ? t('pages.projSettings.source.project') : t('pages.projSettings.source.product')}
            invalidReason={pc.cfg.keys['core.milestone_keywords'].status === 'invalid' ? pc.cfg.keys['core.milestone_keywords'].error : undefined} />
        </div>}
        </SectionCard>
      {/* ── WBS 단계 (관리자) — 라벨 배열이 곧 깊이. 축소 검증은 서버 액션이 한다. ── */}
        {isAdmin && labels && (
          <SectionCard
            searchText="core.level_labels 단계 깊이 WBS"
            title={t('pages.projSettings.levelsTitle')}
            icon={ListTree}
          >
            <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">
              {t('pages.projSettings.levelsDesc')}
            </p>
            {labels.ok
              ? <LevelSettingsManager projectId={projectId} levelLabels={labels.value} revision={revision} />
              : <ConfigLoadError error={labels.error} keyName={labels.key} kind={labels.kind}
                isAdmin={canMutate} settingsHref={`/p/${projectId}/settings`} />}
          </SectionCard>
        )}
      {/* ── 추가 축 이름 (관리자) — 단계 이름 곁의 '작업 구조의 이름'. 손상 값도 편집기를 그린다(복구 경로) ── */}
        {isAdmin && extraAxisState && (
          <SectionCard searchText="core.extra_axis_label 추가 축 업무 분류 WBS" title={t('settings.core.extra_axis_label.label')} icon={ListTree}>
            <ExtraAxisLabelEditor key={`axis-${revision}`} projectId={projectId} revision={revision} canEdit={canMutate}
              value={extraAxisState.status === 'set' ? extraAxisState.value : null} invalid={extraAxisState.status === 'invalid'} />
          </SectionCard>
        )}
      {/* ── 공개 범위 (슈퍼유저 전용) — 관리자에게도 열지 않는다(전역 가시성 정책은 전역 등급이 쥔다) ── */}
        {isSuperuser && (
          <SectionCard
            searchText="프로젝트 공개 범위 비공개"
            title={t('settings.privacyTitle')}
            icon={Lock}
            actions={<ProjectPrivacyToggle projectId={projectId} isPrivate={Boolean(project?.is_private)} />}
          >
            <p className="-mt-2 text-xs leading-5 text-fg-secondary">
              {t('settings.privacyDesc1')}
              <strong className="text-fg">{t('settings.privacyDescStrong')}</strong>
              {t('settings.privacyDesc2')}
            </p>
          </SectionCard>
        )}
      {/* ── WBS 데이터 가져오기 / 내보내기 ── */}
        <SectionCard
        searchText="wbs.excel_profile import export 데이터 가져오기 내보내기"
        title={t('settings.importExportTitle')}
        icon={Upload}
      >
        <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">
          {t('settings.importDesc')}
        </p>
        <Link href={`/p/${projectId}/import`} className="btn btn-primary">
          <Upload className="h-4 w-4" />
          {t('settings.openImportWizard')}
          <ArrowUpRight className="h-4 w-4" />
        </Link>

        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-fg-secondary">{t('settings.exportDesc')}</p>
          <ExportExcelButton projectId={projectId} layout={exportLayout} />
        </div>
        {/* 저장된 엑셀 양식이 있을 때만 — 손상·깊이 부족으로 내보내기가 막힌 교착을 관리자가 푼다(Task 1b).
            설정 조회 실패면 그리지 않는다 — 있는지 모르는 양식을 비우라고 권하지 않는다. */}
        {hasProfile && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-fg-secondary">{t('settings.clearExcelProfileDesc')}</p>
            <ClearExcelProfileButton projectId={projectId} revision={revision} />
          </div>
        )}
        </SectionCard>
      {/* ── AI 어시스턴트 의미검색 색인 ── */}
        <SectionCard
        searchText="ai.enabled 색인 재색인"
        title={t('settings.assistantTitle')}
        icon={Sparkles}
        actions={
          // 좁은 화면(390)에서 카드 머리 actions 는 줄어들지 않아(shrink-0) 폭을 여기서 묶고 줄바꿈한다
          <div className="flex max-w-[13rem] flex-wrap items-center justify-end gap-2 sm:max-w-none">
            <span className={`badge px-2 py-1 ${assistantBadge(assistantIndex).cls}`}>{assistantBadge(assistantIndex).label}</span>
            {/* 서버 가드(reindexProjectAction·/api/chat/reindex)가 requireProjectAdmin 이라 이 화면에 온 관리자에게 그대로 준다. */}
            <ReindexButton projectId={projectId} />
          </div>
        }
      >
        <p className="-mt-2 text-xs leading-5 text-fg-secondary">
          {t('settings.assistantDesc1')}<span className="font-medium text-pending">{t('settings.assistantDescBadge')}</span>{t('settings.assistantDesc2')}
          <br />
          <span className="text-fg-muted">
            {t('settings.assistantDesc3')}
          </span>
        </p>
        </SectionCard>
      {/* ── 서버 LLM 설정 (슈퍼유저 전용) ── */}
        {isSuperuser && llm && (
          <SectionCard
            searchText="llm ai 모델 환경변수"
            title={t('settings.llmTitle')}
            icon={Cpu}
            actions={
              <div className="flex max-w-[13rem] flex-wrap items-center justify-end gap-2 sm:max-w-none">
                <span className="badge bg-surface-subtle px-2 py-1 text-fg-secondary">{t('settings.llmGlobalBadge')}</span>
                <span className={`badge px-2 py-1 ${llm.cls}`}>{llm.label}</span>
                <Link href="/admin/llm-config" className="btn btn-ghost shrink-0">
                  <ArrowUpRight className="h-4 w-4" /> {t('settings.llmOpenAdmin')}
                </Link>
              </div>
            }
          >
            <p className="-mt-2 text-xs leading-5 text-fg-secondary">
              {t('settings.llmDesc1')}
              <br />
              <span className="text-fg-muted">{t('settings.llmDesc2')}</span>
            </p>
          </SectionCard>
        )}
        </div>

        {/* ════ 모듈·메뉴 ════ */}
        <div id="project-modules" className="scroll-mt-24 space-y-5">
        <div>
        <SectionCard searchText="modules.enabled 모듈 메뉴 views.default 작업 계획 기본 보기" title={t('pages.projSettings.nav.modules')} icon={LayoutList}>
          {pc.ok && workspaceModules ? (() => {
            const enabled = pc.cfg.keys['modules.enabled']
            const allowed = workspaceModules.keys['modules.allowed']
            const allowedIds = allowed.status === 'set' || allowed.status === 'default' ? allowed.value : []
            return <>
              {(allowed.status === 'invalid' || allowed.status === 'required_missing') &&
                <ConfigStateNotice kind={allowed.status === 'invalid' ? 'invalid' : 'required'} keyName="modules.allowed"
                  message={allowed.status === 'invalid' ? allowed.error : undefined}
                  isAdmin={Boolean(workspaceLink)} settingsHref={workspaceLink ? `/w/${encodeURIComponent(workspaceLink.slug)}/settings` : undefined} />}
              {!agentsOn && allowedIds.includes('agents') && (enabled.status === 'set' || enabled.status === 'default') && enabled.value.includes('agents') &&
                <p role="alert" className="mb-3 text-sm text-pending">{t('pages.projSettings.agentsClosed')}</p>}
              <ModuleToggleEditor projectId={projectId} revision={pc.cfg.revision}
                initialEnabled={enabled.status === 'set' || enabled.status === 'default' ? enabled.value : null}
                invalidReason={enabled.status === 'invalid' ? enabled.error : undefined}
                requiredMissing={enabled.status === 'required_missing'}
                options={MODULES.filter(m => PROJECT_TOGGLABLE.has(m.id)).map(m => ({ id: m.id, label: t(MODULE_LABEL_KEY[m.id]),
                  allowed: allowedIds.includes(m.id), available: m.envAvailable() }))} />
              {/* 작업 계획 기본 보기(views.default — SP3b UI-3 과제 7) — 같은 '모듈·메뉴' 범주 안 구역 */}
              <section aria-labelledby="project-views-default" data-settings-search="views.default 작업 계획 기본 보기 표 간트 보드" className="mt-8 border-t border-border pt-6">
                <h4 id="project-views-default" className="mb-3 text-sm font-semibold text-fg">{t('settings.views.default.label')}</h4>
                <ViewsDefaultEditor projectId={projectId} revision={pc.cfg.revision} kanbanOn={kanbanOn} labelledBy="project-views-default"
                  initial={pc.cfg.keys['views.default'].status === 'set' || pc.cfg.keys['views.default'].status === 'default' ? pc.cfg.keys['views.default'].value : null}
                  invalidReason={pc.cfg.keys['views.default'].status === 'invalid' ? pc.cfg.keys['views.default'].error : undefined} />
              </section>
            </>
          })() : workspaceModulesError ? <ConfigLoadError error={workspaceModulesError} /> : null}
        </SectionCard>
        </div>
        </div>

        {/* ════ 팀·업무영역 ════ */}
        <div id="project-team" className="scroll-mt-24 space-y-5">
      {/* ── 권한·초대는 팀 구성 페이지로 이동(2026-08-20 화면 통합) — 길 잃지 않게 이정표만 남긴다 ── */}
        {isAdmin && (
          <SectionCard
            searchText="권한 역할 멤버"
            title={t('pages.projSettings.rolesTitle')}
            icon={Shield}
          >
            <p className="-mt-2 text-xs leading-5 text-fg-secondary">
              {t('pages.projSettings.rolesDesc')}
              {' '}
              <Link href={`/p/${projectId}/members`} className="font-semibold text-action hover:underline">
                {t('pages.projSettings.openMembers')}
                <ArrowUpRight className="ml-0.5 inline h-3.5 w-3.5" aria-hidden />
              </Link>
            </p>
          </SectionCard>
        )}
      {/* ── 팀 관리 (관리자 이상) — 프로젝트 스코프 팀(0071). 전역 팀은 /admin/teams. ── */}
        {isAdmin && (
          <SectionCard
            searchText="팀 업무영역 담당"
            title={t('pages.projSettings.teamsTitle')}
            icon={Users}
          >
            <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">
              {t('pages.projSettings.teamsDesc')}
            </p>
            {teams.ok ? (
              <ProjectTeamsManager
                projectId={projectId}
                teams={teams.own.map(t => ({ id: t.id, code: t.code, name: t.name, color: t.color, sortOrder: t.sortOrder, active: t.active, progressVisible: t.progressVisible }))}
                inherited={teams.own.length === 0}
                hasGlobalTeams={teams.common.some(t => t.active)}
              />
            ) : (
              <p role="alert" className="rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{ERR_TEAMS_UI}</p>
            )}
          </SectionCard>
        )}
      {/* ── 업무영역(주간보고의 행) — kind 고정 편집기(SP4 D26). 이슈 영역은 SP5. 설정 조회가 실패하면 머리의 오류 상태 하나로 갈음한다 ── */}
        {isAdmin && pc.ok && (
          <SectionCard
            searchText="업무영역 주간보고 영역 담당 팀 weekly areas"
            title={t('pages.projSettings.areasTitle')}
            icon={ListTree}
          >
            <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">
              {t('pages.projSettings.areasDesc')}
            </p>
            {teams.ok ? (
              <ProjectAreasManager
                projectId={projectId}
                kind="weekly_section"
                areas={pc.cfg.areas.weekly_section}
                teamOptions={areaTeamOptions(teams.visible, pc.cfg.teams, pc.cfg.areas.weekly_section)}
              />
            ) : (
              <p role="alert" className="rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{ERR_TEAMS_UI}</p>
            )}
          </SectionCard>
        )}
          {isAdmin && pc.ok && issuesGate.ok && (
            <SectionCard searchText="issue areas code prefix pattern counter" title={t('settings.issueAreas.title')} icon={ListTree}>
              <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t('settings.issueAreas.desc')}</p>
              {teams.ok ? <ProjectAreasManager projectId={projectId} kind="issue_area" areas={pc.cfg.areas.issue_area} teamOptions={areaTeamOptions(teams.visible, pc.cfg.teams, pc.cfg.areas.issue_area)} /> : <p role="alert" className="text-sm text-danger">{ERR_TEAMS_UI}</p>}
            </SectionCard>
          )}
        </div>
        {isAdmin && pc.ok && issuesGate.ok && <div id="project-issues" className="scroll-mt-24 space-y-5">
          <SectionCard searchText="issues.id_policy issue code analysis policy" title={t('settings.issues.policy.title')} icon={LayoutList}>
            <p className="mb-4 text-xs leading-5 text-fg-secondary">{t('settings.issues.id_policy.desc')}</p>
            {issuePolicy?.ok && issueAnalysis?.ok && issueYear !== null ? <IssuePolicyEditor key={`${projectId}-${revision}`} projectId={projectId} policy={issuePolicy.value as IdPolicy} revision={revision} areas={pc.cfg.areas.issue_area} year={issueYear} canEdit={canMutate} analysis={issueAnalysis.value as IssueAnalysisSetting} analysisEnabled={analysisState === 'on'} /> : <ConfigStateNotice kind="unavailable" />}
          </SectionCard>
        </div>}

        {isAdmin && pc.ok && minutesGate.ok && attachmentPolicy && <div id="project-minutes" className="scroll-mt-24 space-y-5">
          <SectionCard searchText="minutes.attachments 회의록 첨부 정책 용량 개수 형식 미리보기 attachment" title={t('settings.minutes.attachments.label')} icon={Paperclip}>
            <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t('settings.minutes.attachments.desc')}</p>
            <AttachmentPolicyEditor key={`${projectId}-${revision}`} scope={{ projectId }} revision={revision} canEdit={canMutate}
              policy={attachmentPolicy.ok ? attachmentPolicy.value as AttachmentPolicy : null} invalid={!attachmentPolicy.ok} />
          </SectionCard>
          {autoFile && <SectionCard searchText="minutes.auto_file_by_path 회의록 외부 업로드 폴더 자동 정리 편철 folder path upload" title={t('settings.minutes.auto_file_by_path.label')} icon={FolderInput}>
            <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t('settings.minutes.auto_file_by_path.desc')}</p>
            <MinutesAutoFileEditor key={`${projectId}-${revision}`} projectId={projectId} revision={revision} canEdit={canMutate}
              value={autoFile.ok ? autoFile.value as boolean : null} invalid={!autoFile.ok} />
          </SectionCard>}
        </div>}

        {isAdmin && pc.ok && vocabKeys.length > 0 && <div id="project-vocab" className="scroll-mt-24 space-y-5">
          {vocabKeys.map(key => {
            const st = pc.cfg.keys[key]
            const ok = st.status === 'set' || st.status === 'default'
            return <SectionCard key={key} searchText={`${key} 용어 분류 어휘 vocabulary ${t(`settings.${key}.label` as DictKey)}`} title={t(`settings.${key}.label` as DictKey)} icon={LayoutList}>
              <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t(`settings.${key}.desc` as DictKey)}</p>
              <VocabEditor key={`${projectId}-${key}-${revision}`} projectId={projectId} vocabKey={key} revision={revision} canEdit={canMutate}
                value={ok ? (st.value as readonly VocabEntry[]) : null} invalid={!ok} />
            </SectionCard>
          })}
        </div>}

        {isAdmin && pc.ok && formKinds && <div id="project-forms" className="scroll-mt-24 space-y-5">
          <SectionCard searchText="forms 양식 템플릿 보고서 pptx xlsx 업로드 매핑 자리표시자" title={t('pages.projSettings.formsTitle')} icon={Upload}>
            <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t('pages.projSettings.formsDesc')}</p>
            <FormTemplatesManager key={`${projectId}-${revision}`} projectId={projectId} revision={revision} canEdit={canMutate} kinds={formKinds} />
          </SectionCard>
        </div>}

        {isAdmin && pc.ok && fieldStates && <div id="project-fields" className="scroll-mt-24 space-y-5">
          <SectionCard searchText="fields.wbs_item fields.issue fields.weekly_row 추가 필드 custom fields" title={t('pages.projSettings.nav.fields')} icon={LayoutList}>
            <CustomFieldsSettings key={`${projectId}-fields-${revision}`} projectId={projectId} states={fieldStates} revision={revision} canEdit={canMutate} />
          </SectionCard>
        </div>}

        {/* ════ 상태·승인 ════ */}
        <div id="project-status" className="scroll-mt-24 space-y-5">
        {/* 이슈 표시 상태(SP5b I — D1) — 이슈 모듈이 켜진 관리자만. 손상 값도 편집기를 그린다(복구 경로) */}
        {isAdmin && pc.ok && issuesGate.ok && (() => {
          const key = 'workflow.issue_statuses' as const
          const st = pc.cfg.keys[key]
          const ok = st.status === 'set' || st.status === 'default'
          return <SectionCard searchText={`${key} 이슈 상태 범주 업무 흐름 workflow status ${t('settings.workflow.issue_statuses.label')}`} title={t('settings.workflow.issue_statuses.label')} icon={LayoutList}>
            <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t('settings.workflow.issue_statuses.desc')}</p>
            <VocabEditor key={`${projectId}-${key}-${revision}`} projectId={projectId} vocabKey={key} revision={revision} canEdit={canMutate}
              value={ok ? (st.value as readonly VocabEntry[]) : null} invalid={!ok} />
          </SectionCard>
        })()}
        {/* WBS 승인 흐름(SP5b W2 — 단계 이름·승인 단계·서로 다른 승인자·선행 기준). wbs 는 core 라 모듈 관문 없음. 손상 값도 편집기를 그린다(복구 경로) */}
        {isAdmin && pc.ok && (() => {
          const st = <K extends 'workflow.wbs_stage_labels' | 'workflow.approval_steps' | 'workflow.approval_distinct_approvers' | 'workflow.predecessor_gate'>(k: K) => {
            const v = pc.cfg.keys[k]
            return v.status === 'set' || v.status === 'default' ? v.value as ProjectSettingValue<K> : null
          }
          return <SectionCard searchText={`workflow.wbs_stage_labels workflow.approval_steps workflow.approval_distinct_approvers workflow.predecessor_gate 승인 단계 선행 ${t('settings.workflow.wbsTitle')}`} title={t('settings.workflow.wbsTitle')} icon={LayoutList}>
            <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">{t('settings.workflow.wbsDesc')}</p>
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-fg">{t('settings.workflow.wbs_stage_labels.label')}</p>
                <StageLabelsEditor key={`labels-${revision}`} projectId={projectId} value={st('workflow.wbs_stage_labels')} revision={revision} canEdit={canMutate}
                  invalid={st('workflow.wbs_stage_labels') === null} />
              </div>
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-semibold text-fg">{t('settings.workflow.approval_steps.label')}</p>
                <ApprovalStepsEditor key={`steps-${revision}`} projectId={projectId} steps={st('workflow.approval_steps')} distinct={st('workflow.approval_distinct_approvers')}
                  gate={st('workflow.predecessor_gate')} revision={revision} canEdit={canMutate} />
              </div>
            </div>
          </SectionCard>
        })()}
      {/* ── 에이전트 (킬스위치) ── */}
        <SectionCard
        searchText="workflow.stage_credits 에이전트 상태 승인 크레딧"
        title={t('settings.agentTitle')}
        icon={Bot}
        actions={
          // 좁은 화면(390)에서는 칩·버튼 한 줄, 허브 링크 한 줄로 접는다 — 카드 머리 actions 는 줄어들지 않아(shrink-0) 폭을 여기서 묶는다
          <div className="flex max-w-[13rem] flex-wrap items-center justify-end gap-2 sm:max-w-none">
            {/* 위임·승인은 에이전트 허브 — 에이전트가 꺼져 있으면 허브는 404 다(사이드바 링크처럼 SP3b 전까지 남는다) */}
            <Link href={`/p/${projectId}/agents`} className="btn btn-ghost h-9 px-3 text-[13px]">{t('settings.agentHubLink')}</Link>
          </div>
        }
      >
        <p className="-mt-2 text-xs leading-5 text-fg-secondary">
          {t('settings.agentDesc1')}<span className="font-medium text-pending">{t('settings.agentDescBadge')}</span>{t('settings.agentDesc2')}
        </p>
        {/* 개발 워크플로 크레딧(스펙 2026-09-15 §5.1) — 설정 조회 실패면 그리지 않는다(잘못된 초기값으로 저장하면 표를 덮는다). */}
        {credits && (
          <div className="mt-4 space-y-1 border-t border-border pt-4">
            <p className="text-sm font-semibold text-fg">{t('settings.creditsTitle')}</p>
            <p className="text-xs leading-5 text-fg-secondary">{t('settings.creditsDesc')}</p>
            {/* agents 가 꺼져도 크레딧 편집기는 남는다 — 다시 켤 때 쓸 값이다(스펙 §4.4, 정본 §3.3.1) */}
            {!agentsOn && <p className="text-xs leading-5 text-pending">{t('settings.agentsModuleOff')}</p>}
            {credits.ok
              ? <StageCreditSlider projectId={projectId} initial={credits.value} initialPolicy={creditPolicy?.ok ? creditPolicy.value : null} editable={canMutate} revision={revision} />
              : <ConfigLoadError error={credits.error} keyName={credits.key} kind={credits.kind}
                isAdmin={canMutate} settingsHref={`/p/${projectId}/settings`} />}
          </div>
        )}
        </SectionCard>
      {/* ── 프로젝트 상태 관리 (시각 전용) ── */}
        <SectionCard searchText="workflow.stage_credits 상태 정책 자동 동기화" title={t('settings.statusPolicyTitle')} icon={Settings}>
        <p className="-mt-2 mb-4 text-xs leading-5 text-fg-secondary">
          {t('settings.statusPolicyDesc')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border-focus bg-action-soft/40 p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-action-soft text-action">
                <RefreshCw className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-fg">{t('settings.autoSyncTitle')}</p>
                <span className="badge bg-action-soft text-action">{t('settings.currentlyApplied')}</span>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-fg-secondary">
              {t('settings.autoSyncDesc')}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface-subtle p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-fg-secondary">
                <Lock className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-fg">{t('settings.baseDatePolicyTitle')}</p>
                {project?.base_date
                  ? <span className="badge bg-pending-weak text-warning">{t('settings.manualFixed')} · {project.base_date}</span>
                  : <span className="badge bg-action-soft text-action">{t('settings.autoTodayShort')}</span>}
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-fg-secondary">
              {t('settings.baseDatePolicyDesc')}
            </p>
          </div>
        </div>
        </SectionCard>
        </div>

        {/* ════ 달력 ════ */}
        <div id="project-calendar" className="scroll-mt-24 space-y-5">
      {/* ── 달력: 주 시작·근무 요일·시간대 + 기준일·날짜 예외 ── */}
        <SectionCard
        searchText="calendar.working_days calendar.week_start calendar.timezone 달력 기준일 주 시작 근무 요일 시간대 휴무 근무 날짜 예외"
        title={t('settings.calendarTitle')}
        icon={CalendarDays}
      >
        {calendarFields ? (
          <CalendarSettingsPanel scope={{ projectId }} revision={revision} todayIso={calendarToday}
            canEdit={canMutate} {...calendarFields} />
        ) : (
          <ConfigStateNotice kind="unavailable" />
        )}
        <div className="mt-6 border-t border-border pt-6">
        {pc.ok ? (
          <ScheduleManager
            projectId={projectId}
            baseDate={project?.base_date ?? null}
            holidays={pc.cfg.holidays}
            canEdit={canMutate}
          />
        ) : (
          // 날짜 예외를 빈 배열로 넘기면 '예외 0건'(정상)과 구분되지 않아 조용히 틀린 화면이 된다 —
          // 조회 실패는 안내로 드러내고, 임포트·기본 설정 등 나머지 카드는 그대로 쓰게 둔다.
          <div className="panel-soft flex items-center gap-4 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pending-weak text-pending">
              <Info className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">
                {t('pages.projSettings.scheduleLoadFailed')}
              </p>
              <p className="mt-1 text-xs leading-5 text-fg-secondary">
                {t('pages.projSettings.scheduleLoadFailedDesc')}
              </p>
            </div>
          </div>
        )}
        </div>
        </SectionCard>
        </div>

        <SectionCard id="project-history" searchText="history 설정 변경 기록 이력" title={t('pages.projSettings.historyTitle')} icon={History}>
          {historyCal === null
            ? null /* 설정 전체를 못 읽었다 — 페이지 머리의 ConfigLoadError 가 이미 사유를 그린다 */
            : historyCal.ok
              ? <SettingsHistoryList scope={{ projectId }} initial={settingsHistory} timeZone={historyCal.calendar.timezone} />
              : <ConfigLoadError error={historyCal.error} keyName={historyCal.key} kind={historyCal.kind} />}
        </SectionCard>
      </div>
      </SettingsShell>
    </ProjectPageShell>
  )
}
