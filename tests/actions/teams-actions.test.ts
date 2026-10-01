import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/cache · authz 가드 · admin 클라이언트 · 팀 마스터 캐시를 모킹해 게이트·검증·시드 폴더 생성만 본다.
// 공용 팀은 워크스페이스 기준정보라 그 워크스페이스의 관리자가 손댄다(SP2 §4.1) — 가드 모킹은 순수 판정에 위임한다.
const { db, createAdminClient, refreshTeams, requireWorkspaceAdmin, getActor } = vi.hoisted(() => {
  const db = {
    teams: [] as Array<Record<string, unknown>>,
    folders: [] as Array<Record<string, unknown>>,
    inserted: { teams: [] as unknown[], minute_folders: [] as unknown[] },
    updated: [] as Array<{ patch: unknown; id: unknown }>,
    lookupError: null as { message: string } | null,
  }
  /** 체이너블 최소 모의 — eq/is/order/limit 는 자기 자신, maybeSingle 은 큐 결과. */
  const table = (name: 'teams' | 'minute_folders') => {
    const rows = () => (name === 'teams' ? db.teams : db.folders)
    const filters: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {}
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q }
    Object.assign(q, {
      select: chain(),
      eq: chain((col, v) => filters.push([String(col), v])),
      is: chain((col, v) => filters.push([String(col), v])),
      order: chain(),
      limit: chain(),
      maybeSingle: async () => {
        if (db.lookupError) return { data: null, error: db.lookupError }
        const found = rows().find(r => filters.every(([c, v]) => (r[c] ?? null) === v))
        // sort_order 최대값 조회(내림차순 limit 1) 근사: 필터 없으면 첫 행
        return { data: found ?? (filters.length === 0 ? rows()[0] ?? null : null), error: null }
      },
      insert: async (row: unknown) => { db.inserted[name].push(row); return { error: null } },
      // 목록 조회(select … eq/is 뒤 바로 await — addTeam 의 같은 워크스페이스 공용 팀 목록)
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(db.lookupError
        ? { data: null, error: db.lookupError }
        : { data: rows().filter(r => filters.every(([c, v]) => (r[c] ?? null) === v)), error: null }).then(res, rej),
      // update 체인도 eq/is 를 함께 받는다(updateTeam 의 .eq('id', id).is('project_id', null) 방어).
      // .select('id') 가 종결 — 실제로 매칭되는 행이 있어야 db.updated 에 반영된다(조용한 no-op
      // 을 성공으로 위장하지 않는 프로덕션 코드의 영향행 확인을 모의도 똑같이 강제한다).
      // .then 도 구현해 .select() 없이 바로 await 하는 경로까지 호환한다.
      update: (patch: unknown) => {
        const where: Array<[string, unknown]> = []
        const finalize = () => {
          const target = rows().find(r => where.every(([c, v]) => (r[c] ?? null) === v))
          const id = where.find(([c]) => c === 'id')?.[1]
          if (target) db.updated.push({ patch, id })
          return { data: target ? [{ id }] : [], error: null }
        }
        const upd: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { where.push([c, v]); return upd },
          is: (c: string, v: unknown) => { where.push([c, v]); return upd },
          select: async (_cols: string) => finalize(),
          then: (resolve: (v: { error: null }) => void) => resolve({ error: finalize().error }),
        }
        return upd
      },
    })
    return q
  }
  const createAdminClient = vi.fn(() => ({ from: (n: 'teams' | 'minute_folders') => table(n) }))
  const refreshTeams = vi.fn(async () => true)
  return { db, createAdminClient, refreshTeams, requireWorkspaceAdmin: vi.fn(), getActor: vi.fn() }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin, getActor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/teams/master', () => ({ refreshTeams }))

import { addTeam, updateTeam, listTeamsAdmin } from '@/app/actions/teams'
import { workspaceAdminVerdict, type Actor } from '@/lib/domain/authz'
import { ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'
import { makeActor, makeSuperuser, WS } from '../fixtures/actor'

const WS_B = 'ws-b'
const WS_ADMIN = makeActor({ userId: 'u-wsadmin', workspaceRoles: new Map([[WS, 'admin']]) })
const OTHER_WS_ADMIN = makeActor({ userId: 'u-other', workspaceRoles: new Map([[WS_B, 'admin']]) })
const WS_MEMBER = makeActor({ userId: 'u-mem' })

function signedInAs(a: Actor) {
  getActor.mockResolvedValue(a)
  requireWorkspaceAdmin.mockImplementation(async (wid: string | null) => {
    const v = workspaceAdminVerdict(a, wid)
    return v === 'ok' ? { ok: true, actor: a } : { ok: false, error: v === 'missing' ? ERR_MISSING : ERR_DENIED }
  })
}
const asAdmin = () => signedInAs(WS_ADMIN)

describe('팀 관리 서버액션', () => {
  beforeEach(() => {
    db.teams = []
    db.folders = []
    db.inserted.teams = []
    db.inserted.minute_folders = []
    db.updated = []
    db.lookupError = null
    createAdminClient.mockClear()
    refreshTeams.mockClear()
    requireWorkspaceAdmin.mockReset()
    getActor.mockReset()
  })

  it('addTeam: 워크스페이스 멤버는 거부, 다른 워크스페이스 관리자는 존재 은닉 — DB 를 건드리지 않는다', async () => {
    signedInAs(WS_MEMBER)
    expect(await addTeam(WS, '신팀')).toEqual({ ok: false, error: ERR_DENIED })
    signedInAs(OTHER_WS_ADMIN)
    expect(await addTeam(WS, '신팀')).toEqual({ ok: false, error: ERR_MISSING })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('addTeam: 워크스페이스가 비면 가드 전에 거부한다 — 슈퍼유저도', async () => {
    signedInAs(makeSuperuser())
    for (const wid of [null, undefined, '']) {
      // @ts-expect-error 호출부 타입 우회를 흉내낸다
      expect((await addTeam(wid, '신팀')).ok).toBe(false)
    }
    expect(requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('addTeam: 그 워크스페이스의 관리자는 입력 워크스페이스에 만든다', async () => {
    asAdmin()
    expect(await addTeam(WS, '신팀')).toEqual({ ok: true })
    expect(requireWorkspaceAdmin).toHaveBeenCalledWith(WS)
    expect(db.inserted.teams[0]).toMatchObject({ code: '신팀', workspace_id: WS })
  })

  it('updateTeam: 대상 팀의 워크스페이스로 판정 — 멤버 거부, 다른 워크스페이스 관리자 존재 은닉, 관리자 통과', async () => {
    db.teams = [{ id: 't1', code: 'PMO', project_id: null, workspace_id: WS }]
    signedInAs(WS_MEMBER)
    expect(await updateTeam('t1', { active: false })).toEqual({ ok: false, error: ERR_DENIED })
    signedInAs(OTHER_WS_ADMIN)
    expect(await updateTeam('t1', { active: false })).toEqual({ ok: false, error: ERR_MISSING })
    expect(db.updated).toHaveLength(0)
    asAdmin()
    expect(await updateTeam('t1', { active: false })).toEqual({ ok: true })
    expect(requireWorkspaceAdmin).toHaveBeenLastCalledWith(WS)
    expect(db.updated).toHaveLength(1)
  })

  it('updateTeam: 대상 조회 실패는 ERR_LOOKUP, 없음·프로젝트 팀은 ERR_MISSING — 가드·쓰기 전에 끊는다', async () => {
    asAdmin()
    db.lookupError = { message: 'boom' }
    expect(await updateTeam('t1', { active: false })).toEqual({ ok: false, error: ERR_LOOKUP })
    db.lookupError = null
    db.teams = [{ id: 't-proj', code: 'ERP', project_id: 'p1', workspace_id: WS }]
    expect(await updateTeam('t-proj', { active: false })).toEqual({ ok: false, error: ERR_MISSING })
    expect(await updateTeam('no-such-id', { active: false })).toEqual({ ok: false, error: ERR_MISSING })
    expect(requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(db.updated).toHaveLength(0)
  })

  it('[Q5] addTeam: 같은 워크스페이스 공용 팀의 개명된 이름·대소문자만 다른 code 와 겹치면 거부(개명 규칙의 대칭)', async () => {
    asAdmin()
    db.teams = [{ id: 't-res', code: 'RES', name: '운영', project_id: null, workspace_id: WS },
      { id: 't-other-ws', code: 'LAB', name: 'LAB', project_id: null, workspace_id: WS_B }]
    for (const input of ['운영', 'res']) {
      expect(await addTeam(WS, input), input).toMatchObject({ ok: false, error: expect.stringContaining('다른 팀(RES)') })
    }
    expect(await addTeam(WS, 'lab')).toEqual({ ok: true })   // 다른 워크스페이스의 팀과는 겹침을 보지 않는다
    expect(db.inserted.teams).toHaveLength(1)
  })

  it('addTeam: 조회 실패는 고정 문구 — DB 원문을 싣지 않는다(SP4 D21)', async () => {
    asAdmin()
    db.lookupError = { message: 'relation "teams" boom' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await addTeam(WS, '신팀')
    expect(r).toEqual({ ok: false, error: '팀 정보를 확인하지 못했습니다. 잠시 후 다시 시도하세요.' })
    expect(JSON.stringify(r)).not.toContain('boom')
    expect(db.inserted.teams).toHaveLength(0)
    db.lookupError = null
    err.mockRestore()
  })

  // 행 조회보다 인증이 먼저 — 아니면 비로그인 호출자가 ERR_MISSING(없는 id)과 ERR_ANON(있는 id)으로 팀 id 존재를 가려낸다.
  it('updateTeam: 비로그인은 행 조회 없이 ERR_ANON — 있는 id·없는 id 가 같은 응답, 권한 조회 실패는 ERR_LOOKUP', async () => {
    db.teams = [{ id: 't1', code: 'PMO', project_id: null, workspace_id: WS }]
    getActor.mockResolvedValue(null)
    expect(await updateTeam('t1', { active: false })).toEqual({ ok: false, error: ERR_ANON })
    expect(await updateTeam('no-such-id', { active: false })).toEqual({ ok: false, error: ERR_ANON })
    getActor.mockRejectedValue(new Error('boom'))
    expect(await updateTeam('t1', { active: false })).toEqual({ ok: false, error: ERR_LOOKUP })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(db.updated).toHaveLength(0)
  })

  it('listTeamsAdmin: 그 워크스페이스의 공용 팀만 — 다른 워크스페이스 팀이 섞이지 않는다(adminFor 스코프)', async () => {
    // adminFor 는 uuid 스코프만 받는다 — 이 케이스만 실제 형식의 워크스페이스 id 를 쓴다.
    const WID = '0d000000-0000-4000-8000-00000000000d'
    signedInAs(makeActor({ userId: 'u-wsadmin', workspaceRoles: new Map([[WID, 'admin']]) }))
    const filters: Array<[string, unknown]> = []
    createAdminClient.mockImplementationOnce(() => ({
      from: () => {
        const q: Record<string, unknown> = {}
        Object.assign(q, {
          select: () => q,
          is: (c: string, v: unknown) => { filters.push([c, v]); return q },
          eq: (c: string, v: unknown) => { filters.push([c, v]); return q },
          order: () => q,
          then: (resolve: (v: unknown) => void) => resolve({
            data: [{ id: 't1', code: 'PMO', sort_order: 0, active: true, progress_visible: true }], error: null,
          }),
        })
        return q
      },
    }) as never)
    const res = await listTeamsAdmin(WID)
    expect(res.ok && res.rows).toHaveLength(1)
    expect(filters).toContainEqual(['workspace_id', WID])
    expect(filters).toContainEqual(['project_id', null])
  })

  // 조회 실패를 빈 목록으로 돌려주면 화면이 'TEAMS 0' 을 사실처럼 그린다 — 관리자가 '없는' 팀을 다시 추가하다 중복 오류를 만난다
  // (SP2 최종 리뷰 ERR-7, 에러 3원칙 ①). 거부·조회 실패는 오류로 돌려준다.
  // PostgREST 원문은 로그에만 — 사용자 문구에는 DB 내부 사정 대신 재시도 안내만 싣는다(SP2 최종 리뷰 minor b).
  it('listTeamsAdmin: select 가 실패하면 빈 목록이 아니라 오류 — 원문은 로그에만 남긴다', async () => {
    const WID = '0d000000-0000-4000-8000-00000000000d'
    signedInAs(makeActor({ userId: 'u-wsadmin', workspaceRoles: new Map([[WID, 'admin']]) }))
    createAdminClient.mockImplementationOnce(() => ({
      from: () => {
        const q: Record<string, unknown> = {}
        Object.assign(q, {
          select: () => q, is: () => q, eq: () => q, order: () => q,
          then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'boom' } }),
        })
        return q
      },
    }) as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listTeamsAdmin(WID)
    expect(res).toEqual({ ok: false, error: '팀 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.' })
    expect(JSON.stringify(res)).not.toContain('boom')
    expect(spy.mock.calls.flat().join(' ')).toContain('boom')
    spy.mockRestore()
  })

  it('listTeamsAdmin: 다른 워크스페이스 관리자는 거부(사유를 돌려주고 로그) — DB 를 건드리지 않는다', async () => {
    signedInAs(OTHER_WS_ADMIN)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listTeamsAdmin(WS)
    expect(res.ok).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('예약어·빈 이름 거부', async () => {
    asAdmin()
    expect((await addTeam(WS, '산출물')).ok).toBe(false)
    expect((await addTeam(WS, '   ')).ok).toBe(false)
    expect(db.inserted.teams).toHaveLength(0)
  })

  it('중복 코드 거부(같은 워크스페이스)', async () => {
    asAdmin()
    db.teams = [{ id: 't-pmo', code: 'PMO', sort_order: 0, project_id: null, workspace_id: 'ws-1' }]
    const r = await addTeam(WS, 'PMO')
    expect(r.ok).toBe(false)
    expect(db.inserted.teams).toHaveLength(0)
  })

  // workspace_id 필터가 없으면 다른 워크스페이스의 동명 전역 팀을 오탐해 생성이 막힌다(0003 이후 회귀 방지).
  it('다른 워크스페이스의 동명 전역 팀은 막지 않는다', async () => {
    asAdmin()
    db.teams = [{ id: 't-other-ws', code: 'PMO', sort_order: 0, project_id: null, workspace_id: 'ws-other' }]
    const r = await addTeam(WS, 'PMO')
    expect(r.ok).toBe(true)
    expect(db.inserted.teams).toHaveLength(1)
  })

  it('성공: teams insert(workspace_id·color 포함) + 시드 루트 폴더 insert + refreshTeams', async () => {
    asAdmin()
    const r = await addTeam(WS, ' 신팀 ')
    expect(r.ok).toBe(true)
    expect(db.inserted.teams[0]).toMatchObject({ code: '신팀', name: '신팀', workspace_id: 'ws-1' })
    expect((db.inserted.teams[0] as { color: string }).color).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(db.inserted.minute_folders[0]).toMatchObject({ name: '신팀', parent_id: null, created_by: null })
    expect(refreshTeams).toHaveBeenCalled()
  })

  it('동명 시드 폴더가 이미 있으면 폴더 insert 는 생략하고 성공', async () => {
    asAdmin()
    db.folders = [{ id: 'f1', code: undefined, name: '신팀', parent_id: null, created_by: null, workspace_id: WS }]
    const r = await addTeam(WS, '신팀')
    expect(r.ok).toBe(true)
    expect(db.inserted.minute_folders).toHaveLength(0)
  })

  // 0006 — 미지정 루트는 워크스페이스별이다. 다른 워크스페이스의 동명 루트를 "이미 있다"로 오인하지 않고,
  // 새 루트에는 부모·프로젝트가 없어 트리거가 못 채우므로 workspace_id 를 명시한다.
  it('동명 시드 폴더가 다른 워크스페이스 것이면 이 워크스페이스에 workspace_id 를 명시해 만든다', async () => {
    asAdmin()
    db.folders = [{ id: 'f2', name: '신팀', parent_id: null, created_by: null, workspace_id: 'ws-other' }]
    const r = await addTeam(WS, '신팀')
    expect(r.ok).toBe(true)
    expect(db.inserted.minute_folders).toHaveLength(1)
    expect(db.inserted.minute_folders[0]).toMatchObject({ name: '신팀', parent_id: null, project_id: null, workspace_id: WS })
  })

  // 0071 이후 project_id 로도 스코프해야 한다 — 프로젝트 루트 폴더가 같은 이름을 먼저 선점해도
  // 전역 루트 시드 dup-check 는 그 행을 무시하고 새로 만들어야 한다(post-0076 드리프트 회귀).
  it('동명 폴더가 다른 프로젝트 소속이면 전역 루트 시드는 별도로 생성된다', async () => {
    asAdmin()
    db.folders = [{ id: 'pf1', name: '신팀', parent_id: null, created_by: null, project_id: 'p1' }]
    const r = await addTeam(WS, '신팀')
    expect(r.ok).toBe(true)
    expect(db.inserted.minute_folders).toHaveLength(1)
    expect(db.inserted.minute_folders[0]).toMatchObject({ name: '신팀', parent_id: null, created_by: null, project_id: null })
  })

  it('updateTeam: 빈 patch 거부, 정상 patch 는 스네이크케이스로 update', async () => {
    asAdmin()
    db.teams = [{ id: 't1', code: 'PMO', project_id: null, workspace_id: WS }]
    expect((await updateTeam('t1', {})).ok).toBe(false)
    const r = await updateTeam('t1', { active: false, progressVisible: true, sortOrder: 3 })
    expect(r.ok).toBe(true)
    expect(db.updated[0]).toMatchObject({ id: 't1', patch: { active: false, progress_visible: true, sort_order: 3 } })
    expect(refreshTeams).toHaveBeenCalled()
  })
})
