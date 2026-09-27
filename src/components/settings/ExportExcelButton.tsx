'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { downloadWbsExport, exportFailureKey } from '@/components/import/downloadWbsExport'

/** 설정 화면의 WBS 엑셀 내보내기(접기) — 저장 양식이 있으면 그 양식, 없으면 프로젝트 기본 레이아웃. 실패 사유는 토스트로. */
export function ExportExcelButton({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await downloadWbsExport(projectId, { expand: false })
      if (!r.ok) {
        const key = exportFailureKey(r.status, false)
        toast({ title: t('settings.exportFailed'), description: key ? t(key) : undefined, variant: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={run} disabled={busy} className="btn btn-ghost shrink-0" aria-label={t('settings.exportAria')}>
      <Download className="h-4 w-4" /> {busy ? t('settings.exporting') : t('settings.exportExcel')}
    </button>
  )
}
