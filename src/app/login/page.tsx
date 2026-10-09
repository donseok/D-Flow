'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Sparkles, Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { BRAND } from '@/lib/branding'
import { BrandGlyph } from '@/components/ui/BrandMark'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useLoginEnv } from '@/components/login/LoginEnv'
import { recoveryFragment } from '@/lib/auth/recoveryLink'

/* 로그인 — 의미 토큰만 쓴다(SP3b UI-1, 스펙 §4.4). 평면 표면·단색 주 버튼, 부유 장식·방사 그라데이션 없음.
   공개 화면의 브랜드는 env(BRAND_*) 그대로다. 가시 h1 은 모든 크기에서 하나다. 문구는 사전(auth) — 로캘을 따른다. */
const FEATURES = [
  { title: 'login.feature.wbs', sub: 'login.feature.wbsSub' },
  { title: 'login.feature.gantt', sub: 'login.feature.ganttSub' },
  { title: 'login.feature.team', sub: 'login.feature.teamSub' },
] as const

const inputBase =
  'h-11 w-full rounded-(--radius-control) border border-border-input bg-surface text-base text-fg outline-none transition-[border-color] duration-(--motion-fast) placeholder:text-fg-muted focus:border-border-focus focus:ring-2 focus:ring-border-focus/25'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { t } = useLocale()
  const { mailReset, localDev } = useLoginEnv()

  // 재설정 메일의 링크가 이 화면으로 떨어진 경우(인증 서버가 돌아갈 주소를 받아들이지 않으면 기본 주소 → 미들웨어 → /login 으로 온다) —
  // 주소의 조각(#…)을 그대로 들고 새 비밀번호 화면으로 넘긴다. 조각은 서버로 가지 않으므로 여기(브라우저)서만 볼 수 있다.
  useEffect(() => {
    const fragment = recoveryFragment(window.location.hash)
    if (fragment) router.replace(`/login/reset${fragment}`)
  }, [router])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error: authError } = await createBrowserClient().auth.signInWithPassword({ email, password })
      if (authError) {
        setError(t('login.err.credentials'))
        setLoading(false)
      } else {
        router.push('/')
        // 클라이언트 라우터 캐시(staleTimes.dynamic 30초)에 같은 브라우저 직전 사용자의 RSC 페이로드가 남아 있을 수 있다.
        router.refresh()
      }
    } catch {
      // 로컬 DB 를 켜라는 말은 개발자에게만 뜻이 있다 — 배포 화면에서는 사용자가 할 수 있는 말만 한다
      setError(t(localDev ? 'login.err.unreachableDev' : 'login.err.unreachable'))
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-canvas text-fg">
      {/* ── 좌측 소개(lg 이상) ─────────────────────────────── */}
      <div className="hidden flex-1 items-center justify-center lg:flex">
        <div className="mx-10 flex h-[calc(100vh-5rem)] w-full max-w-xl flex-col items-center justify-center rounded-(--radius-panel) border border-border bg-surface p-12">
          <div className="mx-auto mb-8 w-fit">
            <BrandGlyph size={80} />
          </div>
          <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface-subtle px-3.5 py-1.5 text-meta font-semibold text-fg-secondary">
            <Sparkles className="h-3.5 w-3.5 text-action" aria-hidden />
            {t('login.pill')}
          </div>
          <p className="mt-6 text-center text-[clamp(2rem,3.6vw,3rem)] font-semibold leading-tight text-fg">{BRAND.tagline}</p>
          <p className="mx-auto mt-5 max-w-sm text-center text-body text-fg-secondary">
            {t('login.intro1')}
            <br />
            {t('login.intro2')}
          </p>
          <div className="mx-auto mt-10 grid max-w-sm grid-cols-3 gap-4">
            {FEATURES.map(f => (
              <div key={f.title} className="rounded-(--radius-panel) border border-border bg-surface-subtle p-4 text-center">
                <p className="text-section text-fg">{t(f.title)}</p>
                <p className="mt-1 text-meta text-fg-secondary">{t(f.sub)}</p>
              </div>
            ))}
          </div>
          {BRAND.copyright && <div className="mt-auto pt-6 text-meta text-fg-muted">{BRAND.copyright}</div>}
        </div>
      </div>

      {/* ── 로그인 폼 ────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:items-start lg:text-left">
            <span className="lg:hidden"><BrandGlyph size={56} /></span>
            <h1 className="text-title text-fg">{BRAND.productName}</h1>
            {/* env 태그라인 — lg 이상은 소개 카드가 보인다(스펙 E14 "env 브랜드는 그대로") */}
            <p className="text-body text-fg-secondary lg:hidden">{BRAND.tagline}</p>
            <p className="text-body text-fg-secondary">{t('login.lead')}</p>
          </div>

          <div className="w-full rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8">
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-2 block text-meta font-semibold text-fg-secondary">{t('login.email')}</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="user@example.com"
                    className={`${inputBase} pl-10 pr-4`}
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    aria-invalid={!!error}
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-meta font-semibold text-fg-secondary">{t('login.password')}</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className={`${inputBase} pl-10 pr-11`}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    aria-invalid={!!error}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(previous => !previous)}
                    aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-muted transition-colors duration-(--motion-fast) hover:text-fg"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="text-sm font-medium text-danger">{error}</p>
              )}

              <button type="submit" disabled={loading} className="btn btn-primary h-11 w-full">
                <LogIn className="h-4 w-4" aria-hidden />
                {loading ? t('login.submitting') : t('login.submit')}
              </button>

              {/* 메일을 보내지 않는 배포에서는 링크를 숨기고 지금까지의 안내(관리자에게 문의)를 그대로 둔다 */}
              {mailReset && (
                <p className="pt-1 text-center text-meta">
                  <Link href="/login/forgot" data-forgot-link className="font-semibold text-action underline underline-offset-2 hover:text-action-hover">
                    {t('login.forgotLink')}
                  </Link>
                </p>
              )}
              <p className="pt-1 text-center text-meta text-fg-muted">
                {t(mailReset ? 'login.helpWithMail' : 'login.helpNoMail')}
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
