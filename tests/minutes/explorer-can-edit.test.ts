// 탐색기 리프의 canEdit(SP5 B2 — D40): 서버 canEditMinute 를 회의록 행의 project_id 그대로 판정한다. 리프의 projectId 는 회의 폴백이
// 섞인 귀속 프로젝트라 그것으로 판정하면 연결 회의 프로젝트의 관리자에게 이동·일괄 지정 어포던스가 열리고 서버가 거부한다.
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ byTable: {} as Record<string, unknown[]> }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'or', 'order', 'limit', 'in']) q[m] = () => q
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.byTable[t] ?? [], error: null }).then(res)
      return q
    },
  }),
}))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectVocabs: async () => ({}) }))

import { getMinutesExplorer } from '@/lib/data/minutes'
import { makeActor } from '../fixtures/actor'

const WS = 'ws-ce', P_MEET = 'p-meet', P_OWN = 'p-own'
const row = (id: string, created_by: string, project_id: string | null, meetingProject: string | null) => ({
  id, minute_date: '2026-10-01', team_code: 'QA', team_id: null, title: id, meeting_id: meetingProject ? 'mt' : null, project_id, workspace_id: WS,
  archived_at: null, created_by, created_by_name: null, created_at: 'x', updated_at: 'x', body_preview: '', folder_id: null,
  minute_files: [{ count: 0 }], meetings: meetingProject ? { category: 'general', project_id: meetingProject } : null, projects: null,
})

describe('getMinutesExplorer — 리프 canEdit = canEditMinute(회의록의 project_id)', () => {
  it('회의 폴백 프로젝트의 관리자는 고칠 수 없다(무프로젝트 회의록은 작성자·플랫폼 관리자만), 그 회의록 프로젝트의 관리자는 고친다', async () => {
    h.byTable = { minutes: [row('m-fallback', 'u-x', null, P_MEET), row('m-own', 'u-x', P_OWN, null), row('m-mine', 'u-me', P_OWN, null)], minute_folders: [] }
    const meetAdmin = makeActor({ userId: 'u-me', workspaceRoles: new Map([[WS, 'member']]), projectRoles: new Map([[P_MEET, 'admin'], [P_OWN, 'member']]), projectWorkspace: new Map([[P_MEET, WS], [P_OWN, WS]]) })
    const data = await getMinutesExplorer(WS, null, meetAdmin)
    const can = Object.fromEntries(data!.leaves.map((l) => [l.id, l.canEdit]))
    expect(can).toEqual({ 'm-fallback': false, 'm-own': false, 'm-mine': true })
    expect(data!.leaves.find((l) => l.id === 'm-fallback')!.projectId).toBe(P_MEET)   // 귀속 프로젝트는 회의 폴백 그대로(표시용)
    const ownAdmin = makeActor({ userId: 'u-other', workspaceRoles: new Map([[WS, 'member']]), projectRoles: new Map([[P_OWN, 'admin']]), projectWorkspace: new Map([[P_OWN, WS]]) })
    const data2 = await getMinutesExplorer('ws-ce-2', null, ownAdmin)   // 다른 워크스페이스 인자 — react cache 키를 가른다(행은 같은 표본)
    expect(Object.fromEntries(data2!.leaves.map((l) => [l.id, l.canEdit]))).toEqual({ 'm-fallback': false, 'm-own': true, 'm-mine': true })
  })
  it('행위자가 없으면 전부 거짓(fail-closed)', async () => {
    h.byTable = { minutes: [row('m-mine', 'u-me', P_OWN, null)], minute_folders: [] }
    const data = await getMinutesExplorer('ws-ce-3', null, null)
    expect(data!.leaves.every((l) => l.canEdit === false)).toBe(true)
  })
})
