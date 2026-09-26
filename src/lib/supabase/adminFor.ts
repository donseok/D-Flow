import 'server-only'
import { createAdminClient } from './admin'

// service_role 클라이언트를 스코프(워크스페이스 또는 프로젝트) id 와 함께 만든다(SP2 §4.2).
// 감사표(docs/sp2-admin-client-audit.md)와 tests/invariants/admin-scope.test.ts 가 createAdminClient 를 직접 부르는
// 파일을 전부 목록으로 붙든다 — 스코프가 정해진 경로는 이 함수로 옮겨 그 목록에서 빠진다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AdminScope = { workspaceId: string } | { projectId: string }
export type AdminClient = ReturnType<typeof createAdminClient>

/** service_role 클라이언트를 스코프 값과 함께 돌려준다 — 호출부가 그 값으로 필터를 걸게 하고, 정적 불변식이
 *  "스코프 없이 admin 을 만드는 파일"을 잡을 수 있게 한다. id 가 uuid 가 아니면 throw(fail-closed). */
export function adminFor<S extends AdminScope>(scope: S): S & { admin: AdminClient } {
  const id = 'workspaceId' in scope ? scope.workspaceId : 'projectId' in scope ? scope.projectId : undefined
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('adminFor: 스코프 id 가 올바르지 않다')
  return { ...scope, admin: createAdminClient() }
}
