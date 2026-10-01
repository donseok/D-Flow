'use client'
import { type ReactNode } from 'react'
import { PageFrame } from './PageFrame'

/**
 * 옛 프로젝트 화면 틀의 어댑터(D18) — PageFrame 에 머리(hero)·고정 도구 줄(pinned)·종류(variant)를 넘긴다. 스크롤은 main 하나(D19)라
 * 안쪽 스크롤 영역과 컴팩트에서 머리를 버리던 분기가 없다 — 모든 뷰포트에 h1. flush = 채움형의 아래 여백 0(WBS 간트).
 * 화면의 유일한 조작부(위키 검색 카드·에이전트 탭)는 pinned 에 얹는다 — main 안 sticky 도구 줄이라 스크롤해도 남는다.
 * props 대조 이관(PageHeader 로)은 화면 소유 SP 가 그 화면을 만질 때다.
 */
export function ProjectPageShell({ hero, pinned, variant, flush = false, children }: {
  hero: ReactNode; pinned?: ReactNode; variant?: 'document' | 'fill'; flush?: boolean; children: ReactNode
}) {
  const v = variant ?? 'document'
  return (
    <PageFrame header={hero} toolbar={pinned} variant={v}>
      {v === 'fill' ? <div className={`h-full min-h-0 ${flush ? 'pb-0' : 'pb-4'}`}>{children}</div> : <div className="pb-6">{children}</div>}
    </PageFrame>
  )
}
