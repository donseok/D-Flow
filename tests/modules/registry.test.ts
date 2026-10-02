// 모듈 레지스트리(정본 §3.2.1·§3.2.2, 개정 §2.7.1) — 17개 정적 목록, 적재 단언, import 방향, 설정 소유.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CORE, LEGACY_GLOBAL_PREFIXES, MODULES, assertModules, moduleDef } from '@/lib/modules/registry'
import { CORE_MODULES, MODULE_IDS, NON_CORE_MODULES, PROJECT_TOGGLABLE, WORKSPACE_SCOPED } from '@/lib/modules/defaults'
import { closeRequires, missingRequires } from '@/lib/modules/closure'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { BOT_DOMAINS } from '@/lib/ai/chat/protocol'

const byId = Object.fromEntries(MODULES.map((m) => [m.id, m]))
const req = (id: Parameters<typeof moduleDef>[0]) => moduleDef(id).requires

describe('목록', () => {
  it('17개, MODULE_IDS 순서, 필드는 정확히 10개', () => {
    expect(MODULES.map((m) => m.id)).toEqual([...MODULE_IDS])
    for (const m of MODULES) expect(Object.keys(m).sort(), m.id).toEqual(['apiPrefixes', 'botDomains', 'core', 'envAvailable', 'id', 'nav', 'requires', 'routePrefixes', 'scope', 'settings'])
    expect(() => moduleDef('issue_analysis' as never)).toThrow()
  })
  it('core·scope 가 정본 §3.2.2 표와 같다', () => {
    expect(MODULES.filter((m) => m.core).map((m) => m.id)).toEqual([...CORE_MODULES])
    expect([...CORE]).toEqual([...CORE_MODULES])
    const scopeOf = (id: string) => byId[id].scope
    expect(['dashboard', 'wbs', 'members', 'settings', 'kanban', 'weekly', 'issues', 'announcements', 'attendance', 'wiki'].map(scopeOf)).toEqual(Array(10).fill('project'))
    expect(['meetings', 'agents', 'chatbot'].map(scopeOf)).toEqual(['both', 'both', 'both'])
    expect(['minutes', 'minutes_integration', 'portfolio', 'usage'].map(scopeOf)).toEqual(Array(4).fill('workspace'))
    // defaults 의 두 집합은 scope 에서 유도된 것과 같다
    expect(new Set(MODULES.filter((m) => !m.core && m.scope !== 'workspace').map((m) => m.id))).toEqual(PROJECT_TOGGLABLE)
    expect(new Set(MODULES.filter((m) => m.scope === 'workspace').map((m) => m.id))).toEqual(WORKSPACE_SCOPED)
  })
  it('requires 닫힘 4건과 core 의 requires: []·envAvailable 상수 true(개정 §2.7.1)', () => {
    expect(MODULES.filter((m) => m.requires.length).map((m) => [m.id, [...m.requires]])).toEqual([
      ['kanban', ['wbs']], ['wiki', ['minutes']], ['agents', ['wbs']], ['minutes_integration', ['minutes']],
    ])
    for (const id of CORE_MODULES) {
      expect(req(id), id).toEqual([])
      expect(byId[id].envAvailable(), id).toBe(true)
      expect(byId[id].envAvailable.toString(), id).toMatch(/=>\s*true/)   // 상수 — env 를 읽지 않는다
    }
    expect(() => assertModules()).not.toThrow()
  })
  it('envAvailable 은 flags.ts 술어 셋만 env 를 읽는다', () => {
    const src = readFileSync('src/lib/modules/registry.ts', 'utf8')
    expect(src).not.toMatch(/process\.env/)
    const saved = { ...process.env }
    try {
      delete process.env.WIKI_SERVICE_ENABLED; delete process.env.CHAT_V2_ENABLED; delete process.env.MINUTES_API_ENABLED
      expect([byId.wiki.envAvailable(), byId.chatbot.envAvailable(), byId.minutes_integration.envAvailable()]).toEqual([false, false, false])
      process.env.WIKI_SERVICE_ENABLED = 'true'; process.env.CHAT_V2_ENABLED = 'true'; process.env.MINUTES_API_ENABLED = 'true'
      expect([byId.wiki.envAvailable(), byId.chatbot.envAvailable(), byId.minutes_integration.envAvailable()]).toEqual([true, true, true])
      expect(byId.agents.envAvailable()).toBe(true)   // API 킬스위치는 라우트의 몫(정본 §3.2.2)
    } finally {
      process.env = saved
    }
  })
  it('nav — kanban·minutes_integration·chatbot 은 null, both 는 두 층, 항목 id 는 그 층의 접두를 갖는다', () => {
    expect([byId.kanban.nav, byId.minutes_integration.nav, byId.chatbot.nav]).toEqual([null, null, null])
    for (const m of MODULES) {
      if (!m.nav) continue
      if (m.nav.project) { expect(m.nav.project.id, m.id).toMatch(/^p\./); expect(m.scope).not.toBe('workspace') }
      if (m.nav.workspace) { expect(m.nav.workspace.id, m.id).toMatch(/^ws\./); expect(m.scope).not.toBe('project') }
      if (m.scope === 'both') expect(Boolean(m.nav.project && m.nav.workspace), m.id).toBe(true)
    }
    expect(byId.meetings.nav!.workspace!.segment).toBe('meetings')
    expect(byId.agents.nav!.project!.segment).toBe('agents/office')
    expect(byId.settings.nav!.project!.labelKey).toBe('nav.settings')
  })
  it('routePrefixes·apiPrefixes 는 유일하고 정본 표의 모양이다', () => {
    const routes = MODULES.flatMap((m) => [...m.routePrefixes]); const apis = MODULES.flatMap((m) => [...m.apiPrefixes])
    expect(new Set(routes).size).toBe(routes.length); expect(new Set(apis).size).toBe(apis.length)
    expect([...byId.wbs.routePrefixes]).toEqual(['/p/[projectId]/wbs', '/p/[projectId]/gantt', '/p/[projectId]/import'])
    expect([...byId.wbs.apiPrefixes]).toEqual(['/api/export', '/api/import'])
    expect([...byId.agents.apiPrefixes]).toEqual(['/api/v1/agent', '/api/v1/wbs'])
    expect([...byId.minutes_integration.apiPrefixes]).toEqual(['/api/v1/minutes'])
    expect([...byId.chatbot.apiPrefixes]).toEqual(['/api/chat', '/api/cron/ai-index'])
    expect([...byId.usage.apiPrefixes]).toEqual(['/api/track'])
    expect([...byId.issues.apiPrefixes]).toEqual(['/api/issue-analysis'])   // 스펙 E16 — issue_analysis 모듈은 SP5(과제 4)
    expect(LEGACY_GLOBAL_PREFIXES).toEqual({ '/meetings': 'meetings', '/minutes': 'minutes', '/agents': 'agents', '/portfolio': 'portfolio', '/usage': 'usage' })
  })
  it('botDomains 는 BOT_DOMAINS 의 부분집합이고, projects·unknown 은 어느 모듈에도 없다', () => {
    const claimed = MODULES.flatMap((m) => [...m.botDomains])
    for (const d of claimed) expect(BOT_DOMAINS).toContain(d)
    expect(new Set(claimed).size).toBe(claimed.length)
    expect(new Set([...claimed, 'projects', 'unknown'])).toEqual(new Set(BOT_DOMAINS))
    expect([...byId.chatbot.botDomains]).toEqual([])
  })
  it('settings — 20정의(SP5 A calendar.* 포함)가 소유 모듈에 정확히 한 번씩 있고, wbs 5·settings 15 다', () => {
    const owned = MODULES.flatMap((m) => m.settings.map((s) => [m.id, s.key] as const))
    expect(owned).toHaveLength(20)
    for (const [mid, key] of owned) {
      const def = [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS].find((d) => d.key === key)!
      expect(def.module, key).toBe(mid)
    }
    expect(byId.wbs.settings.map((s) => s.key)).toEqual(['core.level_labels', 'core.extra_axis_label', 'core.milestone_keywords', 'wbs.excel_profile', 'workflow.stage_credits'].filter((k) => k !== 'workflow.stage_credits').concat('workflow.stage_credits'))
    expect(byId.settings.settings).toHaveLength(15)
  })
})

describe('closeRequires·missingRequires', () => {
  const requiresOf = (id: Parameters<typeof moduleDef>[0]) => moduleDef(id).requires
  it('뺄 뿐 더하지 않는다 — 고정점까지', () => {
    const s = new Set(['kanban', 'wiki', 'minutes_integration', 'dashboard'] as const)
    expect([...closeRequires(s, requiresOf)].sort()).toEqual(['dashboard'])       // wbs·minutes 가 없어 셋이 빠진다
    const t = new Set(['wbs', 'kanban', 'minutes', 'wiki'] as const)
    expect([...closeRequires(t, requiresOf)].sort()).toEqual(['kanban', 'minutes', 'wbs', 'wiki'])
    expect(closeRequires(new Set(), requiresOf).size).toBe(0)
  })
  it('missingRequires 는 빠진 의존을 모듈별로 돌려준다(validateConfig 문구용)', () => {
    expect(missingRequires(new Set(['kanban', 'agents'] as const), requiresOf)).toEqual([{ id: 'kanban', missing: ['wbs'] }, { id: 'agents', missing: ['wbs'] }])
    expect(missingRequires(new Set(['wbs', 'kanban'] as const), requiresOf)).toEqual([])
  })
})

describe('import 방향(스펙 §3.5 끝·§3.6)', () => {
  it('해석기 두 파일은 @/lib/modules 의 값을 import 하지 않는다(타입만). 모듈 → 설정은 값 import', () => {
    for (const f of ['src/lib/settings/projectConfig.ts', 'src/lib/settings/workspaceConfig.ts', 'src/lib/settings/registry.ts', 'src/lib/settings/defs/workspace.ts', 'src/lib/settings/defs/project.ts']) {
      let src: string
      try { src = readFileSync(f, 'utf8') } catch { continue }   // 과제 6 전에는 해석기가 없다
      const valueImports = [...src.matchAll(/^import\s+(?!type\s)\{[^}]*\}\s+from\s+'@\/lib\/modules\/(?!defaults')[^']*'/gm)].map((m) => m[0])
      expect(valueImports, f).toEqual([])
    }
    const reg = readFileSync('src/lib/modules/registry.ts', 'utf8')
    expect(reg).toMatch(/^import\s+\{[^}]*\}\s+from\s+'@\/lib\/settings\/registry'/m)
    expect(reg).not.toMatch(/from\s+'@\/app\//)
  })
})

describe('0012 의 동결 목록 = 레지스트리', () => {
  const sql = readFileSync('supabase/migrations/0012_settings.sql', 'utf8').split('\n')
  const arrayAfter = (marker: string) => {
    const i = sql.findIndex((l) => l.includes(marker))
    expect(i, marker).toBeGreaterThan(-1)
    const m = sql[i + 1].match(/array\[([^\]]*)\]/)
    expect(m, `${marker} 다음 줄에 array[...]`).toBeTruthy()
    return m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
  }
  // 0012 는 커밋된 마이그레이션이라 이 두 목록은 바뀌지 않는다 — 테스트가 리터럴로 쥐고, 레지스트리와는 ⊆ 로 대조한다.
  // SP5 가 모듈을 더해 PROJECT_TOGGLABLE·NON_CORE_MODULES 가 늘어도 깨지지 않고, 목록의 모듈이 사라지거나 층이 바뀌면 깨진다(FM-7)
  const FROZEN_PROJECT_9 = ['kanban', 'meetings', 'weekly', 'issues', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot'] as const
  const FROZEN_WORKSPACE_13 = [...FROZEN_PROJECT_9, 'minutes', 'minutes_integration', 'portfolio', 'usage'] as const
  it('SQL 의 동결 목록 = 테스트 리터럴(프로젝트 9, 워크스페이스 13 = 토글 9 + 워크스페이스 층 4 순서)', () => {
    expect(arrayAfter('-- 동결 목록(프로젝트 9)')).toEqual([...FROZEN_PROJECT_9])
    // 0012 는 워크스페이스 목록을 프로젝트 토글 9 다음에 워크스페이스 층 4 순서로 적었다 — modules.allowed 는 집합으로 읽히므로
    // (parseModuleList 는 순서를 보지 않는다) 순서는 이 파일의 구성(토글 + 층)으로 고정한다
    expect(arrayAfter('-- 동결 목록(워크스페이스 13)')).toEqual([...FROZEN_WORKSPACE_13])
  })
  it('테스트 리터럴 ⊆ 레지스트리 — 프로젝트 9 는 프로젝트 토글, 워크스페이스 13 은 비core, 층 4 는 워크스페이스 층', () => {
    expect(FROZEN_PROJECT_9.filter((id) => !PROJECT_TOGGLABLE.has(id))).toEqual([])
    expect(FROZEN_WORKSPACE_13.filter((id) => !NON_CORE_MODULES.includes(id))).toEqual([])
    expect(FROZEN_WORKSPACE_13.slice(9).filter((id) => !WORKSPACE_SCOPED.has(id))).toEqual([])
  })
})
