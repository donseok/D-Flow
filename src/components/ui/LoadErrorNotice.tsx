'use client'

import { useRouter } from 'next/navigation'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 조회 실패 표시 — 위젯 자리에 '0건'·'데이터 없음' 대신 사유와 재시도를 둔다(에러 처리 3원칙 ①).
 *  message 는 사전 문구(common.loadFailed.* 등) — 로더의 ERR_* 한국어 상수는 로그·시험용이라 그대로 넘기지 않는다.
 *  onRetry 가 있으면 router.refresh() 대신 그것을 부른다 — 서버 컴포넌트가 아니라 클라이언트 로더가 읽은 데이터의 재시도.
 *  글자는 text-ink — delayed 는 delayed-weak 위 3.71:1 로 본문 AA 미만이라 비텍스트 기준(3:1)인 아이콘에만 쓴다(티커 실패 칩과 같은 처리). */
export function LoadErrorNotice({ message, retry = true, onRetry }: { message: string; retry?: boolean; onRetry?: () => void }) {
  const router = useRouter()
  const { t } = useLocale()
  return (
    <div role="alert" data-load-error className="flex items-center justify-between gap-3 rounded-xl bg-delayed-weak px-4 py-3 text-sm text-ink">
      <span className="flex min-w-0 items-center gap-2 text-ink">
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-delayed" />{message}
      </span>
      {retry && (
        <button type="button" onClick={onRetry ?? (() => router.refresh())} className="btn btn-ghost h-8 shrink-0 px-3 text-xs">
          <RotateCw className="h-3.5 w-3.5" /> {t('common.retry')}
        </button>
      )}
    </div>
  )
}
