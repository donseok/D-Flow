'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, LogIn, ShieldCheck, UserPlus } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { endSession } from '@/lib/auth/signOut'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import {
  getInviteSessionState, redeemInvite, redeemInviteWithSignup, type InvitePreview,
} from '@/app/actions/inviteRedeem'

const E_INVALID_LINK_KEY = 'invite.err.invalidLink' satisfies DictKey
// inviteRedeem.ts 의 E5 원문. 액션 모듈은 'use server' 라 async 함수 외에는 export 할 수 없어
// 상수를 공유하지 못한다 — 문자열로 대조하므로 서버 문구를 바꾸면 여기도 함께 바꿀 것.
const E_OTHER_ACCOUNT = '이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.'
// 세션 판정 실패(네트워크 등)는 화면 언어를 따르는 사전 문구 — 상태에는 키를 담고 그릴 때 푼다(서버가 준 사유는 그대로 담긴다)
const E_SESSION_CHECK_KEY = 'invite.err.sessionCheck' satisfies DictKey

/** 서버가 내려주는 화면 분기용 세션 상태. 이메일 원문도 마스킹도 여기로 오지 않는다. */
interface SessionState { authed: boolean; emailMatches: boolean }

/**
 * 초대 수령 카드. **세션 판정을 페이지가 아니라 여기서 시작한다**(설계 P8) — /invite 는
 * 미들웨어 밖이라 RSC 에서 세션을 읽으면 만료 토큰 갱신이 쿠키 쓰기로 이어져 500 이 된다.
 * 마운트 후 서버 액션으로 물으면 액션은 쿠키를 쓸 수 있어 갱신이 정상 동작한다.
 *
 * **이메일 대조는 클라이언트에서 하지 않는다.** 마스킹은 앞 2자와 길이만 남기므로
 * `hong.gd@`와 `hong.gs@`가 같은 값이 된다 — `이름.이니셜@` 같은 주소 관례에서 흔한 충돌이다.
 * 판정은 getInviteSessionState 가 정규화된 원문끼리 하고 결과 불리언만 내려준다.
 *
 * 이 판정은 어떤 폼을 보여줄지 고르는 어포던스일 뿐이다 — 합류 허용 여부는
 * redeemInvite / redeemInviteWithSignup 이 세션과 초대 이메일을 다시 대조해 결정한다.
 */
export function InviteRedeemCard({ token, preview, loadError }: {
  token: string
  preview: InvitePreview | null
  loadError: string | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [session, setSession] = useState<SessionState | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  // 비활성 초대는 아래에서 안내 문구만 렌더하므로 세션을 물을 이유가 없다.
  const isActive = preview?.status === 'active'

  useEffect(() => {
    if (!isActive) return
    let alive = true
    // 판정 실패를 '비로그인'으로 폴백하지 않는다 — 엉뚱한 폼을 띄우느니 사유를 보여주고 멈춘다.
    getInviteSessionState(token)
      .then((res) => {
        if (!alive) return
        if (res.ok) setSession({ authed: res.authed, emailMatches: res.emailMatches })
        else setSessionError(res.error)
      })
      .catch((e) => {
        console.error('[invite] 세션 상태 확인 실패:', e instanceof Error ? e.message : e)
        if (alive) setSessionError(E_SESSION_CHECK_KEY)
      })
    return () => { alive = false }
  }, [token, isActive])

  function run(work: () => Promise<void>) {
    setBusy(true)
    startTransition(async () => {
      try {
        await work()
      } catch {
        setError(t('wsAccounts.requestFailed'))
      } finally {
        setBusy(false)
      }
    })
  }

  /**
   * 합류 처리 — 성공/실패 모두 화면에 남기고 넘어간다(조용한 실패 금지).
   *
   * `signOutOnMismatch` 는 로그인 폼 경로에서만 켠다. 방금 만든 세션이 초대와 무관한
   * 계정이었다면 되돌려야 한다 — 합류는 실패했는데 로그인만 되어버린 상태를 남기지 않는다.
   */
  async function join(signOutOnMismatch = false) {
    const res = await redeemInvite(token)
    if (!res.ok) {
      // 서버 로그아웃이 실패·던져도 로컬 세션은 지운다(endSession — 로그아웃 경로는 하나, AA8)
      if (signOutOnMismatch && res.error === E_OTHER_ACCOUNT) await endSession()
      setError(res.error)
      return
    }
    toast({
      title: res.alreadyMember ? t('invite.alreadyJoined') : t('invite.joined'),
      variant: 'success',
    })
    router.push(`/p/${res.projectId}/dashboard`)
    // 클라이언트 라우터 캐시(staleTimes.dynamic 30초)에 같은 브라우저 직전 사용자의 RSC 페이로드가 남아 있을 수 있다(로그인 화면과 같다).
    router.refresh()
  }

  function submitSignup(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    // 서버 왕복 전에 거른다 — 실패가 확실한 제출로 1회용 초대를 건드리지 않는다.
    if (password !== confirmation) { setError(t('invite.err.mismatch')); return }
    run(async () => {
      const res = await redeemInviteWithSignup(token, { name, password, passwordConfirmation: confirmation })
      if (!res.ok) { setError(res.error); return }
      // 이메일은 서버가 초대 행에서 읽어 돌려준 값이다(클라이언트가 정하지 않는다).
      const { error: signInError } = await createBrowserClient().auth
        .signInWithPassword({ email: res.email, password })
      if (signInError) {
        // 가입·합류는 이미 끝났다. 자동 로그인만 실패한 것이므로 로그인 화면으로 보낸다.
        toast({ title: t('invite.signupDoneLogin'), variant: 'info' })
        router.push('/login')
        return
      }
      toast({ title: t('invite.joined'), variant: 'success' })
      router.push(`/p/${res.projectId}/dashboard`)
      router.refresh()
    })
  }

  function submitLogin(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    // 선검증에서 이메일을 대조하지 않는다 — 클라이언트가 가진 것은 마스킹뿐이라 다른 주소끼리
    // 통과·차단이 뒤바뀐다. 판정은 redeemInvite 가 원문끼리 하고, 불일치면 아래에서 세션을 되돌린다.
    run(async () => {
      const { error: signInError } = await createBrowserClient().auth
        .signInWithPassword({ email: email.trim(), password })
      if (signInError) { setError(t('login.err.credentials')); return }
      await join(true)
    })
  }

  /* ── 무효 링크 ────────────────────────────────────────────── */
  // loadError 를 E_INVALID_LINK 로 덮지 않고 서버가 준 사유를 그대로 보여준다(에러 처리 3원칙).
  // 조회 실패(E17 '초대를 확인할 수 없어 중단했습니다.')를 '만료됨'으로 위장하면 DB 장애가
  // 곧 '링크가 만료됐다'는 안내가 되어, 멀쩡한 초대를 관리자가 재발급하게 만든다.
  if (!preview || preview.status !== 'active') {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-danger-weak text-danger">
            <AlertTriangle className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p role="alert" className="text-sm font-semibold text-fg">{loadError ?? t(E_INVALID_LINK_KEY)}</p>
            <p className="mt-1 text-sm leading-6 text-fg-secondary">
              {t('invite.oneTime')}
            </p>
          </div>
        </div>
        <Link href="/login" className="btn btn-ghost mt-5 w-full">{t('invite.toLogin')}</Link>
      </div>
    )
  }

  const errorLine = error
    ? <p role="alert" className="text-sm font-medium text-danger">{error}</p>
    : null

  return (
    <div className="card p-6">
      <p className="eyebrow">{t('invite.eyebrow')}</p>
      <h2 className="mt-2 text-lg font-semibold text-fg">{preview.projectName || t('invite.projectFallback')}</h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-fg-secondary">{t('invite.workspace')}</dt><dd className="min-w-0 break-words text-fg">{preview.workspaceName ?? '—'}</dd>
        <dt className="text-fg-secondary">{t('invite.project')}</dt><dd className="min-w-0 break-words text-fg">{preview.projectName || t('invite.projectFallback')}</dd>
        <dt className="text-fg-secondary">{t('invite.accessLabel')}</dt><dd className="text-fg">{preview.accessRole === 'admin' ? t('roster.effective.admin') : preview.accessRole === 'member' ? t('roster.effective.member') : t('roster.effective.viewer')}</dd>
        <dt className="text-fg-secondary">{t('invite.invitedEmail')}</dt><dd className="min-w-0 break-words text-fg">{preview.maskedEmail}</dd>
      </dl>
      {preview.projectDescription && (
        <p className="mt-1 text-sm leading-6 text-fg-secondary">{preview.projectDescription}</p>
      )}
      {preview.teamNames.length > 0 && (
        <p data-invite-teams className="mt-2 text-sm leading-6 text-fg-secondary">
          {t('invite.teamsBefore')}<span className="font-medium text-fg">{preview.teamNames.join(', ')}</span>{t('invite.teamsAfter')}
        </p>
      )}

      <div className="mt-5 space-y-4">
        {sessionError ? (
          /* 판정 실패 — 사유를 그대로 보여주고 폼은 띄우지 않는다(fail-closed) */
          <>
            <p role="alert" className="text-sm font-medium text-danger">{sessionError === E_SESSION_CHECK_KEY ? t(E_SESSION_CHECK_KEY) : sessionError}</p>
            <Link href="/login" className="btn btn-ghost w-full">{t('invite.toLogin')}</Link>
          </>
        ) : !session ? (
          <p className="text-sm text-fg-muted">{t('invite.checkingSession')}</p>
        ) : session.authed ? (
          session.emailMatches ? (
            /* 로그인 · 이메일 일치(서버 판정) */
            <>
              <p className="text-sm leading-6 text-fg-secondary">
                <span className="font-medium text-fg">{preview.maskedEmail}</span>{t('invite.joinAs')}
              </p>
              {errorLine}
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={busy}
                onClick={() => { setError(''); run(() => join()) }}
              >
                <ShieldCheck className="h-4 w-4" />
                {busy ? t('invite.busy') : t('invite.join')}
              </button>
            </>
          ) : (
            /* 로그인 · 이메일 불일치(서버 판정) */
            <>
              <p role="alert" className="text-sm leading-6 text-fg-secondary">
                {t('invite.otherBefore')}<span className="font-medium text-fg">{preview.maskedEmail}</span>{t('invite.otherAfter')}
              </p>
              <Link href="/login" className="btn btn-ghost w-full">{t('invite.toLogin')}</Link>
            </>
          )
        ) : preview.accountExists ? (
          /* 비로그인 · 계정 있음 — 로그인 후 이어서 합류 */
          <form onSubmit={submitLogin} className="space-y-4">
            {/* 미리보기는 마스킹된 주소만 내려준다(수신자 비노출) — 읽기 전용 1필드로 만들 수 없어
                이메일도 입력받는다. 대신 마스킹 힌트만 보여주고, 일치 판정은 서버(redeemInvite)에
                맡긴다. 불일치면 join(true) 이 방금 만든 세션을 signOut 으로 되돌린다. */}
            <div>
              <label htmlFor="invite-email" className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('login.email')}</label>
              <input
                id="invite-email"
                type="email"
                autoComplete="email"
                className="app-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <p className="mt-1.5 text-xs text-fg-muted">{t('invite.invitedAddress')}{preview.maskedEmail}</p>
            </div>
            <div>
              <label htmlFor="invite-password" className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('login.password')}</label>
              <input
                id="invite-password"
                type="password"
                autoComplete="current-password"
                className="app-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            {errorLine}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              <LogIn className="h-4 w-4" />
              {busy ? t('invite.busy') : t('invite.signInAndJoin')}
            </button>
          </form>
        ) : (
          /* 비로그인 · 계정 없음 — 가입 후 합류. 이메일 입력란은 두지 않는다(설계 P1). */
          <form onSubmit={submitSignup} className="space-y-4">
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('login.email')}</span>
              <p className="rounded-xl border border-border bg-surface-subtle px-3 py-2.5 text-sm text-fg-secondary">
                {preview.maskedEmail}
              </p>
              <p className="mt-1.5 text-xs text-fg-muted">{t('invite.signupNote')}</p>
            </div>
            <div>
              <label htmlFor="invite-name" className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('invite.name')}</label>
              <input
                id="invite-name"
                type="text"
                autoComplete="name"
                className="app-input"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="invite-new-password" className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('login.password')}</label>
              <input
                id="invite-new-password"
                type="password"
                autoComplete="new-password"
                className="app-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <p className="mt-1.5 text-xs text-fg-muted">{t('invite.pwHint')}</p>
            </div>
            <div>
              <label htmlFor="invite-password-confirm" className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('invite.pwConfirm')}</label>
              <input
                id="invite-password-confirm"
                type="password"
                autoComplete="new-password"
                className="app-input"
                value={confirmation}
                onChange={e => setConfirmation(e.target.value)}
                required
              />
            </div>
            {errorLine}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              <UserPlus className="h-4 w-4" />
              {busy ? t('invite.busy') : t('invite.signupAndJoin')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
