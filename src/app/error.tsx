'use client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { StandaloneError } from '@/components/errors/StandaloneError'

/**
 * 범위 밖 경로의 오류 경계 — (app) 그룹 밖 화면(/login·/invite/[token]·/share/minutes/[token]·루트 리졸버)이 던진 오류를 받는다.
 * 이 파일이 없으면 Next 기본 오류 화면(영문 "Application error")이 뜬다. (app) 그룹 안은 그쪽 error.tsx 가 먼저 받는다.
 * 루트 레이아웃은 살아 있으므로 사전 공급자(LocaleProvider)와 전역 CSS 를 그대로 쓴다. 루트 레이아웃 자신의 오류는 global-error.tsx 다.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLocale()
  return <StandaloneError digest={error.digest} reset={reset} t={t} />
}
