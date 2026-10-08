import { describe, expect, it, vi } from 'vitest'
import { createLexicalSearch, toFusionCandidate } from '@/lib/ai/index/lexical'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const WS = '99999999-9999-4999-8999-999999999999'

function client(response: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(async () => response) } as never
}

const row = {
  id: 'r1', project_id: PROJECT, domain: 'minutes', entity_type: 'minute',
  entity_id: 'm1', chunk_no: 3, title: '정례 회의', content: '계정 발급',
  href: '/m/m1', occurred_on: '2026-07-01', similarity: 0.8,
}

describe('createLexicalSearch', () => {
  it('RPC 결과를 FusionCandidate 로 옮긴다', async () => {
    const search = createLexicalSearch(client({ data: [row], error: null }))
    const result = await search({ workspaceId: WS, tokens: ['계정'], projectIds: [PROJECT], limit: 20 })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('실패하면 안 된다')
    expect(result.candidates[0]).toMatchObject({
      entityId: 'm1', chunkNo: 3, domain: 'minutes', title: '정례 회의',
    })
  })

  it('projectIds 가 비면 RPC 를 부르지 않는다 — 빈 스코프는 전체 허용이 아니다', async () => {
    const c = client({ data: [row], error: null })
    const search = createLexicalSearch(c)
    const result = await search({ workspaceId: WS, tokens: ['계정'], projectIds: [], limit: 20 })
    expect(result).toEqual({ ok: true, candidates: [] })
    expect((c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
  })

  it('토큰이 비면 RPC 를 부르지 않는다', async () => {
    const c = client({ data: [row], error: null })
    const result = await createLexicalSearch(c)({ workspaceId: WS, tokens: [], projectIds: [PROJECT], limit: 20 })
    expect(result).toEqual({ ok: true, candidates: [] })
    expect((c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
  })

  it('RPC 오류를 조용히 빈 결과로 위장하지 않는다', async () => {
    const search = createLexicalSearch(client({ data: null, error: { message: 'boom' } }))
    const result = await search({ workspaceId: WS, tokens: ['계정'], projectIds: [PROJECT], limit: 20 })
    expect(result).toMatchObject({ ok: false, errorCode: 'LEXICAL_SEARCH_FAILED' })
  })

  it('형태가 깨진 행은 버리되 나머지는 살린다', async () => {
    const search = createLexicalSearch(client({ data: [{ id: 'x' }, row], error: null }))
    const result = await search({ workspaceId: WS, tokens: ['계정'], projectIds: [PROJECT], limit: 20 })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('실패하면 안 된다')
    expect(result.candidates).toHaveLength(1)
  })

  it('RPC 는 늘 p_workspace_id 를 받고 p_include_global 은 기본 거짓이다', async () => {
    const c = client({ data: [], error: null })
    await createLexicalSearch(c)({ workspaceId: WS, tokens: ['계정'], projectIds: [PROJECT], limit: 20 })
    const rpc = (c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('match_ai_documents_lexical', {
      p_tokens: ['계정'], match_count: 20, p_workspace_id: WS, p_project_ids: [PROJECT],
      p_include_global: false, p_domains: null, p_entity_types: null, p_index_version: expect.any(Number),
    })
  })

  it('includeGlobal 이 참일 때만 p_include_global: true — 프로젝트가 비어도 그 워크스페이스의 전역 문서는 찾는다', async () => {
    const c = client({ data: [], error: null })
    const rpc = (c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc
    const search = createLexicalSearch(c)
    await search({ workspaceId: WS, tokens: ['계정'], projectIds: [PROJECT], includeGlobal: true, limit: 20 })
    await search({ workspaceId: WS, tokens: ['계정'], projectIds: [], includeGlobal: true, limit: 20 })
    await search({ workspaceId: WS, tokens: ['계정'], projectIds: [PROJECT], includeGlobal: false, limit: 20 })
    await search({ workspaceId: WS, tokens: ['계정'], projectIds: [PROJECT], includeGlobal: 'yes' as never, limit: 20 })
    expect(rpc.mock.calls.map(call => [call[1].p_workspace_id, call[1].p_project_ids, call[1].p_include_global])).toEqual([
      [WS, [PROJECT], true], [WS, [], true], [WS, [PROJECT], false], [WS, [PROJECT], false],
    ])
  })

  it('워크스페이스를 모르면 RPC 를 부르지 않고 실패를 돌려준다 — 빈 결과로 위장하지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const workspaceId of [undefined, null, '', 'ws-1']) {
      const c = client({ data: [row], error: null })
      const result = await createLexicalSearch(c)({ workspaceId: workspaceId as never, tokens: ['계정'], projectIds: [PROJECT], limit: 20 })
      expect(result, String(workspaceId)).toEqual({ ok: false, errorCode: 'SEARCH_SCOPE_UNAVAILABLE' })
      expect((c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
    }
    err.mockRestore()
  })
})
