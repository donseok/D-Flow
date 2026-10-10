/**
 * 경로 → 그 화면의 모듈(순수). 페이지 관문이 쓰는 routePrefixes(레지스트리)와 같은 표로 읽는다 — 관문 불변식(tests/invariants/module-page-gates)의
 * 판정과 같은 규칙(세그먼트 접두 일치)이다. 꺼진 모듈 안내(BUG-22 — /api/nav/module-off)가 "이 주소가 어느 모듈의 화면인가"를 알 때 쓴다.
 * 모듈 경로가 아니면(셸 화면·설정·없는 주소) null.
 */
import { UUID_RE } from '@/lib/domain/validate'
import { SLUG_RE } from '@/lib/workspace/constants'
import type { ModuleId } from './defaults'
import { MODULES } from './registry'

export type PathModule =
  | { scope: 'project'; projectId: string; moduleId: ModuleId }
  | { scope: 'workspace'; slug: string; moduleId: ModuleId }

export function moduleOfPath(pathname: string): PathModule | null {
  const segs = pathname.split('?')[0].split('#')[0].split('/').filter(Boolean)
  if (segs.length < 3) return null
  const [root, id] = segs
  const pattern = root === 'p' ? `/p/[projectId]/${segs.slice(2).join('/')}` : root === 'w' ? `/w/[slug]/${segs.slice(2).join('/')}` : null
  if (!pattern) return null
  const hit = MODULES.find((m) => m.routePrefixes.some((p) => pattern === p || pattern.startsWith(`${p}/`)))
  if (!hit) return null
  if (root === 'p') return UUID_RE.test(id) ? { scope: 'project', projectId: id.toLowerCase(), moduleId: hit.id } : null
  return SLUG_RE.test(id) ? { scope: 'workspace', slug: id, moduleId: hit.id } : null
}
