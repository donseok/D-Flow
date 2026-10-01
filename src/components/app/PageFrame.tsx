'use client'
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

const WIDTH = { portal: 'max-w-[1440px]', doc: 'max-w-[760px]', form: 'max-w-[800px]', full: '' } as const

/**
 * 페이지 틀(개정 §5.4.1·§5.4.2, D19·D54). 문서형: 머리 + 고정 도구 줄(main 안 sticky, --z-sticky) + 본문 — 세로 overflow 없음(스크롤은 main 하나).
 * 도구 줄은 자기 높이를 --frame-sticky-top 으로 루트에 내리고 페이지 안 고정 요소는 top-(--frame-sticky-top) 을 쓴다. 채움형: data-frame="fill",
 * 세로 flex 로 남은 높이를 쓰고 스크롤은 자식(그리드)이 갖는다 — .app-main:has([data-frame="fill"]) 가 main 을 닫는다(UI-2b, S-5).
 */
export function PageFrame({ header, toolbar, variant = 'document', width = 'full', children }: {
  header: ReactNode; toolbar?: ReactNode; variant?: 'document' | 'fill'; width?: keyof typeof WIDTH; children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const hasToolbar = !!toolbar
  useEffect(() => {
    const root = rootRef.current, bar = barRef.current
    if (!root || !bar || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => root.style.setProperty('--frame-sticky-top', `${Math.ceil(e.contentRect.height)}px`))
    ro.observe(bar)
    return () => { ro.disconnect(); root.style.setProperty('--frame-sticky-top', '0px') }
  }, [hasToolbar])
  const base = { '--frame-sticky-top': '0px' } as CSSProperties
  if (variant === 'fill') {
    return (
      <div ref={rootRef} data-frame="fill" style={base} className={`mx-auto flex h-full min-h-0 w-full flex-col ${WIDTH[width]}`}>
        <div className="shrink-0">{header}</div>
        {toolbar && <div ref={barRef} data-frame-toolbar className="shrink-0">{toolbar}</div>}
        <div data-frame-body className="min-h-0 flex-1">{children}</div>
      </div>
    )
  }
  return (
    <div ref={rootRef} data-frame="document" style={base} className={`mx-auto w-full ${WIDTH[width]}`}>
      {header}
      {toolbar && <div ref={barRef} data-frame-toolbar className="sticky top-0 z-(--z-sticky) bg-canvas py-2">{toolbar}</div>}
      <div data-frame-body>{children}</div>
    </div>
  )
}
