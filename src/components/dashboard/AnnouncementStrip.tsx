import Link from 'next/link'
import { Pin } from 'lucide-react'
import type { Announcement } from '@/lib/domain/types'
import { sortAnnouncements, isPublishedNow, ANNOUNCEMENT_META } from '@/lib/domain/announcements'
import { getServerLocale } from '@/lib/i18n/server'
import { t, type DictKey } from '@/lib/i18n/dict'

/** 게시중 공지 1건(고정 우선 → 최신) 바로가기 — 경영진 요약 안에 있던 줄을 떼어 WBS 없이도 보이게 했다.
 *  게시중 공지가 없으면 그리지 않는다. */
export async function AnnouncementStrip({ projectId, announcements, today }: {
  projectId: string
  announcements: Announcement[]
  today: string
}) {
  const notice = sortAnnouncements(announcements.filter(a => isPublishedNow(a, today)))[0] ?? null
  if (!notice) return null
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  return (
    <Link href={`/p/${projectId}/announcements`}
      className="card flex items-center gap-2.5 px-4 py-3 transition hover:bg-surface-2">
      <span className={`chip shrink-0 ${ANNOUNCEMENT_META[notice.category].chip}`}>{tr(ANNOUNCEMENT_META[notice.category].labelKey)}</span>
      {notice.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-accent-warning" />}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={notice.title}>{notice.title}</span>
      <span className="shrink-0 text-[11px] text-ink-subtle">{tr('common.viewAll')}</span>
    </Link>
  )
}
