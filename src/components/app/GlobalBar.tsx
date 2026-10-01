'use client'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import type { ReactNode } from 'react'
import { BrandSlot, type ShellBrand } from './BrandSlot'
import { ContextBreadcrumb, type ContextBreadcrumbProps } from './ContextBreadcrumb'
import { NotificationBell } from './NotificationBell'
import { AccountMenu, type ShellIdentity } from './AccountMenu'

/**
 * 전역 바(★10, 개정 §5.4.1·§5.4.3) — 높이 48·전체 폭·아래 1px 경계·그림자 없음. 가운데는 찾기 자리(조작 없음 — SPU2). 티커는 없다(D28).
 * 크기별 브랜드 전환은 바깥 래퍼 span 의 정적 리터럴(로고 img 에는 display 유틸 없음 — D24). STAGING 은 레이아웃이 env 로 정해 prop 으로 내린다.
 */
export function GlobalBar({ scope, brand, homeHref, crumbs, identity, staging, aiButton, onOpenDrawer }: {
  scope: 'workspace' | 'project' | 'global'; brand: ShellBrand; homeHref: string; crumbs: ContextBreadcrumbProps
  identity: ShellIdentity | null; staging: boolean; aiButton?: ReactNode; onOpenDrawer(): void
}) {
  return (
    <header className="relative z-(--z-shell) flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <button type="button" data-drawer-trigger onClick={onOpenDrawer} aria-label="메뉴 열기" className="rounded-(--radius-control) p-2 hover:bg-surface-hover lg:hidden"><Menu size={18} aria-hidden /></button>
      <Link href={homeHref} aria-label={`${brand.productName} 홈`} className="flex shrink-0 items-center">
        <span className="hidden lg:inline-flex"><BrandSlot brand={brand} compact={false} /></span>
        <span className="lg:hidden"><BrandSlot brand={brand} compact /></span>
      </Link>
      <div className="min-w-0 flex-1"><ContextBreadcrumb {...crumbs} scope={scope} /></div>
      <div data-slot="search" aria-hidden="true"></div>
      <div className="flex shrink-0 items-center gap-1.5">
        {staging && <span className="rounded-md bg-warning px-2 py-0.5 text-meta font-bold text-warning-fg">STAGING</span>}
        {aiButton && <span className="hidden lg:inline-flex">{aiButton}</span>}
        <NotificationBell />
        <AccountMenu identity={identity} />
      </div>
    </header>
  )
}
