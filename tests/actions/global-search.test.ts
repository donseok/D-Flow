import { describe, expect, it, vi, beforeEach } from 'vitest'
import { searchTitles } from '@/app/actions/globalSearch'

const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({
    from: mockFrom,
  })),
}))

describe('searchTitles server action (개정 §5.3.7, UX-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('빈 쿼리이거나 공백만 있는 경우 빈 결과를 즉시 반환한다', async () => {
    const res1 = await searchTitles({
      workspaceId: 'ws-1',
      query: '   ',
      scope: 'workspace',
    })
    expect(res1.ok).toBe(true)
    expect(res1.projects).toEqual([])
    expect(res1.wbsItems).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('특수문자만 있는 경우 빈 결과를 반환한다', async () => {
    const res = await searchTitles({
      workspaceId: 'ws-1',
      query: '%,_()',
      scope: 'workspace',
    })
    expect(res.ok).toBe(true)
    expect(res.projects).toEqual([])
    expect(res.wbsItems).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('워크스페이스 스코프에서 프로젝트와 WBS 항목을 모두 검색한다', async () => {
    const mockSelectProjects = vi.fn().mockReturnThis()
    const mockEqProjects = vi.fn().mockReturnThis()
    const mockIlikeProjects = vi.fn().mockReturnThis()
    const mockLimitProjects = vi.fn().mockResolvedValue({
      data: [{ id: 'p-1', name: 'Alpha Project' }],
      error: null,
    })

    const mockSelectWbs = vi.fn().mockReturnThis()
    const mockOrWbs = vi.fn().mockReturnThis()
    const mockLimitWbs = vi.fn().mockResolvedValue({
      data: [{ id: 'w-1', code: '1.1', name: 'Alpha Design', project_id: 'p-1' }],
      error: null,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'projects') {
        return {
          select: mockSelectProjects,
          eq: mockEqProjects,
          ilike: mockIlikeProjects,
          limit: mockLimitProjects,
        }
      }
      if (table === 'wbs_items') {
        return {
          select: mockSelectWbs,
          or: mockOrWbs,
          limit: mockLimitWbs,
        }
      }
      return {}
    })

    const res = await searchTitles({
      workspaceId: 'ws-1',
      query: 'Alpha',
      scope: 'workspace',
    })

    expect(res.ok).toBe(true)
    expect(res.projects).toHaveLength(1)
    expect(res.projects[0].name).toBe('Alpha Project')
    expect(res.wbsItems).toHaveLength(1)
    expect(res.wbsItems[0].title).toBe('Alpha Design')
    expect(res.wbsItems[0].code).toBe('1.1')
    expect(res.wbsItems[0].href).toBe('/p/p-1/wbs?focus=w-1')
  })

  it('프로젝트 스코프에서는 프로젝트 쿼리를 건너뛰고 해당 프로젝트의 WBS만 검색한다', async () => {
    const mockSelectWbs = vi.fn().mockReturnThis()
    const mockOrWbs = vi.fn().mockReturnThis()
    const mockEqWbs = vi.fn().mockReturnThis()
    const mockLimitWbs = vi.fn().mockResolvedValue({
      data: [{ id: 'w-2', code: '2.0', name: 'Beta Task', project_id: 'p-2' }],
      error: null,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'wbs_items') {
        return {
          select: mockSelectWbs,
          or: mockOrWbs,
          eq: mockEqWbs,
          limit: mockLimitWbs,
        }
      }
      return {}
    })

    const res = await searchTitles({
      workspaceId: 'ws-1',
      projectId: 'p-2',
      query: 'Beta',
      scope: 'project',
    })

    expect(res.ok).toBe(true)
    expect(res.projects).toHaveLength(0) // 프로젝트 스코프에서는 프로젝트 검색 없음
    expect(res.wbsItems).toHaveLength(1)
    expect(res.wbsItems[0].title).toBe('Beta Task')
  })
})
