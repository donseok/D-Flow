import { beforeEach, describe, expect, it, vi } from 'vitest'

// SP2 Task 16b 리뷰 — 담당팀 검증은 프로젝트 접근 판정 뒤에 한다(심층 방어). 먼저 보면 볼 수 없는 프로젝트의 팀 구성이
// 검증 결과(INVALID_ARGUMENT vs ACCESS_DENIED)로 새고, 그 전에 service_role 팀 캐시를 읽는다. weekly·minutes 와 같은 순서.
const activeTeamCodesForProjectSync = vi.hoisted(() => vi.fn<(projectId: string) => string[]>(() => ['PMO']))
vi.mock('@/lib/teams/master', () => ({ activeTeamCodesForProjectSync }))

import { createGetAttendanceTool } from '@/lib/ai/tools/attendance'
import { createGetKanbanViewTool } from '@/lib/ai/tools/kanban'
import { createFindWbsItemsTool } from '@/lib/ai/tools/wbs'
import { createGetMemberWorkloadTool, createListMembersTool } from '@/lib/ai/tools/members'
import type { ReadOnlyBotTool, ToolExecutionContext } from '@/lib/ai/tools/types'
import type {
  AttendanceRepository, MemberRepository, WbsBotRepository,
} from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  capabilities: ['attendance:read', 'kanban:read', 'wbs:read', 'members:read'],
  allowedProjectIds: ['p1'],
  workspaceIds: ['ws-a'],
  pageContext: null,
  now: '2026-09-26T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}
const unreachable = () => { throw new Error('접근 거부 뒤 저장소에 닿으면 안 된다') }
const wbs = { getProjectSnapshot: vi.fn(unreachable) } as unknown as WbsBotRepository
const members = { listMembers: vi.fn(unreachable) } as unknown as MemberRepository
const attendance: AttendanceRepository = { listRecords: vi.fn(unreachable) }

const TOOLS: Array<[string, ReadOnlyBotTool<unknown>, Record<string, unknown>]> = [
  ['get_attendance', createGetAttendanceTool(attendance), { from: '2026-09-01', to: '2026-09-26' }],
  ['get_kanban_view', createGetKanbanViewTool(wbs), {}],
  ['find_wbs_items', createFindWbsItemsTool(wbs), {}],
  ['list_members', createListMembersTool(members), {}],
  ['get_member_workload', createGetMemberWorkloadTool(members, wbs), {}],
]

beforeEach(() => { vi.clearAllMocks() })

describe.each(TOOLS)('%s — 볼 수 없는 프로젝트는 팀 검증 전에 ACCESS_DENIED', (_name, tool, extra) => {
  it('모르는 팀 코드여도 ACCESS_DENIED 이고, 팀 캐시를 읽지 않는다', async () => {
    await expect(tool.execute({ projectId: 'p-other-ws', team: '남의팀', ...extra }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'ACCESS_DENIED' },
    })
    expect(activeTeamCodesForProjectSync).not.toHaveBeenCalled()
  })

  it('있는 팀 코드여도 같은 ACCESS_DENIED — 응답으로 팀 구성을 가를 수 없다', async () => {
    await expect(tool.execute({ projectId: 'p-other-ws', team: 'PMO', ...extra }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'ACCESS_DENIED' },
    })
    expect(activeTeamCodesForProjectSync).not.toHaveBeenCalled()
  })

  it('볼 수 있는 프로젝트의 모르는 팀은 여전히 INVALID_ARGUMENT', async () => {
    await expect(tool.execute({ projectId: 'p1', team: '남의팀', ...extra }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_ARGUMENT', message: '알 수 없는 담당팀입니다.' },
    })
    expect(activeTeamCodesForProjectSync).toHaveBeenCalledWith('p1')
  })
})
