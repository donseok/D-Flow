import { describe, expect, it } from 'vitest'
import { NAV_ICONS, NAV_ICON_STROKE, navIcon } from '@/components/app/navIcons'
import { MODULES } from '@/lib/modules/registry'
import { SHELL_NAV } from '@/lib/nav/registry'

describe('navIcons — 레지스트리의 lucide 이름 → 컴포넌트(§5.4.2, D31)', () => {
  it('레지스트리·셸 항목의 아이콘 이름이 표에 모두 있다', () => {
    const names = [...MODULES.flatMap((m) => [m.nav?.project?.icon, m.nav?.workspace?.icon]), ...SHELL_NAV.map((s) => s.icon)].filter((x): x is string => !!x)
    expect(names.length).toBeGreaterThan(10)
    for (const n of names) expect(NAV_ICONS[n], n).toBeDefined()
  })
  it('모르는 이름은 던진다 — 조용히 빈 아이콘을 그리지 않는다', () => { expect(() => navIcon('Nope')).toThrow() })
  it('획 두께 1.75', () => { expect(NAV_ICON_STROKE).toBe(1.75) })
})
