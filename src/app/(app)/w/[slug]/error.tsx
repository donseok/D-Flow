'use client'
import { ScopeError } from '@/components/app/ScopeError'
import { ErrorReference } from '@/components/errors/ErrorReference'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 범위 안 페이지 오류 — 셸(전역 바·내비)은 남고 main 자리에 뜬다(D2). 참조 ID(error.digest)를 아래에 보인다(개정 §5.10.3 — 서버 로그의 같은 값과 맞춘다) */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLocale()
  return (
    <>
      <ScopeError reset={reset} />
      <ErrorReference digest={error.digest} t={t} />
    </>
  )
}
