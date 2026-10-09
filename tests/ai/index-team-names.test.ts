// 색인 본문의 팀 표기(팀 유연화 1단계) — 화면이 팀 이름을 보이므로 본문도 `이름 (code)` 로 적는다(이름으로 묻는 검색이 맞게).
// code 는 함께 남는다(엑셀·옛 표기로 묻는 검색). 문서의 team 열(필터 키)은 code 그대로다.
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/settings/projectConfig', () => ({
  getProjectConfig: vi.fn(async (projectId: string) => ({ projectId, workspaceId: 'ws-1', revision: 1, keys: {} })),
}))
vi.mock('@/lib/ai/embeddings', async (orig) => ({ ...(await orig<Record<string, unknown>>()), embedDocuments: vi.fn(async () => null) }))

import { createSupabaseIndexContentLoader } from '@/lib/ai/index/content'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const WBS_ID = '22222222-2222-4222-8222-222222222222'
const MINUTE_ID = '55555555-5555-4555-8555-555555555555'

type Response = { data: unknown; error: unknown }
function client(table: string, response: Response) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) b[m] = vi.fn(() => b)
  b.maybeSingle = vi.fn(async () => response)
  b.then = (res: (v: Response) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(response).then(res, rej)
  const empty = { ...b, maybeSingle: vi.fn(async () => ({ data: null, error: null })) }
  return { client: { from: vi.fn((t: string) => (t === table ? b : empty)), rpc: vi.fn() } as never, builder: b }
}
const job = (entityType: string, domain: string, entityId: string) =>
  ({ id: 'job-1', projectId: PROJECT, workspaceId: null, domain, entityType, entityId, operation: 'upsert', attempts: 0 }) as never
const textOf = (r: unknown) => {
  const res = r as { ok: boolean; data: { documents: Array<{ content: string; team: string | null }> } | null }
  expect(res.ok).toBe(true)
  return { text: res.data!.documents.map((d) => d.content).join('\n'), team: res.data!.documents[0]?.team }
}

describe('WBS 항목 — 담당팀 줄', () => {
  const row = (owners: unknown[]) => ({
    id: WBS_ID, project_id: PROJECT, code: 'W-1', name: '요구사항 정리', biz: null, deliverable: null,
    planned_start: null, planned_end: null, actual_pct: 10, updated_at: '2026-10-01T00:00:00Z', custom: {}, item_owners: owners,
  })
  it('팀을 `이름 (code)` 로 적는다 — 이름이 code 와 같으면 한 번만. 문서의 team(필터 키)은 주관 팀의 code', async () => {
    const { client: c, builder } = client('wbs_items', { data: row([
      { kind: 'primary', teams: { code: 'TEAM_A', name: '기획팀' } },
      { kind: 'support', teams: { code: 'OPS', name: 'OPS' } },
    ]), error: null })
    const { text, team } = textOf(await createSupabaseIndexContentLoader(c)(job('wbs_item', 'wbs', WBS_ID)))
    expect(text).toContain('담당팀: 기획팀 (TEAM_A), OPS')
    expect(team).toBe('TEAM_A')
    // 이름을 읽어 온다
    expect(String((builder.select as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('item_owners(kind, teams(code, name))')
  })
  it('이름을 못 읽은 팀은 code 만 — 줄이 깨지지 않는다 · 같은 팀의 주관·지원 두 행은 한 번만', async () => {
    const { client: c } = client('wbs_items', { data: row([
      { kind: 'primary', teams: { code: 'TEAM_A' } },
      { kind: 'primary', teams: [{ code: 'TEAM_B', name: '품질관리' }] },
      { kind: 'support', teams: [{ code: 'TEAM_B', name: '품질관리' }] },
    ]), error: null })
    expect(textOf(await createSupabaseIndexContentLoader(c)(job('wbs_item', 'wbs', WBS_ID))).text).toContain('담당팀: TEAM_A, 품질관리 (TEAM_B)')
  })
})

describe('회의록 — 팀 줄', () => {
  const row = (over: Record<string, unknown>) => ({
    id: MINUTE_ID, minute_date: '2026-10-02', team_code: 'TEAM_A', title: '주간 회의', body_md: '결정: 일정을 유지한다',
    project_id: PROJECT, archived_at: null, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T01:00:00Z', meetings: null, ...over,
  })
  it('지금의 팀 이름을 병기한다(minutes.team_id 의 팀) — code 는 회의록의 사본 열, 문서의 team 은 code 그대로', async () => {
    const { client: c, builder } = client('minutes', { data: row({ team: { name: '기획팀' } }), error: null })
    const { text, team } = textOf(await createSupabaseIndexContentLoader(c)(job('minute', 'minutes', MINUTE_ID)))
    expect(text).toContain('팀: 기획팀 (TEAM_A)')
    expect(team).toBe('TEAM_A')
    expect(String((builder.select as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('team:teams(name)')
  })
  it('팀 행이 없거나(team_id null) 이름이 code 와 같으면 code 한 번만', async () => {
    for (const team of [null, undefined, { name: 'TEAM_A' }, []]) {
      const { client: c } = client('minutes', { data: row({ team }), error: null })
      const { text } = textOf(await createSupabaseIndexContentLoader(c)(job('minute', 'minutes', MINUTE_ID)))
      expect(text).toContain('팀: TEAM_A\n')
      expect(text).not.toContain('(TEAM_A)')
    }
  })
})
