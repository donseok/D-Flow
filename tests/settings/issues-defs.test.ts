import { describe, expect, it } from 'vitest'
import { PROJECT_SETTINGS } from '@/lib/settings/registry'
import { DEFAULT_ID_POLICY } from '@/lib/issues/idPolicy'
import { OFF_ON_CREATE, PROJECT_TOGGLABLE } from '@/lib/modules/defaults'
import { moduleDef } from '@/lib/modules/registry'

const def = (key: string) => PROJECT_SETTINGS.find((d) => d.key === key)!

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
