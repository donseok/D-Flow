import { actionAreaId } from '../fixtures/issue-areas'
vi.mock('@/lib/issues/context', async () => ({ loadIssueEntryContext: async () => ({ ok: true, value: { ...(await import('../fixtures/issue-areas')).ACTION_ENTRY_CONTEXT, customFields: state.fields } }) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'

const state = vi.hoisted(() => ({
  fields: [] as import('@/lib/domain/customFields').FieldDef[],
  client: undefined as unknown,
  admin: undefined as unknown,
}))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('검증 전 DB 접근 금지')
    return state.client
  }),
}))
const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => {
    if (state.admin === undefined) throw new Error('원문 검증 전 service_role 접근 금지')
    return state.admin
  }),
}))

const { requireProjectMember, requireProjectAdmin, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
const ai = vi.hoisted(() => ({
  generateAnswer: vi.fn(),
  hasLLM: vi.fn(() => true),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, resolveProjectId, getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: ai.generateAnswer }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: ai.hasLLM }))

import { getSession } from '@/lib/auth'
import { matchMinuteSelection, minuteSelectionKeyHash } from '@/lib/minutes/selection'
import {
  createIssueFromMinuteBlock,
  fetchIssueProjectMembers,
  prepareMinuteIssueDraft,
} from '@/app/actions/issues'
import { aiAvailable } from '@/lib/modules/aiAvailable'
import { makeMemberActor, WS } from '../fixtures/actor'
import { ROSTER_SELECT } from '@/lib/data/memberSelect'

const USER = { id: 'user-1', email: 'user@example.com', user_metadata: { name: '홍길동' } } as const
const ACTOR = makeMemberActor('project-1', [], { userId: USER.id })
const BODY = '# 제목\n\n인터페이스 전환 지연 위험을 담당자와 확인한다.'
const BODY_HASH = fnv1a64(BODY)
const BLOCK = splitMinuteBlocks(BODY)[1]
const INPUT = { title: '인터페이스 전환 지연 위험', body: BLOCK.text, severity: 'high' as const, assigneeMemberIds: ['member-1'], startDate: '2026-07-27', dueDate: '2026-08-03', areaId: actionAreaId('02'), analysis: { majorName: '주문관리', subProcess: '수주 등록', ownerDepartment: '영업팀', relatedSystems: ['CRM', 'ERP'], sourceType: 'other' as const, sourceDetail: '주간 영업회의 위험 블록' } }
const SOURCE = {
  minuteId: 'minute-1',
  minuteVersionId: 'version-1',
  bodyHash: BODY_HASH,
  blockIndex: BLOCK.index,
  blockHash: BLOCK.hash,
  kind: 'risk' as const,
}

const MULTI_BODY = [
  '# 주간회의',
  '',
  '첫 번째 문단은 인터페이스 전송 누락 위험을 다룬다.',
  '',
  '- 재처리 여부 확인',
  '- 인터페이스 보완 방안 협의',
].join('\n')
const MULTI_BLOCKS = splitMinuteBlocks(MULTI_BODY)
const MULTI_HASH = fnv1a64(MULTI_BODY)
const SELECTION_RAW = '누락 위험을 다룬다.\n재처리 여부 확인'
const SELECTION_SOURCE = {
  minuteId: 'minute-1',
  minuteVersionId: 'version-1',
  bodyHash: MULTI_HASH,
  blockIndex: MULTI_BLOCKS[1].index,
  blockHash: MULTI_BLOCKS[1].hash,
  kind: 'manual' as const,
  selection: {
    text: SELECTION_RAW,
    endBlockIndex: MULTI_BLOCKS[2].index,
    endBlockHash: MULTI_BLOCKS[2].hash,
  },
}

function aiResponseForAction(title: string): string {
  return JSON.stringify({ title, body: '[현황]\n- 주문 입력을 처리하고 있습니다.\n[문제/영향]\n- 입력 오류와 납기 지연이 발생합니다.\n[필요 조치]\n- 주문 등록 절차 개선이 필요합니다.', areaCode: '02', analysis: { majorName: '주문관리', subProcess: '주문접수/등록', ownerDepartment: '영업팀', relatedSystems: [], sourceDetail: '' } })
}

function clientsWithVersion({
  currentProjectId = 'project-1',
  currentWorkspaceId = WS,
  versionProjectId = 'project-1',
  archivedAt = null,
  body = BODY,
  bodyHash = fnv1a64(body),
  knownMajorProcesses = [
    { area_id: actionAreaId('02'), name: '주문관리' },
    { area_id: actionAreaId('07'), name: '원가관리' },
  ],
  knownSubProcesses = [
    { area_id: actionAreaId('02'), sub_process: '주문접수/등록' },
    { area_id: actionAreaId('07'), sub_process: '원가손익분석' },
  ],
}: {
  currentProjectId?: string | null
  /** 회의록의 워크스페이스 — 프로젝트 없는 회의록은 이것으로만 스코프된다 */
  currentWorkspaceId?: string
  versionProjectId?: string | null
  archivedAt?: string | null
  body?: string
  bodyHash?: string
  knownMajorProcesses?: Array<{ area_id: string; name: string }>
  knownSubProcesses?: Array<{ area_id: string; sub_process: string }>
} = {}) {
  const rpcSingle = vi.fn(async () => ({
    data: { issue_id: 'issue-1', issue_no: 27, code: 'PI-I-02-03' },
    error: null,
  }))
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    void name
    void args
    return { single: rpcSingle }
  })
  const admin = { rpc, rpcSingle }
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'minute_versions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: SOURCE.minuteVersionId,
                    minute_id: SOURCE.minuteId,
                    body_md: body,
                    body_hash: bodyHash,
                    project_id: versionProjectId,
                    title: '영업 PI 주간회의',
                    minute_date: '2026-07-27',
                  },
                  error: null,
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'minutes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  project_id: currentProjectId,
                  archived_at: archivedAt,
                  workspace_id: currentWorkspaceId,
                },
                error: null,
              })),
            })),
          })),
        }
      }
      if (table === 'minute_insights') {
        const query = {
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: vi.fn(async () => ({
            data: { label: '인터페이스 전환 지연 대응 필요' },
            error: null,
          })),
        }
        query.select.mockReturnValue(query)
        query.eq.mockReturnValue(query)
        return query
      }
      if (table === 'issues') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: knownSubProcesses, error: null })),
          })),
        }
      }
      if (table === 'issue_major_processes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                order: vi.fn(async () => ({ data: knownMajorProcesses, error: null })),
              })),
            })),
          })),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    }),
  }
  return { client, admin }
}

/** 이 프로젝트의 멤버 — 회의록 블록에서 이슈를 등록할 수 있는 최소 자격. */
function asMember() {
  requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
  getActor.mockResolvedValue(ACTOR)
}

beforeEach(() => {
  state.fields = []
  state.client = undefined
  state.admin = undefined
  createServerClient.mockClear()
  createAdminClient.mockClear()
  requireProjectMember.mockReset()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
  getActor.mockReset()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'project-1' })
  vi.mocked(getSession).mockReset()
  vi.mocked(getSession).mockResolvedValue(USER as never)
  ai.generateAnswer.mockReset()
  ai.hasLLM.mockReset()
  ai.hasLLM.mockReturnValue(true)
})

describe('prepareMinuteIssueDraft', () => {
  it('프로젝트 역할이 없으면 원문 조회와 AI 호출 전에 거부한다', async () => {
    requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })

    const result = await prepareMinuteIssueDraft('project-1', SOURCE)

    expect(result).toEqual({ ok: false, error: '권한 없음' })
    expect(createServerClient).not.toHaveBeenCalled()
    expect(ai.generateAnswer).not.toHaveBeenCalled()
  })

  it('서버에서 검증한 블록만 AI에 전달하고 구조화된 초안을 반환·캐시한다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client
    ai.generateAnswer.mockResolvedValue(JSON.stringify({ title: '인터페이스 전환 지연 대응', body: '[현황]\n- 인터페이스 전환이 지연되고 있습니다.\n\n[문제/영향]\n- 전환 일정에 차질 위험이 있습니다.\n\n[필요 조치]\n- 담당자와 대응 방안을 확인합니다.', areaCode: '02', analysis: { majorName: '주문관리', subProcess: '주문접수/등록', ownerDepartment: '영업팀', relatedSystems: [], sourceDetail: '' } }))

    const first = await prepareMinuteIssueDraft('project-1', SOURCE)
    const second = await prepareMinuteIssueDraft('project-1', SOURCE)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      ok: true,
      draft: { title: '인터페이스 전환 지연 대응', areaId: actionAreaId('02'), mode: 'ai', analysis: { majorName: '주문관리', subProcess: '주문접수/등록' } },
    })
    expect(ai.generateAnswer).toHaveBeenCalledOnce()
    const [, messages, options] = ai.generateAnswer.mock.calls[0]
    expect(messages[0].content).toContain(BLOCK.text)
    expect(messages[0].content).toContain('영업 PI 주간회의')
    expect(messages[0].content).toContain('상위 섹션')
    expect(messages[0].content).toContain('주문관리')
    expect(messages[0].content).toContain('주문접수/등록')
    expect(options).toMatchObject({
      timeoutMs: 15_000,
      maxOutputTokens: 8_192,
      allowModelFallback: false,
      retries: 0,
      retryRateLimit: false,
    })
  })

  it('AI를 사용할 수 없으면 원문 복사 대신 편집 가능한 결정형 초안을 반환한다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client
    ai.hasLLM.mockReturnValue(false)

    const result = await prepareMinuteIssueDraft('project-1', { ...SOURCE, kind: 'action' })

    expect(result.ok).toBe(true)
    expect(result.draft?.mode).toBe('fallback')
    expect(result.draft?.title).toBe('인터페이스 전환 지연 대응 필요')
    expect(result.draft?.body).toContain('[현황]')
    expect(result.draft?.body).toContain('[문제/영향]')
    expect(result.draft?.body).toContain('[필요 조치]')
    expect(result.draft?.body).not.toBe(BLOCK.text)
    expect(ai.generateAnswer).not.toHaveBeenCalled()
  })

  it('AI 응답이 깨져도 등록을 막지 않고 결정형 초안으로 대체한다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client
    ai.generateAnswer.mockResolvedValue('JSON이 아닌 응답')

    const result = await prepareMinuteIssueDraft('project-1', { ...SOURCE, kind: 'manual' })

    expect(result.ok).toBe(true)
    expect(result.draft?.mode).toBe('fallback')
    expect(result.draft?.body).not.toBe(BLOCK.text)
    expect(ai.generateAnswer).toHaveBeenCalledOnce()
  })

  it('목록 블록의 항목 경계를 보존해 AI 원문으로 전달한다', async () => {
    asMember()
    const body = [
      '- 주문 입력 오류가 반복됩니다.',
      '- 납기 대응이 지연됩니다.',
      '- 주문 등록 절차 개선이 필요합니다.',
    ].join('\n')
    const bodyHash = fnv1a64(body)
    const block = splitMinuteBlocks(body)[0]
    state.client = clientsWithVersion({ body, bodyHash }).client
    ai.generateAnswer.mockResolvedValue(aiResponseForAction('목록 이슈'))

    const result = await prepareMinuteIssueDraft('project-1', {
      ...SOURCE,
      bodyHash,
      blockIndex: block.index,
      blockHash: block.hash,
    })

    expect(result.ok).toBe(true)
    const prompt = ai.generateAnswer.mock.calls[0][1][0].content as string
    const payload = JSON.parse(prompt.split('\n')[1]) as { sourceText: string }
    expect(payload.sourceText).toBe([
      '주문 입력 오류가 반복됩니다.',
      '납기 대응이 지연됩니다.',
      '주문 등록 절차 개선이 필요합니다.',
    ].join('\n'))
  })

  it('긴 블록에서 AI를 사용할 수 없으면 사실을 버린 일반 문구 대신 범위 재선택을 안내한다', async () => {
    asMember()
    const body = `처리 지연 문제가 ${'가'.repeat(21_000)}`
    const bodyHash = fnv1a64(body)
    const block = splitMinuteBlocks(body)[0]
    state.client = clientsWithVersion({ body, bodyHash }).client
    ai.hasLLM.mockReturnValue(false)

    const result = await prepareMinuteIssueDraft('project-1', {
      ...SOURCE,
      bodyHash,
      blockIndex: block.index,
      blockHash: block.hash,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('작은 블록')
    expect(result.draft).toBeUndefined()
  })

  it('프로젝트의 Sub Process 사례가 바뀌면 이전 AI 캐시를 재사용하지 않는다', async () => {
    asMember()
    const firstFixture = clientsWithVersion({
      knownSubProcesses: [{ area_id: actionAreaId('02'), sub_process: '주문접수/등록' }],
    })
    state.client = firstFixture.client
    ai.generateAnswer.mockResolvedValueOnce(JSON.stringify({ title: '첫 분류 기준의 주문 이슈', body: '[현황]\n- 주문 입력을 처리하고 있습니다.\n[문제/영향]\n- 입력 오류가 발생합니다.\n[필요 조치]\n- 등록 절차를 확인해야 합니다.', areaCode: '02', analysis: { majorName: '주문관리', subProcess: '주문접수/등록', ownerDepartment: '영업팀', relatedSystems: [], sourceDetail: '' } }))
    const source = { ...SOURCE, kind: 'action' as const }
    const first = await prepareMinuteIssueDraft('project-1', source)

    const secondFixture = clientsWithVersion({
      knownSubProcesses: [{ area_id: actionAreaId('02'), sub_process: '주문진행관리' }],
    })
    state.client = secondFixture.client
    ai.generateAnswer.mockResolvedValueOnce(JSON.stringify({ title: '변경된 분류 기준의 주문 이슈', body: '[현황]\n- 주문 진행 정보를 관리하고 있습니다.\n[문제/영향]\n- 진행 정보가 부정확합니다.\n[필요 조치]\n- 관리 절차를 확인해야 합니다.', areaCode: '02', analysis: { majorName: '주문관리', subProcess: '주문진행관리', ownerDepartment: '영업팀', relatedSystems: [], sourceDetail: '' } }))
    const second = await prepareMinuteIssueDraft('project-1', source)

    expect(first.draft?.analysis?.subProcess).toBe('주문접수/등록')
    expect(second.draft?.analysis?.subProcess).toBe('주문진행관리')
    expect(ai.generateAnswer).toHaveBeenCalledTimes(2)
  })

  it('체번된 Major Process 사례가 바뀌면 이전 AI 캐시를 재사용하지 않는다', async () => {
    asMember()
    state.client = clientsWithVersion({
      knownMajorProcesses: [{ area_id: actionAreaId('02'), name: '주문관리' }],
    }).client
    ai.generateAnswer.mockResolvedValueOnce(JSON.stringify({ title: '기존 Major 기준의 주문 이슈', body: '[현황]\n- 주문 입력을 처리하고 있습니다.\n[문제/영향]\n- 입력 오류가 발생합니다.\n[필요 조치]\n- 등록 절차를 확인해야 합니다.', areaCode: '02', analysis: { majorName: '주문관리', subProcess: '주문접수/등록', ownerDepartment: '영업팀', relatedSystems: [], sourceDetail: '' } }))
    const source = { ...SOURCE, kind: 'action' as const }
    const first = await prepareMinuteIssueDraft('project-1', source)

    state.client = clientsWithVersion({
      knownMajorProcesses: [{ area_id: actionAreaId('02'), name: '수주관리' }],
    }).client
    ai.generateAnswer.mockResolvedValueOnce(JSON.stringify({ title: '개명된 Major 기준의 주문 이슈', body: '[현황]\n- 수주 정보를 관리하고 있습니다.\n[문제/영향]\n- 수주 정보가 부정확합니다.\n[필요 조치]\n- 관리 절차를 확인해야 합니다.', areaCode: '02', analysis: { majorName: '수주관리', subProcess: '주문접수/등록', ownerDepartment: '영업팀', relatedSystems: [], sourceDetail: '' } }))
    const second = await prepareMinuteIssueDraft('project-1', source)

    expect(first.draft?.analysis?.majorName).toBe('주문관리')
    expect(second.draft?.analysis?.majorName).toBe('수주관리')
    expect(ai.generateAnswer).toHaveBeenCalledTimes(2)
    // 입력 JSON에는 체번 정본 이름이 knownMajorProcesses 로 직렬화돼 재사용을 유도한다.
    const firstPrompt = ai.generateAnswer.mock.calls[0][1][0].content as string
    const firstPayload = JSON.parse(firstPrompt.split('\n')[1]) as {
      knownMajorProcesses: Array<{ areaCode: string; name: string }>
    }
    expect(firstPayload.knownMajorProcesses).toEqual([{ areaCode: '02', name: '주문관리' }])
  })

  it('변조된 블록 앵커는 AI 호출 전에 거부한다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client

    const result = await prepareMinuteIssueDraft('project-1', {
      ...SOURCE,
      kind: 'manual',
      blockHash: '0000000000000000',
    })

    expect(result.ok).toBe(false)
    expect(ai.generateAnswer).not.toHaveBeenCalled()
  })

  it('제목 블록은 이슈 사실로 포장하지 않고 AI 호출 전에 거부한다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client
    const heading = splitMinuteBlocks(BODY)[0]

    const result = await prepareMinuteIssueDraft('project-1', {
      ...SOURCE,
      blockIndex: heading.index,
      blockHash: heading.hash,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('제목이 아닌')
    expect(ai.generateAnswer).not.toHaveBeenCalled()
  })

  it('aiAvailable 이 거짓이면 인스턴스 캐시에 AI 초안이 있어도 결정형 초안이다(Review Focus 4)', async () => {
    asMember()
    state.client = clientsWithVersion().client
    ai.generateAnswer.mockResolvedValue(JSON.stringify({ title: '인터페이스 전환 지연 대응', body: '[현황]\n- 가\n\n[문제/영향]\n- 나\n\n[필요 조치]\n- 다', areaCode: '02', analysis: { majorName: '주문관리', subProcess: '주문접수/등록', ownerDepartment: '영업팀', relatedSystems: [], sourceDetail: '' } }))
    const warm = await prepareMinuteIssueDraft('project-1', SOURCE)
    expect(warm.draft?.mode).toBe('ai')                                   // 캐시에 AI 초안(앞 케이스가 넣었을 수도 있다)
    state.client = clientsWithVersion().client
    ai.hasLLM.mockReturnValue(false)
    const off = await prepareMinuteIssueDraft('project-1', SOURCE)
    expect(off.draft?.mode).toBe('fallback')
    expect(vi.mocked(aiAvailable)).toHaveBeenLastCalledWith({ projectId: 'project-1' }, { module: 'issues' })
  })
})

describe('createIssueFromMinuteBlock', () => {
  it('forwards typed custom values only after source validation to the atomic RPC',async()=>{
    asMember()
    state.fields=[{key:'quantity',label:'수량',description:'',type:'number',required:false,active:true,editable_by:'member',show_in_list:false,searchable:false,sort:0}]
    const fixture=clientsWithVersion();state.client=fixture.client;state.admin=fixture.admin
    expect(await createIssueFromMinuteBlock('project-1',{...INPUT,custom:{quantity:0}},SOURCE)).toMatchObject({ok:true})
    expect(fixture.admin.rpc).toHaveBeenCalledWith('create_issue_from_minute_block',expect.objectContaining({p_custom:{quantity:0},p_actor_id:USER.id,p_block_hash:BLOCK.hash}))
  })
  it('rejects explicit admin custom input before source and service access but allows omitted required default',async()=>{
    asMember()
    state.fields=[{key:'approved',label:'승인',description:'',type:'boolean',required:true,default:false,active:true,editable_by:'admin',show_in_list:false,searchable:false,sort:0}]
    expect(await createIssueFromMinuteBlock('project-1',{...INPUT,custom:{approved:false}},SOURCE)).toMatchObject({ok:false})
    expect(createAdminClient).not.toHaveBeenCalled();expect(createServerClient).not.toHaveBeenCalled()
    const fixture=clientsWithVersion();state.client=fixture.client;state.admin=fixture.admin
    expect(await createIssueFromMinuteBlock('project-1',{...INPUT,custom:{}},SOURCE)).toMatchObject({ok:true})
    expect(fixture.admin.rpc).toHaveBeenCalledWith('create_issue_from_minute_block',expect.objectContaining({p_custom:{}}))
  })

  it('프로젝트 역할이 없는 사용자는 DB에 접근하기 전에 거부한다', async () => {
    requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)
    expect(result).toMatchObject({ ok: false, error: '권한 없음' })
    expect(requireProjectMember).toHaveBeenCalledWith('project-1')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('분석 없는 회의록 이슈는 새 RPC의 분석 인자 여섯을 모두 null로 보낸다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client; state.admin = fixture.admin
    const result = await createIssueFromMinuteBlock('project-1', { ...INPUT, areaId: null, analysis: null }, SOURCE)
    expect(result).toEqual({ ok: true, issueId: 'issue-1', code: 'PI-I-02-03' })
    const args = fixture.admin.rpc.mock.calls[0][1]
    expect(args).not.toHaveProperty('p_mega_code')
    expect(args).toMatchObject({ p_area_id: null, p_major_name: null, p_sub_process: null, p_owner_department: null,
      p_related_systems: null, p_source_type: null, p_source_detail: null, p_actor_id: ACTOR.userId })
  })

  it('서버가 불변 원문을 재검증하고 원자 생성 RPC를 호출한다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result).toEqual({
      ok: true,
      issueId: 'issue-1',

      code: 'PI-I-02-03',
    })
    expect(fixture.admin.rpc).toHaveBeenCalledWith('create_issue_from_minute_block', expect.objectContaining({
      p_project_id: 'project-1',
      p_actor_id: USER.id,
      p_minute_id: SOURCE.minuteId,
      p_minute_version_id: SOURCE.minuteVersionId,
      p_body_hash: BODY_HASH,
      p_block_index: BLOCK.index,
      p_block_hash: BLOCK.hash,
      p_excerpt_snapshot: BLOCK.text,
      p_source_kind: 'risk',
      p_start_date: '2026-07-27',
      p_due_date: '2026-08-03',
      p_area_id: actionAreaId('02'),
      p_major_name: '주문관리',
      p_sub_process: '수주 등록',
      p_owner_department: '영업팀',
      p_related_systems: ['CRM', 'ERP'],
      p_source_type: 'minutes',
      p_source_detail: '주간 영업회의 위험 블록',
    }))
  })

  it('현재 회의록 프로젝트와 대상 프로젝트가 다르면 생성하지 않는다', async () => {
    asMember()
    const fixture = clientsWithVersion({ currentProjectId: 'other-project' })
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result.ok).toBe(false)
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  // 프로젝트 없는 회의록은 워크스페이스로만 스코프된다 — 두 워크스페이스 사용자가 A 의 회의록 발췌를 B 프로젝트 이슈로 옮기면
  // B 에만 속한 사람도 그 발췌를 읽는다(SP2 최종 리뷰 ISO-6·AUTHZ-3, 0009 issue_links 트리거가 DB 에서도 막는다).
  it('프로젝트 없는 회의록이 다른 워크스페이스 것이면 생성하지 않는다(RPC 호출 전)', async () => {
    asMember()
    const fixture = clientsWithVersion({ currentProjectId: null, currentWorkspaceId: 'ws-other' })
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result).toEqual({ ok: false, error: '다른 워크스페이스의 회의록으로는 이 프로젝트의 이슈를 만들 수 없습니다.' })
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  it('프로젝트 없는 회의록이 같은 워크스페이스 것이면 만든다', async () => {
    asMember()
    const fixture = clientsWithVersion({ currentProjectId: null, currentWorkspaceId: WS })
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result.ok).toBe(true)
    expect(fixture.admin.rpc).toHaveBeenCalledOnce()
  })

  it('초안 생성도 같은 판정 — 다른 워크스페이스의 프로젝트 없는 회의록 발췌를 AI 에 보내지 않는다', async () => {
    asMember()
    const fixture = clientsWithVersion({ currentProjectId: null, currentWorkspaceId: 'ws-other' })
    state.client = fixture.client

    const result = await prepareMinuteIssueDraft('project-1', SOURCE)

    expect(result.ok).toBe(false)
    expect(ai.generateAnswer).not.toHaveBeenCalled()
  })

  it('긴 원문 근거는 생략부호 없이 전체 원문 링크 안내를 붙여 저장한다', async () => {
    asMember()
    const body = `주문 처리 지연 문제 ${'가'.repeat(5_000)}`
    const bodyHash = fnv1a64(body)
    const block = splitMinuteBlocks(body)[0]
    const fixture = clientsWithVersion({ body, bodyHash })
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SOURCE,
      bodyHash,
      blockIndex: block.index,
      blockHash: block.hash,
    })

    expect(result.ok).toBe(true)
    const excerpt = fixture.admin.rpc.mock.calls[0][1].p_excerpt_snapshot as string
    expect(excerpt.length).toBeLessThanOrEqual(4_000)
    expect(excerpt).toContain('[전체 내용은 연결된 회의록 원문에서 확인]')
    expect(excerpt).not.toContain('…')
  })

  it('회의록을 옮긴 뒤에도 과거 버전 프로젝트는 출처 스냅샷으로만 취급한다', async () => {
    asMember()
    const fixture = clientsWithVersion({
      currentProjectId: 'project-1',
      versionProjectId: 'old-project',
    })
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result.ok).toBe(true)
    expect(fixture.admin.rpc).toHaveBeenCalledOnce()
  })

  it('보관된 회의록에서는 생성하지 않는다', async () => {
    asMember()
    const fixture = clientsWithVersion({ archivedAt: '2026-07-27T00:00:00Z' })
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result.ok).toBe(false)
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  it('클라이언트가 조작한 블록 해시는 생성 전에 거부한다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SOURCE,
      blockHash: '0000000000000000',
    })

    expect(result.ok).toBe(false)
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })
})

describe('드래그 선택 이슈 등록', () => {
  const expectedMatch = matchMinuteSelection(
    MULTI_BLOCKS, 1, MULTI_BLOCKS[1].hash, 2, MULTI_BLOCKS[2].hash, SELECTION_RAW,
  )

  it('검증된 선택 발췌를 excerpt·:sel: source_key로 저장한다', async () => {
    asMember()
    const fixture = clientsWithVersion({ body: MULTI_BODY })
    state.client = fixture.client
    state.admin = fixture.admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, SELECTION_SOURCE)

    expect(res.ok).toBe(true)
    expect(expectedMatch.ok).toBe(true)
    if (!expectedMatch.ok) return
    const rpcArgs = fixture.admin.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(rpcArgs.p_excerpt_snapshot).toBe(expectedMatch.excerpt)
    expect(rpcArgs.p_block_index).toBe(1)
    expect(rpcArgs.p_source_kind).toBe('manual')
    expect(rpcArgs.p_source_key).toBe(
      `minute:version-1:1:${MULTI_BLOCKS[1].hash}:manual:sel:${minuteSelectionKeyHash(expectedMatch.excerpt)}`,
    )
  })

  it('원문에 없는 선택 텍스트는 fail-closed로 거절하고 RPC를 호출하지 않는다', async () => {
    asMember()
    const fixture = clientsWithVersion({ body: MULTI_BODY })
    state.client = fixture.client
    state.admin = fixture.admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      selection: { ...SELECTION_SOURCE.selection, text: '원문에 없는 문장이다' },
    })

    expect(res.ok).toBe(false)
    expect(res.error).toContain('선택 영역을 회의록 원문과 대조하지 못했습니다')
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  it('selection이 있는데 kind가 manual이 아니면 형식 오류로 거절한다', async () => {
    asMember()
    const fixture = clientsWithVersion({ body: MULTI_BODY })
    state.client = fixture.client
    state.admin = fixture.admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      kind: 'risk' as const,
    })

    expect(res.ok).toBe(false)
    expect(res.error).toContain('회의록 원문 정보가 올바르지 않습니다')
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  it('제목(heading)만의 선택은 거절한다', async () => {
    asMember()
    const fixture = clientsWithVersion({ body: MULTI_BODY })
    state.client = fixture.client
    state.admin = fixture.admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      blockIndex: MULTI_BLOCKS[0].index,
      blockHash: MULTI_BLOCKS[0].hash,
      selection: { text: '주간회의', endBlockIndex: 0, endBlockHash: MULTI_BLOCKS[0].hash },
    })

    expect(res.ok).toBe(false)
    expect(res.error).toContain('제목이 아닌 실제 이슈 내용')
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  it('prepare는 선택 발췌를 AI 원문으로 쓰고 범위 블록 원문을 컨텍스트에 담는다', async () => {
    asMember()
    const fixture = clientsWithVersion({ body: MULTI_BODY })
    state.client = fixture.client
    ai.generateAnswer.mockResolvedValue(aiResponseForAction('선택 발췌 제목'))

    const res = await prepareMinuteIssueDraft('project-1', SELECTION_SOURCE)

    expect(res.ok).toBe(true)
    expect(expectedMatch.ok).toBe(true)
    if (!expectedMatch.ok) return
    const prompt = ai.generateAnswer.mock.calls[0][1][0].content as string
    const payload = JSON.parse(prompt.split('\n')[1]) as { sourceText: string; contextText: string }
    expect(payload.sourceText).toBe(expectedMatch.excerpt)
    expect(payload.contextText).toContain('선택 범위 블록 원문')
    expect(payload.contextText).toContain('인터페이스 보완 방안 협의')
  })

  it('시작 블록 안에서 끝나는 선택이 끝 블록을 부풀려 주장하면 거절한다', async () => {
    asMember()
    const fixture = clientsWithVersion({ body: MULTI_BODY })
    state.client = fixture.client
    state.admin = fixture.admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      selection: { ...SELECTION_SOURCE.selection, text: '전송 누락 위험' },
    })

    expect(res.ok).toBe(false)
    expect(res.error).toContain('선택 영역을 회의록 원문과 대조하지 못했습니다')
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  it('selection이 null 이면 500 없이 블록 흐름으로 처리한다', async () => {
    asMember()
    const fixture = clientsWithVersion({ body: MULTI_BODY })
    state.client = fixture.client
    state.admin = fixture.admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      selection: null as never,
    })

    expect(res.ok).toBe(true)
    const rpcArgs = fixture.admin.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(rpcArgs.p_excerpt_snapshot).toBe(MULTI_BLOCKS[1].text)
    expect(String(rpcArgs.p_source_key)).not.toContain(':sel:')
  })

  it('상한 초과 선택은 형식 오류가 아니라 범위 축소 안내 문구로 거절한다', async () => {
    asMember()
    const fixture = clientsWithVersion({ body: MULTI_BODY })
    state.client = fixture.client
    state.admin = fixture.admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      selection: { ...SELECTION_SOURCE.selection, text: '가'.repeat(20_001) },
    })

    expect(res.ok).toBe(false)
    expect(res.error).toContain('선택 범위가 너무 큽니다')
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  it('4,000자 캡은 저장 발췌만 자르고 source_key 해시는 전문 기준을 유지한다', async () => {
    asMember()
    const longBody = `장애 대응 지연 문제 ${'상세 '.repeat(1_500)}종결.`
    const longBlocks = splitMinuteBlocks(longBody)
    const longHash = fnv1a64(longBody)
    const fixture = clientsWithVersion({ body: longBody, bodyHash: longHash })
    state.client = fixture.client
    state.admin = fixture.admin

    const res = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SELECTION_SOURCE,
      bodyHash: longHash,
      blockIndex: longBlocks[0].index,
      blockHash: longBlocks[0].hash,
      selection: { text: longBody, endBlockIndex: 0, endBlockHash: longBlocks[0].hash },
    })

    expect(res.ok).toBe(true)
    const rpcArgs = fixture.admin.rpc.mock.calls[0][1] as Record<string, unknown>
    const storedExcerpt = String(rpcArgs.p_excerpt_snapshot)
    expect(storedExcerpt.length).toBeLessThanOrEqual(4_000)
    expect(storedExcerpt).toContain('[전체 내용은 연결된 회의록 원문에서 확인]')
    // 해시는 절단 전 전체 발췌(서버 재구성본) 기준 — 캡 이후로 바뀌면 조회 키가 흔들린다.
    const fullMatch = matchMinuteSelection(
      longBlocks, 0, longBlocks[0].hash, 0, longBlocks[0].hash, longBody,
    )
    expect(fullMatch.ok).toBe(true)
    if (!fullMatch.ok) return
    expect(String(rpcArgs.p_source_key)).toContain(`:sel:${minuteSelectionKeyHash(fullMatch.excerpt)}`)
  })
})

describe('fetchIssueProjectMembers', () => {
  it('조회 실패를 정상적인 빈 담당자 목록과 구분한다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    asMember()
    state.client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: null,
              error: { message: 'temporary failure' },
            })),
          })),
        })),
      })),
    }

    const result = await fetchIssueProjectMembers('project-1')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('담당자 목록')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('성공 경로는 명단 정본(ROSTER_SELECT)으로 읽어 매퍼로 편다 — people 임베드·팀 배열·가나다순', async () => {
    asMember()
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(async () => ({
          data: [
            {
              id: 'm2', project_id: 'project-1', person_id: 'pe-2', access_role: null, role_label: null, title: null,
              active: true, sort_order: 0, created_at: '2026-09-01T00:00:00Z',
              people: { display_name: '나외주', email: null, user_id: null, kind: 'external', active: true },
              project_member_teams: [],
            },
            {
              id: 'm1', project_id: 'project-1', person_id: 'pe-1', access_role: 'admin', role_label: 'PM', title: null,
              active: true, sort_order: 0, created_at: '2026-09-02T00:00:00Z',
              people: { display_name: '가관리', email: 'alice@example.com', user_id: 'u1', kind: 'account', active: true },
              project_member_teams: [{ team_id: 't1', is_primary: true, teams: { id: 't1', code: 'ERP', name: 'ERP' } }],
            },
          ],
          error: null,
        })),
      })),
    }))
    state.client = { from: vi.fn(() => ({ select })) }

    const result = await fetchIssueProjectMembers('project-1')

    expect(select).toHaveBeenCalledWith(ROSTER_SELECT)
    expect(result.ok).toBe(true)
    expect(result.members?.map(m => [m.id, m.name, m.accessRole, m.teams[0]?.code ?? null, m.hasAccount])).toEqual([
      ['m1', '가관리', 'admin', 'ERP', true],
      ['m2', '나외주', null, null, false],
    ])
  })
})
