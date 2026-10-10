// 포털 머리의 날짜(스펙 §6.1 머리 행) — 시간대는 호출부가 viewTimezone(워크스페이스 calendar.timezone)으로 준다(판정 R1 — 서울 상수 없음)
import { describe, expect, it } from 'vitest'
import { portalDateLabel } from '@/lib/portal/dateLabel'

describe('portalDateLabel', () => {
  it('그 시간대의 월·일·요일 — 같은 순간도 시간대에 따라 날이 다르다', () => {
    const t = new Date('2026-09-28T15:30:00Z')
    expect(portalDateLabel(t, 'Asia/Seoul')).toBe('9월 29일 화요일')
    expect(portalDateLabel(t, 'UTC')).toBe('9월 28일 월요일')
    expect(portalDateLabel(t, 'America/Los_Angeles')).toBe('9월 28일 월요일')
  })
  it('시간대 이름이 아니면 null(다른 시간대로 대신 그리지 않는다)', () => {
    expect(portalDateLabel(new Date('2026-09-28T15:30:00Z'), 'Not/AZone')).toBeNull()
  })
})
