/**
 * 현재 워크스페이스(D3) — URL 이 정본이고 쿠키 dflow-ws(슬러그)는 기본값 힌트다. 읽는 곳은 셋뿐: 루트 리졸버, (global) 레이아웃,
 * 목록형 옛 경로 스텁. 읽을 때마다 소속을 다시 본다(탈퇴·위조는 무시하고 첫 소속). 쓰는 곳은 셸의 ShellScope(클라이언트) 하나다.
 * 쿠키는 보안 경계가 아니다 — 이 값으로 권한을 판정하지 않는다.
 */
import { cookies } from 'next/headers'
import { SLUG_RE, WS_COOKIE, type WorkspaceRef } from './constants'
import { listMyWorkspaces, type MyWorkspace } from './list'

export { WS_COOKIE } from './constants'

export function pickCurrentWorkspace(rows: readonly MyWorkspace[], cookieValue: string | undefined): WorkspaceRef | null {
  if (rows.length === 0) return null
  const hit = typeof cookieValue === 'string' && SLUG_RE.test(cookieValue) ? rows.find((r) => r.slug === cookieValue) : undefined
  const r = hit ?? rows[0]
  return { id: r.id, slug: r.slug, name: r.name }
}

export async function readCurrentWorkspace(): Promise<{ ok: true; ws: WorkspaceRef | null } | { ok: false; error: string }> {
  const [list, jar] = await Promise.all([listMyWorkspaces(), cookies()])
  if (!list.ok) return { ok: false, error: list.error }
  return { ok: true, ws: pickCurrentWorkspace(list.rows, jar.get(WS_COOKIE)?.value) }
}
