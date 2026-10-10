'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Search, X, FolderOpen, ListTodo, ArrowRight, Loader2 } from 'lucide-react'
import { useEscHandler, ESC_PRIORITY } from '@/lib/ui/escStack'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { searchTitles, type SearchProjectItem, type SearchWbsItem } from '@/app/actions/globalSearch'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { NavGroup } from '@/lib/nav/registry'

/** 검색 대화상자가 보일 메뉴 — 사이드 내비와 같은 navFor 결과다(저장한 순서·이름 navigation.menu, 모듈·권한으로 걸러진 항목).
 *  손으로 적은 목록을 두지 않는다: 꺼진 모듈·권한 없는 화면이 검색에만 뜨거나, 바꾼 메뉴 이름이 검색에서만 옛 이름으로 남는다. */
export interface SearchNav {
  workspace: readonly NavGroup[]
  /** 프로젝트 범위의 셸에서만 — 그 밖에서는 null */
  project: readonly NavGroup[] | null
}

export interface GlobalSearchDialogProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  projectId?: string | null
  projectName?: string | null
  nav: SearchNav
  /** 그 워크스페이스의 제품 이름(branding.product_name) — 셸의 브랜드와 같은 값 */
  productName: string
}

/** 설정 화면만 갈래 이름이 다르다(옛 고정 목록과 같은 표기) */
const SETTINGS_ITEMS: ReadonlySet<string> = new Set(['ws.settings', 'p.settings'])

type ResultItem =
  | { kind: 'nav'; id: string; title: string; subtitle: string; href: string }
  | { kind: 'project'; id: string; title: string; subtitle: string; href: string }
  | { kind: 'wbs'; id: string; title: string; subtitle: string; href: string }

export function GlobalSearchDialog({
  open,
  onClose,
  workspaceId,
  projectId,
  projectName,
  nav,
  productName,
}: GlobalSearchDialogProps) {
  const router = useRouter()
  const { t } = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'workspace' | 'project'>(projectId ? 'project' : 'workspace')
  const [projects, setProjects] = useState<SearchProjectItem[]>([])
  const [wbsItems, setWbsItems] = useState<SearchWbsItem[]>([])
  // 실패(조회 오류·범위 거부)와 0건은 다른 상태다 — 0건은 서버가 답한 검색어(answered)가 지금 검색어와 같을 때만 말한다
  const [searchError, setSearchError] = useState<{ reason: 'denied' | 'failed'; message: string | null } | null>(null)
  const [answered, setAnswered] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isPending, startTransition] = useTransition()

  // Esc 핸들러 등록 (MODAL 우선순위)
  useEscHandler(
    useCallback(() => {
      onClose()
    }, [onClose]),
    { priority: ESC_PRIORITY.MODAL, enabled: open }
  )

  // 모달 오픈 시 포커스 및 초기화
  useEffect(() => {
    if (open) {
      setQuery('')
      setProjects([])
      setWbsItems([])
      setSearchError(null)
      setAnswered(null)
      setSelectedIndex(0)
      setScope(projectId ? 'project' : 'workspace')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, projectId])

  // 네비게이션 바로가기 항목 — 셸이 내려 준 메뉴(navFor)를 그대로 편다: 순서·이름·주소 모두 사이드 내비와 같다
  const inProject = scope === 'project' && !!projectId && nav.project !== null
  const needle = query.trim().toLowerCase()
  const allNavItems: ResultItem[] = (inProject ? nav.project ?? [] : nav.workspace)
    .flatMap((g) => g.items)
    .map((item) => ({
      kind: 'nav' as const,
      id: `nav-${item.id}`,
      title: typeof item.label === 'string' ? item.label : t(item.label.key),
      subtitle: `${inProject ? projectName ?? t('search.sub.project') : t('search.sub.workspace')} · ${SETTINGS_ITEMS.has(item.id) ? t('search.sub.settings') : t('search.sub.go')}`,
      href: item.href,
    }))
    .filter((item) => !needle || item.title.toLowerCase().includes(needle))

  // 검색 트리거 (디바운스)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setProjects([])
      setWbsItems([])
      setSearchError(null)
      setAnswered(null)
      return
    }

    let stale = false   // 늦게 온 앞 검색어의 응답이 지금 결과를 덮지 않게
    const timer = setTimeout(() => {
      startTransition(async () => {
        // 요청 자체가 실패하면 error 를 null 로 둔다 — 문구는 렌더에서 고른다
        let res: Awaited<ReturnType<typeof searchTitles>> | { ok: false; reason: 'failed'; error: null }
        try {
          res = await searchTitles({
            workspaceId,
            query: q,
            scope,
            projectId: scope === 'project' ? projectId : null,
          })
        } catch {
          res = { ok: false, reason: 'failed', error: null }
        }
        if (stale) return
        if (!res.ok) {
          setSearchError({ reason: res.reason, message: res.error })
          setAnswered(null)
          setProjects([])
          setWbsItems([])
        } else {
          setSearchError(null)
          setAnswered(q)
          setProjects(res.projects)
          setWbsItems(res.wbsItems)
        }
      })
    }, 180)

    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, scope, workspaceId, projectId, retry])

  // 전체 표시 결과 리스트
  const combinedItems: ResultItem[] = [
    ...allNavItems,
    ...projects.map((p) => ({
      kind: 'project' as const,
      id: `proj-${p.id}`,
      title: p.name,
      subtitle: t('search.sub.project'),
      href: p.href,
    })),
    ...wbsItems.map((w) => ({
      kind: 'wbs' as const,
      id: `wbs-${w.id}`,
      title: `${w.code} ${w.title}`,
      subtitle: t('search.sub.wbs'),
      href: w.href,
    })),
  ]

  // 선택 인덱스 범위 보정
  useEffect(() => {
    if (selectedIndex >= combinedItems.length) {
      setSelectedIndex(Math.max(0, combinedItems.length - 1))
    }
  }, [combinedItems.length, selectedIndex])

  const handleSelect = (item: ResultItem) => {
    onClose()
    router.push(item.href)
  }

  // 키보드 조작
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, combinedItems.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + Math.max(1, combinedItems.length)) % Math.max(1, combinedItems.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = combinedItems[selectedIndex]
      if (selected) {
        handleSelect(selected)
      }
    }
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('search.dialogAria')}
      className="fixed inset-0 z-(--z-modal) flex items-start justify-center bg-black/50 p-4 pt-16 sm:pt-24 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        onKeyDown={handleKeyDown}
      >
        {/* 검색창 상단 헤더 */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search size={18} className="text-fg-secondary shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder={scope === 'project' ? t('search.placeholderProject') : t('search.placeholderWorkspace')}
            aria-label={t('search.inputAria')}
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          />
          {isPending && <Loader2 size={16} className="animate-spin text-fg-muted shrink-0" />}
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              className="rounded p-1 text-fg-muted hover:text-fg"
              aria-label={t('search.clearInput')}
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:text-fg"
            aria-label={t('common.close')}
          >
            <span className="text-xs font-mono">ESC</span>
          </button>
        </div>

        {/* 범위 칩 바 */}
        <div className="flex items-center justify-between border-b border-border bg-surface-subtle/50 px-3 py-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-fg-muted">{t('search.scopeLabel')}</span>
            {projectId && (
              <button
                type="button"
                onClick={() => {
                  setScope('project')
                  setSelectedIndex(0)
                }}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  scope === 'project'
                    ? 'bg-action text-action-fg'
                    : 'bg-surface text-fg-secondary hover:bg-surface-hover'
                }`}
              >
                {projectName ? `${projectName}` : t('search.scopeCurrentProject')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setScope('workspace')
                setSelectedIndex(0)
              }}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                scope === 'workspace'
                  ? 'bg-action text-action-fg'
                  : 'bg-surface text-fg-secondary hover:bg-surface-hover'
              }`}
            >
              {t('search.scopeWorkspace')}
            </button>
          </div>
          <span className="text-meta text-fg-muted">{t('search.titleOnly')}</span>
        </div>

        {/* 결과 리스트 영역 */}
        <div className="max-h-80 overflow-y-auto p-2" role="listbox">
          {searchError && (
            <div className="px-3 pb-1" data-search-state={searchError.reason}>
              {searchError.reason === 'failed' ? (
                <StatusMessage
                  compact
                  kind="partial_error"
                  title={t('search.err.failedTitle')}
                  detail={`${searchError.message ?? t('search.err.requestFailed')}${t('search.err.notEmptySuffix')}`}
                  action={{ label: t('search.retry'), onSelect: () => setRetry((n) => n + 1) }}
                />
              ) : (
                <StatusMessage compact kind="disabled" title={t('search.err.deniedTitle')} detail={searchError.message ?? t('search.err.requestFailed')} />
              )}
            </div>
          )}

          {!searchError && combinedItems.length === 0 && query.trim() && answered === query.trim() && (
            <div className="px-3" data-search-state="empty">
              <StatusMessage
                compact
                kind="empty"
                title={t('search.emptyTitle').replace('{q}', () => query.trim())}
                detail={scope === 'project' ? t('search.emptyDetailProject') : t('search.emptyDetailWorkspace')}
              />
            </div>
          )}

          {combinedItems.map((item, idx) => {
              const isSelected = idx === selectedIndex
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    isSelected ? 'bg-surface-hover text-fg' : 'text-fg-secondary hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {item.kind === 'nav' && <ArrowRight size={15} className="text-fg-muted shrink-0" />}
                    {item.kind === 'project' && <FolderOpen size={15} className="text-action shrink-0" />}
                    {item.kind === 'wbs' && <ListTodo size={15} className="text-success shrink-0" />}
                    <div className="min-w-0">
                      <div className="truncate font-medium text-fg">{item.title}</div>
                      <div className="truncate text-xs text-fg-muted">{item.subtitle}</div>
                    </div>
                  </div>
                  {isSelected && <span className="text-xs text-fg-muted font-mono shrink-0">↵</span>}
                </div>
              )
            })}
        </div>

        {/* 키보드 도움말 하단 바 */}
        <div className="flex items-center justify-between border-t border-border bg-surface-subtle/30 px-3 py-1.5 text-meta text-fg-muted">
          <div className="flex items-center gap-3">
            <span>{t('search.hintMove')}</span>
            <span>{t('search.hintSelect')}</span>
            <span>{t('search.hintClose')}</span>
          </div>
          <span>{t('search.footer').replace('{product}', () => productName)}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
