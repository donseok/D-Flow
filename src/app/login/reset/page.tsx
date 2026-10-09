'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AuthCard, authInput, authLabel } from '@/components/login/AuthCard'
import { useLocale } from '@/components/providers/LocaleProvider'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { buttonClass } from '@/components/ui/buttonStyles'
import { readRecoveryLink } from '@/lib/auth/recoveryLink'
import { isValidPassword } from '@/lib/domain/accounts'
import type { DictKey } from '@/lib/i18n/dict'
import { createBrowserClient } from '@/lib/supabase/client'

type Phase = 'checking' | 'ready' | 'expired' | 'invalid' | 'done'

/**
 * 새 비밀번호 설정 — 재설정 메일의 링크가 돌아오는 화면. 링크의 결과는 주소의 조각(#…)에 있다(src/lib/auth/recoveryLink.ts).
 * ① 조각에서 재설정 토큰을 읽어 세션으로 바꾼다(setSession) ② 토큰을 주소에서 지운다(기록·뒤로가기에 남지 않게) ③ 새 비밀번호를 받는다(updateUser).
 * 재설정 토큰 없이 열면 폼을 보이지 않는다 — 이미 로그인한 사람이 이 주소로 "현재 비밀번호 확인 없는 변경"을 하지 못하게
 * (그 길은 계정 화면의 비밀번호 변경이고 현재 비밀번호를 다시 묻는다).
 * 비밀번호 규칙은 관리자 재설정·계정 생성과 같은 함수(isValidPassword — 8자 이상)다.
 */
export default function ResetPassword() {
  const { t } = useLocale()
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // 개발 모드의 이중 실행에서 두 번째 실행은 이미 지운 조각을 본다 — 한 번만 읽는다
  const read = useRef(false)

  useEffect(() => {
    if (read.current) return
    read.current = true
    const link = readRecoveryLink(window.location.hash, window.location.search)
    // 토큰·오류 표지를 주소에서 지운다 — 판독은 끝났다
    window.history.replaceState(window.history.state, '', window.location.pathname)
    if (link.kind === 'error') { setPhase('expired'); return }
    if (link.kind === 'none') { setPhase('invalid'); return }
    let alive = true
    createBrowserClient().auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
      .then(({ error: sessionError }) => { if (alive) setPhase(sessionError ? 'expired' : 'ready') })
      .catch(() => { if (alive) setPhase('expired') })
    return () => { alive = false }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    setError(null)
    if (!isValidPassword(password)) { setError(t('reset.err.tooShort')); return }
    if (password !== confirm) { setError(t('reset.err.mismatch')); return }
    setPending(true)
    try {
      const { error: updateError } = await createBrowserClient().auth.updateUser({ password })
      if (!updateError) { setPhase('done'); return }
      // 인증 서버의 원문은 화면에 내지 않는다 — 사용자가 고칠 수 있는 것(쓸 수 없는 비밀번호)과 링크 문제만 가른다
      const code = (updateError as { code?: string }).code ?? ''
      if (code === 'same_password' || code === 'weak_password') setError(t('reset.err.rejected'))
      else if (code === 'session_not_found' || code === 'session_expired' || updateError.name === 'AuthSessionMissingError') setPhase('expired')
      else setError(t('reset.err.failed'))
    } catch {
      setError(t('reset.err.failed'))
    } finally {
      setPending(false)
    }
  }

  if (phase === 'checking') {
    return <AuthCard title={t('reset.title')}><p role="status" className="text-body text-fg-muted">{t('reset.checking')}</p></AuthCard>
  }
  if (phase === 'expired' || phase === 'invalid') {
    const key = phase === 'expired' ? 'reset.expired' : 'reset.invalid'
    return (
      <AuthCard title={t('reset.title')}>
        <div data-reset-state={phase} className="space-y-4">
          <StatusMessage kind="partial_error" title={t(`${key}Title` as DictKey)} detail={t(key as DictKey)} />
          <Link href="/login/forgot" className={`${buttonClass('primary')} h-11 w-full`}>{t('reset.requestAgain')}</Link>
          <p className="text-center text-meta">
            <Link href="/login" className="font-semibold text-action underline underline-offset-2 hover:text-action-hover">{t('forgot.back')}</Link>
          </p>
        </div>
      </AuthCard>
    )
  }
  if (phase === 'done') {
    return (
      <AuthCard title={t('reset.title')}>
        <div data-reset-state="done" className="space-y-4">
          <p role="status" className="text-section text-fg">{t('reset.doneTitle')}</p>
          <p className="text-body text-fg-secondary">{t('reset.done')}</p>
          {/* 같은 브라우저의 직전 사용자 화면이 라우터 캐시에 남아 있을 수 있다 — 로그인과 같이 새로 고친다 */}
          <button type="button" className="btn btn-primary h-11 w-full" onClick={() => { router.push('/'); router.refresh() }}>
            {t('reset.continue')}
          </button>
        </div>
      </AuthCard>
    )
  }
  return (
    <AuthCard title={t('reset.title')} lead={t('reset.lead')}>
      <form onSubmit={submit} className="space-y-4" noValidate data-reset-state="ready">
        <div>
          <label htmlFor="reset-password" className={authLabel}>{t('reset.newPassword')}</label>
          <input id="reset-password" type="password" autoComplete="new-password" className={authInput}
            value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} required autoFocus />
        </div>
        <div>
          <label htmlFor="reset-confirm" className={authLabel}>{t('reset.confirmPassword')}</label>
          <input id="reset-confirm" type="password" autoComplete="new-password" className={authInput}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!error} required />
        </div>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <button type="submit" disabled={pending} className="btn btn-primary h-11 w-full">
          {pending ? t('reset.submitting') : t('reset.submit')}
        </button>
      </form>
    </AuthCard>
  )
}
