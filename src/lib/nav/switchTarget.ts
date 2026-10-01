/**
 * 프로젝트 전환의 '같은 모듈 유지'(D41, 개정 §5.3.6) — 순수. 현재 경로가 /p/<A>/<조각>/… 이면 그 조각의 소유 모듈을 보고, 대상 프로젝트에서
 * effective 면 그 모듈 항목의 href(동적 하위 경로는 접힌다), 아니면 개요 + fallbackModule. 워크스페이스 범위·알 수 없는 조각은 개요.
 * 쿼리는 보기 상태 화이트리스트만 남긴다(D36 의 group 포함). 대상 모듈 집합은 /api/nav/switch-target 이 서버에서 읽어 넘긴다.
 */
import { MODULES } from '@/lib/modules/registry'
import type { ModuleId } from '@/lib/modules/defaults'
import { parseScopePath, projectSegmentModule } from './active'

export const VIEW_QUERY_KEYS = ['view', 'density', 'scale', 'group'] as const

function keepViewQuery(search: string): string {
  const src = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const out = new URLSearchParams()
  for (const [k, v] of src) if ((VIEW_QUERY_KEYS as readonly string[]).includes(k)) out.append(k, v)
  const s = out.toString()
  return s ? `?${s}` : ''
}

export function switchTarget(input: { pathname: string; search: string; targetProjectId: string; targetModules: ReadonlySet<ModuleId> }): { href: string; fallbackModule: ModuleId | null } {
  const base = `/p/${input.targetProjectId}`
  const overview = { href: `${base}/dashboard`, fallbackModule: null }
  const p = parseScopePath(input.pathname)
  if (!p || p.scope !== 'project' || !p.rest[0]) return overview
  const owner = projectSegmentModule(p.rest[0])
  if (!owner) return overview
  if (!input.targetModules.has(owner)) return { href: `${base}/dashboard`, fallbackModule: owner }
  const segment = MODULES.find((m) => m.id === owner)?.nav?.project?.segment ?? p.rest[0]
  return { href: `${base}/${segment}${keepViewQuery(input.search)}`, fallbackModule: null }
}
