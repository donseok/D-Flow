'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { downloadWbsExport, exportFailureKey } from '@/components/import/downloadWbsExport'
import { exportLayoutLabel, type ExportLayout } from './exportLayout'

/** 설정 화면의 WBS 엑셀 내보내기(접기) — 저장 양식이 있으면 그 양식, 없으면 표준 양식(프로젝트 팀·단계로 생성). 어느 쪽인지 버튼 옆에 적는다(D48).
 *  layout 이 null 이면(손상 양식·설정 조회 실패) 표기하지 않는다. 실패 사유는 토스트로. */
export function ExportExcelButton({ projectId, layout }: { projectId: string; layout: ExportLayout | null }) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await downloadWbsExport(projectId, { expand: false })
      if (!r.ok) {
        const key = exportFailureKey(r.status, false, r.code)
        toast({ title: t('settings.exportFailed'), description: key ? t(key) : undefined, variant: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-2">
      {layout && <span className="text-xs text-ink-muted" data-export-layout={layout.kind}>{exportLayoutLabel(layout, t)}</span>}
      <button type="button" onClick={run} disabled={busy} className="btn btn-ghost shrink-0" aria-label={t('settings.exportAria')}>
        <Download className="h-4 w-4" /> {busy ? t('settings.exporting') : t('settings.exportExcel')}
      </button>
    </span>
  )
}
