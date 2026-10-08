'use client'
// 에이전트 스튜디오 · 위임·승인 두 화면을 오가는 탭(에이전트 명부는 스튜디오 안의 보기다, 2026-09-18). 스튜디오가 기본 화면이라 앞에 둔다(2026-09-19). 공통 틀(AgentFrame)의
// 고정 도구 줄 한 곳에 light 로 얹는다(D18 — 머리와 도구 줄에 두 번 나오지 않게). 활성 판정은 경로 완전 일치.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type AgentTabKey = 'hub' | 'office'

export function agentTabs(projectId: string): ReadonlyArray<{ key: AgentTabKey; href: string; label: string }> {
  const base = `/p/${projectId}/agents`
  return [
    { key: 'office', href: `${base}/office`, label: '에이전트 스튜디오' },
    { key: 'hub', href: base, label: '위임·승인' },
  ]
}

// 톤은 고정 도구 줄의 light 하나다 — 머리(AgentHero)에서 탭이 내려온 뒤 쓰이지 않던 dark 갈래를 지웠다(UI-2b BB4 이월, SP3b UI-3)
export const TAB_TONE = {
  light: { on: 'bg-action-soft text-action', off: 'text-fg-secondary hover:text-fg' },
} as const

export type TabTone = keyof typeof TAB_TONE

export function AgentTabs({ projectId, tone = 'light' }: { projectId: string; tone?: TabTone }) {
  const pathname = usePathname()
  const t = TAB_TONE[tone]
  return (
    <nav aria-label="에이전트 화면" className="flex items-center gap-1.5">
      {agentTabs(projectId).map(tab => {
        const active = pathname === tab.href
        return (
          <Link key={tab.key} href={tab.href} data-agent-tab={tab.key} aria-current={active ? 'page' : undefined}
            className={`chip ${active ? t.on : t.off}`}>{tab.label}</Link>
        )
      })}
    </nav>
  )
}
