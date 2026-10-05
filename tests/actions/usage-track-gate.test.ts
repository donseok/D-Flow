import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 게이트를 통과하기 전에는 service_role 클라이언트가 만들어지면 안 된다.
const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })))
const getClaimsMock = vi.hoisted(() => vi.fn(async () => ({ data: null }) as unknown))
const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => ({ from: () => ({ insert }) })),
}))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock } })),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
// 프로젝트 없는 경로의 범위 관문(과제 34)이 읽는 행위자 — 워크스페이스 W 소속, 프로젝트 PID 는 W 의 것
const getActorMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/authz', () => ({ getActor: getActorMock }))

import { POST } from '@/app/api/track/route'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { ERR_MISSING } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { makeActor } from '../fixtures/actor'

const PID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const W = '00000000-0000-0000-7e57-000000001771', WX = '00000000-0000-0000-7e57-000000001772'
const req = (body: unknown) =>
  new Request('http://localhost/api/track', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  getActorMock.mockReset()
  getActorMock.mockResolvedValue(makeActor({ workspaceRoles: new Map([[W, 'member']]), projectWorkspace: new Map([[PID, W]]) }))
  insert.mockClear()
  insert.mockResolvedValue({ error: null })
  createAdminClient.mockClear()
  getClaimsMock.mockReset()
  process.env.USAGE_TRACKING = 'on'
})
afterEach(() => { delete process.env.USAGE_TRACKING })
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('수집 게이트', () => {
  it('수집이 꺼져 있으면 DB 에 접근하지 않는다', async () => {
    process.env.USAGE_TRACKING = 'off'
    const res = await POST(req({ path: '/minutes' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: 'disabled' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('미인증이면 401 이고 DB 에 접근하지 않는다', async () => {
    getClaimsMock.mockResolvedValue({ data: null })
    const res = await POST(req({ path: '/minutes' }))
    expect(res.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it.each([
    ['path 없음', {}],
    ['path 가 문자열이 아님', { path: 42 }],
    ['슬래시로 시작하지 않음', { path: 'https://evil.example/x' }],
    ['너무 김', { path: '/' + 'a'.repeat(600) }],
  ])('잘못된 본문(%s)은 400 이고 DB 에 접근하지 않는다', async (_n, body) => {
    getClaimsMock.mockResolvedValue({ data: { claims: { sub: 'u1' } } })
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('기록 내용 — 본문을 신뢰하지 않는다', () => {
  beforeEach(() => { getClaimsMock.mockResolvedValue({ data: { claims: { sub: 'real-user' } } }) })

  it('사용자 id 는 쿠키의 것을 쓰고 본문의 user_id 는 무시한다', async () => {
    const res = await POST(req({ path: '/minutes', workspaceId: W, user_id: 'spoofed', menu_key: 'spoofed' }))
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'real-user',
      menu_key: 'minutes',
    }))
  })

  it('경로에서 메뉴 키·프로젝트 id 를 서버가 판정하고 UUID 를 정규화한다', async () => {
    await POST(req({ path: `/p/${PID}/wbs?view=gantt` }))
    expect(insert).toHaveBeenCalledWith({
      user_id: 'real-user',
      menu_key: 'wbs',
      path: '/p/:id/wbs',
      project_id: PID,
      workspace_id: null,
      event_name: 'page_view',
      metadata: {},
    })
  })

  it('Wiki 제품 이벤트만 Wiki 경로에 기록하고 질문 원문 같은 metadata는 버린다', async () => {
    const res = await POST(req({
      path: `/p/${PID}/wiki`,
      eventName: 'wiki_ask_answered',
      metadata: {
        result_count: 3,
        grounded: true,
        question_short: '짧은 민감 질문도 저장 금지',
        question: '민감한 질문 원문'.repeat(20),
        nested: { body: '저장 금지' },
      },
    }))
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'wiki_ask_answered',
      metadata: { result_count: 3, grounded: true },
    }))
  })

  it('0079 전 스키마에서는 page view를 기존 행 형식으로 다시 기록한다', async () => {
    insert
      .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'event_name' column" } } as never)
      .mockResolvedValueOnce({ error: null })

    const res = await POST(req({ path: `/p/${PID}/wiki` }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, compatibility: 'legacy' })
    expect(insert).toHaveBeenNthCalledWith(2, {
      user_id: 'real-user',
      menu_key: 'wiki',
      path: '/p/:id/wiki',
      project_id: PID,
      workspace_id: null,
    })
  })

  it('0079 전 스키마에서 Wiki 제품 이벤트를 page view로 오염시키지 않고 건너뛴다', async () => {
    insert.mockResolvedValueOnce({
      error: { code: '42703', message: 'column metadata does not exist' },
    } as never)

    const res = await POST(req({ path: `/p/${PID}/wiki`, eventName: 'wiki_search' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'schema_missing' })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('알 수 없는 이벤트와 Wiki 밖의 Wiki 이벤트는 거절한다', async () => {
    const unknown = await POST(req({ path: `/p/${PID}/wiki`, eventName: 'wiki_raw_prompt' }))
    expect(unknown.status).toBe(400)
    const wrongPath = await POST(req({ path: `/p/${PID}/wbs`, eventName: 'wiki_search' }))
    expect(wrongPath.status).toBe(400)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('insert 실패는 삼키지 않고 500 으로 올린다', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'boom' } } as never)
    const res = await POST(req({ path: '/minutes', workspaceId: W }))
    expect(res.status).toBe(500)
  })
})

describe('usage 모듈 관문(과제 20, P19)', () => {
  beforeEach(() => { getClaimsMock.mockResolvedValue({ data: { claims: { sub: 'real-user' } } }) })
  it('프로젝트 경로는 그 프로젝트로 판정 — 꺼지면 200 skipped 이고 기록하지 않는다(404 면 트래커가 전환마다 오류를 남긴다)', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(req({ path: `/p/${PID}/wbs` }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'module_disabled' })
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'usage')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })
  it('프로젝트 없는 경로는 요청의 워크스페이스(소속 확인) — 꺼지면 skipped(Review Focus 5, D26)', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    expect(await (await POST(req({ path: '/w/acme/minutes', workspaceId: W }))).json()).toMatchObject({ skipped: 'module_disabled' })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: W }, 'usage')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })
  it('프로젝트도 워크스페이스도 없으면 400 — 세션 유일 워크스페이스로 추측하지 않는다(skipped 아님, 기록 없음)', async () => {
    const res = await POST(req({ path: '/account' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: ERR_WORKSPACE_REQUIRED })
    expect(requireModule).not.toHaveBeenCalled()
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })
  it.each([
    ['비소속', WX],
    ['형식 밖(줄바꿈)', `${W}\n`],
    ['형식 밖(숫자)', 7],
    ['형식 밖(대문자 변형)', W.toUpperCase()],
  ])('적대 — %s 워크스페이스는 404 이고 관문·기록 없음', async (_n, workspaceId) => {
    const res = await POST(req({ path: '/w/acme', workspaceId }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: ERR_MISSING })
    expect(requireModule).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })
  it('적대 — 경로의 프로젝트와 다른 워크스페이스를 실으면 404(조합 불일치), 같으면 그 프로젝트로 기록', async () => {
    getActorMock.mockResolvedValue(makeActor({ workspaceRoles: new Map([[W, 'member'], [WX, 'member']]), projectWorkspace: new Map([[PID, W]]) }))
    expect((await POST(req({ path: `/p/${PID}/wbs`, workspaceId: WX }))).status).toBe(404)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect((await POST(req({ path: `/p/${PID}/wbs`, workspaceId: W }))).status).toBe(200)
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'usage')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ project_id: PID }))
  })
  it('본문의 워크스페이스(소속 검증됨)를 usage_events에 기록한다', async () => {
    expect((await POST(req({ path: '/w/acme/minutes', workspaceId: W }))).status).toBe(200)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: W }))
  })
  it('잘못된 이벤트 경로는 모듈 판정 전에 400 — 입력 모양 검사는 관문 앞(기존 계약)', async () => {
    expect((await POST(req({ path: `/p/${PID}/wbs`, eventName: 'wiki_search' }))).status).toBe(400)
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('켜져 있으면 판정한 프로젝트를 그대로 기록한다(대조)', async () => {
    expect((await POST(req({ path: `/p/${PID}/wbs` }))).status).toBe(200)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ project_id: PID }))
  })
})
