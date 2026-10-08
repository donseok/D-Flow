import { CustomFieldsProvider } from '@/components/fields/CustomFieldValuesEditor'
import { getComputedWbs } from '@/lib/data/wbs'
import { toCalendarInput } from '@/lib/calendar/load'
import { getProjectRoster } from '@/lib/data/members'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pick } from '@/lib/settings/pick'
import { levelDepthOf } from '@/lib/settings/projectConfig'
import { listProjects } from '@/app/actions/project'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, toProjectActorView } from '@/lib/domain/authz'
import { displayNameFrom } from '@/lib/domain/display-name'
import { getWbsCollapse, getAccountPrefs } from '@/app/actions/preferences'
import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { PageHeader } from '@/components/app/PageHeader'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { RosterLoadError } from '@/components/members/RosterLoadError'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'
import { requireModule, moduleState } from '@/lib/modules/gate'
import { resolveWbsView } from '@/lib/wbs/view'
import { boardUnavailableReason } from '@/lib/wbs/boardAvailability'
import { ViewSwitch } from '@/components/wbs/ViewSwitch'
import { WbsAddButton } from '@/components/wbs/WbsAddButton'
import { WbsRealtimeRefresh } from '@/components/wbs/WbsRealtimeRefresh'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { ConfigStateNotice } from '@/components/settings/ConfigStateNotice'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { getApprovedItemIds } from '@/lib/data/approvedItems'

type ProjectRow = { id: string; name: string; description?: string | null; start_date?: string | null; end_date?: string | null }

export default async function WbsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'wbs')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const sp = await searchParams
  const one = (key: string) => typeof sp[key] === 'string' ? sp[key] as string : undefined
  const focus = one('focus')
  const locale = await getServerLocale()
  const [{ items, dependencies, unresolvedDepends, calendar, today }, actor, projects, initialCollapsed, user, pc, uiPrefs, roster] = await Promise.all([
    getComputedWbs(projectId),
    getActorForView(),
    listProjects(),
    getWbsCollapse(projectId),
    getSession(),
    loadProjectConfigForPage(projectId),
    getAccountPrefs(),
    getProjectRoster(projectId),
  ])
  // 명단은 담당자 선택·이름 표시용 곁가지 — 실패해도 간트는 그리되, 빈 선택 목록이 '0명' 으로 읽히지 않게 사유를 띄운다.
  if (!roster.ok) console.error(`[wbs] 명단 조회 실패(project=${projectId}) — 담당자 목록 없이 그리고 경고를 띄운다`)
  const members = roster.ok ? roster.rows : []
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  // 프레즌스 신원 — 주간 시트와 동일하게 서버 세션에서 전달
  const me = user ? { id: user.id, name: displayNameFrom(user.user_metadata, user.email) ?? '사용자' } : null
  const hero = <PageHeader title={t(locale, 'nav.wbsGantt')} />
  // 설정을 못 읽거나 단계 이름이 손상이면 간트를 기본값으로 그리지 않는다(스펙 §3.5) — 트리 깊이·라벨이 틀린 채 편집하게 된다.
  if (!pc.ok) return <ProjectPageShell hero={hero}><ConfigLoadError error={pc.error} locale={locale} /></ProjectPageShell>
  const labels = pick(pc.cfg, 'core.level_labels')
  if (!labels.ok) return <ProjectPageShell hero={hero}><ConfigLoadError error={labels.error} keyName={labels.key} kind={labels.kind} locale={locale}
    isAdmin={isProjectAdmin(actor, projectId)} settingsHref={`/p/${projectId}/settings`} /></ProjectPageShell>
  // 본체 설정 실패에는 보드를 판정할 필요가 없다. 정상 경로는 요청 캐시의 같은 프로젝트 설정을 재사용한다.
  const boardGate = await requireModule({ projectId }, 'kanban')
  // 키워드 손상은 마커 없이 그리고 명단 오류와 같은 자리에 사유를 띄운다.
  const keywords = pick(pc.cfg, 'core.milestone_keywords')
  const storedPick = pick(pc.cfg, 'views.default')
  if (!storedPick.ok) console.error(`[wbs] views.default 손상(project=${projectId}) — 표로 그린다`)
  const decided = resolveWbsView({ view: one('view'), focus, stored: storedPick.ok ? storedPick.value.wbs : null, boardOn: boardGate.ok })
  const admin = isProjectAdmin(actor, projectId)
  const reason = decided.notice === 'board_off' ? await boardUnavailableReason(pc.cfg) : null

  const customFields = pick(pc.cfg, 'fields.wbs_item')
  // 선행 기준·승인 주문 축(SP5b D21) — 상세 패널의 "시작 가능"이 claim 게이트와 같은 판정이 되게. 기준이 손상이면 final(엄격 — 시작 가능으로
  // 위장하지 않는다). agents 가 꺼진 프로젝트는 주문 표를 읽지 않는다(승인 축 = false)
  const gate = pick(pc.cfg, 'workflow.predecessor_gate')
  // 단계 이름(SP5b W2) — 손상이면 기본 이름으로 그린다(표시 전용 — 판정에 쓰지 않는다)
  const stageLabels = pick(pc.cfg, 'workflow.wbs_stage_labels')
  // 승인 단계(SP5b) — 검수 대기(im) 열 부제 표시 등에 사용
  const approvalSteps = pick(pc.cfg, 'workflow.approval_steps')
  if (!gate.ok) console.error(`[wbs] 선행 기준 손상(project=${projectId}) — final 로 판정한다`)
  const approvedItemIds = (await moduleState({ projectId }, 'agents')) === 'on' ? await getApprovedItemIds(projectId) : []

  // R5: 기존 머리(PageHeader)·ProjectPageShell을 유지하고 화면 소유의 주 동작만 곁에 배치한다.
  const header = <div className="flex items-center"><div className="min-w-0 flex-1">{hero}</div>
    {decided.view !== 'board' && admin && <div className="shrink-0"><WbsAddButton /></div>}
  </div>
  const pinned = (
    <div className="flex flex-col gap-2 pb-2">
      {reason && <StatusMessage kind={reason === 'unknown' ? 'partial_error' : 'disabled'} compact
        title={reason === 'project_off' ? '이 프로젝트에서는 보드를 사용하지 않습니다' : reason === 'workspace_denied' ? '워크스페이스에서 보드를 허용하지 않습니다' : '보드 사용 여부를 확인하지 못했습니다'}
        detail={reason === 'workspace_denied' ? '워크스페이스 관리자에게 문의하세요.' : undefined}
        action={admin && reason !== 'workspace_denied' ? { label: '모듈·메뉴 설정', href: `/p/${projectId}/settings#project-modules` } : undefined} />}
      {!storedPick.ok && <ConfigStateNotice kind={storedPick.kind} locale={locale} keyName="views.default" message={storedPick.error} compact isAdmin={admin} settingsHref={`/p/${projectId}/settings#project-modules`} />}
      {!roster.ok && <RosterLoadError error={roster.error} />}
      {!keywords.ok && <ConfigLoadError error={keywords.error} keyName={keywords.key} kind={keywords.kind} locale={locale}
        isAdmin={isProjectAdmin(actor, projectId)} settingsHref={`/p/${projectId}/settings`} />}
      <ViewSwitch basePath={`/p/${projectId}/wbs`} query={sp} current={decided.view} boardOn={boardGate.ok} />
    </div>
  )
  return (
    <ProjectPageShell
      variant="fill"
      flush
      pinned={pinned}
      hero={header}
    >
      <CustomFieldsProvider projectId={projectId} entity="wbs_item" defs={customFields.ok ? customFields.value : null} canAdmin={isProjectAdmin(actor, projectId)} locale={locale}>
        {decided.view === 'board' ? <>
          {/* 조작 화면의 done 보고를 짧은 창으로 재조회한다. 연속 이벤트는 합쳐 렌더하며 채널 구독을 중복하지 않는다. */}
          <WbsRealtimeRefresh projectId={projectId} delayMs={1_500} maxWaitMs={5_000} jitterMs={3_000} />
          <KanbanBoard
            projectId={projectId}
            items={items}
            actorView={toProjectActorView(actor, projectId)}
            today={today}
            stageLabels={stageLabels.ok ? stageLabels.value : null}
            approvalSteps={approvalSteps.ok ? approvalSteps.value : null}
          />
        </> : <WbsGanttSheet
          key={projectId}
          items={items}
          dependencies={dependencies}
          unresolvedDepends={unresolvedDepends}
          calendar={toCalendarInput(calendar)}
          today={today}
          actorView={toProjectActorView(actor, projectId)}
          me={me}
          projectId={projectId}
          projectName={project?.name ?? ''}
          projectDescription={project?.description}
          startDate={project?.start_date}
          endDate={project?.end_date}
          defaultView={decided.view === 'timeline' ? 'timeline' : 'sheet'}
          initialCollapsed={initialCollapsed ?? undefined}
          focusId={focus ?? null}
          levelLabels={labels.value}
          maxDepth={levelDepthOf(pc.cfg)}
          milestoneKeywords={keywords.ok ? keywords.value : []}
          initialHideDone={uiPrefs.wbsHideDone ?? false}
          initialOutline={uiPrefs.wbsOutline ?? false}
          initialGanttScale={uiPrefs.wbsGanttScale}
          members={members}
          predecessorGate={gate.ok ? gate.value : 'final'}
          approvedItemIds={approvedItemIds ?? []}
          stageLabels={stageLabels.ok ? stageLabels.value : null}
        />}
      </CustomFieldsProvider>
    </ProjectPageShell>
  )
}
