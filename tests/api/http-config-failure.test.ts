// 라우트의 설정·달력 실패 응답 한 꼴(A-4 리뷰 N5) — 달력 키 손상 → configStatus + CALENDAR_INVALID·키, 다른 키 손상 → 그 코드·키,
// 일시 조회 실패 → 503 고정 문구(원문은 로그). 그 밖의 예외는 null(호출부가 결함으로 처리).
import { describe, expect, it, vi } from 'vitest'
import { configFailureResponse } from '@/lib/api/http'
import { ConfigKeyError, ConfigUnavailableError, CONFIG_MESSAGES } from '@/lib/settings/errors'

describe('configFailureResponse', () => {
  it('달력 키 손상 → 422 CALENDAR_INVALID + 키', async () => {
    const r = configFailureResponse(new ConfigKeyError('CONFIG_INVALID', 'calendar.week_start'), 'x')!
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: `${CONFIG_MESSAGES.CONFIG_INVALID} (calendar.week_start)`, code: 'CALENDAR_INVALID', key: 'calendar.week_start' })
  })
  it('다른 키 손상 → 그 코드·키(단계 이름 등)', async () => {
    const r = configFailureResponse(new ConfigKeyError('CONFIG_INVALID', 'core.level_labels'), 'x')!
    expect(r.status).toBe(422)
    expect(await r.json()).toMatchObject({ code: 'CONFIG_INVALID', key: 'core.level_labels' })
  })
  it('조회 실패 → 503 고정 문구, 원문은 로그', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = configFailureResponse(new ConfigUnavailableError('프로젝트 설정 조회 실패: relation boom'), 'tag')!
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: '프로젝트 설정을 확인할 수 없습니다.' })
    expect(err).toHaveBeenCalledWith(expect.stringContaining('[tag]'), expect.stringContaining('relation boom'))
    err.mockRestore()
  })
  it('그 밖의 예외는 null', () => {
    expect(configFailureResponse(new Error('boom'), 'x')).toBeNull()
  })
})
