'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { Check, KeyRound, Mail, User as UserIcon } from 'lucide-react'
import { PageHeader } from '@/components/app/PageHeader'
import type { UiPrefs } from '@/lib/domain/types'
import type { WorkspaceNotifyOff } from '@/lib/notify/workspaceOff'
import { WorkspacePrefsSection } from './WorkspacePrefsSection'
import { NotifPrefsSection } from './NotifPrefsSection'
import { ChangePasswordModal } from '@/components/account/ChangePasswordModal'
import { MyTokensSection } from '@/components/account/MyTokensSection'
import { ThemeRadioGroup } from '@/components/account/ThemeRadioGroup'
import { rovingRadioIndex } from '@/components/account/rovingRadio'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * 내 계정 — 결정 D. 구획: 프로필 정보 · 비밀번호 변경 · 화면(테마 3단·언어 — SP3b UI-1, 결정 #21) · 알림 유형 토글(SPU1, 개정 §4.10) · PAT 발급/관리.
 * HeaderChrome 드롭다운의 비밀번호 변경 진입은 이 화면으로 이동했다(ChangePasswordModal 재사용).
 */
export function AccountView({ email, displayName, projects, currentWorkspace = null, currentWorkspaceError = false, startPage = null, projectsView = 'rows', tokenWorkspaces = [], tokenWorkspaceError = false, notif = {}, workspaceOff = {} }: {
  email: string | null
  displayName: string | null
  projects: { id: string; name: string; workspace_id?: string }[]
  tokenWorkspaces?: { id: string; name: string }[]
  tokenWorkspaceError?: boolean
  currentWorkspace?: { id: string; name: string } | null
  currentWorkspaceError?: boolean
  startPage?: UiPrefs['startPage'] | null
  projectsView?: 'rows' | 'cards'
  /** 계정 키 notif(알림 유형 → 켜짐). null = 조회 실패 — 토글을 열지 않는다 */
  notif?: Record<string, boolean> | null
  /** 소속 워크스페이스가 정책으로 끈 유형 — 토글 옆 안내용(개인 토글의 조작은 막지 않는다) */
  workspaceOff?: WorkspaceNotifyOff
}) {
  const [pwOpen, setPwOpen] = useState(false)
  const { t } = useLocale()

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      <PageHeader title={t('account.title')} />

      <div className="card p-5 sm:p-6">
        <h2 className="mt-0.5 text-sm font-semibold text-fg">{t('account.profile')}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
            <UserIcon className="h-4 w-4 text-fg-muted" />
            <div className="min-w-0">
              <div className="text-meta text-fg-secondary">{t('account.name')}</div>
              <div className="truncate text-sm text-fg">{displayName ?? '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
            <Mail className="h-4 w-4 text-fg-muted" />
            <div className="min-w-0">
              <div className="text-meta text-fg-secondary">{t('account.email')}</div>
              <div className="truncate text-sm text-fg">{email ?? '—'}</div>
            </div>
          </div>
        </div>
        <button onClick={() => setPwOpen(true)} className="btn btn-ghost mt-4">
          <KeyRound className="h-4 w-4" />{t('account.pw.change')}
        </button>
      </div>

      <div data-account-display className="card p-5 sm:p-6">
        <h2 className="mt-0.5 text-sm font-semibold text-fg">{t('chrome.display')}</h2>
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

      <WorkspacePrefsSection key={currentWorkspace?.id ?? 'none'} currentWorkspace={currentWorkspace} currentWorkspaceError={currentWorkspaceError} startPage={startPage} projectsView={projectsView} />

      <NotifPrefsSection notif={notif} workspaceOff={workspaceOff} />

      <MyTokensSection projects={projects} workspaces={tokenWorkspaces} currentWorkspaceId={currentWorkspace?.id} workspaceError={tokenWorkspaceError} />

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
