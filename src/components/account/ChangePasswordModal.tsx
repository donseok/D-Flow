'use client'

import { useEffect, useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { isValidPassword } from '@/lib/domain/accounts'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * 로그인한 본인의 비밀번호 변경 — 기존/신규 두 칸만. 저장 시 즉시 적용.
 * 기존 비밀번호 재확인(signInWithPassword) 후 updateUser 로 변경. 이메일은 현재 세션에서 조회.
 * 신규 비밀번호 규칙은 관리자 재설정·계정 생성·메일 재설정과 같은 함수(isValidPassword — 8자 이상)다 — 길마다 하한이 다르면
 * 한 길에서 받은 비밀번호가 다른 길에서 거절된다. 갱신주기/강제변경 없음.
 */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setCurrent(''); setNext(''); setError(null)
  }, [open])

  function submit() {
    setError(null)
    if (!current) { setError(t('account.pw.err.currentRequired')); return }
    if (!isValidPassword(next)) { setError(t('account.pw.err.tooShort')); return }
    startTransition(async () => {
      try {
        const sb = createBrowserClient()
        const { data } = await sb.auth.getUser()
        const email = data.user?.email
        if (!email) { setError(t('account.pw.err.noSession')); return }
        // 기존 비밀번호 재확인(같은 사용자 재로그인 — 세션 유지)
        const { error: reauth } = await sb.auth.signInWithPassword({ email, password: current })
        if (reauth) {
          const code = (reauth as { code?: string }).code
          setError(code === 'invalid_credentials'
            ? t('account.pw.err.currentWrong')
            : t('account.pw.err.reauthFailed').replace('{message}', () => String(reauth.message)))
          return
        }
        const { error: updErr } = await sb.auth.updateUser({ password: next })
        if (updErr) { setError(updErr.message); return }
        toast({ title: t('account.pw.changed'), variant: 'success' })
        onClose()
      } catch {
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  return (
    <Modal
      open={open} onClose={onClose} title={t('account.pw.change')}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('common.cancel')}</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? t('account.pw.changing') : t('account.pw.submit')}</button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('account.pw.currentLabel')}</span>
          <input className="app-input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('account.pw.newLabel')}</span>
          <input className="app-input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
