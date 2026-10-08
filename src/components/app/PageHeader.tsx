import type { ReactNode } from 'react'

/** 컴팩트 = 폭 1279 이하 또는 높이 799 이하(개정 §5.4.4, D55). 기본 경계가 아니라 임의 미디어 한 클래스 — 반응형 display 클래스와 한 요소에 섞지 않는다 */
const COMPACT_HIDE = '[@media(max-width:1279px),(max-height:799px)]:hidden'
const COMPACT_TITLE = '[@media(max-width:1279px),(max-height:799px)]:text-title-sm'
/** 컴팩트 머리 높이 48(§5.4.1 — 기본 64~80). 제목 줄 30 + 위아래 8 = 46 → 최소 48 */
const COMPACT_BOX = '[@media(max-width:1279px),(max-height:799px)]:min-h-12 [@media(max-width:1279px),(max-height:799px)]:py-2'

/**
 * 페이지 머리(개정 §5.4.4) — title 은 모든 뷰포트에서 렌더하는 h1. 컴팩트에서 description·meta 는 CSS 로 숨긴다(조건부 렌더는 SSR 첫 페인트가
 * 데스크톱 모양이라 튄다). 높이는 64~80, 컴팩트 48. 보조 동작은 보이는 것 둘까지, 나머지는 overflow 자리. syncStatus 는 오른쪽 끝 자리만(SPU1).
 * preview 는 상태 점검 화면(/admin/ui-states) 전용 — 한 화면에 머리를 여러 번 그리므로 제목을 h2 로 내리고(화면당 h1 하나), 뷰포트 대신 고정 모양으로 그린다.
 */
export function PageHeader({ title, description, meta, primaryAction, secondaryActions = [], overflow, syncStatus, preview }: {
  title: ReactNode; description?: ReactNode; meta?: ReactNode; primaryAction?: ReactNode
  secondaryActions?: ReactNode[]; overflow?: ReactNode; syncStatus?: ReactNode; preview?: 'default' | 'compact'
}) {
  const shown = secondaryActions.slice(0, 2)
  const rest = secondaryActions.slice(2)
  const pick = (media: string, fixed: string) => (preview === 'compact' ? fixed : preview === 'default' ? '' : media)
  const titleClass = `truncate text-fg ${preview === 'compact' ? 'text-title-sm' : `text-title ${pick(COMPACT_TITLE, '')}`}`
  const hide = pick(COMPACT_HIDE, 'hidden')
  return (
    <header data-page-header data-preview={preview} className={`flex flex-wrap items-center justify-between gap-3 ${preview === 'compact' ? 'min-h-12 py-2' : `min-h-16 py-3 ${pick(COMPACT_BOX, '')}`}`}>
      <div className="min-w-0">
        {preview ? <h2 className={titleClass}>{title}</h2> : <h1 className={titleClass}>{title}</h1>}
        {description && <p className={`mt-1 text-body text-fg-secondary ${hide}`}>{description}</p>}
        {meta && <div className={`mt-1 text-meta text-fg-secondary ${hide}`}>{meta}</div>}
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
