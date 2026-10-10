// 포털·프로젝트 목록 개인 설정 값의 순수 파서(SP3b UI-3 과제 8, 판정 R10 ③)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECTS_VIEW, PORTAL_MEMO_MAX, PROJECTS_VIEWS, cleanPortalLayout, isPortalMemo, isProjectsView, parseHiddenWidgets } from '@/lib/portal/prefs'

describe('projectsView', () => {
  it('rows·cards 둘, 기본은 rows', () => {
    expect([...PROJECTS_VIEWS]).toEqual(['rows', 'cards']); expect(DEFAULT_PROJECTS_VIEW).toBe('rows')
    expect(isProjectsView('cards')).toBe(true); expect(isProjectsView('grid')).toBe(false); expect(isProjectsView(null)).toBe(false)
  })
})
describe('parseHiddenWidgets', () => {
  it('배열이 아니면 null, 레지스트리 id 만·처음 순서로 중복 제거', () => {
    expect(parseHiddenWidgets('review')).toBeNull(); expect(parseHiddenWidgets(undefined)).toBeNull()
    expect(parseHiddenWidgets(['upcoming', 1, 'setup_checklist', 'upcoming', 'my_work'])).toEqual(['upcoming', 'my_work'])
    expect(parseHiddenWidgets([])).toEqual([])
  })
})
describe('cleanPortalLayout — 홈 구성의 저장 경로 정리', () => {
  it('null 은 개인 구성 지우기 — 그대로 저장한다(워크스페이스 기본 배치로 되돌아간다)', () => { expect(cleanPortalLayout(null)).toEqual({ ok: true, value: null }) })
  it('형태가 맞으면 정리한 값, 아니면 그 키를 버린다', () => {
    expect(cleanPortalLayout({ v: 1, items: [{ id: 'memo', size: 'full' }, { id: 'nope', size: 'half' }], known: ['memo'], extra: 1 }))
      .toEqual({ ok: true, value: { v: 1, items: [{ id: 'memo', size: 'full' }], known: ['memo'] } })
    for (const bad of [undefined, 'x', [], { v: 2, items: [] }, { items: [] }]) expect(cleanPortalLayout(bad)).toEqual({ ok: false })
  })
})
describe('portalMemo', () => {
  it('문자열·상한 안만 — 넘치면 잘라 받지 않고 거부한다', () => {
    expect(isPortalMemo('')).toBe(true); expect(isPortalMemo('가'.repeat(PORTAL_MEMO_MAX))).toBe(true)
    expect(isPortalMemo('가'.repeat(PORTAL_MEMO_MAX + 1))).toBe(false); expect(isPortalMemo(null)).toBe(false); expect(isPortalMemo(3)).toBe(false)
  })
})
describe('순수 모듈 — 클라이언트가 함께 쓴다', () => {
  it('prefs·settings/defs·서버 전용 모듈을 import 하지 않는다', () => {
    const src = readFileSync('src/lib/portal/prefs.ts', 'utf8')
    expect(src).not.toMatch(/from\s+['"]@\/lib\/(prefs|settings\/defs)|server-only|next\/headers/)
  })
})
