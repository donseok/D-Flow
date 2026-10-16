import type { ManualAudience } from '@/lib/manual/parse'
import { withAudience } from './labels'

/** "프로젝트 관리자용" 같은 장 표지 — 일반 사용자용(member) 장에는 붙이지 않는다(호출부가 거른다) */
export function ManualBadge({ audience }: { audience: ManualAudience }) {
  return <span data-manual-badge="" className="chip bg-action-soft text-action">{withAudience('manual.badge', audience)}</span>
}
