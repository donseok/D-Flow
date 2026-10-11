'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'

const PRESETS = [10, 30, 50, 70, 90]

/** 진척% 입력 — 프리셋 칩 + 직접입력(1~99, initial로 프리필). 진행중 진입/재개 시 사용. Modal(size sm) 기반. */
export function ProgressPopover({
  open, title, initial, onSubmit, onClose,
}: {
  open: boolean
  title: string
  initial: number
  onSubmit: (pct: number) => void
  onClose: () => void
}) {
  const { t } = useLocale()
  const [custom, setCustom] = useState(String(initial))
  const [error, setError] = useState<string | null>(null)
  // 범위 밖 값을 조용히 1·99 로 고치지 않는다 — 표의 실적% 입력처럼 거부하고 이유를 알린다(같은 값에 다른 규칙이라는 2026-10-11 사용자 테스트).
  // 이 입력은 '진행 중' 칸의 진척이라 1~99 만 받는다: 0 은 시작 전, 100 은 완료 칸으로 옮기는 일이다.
  const apply = () => {
    const n = Number(custom)
    if (!Number.isFinite(n) || n < 1 || n > 99) { setError(t('kanban.progressRange')); return }
    setError(null)
    onSubmit(Math.round(n))
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={<button className="btn btn-ghost" onClick={onClose}>{t('kanban.cancel')}</button>}
    >
      <p className="mb-3 text-sm text-fg-secondary">{t('kanban.progressDesc')}</p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <button
            key={p}
            className="badge bg-surface-subtle text-fg hover:bg-action-soft hover:text-action"
            onClick={() => onSubmit(p)}
          >{p}%</button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          type="number" min={1} max={99} inputMode="numeric"
          value={custom}
          onChange={e => { setCustom(e.target.value); setError(null) }}
          onKeyDown={e => { if (e.key === 'Enter') apply() }}
          aria-invalid={error ? true : undefined}
          placeholder={t('kanban.progressCustom')}
          aria-label={t('kanban.progressCustom')}
          className="app-input w-32"
        />
        <button
          className="btn btn-primary"
          disabled={custom.trim() === '' || Number.isNaN(Number(custom))}
          onClick={apply}
        >{t('kanban.progressApply')}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs font-medium text-danger">{error}</p>}
    </Modal>
  )
}
