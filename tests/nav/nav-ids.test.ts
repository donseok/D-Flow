// 내비 id 25개(스펙 §4.5 의 24 + 플랫폼 관리 ws.workspaces)와 그룹 — navigation.menu 의 parse 가 이 목록으로 검증한다. navFor 자체는 Phase B.
import { describe, expect, it } from 'vitest'
import { NAV_GROUP_OF, NAV_ITEM_IDS, isNavItemId } from '@/lib/nav/ids'

describe('nav ids', () => {
  it('정확히 25개이고 유일하다', () => {
    expect(NAV_ITEM_IDS).toHaveLength(25)
    expect(new Set(NAV_ITEM_IDS).size).toBe(25)
  })
  it('그룹 배정이 스펙 §4.5 표와 같다', () => {
    const byGroup: Record<string, string[]> = {}
    for (const id of NAV_ITEM_IDS) (byGroup[NAV_GROUP_OF[id]] ??= []).push(id)
    expect(byGroup).toEqual({
      'ws.main': ['ws.home', 'ws.my_work', 'ws.projects'],
      'ws.shared': ['ws.meetings', 'ws.minutes', 'ws.agents'],
      'ws.ops': ['ws.portfolio', 'ws.usage', 'ws.members', 'ws.teams', 'ws.settings'],
      'ws.platform': ['ws.workspaces', 'ws.llm', 'ws.ui_states'],
      'p.overview': ['p.dashboard'],
      'p.plan': ['p.wbs', 'p.issues', 'p.weekly'],
      'p.collab': ['p.meetings', 'p.wiki', 'p.announcements'],
      'p.team': ['p.members', 'p.attendance', 'p.agents'],
      'p.settings': ['p.settings'],
    })
  })
  it('isNavItemId 는 목록 밖·비문자열을 거른다', () => {
    expect(isNavItemId('p.wbs')).toBe(true)
    expect(isNavItemId('p.gantt')).toBe(false)
    expect(isNavItemId(3)).toBe(false)
  })
})
