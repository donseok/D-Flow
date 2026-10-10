// 화면 날짜 표기의 한 꼴(BUG-20)과 시작/종료 역전 문구의 한 문형(BUG-21).
import { describe, expect, it } from 'vitest'
import { t, type DictKey } from '@/lib/i18n/dict'
import { formatDayIn, formatStampIn, formatYearMonth, formatYmd } from '@/lib/i18n/format'
import { dateOrderMessage } from '@/lib/i18n/dateOrder'
import { fmtDate } from '@/components/wbs/shared'

describe('[BUG-20] 화면 날짜 표기 — 4자리 연도 YYYY-MM-DD(시각은 YYYY-MM-DD HH:mm)', () => {
  it('달력 머리의 달은 YYYY-MM — 로케일 꼴(2026. 10.)을 쓰지 않고, 범위를 넘는 달은 해를 넘긴다', () => {
    expect(formatYearMonth(2026, 9)).toBe('2026-10'); expect(formatYearMonth(2026, 0)).toBe('2026-01')
    expect(formatYearMonth(2026, 12)).toBe('2027-01'); expect(formatYearMonth(2026, -1)).toBe('2025-12')
  })
  it('date-only 값은 그대로 — 2자리 연도(26.10.12)로 줄이지 않는다', () => {
    expect(formatYmd('2026-10-12')).toBe('2026-10-12')
    expect(fmtDate('2026-10-12')).toBe('2026-10-12')
    expect(formatYmd('2026-10-12T05:00:00Z')).toBe('2026-10-12')
    expect(formatYmd(null)).toBe('-'); expect(fmtDate(null)).toBe('-'); expect(formatYmd(undefined, '미정')).toBe('미정')
  })
  it('instant 는 그 tz 의 벽시계 — 같은 순간이 서울 10-04 08:30, LA 10-03 16:30', () => {
    const at = '2026-10-03T23:30:00.000Z'
    expect(formatStampIn(at, 'Asia/Seoul')).toBe('2026-10-04 08:30')
    expect(formatStampIn(at, 'America/Los_Angeles')).toBe('2026-10-03 16:30')
    expect(formatDayIn(at, 'Asia/Seoul')).toBe('2026-10-04')
    expect(formatDayIn(new Date(at), 'America/Los_Angeles')).toBe('2026-10-03')
  })
  it('읽을 수 없는 값·tz 미상은 빈 표시(기본 —) — 엉뚱한 날짜를 지어내지 않는다', () => {
    expect(formatStampIn('not-a-date', 'Asia/Seoul')).toBe('—')
    expect(formatStampIn('2026-10-03T23:30:00Z', null)).toBe('—')
    expect(formatDayIn(null, 'Asia/Seoul')).toBe('—')
    expect(formatStampIn('not-a-date', 'Asia/Seoul', 'not-a-date')).toBe('not-a-date')
  })
})

describe('[BUG-21] 시작/종료 역전 문구 — 사전 한 키, 대상 이름만 다르다', () => {
  it('기본은 시작일·종료일', () => {
    expect(dateOrderMessage(t)).toBe('시작일은 종료일보다 늦을 수 없습니다.')
  })
  it('이슈는 같은 문형에 목표 해결일', () => {
    expect(dateOrderMessage(t, { end: 'issue.form.due' })).toBe('시작일은 목표 해결일보다 늦을 수 없습니다.')
  })
  it('조사는 이름의 받침으로 고른다', () => {
    expect(dateOrderMessage(t, { start: 'issue.form.due' })).toBe('목표 해결일은 종료일보다 늦을 수 없습니다.')
    expect(dateOrderMessage((k: DictKey) => (k === 'common.date.start' ? '착수' : t(k)))).toBe('착수는 종료일보다 늦을 수 없습니다.')
  })
})
