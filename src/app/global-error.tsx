'use client'
// 루트 레이아웃이 던진 오류의 화면 — 레이아웃을 통째로 대신하므로 자체 <html>·<body> 가 필요하다(Next 규약).
// 레이아웃이 불러오던 전역 CSS 는 따라오지 않는다 → 여기서 같은 파일을 다시 import 해 의미 토큰·공용 클래스를 그대로 쓴다(인라인 색을 따로 두지 않는다).
// 사전 공급자도 없다: 문구는 사전에서 직접 꺼낸다.
// 웹폰트 링크는 넣지 않는다 — 깨진 상태의 화면이 외부 출처에 기대지 않게(시스템 글꼴로 뜬다).
import './globals.css'
import { StandaloneError } from '@/components/errors/StandaloneError'
import { t as translate, type DictKey } from '@/lib/i18n/dict'

const t = (key: DictKey) => translate(key)

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">
        <StandaloneError digest={error.digest} reset={reset} t={t} />
      </body>
    </html>
  )
}
