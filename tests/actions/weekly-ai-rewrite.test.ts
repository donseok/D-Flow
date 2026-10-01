import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  requireProjectAdmin: vi.fn(),
  createServerClient: vi.fn(),
  generateAnswer: vi.fn(),
  hasLLM: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember,
  requireProjectAdmin: mocks.requireProjectAdmin,
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: mocks.generateAnswer }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: mocks.hasLLM }))
vi.mock('@/lib/data/weeklySheet', () => ({
  findCarryOverSource: vi.fn(),
  getWeeklySheet: vi.fn(),
}))

import { prepareWeeklyCellRewrite, type WeeklyRewriteInput } from '@/app/actions/weekly'
import { aiAvailable } from '@/lib/modules/aiAvailable'
import { makeMemberActor } from '../fixtures/actor'

const MEMBER = makeMemberActor('p1', [])

function query(result: { data: unknown; error: null | { message: string } }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'eq']) chain[method] = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve)
  return chain
}

const A_EXP = '00000000-0000-0000-7e57-0000000018b1'
const A_DATA = '00000000-0000-0000-7e57-0000000018b2'

function weeklyClient({
  scopeRows = [{ id: 'r1', area_id: A_EXP }],
  areaRows = [{ id: A_EXP, name: '실험', active: true }, { id: A_DATA, name: '데이터', active: false }],
  scopeError = null,
  areaError = null,
}: {
  scopeRows?: { id: string; area_id: string }[]
  areaRows?: { id: string; name: string; active: boolean }[]
  scopeError?: { message: string } | null
  areaError?: { message: string } | null
} = {}) {
  let call = 0
  const scope = query({ data: scopeRows, error: scopeError })
  const areas = query({ data: areaRows, error: areaError })
  const from = vi.fn((table: string) => {
    call += 1
    if (call === 1 && table === 'weekly_report_rows') return scope
    if (call === 2 && table === 'project_areas') return areas
    throw new Error(`AI 미리보기에서 추가 DB 접근 금지: ${call}:${table}`)
  })
  return { from, scope, areas }
}

const input = (over: Partial<WeeklyRewriteInput> = {}): WeeklyRewriteInput => ({
  rowId: 'r1', cellKey: 'this_content', content: 'FIN-21 전환을 80% 완료함', ...over,
})

beforeEach(() => {
  mocks.requireProjectMember.mockReset()
  mocks.requireProjectAdmin.mockReset()
  mocks.createServerClient.mockReset()
  mocks.generateAnswer.mockReset()
  mocks.hasLLM.mockReset()
  mocks.revalidatePath.mockReset()
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: MEMBER })
  mocks.hasLLM.mockReturnValue(true)
})

describe('prepareWeeklyCellRewrite', () => {
  it('프로젝트 멤버가 아니면 DB와 AI에 접근하지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await prepareWeeklyCellRewrite('p1', [input()])).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.createServerClient).not.toHaveBeenCalled()
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it.each([
    ['빈 선택', []],
    ['잘못된 셀 키', [input({ cellKey: 'section' as never })]],
    ['빈 내용', [input({ content: '   ' })]],
    ['중복 셀', [input(), input()]],
    ['40개 초과', Array.from({ length: 41 }, (_, i) => input({ rowId: `r${i}` }))],
    ['전체 길이 초과', [
      input({ rowId: 'r1', content: '가'.repeat(3_001) }),
      input({ rowId: 'r2', content: '나'.repeat(3_000) }),
    ]],
  ])('%s 입력은 DB·AI 호출 전에 거부한다', async (_name, inputs) => {
    const result = await prepareWeeklyCellRewrite('p1', inputs)
    expect(result.ok).toBe(false)
    expect(mocks.createServerClient).not.toHaveBeenCalled()
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('다른 프로젝트 또는 삭제된 행이 포함되면 AI 호출 전에 중단한다', async () => {
    const client = weeklyClient({ scopeRows: [] })
    mocks.createServerClient.mockResolvedValue(client as never)
    const result = await prepareWeeklyCellRewrite('p1', [input()])
    expect(result).toEqual({ ok: false, error: '선택한 셀을 확인할 수 없습니다.' })
    expect(client.from).toHaveBeenCalledTimes(1)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('AI가 없거나 응답이 실패·훼손되면 원문을 저장하지 않고 명시적으로 실패한다', async () => {
    const client = weeklyClient()
    mocks.createServerClient.mockResolvedValue(client as never)
    mocks.hasLLM.mockReturnValue(false)
    expect((await prepareWeeklyCellRewrite('p1', [input()])).ok).toBe(false)
    expect(mocks.generateAnswer).not.toHaveBeenCalled()

    mocks.createServerClient.mockResolvedValue(weeklyClient() as never)
    mocks.hasLLM.mockReturnValue(true)
    mocks.generateAnswer.mockResolvedValue(JSON.stringify({
      cells: [{ id: 'c0', content: '전환을 완료했습니다.' }],
    }))
    const damaged = await prepareWeeklyCellRewrite('p1', [input()])
    expect(damaged).toEqual({ ok: false, error: 'AI 응답을 확인하지 못했습니다. 원문은 변경되지 않았습니다.' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('현재 로컬 내용을 가상 ID로 한 번만 요청하고 제안만 반환한다 — 라벨은 행의 영역 이름', async () => {
    const client = weeklyClient({ scopeRows: [{ id: 'r1', area_id: A_EXP }, { id: 'r2', area_id: A_DATA }] })
    mocks.createServerClient.mockResolvedValue(client as never)
    mocks.generateAnswer.mockResolvedValue(JSON.stringify({ cells: [
      { id: 'c0', content: 'FIN-21 전환을 80% 완료했습니다.' },
      { id: 'c1', content: 'MM-3 검증을 2건 완료했습니다.' },
    ] }))
    const inputs = [
      input(),
      input({ rowId: 'r2', cellKey: 'this_issue', content: 'MM-3 검증 2건 완료함' }),
    ]

    const result = await prepareWeeklyCellRewrite('p-success', inputs)

    expect(result).toEqual({ ok: true, edits: [
      { ...inputs[0], original: inputs[0].content, content: 'FIN-21 전환을 80% 완료했습니다.' },
      { ...inputs[1], original: inputs[1].content, content: 'MM-3 검증을 2건 완료했습니다.' },
    ] })
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(1)
    const [system, messages, options] = mocks.generateAnswer.mock.calls[0]
    expect(system).toContain('한국어 프로젝트 주간업무 보고서 편집자')
    expect(JSON.parse(messages[0].content)).toEqual({ cells: [
      { id: 'c0', section: '실험', field: '금주실적 내용', content: inputs[0].content },
      { id: 'c1', section: '데이터 (비활성)', field: '금주 이슈·이벤트', content: inputs[1].content },
    ] })
    expect(options).toEqual({
      timeoutMs: 15_000,
      maxOutputTokens: 8_192,
      allowModelFallback: false,
      retries: 0,
      retryRateLimit: false,
    })
    expect(client.from).toHaveBeenCalledTimes(2)
    expect(client.scope.select).toHaveBeenCalledWith('id, area_id')
    expect(client.scope.eq).toHaveBeenCalledWith('project_id', 'p-success')
    expect(client.areas.select).toHaveBeenCalledWith('id, name, active')
    expect(client.areas.eq).toHaveBeenCalledWith('project_id', 'p-success')
    expect(client.areas.eq).toHaveBeenCalledWith('kind', 'weekly_section')
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('사용자·프로젝트별 연속 AI 호출을 짧게 제한한다', async () => {
    mocks.createServerClient.mockImplementation(async () => weeklyClient() as never)
    mocks.generateAnswer.mockResolvedValue(JSON.stringify({ cells: [
      { id: 'c0', content: 'FIN-21 전환을 80% 완료했습니다.' },
    ] }))

    expect((await prepareWeeklyCellRewrite('p-rate', [input()])).ok).toBe(true)
    const limited = await prepareWeeklyCellRewrite('p-rate', [input({ content: 'FIN-21 전환을 80% 점검함' })])
    expect(limited).toEqual({ ok: false, error: 'AI 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.' })
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(1)
  })

  it('AI 판정은 aiAvailable({ projectId }, { module: weekly }) 이다(D17) — 거짓이면 AI 를 부르지 않는다', async () => {
    mocks.createServerClient.mockResolvedValue(weeklyClient() as never)
    mocks.hasLLM.mockReturnValue(false)
    // 거부 사유까지 고정한다 — ok:false 만 보면 앞 케이스가 남긴 쿨다운('너무 빠릅니다')으로도 초록이다
    expect(await prepareWeeklyCellRewrite('p1', [input()])).toEqual({ ok: false, error: 'AI 를 사용할 수 없습니다. 관리자에게 AI 설정을 요청해 주세요.' })
    expect(vi.mocked(aiAvailable)).toHaveBeenLastCalledWith({ projectId: 'p1' }, { module: 'weekly' })
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
  })

  it('영역 조회가 실패하면 AI 를 부르지 않고 중단한다 — 원문을 싣지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.createServerClient.mockResolvedValue(weeklyClient({ areaError: { message: 'relation secret_areas' } }) as never)
    const result = await prepareWeeklyCellRewrite('p-areas', [input()])
    expect(result).toEqual({ ok: false, error: '선택한 셀을 확인할 수 없습니다.' })
    expect(JSON.stringify(result)).not.toContain('secret_areas')
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
