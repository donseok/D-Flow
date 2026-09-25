import { describe, it, expect } from 'vitest'
import { validateArea, type AreaInput } from '@/lib/domain/areas'

const base = (over: Partial<AreaInput> = {}): AreaInput => ({
  kind: 'weekly_section', code: 'PLAN', name: '생산계획', sortOrder: 0, active: true,
  teams: [{ teamId: 't-erp', kind: 'primary' }, { teamId: 't-mes', kind: 'support' }],
  ...over,
})

describe('validateArea', () => {
  it('정상 입력은 code·name 을 trim 해 돌려준다', () => {
    const r = validateArea(base({ code: ' PLAN ', name: ' 생산계획 ' }), [])
    expect(r).toEqual({ ok: true, value: base() })
  })

  it('kind 는 제품 고정 두 값뿐', () => {
    const r = validateArea(base({ kind: 'etc' as AreaInput['kind'] }), [])
    expect(r.ok).toBe(false)
  })

  it('code·name 공백은 거부', () => {
    expect(validateArea(base({ code: '   ' }), [])).toEqual({ ok: false, error: '영역 코드를 입력하세요.' })
    expect(validateArea(base({ name: '' }), [])).toEqual({ ok: false, error: '영역 이름을 입력하세요.' })
  })

  it('순서는 정수(숫자형) — 문자열·NaN 도 거부', () => {
    expect(validateArea(base({ sortOrder: 1.5 }), []).ok).toBe(false)
    expect(validateArea(base({ sortOrder: NaN }), []).ok).toBe(false)
    expect(validateArea(base({ sortOrder: '1' as unknown as number }), [])).toEqual({ ok: false, error: '순서는 정수여야 합니다.' })
  })

  it('같은 kind 에 같은 code 가 있으면 거부 — 자기 자신(같은 id)은 제외, 다른 kind 는 허용', () => {
    const existing = [{ id: 'a1', kind: 'weekly_section' as const, code: 'PLAN' }]
    expect(validateArea(base(), existing)).toEqual({ ok: false, error: "'PLAN' 코드가 이미 있습니다." })
    expect(validateArea(base({ id: 'a1' }), existing).ok).toBe(true)
    expect(validateArea(base({ kind: 'issue_area' }), existing).ok).toBe(true)
  })

  it('담당 팀 kind 는 primary|support 만, 같은 팀 중복은 거부', () => {
    expect(validateArea(base({ teams: [{ teamId: 't1', kind: 'lead' as 'primary' }] }), []).ok).toBe(false)
    expect(validateArea(base({ teams: [{ teamId: 't1', kind: 'primary' }, { teamId: 't1', kind: 'support' }] }), []))
      .toEqual({ ok: false, error: '같은 팀을 두 번 지정할 수 없습니다.' })
  })

  it('담당 팀 0개는 허용(소비처가 없는 SP1 에서 강제하지 않는다)', () => {
    expect(validateArea(base({ teams: [] }), []).ok).toBe(true)
  })
})
