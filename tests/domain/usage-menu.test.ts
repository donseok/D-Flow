import { describe, expect, it } from 'vitest'
import {
  USAGE_KEY_OF, USAGE_MENUS, resolveMenuKey, normalizeUsagePath, extractProjectId, menuLabel,
} from '@/lib/domain/usageMenu'
import { NAV_ITEM_IDS } from '@/lib/nav/ids'

const PID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('resolveMenuKey — 레지스트리 파생(D27)', () => {
  it('새 워크스페이스 경로와 옛 전역 경로가 같은 키', () => {
    const pairs: [string, string][] = [
      ['/w/acme/minutes', '/minutes'], ['/w/acme/minutes/x', '/minutes/x'], ['/w/acme/meetings', '/meetings'], ['/w/acme/agents', '/agents'],
      ['/w/acme/portfolio', '/portfolio'], ['/w/acme/usage', '/usage'], ['/w/acme/admin/accounts', '/admin/accounts'], ['/w/acme/admin/teams', '/admin/teams'],
      ['/w/acme/projects', '/projects'],
    ]
    for (const [a, b] of pairs) expect(resolveMenuKey(a), a).toBe(resolveMenuKey(b))
    expect(resolveMenuKey('/minutes')).toBe('minutes')
    expect(resolveMenuKey('/agents')).toBe('seatmap')
    expect(resolveMenuKey('/meetings')).toBe('my-meetings')
  })
  it('새 키 둘', () => {
    expect(resolveMenuKey('/w/acme')).toBe('ws-home')
    expect(resolveMenuKey('/w/acme/my-work?kind=issue')).toBe('my-work')
    expect(USAGE_MENUS.map((m) => m.key)).toEqual(expect.arrayContaining(['ws-home', 'my-work']))
  })
  it('옛 경로 — 역사 데이터가 같은 키로 읽힌다', () => {
    const legacy: [string, string][] = [
      ['/projects', 'projects'], ['/projects/x', 'projects'], ['/usage', 'usage'], ['/portfolio', 'portfolio'],
      ['/admin/accounts', 'admin-accounts'], ['/admin/teams', 'admin-teams'], ['/admin/llm-config', 'admin-llm'],
    ]
    for (const [p, k] of legacy) expect(resolveMenuKey(p), p).toBe(k)
  })
  it('프로젝트 경로 — 항목 조각, 슬래시 조각(agents/office), nav 없는 칸반, 간트·가져오기는 작업 계획', () => {
    expect(resolveMenuKey(`/p/${PID}/dashboard`)).toBe('dashboard')
    expect(resolveMenuKey(`/p/${PID}/issues`)).toBe('issues')
    expect(resolveMenuKey(`/p/${PID}/wiki/some-topic`)).toBe('wiki')
    expect(resolveMenuKey(`/p/${PID}/agents`)).toBe('agents')
    expect(resolveMenuKey(`/p/${PID}/agents/office`)).toBe('agents')
    expect(resolveMenuKey(`/p/${PID}/kanban`)).toBe('kanban')
    expect(resolveMenuKey(`/p/${PID}/wbs?view=gantt`)).toBe('wbs')
    expect(resolveMenuKey(`/p/${PID}/gantt`)).toBe('wbs')
    expect(resolveMenuKey(`/p/${PID}/import`)).toBe('wbs')
    expect(resolveMenuKey(`/p/${PID}/settings`)).toBe('settings')
    expect(resolveMenuKey(`/p/${PID}/nope`)).toBe('unknown')
  })
  it.each([
    [`/p/${PID}`], [`/p/${PID}/무언가새로생긴메뉴`], ['/login'], ['/'], ['/share/minutes/tok'],
    ['/w/acme/nope'], ['/w/acme/admin'], ['/w/acme/admin/nope'], ['/account'],
  ])('모르는 경로(%s)는 추측하지 않고 unknown', (path) => {
    expect(resolveMenuKey(path)).toBe('unknown')
  })
  it('모든 NavItemId 에 키가 있고, 그 키는 USAGE_MENUS 에 있다', () => {
    const keys = new Set(USAGE_MENUS.map((m) => m.key))
    for (const id of NAV_ITEM_IDS) expect(keys.has(USAGE_KEY_OF[id]), id).toBe(true)
  })
  it('모든 반환 키는 USAGE_MENUS 에 정의돼 있다', () => {
    const keys = new Set(USAGE_MENUS.map((m) => m.key))
    for (const p of [`/p/${PID}/issues`, '/minutes', '/w/acme/usage', '/w/acme', '/nope']) {
      expect(keys.has(resolveMenuKey(p)), p).toBe(true)
    }
  })
})

describe('normalizeUsagePath — UUID 를 지우고 길이를 제한', () => {
  it('UUID 를 :id 로 바꾼다', () => {
    expect(normalizeUsagePath(`/p/${PID}/wbs`)).toBe('/p/:id/wbs')
  })
  it('쿼리스트링과 해시를 버린다', () => {
    expect(normalizeUsagePath(`/p/${PID}/wbs?view=gantt#x`)).toBe('/p/:id/wbs')
  })
  it('200자를 넘기지 않는다', () => {
    expect(normalizeUsagePath('/a' + 'b'.repeat(500)).length).toBe(200)
  })
})

describe('extractProjectId', () => {
  it('프로젝트 스코프 경로에서 id 를 뽑는다', () => {
    expect(extractProjectId(`/p/${PID}/wbs`)).toBe(PID)
  })
  it('전역 경로는 null', () => {
    expect(extractProjectId('/minutes')).toBeNull()
    expect(extractProjectId('/p/not-a-uuid/wbs')).toBeNull()
  })
})

describe('menuLabel', () => {
  it('labelKey 가 있으면 번역기를 쓴다', () => {
    expect(menuLabel('dashboard', () => '번역됨')).toBe('번역됨')
  })
  it('i18n 이 없는 관리자 메뉴는 fallback 을 쓴다', () => {
    expect(menuLabel('admin-accounts', () => '번역됨')).toBe('계정 관리')
  })
  it('정의에 없는 키는 키 자체를 돌려준다(추측 금지)', () => {
    expect(menuLabel('zzz', () => '번역됨')).toBe('zzz')
  })
})
