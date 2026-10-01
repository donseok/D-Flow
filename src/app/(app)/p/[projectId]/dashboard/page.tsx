import { notFound } from 'next/navigation'
import { after } from 'next/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getSnapshots, recordProgressSnapshot } from '@/lib/data/snapshots'
import { getAnnouncements } from '@/lib/data/announcements'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getIssuesForDashboard } from '@/lib/data/issues'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pick } from '@/lib/settings/pick'
import { listProjects } from '@/app/actions/project'
import { getSession } from '@/lib/auth'
import { getActorViewState } from '@/lib/authz'
import { isHiddenProject, isProjectAdmin } from '@/lib/domain/authz'
import { createServerClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero } from '@/components/ui/PageHero'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { WbsRealtimeRefresh } from '@/components/wbs/WbsRealtimeRefresh'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'
import { moduleSetFor } from '@/lib/modules/gate'
import { workspaceRefById } from '@/lib/workspace/resolve'
import { wsHref } from '@/lib/workspace/paths'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'dashboard')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const locale = await getServerLocale()
  const [{ items, holidays, today }, projects, annRes, snapRes, meetRes, issuesRes, sb, user, { actor: membership, degraded }, pc, mods, wsRef] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getAnnouncements(projectId),
    getSnapshots(projectId),
    getProjectMeetingData(projectId),
    // 이슈 현황 카드 — issues 단일 쿼리 슬라이스. 같은 배치에 얹어 직렬 왕복을 늘리지 않는다.
    getIssuesForDashboard(projectId),
    createServerClient(),
    // 회의 카드에서 '작성자 본인이면 수정' 판정에 쓰는 식별자 — 기존 배치에 얹어 직렬 왕복을 늘리지 않는다.
    getSession(),
    getActorViewState(),
    // 마일스톤 키워드 등 프로젝트 설정 — 봇 대시보드 도구도 같은 해석기를 쓴다. 실패는 기본값이 아니라 오류 상태(스펙 §3.5).
    loadProjectConfigForPage(projectId),
    // P20 — 교차 모듈 카드(이슈·공지·회의). 판정 실패는 core 만 = 숨김(로그는 moduleSetFor). 꺼진 모듈의 로더도 위에서 그대로 부른다
    // (관문은 로더 안 — 호출을 조건부로 바꾸면 이 묶음의 병렬이 깨진다). 데이터는 카드에서만 버린다
    moduleSetFor({ projectId }),
    // D53 — 회의 카드의 '이 프로젝트 회의록' 슬러그. getActor 는 요청 캐시라 권한 조회를 더하지 않는다
    getActorViewState().then(async ({ actor }) => {
      const wid = actor?.projectWorkspace.get(projectId)
      return wid ? workspaceRefById(wid) : null
    }),
  ])
  // 존재 은닉을 페이지가 다시 판정한다 — 레이아웃과 페이지는 병렬로 렌더돼 레이아웃의 notFound 가 이 페이지를 멈추지
  // 않는다. DashboardView 는 service_role 팀 캐시로 팀별 진척을 그리므로 숨은 프로젝트에서는 그리기 전에 끊는다
  // (뷰는 RLS 로 읽은 WBS 항목이 있을 때만 팀 캐시를 읽지만, 그 조건에 기대지 않는다). 스냅샷 기록도 걸지 않는다.
  // 권한 조회 실패(degraded)는 레이아웃처럼 404 로 위장하지 않는다 — 그때 팀 캐시는 RLS 로 읽힌 항목이 있을 때만 쓰인다.
  // WBS 가 비어도 회의·이슈·공지는 그린다 — 팀 캐시(teamsForProjectSync)는 WBS 가 있을 때만 읽는다(DashboardView).
  // 이슈·공지·회의·진척 이력 조회 실패는 결과로 받아 뷰에 넘긴다 — 뷰가 '0건'·합성 추세선 대신 사유를 보인다.
  if (!degraded && isHiddenProject(membership, projectId)) notFound()
  // 보험 스냅샷 — 응답 전송 후 실행. 페이지의 after() 안에서는 cookies() 호출이 불가하므로
  // supabase 클라이언트를 미리 만들어 넘긴다(서버 액션 훅과 달리 이 경로만 client 인자 사용).
  // 방금 계산한 트리를 함께 넘긴다 — 안 넘기면 같은 요청에서 wbs_items 전량을
  // 다시 읽고 computeTree 를 한 번 더 돌린다. 실시간 재조회가 잦아지면 그 중복이 배수로 커진다.
  after(() => recordProgressSnapshot(projectId, sb, { roots: items, today }))

  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'dash.heroProjectFallback')
  // 관리자 이상 — 회의 상세의 남의 회의 수정·취소와 AI 브리핑 생성이 같은 판정을 쓴다.
  const canManage = isProjectAdmin(membership, projectId)
  const hero = <PageHero title={`${projectName}${t(locale, 'dash.heroTitleSuffix')}`} />

  if (!pc.ok) return <ProjectPageShell hero={hero}><ConfigLoadError error={pc.error} locale={locale} /></ProjectPageShell>
  // 대시보드는 core.level_labels 를 쓰지 않는다. 키워드가 손상이면 마일스톤만 비우고 그 사실을 위에 보인다 — 다른 카드는 그린다.
  const keywords = pick(pc.cfg, 'core.milestone_keywords')
  const modules = { issues: mods.has('issues'), announcements: mods.has('announcements'), meetings: mods.has('meetings') }
  const minutesHref = mods.has('minutes') && wsRef?.ok ? wsHref(wsRef.ws.slug, 'minutes', { project: projectId }) : null

  return (
    <ProjectPageShell hero={hero}>
      {!keywords.ok && <ConfigLoadError error={keywords.error} keyName={keywords.key} kind={keywords.kind} locale={locale}
        isAdmin={canManage} settingsHref={`/p/${projectId}/settings`} />}
      <DashboardView
        items={items}
        projectId={projectId}
        projectName={projectName}
        projectDescription={project?.description}
        startDate={project?.start_date ?? null}
        endDate={project?.end_date ?? null}
        today={today}
        holidays={holidays}
        snapshots={snapRes.ok ? snapRes.rows : []}
        historyFailed={!snapRes.ok}
        announcements={annRes.ok ? annRes.rows : null}
        meetings={meetRes.ok ? meetRes.meetings : null}
        meetingExceptions={meetRes.ok ? meetRes.exceptions : []}
        issues={issuesRes.ok ? issuesRes.rows : null}
        currentUserId={user?.id ?? null}
        canManage={canManage}
        canGenerateBrief={canManage}
        milestoneKeywords={keywords.ok ? keywords.value : []}
        modules={modules}
        minutesHref={minutesHref}
      />
      {/* 진척률은 집계값이라 행 단위 패치가 정의되지 않는다 — 실시간 신호를 받아 재조회한다(0098). */}
      <WbsRealtimeRefresh projectId={projectId} />
    </ProjectPageShell>
  )
}
