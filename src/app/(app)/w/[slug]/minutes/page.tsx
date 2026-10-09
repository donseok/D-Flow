import { redirect } from 'next/navigation'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getMinuteFavorites, getMinutesExplorer, getMinutesPage, hasMinutesWithoutTeam } from '@/lib/data/minutes'
import { getSession } from '@/lib/auth'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { UUID_RE } from '@/lib/domain/validate'
import { adminWorkspaceIdList, hasProjectRoleInWorkspace } from '@/lib/domain/authz'
import { identityTeamCodes } from '@/lib/domain/identityTeams'
import { getMyProjectIds } from '@/lib/data/members'
import { getAccountPrefs } from '@/app/actions/preferences'
import { listProjects } from '@/app/actions/project'
import { PageHeader } from '@/components/app/PageHeader'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MinutesView } from '@/components/minutes/MinutesView'
import { MinutesScopeProvider } from '@/components/minutes/MinutesScopeContext'
import { MinutesProjectChip } from '@/components/minutes/MinutesProjectChip'
import { todayIn } from '@/lib/domain/calendar'
import { viewCalendar } from '@/lib/calendar/viewZone'
import { calendarViewOf } from '@/lib/domain/attendance'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'
import { projectTeams, workspaceTeams } from '@/lib/teams/source'
import { resolveTeamParam } from '@/lib/minutes/teamResolve'
import { wsHref } from '@/lib/workspace/paths'

/** 해당 월 1일~말일 (달력 그리드 아님 — 목록은 월 단위 조회). */
function monthRange(todayIso: string): [string, string] {
  const [y, m] = todayIso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`]
}

/** 탭 제목 — 화면 언어를 따른다(ko 는 종전의 '회의록') */
export async function generateMetadata() { return { title: t(await getServerLocale(), 'nav.minutes') } }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)

export default async function MinutesPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ project?: string | string[]; team?: string | string[] }>
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
  // 담당 팀 필터(SP5 B2) — ?team=<팀 id>. 선택지는 그 범위의 팀(프로젝트를 고르면 그 프로젝트의 전용 + 공용, 아니면 공용).
  // 옛 ?team=<code> 링크는 code 단위로 한 번 해석해 id 로 리다이렉트하고, 모르는 값·범위 밖은 파라미터를 지운다(존재 은닉 — 안내 없음).
  // ?team=none 은 팀 없는 회의록 필터(0052 — resolveTeamParam 이 그대로 돌려준다)
  const scopeTeams = projectId ? await projectTeams(projectId) : await workspaceTeams(scope.ws.id)
  const teamOptions = scopeTeams.filter((tm) => tm.active).map((tm) => ({ id: tm.id, code: tm.code, name: tm.name }))
  const teamParam = resolveTeamParam(typeof q.team === 'string' ? q.team : Array.isArray(q.team) ? (q.team[0] ?? '') : undefined,
    teamOptions.map((tm) => ({ ...tm, projectId: null })), { projectId: null })
  if (teamParam.kind === 'redirect') redirect(wsHref(scope.ws.slug, 'minutes', { project: projectId, team: teamParam.id }))
  const initialTeamId = teamParam.kind === 'id' ? teamParam.id : null
  // 트리는 기본 뷰라 거의 항상 필요하다 — 예전에는 MinutesView 가 마운트 뒤 서버액션으로 따로
  // 가져와서 "화면이 뜨고 나서 또 로딩이 도는" 왕복이 한 번 더 붙었다. 여기서 함께 싣는다.
  // prefs.minutesView 를 먼저 await 해 조건부로 부르면 안 된다 — 직렬 2단이 되고,
  // 리스트/달력 전환용 월 목록까지 늦어진다.
  const [minutes, tree, favs, user, prefs, locale, myProjectIds, hasNoTeam] = await Promise.all([
    getMinutesPage(scope.ws.id, projectId, rs, re, initialTeamId),
    getMinutesExplorer(scope.ws.id, projectId, m ?? null),
    getMinuteFavorites(scope.ws.id),
    getSession(),
    getAccountPrefs(),
    getServerLocale(),
    getMyProjectIds(),
    hasMinutesWithoutTeam(scope.ws.id, projectId),
  ])
  // 기본값은 트리, 미지 값(구버전 롤백·스큐)도 트리로 클램프 — calendar만 저장값 유지.
  // 리스트 뷰는 폐지(2026-07-24) — 구 저장값 'list'도 트리로 정규화.
  const savedView = prefs.minutesView
  const initialView = savedView === 'calendar' ? 'calendar' : 'tree'
  return (
    <MinutesScopeProvider scope={minutesScope}>
      <ProjectPageShell
        hero={<PageHeader title={t(locale, 'min.heroTitle')} description={t(locale, 'min.heroDesc')} />}
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
          isSuperuser={m?.isSuperuser ?? false}
          calendar={calendarViewOf(vc.calendar)} teamOptions={teamOptions} initialTeamId={initialTeamId} hasNoTeamMinutes={hasNoTeam} />
      </ProjectPageShell>
    </MinutesScopeProvider>
  )
}
