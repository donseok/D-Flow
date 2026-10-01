// 옛 경로 스텁(스펙 §5.3, D5·D6) — ① 본문 함수의 동작(세션·조회 mock) ② src/app/(legacy)/** 의 모든 route.ts 가 정본 전문 그대로이고 경로에 맞는 종류를 부른다.
import { existsSync, readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { walk } from '../invariants/_walk'

const h = vi.hoisted(() => ({ readCurrentWorkspace: vi.fn(), workspaceRefById: vi.fn(), getActorViewState: vi.fn(), createServerClient: vi.fn() }))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: h.readCurrentWorkspace }))
vi.mock('@/lib/workspace/resolve', () => ({ workspaceRefById: h.workspaceRefById }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))

import { legacyRedirect } from '@/lib/workspace/legacyStub'
import { LEGACY_ROUTES, type LegacyKind } from '@/lib/workspace/legacy'
import { makeActor } from '../fixtures/actor'

const ORIGIN = 'http://127.0.0.1:3201'
const MID = '00000000-0000-0000-7e57-000000001661'
const PID = '00000000-0000-0000-7e57-000000001662'
const WB = '00000000-0000-0000-7e57-000000001663'
const req = (path: string) => new NextRequest(new URL(path, ORIGIN))
function minuteRow(row: unknown, error: { message: string } | null = null) {
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: row, error }) }))
  return { eq, client: { from: () => ({ select: () => ({ eq }) }) } }
}
beforeEach(() => {
  vi.clearAllMocks()
  h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: 'wa', slug: 'acme', name: 'Acme' } })
  h.getActorViewState.mockResolvedValue({ actor: makeActor({ projectWorkspace: new Map([[PID, WB]]) }), degraded: false })
  h.workspaceRefById.mockResolvedValue({ ok: true, ws: { id: WB, slug: 'beta', name: 'Beta' } })
  h.createServerClient.mockResolvedValue(minuteRow(null).client)
})

/** Location 은 상대 경로(컨트롤러 W2 — 요청 원점·NEXT_PUBLIC_APP_URL 을 싣지 않는다) */
async function expectRedirect(kind: LegacyKind, path: string, location: string) {
  const res = await legacyRedirect(req(path), kind)
  expect(res.status).toBe(307)
  expect(res.headers.get('location')).toBe(location)
  expect(res.headers.get('cache-control')).toBe('no-store')
}

describe('legacyRedirect — 307·no-store·상대 Location', () => {
  it('목록형 — 현재 워크스페이스(쿠키 → 첫 소속), 쿼리 보존, _rsc 제거', async () => {
    await expectRedirect('meetings', '/meetings', '/w/acme/meetings')
    await expectRedirect('minutes', '/minutes?view=calendar&_rsc=1', '/w/acme/minutes?view=calendar')
    await expectRedirect('agents', '/agents', '/w/acme/agents')
    await expectRedirect('portfolio', '/portfolio', '/w/acme/portfolio')
    await expectRedirect('usage', '/usage?days=7&menu=a&menu=b', '/w/acme/usage?days=7&menu=a&menu=b')
    await expectRedirect('adminTeams', '/admin/teams', '/w/acme/admin/teams')
    await expectRedirect('projects', '/projects?q=%ED%95%9C', '/w/acme/projects?q=%ED%95%9C')
  })
  it('/minutes/<id> 는 행의 워크스페이스가 쿠키보다 앞선다(D6), ?block=·?version= 보존', async () => {
    const row = minuteRow({ workspace_id: WB, workspaces: { slug: 'beta' } })
    h.createServerClient.mockResolvedValue(row.client)
    await expectRedirect('minute', `/minutes/${MID}?block=3&version=v2`, `/w/beta/minutes/${MID}?block=3&version=v2`)
    expect(row.eq).toHaveBeenCalledWith('id', MID)
    expect(h.readCurrentWorkspace).not.toHaveBeenCalled()
  })
  it('/minutes/<id> 행을 못 읽으면(0행·오류·형식 밖 id·깨진 인코딩) 현재 워크스페이스로 — 거기서 페이지가 404(존재 은닉)', async () => {
    await expectRedirect('minute', `/minutes/${MID}`, `/w/acme/minutes/${MID}`)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(minuteRow(null, { message: 'down' }).client)
    await expectRedirect('minute', `/minutes/${MID}`, `/w/acme/minutes/${MID}`)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
    h.createServerClient.mockClear()
    await expectRedirect('minute', '/minutes/not-a-uuid', '/w/acme/minutes/not-a-uuid')
    await expectRedirect('minute', '/minutes/%E0%A4%A', '/w/acme/minutes/%E0%A4%A')
    expect(h.createServerClient).not.toHaveBeenCalled()
  })
  it('/admin/accounts?project= 는 그 프로젝트의 워크스페이스(아는 프로젝트일 때), 아니면 현재', async () => {
    await expectRedirect('adminAccounts', `/admin/accounts?project=${PID}`, `/w/beta/admin/accounts?project=${PID}`)
    expect(h.workspaceRefById).toHaveBeenCalledWith(WB)
    await expectRedirect('adminAccounts', '/admin/accounts?project=00000000-0000-0000-7e57-000000001669', '/w/acme/admin/accounts?project=00000000-0000-0000-7e57-000000001669')
    await expectRedirect('adminAccounts', '/admin/accounts?project=x', '/w/acme/admin/accounts?project=x')
  })
  it('간트(W1)·칸반은 슬러그 해석 없이 WBS 로', async () => {
    await expectRedirect('gantt', `/p/${PID}/gantt?scale=24`, `/p/${PID}/wbs?view=timeline&scale=24`)
    await expectRedirect('kanban', `/p/${PID}/kanban?view=phase`, `/p/${PID}/wbs?view=board&group=phase`)
    expect(h.readCurrentWorkspace).not.toHaveBeenCalled()
  })
  it('소속 0 → /, 소속 조회 오류 → /(리졸버가 오류를 그린다)', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: null })
    await expectRedirect('meetings', '/meetings?x=1', '/')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.readCurrentWorkspace.mockResolvedValue({ ok: false, error: 'down' })
    await expectRedirect('usage', '/usage', '/')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('Location 에 호스트가 없다 — NEXT_PUBLIC_APP_URL·요청 원점을 싣지 않는다(호스트가 바뀌면 쿠키를 잃어 로그인 고리)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    const res = await legacyRedirect(req('/meetings'), 'meetings')
    expect(res.headers.get('location')).toBe('/w/acme/meetings')
    expect(res.headers.get('location')).not.toMatch(/^https?:/)
    vi.unstubAllEnvs()
  })
})

/** 종류 → 스텁 파일. UI-2a 여덟 + 간트(W1), UI-2b 가 projects, UI-3 이 kanban */
const STUB_FILE: Readonly<Record<LegacyKind, string>> = {
  meetings: 'src/app/(legacy)/meetings/route.ts', minutes: 'src/app/(legacy)/minutes/route.ts', minute: 'src/app/(legacy)/minutes/[id]/route.ts',
  agents: 'src/app/(legacy)/agents/route.ts', portfolio: 'src/app/(legacy)/portfolio/route.ts', usage: 'src/app/(legacy)/usage/route.ts',
  adminAccounts: 'src/app/(legacy)/admin/accounts/route.ts', adminTeams: 'src/app/(legacy)/admin/teams/route.ts',
  projects: 'src/app/(legacy)/projects/route.ts', kanban: 'src/app/(legacy)/p/[projectId]/kanban/route.ts',
  gantt: 'src/app/(legacy)/p/[projectId]/gantt/route.ts',
}

/** 스텁 파일의 정본 전문(계획 V11) — 열거 게이트(tests/gates/_enumerate.ts)가 (legacy) route.ts 를 관문 열거에서 빼는 전제다.
 *  정규식 부분 일치는 `export const POST = …`·`export { h as POST }`·가드 없는 top-level 조회를 놓친다(U2a-3 리뷰 V2) — 전문을 대조해 닫는다 */
const stubTemplate = (kind: LegacyKind) => [
  "import { type NextRequest } from 'next/server'",
  "import { legacyRedirect } from '@/lib/workspace/legacyStub'",
  '',
  "export const dynamic = 'force-dynamic'",
  `export async function GET(req: NextRequest) { return legacyRedirect(req, '${kind}') }`,
  '',
].join('\n')
function stubShapeProblem(text: string, kind: LegacyKind): string | null {
  return text === stubTemplate(kind) ? null : `정본 전문과 다르다 — import 둘·dynamic·GET 한 줄만 둔다(다른 export·top-level 문장 금지)`
}

describe('src/app/(legacy)/** — 스텁 모양', () => {
  const files = existsSync('src/app/(legacy)') ? walk('src/app/(legacy)') : []
  it('(legacy) 아래에는 route.ts 만 있다(페이지·레이아웃을 두지 않는다)', () => {
    expect(files.filter((f) => !f.endsWith('/route.ts'))).toEqual([])
  })
  it('모든 route.ts 가 표의 파일이고 경로에 맞는 종류를 부르는 정본 전문 그대로다', () => {
    const byFile = new Map(Object.entries(STUB_FILE).map(([k, f]) => [f, k as LegacyKind]))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files.filter((x) => x.endsWith('route.ts'))) {
      const kind = byFile.get(f)
      expect(kind, `${f} 는 STUB_FILE 에 없다`).toBeDefined()
      expect(stubShapeProblem(readFileSync(f, 'utf8'), kind!), f).toBeNull()
    }
  })
  it('전문 대조의 민감도 — 다른 메서드(const·재수출)·top-level 조회·다른 종류는 거부한다', () => {
    const ok = stubTemplate('agents')
    expect(stubShapeProblem(ok, 'agents')).toBeNull()
    for (const bad of [
      `${ok}export const POST = async (req: NextRequest) => legacyRedirect(req, 'agents')\n`,
      `${ok}export { GET as POST }\n`,
      `${ok}export const revalidate = 0\n`,
      ok.replace("export const dynamic", "const rows = await createAdminClient().from('x').select('*')\nexport const dynamic"),
      ok.replace("legacyRedirect(req, 'agents') }", "legacyRedirect(req, 'agents') }\nexport async function POST() { return new Response() }"),
    ]) expect(stubShapeProblem(bad, 'agents'), bad).not.toBeNull()
    expect(stubShapeProblem(ok, 'usage')).not.toBeNull()
  })
  it('표의 옛 경로와 파일 경로가 맞는다', () => {
    for (const [kind, f] of Object.entries(STUB_FILE) as [LegacyKind, string][]) {
      expect(f, kind).toBe(`src/app/(legacy)${LEGACY_ROUTES[kind].oldPath}/route.ts`)
    }
  })
})
