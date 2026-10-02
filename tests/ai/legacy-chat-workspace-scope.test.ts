// 옛 챗(answer.ts·knowledge.ts·retrieve.ts)의 프로젝트 없는 원천과 AI 판정은 요청 범위로(U2b-5 리뷰 수정 CC2·CC3).
// 관문(requireScopedSessionModule)은 셸의 워크스페이스로 chatbot 을 보지만, 그 뒤 답의 원천이 볼 수 있는 전 프로젝트였다:
//  - 전사 요약·문맥 개수에 다른 워크스페이스·chatbot 꺼진 프로젝트가 섞였다(모듈 끔 우회)
//  - 프로젝트 없는 의미검색(match_wbs_documents, SECURITY INVOKER — RLS 는 워크스페이스 소속만 본다)이 명단 밖 비공개 프로젝트의
//    작업 청크를 LLM 근거·폴백 답·sources 에 실었다(FA1 위반)
//  - AI 사용 판정은 세션 유일 워크스페이스(aiAvailable(null))라 다중 소속자는 늘 LLM 이 꺼지고, 한 곳 소속 플랫폼 관리자는
//    비소속 워크스페이스의 ai.enabled=false 를 자기 워크스페이스 설정으로 넘었다
// 파이프라인(answer·knowledge·retrieve·aiAvailable)은 진짜를 태우고 IO 경계(프로젝트 목록·WBS·임베딩·RPC·설정·LLM)만 흉내 낸다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const W_A = '00000000-0000-0000-7e57-00000000c201', W_B = '00000000-0000-0000-7e57-00000000c202'
const PA_ON = '00000000-0000-0000-7e57-00000000c211'    // A · chatbot 켜짐
const PA_OFF = '00000000-0000-0000-7e57-00000000c212'   // A · chatbot 꺼짐
const PB = '00000000-0000-0000-7e57-00000000c221'       // B · chatbot 켜짐
const P_PRIV = '00000000-0000-0000-7e57-00000000c213'   // A · 명단 밖 비공개(listProjects 가 이미 뺀다 — RLS 는 통과)

const m = vi.hoisted(() => ({
  hasLLM: vi.fn(), rpc: vi.fn(), generateAnswer: vi.fn(), generateAnswerStream: vi.fn(),
  getActor: vi.fn(), getWorkspaceConfig: vi.fn(), getProjectConfig: vi.fn(), effectiveModules: vi.fn(),
}))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: m.hasLLM, hasEmbeddings: () => true }))
vi.mock('@/lib/ai/embeddings', () => ({ embedTexts: vi.fn(async () => [[0.1, 0.2]]) }))
vi.mock('@/lib/ai/ensure-index', () => ({ ensureProjectIndexed: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: m.generateAnswer, generateAnswerStream: m.generateAnswerStream }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => {
    const b: Record<string, unknown> = {}
    b.select = () => b; b.eq = () => b; b.maybeSingle = async () => ({ data: { name: '비프로젝트' }, error: null })
    return { rpc: m.rpc, from: () => b }
  }),
}))
vi.mock('@/app/actions/project', () => ({
  // listProjects = RLS + 비공개 명단(canSeeProject) — 명단 밖 비공개 P_PRIV 는 이미 없다
  listProjectsWithState: vi.fn(async () => ({
    projects: [
      { id: PA_ON, name: '에이켜짐', workspace_id: W_A },
      { id: PA_OFF, name: '에이꺼짐', workspace_id: W_A },
      { id: PB, name: '비프로젝트', workspace_id: W_B },
    ],
    degraded: false,
  })),
}))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], calendar: (await import('../helpers/calendarFixture')).calUtcSun, today: '2026-10-02' })) }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: vi.fn(async () => ({ ok: true, rows: [] })) }))
// 팀은 요청 범위 원천(SP4 A2 — knowledge.ts 가 projectTeams 를 읽는다). 이 파일은 팀 축을 보지 않는다 — 빈 목록
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock([]))
// AI 판정은 진짜(전역 셋업의 mock 을 이 파일에서 되돌린다) — 설정 해석기만 흉내 낸다
vi.mock('@/lib/modules/aiAvailable', async () => vi.importActual('@/lib/modules/aiAvailable'))
vi.mock('@/lib/authz', () => ({ getActor: m.getActor }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: m.effectiveModules }))

import { answerQuestion, streamAnswer } from '@/lib/ai/answer'
import { buildBotContext } from '@/lib/ai/knowledge'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const chunk = (pid: string, text: string) => ({ id: `e-${pid}`, project_id: pid, kind: 'task', ref_id: `t-${pid}`, content: text, similarity: 0.95 })
const VECTOR = [
  chunk(PA_ON, '에이켜짐 작업 — 결제 모듈 이관'),
  chunk(PA_OFF, '에이꺼짐 작업 — 결제 모듈 이관'),
  chunk(PB, '비프로젝트 작업 — 결제 모듈 이관'),
  chunk(P_PRIV, '비공개 작업 — 결제 모듈 이관'),
]
const AI = { [W_A]: true, [W_B]: false } as Record<string, boolean>
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader(), dec = new TextDecoder()
  let out = ''
  for (;;) { const { done, value } = await reader.read(); if (done) return out; out += dec.decode(value, { stream: true }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.hasLLM.mockReturnValue(false)
  m.rpc.mockResolvedValue({ data: VECTOR, error: null })
  m.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([[W_A, 'member'], [W_B, 'member']]) }))
  m.getWorkspaceConfig.mockImplementation(async (wid: string) => ({ workspaceId: wid, keys: { 'ai.enabled': { status: 'set', value: AI[wid] ?? false } } }))
  m.getProjectConfig.mockImplementation(async (pid: string) => ({ projectId: pid, workspaceId: pid === PB ? W_B : W_A }))
  m.effectiveModules.mockResolvedValue(new Set(['chatbot']))
  vi.mocked(projectsWithModule).mockImplementation(async (ids: readonly string[]) => [...new Set(ids)].filter((id) => id !== PA_OFF))
})
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('CC2 — 프로젝트 없는 옛 챗의 원천은 그 워크스페이스·chatbot 켜진·볼 수 있는 프로젝트', () => {
  it('전사 요약(결정형 기본 답)에 다른 워크스페이스·chatbot 꺼진 프로젝트가 없다', async () => {
    const r = await answerQuestion({ projectId: null, workspaceId: W_A, message: '전체 프로젝트 현황 알려줘', history: [] })
    expect(r.answer).toContain('에이켜짐')
    expect(r.answer).not.toContain('에이꺼짐')
    expect(r.answer).not.toContain('비프로젝트')
  })

  it('의미검색 근거·폴백 답·sources 에 다른 워크스페이스·chatbot 꺼짐·명단 밖 비공개 프로젝트의 청크가 없다', async () => {
    const r = await answerQuestion({ projectId: null, workspaceId: W_A, message: '결제 모듈 이관은 어떻게 되고 있어?', history: [] })
    expect(r.answer).toContain('에이켜짐 작업')
    for (const s of ['에이꺼짐 작업', '비프로젝트 작업', '비공개 작업']) expect(r.answer).not.toContain(s)
    expect(r.sources.map((s) => s.refId)).toEqual([`t-${PA_ON}`])
  })

  it('LLM 근거 블록도 같은 원천이다(스트림) — 걸러진 청크만 [관련 작업(의미검색)] 에 싣는다', async () => {
    m.hasLLM.mockReturnValue(true)
    m.generateAnswerStream.mockResolvedValue((async function* () { yield '답' })())
    expect(await readAll(await streamAnswer({ projectId: null, workspaceId: W_A, message: '결제 모듈 이관은 어떻게 되고 있어?', history: [] }))).toBe('답')
    const system = m.generateAnswerStream.mock.calls[0][0] as string
    expect(system).toContain('에이켜짐 작업')
    for (const s of ['에이꺼짐', '비프로젝트', '비공개 작업']) expect(system).not.toContain(s)
  })

  it('B 화면에서 물으면 B 의 프로젝트만 — A 프로젝트 요약이 섞이지 않는다', async () => {
    const r = await answerQuestion({ projectId: null, workspaceId: W_B, message: '전체 프로젝트 현황 알려줘', history: [] })
    expect(r.answer).toContain('비프로젝트')
    expect(r.answer).not.toContain('에이켜짐')
  })

  it('패널 문맥의 프로젝트 개수도 같은 원천이다', async () => {
    expect((await buildBotContext(null, W_A)).totalProjects).toBe(1)
    expect((await buildBotContext(null, W_B)).totalProjects).toBe(1)
  })

  it('범위 밖 청크가 상위를 차지해도 근거가 0 이 되지 않게 넉넉히 받아 거른 뒤 k 개로 자른다', async () => {
    await answerQuestion({ projectId: null, workspaceId: W_A, message: '결제 모듈 이관은 어떻게 되고 있어?', history: [] })
    expect(m.rpc).toHaveBeenCalledWith('match_wbs_documents', expect.objectContaining({ p_project_id: null, match_count: 32 }))
  })

  it('프로젝트 목록을 못 읽었으면 던진다 — "등록된 프로젝트가 없습니다"로 위장하지 않는다(라우트의 500)', async () => {
    const { listProjectsWithState } = await import('@/app/actions/project')
    vi.mocked(listProjectsWithState).mockResolvedValueOnce({ projects: [], degraded: true } as never)
    await expect(answerQuestion({ projectId: null, workspaceId: W_A, message: '전체 프로젝트 현황 알려줘', history: [] })).rejects.toThrow()
  })

  it('프로젝트도 워크스페이스도 없으면 답을 만들지 않는다 — 전 프로젝트로 넓히지 않는다(fail-closed)', async () => {
    await expect(answerQuestion({ projectId: null, workspaceId: null, message: '전체 프로젝트 현황 알려줘', history: [] })).rejects.toThrow()
    expect(m.rpc).not.toHaveBeenCalled()
  })
})

describe('CC3 — AI 사용 판정은 요청 범위(그 워크스페이스, 프로젝트면 그 프로젝트)', () => {
  it('두 워크스페이스 소속자가 A(ai 켜짐)에서 프로젝트 없이 물으면 LLM 으로 답한다', async () => {
    m.hasLLM.mockReturnValue(true)
    m.generateAnswer.mockResolvedValue('LLM 답')
    const r = await answerQuestion({ projectId: null, workspaceId: W_A, message: '전체 프로젝트 현황 알려줘', history: [] })
    expect(r).toMatchObject({ usedLLM: true, answer: 'LLM 답' })
    expect(m.getWorkspaceConfig.mock.calls.map((c) => c[0])).toEqual([W_A])
  })

  it('A 에만 소속된 플랫폼 관리자가 비소속 B(ai 꺼짐)에서 물으면 LLM 에 보내지 않는다 — A 설정으로 판정하지 않는다', async () => {
    m.hasLLM.mockReturnValue(true)
    m.generateAnswer.mockResolvedValue('LLM 답')
    m.generateAnswerStream.mockResolvedValue((async function* () { yield 'LLM 답' })())
    m.getActor.mockResolvedValue(makeSuperuser({ workspaceRoles: new Map([[W_A, 'admin']]) }))
    const r = await answerQuestion({ projectId: null, workspaceId: W_B, message: '전체 프로젝트 현황 알려줘', history: [] })
    expect(r.usedLLM).toBe(false)
    expect(await readAll(await streamAnswer({ projectId: null, workspaceId: W_B, message: '전체 프로젝트 현황 알려줘', history: [] }))).not.toBe('LLM 답')
    expect(m.generateAnswer).not.toHaveBeenCalled()
    expect(m.generateAnswerStream).not.toHaveBeenCalled()
  })

  it('프로젝트 질문은 그 프로젝트로 판정한다(대조)', async () => {
    m.hasLLM.mockReturnValue(true)
    m.generateAnswer.mockResolvedValue('LLM 답')
    const r = await answerQuestion({ projectId: PB, workspaceId: null, message: '지연된 작업 알려줘', history: [] })
    expect(r.usedLLM).toBe(false)   // PB 는 B(ai 꺼짐)
    expect(m.getProjectConfig).toHaveBeenCalledWith(PB, expect.anything())
  })
})
