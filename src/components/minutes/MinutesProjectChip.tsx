'use client'
import Link from 'next/link'
import { X } from 'lucide-react'
import { wsHref } from '@/lib/workspace/paths'
import { useLocale } from '@/components/providers/LocaleProvider'

/** '프로젝트: {이름} ×' — × 는 쿼리를 지운 링크(워크스페이스 전체로). D53 */
export function MinutesProjectChip({ slug, project }: { slug: string; project: { id: string; name: string } }) {
  const { t } = useLocale()
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-subtle px-3 py-1 text-meta font-semibold text-fg-secondary">
      {t('min.projectChip.prefix')}{project.name}
      <Link href={wsHref(slug, 'minutes')} aria-label={t('min.projectChip.clear')} className="-mr-1 rounded-full p-0.5 hover:bg-surface-hover">
        <X className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </span>
  )
}
