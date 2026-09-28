import { describe, it, expect } from 'vitest'
import { denyStatus, ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'

describe('denyStatus — 가드 사유 → HTTP status', () => {
  it('비로그인 401 · 권한 없음 403', () => {
    expect(denyStatus(ERR_ANON)).toBe(401)
    expect(denyStatus(ERR_DENIED)).toBe(403)
  })
  // 타 워크스페이스·미존재 프로젝트는 403 이 아니라 404 — 존재 자체를 알리지 않는다.
  it('대상 없음(존재 은닉)은 404 — fallback 을 무시한다', () => {
    expect(denyStatus(ERR_MISSING)).toBe(404)
    expect(denyStatus(ERR_MISSING, 503)).toBe(404)
  })
  it('그 외(권한 조회 실패 등)는 호출부 fallback', () => {
    expect(denyStatus(ERR_LOOKUP)).toBe(500)
    expect(denyStatus(ERR_LOOKUP, 503)).toBe(503)
  })
  // 모듈 관문(스펙 §4.1) — 꺼진 모듈은 존재를 알리지 않는다(404). 호출부 fallback 을 무시한다.
  it('모듈 꺼짐은 404 — fallback 을 무시한다', () => {
    expect(denyStatus(ERR_MODULE_DISABLED)).toBe(404)
    expect(denyStatus(ERR_MODULE_DISABLED, 503)).toBe(404)
  })
})
