'use client'
import Link from 'next/link'
import { KeyRound, LogOut, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/providers/LocaleProvider'
import { ThemeRadioGroup } from '@/components/account/ThemeRadioGroup'
import { identityTeamLabel } from '@/lib/domain/identityTeams'
import { signOutAndClear } from '@/lib/auth/signOut'
import { usePopover } from './usePopover'
import type { DictKey } from '@/lib/i18n/dict'

/** teamLabels 는 teamCodes 의 표시 글자(팀 이름) — 없으면(옛 호출부) code 로 보인다. 식별은 teamCodes 다 */
/** roleKey 는 roleLabel 의 사전 키(셸이 함께 내린다) — 있으면 화면 언어로 풀고, 없으면(옛 호출부) roleLabel 글자 그대로 */
export interface ShellIdentity { displayName: string | null; roleLabel: string; roleKey?: DictKey; teamCodes: string[] | null; teamLabels?: string[] | null }

/** 계정 팝오버(★10, D28) — 관리 링크는 내비의 '운영'·'플랫폼 운영' 그룹으로 옮겼으므로 없다. 로그아웃은 signOutAndClear 하나(W16).
 *  테마 라디오·머리를 담으므로 menu 가 아니라 비모달 dialog 다(알림 벨과 같은 꼴 — 첫 항목 초점·Esc·바깥 클릭은 usePopover) */
export function AccountMenu({ identity }: { identity: ShellIdentity | null }) {
  const { t } = useLocale(); const router = useRouter()
  const { open, setOpen, triggerRef, panelRef } = usePopover()
  const role = identity ? (identity.roleKey ? t(identity.roleKey) : identity.roleLabel) : t('shell.account.guest')
  const name = identity?.displayName?.trim() || null
  const teams = identity?.teamLabels ?? identity?.teamCodes ?? null
  // 팀 모름(null)은 '—' 도 적지 않는다 — 미지정이라고 주장하지 않는다
  const sub = teams?.length ? `${role} · ${identityTeamLabel(teams)}` : role
  return (
    <div className="relative">
      <button ref={triggerRef} type="button" data-account-trigger aria-haspopup="dialog" aria-expanded={open} aria-label={t('shell.account.menuLabel').replace('{name}', () => name ?? role)} onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 hover:bg-surface-hover">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-action text-action-fg"><User size={16} aria-hidden /></span>
        <span className="hidden text-meta font-semibold text-fg sm:block">{name ?? role}</span>
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label={t('shell.account.dialog')} className="absolute right-0 top-full z-(--z-popover) mt-1 w-64 rounded-(--radius-panel) border border-border bg-surface-raised shadow-(--shadow-popover)">
          <div className="border-b border-border px-4 py-3">
            <div className="text-control font-semibold text-fg">{name ?? role}</div>
            <div data-profile-subtitle title={teams && teams.length > 1 ? teams.join(', ') : undefined} className="mt-0.5 text-meta text-fg-secondary">{sub}</div>
          </div>
          <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-3 text-control text-fg-secondary hover:bg-surface-hover hover:text-fg">
            <KeyRound size={16} aria-hidden />{t('shell.account.mine')}
          </Link>
          <div data-theme-section className="border-t border-border px-4 py-3">
            <div className="mb-2 text-meta font-semibold text-fg-secondary">{t('chrome.theme')}</div>
            <ThemeRadioGroup compact />
          </div>
          <button type="button" onClick={() => void signOutAndClear(router)} className="flex w-full items-center gap-2 border-t border-border px-4 py-3 text-left text-control text-fg-secondary hover:bg-surface-hover hover:text-danger">
            <LogOut size={16} aria-hidden />{t('chrome.logout')}
          </button>
        </div>
      )}
    </div>
  )
}
