// 포털·프로젝트 목록 개인 설정 값의 순수 파서(SP3b UI-3 과제 8, 판정 R10 ③)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROJECTS_VIEW, PROJECTS_VIEWS, isProjectsView, parseHiddenWidgets } from '@/lib/portal/prefs'

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
describe('순수 모듈 — 클라이언트가 함께 쓴다', () => {
  it('prefs·settings/defs·서버 전용 모듈을 import 하지 않는다', () => {
    const src = readFileSync('src/lib/portal/prefs.ts', 'utf8')
    expect(src).not.toMatch(/from\s+['"]@\/lib\/(prefs|settings\/defs)|server-only|next\/headers/)
  })
})
