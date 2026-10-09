// 회의록 Q&A 프롬프트의 제품 이름 — 그 회의록·보관함의 워크스페이스가 정한 값(branding.product_name)이다(재점검 2026-10-09).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ generateAnswerStream: vi.fn(), getWorkspaceConfig: vi.fn(), hasLLM: vi.fn(() => true) }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswerStream: m.generateAnswerStream }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: m.hasLLM, hasEmbeddings: () => false }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ healMissingMinuteEmbeddings: vi.fn(async () => undefined) }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: vi.fn(async () => new Set()) }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'is', 'or', 'order', 'limit', 'in']) b[k] = () => b
    b.maybeSingle = async () => ({ data: { id: 'm-1', minute_date: '2026-10-01', team_code: 'PMO', title: '주간', body_md: '본문' }, error: null })
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
    return { from: () => b, rpc: vi.fn(async () => ({ data: [], error: null })) }
  }),
}))

import { streamArchiveAnswer, streamDocAnswer } from '@/lib/ai/minutes-answer'

const A = 'ws-a', B = 'ws-b'
const NAMES: Record<string, string> = { [A]: 'Acme Flow', [B]: 'Beta PM' }
const system = () => String(m.generateAnswerStream.mock.calls.at(-1)?.[0] ?? '')
async function drain(s: ReadableStream<Uint8Array> | null) { const r = s!.getReader(); for (;;) { if ((await r.read()).done) return } }

beforeEach(() => {
  vi.clearAllMocks()
  m.hasLLM.mockReturnValue(true)
  m.generateAnswerStream.mockImplementation(async () => (async function* () { yield '답' })())
  m.getWorkspaceConfig.mockImplementation(async (wid: string) => ({ workspaceId: wid, keys: {
    'branding.product_name': { status: 'set', value: NAMES[wid] }, 'branding.mail_from_name': { status: 'default', value: null },
  } }))
})

describe('회의록 Q&A 프롬프트의 제품 이름', () => {
  it('문서 모드 — 라우트가 넘긴 워크스페이스의 이름이 실린다', async () => {
    await drain(await streamDocAnswer({ minuteId: 'm-1', message: '요약해줘', history: [], workspaceId: A }))
    expect(system()).toContain('너는 Acme Flow 의 회의록 어시스턴트야')
  })
  it('보관함 모드 — 그 워크스페이스의 이름이 실린다', async () => {
    await drain(await streamArchiveAnswer({ workspaceId: A, message: '결정 사항 알려줘', history: [], filters: {} }))
    expect(system()).toContain('너는 Acme Flow 의 회의록 보관함 어시스턴트야')
  })
  it('격리 — B 의 질문에는 B 의 이름만(읽는 설정도 B 하나)', async () => {
    await drain(await streamArchiveAnswer({ workspaceId: B, message: '결정 사항 알려줘', history: [], filters: {} }))
    await drain(await streamDocAnswer({ minuteId: 'm-1', message: '요약해줘', history: [], workspaceId: B }))
    for (const call of m.generateAnswerStream.mock.calls) { expect(String(call[0])).toContain('Beta PM'); expect(String(call[0])).not.toContain('Acme Flow') }
    expect(m.getWorkspaceConfig.mock.calls.every((c) => c[0] === B)).toBe(true)
  })
  it('워크스페이스를 받지 못한 문서 질문은 배포 기본 이름 — 설정을 읽지 않는다', async () => {
    await drain(await streamDocAnswer({ minuteId: 'm-1', message: '요약해줘', history: [] }))
    expect(system()).toContain('너는 D-Flow 의 회의록 어시스턴트야')
    expect(m.getWorkspaceConfig).not.toHaveBeenCalled()
  })
  it('AI 를 쓰지 않으면 이름을 읽으러 가지 않는다', async () => {
    m.hasLLM.mockReturnValue(false)
    await drain(await streamArchiveAnswer({ workspaceId: A, message: '결정 사항 알려줘', history: [], filters: {} }))
    expect(m.generateAnswerStream).not.toHaveBeenCalled()
    expect(m.getWorkspaceConfig).not.toHaveBeenCalled()
  })
})
