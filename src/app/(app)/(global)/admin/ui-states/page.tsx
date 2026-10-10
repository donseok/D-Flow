import { notFound } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canViewUiStates } from '@/lib/authz/uiStatesAccess'
import { deriveAccent } from '@/lib/settings/accent'
import { PageHeader } from '@/components/app/PageHeader'
import { UiStatesShowcase, type AccentSample } from '@/components/admin/UiStatesShowcase'
import { t, type DictKey } from '@/lib/i18n/dict'

export const dynamic = 'force-dynamic'

/** accent 표본 10종(SP3b 스펙 §4.6) — 빨강·초록 근처 넷은 거부, 나머지는 통과(tests/settings/accent.test.ts 와 같은 표) */
const ACCENT_SAMPLES: readonly (readonly [nameKey: DictKey, hex: string])[] = [
  ['pages.uiStates.accent.cobalt', '#2456e6'], ['pages.uiStates.accent.red1', '#e03131'], ['pages.uiStates.accent.red2', '#c2255c'], ['pages.uiStates.accent.green1', '#2b8a3e'], ['pages.uiStates.accent.green2', '#0ca678'],
  ['pages.uiStates.accent.veryLight', '#ffe066'], ['pages.uiStates.accent.veryDark', '#1b1f3b'], ['pages.uiStates.accent.lowChroma', '#8a6f73'], ['pages.uiStates.accent.purple', '#7048e8'], ['pages.uiStates.accent.orange', '#f76707'],
]

/**
 * 컴포넌트 상태 점검(D16) — (global) 라우트 그룹: 레이아웃이 없어 UI-1 에서는 지금 셸 아래 뜨고, UI-2b 가 (global)/layout 을 더한다.
 * 플랫폼 진단이라 모듈 관문 밖이다(페이지 관문 불변식 제외 목록 — 사유 "플랫폼 진단 — 모듈 밖").
 */
export default async function UiStatesPage() {
  const actor = await getActorForView()
  if (!canViewUiStates(actor)) notFound()
  const samples: AccentSample[] = ACCENT_SAMPLES.map(([nameKey, hex]) => ({ name: t(nameKey), hex, result: deriveAccent(hex) }))
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.uiStates')} />
      <UiStatesShowcase samples={samples} />
    </div>
  )
}
