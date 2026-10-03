// views.default(스펙 §6.4 표 둘째 행, D43) — { wbs } 만, 보드는 칸반이 effective 일 때만 저장(패치 뒤 enabled 기준 — W12)
import { describe, expect, it } from 'vitest'
import { settingDef } from '@/lib/settings/registry'
import { DEFAULT_VIEWS, WBS_VIEWS, parseViewsDefault } from '@/lib/settings/defs/project'
import { ERR_VIEWS_BOARD_KANBAN_OFF, validateProjectConfig, type ProjectValidateDeps } from '@/lib/settings/validateConfig'

const deps = (over: Partial<ProjectValidateDeps> = {}): ProjectValidateDeps => ({
  treeMaxDepth: null, teamCodes: [], allowed: ['kanban', 'issues'], prevEnabled: ['kanban', 'issues'], ...over,
})
const viewsErrors = (r: ReturnType<typeof validateProjectConfig>) => (r.ok ? [] : r.fieldErrors.filter((e) => e.key === 'views.default'))

describe('parseViewsDefault', () => {
  it('세 값', () => {
    expect(WBS_VIEWS).toEqual(['sheet', 'timeline', 'board'])
    for (const wbs of ['sheet', 'timeline', 'board'] as const) expect(parseViewsDefault({ wbs })).toEqual({ ok: true, value: { wbs } })
  })
  it('다른 값·다른 필드·모양 밖은 거부(밀도는 SPU2 의 별도 키 — D43)', () => {
    expect(parseViewsDefault({ wbs: 'gantt' }).ok).toBe(false)
    expect(parseViewsDefault({ wbs: 'sheet', density: 'compact' }).ok).toBe(false)
    expect(parseViewsDefault({}).ok).toBe(false)
    expect(parseViewsDefault(['sheet']).ok).toBe(false)
    expect(parseViewsDefault('sheet').ok).toBe(false)
    expect(parseViewsDefault(null).ok).toBe(false)
  })
  it('정의 — 프로젝트 키, 소유 wbs, 프로젝트 관리자, 기본 sheet', () => {
    const d = settingDef('project', 'views.default')!
    expect([d.scope, d.module, d.editor, d.apply, [...d.impact], d.widget, d.sql]).toEqual(
      ['project', 'wbs', 'project_admin', 'immediate', ['none'], { kind: 'custom', component: 'ViewsDefaultEditor' }, null])
    expect(d.default).toEqual(DEFAULT_VIEWS); expect(DEFAULT_VIEWS).toEqual({ wbs: 'sheet' })
    expect(settingDef('workspace', 'views.default')).toBeUndefined()
  })
})

describe('validateProjectConfig — 보드 ↔ 칸반(W12)', () => {
  it('칸반이 켜져 있으면 board 저장 통과', () => {
    expect(validateProjectConfig({ 'views.default': { wbs: 'board' } }, deps())).toEqual({ ok: true })
  })
  it('칸반이 프로젝트에서 꺼져 있으면 CONFIG_INVALID 필드 오류', () => {
    expect(validateProjectConfig({ 'views.default': { wbs: 'board' } }, deps({ prevEnabled: ['issues'] })))
      .toEqual({ ok: false, fieldErrors: [{ key: 'views.default', message: ERR_VIEWS_BOARD_KANBAN_OFF }] })
  })
  it('워크스페이스가 칸반을 허용하지 않으면 거부', () => {
    expect(viewsErrors(validateProjectConfig({ 'views.default': { wbs: 'board' } }, deps({ allowed: ['issues'] }))))
      .toEqual([{ key: 'views.default', message: ERR_VIEWS_BOARD_KANBAN_OFF }])
  })
  it('저장된 enabled 를 모르면(prevEnabled null) 보드를 거부한다 — 켜짐을 확인하지 못하면 열지 않는다', () => {
    expect(viewsErrors(validateProjectConfig({ 'views.default': { wbs: 'board' } }, deps({ prevEnabled: null })))).toHaveLength(1)
  })
  it('같은 패치에서 칸반을 끄며 보드를 고르면 거부, 켜며 고르면 통과', () => {
    expect(viewsErrors(validateProjectConfig({ 'modules.enabled': ['issues'], 'views.default': { wbs: 'board' } }, deps())))
      .toEqual([{ key: 'views.default', message: ERR_VIEWS_BOARD_KANBAN_OFF }])
    expect(validateProjectConfig({ 'modules.enabled': ['kanban', 'issues'], 'views.default': { wbs: 'board' } }, deps({ prevEnabled: ['issues'] }))).toEqual({ ok: true })
  })
  it('칸반을 끄는 저장은 막지 않는다 — 저장된 board 는 읽을 때 sheet 로 그린다(D43, Review Focus 3)', () => {
    expect(validateProjectConfig({ 'modules.enabled': ['issues'] }, deps())).toEqual({ ok: true })
  })
  it('sheet·timeline 은 칸반과 무관', () => {
    expect(validateProjectConfig({ 'views.default': { wbs: 'timeline' } }, deps({ prevEnabled: [], allowed: [] }))).toEqual({ ok: true })
    expect(validateProjectConfig({ 'views.default': { wbs: 'sheet' } }, deps({ prevEnabled: [], allowed: [] }))).toEqual({ ok: true })
  })
})
