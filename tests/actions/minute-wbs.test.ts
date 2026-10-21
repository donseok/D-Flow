// 회의록 → WBS 등록 액션(src/app/actions/minuteWbs.ts) — 가드 → 모듈 관문 → 입력 검증 → 원문 검증 → 읽기(세션)·AI → RPC(service_role) 순서와
// 실패를 "없음"으로 그리지 않는 규칙, RPC 토큰 → 문구·줄 번호, 등록 뒤 처리(색인·담당자 도우미 셋)를 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fnv1a64, minuteBlockDraftText, splitMinuteBlocks, type MinuteBlock } from '@/lib/minutes/blocks'

const m = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
  createServerClient: vi.fn(),
  createAdminClient: vi.fn(),
  generateAnswer: vi.fn(),
  hasLLM: vi.fn(() => true),
  getComputedWbs: vi.fn(),
  getProjectConfig: vi.fn(),
  levelDepthOf: vi.fn(),
  getProjectRoster: vi.fn(),
  verify: vi.fn(),
  applyWorkflowEvent: vi.fn(),
  emitNotification: vi.fn(),
  ensureOrderForWorkflowLeaf: vi.fn(),
  enqueueIndexChange: vi.fn(async () => {}),
  recordProgressSnapshot: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
  after: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({ requireProjectAdmin: m.requireProjectAdmin, requireProjectMember: m.requireProjectMember, resolveProjectId: m.resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.createAdminClient }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: m.generateAnswer }))
// aiAvailable 은 tests/setup/module-gate.ts 의 전역 mock 이 hasLLM() 을 돌려준다
vi.mock('@/lib/ai/provider', () => ({ hasLLM: m.hasLLM }))
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: m.after }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: m.getComputedWbs }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig, levelDepthOf: m.levelDepthOf }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: m.getProjectRoster }))
vi.mock('@/lib/minutes/verifySource', async (orig) => ({
  ...(await orig<typeof import('@/lib/minutes/verifySource')>()), verifyMinuteIssueBlock: m.verify,
}))
vi.mock('@/lib/agent/workflowEvent', () => ({ applyWorkflowEvent: m.applyWorkflowEvent }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: m.emitNotification }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: m.ensureOrderForWorkflowLeaf }))
vi.mock('@/lib/ai/index/enqueueChange', () => ({ enqueueIndexChange: m.enqueueIndexChange }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: m.recordProgressSnapshot }))

import { createWbsItemsFromMinute, getWbsItemMinuteSources, prepareMinuteWbsDrafts } from '@/app/actions/minuteWbs'
import { requireModule } from '@/lib/modules/gate'
import { ERR_DENIED, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { serverKoTranslate as t } from '@/lib/i18n/serverDict'
import { minuteIssueSourceExcerpt } from '@/lib/minutes/verifySource'
import { makeMinuteIssueSourceKey, type MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import {
  fallbackWbsName, recommendableParents, scoreParentCandidates, type MinuteWbsCreateRow, type MinuteWbsParentOption,
} from '@/lib/domain/minuteWbs'
import { MINUTE_WBS_DRAFT_SYSTEM_PROMPT } from '@/lib/ai/minute-wbs-draft'
import { makeAdminActor, makeMemberActor } from '../fixtures/actor'

const PROJECT = 'project-1'
const USER = 'user-1'
const ADMIN = makeAdminActor(PROJECT, { userId: USER })
const MEMBER = makeMemberActor(PROJECT, [], { userId: USER })

const BODY = ['# 개발 회의', '', '로그인 API 개발은 김철수가 10월 31일까지 맡는다.', '', '- 권한 화면 시안 검토', '- 성능 테스트 계획 수립'].join('\n')
const BODY_HASH = fnv1a64(BODY)
const BLOCKS = splitMinuteBlocks(BODY)
const LABELS: Record<number, string> = { 1: '로그인 API 개발', 2: '권한 화면 시안 검토' }
const source = (index: number, kind: MinuteIssueSourceInput['kind'] = 'action', over: Partial<MinuteIssueSourceInput> = {}): MinuteIssueSourceInput => ({
  minuteId: 'minute-1', minuteVersionId: 'version-1', bodyHash: BODY_HASH, blockIndex: BLOCKS[index].index, blockHash: BLOCKS[index].hash, kind, ...over,
})
const S1 = source(1)
const S2 = source(2)

// 트리 — 개발(인증·회원관리 각 말단 하나), 테스트(성능 테스트 — 말단·실적 40·선행 하나), 운영(진행 중 주문), 배포 자동화(업무 흐름 켬)
const ID = {
  dev: '10000000-0000-4000-8000-000000000001', auth: '10000000-0000-4000-8000-000000000002', authLeaf: '10000000-0000-4000-8000-000000000003',
  member: '10000000-0000-4000-8000-000000000004', memberLeaf: '10000000-0000-4000-8000-000000000005', test: '10000000-0000-4000-8000-000000000006',
  perf: '10000000-0000-4000-8000-000000000007', ops: '10000000-0000-4000-8000-000000000008', flow: '10000000-0000-4000-8000-000000000009',
}
const ASSIGNEE = '44444444-4444-4444-8444-444444444444'
type Item = { id: string; parentId: string | null; name: string; depth: number; isOwnerSplit: boolean; actualPct: number | null; devWorkflow?: boolean; children: Item[] }
const node = (id: string, parentId: string | null, name: string, depth: number, children: Item[] = [], over: Partial<Item> = {}): Item =>
  ({ id, parentId, name, depth, isOwnerSplit: false, actualPct: null, children, ...over })
const TREE: Item[] = [
  node(ID.dev, null, '개발', 0, [
    node(ID.auth, ID.dev, '인증', 1, [node(ID.authLeaf, ID.auth, '로그인 화면 설계', 2)]),
    node(ID.member, ID.dev, '회원관리', 1, [node(ID.memberLeaf, ID.member, '회원 목록 화면', 2)]),
  ]),
  node(ID.test, null, '테스트', 0, [node(ID.perf, ID.test, '성능 테스트', 1, [], { actualPct: 40 })]),
  node(ID.ops, null, '운영', 0),
  node(ID.flow, null, '배포 자동화', 0, [], { devWorkflow: true }),
]
const DEPENDENCIES = [{ id: 'd1', projectId: PROJECT, predecessorId: ID.perf, successorId: ID.authLeaf, type: 'FS', lagDays: 0, origin: 'manual' }]

type Resp = { data?: unknown; error?: { message: string; code?: string } | null; count?: number }
type Call = [string, unknown[]]
/** 세션 클라이언트 — 표마다 응답 하나, 체인 호출을 기록한다(어느 표를 어떤 조건으로 읽었는가) */
function sessionClient(tables: Record<string, Resp>) {
  const queries: Array<{ table: string; calls: Call[] }> = []
  const from = vi.fn((table: string) => {
    const calls: Call[] = []
    queries.push({ table, calls })
    const resp = (): Resp => {
      if (!(table in tables)) throw new Error(`unexpected table: ${table}`)
      return tables[table]
    }
    const chain: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'gt', 'order', 'limit']) chain[k] = (...args: unknown[]) => { calls.push([k, args]); return chain }
    chain.maybeSingle = async () => { const r = resp(); return { data: r.error ? null : r.data ?? null, error: r.error ?? null } }
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(() => {
      const r = resp()
      const data = r.error ? null : r.data ?? []
      return { data, error: r.error ?? null, count: r.count ?? (Array.isArray(data) ? data.length : null) }
    }).then(res, rej)
    return chain
  })
  return { client: { from }, queries }
}

const PREPARE_TABLES: Record<string, Resp> = {
  agent_work_orders: { data: [{ id: 'order-1', wbs_item_id: ID.ops }] },
  wbs_item_links: { data: [
    { wbs_item_id: 'item-old', block_hash: BLOCKS[2].hash, wbs_items: { code: '권한', name: '권한 화면 시안' } },
    { wbs_item_id: 'item-newer', block_hash: BLOCKS[2].hash, wbs_items: { code: '권한2', name: '두 번째' } },
  ] },
  minute_insights: { data: [{ block_index: 1, label: '10월 31일까지 로그인 API' }] },
  minute_versions: { data: { minute_date: '2026-10-21' } },
}

function verified(s: MinuteIssueSourceInput, block: MinuteBlock = BLOCKS[s.blockIndex]) {
  return { ok: true as const, value: { storedBodyHash: BODY_HASH, block, insightLabel: s.kind === 'manual' ? null : LABELS[s.blockIndex] ?? null, draftContextText: '', selectionExcerpt: null } }
}

let session: ReturnType<typeof sessionClient>

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ADMIN })
  m.requireProjectMember.mockResolvedValue({ ok: true, actor: MEMBER })
  m.resolveProjectId.mockResolvedValue({ ok: true, projectId: PROJECT })
  vi.mocked(requireModule).mockResolvedValue({ ok: true })
  session = sessionClient(PREPARE_TABLES)
  m.createServerClient.mockResolvedValue(session.client)
  m.createAdminClient.mockImplementation(() => { throw new Error('admin 클라이언트를 만들면 안 되는 자리') })
  m.hasLLM.mockReturnValue(true)
  m.generateAnswer.mockResolvedValue(null)
  m.getComputedWbs.mockResolvedValue({ items: TREE, dependencies: DEPENDENCIES })
  m.getProjectConfig.mockResolvedValue({})
  m.levelDepthOf.mockReturnValue(3)
  m.getProjectRoster.mockResolvedValue({ ok: true, rows: [{ id: 'm-1', name: '김철수', active: true }, { id: 'm-gone', name: '퇴사자', active: false }] })
  m.verify.mockImplementation(async (_pid: string, _ws: string | undefined, s: MinuteIssueSourceInput) => verified(s))
  m.applyWorkflowEvent.mockResolvedValue({ ok: true, actualChanged: false })
  m.emitNotification.mockResolvedValue({ ok: true })
  m.ensureOrderForWorkflowLeaf.mockResolvedValue({ ok: true, created: false, reason: 'not_workflow' })
})

/** 프롬프트 user 메시지의 JSON 본문(빌더가 <minute_wbs_input_json> 태그 사이 한 줄에 싣는다) */
function promptPayload(): {
  minuteDate: string; rows: { row: number; text: string; insightLabel: string | null; deadlineLabel: string | null }[]
  candidates: { id: string; path: string }[]; members: { id: string; name: string }[]; exampleNames: string[]
} {
  const content = (m.generateAnswer.mock.calls[0][1] as { content: string }[])[0].content
  return JSON.parse(content.split('\n')[1])
}

describe('prepareMinuteWbsDrafts', () => {
  it('프로젝트 관리자가 아니면(멤버) 원문·DB·AI 에 닿기 전에 거부한다', async () => {
    m.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1])
    expect(r).toEqual({ ok: false, error: ERR_DENIED })
    expect(m.requireProjectAdmin).toHaveBeenCalledWith(PROJECT)
    expect(m.createServerClient).not.toHaveBeenCalled()
    expect(m.verify).not.toHaveBeenCalled()
    expect(m.generateAnswer).not.toHaveBeenCalled()
  })

  it('회의록 모듈이 꺼지면 관문의 거부 그대로 — 원문·DB 에 닿지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1])
    expect(r).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
    expect(requireModule).toHaveBeenCalledWith({ projectId: PROJECT }, 'minutes')
    expect(m.verify).not.toHaveBeenCalled()
    expect(m.createServerClient).not.toHaveBeenCalled()
    expect(m.getComputedWbs).not.toHaveBeenCalled()
  })

  it('줄 수는 1~30 — 비었거나 넘치면 rowsInvalid', async () => {
    expect(await prepareMinuteWbsDrafts(PROJECT, [])).toEqual({ ok: false, error: t('srv.minuteWbs.rowsInvalid') })
    expect(await prepareMinuteWbsDrafts(PROJECT, Array.from({ length: 31 }, () => S1))).toEqual({ ok: false, error: t('srv.minuteWbs.rowsInvalid') })
    expect(m.verify).not.toHaveBeenCalled()
  })

  it('소스의 회의록·버전·본문이 섞이면 sourceMixed — 원문 검증 전에 멈춘다', async () => {
    const mixed = await prepareMinuteWbsDrafts(PROJECT, [S1, source(2, 'action', { minuteId: 'minute-2' })])
    expect(mixed).toEqual({ ok: false, error: t('srv.minuteWbs.sourceMixed') })
    const version = await prepareMinuteWbsDrafts(PROJECT, [S1, source(2, 'action', { minuteVersionId: 'version-2' })])
    expect(version).toEqual({ ok: false, error: t('srv.minuteWbs.sourceMixed') })
    expect(m.verify).not.toHaveBeenCalled()
  })

  it('kind 는 manual·action 만(등록 RPC 의 source_kind) — risk 는 원문 정보 오류', async () => {
    const r = await prepareMinuteWbsDrafts(PROJECT, [source(1, 'risk')])
    expect(r).toEqual({ ok: false, error: t('srv.issues.minutesSourceInformationNotValid') })
    expect(m.verify).not.toHaveBeenCalled()
  })

  it('원문 검증은 WBS 문구 갈래로 부르고, 그 거부를 그대로 돌려준다', async () => {
    m.verify.mockResolvedValue({ ok: false, error: t('srv.minuteWbs.bodyStale') })
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1])
    expect(r).toEqual({ ok: false, error: t('srv.minuteWbs.bodyStale') })
    expect(m.verify).toHaveBeenCalledWith(PROJECT, 'ws-1', S1, 'prepareMinuteWbsDrafts', true, 'wbs')
    expect(m.getComputedWbs).not.toHaveBeenCalled()
  })

  it('제목 줄(블록 등록)은 거부한다', async () => {
    const r = await prepareMinuteWbsDrafts(PROJECT, [source(0, 'manual')])
    expect(r).toEqual({ ok: false, error: t('srv.minuteWbs.headingBlock') })
    expect(m.generateAnswer).not.toHaveBeenCalled()
  })

  it('작업 계획을 못 읽으면 treeUnavailable — 빈 위치 목록으로 열지 않는다', async () => {
    m.getComputedWbs.mockRejectedValue(new Error('wbs_items 조회 실패'))
    expect(await prepareMinuteWbsDrafts(PROJECT, [S1])).toEqual({ ok: false, error: t('srv.minuteWbs.treeUnavailable') })
    expect(m.generateAnswer).not.toHaveBeenCalled()
  })

  it('진행 중 주문을 못 읽어도 treeUnavailable(위치 후보의 재료)', async () => {
    session = sessionClient({ ...PREPARE_TABLES, agent_work_orders: { error: { message: 'boom' } } })
    m.createServerClient.mockResolvedValue(session.client)
    expect(await prepareMinuteWbsDrafts(PROJECT, [S1])).toEqual({ ok: false, error: t('srv.minuteWbs.treeUnavailable') })
  })

  it('설정을 못 읽으면 configUnavailable', async () => {
    m.getProjectConfig.mockRejectedValue(new Error('설정 조회 실패'))
    expect(await prepareMinuteWbsDrafts(PROJECT, [S1])).toEqual({ ok: false, error: t('srv.minuteWbs.configUnavailable') })
    expect(m.generateAnswer).not.toHaveBeenCalled()
  })

  it('명단·연결·회의록 정보를 못 읽으면 그 사유로 멈춘다', async () => {
    m.getProjectRoster.mockResolvedValue({ ok: false, error: '명단을 불러오지 못했습니다.' })
    expect(await prepareMinuteWbsDrafts(PROJECT, [S1])).toEqual({ ok: false, error: t('srv.minuteWbs.rosterUnavailable') })
    m.getProjectRoster.mockResolvedValue({ ok: true, rows: [] })

    m.createServerClient.mockResolvedValue(sessionClient({ ...PREPARE_TABLES, wbs_item_links: { error: { message: 'boom' } } }).client)
    expect(await prepareMinuteWbsDrafts(PROJECT, [S1])).toEqual({ ok: false, error: t('srv.minuteWbs.linksUnavailable') })

    m.createServerClient.mockResolvedValue(sessionClient({ ...PREPARE_TABLES, minute_insights: { error: { message: 'boom' } } }).client)
    expect(await prepareMinuteWbsDrafts(PROJECT, [S1])).toEqual({ ok: false, error: t('srv.minuteWbs.minuteContextUnavailable') })
    expect(m.generateAnswer).not.toHaveBeenCalled()
  })

  it('AI 응답이 정상이면 mode ai — 후보 밖 위치·명단 밖 담당자는 버리고, 등록됨은 같은 문단 hash 의 첫 연결이다', async () => {
    m.generateAnswer.mockResolvedValue(JSON.stringify([
      { row: 0, name: '로그인 API 개발', parents: [ID.auth, 'not-a-candidate', ID.perf], end: '2026-10-31', assignee: 'm-1' },
      { row: 1, name: '권한 화면 시안 검토', parents: [ID.member], end: null, assignee: 'm-gone' },
    ]))
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.mode).toBe('ai')
    expect(r.value.members).toEqual([{ id: 'm-1', name: '김철수' }])
    expect(r.value.rows).toEqual([
      { row: 0, blockIndex: 1, blockHash: BLOCKS[1].hash, excerpt: minuteBlockDraftText(BLOCKS[1]), name: '로그인 API 개발',
        parentIds: [ID.auth], plannedEnd: '2026-10-31', assigneeMemberId: 'm-1', registered: null },
      { row: 1, blockIndex: 2, blockHash: BLOCKS[2].hash, excerpt: minuteBlockDraftText(BLOCKS[2]), name: '권한 화면 시안 검토',
        parentIds: [ID.member], plannedEnd: null, assigneeMemberId: null, registered: { itemId: 'item-old', code: '권한', name: '권한 화면 시안' } },
    ])
    // 고를 수 있는 위치 — 깊이 상한(3)에 닿은 말단·진행 중 주문·업무 흐름은 빠지고, 번호·의존 수·실적이 실린다
    expect(r.value.parents.map(p => p.id)).toEqual([ID.dev, ID.auth, ID.member, ID.test, ID.perf])
    expect(r.value.parents.find(p => p.id === ID.perf)).toMatchObject({ path: '2 테스트 › 2.1 성능 테스트', leaf: true, actualPct: 40, dependencyCount: 1 })
    // 줄마다 후보 id 는 추천 가능한(하위가 있는) 위치 안이다
    const recommendable = new Set(recommendableParents(r.value.parents).map(p => p.id))
    for (const row of r.value.rows) for (const id of row.parentIds) expect(recommendable.has(id)).toBe(true)

    expect(m.generateAnswer).toHaveBeenCalledOnce()
    const [system, , options] = m.generateAnswer.mock.calls[0]
    expect(system).toBe(MINUTE_WBS_DRAFT_SYSTEM_PROMPT)
    expect(options).toEqual({ timeoutMs: 20_000, maxOutputTokens: 4_096, allowModelFallback: false, retries: 0, retryRateLimit: false })
    const payload = promptPayload()
    expect(payload.minuteDate).toBe('2026-10-21')
    expect(payload.rows.map(row => [row.row, row.insightLabel, row.deadlineLabel])).toEqual([[0, '로그인 API 개발', '10월 31일까지 로그인 API'], [1, '권한 화면 시안 검토', null]])
    expect(payload.candidates.map(c => c.id).sort()).toEqual([ID.dev, ID.auth, ID.member, ID.test].sort())
    expect(payload.members).toEqual([{ id: 'm-1', name: '김철수' }])
    expect(payload.exampleNames).toEqual(['로그인 화면 설계', '회원 목록 화면', '성능 테스트', '운영', '배포 자동화'])
    // 읽기는 세션 클라이언트(RLS)만 — service_role 을 만들지 않는다
    expect(m.createAdminClient).not.toHaveBeenCalled()
    const links = session.queries.find(q => q.table === 'wbs_item_links')
    expect(links?.calls).toEqual(expect.arrayContaining([['eq', ['minute_id', 'minute-1']], ['eq', ['project_id', PROJECT]], ['order', ['created_at', { ascending: true }]]]))
    const orders = session.queries.find(q => q.table === 'agent_work_orders')
    expect(orders?.calls).toEqual(expect.arrayContaining([['eq', ['project_id', PROJECT]], ['in', ['status', ['ready', 'claimed', 'reported']]]]))
  })

  it('AI 가 일부 줄만 주거나 이름이 비면 그 줄은 통째로 결정형으로 채운다 — 쓸 만한 줄이 하나도 없으면 fallback', async () => {
    m.generateAnswer.mockResolvedValue(JSON.stringify([
      { row: 0, name: 'AI 작업명', parents: [ID.auth], end: null, assignee: null },
      { row: 1, name: '', parents: [ID.member], end: '2026-11-01', assignee: 'm-1' },
    ]))
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(r.ok && r.value.mode).toBe('ai')
    expect(r.ok && r.value.rows.map(row => [row.name, row.parentIds, row.plannedEnd, row.assigneeMemberId])).toEqual([
      ['AI 작업명', [ID.auth], null, null],
      [LABELS[2], [ID.test, ID.auth, ID.member], null, null],
    ])
    m.generateAnswer.mockResolvedValue(JSON.stringify([{ row: 1, name: '', parents: [], end: null, assignee: null }]))
    const none = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(none.ok && none.value.mode).toBe('fallback')
    expect(none.ok && none.value.rows.map(row => row.name)).toEqual([LABELS[1], LABELS[2]])
  })

  it('generateAnswer 가 null 이면 mode fallback — 이름은 fallbackWbsName, 위치는 결정형 점수 상위 3', async () => {
    m.generateAnswer.mockResolvedValue(null)
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.mode).toBe('fallback')
    const candidates: MinuteWbsParentOption[] = recommendableParents(r.value.parents)
    const expected = [S1, S2].map((s) => {
      const text = minuteBlockDraftText(BLOCKS[s.blockIndex])
      const name = fallbackWbsName(text, LABELS[s.blockIndex])
      return { name, parentIds: scoreParentCandidates(`${name}\n${text}`, candidates, 3) }
    })
    expect(r.value.rows.map(row => ({ name: row.name, parentIds: row.parentIds }))).toEqual(expected)
    expect(expected.map(e => e.parentIds)).toEqual([[ID.auth, ID.dev, ID.member], [ID.test, ID.auth, ID.member]])
    expect(r.value.rows.every(row => row.plannedEnd === null && row.assigneeMemberId === null)).toBe(true)
  })

  it('AI 를 쓸 수 없으면 generateAnswer 를 부르지 않는다', async () => {
    m.hasLLM.mockReturnValue(false)
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1])
    expect(r.ok && r.value.mode).toBe('fallback')
    expect(m.generateAnswer).not.toHaveBeenCalled()
  })

  it('프롬프트의 줄 원문은 1,500자에서 자른다(저장 발췌 상한과 별개)', async () => {
    const long = splitMinuteBlocks(`긴 문단 ${'가'.repeat(3_000)}`)[0]
    m.verify.mockImplementation(async (_p: string, _w: string | undefined, s: MinuteIssueSourceInput) => verified(s, long))
    m.generateAnswer.mockResolvedValue('[]')
    const r = await prepareMinuteWbsDrafts(PROJECT, [source(1, 'manual')])
    expect(promptPayload().rows[0].text).toHaveLength(1_500)
    expect(r.ok && r.value.rows[0].excerpt).toBe(minuteIssueSourceExcerpt(minuteBlockDraftText(long)))
  })
})

describe('createWbsItemsFromMinute', () => {
  const row = (over: Partial<MinuteWbsCreateRow> = {}): MinuteWbsCreateRow => ({
    source: S1, name: '로그인 API 개발', parentId: ID.auth, plannedStart: null, plannedEnd: '2026-10-31', assigneeMemberId: ASSIGNEE, confirmParentLeaf: false, ...over,
  })
  const ROWS: MinuteWbsCreateRow[] = [row(), row({ source: S2, name: '권한 화면 시안 검토', parentId: ID.perf, plannedEnd: null, assigneeMemberId: null, confirmParentLeaf: true })]
  const rpc = vi.fn()
  const admin = { rpc }

  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: [{ row: 0, item_id: 'item-0', code: '로그인' }, { row: 1, item_id: 'item-1', code: '권한' }], error: null })
    m.createAdminClient.mockImplementation(() => admin)
  })

  it('프로젝트 관리자가 아니면 거부하고 service_role 을 만들지 않는다', async () => {
    m.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await createWbsItemsFromMinute(PROJECT, ROWS)).toEqual({ ok: false, error: ERR_DENIED })
    expect(m.createAdminClient).not.toHaveBeenCalled()
    expect(m.verify).not.toHaveBeenCalled()
  })

  it('회의록 모듈이 꺼지면 관문의 거부 — 검증·service_role 없음', async () => {
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    expect(await createWbsItemsFromMinute(PROJECT, ROWS)).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
    expect(m.verify).not.toHaveBeenCalled()
    expect(m.createAdminClient).not.toHaveBeenCalled()
  })

  it('입력 검증에 걸린 줄은 그 줄 번호와 함께 거부하고 RPC·원문 검증에 가지 않는다', async () => {
    const cases: Array<[MinuteWbsCreateRow[], string, number | undefined]> = [
      [[row(), row({ source: S2, name: '   ' })], t('srv.minuteWbs.nameRequired'), 1],
      [[row({ name: '가'.repeat(201) })], t('srv.minuteWbs.nameTooLong'), 0],
      [[row({ plannedStart: '2026-11-01', plannedEnd: '2026-10-31' })], t('srv.minuteWbs.dateRange'), 0],
      [[row({ plannedEnd: '2026-02-30' })], t('err.invalidRequest'), 0],
      [[row(), row({ source: S2, parentId: '__root__' })], t('err.invalidRequest'), 1],
      [[row({ assigneeMemberId: 'm-1' })], t('err.invalidRequest'), 0],
      [[row({ source: source(1, 'risk') })], t('srv.issues.minutesSourceInformationNotValid'), 0],
      [[row(), row({ source: source(2, 'action', { minuteVersionId: 'version-2' }) })], t('srv.minuteWbs.sourceMixed'), undefined],
    ]
    for (const [rows, error, at] of cases) {
      expect(await createWbsItemsFromMinute(PROJECT, rows)).toEqual(at === undefined ? { ok: false, error } : { ok: false, error, row: at })
    }
    expect(await createWbsItemsFromMinute(PROJECT, [])).toEqual({ ok: false, error: t('srv.minuteWbs.rowsInvalid') })
    expect(await createWbsItemsFromMinute(PROJECT, Array.from({ length: 31 }, () => row()))).toEqual({ ok: false, error: t('srv.minuteWbs.rowsInvalid') })
    expect(m.verify).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(m.createAdminClient).not.toHaveBeenCalled()
  })

  it('원문 검증 거부 — 한 줄만 걸리면 그 줄, 모든 줄이 같은 사유(회의록 단위)면 줄 번호 없이', async () => {
    m.verify.mockImplementation(async (_p: string, _w: string | undefined, s: MinuteIssueSourceInput) =>
      (s.blockIndex === 2 ? { ok: false, error: t('srv.issues.minutesBodyChanged') } : verified(s)))
    expect(await createWbsItemsFromMinute(PROJECT, ROWS)).toEqual({ ok: false, error: t('srv.issues.minutesBodyChanged'), row: 1 })
    m.verify.mockResolvedValue({ ok: false, error: t('srv.minuteWbs.minuteArchived') })
    expect(await createWbsItemsFromMinute(PROJECT, ROWS)).toEqual({ ok: false, error: t('srv.minuteWbs.minuteArchived') })
    expect(m.verify).toHaveBeenCalledWith(PROJECT, 'ws-1', S1, 'createWbsItemsFromMinute', false, 'wbs')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('제목 줄은 거부한다', async () => {
    expect(await createWbsItemsFromMinute(PROJECT, [row({ source: source(0, 'manual') })])).toEqual({ ok: false, error: t('srv.minuteWbs.headingBlock'), row: 0 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('설정을 못 읽으면 configUnavailable — service_role·RPC 없음', async () => {
    m.getProjectConfig.mockRejectedValue(new Error('설정 조회 실패'))
    expect(await createWbsItemsFromMinute(PROJECT, ROWS)).toEqual({ ok: false, error: t('srv.minuteWbs.configUnavailable') })
    expect(m.createAdminClient).not.toHaveBeenCalled()
  })

  it('정상 — RPC 한 번에 서버가 검증한 블록·발췌(4,000자 상한)·원문 키·본문 hash·깊이 상한을 싣는다', async () => {
    const long = splitMinuteBlocks(`긴 문단 ${'나'.repeat(5_000)}`)[0]
    m.verify.mockImplementation(async (_p: string, _w: string | undefined, s: MinuteIssueSourceInput) => verified(s, s.blockIndex === 1 ? long : BLOCKS[2]))
    // 클라이언트가 보낸 앵커(대문자 hash·다른 블록)가 아니라 서버가 검증한 값이 RPC 로 간다
    const r = await createWbsItemsFromMinute(PROJECT, ROWS.map(x => ({ ...x, source: { ...x.source, bodyHash: BODY_HASH.toUpperCase() } })))
    expect(r).toEqual({ ok: true, items: [{ row: 0, itemId: 'item-0', code: '로그인' }, { row: 1, itemId: 'item-1', code: '권한' }] })
    expect(rpc).toHaveBeenCalledTimes(1)
    const longExcerpt = minuteIssueSourceExcerpt(minuteBlockDraftText(long))
    expect(longExcerpt.length).toBeLessThanOrEqual(4_000)
    expect(rpc).toHaveBeenCalledWith('create_wbs_items_from_minute', {
      p_project_id: PROJECT,
      p_actor: USER,
      p_minute_id: 'minute-1',
      p_minute_version_id: 'version-1',
      p_body_hash: BODY_HASH,
      p_max_depth: 3,
      p_rows: [
        { name: '로그인 API 개발', parent_id: ID.auth, planned_start: null, planned_end: '2026-10-31', assignee_member_id: ASSIGNEE,
          block_index: long.index, block_hash: long.hash, excerpt: longExcerpt, source_kind: 'action',
          source_key: makeMinuteIssueSourceKey({ minuteVersionId: 'version-1', blockIndex: long.index, blockHash: long.hash, kind: 'action', selectionHash: null }),
          confirm_parent_leaf: false },
        { name: '권한 화면 시안 검토', parent_id: ID.perf, planned_start: null, planned_end: null, assignee_member_id: null,
          block_index: 2, block_hash: BLOCKS[2].hash, excerpt: minuteBlockDraftText(BLOCKS[2]), source_kind: 'action',
          source_key: makeMinuteIssueSourceKey({ minuteVersionId: 'version-1', blockIndex: 2, blockHash: BLOCKS[2].hash, kind: 'action', selectionHash: null }),
          confirm_parent_leaf: true },
      ],
    })
  })

  it('RPC 의 줄 거부 토큰은 그 문구와 줄 번호로 — WBS_PARENT_LEAF_UNCONFIRMED · detail 1', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'WBS_PARENT_LEAF_UNCONFIRMED', details: '1', code: '23514' } })
    expect(await createWbsItemsFromMinute(PROJECT, ROWS)).toEqual({ ok: false, error: t('srv.minuteWbs.parentLeafUnconfirmed'), row: 1 })
    expect(m.enqueueIndexChange).not.toHaveBeenCalled()
    expect(m.revalidatePath).not.toHaveBeenCalled()
  })

  it('RPC 토큰 표 — 계약의 토큰은 모두 그 문구, 회의록 단위 거부는 줄 번호 없이', async () => {
    const table: Array<[string, string, Parameters<typeof t>[0], string | null]> = [
      ['MINUTE_WBS_ROWS_INVALID', '22023', 'srv.minuteWbs.rowsInvalid', null],
      ['WBS_ACTOR_FORBIDDEN', '42501', 'srv.minuteWbs.forbidden', null],
      ['MINUTE_NOT_FOUND', 'P0002', 'srv.minuteWbs.minuteNotFound', null],
      ['MINUTE_ARCHIVED', '55000', 'srv.minuteWbs.minuteArchived', null],
      ['MINUTE_PROJECT_MISMATCH', '23514', 'srv.minuteWbs.minuteProjectMismatch', null],
      ['MINUTE_VERSION_NOT_FOUND', 'P0002', 'srv.minuteWbs.versionNotFound', null],
      ['MINUTE_BODY_STALE', '22023', 'srv.minuteWbs.bodyStale', null],
      ['WBS_NAME_REQUIRED', '22023', 'srv.minuteWbs.nameRequired', '0'],
      ['WBS_NAME_TOO_LONG', '22023', 'srv.minuteWbs.nameTooLong', '1'],
      ['WBS_PARENT_NOT_FOUND', 'P0002', 'srv.minuteWbs.parentNotFound', '0'],
      ['WBS_PARENT_SUB_ACT', '23514', 'srv.minuteWbs.parentSubAct', '1'],
      ['WBS_PARENT_WORKFLOW', '23514', 'srv.minuteWbs.parentWorkflow', '0'],
      ['WBS_PARENT_DEPTH', '23514', 'srv.minuteWbs.parentDepth', '1'],
      ['WBS_DATE_RANGE_INVALID', '22023', 'srv.minuteWbs.dateRange', '0'],
      ['WBS_ASSIGNEE_INVALID', '22023', 'srv.minuteWbs.assigneeInvalid', '0'],
      ['MINUTE_BLOCK_ALREADY_LINKED', '23505', 'srv.minuteWbs.alreadyLinked', '1'],
    ]
    for (const [message, code, key, details] of table) {
      rpc.mockResolvedValueOnce({ data: null, error: { message, code, details } })
      const r = await createWbsItemsFromMinute(PROJECT, ROWS)
      expect(r, message).toEqual(details === null ? { ok: false, error: t(key) } : { ok: false, error: t(key), row: Number(details) })
    }
  })

  it('표에 없는 오류(색인의 날 23505·격리 수준)는 고정 문구 createFailed — Key 세부는 줄 번호가 아니다', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'duplicate key value violates unique constraint "wbs_item_links_action_block_uidx"', code: '23505',
      details: 'Key (project_id, minute_id, block_hash)=(a, b, c) already exists.' } })
    expect(await createWbsItemsFromMinute(PROJECT, ROWS)).toEqual({ ok: false, error: t('srv.minuteWbs.createFailed') })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'MINUTE_WBS_ISOLATION', code: '25001', details: null } })
    expect(await createWbsItemsFromMinute(PROJECT, ROWS)).toEqual({ ok: false, error: t('srv.minuteWbs.createFailed') })
  })

  it('등록 뒤 — 색인 등록 한 번(줄 수만큼), 담당자 있는 줄만 도우미 셋을 전이 → 알림 → 주문 순으로, 스냅샷·재검증', async () => {
    const r = await createWbsItemsFromMinute(PROJECT, ROWS)
    expect(r.ok).toBe(true)
    expect(m.enqueueIndexChange).toHaveBeenCalledTimes(1)
    expect(m.enqueueIndexChange).toHaveBeenCalledWith([
      { domain: 'wbs', projectId: PROJECT, entityId: 'item-0' },
      { domain: 'wbs', projectId: PROJECT, entityId: 'item-1' },
    ])
    expect(m.applyWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(m.applyWorkflowEvent).toHaveBeenCalledWith(admin, { event: 'assign', actorUserId: USER, itemId: 'item-0' })
    expect(m.emitNotification).toHaveBeenCalledTimes(1)
    expect(m.emitNotification).toHaveBeenCalledWith({
      type: 'work.assigned', projectId: PROJECT, actorUserId: USER, entityType: 'wbs_item', entityId: 'item-0',
      payload: { title: '로그인 API 개발', detail: t('srv.minuteWbs.assignedDetail'), href: `/p/${PROJECT}/wbs` },
      recipientMemberIds: [ASSIGNEE],
    })
    expect(m.ensureOrderForWorkflowLeaf).toHaveBeenCalledTimes(1)
    expect(m.ensureOrderForWorkflowLeaf).toHaveBeenCalledWith(admin, { projectId: PROJECT, wbsItemId: 'item-0', actorUserId: USER })
    const [apply] = m.applyWorkflowEvent.mock.invocationCallOrder
    const [emit] = m.emitNotification.mock.invocationCallOrder
    const [order] = m.ensureOrderForWorkflowLeaf.mock.invocationCallOrder
    expect(apply).toBeLessThan(emit)
    expect(emit).toBeLessThan(order)
    expect(m.after).toHaveBeenCalledTimes(1)
    expect(m.revalidatePath).toHaveBeenCalledWith('/(app)/p/[projectId]', 'layout')
    expect(m.revalidatePath).toHaveBeenCalledWith('/(app)/w/[slug]/minutes/[id]', 'page')
  })

  it('담당자 도우미가 실패(예외)해도 각자 로그만 남기고 등록은 성공이다', async () => {
    m.applyWorkflowEvent.mockRejectedValue(new Error('전이 실패'))
    m.emitNotification.mockRejectedValue(new Error('알림 실패'))
    m.ensureOrderForWorkflowLeaf.mockRejectedValue(new Error('주문 실패'))
    const r = await createWbsItemsFromMinute(PROJECT, ROWS)
    expect(r).toEqual({ ok: true, items: [{ row: 0, itemId: 'item-0', code: '로그인' }, { row: 1, itemId: 'item-1', code: '권한' }] })
    expect([m.applyWorkflowEvent, m.emitNotification, m.ensureOrderForWorkflowLeaf].map(f => f.mock.calls.length)).toEqual([1, 1, 1])
  })
})

describe('getWbsItemMinuteSources', () => {
  const ITEM = '20000000-0000-4000-8000-000000000001'
  const LINK_ROW = {
    id: 'link-1', minute_id: 'minute-1', minute_version_id: 'version-1', minute_version_no: 3, minute_title_snapshot: '개발 회의',
    minute_date_snapshot: '2026-10-21', body_hash: BODY_HASH, block_index: 1, block_hash: BLOCKS[1].hash, excerpt_snapshot: '로그인 API 개발', created_at: '2026-10-21T01:00:00Z',
  }

  it('항목의 프로젝트를 못 정하면 그 사유 그대로', async () => {
    m.resolveProjectId.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    m.resolveProjectId.mockResolvedValue({ ok: true, projectId: null })
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: ERR_MISSING })
    expect(m.requireProjectMember).not.toHaveBeenCalled()
    expect(m.createServerClient).not.toHaveBeenCalled()
  })

  it('uuid 가 아닌 항목 id 는 조회 전에 거부', async () => {
    expect(await getWbsItemMinuteSources('not-a-uuid')).toEqual({ ok: false, error: t('err.invalidRequest') })
    expect(m.resolveProjectId).not.toHaveBeenCalled()
  })

  it('가드·모듈 관문이 거부하면 읽지 않는다', async () => {
    m.requireProjectMember.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: ERR_DENIED })
    m.requireProjectMember.mockResolvedValue({ ok: true, actor: MEMBER })
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
    expect(m.createServerClient).not.toHaveBeenCalled()
  })

  it('멤버면 세션 클라이언트로 그 항목의 연결을 만든 순서대로 읽어 WbsItemMinuteSource 로', async () => {
    session = sessionClient({ wbs_item_links: { data: [LINK_ROW] } })
    m.createServerClient.mockResolvedValue(session.client)
    const r = await getWbsItemMinuteSources(ITEM)
    expect(r).toEqual({ ok: true, rows: [{
      linkId: 'link-1', minuteId: 'minute-1', minuteVersionId: 'version-1', minuteVersionNo: 3, minuteTitle: '개발 회의', minuteDate: '2026-10-21',
      bodyHash: BODY_HASH, blockIndex: 1, blockHash: BLOCKS[1].hash, excerpt: '로그인 API 개발', createdAt: '2026-10-21T01:00:00Z',
    }] })
    expect(m.resolveProjectId).toHaveBeenCalledWith('wbs_items', ITEM)
    expect(m.requireProjectMember).toHaveBeenCalledWith(PROJECT)
    expect(requireModule).toHaveBeenCalledWith({ projectId: PROJECT }, 'minutes')
    expect(session.queries.map(q => q.table)).toEqual(['wbs_item_links'])
    expect(session.queries[0].calls).toEqual(expect.arrayContaining([['eq', ['wbs_item_id', ITEM]], ['order', ['created_at', { ascending: true }]]]))
    expect(m.createAdminClient).not.toHaveBeenCalled()
  })

  it('읽기 실패는 sourcesUnavailable(빈 목록으로 그리지 않는다)', async () => {
    m.createServerClient.mockResolvedValue(sessionClient({ wbs_item_links: { error: { message: 'boom' } } }).client)
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: t('srv.minuteWbs.sourcesUnavailable') })
  })
})
