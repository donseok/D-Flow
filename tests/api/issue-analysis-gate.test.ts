// /api/issue-analysis 의 issues 관문(스펙 §4.2 세션 API 행, E16·P5) — 가드 → 관문 → 본문. 꺼지면 404 이고 저장된 분석 실행을 읽지 않는다.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ requireProjectMember: vi.fn(), loadSaved: vi.fn(), diag: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember: m.requireProjectMember }))
vi.mock('@/lib/auth', () => ({ getDisplayName: vi.fn(async () => 'alice') }))
vi.mock('@/lib/data/issueAnalysis', () => ({ loadSavedIssueAnalysisRun: m.loadSaved }))
vi.mock('@/lib/report/issues/export', async (orig) => ({ ...(await orig<typeof import('@/lib/report/issues/export')>()), getIssueAnalysisPptExportDiagnostic: m.diag }))
import { GET } from '@/app/api/issue-analysis/route'
import { ERR_DENIED, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { makeMemberActor } from '../fixtures/actor'

const PID = '00000000-0000-0000-7e57-000000001441', RUN = '00000000-0000-0000-7e57-000000001442'
const req = () => new NextRequest(`http://localhost/api/issue-analysis?projectId=${PID}&runId=${RUN}`)
beforeEach(() => {
  vi.clearAllMocks()
  m.requireProjectMember.mockResolvedValue({ ok: true, actor: makeMemberActor(PID) })
  m.diag.mockReturnValue({ status: 'unavailable', message: '렌더러 없음', code: 'RENDERER_UNAVAILABLE' })
})
// 관문 mock 값을 바꾸는 파일 — 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('/api/issue-analysis — issue_analysis 관문', () => {
  it('issue_analysis 가 꺼지면 404 · ERR_MODULE_DISABLED 이고 저장된 실행을 읽지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await GET(req())
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'issue_analysis')
    expect(m.loadSaved).not.toHaveBeenCalled(); expect(m.diag).not.toHaveBeenCalled()
  })
  it('가드가 거부하면 관문을 부르지 않는다', async () => {
    m.requireProjectMember.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect((await GET(req())).status).toBe(403)
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('켜져 있으면 기존 흐름(렌더러가 없으면 503)', async () => {
    expect((await GET(req())).status).toBe(503)
  })
})
