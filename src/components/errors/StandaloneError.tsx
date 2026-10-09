'use client'
import { buttonClass } from '@/components/ui/buttonStyles'
import type { DictKey } from '@/lib/i18n/dict'
import { ErrorReference } from './ErrorReference'

/**
 * 셸 밖 오류 화면의 본문 — 범위 밖 경로(/login·/invite·/share·루트 리졸버)의 오류(src/app/error.tsx)와 루트 레이아웃 오류(global-error.tsx)가 같이 쓴다.
 * 범위 안 오류는 ScopeError(src/components/app)가 셸 안에서 받는다 — 문구 관용구(실패한 일 → 다음 행동)와 E2E 표지 문구(error.title 의 ko)를 맞췄다.
 * 사전 공급자(LocaleProvider)가 없는 global-error 에서도 쓰이므로 번역 함수를 인자로 받는다.
 * 알림 영역은 하나다(ScopeError 와 같은 이유 — 두 영역이면 오류 순간에 두 번 낭독된다). 참조 ID 는 영역 밖에 둬 복사 알림과 겹치지 않는다.
 */
export function StandaloneError({ digest, reset, t }: { digest: string | undefined; reset: () => void; t: (key: DictKey) => string }) {
  return (
    <main id="main-content" data-standalone-error className="mx-auto flex min-h-dvh max-w-[560px] flex-col items-center justify-center gap-5 bg-canvas px-4 py-10 text-center">
      <div role="alert" className="flex flex-col items-center gap-3">
        <h1 className="text-title text-fg">{t('error.title')}</h1>
        <p className="text-body text-fg-secondary">{t('error.retryHint')} {t('error.contactHint')}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={reset} className={buttonClass('primary')}>{t('error.retry')}</button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 리졸버로 전체 새로 고침(깨진 상태에서 클라이언트 이동을 믿지 않는다) */}
          <a href="/" className={buttonClass('secondary')}>{t('error.home')}</a>
        </div>
      </div>
      <ErrorReference digest={digest} t={t} />
    </main>
  )
}
