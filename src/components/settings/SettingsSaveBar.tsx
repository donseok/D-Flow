import type { ReactNode } from 'react'

/**
 * 설정 화면의 저장 바(개정 §5.9.3, SP3b 스펙 §6.4, W19) — main 안 sticky bottom-0. 층은 페이지 안 고정 요소의 상한 z-10(D54).
 * data-save-bar: 1024 미만에서 AI FAB 이 이 바를 가리지 않게 셸이 찾는 표지(D33). 높이는 SettingsShell 이 재서 본문 아래 여백·초점 스크롤 여백으로 예약한다.
 * 편집기마다 자기 바를 두므로 바는 그 편집기 상자 안에서만 붙는다(편집기가 화면 아래로 이어질 때). 좌우로 카드 여백까지 넓히지 않는다 —
 * 편집기가 놓인 상자(카드 본문·폼·묶음)의 안쪽 여백이 제각각이라 음수 여백은 상자마다 어긋난다. 배경이 다른 상자(panel-soft 폼) 안에서는 tone="subtle".
 */
export function SettingsSaveBar({ children, summary, tone = 'surface' }: { children: ReactNode; summary?: ReactNode; tone?: 'surface' | 'subtle' }) {
  return (
    <div data-save-bar className={`sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 ${tone === 'subtle' ? 'bg-surface-subtle' : 'bg-surface'}`}>
      <span className="text-meta text-fg-secondary">{summary}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
