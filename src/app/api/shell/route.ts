// 앱 셸 상태 통합 조회(D34, 스펙 §5.4.7) — ?ws=<wid>&project=<pid>(둘 다 ShellScope 에서). 이동당 GET 1회(R25) — GET 이라 서버 액션 큐와 경쟁하지 않는다.
// 응답 = { inbox, notifications, badges: { myWorkReview, projectApprovals, projectUnreadAnnouncements } }. 티커 필드는 없다(D28). 개인화라 no-store.
// 배지 실패는 0 이 아니라 null + 로그(3원칙 ①). 모듈이 꺼진 항목은 실패가 아니다(결재 배지 0 — §4.2 셸 행, 공지는 액션이 0).
// 범위 판정은 fail-closed(E10 — 남의 수를 흘리지 않는다): ws 는 uuid 이고 그 워크스페이스에 역할이 있을 때만(플랫폼 관리자 포함 — 그 워크스페이스를 보는
// 화면과 같은 축) 센다. project 는 uuid 이고 볼 수 있는 프로젝트(isHiddenProject 아님)이며 ws 를 같이 보냈으면 그 워크스페이스의 프로젝트일 때만 조회한다.
// 권한 조회가 실패하면(열화) 범위 배지는 모두 null 이고 인박스만 낸다. 안의 조회 함수들도 각자 세션·관문을 다시 지난다.
import { type NextRequest, NextResponse } from 'next/server'
import { getInboxFeed } from '@/app/actions/inbox'
import { getNotifications } from '@/app/actions/notifications'
import { getUnreadAnnouncementCount } from '@/app/actions/announcements'
import { getPendingApprovalCount } from '@/lib/data/agentApprovals'
import { projectsWithModule } from '@/lib/modules/gate'
import { countMyReview } from '@/lib/data/portal'
import { getActorViewState } from '@/lib/authz'
import { isHiddenProject, isWorkspaceMember, type Actor } from '@/lib/domain/authz'
import { UUID_RE } from '@/lib/domain/validate'

const nullOnFail = <T,>(label: string, p: Promise<T>): Promise<T | null> =>
  p.catch((e: unknown) => { console.error(`[shell] ${label} 실패:`, e instanceof Error ? e.message : e); return null })
const uuidOrNull = (v: string | null) => (v && UUID_RE.test(v) ? v.toLowerCase() : null)

async function actorOrNull(): Promise<Actor | null> {
  try { return (await getActorViewState()).actor } catch (e) {
    console.error('[shell] 권한 조회 실패 — 범위 배지 없이 응답한다:', e instanceof Error ? e.message : e)
    return null
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const wsRaw = uuidOrNull(q.get('ws'))
  const projectRaw = uuidOrNull(q.get('project'))
  const actor = await actorOrNull()
  const ws = actor && wsRaw && isWorkspaceMember(actor, wsRaw) ? wsRaw : null
  const project = actor && projectRaw && !isHiddenProject(actor, projectRaw) && (!wsRaw || actor.projectWorkspace.get(projectRaw) === wsRaw) ? projectRaw : null
  const [inbox, notifications, myWorkReview, projectApprovals, projectUnreadAnnouncements] = await Promise.all([
    getInboxFeed(),
    // 파생 알림은 실패해도 벨 전체를 죽이지 않는다(옛 HeaderChrome catch 시맨틱 — 클라이언트는 직전 값을 유지)
    project ? nullOnFail('파생 알림', getNotifications(project)) : Promise.resolve(null),
    ws && actor ? nullOnFail('검토 대기 수', countMyReview(ws, actor)) : Promise.resolve(null),
    // 결재 배지는 액션이 아니라(열거 게이트 밖) 여기서 agents 판정 — 꺼진 프로젝트면 0(꺼짐은 실패가 아니다)
    project ? nullOnFail('결재 대기 수', projectsWithModule([project], 'agents').then((on) => (on.length ? getPendingApprovalCount(project) : 0))) : Promise.resolve(null),
    project ? nullOnFail('공지 안읽음 수', getUnreadAnnouncementCount(project)) : Promise.resolve(null),
  ])
  return NextResponse.json(
    { inbox, notifications, badges: { myWorkReview, projectApprovals, projectUnreadAnnouncements } },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
