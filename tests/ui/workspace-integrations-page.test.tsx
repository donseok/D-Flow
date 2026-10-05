import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  redirect: vi.fn((to: string): never => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  createAdminClient: vi.fn(),
  manager: vi.fn<(props: Record<string, unknown>) => ReactNode>(() => <div id="mock-credentials-manager" />),
}))

vi.mock('@/lib/settings/workspacePageAccess', () => ({
  workspacePageAccess: (...a: unknown[]) => mocks.access(...a),
}))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock('@/components/settings/IntegrationCredentialsManager', () => ({
  IntegrationCredentialsManager: (props: Record<string, unknown>) => mocks.manager(props),
}))

import WorkspaceIntegrationsPage from '@/app/(app)/w/[slug]/settings/integrations/page'

const WID = '00000000-0000-0000-7e57-000000000001'

describe('/w/[slug]/settings/integrations 페이지', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.access.mockResolvedValue({
      id: WID,
      slug: 'my-org',
      name: 'My Org',
      isAdmin: true,
      isSuperuser: false,
    })

    const makeQuery = (data: unknown[]) => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data, error: null }),
        }),
      }),
    })

    mocks.createAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'projects') {
          return makeQuery([{ id: 'p1', name: '프로젝트 1' }])
        }
        if (table === 'teams') {
          return makeQuery([{ id: 't1', code: 'DEV', name: '개발팀' }])
        }
        return makeQuery([])
      },
    })
  })

  it('비관리자 접근 시 워크스페이스 홈으로 리다이렉트된다', async () => {
    mocks.access.mockResolvedValueOnce({
      id: WID,
      slug: 'my-org',
      name: 'My Org',
      isAdmin: false,
      isSuperuser: false,
    })

    await expect(
      WorkspaceIntegrationsPage({ params: Promise.resolve({ slug: 'my-org' }) }),
    ).rejects.toThrow('NEXT_REDIRECT /w/my-org')
  })

  it('관리자 접근 시 프로젝트 및 팀 목록을 주입하여 매니저 컴포넌트를 렌더링한다', async () => {
    const page = await WorkspaceIntegrationsPage({ params: Promise.resolve({ slug: 'my-org' }) })
    const out = renderToStaticMarkup(page as ReactElement)

    expect(out).toContain('mock-credentials-manager')
    expect(mocks.manager).toHaveBeenCalledTimes(1)
    const props = mocks.manager.mock.calls[0][0] as {
      workspaceId: string
      projects: Array<{ id: string; name: string }>
      teams: Array<{ id: string; code: string; name: string }>
    }
    expect(props.workspaceId).toBe(WID)
    expect(props.projects).toEqual([{ id: 'p1', name: '프로젝트 1' }])
    expect(props.teams).toEqual([{ id: 't1', code: 'DEV', name: '개발팀' }])
  })
})
