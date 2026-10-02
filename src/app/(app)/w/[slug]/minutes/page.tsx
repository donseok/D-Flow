import { NotebookText } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getMinuteFavorites, getMinutesExplorer, getMinutesPage } from '@/lib/data/minutes'
import { getSession } from '@/lib/auth'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { UUID_RE } from '@/lib/domain/validate'
import { adminProjectIds, adminWorkspaceIdList, hasProjectRoleInWorkspace } from '@/lib/domain/authz'
import { identityTeamCodes } from '@/lib/domain/identityTeams'
import { getMyProjectIds } from '@/lib/data/members'
import { getAccountPrefs } from '@/app/actions/preferences'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MinutesView } from '@/components/minutes/MinutesView'
import { MinutesScopeProvider } from '@/components/minutes/MinutesScopeContext'
import { MinutesProjectChip } from '@/components/minutes/MinutesProjectChip'
import { todayIn } from '@/lib/domain/calendar'
import { viewCalendar } from '@/lib/calendar/viewZone'
import { calendarViewOf } from '@/lib/domain/attendance'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'

/** 해당 월 1일~말일 (달력 그리드 아님 — 목록은 월 단위 조회). */
function monthRange(todayIso: string): [string, string] {
  const [y, m] = todayIso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`]
}

export const metadata = { title: '회의록' }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)

export default async function MinutesPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ project?: string | string[] }>
}) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                           // 첫 await — 비소속 404(E19)
  await requireModulePage({ workspaceId: scope.ws.id }, 'minutes')     // 슬러그 워크스페이스로 판정(D26)
  const q = await searchParams
  // '오늘'(이번 달 목록)·달력 첫 열·쉬는 날 = 이 워크스페이스의 달력(계획 D-22b — 소속 목록으로 정하지 않는다)
  const vc = await viewCalendar(scope.ws.id)
  if (!vc.ok) return <ConfigLoadError error={vc.error} keyName={vc.key} kind="invalid" locale={await getServerLocale()} />
  const today = todayIn(vc.calendar.timezone, new Date())
  const [rs, re] = monthRange(today)
  const m = scope.actor
  // 이 워크스페이스의 프로젝트만 선택지로(업로드·일괄 지정). listProjects 는 요청 캐시라 레이아웃과 같은 조회를 나눠 쓴다
  const projects = (await listProjects() as { id: string; name: string; workspace_id?: string }[]).filter((p) => p.workspace_id === scope.ws.id)
  // D53·W11 — ?project= 는 그 워크스페이스의 아는 프로젝트이고 목록(숨김 제외)에 있을 때만. 아니면 쿼리 무시(존재 은닉 — 안내 없음)
  const raw = typeof q.project === 'string' ? q.project : null
  const filterProject = raw && UUID_RE.test(raw) && m?.projectWorkspace.get(raw) === scope.ws.id
    ? projects.find((p) => p.id === raw) ?? null : null
  const projectId = filterProject?.id ?? null
  const minutesScope = { workspaceId: scope.ws.id, projectId }
  // 트리는 기본 뷰라 거의 항상 필요하다 — 예전에는 MinutesView 가 마운트 뒤 서버액션으로 따로
  // 가져와서 "화면이 뜨고 나서 또 로딩이 도는" 왕복이 한 번 더 붙었다. 여기서 함께 싣는다.
  // prefs.minutesView 를 먼저 await 해 조건부로 부르면 안 된다 — 직렬 2단이 되고,
  // 아래 히어로 KPI(minutes.length)와 리스트/달력 전환용 월 목록까지 늦어진다.
  const [minutes, tree, favs, user, prefs, locale, myProjectIds] = await Promise.all([
    getMinutesPage(scope.ws.id, projectId, rs, re, null),
    getMinutesExplorer(scope.ws.id, projectId),
    getMinuteFavorites(scope.ws.id),
    getSession(),
    getAccountPrefs(),
    getServerLocale(),
    getMyProjectIds(),
  ])
  // 기본값은 트리, 미지 값(구버전 롤백·스큐)도 트리로 클램프 — calendar만 저장값 유지.
  // 리스트 뷰는 폐지(2026-07-24) — 구 저장값 'list'도 트리로 정규화.
  const savedView = prefs.minutesView
  const initialView = savedView === 'calendar' ? 'calendar' : 'tree'
  return (
    <MinutesScopeProvider scope={minutesScope}>
      <ProjectPageShell
        hero={<PageHero
          eyebrow="MINUTES"
          badge={<HeroBadge>Minutes</HeroBadge>}
          title={t(locale, 'min.heroTitle')}
          description={t(locale, 'min.heroDesc')}
          heroKpis={<KpiCard variant="hero" label="THIS MONTH" value={minutes.length}
            sub={t(locale, 'min.kpi.monthSub')} icon={NotebookText} tone="brand" />}
        />}
        pinned={filterProject ? <MinutesProjectChip slug={scope.ws.slug} project={filterProject} /> : undefined}
      >
        {/* 세션이 없으면 프리페치를 버린다. minutes 의 RLS 는 `to authenticated`(0021:77)라
            세션 없는 RSC 조회는 에러가 아니라 200+빈 배열로 돌아오고, getMinutesExplorer 는 그걸
            null 이 아닌 빈 트리 객체로 반환한다(minutes.ts 주석의 "실패=null/빈결과=객체" 구분).
            그대로 넘기면 '회의록 없음' EmptyState 로 위장되고 클라이언트 self-heal 도 막힌다.
            fetchMinutesExplorer(actions/minutes.ts)가 가진 세션 게이트를 서버 경로에도 맞춘 것.
            user 는 위 Promise.all 에서 이미 받았으므로 추가 왕복은 없다.
            (대가: GoTrue 일시 실패 시 멀쩡한 프리페치를 버려 왕복 1회 손해 — 정확성 우선.) */}
        <MinutesView scope={minutesScope} initialMinutes={minutes} initialTree={user ? tree : null} todayIso={today}
          initialFavorites={user ? favs : null}
          explorerLayout={prefs.minutesExplorerLayout === 'list' ? 'list' : 'grid'}
          initialView={initialView} projects={projects} defaultTeam={identityTeamCodes(m, scope.ws.id)[0] ?? null}
          currentUserId={user?.id ?? null} adminWorkspaceIds={adminWorkspaceIdList(m)} canEdit={hasProjectRoleInWorkspace(m, scope.ws.id)}
          myProjectIds={myProjectIds}
          projectWorkspaces={Object.fromEntries(m?.projectWorkspace ?? [])}
          noProjectWorkspace={{ ok: true, workspaceId: scope.ws.id }}
          adminProjectIds={adminProjectIds(m)} isSuperuser={m?.isSuperuser ?? false}
          calendar={calendarViewOf(vc.calendar)} />
      </ProjectPageShell>
    </MinutesScopeProvider>
  )
}
