// branding.product_name 의 남은 소비처 셋(주간 브리핑 프롬프트·챗 v2 합성 프롬프트·wbs.md 검증 오류문)이 워크스페이스의 설정값을 쓴다(2026-10-10).
// 양성(그 워크스페이스의 이름이 실린다)과 격리(다른 워크스페이스의 이름이 새지 않고, 읽는 설정도 그 워크스페이스 하나)를 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const W_A = 'ws-a', W_B = 'ws-b'
const NAMES: Record<string, string> = { [W_A]: 'Acme Flow', [W_B]: 'Beta PM' }
const P_A = 'p-a', P_B = 'p-b'
const PROJECT_WS: Record<string, string> = { [P_A]: W_A, [P_B]: W_B }

const m = vi.hoisted(() => ({
  generateAnswer: vi.fn(), getWorkspaceConfig: vi.fn(), getSession: vi.fn(), createServerClient: vi.fn(), orchestrate: vi.fn(),
  adminFrom: vi.fn(), upserts: [] as Record<string, unknown>[], guard: vi.fn(), getProjectConfig: vi.fn(),
}))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: m.generateAnswer }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: () => true, hasEmbeddings: () => false, llmConfig: () => ({ model: 'test-model' }) }))
vi.mock('@/lib/supabase/env', () => ({ serviceRoleConfigured: () => true }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: m.adminFrom }) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))
vi.mock('@/lib/settings/projectConfig', async (orig) => ({ ...(await orig<object>()), getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/auth', () => ({ getSession: m.getSession }))
vi.mock('@/lib/authz', async (orig) => ({ ...(await orig<object>()), requireProjectAdmin: m.guard }))
vi.mock('@/lib/calendar/load', async (orig) => ({
  ...(await orig<object>()),
  resolveRequestCalendar: vi.fn(async () => (await import('../helpers/calendarFixture')).calSeoulMon),
  resolveMemberWorkspacesCalendar: vi.fn(async () => (await import('../helpers/calendarFixture')).calSeoulMon),
}))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())
vi.mock('@/lib/ai/chat/default-registry', async () => {
  const { EMPTY_CHAT_TOOL_REGISTRY } = await import('@/lib/ai/chat/registry')
  return { createDefaultChatToolRegistry: () => EMPTY_CHAT_TOOL_REGISTRY }
})
vi.mock('@/lib/ai/chat/orchestrator', async (orig) => {
  const actual = await orig<typeof import('@/lib/ai/chat/orchestrator')>()
  return { ...actual, orchestrateChatV2: (...a: Parameters<typeof actual.orchestrateChatV2>) => { m.orchestrate(...a); return actual.orchestrateChatV2(...a) } }
})

import { buildBriefFacts, ensureWeeklyBrief, weeklySystem, type BriefFactsInput } from '@/lib/ai/brief'
import { synthesisSystem, synthesizeWithConfiguredLlm } from '@/lib/ai/chat/orchestrator'
import { buildEvidencePack } from '@/lib/ai/chat/evidence'
import { parseWbsMarkdown, validateWbsDoc } from '@/lib/wbsmd/parse'
import { previewWbsUpload } from '@/app/actions/wbsMarkdown'
import { POST } from '@/app/api/chat/v2/stream/route'
import { BRAND } from '@/lib/branding'
import { calUtcSun } from '../helpers/calendarFixture'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

const configFor = async (wid: string) => ({ workspaceId: wid, keys: {
  'branding.product_name': { status: 'set', value: NAMES[wid] }, 'branding.mail_from_name': { status: 'default', value: null },
} })
const readWorkspaces = () => m.getWorkspaceConfig.mock.calls.map((c) => c[0])

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  m.upserts.length = 0
  m.getWorkspaceConfig.mockImplementation(configFor)
  m.getProjectConfig.mockImplementation(async (pid: string) => makeProjectConfig({}, { projectId: pid, workspaceId: PROJECT_WS[pid] ?? 'ws-none' }))
})

describe('주간 브리핑 프롬프트(src/lib/ai/brief.ts)', () => {
  const input = (name: string): BriefFactsInput => ({
    projectName: name, items: [], startDate: '2026-01-01', endDate: '2026-12-31', todayWbs: '2026-07-15', realToday: '2026-07-19',
    calendar: calUtcSun, snapshots: [], minuteSignals: [], meetings: [], meetingExceptions: [], milestoneKeywords: [], teams: ['PMO'],
  })
  /** service_role 대역 — projects 는 그 프로젝트의 워크스페이스를, project_ai_briefs 는 빈 캐시와 upsert 기록을 준다 */
  function admin(projectsError = false) {
    m.adminFrom.mockImplementation((table: string) => {
      const b: Record<string, unknown> = {}
      let pid = ''
      b.select = () => b
      b.eq = (col: string, v: string) => { if (col === 'id' || col === 'project_id') pid = v; return b }
      b.maybeSingle = async () => table === 'projects'
        ? (projectsError ? { data: null, error: { message: 'boom' } } : { data: PROJECT_WS[pid] ? { workspace_id: PROJECT_WS[pid] } : null, error: null })
        : { data: null, error: null }
      b.upsert = async (row: Record<string, unknown>) => { m.upserts.push(row); return { error: null } }
      return b
    })
  }
  const system = () => String(m.generateAnswer.mock.calls.at(-1)?.[0] ?? '')

  beforeEach(() => { m.generateAnswer.mockResolvedValue('이번 주 요약\n\n## 진행 현황\n- 항목') })

  it('프롬프트 틀은 이름만 바뀐다(나머지 글자는 그대로)', () => {
    expect(weeklySystem('Acme Flow').split('\n')[0]).toBe('너는 Acme Flow의 PM 보조다. [데이터] 블록의 수치·목록만 근거로 이번 주 프로젝트 브리핑을 한국어로 써라.')
    expect(weeklySystem(BRAND.productName)).toContain(`너는 ${BRAND.productName}의 PM 보조다.`)
  })

  it('양성 — 그 프로젝트의 워크스페이스가 정한 이름이 프롬프트에 실린다', async () => {
    admin()
    await ensureWeeklyBrief(P_A, buildBriefFacts(input('가')))
    expect(system()).toContain('너는 Acme Flow의 PM 보조다.')
    expect(readWorkspaces()).toEqual([W_A])
    expect(m.upserts).toHaveLength(1)                        // 생성·기록은 종전대로
  })

  it('격리 — 다른 워크스페이스의 프로젝트에는 그쪽 이름만(읽는 설정도 그 워크스페이스 하나)', async () => {
    admin()
    await ensureWeeklyBrief(P_B, buildBriefFacts(input('나')))
    expect(system()).toContain('너는 Beta PM의 PM 보조다.')
    expect(system()).not.toContain('Acme Flow')
    expect(readWorkspaces()).toEqual([W_B])
  })

  it('워크스페이스를 풀지 못하면 배포 기본 이름으로 생성한다(로그) — 다른 워크스페이스의 설정을 읽지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    admin(true)
    await ensureWeeklyBrief('p-unknown', buildBriefFacts(input('다')))
    expect(system()).toContain(`너는 ${BRAND.productName}의 PM 보조다.`)
    expect(m.getWorkspaceConfig).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('챗 v2 합성 프롬프트(src/lib/ai/chat/orchestrator.ts)', () => {
  const pack = buildEvidencePack([], '2026-10-10T00:00:00.000Z')
  const request = { message: '현황', history: [] } as never

  it('합성 입력의 productName 이 프롬프트 머리에 실린다 — 없으면 배포 기본 이름', async () => {
    m.generateAnswer.mockResolvedValue(null)
    await synthesizeWithConfiguredLlm({ request, evidence: pack, failedTools: [], productName: 'Acme Flow' })
    expect(String(m.generateAnswer.mock.calls.at(-1)?.[0])).toMatch(/^너는 Acme Flow의 읽기 전용 운영 코파일럿이다\./)
    await synthesizeWithConfiguredLlm({ request, evidence: pack, failedTools: [] })
    expect(String(m.generateAnswer.mock.calls.at(-1)?.[0])).toMatch(new RegExp(`^너는 ${BRAND.productName}의 읽기 전용 운영 코파일럿이다\\.`))
    expect(synthesisSystem('Beta PM')).not.toContain('Acme Flow')
  })

  describe('라우트 — 확인된 워크스페이스의 이름을 싣는다', () => {
    const withCount = (r: { data: unknown; error: unknown }) => (Array.isArray(r.data) ? { ...r, count: r.data.length } : r)
    /** 두 워크스페이스 소속 · 프로젝트는 워크스페이스마다 하나 */
    function client() {
      const tables: Record<string, { data: unknown; error: null }> = {
        platform_admins: { data: null, error: null },
        workspace_members: { data: [{ workspace_id: W_A, role: 'member' }, { workspace_id: W_B, role: 'member' }], error: null },
        project_members: { data: [], error: null },
        projects: { data: [{ id: P_A, workspace_id: W_A, is_private: false }, { id: P_B, workspace_id: W_B, is_private: false }], error: null },
      }
      const from = (table: string) => {
        const r = tables[table] ?? { data: null, error: null }
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
        b.maybeSingle = async () => r
        b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(withCount(r)).then(res, rej)
        return b
      }
      return { from, auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } } }) } }
    }
    const post = async (body: unknown) => {
      const res = await POST(new NextRequest('http://localhost/api/chat/v2/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      await res.text()
      return res
    }
    const deps = () => m.orchestrate.mock.calls.at(-1)?.[1] as { productName?: string } | undefined

    beforeEach(() => {
      vi.stubEnv('CHAT_V2_ENABLED', 'true')
      vi.stubEnv('CHAT_V2_LLM_SYNTHESIS_ENABLED', 'true')
      m.getSession.mockResolvedValue({ id: 'u1' })
      m.createServerClient.mockResolvedValue(client())
      m.generateAnswer.mockResolvedValue(null)
    })

    it('양성 — 프로젝트 요청은 그 프로젝트의 워크스페이스 이름', async () => {
      expect((await post({ projectId: P_A, message: '첨부파일 보여줘', history: [] })).status).toBe(200)
      expect(deps()?.productName).toBe('Acme Flow')
      expect(readWorkspaces()).toEqual([W_A])
    })

    it('격리 — 다른 워크스페이스의 프로젝트에는 그쪽 이름만(읽는 설정도 그 워크스페이스 하나)', async () => {
      expect((await post({ projectId: P_B, message: '첨부파일 보여줘', history: [] })).status).toBe(200)
      expect(deps()?.productName).toBe('Beta PM')
      expect(readWorkspaces()).toEqual([W_B])
    })

    it('요청이 다른 워크스페이스를 실어 와도 그 이름을 고르지 못한다 — 프로젝트와 어긋나면 관문이 404 로 닫는다', async () => {
      expect((await post({ projectId: P_A, workspaceId: W_B, message: '첨부파일 보여줘', history: [] })).status).toBe(404)
      expect(m.orchestrate).not.toHaveBeenCalled()
      expect(m.getWorkspaceConfig).not.toHaveBeenCalled()
    })

    it('합성을 쓰지 않으면 이름을 읽으러 가지 않는다', async () => {
      vi.stubEnv('CHAT_V2_LLM_SYNTHESIS_ENABLED', '')
      expect((await post({ projectId: P_A, message: '첨부파일 보여줘', history: [] })).status).toBe(200)
      expect(deps()).toBeDefined()
      expect(deps()?.productName).toBeUndefined()
      expect(m.getWorkspaceConfig).not.toHaveBeenCalled()
    })
  })
})

describe('wbs.md 검증 오류문(src/lib/wbsmd/parse.ts)', () => {
  const MD = `---
module: acme-qa
attach: PH-03/SYS-QA

levels:
  - { name: Phase,     prefix: PH,  progress: rollup, owner: pmo, upload: false }
  - { name: System,    prefix: SYS, progress: rollup, owner: pmo, upload: false }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: Task,      prefix: TSK, progress: input }
---

## SUB-QA-JD: 판정
- [x] TSK-QA-JD-01: 자동판정 50%   w:5  ~2026-12-19
`
  it('순수 파서 — 넘긴 이름을 쓰고, 넘기지 않으면 배포 기본 이름(종전 문구 그대로)', () => {
    const doc = parseWbsMarkdown(MD)
    const named = validateWbsDoc(doc, 'pl', 'Acme Flow').errors
    expect(named).toContain('TSK-QA-JD-01: 상태는 항상 [ ] — [x] 는 checklist 층 전용(전이 정본은 Acme Flow).')
    expect(named).toContain('TSK-QA-JD-01: 제목에 실적 % 금지 — 진도의 정본은 Acme Flow.')
    const dflt = validateWbsDoc(doc, 'pl').errors
    expect(dflt).toContain(`TSK-QA-JD-01: 상태는 항상 [ ] — [x] 는 checklist 층 전용(전이 정본은 ${BRAND.productName}).`)
    expect(dflt).toContain(`TSK-QA-JD-01: 제목에 실적 % 금지 — 진도의 정본은 ${BRAND.productName}.`)
  })

  describe('업로드 액션 — 가드 결과의 워크스페이스로 이름을 읽는다', () => {
    const actor = (pid: string) => ({ ok: true as const, actor: { userId: 'u1', isSuperuser: false, projectWorkspace: new Map(Object.entries(PROJECT_WS).filter(([p]) => p === pid)) } })
    beforeEach(() => {
      m.adminFrom.mockImplementation(() => {
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'in', 'like', 'limit', 'is', 'order', 'range']) b[k] = () => b
        b.maybeSingle = async () => ({ data: null, error: null })
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
        return b
      })
    })

    it('양성 — 미리보기의 오류문에 그 프로젝트 워크스페이스의 이름이 실린다', async () => {
      m.guard.mockResolvedValue(actor(P_A))
      const r = await previewWbsUpload(P_A, MD)
      expect(r.errors?.join('\n')).toContain('전이 정본은 Acme Flow')
      expect(readWorkspaces()).toEqual([W_A])
    })

    it('격리 — 다른 워크스페이스의 프로젝트에는 그쪽 이름만', async () => {
      m.guard.mockResolvedValue(actor(P_B))
      const r = await previewWbsUpload(P_B, MD)
      const text = r.errors?.join('\n') ?? ''
      expect(text).toContain('진도의 정본은 Beta PM')
      expect(text).not.toContain('Acme Flow')
      expect(readWorkspaces()).toEqual([W_B])
    })

    it('가드가 거부하면 이름을 읽지 않는다', async () => {
      m.guard.mockResolvedValue({ ok: false, error: '권한 없음' })
      expect((await previewWbsUpload(P_A, MD)).ok).toBe(false)
      expect(m.getWorkspaceConfig).not.toHaveBeenCalled()
    })
  })
})
