'use client'
import { ScopeError } from '@/components/app/ScopeError'

/** 범위 안 페이지 오류 — 셸(전역 바·내비)은 남고 main 자리에 뜬다(D2) */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ScopeError reset={reset} />
}
