// 포털 위젯 레지스트리와 워크스페이스 설정(portal.widgets)의 해석 — 스펙 §6.1 을 2026-10-10 위젯 강화로 넓힌 모델(열 고정 → 순서 + 크기)
import { describe, expect, it } from 'vitest'
import { t } from '@/lib/i18n/dict'
import { isModuleId } from '@/lib/modules/defaults'
import {
  PORTAL_WIDGETS, PORTAL_WIDGET_IDS, defaultPortalWidgets, isPortalReviewer, isPortalWidgetId, parsePortalWidgets, portalWidgetDef, resolvePortalWidgets,
} from '@/lib/portal/widgets'

describe('PORTAL_WIDGETS — 닫힌 목록', () => {
  it('앞 여섯은 종전 홈 그대로(순서·모듈·검토 조건) — 옛 저장값과 E2E 가 이 순서에 기댄다', () => {
    expect(PORTAL_WIDGETS.slice(0, 6).map((w) => [w.id, w.size, w.module, w.needs, w.defaultOn])).toEqual([
      ['my_work', 'full', null, null, true], ['projects', 'full', null, null, true], ['review', 'half', 'agents', 'reviewer', true],
      ['upcoming', 'half', 'meetings', null, true], ['recent_docs', 'half', 'minutes', null, true], ['announcements', 'half', 'announcements', null, true],
    ])
    expect(PORTAL_WIDGET_IDS).toEqual(PORTAL_WIDGETS.map((w) => w.id))
  })
  it('새로 더한 위젯은 기본 배치에 들지 않는다 — 기존 홈이 저절로 바뀌지 않는다', () => {
    const added = PORTAL_WIDGETS.slice(6)
    expect(added.map((w) => w.id)).toEqual(['due_work', 'my_issues', 'project_progress', 'week_schedule', 'favorites', 'quick_actions', 'memo',
      'recent_changes', 'attendance_today', 'agents_status', 'weekly_reports', 'wiki_recent'])
    expect(added.every((w) => w.defaultOn === false && w.needs === null)).toBe(true)
    expect(Object.fromEntries(added.filter((w) => w.module).map((w) => [w.id, w.module]))).toEqual(
      { my_issues: 'issues', attendance_today: 'attendance', agents_status: 'agents', weekly_reports: 'weekly', wiki_recent: 'wiki' })
  })
  it('모든 위젯에 이름·설명 문구가 있고 모듈은 실제 모듈 id 다', () => {
    for (const w of PORTAL_WIDGETS) {
      // 사전에 없는 키면 t 가 키를 그대로 돌려준다 — 문구가 키와 달라야 한다
      expect(t(w.labelKey), w.labelKey).not.toBe(w.labelKey); expect(t(w.descKey), w.descKey).not.toBe(w.descKey)
      if (w.module !== null) expect(isModuleId(w.module), w.id).toBe(true)
    }
    expect(new Set(PORTAL_WIDGET_IDS).size).toBe(PORTAL_WIDGET_IDS.length)
  })
  it('setup_checklist 는 예약하지 않는다(SP9 — 스펙 §6.1 역할별 행)', () => { expect(PORTAL_WIDGET_IDS).not.toContain('setup_checklist') })
  it('isPortalWidgetId 는 레지스트리 id 만', () => {
    expect(isPortalWidgetId('my_work')).toBe(true); expect(isPortalWidgetId('memo')).toBe(true)
    expect(isPortalWidgetId('setup_checklist')).toBe(false); expect(isPortalWidgetId(1)).toBe(false)
    expect(portalWidgetDef('memo').size).toBe('half')
  })
})

describe('resolvePortalWidgets — 옛 형태·새 형태를 네 칸으로', () => {
  it('옛 형태 { id, enabled } 는 크기·기본 배치를 레지스트리에서 받는다', () => {
    const r = resolvePortalWidgets([{ id: 'projects', enabled: false }, { id: 'memo', enabled: true }])
    expect(r[0]).toEqual({ id: 'projects', enabled: false, size: 'full', inDefault: true })
    expect(r[1]).toEqual({ id: 'memo', enabled: true, size: 'half', inDefault: false })
  })
  it('새 형태는 적힌 값을 쓴다 — 한 배열에 옛·새 항목이 섞여도 항목마다 해석한다', () => {
    const r = resolvePortalWidgets([{ id: 'memo', enabled: true, size: 'full', inDefault: true }, { id: 'my_work', enabled: true }, { id: 'review', enabled: true, inDefault: false }])
    expect(r.slice(0, 3)).toEqual([
      { id: 'memo', enabled: true, size: 'full', inDefault: true }, { id: 'my_work', enabled: true, size: 'full', inDefault: true },
      { id: 'review', enabled: true, size: 'half', inDefault: false },
    ])
  })
  it('빠진 id 는 레지스트리 순서로 뒤에(허용), 레지스트리 밖 id·중복은 버린다', () => {
    const r = resolvePortalWidgets([{ id: 'nope', enabled: true }, { id: 'memo', enabled: true }, { id: 'memo', enabled: false }] as never)
    expect(r.map((w) => w.id)).toEqual(['memo', ...PORTAL_WIDGET_IDS.filter((id) => id !== 'memo')])
    expect(r[0].enabled).toBe(true); expect(r.every((w) => w.enabled)).toBe(true)
  })
  it('기본값을 해석하면 레지스트리 그대로다', () => {
    expect(resolvePortalWidgets(defaultPortalWidgets())).toEqual(PORTAL_WIDGETS.map((w) => ({ id: w.id, enabled: true, size: w.size, inDefault: w.defaultOn })))
  })
  it('parse 를 거친 값과 거치지 않은 값의 해석이 같다', () => {
    const raw = [{ id: 'upcoming', enabled: false }, { id: 'memo', enabled: true, size: 'full' }]
    const parsed = parsePortalWidgets(raw)
    expect(parsed.ok && resolvePortalWidgets(parsed.value)).toEqual(resolvePortalWidgets(raw as never))
  })
})

describe('isPortalReviewer(W11)', () => {
  it('agents 가 켜진 프로젝트의 관리자이거나 검토 대기가 있으면', () => {
    expect(isPortalReviewer({ adminOfAgentsProject: true, reviewCount: 0 })).toBe(true)
    expect(isPortalReviewer({ adminOfAgentsProject: false, reviewCount: 2 })).toBe(true)
    expect(isPortalReviewer({ adminOfAgentsProject: false, reviewCount: 0 })).toBe(false)
  })
  it('검토 수 조회 실패(null)는 관리자일 때만 — 실패를 0 으로 보지도, 모두에게 열지도 않는다', () => {
    expect(isPortalReviewer({ adminOfAgentsProject: false, reviewCount: null })).toBe(false)
    expect(isPortalReviewer({ adminOfAgentsProject: true, reviewCount: null })).toBe(true)
  })
  it('관리자 여부 판정 불가(합집합 실패 — null): 검토 0건·조회 실패면 null(판정 불가), 검토 1건이면 검토자(R9 ①)', () => {
    expect(isPortalReviewer({ adminOfAgentsProject: null, reviewCount: 0 })).toBeNull()
    expect(isPortalReviewer({ adminOfAgentsProject: null, reviewCount: null })).toBeNull()
    expect(isPortalReviewer({ adminOfAgentsProject: null, reviewCount: 1 })).toBe(true)
  })
})
