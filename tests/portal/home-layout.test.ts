// 홈 해석(워크스페이스 허용 × 개인 구성 × 모듈·검토 조건)과 개인 구성의 저장 형태·격자·편집 — 순수 함수(2026-10-10 위젯 강화)
import { describe, expect, it } from 'vitest'
import type { ModuleId } from '@/lib/modules/defaults'
import {
  PORTAL_WIDGET_IDS, defaultPortalWidgets, dropLayoutItem, gridCells, moveLayoutItem, parsePortalLayout, resolveHomeLayout, sameLayout,
  type LayoutItem, type PortalLayout, type PortalWidgetId, type PortalWidgetSetting,
} from '@/lib/portal/widgets'

const ALL_ON = new Set<ModuleId>(['agents', 'meetings', 'minutes', 'announcements', 'issues', 'attendance', 'weekly', 'wiki'])
const LEGACY = ['my_work', 'projects', 'review', 'upcoming', 'recent_docs', 'announcements']
const base = { setting: defaultPortalWidgets(), layout: null as PortalLayout | null, moduleUnion: ALL_ON as ReadonlySet<ModuleId> | null, reviewer: true as boolean | null }
const ids = (xs: readonly { id: PortalWidgetId }[]) => xs.map((x) => x.id)
const layout = (items: [PortalWidgetId, 'half' | 'full'][], known: PortalWidgetId[] = []): PortalLayout => ({ v: 1, items: items.map(([id, size]) => ({ id, size })), known })
const setting = (change: (w: PortalWidgetSetting[number]) => PortalWidgetSetting[number]): PortalWidgetSetting => defaultPortalWidgets().map(change)

describe('parsePortalLayout — 개인 구성의 저장 형태', () => {
  it('새 형태를 그대로 읽는다', () => {
    expect(parsePortalLayout({ v: 1, items: [{ id: 'memo', size: 'full' }, { id: 'my_work', size: 'half' }], known: ['memo', 'my_work', 'projects'] }))
      .toEqual({ v: 1, items: [{ id: 'memo', size: 'full' }, { id: 'my_work', size: 'half' }], known: ['memo', 'my_work', 'projects'] })
  })
  it('형태가 아니면 null — 개인 구성 없음으로 읽는다(저장 경로는 그 키를 버린다)', () => {
    for (const bad of [null, undefined, 'x', 3, [], ['memo'], {}, { v: 2, items: [] }, { v: 1 }, { v: 1, items: 'memo' }]) expect(parsePortalLayout(bad), JSON.stringify(bad)).toBeNull()
  })
  it('손상된 항목은 조용히 버린다 — 모르는 id·중복·객체 아님. 크기가 이상하면 레지스트리 기본', () => {
    const r = parsePortalLayout({ v: 1, items: [{ id: 'memo', size: 'huge' }, null, 'x', { id: 'nope', size: 'half' }, { id: 'memo', size: 'full' }, { id: 'my_work' }], known: ['memo', 'nope', 7, 'memo'] })
    expect(r).toEqual({ v: 1, items: [{ id: 'memo', size: 'half' }, { id: 'my_work', size: 'full' }], known: ['memo'] })
  })
  it('빈 구성도 구성이다(위젯을 모두 뺀 홈) — known 이 없으면 빈 목록', () => {
    expect(parsePortalLayout({ v: 1, items: [] })).toEqual({ v: 1, items: [], known: [] })
  })
  it('항목 수는 레지스트리 크기를 넘지 못한다(닫힌 목록 + 중복 제거)', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: PORTAL_WIDGET_IDS[i % PORTAL_WIDGET_IDS.length], size: 'half' }))
    expect(parsePortalLayout({ v: 1, items: many })!.items).toHaveLength(PORTAL_WIDGET_IDS.length)
  })
})

describe('resolveHomeLayout — 기본 배치(개인 구성 없음)', () => {
  it('기본 설정이면 종전 홈 여섯 — 순서·크기는 레지스트리', () => {
    const h = resolveHomeLayout(base)
    expect(h.slots).toEqual([
      { id: 'my_work', size: 'full', state: 'show' }, { id: 'projects', size: 'full', state: 'show' }, { id: 'review', size: 'half', state: 'show' },
      { id: 'upcoming', size: 'half', state: 'show' }, { id: 'recent_docs', size: 'half', state: 'show' }, { id: 'announcements', size: 'half', state: 'show' },
    ])
    expect(h.personal).toBe(false); expect(h.defaults).toEqual(h.slots.map(({ id, size }) => ({ id, size })))
    expect(ids(h.gallery)).toEqual(PORTAL_WIDGET_IDS)                       // 갤러리에는 허용된 위젯 전부
    expect(h.gallery.every((g) => !g.isNew)).toBe(true)
  })
  it('설정의 순서·크기·기본 배치 여부를 따른다(새 형태)', () => {
    const h = resolveHomeLayout({ ...base, setting: [
      { id: 'memo', enabled: true, size: 'full', inDefault: true }, { id: 'announcements', enabled: true, size: 'full', inDefault: true },
      { id: 'my_work', enabled: true, size: 'half', inDefault: true }, { id: 'projects', enabled: true, inDefault: false },
      ...LEGACY.slice(2, 5).map((id) => ({ id: id as PortalWidgetId, enabled: true, inDefault: false })),
    ] })
    expect(h.slots.map((s) => [s.id, s.size])).toEqual([['memo', 'full'], ['announcements', 'full'], ['my_work', 'half']])
  })
  it('옛 형태의 순서도 따른다(종전 동작)', () => {
    const order = ['announcements', 'upcoming', 'recent_docs', 'review', 'projects', 'my_work'].map((id) => ({ id: id as PortalWidgetId, enabled: true }))
    expect(ids(resolveHomeLayout({ ...base, setting: order }).slots)).toEqual(['announcements', 'upcoming', 'recent_docs', 'review', 'projects', 'my_work'])
  })
  it('설정에서 끈 위젯은 홈에도 갤러리에도 없다', () => {
    const h = resolveHomeLayout({ ...base, setting: setting((w) => (w.id === 'upcoming' || w.id === 'memo' ? { ...w, enabled: false } : w)) })
    expect(ids(h.slots)).not.toContain('upcoming'); expect(ids(h.gallery)).not.toContain('upcoming'); expect(ids(h.gallery)).not.toContain('memo')
  })
  it('옛 개인 숨김은 기본 배치에서 뺀다(이행) — 갤러리에는 남아 다시 올릴 수 있다', () => {
    const h = resolveHomeLayout({ ...base, legacyHidden: ['projects', 'announcements'] })
    expect(ids(h.slots)).toEqual(['my_work', 'review', 'upcoming', 'recent_docs'])
    expect(ids(h.gallery)).toContain('projects'); expect(h.personal).toBe(false)
    expect(ids(h.defaults)).toContain('projects')                           // '기본값으로 되돌리기' 는 숨김 없는 기본 배치다
  })
  it('설정에 레지스트리 밖 id 가 섞여도 무시한다', () => {
    const s = [{ id: 'nope', enabled: true }, ...defaultPortalWidgets()] as unknown as PortalWidgetSetting
    expect(ids(resolveHomeLayout({ ...base, setting: s }).slots)).toEqual(LEGACY)
  })
})

describe('resolveHomeLayout — 모듈·검토 조건', () => {
  it('모듈이 어디서도 켜지지 않은 위젯은 홈에도 갤러리에도 없다', () => {
    const h = resolveHomeLayout({ ...base, moduleUnion: new Set<ModuleId>(['agents']) })
    expect(ids(h.slots)).toEqual(['my_work', 'projects', 'review'])
    for (const id of ['upcoming', 'my_issues', 'attendance_today', 'weekly_reports', 'wiki_recent']) expect(ids(h.gallery), id).not.toContain(id)
    expect(ids(h.gallery)).toContain('agents_status')
  })
  it('검토자가 아니면 review 가 없다(갤러리에도)', () => {
    const h = resolveHomeLayout({ ...base, reviewer: false })
    expect(ids(h.slots)).not.toContain('review'); expect(ids(h.gallery)).not.toContain('review')
  })
  it('모듈 합집합을 읽지 못하면(null) 모듈 위젯은 숨기지 않고 module_unknown 으로 남긴다(W10)', () => {
    const h = resolveHomeLayout({ ...base, moduleUnion: null })
    expect(h.slots.map((s) => [s.id, s.state])).toEqual([['my_work', 'show'], ['projects', 'show'], ['review', 'module_unknown'],
      ['upcoming', 'module_unknown'], ['recent_docs', 'module_unknown'], ['announcements', 'module_unknown']])
  })
  // R9 ① — '검토자 아님'(false)과 '판정 불가'(null)를 가른다. null 이면 review 가 조용히 사라지지 않는다
  it('검토자 판정 불가(null) → review 는 module_unknown, 검토자 아님(false) → 없음', () => {
    expect(resolveHomeLayout({ ...base, moduleUnion: null, reviewer: null }).slots.find((s) => s.id === 'review')).toEqual({ id: 'review', size: 'half', state: 'module_unknown' })
    expect(ids(resolveHomeLayout({ ...base, moduleUnion: null, reviewer: false }).slots)).not.toContain('review')
  })
  it('합집합을 읽었고 agents 가 어디서도 꺼져 있으면 reviewer null 이어도 review 없음', () => {
    expect(ids(resolveHomeLayout({ ...base, moduleUnion: new Set<ModuleId>(['meetings']), reviewer: null }).slots)).not.toContain('review')
  })
})

describe('resolveHomeLayout — 개인 구성', () => {
  it('개인 순서·크기로 그린다 — 기본 배치에 없던 위젯도 올릴 수 있다', () => {
    const h = resolveHomeLayout({ ...base, layout: layout([['memo', 'full'], ['my_work', 'half'], ['due_work', 'half']]) })
    expect(h.slots.map((s) => [s.id, s.size])).toEqual([['memo', 'full'], ['my_work', 'half'], ['due_work', 'half']])
    expect(h.personal).toBe(true)
  })
  it('관리자가 끈 위젯은 개인 구성에 있어도 보이지 않는다(갤러리에도 없다) — 다시 켜면 그 자리에 돌아온다', () => {
    const mine = layout([['memo', 'full'], ['projects', 'half'], ['my_work', 'half']])
    const off = resolveHomeLayout({ ...base, layout: mine, setting: setting((w) => (w.id === 'projects' ? { ...w, enabled: false } : w)) })
    expect(ids(off.slots)).toEqual(['memo', 'my_work']); expect(ids(off.gallery)).not.toContain('projects')
    expect(ids(resolveHomeLayout({ ...base, layout: mine }).slots)).toEqual(['memo', 'projects', 'my_work'])
  })
  it('모듈이 꺼진 위젯·검토자가 아닌 review 도 개인 구성에서 빠진다', () => {
    const h = resolveHomeLayout({ ...base, layout: layout([['upcoming', 'half'], ['review', 'half'], ['my_work', 'full']]), moduleUnion: new Set<ModuleId>(), reviewer: false })
    expect(ids(h.slots)).toEqual(['my_work'])
  })
  it('관리자가 새로 켠 위젯은 끼어들지 않는다 — 갤러리에 새로 추가됨으로 보인다', () => {
    const before = setting((w) => (w.id === 'memo' ? { ...w, enabled: false } : w))
    const known = resolveHomeLayout({ ...base, setting: before }).gallery.map((g) => g.id)            // 저장할 때 갤러리에 있던 것
    const mine = layout([['my_work', 'full']], known)
    const h = resolveHomeLayout({ ...base, layout: mine, setting: [{ id: 'memo', enabled: true, inDefault: true }, ...defaultPortalWidgets().filter((w) => w.id !== 'memo')] })
    expect(ids(h.slots)).toEqual(['my_work'])                                                          // 기본 배치에 넣어도 내 홈에는 저절로 들어오지 않는다
    expect(h.gallery.filter((g) => g.isNew).map((g) => g.id)).toEqual(['memo'])
  })
  it('내가 뺀 위젯은 새로 추가됨이 아니다(저장 때 갤러리에 있었다)', () => {
    const h = resolveHomeLayout({ ...base, layout: layout([['my_work', 'full']], [...PORTAL_WIDGET_IDS]) })
    expect(h.gallery.some((g) => g.isNew)).toBe(false)
  })
  it('개인 구성이 있으면 옛 숨김 값은 보지 않는다', () => {
    const h = resolveHomeLayout({ ...base, layout: layout([['projects', 'full']]), legacyHidden: ['projects'] })
    expect(ids(h.slots)).toEqual(['projects'])
  })
  it('빈 개인 구성은 빈 홈이다(기본 배치로 되돌아가지 않는다)', () => {
    const h = resolveHomeLayout({ ...base, layout: layout([]) })
    expect(h.slots).toEqual([]); expect(h.personal).toBe(true); expect(h.defaults.length).toBe(6)
  })
})

describe('격자 배치 — 2열, full 은 두 칸', () => {
  const L = (...xs: [PortalWidgetId, 'half' | 'full'][]): LayoutItem[] => xs.map(([id, size]) => ({ id, size }))
  it('half 둘은 한 줄, full 은 새 줄의 두 칸', () => {
    expect(gridCells(L(['my_work', 'full'], ['review', 'half'], ['upcoming', 'half'], ['memo', 'half']))).toEqual([
      { id: 'my_work', row: 1, col: 1, span: 2 }, { id: 'review', row: 2, col: 1, span: 1 }, { id: 'upcoming', row: 2, col: 2, span: 1 }, { id: 'memo', row: 3, col: 1, span: 1 },
    ])
  })
  it('half 뒤의 full 은 다음 줄로 — 그 줄의 남은 칸은 비워 둔다(순서를 바꿔 채우지 않는다)', () => {
    expect(gridCells(L(['review', 'half'], ['my_work', 'full'], ['memo', 'half'])).map((c) => [c.id, c.row, c.col])).toEqual([['review', 1, 1], ['my_work', 2, 1], ['memo', 3, 1]])
  })
  it('빈 구성은 빈 격자', () => { expect(gridCells([])).toEqual([]) })
})

describe('편집 — 옮기기·끌어 놓기', () => {
  const L: LayoutItem[] = [{ id: 'my_work', size: 'full' }, { id: 'review', size: 'half' }, { id: 'memo', size: 'half' }]
  it('앞·뒤로 한 자리 — 끝에서는 같은 배열(못 옮김)', () => {
    expect(ids(moveLayoutItem(L, 'review', -1))).toEqual(['review', 'my_work', 'memo'])
    expect(ids(moveLayoutItem(L, 'review', 1))).toEqual(['my_work', 'memo', 'review'])
    expect(moveLayoutItem(L, 'my_work', -1)).toBe(L); expect(moveLayoutItem(L, 'memo', 1)).toBe(L); expect(moveLayoutItem(L, 'projects', 1)).toBe(L)
    expect(ids(L)).toEqual(['my_work', 'review', 'memo'])                 // 원본은 그대로
  })
  it('끌어 놓으면 놓은 자리를 차지한다', () => {
    expect(ids(dropLayoutItem(L, 'my_work', 'memo'))).toEqual(['review', 'memo', 'my_work'])
    expect(ids(dropLayoutItem(L, 'memo', 'my_work'))).toEqual(['memo', 'my_work', 'review'])
    expect(dropLayoutItem(L, 'memo', 'memo')).toBe(L); expect(dropLayoutItem(L, 'projects', 'memo')).toBe(L)
  })
  it('sameLayout 은 순서·크기까지 본다', () => {
    expect(sameLayout(L, [...L])).toBe(true); expect(sameLayout(L, moveLayoutItem(L, 'review', 1))).toBe(false)
    expect(sameLayout(L, L.map((i) => (i.id === 'memo' ? { ...i, size: 'full' as const } : i)))).toBe(false)
  })
})
