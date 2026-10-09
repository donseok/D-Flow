import type { Metadata } from 'next'
import { notFound, unstable_rethrow } from 'next/navigation'
import { getActorViewState } from '@/lib/authz'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { getDisplayName } from '@/lib/auth'
import { isHiddenProject } from '@/lib/domain/authz'
import { workspaceRefById } from '@/lib/workspace/resolve'
import { listMyWorkspaces } from '@/lib/workspace/list'
import { loadShell, minimalShell } from '@/lib/shell/loadShell'
import { displayBranding, workspaceIconHref } from '@/lib/settings/displayBranding'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { projectTeams } from '@/lib/teams/source'
import { activeTeamsForLayout } from '@/lib/teams/layoutTeams'
import { AppShell } from '@/components/app/AppShell'
import { ScopeProvider } from '@/components/app/ScopeContext'
import { ShellScope } from '@/components/app/ShellScope'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import type { Team } from '@/lib/domain/teams'

type Params = Promise<{ projectId: string }>

/**
 * /p/* 는 그 프로젝트의 워크스페이스 마크(★8)와 제품 이름(branding.product_name — 제목 '{화면} | {제품}'. 워크스페이스 범위의 템플릿과 같은 값을
 * 쓴다. 워크스페이스·프로젝트 이름은 넣지 않는다 — 이 함수는 이름을 읽는 조회를 하지 않는다). 숨김 프로젝트(명단 밖 비공개 포함)는 아이콘도 제목도
 * 내지 않는다(존재 은닉 — 루트의 배포 기본 제목이 나온다). 비공개 판정 실패도 내지 않는다 — 판정자는 쿼리 오류만 로그하므로 여기서도 남기고(원칙 ①),
 * Next 제어 신호는 삼키지 않는다(HH3). 브랜딩이 손상(invalid)이면 displayBranding 이 배포 기본 이름으로 내린다
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const hiddenOrNull = getHiddenProjectIds().catch((e: unknown) => {
    unstable_rethrow(e)
    console.error('[project layout] 비공개 판정 실패 — 아이콘을 내지 않는다:', e instanceof Error ? e.message : e)
    return null
  })
  const [{ projectId }, { actor }, hidden] = await Promise.all([params, getActorViewState(), hiddenOrNull])
  if (!actor || !hidden || isHiddenProject(actor, projectId, hidden)) return {}
  const wid = actor.projectWorkspace.get(projectId)
  if (!wid) return {}
  try {
    const config = await getWorkspaceConfig(wid)
    const icon = workspaceIconHref(config), { productName } = displayBranding(config)
    return { title: { template: `%s | ${productName}`, default: productName }, ...(icon ? { icons: { icon } } : {}) }
  } catch (e) { console.error('[project layout] 브랜딩 판독 실패:', e instanceof Error ? e.message : e); return {} }
}

/**
 * 프로젝트 범위 셸(스펙 §5.4.1). 존재 은닉(스펙 §3.2) — 내 워크스페이스에 없는 프로젝트(타 워크스페이스·미존재)와 명단 밖 비공개 프로젝트
 * (GG1 — 사용자 결정 2026-08-10 "비공개 = 화면 숨김"을 회의록·위키·AI·포털과 같은 판정자로)는 404 이고, 그때는 셸 데이터
 * (워크스페이스 이름·프로젝트 목록·브랜드)도 조회하지 않는다. 같은 워크스페이스의 조회 전용(viewer)은 공개 프로젝트면 통과한다. 플랫폼 관리자도 없는 pid 는 404.
 * 비공개 판정(getHiddenProjectIds)이 실패하면 404 로 위장하지 않고 던진다(오류 경계). 요청 캐시라 페이지 재판정과 왕복을 나눈다.
 * 권한 조회 실패(degraded)는 404 가 아니다 — 워크스페이스를 모르므로 내비 없는 최소 셸(열화 알림)로 그린다. 팀은 요청 범위 원천(세션)으로 읽는다 — 열화면 읽지 않는다.
 * 단 그 프로젝트가 비공개면 명단을 판정할 수 없으므로 최소 셸로도 열지 않고 던진다(GG1).
 * 워크스페이스 id 는 actor.projectWorkspace(조회 없음, D38), 슬러그·이름은 workspaceRefById(세션 RLS). 그 행이 안 보이면 최소 셸, 조회 오류는 오류 경계.
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  const [{ projectId }, { actor, degraded }, mine, userName, hidden] = await Promise.all([
    params, getActorViewState(), listMyWorkspaces(), getDisplayName(), getHiddenProjectIds(),
  ])
  // 열화면 판정자의 actor 도 null 이라 숨김 집합 = 비공개 전부 — 명단을 모르는 비공개는 오류로 닫는다(404 로 위장하지 않는다)
  if (degraded && hidden.has(projectId)) throw new Error('권한 조회가 실패해 비공개 프로젝트의 명단을 판정하지 못했습니다')
  if (!degraded && isHiddenProject(actor, projectId, hidden)) notFound()
  if (!mine.ok) throw new Error(`소속 목록을 불러오지 못했습니다: ${mine.error}`)
  const wid = actor?.projectWorkspace.get(projectId) ?? null
  const ref = wid ? await workspaceRefById(wid) : null
  if (ref && !ref.ok && ref.kind === 'unavailable') throw new Error(`워크스페이스를 조회하지 못했습니다: ${ref.error}`)
  if (!ref || !ref.ok) {
    if (ref) console.error('[project layout] 프로젝트의 워크스페이스 행이 보이지 않는다 — 내비 없이 그린다:', projectId)
    return (
      <ScopeProvider value={{ workspace: null, projectId }}>
        <TeamsProvider teams={[]}>
          <AppShell {...minimalShell({ scope: 'project', projectId, workspaces: mine.rows, userName, degraded: true })}>{children}</AppShell>
        </TeamsProvider>
      </ScopeProvider>
    )
  }
  const ws = ref.ws
  // 칩·비기록은 권한 조회와 무관한 실제 소속 목록으로 정한다(AA6) — 비소속인데 여기까지 왔으면 플랫폼 관리자 보기다(열화로 actor 가 없어도)
  const member = mine.rows.some((r) => r.id === ws.id)
  const viewingAsPlatformAdmin = !member
  const [shell, teams] = await Promise.all([
    loadShell({ scope: 'project', ws, actor, degraded, projectId, viewingAsPlatformAdmin, workspaces: mine.rows, userName }),
    actor ? activeTeamsForLayout(() => projectTeams(projectId), 'project layout') : Promise.resolve<Team[]>([]),
  ])
  return (
    <ScopeProvider value={{ workspace: ws, projectId }}>
      <TeamsProvider teams={teams}>
        <ShellScope workspace={ws} projectId={projectId} projects={shell.projects.map((p) => ({ id: p.id, name: p.name }))} persist={member} />
        <AppShell {...shell}>{children}</AppShell>
      </TeamsProvider>
    </ScopeProvider>
  )
}
