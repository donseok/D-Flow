import Link from 'next/link'
import { X } from 'lucide-react'
import { wsHref } from '@/lib/workspace/paths'

/** '프로젝트: {이름} ×' — × 는 쿼리를 지운 링크(워크스페이스 전체로). D53 */
export function MinutesProjectChip({ slug, project }: { slug: string; project: { id: string; name: string } }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-subtle px-3 py-1 text-meta font-semibold text-fg-secondary">
      프로젝트: {project.name}
      <Link href={wsHref(slug, 'minutes')} aria-label="프로젝트 거르기 해제" className="-mr-1 rounded-full p-0.5 hover:bg-surface-hover">
        <X className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </span>
  )
}
