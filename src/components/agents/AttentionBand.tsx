'use client'
import type { Attention } from '@/lib/domain/seatmap'
import { useLocale } from '@/components/providers/LocaleProvider'
import { STATE_LABEL } from './Seat'
import css from './seatmap.module.css'

export function AttentionBand({ items, onSelect }: { items: Attention[]; onSelect: (orderId: string) => void }) {
  const { t } = useLocale()
  if (items.length === 0) return null
  return (
    <div className={css.alert} role="region" aria-label={t('agents.attention.title')}>
      <strong>{t('agents.attention.title')}</strong>
      <ul className={css.alertList}>
        {items.map(a => (
          <li key={a.orderId}>
            <button type="button" className={css.alertBtn} onClick={() => onSelect(a.orderId)}>
              <span className={css.eyebrow}>{a.floorName}</span> <b>{a.code}</b> {a.name} · {t(STATE_LABEL[a.state])} · {a.why}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
