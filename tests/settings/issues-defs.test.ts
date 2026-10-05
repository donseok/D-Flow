import { describe, expect, it } from 'vitest'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { DEFAULT_ID_POLICY } from '@/lib/issues/idPolicy'
import { OFF_ON_CREATE, PROJECT_TOGGLABLE, type ModuleId } from '@/lib/modules/defaults'
import { closeRequires } from '@/lib/modules/closure'
import { CORE, moduleDef } from '@/lib/modules/registry'
import { PRE_B1_NON_CORE_MODULES, PRE_B1_PROJECT_TOGGLABLE } from '../fixtures/pre-b1-modules'

const def = (key: string) => PROJECT_SETTINGS.find((d) => d.key === key)!
const wsDef = (key: string) => WORKSPACE_SETTINGS.find((d) => d.key === key)!

describe('SP5 B1 — issues.* 두 정의와 issue_analysis 모듈(D15·D16·D44)', () => {
  it('issues.id_policy — 기본값 ISS-{seq:3}, 모듈 issues, 손상 거부, 새 이슈에만(future_only)', () => {
    const d = def('issues.id_policy')
    expect(d.default).toEqual(DEFAULT_ID_POLICY)
    expect(d.module).toBe('issues')
    expect(d.parse({ ...DEFAULT_ID_POLICY, pattern: '{prefix}' }).ok).toBe(false)
    expect(d.impact).toEqual(['future_only'])
    expect(d.sql).toEqual({ readers: ['assign_issue_code', 'create_issue_from_minute_block', 'settings_ref_check'] })
  })
  it("issues.analysis — 'optional' 기본, 모듈 issue_analysis, enum 밖 거부", () => {
    const d = def('issues.analysis')
    expect(d.default).toBe('optional')
    expect(d.module).toBe('issue_analysis')
    expect(d.parse('required')).toEqual({ ok: true, value: 'required' })
    expect(d.parse('always').ok).toBe(false)
  })
  it('issue_analysis 는 issues 를 요구하고 새 프로젝트에서 꺼진다(개정 §4.4.2)', () => {
    expect(moduleDef('issue_analysis').requires).toEqual(['issues'])
    expect(PROJECT_TOGGLABLE.has('issue_analysis')).toBe(true)
    expect(OFF_ON_CREATE).toEqual(['issue_analysis'])
    expect(def('modules.enabled').default).not.toContain('issue_analysis')
  })
})

// 이미 저장된 값(B1 이전 리터럴 — tests/fixtures/pre-b1-modules.ts)이 새 정의를 여전히 통과하고, 새 모듈이 몰래 켜지지 않는다(B1-1 리뷰 P2-6)
describe('SP5 B1 — 기존 저장 값 호환', () => {
  it('옛 프로젝트 토글 9개 목록이 modules.enabled parse 를 통과한다', () => {
    expect(def('modules.enabled').parse([...PRE_B1_PROJECT_TOGGLABLE])).toEqual({ ok: true, value: [...PRE_B1_PROJECT_TOGGLABLE] })
    expect(def('modules.enabled').parse([]).ok).toBe(true)
  })
  it('옛 비core 13개 목록이 modules.allowed parse 를 통과한다', () => {
    expect(wsDef('modules.allowed').parse([...PRE_B1_NON_CORE_MODULES])).toEqual({ ok: true, value: [...PRE_B1_NON_CORE_MODULES] })
    expect(wsDef('modules.allowed').parse([]).ok).toBe(true)
  })
  it('옛 modules.enabled 를 닫아도 issue_analysis 가 들어오지 않는다(닫힘은 빼기만 한다)', () => {
    const parsed = def('modules.enabled').parse([...PRE_B1_PROJECT_TOGGLABLE])
    if (!parsed.ok) throw new Error('옛 목록이 통과해야 한다')
    const closed = closeRequires(new Set<ModuleId>([...CORE, ...(parsed.value as ModuleId[])]), (id) => moduleDef(id).requires)
    expect(closed.has('issue_analysis')).toBe(false)
    expect(closed.has('issues')).toBe(true)
    expect(PRE_B1_PROJECT_TOGGLABLE).not.toContain('issue_analysis')
    expect(PRE_B1_NON_CORE_MODULES).not.toContain('issue_analysis')
  })
})
