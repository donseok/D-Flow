'use client'
// 전체 스튜디오(/agents)의 헤더 내비게이션 — 프로젝트 화면의 위임·승인|에이전트 스튜디오 탭 자리에 얹는다(2026-09-18).
// 이 화면은 사이드바 항목도 프로젝트 탭도 없어서, 여기가 유일한 돌아갈 길이다. 층 = 지금 좌석이 있는 프로젝트,
// 층이 없을 때를 위해 프로젝트 목록 링크를 늘 둔다.
import Link from 'next/link'
import { TAB_TONE, type TabTone } from '@/components/agent-hub/AgentTabs'
import { useScope } from '@/components/app/ScopeContext'
import { wsHref } from '@/lib/workspace/paths'
import { useLocale } from '@/components/providers/LocaleProvider'
import { fill } from './labelKeys'

export function OfficeNav({ floors, tone }: { floors: ReadonlyArray<{ id: string; name: string }>; tone: TabTone }) {
  const { t } = useLocale()
  const look = TAB_TONE[tone]
  const scope = useScope()   // 범위가 없으면(셸 밖) 옛 형식 — 스텁이 해석한다(D5)
  return (
    <nav aria-label={t('agents.nav.aria')} className="flex flex-wrap items-center gap-1.5">
      <span data-office-nav="all" aria-current="page" className={`chip ${look.on}`}>{t('agents.nav.all')}</span>
      {floors.map(f => (
        <Link key={f.id} href={`/p/${f.id}/agents/office`} data-office-nav={f.id}
          title={fill(t('agents.nav.floorTitle'), { name: f.name })}
          className={`chip ${look.off}`}>{f.name}</Link>
      ))}
      <Link href={scope?.workspace ? wsHref(scope.workspace.slug, 'projects') : '/projects'} data-office-nav="projects" className={`chip ${look.off}`}>{t('agents.nav.projects')}</Link>
    </nav>
  )
}
