import { describe, expect, it } from 'vitest'
import { BOOTSTRAP_MODULE_IDS, parseBootstrapModules } from '../../scripts/lib/bootstrap-modules.mjs'

describe('parseBootstrapModules(D27)', () => {
  it('env 가 없으면 비core 전부, 빈 문자열은 [] (core 만)', () => {
    expect(parseBootstrapModules(undefined)).toEqual({ ok: true, modules: [...BOOTSTRAP_MODULE_IDS] })
    expect(parseBootstrapModules('')).toEqual({ ok: true, modules: [] })
    expect(parseBootstrapModules('   ')).toEqual({ ok: true, modules: [] })
  })
  it('쉼표·공백 구분, 중복 제거, 순서 유지', () => {
    expect(parseBootstrapModules('kanban, minutes,kanban  agents')).toEqual({ ok: true, modules: ['kanban', 'minutes', 'agents'] })
  })
  it('모르는 id·core id 는 멈추고 허용 목록을 돌려준다(대소문자 구분)', () => {
    expect(parseBootstrapModules('kanban, Wiki, wbs, nope')).toEqual({ ok: false, unknown: ['Wiki', 'wbs', 'nope'], allowed: [...BOOTSTRAP_MODULE_IDS] })
  })
  it('상수는 13개이고 core 넷이 없다', () => {
    expect(BOOTSTRAP_MODULE_IDS).toHaveLength(13)
    for (const c of ['dashboard', 'wbs', 'members', 'settings']) expect(BOOTSTRAP_MODULE_IDS).not.toContain(c)
  })
})
