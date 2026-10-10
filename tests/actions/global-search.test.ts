import { describe, expect, it, vi, beforeEach } from 'vitest'
import { makeActor, makeMemberActor, makeSuperuser, WS } from '../fixtures/actor'
import type { Actor } from '@/lib/domain/authz'
import { ERR_ANON, ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'

type Row = Record<string, unknown>
type Reply = { data: Row[] | Row | null; error: { message: string } | null; count?: number }
interface Call { table: string; ops: Array<[string, ...unknown[]]> }

const h = vi.hoisted(() => ({
  actor: null as unknown,
  actorThrows: false,
  replies: {} as Record<string, unknown>,
  calls: [] as unknown[],
}))

/** 호출 사슬을 기록하고 표별 응답을 돌려주는 세션 클라이언트 흉내 — 범위 조건(eq)이 실제로 걸렸는지 본다 */
function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { table, ops: [] }
      ;(h.calls as Call[]).push(call)
      const reply = () => {
        const r = (h.replies as Record<string, Reply | ((c: Call) => Reply)>)[table]
        if (!r) throw new Error(`응답 없는 표: ${table}`)
        return typeof r === 'function' ? r(call) : r
      }
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'ilike', 'or', 'order', 'limit', 'in', 'gt']) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, ...args]); return chain }
      }
      chain.maybeSingle = async () => { call.ops.push(['maybeSingle']); const r = reply(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error } }
      chain.then = (res: (v: Reply) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(reply).then(res, rej)
      return chain
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => fakeClient()) }))
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(async () => { if (h.actorThrows) throw new Error('권한 축 조회 실패'); return h.actor }),
}))

import { searchTitles } from '@/app/actions/globalSearch'

const calls = () => h.calls as Call[]
const tables = () => calls().map((c) => c.table)
const opsOf = (table: string, op: string) => calls().filter((c) => c.table === table).flatMap((c) => c.ops.filter((o) => o[0] === op))
const setActor = (a: Actor | null) => { h.actor = a }
const reply = (table: string, r: Reply | ((c: Call) => Reply)) => { (h.replies as Record<string, unknown>)[table] = r }

/** wbs_items 는 두 번 읽힌다 — 찾기(or)와 번호를 매길 구조 읽기(id, parent_id, sort_order …). select 의 열로 가른다 */
const isStructureRead = (c: Call) => c.ops.some((o) => o[0] === 'select' && String(o[1]).includes('parent_id'))
const wbsReplies = (hits: Row[], structure: Row[]) => reply('wbs_items', (c) => (isStructureRead(c)
  ? { data: structure, error: null, count: structure.length } : { data: hits, error: null }))

describe('searchTitles server action (개정 §5.3.7, UX-04, SPU2)', () => {
  beforeEach(() => {
    h.calls = []; h.replies = {}; h.actorThrows = false
    setActor(makeActor({ projectWorkspace: new Map([['p-1', WS], ['p-2', WS], ['p-other', 'ws-2']]) }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('빈 쿼리이거나 공백만 있는 경우 빈 결과를 즉시 반환한다', async () => {
    const res = await searchTitles({ workspaceId: WS, query: '   ', scope: 'workspace' })
    expect(res).toEqual({ ok: true, projects: [], wbsItems: [] })
    expect(tables()).toEqual([])
  })

  it('특수문자만 있는 경우 빈 결과를 반환한다', async () => {
    const res = await searchTitles({ workspaceId: WS, query: '%,_()', scope: 'workspace' })
    expect(res).toEqual({ ok: true, projects: [], wbsItems: [] })
    expect(tables()).toEqual([])
  })

  it('세션이 없으면 거부하고 DB 에 닿지 않는다', async () => {
    setActor(null)
    const res = await searchTitles({ workspaceId: WS, query: 'Alpha', scope: 'workspace' })
    expect(res).toEqual({ ok: false, reason: 'denied', error: ERR_ANON })
    expect(tables()).toEqual([])
  })

  it('권한 조회가 실패하면 실패 유니온이다 — 빈 결과가 아니다', async () => {
    h.actorThrows = true
    const res = await searchTitles({ workspaceId: WS, query: 'Alpha', scope: 'workspace' })
    expect(res).toEqual({ ok: false, reason: 'failed', error: ERR_LOOKUP })
    expect(tables()).toEqual([])
  })

  describe('워크스페이스 범위 — 그 워크스페이스의 프로젝트 이름만', () => {
    it('프로젝트를 워크스페이스 조건으로 찾고, WBS 는 뒤지지 않는다(범위 없는 WBS 검색 없음)', async () => {
      reply('projects', { data: [{ id: 'p-1', name: 'Alpha Project', is_private: false }], error: null })
      const res = await searchTitles({ workspaceId: WS, query: 'Alpha', scope: 'workspace' })
      expect(res).toEqual({
        ok: true,
        projects: [{ type: 'project', id: 'p-1', name: 'Alpha Project', href: '/p/p-1/dashboard' }],
        wbsItems: [],
      })
      expect(tables()).toEqual(['projects'])
      expect(opsOf('projects', 'eq')).toEqual([['eq', 'workspace_id', WS]])
      expect(opsOf('projects', 'ilike')).toEqual([['ilike', 'name', '%Alpha%']])
    })

    it('클라이언트가 보낸 워크스페이스가 소속이 아니면 거부한다(존재 은닉) — 조회하지 않는다', async () => {
      const res = await searchTitles({ workspaceId: 'ws-2', query: 'Alpha', scope: 'workspace' })
      expect(res).toEqual({ ok: false, reason: 'denied', error: ERR_MISSING })
      expect(tables()).toEqual([])
    })

    it('워크스페이스가 없으면 거부한다 — 소속에서 짐작하지 않는다', async () => {
      for (const workspaceId of [undefined, null, '']) {
        const res = await searchTitles({ workspaceId, query: 'Alpha', scope: 'workspace' })
        expect(res).toEqual({ ok: false, reason: 'denied', error: ERR_WORKSPACE_REQUIRED })
      }
      expect(tables()).toEqual([])
    })

    it('모양이 틀린 워크스페이스 값은 거부한다', async () => {
      for (const workspaceId of ['ws-1,ws-2', 'a b', 'x'.repeat(65), 42 as unknown as string]) {
        const res = await searchTitles({ workspaceId, query: 'Alpha', scope: 'workspace' })
        expect(res).toEqual({ ok: false, reason: 'denied', error: ERR_MISSING })
      }
      expect(tables()).toEqual([])
    })

    it('명단 밖 비공개 프로젝트는 결과에 없다 — 명단에 있으면 보인다', async () => {
      reply('projects', { data: [
        { id: 'p-1', name: 'Alpha 공개', is_private: false },
        { id: 'p-2', name: 'Alpha 비공개', is_private: true },
      ], error: null })
      const outsider = await searchTitles({ workspaceId: WS, query: 'Alpha', scope: 'workspace' })
      expect(outsider.ok && outsider.projects.map((p) => p.id)).toEqual(['p-1'])

      setActor(makeMemberActor('p-2', [], { projectWorkspace: new Map([['p-1', WS], ['p-2', WS]]) }))
      const roster = await searchTitles({ workspaceId: WS, query: 'Alpha', scope: 'workspace' })
      expect(roster.ok && roster.projects.map((p) => p.id)).toEqual(['p-1', 'p-2'])
    })

    it('플랫폼 관리자는 비소속 워크스페이스도 검색하되 조건은 그 워크스페이스다', async () => {
      setActor(makeSuperuser())
      reply('projects', { data: [], error: null })
      const res = await searchTitles({ workspaceId: 'ws-9', query: 'Alpha', scope: 'workspace' })
      expect(res).toEqual({ ok: true, projects: [], wbsItems: [] })
      expect(opsOf('projects', 'eq')).toEqual([['eq', 'workspace_id', 'ws-9']])
    })

    it('조회 오류는 실패 유니온이다 — 빈 결과가 아니다', async () => {
      reply('projects', { data: null, error: { message: 'boom' } })
      const res = await searchTitles({ workspaceId: WS, query: 'Alpha', scope: 'workspace' })
      expect(res.ok).toBe(false)
      expect(res).toMatchObject({ ok: false, reason: 'failed' })
      expect(res).not.toHaveProperty('projects')
      expect(console.error).toHaveBeenCalled()
    })

    it('0건은 ok:true 의 빈 배열이다(실패와 다르다)', async () => {
      reply('projects', { data: [], error: null })
      expect(await searchTitles({ workspaceId: WS, query: 'Zzz', scope: 'workspace' })).toEqual({ ok: true, projects: [], wbsItems: [] })
    })
  })

  describe('프로젝트 범위 — 그 프로젝트의 WBS 이름·코드만', () => {
    it('프로젝트 검색을 건너뛰고 해당 프로젝트의 WBS만 검색한다', async () => {
      reply('projects', { data: { id: 'p-2', is_private: false }, error: null })
      wbsReplies([{ id: 'w-2', code: '2.0', name: 'Beta Task', project_id: 'p-2' }], [{ id: 'w-2', parent_id: null, sort_order: 1, is_owner_split: false }])
      const res = await searchTitles({ workspaceId: WS, projectId: 'p-2', query: 'Beta', scope: 'project' })
      expect(res).toEqual({
        ok: true,
        projects: [],
        // 번호는 저장 code('2.0')가 아니라 트리 위치다 — 루트 하나뿐이라 1 (BUG-05)
        wbsItems: [{ type: 'wbs', id: 'w-2', number: '1', title: 'Beta Task', projectId: 'p-2', href: '/p/p-2/wbs?focus=w-2' }],
      })
      expect(opsOf('wbs_items', 'eq')).toEqual([['eq', 'project_id', 'p-2'], ['eq', 'project_id', 'p-2']])   // 찾기 + 구조 읽기 둘 다 그 프로젝트로 좁힌다
      expect(opsOf('wbs_items', 'or')).toEqual([['or', 'name.ilike.%Beta%,code.ilike.%Beta%']])
    })

    it('[BUG-05] 번호는 표와 같은 계산이다 — 화면에서 추가한 항목(code = 이름의 첫 낱말)도 1.1·1.1.1 로 나오고 표 순서로 놓인다', async () => {
      reply('projects', { data: { id: 'p-2', is_private: false }, error: null })
      wbsReplies(
        [
          { id: 'c', code: '현행', name: '현행 업무 인터뷰', project_id: 'p-2' },
          { id: 'b', code: '요구사항', name: '요구사항 분석', project_id: 'p-2' },
        ],
        [
          { id: 'a', parent_id: null, sort_order: 1, is_owner_split: false },
          { id: 'b', parent_id: 'a', sort_order: 1, is_owner_split: false },
          { id: 'c', parent_id: 'b', sort_order: 1, is_owner_split: false },
          { id: 'd', parent_id: 'a', sort_order: 2, is_owner_split: false },
        ],
      )
      const res = await searchTitles({ workspaceId: WS, projectId: 'p-2', query: '요', scope: 'project' })
      expect(res.ok && res.wbsItems.map((w) => [w.number, w.title])).toEqual([['1.1', '요구사항 분석'], ['1.1.1', '현행 업무 인터뷰']])
      expect(tables()).toEqual(['projects', 'wbs_items', 'wbs_items'])   // 담당 분리 행이 없으면 담당·팀을 읽지 않는다
    })

    it('[BUG-05] 번호를 내지 못하면(구조 읽기 실패) 검색은 성공이고 번호만 비운다 — 저장 code 로 대신하지 않는다', async () => {
      reply('projects', { data: { id: 'p-2', is_private: false }, error: null })
      reply('wbs_items', (c) => (isStructureRead(c)
        ? { data: null, error: { message: 'boom' } }
        : { data: [{ id: 'w-2', code: '요구사항', name: '요구사항 분석', project_id: 'p-2' }], error: null }))
      const res = await searchTitles({ workspaceId: WS, projectId: 'p-2', query: '요구', scope: 'project' })
      expect(res.ok && res.wbsItems).toEqual([{ type: 'wbs', id: 'w-2', number: '', title: '요구사항 분석', projectId: 'p-2', href: '/p/p-2/wbs?focus=w-2' }])
      expect(console.error).toHaveBeenCalled()
    })

    it('다른 워크스페이스의 프로젝트는 거부한다 — 요청 워크스페이스와 프로젝트의 워크스페이스가 달라도 같다', async () => {
      const foreign = await searchTitles({ workspaceId: WS, projectId: 'p-other', query: 'Beta', scope: 'project' })
      expect(foreign).toEqual({ ok: false, reason: 'denied', error: ERR_MISSING })
      const mismatch = await searchTitles({ workspaceId: 'ws-2', projectId: 'p-1', query: 'Beta', scope: 'project' })
      expect(mismatch).toEqual({ ok: false, reason: 'denied', error: ERR_MISSING })
      expect(tables()).toEqual([])
    })

    it('액터가 모르는 프로젝트·프로젝트 없는 요청은 거부한다', async () => {
      for (const projectId of ['p-unknown', null, undefined, '']) {
        const res = await searchTitles({ workspaceId: WS, projectId, query: 'Beta', scope: 'project' })
        expect(res).toEqual({ ok: false, reason: 'denied', error: ERR_MISSING })
      }
      expect(tables()).toEqual([])
    })

    it('명단 밖 비공개 프로젝트의 WBS 는 찾지 않는다', async () => {
      reply('projects', { data: { id: 'p-2', is_private: true }, error: null })
      const res = await searchTitles({ workspaceId: WS, projectId: 'p-2', query: 'Beta', scope: 'project' })
      expect(res).toEqual({ ok: false, reason: 'denied', error: ERR_MISSING })
      expect(tables()).toEqual(['projects'])
    })

    it('RLS 가 프로젝트 행을 가리면(0행) 거부한다', async () => {
      reply('projects', { data: null, error: null })
      const res = await searchTitles({ workspaceId: WS, projectId: 'p-2', query: 'Beta', scope: 'project' })
      expect(res).toEqual({ ok: false, reason: 'denied', error: ERR_MISSING })
      expect(tables()).toEqual(['projects'])
    })

    it('선행 조회(비공개 판정)가 실패하면 중단한다 — WBS 를 읽지 않는다', async () => {
      reply('projects', { data: null, error: { message: 'boom' } })
      const res = await searchTitles({ workspaceId: WS, projectId: 'p-2', query: 'Beta', scope: 'project' })
      expect(res).toMatchObject({ ok: false, reason: 'failed' })
      expect(tables()).toEqual(['projects'])
    })

    it('WBS 조회 오류는 실패 유니온이다 — 빈 결과가 아니다', async () => {
      reply('projects', { data: { id: 'p-2', is_private: false }, error: null })
      reply('wbs_items', { data: null, error: { message: 'boom' } })
      const res = await searchTitles({ workspaceId: WS, projectId: 'p-2', query: 'Beta', scope: 'project' })
      expect(res).toMatchObject({ ok: false, reason: 'failed' })
      expect(res).not.toHaveProperty('wbsItems')
    })

    it('응답에 다른 프로젝트 행이 섞여 와도 결과에 싣지 않는다', async () => {
      reply('projects', { data: { id: 'p-2', is_private: false }, error: null })
      reply('wbs_items', { data: [
        { id: 'w-2', code: '2.0', name: 'Beta Task', project_id: 'p-2' },
        { id: 'w-x', code: '9.9', name: 'Beta Leak', project_id: 'p-other' },
      ], error: null })
      const res = await searchTitles({ workspaceId: WS, projectId: 'p-2', query: 'Beta', scope: 'project' })
      expect(res.ok && res.wbsItems.map((w) => w.id)).toEqual(['w-2'])
    })
  })

  it('모르는 범위 값은 거부한다', async () => {
    const res = await searchTitles({ workspaceId: WS, query: 'Alpha', scope: 'all' as unknown as 'workspace' })
    expect(res).toEqual({ ok: false, reason: 'denied', error: ERR_MISSING })
    expect(tables()).toEqual([])
  })
})
