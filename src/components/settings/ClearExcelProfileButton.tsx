'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eraser } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { clearExcelProfile } from '@/app/actions/project'

/** 저장된 엑셀 양식 비우기(Task 1b) — 손상된 양식(내보내기 422)·WBS 보다 얕은 양식(400)으로 막힌 내보내기를 푼다.
 *  되돌리려면 마법사에서 다시 저장해야 하므로 확인 모달을 거친다. 실패 사유는 토스트로. */
export function ClearExcelProfileButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await clearExcelProfile(projectId)
      if (!r.ok) {
        toast({ title: t('settings.clearExcelProfileFailed'), description: r.error, variant: 'error' })
        return
      }
      setOpen(false)
      toast({ title: t('settings.clearExcelProfileDone'), variant: 'success' })
      router.refresh()
    } catch (e) {
      toast({ title: t('settings.clearExcelProfileFailed'), description: e instanceof Error ? e.message : undefined, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost shrink-0" disabled={busy} onClick={() => setOpen(true)}>
        <Eraser className="h-4 w-4" /> {t('settings.clearExcelProfileButton')}
      </button>
      <Modal
        open={open}
        onClose={() => { if (!busy) setOpen(false) }}
        eyebrow="EXCEL"
        title={t('settings.clearExcelProfileConfirmTitle')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>
              {busy ? t('settings.clearing') : t('settings.clearExcelProfileConfirm')}
            </button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink-muted">{t('settings.clearExcelProfileConfirmBody')}</p>
      </Modal>
    </>
  )
}
