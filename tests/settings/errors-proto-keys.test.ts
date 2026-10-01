import { describe, expect, it } from 'vitest'
import { mapDbError } from '@/lib/settings/errors'

// SP4 A2 P11(A1 이월) — 토큰 표는 객체 리터럴이라 프로토타입 이름이 표의 값처럼 읽혔다. 표에 없는 것은 null(호출부가 로그 + 500).
describe('mapDbError — 프로토타입 이름 토큰', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'toString: x'])('%s → null', (message) => {
    expect(mapDbError({ code: 'P0001', message })).toBeNull()
  })
  it('표의 토큰은 그대로 매핑된다(대조)', () => {
    expect(mapDbError({ code: 'P0001', message: 'COMMAND_REUSED' })).toMatchObject({ code: 'CONFIG_INVALID', status: 422 })
  })
})
