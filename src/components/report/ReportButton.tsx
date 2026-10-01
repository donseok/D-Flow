'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { ReportModal } from './ReportModal'

/**
 * 대시보드 히어로의 "주간 보고서" 액션 버튼.
 * 클릭 시 인쇄/PDF 가능한 ReportModal을 연다. (라우트 아님)
 */
export function ReportButton({
  projectId,
  items,
  projectName,
  projectDescription,
  today,
  startDate,
  endDate,
  variant = 'hero',
  label = '주간 보고서',
  canGenerate,
}: {
  projectId: string
  items: ComputedItem[]
  projectName: string
  projectDescription?: string | null
  today: string
  startDate?: string | null
  endDate?: string | null
  variant?: 'hero' | 'surface'
  label?: string
  /** 모달 안 'AI 브리핑 생성' 버튼 노출 여부 = isProjectAdmin(actor, projectId). */
  canGenerate: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === 'surface'
            ? 'inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-sm transition hover:bg-surface-2'
            // 'hero' — 히어로가 밝은 표면이 된 뒤(D13·E8)의 주 동작 버튼. 옛 흰 반투명(어두운 히어로 전제)은 흰 위에서 사라진다
            : 'btn btn-primary'
        }
      >
        <FileText className="h-4 w-4" />
        {label}
      </button>

      <ReportModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        items={items}
        projectName={projectName}
        projectDescription={projectDescription}
        today={today}
        startDate={startDate}
        endDate={endDate}
        canGenerate={canGenerate}
      />
    </>
  )
}
