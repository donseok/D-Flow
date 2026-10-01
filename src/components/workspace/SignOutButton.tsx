'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { signOutAndLeave } from '@/lib/auth/signOut'
import { buttonClass } from '@/components/ui/buttonStyles'

/** 로그아웃 버튼 하나 — 셸 밖 화면(소속 없음)용. 정리 규칙은 signOutAndLeave 하나 */
export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" disabled={busy} className={buttonClass('secondary')}
      onClick={async () => { setBusy(true); try { await signOutAndLeave(router) } finally { setBusy(false) } }}>
      <LogOut className="h-4 w-4" aria-hidden />로그아웃
    </button>
  )
}
