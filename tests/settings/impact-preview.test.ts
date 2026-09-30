import { describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
import { previewModuleAllowImpact, previewProjectModuleImpact } from '@/lib/settings/impactPreview'

const WID = '00000000-0000-4000-8000-00000000bb01'
const OTHER = '00000000-0000-4000-8000-00000000bb02'
const one = '00000000-0000-4000-8000-00000000aa01'
const two = '00000000-0000-4000-8000-00000000aa02'

describe('modules.allowed 영향 미리보기', () => {
  it('제거한 프로젝트 모듈은 켜진 프로젝트만, 워크스페이스 모듈은 전 프로젝트를 센다', async () => {
    const db = new FakeSettingsDb()
      .addProject({ id: one, workspaceId: WID, values: { 'core.level_labels': ['Phase'], 'modules.enabled': ['agents', 'wiki'] } })
      .addProject({ id: two, workspaceId: WID, values: { 'core.level_labels': ['Phase'], 'modules.enabled': ['kanban'] } })
      .addProject({ id: '00000000-0000-4000-8000-00000000aa03', workspaceId: OTHER, values: { 'core.level_labels': ['Phase'], 'modules.enabled': ['agents'] } })
    const result = await previewModuleAllowImpact(db.client() as never, { workspaceId: WID, before: ['agents', 'minutes', 'kanban'], next: ['kanban'] })
    expect(result).toEqual({ removed: [{ moduleId: 'agents', projectCount: 1 }, { moduleId: 'minutes', projectCount: 2 }], affectedProjects: 2 })
  })

  it('허용을 넓히면 조회 없이 영향 0건이며 조회 실패는 숫자로 위장하지 않는다', async () => {
    const db = new FakeSettingsDb()
    db.failTable = 'projects'
    expect(await previewModuleAllowImpact(db.client() as never, { workspaceId: WID, before: ['kanban'], next: ['kanban', 'agents'] }))
      .toEqual({ removed: [], affectedProjects: 0 })
    await expect(previewModuleAllowImpact(db.client() as never, { workspaceId: WID, before: ['agents'], next: [] }))
      .rejects.toThrow('fake failure: projects')
  })

  it('프로젝트 설정 손상은 영향 0건으로 계산하지 않는다', async () => {
    const db = new FakeSettingsDb().addProject({ id: one, workspaceId: WID, values: { 'core.level_labels': ['Phase'], 'modules.enabled': 'bad' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(previewModuleAllowImpact(db.client() as never, { workspaceId: WID, before: ['agents'], next: [] }))
      .rejects.toThrow()
  })
})

describe('modules.enabled 영향 미리보기', () => {
  it('꺼지는 모듈의 대표 데이터 건수를 세고 별도 집계가 없는 모듈을 구분한다', async () => {
    const from = vi.fn((table: string) => ({ select: () => ({ eq: async () => ({ count: table === 'meetings' ? 7 : 0, error: null }) }) }))
    const result = await previewProjectModuleImpact({ from } as never, { projectId: one, before: ['meetings', 'chatbot'], next: [] })
    expect(result).toEqual({ removed: [
      { moduleId: 'meetings', dataCount: 7, dataLabel: '회의' },
      { moduleId: 'chatbot', dataCount: null, dataLabel: '별도 데이터 집계 없음' },
    ] })
    expect(from).toHaveBeenCalledTimes(1)
  })
  it('건수 조회가 실패하면 0건으로 위장하지 않는다', async () => {
    const from = () => ({ select: () => ({ eq: async () => ({ count: null, error: { message: 'offline' } }) }) })
    await expect(previewProjectModuleImpact({ from } as never, { projectId: one, before: ['meetings'], next: [] })).rejects.toThrow('offline')
  })
})
