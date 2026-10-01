import { describe, expect, it } from 'vitest'
import { WS_BASE_RE, wsHref, wsMinuteHref } from '@/lib/workspace/paths'

describe('wsHref — 화면 안 링크의 유일한 조립 함수', () => {
  it('조각·쿼리', () => {
    expect(wsHref('acme')).toBe('/w/acme')
    expect(wsHref('acme', 'minutes')).toBe('/w/acme/minutes')
    expect(wsHref('acme', 'admin/accounts', { project: 'p1' })).toBe('/w/acme/admin/accounts?project=p1')
    expect(wsHref('acme', 'minutes', { project: null, q: '' })).toBe('/w/acme/minutes')
  })
  it('회의록 상세는 id 를 인코딩한다', () => {
    expect(wsMinuteHref('acme', 'a/b', { block: '3' })).toBe('/w/acme/minutes/a%2Fb?block=3')
  })
  it('WS_BASE_RE 는 슬러그와 나머지를 가른다', () => {
    expect(WS_BASE_RE.exec('/w/acme/minutes/x')?.slice(1)).toEqual(['acme', '/minutes/x'])
    expect(WS_BASE_RE.exec('/w/acme')?.slice(1)).toEqual(['acme', undefined])
    expect(WS_BASE_RE.exec('/p/x')).toBeNull()
  })
})
