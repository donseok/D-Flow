'use client'
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PowerOff, Settings } from 'lucide-react'
import { t, type DictKey } from '@/lib/i18n/dict'
import { MODULE_LABEL_KEY } from '@/lib/modules/labels'
import type { ModuleId } from '@/lib/modules/defaults'

type Off = { layer: 'project' | 'workspace'; module: ModuleId; settingsHref: string | null }
const BODY_KEY: Record<Off['layer'], DictKey> = { project: 'home.moduleOff.project', workspace: 'home.moduleOff.workspace' }

/**
 * 404 화면의 본문 자리(BUG-22). 꺼진 모듈의 화면도 없는 화면과 같은 404 로 닫히는데(존재 은닉), 그 범위의 구성원에게는 "왜 없는지"를 알려야
 * 한다 — 메뉴에서 사라진 기능의 옛 주소·북마크로 들어온 사람이 고장으로 읽는다. 서버가 이 주소를 "꺼진 모듈 화면"이라고 확인해 줄 때만
 * (/api/nav/module-off — 그 범위를 볼 수 있는 사람에게만 답한다) 안내로 바꾼다. 그 밖(판정 실패 포함)은 받은 404 본문(children) 그대로다.
 * 첫 렌더는 늘 children 이다 — 서버가 그린 404 와 같아야 하고(수화), 페이지 응답의 notFound 표지도 그대로 남는다.
 */
export function ModuleOffSwap({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [off, setOff] = useState<Off | null>(null)
  useEffect(() => {
    if (!pathname || !/^\/(p|w)\//.test(pathname)) return     // 모듈 화면은 /p/…·/w/… 아래뿐 — 그 밖의 404 는 묻지 않는다
    let cancelled = false
    fetch(`/api/nav/module-off?path=${encodeURIComponent(pathname)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (cancelled || !body || typeof body !== 'object') return
        const b = body as Partial<Off> & { off?: boolean }
        if (b.off === true && (b.layer === 'project' || b.layer === 'workspace') && typeof b.module === 'string' && b.module in MODULE_LABEL_KEY) {
          setOff({ layer: b.layer, module: b.module, settingsHref: typeof b.settingsHref === 'string' ? b.settingsHref : null })
        }
      })
      .catch((e: unknown) => { console.warn('[module-off] 안내 판정을 받지 못했습니다 — 404 그대로:', e instanceof Error ? e.message : e) })
    return () => { cancelled = true }
  }, [pathname])

  if (!off) return <>{children}</>
  return (
    <div data-module-off={off.module} data-module-off-layer={off.layer}>
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-pending-weak text-pending">
        <PowerOff className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="mt-6 text-lg font-bold tracking-tight text-fg">{t('home.moduleOff.title')}</h1>
      <p className="mt-2 text-sm leading-6 text-fg-secondary">
        {t(BODY_KEY[off.layer]).replace('{module}', () => t(MODULE_LABEL_KEY[off.module]))}
      </p>
      {off.settingsHref
        ? <Link href={off.settingsHref} data-module-off-settings className="btn btn-ghost mt-5 w-full"><Settings className="h-4 w-4" aria-hidden />{t('home.moduleOff.openSettings')}</Link>
        : <p className="mt-2 text-sm leading-6 text-fg-secondary">{t('home.moduleOff.askAdmin')}</p>}
    </div>
  )
}
