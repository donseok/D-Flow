'use client'
import Link from 'next/link'
import { ChevronDown, Menu } from 'lucide-react'
import type { ReactNode } from 'react'
import { BrandSlot, type ShellBrand } from './BrandSlot'
import { ContextBreadcrumb, type ContextBreadcrumbProps } from './ContextBreadcrumb'
import { NotificationBell } from './NotificationBell'
import { AccountMenu, type ShellIdentity } from './AccountMenu'

/**
 * 전역 바(★10, 개정 §5.4.1·§5.4.3) — 높이 48·전체 폭·아래 1px 경계·그림자 없음. 가운데는 찾기 자리(조작 없음 — SPU2). 티커는 없다(D28).
 * 크기별 브랜드 전환은 바깥 래퍼 span 의 정적 리터럴(로고 img 에는 display 유틸 없음 — D24). STAGING 은 레이아웃이 env 로 정해 prop 으로 내린다.
 * 768 미만은 브레드크럼 대신 범위 이름 버튼(프로젝트 → 워크스페이스 이름)이 같은 드로어를 연다(§5.4.5 "상단 범위 선택 + 메뉴" — 표시 전환은 정적 래퍼).
 */
export function GlobalBar({ scope, brand, homeHref, crumbs, identity, staging, aiButton, onOpenDrawer, workspaceSwitcher }: {
  scope: 'workspace' | 'project' | 'global'; brand: ShellBrand; homeHref: string; crumbs: ContextBreadcrumbProps
  identity: ShellIdentity | null; staging: boolean; aiButton?: ReactNode; onOpenDrawer(): void
  /** 워크스페이스 전환기(D4) — 768 이상 브레드크럼의 워크스페이스 자리. 그 아래 폭은 드로어 안의 같은 전환기 */
  workspaceSwitcher?: ReactNode
}) {
  const scopeName = crumbs.project?.name ?? crumbs.workspace?.name ?? null
  return (
    <header className="relative z-(--z-shell) flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <button type="button" data-drawer-trigger onClick={onOpenDrawer} aria-label="메뉴 열기" className="rounded-(--radius-control) p-2 hover:bg-surface-hover lg:hidden"><Menu size={18} aria-hidden /></button>
      <Link href={homeHref} aria-label={`${brand.productName} 홈`} className="flex shrink-0 items-center">
        <span className="hidden lg:inline-flex"><BrandSlot brand={brand} compact={false} /></span>
        <span className="lg:hidden"><BrandSlot brand={brand} compact /></span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="hidden min-w-0 md:block"><ContextBreadcrumb {...crumbs} scope={scope} workspaceSlot={workspaceSwitcher} /></div>
        {scopeName && (
          <button type="button" data-scope-button onClick={onOpenDrawer} aria-haspopup="dialog" aria-label={`${scopeName} — 메뉴 열기`}
            className="flex min-w-0 max-w-full items-center gap-1 rounded-(--radius-control) px-2 py-1 text-control font-semibold text-fg hover:bg-surface-hover md:hidden">
            <span className="truncate">{scopeName}</span><ChevronDown size={14} aria-hidden className="shrink-0 text-fg-secondary" />
          </button>
        )}
      </div>
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
