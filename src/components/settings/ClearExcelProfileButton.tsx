'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eraser } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { updateProjectSettings } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import { ERR_ANON, ERR_DENIED, ERR_LOOKUP } from '@/lib/authz/errors'
import type { DictKey } from '@/lib/i18n/dict'

/** 액션 사유 → 토스트 설명 사전 키. 가드 문구만 알아보고 나머지(저장 실패 등)는 일반 문구 — 액션의 한국어를 날것으로 싣지 않는다. */
const GUARD_KEY: Record<string, DictKey> = { [ERR_DENIED]: 'common.err.denied', [ERR_ANON]: 'common.err.signIn', [ERR_LOOKUP]: 'common.err.lookup' }
const failureKey = (error: string | undefined): DictKey => (error && Object.hasOwn(GUARD_KEY, error) ? GUARD_KEY[error] : 'common.err.tryAgain')

/** 저장된 엑셀 양식 비우기(Task 1b) — 손상된 양식(내보내기 422)·WBS 보다 얕은 양식(400)으로 막힌 내보내기를 푼다.
 *  비우기는 설정 액션의 unset 이다. 되돌리려면 마법사에서 다시 저장해야 하므로 확인 모달을 거친다. 실패 사유는 토스트로. */
export function ClearExcelProfileButton({ projectId, revision }: { projectId: string; revision: number }) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await updateProjectSettings(projectId, {
        expectedRevision: revision, commandId: newUuid(), set: {}, unset: ['wbs.excel_profile'],
      })
      if (!r.ok) {
        const key: DictKey = r.kind === 'denied' ? failureKey(r.code) : r.kind === 'conflict' ? 'settings.configConflict' : 'common.err.tryAgain'
        toast({ title: t('settings.clearExcelProfileFailed'), description: t(key), variant: 'error' })
        // 충돌이면 다른 두 편집기처럼 최신 값을 다시 읽는다(비교 화면은 Phase C) — 이미 비워졌으면 버튼이 사라진다
        if (r.kind === 'conflict') { setOpen(false); router.refresh() }
        return
      }
      setOpen(false)
      toast({ title: t('settings.clearExcelProfileDone'), variant: 'success' })
      router.refresh()
    } catch (e) {
      console.error('[ClearExcelProfileButton] 호출 실패:', e)
      toast({ title: t('settings.clearExcelProfileFailed'), description: t('common.err.tryAgain'), variant: 'error' })
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
        <p className="text-sm leading-6 text-fg-secondary">{t('settings.clearExcelProfileConfirmBody')}</p>
      </Modal>
    </>
  )
}
