import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const OWNER = { id: 'u-1', email: 'admin@example.com' }
const PROJECT_ID = '87654321-4321-4321-4321-987654321def'
const WORKSPACE_ID = '11111111-2222-3333-4444-555555555555'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn(async () => ({ ok: true })),
  runWbsImport: vi.fn(),
  resolveAgentPrincipal: vi.fn(),
  requireScope: vi.fn(),
  patProjectAllowed: vi.fn(),
  requireAgentProject: vi.fn(),
  isAgentProjectMember: vi.fn(),
  isAgentProjectAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/lib/agent/wbsImport', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return {
    ...m,
    runWbsImport: (...args: unknown[]) => mocks.runWbsImport(...args),
  }
})
vi.mock('@/lib/agent/externalApi', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return {
    ...m,
    resolveAgentPrincipal: (...args: unknown[]) => mocks.resolveAgentPrincipal(...args),
    requireScope: (...args: unknown[]) => mocks.requireScope(...args),
    patProjectAllowed: (...args: unknown[]) => mocks.patProjectAllowed(...args),
    requireAgentProject: (...args: unknown[]) => mocks.requireAgentProject(...args),
    isAgentProjectMember: (...args: unknown[]) => mocks.isAgentProjectMember(...args),
    isAgentProjectAdmin: (...args: unknown[]) => mocks.isAgentProjectAdmin(...args),
  }
})
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as importPOST } from '@/app/api/v1/wbs/import/route'

describe('POST /api/v1/wbs/import 멱등성 (command_receipts)', () => {
  let receiptsTable: Array<Record<string, unknown>> = []

  function setupAdmin(initialReceipts: Array<Record<string, unknown>> = []) {
    receiptsTable = [...initialReceipts]

    const admin = {
      from: vi.fn((table: string) => {
        const filters: Array<[string, unknown]> = []
        const chain = {
          select: () => chain,
          update: () => chain,
          delete: () => chain,
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return chain
          },
          in: () => chain,
          limit: () => chain,
          order: () => chain,
          maybeSingle: async () => {
            if (table === 'command_receipts') {
              const row = receiptsTable.find(r =>
                filters.every(([c, v]) => r[c] === v),
              )
              return { data: row ?? null, error: null }
            }
            if (table === 'projects') {
              return { data: { workspace_id: WORKSPACE_ID }, error: null }
            }
            return { data: null, error: null }
          },
          insert: async (data: Record<string, unknown>) => {
            if (table === 'command_receipts') {
              receiptsTable.push(data)
            }
            return { error: null }
          },
        }
        return chain
      }),
    }

    mocks.createAdminClient.mockReturnValue(admin)
    return admin
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setupAdmin()

    mocks.resolveAgentPrincipal.mockResolvedValue({
      kind: 'pat',
      runnerId: 'runner-1',
      userId: OWNER.id,
      userEmail: OWNER.email,
      scopes: ['work:claim'],
      projectId: null,
      runnerKind: 'user_pat',
      tokenExpiresAt: '2099-01-01T00:00:00Z',
      runnerName: 'test-runner',
      tokenPrefix: 'dflow_pat_123',
      credential: {
        id: 'cred-1',
        workspaceId: WORKSPACE_ID,
        kind: 'agent_runner',
        name: 'test-runner',
        tokenPrefix: 'dflow_pat_123',
        expiresAt: '2099-01-01T00:00:00Z',
        scopes: ['work:claim'],
        projectIds: null,
        defaultProjectId: null,
        defaultTeamId: null,
        teamMap: {},
        ownerUserId: OWNER.id,
      },
    })
    mocks.requireScope.mockReturnValue(null)
    mocks.patProjectAllowed.mockReturnValue(true)
    mocks.requireAgentProject.mockResolvedValue(true)
    mocks.isAgentProjectMember.mockResolvedValue(true)
    mocks.isAgentProjectAdmin.mockResolvedValue(true)

    mocks.runWbsImport.mockResolvedValue({
      ok: true,
      upserted: 3,
      skipped: 0,
      unmatched: [],
      nonLeafSkipped: [],
      ordersCreated: 1,
    })
  })

  it('command_id 형식이 올바르지 않으면 400 validation_failed 반환', async () => {
    const req = new NextRequest('http://l/api/v1/wbs/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dflow_pat_dummy',
      },
      body: JSON.stringify({
        project_id: PROJECT_ID,
        module: 'MES',
        command_id: 'not-a-valid-uuid',
        nodes: [{ id: 'T1', title: 'Task 1' }],
      }),
    })

    const res = await importPOST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('command_id 형식이 올바르지 않습니다.')
    expect(mocks.runWbsImport).not.toHaveBeenCalled()
  })

  it('새로운 command_id로 요청 시 실행 후 command_receipts에 영수증을 저장한다', async () => {
    const commandId = '00000000-0000-0000-7e57-000000000099'
    const req = new NextRequest('http://l/api/v1/wbs/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dflow_pat_dummy',
      },
      body: JSON.stringify({
        project_id: PROJECT_ID,
        module: 'MES',
        command_id: commandId,
        nodes: [{ id: 'T1', title: 'Task 1' }],
      }),
    })

    const res = await importPOST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.upserted).toBe(3)
    expect(mocks.runWbsImport).toHaveBeenCalledTimes(1)

    // command_receipts에 저장 확인
    expect(receiptsTable.length).toBe(1)
    expect(receiptsTable[0].command_id).toBe(commandId)
    expect(receiptsTable[0].kind).toBe('wbs_import')
    expect(receiptsTable[0].actor).toBe(OWNER.id)
    expect(receiptsTable[0].workspace_id).toBe(WORKSPACE_ID)
    expect(receiptsTable[0].project_id).toBe(PROJECT_ID)
    expect(receiptsTable[0].command_digest).toBeDefined()
    expect(receiptsTable[0].result).toEqual({
      ok: true,
      upserted: 3,
      skipped: 0,
      unmatched_assignees: [],
      non_leaf_skipped: [],
      orders_created: 1,
    })
  })

  it('동일한 command_id와 동일한 내용으로 재전송 시 runWbsImport를 다시 부르지 않고 status: duplicate로 응답한다', async () => {
    const commandId = '00000000-0000-0000-7e57-000000000099'
    const body = {
      project_id: PROJECT_ID,
      module: 'MES',
      command_id: commandId,
      nodes: [{ id: 'T1', title: 'Task 1' }],
    }

    // 1회차 요청
    const firstReq = new NextRequest('http://l/api/v1/wbs/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dflow_pat_dummy',
      },
      body: JSON.stringify(body),
    })
    const firstRes = await importPOST(firstReq)
    expect(firstRes.status).toBe(200)
    expect(mocks.runWbsImport).toHaveBeenCalledTimes(1)
    expect(mocks.emitNotification).toHaveBeenCalledTimes(1)

    // 2회차 요청: 동일한 command_id와 동일한 내용
    const secondReq = new NextRequest('http://l/api/v1/wbs/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dflow_pat_dummy',
      },
      body: JSON.stringify(body),
    })
    const secondRes = await importPOST(secondReq)
    expect(secondRes.status).toBe(200)
    const secondJson = await secondRes.json()
    expect(secondJson.ok).toBe(true)
    expect(secondJson.status).toBe('duplicate')
    expect(secondJson.upserted).toBe(3)

    // runWbsImport와 알림은 추가로 호출되지 않음!
    expect(mocks.runWbsImport).toHaveBeenCalledTimes(1)
    expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
  })

  it('동일한 command_id로 다른 내용의 요청을 보내면 409 command_reused로 거부된다', async () => {
    const commandId = '00000000-0000-0000-7e57-000000000099'

    // 1회차 요청
    const body1 = {
      project_id: PROJECT_ID,
      module: 'MES',
      command_id: commandId,
      nodes: [{ id: 'T1', title: 'Task 1' }],
    }
    const firstReq = new NextRequest('http://l/api/v1/wbs/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dflow_pat_dummy',
      },
      body: JSON.stringify(body1),
    })
    await importPOST(firstReq)

    // 2회차 요청: 같은 command_id지만 다른 nodes 내용
    const body2 = {
      project_id: PROJECT_ID,
      module: 'MES',
      command_id: commandId,
      nodes: [{ id: 'T2', title: 'Task 2 - 다른 내용' }],
    }
    const secondReq = new NextRequest('http://l/api/v1/wbs/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dflow_pat_dummy',
      },
      body: JSON.stringify(body2),
    })
    const secondRes = await importPOST(secondReq)
    expect(secondRes.status).toBe(409)
    const secondJson = await secondRes.json()
    expect(secondJson.code).toBe('command_reused')
    expect(secondJson.error).toBe('이미 사용된 명령 ID입니다.')
  })

  it('command_id가 없으면 기존대로 실행되고 command_receipts에 저장하지 않는다', async () => {
    const req = new NextRequest('http://l/api/v1/wbs/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dflow_pat_dummy',
      },
      body: JSON.stringify({
        project_id: PROJECT_ID,
        module: 'MES',
        nodes: [{ id: 'T1', title: 'Task 1' }],
      }),
    })

    const res = await importPOST(req)
    expect(res.status).toBe(200)
    expect(mocks.runWbsImport).toHaveBeenCalledTimes(1)
    expect(receiptsTable.length).toBe(0)
  })
})
