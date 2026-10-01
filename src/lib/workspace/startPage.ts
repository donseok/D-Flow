import type { UiPrefs } from '@/lib/domain/types'
import { UUID_RE } from '@/lib/domain/validate'
import { LEGACY_PATHS } from '@/lib/nav/legacyPaths'

/**
 * 시작 화면(D44) — 워크스페이스 키 startPage. 알 수 없는 값·접근 불가는 home. last_project 는 지금 접근 가능한 첫 최근 프로젝트.
 * 저장된 값은 클라이언트가 쓴 것이라 경로에 넣기 전에 uuid 꼴만 받는다.
 */
export function resolveStartPath(ws: { slug: string }, prefs: Pick<UiPrefs, 'startPage' | 'recentProjects'>, canOpen: (projectId: string) => boolean): string {
  const base = `/w/${encodeURIComponent(ws.slug)}`
  switch (prefs.startPage) {
    case 'my_work': return `${base}/my-work`
    // 전체 프로젝트는 과제 25 가 /w/<slug>/projects 로 옮길 때까지 옛 경로다 — 없는 경로로 보내면 404 이고 prefetch 가 끝나지 않는다(홈의 '전체 보기'와 같게).
    // 과제 25 가 legacyPaths.ts 를 지우면 타입 검사가 여기를 `${base}/projects` 로 되돌리게 한다
    case 'projects': return LEGACY_PATHS.projects
    case 'last_project': {
      const hit = (Array.isArray(prefs.recentProjects) ? prefs.recentProjects : []).find((r) => typeof r?.id === 'string' && UUID_RE.test(r.id) && canOpen(r.id))
      return hit ? `/p/${hit.id}/dashboard` : base
    }
    default: return base
  }
}
