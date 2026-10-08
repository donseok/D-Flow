import Link from 'next/link'
import { ClipboardCheck, CheckCircle2, ArrowRight } from 'lucide-react'
import type { HygieneModel } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

/** 계획 데이터 품질 — 담당 누락/기간 미설정/가중치 혼재. 전부 0이면 확인 상태. */
export async function DataHygiene({ hygiene, projectId }: { hygiene: HygieneModel; projectId: string }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const rows: { key: DictKey; n: number }[] = [
    { key: 'dash.hygiene.noOwner', n: hygiene.noOwner },
    { key: 'dash.hygiene.noDates', n: hygiene.noDates },
    { key: 'dash.hygiene.mixedWeight', n: hygiene.mixedWeight },
  ]

  return (
    <SectionCard eyebrow="DATA QUALITY" title={tr('dash.hygiene.title')} icon={ClipboardCheck}>
      {hygiene.clean ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-success-weak/40 px-4 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <div className="text-[13px] font-medium text-success">{tr('dash.hygiene.clean')}</div>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            {rows.map(r => (
              <li key={r.key} className="flex items-center justify-between rounded-xl border border-border bg-surface-subtle/40 px-3 py-2.5">
                <span className="text-[13px] font-medium text-fg">{tr(r.key)}</span>
                <span className={`badge ${r.n > 0 ? 'bg-danger-weak text-danger' : 'bg-surface-subtle text-fg-muted'}`}>
                  {r.n}{tr('dash.unitCount')}
                </span>
              </li>
            ))}
          </ul>
          <Link href={`/p/${projectId}/wbs`} className="inline-flex items-center gap-1 text-[12px] font-medium text-action hover:underline">
            {tr('dash.hygiene.goWbs')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </SectionCard>
  )
}
