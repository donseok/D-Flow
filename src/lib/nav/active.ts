/**
 * 활성 내비 항목(스펙 §5.4.2, D31) — base(/w/<s>·/p/<pid>)를 떼고 항목 조각과 비교한다. 먼저 항목 조각 전체가 경로의 접두인 것 가운데
 * 가장 긴 것(admin/accounts 와 admin/teams 를 가른다 — 첫 조각만 보면 둘 다 admin), 없으면 첫 조각이 같은 항목이 하나뿐일 때 그것
 * (슬래시 조각 p.agents = agents/office 를 /p/<pid>/agents 에서). 내비 항목이 없는 경로는 레지스트리 routePrefixes 로 소유 모듈을 찾아 그 모듈의 항목으로 본다
 * (/p/<pid>/import·gantt → p.wbs). 범위 밖 경로는 절대 경로 항목(플랫폼 운영 셋 — /admin/workspaces·/admin/llm-config·/admin/ui-states)의 접두일 때만 그 항목이고
 * 나머지((global) 의 /account 등)는 null(개정 §5.3.1 — 계정은 선택 항목 없음). 브레드크럼·사용 현황 키·봇 문맥이 같이 쓴다.
 */
import { MODULES } from '@/lib/modules/registry'
import type { ModuleId } from '@/lib/modules/defaults'
import type { NavGroup, NavItemId } from './registry'

const SCOPE_RE = /^\/(w|p)\/([^/?#]+)(?:\/([^?#]*))?/

export function parseScopePath(pathname: string): { scope: 'workspace' | 'project'; key: string; base: string; rest: string[] } | null {
  const m = SCOPE_RE.exec(pathname)
  if (!m) return null
  const scope = m[1] === 'w' ? 'workspace' : 'project'
  return { scope, key: m[2], base: `/${m[1]}/${m[2]}`, rest: (m[3] ?? '').split('/').filter(Boolean) }
}

const PROJECT_PREFIX = '/p/[projectId]/'
export function projectSegmentModule(segment: string): ModuleId | null {
  for (const m of MODULES) {
    for (const p of m.routePrefixes) {
      if (p.startsWith(PROJECT_PREFIX) && p.slice(PROJECT_PREFIX.length).split('/')[0] === segment) return m.id
    }
  }
  return null
}

/** 항목 href 의 조각 목록 — base 자신이면 [](홈), 다른 범위·절대 경로 항목(플랫폼 둘)이면 null */
function itemSegments(href: string, base: string): string[] | null {
  if (href === base) return []
  if (!href.startsWith(base + '/')) return null
  return href.slice(base.length + 1).split(/[?#]/)[0].split('/').filter(Boolean)
}

export function activeNavItem(pathname: string, groups: readonly NavGroup[]): NavItemId | null {
  const p = parseScopePath(pathname)
  if (!p) {
    const path = pathname.split(/[?#]/)[0]
    const hit = groups.flatMap((g) => g.items).find((it) => !SCOPE_RE.test(it.href) && (path === it.href || path.startsWith(it.href + '/')))
    return hit ? hit.id : null
  }
  const first = p.rest[0] ?? ''
  const items = groups.flatMap((g) => g.items).map((it) => ({ id: it.id, segs: itemSegments(it.href, p.base) }))
  // ① 항목 조각 전체가 경로의 접두 — 가장 긴 것. 홈([])은 경로가 base 자신일 때만
  let best: { id: NavItemId; len: number } | null = null
  for (const it of items) {
    if (!it.segs) continue
    const hit = it.segs.length === 0 ? p.rest.length === 0 : it.segs.every((s, i) => p.rest[i] === s)
    if (hit && (!best || it.segs.length > best.len)) best = { id: it.id, len: it.segs.length }
  }
  if (best) return best.id
  // ② 첫 조각만 같은 항목이 하나뿐이면 그것(D31 — 슬래시 조각). 둘 이상이면 추측하지 않는다
  const byFirst = first ? items.filter((it) => it.segs && it.segs[0] === first) : []
  if (byFirst.length === 1) return byFirst[0].id
  if (byFirst.length > 1) return null
  if (p.scope !== 'project' || !first) return null
  const owner = projectSegmentModule(first)
  if (!owner) return null
  const navId = MODULES.find((m) => m.id === owner)?.nav?.project?.id
  return navId && items.some((it) => it.id === navId) ? navId : null
}
