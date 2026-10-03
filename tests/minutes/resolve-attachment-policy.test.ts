import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { DEFAULT_ATTACHMENT_POLICY } from '@/lib/minutes/attachmentPolicy'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
const h = vi.hoisted(() => ({ project: vi.fn(), workspace: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.project }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.workspace }))
import { resolveAttachmentPolicy } from '@/lib/minutes/resolveAttachmentPolicy'
const scope = { workspaceId: 'ws-test', projectId: 'p-test' }
const projectPolicy = { ...DEFAULT_ATTACHMENT_POLICY, maxCount: 2, maxTotalBytes: 2 * DEFAULT_ATTACHMENT_POLICY.maxFileBytes }
const workspace = () => ({ workspaceId: scope.workspaceId, schemaAhead: false, keys: { 'minutes.attachments': { status: 'set', value: DEFAULT_ATTACHMENT_POLICY } } })
beforeEach(() => {
  vi.clearAllMocks()
  h.project.mockResolvedValue(makeProjectConfig({ 'minutes.attachments': projectPolicy }))
  h.workspace.mockResolvedValue(workspace())
})
describe('실제 회의록 scope의 첨부 정책', () => {
  it('프로젝트가 있으면 그 정책만 읽으며 워크스페이스 제한을 상속하지 않는다', async () => {
    expect(await resolveAttachmentPolicy(scope)).toEqual(projectPolicy)
    expect(h.project).toHaveBeenCalledWith('p-test', undefined)
    expect(h.workspace).not.toHaveBeenCalled()
  })
  it('무프로젝트 회의록은 워크스페이스 정책을 쓴다', async () => {
    expect(await resolveAttachmentPolicy({ ...scope, projectId: null })).toEqual(DEFAULT_ATTACHMENT_POLICY)
    expect(h.project).not.toHaveBeenCalled()
  })
  it('프로젝트 미설정은 제품 기본값이며 워크스페이스 값을 읽지 않는다', async () => {
    h.project.mockResolvedValue(makeProjectConfig())
    expect(await resolveAttachmentPolicy(scope)).toEqual(DEFAULT_ATTACHMENT_POLICY)
    expect(h.workspace).not.toHaveBeenCalled()
  })
  it('손상된 프로젝트 키는 기본값/워크스페이스로 대체하지 않는다', async () => {
    h.project.mockResolvedValue(makeProjectConfig({ 'minutes.attachments': null }))
    await expect(resolveAttachmentPolicy(scope)).rejects.toBeInstanceOf(ConfigKeyError)
    expect(h.workspace).not.toHaveBeenCalled()
  })
  it('설정 조회 실패를 그대로 중단한다', async () => {
    h.project.mockRejectedValue(new ConfigUnavailableError('lookup failed'))
    await expect(resolveAttachmentPolicy(scope)).rejects.toBeInstanceOf(ConfigUnavailableError)
    expect(h.workspace).not.toHaveBeenCalled()
  })
  it.each([{ workspaceId: 'other' }, { projectId: 'other' }, { schemaAhead: true }])('범위/세대 불일치 %j 거부', async over => {
    h.project.mockResolvedValue(makeProjectConfig({}, over))
    await expect(resolveAttachmentPolicy(scope)).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
  it('무프로젝트 범위 불일치와 손상된 키도 거부한다', async () => {
    h.workspace.mockResolvedValue({ ...workspace(), workspaceId: 'other' })
    await expect(resolveAttachmentPolicy({ ...scope, projectId: null })).rejects.toBeInstanceOf(ConfigUnavailableError)
    h.workspace.mockResolvedValue({ ...workspace(), keys: { 'minutes.attachments': { status: 'invalid', error: 'broken' } } })
    await expect(resolveAttachmentPolicy({ ...scope, projectId: null })).rejects.toBeInstanceOf(ConfigKeyError)
  })
  it('누락/빈 scope는 조회 전에 거부한다', async () => {
    await expect(resolveAttachmentPolicy({ ...scope, workspaceId: null })).rejects.toBeInstanceOf(ConfigUnavailableError)
    await expect(resolveAttachmentPolicy({ ...scope, projectId: '' })).rejects.toBeInstanceOf(ConfigUnavailableError)
    expect(h.project).not.toHaveBeenCalled()
    expect(h.workspace).not.toHaveBeenCalled()
  })
  it('세션 없는 경로의 검증된 client를 로더에 전달한다', async () => {
    const opts = { client: { from: vi.fn() } as never }
    await resolveAttachmentPolicy(scope, opts)
    expect(h.project).toHaveBeenCalledWith('p-test', opts)
  })
})
