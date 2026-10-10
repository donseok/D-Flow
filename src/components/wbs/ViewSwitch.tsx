import Link from 'next/link'
import { viewHref, type WbsView } from '@/lib/wbs/view'
import { t, type DictKey} from '@/lib/i18n/dict'
const LABEL: Record<WbsView, DictKey> = { sheet: 'wbs.view.sheet', timeline: 'wbs.view.timeline', board: 'wbs.view.board' }
/** 보기 전환(표·간트·보드) — 옅은 표면 홈 + 흰 선택 칸(2026-10-10 디자인 정비). 선택은 aria-current 와 굵기로도 알린다 */
export function ViewSwitch({ basePath, query, current, boardOn }: { basePath: string; query: Record<string, string | string[] | undefined>; current: WbsView; boardOn: boolean }) {
  const views: WbsView[] = boardOn ? ['sheet', 'timeline', 'board'] : ['sheet', 'timeline']
  return <nav aria-label={t('wbs.view.aria')} className="inline-flex w-fit gap-0.5 rounded-(--radius-control) bg-surface-subtle p-0.5">
    {views.map(v => <Link key={v} href={viewHref(basePath, query, v)} aria-current={v === current ? 'page' : undefined} className={`rounded-(--radius-control) px-3 py-1 text-xs font-medium transition-[color,background-color] duration-(--motion-fast) ${v === current ? 'bg-surface font-semibold text-fg shadow-(--shadow-card)' : 'text-fg-secondary hover:text-fg'}`}>{t(LABEL[v])}</Link>)}
  </nav>
}
