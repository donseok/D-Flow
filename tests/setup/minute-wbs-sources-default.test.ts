// tests/setup/minute-wbs-sources.ts 의 전역 기본 mock 을 고정한다 — 회의록 원문 읽기만 대역('연결 없음')이고 준비·등록 두 액션은 진짜다.
// 진짜 읽기 액션을 보는 파일의 vi.unmock 은 tests/actions/minute-wbs.test.ts 가 고정한다(isMockFunction === false).
import { describe, expect, it, vi } from 'vitest'
import { createWbsItemsFromMinute, getWbsItemMinuteSources, prepareMinuteWbsDrafts } from '@/app/actions/minuteWbs'

describe('셋업 기본 mock — @/app/actions/minuteWbs', () => {
  it('getWbsItemMinuteSources 는 대역이고 연결 없음을 돌려준다 — 상세 패널을 그리는 테스트가 진짜 액션(cookies)으로 가지 않는다', async () => {
    expect(vi.isMockFunction(getWbsItemMinuteSources)).toBe(true)
    await expect(getWbsItemMinuteSources('item-1')).resolves.toEqual({ ok: true, rows: [] })
  })

  it('mockReset 뒤에도 같은 기본값이다 — undefined 로 구역이 깨지지 않는다(vi.fn(impl))', async () => {
    vi.mocked(getWbsItemMinuteSources).mockReset()
    await expect(getWbsItemMinuteSources('item-1')).resolves.toEqual({ ok: true, rows: [] })
  })

  it('준비·등록 액션은 진짜다(importActual)', () => {
    expect(vi.isMockFunction(prepareMinuteWbsDrafts)).toBe(false)
    expect(vi.isMockFunction(createWbsItemsFromMinute)).toBe(false)
  })
})
