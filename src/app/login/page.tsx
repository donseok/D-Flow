'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { BRAND } from '@/lib/branding'
import { BrandGlyph } from '@/components/ui/BrandMark'

/* 로그인 — 의미 토큰만 쓴다(SP3b UI-1, 스펙 §4.4). 평면 표면·단색 주 버튼, 부유 장식·방사 그라데이션 없음.
   공개 화면의 브랜드는 env(BRAND_*) 그대로다. 가시 h1 은 모든 크기에서 하나다. */
const FEATURES = [
  { title: 'WBS', sub: '작업분류체계' },
  { title: 'Gantt', sub: '일정 관리' },
  { title: 'Team', sub: '팀 협업' },
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

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const { error: authError } = await createBrowserClient().auth.signInWithPassword({ email, password })
    if (authError) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      setLoading(false)
    } else {
      router.push('/')
      // 클라이언트 라우터 캐시(staleTimes.dynamic 30초)에 같은 브라우저 직전 사용자의 RSC 페이로드가 남아 있을 수 있다.
      router.refresh()
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
            Project Management System
          </div>
          <p className="mt-6 text-center text-[clamp(2rem,3.6vw,3rem)] font-semibold leading-tight text-fg">{BRAND.tagline}</p>
          <p className="mx-auto mt-5 max-w-sm text-center text-body text-fg-secondary">
            WBS, 간트 차트, 팀 관리를 하나의 흐름으로.
            <br />
            프로젝트의 시작부터 완료까지 선명하게.
          </p>
          <div className="mx-auto mt-10 grid max-w-sm grid-cols-3 gap-4">
            {FEATURES.map(f => (
              <div key={f.title} className="rounded-(--radius-panel) border border-border bg-surface-subtle p-4 text-center">
                <p className="text-section text-fg">{f.title}</p>
                <p className="mt-1 text-meta text-fg-secondary">{f.sub}</p>
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
            <p className="text-body text-fg-secondary">이메일과 비밀번호로 로그인하세요.</p>
          </div>

          <div className="w-full rounded-(--radius-panel) border border-border bg-surface p-6 sm:p-8">
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-2 block text-meta font-semibold text-fg-secondary">이메일</label>
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
                <label htmlFor="password" className="mb-2 block text-meta font-semibold text-fg-secondary">비밀번호</label>
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
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
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
                {loading ? '로그인 중…' : '로그인'}
              </button>

              <p className="pt-1 text-center text-meta text-fg-muted">
                아이디(이메일) 또는 비밀번호를 잊으셨다면 관리자에게 문의하세요.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
