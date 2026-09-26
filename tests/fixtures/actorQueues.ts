// buildActor(actorFromUser 의 구현) 가 읽는 4축 응답 — 테이블별 응답 큐 목을 쓰는 라우트 테스트용.
// SP2 결정 8 로 외부 API 판정이 buildActor + roleIn 이 되면서, 판정 1회가 platform_admins·workspace_members·
// project_members·projects 를 한 번씩 읽는다(projects 는 range·count — 빌더 목은 range 를 받고 count 를 돌려줘야 한다).
// 판정이 여러 번이면 axes(…, n) 로 n 벌을 싣는다.
import { WS } from './actor'

type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }

/** 명단 행 1개 — buildActor 의 project_members 응답. access_role null 은 조회 전용 명단 행이다. */
export function rosterRow(projectId: string, accessRole: 'admin' | 'member' | null, id = `m-${projectId}`) {
  return { id, project_id: projectId, access_role: accessRole, people: { user_id: 'u', active: true }, project_member_teams: [] }
}
/** 판정 1회분 project_members 응답(행 없으면 명단에 없음). */
export function roster(...rows: ReturnType<typeof rosterRow>[]): Resp {
  return { data: rows }
}
/**
 * project_members 를 뺀 나머지 축 n 벌 — 소속 워크스페이스 WS(role) 와 그 워크스페이스의 프로젝트들.
 * 플랫폼 관리자면 superuser: true(projects 는 필터 없이 전부 읽는다 — 같은 응답을 준다).
 */
export function axes(projectIds: string[], n = 1, opts: { role?: 'admin' | 'member'; superuser?: boolean } = {}) {
  const times = <T>(v: T): T[] => Array.from({ length: n }, () => v)
  return {
    platform_admins: times<Resp>({ data: opts.superuser ? { user_id: 'u-1' } : null }),
    workspace_members: times<Resp>({ data: [{ workspace_id: WS, role: opts.role ?? 'member' }] }),
    // buildActor 는 projects 를 id 정렬 페이지로 읽고 count 총합으로 대조한다(fetchAllPages) — count 를 함께 싣는다.
    projects: times<Resp>({ data: projectIds.map(id => ({ id, workspace_id: WS })), count: projectIds.length }),
  }
}
