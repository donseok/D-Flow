import { readScope, type ProjectScopedTable } from '@/lib/authz/scope'

/**
 * `@/lib/authz` 목의 resolveScope — 실구현(readScope(세션 클라이언트, …))과 같이 각 테스트의 createServerClient 목으로
 * 대상 행을 읽는다. 행의 project_id·workspace_id 로 범위를 정하고, 조회 실패는 ERR_LOOKUP·없음은 ERR_MISSING 이다.
 *
 * vi.mock 팩토리는 호이스팅되므로 async 팩토리 안에서 동적 import 해 쓴다:
 * `resolveScope: (await import('../helpers/resolve-scope-mock')).resolveScopeVia(() => createServerClient())`
 */
export function resolveScopeVia(client: () => Promise<unknown>) {
  return async (table: ProjectScopedTable, id: string) =>
    readScope((await client()) as Parameters<typeof readScope>[0], table, id, 'resolveScope')
}
