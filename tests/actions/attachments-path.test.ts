import { describe, it, expect, vi, beforeEach } from 'vitest'

// 산출물 첨부 등록의 경로 검증(SP2 B1) — scope 는 클라이언트 입력이 아니라 DB 의 항목 → 프로젝트 → 워크스페이스다.
const { requireProjectMember, resolveProjectId, createServerClient } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), resolveProjectId: vi.fn(), createServerClient: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u-admin' })) }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { recordAttachment } from '@/app/actions/attachments'
import { makeActor } from '../fixtures/actor'

const WS = 'aaaaaaaa-1111-4111-8111-111111111111'
const OTHER_WS = 'dddddddd-4444-4444-8444-444444444444'
const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
const ITEM = 'cccccccc-3333-4333-8333-333333333333'
const ADMIN = makeActor({ userId: 'u-admin', projectWorkspace: new Map([[PID, WS]]), projectRoles: new Map([[PID, 'admin']]) })
const PATH = `ws/${WS}/p/${PID}/deliverables/${ITEM}/1700000000000-plan.xlsx`
const file = (filePath: string) => ({ fileName: 'plan.xlsx', filePath, size: 1, mime: 'application/octet-stream' })

function sb(project: { data: unknown; error: unknown }) {
  const insert = vi.fn(async () => ({ error: null }))
  const client = {
    from: vi.fn((t: string) => t === 'projects'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => project }) }) }
      : { insert }),
  }
  createServerClient.mockResolvedValue(client as never)
  return { insert }
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: PID })
  requireProjectMember.mockResolvedValue({ ok: true, actor: ADMIN })
})

describe('recordAttachment 경로 검증', () => {
  it('항목 스코프 경로는 기록한다', async () => {
    const { insert } = sb({ data: { workspace_id: WS }, error: null })
    expect(await recordAttachment(ITEM, file(PATH))).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ wbs_item_id: ITEM, file_path: PATH }))
  })

  it.each([
    ['옛 형식', `${ITEM}/1-plan.xlsx`],
    ['다른 항목', PATH.replace(ITEM, '99999999-8888-4777-8666-555555555555')],
    ['다른 entity', PATH.replace('/deliverables/', '/issue-attachments/')],
    ['다른 프로젝트', PATH.replace(`/p/${PID}/`, '/p/eeeeeeee-5555-4555-8555-555555555555/')],
    ['경로 순회', `ws/${WS}/p/${PID}/deliverables/${ITEM}/..`],
  ])('%s 경로는 거부하고 insert 하지 않는다', async (_label, path) => {
    const { insert } = sb({ data: { workspace_id: WS }, error: null })
    expect(await recordAttachment(ITEM, file(path))).toEqual({ ok: false, error: '잘못된 파일 경로입니다.' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('scope 는 DB 의 프로젝트 워크스페이스다 — 경로의 워크스페이스가 다르면 거부한다', async () => {
    const { insert } = sb({ data: { workspace_id: OTHER_WS }, error: null })
    expect(await recordAttachment(ITEM, file(PATH))).toEqual({ ok: false, error: '잘못된 파일 경로입니다.' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('프로젝트 워크스페이스 조회가 실패하면 쓰기를 중단한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { insert } = sb({ data: null, error: { message: 'boom' } })
    expect(await recordAttachment(ITEM, file(PATH))).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(insert).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
