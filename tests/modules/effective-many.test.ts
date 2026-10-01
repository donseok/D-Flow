import { describe, expect, it, vi } from 'vitest'
import { effectiveModules } from '@/lib/modules/effective'
import { effectiveModulesMany } from '@/lib/modules/effectiveMany'
import type { ConfigReadClient } from '@/lib/settings/projectConfig'

const WS = '00000000-0000-0000-7e57-000000001631', WS2 = '00000000-0000-0000-7e57-000000001632'
const P1 = '00000000-0000-0000-7e57-000000001633', P2 = '00000000-0000-0000-7e57-000000001634', P3 = '00000000-0000-0000-7e57-000000001635'
type Row = Record<string, unknown>
/** 해석기 셋(workspace_settings·project_settings·project_areas·teams)이 쓰는 체인만 — eq/in/or/order/range/maybeSingle/select(count) */
function fakeClient(tables: Record<string, Row[]>, calls: string[]): ConfigReadClient {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      let counted = false
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string }) => { counted = !!o?.count; calls.push(`${table}.select`); return q },
        eq: (c: string, v: unknown) => { rows = rows.filter((r) => (c.includes('.') ? (r[c.split('.')[0]] as Row)?.[c.split('.')[1]] : r[c]) === v); return q },
        in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q },
        or: () => q, order: () => q,
        range: (a: number, b: number) => Promise.resolve({ data: rows.slice(a, b + 1), error: null, count: counted ? rows.length : null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (r: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(r),
      }
      return q
    },
  } as unknown as ConfigReadClient
}
const wsRow = (id: string, values: Row) => ({ workspace_id: id, values, revision: 1, schema_version: 1 })
const pRow = (pid: string, wid: string, values: Row) => ({ project_id: pid, values, revision: 1, schema_version: 1, projects: { workspace_id: wid } })

describe('effectiveModulesMany = 프로젝트마다 effectiveModules(D39)', () => {
  const tables = {
    workspace_settings: [wsRow(WS, { 'modules.allowed': ['issues', 'meetings', 'agents', 'kanban', 'minutes'] })],
    project_settings: [
      pRow(P1, WS, { 'modules.enabled': ['issues', 'meetings'] }),
      pRow(P2, WS, { 'modules.enabled': ['agents'] }),         // agents → wbs(core) 닫힘
      pRow(P3, WS2, { 'modules.enabled': ['issues'] }),        // CR-5 — 다른 워크스페이스
    ],
    project_areas: [], teams: [],
  }
  it('같은 값 — 픽스처 둘', async () => {
    const calls: string[] = []
    const client = fakeClient(tables, calls)
    const many = await effectiveModulesMany(WS, [P1, P2], { client })
    for (const pid of [P1, P2]) {
      const one = await effectiveModules({ workspaceId: WS, projectId: pid }, { client: fakeClient(tables, []) })
      expect([...many.sets.get(pid)!].sort(), pid).toEqual([...one].sort())
    }
    expect(many.failed).toEqual([])
    expect(calls.filter((c) => c === 'workspace_settings.select')).toHaveLength(1)
    expect(calls.filter((c) => c === 'project_settings.select')).toHaveLength(1)
  })
  it('CR-5 — 프로젝트의 워크스페이스가 인자와 다르면 effectiveModules 는 던지고, Many 는 그 프로젝트를 failed 로', async () => {
    await expect(effectiveModules({ workspaceId: WS, projectId: P3 }, { client: fakeClient(tables, []) })).rejects.toThrow()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const many = await effectiveModulesMany(WS, [P1, P3], { client: fakeClient(tables, []) })
    expect(many.sets.has(P3)).toBe(false); expect(many.failed).toEqual([P3])
    err.mockRestore()
  })
  it('modules.enabled 손상·행 없음은 그 프로젝트만 failed, 워크스페이스 설정 실패는 throw', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = { ...tables, project_settings: [pRow(P1, WS, { 'modules.enabled': 'oops' })] }
    const many = await effectiveModulesMany(WS, [P1, P2], { client: fakeClient(bad, []) })
    expect(many.failed.sort()).toEqual([P1, P2].sort())
    await expect(effectiveModulesMany(WS, [P1], { client: fakeClient({ ...tables, workspace_settings: [] }, []) })).rejects.toThrow()
    err.mockRestore()
  })
  it('빈 목록은 조회 없이 빈 결과', async () => {
    const calls: string[] = []
    await expect(effectiveModulesMany(WS, [], { client: fakeClient(tables, calls) })).resolves.toEqual({ sets: new Map(), failed: [] })
    expect(calls).toEqual([])
  })
})
