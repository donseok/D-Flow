/** 화면 안 링크의 유일한 조립 함수(스펙 §5.2·§5.7). segment 는 navFor 항목의 조각과 같다(SHELL_NAV·모듈 nav.workspace) */
export type WsSegment = '' | 'my-work' | 'projects' | 'meetings' | 'minutes' | 'agents' | 'portfolio' | 'usage' | 'admin/accounts' | 'admin/teams' | 'settings' | 'settings/integrations'
export const WS_BASE_RE = /^\/w\/([^/]+)(\/.*)?$/

function withQuery(path: string, query?: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v !== null && v !== undefined && v !== '') qs.set(k, v)
  const s = qs.toString()
  return s ? `${path}?${s}` : path
}

export function wsHref(slug: string, segment: WsSegment = '', query?: Record<string, string | null | undefined>): string {
  const base = `/w/${encodeURIComponent(slug)}`
  return withQuery(segment ? `${base}/${segment}` : base, query)
}

export function wsMinuteHref(slug: string, minuteId: string, query?: Record<string, string | null | undefined>): string {
  return withQuery(`${wsHref(slug, 'minutes')}/${encodeURIComponent(minuteId)}`, query)
}
