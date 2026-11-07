'use client'

import { useRef, useState } from 'react'
import type { Minute } from '@/lib/domain/types'
import { MINUTE_BODY_MAX } from '@/lib/domain/minutes'
import { replaceMinuteBody } from '@/app/actions/minutes'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'

export function MinuteBodyEditModal({ minute, onClose, onSaved }: {
  minute: Minute
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [body, setBody] = useState(minute.bodyMd)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)
  const dirty = body !== minute.bodyMd
  const tooLong = body.length > MINUTE_BODY_MAX

  async function save() {
    if (savingRef.current || !dirty || tooLong) return
    savingRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await replaceMinuteBody(minute.id, body)
      if (!result.ok) {
        setError(result.error ?? t('min.body.saveFailed'))
        return
      }
      toast({ title: t('min.body.saved'), variant: 'success' })
      onSaved()
    } catch (e) {
      console.error('[MinuteBodyEditModal] 본문 저장 실패:', e)
      setError(t('min.body.saveFailed'))
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  return (
    <Modal open title={t('min.body.edit')} size="lg" dirty={dirty && !busy}
      onClose={() => { if (!savingRef.current) onClose() }}
      notice={(error || tooLong) && <p role="alert" className="text-sm text-danger">{tooLong ? t('min.body.tooLong') : error}</p>}
      footer={<button type="button" onClick={() => void save()} disabled={busy || !dirty || tooLong}
        className="btn btn-primary">{t(busy ? 'min.body.saving' : 'min.meta.save')}</button>}>
      <p className="mb-3 text-sm text-fg-secondary">{t('min.body.hint')}</p>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t('min.body.label')}</span>
        <textarea value={body} onChange={e => setBody(e.target.value)} disabled={busy}
          rows={18} className="app-input w-full resize-y font-mono" />
      </label>
    </Modal>
  )
}
