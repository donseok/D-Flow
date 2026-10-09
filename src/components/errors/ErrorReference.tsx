'use client'
import { useState } from 'react'
import { buttonClass } from '@/components/ui/buttonStyles'
import type { DictKey } from '@/lib/i18n/dict'

/**
 * 지원용 참조 ID(개정 §5.10.3 "지원용 참조 ID 를 붙인다. 기술 스택·내부 구현은 노출하지 않는다") — 렌더 오류에서는 Next 가 주는 error.digest 다.
 * 서버는 같은 digest 를 오류 로그에 남기므로(docs/runbook-selfhost.md "오류 참조 ID") 사용자가 이 값을 알려 주면 운영자가 그 로그 줄을 찾는다.
 * 오류 메시지·스택은 보이지 않는다(프로덕션의 서버 오류 메시지는 Next 가 이미 가린다). digest 가 없으면(브라우저에서만 난 오류) 아무것도 그리지 않는다.
 */
export function ErrorReference({ digest, t }: { digest: string | undefined; t: (key: DictKey) => string }) {
  const [copied, setCopied] = useState(false)
  if (!digest) return null
  async function copy() {
    try {
      await navigator.clipboard.writeText(digest!)
      setCopied(true)
    } catch {
      // 클립보드 권한이 없으면(비보안 출처 등) 조용히 둔다 — 값은 화면에 있어 직접 고를 수 있다(select-all)
      setCopied(false)
    }
  }
  return (
    <div data-error-reference className="flex flex-col items-center gap-1.5 text-center">
      <p className="text-meta text-fg-secondary">
        {t('error.refLabel')}: <code className="select-all rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-fg">{digest}</code>
      </p>
      <p className="text-meta text-fg-muted">{t('error.refHint')}</p>
      <button type="button" onClick={copy} aria-label={t('error.refCopyLabel')} className={buttonClass('ghost')}>
        {copied ? t('error.refCopied') : t('error.refCopy')}
      </button>
      {/* 복사 결과를 스크린리더에 알린다 — 버튼 글자만 바뀌면 낭독되지 않는다 */}
      <span role="status" className="sr-only">{copied ? t('error.refCopied') : ''}</span>
    </div>
  )
}
