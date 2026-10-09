// 팀 코드 변경(*_team_code_change — 팀 유연화 2단계 ①). 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다.
// 한 길(change_team_code)에서만 code 불변이 풀리는지, RPC 안의 등급 재판정, 유일성·M1 불변식의 DB 최종 판정,
// 회의록 사본(minutes.team_code)은 따라가고 버전 스냅샷(minute_versions.team_code)은 그대로인지, 그 뒤의 메타 변경·새 버전이 팀을 유지하는지 본다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const ID = (nn: string) => `00000000-0000-0000-7e57-0000000050${nn}`
const W = ID('00')                       // 케이스 전용 워크스페이스(롤백)
const P = ID('01')
const Q = ID('02')
const CHANGE = 'select public.change_team_code($1, $2, $3) as r'
const CODE_OF = 'select code from public.teams where id = $1'

async function seedWorkspace(c: PoolClient) {
  await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-team-code', '코드 변경')`, [W])
  await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3), ($4, $5, $3)', [P, '코드 P', W, Q, '코드 Q'])
}
const insertTeam = async (c: PoolClient, v: { project: string | null; code: string; name?: string; active?: boolean }) =>
  (await c.query<{ id: string }>(
    'insert into public.teams (workspace_id, project_id, code, name, active) values ($1, $2, $3, $4, $5) returning id',
    [W, v.project, v.code, v.name ?? v.code, v.active ?? true])).rows[0].id
const insertMinute = async (c: PoolClient, v: { project: string | null; code: string }) =>
  (await c.query<{ id: string; team_id: string | null; team_code: string }>(
    `insert into public.minutes (project_id, workspace_id, minute_date, team_code, title, body_md)
     values ($1, $2, '2026-10-09', $3, '코드 변경 회의록', '# c') returning id, team_id, team_code`, [v.project, W, v.code])).rows[0]
async function toSession(c: PoolClient, userId: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
}

describe('change_team_code — 실행권·등급 재판정', () => {
  it('JWT 세션은 실행하지 못한다(42501) — 플랫폼 관리자여도', async () => {
    await asUser(pool, F.users.platform, async (c) => {
      expect(await pgError(c, CHANGE, [F.users.platform, F.teams.aShared, 'SHX']))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function change_team_code') })
    })
  })
  it('공용 팀은 워크스페이스 관리자만 — 프로젝트 관리자·다른 워크스페이스 관리자는 TEAM_CODE_CHANGE_FORBIDDEN', async () => {
    await asService(pool, async (c) => {
      const FORBIDDEN = { code: '42501', message: 'TEAM_CODE_CHANGE_FORBIDDEN' }
      expect(await pgError(c, CHANGE, [F.users.member, F.teams.aShared, 'SHX'])).toMatchObject(FORBIDDEN)   // A 프로젝트의 명단 관리자
      expect(await pgError(c, CHANGE, [F.users.bAdmin, F.teams.aShared, 'SHX'])).toMatchObject(FORBIDDEN)   // B 워크스페이스 관리자
      expect((await c.query(CODE_OF, [F.teams.aShared])).rows[0].code).toBe('SHR')
      expect((await c.query(CHANGE, [F.users.wsAdmin, F.teams.aShared, 'SHX'])).rows[0].r)
        .toMatchObject({ status: 'changed', old_code: 'SHR', code: 'SHX' })
      expect((await c.query(CODE_OF, [F.teams.aShared])).rows[0].code).toBe('SHX')
    })
  })
  it('전용 팀은 그 프로젝트의 관리자(명단 admin·워크스페이스 관리자·플랫폼) — 명단 없는 멤버·조회 전용은 거부', async () => {
    await asService(pool, async (c) => {
      const FORBIDDEN = { code: '42501', message: 'TEAM_CODE_CHANGE_FORBIDDEN' }
      expect(await pgError(c, CHANGE, [F.users.aLoose, F.teams.mes, 'MFG'])).toMatchObject(FORBIDDEN)
      expect(await pgError(c, CHANGE, [F.users.dual, F.teams.mes, 'MFG'])).toMatchObject(FORBIDDEN)      // A 명단 member
      expect((await c.query(CHANGE, [F.users.member, F.teams.mes, 'MFG'])).rows[0].r).toMatchObject({ status: 'changed', code: 'MFG' })
      expect((await c.query(CHANGE, [F.users.wsAdmin, F.teams.mes, 'MFG2'])).rows[0].r).toMatchObject({ status: 'changed', code: 'MFG2' })
      expect((await c.query(CHANGE, [F.users.platform, F.teams.mes, 'MES'])).rows[0].r).toMatchObject({ status: 'changed', code: 'MES' })
    })
  })
  it('입력 검증 — 빈 값·21자·제어 문자는 TEAM_CODE_INVALID, 없는 팀은 TEAM_NOT_FOUND, 같은 값은 unchanged', async () => {
    await asService(pool, async (c) => {
      const INVALID = { code: '22023', message: 'TEAM_CODE_INVALID' }
      expect(await pgError(c, CHANGE, [F.users.wsAdmin, F.teams.aShared, '  '])).toMatchObject(INVALID)
      expect(await pgError(c, CHANGE, [F.users.wsAdmin, F.teams.aShared, 'x'.repeat(21)])).toMatchObject(INVALID)
      expect(await pgError(c, CHANGE, [F.users.wsAdmin, F.teams.aShared, 'a\tb'])).toMatchObject(INVALID)
      expect(await pgError(c, CHANGE, [null, F.teams.aShared, 'SHX'])).toMatchObject(INVALID)
      expect(await pgError(c, CHANGE, [F.users.wsAdmin, ID('ff'), 'SHX'])).toMatchObject({ code: 'P0002', message: 'TEAM_NOT_FOUND' })
      expect((await c.query(CHANGE, [F.users.wsAdmin, F.teams.aShared, ' SHR '])).rows[0].r).toEqual({ status: 'unchanged', code: 'SHR' })
    })
  })
})

describe('code 불변은 이 RPC 안에서만 풀린다', () => {
  it('세션의 직접 UPDATE 는 권한이 없고, service_role 의 직접 UPDATE 는 TEAM_CODE_IMMUTABLE — RPC 뒤에도 그대로', async () => {
    await asService(pool, async (c) => {
      const IMMUTABLE = { code: '23514', message: 'TEAM_CODE_IMMUTABLE' }
      expect(await pgError(c, `update public.teams set code = 'ZZZ' where id = $1`, [F.teams.aShared])).toMatchObject(IMMUTABLE)
      await c.query(CHANGE, [F.users.wsAdmin, F.teams.aShared, 'SHX'])
      // 허가는 RPC 가 끝나며 비워진다 — 같은 트랜잭션의 뒤 문장으로 번지지 않는다(같은 팀·다른 팀 모두)
      expect((await c.query(`select current_setting('app.team_code_change', true) as v`)).rows[0].v).toBe('')
      expect(await pgError(c, `update public.teams set code = 'ZZZ' where id = $1`, [F.teams.aShared])).toMatchObject(IMMUTABLE)
      expect(await pgError(c, `update public.teams set code = 'ZZZ' where id = $1`, [F.teams.erp])).toMatchObject(IMMUTABLE)
      // 허가 값이 다른 팀 id 면 그 팀만 열린다 — 이 팀은 여전히 막힌다
      await c.query(`select set_config('app.team_code_change', $1, true)`, [F.teams.erp])
      expect(await pgError(c, `update public.teams set code = 'ZZZ' where id = $1`, [F.teams.aShared])).toMatchObject(IMMUTABLE)
    })
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, `update public.teams set code = 'ZZZ' where id = $1`, [F.teams.aShared])).toMatchObject({ code: '42501' })
    })
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, `update public.teams set code = 'ZZZ' where id = $1`, [F.teams.erp])).toMatchObject({ code: '42501' })
    })
  })
})

describe('유일성·M1 불변식은 DB 가 최종 판정한다', () => {
  it('같은 범위의 다른 팀이 쓰는 code 는 TEAM_CODE_TAKEN — 범위가 다르면(공용↔전용, 다른 프로젝트) 같은 code 를 쓸 수 있다', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const a = await insertTeam(c, { project: null, code: 'AAA' })
      await insertTeam(c, { project: null, code: 'BBB' })
      const pa = await insertTeam(c, { project: P, code: 'PA' })
      await insertTeam(c, { project: P, code: 'PB' })
      await insertTeam(c, { project: Q, code: 'QA' })
      expect(await pgError(c, CHANGE, [F.users.platform, a, 'BBB'])).toMatchObject({ code: '23505', message: 'TEAM_CODE_TAKEN' })
      expect(await pgError(c, CHANGE, [F.users.platform, pa, 'PB'])).toMatchObject({ code: '23505', message: 'TEAM_CODE_TAKEN' })
      expect((await c.query(CODE_OF, [a])).rows[0].code).toBe('AAA')
      // 다른 프로젝트의 code, 아무도 가리키지 않는 공용 팀의 code 는 겹쳐도 된다(복합 유일 키와 같다)
      expect((await c.query(CHANGE, [F.users.platform, pa, 'QA'])).rows[0].r).toMatchObject({ status: 'changed', code: 'QA' })
      expect((await c.query(CHANGE, [F.users.platform, pa, 'BBB'])).rows[0].r).toMatchObject({ status: 'changed', code: 'BBB' })
    })
  })
  it('전용 팀을 "그 프로젝트가 가리키는 공용 팀"의 code 로 바꾸면 TEAM_CODE_SCOPE_CONFLICT', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const common = await insertTeam(c, { project: null, code: 'OPS' })
      // 프로젝트 P 는 아직 전용 팀이 없던 때 공용 OPS 를 담당으로 걸어 뒀다
      const item = (await c.query(`insert into public.wbs_items (project_id, code, name) values ($1, '1', '코드 항목') returning id`, [P])).rows[0].id
      await c.query(`insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'primary')`, [item, common])
      const own = await insertTeam(c, { project: P, code: 'DEV' })
      expect(await pgError(c, CHANGE, [F.users.platform, own, 'OPS'])).toMatchObject({ code: '23514', message: 'TEAM_CODE_SCOPE_CONFLICT' })
      // 공용 팀 쪽에서 그 전용 팀의 code 로 가는 것도 같은 충돌이다
      expect(await pgError(c, CHANGE, [F.users.platform, common, 'DEV'])).toMatchObject({ code: '23514', message: 'TEAM_CODE_SCOPE_CONFLICT' })
      // 참조가 없는 프로젝트 Q 의 전용 팀은 OPS 로 바꿀 수 있다
      const other = await insertTeam(c, { project: Q, code: 'QQ' })
      expect((await c.query(CHANGE, [F.users.platform, other, 'OPS'])).rows[0].r).toMatchObject({ status: 'changed' })
    })
  })
})

describe('회의록 — 사본은 따라가고 버전 스냅샷은 그대로', () => {
  it('minutes.team_code 가 새 code 로 바뀌고 team_id·updated_at 은 그대로, minute_versions.team_code 는 옛 값', async () => {
    await asService(pool, async (c) => {
      const before = (await c.query('select team_id, team_code, updated_at from public.minutes where id = $1', [F.rows.minute])).rows[0]
      expect(before).toMatchObject({ team_id: F.teams.erp, team_code: 'ERP' })
      const r = (await c.query(CHANGE, [F.users.member, F.teams.erp, 'FIN'])).rows[0].r
      expect(r).toMatchObject({ status: 'changed', old_code: 'ERP', code: 'FIN' })
      expect(r.minutes).toBeGreaterThanOrEqual(1)
      const after = (await c.query('select team_id, team_code, updated_at from public.minutes where id = $1', [F.rows.minute])).rows[0]
      expect(after).toEqual({ team_id: F.teams.erp, team_code: 'FIN', updated_at: before.updated_at })
      expect((await c.query('select team_code from public.minute_versions where id = $1', [F.rows.minuteVersion])).rows[0].team_code).toBe('ERP')
      // 이 팀을 가리키지 않는 회의록(프로젝트 없는 ERP 글자 — team_id null)은 건드리지 않는다
      expect((await c.query('select team_id, team_code from public.minutes where id = $1', [F.rows.nullMinute])).rows[0])
        .toEqual({ team_id: null, team_code: 'ERP' })
    })
  })
  it('비활성 팀의 code 도 바뀐다 — 사본 갱신이 MINUTE_TEAM_INVALID 로 막히지 않는다', async () => {
    await asService(pool, async (c) => {
      await seedWorkspace(c)
      const t = await insertTeam(c, { project: null, code: 'OLD' })
      const m = await insertMinute(c, { project: null, code: 'OLD' })
      expect(m.team_id).toBe(t)
      await c.query('update public.teams set active = false where id = $1', [t])
      expect((await c.query(CHANGE, [F.users.platform, t, 'ARCHIVE'])).rows[0].r).toMatchObject({ status: 'changed', minutes: 1 })
      expect((await c.query('select team_id, team_code from public.minutes where id = $1', [m.id])).rows[0]).toEqual({ team_id: t, team_code: 'ARCHIVE' })
    })
  })
  it('코드 변경 뒤 메타 변경(팀 글자 없이)·새 버전은 팀을 유지하고 새 버전은 현재 code 를 적는다', async () => {
    await asService(pool, async (c) => {
      await c.query(CHANGE, [F.users.member, F.teams.erp, 'FIN'])
      // 메타 RPC — team_code 키 없이 제목만 바꾼다(화면의 프로젝트 지정·외부 API 의 부분 갱신과 같은 꼴)
      await c.query(`select * from public.update_minute_metadata_with_wiki_retraction($1, $2::jsonb)`, [F.rows.minute, JSON.stringify({ title: '바꾼 제목' })])
      expect((await c.query('select team_id, team_code, title from public.minutes where id = $1', [F.rows.minute])).rows[0])
        .toEqual({ team_id: F.teams.erp, team_code: 'FIN', title: '바꾼 제목' })
      // 새 code 로 다시 지정해도 같은 팀이다(화면의 메타 편집 — 늘 team_code 를 함께 보낸다)
      await c.query(`select * from public.update_minute_metadata_with_wiki_retraction($1, $2::jsonb)`, [F.rows.minute, JSON.stringify({ team_code: 'FIN' })])
      expect((await c.query('select team_id from public.minutes where id = $1', [F.rows.minute])).rows[0].team_id).toBe(F.teams.erp)
      // 새 본문 버전 — 스냅샷은 그 시점의 code
      const body = '# 새 본문'
      await c.query(
        `select * from public.commit_minute_body_version($1, $2, public.wiki_fnv1a64($2), null, null, null, null, $3, 'alice')`,
        [F.rows.minute, body, F.users.member])
      const versions = (await c.query('select team_code from public.minute_versions where minute_id = $1 order by version_no', [F.rows.minute])).rows
      expect(versions[0].team_code).toBe('ERP')
      expect(versions.at(-1)!.team_code).toBe('FIN')
      expect((await c.query('select team_id, team_code from public.minutes where id = $1', [F.rows.minute])).rows[0])
        .toEqual({ team_id: F.teams.erp, team_code: 'FIN' })
    })
  })
  it('세션은 여전히 minutes 를 직접 고치지 못한다(쓰기 정책 없음)', async () => {
    await asService(pool, async (c) => {
      await toSession(c, F.users.member)
      expect(await pgError(c, `update public.minutes set team_code = 'FIN' where id = $1`, [F.rows.minute])).toMatchObject({ code: '42501' })
    })
  })
})

describe('나머지 참조는 id 로 이어져 그대로다', () => {
  it('담당·명단·영역의 team_id 가 바뀌지 않는다', async () => {
    await asService(pool, async (c) => {
      const COUNT = `select (select count(*)::int from public.item_owners where team_id = $1) as owners,
        (select count(*)::int from public.project_member_teams where team_id = $1) as members,
        (select count(*)::int from public.area_teams where team_id = $1) as areas`
      const before = (await c.query(COUNT, [F.teams.erp])).rows[0]
      expect(before.owners).toBeGreaterThanOrEqual(1)
      await c.query(CHANGE, [F.users.member, F.teams.erp, 'FIN'])
      expect((await c.query(COUNT, [F.teams.erp])).rows[0]).toEqual(before)
    })
  })
})
