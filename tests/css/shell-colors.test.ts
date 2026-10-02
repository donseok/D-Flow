// 셸의 색·층(SP3b 스펙 §4.3·D56, 계획 판정 Q17·Q32) — 옛 팔레트 점·흰 글자 배지·임의 층이 돌아오지 않게. 과제 31 이 옛 셸(Sidebar·HeaderChrome)을 지우며
// 대상을 새 셸 파일로 옮겼다(같은 규칙). 옛 사이드바의 상태 점은 새 셸에 없다(전환기는 상태를 글자로 — 상태 칩 색은 UI-3 의 포털 몫).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FILES = [
  'src/components/app/AppShell.tsx', 'src/components/app/GlobalBar.tsx', 'src/components/app/NavList.tsx', 'src/components/app/WorkspaceNav.tsx',
  'src/components/app/ProjectNav.tsx', 'src/components/app/WorkspaceSwitcher.tsx', 'src/components/app/ProjectSwitcher.tsx', 'src/components/app/MobileNavDrawer.tsx',
  'src/components/app/NotificationBell.tsx', 'src/components/app/AccountMenu.tsx', 'src/components/app/ContextBreadcrumb.tsx', 'src/app/(app)/layout.tsx',
]
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

describe('셸 색·층', () => {
  it.each(FILES)('%s — 팔레트 유틸·흰 글자·z-[…]·sidebar 유틸이 없다', (f) => {
    const t = read(f)
    expect(t).not.toMatch(/(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring)-(?:amber|emerald|rose|sky|slate)-\d{2,3}\b/)
    expect(t).not.toMatch(/\btext-white\b/)
    expect(t).not.toMatch(/\bz-\[/)
    expect(t).not.toMatch(/(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring)-sidebar\b/)
  })
  it('내비 배지 세 계열 — 알림 수 action, 검토·결재 대기 warning, 채움과 전경이 짝이다(판정 Q17)', () => {
    const t = read('src/components/app/NavList.tsx')
    expect(t).toContain("'bg-action text-action-fg'")
    expect(t).toContain("'ws.my_work': 'bg-warning text-warning-fg'")
    expect(t).toContain("'p.agents': 'bg-warning text-warning-fg'")
  })
  it('벨 배지는 알림 수 계열(action)', () => {
    expect(read('src/components/app/NotificationBell.tsx')).toMatch(/data-bell-badge[^>]*bg-action[^>]*text-action-fg/)
  })
  it('스킵 링크는 가장 위 층(--z-skip)이다 — 사다리 값은 global-rule-layers 가 지키고 여기서는 쓰임을 고정한다(U1b 리뷰 R3 P3)', () => {
    expect(read('src/app/(app)/layout.tsx')).toMatch(/href="#main-content"[^>]*\bz-\(--z-skip\)/)
  })
  it('전역 바는 셸 층(--z-shell), 팝오버·드로어는 각자의 층 토큰', () => {
    expect(read('src/components/app/GlobalBar.tsx')).toContain('z-(--z-shell)')
    expect(read('src/components/app/MobileNavDrawer.tsx')).toContain('z-(--z-overlay)')
    for (const f of ['src/components/app/AccountMenu.tsx', 'src/components/app/NotificationBell.tsx', 'src/components/app/WorkspaceSwitcher.tsx']) expect(read(f), f).toContain('z-(--z-popover)')
  })
})
