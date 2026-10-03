import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ID_POLICY, codeExample, issueCodeYear, parseIdPolicy, policyNeedsArea, policyNeedsYear, renderIssueCode, scopeKeyOf,
} from '@/lib/issues/idPolicy'
import { ISSUE_OWN_TOKENS } from '@/lib/issues/errors'
import { ID_POLICY_PARSE_CASES, ID_POLICY_RENDER_CASES, ISSUE_YEAR_BAD_TZ, ISSUE_YEAR_CASES } from '../fixtures/issue-id-policy-cases'

describe('parseIdPolicy — 개정 §4.4.3 검증표', () => {
  it.each(ID_POLICY_PARSE_CASES)('$name', ({ raw, ok }) => {
    expect(parseIdPolicy(raw).ok).toBe(ok)
  })
  it('제품 기본값이 통과하고 얼어 있다', () => {
    expect(parseIdPolicy(DEFAULT_ID_POLICY)).toEqual({ ok: true, value: DEFAULT_ID_POLICY })
    expect(Object.isFrozen(DEFAULT_ID_POLICY)).toBe(true)
  })
})

describe('renderIssueCode — 최소 n자리·절단 금지', () => {
  it.each(ID_POLICY_RENDER_CASES)('$name → $code', ({ policy, areaCode, year, seq, code }) => {
    expect(renderIssueCode(policy, { areaCode, year, seq })).toBe(code)
  })
  it('{area} 인데 영역 없음·{yyyy} 인데 연도 없음은 던진다', () => {
    expect(() => renderIssueCode({ prefix: 'RS', pattern: '{prefix}-{area}-{seq:3}', counter_scope: 'area', reset: 'never' }, { areaCode: null, year: null, seq: 1 }))
      .toThrow('ISSUE_AREA_REQUIRED')
    expect(() => renderIssueCode({ prefix: 'R', pattern: '{prefix}-{yyyy}-{seq:3}', counter_scope: 'project', reset: 'yearly' }, { areaCode: null, year: null, seq: 1 }))
      .toThrow('ISSUE_YEAR_REQUIRED')
  })
  it("치환 값의 $ 특수 패턴($&·$1·$$)을 해석하지 않고 리터럴로 넣는다(순수 함수가 호출자 신뢰에 기대지 않는다)", () => {
    const rs = { prefix: 'RS', pattern: '{prefix}-{area}-{seq:3}', counter_scope: 'area', reset: 'never' } as const
    expect(renderIssueCode(rs, { areaCode: '$&', year: null, seq: 1 })).toBe('RS-$&-001')
    expect(renderIssueCode(rs, { areaCode: '$1', year: null, seq: 1 })).toBe('RS-$1-001')
    expect(renderIssueCode(rs, { areaCode: '$$', year: null, seq: 1 })).toBe('RS-$$-001')
    expect(renderIssueCode({ ...rs, prefix: '$&' }, { areaCode: 'A', year: null, seq: 1 })).toBe('$&-A-001')
  })
  it('레거시 형식(이관 전용)은 영역별 템플릿과 겹치지 않는다 — 1..1500 전부(D55)', () => {
    const pi = { prefix: 'PI', pattern: '{prefix}-I-{area}-{seq:2}', counter_scope: 'area', reset: 'never' } as const
    const legacy = { prefix: 'PI', pattern: '{prefix}-U-{seq:3}', counter_scope: 'project', reset: 'never' } as const
    const piCodes = new Set<string>()
    for (const a of ['00', '07', 'U', 'RND']) for (let s = 1; s <= 1500; s++) piCodes.add(renderIssueCode(pi, { areaCode: a, year: null, seq: s }))
    for (let s = 1; s <= 1500; s++) expect(piCodes.has(renderIssueCode(legacy, { areaCode: null, year: null, seq: s }))).toBe(false)
  })
})

describe('범위 키·필요 판정·예시', () => {
  it('scopeKeyOf 네 꼴', () => {
    const A = '00000000-0000-0000-7e57-000000001bb0'
    expect(scopeKeyOf(DEFAULT_ID_POLICY, { areaId: A, year: 2026 })).toBe('')
    expect(scopeKeyOf({ ...DEFAULT_ID_POLICY, pattern: '{area}-{seq:3}', counter_scope: 'area' }, { areaId: A, year: null })).toBe(`a:${A}`)
    expect(scopeKeyOf({ ...DEFAULT_ID_POLICY, pattern: '{yyyy}-{seq:3}', reset: 'yearly' }, { areaId: null, year: 2026 })).toBe('y:2026')
    expect(scopeKeyOf({ prefix: '', pattern: '{area}{yy}{seq:3}', counter_scope: 'area', reset: 'yearly' }, { areaId: A, year: 2026 })).toBe(`a:${A}|y:2026`)
  })
  it('policyNeedsArea·policyNeedsYear 는 패턴의 토큰만 본다', () => {
    expect(policyNeedsArea({ ...DEFAULT_ID_POLICY, pattern: '{prefix}-{area}-{seq:3}' })).toBe(true)
    expect(policyNeedsArea(DEFAULT_ID_POLICY)).toBe(false)
    expect(policyNeedsYear({ ...DEFAULT_ID_POLICY, pattern: '{yy}-{seq:3}' })).toBe(true)
  })
  it('codeExample — 영역이 필요한데 없으면 RND, seq 1(P19)', () => {
    expect(codeExample({ prefix: 'RS', pattern: '{prefix}-{area}-{seq:3}', counter_scope: 'area', reset: 'never' }, { areaCode: null, year: 2026 })).toBe('RS-RND-001')
    expect(codeExample(DEFAULT_ID_POLICY, { areaCode: 'OPS', year: 2026 })).toBe('ISS-001')
  })
})

describe('issueCodeYear — 프로젝트 tz 의 달력 연도(§9.1 D54 정본)', () => {
  it.each(ISSUE_YEAR_CASES)('$tz $at → $year', ({ tz, at, year }) => {
    expect(issueCodeYear(tz, new Date(at))).toBe(year)
  })
  it.each(ISSUE_YEAR_BAD_TZ)('거부: %s', (tz) => {
    expect(() => issueCodeYear(tz, new Date('2026-06-01T00:00:00Z'))).toThrow('CONFIG_INVALID:calendar.timezone')
  })
})

describe('DB 토큰 표', () => {
  it('정상 경로 토큰은 고정 문구로, 원문 낱말을 싣지 않는다', () => {
    for (const t of ['ISSUE_AREA_REQUIRED', 'ISSUE_AREA_INACTIVE', 'ISSUE_AREA_NOT_FOUND', 'ISSUE_AREA_IMMUTABLE', 'ISSUE_CODE_EXHAUSTED',
      'CONFIG_INVALID', 'ISSUE_ANALYSIS_DISABLED', 'ISSUE_ANALYSIS_REQUIRED']) {
      expect(ISSUE_OWN_TOKENS[t], t).toBeDefined()
      expect(ISSUE_OWN_TOKENS[t].message).not.toMatch(/[A-Z_]{6,}/)
    }
  })
})
