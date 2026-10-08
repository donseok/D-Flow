'use client'

import Link from 'next/link'
import { History, ArrowRight, FileEdit, CheckCircle2 } from 'lucide-react'

export interface DocumentVersionStatusProps {
  currentVersionNo: number | null
  viewingVersionNo: number | null
  isDraft?: boolean
  publicationState?: 'saved' | 'draft' | 'published'
  latestHref?: string
  documentType?: 'wiki' | 'minute'
  className?: string
}

/**
 * 문서 버전, 최신 여부 및 초안/게시 구분 표시 컴포넌트 (D6-§8-docs, Q11)
 * - 현재 열람 중인 버전이 최신이 아닐 경우 상단에 명확한 안내 및 최신본 링크 제공
 * - 편집 중이면 초안, 저장된 문서면 저장됨. 게시 상태는 호출자가 명시할 때만 표시한다.
 */
export function DocumentVersionStatus({
  currentVersionNo,
  viewingVersionNo,
  isDraft = false,
  publicationState,
  latestHref,
  className = '',
}: DocumentVersionStatusProps) {
  const hasVersion = currentVersionNo !== null && viewingVersionNo !== null
  const isLatest = hasVersion && viewingVersionNo === currentVersionNo
  const state = publicationState ?? (isDraft ? 'draft' : 'saved')

  return (
    <div className={`space-y-2 ${className}`} data-testid="doc-version-status">
      {/* 1. 이전 버전 열람 중 안내 배너 */}
      {hasVersion && !isLatest && (
        <div
          role="status"
          data-testid="doc-version-old-warning"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning bg-warning-weak px-3.5 py-2 text-xs text-warning dark:text-warning"
        >
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-warning dark:text-warning" />
            <span>
              이전 버전(<strong>v{viewingVersionNo}</strong>)을 열람 중입니다. 최신 버전은{' '}
              <strong>v{currentVersionNo}</strong>입니다.
            </span>
          </div>
          {latestHref && (
            <Link
              href={latestHref}
              data-testid="doc-version-latest-link"
              className="flex items-center gap-1 font-semibold text-warning dark:text-warning hover:underline shrink-0"
            >
              최신 버전 보기
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}

      {/* 2. 버전 및 상태 메타 칩 */}
      <div className="flex items-center gap-2 text-xs">
        <span
          data-testid="doc-version-badge"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-subtle px-2 py-0.5 font-medium text-fg"
        >
          {viewingVersionNo === null ? '버전 정보 없음' : `v${viewingVersionNo}`}
          {isLatest && (
            <span className="text-meta text-action font-semibold ml-0.5">(최신)</span>
          )}
        </span>

        {state === 'draft' ? (
          <span
            data-testid="doc-status-draft-chip"
            className="inline-flex items-center gap-1 rounded-md border border-warning bg-warning-weak dark:bg-warning-weak px-2 py-0.5 text-xs font-semibold text-warning dark:text-warning"
          >
            <FileEdit className="h-3 w-3" />
            초안 (Draft)
          </span>
        ) : (
          <span
            data-testid="doc-status-published-chip"
            className="inline-flex items-center gap-1 rounded-md border border-success bg-success-weak dark:bg-success-weak px-2 py-0.5 text-xs font-semibold text-success dark:text-success"
          >
            <CheckCircle2 className="h-3 w-3" />
            {state === 'saved' ? '저장된 문서' : '게시됨 (Published)'}
          </span>
        )}
      </div>
    </div>
  )
}
