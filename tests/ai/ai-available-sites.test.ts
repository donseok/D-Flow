// hasLLM() 호출부 → aiAvailable(과제 9, D17, 판정 P9) — 호출 지점마다 "무엇으로 판정하는지(범위·모듈)"와 "거짓이면 LLM·쓰기를 부르지
// 않는지"를 문다. 전역 mock(tests/setup/module-gate.ts)은 인자를 보지 않고 hasLLM 만 따르므로, 여기서 거짓을 주고 인자를 정확히 비교한다.
// 키(hasLLM)는 참으로 둔다 — 판정을 무시하는 회귀(늘 LLM)가 LLM mock 호출로 드러나게. 인자 비교는 toStrictEqual(둘째 인자 없음까지).
// 세션 없는 경로(인사이트·위키 워커)는 minutes-insights-ai-gate.test.ts·wiki-ingest.test.ts 가, 주간·이슈 초안은 각 액션 테스트가 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'

const m = vi.hoisted(() => ({
  generateAnswer: vi.fn(), generateAnswerStream: vi.fn(), createAdminClient: vi.fn(), createServerClient: vi.fn(),
  gatherKnowledge: vi.fn(), retrieveContext: vi.fn(), ensureProjectIndexed: vi.fn(), healMissingMinuteEmbeddings: vi.fn(),
}))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: m.generateAnswer, generateAnswerStream: m.generateAnswerStream }))
vi.mock('@/lib/ai/provider', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/provider')>()),
  hasLLM: () => true, hasEmbeddings: () => false, llmConfig: () => ({ model: 'test-model', apiKey: 'test-key' }),
}))
vi.mock('@/lib/ai/knowledge', () => ({ gatherKnowledge: m.gatherKnowledge }))
vi.mock('@/lib/ai/retrieve', () => ({ retrieveContext: m.retrieveContext }))
vi.mock('@/lib/ai/ensure-index', () => ({ ensureProjectIndexed: m.ensureProjectIndexed }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ healMissingMinuteEmbeddings: m.healMissingMinuteEmbeddings }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.createAdminClient }))
vi.mock('@/lib/supabase/env', () => ({ serviceRoleConfigured: () => true }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
import { aiAvailable } from '@/lib/modules/aiAvailable'          // 전역 mock(과제 8) — 여기서 거짓으로 바꾼다
import { answerQuestion, streamAnswer } from '@/lib/ai/answer'
import { buildBriefFacts, ensureWeeklyBrief, type BriefFactsInput } from '@/lib/ai/brief'
import { ensureIssueAnalysis } from '@/lib/ai/issue-analysis'
import { streamArchiveAnswer, streamDocAnswer } from '@/lib/ai/minutes-answer'
import { FIXTURE_MILESTONE_KEYWORDS } from '../fixtures/milestoneKeywords'

const PID = '00000000-0000-0000-7e57-000000001482', MID = '00000000-0000-0000-7e57-000000001481'
const AI_OFF = 'AI 를 사용할 수 없어 이슈 분석서를 생성할 수 없습니다. 관리자에게 AI 설정을 요청해 주세요.'
const calls = () => vi.mocked(aiAvailable).mock.calls

/** 어떤 체인이든 같은 결과로 끝나는 조회 흉내(select·eq·is·or·order·limit·in → maybeSingle 또는 await) */
function query(result: { data: unknown; error: null }) {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'or', 'order', 'limit', 'in']) c[k] = () => c
  c.maybeSingle = async () => result
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c
}
async function readAll(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) throw new Error('스트림이 없다')
  const reader = stream.getReader(), dec = new TextDecoder()
  let out = ''
  for (;;) { const { done, value } = await reader.read(); if (done) return out; out += dec.decode(value, { stream: true }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(aiAvailable).mockResolvedValue(false)
  m.gatherKnowledge.mockResolvedValue({ text: 'KNOWLEDGE', facts: 'KNOWLEDGE', scopeProjectId: PID })
  m.retrieveContext.mockResolvedValue([])
  m.healMissingMinuteEmbeddings.mockResolvedValue(undefined)
})
afterEach(() => { vi.mocked(aiAvailable).mockReset() })   // 전역 mock 의 hasLLM 따르기로 되돌린다

describe('옛 챗(answer.ts) — chatbot, 프로젝트 없으면 null(세션 유일 워크스페이스, P13)', () => {
  it.each([
    ['{ projectId }', PID, { projectId: PID }],
    ['null', null, null],
  ] as const)('answerQuestion: %s — 거짓이면 결정형, LLM 미호출', async (_n, projectId, scope) => {
    const r = await answerQuestion({ projectId, message: '지연된 작업 알려줘', history: [] })
    expect(r.usedLLM).toBe(false)
    expect(calls()).toStrictEqual([[scope, { module: 'chatbot' }]])
    expect(m.generateAnswer).not.toHaveBeenCalled()
  })
  it.each([
    ['{ projectId }', PID, { projectId: PID }],
    ['null', null, null],
  ] as const)('streamAnswer: %s — 거짓이면 결정형 한 덩이, LLM 스트림 미호출', async (_n, projectId, scope) => {
    expect(await readAll(await streamAnswer({ projectId, message: '지연된 작업 알려줘', history: [] }))).toContain('KNOWLEDGE')
    expect(calls()).toStrictEqual([[scope, { module: 'chatbot' }]])
    expect(m.generateAnswerStream).not.toHaveBeenCalled()
  })
})

describe('주간 브리핑(brief.ts) — 모듈 없음(대시보드 core 카드의 AI, P9)', () => {
  const input: BriefFactsInput = {
    projectName: '테스트 프로젝트', items: [], startDate: '2026-01-01', endDate: '2026-12-31',
    todayWbs: '2026-07-15', realToday: '2026-07-19', holidays: [], snapshots: [],
    minuteSignals: [], meetings: [], meetingExceptions: [],
    milestoneKeywords: [...FIXTURE_MILESTONE_KEYWORDS], teams: ['PMO', 'ERP'],
  }
  it("ensureWeeklyBrief: ({ projectId }) 하나만 — 거짓이면 'unavailable', LLM·admin 미호출", async () => {
    expect(await ensureWeeklyBrief(PID, buildBriefFacts(input))).toBe('unavailable')
    // 둘째 인자가 없어야 한다 — 모듈(weekly 등)을 붙이면 그 모듈을 끈 프로젝트의 core 카드 AI 가 조용히 꺼진다
    expect(calls()).toStrictEqual([[{ projectId: PID }]])
    expect(m.generateAnswer).not.toHaveBeenCalled()
    expect(m.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('이슈 분석(issue-analysis.ts) — issues', () => {
  const MAJOR = { id: 'aaaa0000-0000-4000-8000-000000000002', megaCode: '02' as const, majorSeq: 1, name: '02 대표 프로세스' }
  const issue: IssueAnalysisIssueInput = {
    id: '550e8400-e29b-41d4-a716-446655440201', issueNo: 1, piIssueCode: 'PI-I-02-01', projectId: PID,
    megaCode: '02', megaSeq: 1, majorId: MAJOR.id, title: '02 영역 이슈', body: '업무 처리 기준이 표준화되어 있지 않다.',
    status: 'open', severity: 'medium', assigneeMemberIds: [], startDate: null, dueDate: null, subProcess: '업무 처리',
    ownerDepartment: 'PI팀', relatedSystems: ['ERP'], sourceType: 'interview', sourceDetail: '현업 인터뷰', minuteSources: [],
    resolutionNote: '', resolvedAt: null, createdBy: 'user-1', createdByName: '테스터',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-30T00:00:00Z',
  }
  it("ensureIssueAnalysis: ({ projectId }, { module: 'issues' }) — 거짓이면 llm_missing(넓힌 문구), LLM·저장 미호출", async () => {
    const upsert = vi.fn()
    m.createAdminClient.mockReturnValue({ from: () => ({ ...query({ data: null, error: null }), upsert }) })   // 캐시 조회는 판정 앞(저장된 결과)
    expect(await ensureIssueAnalysis(PID, [issue], [MAJOR], 'user-1')).toEqual({
      state: 'unavailable', reason: 'llm_missing', error: AI_OFF, inputHash: expect.any(String),
    })
    expect(calls()).toStrictEqual([[{ projectId: PID }, { module: 'issues' }]])
    expect(m.generateAnswer).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('회의록 Q&A(minutes-answer.ts) — minutes', () => {
  it('streamDocAnswer: ({ minuteId }, { module: minutes }) — client 없음(세션 경로), 거짓이면 결정형, LLM 스트림·admin 미호출', async () => {
    const row = { id: MID, minute_date: '2026-07-25', team_code: 'PMO', title: '주간 회의', body_md: '# 주간 회의\n\n결정: A 로 간다' }
    m.createServerClient.mockResolvedValue({ from: vi.fn(() => query({ data: row, error: null })) })
    expect(await readAll(await streamDocAnswer({ minuteId: MID, message: '요약해 줘', history: [] }))).toContain('AI 응답을 사용할 수 없어요')
    // null 로 판정하면 다중 소속 사용자의 문서 Q&A 가 조용히 결정형이 된다 — 행의 워크스페이스로 판정해야 한다
    expect(calls()).toStrictEqual([[{ minuteId: MID }, { module: 'minutes' }]])
    expect(m.generateAnswerStream).not.toHaveBeenCalled()
    expect(m.createAdminClient).not.toHaveBeenCalled()
  })
  it('streamArchiveAnswer: (null, { module: minutes }) — 보관함은 세션 유일 워크스페이스(P13), 거짓이면 결정형, LLM 스트림·admin 미호출', async () => {
    m.createServerClient.mockResolvedValue({ from: vi.fn(() => query({ data: [], error: null })), rpc: vi.fn() })
    expect(await readAll(await streamArchiveAnswer({ message: '요약해 줘', history: [], filters: {} }))).toContain('관련 회의록을 찾지 못했어요')
    expect(calls()).toStrictEqual([[null, { module: 'minutes' }]])
    expect(m.generateAnswerStream).not.toHaveBeenCalled()
    expect(m.createAdminClient).not.toHaveBeenCalled()
  })
})
