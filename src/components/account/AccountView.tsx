'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { Check, KeyRound, Mail, User as UserIcon } from 'lucide-react'
import { PageHero } from '@/components/ui/PageHero'
import { ChangePasswordModal } from '@/components/account/ChangePasswordModal'
import { MyTokensSection } from '@/components/account/MyTokensSection'
import { ThemeRadioGroup } from '@/components/account/ThemeRadioGroup'
import { rovingRadioIndex } from '@/components/account/rovingRadio'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * 내 계정 — 결정 D. 구획: 프로필 정보 · 비밀번호 변경 · 화면(테마 3단·언어 — SP3b UI-1, 결정 #21) · PAT 발급/관리.
 * HeaderChrome 드롭다운의 비밀번호 변경 진입은 이 화면으로 이동했다(ChangePasswordModal 재사용).
 */
export function AccountView({ email, displayName, projects }: {
  email: string | null
  displayName: string | null
  projects: { id: string; name: string }[]
}) {
  const [pwOpen, setPwOpen] = useState(false)
  const { t } = useLocale()

  return (
    <div className="space-y-6">
      <PageHero eyebrow="ACCOUNT" title="내 계정" />

      <div className="card p-5 sm:p-6">
        <div className="eyebrow">Profile</div>
        <h2 className="mt-0.5 text-sm font-semibold text-ink">프로필 정보</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
            <UserIcon className="h-4 w-4 text-ink-subtle" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">이름</div>
              <div className="truncate text-sm text-ink">{displayName ?? '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
            <Mail className="h-4 w-4 text-ink-subtle" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">이메일</div>
              <div className="truncate text-sm text-ink">{email ?? '—'}</div>
            </div>
          </div>
        </div>
        <button onClick={() => setPwOpen(true)} className="btn btn-ghost mt-4">
          <KeyRound className="h-4 w-4" />비밀번호 변경
        </button>
      </div>

      <div data-account-display className="card p-5 sm:p-6">
        <div className="eyebrow">Display</div>
        <h2 className="mt-0.5 text-sm font-semibold text-ink">{t('chrome.display')}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div data-account-label className="mb-2 text-meta font-semibold text-fg-secondary">{t('chrome.theme')}</div>
            <ThemeRadioGroup />
          </div>
          <div>
            <div data-account-label className="mb-2 text-meta font-semibold text-fg-secondary">{t('chrome.language')}</div>
            <LocaleRadioGroup />
          </div>
        </div>
      </div>

      <MyTokensSection projects={projects} />

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  )
}

const LOCALES = [['ko', '한국어'], ['en', 'English']] as const

/** 언어 — 전역 바에서 뺀 언어 선택의 유일한 자리(스펙 §4.2). 서버가 쿠키로 언어를 알아 첫 렌더부터 선택을 그린다 */
function LocaleRadioGroup() {
  const { locale, setLocale, t } = useLocale()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = rovingRadioIndex(e.key, i, LOCALES.length)
    if (next === null) return
    e.preventDefault()
    setLocale(LOCALES[next][0])
    refs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={t('chrome.language')} className="grid max-w-sm grid-cols-2 gap-1 rounded-(--radius-control) border border-border bg-surface-subtle p-1">
      {LOCALES.map(([value, label], i) => {
        const on = locale === value
        return (
          <button
            key={value}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-locale-option={value}
            onClick={() => { if (!on) setLocale(value) }}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`inline-flex h-8 items-center justify-center gap-1 rounded-(--radius-control) px-2 text-xs font-medium transition-colors duration-(--motion-fast) ${on ? 'bg-surface-selected text-action' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'}`}
          >
            <Check className={`h-3.5 w-3.5 ${on ? '' : 'invisible'}`} aria-hidden />
            {label}
          </button>
        )
      })}
    </div>
  )
}
