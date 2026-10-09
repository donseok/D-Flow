// 팀 병합(*_team_merge — 팀 유연화 2단계 ②). 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다.
// 실행권·등급 재판정, 범위 불일치·자기 자신·비활성 대상 거부, 참조 이전과 중복 제거 규칙(주관·대표가 이긴다), 회의록·팀 루트·초대·자격증명,
// 원본 비활성화, M1 불변식을 본다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const INSERT_AUTH_USER = `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  aud, role, instance_id, created_at, updated_at) values ($1, $2, '', now(), '{}', '{}', 'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000', now(), now())`
const ID = (nn: string) => `00000000-0000-0000-7e57-0000000051${nn}`
const W = ID('00')                       // 케이스 전용 워크스페이스(롤백)
const P = ID('01')
const Q = ID('02')
const MERGE = 'select public.merge_teams($1, $2, $3) as r'
const COUNTS = 'select public.team_reference_counts($1) as r'
const CREATE = 'select public.create_team($1, $2, $3, $4, $5, $6) as id'
const ZERO = { item_owners: 0, project_member_teams: 0, area_teams: 0, minutes: 0, minute_folders: 0, invites: 0, credentials: 0 }

async function seedWorkspace(c: PoolClient) {
  await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-team-merge', '병합')`, [W])
  await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3), ($4, $5, $3)', [P, '병합 P', W, Q, '병합 Q'])
}
/** 공용 팀(+ teams 모드의 워크스페이스 팀 루트) */
const commonTeam = async (c: PoolClient, code: string, name: string, sort: number) =>
  (await c.query<{ id: string }>(CREATE, [F.users.platform, W, code, name, null, sort])).rows[0].id
const projectTeam = async (c: PoolClient, project: string, code: string, name = code) =>
  (await c.query<{ id: string }>('insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, $3, $4) returning id',
    [W, project, code, name])).rows[0].id
const rootOf = async (c: PoolClient, team: string, project: string | null) =>
  (await c.query<{ id: string; name: string }>(
    `select id, name from public.minute_folders where kind = 'team_root' and team_id = $1 and project_id is not distinct from $2`, [team, project])).rows[0]
const insertItem = async (c: PoolClient, project: string, code: string) =>
  (await c.query<{ id: string }>(`insert into public.wbs_items (project_id, code, name) values ($1, $2, $3) returning id`, [project, code, `병합 항목 ${code}`])).rows[0].id
const own = (c: PoolClient, item: string, team: string, kind: 'primary' | 'support') =>
  c.query('insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, $3)', [item, team, kind])
const ownersOf = async (c: PoolClient, item: string) =>
  (await c.query<{ team_id: string; kind: string }>('select team_id, kind from public.item_owners where wbs_item_id = $1 order by team_id', [item])).rows
async function seedMember(c: PoolClient, nn: string, project: string) {
  const user = ID(`a${nn}`), person = ID(`b${nn}`), member = ID(`c${nn}`)   // nn 은 한 글자
  await c.query(INSERT_AUTH_USER, [user, `rls-team-merge-${nn}@example.com`])
  await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [W, user])
  await c.query(`insert into public.people (id, workspace_id, display_name, email, user_id) values ($1, $2, $3, $4, $5)`,
    [person, W, `병합 ${nn}`, `rls-team-merge-${nn}@example.com`, user])
  await c.query(`insert into public.project_members (id, project_id, person_id, access_role) values ($1, $2, $3, 'member')`, [member, project, person])
  return member
}
const memberTeam = (c: PoolClient, member: string, team: string, primary: boolean) =>
  c.query('insert into public.project_member_teams (member_id, team_id, is_primary) values ($1, $2, $3)', [member, team, primary])
const insertMinute = async (c: PoolClient, v: { project: string | null; code: string; folder?: string | null }) =>
  (await c.query<{ id: string; team_id: string | null }>(
    `insert into public.minutes (project_id, workspace_id, minute_date, team_code, title, body_md, folder_id)
     values ($1, $2, '2026-10-09', $3, '병합 회의록', '# m', $4) returning id, team_id`, [v.project, W, v.code, v.folder ?? null])).rows[0]
const subFolder = async (c: PoolClient, parent: string, name: string, project: string | null = null) =>
  (await c.query<{ id: string }>(
    'insert into public.minute_folders (name, parent_id, workspace_id, project_id, created_by) values ($1, $2, $3, $4, $5) returning id',
    [name, parent, W, project, F.users.platform])).rows[0].id

describe('merge_teams — 실행권·등급 재판정·입력', () => {
  it('JWT 세션은 병합도 건수 조회도 실행하지 못한다(42501)', async () => {
    await asUser(pool, F.users.platform, async (c) => {
      expect(await pgError(c, MERGE, [F.users.platform, F.teams.mes, F.teams.erp]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function merge_teams') })
      expect(await pgError(c, COUNTS, [F.teams.erp]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function team_reference_counts') })
    })
  })
  it('전용 팀은 그 프로젝트의 관리자만, 공용 팀은 워크스페이스 관리자만 — 아니면 TEAM_MERGE_FORBIDDEN(아무것도 옮기지 않는다)', async () => {
    await asService(pool, async (c) => {
      const FORBIDDEN = { code: '42501', message: 'TEAM_MERGE_FORBIDDEN' }
      const before = (await c.query(COUNTS, [F.teams.mes])).rows[0].r
      expect(await pgError(c, MERGE, [F.users.aLoose, F.teams.mes, F.teams.erp])).toMatchObject(FORBIDDEN)
      expect(await pgError(c, MERGE, [F.users.dual, F.teams.mes, F.teams.erp])).toMatchObject(FORBIDDEN)     // A 명단 member
      expect(await pgError(c, MERGE, [F.users.bAdmin, F.teams.mes, F.teams.erp])).toMatchObject(FORBIDDEN)   // 다른 워크스페이스 관리자
      expect((await c.query(COUNTS, [F.teams.mes])).rows[0].r).toEqual(before)
      // 공용 팀 — A 프로젝트의 명단 관리자(alice)는 워크스페이스 관리자가 아니다
      const other = (await c.query(`insert into public.teams (workspace_id, project_id, code, name) values ($1, null, 'SH2', 'SH2') returning id`, [F.ws])).rows[0].id
      expect(await pgError(c, MERGE, [F.users.member, F.teams.aShared, other])).toMatchObject(FORBIDDEN)
      expect((await c.query(MERGE, [F.users.wsAdmin, F.teams.aShared, other])).rows[0].r).toMatchObject({ status: 'merged' })
    })
  })
  it('자기 자신·범위 불일치·비활성 대상·없는 팀은 거부한다', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const common = await commonTeam(c, 'CMN', '공용', 0)
      const inP = await projectTeam(c, P, 'PA')
      const inQ = await projectTeam(c, Q, 'QA')
      const MISMATCH = { code: '23514', message: 'TEAM_MERGE_SCOPE_MISMATCH' }
      expect(await pgError(c, MERGE, [F.users.platform, common, common])).toMatchObject({ code: '22023', message: 'TEAM_MERGE_SAME_TEAM' })
      expect(await pgError(c, MERGE, [F.users.platform, common, inP])).toMatchObject(MISMATCH)      // 공용 → 전용
      expect(await pgError(c, MERGE, [F.users.platform, inP, common])).toMatchObject(MISMATCH)      // 전용 → 공용
      expect(await pgError(c, MERGE, [F.users.platform, inP, inQ])).toMatchObject(MISMATCH)         // 다른 프로젝트
      expect(await pgError(c, MERGE, [F.users.platform, common, F.teams.aShared])).toMatchObject(MISMATCH)   // 다른 워크스페이스의 공용 팀
      expect(await pgError(c, MERGE, [F.users.platform, common, ID('ff')])).toMatchObject({ code: 'P0002', message: 'TEAM_NOT_FOUND' })
      expect(await pgError(c, MERGE, [null, common, inP])).toMatchObject({ code: '22023', message: 'TEAM_MERGE_INVALID_INPUT' })
      const off = await projectTeam(c, P, 'OFF')
      await c.query('update public.teams set active = false where id = $1', [off])
      expect(await pgError(c, MERGE, [F.users.platform, inP, off])).toMatchObject({ code: '23514', message: 'TEAM_MERGE_TARGET_INACTIVE' })
      // 비활성 원본을 활성 대상으로 합치는 것은 된다(옛 팀 정리)
      expect((await c.query(MERGE, [F.users.platform, off, inP])).rows[0].r).toMatchObject({ status: 'merged' })
    })
  })
})

describe('merge_teams — 참조 이전과 중복 제거', () => {
  it('공용 팀 병합: 담당·명단·영역·초대·회의록·팀 루트·자격증명이 대상으로 가고 원본은 비활성으로 남는다', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const src = await commonTeam(c, 'SRC', '원본팀', 0)
      const tgt = await commonTeam(c, 'TGT', '대상팀', 1)
      const etc = await commonTeam(c, 'ETC', '그밖', 2)

      // 작업 담당 — ① 원본 주관 + 대상 지원 ② 원본 지원만 ③ 원본 지원 + 대상 주관 ④ 원본 주관만(프로젝트 Q)
      const i1 = await insertItem(c, P, '1'), i2 = await insertItem(c, P, '2'), i3 = await insertItem(c, P, '3'), i4 = await insertItem(c, Q, '1')
      await own(c, i1, src, 'primary'); await own(c, i1, tgt, 'support')
      await own(c, i2, src, 'support')
      await own(c, i3, src, 'support'); await own(c, i3, tgt, 'primary'); await own(c, i3, etc, 'support')
      await own(c, i4, src, 'primary')
      // 명단의 팀 — ① 원본 대표 + 대상(대표 아님) ② 원본만(대표) ③ 원본(대표 아님) + 대상 대표
      const m1 = await seedMember(c, '1', P), m2 = await seedMember(c, '2', P), m3 = await seedMember(c, '3', Q)
      await memberTeam(c, m1, src, true); await memberTeam(c, m1, tgt, false)
      await memberTeam(c, m2, src, true)
      await memberTeam(c, m3, src, false); await memberTeam(c, m3, tgt, true)
      // 영역 담당 — ① 원본 주관 + 대상 지원 ② 원본 지원만
      const a1 = (await c.query(`insert into public.project_areas (project_id, kind, code, name) values ($1, 'weekly_section', 'LAB', '실험') returning id`, [P])).rows[0].id
      const a2 = (await c.query(`insert into public.project_areas (project_id, kind, code, name) values ($1, 'weekly_section', 'OPS', '운영') returning id`, [P])).rows[0].id
      await c.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $3, 'primary'), ($1, $4, 'support'), ($2, $3, 'support')`, [a1, a2, src, tgt])
      // 초대 — 수락 전 [원본, 대상, 그밖] / 수락한 것 [원본](기록 — 그대로)
      const invOpen = ID('d1'), invDone = ID('d2')
      await c.query(`insert into public.project_invites (id, workspace_id, project_id, email, access_role, token_hash, created_by, expires_at, team_ids, redeemed_at)
        values ($1, $3, $4, 'rls-merge-open@example.com', 'member', 'rls-team-merge-open', $5, now() + interval '1 day', array[$6, $7, $8]::uuid[], null),
               ($2, $3, $4, 'rls-merge-done@example.com', 'member', 'rls-team-merge-done', $5, now() + interval '1 day', array[$6]::uuid[], now())`,
        [invOpen, invDone, W, P, F.users.platform, src, tgt, etc])
      // 회의록 팀 루트 — 워크스페이스 루트는 둘 다 있다(create_team). 원본 아래 '자료'·'주간', 대상 아래 '주간'(이름 겹침)
      const srcRoot = (await rootOf(c, src, null)).id, tgtRoot = (await rootOf(c, tgt, null)).id
      const fData = await subFolder(c, srcRoot, '자료'), fWeekly = await subFolder(c, srcRoot, '주간')
      const fTargetWeekly = await subFolder(c, tgtRoot, '주간')
      // 프로젝트 P 의 원본 팀 루트만 있다(대상 것은 없다) → 원본 루트가 대상의 루트가 된다
      const srcRootP = (await c.query(`select public.minute_team_root_insert($1, $2, $3, '원본팀', 100) as id`, [W, P, src])).rows[0].id
      // 회의록 — 워크스페이스(원본 루트 바로 아래), 프로젝트 P(하위 폴더 안), 대상 팀 것 하나
      const mWs = await insertMinute(c, { project: null, code: 'SRC', folder: srcRoot })
      const mP = await insertMinute(c, { project: P, code: 'SRC', folder: null })
      const mTgt = await insertMinute(c, { project: null, code: 'TGT', folder: fTargetWeekly })
      expect([mWs.team_id, mP.team_id, mTgt.team_id]).toEqual([src, src, tgt])
      await c.query(`insert into public.minute_versions (minute_id, version_no, body_md, body_hash, title, minute_date, team_code, project_id)
        values ($1, 1, '# m', 'rls-merge-h', '병합 회의록', '2026-10-09', 'SRC', null)`, [mWs.id])
      // 연동 자격증명 — 기본 팀·팀 매핑
      const cred = (await c.query(`insert into public.integration_credentials (workspace_id, kind, name, token_prefix, token_hash, expires_at, default_team_id, team_map)
        values ($1, 'minutes_api', '병합 연동', 'rlsmerge0001', repeat('a', 64), now() + interval '1 day', $2, $3::jsonb) returning id`,
        [W, src, JSON.stringify({ 원본부서: src, 그밖부서: etc })])).rows[0].id

      expect((await c.query(COUNTS, [src])).rows[0].r).toEqual({
        item_owners: 4, project_member_teams: 3, area_teams: 2, minutes: 2, minute_folders: 2, invites: 1, credentials: 1,
      })
      const r = (await c.query(MERGE, [F.users.platform, src, tgt])).rows[0].r
      expect(r).toMatchObject({
        status: 'merged',
        source: { id: src, code: 'SRC', name: '원본팀' }, target: { id: tgt, code: 'TGT', name: '대상팀' },
        moved: { item_owners: 2, project_member_teams: 1, area_teams: 1, minutes: 2, invites: 1, credentials: 1 },
        deduped: { item_owners: 2, project_member_teams: 2, area_teams: 1 },
        folders: { roots_repointed: 1, roots_merged: 1, moved: 2, renamed: 1, minutes_moved: 1 },
        source_references: ZERO,
      })

      // 담당 — 주관이 지원을 이긴다
      expect(await ownersOf(c, i1)).toEqual([{ team_id: tgt, kind: 'primary' }])
      expect(await ownersOf(c, i2)).toEqual([{ team_id: tgt, kind: 'support' }])
      expect((await ownersOf(c, i3)).sort((a, b) => a.team_id.localeCompare(b.team_id)))
        .toEqual([{ team_id: tgt, kind: 'primary' }, { team_id: etc, kind: 'support' }].sort((a, b) => a.team_id.localeCompare(b.team_id)))
      expect(await ownersOf(c, i4)).toEqual([{ team_id: tgt, kind: 'primary' }])
      // 명단 — 대표가 이긴다, 한 사람의 대표 팀은 하나
      const teamsOf = async (m: string) => (await c.query('select team_id, is_primary from public.project_member_teams where member_id = $1', [m])).rows
      expect(await teamsOf(m1)).toEqual([{ team_id: tgt, is_primary: true }])
      expect(await teamsOf(m2)).toEqual([{ team_id: tgt, is_primary: true }])
      expect(await teamsOf(m3)).toEqual([{ team_id: tgt, is_primary: true }])
      // 영역
      expect((await c.query('select team_id, kind from public.area_teams where area_id = $1', [a1])).rows).toEqual([{ team_id: tgt, kind: 'primary' }])
      expect((await c.query('select team_id, kind from public.area_teams where area_id = $1', [a2])).rows).toEqual([{ team_id: tgt, kind: 'support' }])
      // 초대 — 수락 전은 치환 + 중복 제거(자리 유지), 수락한 것은 그대로
      expect((await c.query('select team_ids from public.project_invites where id = $1', [invOpen])).rows[0].team_ids).toEqual([tgt, etc])
      expect((await c.query('select team_ids from public.project_invites where id = $1', [invDone])).rows[0].team_ids).toEqual([src])
      // 회의록 — team_id·team_code 는 대상, 버전 스냅샷은 그대로
      expect((await c.query('select team_id, team_code, folder_id from public.minutes where id = $1', [mWs.id])).rows[0])
        .toEqual({ team_id: tgt, team_code: 'TGT', folder_id: tgtRoot })
      expect((await c.query('select team_id, team_code from public.minutes where id = $1', [mP.id])).rows[0]).toEqual({ team_id: tgt, team_code: 'TGT' })
      expect((await c.query('select team_code from public.minute_versions where minute_id = $1', [mWs.id])).rows[0].team_code).toBe('SRC')
      // 팀 루트 — 워크스페이스: 하위 폴더가 대상 루트 아래로(겹친 이름은 '이름 (원본 팀 이름)'), 원본 루트는 없다
      expect((await c.query('select count(*)::int as n from public.minute_folders where id = $1', [srcRoot])).rows[0].n).toBe(0)
      const children = (await c.query('select id, name from public.minute_folders where parent_id = $1 order by name', [tgtRoot])).rows
      expect(children).toEqual([
        { id: fData, name: '자료' }, { id: fTargetWeekly, name: '주간' }, { id: fWeekly, name: '주간 (원본팀)' },
      ].sort((a, b) => a.name.localeCompare(b.name)))
      // 프로젝트 P: 원본 루트가 그대로 대상의 루트가 됐다(id 불변, 이름 = 대상 팀 이름)
      expect(await rootOf(c, tgt, P)).toEqual({ id: srcRootP, name: '대상팀' })
      // 자격증명
      expect((await c.query('select default_team_id, team_map from public.integration_credentials where id = $1', [cred])).rows[0])
        .toEqual({ default_team_id: tgt, team_map: { 원본부서: tgt, 그밖부서: etc } })
      // 원본은 지워지지 않고 비활성 — code·이름 그대로
      expect((await c.query('select code, name, active from public.teams where id = $1', [src])).rows[0]).toEqual({ code: 'SRC', name: '원본팀', active: false })
      expect((await c.query('select active from public.teams where id = $1', [tgt])).rows[0].active).toBe(true)
    })
  })
  it('전용 팀 병합: 프로젝트 관리자가 MES 를 ERP 로 — 둘 다 가진 명단은 한 행(대표 유지), 다른 프로젝트는 그대로', async () => {
    await asService(pool, async (c) => {
      const others = async () => (await c.query(
        `select (select count(*)::int from public.item_owners where team_id in ($1, $2)) as owners,
                (select count(*)::int from public.project_member_teams where team_id in ($1, $2, $3)) as members`,
        [F.teams.qa, F.teams.qa2, F.teams.ops])).rows[0]
      const before = await others()
      const r = (await c.query(MERGE, [F.users.member, F.teams.mes, F.teams.erp])).rows[0].r
      expect(r).toMatchObject({ status: 'merged', deduped: { project_member_teams: 1 }, source_references: ZERO })
      expect((await c.query('select team_id, is_primary from public.project_member_teams where member_id = $1', [F.members.aliceA])).rows)
        .toEqual([{ team_id: F.teams.erp, is_primary: true }])
      expect((await c.query('select active from public.teams where id = $1', [F.teams.mes])).rows[0].active).toBe(false)
      expect(await others()).toEqual(before)
    })
  })
  it('이름이 겹치는 하위 폴더가 여럿이면 번호를 붙이고, 긴 이름은 앞을 줄여 60자 안에 든다', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const src = await commonTeam(c, 'SRC', '원본팀', 0)
      const tgt = await commonTeam(c, 'TGT', '대상팀', 1)
      const srcRoot = (await rootOf(c, src, null)).id, tgtRoot = (await rootOf(c, tgt, null)).id
      const long = 'ㄱ'.repeat(60)
      await subFolder(c, srcRoot, '주간'); await subFolder(c, srcRoot, long)
      await subFolder(c, tgtRoot, '주간'); await subFolder(c, tgtRoot, '주간 (원본팀)'); await subFolder(c, tgtRoot, long)
      const r = (await c.query(MERGE, [F.users.platform, src, tgt])).rows[0].r
      expect(r.folders).toMatchObject({ roots_merged: 1, moved: 2, renamed: 2 })
      const names = (await c.query<{ name: string }>('select name from public.minute_folders where parent_id = $1', [tgtRoot])).rows.map((x) => x.name)
      expect(names).toContain('주간 (원본팀 2)')
      const renamedLong = names.find((n) => n.endsWith(' (원본팀)') && n.startsWith('ㄱ'))
      expect(renamedLong).toBeDefined()
      expect([...renamedLong!].length).toBeLessThanOrEqual(60)
      expect(new Set(names).size).toBe(names.length)
    })
  })
  it('M1 불변식: 원본 공용 팀을 가리키는 프로젝트가 대상과 같은 code 의 전용 팀을 갖고 있으면 TEAM_MERGE_SCOPE_CONFLICT', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const src = await commonTeam(c, 'SRC', '원본팀', 0)
      const tgt = await commonTeam(c, 'TGT', '대상팀', 1)
      // P 는 상속 시절 공용 SRC 를 담당으로 걸어 둔 뒤 전용 팀 TGT(같은 code)를 만들었다
      const item = await insertItem(c, P, '1')
      await own(c, item, src, 'primary')
      await projectTeam(c, P, 'TGT', 'P 의 대상')
      expect(await pgError(c, MERGE, [F.users.platform, src, tgt])).toMatchObject({ code: '23514', message: 'TEAM_MERGE_SCOPE_CONFLICT' })
      expect(await ownersOf(c, item)).toEqual([{ team_id: src, kind: 'primary' }])
      expect((await c.query('select active from public.teams where id = $1', [src])).rows[0].active).toBe(true)
    })
  })
  it('병합 뒤에도 code 는 RPC 밖에서 바뀌지 않고, 세션은 팀을 직접 고치지 못한다', async () => {
    await asService(pool, async (c) => {
      await c.query(MERGE, [F.users.member, F.teams.mes, F.teams.erp])
      expect(await pgError(c, `update public.teams set code = 'ZZZ' where id = $1`, [F.teams.mes])).toMatchObject({ code: '23514', message: 'TEAM_CODE_IMMUTABLE' })
    })
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, `update public.teams set active = false where id = $1`, [F.teams.erp])).toMatchObject({ code: '42501' })
    })
  })
})
