'use client'
// 허브 조작 줄 — 켜짐/중지(관리자 토글), 감시 중 에이전트, 내 토큰 링크. 공통 헤더(AgentFrame) 아래 고정 줄에 얹는다.
// 카운터는 헤더 타일로 올라갔다(2026-09-18). 전체 스튜디오 링크는 스튜디오 탭에 있다(2026-09-14).
import Link from 'next/link'
import { Bot, PauseCircle } from 'lucide-react'
import type { Watcher } from '@/lib/domain/seatmap'
import { useLocale } from '@/components/providers/LocaleProvider'
import { fill, type Translate } from '@/components/agents/labelKeys'

type Props = {
  projectId: string
  registered: boolean
  enabled: boolean
  watchers: Watcher[]
  isAdmin: boolean
}

/** FloorCard 의 감시자 표기와 같은 조합 — `agent busy/slots ~until`. */
export function watchLabel(w: Watcher[], t: Translate): string {
  if (w.length === 0) return t('agents.watch.none')
  return w.map(x => `${x.agent}${x.slots != null ? ` ${x.busy ?? 0}/${x.slots}` : ''}${x.untilLabel ? ` ~${x.untilLabel}` : ''}`).join(' · ')
}

export function HubStatusBar({ projectId, registered, enabled, watchers, isAdmin }: Props) {
  const { t } = useLocale()
  const badge = !registered
    ? { cls: 'bg-surface-subtle text-fg-muted', label: t('agentHub.status.unregistered'), icon: PauseCircle }
    : enabled
      ? { cls: 'bg-action-soft text-action', label: t('agentHub.status.on'), icon: Bot }
      : { cls: 'bg-pending-weak text-warning', label: t('agentHub.status.off'), icon: PauseCircle }
  const Icon = badge.icon
  return (
    <section aria-label={t('agentHub.status.aria')} className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip ${badge.cls}`}><Icon className="mr-1 h-3.5 w-3.5" aria-hidden />{badge.label}</span>
        {isAdmin && !registered && <span className="text-meta text-fg-muted">{t('agentHub.status.firstDelegation')}</span>}
        {isAdmin && <Link href={`/p/${projectId}/settings#project-modules`} className="text-xs font-medium text-action underline-offset-2 hover:underline">{t('agentHub.status.settingsLink')}</Link>}
      </div>
      <div className="flex items-center gap-3 text-meta text-fg-secondary">
        <span title={watchLabel(watchers, t)}>{watchers.length ? fill(t('agents.watch.on'), { list: watchLabel(watchers, t) }) : t('agents.watch.none')}</span>
        <Link href="/account" className="text-action underline-offset-2 hover:underline">{t('agentHub.status.myToken')}</Link>
      </div>
    </section>
  )
}
