import type { ReactNode } from 'react'

/**
 * 설정 화면의 저장 바(개정 §5.9.3, SP3b 스펙 §6.4, W19) — main 안 sticky bottom-0. 층은 페이지 안 고정 요소의 상한 z-10(D54).
 * data-save-bar: 1024 미만에서 AI FAB 이 이 바를 가리지 않게 셸이 찾는 표지(D33). 높이는 SettingsShell 이 재서 본문 아래 여백·초점 스크롤 여백으로 예약한다.
 * notice = 저장 결과 알림(성공 톤 text-success, role=status) — 있으면 summary 자리에 대신 보인다(편집기마다 같은 자리·같은 색, u3-3 리뷰 P2-2).
 * 편집기마다 자기 바를 두므로 바는 그 편집기 상자 안에서만 붙는다(편집기가 화면 아래로 이어질 때). 좌우로 카드 여백까지 넓히지 않는다 —
 * 편집기가 놓인 상자(카드 본문·폼·묶음)의 안쪽 여백이 제각각이라 음수 여백은 상자마다 어긋난다. 배경이 다른 상자(panel-soft 폼) 안에서는 tone="subtle".
 * 바 아래 16px 덮개(after): sticky 는 스크롤 상자(main)의 안쪽 여백(pb-4) 안에 붙는다 — bottom-0 이어도 화면 아래 가장자리에서 16px 떠서
 * 그 틈으로 뒤의 목록 한 줄이 비쳐 보였다(메뉴 설정처럼 긴 편집기). 바와 같은 배경을 그만큼 아래로 이어 틈을 덮는다. 바가 제자리(편집기 끝)에
 * 있을 때는 상자의 아래 여백(같은 배경) 위에 놓여 보이지 않는다. 위쪽의 같은 문제는 셸이 여백을 자리(div)로 바꿔 풀었다(AppShell — D54).
 */
export function SettingsSaveBar({ children, summary, notice, tone = 'surface' }: {
  children: ReactNode; summary?: ReactNode; notice?: string | null; tone?: 'surface' | 'subtle'
}) {
  return (
    <div data-save-bar className={`sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-inherit after:content-[''] ${tone === 'subtle' ? 'bg-surface-subtle' : 'bg-surface'}`}>
      {/* 저장 결과 알림은 바 안(편집기가 화면 아래로 이어져도 보이게) — 성공 색. 알림이 없으면 요약(변경 n개 등) */}
      <span className={`text-meta ${notice ? 'text-success' : 'text-fg-secondary'}`}>
        <span role="status" aria-live="polite" aria-atomic="true">{notice ?? ''}</span>
        {!notice && summary}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
