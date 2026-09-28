// 설정 액션 테스트용 메모리 DB — 해석기가 쓰는 체인(select/eq/is/or/gt/lt/order/limit/maybeSingle/then)과
// apply_project_settings·apply_workspace_settings 의 CAS·중복·이력·값 불변 규칙을 RPC 와 같은 순서로 흉내 낸다(개정 §2.3.2 요지).
// DB 층의 진짜 판정은 tests/rls/settings-lifecycle.test.ts 가 한다 — 여기는 액션 층의 분기만 본다.
import { createHash } from 'node:crypto'

export interface FakeProject { id: string; workspaceId: string; values: Record<string, unknown>; revision: number; schemaVersion: number }
export interface FakeWorkspace { id: string; values: Record<string, unknown>; revision: number; schemaVersion: number }
export interface FakeHistoryRow {
  id: number; project_id?: string; workspace_id?: string; revision: number; key: string; old_value: unknown; new_value: unknown
  source: string; command_id: string; command_digest: string; changed_by: string | null; changed_at: string; copied_from: string | null
}
type Filter = { op: 'eq' | 'is' | 'gt' | 'lt'; col: string; val: unknown } | { op: 'or'; expr: string }

export class FakeSettingsDb {
  projects = new Map<string, FakeProject>()
  workspaces = new Map<string, FakeWorkspace>()
  areas: Record<string, unknown>[] = []
  teams: Record<string, unknown>[] = []
  wbsItems: Record<string, unknown>[] = []
  agentProjects: Record<string, unknown>[] = []
  history: FakeHistoryRow[] = []
  rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  /** 다음 RPC 호출 직전에 한 번 실행 — 동시 편집을 흉내 낸다(다른 사용자가 먼저 저장) */
  beforeRpc: (() => void) | null = null
  failTable: string | null = null
  private seq = 1

  addProject(p: Omit<FakeProject, 'revision' | 'schemaVersion'> & Partial<Pick<FakeProject, 'revision' | 'schemaVersion'>>) {
    this.projects.set(p.id, { revision: 0, schemaVersion: 1, ...p }); return this
  }
  addWorkspace(w: Omit<FakeWorkspace, 'revision' | 'schemaVersion'> & Partial<Pick<FakeWorkspace, 'revision' | 'schemaVersion'>>) {
    this.workspaces.set(w.id, { revision: 0, schemaVersion: 1, ...w }); return this
  }
  /** 다른 사용자의 저장을 흉내 낸다 — 값을 바꾸고 revision 을 올리고 이력을 남긴다 */
  externalWrite(scope: { projectId: string } | { workspaceId: string }, set: Record<string, unknown>, by = 'someone-else') {
    const doc = 'projectId' in scope ? this.projects.get(scope.projectId)! : this.workspaces.get(scope.workspaceId)!
    const rev = doc.revision + 1
    for (const [k, v] of Object.entries(set)) {
      this.history.push({ id: this.seq++, ...('projectId' in scope ? { project_id: scope.projectId } : { workspace_id: scope.workspaceId }), revision: rev, key: k,
        old_value: doc.values[k] ?? null, new_value: v, source: 'edit', command_id: `ext-${this.seq}`, command_digest: 'ext', changed_by: by, changed_at: new Date().toISOString(), copied_from: null })
      doc.values[k] = v
    }
    doc.revision = rev
  }

  /** supabase-js 모양의 클라이언트 — from()·rpc() */
  client() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this
    return {
      from(table: string) {
        const filters: Filter[] = []
        let order: { col: string; asc: boolean } | null = null
        let limit: number | null = null
        let select = '*'
        const run = () => {
          if (db.failTable === table) return { data: null, error: { message: `fake failure: ${table}` } }
          let rows = db.rowsOf(table, select)
          for (const f of filters) rows = rows.filter((r) => db.match(r, f))
          if (order) {
            const { col, asc } = order
            rows = [...rows].sort((a, b) => {
              const x = a[col] as string | number, y = b[col] as string | number
              return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1)
            })
          }
          if (limit !== null) rows = rows.slice(0, limit)
          return { data: rows, error: null }
        }
        const b: Record<string, unknown> = {
          select: (s: string) => { select = s; return b },
          eq: (col: string, val: unknown) => { filters.push({ op: 'eq', col, val }); return b },
          is: (col: string, val: unknown) => { filters.push({ op: 'is', col, val }); return b },
          gt: (col: string, val: unknown) => { filters.push({ op: 'gt', col, val }); return b },
          lt: (col: string, val: unknown) => { filters.push({ op: 'lt', col, val }); return b },
          or: (expr: string) => { filters.push({ op: 'or', expr }); return b },
          order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending ?? true }; return b },
          limit: (n: number) => { limit = n; return b },
          maybeSingle: async () => { const r = run(); return r.error ? r : { data: (r.data as unknown[])[0] ?? null, error: null } },
          then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
          insert: async (row: Record<string, unknown>) => { if (table === 'agent_projects') db.agentProjects.push({ enabled: true, ...row }); return { error: null } },
          update: (patch: Record<string, unknown>) => ({ eq: async (col: string, val: unknown) => { for (const r of db.rowsOf(table, '*')) if (r[col] === val) Object.assign(r, patch); return { error: null } } }),
        }
        return b
      },
      async rpc(name: string, args: Record<string, unknown>) {
        db.rpcCalls.push({ name, args })
        if (db.beforeRpc) { const f = db.beforeRpc; db.beforeRpc = null; f() }
        if (name !== 'apply_project_settings' && name !== 'apply_workspace_settings') return { data: null, error: { message: `fake: unknown rpc ${name}` } }
        return db.apply(name === 'apply_project_settings' ? { projectId: args.p_project_id as string } : { workspaceId: args.p_workspace_id as string }, args)
      },
    }
  }

  private rowsOf(table: string, select: string): Record<string, unknown>[] {
    switch (table) {
      case 'project_settings': return [...this.projects.values()].map((p) => ({ project_id: p.id, values: p.values, revision: p.revision, schema_version: p.schemaVersion,
        ...(select.includes('projects') ? { projects: { workspace_id: p.workspaceId } } : {}) }))
      case 'workspace_settings': return [...this.workspaces.values()].map((w) => ({ workspace_id: w.id, values: w.values, revision: w.revision, schema_version: w.schemaVersion }))
      case 'project_areas': return this.areas
      case 'teams': return this.teams
      case 'wbs_items': return this.wbsItems
      case 'agent_projects': return this.agentProjects
      case 'project_settings_history': return this.history.filter((h) => h.project_id) as unknown as Record<string, unknown>[]
      case 'workspace_settings_history': return this.history.filter((h) => h.workspace_id) as unknown as Record<string, unknown>[]
      default: throw new Error(`fake db: 모르는 표 ${table}`)
    }
  }
  private match(r: Record<string, unknown>, f: Filter): boolean {
    if (f.op === 'or') return f.expr.split(',').some((part) => { const [col, op, val] = part.split('.'); return op === 'is' ? r[col] === null : op === 'eq' ? String(r[col]) === val : false })
    const v = r[f.col]
    if (f.op === 'eq') return v === f.val
    if (f.op === 'is') return v === f.val
    if (f.op === 'gt') return (v as number) > (f.val as number)
    return (v as number) < (f.val as number)
  }
  private apply(scope: { projectId: string } | { workspaceId: string }, a: Record<string, unknown>) {
    const err = (code: string, message: string, details: string | null = null) => ({ data: null, error: { code, message, details } })
    const doc = 'projectId' in scope ? this.projects.get(scope.projectId) : this.workspaces.get(scope.workspaceId)
    if (!doc) return err('P0001', 'SETTINGS_ROW_MISSING')
    const set = (a.p_set ?? {}) as Record<string, unknown>
    const unset = [...new Set((a.p_unset ?? []) as string[])].sort()
    const digest = createHash('sha256').update(JSON.stringify(set) + '|' + unset.join(',')).digest('hex')
    const idCol = 'projectId' in scope ? 'project_id' : 'workspace_id'
    const dup = this.history.filter((h) => h[idCol] === ('projectId' in scope ? scope.projectId : scope.workspaceId) && h.command_id === a.p_command_id && h.changed_by === a.p_actor)
    if (dup.length) return dup[0].command_digest === digest ? { data: { status: 'duplicate', revision: Math.max(...dup.map((d) => d.revision)) }, error: null } : err('23505', 'COMMAND_REUSED')
    if ((a.p_schema_version as number) < doc.schemaVersion) return err('P0001', 'SETTINGS_SCHEMA_AHEAD')
    const next = { ...doc.values }
    for (const k of unset) delete next[k]
    for (const [k, v] of Object.entries(set)) next[k] = v
    if (JSON.stringify(next) === JSON.stringify(doc.values)) return { data: { status: 'applied', revision: doc.revision, changed: 0 }, error: null }
    if (a.p_expected_revision !== doc.revision) return err('P0001', 'SETTINGS_REVISION_CONFLICT', String(doc.revision))
    const rev = doc.revision + 1
    const changedKeys = [...new Set([...Object.keys(set), ...unset])].filter((k) => JSON.stringify(next[k]) !== JSON.stringify(doc.values[k]))
    for (const k of changedKeys) {
      this.history.push({ id: this.seq++, [idCol]: 'projectId' in scope ? scope.projectId : scope.workspaceId, revision: rev, key: k, old_value: doc.values[k] ?? null, new_value: next[k] ?? null,
        source: a.p_source as string, command_id: a.p_command_id as string, command_digest: digest, changed_by: (a.p_actor as string | null) ?? null, changed_at: new Date().toISOString(), copied_from: null })
    }
    doc.values = next; doc.revision = rev
    return { data: { status: 'applied', revision: rev }, error: null }
  }
}
