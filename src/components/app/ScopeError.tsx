'use client'
import { StatusMessage } from '@/components/ui/StatusMessage'

/**
 * 범위 레이아웃 안의 페이지 오류(D2) — 셸은 남고 main 자리에 뜬다. 표지 문구는 E2E PAGE_MARKERS 의 error-boundary('화면을 불러오지 못했습니다')와 같다.
 * 상태 종류는 막는 부분 실패(partial_error + blocking → role="alert") — StatusKind 에 'error' 가 없다(W3).
 */
export function ScopeError({ reset }: { reset: () => void }) {
  return (
    <div data-scope-error className="flex min-h-[420px] items-center justify-center">
      <StatusMessage kind="partial_error" blocking title="화면을 불러오지 못했습니다"
        detail="잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의하세요."
        action={{ label: '다시 시도', onSelect: reset }} />
    </div>
  )
}
