// tests/ai/commands-parse.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn() }))

import { generateAnswer } from '@/lib/ai/llm'
import {
  parseDeterministic, extractJson, validateParsed, parseCommand, parseSystemPrompt,
} from '@/lib/ai/commands/parse'

const mGen = vi.mocked(generateAnswer)

describe('parseDeterministic — LLM 없이 잡는 고빈도 패턴', () => {
  it('실적 NN(%)로/으로 + 올려/변경/바꿔', () => {
    expect(parseDeterministic('ERP 인터페이스 설계 실적 80으로 올려줘')).toEqual({
      action: 'set_actual', targetQuery: 'ERP 인터페이스 설계', actualPct: 80,
    })
  })
  it('완료 처리', () => {
    expect(parseDeterministic('TFT R&R 확정 완료 처리해줘')).toEqual({
      action: 'complete', targetQuery: 'TFT R&R 확정',
    })
  })
  it('범위 밖 실적은 null (LLM 폴백에 넘김)', () => {
    expect(parseDeterministic('설계 실적 180으로 올려줘')).toBeNull()
  })
  it('일정 변경 문장은 결정형이 안 잡는다 (날짜 해석은 LLM 몫)', () => {
    expect(parseDeterministic('기준정보 정제 종료일 8월 20일로 미뤄줘')).toBeNull()
  })
})

describe('extractJson — 관용적 JSON 추출', () => {
  it('코드펜스를 벗긴다', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('서두 문장 뒤 첫 {} 블록', () => {
    expect(extractJson('다음과 같습니다: {"a":1} 끝')).toEqual({ a: 1 })
  })
  it('JSON 없으면 null', () => {
    expect(extractJson('죄송하지만 이해하지 못했어요')).toBeNull()
  })
})

describe('validateParsed — 스키마 강제', () => {
  it('유효한 set_dates', () => {
    expect(validateParsed({
      action: 'set_dates', targetQuery: '기준정보 정제', plannedEnd: '2026-08-20',
    })).toEqual({ action: 'set_dates', targetQuery: '기준정보 정제', plannedEnd: '2026-08-20' })
  })
  it('잘못된 날짜 형식 거부', () => {
    expect(validateParsed({ action: 'set_dates', targetQuery: 'x', plannedEnd: '8월 20일' })).toBeNull()
  })
  it('실적 범위 밖 거부', () => {
    expect(validateParsed({ action: 'set_actual', targetQuery: 'x', actualPct: 101 })).toBeNull()
  })
  it('빈 targetQuery 거부', () => {
    expect(validateParsed({ action: 'complete', targetQuery: ' ' })).toBeNull()
  })
})

// 고정한 '오늘' — 실제 달력과 무관하게 통과해야 한다(해가 바뀌어도)
const TODAY = '2031-03-04'

describe('parseCommand — 결정형 우선, LLM 폴백', () => {
  beforeEach(() => vi.clearAllMocks())
  it('결정형이 잡으면 LLM을 부르지 않는다', async () => {
    const r = await parseCommand('설계 검토 실적 60으로 변경', TODAY)
    expect(r?.action).toBe('set_actual')
    expect(mGen).not.toHaveBeenCalled()
  })
  it('결정형 실패 시 LLM JSON을 검증해 반환', async () => {
    mGen.mockResolvedValue('{"action":"set_dates","targetQuery":"기준정보 정제","plannedEnd":"2026-08-20"}')
    const r = await parseCommand('기준정보 정제 종료일 8월 20일로 미뤄줘', TODAY)
    expect(r).toEqual({ action: 'set_dates', targetQuery: '기준정보 정제', plannedEnd: '2026-08-20' })
  })
  it('LLM null(불능)이면 null', async () => {
    mGen.mockResolvedValue(null)
    expect(await parseCommand('기준정보 정제 종료일 미뤄줘', TODAY)).toBeNull()
  })
  it('LLM이 이상한 텍스트를 내면 null (환각 방어)', async () => {
    mGen.mockResolvedValue('알겠습니다! 변경하겠습니다.')
    expect(await parseCommand('기준정보 정제 종료일 미뤄줘', TODAY)).toBeNull()
  })
  it('프롬프트의 연도는 넘겨받은 오늘에서 온다 — 상수 연도가 없다', async () => {
    mGen.mockResolvedValue(null)
    await parseCommand('기준정보 정제 종료일 8월 20일로 미뤄줘', TODAY)
    const system = mGen.mock.calls[0][0]
    expect(system).toContain('오늘은 2031-03-04')
    expect(system).toContain('연도 불명시는 2031')
    await parseCommand('기준정보 정제 종료일 8월 20일로 미뤄줘', '2040-12-31')
    expect(mGen.mock.calls[1][0]).toContain('연도 불명시는 2040')
    // 오늘을 뺀 나머지 문구에는 연도 숫자가 남지 않는다
    expect(parseSystemPrompt('YYYY-MM-DD')).not.toMatch(/\b(19|20)\d{2}\b/)
  })
})
