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
    // 테두리 상자 높이 — contentRect 는 도구 줄의 py-2 를 빼서 고정 요소가 줄 아래 16px 에 숨는다
    // 감싼 main(유일한 스크롤 상자 — D19)의 scroll-padding-top 도 맞춘다: 초점·앵커 스크롤이 도구 줄 뒤로 숨지 않게(BB4, globals.css .app-main)
    const main = root.closest('main')
    const ro = new ResizeObserver(([e]) => {
      const h = e.borderBoxSize?.[0]?.blockSize ?? (e.target as HTMLElement).getBoundingClientRect().height
      root.style.setProperty('--frame-sticky-top', `${Math.ceil(h)}px`)
      main?.style.setProperty('--main-scroll-pad', `${Math.ceil(h) + 8}px`)
    })
    ro.observe(bar)
    return () => { ro.disconnect(); root.style.setProperty('--frame-sticky-top', '0px'); main?.style.removeProperty('--main-scroll-pad') }
  }, [hasToolbar])
  const base = { '--frame-sticky-top': '0px' } as CSSProperties
  if (variant === 'fill') {
    return (
      <div ref={rootRef} data-frame="fill" style={base} className={`mx-auto flex h-full min-h-0 w-full flex-1 flex-col ${WIDTH[width]}`}>
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
