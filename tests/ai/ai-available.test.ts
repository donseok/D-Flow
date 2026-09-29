// aiAvailable(D17, 정본 §5.4.5, 판정 P9) — 세 조건의 조합, 스코프 네 모양, hasLLM 거짓이면 읽지 않음, 실패는 false + 로그.
// 전역 셋업이 이 모듈을 mock 하므로 진짜는 importActual 로 쓴다.
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ hasLLM: vi.fn(), getWorkspaceConfig: vi.fn(), getProjectConfig: vi.fn(), effectiveModules: vi.fn(), getActor: vi.fn(), createServerClient: vi.fn() }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: m.hasLLM }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: m.effectiveModules }))
vi.mock('@/lib/authz', () => ({ getActor: m.getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
import { codeLines, walk } from '../invariants/_walk'
import { makeActor } from '../fixtures/actor'
const { aiAvailable } = await vi.importActual<typeof import('@/lib/modules/aiAvailable')>('@/lib/modules/aiAvailable')

const WID = '00000000-0000-0000-7e57-000000001411', PID = '00000000-0000-0000-7e57-000000001412', MID = '00000000-0000-0000-7e57-000000001413'
const WID2 = '00000000-0000-0000-7e57-000000001414'
const ws = (ai: boolean) => ({ workspaceId: WID, keys: { 'ai.enabled': { status: 'set', value: ai } } })
const client = { from: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  m.hasLLM.mockReturnValue(true)
  m.getWorkspaceConfig.mockResolvedValue(ws(true))
  m.getProjectConfig.mockResolvedValue({ projectId: PID, workspaceId: WID })
  m.effectiveModules.mockResolvedValue(new Set(['weekly', 'issues']))
})
afterEach(() => { vi.restoreAllMocks() })   // console.error spy — 뒤 케이스의 로그를 삼키지 않게
/** 회의록 행 조회 하나를 흉내 낸다(select → eq → maybeSingle) */
const minuteClient = (row: { workspace_id: string; project_id: string | null } | null) => {
  const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => ({ data: row, error: null })
  return { from: vi.fn(() => b) }
}

describe('aiAvailable — 조합', () => {
  it.each([
    [true, true, 'weekly', true], [true, true, 'wiki', false], [true, false, 'weekly', false], [true, false, undefined, false],
    [false, true, 'weekly', false], [false, false, undefined, false], [true, true, undefined, true], [false, true, undefined, false],
  ] as const)('hasLLM=%s ai.enabled=%s module=%s → %s', async (llm, ai, module, expected) => {
    m.hasLLM.mockReturnValue(llm); m.getWorkspaceConfig.mockResolvedValue(ws(ai))
    expect(await aiAvailable({ workspaceId: WID, projectId: PID }, { module })).toBe(expected)
  })
  it('hasLLM 이 거짓이면 설정을 하나도 읽지 않는다(키 없는 배포의 비용 0)', async () => {
    m.hasLLM.mockReturnValue(false)
    expect(await aiAvailable({ projectId: PID }, { module: 'weekly' })).toBe(false)
    expect(m.getWorkspaceConfig).not.toHaveBeenCalled(); expect(m.getProjectConfig).not.toHaveBeenCalled(); expect(m.effectiveModules).not.toHaveBeenCalled()
  })
  it('module 이 없으면 effectiveModules 를 부르지 않는다(주간 브리핑 — 모듈 없는 AI)', async () => {
    expect(await aiAvailable({ workspaceId: WID })).toBe(true)
    expect(m.effectiveModules).not.toHaveBeenCalled()
  })
  it('판정 실패는 false 와 [aiAvailable] 로그(결정형 폴백 — 표시=로깅)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getWorkspaceConfig.mockRejectedValue(new Error('down'))
    expect(await aiAvailable({ workspaceId: WID }, { module: 'weekly' })).toBe(false)
    expect(err.mock.calls[0][0]).toBe('[aiAvailable]')
  })
  it.each([
    ['동적 사용', { digest: 'DYNAMIC_SERVER_USAGE' }],
    ['notFound', { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }],
    ['redirect', { digest: 'NEXT_REDIRECT;replace;/login;307;' }],
  ])('Next 제어 흐름 신호(%s)는 false 로 삼키지 않고 다시 던진다 — 설정 조회에서도, 행위자 조회에서도', async (_n, sig) => {
    const signal = Object.assign(new Error('signal'), sig)
    m.getWorkspaceConfig.mockRejectedValueOnce(signal)
    await expect(aiAvailable({ workspaceId: WID }, { module: 'weekly' })).rejects.toBe(signal)
    m.getActor.mockRejectedValueOnce(signal)
    await expect(aiAvailable(null, { module: 'chatbot' })).rejects.toBe(signal)
  })
})

describe('aiAvailable — 스코프 네 모양', () => {
  it('{ projectId } — 해석기의 workspaceId 로, client 를 넘긴다 — 읽은 프로젝트 설정도 넘겨 다시 읽지 않는다(P27)', async () => {
    expect(await aiAvailable({ projectId: PID }, { module: 'issues', client })).toBe(true)
    expect(m.getProjectConfig).toHaveBeenCalledWith(PID, { client })
    expect(m.getWorkspaceConfig).toHaveBeenCalledWith(WID, { client })
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID, projectId: PID }, { client, projectConfig: { projectId: PID, workspaceId: WID } })
    expect(m.getProjectConfig).toHaveBeenCalledTimes(1)
  })
  it('{ minuteId } — 회의록 행의 워크스페이스·프로젝트(넘긴 client 로 읽는다)', async () => {
    const row = { workspace_id: WID, project_id: null }
    const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => ({ data: row, error: null })
    const c = { from: vi.fn(() => b) }
    m.effectiveModules.mockResolvedValue(new Set(['minutes']))
    expect(await aiAvailable({ minuteId: MID }, { module: 'minutes', client: c as never })).toBe(true)   // 가짜 클라이언트 — ConfigReadClient 가 아니다(TS2322)
    expect(c.from).toHaveBeenCalledWith('minutes')
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID }, { client: c })
  })
  it('{ minuteId } 행이 없으면 false 와 [aiAvailable] 로그', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await aiAvailable({ minuteId: MID }, { module: 'minutes', client: minuteClient(null) as never })).toBe(false)
    expect(err.mock.calls[0][0]).toBe('[aiAvailable]')
  })
  it('{ minuteId } 행 조회가 실패하면 false 와 그 원인을 로그에 — "행 없음"으로 위장하지 않는다(에러 처리 원칙 1)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => ({ data: null, error: { message: 'boom' } })
    expect(await aiAvailable({ minuteId: MID }, { module: 'minutes', client: { from: () => b } as never })).toBe(false)
    expect(err.mock.calls[0][0]).toBe('[aiAvailable]')
    expect(err.mock.calls[0].join(' ')).toContain('회의록 범위 조회 실패: boom')
  })
  it('{ minuteId } 에 client 가 없으면 세션 클라이언트로 행을 읽고, 행의 프로젝트까지 범위에 싣는다(프로젝트 층 모듈)', async () => {
    const c = minuteClient({ workspace_id: WID, project_id: PID })
    m.createServerClient.mockResolvedValue(c)
    expect(await aiAvailable({ minuteId: MID }, { module: 'issues' })).toBe(true)
    expect(m.createServerClient).toHaveBeenCalledTimes(1)
    expect(c.from).toHaveBeenCalledWith('minutes')
    expect(m.effectiveModules.mock.calls[0][0]).toEqual({ workspaceId: WID, projectId: PID })
  })
  it('{ minuteId } + 워크스페이스 층 모듈(minutes)은 행에 프로젝트가 있어도 워크스페이스로만 판정한다 — 무관한 프로젝트 설정을 읽지 않는다(T8-4)', async () => {
    const c = minuteClient({ workspace_id: WID, project_id: PID })
    m.effectiveModules.mockResolvedValue(new Set(['minutes']))
    expect(await aiAvailable({ minuteId: MID }, { module: 'minutes', client: c as never })).toBe(true)
    expect(m.effectiveModules).toHaveBeenCalledWith({ workspaceId: WID }, { client: c })
    expect(m.getProjectConfig).not.toHaveBeenCalled()
  })
  it('null — 세션 행위자의 유일 워크스페이스, 없으면 false 와 [aiAvailable] 로그', async () => {
    m.getActor.mockResolvedValueOnce(makeActor({ userId: 'u', workspaceRoles: new Map([[WID, 'member']]) }))
    m.effectiveModules.mockResolvedValue(new Set(['chatbot']))
    expect(await aiAvailable(null, { module: 'chatbot' })).toBe(true)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getActor.mockResolvedValueOnce(makeActor({ userId: 'u', workspaceRoles: new Map() }))
    expect(await aiAvailable(null, { module: 'chatbot' })).toBe(false)
    expect(err.mock.calls[0][0]).toBe('[aiAvailable]')
  })
  it('null — 소속이 둘 이상이면 false, 어느 워크스페이스의 설정도 읽지 않는다(첫 워크스페이스로 판정하면 AI 를 끈 곳의 데이터가 LLM 으로 간다, P13)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getActor.mockResolvedValueOnce(makeActor({ userId: 'u', workspaceRoles: new Map([[WID2, 'member'], [WID, 'admin']]) }))
    m.effectiveModules.mockResolvedValue(new Set(['chatbot']))
    expect(await aiAvailable(null, { module: 'chatbot' })).toBe(false)
    expect(m.getWorkspaceConfig).not.toHaveBeenCalled()
    expect(m.effectiveModules).not.toHaveBeenCalled()
    expect(err.mock.calls[0][0]).toBe('[aiAvailable]')
  })
})

describe('정적 — hasLLM() 직접 호출(D17)', () => {
  const EXCEPT = ['src/lib/ai/provider.ts', 'src/lib/ai/health.ts', 'src/lib/modules/aiAvailable.ts']
  it('예외 3파일(정의·배포 진단·판정 함수) 밖에서 hasLLM( 호출이 0건(주석 제외 — codeLines)', () => {
    const hits = walk('src').flatMap((f) => {
      const rel = relative(process.cwd(), f)
      if (EXCEPT.includes(rel)) return []
      // 옵셔널 호출(hasLLM?.())·네임스페이스 호출(p.hasLLM())도 본다
      return codeLines(readFileSync(f, 'utf8'), f).flatMap((l, i) => (/\bhasLLM\s*(\?\.)?\s*\(/.test(l) ? [`${rel}:${i + 1}: ${l.trim()}`] : []))
    })
    expect(hits, 'AI 판정은 aiAvailable 로 — ai.enabled 와 모듈을 함께 본다').toEqual([])
  })
  it('예외 3파일 밖에서 provider 의 hasLLM 을 가져오지 않는다 — 별칭(as)·여러 줄 import·재수출까지(호출 줄만 보면 별칭 호출이 샌다)', () => {
    const hits = walk('src').flatMap((f) => {
      const rel = relative(process.cwd(), f)
      if (EXCEPT.includes(rel)) return []
      const code = codeLines(readFileSync(f, 'utf8'), f).join('\n')
      return [...code.matchAll(/\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)]
        .filter(([, names, from]) => /(^|\/)provider$/.test(from) && /\bhasLLM\b/.test(names))
        .map(([s]) => `${rel}: ${s.replace(/\s+/g, ' ')}`)
    })
    expect(hits, 'AI 판정은 aiAvailable 로 — 키만 보는 판정을 새로 만들지 않는다').toEqual([])
  })
  it('예외 파일이 실재한다(낡은 예외 금지)', () => {
    for (const f of EXCEPT) expect(() => readFileSync(f, 'utf8'), f).not.toThrow()
  })
})
