'use client'
// 루트 레이아웃이 던진 오류의 화면 — 레이아웃을 통째로 대신하므로 자체 <html>·<body> 가 필요하다(Next 규약).
// 레이아웃이 불러오던 전역 CSS 는 따라오지 않는다 → 여기서 같은 파일을 다시 import 해 의미 토큰·공용 클래스를 그대로 쓴다(인라인 색을 따로 두지 않는다).
// 사전 공급자·테마 공급자도 없다: 로캘은 쿠키에서 직접 읽고(공개 화면이 서버에서 읽는 것과 같은 쿠키 dflow-locale), 다크는 레이아웃과 같은 no-flash 스크립트로 붙인다.
// 웹폰트 링크는 넣지 않는다 — 깨진 상태의 화면이 외부 출처에 기대지 않게(시스템 글꼴로 뜬다).
import './globals.css'
import { useCallback, useEffect, useState } from 'react'
import { StandaloneError } from '@/components/errors/StandaloneError'
import { ensureEnLoaded, t as translate, type DictKey, type Locale } from '@/lib/i18n/dict'
import { noFlashScript } from '@/lib/theme/policy'

const EN_COOKIE = /(?:^|; )dflow-locale=en(?:;|$)/

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // 첫 그림은 ko(서버·클라이언트 일치). 쿠키가 en 이면 영어 사전(지연 청크)을 받은 뒤 바꾼다 — 받지 못하면 ko 로 남는다
  const [locale, setLocale] = useState<Locale>('ko')
  useEffect(() => {
    let alive = true
    try {
      if (EN_COOKIE.test(document.cookie)) void ensureEnLoaded().then(() => { if (alive) setLocale('en') }).catch(() => {})
    } catch { /* 쿠키를 읽지 못하면 ko */ }
    return () => { alive = false }
  }, [])
  const t = useCallback((key: DictKey) => translate(locale, key), [locale])
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript() }} />
      </head>
      <body className="font-sans antialiased">
        <StandaloneError digest={error.digest} reset={reset} t={t} />
      </body>
    </html>
  )
}
