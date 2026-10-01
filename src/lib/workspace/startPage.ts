import type { UiPrefs } from '@/lib/domain/types'
import { UUID_RE } from '@/lib/domain/validate'

/**
 * 시작 화면(D44) — 워크스페이스 키 startPage. 알 수 없는 값·접근 불가는 home. last_project 는 지금 접근 가능한 첫 최근 프로젝트.
 * 저장된 값은 클라이언트가 쓴 것이라 경로에 넣기 전에 uuid 꼴만 받는다.
 */
export function resolveStartPath(ws: { slug: string }, prefs: Pick<UiPrefs, 'startPage' | 'recentProjects'>, canOpen: (projectId: string) => boolean): string {
  const base = `/w/${encodeURIComponent(ws.slug)}`
  switch (prefs.startPage) {
    case 'my_work': return `${base}/my-work`
    case 'projects': return `${base}/projects`
    case 'last_project': {
      const hit = (Array.isArray(prefs.recentProjects) ? prefs.recentProjects : []).find((r) => typeof r?.id === 'string' && UUID_RE.test(r.id) && canOpen(r.id))
      return hit ? `/p/${hit.id}/dashboard` : base
    }
    default: return base
  }
}
