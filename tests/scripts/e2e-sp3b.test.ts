import { describe, expect, it } from 'vitest'
import { expectLocation, hiddenVerdict, legacyCases } from '../../scripts/e2e-sp3b.mjs'

const O = 'http://127.0.0.1:3201'
const res = (status: number, location: string) => ({ status, headers: new Headers({ location }) })

describe('e2e-sp3b 순수 함수', () => {
  it('legacyCases — 옛 여덟 × 쿼리(없음·하나·여럿·인코딩)', () => {
    const cs = legacyCases('acme', { minuteId: 'm1', projectId: 'p1' })
    expect(cs).toContainEqual({ from: '/minutes?view=calendar', to: '/w/acme/minutes?view=calendar' })
    expect(cs).toContainEqual({ from: '/usage?days=7&menu=a&menu=b', to: '/w/acme/usage?days=7&menu=a&menu=b' })
    expect(cs).toContainEqual({ from: '/admin/accounts?project=p1', to: '/w/acme/admin/accounts?project=p1' })
    expect(cs).toContainEqual({ from: '/minutes/m1?block=2&version=v', to: '/w/acme/minutes/m1?block=2&version=v' })
    expect(cs.length).toBeGreaterThanOrEqual(16)
  })
  it('expectLocation — 307·요청 원점·경로·쿼리(상대 Location 도 원점에 풀어 본다)', () => {
    expect(expectLocation(res(307, `${O}/w/acme/minutes?view=x`), O, '/w/acme/minutes?view=x')).toEqual([])
    expect(expectLocation(res(307, '/w/acme/minutes?view=x'), O, '/w/acme/minutes?view=x')).toEqual([])
    expect(expectLocation(res(308, '/w/acme/minutes?view=x'), O, '/w/acme/minutes?view=x')).toEqual(['상태 308 ≠ 307'])
  })
  it('expectLocation — 인코딩 차이(%20 ↔ +)는 같은 값, 다른 호스트·경로·중복 키 순서는 다른 값', () => {
    expect(expectLocation(res(307, '/w/acme/minutes?q=a%20b'), O, '/w/acme/minutes?q=a+b')).toEqual([])
    expect(expectLocation(res(307, 'http://localhost:3201/w/acme/minutes'), O, '/w/acme/minutes')[0]).toMatch(/원점/)
    expect(expectLocation(res(307, '/w/other/minutes'), O, '/w/acme/minutes')[0]).toMatch(/경로/)
    expect(expectLocation(res(307, '/w/acme/usage?menu=b&menu=a'), O, '/w/acme/usage?menu=a&menu=b')[0]).toMatch(/쿼리/)
  })
  it('hiddenVerdict — 404 또는 notFound digest, 센티널이 본문에 있으면 문제', () => {
    expect(hiddenVerdict({ status: 404, html: '' })).toEqual([])
    expect(hiddenVerdict({ status: 200, html: 'x NEXT_HTTP_ERROR_FALLBACK;404 y' }, ['SECRET'])).toEqual([])
    expect(hiddenVerdict({ status: 200, html: 'ok' })[0]).toMatch(/404 가 아니다/)
    expect(hiddenVerdict({ status: 404, html: 'a SECRET b' }, ['SECRET'])[0]).toMatch(/SECRET/)
  })
})
