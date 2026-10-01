import { listProjects } from '@/app/actions/project'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { displayNameFrom } from '@/lib/domain/display-name'
import { visibleRows } from '@/lib/domain/weeklySheet'
import { mondayIso, sheetWeekMeta } from '@/lib/report/week'
import { getWeeklySheet, hasCarryOverSource } from '@/lib/data/weeklySheet'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHero } from '@/components/ui/PageHero'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { WeeklySheetView } from '@/components/weekly/WeeklySheetView'
import { seoulToday } from '@/lib/domain/dates'
import { requireModulePage } from '@/lib/modules/pageGate'

export default async function WeeklyPage({
  params, searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'weekly')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const { week } = await searchParams
  const weekStart = mondayIso(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : seoulToday())
  const wk = sheetWeekMeta(weekStart)

  const [sheet, hasCarry, projects, locale, user, actor, pc] = await Promise.all([
    getWeeklySheet(projectId, weekStart),   // 읽기만 한다(W16)
    // 판정 전용 경량 조회 — 셀 내용(최대 44셀×20,000자)을 실어오지 않는다(2026-08-18 성능 감사).
    hasCarryOverSource(projectId, weekStart),
    listProjects(),
    getServerLocale(),
    getSession(),
    // 어포던스 게이팅용 — 조회 실패는 null(조회 전용)로 열화한다. 쓰기는 서버 액션 가드가 다시 판정.
    getActorForView(),
    // 행 라벨·순서·빈 시트 안내는 프로젝트의 주간 영역이 정한다 — 조회 실패를 '영역 없음'(빈 시트)으로 위장하지 않는다
    loadProjectConfigForPage(projectId),
  ])
  const projectName = projects.find(p => p.id === projectId)?.name ?? ''
  // 프레즌스 신원 — 표시명 규칙은 헤더와 동일(full_name → name → 이메일 아이디)
  const me = user ? { id: user.id, name: displayNameFrom(user.user_metadata, user.email) ?? '사용자' } : null
  // 이 화면은 구글시트 복제 룩이 주인공 — 큰 히어로 대신 콤팩트한 한 줄 헤더만 둔다(공용 PageHero).
  const hero = <PageHero title={`${projectName} ${t(locale, 'nav.weekly')}`} />
  if (!pc.ok) return <ProjectPageShell hero={hero}><ConfigLoadError error={pc.error} locale={locale} /></ProjectPageShell>
  const areas = pc.cfg.areas.weekly_section

  return (
    <ProjectPageShell hero={hero}>
      <WeeklySheetView
        projectId={projectId}
        weekStart={weekStart}
        weekLabel={`${wk.label} (${wk.thisRange})`}
        weekTitle={wk.label}
        thisRange={wk.thisRange}
        nextRange={wk.nextRange}
        projectName={projectName}
        report={sheet ? { id: sheet.report.id, title: sheet.report.title } : null}
        areas={areas}
        // 표시 집합은 여기서 한 번 정한다(D32 — 활성 영역의 행 → 내용 있는 비활성 영역의 행). 같은 화면 안에서는 빼지 않는다.
        initialRows={sheet ? visibleRows(sheet.rows, areas) : []}
        hasCarrySource={hasCarry}
        me={me}
        canEditCells={isProjectMember(actor, projectId)}
        canCreateRound={isProjectAdmin(actor, projectId)}
      />
    </ProjectPageShell>
  )
}
