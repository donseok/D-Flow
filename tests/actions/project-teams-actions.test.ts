import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/cache · authz 가드 · admin 클라이언트 · 팀 마스터 캐시를 모킹해 게이트·검증·프로젝트 스코프만 본다.
// 프로젝트 팀은 이 프로젝트 관리자만 손댈 수 있다(0071 §4) — 전역 teams.ts(슈퍼유저 전용)와는
// 가드가 다르고, 회의록 시드 폴더도 만들지 않는다(스펙 §5) — from('minute_folders') 호출 자체를
// 차단해 그 계약을 무너뜨리는 회귀를 즉시 실패로 드러낸다.
const { db, fromCalls, createAdminClient, refreshTeams, requireProjectAdmin, workspaceTeams, referencedCommonTeamCodes } = vi.hoisted(() => {
  const db = {
    teams: [] as Array<Record<string, unknown>>,
    inserted: { teams: [] as Array<Record<string, unknown>> },
    updated: [] as Array<{ patch: unknown; id: unknown }>,
  }
  const fromCalls: string[] = []
  const table = () => {
    const rows = () => db.teams
    const filters: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {}
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q }
    Object.assign(q, {
      select: chain(),
      eq: chain((col, v) => filters.push([String(col), v])),
      order: chain(),
      limit: chain(),
      // 목록 조회(select … eq 뒤 바로 await — addProjectTeam 의 같은 프로젝트 팀 목록)
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows().filter(r => filters.every(([c, v]) => (r[c] ?? null) === v)), error: null }).then(res, rej),
      maybeSingle: async () => {
        const found = rows().find(r => filters.every(([c, v]) => (r[c] ?? null) === v))
        return { data: found ?? (filters.length === 0 ? rows()[0] ?? null : null), error: null }
      },
      insert: async (row: unknown) => {
        const arr = (Array.isArray(row) ? row : [row]) as Array<Record<string, unknown>>
        db.inserted.teams.push(...arr)
        return { error: null }
      },
      // .eq() 를 여러 번 받아 컬럼별로 누적한다(updateProjectTeam 의 .eq('id').eq('project_id')
      // 이중 필터를 정확히 흉내내야 "전역 행·타 프로젝트 행은 0행"이 제대로 검증된다.
      update: (patch: unknown) => {
        const updFilters: Array<[string, unknown]> = []
        const upd: Record<string, unknown> = {
          eq: (col: string, v: unknown) => { updFilters.push([col, v]); return upd },
          select: async (_cols: string) => {
            const target = rows().find(r => updFilters.every(([c, v]) => (r[c] ?? null) === v))
            if (target) db.updated.push({ patch, id: target.id })
            return { data: target ? [{ id: target.id }] : [], error: null }
          },
        }
        return upd
      },
    })
    return q
  }
  const createAdminClient = vi.fn(() => ({
    from: (n: string) => {
      fromCalls.push(n)
      // 프로젝트 팀 액션은 'teams' 테이블만 만진다 — 다른 테이블(특히 minute_folders) 접근은
      // 회의록 시드 폴더 계약 위반이라 즉시 던져 테스트를 실패시킨다.
      if (n !== 'teams') throw new Error(`프로젝트 팀 액션이 ${n} 테이블을 건드렸습니다(전역 팀 축 위반)`)
      return table()
    },
  }))
  const refreshTeams = vi.fn(async () => true)
  const requireProjectAdmin = vi.fn()
  const workspaceTeams = vi.fn()
  const referencedCommonTeamCodes = vi.fn(async (): Promise<Map<string, string>> => new Map())
  return { db, fromCalls, createAdminClient, refreshTeams, requireProjectAdmin, workspaceTeams, referencedCommonTeamCodes }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/teams/master', () => ({ refreshTeams }))
// 공용 팀 복사의 원천(SP4 A2 — 요청 범위, service_role 로)
vi.mock('@/lib/teams/source', () => ({ workspaceTeams }))
// 이 프로젝트가 이미 쓰는 공용 팀 code(A2-1 리뷰 보안 P3 — 가져오기 Z4 와 같은 판정). service_role 판정 모듈이라 목으로 — teams 만 만지는 계약 밖
vi.mock('@/lib/teams/referencedCommon', () => ({ referencedCommonTeamCodes }))
// 팀 예약어는 그 프로젝트의 단계 이름까지(SP4 D38) — 설정 해석기는 목이라 admin 의 "teams 만" 계약에 걸리지 않는다
const cfg = vi.hoisted(() => ({ getProjectConfig: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: cfg.getProjectConfig }))

import { addProjectTeam, updateProjectTeam, copyGlobalTeams } from '@/app/actions/projectTeams'
import { makeAdminActor } from '../fixtures/actor'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

const ADMIN_ACTOR = makeAdminActor('p1', { userId: 'u-admin' })
const asAdmin = () => requireProjectAdmin.mockResolvedValue({ ok: true, actor: ADMIN_ACTOR })

describe('프로젝트 팀 관리 서버액션', () => {
  beforeEach(() => {
    db.teams = []
    db.inserted.teams = []
    db.updated = []
    fromCalls.length = 0
    createAdminClient.mockClear()
    refreshTeams.mockClear()
    requireProjectAdmin.mockReset()
    workspaceTeams.mockReset()
    referencedCommonTeamCodes.mockReset()
    referencedCommonTeamCodes.mockResolvedValue(new Map())
    cfg.getProjectConfig.mockReset()
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'] }))
  })

  describe('addProjectTeam', () => {
    it('프로젝트 관리자가 아니면 거부(fail-closed)', async () => {
      requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
      expect(await addProjectTeam('p1', '신팀')).toEqual({ ok: false, error: '권한 없음' })
      expect(createAdminClient).not.toHaveBeenCalled()
    })

    it('예약어·빈 이름 거부', async () => {
      asAdmin()
      expect((await addProjectTeam('p1', '산출물')).ok).toBe(false)
      expect((await addProjectTeam('p1', '   ')).ok).toBe(false)
      expect(db.inserted.teams).toHaveLength(0)
    })

    it('동일 프로젝트 내 중복 코드는 거부', async () => {
      asAdmin()
      db.teams = [{ id: 't-mine', code: 'ERP', name: 'ERP', project_id: 'p1', sort_order: 0 }]
      const r = await addProjectTeam('p1', 'ERP')
      expect(r.ok).toBe(false)
      expect(db.inserted.teams).toHaveLength(0)
    })

    it('전역·타 프로젝트의 동명 팀은 막지 않는다(복합 유니크와 일치)', async () => {
      asAdmin()
      db.teams = [
        { id: 't-global', code: 'ERP', name: 'ERP', project_id: null, sort_order: 0 },
        { id: 't-other', code: 'ERP', name: 'ERP', project_id: 'p2', sort_order: 0 },
      ]
      const r = await addProjectTeam('p1', 'ERP')
      expect(r.ok).toBe(true)
      expect(db.inserted.teams).toHaveLength(1)
    })

    it('[Q5] 같은 프로젝트 팀의 개명된 이름·대소문자만 다른 code 와 겹치는 새 code 는 거부(개명 규칙의 대칭)', async () => {
      asAdmin()
      db.teams = [{ id: 't-res', code: 'RES', name: '운영', project_id: 'p1', sort_order: 0 }]
      for (const input of ['운영', 'res', 'ＲＥＳ']) {
        const r = await addProjectTeam('p1', input)
        expect(r, input).toMatchObject({ ok: false, error: expect.stringContaining('다른 팀(RES)') })
      }
      expect(db.inserted.teams).toHaveLength(0)
      expect(referencedCommonTeamCodes).not.toHaveBeenCalled()
    })

    it('[Q4] 이 프로젝트가 이미 쓰는 공용 팀과 같은 code 의 전용 팀은 만들지 않는다 — 안내 문구, insert 없음(D4 분열 방지)', async () => {
      asAdmin()
      referencedCommonTeamCodes.mockResolvedValue(new Map([['QA', 'QA']]))
      const r = await addProjectTeam('p1', 'QA')
      expect(r).toEqual({ ok: false, error: expect.stringContaining("공용 팀 'QA'") })
      expect(referencedCommonTeamCodes).toHaveBeenCalledWith({ projectId: 'p1', workspaceId: 'ws-1' }, ['QA'])
      expect(db.inserted.teams).toHaveLength(0)
    })

    it('[U4] 이 프로젝트가 쓰는 공용 팀과 대소문자·전각만 다른 code 는 겹침으로 거부 — 전용 qa 가 공용 QA 참조와 갈라지지 않는다', async () => {
      asAdmin()
      for (const input of ['qa', 'ＱＡ']) {
        referencedCommonTeamCodes.mockResolvedValue(new Map([[input === 'qa' ? 'qa' : 'ＱＡ', 'QA']]))
        const r = await addProjectTeam('p1', input)
        expect(r, input).toMatchObject({ ok: false, error: expect.stringContaining('다른 팀(QA)') })
      }
      expect(db.inserted.teams).toHaveLength(0)
    })

    it('[Q4] 공용 팀 참조 판정 조회가 실패하면 만들지 않는다 — 고정 문구, 원문은 로그로만(3원칙 ②)', async () => {
      asAdmin()
      referencedCommonTeamCodes.mockRejectedValue(new Error('relation "item_owners" boom'))
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const r = await addProjectTeam('p1', 'QA')
      expect(r).toEqual({ ok: false, error: '팀 정보를 확인하지 못했습니다. 잠시 후 다시 시도하세요.' })
      expect(JSON.stringify(r)).not.toContain('boom')
      expect(db.inserted.teams).toHaveLength(0)
      err.mockRestore()
    })

    it('성공: teams insert(project_id·workspace_id·color 포함) + refreshTeams, 시드 폴더는 절대 만들지 않는다', async () => {
      asAdmin()
      const r = await addProjectTeam('p1', ' 신팀 ')
      expect(r.ok).toBe(true)
      // workspace_id 는 projects 를 다시 조회하지 않고 g.actor.projectWorkspace(fixtures 의 WS='ws-1')에서 얻는다.
      expect(db.inserted.teams[0]).toMatchObject({ code: '신팀', name: '신팀', project_id: 'p1', workspace_id: 'ws-1' })
      expect(db.inserted.teams[0].color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(refreshTeams).toHaveBeenCalled()
      expect(fromCalls).not.toContain('minute_folders')
      expect(fromCalls).not.toContain('projects')
    })
  })

  describe('updateProjectTeam', () => {
    it('프로젝트 관리자가 아니면 거부', async () => {
      requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
      expect(await updateProjectTeam('p1', 't1', { active: false })).toEqual({ ok: false, error: '권한 없음' })
    })

    it('빈 patch 거부', async () => {
      asAdmin()
      expect((await updateProjectTeam('p1', 't1', {})).ok).toBe(false)
    })

    // 조용한 no-op 을 성공으로 위장하지 않는다(teams.ts updateTeam·revokeProjectInvite 와 동일 관례) —
    // id 가 존재하지 않거나 전역/타 프로젝트 행이면 이중 .eq 필터에 걸려 0행이 된다.
    it('0행 매치(전역 행·타 프로젝트 행·존재하지 않는 id)는 실패로 보고한다(조용한 no-op 금지)', async () => {
      asAdmin()
      db.teams = [
        { id: 't-global', code: 'ERP', project_id: null },
        { id: 't-other', code: 'MES', project_id: 'p2' },
      ]
      expect(await updateProjectTeam('p1', 't-global', { active: false }))
        .toEqual({ ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' })
      expect(await updateProjectTeam('p1', 't-other', { active: false }))
        .toEqual({ ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' })
      expect(await updateProjectTeam('p1', 'no-such-id', { active: false }))
        .toEqual({ ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' })
      expect(db.updated).toHaveLength(0)
      expect(refreshTeams).not.toHaveBeenCalled()
    })

    it('성공: 이 프로젝트 소속 행만 스네이크케이스로 update', async () => {
      asAdmin()
      db.teams = [{ id: 't-mine', code: 'ERP', project_id: 'p1' }]
      const r = await updateProjectTeam('p1', 't-mine', { active: false, progressVisible: true, sortOrder: 3 })
      expect(r.ok).toBe(true)
      expect(db.updated[0]).toMatchObject({ id: 't-mine', patch: { active: false, progress_visible: true, sort_order: 3 } })
      expect(refreshTeams).toHaveBeenCalled()
    })
  })

  describe('copyGlobalTeams', () => {
    it('프로젝트 관리자가 아니면 거부', async () => {
      requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
      expect(await copyGlobalTeams('p1')).toEqual({ ok: false, error: '권한 없음' })
    })

    it('이미 프로젝트 팀이 정의되어 있으면 거부', async () => {
      asAdmin()
      db.teams = [{ id: 't-mine', code: 'ERP', project_id: 'p1', sort_order: 0 }]
      const r = await copyGlobalTeams('p1')
      expect(r.ok).toBe(false)
      expect(db.inserted.teams).toHaveLength(0)
    })

    it('전역 활성 팀이 0개면 거부(복사할 것이 없음) — 빈 insert 를 성공으로 위장하지 않는다', async () => {
      asAdmin()
      workspaceTeams.mockResolvedValue([])
      const r = await copyGlobalTeams('p1')
      expect(r).toEqual({ ok: false, error: '복사할 전역 팀이 없습니다.' })
      expect(db.inserted.teams).toHaveLength(0)
      expect(refreshTeams).not.toHaveBeenCalled()
    })

    it('전역 팀이 전부 비활성이어도 거부(활성 0건과 동치)', async () => {
      asAdmin()
      workspaceTeams.mockResolvedValue([
        { id: 'g-old', code: 'OLD', sortOrder: 0, active: false, progressVisible: true, projectId: null, workspaceId: 'ws-1' },
      ])
      const r = await copyGlobalTeams('p1')
      expect(r).toEqual({ ok: false, error: '복사할 전역 팀이 없습니다.' })
      expect(db.inserted.teams).toHaveLength(0)
    })

    it('성공: 전역 활성 팀만 복사하고 MDM 의 progressVisible=false 를 보존한다', async () => {
      asAdmin()
      workspaceTeams.mockResolvedValue([
        { id: 'g-pmo', code: 'PMO', sortOrder: 0, active: true, progressVisible: true, projectId: null, workspaceId: 'ws-1' },
        { id: 'g-mdm', code: 'MDM', sortOrder: 4, active: true, progressVisible: false, projectId: null, workspaceId: 'ws-1' },
        { id: 'g-old', code: 'OLD', sortOrder: 5, active: false, progressVisible: true, projectId: null, workspaceId: 'ws-1' },
      ])
      const r = await copyGlobalTeams('p1')
      expect(r.ok).toBe(true)
      expect(db.inserted.teams).toHaveLength(2)
      expect(db.inserted.teams).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PMO', project_id: 'p1', progress_visible: true, workspace_id: 'ws-1' }),
        expect.objectContaining({ code: 'MDM', project_id: 'p1', progress_visible: false, workspace_id: 'ws-1' }),
      ]))
      expect(db.inserted.teams.every(t => typeof t.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.color as string))).toBe(true)
      expect(db.inserted.teams.some(t => t.code === 'OLD')).toBe(false)
      expect(refreshTeams).toHaveBeenCalled()
      // 복사 원본은 이 프로젝트 워크스페이스의 공용 팀 — 다른 워크스페이스의 공용 팀을 끌어오지 않는다(SP2 §4.2).
      expect(workspaceTeams).toHaveBeenCalledWith('ws-1', { client: expect.objectContaining({ from: expect.any(Function) }) })
    })

    it('팀 원천 실패는 오류 — "복사할 팀 없음" 으로 위장하지 않는다', async () => {
      asAdmin()
      workspaceTeams.mockRejectedValue(new Error('팀 목록을 불러오지 못했습니다.'))
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const r = await copyGlobalTeams('p1')
      expect(r).toEqual({ ok: false, error: '팀 기준정보를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.' })
      expect(db.inserted.teams).toHaveLength(0)
      spy.mockRestore()
    })
  })
  it('프로젝트 단계 이름과 같은 팀 이름은 거부한다 — 대소문자를 무시한다(D38)', async () => {
    asAdmin()
    expect(await addProjectTeam('p1', '작업')).toEqual({ ok: false, error: "'작업'는 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다." })
    expect(await addProjectTeam('p1', 'START')).toEqual({ ok: false, error: "'START'는 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다." })
    expect(db.inserted.teams).toEqual([])
  })
  it('프로젝트의 추가 축 이름(core.extra_axis_label)도 예약어다(D38 — 카탈로그 소비처)', async () => {
    asAdmin()
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'], 'core.extra_axis_label': '사업영역A' }))
    expect(await addProjectTeam('p1', '사업영역a')).toEqual({ ok: false, error: "'사업영역a'는 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다." })
    expect(db.inserted.teams).toEqual([])
  })
  it('설정을 읽지 못하면 팀을 만들지 않는다 — 예약어를 모르는 채 통과시키지 않는다(3원칙 ②)', async () => {
    asAdmin()
    cfg.getProjectConfig.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await addProjectTeam('p1', '신팀')
    expect(r.ok).toBe(false)
    expect(db.inserted.teams).toEqual([])
    expect(fromCalls).toEqual([])
    err.mockRestore()
  })
})
