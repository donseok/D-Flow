import { describe, expect, it } from 'vitest'
import { issueEntryRules } from '@/lib/issues/rules'
import { DEFAULT_ID_POLICY } from '@/lib/issues/idPolicy'
const AREA = { prefix: 'RS', pattern: '{prefix}-{area}-{seq:3}', counter_scope: 'area', reset: 'never' } as const
describe('이슈 등록 규칙', () => {
  it.each([
    ['off', 'required', DEFAULT_ID_POLICY, { areaRequired: false, analysis: 'off' }],
    ['off', 'optional', AREA, { areaRequired: true, analysis: 'off' }],
    ['on', 'optional', DEFAULT_ID_POLICY, { areaRequired: false, analysis: 'optional' }],
    ['on', 'required', DEFAULT_ID_POLICY, { areaRequired: true, analysis: 'required' }],
    ['on', 'optional', AREA, { areaRequired: true, analysis: 'optional' }],
  ] as const)('%s %s %j', (analysisModule, analysisSetting, policy, want) => {
    expect(issueEntryRules({ policy, analysisModule, analysisSetting })).toEqual(want)
  })
})
