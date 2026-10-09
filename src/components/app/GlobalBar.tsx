'use client'
import Link from 'next/link'
import { ChevronDown, Menu, Search } from 'lucide-react'
import { useState, useEffect, type ReactNode } from 'react'
import { BrandSlot, type ShellBrand } from './BrandSlot'
import { ContextBreadcrumb, type ContextBreadcrumbProps } from './ContextBreadcrumb'
import { NotificationBell } from './NotificationBell'
import { AccountMenu, type ShellIdentity } from './AccountMenu'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { GlobalSearchDialog, type SearchNav } from '@/components/search/GlobalSearchDialog'
import { TOUCH_TARGET } from '@/components/ui/touchTarget'

/**
 * 전역 바(★10, 개정 §5.4.1·§5.4.3) — 높이 48·전체 폭·아래 1px 경계·그림자 없음. 가운데는 ⌘K 제목 검색 슬롯(SPU2). 티커는 없다(D28).
 * 크기별 브랜드 전환은 바깥 래퍼 span 의 정적 리터럴(로고 img 에는 display 유틸 없음 — D24). STAGING 은 레이아웃이 env 로 정해 prop 으로 내린다.
 * 찾기는 워크스페이스가 확정된 셸에만 있다(없으면 대화상자가 범위 거부만 낸다) — 640 이상은 글자 상자, 그 아래는 아이콘 버튼(둘 다 정적 리터럴 전환).
 * 768 미만은 브레드크럼 대신 범위 이름 버튼(프로젝트 → 워크스페이스 이름)이 같은 드로어를 연다(§5.4.5 "상단 범위 선택 + 메뉴" — 표시 전환은 정적 래퍼).
 */
export function GlobalBar({
  scope,
  brand,
  homeHref,
  crumbs,
  identity,
  staging,
  aiButton,
  onOpenDrawer,
  workspaceSwitcher,
  projectSwitcher,
  syncStatus,
  workspaceId,
  projectId,
  projectName,
  searchNav,
}: {
  scope: 'workspace' | 'project' | 'global'
  brand: ShellBrand
  homeHref: string
  crumbs: ContextBreadcrumbProps
  identity: ShellIdentity | null
  staging: boolean
  aiButton?: ReactNode
  onOpenDrawer(): void
  /** 워크스페이스 전환기(D4) — 768 이상 브레드크럼의 워크스페이스 자리. 그 아래 폭은 드로어 안의 같은 전환기 */
  workspaceSwitcher?: ReactNode
  /** 프로젝트 전환기(AA1) — 768 이상 브레드크럼의 프로젝트 자리(사이드바가 레일인 폭에서도 닿게). 그 아래 폭은 드로어 안의 전환기 */
  projectSwitcher?: ReactNode
  /** 동기화 상태 표시 슬롯(SPU1). 미지정 시 기본 SyncStatus 사용 */
  syncStatus?: ReactNode
  workspaceId?: string
  projectId?: string
  projectName?: string
  /** 검색 대화상자의 메뉴 — 사이드 내비와 같은 해석 결과(navigation.menu). 없으면 메뉴 없이 제목 검색만 */
  searchNav?: SearchNav
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const scopeName = crumbs.project?.name ?? crumbs.workspace?.name ?? null
  const canSearch = !!workspaceId

  // ⌘K / Ctrl+K 단축키 리스너
  useEffect(() => {
    if (!canSearch) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canSearch])

  // 프로젝트 ID 추출 (프롭 우선, 없으면 crumbs 해석)
  const resolvedProjectId =
    projectId ??
    (crumbs.project?.href ? crumbs.project.href.replace(/^\/p\//, '').split('/')[0] : undefined)
  return (
    <header className="relative z-(--z-shell) flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <button type="button" data-drawer-trigger onClick={onOpenDrawer} aria-label="메뉴 열기" className={`rounded-(--radius-control) p-2 hover:bg-surface-hover lg:hidden ${TOUCH_TARGET}`}><Menu size={18} aria-hidden /></button>
      <Link href={homeHref} aria-label={`${brand.productName} 홈`} className="flex shrink-0 items-center">
        <span className="hidden lg:inline-flex"><BrandSlot brand={brand} compact={false} /></span>
        <span className="lg:hidden"><BrandSlot brand={brand} compact /></span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="hidden min-w-0 md:block"><ContextBreadcrumb {...crumbs} scope={scope} workspaceSlot={workspaceSwitcher} projectSlot={projectSwitcher} /></div>
        {scopeName && (
          <button type="button" data-scope-button onClick={onOpenDrawer} aria-haspopup="dialog" aria-label={`${scopeName} — 메뉴 열기`}
            className="flex min-w-0 max-w-full items-center gap-1 rounded-(--radius-control) px-2 py-1 text-control font-semibold text-fg hover:bg-surface-hover md:hidden">
            <span className="truncate">{scopeName}</span><ChevronDown size={14} aria-hidden className="shrink-0 text-fg-secondary" />
          </button>
        )}
      </div>
      {canSearch && <div data-slot="search" className="hidden sm:flex items-center">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 rounded-(--radius-control) border border-border bg-surface px-2.5 py-1 text-control text-fg-secondary hover:bg-surface-hover hover:text-fg"
          aria-label="전역 검색 (⌘K)"
        >
          <Search size={14} aria-hidden />
          <span className="text-meta">제목 검색...</span>
          <kbd className="ml-1.5 rounded border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] font-mono text-fg-muted">⌘K</kbd>
        </button>
      </div>}
      {canSearch && (
        <button type="button" data-search-mobile onClick={() => setSearchOpen(true)} aria-label="제목 검색"
          className={`shrink-0 rounded-(--radius-control) p-2 text-fg-secondary hover:bg-surface-hover hover:text-fg sm:hidden ${TOUCH_TARGET}`}>
          <Search size={18} aria-hidden />
        </button>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        <div data-slot="sync-status">{syncStatus ?? <SyncStatus />}</div>
        {staging && <span className="rounded-md bg-warning px-2 py-0.5 text-meta font-bold text-warning-fg">STAGING</span>}
        {aiButton && <span className="hidden lg:inline-flex">{aiButton}</span>}
        <NotificationBell />
        <AccountMenu identity={identity} />
      </div>
      {canSearch && (
        <GlobalSearchDialog
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          workspaceId={workspaceId}
          projectId={resolvedProjectId}
          projectName={crumbs.project?.name ?? projectName}
          nav={searchNav ?? { workspace: [], project: null }}
          productName={brand.productName}
        />
      )}
    </header>
  )
}
