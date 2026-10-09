'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { signOutAndClear } from '@/lib/auth/signOut'
import { buttonClass } from '@/components/ui/buttonStyles'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 로그아웃 버튼 하나 — 셸 밖 화면(소속 없음)용. 정리 규칙은 signOutAndClear 하나 */
export function SignOutButton() {
  const router = useRouter()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" disabled={busy} className={buttonClass('secondary')}
      onClick={async () => { setBusy(true); try { await signOutAndClear(router) } finally { setBusy(false) } }}>
      <LogOut className="h-4 w-4" aria-hidden />{t('chrome.logout')}
    </button>
  )
}
