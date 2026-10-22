import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import { clearMinuteMockupCache } from '@/lib/ai/minute-mockup-cache'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  requireModule: vi.fn(),
  verifyMinuteIssueBlock: vi.fn(),
  aiAvailable: vi.fn(),
  generateAnswer: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/lib/modules/gate', () => ({
  requireModule: mocks.requireModule,
}))
vi.mock('@/lib/minutes/verifySource', () => ({
  verifyMinuteIssueBlock: mocks.verifyMinuteIssueBlock,
}))
vi.mock('@/lib/modules/aiAvailable', () => ({
  aiAvailable: mocks.aiAvailable,
}))
vi.mock('@/lib/ai/llm', () => ({
  generateAnswer: mocks.generateAnswer,
}))
vi.mock('@/lib/i18n/server', () => ({
  serverTranslator: async () => (key: string) => key,
}))

import { prepareMinuteDesignSpec, prepareMinuteMockup } from '@/app/actions/minuteMockup'

const P = '00000000-0000-0000-7e57-000000001432'
const M = '00000000-0000-0000-7e57-000000001433'
const V = '00000000-0000-0000-7e57-000000001434'
const SOURCE: MinuteIssueSourceInput = {
  minuteId: M,
  minuteVersionId: V,
  bodyHash: '0123456789abcdef',
  blockIndex: 0,
  blockHash: 'fedcba9876543210',
  kind: 'manual',
}

const VERIFIED_BODY = {
  ok: true as const,
  value: {
    storedBodyHash: '0123456789abcdef',
    block: {
      index: 0,
      hash: 'fedcba9876543210',
      text: '로그인 화면과 권한 신청 화면을 만든다.',
      kind: 'paragraph' as const,
    },
    insightLabel: null,
    draftContextText: '회의록: 설계 회의 · 2026-10-22',
    selectionExcerpt: null,
  },
}

const VALID_SPEC_JSON = JSON.stringify({
  title: '권한 신청 설계서',
  overview: '로그인 및 권한 신청 흐름 정의',
  requirements: [{ id: 'FR-01', category: '인증', title: '로그인', description: '사내 계정 로그인', priority: 'high' }],
  screens: [{ id: 'login', name: '로그인', purpose: '인증', elements: ['이메일', '버튼'], flow: '홈으로 이동' }],
  rules: [{ kind: 'auth', title: '세션 만료', detail: '30분 무응답 시 만료' }],
  openQuestions: ['2FA 의무화 여부'],
})

const VALID_MOCKUP_JSON = JSON.stringify({
  title: '권한 신청 목업',
  screens: [
    { id: 'login', title: '로그인', summary: '인증 화면', components: [{ type: 'heading', text: '로그인' }, { type: 'button', text: '진입', goto: 'home' }] },
    { id: 'home', title: '홈', summary: '메인 화면', components: [{ type: 'text', text: '환영합니다' }] },
  ],
})

describe('minuteMockup 서버 액션 적대적 검증 (prepareMinuteDesignSpec · prepareMinuteMockup)', () => {
  beforeEach(() => {
    clearMinuteMockupCache()
    vi.clearAllMocks()
    mocks.requireProjectMember.mockResolvedValue({
      ok: true,
      actor: { userId: 'u1', projectWorkspace: new Map([[P, 'ws-1']]) },
    })
    mocks.requireModule.mockResolvedValue({ ok: true })
    mocks.verifyMinuteIssueBlock.mockResolvedValue(VERIFIED_BODY)
    mocks.aiAvailable.mockResolvedValue(true)
  })

  it('비멤버·모듈 비활성은 원문 검증·LLM 호출 전에 즉시 거부한다', async () => {
    mocks.requireProjectMember.mockResolvedValueOnce({ ok: false, error: 'ERR_DENIED' })
    expect(await prepareMinuteDesignSpec(P, SOURCE)).toEqual({ ok: false, error: 'ERR_DENIED' })
    expect(mocks.requireModule).not.toHaveBeenCalled()
    expect(mocks.verifyMinuteIssueBlock).not.toHaveBeenCalled()

    mocks.requireModule.mockResolvedValueOnce({ ok: false, error: 'ERR_MODULE_DISABLED' })
    expect(await prepareMinuteMockup(P, SOURCE)).toEqual({ ok: false, error: 'ERR_MODULE_DISABLED' })
    expect(mocks.verifyMinuteIssueBlock).not.toHaveBeenCalled()
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('비정상 source(null·배열·비UUID)와 제목(heading) 단독 블록은 LLM 호출 전에 거부한다', async () => {
    for (const bad of [null, [], { ...SOURCE, minuteId: 'not-uuid' }, { ...SOURCE, minuteVersionId: 'bad' }]) {
      expect(await prepareMinuteDesignSpec(P, bad as unknown as MinuteIssueSourceInput)).toEqual({
        ok: false,
        error: 'srv.minuteMockup.sourceInvalid',
      })
    }
    expect(mocks.verifyMinuteIssueBlock).not.toHaveBeenCalled()

    mocks.verifyMinuteIssueBlock.mockResolvedValueOnce({
      ok: true,
      value: {
        ...VERIFIED_BODY.value,
        block: { ...VERIFIED_BODY.value.block, headingDepth: 2 },
      },
    })
    expect(await prepareMinuteMockup(P, SOURCE)).toEqual({
      ok: false,
      error: 'srv.minuteWbs.headingBlock',
    })
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('AI 비활성 환경이면 캐시·LLM 호출 없이 aiUnavailable 을 반환한다', async () => {
    mocks.aiAvailable.mockResolvedValue(false)
    expect(await prepareMinuteDesignSpec(P, SOURCE)).toEqual({
      ok: false,
      error: 'srv.minuteMockup.aiUnavailable',
    })
    expect(await prepareMinuteMockup(P, SOURCE)).toEqual({
      ok: false,
      error: 'srv.minuteMockup.aiUnavailable',
    })
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('LLM 예외·깨진 JSON·빈 화면은 실패 사유를 반환하고 캐시하지 않아 다음 호출이 재시도한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.generateAnswer
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('{ broken json')
      .mockResolvedValueOnce(VALID_SPEC_JSON)

    expect(await prepareMinuteDesignSpec(P, SOURCE)).toEqual({ ok: false, error: 'srv.minuteMockup.specFailed' })
    expect(await prepareMinuteDesignSpec(P, SOURCE)).toEqual({ ok: false, error: 'srv.minuteMockup.specFailed' })
    const okRes = await prepareMinuteDesignSpec(P, SOURCE)
    expect(okRes.ok).toBe(true)
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(3)
    spy.mockRestore()
  })

  it('최초 생성(feedback undefined)은 캐시하고, 명시적 다시 생성(feedback 빈 문자열 또는 지시문)은 캐시를 우회해 새 버전을 생성한다', async () => {
    mocks.generateAnswer.mockResolvedValue(VALID_MOCKUP_JSON)

    const r1 = await prepareMinuteMockup(P, SOURCE)
    const r2 = await prepareMinuteMockup(P, SOURCE)
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(1)

    // 빈 피드백으로 '다시 생성' 클릭 시(feedback === "") 캐시를 건너뛰고 새로 호출
    const r3 = await prepareMinuteMockup(P, SOURCE, '')
    expect(r3.ok).toBe(true)
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(2)

    // 피드백 지시문과 함께 '다시 생성' 클릭 시에도 새로 호출하며 프롬프트에 피드백 포함
    const r4 = await prepareMinuteMockup(P, SOURCE, '검색창을 상단에 추가해 주세요')
    expect(r4.ok).toBe(true)
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(3)
    const lastMessages = mocks.generateAnswer.mock.calls[2][1] as Array<{ content: string }>
    expect(lastMessages[0].content).toContain('검색창을 상단에 추가해 주세요')
  })

  it('6,000자 뒤의 요구사항도 설계서·목업 입력에 보존하고, 20,000자 초과는 호출 전에 거부한다', async () => {
    const text = '가'.repeat(6500) + '끝의 필수 보안 요구사항'
    mocks.verifyMinuteIssueBlock.mockResolvedValue({ ok: true, value: { ...VERIFIED_BODY.value, selectionExcerpt: text } })
    mocks.generateAnswer.mockResolvedValueOnce(VALID_SPEC_JSON).mockResolvedValueOnce(VALID_MOCKUP_JSON)
    expect((await prepareMinuteDesignSpec(P, SOURCE)).ok).toBe(true)
    expect((await prepareMinuteMockup(P, SOURCE)).ok).toBe(true)
    for (const call of mocks.generateAnswer.mock.calls) expect(call[1][0].content).toContain(text)
    mocks.verifyMinuteIssueBlock.mockResolvedValue({ ok: true, value: { ...VERIFIED_BODY.value, selectionExcerpt: '가'.repeat(20001) } })
    expect(await prepareMinuteDesignSpec(P, SOURCE)).toEqual({ ok: false, error: 'srv.issues.selectionTooLarge' })
    expect(await prepareMinuteMockup(P, SOURCE)).toEqual({ ok: false, error: 'srv.issues.selectionTooLarge' })
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(2)
  })

  it('현재 선택한 초안을 다음 보완 요청에 전달하고 비정상 초안은 거부한다', async () => {
    mocks.generateAnswer.mockResolvedValueOnce(VALID_SPEC_JSON).mockResolvedValueOnce(VALID_MOCKUP_JSON)
    const design = JSON.parse(VALID_SPEC_JSON)
    const mockup = JSON.parse(VALID_MOCKUP_JSON)
    await prepareMinuteDesignSpec(P, SOURCE, '버튼 이름 변경', design)
    await prepareMinuteMockup(P, SOURCE, '버튼 이름 변경', mockup)
    expect(mocks.generateAnswer.mock.calls[0][1][0].content).toContain('2FA 의무화 여부')
    expect(mocks.generateAnswer.mock.calls[1][1][0].content).toContain('환영합니다')
    expect(await prepareMinuteDesignSpec(P, SOURCE, '', {} as never)).toEqual({ ok: false, error: 'srv.minuteMockup.sourceInvalid' })
    expect(await prepareMinuteMockup(P, SOURCE, '', {} as never)).toEqual({ ok: false, error: 'srv.minuteMockup.sourceInvalid' })
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(2)
  })
})
