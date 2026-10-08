'use client'
// 에이전트 두 화면(위임·승인 · 에이전트 스튜디오)의 공통 틀 — 머리(AgentHero)에 제목·한 문장 요약·상태 누적 막대·타일을 얹고,
// 탭과 화면마다 다른 조작부(tools)는 머리 아래 고정 도구 줄 한 곳에 둔다(2026-09-18 사용자 결정, D18 — 과제 32 에서 탭이 머리에서 내려왔다).
//
// 탭과 조작부는 화면의 유일한 조작 수단이라 늘 pinned(PageFrame 의 고정 도구 줄) 한 곳에 둔다 — 머리와 도구 줄에 탭이 두 번
// 나오지 않는다(D18 예외). 컴팩트에선 큰 다크 띠(AgentHero) 대신 PageHero 제목만 그린다 — 모든 뷰포트에 h1 하나(조건부 렌더).
// 분기는 useCompactViewport 로만 한다(반응형 display 유틸 금지 — globals.css 안전망). 첫 렌더는 데스크톱이라(D55) 컴팩트 기기의
// 첫 페인트에 AgentHero 가 잠깐 그려진다 — 스펙 D18 이 받아들인 예외다.
import type { ReactNode } from 'react'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHero } from '@/components/ui/PageHero'
import { useCompactViewport } from '@/lib/hooks/useCompactViewport'
import { AgentTabs, type TabTone } from './AgentTabs'

/** 고정 도구 줄(늘 light 톤)에 얹는 내비게이션. 기본은 프로젝트의 위임·승인|에이전트 스튜디오 탭이다.
 *  톤은 'light' 하나다(TAB_TONE — dark 갈래는 SP3b UI-3 이 지웠다, BB4 이월). 인자는 OfficeNav 등 바깥 nav 가 같은 톤을 받게 남긴다 */
export type HeroNav = (tone: TabTone) => ReactNode

/** 헤더 타일 하나. bar=false 면 누적 막대에서 뺀다(합계가 다른 축의 숫자). */
export interface HeroTile { key: string; label: string; value: number; color: string; valueColor?: string; bar?: boolean }

export function AgentHero({ nav, projectName, title, lede, tiles, aside }: {
  nav: ReactNode; projectName: string; title: string; lede: ReactNode; tiles: HeroTile[]; aside?: ReactNode
}) {
  const barTiles = tiles.filter(t => t.bar !== false && t.value > 0)
  const total = barTiles.reduce((n, t) => n + t.value, 0)
  return (
    <header data-agent-hero className="hero-card grid items-center gap-7 px-7 py-5 [grid-template-columns:minmax(0,1fr)_minmax(0,560px)]">
      <div className="relative z-10 min-w-0">
        {nav}
        <p className="mt-3.5 text-[11px] font-semibold tracking-[0.12em] text-fg-secondary">{projectName}</p>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-fg">{title}</h1>
        <div data-agent-lede className="mt-1.5 text-[15px] text-fg-secondary [&_b]:text-fg [&_em]:not-italic [&_em]:text-warning">{lede}</div>
      </div>
      <div className="relative z-10 flex min-w-0 flex-col gap-3">
        {aside}
        <div className="flex h-3.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden>
          {total > 0 && barTiles.map(t => <i key={t.key} className="block h-full" style={{ width: `${(t.value / total) * 100}%`, background: t.color }} />)}
        </div>
        <ul aria-label="현황" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
          {tiles.map(t => (
            <li key={t.key} className="rounded-(--radius-panel) border border-border bg-surface-subtle px-3 py-2.5">
              <b data-hero-tile={t.key} className="block text-2xl font-extrabold leading-none tabular-nums" style={{ color: t.valueColor ?? t.color }}>{t.value}</b>
              <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-secondary">
                <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: t.color }} />{t.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </header>
  )
}

export function AgentFrame({ projectId, nav, projectName, title, lede, tiles, tools, children }: {
  /** 프로젝트 화면이면 그 프로젝트의 탭을 단다. 전체 스튜디오처럼 프로젝트가 없는 화면은 nav 를 직접 준다. */
  projectId?: string; nav?: HeroNav
  /** 제목 위 eyebrow — 프로젝트 화면은 프로젝트명. */
  projectName: string; title: string; lede: ReactNode; tiles: HeroTile[]
  /** 이 화면에만 있는 조작부 — 헤더 아래 고정 줄. */
  tools?: ReactNode
  children: ReactNode
}) {
  const compact = useCompactViewport()
  const navFor: HeroNav = nav ?? (tone => projectId === undefined ? null : <AgentTabs projectId={projectId} tone={tone} />)
  // 탭은 pinned 한 곳에만 — 컴팩트에서 AgentHero 대신 PageHero 제목만(타일·막대는 조건부 렌더). 머리와 도구 줄에 탭이 두 번 나오지 않는다
  const tabs = navFor('light')
  const pinned = tabs || tools ? <div data-agent-tools className="flex flex-wrap items-center gap-x-3 gap-y-2">{tabs}{tools}</div> : undefined
  return (
    <ProjectPageShell hero={compact ? <PageHero title={title} /> : <AgentHero nav={null} projectName={projectName} title={title} lede={lede} tiles={tiles} />} pinned={pinned}>
      {children}
    </ProjectPageShell>
  )
}
