import { type ReactNode } from 'react'

/**
 * D-Flow 페이지 히어로 — 항상 접힌 컴팩트 상태(제목 한 줄).
 * 접기/펼치기 토글은 제거됨. eyebrow/description/actions/heroKpis/aside/badge는
 * 호출부 호환을 위해 받되 렌더하지 않는다.
 */
export function PageHero({
  title,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  aside?: ReactNode
  heroKpis?: ReactNode
}) {
  return (
    // 모든 뷰포트에서 보이는 h1(D18, 스펙 §9 ④) — 컴팩트에서 숨기던 분기(2026-08-21)를 지웠다. 제목 문구 정리는 화면 소유 SP
    <section className="grid gap-4">
      <div className="flex flex-col border-b border-border bg-surface px-6 py-3 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight tracking-tight text-fg">
              {title}
            </h1>
          </div>
        </div>
      </div>
    </section>
  )
}

/** 히어로 상단의 작은 카테고리 pill (예: "Settings") */
export function HeroBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-3 py-1 text-xs font-semibold text-fg-secondary">
      {children}
    </span>
  )
}
