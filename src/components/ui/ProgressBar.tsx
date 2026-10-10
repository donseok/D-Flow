'use client'

import { useLocale } from '@/components/providers/LocaleProvider'

/** 진척 바 — 트랙 + fill, 선택적 계획(planned) 마커. 트랙은 옅은 표면(2026-10-10 디자인 정비 — 경계색 트랙은 새 경계 값에서 흰 카드 위에 거의 안 보인다). */
export function ProgressBar({
  value, planned, tone = 'bg-action', height = 'h-2.5', label,
}: {
  value: number
  planned?: number
  tone?: string
  height?: string
  label?: string
}) {
  const { t } = useLocale()
  const v = Math.min(100, Math.max(0, value))
  return (
    <div className={`relative w-full overflow-visible rounded-full bg-surface-subtle ${height}`} role="progressbar" aria-label={label ?? `${t('ui.progress')} ${v}%`} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${v}%` }} />
      {planned != null && (
        <span className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-fg-secondary" style={{ left: `${Math.min(100, Math.max(0, planned))}%` }} aria-hidden />
      )}
    </div>
  )
}
