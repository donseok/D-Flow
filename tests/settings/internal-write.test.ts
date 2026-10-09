// writeProjectSettingsInternal(스펙 §3.3) — 저장 형태 parse → revision 판독 → RPC(source internal) → 충돌이면 한 번만 재시도.
import { describe, expect, it, vi } from 'vitest'
import { writeProjectSettingsInternal, commandDigestInput } from '@/lib/settings/write'
import { ERR_CONFIG_UNAVAILABLE } from '@/lib/settings/errors'

const PID = '00000000-0000-4000-8000-00000000aa01'
const ACTOR = '00000000-0000-4000-8000-00000000cc01'
type RpcResult = { data: unknown; error: { code?: string; message: string; details?: string | null } | null }
function fakeAdmin(revisions: number[], rpcResults: RpcResult[]) {
  const reads: number[] = []
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  const admin = {
    from: (table: string) => {
      if (table !== 'project_settings') throw new Error(`예상치 못한 표: ${table}`)
      const b: Record<string, unknown> = {}
      b.select = () => b; b.eq = () => b
      b.maybeSingle = async () => { const r = revisions.shift(); reads.push(r ?? -1); return r === undefined ? { data: null, error: null } : { data: { revision: r }, error: null } }
      return b
    },
    rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return rpcResults.shift() ?? { data: null, error: { message: 'no more results' } } },
  }
  return { admin: admin as never, reads, rpcCalls }
}
const applied = (revision: number): RpcResult => ({ data: { status: 'applied', revision }, error: null })
const conflict = (current: number): RpcResult => ({ data: null, error: { code: 'P0001', message: 'SETTINGS_REVISION_CONFLICT', details: String(current) } })

describe('writeProjectSettingsInternal', () => {
  it('parse 를 거친 저장 형태로 RPC 를 부른다 — source internal, 세대 1, 읽은 revision 으로 CAS', async () => {
    const { admin, rpcCalls } = fakeAdmin([4], [applied(5)])
    const r = await writeProjectSettingsInternal(admin, PID, { set: { 'core.level_labels': [' Phase ', 'Task'] } }, ACTOR)
    expect(r).toEqual({ ok: true, status: 'applied', revision: 5, commandId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('apply_project_settings')
    expect(rpcCalls[0].args).toMatchObject({
      p_project_id: PID, p_expected_revision: 4, p_set: { 'core.level_labels': ['Phase', 'Task'] }, p_unset: [], p_actor: ACTOR, p_schema_version: 1, p_source: 'internal',
    })
  })
  it('충돌이면 revision 을 다시 읽어 같은 commandId 로 한 번만 재시도한다. 두 번째 충돌은 CONFIG_CONFLICT', async () => {
    const once = fakeAdmin([4, 6], [conflict(6), applied(7)])
    const r1 = await writeProjectSettingsInternal(once.admin, PID, { unset: ['wbs.excel_profile'] }, ACTOR)
    expect(r1).toMatchObject({ ok: true, status: 'applied', revision: 7 })
    expect(once.reads).toEqual([4, 6])
    expect(once.rpcCalls.map((c) => c.args.p_expected_revision)).toEqual([4, 6])
    expect(once.rpcCalls[0].args.p_command_id).toBe(once.rpcCalls[1].args.p_command_id)
    const twice = fakeAdmin([4, 6, 8], [conflict(6), conflict(8), applied(9)])
    const r2 = await writeProjectSettingsInternal(twice.admin, PID, { unset: ['wbs.excel_profile'] }, ACTOR)
    expect(r2).toEqual({ ok: false, code: 'CONFIG_CONFLICT', error: expect.stringContaining('다른 사용자가') })
    expect(twice.rpcCalls).toHaveLength(2)
  })
  it('parse 실패는 RPC 를 부르지 않고 fieldErrors, 미등록 키는 CONFIG_UNKNOWN_KEY, set·unset 겹침은 CONFIG_INVALID', async () => {
    const a = fakeAdmin([1], [])
    expect(await writeProjectSettingsInternal(a.admin, PID, { set: { 'core.level_labels': [] } }, ACTOR)).toEqual({
      ok: false, code: 'CONFIG_INVALID', error: expect.any(String), fieldErrors: [{ key: 'core.level_labels', message: '단계가 최소 1개 필요합니다.' }],
    })
    expect(a.rpcCalls).toHaveLength(0)
    expect(await writeProjectSettingsInternal(a.admin, PID, { set: { 'nope.key': 1 } }, ACTOR)).toMatchObject({ ok: false, code: 'CONFIG_UNKNOWN_KEY' })
    expect(await writeProjectSettingsInternal(a.admin, PID, { set: { 'core.extra_axis_label': 'x' }, unset: ['core.extra_axis_label'] }, ACTOR)).toMatchObject({ ok: false, code: 'CONFIG_INVALID' })
  })
  it('늘 명시 키(core.level_labels·modules.enabled)의 unset 은 거부 — revision 판독·RPC 없음(FN-3)', async () => {
    for (const key of ['core.level_labels', 'modules.enabled']) {
      const a = fakeAdmin([1], [applied(2)])
      expect(await writeProjectSettingsInternal(a.admin, PID, { unset: [key] }, ACTOR)).toEqual({
        ok: false, code: 'CONFIG_INVALID', error: expect.stringContaining(key), fieldErrors: [{ key, message: '필수 설정은 기본값으로 되돌릴 수 없습니다.' }],
      })
      expect(a.rpcCalls).toHaveLength(0); expect(a.reads).toHaveLength(0)
    }
  })
  it('revision 판독 실패·0행은 CONFIG_UNAVAILABLE(RPC 미호출). 표에 있는 토큰은 코드로, 없는 토큰은 throw', async () => {
    const none = fakeAdmin([], [])
    expect(await writeProjectSettingsInternal(none.admin, PID, { set: { 'ai.enabled': true } as never }, ACTOR)).toMatchObject({ ok: false, code: 'CONFIG_UNKNOWN_KEY' })  // 워크스페이스 키
    expect(await writeProjectSettingsInternal(none.admin, PID, { set: { 'core.extra_axis_label': 'x' } }, ACTOR)).toMatchObject({ ok: false, code: 'CONFIG_UNAVAILABLE' })
    const ahead = fakeAdmin([1], [{ data: null, error: { code: 'P0001', message: 'SETTINGS_SCHEMA_AHEAD' } }])
    expect(await writeProjectSettingsInternal(ahead.admin, PID, { set: { 'core.extra_axis_label': 'x' } }, ACTOR)).toMatchObject({ ok: false, code: 'CONFIG_SCHEMA_AHEAD' })
    const weird = fakeAdmin([1], [{ data: null, error: { code: '23514', message: 'SETTINGS_ROW_REQUIRED' } }])
    await expect(writeProjectSettingsInternal(weird.admin, PID, { set: { 'core.extra_axis_label': 'x' } }, ACTOR)).rejects.toThrow(/SETTINGS_ROW_REQUIRED/)
  })
  it('revision 판독 오류의 DB 원문은 error 에 싣지 않는다 — 고정 문구, 원인은 로그(errors-m1)', async () => {
    const b: Record<string, unknown> = {}
    b.select = () => b; b.eq = () => b
    b.maybeSingle = async () => ({ data: null, error: { message: 'relation "project_settings" boom' } })
    const admin = { from: () => b, rpc: vi.fn() } as never
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await writeProjectSettingsInternal(admin, PID, { set: { 'core.extra_axis_label': 'x' } }, ACTOR)
    const logged = JSON.stringify(spy.mock.calls)
    spy.mockRestore()
    expect(r).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: ERR_CONFIG_UNAVAILABLE })
    expect(logged).toContain('boom')
  })
  it('commandDigestInput 은 unset 을 정렬·중복 제거한다(RPC 의 요약과 같은 입력)', () => {
    expect(commandDigestInput({ b: 1 }, ['z', 'a', 'z'])).toEqual({ set: { b: 1 }, unset: ['a', 'z'] })
  })
})

// 워크스페이스 쪽 내부 쓰기 — 플랫폼 관리자의 워크스페이스 생성이 첫 값(허용 모듈·시간대)을 적는 한 길. 프로젝트 쪽과 같은 순서다.
describe('writeWorkspaceSettingsInternal', () => {
  const WID = '00000000-0000-4000-8000-00000000bb01'
  function fakeWs(revisions: (number | 'error')[], rpcResults: RpcResult[]) {
    const tables: string[] = []
    const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
    const admin = {
      from: (table: string) => {
        tables.push(table)
        const b: Record<string, unknown> = {}
        b.select = () => b; b.eq = () => b
        b.maybeSingle = async () => {
          const r = revisions.shift()
          if (r === 'error') return { data: null, error: { message: 'db down: secret-host' } }
          return r === undefined ? { data: null, error: null } : { data: { revision: r }, error: null }
        }
        return b
      },
      rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return rpcResults.shift() ?? { data: null, error: { message: 'no more results' } } },
    }
    return { admin: admin as never, tables, rpcCalls }
  }
  it('parse 를 거친 값으로 apply_workspace_settings 를 부른다 — source internal, 읽은 revision 으로 CAS', async () => {
    const { writeWorkspaceSettingsInternal } = await import('@/lib/settings/write')
    const { admin, tables, rpcCalls } = fakeWs([1], [applied(2)])
    const r = await writeWorkspaceSettingsInternal(admin, WID, { set: { 'modules.allowed': ['wiki', 'kanban'], 'calendar.timezone': 'Asia/Tokyo' } }, ACTOR)
    expect(r).toMatchObject({ ok: true, status: 'applied', revision: 2 })
    expect(tables).toEqual(['workspace_settings'])
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('apply_workspace_settings')
    expect(rpcCalls[0].args).toMatchObject({ p_workspace_id: WID, p_expected_revision: 1, p_unset: [], p_actor: ACTOR, p_schema_version: 1, p_source: 'internal' })
    expect((rpcCalls[0].args.p_set as Record<string, unknown>)['calendar.timezone']).toBe('Asia/Tokyo')
    expect([...(rpcCalls[0].args.p_set as Record<string, string[]>)['modules.allowed']].sort()).toEqual(['kanban', 'wiki'])
  })
  it('빈 허용 모듈(core 만)도 명시 값으로 적는다', async () => {
    const { writeWorkspaceSettingsInternal } = await import('@/lib/settings/write')
    const { admin, rpcCalls } = fakeWs([1], [applied(2)])
    expect(await writeWorkspaceSettingsInternal(admin, WID, { set: { 'modules.allowed': [] } }, ACTOR)).toMatchObject({ ok: true })
    expect(rpcCalls[0].args.p_set).toEqual({ 'modules.allowed': [] })
  })
  it('모르는 키·프로젝트 층 키·parse 실패는 RPC 를 부르지 않는다', async () => {
    const { writeWorkspaceSettingsInternal } = await import('@/lib/settings/write')
    const a = fakeWs([1], [])
    expect(await writeWorkspaceSettingsInternal(a.admin, WID, { set: { 'nope.key': 1 } }, ACTOR)).toMatchObject({ ok: false, code: 'CONFIG_UNKNOWN_KEY' })
    expect(await writeWorkspaceSettingsInternal(a.admin, WID, { set: { 'core.level_labels': ['A'] } }, ACTOR)).toMatchObject({ ok: false, code: 'CONFIG_UNKNOWN_KEY' })
    expect(await writeWorkspaceSettingsInternal(a.admin, WID, { set: { 'modules.allowed': ['wbs'] } }, ACTOR)).toMatchObject({ ok: false, code: 'CONFIG_INVALID', fieldErrors: [{ key: 'modules.allowed' }] })
    expect(a.rpcCalls).toHaveLength(0)
    expect(a.tables).toEqual([])
  })
  it('충돌이면 한 번만 다시 읽어 같은 commandId 로 재시도한다', async () => {
    const { writeWorkspaceSettingsInternal } = await import('@/lib/settings/write')
    const a = fakeWs([1, 2], [conflict(2), applied(3)])
    expect(await writeWorkspaceSettingsInternal(a.admin, WID, { set: { 'modules.allowed': [] } }, ACTOR)).toMatchObject({ ok: true, revision: 3 })
    expect(a.rpcCalls.map((c) => c.args.p_expected_revision)).toEqual([1, 2])
    expect(a.rpcCalls[0].args.p_command_id).toBe(a.rpcCalls[1].args.p_command_id)
  })
  it('revision 판독 실패·설정 행 없음은 CONFIG_UNAVAILABLE — 원문은 결과에 없다, RPC 없음', async () => {
    const { writeWorkspaceSettingsInternal } = await import('@/lib/settings/write')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = fakeWs(['error'], [])
    const r = await writeWorkspaceSettingsInternal(down.admin, WID, { set: { 'modules.allowed': [] } }, ACTOR)
    expect(r).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: ERR_CONFIG_UNAVAILABLE })
    expect(JSON.stringify(r)).not.toContain('secret-host')
    const missing = fakeWs([], [])
    expect(await writeWorkspaceSettingsInternal(missing.admin, WID, { set: { 'modules.allowed': [] } }, ACTOR)).toMatchObject({ ok: false, code: 'CONFIG_UNAVAILABLE' })
    expect(down.rpcCalls.length + missing.rpcCalls.length).toBe(0)
    spy.mockRestore()
  })
})
