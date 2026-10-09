'use client'

import { useState } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { ImportWizard } from '@/components/import/ImportWizard'
import { WbsMarkdownImport } from '@/components/import/WbsMarkdownImport'

/**
 * 임포트 모드 전환 — wbs.md(levels 계약 N단, 자동 부착) | 엑셀(.xlsx 위저드).
 * 기본은 마크다운: N단 분리 업로드의 정본 경로. 엑셀 위저드는 레거시·표 형태 입력용으로 유지.
 * 미등록 팀 등록은 프로젝트 관리자 몫이라(SP4 D4) 슈퍼유저 여부를 넘기지 않는다.
 */
export function ImportModes({ projectId, currentItemCount, timeZone, extraAxisLabel = null }: {
  projectId: string; currentItemCount: number | null
  /** 프로젝트 달력 tz — 엑셀 마법사의 백업 파일 날짜(null = 달력을 못 읽음) */
  timeZone: string | null
  /** 프로젝트의 추가 축 이름(core.extra_axis_label) — 엑셀 마법사의 그 열 이름. null 은 사전 기본 문구 */
  extraAxisLabel?: string | null
}) {
  const [mode, setMode] = useState<'md' | 'xlsx'>('md')
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-xl bg-surface-subtle p-1 w-fit" role="tablist">
        <button
          role="tab" aria-selected={mode === 'md'} data-mode-md
          className={`btn ${mode === 'md' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode('md')}
        >
          <FileText className="h-3.5 w-3.5" />WBS 마크다운 (wbs.md)
        </button>
        <button
          role="tab" aria-selected={mode === 'xlsx'} data-mode-xlsx
          className={`btn ${mode === 'xlsx' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode('xlsx')}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />엑셀 (.xlsx)
        </button>
      </div>
      {mode === 'md'
        ? <WbsMarkdownImport projectId={projectId} />
        : <ImportWizard projectId={projectId} currentItemCount={currentItemCount} timeZone={timeZone} extraAxisLabel={extraAxisLabel} />}
    </div>
  )
}
