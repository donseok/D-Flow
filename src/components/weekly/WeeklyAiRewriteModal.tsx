'use client'

import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useLocale } from '@/components/providers/LocaleProvider'
import { WEEKLY_CELL_MAX } from '@/lib/domain/weeklySheet'
import type { WeeklyRewriteCandidate } from '@/lib/domain/weeklyRewrite'

export interface WeeklyAiRewriteItem extends WeeklyRewriteCandidate {
  section: string
  label: string
}

const itemKey = (item: Pick<WeeklyAiRewriteItem, 'rowId' | 'cellKey'>) =>
  `${item.rowId}:${item.cellKey}`

/** AI 결과는 저장 전 미리보기로만 보여주며, 사용자가 고른 제안만 부모의 배치 저장 경로로 넘긴다. */
export function WeeklyAiRewriteModal({
  open, busy, error, items, onClose, onRetry, onApply,
}: {
  open: boolean
  busy: boolean
  error: string | null
  items: WeeklyAiRewriteItem[]
  onClose: () => void
  onRetry: () => void
  onApply: (items: WeeklyRewriteCandidate[]) => void
}) {
  const { t } = useLocale()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!open) return
    setDrafts(Object.fromEntries(items.map(item => [itemKey(item), item.content])))
    setChecked(Object.fromEntries(items.map(item => [itemKey(item), item.content !== item.original])))
  }, [open, items])

  const selected = useMemo(() => items.flatMap(item => {
    const key = itemKey(item)
    const content = drafts[key] ?? item.content
    if (!checked[key] || !content.trim() || content === item.original) return []
    return [{ rowId: item.rowId, cellKey: item.cellKey, original: item.original, content }]
  }), [checked, drafts, items])

  // 영역 이름·칸 라벨은 사용자 데이터라 한 번에 치환한다(값 안의 치환자 꼴을 다시 읽지 않게)
  const ariaFor = (key: 'weekly.ai.selectAria' | 'weekly.ai.suggestionAria', item: WeeklyAiRewriteItem) =>
    t(key).replace(/\{(section|label)\}/g, (_, name: string) => (name === 'section' ? item.section : item.label))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('weekly.ai.title')}
      eyebrow={items.length > 0 ? t('weekly.ai.cellCount').replace('{n}', String(items.length)) : undefined}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onRetry}>{t('weekly.ai.regenerate')}</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || selected.length === 0}
            onClick={() => onApply(selected)}
          >
            {t('weekly.ai.apply')}{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-2xl border border-border bg-action-soft px-4 py-3 text-sm text-fg">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-action" />
          <p>
            {t('weekly.ai.introLead')}<b>{t('weekly.ai.introStrong')}</b>
          </p>
        </div>

        {error && (
          <StatusMessage kind="partial_error" blocking compact title={error} />
        )}

        {busy && items.length === 0 && (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-sm text-fg-secondary" aria-live="polite">
            <LoaderCircle className="h-7 w-7 animate-spin text-action" />
            {t('weekly.ai.working')}
          </div>
        )}

        {!busy && items.length === 0 && !error && (
          <p className="py-8 text-center text-sm text-fg-secondary">{t('weekly.ai.empty')}</p>
        )}

        {items.length > 0 && (
          <div className={`space-y-3 ${busy ? 'pointer-events-none opacity-60' : ''}`} aria-busy={busy}>
            {items.map(item => {
              const key = itemKey(item)
              const draft = drafts[key] ?? item.content
              const changed = draft !== item.original
              return (
                <section key={key} className="rounded-2xl border border-border bg-surface-subtle p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
                      <input
                        type="checkbox"
                        checked={!!checked[key]}
                        onChange={event => setChecked(current => ({ ...current, [key]: event.target.checked }))}
                        aria-label={ariaFor('weekly.ai.selectAria', item)}
                      />
                      <span className="truncate">{item.section}</span>
                      <span className="shrink-0 text-xs font-normal text-fg-secondary">{item.label}</span>
                    </label>
                    {!changed && <span className="shrink-0 text-xs text-fg-secondary">{t('weekly.ai.unchanged')}</span>}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-fg-secondary">{t('weekly.ai.original')}</div>
                      <div className="min-h-28 whitespace-pre-wrap break-words rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-fg-secondary">
                        {item.original}
                      </div>
                    </div>
                    <label>
                      <span className="mb-1 block text-xs font-semibold text-action">{t('weekly.ai.suggestion')}</span>
                      <textarea
                        value={draft}
                        maxLength={WEEKLY_CELL_MAX}
                        rows={5}
                        onChange={event => {
                          const content = event.target.value
                          setDrafts(current => ({ ...current, [key]: content }))
                          setChecked(current => ({ ...current, [key]: content !== item.original }))
                        }}
                        aria-label={ariaFor('weekly.ai.suggestionAria', item)}
                        className="min-h-28 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-fg outline-none transition focus:border-action focus:ring-2 focus:ring-border-focus"
                      />
                    </label>
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
