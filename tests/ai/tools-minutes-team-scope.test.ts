import { describe, expect, it, vi } from 'vitest'

// SP2 Task 16a — search_minutes 의 담당팀은 조회 범위의 팀이어야 한다: 프로젝트를 주면 그 프로젝트의 팀, 아니면
// 호출자 워크스페이스들(context.workspaceIds)의 공용 팀. 옛 전역 접근자는 전 워크스페이스 합집합이라 남의 팀 코드가 통과했다.
vi.mock('@/lib/teams/master', () => ({
  activeTeamCodesSync: () => ['PMO', 'ERP', 'MES'],
  activeTeamCodesForWorkspaceSync: (wid: string) => (wid === 'ws-a' ? ['PMO'] : wid === 'ws-b' ? ['ERP'] : []),
  activeTeamCodesForProjectSync: (pid: string) => (pid === 'p1' ? ['MES'] : []),
}))
import { createSearchMinutesTool } from '@/lib/ai/tools/minutes'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import { repositoryOk, type MinuteSearchSnapshot, type MinutesRepository } from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  capabilities: ['minutes:read'],
  allowedProjectIds: ['p1'],
  workspaceIds: ['ws-a'],
  pageContext: null,
  now: '2026-09-26T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}
const repository = (): MinutesRepository => ({
  searchMinutes: vi.fn(async () => repositoryOk<MinuteSearchSnapshot>({ records: [], truncated: false })),
  getMinuteDetail: vi.fn(),
})

describe('search_minutes 담당팀 — 조회 범위의 팀만', () => {
  it('프로젝트 없이: 호출자 워크스페이스의 팀은 통과, 다른 워크스페이스의 팀은 INVALID_ARGUMENT', async () => {
    const repo = repository()
    const tool = createSearchMinutesTool(repo)
    await expect(tool.execute({ team: 'PMO', query: '설계' }, context)).resolves.toMatchObject({ ok: true })
    await expect(tool.execute({ team: 'ERP', query: '설계' }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_ARGUMENT' },
    })
    expect(repo.searchMinutes).toHaveBeenCalledTimes(1)
  })

  it('프로젝트를 주면 그 프로젝트의 팀으로 본다', async () => {
    const tool = createSearchMinutesTool(repository())
    await expect(tool.execute({ team: 'MES', projectId: 'p1', query: '설계' }, context)).resolves.toMatchObject({ ok: true })
    await expect(tool.execute({ team: 'PMO', projectId: 'p1', query: '설계' }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_ARGUMENT' },
    })
  })

  it('접근 판정이 먼저다 — 볼 수 없는 프로젝트의 팀 구성은 검증 결과로 새지 않는다', async () => {
    const tool = createSearchMinutesTool(repository())
    await expect(tool.execute({ team: 'QA', projectId: 'p9', query: '설계' }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'ACCESS_DENIED' },
    })
  })

  it('호출자 워크스페이스를 모르면(컨텍스트 누락) 담당팀 필터는 거절 — fail-closed', async () => {
    const tool = createSearchMinutesTool(repository())
    const { workspaceIds: _omit, ...withoutWorkspaces } = context
    void _omit
    await expect(tool.execute({ team: 'PMO', query: '설계' }, withoutWorkspaces)).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_ARGUMENT' },
    })
  })
})
