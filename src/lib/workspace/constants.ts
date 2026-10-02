// 워크스페이스 해석의 순수 조각 — 클라이언트(셸)와 서버(resolve·current)가 같이 쓴다. resolve.ts 는 서버 클라이언트를,
// current.ts 는 next/headers 를 import 하므로 클라이언트 컴포넌트는 여기서만 가져온다.
export interface WorkspaceRef { id: string; slug: string; name: string }
/** 0003_org_core.sql 의 workspaces.slug check 와 같은 식. 디코드·소문자화하지 않는다 — 형식 밖은 없는 워크스페이스다 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/
export const WS_COOKIE = 'dflow-ws'
