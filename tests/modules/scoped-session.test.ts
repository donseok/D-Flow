// 세션 라우트의 범위 관문(D26 UI-2b 몫, 계획 과제 34) — 적대적 셋을 먼저 고정한다(fail-closed):
// ① 비소속 워크스페이스 ② 형식 밖 workspaceId ③ 프로젝트와 다른 워크스페이스 조합. 플랫폼 관리자는 보기 축(loadWorkspaceScope 와 같다 —
// 비소속 워크스페이스를 열어 볼 수 있다)이라 통과하되, 소속 맵에 없는 id 는 실제 존재를 한 번 확인한다(없는 id 를 모듈 판정에 싣지 않는다).
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  getActor: vi.fn(),
  requireModule: vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; error: string }),
  workspaceRefById: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ getActor: h.getActor }))
vi.mock('@/lib/modules/gate', () => ({ requireModule: h.requireModule }))
vi.mock('@/lib/workspace/resolve', () => ({ workspaceRefById: h.workspaceRefById }))
import { requireScopedSessionModule } from '@/lib/modules/scopedSession'
import { ERR_ANON, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { ERR_WORKSPACE_REQUIRED } from '@/lib/authz/workspace'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const WA = '00000000-0000-0000-7e57-000000001751', WB = '00000000-0000-0000-7e57-000000001752'
const P = '00000000-0000-0000-7e57-000000001753', PB = '00000000-0000-0000-7e57-000000001754'
const member = () => makeActor({ workspaceRoles: new Map([[WA, 'member'], [WB, 'member']]), projectWorkspace: new Map([[P, WA], [PB, WB]]) })
const MISSING = { ok: false, error: ERR_MISSING, status: 404 }

beforeEach(() => {
  vi.clearAllMocks()
  h.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectWorkspace: new Map([[P, WA]]) }))
  h.requireModule.mockResolvedValue({ ok: true })
  h.workspaceRefById.mockResolvedValue({ ok: false, kind: 'missing' })
})

describe('requireScopedSessionModule — 프로젝트가 있을 때', () => {
  it('워크스페이스 인자가 없으면 그 프로젝트로(지금과 같다 — 행위자를 읽지 않는다)', async () => {
    await expect(requireScopedSessionModule({ projectId: P, workspaceId: undefined }, 'chatbot')).resolves.toEqual({ ok: true, workspaceId: null })
    expect(h.requireModule).toHaveBeenCalledWith({ projectId: P }, 'chatbot')
    expect(h.getActor).not.toHaveBeenCalled()
  })
  it('같은 워크스페이스를 함께 실으면 통과(그 프로젝트로 판정)', async () => {
    await expect(requireScopedSessionModule({ projectId: P, workspaceId: WA }, 'chatbot')).resolves.toEqual({ ok: true, workspaceId: WA })
    expect(h.requireModule).toHaveBeenCalledWith({ projectId: P }, 'chatbot')
  })
  it('적대 ③ — 프로젝트의 워크스페이스와 다른 워크스페이스(두 곳 다 소속이어도)는 404, 관문을 부르지 않는다', async () => {
    h.getActor.mockResolvedValue(member())
    await expect(requireScopedSessionModule({ projectId: P, workspaceId: WB }, 'chatbot')).resolves.toEqual(MISSING)
    await expect(requireScopedSessionModule({ projectId: PB, workspaceId: WA }, 'chatbot')).resolves.toEqual(MISSING)
    expect(h.requireModule).not.toHaveBeenCalled()
  })
  it('적대 ③ — 플랫폼 관리자도 프로젝트와 다른 워크스페이스는 404, 모르는 프로젝트 + 워크스페이스도 404', async () => {
    h.getActor.mockResolvedValue(makeSuperuser({ workspaceRoles: new Map(), projectWorkspace: new Map([[P, WA]]) }))
    await expect(requireScopedSessionModule({ projectId: P, workspaceId: WB }, 'chatbot')).resolves.toEqual(MISSING)
    await expect(requireScopedSessionModule({ projectId: PB, workspaceId: WB }, 'chatbot')).resolves.toEqual(MISSING)
    expect(h.requireModule).not.toHaveBeenCalled()
    expect(h.workspaceRefById).not.toHaveBeenCalled()
  })
  it('적대 ② — 프로젝트와 함께 온 형식 밖 워크스페이스(대문자 변형·숫자·객체·줄바꿈·65자)는 404', async () => {
    for (const w of [WA.toUpperCase(), 7, { id: WA }, [WA], `${WA}\n`, 'a'.repeat(65), 'acme;x']) {
      await expect(requireScopedSessionModule({ projectId: P, workspaceId: w }, 'chatbot'), JSON.stringify(w)).resolves.toEqual(MISSING)
    }
    expect(h.requireModule).not.toHaveBeenCalled()
  })
  it('워크스페이스를 확인해야 하는데 권한 조회가 던지면 503, 행위자 없음은 401', async () => {
    h.getActor.mockRejectedValueOnce(new Error('db down'))
    await expect(requireScopedSessionModule({ projectId: P, workspaceId: WA }, 'chatbot')).resolves.toEqual({ ok: false, error: ERR_LOOKUP, status: 503 })
    h.getActor.mockResolvedValueOnce(null)
    await expect(requireScopedSessionModule({ projectId: P, workspaceId: WA }, 'chatbot')).resolves.toEqual({ ok: false, error: ERR_ANON, status: 401 })
    expect(h.requireModule).not.toHaveBeenCalled()
  })
  it('모듈 꺼짐은 404', async () => {
    h.requireModule.mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(requireScopedSessionModule({ projectId: P, workspaceId: null }, 'chatbot')).resolves.toEqual({ ok: false, error: ERR_MODULE_DISABLED, status: 404 })
  })
})

describe('requireScopedSessionModule — 프로젝트가 없을 때', () => {
  it('소속 워크스페이스로 관문', async () => {
    await expect(requireScopedSessionModule({ projectId: null, workspaceId: WA }, 'chatbot')).resolves.toEqual({ ok: true, workspaceId: WA })
    expect(h.requireModule).toHaveBeenCalledWith({ workspaceId: WA }, 'chatbot')
    expect(h.workspaceRefById).not.toHaveBeenCalled()
  })
  it('둘 다 없으면 400 — 세션 유일 워크스페이스로 추측하지 않는다(행위자도 읽지 않는다)', async () => {
    for (const w of [undefined, null, '']) {
      await expect(requireScopedSessionModule({ projectId: null, workspaceId: w }, 'chatbot')).resolves.toEqual({ ok: false, error: ERR_WORKSPACE_REQUIRED, status: 400 })
    }
    expect(h.getActor).not.toHaveBeenCalled()
    expect(h.requireModule).not.toHaveBeenCalled()
  })
  it('적대 ① — 비소속(존재하는 남의 워크스페이스)은 404, 관문·존재 조회를 부르지 않는다', async () => {
    await expect(requireScopedSessionModule({ projectId: null, workspaceId: WB }, 'chatbot')).resolves.toEqual(MISSING)
    expect(h.requireModule).not.toHaveBeenCalled()
    expect(h.workspaceRefById).not.toHaveBeenCalled()
  })
  it('적대 ② — 형식 밖(대문자 변형·숫자·객체·배열·줄바꿈·공백·65자·인코딩)은 404, 관문을 부르지 않는다', async () => {
    for (const w of [WA.toUpperCase(), 7, true, { id: WA }, [WA], `${WA}\n`, ` ${WA}`, 'a'.repeat(65), encodeURIComponent(`${WA}/x`)]) {
      await expect(requireScopedSessionModule({ projectId: null, workspaceId: w }, 'chatbot'), JSON.stringify(w)).resolves.toEqual(MISSING)
    }
    expect(h.requireModule).not.toHaveBeenCalled()
  })
  it('권한 조회가 던지면 503(비소속으로 위장하지 않는다), 행위자 없음은 401', async () => {
    h.getActor.mockRejectedValueOnce(new Error('db down'))
    await expect(requireScopedSessionModule({ projectId: null, workspaceId: WA }, 'chatbot')).resolves.toEqual({ ok: false, error: ERR_LOOKUP, status: 503 })
    h.getActor.mockResolvedValueOnce(null)
    await expect(requireScopedSessionModule({ projectId: null, workspaceId: WA }, 'chatbot')).resolves.toEqual({ ok: false, error: ERR_ANON, status: 401 })
    expect(h.requireModule).not.toHaveBeenCalled()
  })
  it('모듈 꺼짐은 404', async () => {
    h.requireModule.mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(requireScopedSessionModule({ projectId: null, workspaceId: WA }, 'chatbot')).resolves.toEqual({ ok: false, error: ERR_MODULE_DISABLED, status: 404 })
  })
})

describe('requireScopedSessionModule — 플랫폼 관리자(보기 축, U2b-3 적대 3·AA6 와의 구분)', () => {
  beforeEach(() => { h.getActor.mockResolvedValue(makeSuperuser({ workspaceRoles: new Map([[WA, 'admin']]), projectWorkspace: new Map() })) })
  it('실제 소속이면 존재 조회 없이 통과', async () => {
    await expect(requireScopedSessionModule({ projectId: null, workspaceId: WA }, 'minutes')).resolves.toEqual({ ok: true, workspaceId: WA })
    expect(h.workspaceRefById).not.toHaveBeenCalled()
  })
  it('비소속이어도 실제로 있는 워크스페이스면 통과(그 화면을 열어 볼 수 있다) — 판정 id 는 조회한 행의 것', async () => {
    h.workspaceRefById.mockResolvedValue({ ok: true, ws: { id: WB, slug: 'beta', name: 'Beta' } })
    await expect(requireScopedSessionModule({ projectId: null, workspaceId: WB }, 'minutes')).resolves.toEqual({ ok: true, workspaceId: WB })
    expect(h.workspaceRefById).toHaveBeenCalledWith(WB)
    expect(h.requireModule).toHaveBeenCalledWith({ workspaceId: WB }, 'minutes')
  })
  it('없는 워크스페이스는 404, 존재 조회 오류는 503(없음으로 위장하지 않는다) — 둘 다 관문을 부르지 않는다', async () => {
    await expect(requireScopedSessionModule({ projectId: null, workspaceId: WB }, 'minutes')).resolves.toEqual(MISSING)
    h.workspaceRefById.mockResolvedValue({ ok: false, kind: 'unavailable', error: 'x' })
    await expect(requireScopedSessionModule({ projectId: null, workspaceId: WB }, 'minutes')).resolves.toEqual({ ok: false, error: ERR_LOOKUP, status: 503 })
    expect(h.requireModule).not.toHaveBeenCalled()
  })
  it('형식 밖은 존재 조회 전에 404(임의 문자열을 조회·로그에 싣지 않는다)', async () => {
    for (const w of ['not-a-uuid', WB.toUpperCase(), `${WB}\n`, 'a'.repeat(65)]) {
      await expect(requireScopedSessionModule({ projectId: null, workspaceId: w }, 'minutes'), w).resolves.toEqual(MISSING)
    }
    expect(h.workspaceRefById).not.toHaveBeenCalled()
    expect(h.requireModule).not.toHaveBeenCalled()
  })
})
