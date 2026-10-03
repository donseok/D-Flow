import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectConfig } from '@/lib/settings/projectConfig'
const h = vi.hoisted(() => ({ workspace: vi.fn() }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.workspace }))
import { boardUnavailableReason } from '@/lib/wbs/boardAvailability'
const cfg = (state: object = { status: 'set', value: ['wbs'] }) => ({ workspaceId: 'w-a', keys: { 'modules.enabled': state } }) as ProjectConfig
beforeEach(() => { h.workspace.mockReset(); h.workspace.mockResolvedValue({ keys: { 'modules.allowed': { status: 'set', value: ['wbs', 'kanban'] } } }) })
describe('보드 제한 사유는 조회 실패와 꺼짐을 구분한다', () => {
  it('프로젝트 꺼짐은 해당 워크스페이스 설정으로 판정한다', async () => {
    expect(await boardUnavailableReason(cfg())).toBe('project_off')
    expect(h.workspace).toHaveBeenCalledExactlyOnceWith('w-a')
  })
  it('워크스페이스 허용 밖은 프로젝트 꺼짐과 다르다', async () => {
    h.workspace.mockResolvedValue({ keys: { 'modules.allowed': { status: 'set', value: ['wbs'] } } })
    expect(await boardUnavailableReason(cfg())).toBe('workspace_denied')
  })
  it.each(['workspace_invalid', 'workspace_unavailable', 'project_invalid'])('%s는 unknown + 로그다', async kind => {
    if (kind === 'workspace_unavailable') h.workspace.mockRejectedValue(new Error('down'))
    if (kind === 'workspace_invalid') h.workspace.mockResolvedValue({ keys: { 'modules.allowed': { status: 'invalid', error: 'bad' } } })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { expect(await boardUnavailableReason(cfg(kind === 'project_invalid' ? { status: 'invalid', error: 'bad' } : undefined))).toBe('unknown'); expect(err).toHaveBeenCalled() } finally { err.mockRestore() }
  })
})
