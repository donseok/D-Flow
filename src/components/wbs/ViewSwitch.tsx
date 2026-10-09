import Link from 'next/link'
import { viewHref, type WbsView } from '@/lib/wbs/view'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
const LABEL: Record<WbsView, DictKey> = { sheet: 'wbs.view.sheet', timeline: 'wbs.view.timeline', board: 'wbs.view.board' }
export function ViewSwitch({ basePath, query, current, boardOn, locale = 'ko' }: { basePath: string; query: Record<string, string | string[] | undefined>; current: WbsView; boardOn: boolean; locale?: Locale }) {
  const views: WbsView[] = boardOn ? ['sheet', 'timeline', 'board'] : ['sheet', 'timeline']
  return <nav aria-label={t(locale, 'wbs.view.aria')} className="inline-flex w-fit rounded-(--radius-control) border border-border bg-surface p-0.5">
    {views.map(v => <Link key={v} href={viewHref(basePath, query, v)} aria-current={v === current ? 'page' : undefined} className={`rounded-(--radius-control) px-3 py-1 text-xs font-medium transition-[color,background-color] duration-(--motion-fast) ${v === current ? 'bg-surface-selected font-semibold text-action' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'}`}>{t(locale, LABEL[v])}</Link>)}
  </nav>
}
