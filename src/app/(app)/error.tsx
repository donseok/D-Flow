'use client'
import { ScopeError } from '@/components/app/ScopeError'
import { ErrorReference } from '@/components/errors/ErrorReference'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * 셸 없는 화면 전체 오류(§5.10) — 범위 레이아웃 자신이 던진 경우(슬러그·소속·워크스페이스 조회 실패). 셸을 그릴 수 없으므로 화면 가운데 카드와
 * '처음으로'(리졸버) 링크, 참조 ID(error.digest — 개정 §5.10.3)만 둔다. 범위 안 페이지 오류는 범위 error.tsx 셋이 셸 안에서 받는다.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLocale()
  return (
    <main id="main-content" className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-3 bg-canvas px-4">
      <ScopeError reset={reset} />
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 리졸버로 전체 새로 고침(셸이 깨진 상태에서 클라이언트 이동을 믿지 않는다) */}
      <a href="/" className="text-center text-meta font-semibold text-action hover:underline">처음으로</a>
      <ErrorReference digest={error.digest} t={t} />
    </main>
  )
}
