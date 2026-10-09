'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { requestPasswordReset } from '@/app/actions/passwordReset'
import { AuthCard, authInput, authLabel, authLink } from '@/components/login/AuthCard'
import { useLoginEnv } from '@/components/login/LoginEnv'
import { useLocale } from '@/components/providers/LocaleProvider'
import { StatusMessage } from '@/components/ui/StatusMessage'
import type { DictKey } from '@/lib/i18n/dict'

/** 같은 화면에서 다시 보낼 수 있을 때까지의 잠금(초) — 인증 서버가 같은 주소에 두는 간격과 같은 크기. 남용 방지의 본체는 인증 서버의 발송 제한이다 */
const RESEND_LOCK_SECONDS = 60

/**
 * 비밀번호 분실 — 재설정 메일 요청. 응답은 계정이 있든 없든 같다("가입된 계정이 있으면 보냈습니다") — 화면이 가입 여부를 알려 주지 않는다.
 * 보낸 뒤에는 폼을 치우고 안내만 남긴다. 다시 보내기는 잠금 시간이 지난 뒤에 열린다(연속 제출 방지).
 * 메일을 보내지 않는 배포에서 주소를 직접 쳐서 들어오면 폼 대신 "관리자에게 문의"를 보인다.
 */
export default function ForgotPassword() {
  const { t } = useLocale()
  const { mailReset } = useLoginEnv()
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [lock, setLock] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (lock <= 0) return
    const id = window.setTimeout(() => setLock((n) => n - 1), 1000)
    return () => window.clearTimeout(id)
  }, [lock])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || lock > 0) return
    setError(null)
    setPending(true)
    try {
      const res = await requestPasswordReset(email)
      if (res.ok) { setSent(true); setLock(RESEND_LOCK_SECONDS) }
      else setError(t(`forgot.err.${res.code}` as DictKey))
    } catch {
      setError(t('forgot.err.failed'))
    } finally {
      setPending(false)
    }
  }

  const back = (
    <p className="pt-2 text-center text-meta">
      <Link href="/login" className={authLink}>{t('forgot.back')}</Link>
    </p>
  )

  if (!mailReset) {
    return (
      <AuthCard title={t('forgot.title')}>
        <StatusMessage kind="disabled" title={t('forgot.unavailableTitle')} detail={t('forgot.err.unavailable')} />
        {back}
      </AuthCard>
    )
  }

  if (sent) {
    return (
      <AuthCard title={t('forgot.title')}>
        <div className="space-y-4" data-forgot-sent>
          <p role="status" className="text-section text-fg">{t('forgot.sentTitle')}</p>
          <p className="text-body text-fg-secondary">{t('forgot.sent')}</p>
          <button type="button" className="btn btn-ghost h-11 w-full" disabled={lock > 0} onClick={() => { setSent(false); setEmail('') }}>
            {t('forgot.again')}{lock > 0 ? ` (${lock})` : ''}
          </button>
          {back}
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={t('forgot.title')} lead={t('forgot.lead')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="forgot-email" className={authLabel}>{t('login.email')}</label>
          <input
            id="forgot-email" type="email" autoComplete="email" placeholder="user@example.com" className={authInput}
            value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} required autoFocus
          />
        </div>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <button type="submit" disabled={pending || lock > 0} className="btn btn-primary h-11 w-full">
          {pending ? t('forgot.submitting') : t('forgot.submit')}
        </button>
        {back}
      </form>
    </AuthCard>
  )
}
