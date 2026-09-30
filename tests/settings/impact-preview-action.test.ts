import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const h = vi.hoisted(() => ({ guard: vi.fn(), adminFor: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.guard }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))

import { previewSettingsImpact } from '@/app/actions/settingsPreview'

const WID = '00000000-0000-4000-8000-00000000bb01'
const PID = '00000000-0000-4000-8000-00000000aa01'
let db: FakeSettingsDb

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeSettingsDb()
    .addWorkspace({ id: WID, values: { 'modules.allowed': ['agents', 'minutes'] }, revision: 4 })
    .addProject({ id: PID, workspaceId: WID, values: { 'core.level_labels': ['Phase'], 'modules.enabled': ['agents'] } })
  h.guard.mockResolvedValue({ ok: true, actor: makeSuperuser() })
  h.adminFor.mockImplementation(() => ({ admin: db.client() }))
})

describe('previewSettingsImpact action', () => {
  it('플랫폼 관리자에게 최신 revision과 제거 영향을 돌린다', async () => {
    expect(await previewSettingsImpact(WID, ['minutes'])).toEqual({ ok: true, revision: 4,
      before: ['agents', 'minutes'], impact: { removed: [{ moduleId: 'agents', projectCount: 1 }], affectedProjects: 1 } })
    expect(h.guard).toHaveBeenCalledWith(WID)
  })

  it('워크스페이스 관리자와 잘못된 목록은 서비스 조회 전에 거부한다', async () => {
    h.guard.mockResolvedValue({ ok: true, actor: makeActor({ workspaceRoles: new Map([[WID, 'admin']]) }) })
    expect(await previewSettingsImpact(WID, ['minutes'])).toMatchObject({ ok: false })
    expect(h.adminFor).not.toHaveBeenCalled()
    h.guard.mockResolvedValue({ ok: true, actor: makeSuperuser() })
    expect(await previewSettingsImpact(WID, ['dashboard'] as never)).toMatchObject({ ok: false })
    expect(h.adminFor).not.toHaveBeenCalled()
  })

  it('저장된 허용 목록 손상은 영향 수를 만들지 않고 복구 검토를 허용한다', async () => {
    db.workspaces.get(WID)!.values['modules.allowed'] = 'bad'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await previewSettingsImpact(WID, ['agents'])).toEqual({ ok: true, revision: 4, before: null, impact: null })
  })

  it('프로젝트 조회 실패는 0건으로 위장하지 않는다', async () => {
    db.failTable = 'projects'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await previewSettingsImpact(WID, ['minutes'])).toMatchObject({ ok: false, error: expect.stringContaining('영향을 확인하지 못했습니다') })
  })
})
