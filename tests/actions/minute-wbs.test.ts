// 회의록 → WBS 등록 액션(src/app/actions/minuteWbs.ts) — 가드 → 모듈 관문 → 입력 검증 → 원문 검증 → 읽기(세션)·AI → RPC(service_role) 순서와
// 실패를 "없음"으로 그리지 않는 규칙, RPC 토큰 → 문구·줄 번호, 등록 뒤 처리(색인·담당자 도우미 셋)를 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fnv1a64, minuteBlockDraftText, splitMinuteBlocks, type MinuteBlock } from '@/lib/minutes/blocks'

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
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
  verify: vi.fn(),
  applyWorkflowEvent: vi.fn(),
  emitNotification: vi.fn(),
  ensureOrderForWorkflowLeaf: vi.fn(),
  enqueueIndexChange: vi.fn(async () => {}),
  recordProgressSnapshot: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
  after: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: m.getSession }))
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
vi.mock('@/lib/minutes/verifySource', async (orig) => ({
  ...(await orig<typeof import('@/lib/minutes/verifySource')>()), verifyMinuteIssueBlock: m.verify,
}))
vi.mock('@/lib/agent/workflowEvent', () => ({ applyWorkflowEvent: m.applyWorkflowEvent }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: m.emitNotification }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: m.ensureOrderForWorkflowLeaf }))
vi.mock('@/lib/ai/index/enqueueChange', () => ({ enqueueIndexChange: m.enqueueIndexChange }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: m.recordProgressSnapshot }))
// 셋업의 전역 기본 mock(tests/setup/minute-wbs-sources.ts — 읽기 액션을 '연결 없음'으로 대역)을 걷는다. 이 파일은 진짜 세 액션을 본다
vi.unmock('@/app/actions/minuteWbs')

import { createWbsItemsFromMinute, getWbsItemMinuteSources, prepareMinuteWbsDrafts } from '@/app/actions/minuteWbs'
import { requireModule } from '@/lib/modules/gate'
import { aiAvailable } from '@/lib/modules/aiAvailable'
import { ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED, guardCodeOf } from '@/lib/authz/errors'
import { serverKoTranslate as t } from '@/lib/i18n/serverDict'
import { minuteIssueSourceExcerpt } from '@/lib/minutes/verifySource'
import { minuteSelectionKeyHash } from '@/lib/minutes/selection'
import { makeMinuteIssueSourceKey, type MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import {
  MINUTE_WBS_LEAF_UNCONFIRMED, fallbackWbsName, recommendableParents, scoreParentCandidates, type MinuteWbsCreateRow, type MinuteWbsParentOption,
} from '@/lib/domain/minuteWbs'
import { MINUTE_WBS_DRAFT_SYSTEM_PROMPT } from '@/lib/ai/minute-wbs-draft'
import { clearMinuteWbsDraftCache } from '@/lib/ai/minute-wbs-draft-cache'
import { makeAdminActor, makeMemberActor } from '../fixtures/actor'

const PROJECT = 'project-1'
const USER = 'user-1'
const ADMIN = makeAdminActor(PROJECT, { userId: USER })
const MEMBER = makeMemberActor(PROJECT, [], { userId: USER })

const BODY = ['# 개발 회의', '', '로그인 API 개발은 김철수가 10월 31일까지 맡는다.', '', '- 권한 화면 시안 검토', '- 성능 테스트 계획 수립'].join('\n')
const BODY_HASH = fnv1a64(BODY)
const BLOCKS = splitMinuteBlocks(BODY)
const LABELS: Record<number, string> = { 1: '로그인 API 개발', 2: '권한 화면 시안 검토' }
// 회의록·버전 id 는 uuid 꼴이어야 액션 입력 검증을 지난다(RPC 인자가 uuid 다)
const MINUTE = '30000000-0000-4000-8000-000000000001'
const VERSION = '30000000-0000-4000-8000-000000000002'
const OTHER_MINUTE = '30000000-0000-4000-8000-000000000003'
const OTHER_VERSION = '30000000-0000-4000-8000-000000000004'
const source = (index: number, kind: MinuteIssueSourceInput['kind'] = 'action', over: Partial<MinuteIssueSourceInput> = {}): MinuteIssueSourceInput => ({
  minuteId: MINUTE, minuteVersionId: VERSION, bodyHash: BODY_HASH, blockIndex: BLOCKS[index].index, blockHash: BLOCKS[index].hash, kind, ...over,
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

/** 본문 BLOCKS[2] 에 걸린 연결 둘(먼저 만든 것이 「등록됨」의 작업) — 그 문단을 등록된 문단으로 보는 케이스가 쓴다 */
const LINKS_ON_BLOCK2 = [
  { wbs_item_id: 'item-old', block_hash: BLOCKS[2].hash, wbs_items: { code: '권한', name: '권한 화면 시안' } },
  { wbs_item_id: 'item-newer', block_hash: BLOCKS[2].hash, wbs_items: { code: '권한2', name: '두 번째' } },
]
/** 문단 1 의 「기한」 요약 — 날짜 해석의 재료(deadlineLabel) */
const DEADLINE_ON_BLOCK1 = { block_index: 1, block_hash: BLOCKS[1].hash, kind: 'deadline', label: '10월 31일까지 로그인 API' }
const PREPARE_TABLES: Record<string, Resp> = {
  agent_work_orders: { data: [{ id: 'order-1', wbs_item_id: ID.ops }] },
  // 기본은 제목 줄(BLOCKS[0]) 연결 하나 — 원천 문단(1·2)은 아직 등록되지 않았다
  wbs_item_links: { data: [{ wbs_item_id: 'item-head', block_hash: BLOCKS[0].hash, wbs_items: { code: '개발', name: '개발 회의' } }] },
  minute_insights: { data: [DEADLINE_ON_BLOCK1] },
  minute_versions: { data: { minute_date: '2026-10-21' } },
  // 담당자 후보의 원천 — 활성 명단 행 + 활성 인물만(박영희는 가나다순으로 김철수 뒤). 휴면(사람 비활성)·퇴사(명단 행 비활성)는 빠져야 한다
  project_members: { data: [
    { id: 'm-2', active: true, people: { display_name: '박영희', active: true } },
    { id: 'm-1', active: true, people: { display_name: '김철수', active: true } },
    { id: 'm-dormant', active: true, people: { display_name: '휴면 인물', active: false } },
    { id: 'm-gone', active: false, people: { display_name: '퇴사자', active: true } },
  ] },
}
const MEMBERS = [{ id: 'm-1', name: '김철수' }, { id: 'm-2', name: '박영희' }]

function verified(s: MinuteIssueSourceInput, block: MinuteBlock = BLOCKS[s.blockIndex], selectionExcerpt: string | null = null) {
  return { ok: true as const, value: { storedBodyHash: BODY_HASH, block, insightLabel: s.kind === 'manual' ? null : LABELS[s.blockIndex] ?? null, draftContextText: '', selectionExcerpt } }
}

let session: ReturnType<typeof sessionClient>

beforeEach(() => {
  vi.clearAllMocks()
  // AI 초안 캐시는 인스턴스(모듈) 상태다 — 케이스마다 비운다(같은 프롬프트의 앞 케이스 응답이 새지 않게)
  clearMinuteWbsDraftCache()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.getSession.mockResolvedValue({ id: USER, email: 'user@example.com' })
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
  m.verify.mockImplementation(async (_pid: string, _ws: string | undefined, s: MinuteIssueSourceInput) => verified(s))
  m.applyWorkflowEvent.mockResolvedValue({ ok: true, actualChanged: false })
  m.emitNotification.mockResolvedValue({ ok: true })
  m.ensureOrderForWorkflowLeaf.mockResolvedValue({ ok: true, created: false, reason: 'not_workflow' })
})

type PromptPayload = {
  minuteDate: string; rows: { row: number; text: string; insightLabel: string | null; deadlineLabel: string | null }[]
  candidates: { id: string; path: string }[]; members: { id: string; name: string }[]; exampleNames: string[]
}
const payloadOf = (messages: unknown): PromptPayload => JSON.parse((messages as { content: string }[])[0].content.split('\n')[1])
/** 프롬프트 user 메시지의 JSON 본문(빌더가 <minute_wbs_input_json> 태그 사이 한 줄에 싣는다) — call 번째 호출 */
function promptPayload(call = 0): PromptPayload {
  return payloadOf(m.generateAnswer.mock.calls[call][1])
}

/** 위치 후보의 경로(트리의 개요 번호 + 이름) — 프롬프트는 id 대신 별칭(c1…)을 싣는다. 대역이 실제 id 를 별칭으로 바꿀 때 경로로 찾는다 */
const PATH: Record<string, string> = {
  [ID.dev]: '1 개발', [ID.auth]: '1 개발 › 1.1 인증', [ID.member]: '1 개발 › 1.2 회원관리', [ID.test]: '2 테스트',
}
const MEMBER_NAME: Record<string, string> = { 'm-1': '김철수', 'm-2': '박영희' }
type AiLine = { row: number; name?: unknown; parents?: unknown; end?: unknown; assignee?: unknown }
/**
 * AI 대역 — 실제 id 로 적은 답을 그 호출의 프롬프트 별칭(후보 c1…·멤버 m1…)으로 바꿔 돌려준다(경로·이름으로 찾는다). 프롬프트에 없는 id
 * (후보 밖 위치·명단 밖 담당자)는 그대로 둔다 — 파서가 버린다. raw 를 주면 바꾼 배열 글을 그 함수로 다듬는다(잘린 응답 등)
 */
function aiAnswers(lines: AiLine[], raw: (json: string) => string = (json) => json) {
  m.generateAnswer.mockImplementation(async (_system: string, messages: unknown) => {
    const payload = payloadOf(messages)
    const candidate = (id: unknown) => payload.candidates.find(c => typeof id === 'string' && c.path === PATH[id])?.id ?? id
    const member = (id: unknown) => payload.members.find(x => typeof id === 'string' && x.name === MEMBER_NAME[id])?.id ?? id
    return raw(JSON.stringify(lines.map(line => ({
      ...line,
      ...(Array.isArray(line.parents) ? { parents: line.parents.map(candidate) } : {}),
      ...('assignee' in line ? { assignee: member(line.assignee) } : {}),
    }))))
  })
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
    const mixed = await prepareMinuteWbsDrafts(PROJECT, [S1, source(2, 'action', { minuteId: OTHER_MINUTE })])
    expect(mixed).toEqual({ ok: false, error: t('srv.minuteWbs.sourceMixed') })
    const version = await prepareMinuteWbsDrafts(PROJECT, [S1, source(2, 'action', { minuteVersionId: OTHER_VERSION })])
    expect(version).toEqual({ ok: false, error: t('srv.minuteWbs.sourceMixed') })
    expect(m.verify).not.toHaveBeenCalled()
  })

  it('kind 는 manual·action 만(등록 RPC 의 source_kind) — risk 는 원문 정보 오류', async () => {
    const r = await prepareMinuteWbsDrafts(PROJECT, [source(1, 'risk')])
    expect(r).toEqual({ ok: false, error: t('srv.issues.minutesSourceInformationNotValid') })
    expect(m.verify).not.toHaveBeenCalled()
  })

  it('회의록 id·버전 id 가 uuid 꼴이 아니면 원문 정보 오류 — 원문 검증·DB 에 닿지 않는다', async () => {
    for (const bad of [{ minuteId: 'minute-1' }, { minuteVersionId: 'version-1' }, { minuteId: 42 as unknown as string }]) {
      expect(await prepareMinuteWbsDrafts(PROJECT, [S1, source(2, 'action', bad)]), JSON.stringify(bad))
        .toEqual({ ok: false, error: t('srv.issues.minutesSourceInformationNotValid') })
    }
    expect(m.verify).not.toHaveBeenCalled()
    expect(m.createServerClient).not.toHaveBeenCalled()
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
    m.createServerClient.mockResolvedValue(sessionClient({ ...PREPARE_TABLES, project_members: { error: { message: 'boom' } } }).client)
    expect(await prepareMinuteWbsDrafts(PROJECT, [S1])).toEqual({ ok: false, error: t('srv.minuteWbs.rosterUnavailable') })

    m.createServerClient.mockResolvedValue(sessionClient({ ...PREPARE_TABLES, wbs_item_links: { error: { message: 'boom' } } }).client)
    expect(await prepareMinuteWbsDrafts(PROJECT, [S1])).toEqual({ ok: false, error: t('srv.minuteWbs.linksUnavailable') })

    m.createServerClient.mockResolvedValue(sessionClient({ ...PREPARE_TABLES, minute_insights: { error: { message: 'boom' } } }).client)
    expect(await prepareMinuteWbsDrafts(PROJECT, [S1])).toEqual({ ok: false, error: t('srv.minuteWbs.minuteContextUnavailable') })
    expect(m.generateAnswer).not.toHaveBeenCalled()
  })

  it('AI 응답이 정상이면 mode ai — 후보 밖 위치·명단 밖 담당자는 버린다. 목록 문단 줄에는 항목 수가 실린다', async () => {
    aiAnswers([
      { row: 0, name: '로그인 API 개발', parents: [ID.auth, 'not-a-candidate', ID.perf], end: '2026-10-31', assignee: 'm-1' },
      { row: 1, name: '권한 화면 시안 검토', parents: [ID.member], end: null, assignee: 'm-gone' },
    ])
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.mode).toBe('ai')
    expect(r.value.members).toEqual(MEMBERS)
    // 문단 2 는 두 항목짜리 목록 — 한 줄이 작업 하나가 된다는 안내의 재료(listItems)
    expect(r.value.rows).toEqual([
      { row: 0, blockIndex: 1, blockHash: BLOCKS[1].hash, excerpt: minuteBlockDraftText(BLOCKS[1]), name: '로그인 API 개발',
        parentIds: [ID.auth], plannedEnd: '2026-10-31', assigneeMemberId: 'm-1', registered: null },
      { row: 1, blockIndex: 2, blockHash: BLOCKS[2].hash, excerpt: minuteBlockDraftText(BLOCKS[2]), name: '권한 화면 시안 검토',
        parentIds: [ID.member], plannedEnd: null, assigneeMemberId: null, registered: null, listItems: 2 },
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
    // 출력 상한은 줄 수를 따라 는다(4,096 + 줄당 200, 8,192 상한) — 큰 묶음에서 배열이 잘리지 않게
    expect(options).toEqual({ timeoutMs: 20_000, maxOutputTokens: 4_096 + 2 * 200, allowModelFallback: false, retries: 0, retryRateLimit: false })
    const payload = promptPayload()
    expect(payload.minuteDate).toBe('2026-10-21')
    expect(payload.rows.map(row => [row.row, row.insightLabel, row.deadlineLabel])).toEqual([[0, '로그인 API 개발', '10월 31일까지 로그인 API'], [1, '권한 화면 시안 검토', null]])
    // 후보·멤버는 uuid 대신 짧은 별칭(c1…·m1…)으로 싣는다 — 별칭 ↔ 실제 id 는 액션이 쥔다
    expect(payload.candidates.map(c => c.path).sort()).toEqual([ID.dev, ID.auth, ID.member, ID.test].map(id => PATH[id]).sort())
    expect(payload.candidates.map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(payload.members).toEqual([{ id: 'm1', name: '김철수' }, { id: 'm2', name: '박영희' }])
    expect(JSON.stringify(payload)).not.toContain(ID.auth)
    expect(payload.exampleNames).toEqual(['로그인 화면 설계', '회원 목록 화면', '성능 테스트', '운영', '배포 자동화'])
    // 읽기는 세션 클라이언트(RLS)만 — service_role 을 만들지 않는다
    expect(m.createAdminClient).not.toHaveBeenCalled()
    const links = session.queries.find(q => q.table === 'wbs_item_links')
    expect(links?.calls).toEqual(expect.arrayContaining([['eq', ['minute_id', MINUTE]], ['eq', ['project_id', PROJECT]], ['order', ['created_at', { ascending: true }]]]))
    const orders = session.queries.find(q => q.table === 'agent_work_orders')
    expect(orders?.calls).toEqual(expect.arrayContaining([['eq', ['project_id', PROJECT]], ['in', ['status', ['ready', 'claimed', 'reported']]]]))
  })

  it('AI 줄은 칸 단위로 채운다 — 이름이 비면 이름만 결정형이고 위치·종료일·담당자는 AI 값(위치까지 비면 결정형 상위 3)', async () => {
    aiAnswers([
      { row: 0, name: '', parents: [ID.member], end: '2026-11-01', assignee: 'm-1' },
      { row: 1, name: '', parents: [], end: '2026-11-07', assignee: 'm-2' },
    ])
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(r.ok && r.value.mode).toBe('ai')
    expect(r.ok && r.value.rows.map(row => [row.name, row.parentIds, row.plannedEnd, row.assigneeMemberId])).toEqual([
      [LABELS[1], [ID.member], '2026-11-01', 'm-1'],
      [LABELS[2], [ID.test, ID.auth, ID.member], '2026-11-07', 'm-2'],
    ])
  })

  it('이름을 낸 AI 줄의 빈 위치는 "확신 없음" 그대로 두고, AI 가 주지 않은 줄은 통째로 결정형이다', async () => {
    aiAnswers([{ row: 0, name: 'AI 작업명', parents: [], end: null, assignee: null }])
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(r.ok && r.value.mode).toBe('ai')
    expect(r.ok && r.value.rows.map(row => [row.name, row.parentIds, row.plannedEnd, row.assigneeMemberId])).toEqual([
      ['AI 작업명', [], null, null],
      [LABELS[2], [ID.test, ID.auth, ID.member], null, null],
    ])
  })

  it('AI 가 준 위치가 모두 후보 밖이면(실제 uuid·없는 별칭) 그 줄만 결정형 상위 3 — 「확신 없음([])」과 다르다', async () => {
    // 프롬프트에는 별칭만 있다 — 별칭 대신 실제 id 를 적은 답·없는 별칭은 위치로 쓸 수 없다(대역이 별칭으로 바꾸지 않은 날 답)
    m.generateAnswer.mockResolvedValue(JSON.stringify([
      { row: 0, name: '로그인 API 개발', parents: ['c99', ID.auth], end: null, assignee: null },
      { row: 1, name: '권한 화면 시안 검토', parents: [], end: null, assignee: null },
    ]))
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(r.ok && r.value.mode).toBe('ai')
    const candidates = r.ok ? recommendableParents(r.value.parents) : []
    const scored = scoreParentCandidates(`로그인 API 개발\n${minuteBlockDraftText(BLOCKS[1])}`, candidates, 3)
    expect(scored.length).toBeGreaterThan(0)
    expect(r.ok && r.value.rows.map(row => [row.name, row.parentIds])).toEqual([
      ['로그인 API 개발', scored],
      ['권한 화면 시안 검토', []],
    ])
  })

  it('AI 가 아무 칸도 채우지 않은 줄만 돌려주면 mode fallback(결정형 초안과 같다)', async () => {
    aiAnswers([{ row: 1, name: '', parents: [], end: null, assignee: null }])
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(r.ok && r.value.mode).toBe('fallback')
    expect(r.ok && r.value.rows.map(row => [row.name, row.parentIds])).toEqual([[LABELS[1], [ID.auth, ID.dev, ID.member]], [LABELS[2], [ID.test, ID.auth, ID.member]]])
  })

  it('담당자 후보는 활성 명단 행이면서 활성 인물만(가나다순) — 사람이 비활성이면 후보에도 AI 허용 목록에도 없다', async () => {
    aiAnswers([
      { row: 0, name: '로그인 API 개발', parents: [], end: null, assignee: 'm-dormant' },
      { row: 1, name: '권한 화면 시안 검토', parents: [], end: null, assignee: 'm-2' },
    ])
    const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
    expect(r.ok && r.value.members).toEqual(MEMBERS)
    expect(r.ok && r.value.rows.map(row => row.assigneeMemberId)).toEqual([null, 'm-2'])
    expect(promptPayload().members.map(x => x.name)).toEqual(MEMBERS.map(x => x.name))
    const roster = session.queries.find(q => q.table === 'project_members')
    expect(roster?.calls).toEqual(expect.arrayContaining([['eq', ['project_id', PROJECT]], ['eq', ['active', true]], ['eq', ['people.active', true]]]))
    expect(roster?.calls.find(([k]) => k === 'select')?.[1][0]).toContain('people!inner(')
  })

  it('드래그 선택 줄 — 발췌·프롬프트 원문은 검증된 선택 발췌이고, 기한 라벨은 선택이 걸친 블록(끝 블록까지)에서만 모은다', async () => {
    const SELECTED = '김철수가 10월 31일까지 맡는다.\n권한 화면 시안 검토'
    const selection = source(1, 'manual', { selection: { text: SELECTED, endBlockIndex: 2, endBlockHash: BLOCKS[2].hash } })
    m.verify.mockImplementation(async (_p: string, _w: string | undefined, s: MinuteIssueSourceInput) => verified(s, BLOCKS[s.blockIndex], s.selection ? SELECTED : null))
    session = sessionClient({ ...PREPARE_TABLES, minute_insights: { data: [
      { block_index: 0, block_hash: BLOCKS[0].hash, kind: 'deadline', label: '범위 밖(제목)' },
      { block_index: 1, block_hash: BLOCKS[1].hash, kind: 'deadline', label: '10월 31일까지' },
      { block_index: 2, block_hash: BLOCKS[2].hash, kind: 'deadline', label: '11월 7일까지' },
      // 선택 등록은 선택한 글이 원문이다 — 첫 문단의 요약 라벨을 끌어오지 않는다(라벨은 문단 전체를 요약한 것)
      { block_index: 1, block_hash: BLOCKS[1].hash, kind: 'action', label: '문단 전체의 액션' },
    ] } })
    m.createServerClient.mockResolvedValue(session.client)
    const r = await prepareMinuteWbsDrafts(PROJECT, [selection])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.rows[0]).toMatchObject({ blockIndex: 1, blockHash: BLOCKS[1].hash, excerpt: minuteIssueSourceExcerpt(SELECTED), name: fallbackWbsName(SELECTED, null) })
    // 선택은 목록의 일부일 수 있다 — 블록 단위 안내(listItems)를 싣지 않는다
    expect(r.value.rows[0].listItems).toBeUndefined()
    expect(promptPayload().rows).toEqual([{ row: 0, text: SELECTED, insightLabel: null, deadlineLabel: '10월 31일까지 / 11월 7일까지' }])
  })

  describe('문단 등록(manual)의 요약 라벨 — 원문 검증이 action 이 아닌 줄의 라벨을 싣지 않으므로 같은 본문의 요약에서 찾는다(설계 §4.1)', () => {
    const MANUAL1 = source(1, 'manual')
    const withInsights = (rows: Record<string, unknown>[]) => {
      session = sessionClient({ ...PREPARE_TABLES, minute_insights: { data: rows } })
      m.createServerClient.mockResolvedValue(session.client)
    }

    it('그 문단에 액션 요약이 있으면 라벨이 프롬프트 줄에 실리고, AI 를 못 쓰면 이름이 라벨이다', async () => {
      withInsights([DEADLINE_ON_BLOCK1, { block_index: 1, block_hash: BLOCKS[1].hash, kind: 'action', label: '로그인 API 개발 착수' }])
      m.generateAnswer.mockResolvedValue(null)
      const r = await prepareMinuteWbsDrafts(PROJECT, [MANUAL1])
      expect(r.ok && r.value.mode).toBe('fallback')
      expect(promptPayload().rows).toEqual([{
        row: 0, text: minuteBlockDraftText(BLOCKS[1]), insightLabel: '로그인 API 개발 착수', deadlineLabel: '10월 31일까지 로그인 API',
      }])
      expect(r.ok && r.value.rows[0].name).toBe(fallbackWbsName(minuteBlockDraftText(BLOCKS[1]), '로그인 API 개발 착수'))
      expect(r.ok && r.value.rows[0].name).toBe('로그인 API 개발 착수')
    })

    it('액션이 먼저, 없으면 요약 우선순위(위험 → 기한 → 결정) — 같은 문단의 hash 가 다른(옛) 요약은 쓰지 않는다', async () => {
      const at = (kind: string, label: string, hash = BLOCKS[1].hash) => ({ block_index: 1, block_hash: hash, kind, label })
      const labelFor = async (rows: Record<string, unknown>[]) => {
        withInsights(rows)
        m.generateAnswer.mockClear()
        m.generateAnswer.mockResolvedValue(null)
        await prepareMinuteWbsDrafts(PROJECT, [MANUAL1])
        return promptPayload().rows[0].insightLabel
      }
      expect(await labelFor([at('decision', '결정'), at('risk', '위험'), at('action', '액션')])).toBe('액션')
      expect(await labelFor([at('decision', '결정'), at('risk', '위험')])).toBe('위험')
      expect(await labelFor([at('decision', '결정'), at('deadline', '기한')])).toBe('기한')
      expect(await labelFor([at('decision', '결정')])).toBe('결정')
      expect(await labelFor([at('action', '옛 액션', 'ffffffffffffffff'), at('none', '없음')])).toBeNull()
      expect(await labelFor([{ block_index: 2, block_hash: BLOCKS[2].hash, kind: 'action', label: '다른 문단' }])).toBeNull()
    })

    it('한꺼번에(action) 줄은 원문 검증이 준 라벨 그대로다', async () => {
      withInsights([DEADLINE_ON_BLOCK1, { block_index: 1, block_hash: BLOCKS[1].hash, kind: 'risk', label: '위험 라벨' }])
      m.generateAnswer.mockResolvedValue(null)
      await prepareMinuteWbsDrafts(PROJECT, [S1])
      expect(promptPayload().rows[0].insightLabel).toBe(LABELS[1])
    })
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

  describe('큰 묶음 — 별칭·출력 상한·잘린 응답', () => {
    /** 서로 다른 문단 n 개(제목 없음) — 같은 내용의 문단이 겹치지 않게 번호를 넣는다 */
    function manyParagraphs(n: number) {
      const body = Array.from({ length: n }, (_, i) => `로그인 후속 작업 ${i + 1}번을 정리한다.`).join('\n\n')
      const blocks = splitMinuteBlocks(body)
      const hash = fnv1a64(body)
      m.verify.mockImplementation(async (_p: string, _w: string | undefined, s: MinuteIssueSourceInput) =>
        ({ ok: true as const, value: { storedBodyHash: hash, block: blocks[s.blockIndex], insightLabel: null, draftContextText: '', selectionExcerpt: null } }))
      return blocks.map(block => source(0, 'action', { bodyHash: hash, blockIndex: block.index, blockHash: block.hash }))
    }

    it('출력 상한은 줄 수를 따라 늘고 8,192 에서 멈춘다(줄 하나 4,296 · 20줄 8,096 · 30줄 8,192)', async () => {
      for (const [n, budget] of [[1, 4_296], [20, 8_096], [30, 8_192]] as const) {
        clearMinuteWbsDraftCache()
        m.generateAnswer.mockClear()
        m.generateAnswer.mockResolvedValue(null)
        await prepareMinuteWbsDrafts(PROJECT, manyParagraphs(n))
        expect(m.generateAnswer.mock.calls[0][2], `${n}줄`).toMatchObject({ maxOutputTokens: budget })
        expect(promptPayload().rows).toHaveLength(n)
      }
    })

    it('30줄 응답이 출력 상한에서 잘려도 끝까지 닫힌 줄은 AI 값으로 쓰고, 나머지 줄만 결정형이다(묶음 전체가 결정형으로 떨어지지 않는다)', async () => {
      const sources = manyParagraphs(30)
      const lines = sources.map((_, row) => ({ row, name: `AI 작업 ${row + 1}`, parents: [ID.auth], end: null, assignee: 'm-1' }))
      // 열여섯째 줄 가운데서 끊긴 응답
      aiAnswers(lines, json => json.slice(0, json.indexOf('{"row":15') + 20))
      const r = await prepareMinuteWbsDrafts(PROJECT, sources)
      expect(r.ok && r.value.mode).toBe('ai')
      if (!r.ok) return
      expect(r.value.rows.slice(0, 15).every((row, i) => row.name === `AI 작업 ${i + 1}` && row.parentIds.join() === ID.auth && row.assigneeMemberId === 'm-1')).toBe(true)
      expect(r.value.rows.slice(15).every(row => row.name.startsWith('로그인 후속 작업') && row.assigneeMemberId === null)).toBe(true)
    })

    it('별칭은 프롬프트 순서대로 c1…·m1… 이고, 답의 별칭은 그 요청의 실제 id 로 돌아온다', async () => {
      aiAnswers([{ row: 0, name: '로그인 API 개발', parents: [ID.member, ID.auth], end: null, assignee: 'm-2' }])
      const r = await prepareMinuteWbsDrafts(PROJECT, [S1])
      const payload = promptPayload()
      expect(payload.candidates.every((c, i) => c.id === `c${i + 1}`)).toBe(true)
      expect(payload.members.map(x => x.id)).toEqual(['m1', 'm2'])
      expect(r.ok && r.value.rows[0]).toMatchObject({ parentIds: [ID.member, ID.auth], assigneeMemberId: 'm-2' })
    })
  })

  describe('한꺼번에(action) 줄 — 이미 등록된 문단·같은 묶음의 같은 문단은 다시 다듬지 않는다', () => {
    const linked = () => {
      session = sessionClient({ ...PREPARE_TABLES, wbs_item_links: { data: LINKS_ON_BLOCK2 } })
      m.createServerClient.mockResolvedValue(session.client)
    }

    it('등록된 action 줄은 등록됨 표시(같은 문단 hash 의 첫 연결)만 — 프롬프트·위치 점수에서 빠지고 남은 줄만 AI 가 받는다', async () => {
      linked()
      aiAnswers([{ row: 0, name: '로그인 API 개발', parents: [ID.auth], end: '2026-10-31', assignee: 'm-1' }])
      const r = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
      expect(r.ok && r.value.mode).toBe('ai')
      if (!r.ok) return
      expect(r.value.rows).toEqual([
        { row: 0, blockIndex: 1, blockHash: BLOCKS[1].hash, excerpt: minuteBlockDraftText(BLOCKS[1]), name: '로그인 API 개발',
          parentIds: [ID.auth], plannedEnd: '2026-10-31', assigneeMemberId: 'm-1', registered: null },
        { row: 1, blockIndex: 2, blockHash: BLOCKS[2].hash, excerpt: minuteBlockDraftText(BLOCKS[2]), name: LABELS[2],
          parentIds: [], plannedEnd: null, assigneeMemberId: null, registered: { itemId: 'item-old', code: '권한', name: '권한 화면 시안' }, listItems: 2 },
      ])
      // 프롬프트는 남은 한 줄뿐(줄 번호는 다시 0부터), 출력 상한도 그 수로
      expect(promptPayload().rows.map(row => [row.row, row.text])).toEqual([[0, minuteBlockDraftText(BLOCKS[1])]])
      expect(m.generateAnswer.mock.calls[0][2]).toMatchObject({ maxOutputTokens: 4_096 + 200 })
    })

    it('남은 줄이 없으면 AI 를 부르지 않는다 — 결정형 초안도 없으니 안내(fallback)를 띄우지 않는다', async () => {
      linked()
      m.generateAnswer.mockResolvedValue(JSON.stringify([]))
      const r = await prepareMinuteWbsDrafts(PROJECT, [S2])
      expect(m.generateAnswer).not.toHaveBeenCalled()
      expect(r.ok && r.value.mode).toBe('ai')
      expect(r.ok && r.value.rows.map(row => [row.registered?.itemId, row.parentIds])).toEqual([['item-old', []]])
    })

    it('문단 등록(manual)은 등록된 문단이어도 다시 다듬는다 — 「WBS로 하나 더 등록」', async () => {
      linked()
      m.generateAnswer.mockResolvedValue(null)
      const r = await prepareMinuteWbsDrafts(PROJECT, [source(2, 'manual')])
      expect(m.generateAnswer).toHaveBeenCalledOnce()
      expect(r.ok && r.value.rows[0].registered?.itemId).toBe('item-old')
      expect(r.ok && r.value.rows[0].parentIds.length).toBeGreaterThan(0)
    })

    it('같은 묶음에서 앞 줄과 같은 문단(같은 hash — 글자가 같은 두 문단)은 duplicate — 등록 RPC 가 둘째 줄을 막으므로 다듬지 않는다', async () => {
      const body = ['로그인 API 를 개발한다.', '권한 화면 시안을 검토한다.', '로그인 API 를 개발한다.'].join('\n\n')
      const blocks = splitMinuteBlocks(body)
      const hash = fnv1a64(body)
      expect(blocks[0].hash).toBe(blocks[2].hash)
      m.verify.mockImplementation(async (_p: string, _w: string | undefined, s: MinuteIssueSourceInput) =>
        ({ ok: true as const, value: { storedBodyHash: hash, block: blocks[s.blockIndex], insightLabel: null, draftContextText: '', selectionExcerpt: null } }))
      const sources = blocks.map(block => source(0, 'action', { bodyHash: hash, blockIndex: block.index, blockHash: block.hash }))
      m.generateAnswer.mockResolvedValue(null)
      const r = await prepareMinuteWbsDrafts(PROJECT, sources)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.rows.map(row => row.duplicate ?? false)).toEqual([false, false, true])
      expect(r.value.rows[2]).toMatchObject({ parentIds: [], plannedEnd: null, assigneeMemberId: null, registered: null, name: '로그인 API 를 개발한다.' })
      expect(promptPayload().rows.map(row => row.text)).toEqual([blocks[0].text, blocks[1].text])
    })
  })

  describe('AI 초안 캐시(설계 §7 — 이슈 초안과 같은 인스턴스 캐시)', () => {
    it('같은 프롬프트로 다시 준비하면 generateAnswer 를 부르지 않고 같은 초안을 준다 — 버전이 다르면 새로 부른다', async () => {
      aiAnswers([
        { row: 0, name: '로그인 API 개발', parents: [ID.auth], end: '2026-10-31', assignee: 'm-1' },
        { row: 1, name: '권한 화면 시안 검토', parents: [ID.member], end: null, assignee: null },
      ])
      const first = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
      const second = await prepareMinuteWbsDrafts(PROJECT, [S1, S2])
      expect(m.generateAnswer).toHaveBeenCalledTimes(1)
      expect(second).toEqual(first)
      expect(second.ok && second.value.mode).toBe('ai')

      const otherVersion = [S1, S2].map(s => ({ ...s, minuteVersionId: OTHER_VERSION }))
      await prepareMinuteWbsDrafts(PROJECT, otherVersion)
      expect(m.generateAnswer).toHaveBeenCalledTimes(2)
    })

    it('AI 를 끄면 캐시를 보지 않는다(결정형) — 못 쓴 응답(null)은 담지 않아 다음 열기에서 다시 부른다', async () => {
      aiAnswers([{ row: 0, name: '로그인 API 개발', parents: [ID.auth], end: null, assignee: null }])
      await prepareMinuteWbsDrafts(PROJECT, [S1])
      m.hasLLM.mockReturnValue(false)
      const off = await prepareMinuteWbsDrafts(PROJECT, [S1])
      expect(off.ok && off.value.mode).toBe('fallback')
      expect(m.generateAnswer).toHaveBeenCalledTimes(1)

      m.hasLLM.mockReturnValue(true)
      m.generateAnswer.mockReset()
      m.generateAnswer.mockResolvedValue(null)
      await prepareMinuteWbsDrafts(PROJECT, [S2])
      await prepareMinuteWbsDrafts(PROJECT, [S2])
      expect(m.generateAnswer).toHaveBeenCalledTimes(2)
    })

    it('동시에 온 같은 요청은 진행 중인 AI 호출 하나를 함께 기다린다', async () => {
      // 셋업의 전역 aiAvailable 대역은 부를 때마다 provider 를 동적 import 한다 — 동시에 두 번 부르면 둘째가 진짜 provider(키 없음 → 거짓)를
      // 받는 시험 환경의 버릇이 있어, 이 케이스는 판정을 직접 준다(제품 코드와 무관)
      vi.mocked(aiAvailable).mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      let answer!: (raw: string) => void
      m.generateAnswer.mockImplementation((_system: string, messages: unknown) => new Promise<string>(resolve => {
        const payload = payloadOf(messages)
        answer = (raw) => resolve(raw.replace('ALIAS', payload.candidates.find(c => c.path === PATH[ID.auth])!.id))
      }))
      const a = prepareMinuteWbsDrafts(PROJECT, [S1])
      const b = prepareMinuteWbsDrafts(PROJECT, [S1])
      await vi.waitFor(() => expect(m.generateAnswer).toHaveBeenCalled())
      answer(JSON.stringify([{ row: 0, name: '로그인 API 개발', parents: ['ALIAS'], end: null, assignee: null }]))
      const [ra, rb] = await Promise.all([a, b])
      expect(m.generateAnswer).toHaveBeenCalledTimes(1)
      expect(ra).toEqual(rb)
      expect(ra.ok && ra.value.rows[0]).toMatchObject({ name: '로그인 API 개발', parentIds: [ID.auth] })
    })
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
      // 회의록 id·버전 id 는 uuid 꼴(RPC 인자가 uuid) — 그 줄 번호와 함께
      [[row(), row({ source: source(2, 'action', { minuteId: 'minute-1' }) })], t('srv.issues.minutesSourceInformationNotValid'), 1],
      [[row({ source: source(1, 'action', { minuteVersionId: 'version-1' }) })], t('srv.issues.minutesSourceInformationNotValid'), 0],
      [[row(), row({ source: source(2, 'action', { minuteVersionId: OTHER_VERSION }) })], t('srv.minuteWbs.sourceMixed'), undefined],
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
      p_minute_id: MINUTE,
      p_minute_version_id: VERSION,
      p_body_hash: BODY_HASH,
      p_max_depth: 3,
      p_rows: [
        { name: '로그인 API 개발', parent_id: ID.auth, planned_start: null, planned_end: '2026-10-31', assignee_member_id: ASSIGNEE,
          block_index: long.index, block_hash: long.hash, excerpt: longExcerpt, source_kind: 'action',
          source_key: makeMinuteIssueSourceKey({ minuteVersionId: VERSION, blockIndex: long.index, blockHash: long.hash, kind: 'action', selectionHash: null }),
          confirm_parent_leaf: false },
        { name: '권한 화면 시안 검토', parent_id: ID.perf, planned_start: null, planned_end: null, assignee_member_id: null,
          block_index: 2, block_hash: BLOCKS[2].hash, excerpt: minuteBlockDraftText(BLOCKS[2]), source_kind: 'action',
          source_key: makeMinuteIssueSourceKey({ minuteVersionId: VERSION, blockIndex: 2, blockHash: BLOCKS[2].hash, kind: 'action', selectionHash: null }),
          confirm_parent_leaf: true },
      ],
    })
  })

  it('드래그 선택 줄 — 발췌는 검증된 선택 발췌(4,000자 상한)이고 원문 키에 선택 hash 가 실린다', async () => {
    const SELECTED = `김철수가 10월 31일까지 맡는다.\n${'다'.repeat(4_500)}`
    const selection = source(1, 'manual', { selection: { text: SELECTED, endBlockIndex: 2, endBlockHash: BLOCKS[2].hash } })
    m.verify.mockImplementation(async (_p: string, _w: string | undefined, s: MinuteIssueSourceInput) => verified(s, BLOCKS[s.blockIndex], SELECTED))
    rpc.mockResolvedValueOnce({ data: [{ row: 0, item_id: 'item-0', code: '김철수가' }], error: null })
    const r = await createWbsItemsFromMinute(PROJECT, [row({ source: selection })])
    expect(r).toEqual({ ok: true, items: [{ row: 0, itemId: 'item-0', code: '김철수가' }] })
    const pRows = (rpc.mock.calls[0][1] as { p_rows: Record<string, unknown>[] }).p_rows
    expect(pRows[0].excerpt).toBe(minuteIssueSourceExcerpt(SELECTED))
    expect((pRows[0].excerpt as string).length).toBeLessThanOrEqual(4_000)
    expect(pRows[0]).toMatchObject({
      block_index: 1, block_hash: BLOCKS[1].hash, source_kind: 'manual',
      source_key: makeMinuteIssueSourceKey({ minuteVersionId: VERSION, blockIndex: 1, blockHash: BLOCKS[1].hash, kind: 'manual', selectionHash: minuteSelectionKeyHash(SELECTED) }),
    })
    expect(pRows[0].source_key).toContain(':sel:')
  })

  it('RPC 의 줄 거부 토큰은 그 문구·줄 번호·토큰(code)으로 — WBS_PARENT_LEAF_UNCONFIRMED · detail 1(창이 그 위치를 하위 없는 작업으로 고쳐 확인을 받는다)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'WBS_PARENT_LEAF_UNCONFIRMED', details: '1', code: '23514' } })
    expect(await createWbsItemsFromMinute(PROJECT, ROWS)).toEqual({
      ok: false, error: t('srv.minuteWbs.parentLeafUnconfirmed'), row: 1, code: MINUTE_WBS_LEAF_UNCONFIRMED,
    })
    expect(MINUTE_WBS_LEAF_UNCONFIRMED).toBe('WBS_PARENT_LEAF_UNCONFIRMED')
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
      // 토큰은 code 로도 돌려준다 — 화면이 사유 문구를 해석하지 않고 갈래를 판단한다
      expect(r, message).toEqual(details === null
        ? { ok: false, error: t(key), code: message }
        : { ok: false, error: t(key), row: Number(details), code: message })
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

  it('셋업의 전역 대역이 아니라 진짜 액션을 본다(vi.unmock — tests/setup/minute-wbs-sources.ts)', () => {
    expect(vi.isMockFunction(getWbsItemMinuteSources)).toBe(false)
  })

  it('명단 밖 조회 전용(로그인 + RLS 가 항목을 보여 줌)도 연결을 만든 순서대로 받는다 — 멤버·관리자 가드를 부르지 않는다', async () => {
    m.requireProjectMember.mockResolvedValue({ ok: false, error: ERR_DENIED })   // 명단 없음 — 멤버 가드를 불렀다면 거부됐을 것
    m.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    session = sessionClient({ wbs_item_links: { data: [LINK_ROW] } })
    m.createServerClient.mockResolvedValue(session.client)
    const r = await getWbsItemMinuteSources(ITEM)
    expect(r).toEqual({ ok: true, rows: [{
      linkId: 'link-1', minuteId: 'minute-1', minuteVersionId: 'version-1', minuteVersionNo: 3, minuteTitle: '개발 회의', minuteDate: '2026-10-21',
      bodyHash: BODY_HASH, blockIndex: 1, blockHash: BLOCKS[1].hash, excerpt: '로그인 API 개발', createdAt: '2026-10-21T01:00:00Z',
    }] })
    expect(m.getSession).toHaveBeenCalledTimes(1)
    expect(m.requireProjectMember).not.toHaveBeenCalled()
    expect(m.requireProjectAdmin).not.toHaveBeenCalled()
    expect(m.resolveProjectId).toHaveBeenCalledWith('wbs_items', ITEM)
    expect(requireModule).toHaveBeenCalledWith({ projectId: PROJECT }, 'minutes')
    expect(session.queries.map(q => q.table)).toEqual(['wbs_item_links'])
    expect(session.queries[0].calls).toEqual(expect.arrayContaining([
      ['eq', ['wbs_item_id', ITEM]], ['eq', ['project_id', PROJECT]], ['order', ['created_at', { ascending: true }]],
    ]))
    expect(m.createAdminClient).not.toHaveBeenCalled()
  })

  it('로그인하지 않았으면 거부 — 항목·관문·연결에 닿지 않는다', async () => {
    m.getSession.mockResolvedValue(null)
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: ERR_ANON })
    expect(m.resolveProjectId).not.toHaveBeenCalled()
    expect(requireModule).not.toHaveBeenCalled()
    expect(m.createServerClient).not.toHaveBeenCalled()
  })

  it('세션이 읽지 못하는 항목은 없는 항목과 같은 답(ERR_MISSING) — 존재를 드러내지 않고, 관문·연결에 닿지 않는다', async () => {
    m.resolveProjectId.mockResolvedValue({ ok: false, error: ERR_MISSING, code: 'missing' })   // RLS 가 가린 항목 = 없는 항목
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: ERR_MISSING })
    m.resolveProjectId.mockResolvedValue({ ok: false, error: ERR_LOOKUP, code: 'lookup' })   // 판정 불가는 그 사유 그대로
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: ERR_LOOKUP })
    m.resolveProjectId.mockResolvedValue({ ok: true, projectId: null })
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: ERR_MISSING })
    expect(requireModule).not.toHaveBeenCalled()
    expect(m.createServerClient).not.toHaveBeenCalled()
  })

  it('회의록 모듈이 꺼지면 관문의 거부 그대로(module_disabled — 상세 패널은 이 코드에서 구역을 닫는다), 연결을 읽지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    const r = await getWbsItemMinuteSources(ITEM)
    expect(r).toEqual({ ok: false, error: ERR_MODULE_DISABLED })
    expect(guardCodeOf(r.ok ? null : r)).toBe('module_disabled')
    expect(m.createServerClient).not.toHaveBeenCalled()
  })

  it('uuid 가 아닌 항목 id 는 조회 전에 거부', async () => {
    expect(await getWbsItemMinuteSources('not-a-uuid')).toEqual({ ok: false, error: t('err.invalidRequest') })
    expect(m.resolveProjectId).not.toHaveBeenCalled()
  })

  it('읽기 실패는 sourcesUnavailable(빈 목록으로 그리지 않는다)', async () => {
    m.createServerClient.mockResolvedValue(sessionClient({ wbs_item_links: { error: { message: 'boom' } } }).client)
    expect(await getWbsItemMinuteSources(ITEM)).toEqual({ ok: false, error: t('srv.minuteWbs.sourcesUnavailable') })
  })
})
