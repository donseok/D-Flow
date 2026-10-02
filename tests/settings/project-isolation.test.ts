// P1-AC4 의 해석기·액션 층(개정 §2.11 ④) — A·B 를 번갈아·동시에 읽고 써도 B 의 config 가 같다. 개인 설정은 해석에 들어가지 않는다.
// src/lib/settings/** 에 모듈 수준 Map·전역 캐시가 없다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
const h = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), requireWorkspaceAdmin: vi.fn(), adminFor: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.requireProjectAdmin, requireWorkspaceAdmin: h.requireWorkspaceAdmin }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/agent/ensureOrder', () => ({ backfillProjectOrders: vi.fn() }))
import { updateProjectSettings } from '@/app/actions/settings'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { makeActor } from '../fixtures/actor'

const A = '00000000-0000-4000-8000-00000000aa01', B = '00000000-0000-4000-8000-00000000aa02', WID = '00000000-0000-4000-8000-00000000bb01'
let db: FakeSettingsDb
beforeEach(() => {
  db = new FakeSettingsDb().addWorkspace({ id: WID, values: { 'modules.allowed': ['kanban'] } })
    .addProject({ id: A, workspaceId: WID, values: { 'core.level_labels': ['A1', 'A2'], 'modules.enabled': ['kanban'] } })
    .addProject({ id: B, workspaceId: WID, values: { 'core.level_labels': ['B1'], 'core.milestone_keywords': ['b'], 'modules.enabled': [] } })
  h.adminFor.mockImplementation((s: Record<string, string>) => ({ ...s, admin: db.client() }))
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeActor({ userId: 'u' }) })
})
const snapshot = async (pid: string) => { const c = await getProjectConfig(pid, { client: db.client() as never }); return JSON.stringify({ keys: c.keys, revision: c.revision, unknownKeys: c.unknownKeys }) }
const cmd = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

describe('프로젝트 격리', () => {
  it('A 를 번갈아 쓰는 동안 B 의 config·revision·이력이 그대로다', async () => {
    const b0 = await snapshot(B); const bHist = db.history.filter((x) => x.project_id === B).length
    for (let i = 0; i < 5; i++) {
      const r = await updateProjectSettings(A, { expectedRevision: i, commandId: cmd(i + 1), set: { 'core.extra_axis_label': `t${i}` }, unset: [] })
      expect(r).toMatchObject({ ok: true, revision: i + 1 })
      expect(await snapshot(B)).toBe(b0)
    }
    expect(db.history.filter((x) => x.project_id === B)).toHaveLength(bHist)
  })
  it('A·B 를 동시에 써도 각자의 revision 만 오른다', async () => {
    const [ra, rb] = await Promise.all([
      updateProjectSettings(A, { expectedRevision: 0, commandId: cmd(11), set: { 'core.milestone_keywords': ['a'] }, unset: [] }),
      updateProjectSettings(B, { expectedRevision: 0, commandId: cmd(12), set: { 'core.milestone_keywords': ['bb'] }, unset: [] }),
    ])
    expect(ra).toMatchObject({ ok: true, revision: 1 }); expect(rb).toMatchObject({ ok: true, revision: 1 })
    expect(db.projects.get(A)!.values['core.milestone_keywords']).toEqual(['a']); expect(db.projects.get(B)!.values['core.milestone_keywords']).toEqual(['bb'])
  })
})

describe('정적 — 캐시와 개인 설정', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [] })
  // 팀 원천은 요청 범위 캐시만 둔다(스펙 §4.2.1) — SP4 B 가 옛 프로세스 캐시를 지워 src/lib/teams/** 전체에 건다(재검토 B P3-7)
  const TEAM_FILES = walk('src/lib/teams')
  const files = [...walk('src/lib/settings'), ...walk('src/lib/modules'), ...TEAM_FILES]
  it('모듈 수준 Map·Set 캐시와 globalThis 가 없다(요청 밖 캐시 금지 — 스펙 §3.5)', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      // 대문자 상수 이름(BY_ID·PROJECT_TOGGLABLE 등)은 불변 색인이라 예외다
      const topLevelMaps = src.split('\n').filter((l) => /^(export )?(const|let|var) \w+.*= new (Map|WeakMap|Set)\b/.test(l) && !/^(export )?const [A-Z_]+\s*[:=]/.test(l))
      expect(topLevelMaps, f).toEqual([])
      expect(src.includes('globalThis'), f).toBe(false)
    }
  })
  it('해석기·모듈 판정은 개인 설정(UiPrefs·user_preferences)을 읽지 않는다', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(/UiPrefs|user_preferences|@\/lib\/prefs|api\/prefs/.test(src), f).toBe(false)
    }
  })
  it('팀 원천에는 모듈 수준 let·var 상태가 없다(요청 범위 cache 하나 — 스펙 §4.2.1)', () => {
    expect(TEAM_FILES.length).toBeGreaterThan(0)
    for (const f of TEAM_FILES) {
      const lines = readFileSync(f, 'utf8').split('\n').filter((l) => /^(export )?(let|var) /.test(l))
      expect(lines, f).toEqual([])
    }
  })
})
