import { describe, it, expect } from 'vitest'
import { correctMinuteBodyTime } from '@/lib/minutes/timeFix'

/** 기존 기대값의 범위 — 2026-07 서울은 +9 */
const SEOUL = { timeZone: 'Asia/Seoul', fallbackDate: '2026-07-15' }

/** 4-마커 메타 헤더가 있는 녹취툴 산출물 본문. */
function toolBody(timeLine: string): string {
  return [
    '# 칼라생산팀 2026.07.15',
    '',
    '- **날짜**: 2026-07-15',
    `- **시간**: ${timeLine}`,
    '- **상태**: 완료',
    '- **생성자**: 관리자',
    '',
    '---',
    '',
    '## AI 회의록',
    '본문 내용',
  ].join('\n')
}

describe('correctMinuteBodyTime', () => {
  it('녹취툴 서명이 있으면 시간 줄만 +9h 보정하고 corrected/from/to 반환', () => {
    const r = correctMinuteBodyTime(toolBody('00:01 ~ 01:59'), SEOUL)
    expect(r.corrected).toBe(true)
    expect(r.from).toBe('00:01 ~ 01:59')
    expect(r.to).toBe('09:01 ~ 10:59')
    expect(r.body).toContain('- **시간**: 09:01 ~ 10:59')
    // 다른 메타 줄·본문은 그대로
    expect(r.body).toContain('- **날짜**: 2026-07-15')
    expect(r.body).toContain('## AI 회의록')
  })

  it('자정을 넘는 시각은 각 시각 독립적으로 mod 24 (23:58→08:58, 00:42→09:42)', () => {
    const r = correctMinuteBodyTime(toolBody('23:58 ~ 00:42'), SEOUL)
    expect(r.corrected).toBe(true)
    expect(r.to).toBe('08:58 ~ 09:42')
    expect(r.body).toContain('- **시간**: 08:58 ~ 09:42')
  })

  it('4-마커 서명이 없으면(손작성 md) 무변경', () => {
    const hand = '# 회의 메모\n\n- **시간**: 00:01 ~ 01:59\n\n내용만 있음'
    const r = correctMinuteBodyTime(hand, SEOUL)
    expect(r.corrected).toBe(false)
    expect(r.body).toBe(hand)
    expect(r.from).toBeUndefined()
  })

  it('서명은 있으나 시간 줄이 없으면 무변경', () => {
    const body = [
      '# 제목', '', '- **날짜**: 2026-07-15', '- **상태**: 완료', '- **생성자**: 관리자', '', '## AI 회의록',
    ].join('\n')
    const r = correctMinuteBodyTime(body, SEOUL)
    expect(r.corrected).toBe(false)
    expect(r.body).toBe(body)
  })

  it('빈/널 본문도 안전', () => {
    expect(correctMinuteBodyTime('', SEOUL).corrected).toBe(false)
    expect(correctMinuteBodyTime('', SEOUL).body).toBe('')
  })
})

describe('correctMinuteBodyTime — 회의록 범위 tz 로 일반화(스펙 D13 ④)', () => {
  it('LA 여름(PDT −7): 17:01 UTC → 10:01', () => {
    const r = correctMinuteBodyTime(toolBody('17:01 ~ 18:30'), { timeZone: 'America/Los_Angeles', fallbackDate: '2026-07-15' })
    expect(r).toMatchObject({ corrected: true, from: '17:01 ~ 18:30', to: '10:01 ~ 11:30', tz: 'America/Los_Angeles' })
  })
  it('DST 는 본문의 **날짜** 로 정한다 — 1월 LA(PST −8)', () => {
    const body = toolBody('17:01 ~ 18:30').replace('2026-07-15', '2026-01-15')
    expect(correctMinuteBodyTime(body, { timeZone: 'America/Los_Angeles', fallbackDate: '2026-07-15' }).to).toBe('09:01 ~ 10:30')
  })
  it('**날짜** 줄이 날짜 꼴이 아니면 fallbackDate', () => {
    const body = toolBody('17:01 ~ 18:30').replace('2026-07-15', '7월 15일')
    expect(correctMinuteBodyTime(body, { timeZone: 'America/Los_Angeles', fallbackDate: '2026-01-15' }).to).toBe('09:01 ~ 10:30')
  })
  it('**날짜** 줄이 실재하지 않는 날짜면 fallbackDate — 02-30 을 03-02(PST)로 굴리지 않는다', () => {
    const body = toolBody('17:01 ~ 18:30').replace('2026-07-15', '2026-02-30')
    expect(correctMinuteBodyTime(body, { timeZone: 'America/Los_Angeles', fallbackDate: '2026-07-15' }).to).toBe('10:01 ~ 11:30')
  })
  it('UTC 범위는 보정하지 않는다(이동 0)', () => {
    const body = toolBody('00:01 ~ 01:59')
    expect(correctMinuteBodyTime(body, { timeZone: 'UTC', fallbackDate: '2026-07-15' })).toEqual({ body, corrected: false })
  })
  it('자정을 넘는 시각은 시·분만(지금의 % 24 와 같다) — 서울 20:30 UTC → 05:30', () => {
    expect(correctMinuteBodyTime(toolBody('20:30 ~ 21:00'), SEOUL).to).toBe('05:30 ~ 06:00')
  })
})
