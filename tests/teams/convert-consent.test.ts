// 전환 동의 토큰(SP4 A1-5 R3) — 409 확인 창이 보여 준 전환 대상(공용 팀 전부 + 등록할 팀)의 지문. 재요청이 그 토큰을 보내야 전환한다 —
// 그 사이 대상이 바뀌면(공용 팀 추가·활성 변경·개명, 등록할 팀 변경) 토큰이 달라져 서버가 다시 409 를 낸다.
import { describe, expect, it } from 'vitest'
import { convertConsentToken } from '@/lib/teams/convertConsent'

const T = (id: string, code: string, over: Partial<{ name: string; active: boolean }> = {}) => ({ id, code, name: over.name ?? code, active: over.active ?? true })
const COMMON = [T('c1', 'RES', { name: '연구팀' }), T('c2', 'OPS'), T('c3', 'OLD', { active: false })]

describe('convertConsentToken', () => {
  it('같은 대상이면 같은 토큰 — 입력 순서와 무관(공용 팀·등록할 팀 모두)', () => {
    const a = convertConsentToken(COMMON, ['QA', 'LAB'])
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(convertConsentToken([...COMMON].reverse(), ['LAB', 'QA'])).toBe(a)
  })
  it('공용 팀이 늘거나 활성이 바뀌거나 개명되면 다른 토큰 — 사용자가 보지 못한 팀이 전환되지 않는다', () => {
    const base = convertConsentToken(COMMON, ['QA'])
    expect(convertConsentToken([...COMMON, T('c4', 'NEW')], ['QA'])).not.toBe(base)
    expect(convertConsentToken(COMMON.map((t) => (t.id === 'c3' ? { ...t, active: true } : t)), ['QA'])).not.toBe(base)
    expect(convertConsentToken(COMMON.map((t) => (t.id === 'c1' ? { ...t, name: '연구' } : t)), ['QA'])).not.toBe(base)
    expect(convertConsentToken(COMMON.slice(0, 2), ['QA'])).not.toBe(base)
  })
  it('등록할 팀이 다르면 다른 토큰', () => {
    expect(convertConsentToken(COMMON, ['QA'])).not.toBe(convertConsentToken(COMMON, ['QA', 'LAB']))
  })
  it('필드 경계가 섞이지 않는다 — code/name 이음이 달라도 같은 문자열이 되지 않는다', () => {
    expect(convertConsentToken([T('c1', 'AB', { name: 'C' })], [])).not.toBe(convertConsentToken([T('c1', 'A', { name: 'BC' })], []))
  })
})
