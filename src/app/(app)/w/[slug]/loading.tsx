'use client'
import { useLocale } from '@/components/providers/LocaleProvider'
export default function Loading() {
  const { t } = useLocale()
  return (
    <div className="animate-pulse space-y-5" role="status" aria-label={t('pages.loading.screen')}>
      <div className="h-40 rounded-2xl bg-border/70" />
      <div className="h-12 w-72 rounded-xl bg-border/70" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(item => <div key={item} className="h-32 rounded-2xl bg-border/70" />)}
      </div>
      <div className="h-80 rounded-2xl bg-border/70" />
    </div>
  )
}
