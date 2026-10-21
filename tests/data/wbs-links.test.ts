// 회의록 화면이 읽는 "문단 → WBS 작업" 연결(설계 2026-10-21-minutes-to-wbs §3.3·§5.6) — 세션 클라이언트(RLS)로 읽고,
// 실패는 결과로 돌려준다(빈 목록으로 위장하지 않는다 — 에러 처리 3원칙 ①). 뷰어는 사유를 보이고 등록 단추를 닫는다.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))

import { getMinuteLinkedWbsItems } from '@/lib/data/wbsLinks'
import { SERVER_KO } from '@/lib/i18n/serverDict'

type Result = { data: unknown; error: { message: string } | null }

const SELECT = 'id, wbs_item_id, project_id, minute_version_id, body_hash, block_index, block_hash, source_kind, wbs_items!wbs_item_links_item_project_fk(code, name)'
const ERR = SERVER_KO['srv.minuteWbs.linksUnavailable']

function client(result: Result) {
  const calls: Array<[string, unknown[]]> = []
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) q[m] = vi.fn((...args: unknown[]) => { calls.push([m, args]); return q })
  q.then = (resolve: (v: Result) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  mocks.from.mockReturnValue(q)
  mocks.createServerClient.mockResolvedValue({ from: mocks.from })
  return calls
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'l1', wbs_item_id: 'w1', project_id: 'p1', minute_version_id: 'v1', body_hash: 'bh1',
  block_index: 3, block_hash: 'h3', source_kind: 'manual', wbs_items: { code: 'A-1', name: '로그인 API 개발' },
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('getMinuteLinkedWbsItems — 회의록 문단에 연결된 WBS 작업', () => {
  it('세션 클라이언트로 wbs_item_links 를 그 회의록·minute_block 으로 걸러 등록순으로 읽는다', async () => {
    const calls = client({ data: [], error: null })
    await getMinuteLinkedWbsItems('m1')
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1)
    expect(mocks.from).toHaveBeenCalledWith('wbs_item_links')
    expect(calls).toEqual([
      ['select', [SELECT]],
      ['eq', ['minute_id', 'm1']],
      ['eq', ['link_type', 'minute_block']],
      ['order', ['created_at']],
    ])
  })

  it('행을 MinuteLinkedWbsItem 으로 편다 — 작업 코드·이름은 FK 임베드(객체·배열 꼴 모두)에서', async () => {
    client({
      data: [
        row(),
        row({ id: 'l2', wbs_item_id: 'w2', project_id: 'p2', minute_version_id: 'v2', body_hash: 'bh2', block_index: 0, block_hash: 'h0', source_kind: 'action', wbs_items: [{ code: 'B-7', name: '권한 화면 시안' }] }),
      ],
      error: null,
    })
    expect(await getMinuteLinkedWbsItems('m1')).toEqual({
      ok: true,
      rows: [
        { linkId: 'l1', itemId: 'w1', code: 'A-1', name: '로그인 API 개발', projectId: 'p1', minuteVersionId: 'v1', bodyHash: 'bh1', blockIndex: 3, blockHash: 'h3', sourceKind: 'manual' },
        { linkId: 'l2', itemId: 'w2', code: 'B-7', name: '권한 화면 시안', projectId: 'p2', minuteVersionId: 'v2', bodyHash: 'bh2', blockIndex: 0, blockHash: 'h0', sourceKind: 'action' },
      ],
    })
  })

  it('작업을 읽을 수 없는 연결(임베드 없음)은 뺀다 — 볼 수 없는 작업을 그리지 않는다(이슈 연결·등록 준비와 같은 규칙)', async () => {
    client({ data: [row({ wbs_items: null }), row({ id: 'l2', wbs_items: [] }), row({ id: 'l3' })], error: null })
    const res = await getMinuteLinkedWbsItems('m1')
    expect(res.ok && res.rows.map(r => r.linkId)).toEqual(['l3'])
  })

  it('조회 실패는 { ok:false, error } + 로그 — 빈 목록("연결 없음")으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    client({ data: null, error: { message: 'boom' } })
    const res = await getMinuteLinkedWbsItems('m1')
    expect(res).toEqual({ ok: false, error: ERR })
    expect(res).not.toHaveProperty('rows')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('getMinuteLinkedWbsItems'), 'boom')
    spy.mockRestore()
  })

  it('오류 없이 data 가 null 이어도 실패로 본다(모르면 "없음"이 아니다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    client({ data: null, error: null })
    expect(await getMinuteLinkedWbsItems('m1')).toEqual({ ok: false, error: ERR })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('사유 문구는 서버 사전의 한국어 — 키가 그대로 새지 않는다', () => {
    expect(ERR).toBeTruthy()
    expect(ERR).not.toBe('srv.minuteWbs.linksUnavailable')
  })

  it('service_role 로 읽지 않는다 — RLS(accessible_project_ids)가 볼 수 있는 연결만', () => {
    const source = readFileSync('src/lib/data/wbsLinks.ts', 'utf8')
    expect(source).toMatch(/from '@\/lib\/supabase\/server'/)
    expect(source).not.toMatch(/supabase\/admin|adminFor|createAdminClient/)
  })
})
