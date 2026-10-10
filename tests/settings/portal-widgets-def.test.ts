// portal.widgets 정의(스펙 §6.4 표 첫 행) — parse 규칙, 빠진 id 보충, 기본값
import { describe, expect, it } from 'vitest'
import { settingDef } from '@/lib/settings/registry'
import { PORTAL_WIDGET_IDS, defaultPortalWidgets, parsePortalWidgets } from '@/lib/portal/widgets'

describe('parsePortalWidgets', () => {
  it('기본값 = 레지스트리 순서 전부 켬', () => {
    expect(defaultPortalWidgets()).toEqual(PORTAL_WIDGET_IDS.map((id) => ({ id, enabled: true })))
  })
  it('빠진 id 는 레지스트리 순서로 뒤에 붙인다(켜짐)', () => {
    const r = parsePortalWidgets([{ id: 'announcements', enabled: false }, { id: 'my_work', enabled: true }])
    expect(r).toEqual({ ok: true, value: [
      { id: 'announcements', enabled: false }, { id: 'my_work', enabled: true },
      ...PORTAL_WIDGET_IDS.filter((id) => id !== 'announcements' && id !== 'my_work').map((id) => ({ id, enabled: true })),
    ] })
  })
  // 위젯 강화(2026-10-10) — 옛 형태·새 형태를 둘 다 받고, 받은 칸만 그대로 돌려준다(옛 저장값을 고쳐 쓰지 않는다)
  it('옛 형태 { id, enabled } 는 그대로 통과한다 — 저장 형태가 입력과 같다(하위 호환)', () => {
    const old = PORTAL_WIDGET_IDS.map((id) => ({ id, enabled: id !== 'projects' }))
    expect(parsePortalWidgets(old)).toEqual({ ok: true, value: old })
  })
  it('새 형태 { id, enabled, size, inDefault } — 두 칸은 항목마다 선택이고 섞여도 된다', () => {
    const mixed = [{ id: 'memo', enabled: true, size: 'full', inDefault: true }, { id: 'my_work', enabled: true, inDefault: false }, { id: 'projects', enabled: false, size: 'half' },
      ...PORTAL_WIDGET_IDS.filter((id) => !['memo', 'my_work', 'projects'].includes(id)).map((id) => ({ id, enabled: true }))]
    expect(parsePortalWidgets(mixed)).toEqual({ ok: true, value: mixed })
  })
  it('새 칸의 값이 형태 밖이면 거부', () => {
    expect(parsePortalWidgets([{ id: 'memo', enabled: true, size: 'wide' }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'memo', enabled: true, size: null }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'memo', enabled: true, inDefault: 'yes' }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'memo', size: 'full', inDefault: true }]).ok).toBe(false)        // enabled 는 늘 필요하다
  })
  it('모르는 id·중복·모양 밖은 거부(던지지 않는다)', () => {
    expect(parsePortalWidgets([{ id: 'setup_checklist', enabled: true }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'my_work', enabled: true }, { id: 'my_work', enabled: false }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'my_work', enabled: 'yes' }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'my_work', enabled: true, extra: 1 }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'my_work', enabled: true, column: 'main' }]).ok).toBe(false)     // 없어진 열 배치는 받지 않는다
    expect(parsePortalWidgets([null]).ok).toBe(false)
    expect(parsePortalWidgets({ my_work: true }).ok).toBe(false)
    expect(parsePortalWidgets(null).ok).toBe(false)
  })
  it('빈 목록은 전부 켬과 같다(빠진 id 보충)', () => { expect(parsePortalWidgets([])).toEqual({ ok: true, value: defaultPortalWidgets() }) })
  it('기본값은 매번 새 배열이다(호출부가 고쳐도 정의의 기본값이 바뀌지 않는다)', () => {
    expect(defaultPortalWidgets()).not.toBe(defaultPortalWidgets())
  })
})

describe('정의', () => {
  it('워크스페이스 키·소유 settings·워크스페이스 관리자·즉시·영향 없음·전용 편집기', () => {
    const d = settingDef('workspace', 'portal.widgets')!
    expect([d.scope, d.module, d.editor, d.apply, [...d.impact], d.widget, d.sql]).toEqual(
      ['workspace', 'settings', 'workspace_admin', 'immediate', ['none'], { kind: 'custom', component: 'PortalWidgetsEditor' }, null])
    expect(d.default).toEqual(defaultPortalWidgets())
    expect(settingDef('project', 'portal.widgets')).toBeUndefined()
  })
})
