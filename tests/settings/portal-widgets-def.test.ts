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
      { id: 'projects', enabled: true }, { id: 'review', enabled: true }, { id: 'upcoming', enabled: true }, { id: 'recent_docs', enabled: true },
    ] })
  })
  it('모르는 id·중복·모양 밖은 거부(던지지 않는다)', () => {
    expect(parsePortalWidgets([{ id: 'setup_checklist', enabled: true }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'my_work', enabled: true }, { id: 'my_work', enabled: false }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'my_work', enabled: 'yes' }]).ok).toBe(false)
    expect(parsePortalWidgets([{ id: 'my_work', enabled: true, extra: 1 }]).ok).toBe(false)
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
