import { describe, expect, it } from 'vitest'
import { withObjectParticle } from '@/lib/i18n/particle'
import { MODULE_LABEL } from '@/lib/modules/labels'
import { MODULE_IDS } from '@/lib/modules/defaults'

describe('withObjectParticle — 목적격 조사 을/를', () => {
  it('받침 없음 → 를, 받침 있음 → 을, 한글 아님 → 을(를)', () => {
    expect(withObjectParticle('이슈')).toBe('이슈를')
    expect(withObjectParticle('회의록')).toBe('회의록을')
    expect(withObjectParticle('Wiki')).toBe('Wiki을(를)')
    expect(withObjectParticle('')).toBe('을(를)')
  })
  it('모듈 표시 이름 표가 모든 모듈을 덮는다', () => {
    for (const id of MODULE_IDS) expect(MODULE_LABEL[id], id).toBeTruthy()
  })
})
