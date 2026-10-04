import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
import { makeActor } from '../fixtures/actor'

const h = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireWorkspaceAdmin: vi.fn(),
  adminFor: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: h.requireProjectAdmin,
  requireWorkspaceAdmin: h.requireWorkspaceAdmin,
}))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => {
    throw new Error('세션 클라이언트를 쓰면 안 된다')
  }),
}))

import { updateProjectSettings, type SettingsPatch } from '@/app/actions/settings'

const PID = '00000000-0000-0000-7e57-0000000019a1'
const WID = '00000000-0000-0000-7e57-00000000aa5c'
const CMD = '00000000-0000-4000-8000-0000000019a2'

let db: FakeSettingsDb
const patch = (over: Partial<SettingsPatch>): SettingsPatch => ({
  expectedRevision: 1,
  commandId: CMD,
  set: {},
  unset: [],
  ...over,
})

const project = (values: Record<string, unknown>) =>
  db.addProject({
    id: PID,
    workspaceId: WID,
    revision: 1,
    values: {
      'core.level_labels': ['Phase', 'Task'],
      'modules.enabled': ['issues', 'weekly'],
      ...values,
    },
  })

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeSettingsDb().addWorkspace({
    id: WID,
    values: { 'modules.allowed': ['issues', 'weekly'] },
    revision: 1,
  })
  h.adminFor.mockImplementation((scope: Record<string, string>) => ({
    ...scope,
    admin: db.client(),
  }))
  const actor = makeActor({ userId: 'u-admin', workspaceRoles: new Map([[WID, 'admin']]) })
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
  h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('설정 저장 시 사용자 정의 필드 변경에 따른 AI 재색인 트리거', () => {
  it('WBS 사용자 정의 필드의 label이 변경되면 wbs_items 재색인 잡을 등록한다', async () => {
    const prevField = {
      key: 'stage',
      label: '이전 단계',
      description: '설명',
      type: 'text',
      required: false,
      editable_by: 'member',
      show_in_list: true,
      searchable: true,
      active: true,
      sort: 1,
    }
    const nextField = {
      ...prevField,
      label: '새 단계',
    }

    project({ 'fields.wbs_item': [prevField] })
    db.wbsItems.push(
      { id: 'wbs-1', project_id: PID },
      { id: 'wbs-2', project_id: PID },
      { id: 'wbs-other', project_id: 'other-project' },
    )

    const res = await updateProjectSettings(
      PID,
      patch({ set: { 'fields.wbs_item': [nextField] } }),
    )

    expect(res).toMatchObject({ ok: true, kind: 'applied', revision: 2 })

    const reindexCalls = db.rpcCalls.filter(c => c.name === 'upsert_ai_index_jobs')
    expect(reindexCalls).toHaveLength(1)
    const jobs = reindexCalls[0].args.p_jobs as Array<Record<string, unknown>>
    expect(jobs).toHaveLength(2)
    expect(jobs.map(j => j.entity_id)).toEqual(['wbs-1', 'wbs-2'])
    expect(jobs[0]).toMatchObject({
      project_id: PID,
      domain: 'wbs',
      entity_type: 'wbs_item',
      operation: 'upsert',
      payload: { reason: 'custom_fields_changed' },
    })
  })

  it('이슈 사용자 정의 필드의 searchable 플래그가 변경되면 issues 재색인 잡을 등록한다', async () => {
    const prevField = {
      key: 'impact',
      label: '영향도',
      description: '설명',
      type: 'text',
      required: false,
      editable_by: 'member',
      show_in_list: true,
      searchable: false,
      active: true,
      sort: 1,
    }
    const nextField = {
      ...prevField,
      searchable: true,
    }

    project({ 'fields.issue': [prevField] })
    db.issues.push(
      { id: 'iss-1', project_id: PID },
      { id: 'iss-2', project_id: PID },
    )

    const res = await updateProjectSettings(
      PID,
      patch({ set: { 'fields.issue': [nextField] } }),
    )

    expect(res).toMatchObject({ ok: true, kind: 'applied', revision: 2 })

    const reindexCalls = db.rpcCalls.filter(c => c.name === 'upsert_ai_index_jobs')
    expect(reindexCalls).toHaveLength(1)
    const jobs = reindexCalls[0].args.p_jobs as Array<Record<string, unknown>>
    expect(jobs).toHaveLength(2)
    expect(jobs.map(j => j.entity_id)).toEqual(['iss-1', 'iss-2'])
    expect(jobs[0]).toMatchObject({
      project_id: PID,
      domain: 'issues',
      entity_type: 'issue',
      operation: 'upsert',
      payload: { reason: 'custom_fields_changed' },
    })
  })

  it('주간보고 행 선택 필드의 옵션 레이블이 변경되면 weekly_reports 재색인 잡을 등록한다', async () => {
    const prevField = {
      key: 'status',
      label: '상태',
      description: '설명',
      type: 'select',
      required: false,
      editable_by: 'member',
      show_in_list: true,
      searchable: true,
      active: true,
      sort: 1,
      options: [
        { code: 'ing', label: '진행중', sort: 1, active: true },
      ],
    }
    const nextField = {
      ...prevField,
      options: [
        { code: 'ing', label: '수행중(명칭변경)', sort: 1, active: true },
      ],
    }

    project({ 'fields.weekly_row': [prevField] })
    db.weeklyReports.push(
      { id: 'rep-1', project_id: PID },
      { id: 'rep-2', project_id: PID },
    )

    const res = await updateProjectSettings(
      PID,
      patch({ set: { 'fields.weekly_row': [nextField] } }),
    )

    expect(res).toMatchObject({ ok: true, kind: 'applied', revision: 2 })

    const reindexCalls = db.rpcCalls.filter(c => c.name === 'upsert_ai_index_jobs')
    expect(reindexCalls).toHaveLength(1)
    const jobs = reindexCalls[0].args.p_jobs as Array<Record<string, unknown>>
    expect(jobs).toHaveLength(2)
    expect(jobs.map(j => j.entity_id)).toEqual(['rep-1', 'rep-2'])
    expect(jobs[0]).toMatchObject({
      project_id: PID,
      domain: 'weekly',
      entity_type: 'weekly_report',
      operation: 'upsert',
      payload: { reason: 'custom_fields_changed' },
    })
  })

  it('색인과 무관한 속성(description, sort, required, show_in_list)만 변경되면 재색인 잡을 등록하지 않는다', async () => {
    const prevField = {
      key: 'memo',
      label: '메모',
      description: '이전 설명',
      type: 'text',
      required: false,
      editable_by: 'member',
      show_in_list: false,
      searchable: true,
      active: true,
      sort: 1,
    }
    const nextField = {
      ...prevField,
      description: '새 설명',
      sort: 5,
      required: false,
      show_in_list: true,
    }

    project({ 'fields.wbs_item': [prevField] })
    db.wbsItems.push({ id: 'wbs-1', project_id: PID })

    const res = await updateProjectSettings(
      PID,
      patch({ set: { 'fields.wbs_item': [nextField] } }),
    )

    expect(res).toMatchObject({ ok: true, kind: 'applied', revision: 2 })

    const reindexCalls = db.rpcCalls.filter(c => c.name === 'upsert_ai_index_jobs')
    expect(reindexCalls).toHaveLength(0)
  })

  it('upsert_ai_index_jobs RPC 실패 시 CONFIG_UNAVAILABLE과 복구 안내를 반환한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const prevField = {
      key: 'stage',
      label: '단계',
      description: '',
      type: 'text',
      required: false,
      editable_by: 'member',
      show_in_list: true,
      searchable: true,
      active: true,
      sort: 1,
    }
    const nextField = {
      ...prevField,
      label: '단계(변경)',
    }

    project({ 'fields.wbs_item': [prevField] })
    db.wbsItems.push({ id: 'wbs-1', project_id: PID })

    // Simulate RPC failure for upsert_ai_index_jobs
    const originalClient = db.client.bind(db)
    h.adminFor.mockImplementation((scope: Record<string, string>) => {
      const client = originalClient()
      const originalRpc = client.rpc.bind(client)
      client.rpc = async (name: string, args: Record<string, unknown>) => {
        if (name === 'upsert_ai_index_jobs') {
          return { data: null, error: { message: 'DB connection failure' } }
        }
        return originalRpc(name, args)
      }
      return { ...scope, admin: client }
    })

    const res = await updateProjectSettings(
      PID,
      patch({ set: { 'fields.wbs_item': [nextField] } }),
    )

    expect(res).toMatchObject({
      ok: false,
      kind: 'unavailable',
      code: 'CONFIG_UNAVAILABLE',
      retryable: false,
      appliedRevision: 2,
    })
    if (!res.ok) {
      expect(res.error).toContain('AI 색인 갱신')
      expect(res.error).toContain('설정을 다시 저장하면 색인 갱신을 재시도합니다')
    }
  })
})
