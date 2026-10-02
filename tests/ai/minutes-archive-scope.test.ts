// 보관함 Q&A 의 워크스페이스 거르기(과제 34, D26) — 두 워크스페이스 소속자가 W 의 회의록 화면에서 물으면 W 의 회의록만 근거·출처가 된다.
// 벡터 RPC(match_minute_documents)는 워크스페이스 인자가 없어 찾은 회의록을 한 번 더 읽어 거른다 — 그 확인이 실패하면 벡터 결과를 버린다(fail-closed).
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ createServerClient: vi.fn(), embedTexts: vi.fn(), heal: vi.fn(async () => undefined) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
vi.mock('@/lib/ai/provider', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/provider')>()), hasEmbeddings: () => true, hasLLM: () => false }))
vi.mock('@/lib/ai/embeddings', () => ({ embedTexts: m.embedTexts }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ healMissingMinuteEmbeddings: m.heal }))
import { streamArchiveAnswer } from '@/lib/ai/minutes-answer'

const W = 'ws-w'
type Call = { table: string; eq: [string, unknown][]; in: [string, unknown][] }
function client(opts: { ownIds: string[]; ownError?: boolean; keywordRows?: Record<string, unknown>[] }) {
  const calls: Call[] = []
  const from = vi.fn((table: string) => {
    const call: Call = { table, eq: [], in: [] }
    calls.push(call)
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'is', 'or', 'order', 'limit']) c[k] = () => c
    c.eq = (col: string, v: unknown) => { call.eq.push([col, v]); return c }
    c.in = (col: string, v: unknown) => { call.in.push([col, v]); return c }
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const isOwnCheck = call.in.some(([col]) => col === 'id')
      const r = isOwnCheck
        ? (opts.ownError ? { data: null, error: { message: 'down' } } : { data: opts.ownIds.map((id) => ({ id })), error: null })
        : { data: opts.keywordRows ?? [], error: null }
      return Promise.resolve(r).then(res, rej)
    }
    return c
  })
  const rpc = vi.fn(async () => ({
    data: [
      { minute_id: 'm-own', content: '우리 결정', minute_date: '2026-09-01', team_code: 'PMO', title: '우리 회의', similarity: 0.9 },
      { minute_id: 'm-other', content: '남의 결정', minute_date: '2026-09-02', team_code: 'ERP', title: '남의 회의', similarity: 0.9 },
    ],
    error: null,
  }))
  return { client: { from, rpc }, calls }
}
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader(), dec = new TextDecoder()
  let out = ''
  for (;;) { const { done, value } = await reader.read(); if (done) return out; out += dec.decode(value, { stream: true }) }
}

beforeEach(() => { vi.clearAllMocks(); m.embedTexts.mockResolvedValue([[0.1, 0.2]]) })

describe('streamArchiveAnswer — 그 워크스페이스의 회의록만', () => {
  it('벡터 결과를 그 워크스페이스 회의록으로 거르고, 키워드 조회에도 워크스페이스 조건을 단다', async () => {
    const fake = client({ ownIds: ['m-own'] })
    m.createServerClient.mockResolvedValue(fake.client)
    const out = await readAll(await streamArchiveAnswer({ workspaceId: W, message: 'ERP 단어가 들어간 회의록 찾아줘', history: [], filters: {} }))
    expect(out).toContain('우리 회의')
    expect(out).not.toContain('남의 회의')
    const own = fake.calls.find((c) => c.in.some(([col]) => col === 'id'))
    expect(own?.eq).toContainEqual(['workspace_id', W])
    expect(own?.in).toContainEqual(['id', ['m-own', 'm-other']])
    const keyword = fake.calls.find((c) => c !== own)
    expect(keyword?.eq).toContainEqual(['workspace_id', W])
  })
  it('확인 조회가 실패하면 벡터 결과를 버린다 — 남의 회의록을 근거로 쓰지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = client({ ownIds: [], ownError: true })
    m.createServerClient.mockResolvedValue(fake.client)
    const out = await readAll(await streamArchiveAnswer({ workspaceId: W, message: '결정 사항 알려줘', history: [], filters: {} }))
    expect(out).not.toContain('남의 회의')
    expect(out).not.toContain('우리 회의')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
