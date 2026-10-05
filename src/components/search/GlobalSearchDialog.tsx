'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Search, X, FolderOpen, ListTodo, ArrowRight, Loader2 } from 'lucide-react'
import { useEscHandler, ESC_PRIORITY } from '@/lib/ui/escStack'
import { searchTitles, type SearchProjectItem, type SearchWbsItem } from '@/app/actions/globalSearch'

export interface NavShortcut {
  id: string
  title: string
  category: string
  href: string
}

export interface GlobalSearchDialogProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  workspaceSlug: string
  projectId?: string | null
  projectName?: string | null
}

const WS_NAV_ITEMS: Omit<NavShortcut, 'href'>[] = [
  { id: 'home', title: '홈', category: '이동' },
  { id: 'my-work', title: '내 업무', category: '이동' },
  { id: 'projects', title: '전체 프로젝트', category: '이동' },
  { id: 'meetings', title: '회의 일정', category: '이동' },
  { id: 'minutes', title: '회의록', category: '이동' },
  { id: 'agents', title: '에이전트 현황', category: '이동' },
  { id: 'portfolio', title: '포트폴리오', category: '이동' },
  { id: 'settings', title: '워크스페이스 설정', category: '설정' },
]

const PROJECT_NAV_ITEMS: Omit<NavShortcut, 'href'>[] = [
  { id: 'dashboard', title: '개요', category: '이동' },
  { id: 'wbs', title: '작업 계획 (WBS)', category: '이동' },
  { id: 'issues', title: '이슈', category: '이동' },
  { id: 'weekly', title: '주간보고', category: '이동' },
  { id: 'meetings', title: '회의', category: '이동' },
  { id: 'wiki', title: '위키', category: '이동' },
  { id: 'announcements', title: '공지사항', category: '이동' },
  { id: 'members', title: '팀 구성', category: '이동' },
  { id: 'settings', title: '프로젝트 설정', category: '설정' },
]

type ResultItem =
  | { kind: 'nav'; id: string; title: string; subtitle: string; href: string }
  | { kind: 'project'; id: string; title: string; subtitle: string; href: string }
  | { kind: 'wbs'; id: string; title: string; subtitle: string; href: string }

export function GlobalSearchDialog({
  open,
  onClose,
  workspaceId,
  workspaceSlug,
  projectId,
  projectName,
}: GlobalSearchDialogProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'workspace' | 'project'>(projectId ? 'project' : 'workspace')
  const [projects, setProjects] = useState<SearchProjectItem[]>([])
  const [wbsItems, setWbsItems] = useState<SearchWbsItem[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
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
      setSelectedIndex(0)
      setScope(projectId ? 'project' : 'workspace')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, projectId])

  // 네비게이션 바로가기 항목 생성
  const allNavItems: ResultItem[] = (
    scope === 'project' && projectId
      ? PROJECT_NAV_ITEMS.map((item) => ({
          kind: 'nav' as const,
          id: `nav-${item.id}`,
          title: item.title,
          subtitle: `${projectName ?? '프로젝트'} · ${item.category}`,
          href: `/p/${encodeURIComponent(projectId)}/${item.id}`,
        }))
      : WS_NAV_ITEMS.map((item) => ({
          kind: 'nav' as const,
          id: `nav-${item.id}`,
          title: item.title,
          subtitle: `워크스페이스 · ${item.category}`,
          href: item.id === 'home' ? `/w/${encodeURIComponent(workspaceSlug)}` : `/w/${encodeURIComponent(workspaceSlug)}/${item.id}`,
        }))
  ).filter((item) => {
    if (!query.trim()) return true
    return item.title.toLowerCase().includes(query.trim().toLowerCase())
  })

  // 검색 트리거 (디바운스)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setProjects([])
      setWbsItems([])
      setSearchError(null)
      return
    }

    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await searchTitles({
          workspaceId,
          query: q,
          scope,
          projectId: scope === 'project' ? projectId : null,
        })
        if (!res.ok) {
          setSearchError(res.error ?? '검색 오류가 발생했습니다.')
          setProjects([])
          setWbsItems([])
        } else {
          setSearchError(null)
          setProjects(res.projects)
          setWbsItems(res.wbsItems)
        }
      })
    }, 180)

    return () => clearTimeout(timer)
  }, [query, scope, workspaceId, projectId])

  // 전체 표시 결과 리스트
  const combinedItems: ResultItem[] = [
    ...allNavItems,
    ...projects.map((p) => ({
      kind: 'project' as const,
      id: `proj-${p.id}`,
      title: p.name,
      subtitle: '프로젝트',
      href: p.href,
    })),
    ...wbsItems.map((w) => ({
      kind: 'wbs' as const,
      id: `wbs-${w.id}`,
      title: `${w.code} ${w.title}`,
      subtitle: 'WBS 작업',
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
      aria-label="전역 ⌘K 제목 검색"
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
            placeholder="제목 검색 (메뉴 이동, 프로젝트, 작업명·코드)..."
            aria-label="제목 검색어"
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
              aria-label="입력 지우기"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:text-fg"
            aria-label="닫기"
          >
            <span className="text-xs font-mono">ESC</span>
          </button>
        </div>

        {/* 범위 칩 바 */}
        <div className="flex items-center justify-between border-b border-border bg-surface-muted/50 px-3 py-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-fg-muted">범위:</span>
            {projectId && (
              <button
                type="button"
                onClick={() => {
                  setScope('project')
                  setSelectedIndex(0)
                }}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  scope === 'project'
                    ? 'bg-brand text-brand-fg'
                    : 'bg-surface text-fg-secondary hover:bg-surface-hover'
                }`}
              >
                {projectName ? `${projectName}` : '현재 프로젝트'}
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
                  ? 'bg-brand text-brand-fg'
                  : 'bg-surface text-fg-secondary hover:bg-surface-hover'
              }`}
            >
              워크스페이스 전체
            </button>
          </div>
          <span className="text-[11px] text-fg-muted">제목 검색 전용</span>
        </div>

        {/* 결과 리스트 영역 */}
        <div className="max-h-80 overflow-y-auto p-2" role="listbox">
          {searchError && (
            <div className="p-4 text-center text-xs text-danger" role="alert">
              {searchError}
            </div>
          )}

          {!searchError && combinedItems.length === 0 && (
            <div className="p-8 text-center text-xs text-fg-muted">
              {query.trim()
                ? `‘${query.trim()}’에 대한 제목 검색 결과가 없습니다.`
                : '검색어를 입력하세요.'}
            </div>
          )}

          {!searchError &&
            combinedItems.map((item, idx) => {
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
                    {item.kind === 'project' && <FolderOpen size={15} className="text-brand shrink-0" />}
                    {item.kind === 'wbs' && <ListTodo size={15} className="text-emerald-500 shrink-0" />}
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
        <div className="flex items-center justify-between border-t border-border bg-surface-muted/30 px-3 py-1.5 text-[11px] text-fg-muted">
          <div className="flex items-center gap-3">
            <span>↑↓ 이동</span>
            <span>↵ 선택</span>
            <span>ESC 닫기</span>
          </div>
          <span>D-Flow 검색 v1</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
