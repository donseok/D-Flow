import { describe, expect, it } from 'vitest'
import { VIEW_QUERY_KEYS, switchTarget } from '@/lib/nav/switchTarget'
import type { ModuleId } from '@/lib/modules/defaults'

const CORE: ModuleId[] = ['dashboard', 'wbs', 'members', 'settings']
const on = (...ids: ModuleId[]) => new Set<ModuleId>([...CORE, ...ids])
const B = '00000000-0000-0000-7e57-000000001622'

describe('switchTarget — 같은 모듈 유지(D41, ⑦)', () => {
  it('대상에서 켜져 있으면 그 모듈 항목의 href, 보기 쿼리만 남긴다', () => {
    expect(switchTarget({ pathname: '/p/A/issues', search: '?status=open&view=board&q=x', targetProjectId: B, targetModules: on('issues') }))
      .toEqual({ href: `/p/${B}/issues?view=board`, fallbackModule: null })
  })
  it('대상에서 꺼져 있으면 개요 + fallbackModule', () => {
    expect(switchTarget({ pathname: '/p/A/issues', search: '', targetProjectId: B, targetModules: on() }))
      .toEqual({ href: `/p/${B}/dashboard`, fallbackModule: 'issues' })
  })
  it('동적 하위 경로는 접힌다 — 위키 주제 → wiki, 간트 → wbs(항목 href), 에이전트 허브 → agents/office', () => {
    expect(switchTarget({ pathname: '/p/A/wiki/topics/t9', search: '', targetProjectId: B, targetModules: on('wiki', 'minutes') }).href).toBe(`/p/${B}/wiki`)
    expect(switchTarget({ pathname: '/p/A/gantt', search: '?scale=24&density=compact&group=phase', targetProjectId: B, targetModules: on() }).href)
      .toBe(`/p/${B}/wbs?scale=24&density=compact&group=phase`)
    expect(switchTarget({ pathname: '/p/A/agents', search: '', targetProjectId: B, targetModules: on('agents') }).href).toBe(`/p/${B}/agents/office`)
  })
  it('워크스페이스 범위·알 수 없는 조각에서 고르면 개요(fallback 없음)', () => {
    expect(switchTarget({ pathname: '/w/acme/minutes', search: '?project=x', targetProjectId: B, targetModules: on() })).toEqual({ href: `/p/${B}/dashboard`, fallbackModule: null })
    expect(switchTarget({ pathname: '/p/A/nope', search: '', targetProjectId: B, targetModules: on() })).toEqual({ href: `/p/${B}/dashboard`, fallbackModule: null })
  })
  it('nav 없는 모듈(칸반 — UI-3 전)은 같은 조각으로', () => {
    expect(switchTarget({ pathname: '/p/A/kanban', search: '?view=phase', targetProjectId: B, targetModules: on('kanban') }).href).toBe(`/p/${B}/kanban?view=phase`)
  })
  it('화이트리스트', () => { expect([...VIEW_QUERY_KEYS]).toEqual(['view', 'density', 'scale', 'group']) })
})
