// 회의록 team_id 계약(SP5 B2 — 스펙 §5.1 "회의록 team_id"·W36). 다섯 갈래를 한곳에서 본다:
//  ① 목록·탐색기는 team_id 를 싣고, 담당 필터는 team_id 로 거른다(code 가 아니다)
//  ② ?team=<code> 옛 링크는 code 단위로 한 번 해석해 id 로 리다이렉트한다(페이지 배선은 minutes-project-filter.test)
//  ③ 위키·AI 재색인 대상 — title·team·minute_date 가 바뀌면 다시 색인한다. 색인 본문은 팀 code 라(D18 — ai_documents.team 은 SP7 까지 code)
//     RPC 는 team_code 변화를 보고, team_id 를 바꾸는 모든 쓰기는 메아리 트리거가 team_code 를 함께 바꾼다
//  ④ 재편철(프로젝트 변경) — 메아리 트리거가 새 범위에서 team_id 를 다시 해석하고, 폴더는 같은 경로(팀 루트 칸 = code)를 새 트리에서 고른다
//  ⑤ 쓰기 길 — team_id 해석은 트리거 한 곳(수신 RPC 본문을 다시 쓰지 않는다)
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]>, rows: [] as unknown[] }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'gte', 'lte', 'or', 'order', 'limit', 'in']) q[m] = (...a: unknown[]) => { h.calls.push([m, a]); return q }
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(res)
      return q
    },
  }),
}))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectVocabs: async () => ({}) }))

import { getMinutesPage, searchMinutes } from '@/lib/data/minutes'
import { resolveTeamParam } from '@/lib/minutes/teamResolve'

const migration = (suffix: string) => {
  const dir = 'supabase/migrations'
  const f = readdirSync(dir).find((n) => n.endsWith(`_${suffix}.sql`))!
  return readFileSync(join(dir, f), 'utf8')
}
const T_QA = '00000000-0000-4000-8000-0000000000a1'

beforeEach(() => { h.calls = []; h.rows = [] })

describe('① 목록은 team_id 를 싣고 team_id 로 거른다', () => {
  it('select 에 team_id 가 있고 행의 team_id 를 Minute.teamId 로 옮긴다', async () => {
    h.rows = [{ id: 'm1', minute_date: '2026-10-01', team_code: 'QA', team_id: T_QA, title: 't', created_at: 'x', updated_at: 'x' }]
    const rows = await getMinutesPage('ws-x', null, '2026-10-01', '2026-10-31', T_QA)
    expect(rows[0]).toMatchObject({ teamCode: 'QA', teamId: T_QA })
    const select = h.calls.find(([m]) => m === 'select')![1][0] as string
    expect(select).toMatch(/\bteam_id\b/)
    expect(h.calls).toContainEqual(['eq', ['team_id', T_QA]])
    expect(h.calls.some(([m, a]) => m === 'eq' && a[0] === 'team_code')).toBe(false)
  })
  it('검색도 같다 — 필터가 없으면 거르지 않는다', async () => {
    await searchMinutes('ws-y', null, '주간', T_QA)
    expect(h.calls).toContainEqual(['eq', ['team_id', T_QA]])
    h.calls = []
    await searchMinutes('ws-z', null, '주간', null)
    expect(h.calls.some(([m, a]) => m === 'eq' && String(a[0]).startsWith('team'))).toBe(false)
  })
})

describe('② ?team= 해석(옛 code 링크 → id 리다이렉트)', () => {
  const teams = [{ id: T_QA, code: 'QA', projectId: null }]
  it('선택지의 id 는 그대로, code 는 id 로, 모르는 값은 파라미터 제거, 없으면 none', () => {
    expect(resolveTeamParam(T_QA.toUpperCase(), teams, { projectId: null })).toEqual({ kind: 'id', id: T_QA })
    expect(resolveTeamParam('QA', teams, { projectId: null })).toEqual({ kind: 'redirect', id: T_QA })
    expect(resolveTeamParam('NOPE', teams, { projectId: null })).toEqual({ kind: 'redirect', id: null })
    expect(resolveTeamParam('00000000-0000-4000-8000-0000000000ff', teams, { projectId: null })).toEqual({ kind: 'redirect', id: null })
    expect(resolveTeamParam(undefined, teams, { projectId: null })).toEqual({ kind: 'none' })
  })
})

describe('③ 재색인 대상 — title·team·minute_date', () => {
  it('메타 RPC 는 title·team_code·minute_date 변화를 색인 변경으로 본다', () => {
    const base = migration('baseline')
    const body = base.slice(base.indexOf('v_index_content_changed :='), base.indexOf(';', base.indexOf('v_index_content_changed :=')))
    for (const col of ['title', 'team_code', 'minute_date']) expect(body, col).toContain(`v_original_minute.${col} is distinct from v_minute.${col}`)
  })
  it('team_id 를 바꾸면 메아리 트리거가 team_code 를 함께 바꾼다 — RPC 의 team_code 판정이 팀 변경을 놓치지 않는다', () => {
    const sql = migration('minutes_teams')
    const echo = sql.slice(sql.indexOf('create function public.minutes_team_code_echo()'), sql.indexOf('create trigger minutes_team_code_echo'))
    expect(echo).toMatch(/new\.team_id is distinct from old\.team_id[\s\S]*new\.team_code := coalesce\(v_code, new\.team_code\)/)
    expect(sql).toMatch(/create trigger minutes_team_code_echo before insert or update on public\.minutes\s/)   // 열 목록 없음 — 모든 쓰기 길
  })
})

describe('④ 재편철 — 새 범위에서 team_id 를 다시 해석', () => {
  it('프로젝트·워크스페이스가 바뀌면 메아리 트리거가 code 단위로 다시 고른다', () => {
    const sql = migration('minutes_teams')
    expect(sql).toMatch(/elsif new\.project_id is distinct from old\.project_id or new\.workspace_id is distinct from old\.workspace_id then\s+new\.team_id := public\.minute_team_for_code\(v_ws, new\.project_id, new\.team_code\)/)
  })
})

describe('⑤ team_id 해석은 트리거 한 곳 — 앱은 team_id 를 쓰지 않는다', () => {
  it('src 의 minutes 쓰기(insert·update·RPC 인자)에 team_id 키가 없다', () => {
    // 폴더 루트의 team_id(minute_folders — folders.ts)는 회의록 쓰기가 아니라 대상 밖
    const files = ['src/app/actions/minutes.ts', 'src/app/api/v1/minutes/route.ts', 'src/app/api/v1/minutes/folder/route.ts']
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bp_team_id\b|\bteam_id\s*:/)
  })
})
