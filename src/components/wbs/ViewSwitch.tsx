import Link from 'next/link'
import { viewHref, type WbsView } from '@/lib/wbs/view'
const LABEL: Record<WbsView, string> = { sheet: '표', timeline: '간트', board: '보드' }
export function ViewSwitch({ basePath, query, current, boardOn }: { basePath: string; query: Record<string, string | string[] | undefined>; current: WbsView; boardOn: boolean }) {
  const views: WbsView[] = boardOn ? ['sheet', 'timeline', 'board'] : ['sheet', 'timeline']
  return <nav aria-label="보기" className="inline-flex w-fit rounded-(--radius-control) border border-border bg-surface p-0.5">
    {views.map(v => <Link key={v} href={viewHref(basePath, query, v)} aria-current={v === current ? 'page' : undefined} className={`rounded-(--radius-control) px-3 py-1 text-xs font-medium transition-[color,background-color] duration-(--motion-fast) ${v === current ? 'bg-surface-selected font-semibold text-action' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'}`}>{LABEL[v]}</Link>)}
  </nav>
}
