import { describe, expect, it } from 'vitest'
import { splitPrefs } from '@/lib/prefs/split'
import { isTypeEnabled, NOTIFICATION_CATALOG } from '@/lib/domain/inbox'

describe('개인 알림 토글 정책 (SPU1, 개정 §4.10)', () => {
  it('required: true 인 알림(work.reported 등)은 false 로 opt-out 하려 해도 차단된다', () => {
    // work.reported, work.approval_step, work.rejected 는 required: true
    expect(NOTIFICATION_CATALOG['work.reported'].required).toBe(true)
    expect(NOTIFICATION_CATALOG['work.approval_step'].required).toBe(true)
    expect(NOTIFICATION_CATALOG['work.rejected'].required).toBe(true)

    const rawNotif = {
      'work.assigned': false,       // required: false -> opt-out 허용
      'work.reported': false,       // required: true -> opt-out 차단 (무시)
      'work.approval_step': false,  // required: true -> opt-out 차단 (무시)
      'work.claimed': true,         // 허용
    }

    const { account } = splitPrefs({ notif: rawNotif })
    const cleanedNotif = account.notif as Record<string, boolean>

    expect(cleanedNotif).toBeDefined()
    expect(cleanedNotif['work.assigned']).toBe(false)
    expect(cleanedNotif['work.claimed']).toBe(true)
    // required 타입에 대한 false 시도는 저장 값에서 제외됨
    expect(cleanedNotif['work.reported']).toBeUndefined()
    expect(cleanedNotif['work.approval_step']).toBeUndefined()
  })

  it('조회 시점 필터 isTypeEnabled 는 prefs 에 false 가 있더라도 required 타입이면 무조건 true 를 돌려준다', () => {
    const maliciousPrefs = {
      'work.reported': false,
      'work.assigned': false,
    }

    expect(isTypeEnabled(maliciousPrefs, 'work.reported')).toBe(true)
    expect(isTypeEnabled(maliciousPrefs, 'work.assigned')).toBe(false)
  })
})
