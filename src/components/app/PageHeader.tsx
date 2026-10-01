import type { ReactNode } from 'react'

/** 컴팩트 = 폭 1279 이하 또는 높이 799 이하(개정 §5.4.4, D55). 기본 경계가 아니라 임의 미디어 한 클래스 — 반응형 display 클래스와 한 요소에 섞지 않는다 */
const COMPACT_HIDE = '[@media(max-width:1279px),(max-height:799px)]:hidden'
const COMPACT_TITLE = '[@media(max-width:1279px),(max-height:799px)]:text-title-sm'

/**
 * 페이지 머리(개정 §5.4.4) — title 은 모든 뷰포트에서 렌더하는 h1. 컴팩트에서 description·meta 는 CSS 로 숨긴다(조건부 렌더는 SSR 첫 페인트가
 * 데스크톱 모양이라 튄다). 보조 동작은 보이는 것 둘까지, 나머지는 overflow 자리. syncStatus 는 오른쪽 끝 자리만(SPU1).
 */
export function PageHeader({ title, description, meta, primaryAction, secondaryActions = [], overflow, syncStatus }: {
  title: ReactNode; description?: ReactNode; meta?: ReactNode; primaryAction?: ReactNode
  secondaryActions?: ReactNode[]; overflow?: ReactNode; syncStatus?: ReactNode
}) {
  const shown = secondaryActions.slice(0, 2)
  const rest = secondaryActions.slice(2)
  return (
    <header data-page-header className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <h1 className={`truncate text-title text-fg ${COMPACT_TITLE}`}>{title}</h1>
        {description && <p className={`mt-1 text-body text-fg-secondary ${COMPACT_HIDE}`}>{description}</p>}
        {meta && <div className={`mt-1 text-meta text-fg-secondary ${COMPACT_HIDE}`}>{meta}</div>}
      </div>
      {(shown.length > 0 || rest.length > 0 || overflow || primaryAction || syncStatus) && (
        <div className="flex shrink-0 items-center gap-2">
          {shown}
          {(rest.length > 0 || overflow) && <div data-slot="overflow">{overflow ?? rest}</div>}
          {primaryAction}
          {syncStatus && <div data-slot="sync-status">{syncStatus}</div>}
        </div>
      )}
    </header>
  )
}
