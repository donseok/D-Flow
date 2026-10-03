// 포털 위젯 레지스트리와 노출 식(스펙 §6.1) — 설정에서 켜짐 ∧ 개인 숨김 아님 ∧ 모듈(어느 프로젝트에서든 effective) ∧ 검토 조건
import { describe, expect, it } from 'vitest'
import { PORTAL_WIDGETS, PORTAL_WIDGET_IDS, defaultPortalWidgets, isPortalReviewer, isPortalWidgetId, visibleWidgets, type PortalWidgetId } from '@/lib/portal/widgets'
import type { ModuleId } from '@/lib/modules/defaults'

const ALL_ON = new Set<ModuleId>(['agents', 'meetings', 'minutes', 'announcements'])
const ids = (slots: { id: PortalWidgetId }[]) => slots.map((s) => s.id)

describe('PORTAL_WIDGETS — 제품 고정 열·모듈·검토 조건', () => {
  it('여섯 위젯, 순서·열·모듈이 스펙 표와 같다', () => {
    expect(PORTAL_WIDGETS.map((w) => [w.id, w.column, w.module, w.needs])).toEqual([
      ['my_work', 'main', null, null], ['projects', 'main', null, null], ['review', 'side', 'agents', 'reviewer'],
      ['upcoming', 'side', 'meetings', null], ['recent_docs', 'side', 'minutes', null], ['announcements', 'side', 'announcements', null],
    ])
    expect(PORTAL_WIDGET_IDS).toEqual(PORTAL_WIDGETS.map((w) => w.id))
  })
  it('setup_checklist 는 예약하지 않는다(SP9 — 스펙 §6.1 역할별 행)', () => { expect(PORTAL_WIDGET_IDS).not.toContain('setup_checklist') })
  it('isPortalWidgetId 는 레지스트리 id 만', () => {
    expect(isPortalWidgetId('my_work')).toBe(true)
    expect(isPortalWidgetId('setup_checklist')).toBe(false)
    expect(isPortalWidgetId(1)).toBe(false)
  })
})

describe('visibleWidgets', () => {
  const base = { setting: defaultPortalWidgets(), hidden: [] as PortalWidgetId[], moduleUnion: ALL_ON, reviewer: true }
  it('기본 — main 둘, side 넷', () => {
    const v = visibleWidgets(base)
    expect(ids(v.main)).toEqual(['my_work', 'projects'])
    expect(ids(v.side)).toEqual(['review', 'upcoming', 'recent_docs', 'announcements'])
    expect(v.hiddenCount).toBe(0)
  })
  it('열 안의 순서는 설정 순서를 따른다(열 배치는 제품 고정)', () => {
    const setting = [{ id: 'announcements', enabled: true }, { id: 'projects', enabled: true }, ...defaultPortalWidgets().filter((w) => !['announcements', 'projects'].includes(w.id))] as ReturnType<typeof defaultPortalWidgets>
    const v = visibleWidgets({ ...base, setting })
    expect(ids(v.main)).toEqual(['projects', 'my_work'])
    expect(ids(v.side)[0]).toBe('announcements')
  })
  it('설정에서 끈 위젯은 없다(숨김 수에 들지 않는다)', () => {
    const setting = defaultPortalWidgets().map((w) => (w.id === 'upcoming' ? { ...w, enabled: false } : w))
    const v = visibleWidgets({ ...base, setting })
    expect(ids(v.side)).not.toContain('upcoming'); expect(v.hiddenCount).toBe(0)
  })
  it('개인 숨김은 빼고 수를 센다', () => {
    const v = visibleWidgets({ ...base, hidden: ['projects', 'announcements'] })
    expect(ids(v.main)).toEqual(['my_work']); expect(ids(v.side)).not.toContain('announcements'); expect(v.hiddenCount).toBe(2)
  })
  it('모듈이 어디서도 effective 가 아니면 없다', () => {
    const v = visibleWidgets({ ...base, moduleUnion: new Set<ModuleId>(['agents']) })
    expect(ids(v.side)).toEqual(['review'])
  })
  it('검토자가 아니면 review 가 없다', () => { expect(ids(visibleWidgets({ ...base, reviewer: false }).side)).not.toContain('review') })
  it('모듈 합집합을 읽지 못하면(null) 모듈 위젯은 숨기지 않고 module_unknown 으로 남긴다(Review Focus 5, W10)', () => {
    const v = visibleWidgets({ ...base, moduleUnion: null })
    expect(v.side.map((s) => [s.id, s.state])).toEqual([['review', 'module_unknown'], ['upcoming', 'module_unknown'], ['recent_docs', 'module_unknown'], ['announcements', 'module_unknown']])
    expect(v.main.every((s) => s.state === 'show')).toBe(true)
  })
  it('숨긴 위젯이 모듈 꺼짐으로 어차피 안 보이면 숨김 수에 들지 않는다', () => {
    const v = visibleWidgets({ ...base, hidden: ['upcoming'], moduleUnion: new Set<ModuleId>(['agents']) })
    expect(v.hiddenCount).toBe(0)
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
})
