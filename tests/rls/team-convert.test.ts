// NNNN_command_receipts ⑤ convert_inherited_teams(스펙 §3.3·§3.5·D54) — 전용 팀이 없는(공용 팀을 상속하는) 프로젝트의 공용 팀을 원본 그대로
// 전용 팀으로 복사하고 그 프로젝트 안의 네 참조(담당·명단 팀·영역 팀·수락 전 초대의 team_ids)를 새 id 로 옮긴다. 케이스는 begin…rollback.
// 두 연결 케이스만 전용 워크스페이스(…aa43)를 커밋하고 finally 에서 그 워크스페이스 프로젝트의 area_teams → 프로젝트 → 워크스페이스 순으로
// 지운다 — 전환이 영역 팀을 전용 팀으로 옮겨 놓아 프로젝트 삭제가 area_teams_team_id_fkey(RESTRICT, K18)에 걸리기 때문이다(T8).
// 영역 팀 이전의 단언은 단일 연결(rollback) 케이스가 맡는다. 부트스트랩 계정·표 전체 행 수에 기대지 않는다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const INSERT_AUTH_USER = `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  aud, role, instance_id, created_at, updated_at) values ($1, $2, '', now(), '{}', '{}', 'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000', now(), now())`
const ID = (nn: string) => `00000000-0000-0000-7e57-0000000018${nn}`
const W = '00000000-0000-0000-7e57-00000000aa43'
const P = ID('60')                  // 전환 대상 — 전용 팀 0, 네 곳이 공용 팀을 가리킨다
const Q = ID('61')                  // 같은 워크스페이스의 다른 상속 프로젝트 — 전환이 건드리지 않아야 한다
/** 공용 팀 — 활성 RES·OPS, 비활성 OLD(P 의 담당이 가리킨다)·NOP(아무도 가리키지 않는다) */
const T = { res: ID('62'), ops: ID('63'), old: ID('64'), nop: ID('65') }
const U = ID('66')                  // W 의 멤버 계정 — P 명단 member, 명단 팀 RES(상속 시절 공용 팀으로 꾸린 명단)
const PERSON = ID('67')
const MEMBER = ID('68')
const ITEM_P = ID('69')
const ITEM_Q = ID('6a')
const AREA_P = ID('6b')
const AREA_Q = ID('6c')
const INV_OPEN = ID('6d')           // P 의 수락 전 초대 [RES, OPS]
const INV_DONE = ID('6e')           // P 의 수락한 초대 [RES] — 옮기지 않는다
const INV_Q = ID('6f')              // Q 의 수락 전 초대 [OPS]
const CONVERT = 'select public.convert_inherited_teams($1, $2) as r'
const IMPORT = 'select public.import_wbs_cmd($1, $2, $3, $4::jsonb, null, $5) as r'

async function seedInherited(c: PoolClient) {
  await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp4-convert', 'Acme 전환')`, [W])
  await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3), ($4, $5, $3)', [P, 'RLS 상속 P', W, Q, 'RLS 상속 Q'])
  await c.query(`insert into public.teams (id, workspace_id, project_id, code, name, color, sort_order, progress_visible, active) values
    ($1, $5, null, 'RES', '연구', '#1d4ed8', 0, true, true),
    ($2, $5, null, 'OPS', '운영', '#0f766e', 1, false, true),
    ($3, $5, null, 'OLD', '옛 팀', '#6b7280', 2, true, false),
    ($4, $5, null, 'NOP', '안 쓰는 팀', '#6b7280', 3, true, false)`, [T.res, T.ops, T.old, T.nop, W])
  await c.query(INSERT_AUTH_USER, [U, 'rls-sp4-convert@example.com'])
  await c.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [W, U])
  await c.query(`insert into public.people (id, workspace_id, display_name, email, user_id) values ($1, $2, 'convert', 'rls-sp4-convert@example.com', $3)`,
    [PERSON, W, U])
  await c.query(`insert into public.project_members (id, project_id, person_id, access_role) values ($1, $2, $3, 'member')`, [MEMBER, P, PERSON])
  await c.query('insert into public.project_member_teams (member_id, team_id, is_primary) values ($1, $2, true)', [MEMBER, T.res])
  await c.query(`insert into public.wbs_items (id, project_id, code, name) values ($1, $2, '1', 'RLS 상속 항목 P'), ($3, $4, '1', 'RLS 상속 항목 Q')`,
    [ITEM_P, P, ITEM_Q, Q])
  await c.query(`insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $3, 'primary'), ($1, $4, 'support'), ($2, $3, 'primary')`,
    [ITEM_P, ITEM_Q, T.res, T.old])
  await c.query(`insert into public.project_areas (id, project_id, kind, code, name) values
    ($1, $2, 'weekly_section', 'LAB', '실험'), ($3, $4, 'weekly_section', 'LAB', '실험')`, [AREA_P, P, AREA_Q, Q])
  await c.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $3, 'primary'), ($2, $3, 'primary')`, [AREA_P, AREA_Q, T.ops])
  await c.query(`insert into public.project_invites (id, workspace_id, project_id, email, access_role, token_hash, created_by, expires_at, team_ids, redeemed_at)
    values ($1, $4, $5, 'rls-sp4-open@example.com', 'member', 'rls-sp4-convert-open', $6, now() + interval '1 day', array[$7, $8]::uuid[], null),
           ($2, $4, $5, 'rls-sp4-done@example.com', 'member', 'rls-sp4-convert-done', $6, now() + interval '1 day', array[$7]::uuid[], now()),
           ($3, $4, $9, 'rls-sp4-q@example.com', 'member', 'rls-sp4-convert-q', $6, now() + interval '1 day', array[$8]::uuid[], null)`,
    [INV_OPEN, INV_DONE, INV_Q, W, P, F.users.platform, T.res, T.ops, Q])
}
/** 프로젝트의 네 참조 — 담당(종류·팀 순)·명단 팀·영역 팀의 팀 id, 초대는 'id:팀 id,…'(배열 순서 그대로) */
async function refs(c: PoolClient, projectId: string) {
  const { rows } = await c.query<{ owners: string[]; member_teams: string[]; area_teams: string[]; invites: string[] }>(`select
     array(select io.team_id::text from public.item_owners io join public.wbs_items w on w.id = io.wbs_item_id
            where w.project_id = $1 order by io.kind, io.team_id) as owners,
     array(select pmt.team_id::text from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
            where pm.project_id = $1 order by pmt.team_id) as member_teams,
     array(select art.team_id::text from public.area_teams art join public.project_areas a on a.id = art.area_id
            where a.project_id = $1 order by art.team_id) as area_teams,
     array(select i.id::text || ':' || coalesce(array_to_string(i.team_ids, ','), '') from public.project_invites i
            where i.project_id = $1 order by i.id) as invites`, [projectId])
  return rows[0]
}
async function toSession(c: PoolClient, userId: string) {
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
}
async function toServer(c: PoolClient) {
  await c.query('reset role')
  await c.query(`select set_config('request.jwt.claims', '', true)`)
}
/** P 에 RES 담당 리프 하나를 가져온다(import_wbs_cmd — 담당 code 는 그 프로젝트 전용 팀이 있으면 그것으로 풀린다, 0009) */
async function importResLeaf(c: PoolClient, name: string, cmd: string) {
  const items = JSON.stringify([{ tempId: 't0', code: '2', name, sortOrder: 1, owners: [{ team: 'RES', kind: 'primary' }] }])
  expect((await c.query(IMPORT, [F.users.platform, P, 'append', items, cmd])).rows[0].r).toMatchObject({ status: 'applied', count: 1 })
  return (await c.query<{ id: string }>('select id from public.wbs_items where project_id = $1 and name = $2', [P, name])).rows[0].id
}

describe('convert_inherited_teams — 실행 권한·입력·격리', () => {
  it('세션은 관리자여도 실행하지 못하고(42501) service_role 은 실행한다', async () => {
    await asUser(pool, F.users.platform, async (c) => {
      expect(await pgError(c, CONVERT, [F.users.platform, F.projects.a]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function convert_inherited_teams') })
    })
    await asService(pool, async (c) => {
      await seedInherited(c)
      await c.query('set local role service_role')
      expect((await c.query(CONVERT, [F.users.platform, P])).rows[0].r).toMatchObject({ status: 'converted' })
    })
  })

  it('프로젝트 관리자가 아니면 TEAM_CONVERT_FORBIDDEN(명단 member·다른 워크스페이스 관리자), 없는 프로젝트는 PROJECT_NOT_FOUND, null 은 TEAM_CONVERT_INVALID_INPUT', async () => {
    await asService(pool, async (c) => {
      await seedInherited(c)
      const FORBIDDEN = { code: '42501', message: 'TEAM_CONVERT_FORBIDDEN' }
      expect(await pgError(c, CONVERT, [U, P]), 'member').toMatchObject(FORBIDDEN)
      expect(await pgError(c, CONVERT, [F.users.wsAdmin, P]), 'A 관리자').toMatchObject(FORBIDDEN)
      expect(await pgError(c, CONVERT, [F.users.platform, ID('7f')])).toMatchObject({ code: 'P0002', message: 'PROJECT_NOT_FOUND' })
      for (const args of [[null, P], [F.users.platform, null]]) {
        expect(await pgError(c, CONVERT, args)).toMatchObject({ code: '22023', message: 'TEAM_CONVERT_INVALID_INPUT' })
      }
      expect((await c.query('select 1 from public.teams where project_id = $1', [P])).rowCount).toBe(0)
    })
  })

  it('read committed 가 아니면 25001 TEAM_CONVERT_ISOLATION(세 수준) — read committed 는 통과(전용 팀이 있는 픽스처 A 는 already)', async () => {
    const REFUSED = ['repeatable read', 'serializable', 'read uncommitted']
    const results: Record<string, unknown> = {}
    for (const level of [...REFUSED, 'read committed']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        results[level] = await pgError(c, CONVERT, [F.users.platform, F.projects.a])
        if (level === 'read committed') results.r = (await c.query(CONVERT, [F.users.platform, F.projects.a])).rows[0].r
      } finally {
        await c.query('rollback').then(() => c.release(), (re: Error) => c.release(re))
      }
    }
    for (const level of REFUSED) expect(results[level], level).toMatchObject({ code: '25001', message: 'TEAM_CONVERT_ISOLATION' })
    expect(results['read committed']).toBeNull()
    expect(results.r).toEqual({ status: 'already' })
  })
})

describe('convert_inherited_teams — 전환', () => {
  it('전용 팀이 하나라도(비활성이어도) 있으면 already — 아무것도 바꾸지 않는다', async () => {
    await asService(pool, async (c) => {
      await seedInherited(c)
      await c.query(`insert into public.teams (workspace_id, project_id, code, name, active) values ($1, $2, 'OWN', '전용', false)`, [W, P])
      const before = await refs(c, P)
      expect((await c.query(CONVERT, [F.users.platform, P])).rows[0].r).toEqual({ status: 'already' })
      expect(await refs(c, P)).toEqual(before)
      expect((await c.query('select code from public.teams where project_id = $1', [P])).rows).toEqual([{ code: 'OWN' }])
    })
  })

  it('활성 공용 팀과 P 가 가리키던 비활성 공용 팀이 원본 그대로 전용 팀이 되고, P 안의 네 참조만 새 id 로 옮겨 간다', async () => {
    await asService(pool, async (c) => {
      await seedInherited(c)
      const qBefore = await refs(c, Q)
      expect((await c.query(CONVERT, [F.users.platform, P])).rows[0].r)
        .toEqual({ status: 'converted', teams: 3, moved: { item_owners: 2, project_member_teams: 1, area_teams: 1, invites: 1 } })
      // 복사본 — code·이름·색·순서·progress_visible·활성이 원본 그대로. 아무도 가리키지 않는 비활성 NOP 는 복사하지 않는다
      expect((await c.query(`select code, name, color, sort_order, progress_visible, active, workspace_id
                               from public.teams where project_id = $1 order by sort_order`, [P])).rows).toEqual([
        { code: 'RES', name: '연구', color: '#1d4ed8', sort_order: 0, progress_visible: true, active: true, workspace_id: W },
        { code: 'OPS', name: '운영', color: '#0f766e', sort_order: 1, progress_visible: false, active: true, workspace_id: W },
        { code: 'OLD', name: '옛 팀', color: '#6b7280', sort_order: 2, progress_visible: true, active: false, workspace_id: W },
      ])
      const own = Object.fromEntries((await c.query<{ code: string; id: string }>('select code, id from public.teams where project_id = $1', [P]))
        .rows.map((t) => [t.code, t.id]))
      // P 의 네 참조는 전부 전용 팀 — 수락한 초대(INV_DONE)는 그대로, 초대의 팀 순서는 지킨다
      expect(await refs(c, P)).toEqual({
        owners: [own.RES, own.OLD], member_teams: [own.RES], area_teams: [own.OPS],
        invites: [`${INV_OPEN}:${own.RES},${own.OPS}`, `${INV_DONE}:${T.res}`],
      })
      // 다른 프로젝트(Q)의 참조와 공용 팀 행은 그대로
      expect(await refs(c, Q)).toEqual(qBefore)
      expect((await c.query('select count(*)::int as n from public.teams where workspace_id = $1 and project_id is null', [W])).rows[0].n).toBe(4)
      // 다시 부르면 already
      expect((await c.query(CONVERT, [F.users.platform, P])).rows[0].r).toEqual({ status: 'already' })
    })
  })

  it('상속 시절 공용 팀으로 꾸린 명단의 담당 팀 멤버가 전환 뒤 가져온 항목의 실적을 고친다(RLS member_update_actual)', async () => {
    await asService(pool, async (c) => {
      await seedInherited(c)
      await c.query(CONVERT, [F.users.platform, P])
      const leaf = await importResLeaf(c, 'RLS 전환 뒤 항목', ID('70'))
      await toSession(c, U)
      expect((await c.query('update public.wbs_items set actual_pct = 30 where id = $1', [leaf])).rowCount).toBe(1)
      await toServer(c)
    })
  })

  it('대조 — 복사만 하고 참조를 옮기지 않으면(같은 code·다른 id) 같은 멤버가 그 항목의 실적을 고치지 못한다(D4 의 분열)', async () => {
    await asService(pool, async (c) => {
      await seedInherited(c)
      await c.query(`insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'RES', '연구')`, [W, P])
      const leaf = await importResLeaf(c, 'RLS 복사만 항목', ID('71'))
      await toSession(c, U)
      expect((await c.query('update public.wbs_items set actual_pct = 30 where id = $1', [leaf])).rowCount).toBe(0)
      await toServer(c)
    })
  })
})

describe('전환 뒤 공용 팀 참조 쓰기 거부(D4·D54 — A1-3 리뷰 M1, team_ref_owned_scope)', () => {
  const OWNED = { code: '23514', message: 'TEAM_SCOPE_PROJECT_OWNED' }
  const AREA_RPC = 'select public.upsert_project_area($1, $2, $3::jsonb, $4::jsonb, $5) as r'

  it('전환한 P 에 같은 code 의 전용 팀이 있는 공용 팀을 다시 붙이는 네 쓰기(담당·명단 팀·영역 팀·초대)는 거부되고, 전용 팀 참조·상속 중인 Q 의 공용 팀 참조·전용 짝이 없는 공용 팀은 통과한다', async () => {
    await asService(pool, async (c) => {
      await seedInherited(c)
      await c.query(CONVERT, [F.users.platform, P])
      const own = Object.fromEntries((await c.query<{ code: string; id: string }>('select code, id from public.teams where project_id = $1', [P]))
        .rows.map((t) => [t.code, t.id]))
      // 넷 — 공용 팀(OPS·RES) id 로 다시 쓰기
      expect(await pgError(c, `insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'support')`, [ITEM_P, T.ops]), 'item_owners')
        .toMatchObject(OWNED)
      expect(await pgError(c, 'insert into public.project_member_teams (member_id, team_id, is_primary) values ($1, $2, false)', [MEMBER, T.ops]), '명단 팀')
        .toMatchObject(OWNED)
      expect(await pgError(c, `insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'support')`, [AREA_P, T.res]), '영역 팀')
        .toMatchObject(OWNED)
      expect(await pgError(c, `insert into public.project_invites (id, workspace_id, project_id, email, access_role, token_hash, created_by, expires_at, team_ids)
        values ($1, $2, $3, 'rls-sp4-owned@example.com', 'member', 'rls-sp4-convert-owned', $4, now() + interval '1 day', array[$5]::uuid[])`,
        [ID('75'), W, P, F.users.platform, T.res]), '초대 발급').toMatchObject(OWNED)
      expect(await pgError(c, 'update public.project_invites set team_ids = array[$2]::uuid[] where id = $1', [INV_OPEN, T.ops]), '초대 팀 바꾸기')
        .toMatchObject(OWNED)
      // 이미 옮긴 참조를 공용 팀으로 되돌리는 갱신도 거부
      expect(await pgError(c, 'update public.area_teams set team_id = $2 where area_id = $1', [AREA_P, T.ops]), '영역 팀 되돌리기')
        .toMatchObject(OWNED)
      // 서버 RPC 경로(오래된 영역 편집기의 저장) — upsert_project_area 도 같은 트리거에 막힌다
      const area = JSON.stringify({ id: AREA_P, kind: 'weekly_section', code: 'LAB', name: '실험', sort_order: 0, active: true })
      expect(await pgError(c, AREA_RPC, [F.users.platform, P, area, JSON.stringify([{ team_id: T.res, kind: 'primary' }]), '2026-09-28']), '영역 RPC')
        .toMatchObject(OWNED)
      // 통과 — P 의 전용 팀 참조, 상속 중인 Q 의 공용 팀 참조, 팀 열을 건드리지 않는 초대 갱신(수락 표시)
      await c.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'support')`, [AREA_P, own.RES])
      await c.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'support')`, [AREA_Q, T.res])
      await c.query(`insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'support')`, [ITEM_Q, T.ops])
      await c.query('update public.project_invites set revoked_at = now() where id = $1', [INV_DONE])   // 공용 팀을 든 수락한 초대 — 팀 열 무변경
      // 전용 짝(같은 code)이 없는 공용 팀 — 전환이 복사하지 않은 비활성 NOP. 분열(같은 code·다른 id)이 아니라 DB 는 막지 않는다(표시는 앱 계층)
      await c.query(`insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'support')`, [ITEM_P, T.nop])
      expect(await refs(c, P)).toMatchObject({ area_teams: [own.OPS, own.RES].sort() })
    })
  })

  it('갈라진(D4 — 복사만 한) 프로젝트에서 기존 공용 팀 참조의 재저장(명단 권한 회수·비활성, 영역 이름 바꾸기, 초대 갱신)은 통과하고, 새 공용 팀 참조는 거부된다(A1-4 리뷰 P1)', async () => {
    const ROSTER = 'select public.upsert_project_member_cmd($1, $2, $3::jsonb, $4::jsonb, $5::uuid[], $6) as r'
    await asService(pool, async (c) => {
      await seedInherited(c)
      // 복사만 — 같은 code 의 전용 팀 RES·OPS 가 생기고 참조(명단 RES·영역 OPS·담당 RES)는 공용 팀 id 그대로다
      await c.query(`insert into public.teams (workspace_id, project_id, code, name) values ($1, $2, 'RES', '연구'), ($1, $2, 'OPS', '운영')`, [W, P])
      await c.query(`update public.project_members set access_role = 'admin' where id = $1`, [MEMBER])
      const person = JSON.stringify({ id: PERSON })
      // 명단 — 지금 소속(공용 RES)을 그대로 실은 권한 회수·비활성화. on conflict 재저장이 같은 키 행을 다시 판정하지 않는다
      expect((await c.query(ROSTER, [F.users.platform, P, person, JSON.stringify({ access_role: 'member' }), [T.res], ID('79')])).rows[0].r)
        .toMatchObject({ status: 'applied' })
      expect((await c.query(ROSTER, [F.users.platform, P, person, JSON.stringify({ active: false }), [T.res], ID('7a')])).rows[0].r)
        .toMatchObject({ status: 'applied' })
      expect((await c.query('select access_role, active from public.project_members where id = $1', [MEMBER])).rows)
        .toEqual([{ access_role: 'member', active: false }])
      // 영역 — 이미 배정된 공용 OPS 를 그대로 둔 이름 바꾸기
      const area = JSON.stringify({ id: AREA_P, kind: 'weekly_section', code: 'LAB', name: '실험 2', sort_order: 0, active: true })
      expect((await c.query(AREA_RPC, [F.users.platform, P, area, JSON.stringify([{ team_id: T.ops, kind: 'primary' }]), '2026-09-28'])).rows[0].r)
        .toMatchObject({ status: 'updated' })
      // 초대 — 같은 팀 집합의 순서만 바꾼 갱신, 담당 — 같은 키 재삽입(on conflict)
      await c.query('update public.project_invites set team_ids = array[$2, $3]::uuid[] where id = $1', [INV_OPEN, T.ops, T.res])
      await c.query(`insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'primary') on conflict do nothing`, [ITEM_P, T.res])
      // 새 공용 팀 참조는 여전히 거부 — 명단에 공용 OPS 를 더함·담당에 공용 OPS·영역에 공용 RES·초대에 없던 공용 팀
      expect(await pgError(c, ROSTER, [F.users.platform, P, person, JSON.stringify({}), [T.res, T.ops], ID('7b')]), '명단 새 팀').toMatchObject(OWNED)
      expect(await pgError(c, `insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'support')`, [ITEM_P, T.ops]), '담당 새 팀')
        .toMatchObject(OWNED)
      expect(await pgError(c, AREA_RPC, [F.users.platform, P, area,
        JSON.stringify([{ team_id: T.ops, kind: 'primary' }, { team_id: T.res, kind: 'support' }]), '2026-09-28']), '영역 새 팀').toMatchObject(OWNED)
      expect(await pgError(c, 'update public.project_invites set team_ids = array[$2]::uuid[] where id = $1', [INV_DONE, T.ops]), '초대 새 팀')
        .toMatchObject(OWNED)
    })
  })
})

describe('convert_inherited_teams — 두 연결(커밋)', () => {
  const P2 = ID('72')
  const AREA2 = ID('73')
  const RES2 = ID('74')
  const cleanup = async () => {
    // 전환이 영역 팀을 전용 팀으로 옮겨 놓았다 — 프로젝트 삭제가 area_teams_team_id_fkey(RESTRICT, K18)에 걸리지 않게 먼저 지운다(T8).
    // 명단 팀(project_member_teams.team_id 도 RESTRICT)은 이 케이스에 두지 않는다
    await pool.query(`delete from public.area_teams where area_id in
      (select a.id from public.project_areas a join public.projects p on p.id = a.project_id where p.workspace_id = $1)`, [W])
    await pool.query('delete from public.projects where workspace_id = $1', [W])
    await pool.query('delete from public.workspaces where id = $1', [W])
  }

  it('동시 전환 — 한쪽 converted·한쪽 already, 전용 팀 한 벌', async () => {
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await cleanup()
      await pool.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp4-convert-2', 'Acme 전환 2')`, [W])
      await pool.query(`insert into public.teams (id, workspace_id, project_id, code, name) values ($1, $2, null, 'RES', '연구')`, [RES2, W])
      await pool.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P2, 'RLS 전환 두 연결', W])
      await pool.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $2, 'weekly_section', 'LAB', '실험')`, [AREA2, P2])
      await pool.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'primary')`, [AREA2, RES2])
      s1 = await pool.connect()
      s2 = await pool.connect()
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s2.query('begin')
      expect((await s1.query(CONVERT, [F.users.platform, P2])).rows[0].r)
        .toEqual({ status: 'converted', teams: 1, moved: { item_owners: 0, project_member_teams: 0, area_teams: 1, invites: 0 } })
      let settled = false
      const second = s2.query(CONVERT, [F.users.platform, P2]).then(
        (res) => res.rows[0].r as unknown, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      let blocked = false
      for (let i = 0; i < 250 && !settled && !blocked; i++) {
        blocked = (await s1.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [s2Pid])).rows[0].n > 0
        if (!blocked) await new Promise((r) => setTimeout(r, 20))
      }
      expect(blocked, '둘째 전환이 프로젝트 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await second).toEqual({ status: 'already' })
      await s2.query('commit')
      expect((await s1.query('select code from public.teams where project_id = $1', [P2])).rows).toEqual([{ code: 'RES' }])
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    const { rows } = await pool.query(
      `select (select count(*) from public.projects where workspace_id = $1)::int as projects,
              (select count(*) from public.teams where workspace_id = $1)::int as teams,
              (select count(*) from public.workspaces where id = $1)::int as workspaces`, [W])
    expect(rows[0]).toEqual({ projects: 0, teams: 0, workspaces: 0 })
  })

  /** 두 연결 시드 — 상속 프로젝트 P3(공용 RES 하나, 영역 하나 — 아직 담당 팀 없음). 커밋한다 */
  const P3 = ID('76')
  const AREA3 = ID('77')
  const RES3 = ID('78')
  async function seedRace() {
    await cleanup()
    await pool.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp4-convert-3', 'Acme 전환 3')`, [W])
    await pool.query(`insert into public.teams (id, workspace_id, project_id, code, name) values ($1, $2, null, 'RES', '연구')`, [RES3, W])
    await pool.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P3, 'RLS 전환 경합', W])
    await pool.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $2, 'weekly_section', 'LAB', '실험')`, [AREA3, P3])
  }
  /** s 가 다른 연결에 막힐 때까지 기다린다 — 끝나 버리면 false */
  async function waitBlocked(observer: PoolClient, pid: number, settled: () => boolean) {
    for (let i = 0; i < 250 && !settled(); i++) {
      if ((await observer.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [pid])).rows[0].n > 0) return true
      await new Promise((r) => setTimeout(r, 20))
    }
    return false
  }
  const assertCleaned = async () => {
    const { rows } = await pool.query(
      `select (select count(*) from public.projects where workspace_id = $1)::int as projects,
              (select count(*) from public.teams where workspace_id = $1)::int as teams,
              (select count(*) from public.workspaces where id = $1)::int as workspaces`, [W])
    expect(rows[0]).toEqual({ projects: 0, teams: 0, workspaces: 0 })
  }

  it('M1 경합 ① — 공용 팀 참조 쓰기가 먼저 프로젝트 행을 잡으면 전환은 그 커밋을 기다렸다가 그 행까지 옮긴다', async () => {
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await seedRace()
      s1 = await pool.connect()
      s2 = await pool.connect()
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s2.query('begin')
      await s1.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'primary')`, [AREA3, RES3])
      let settled = false
      const conv = s2.query(CONVERT, [F.users.platform, P3]).then(
        (res) => res.rows[0].r as unknown, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      expect(await waitBlocked(s1, s2Pid, () => settled), '전환이 프로젝트 행(for update)을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await conv).toEqual({ status: 'converted', teams: 1, moved: { item_owners: 0, project_member_teams: 0, area_teams: 1, invites: 0 } })
      await s2.query('commit')
      const { rows } = await s1.query<{ project_id: string | null }>(
        'select t.project_id from public.area_teams art join public.teams t on t.id = art.team_id where art.area_id = $1', [AREA3])
      expect(rows).toEqual([{ project_id: P3 }])   // 공용 팀 참조가 남지 않았다
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    await assertCleaned()
  })

  it('M1 경합 ② — 전환이 먼저 프로젝트 행을 잡으면 공용 팀 참조 쓰기는 그 커밋을 기다렸다가 TEAM_SCOPE_PROJECT_OWNED 로 거부된다', async () => {
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await seedRace()
      s1 = await pool.connect()
      s2 = await pool.connect()
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s2.query('begin')
      expect((await s1.query(CONVERT, [F.users.platform, P3])).rows[0].r).toMatchObject({ status: 'converted', teams: 1 })
      let settled = false
      const write = s2.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'primary')`, [AREA3, RES3]).then(
        () => null as unknown, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      expect(await waitBlocked(s1, s2Pid, () => settled), '참조 쓰기가 프로젝트 행(for key share)을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await write).toMatchObject({ code: '23514', message: 'TEAM_SCOPE_PROJECT_OWNED' })
      await s2.query('rollback')
      expect((await s1.query('select 1 from public.area_teams where area_id = $1', [AREA3])).rowCount).toBe(0)
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    await assertCleaned()
  })
  it('M1 경합 ③ — 반대 순서(참조 행을 먼저 지운 쓰기가 전환 뒤 새 공용 팀을 넣는다)는 교착 탐지로 한쪽만 40P01 이고, 남은 쪽의 결과는 일관된다(A1-4 리뷰 P3)', async () => {
    const OPS3 = ID('7e')
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await seedRace()
      await pool.query(`insert into public.teams (id, workspace_id, project_id, code, name) values ($1, $2, null, 'OPS', '운영')`, [OPS3, W])
      await pool.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'primary')`, [AREA3, RES3])
      s1 = await pool.connect()
      s2 = await pool.connect()
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s2.query('begin')
      // 영역 RPC 의 순서 — 참조 행 delete(행 잠금) → insert(트리거가 프로젝트 행 key share)
      await s1.query('delete from public.area_teams where area_id = $1 and team_id = $2', [AREA3, RES3])
      let settled = false
      const asOutcome = (p: Promise<unknown>) => p.then(() => 'ok' as const, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e })
      const conv = asOutcome(s2.query(CONVERT, [F.users.platform, P3])).finally(() => { settled = true })
      expect(await waitBlocked(s1, s2Pid, () => settled), '전환의 참조 UPDATE 가 지워진 행을 기다린다').toBe(true)
      const write = asOutcome(s1.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'primary')`, [AREA3, OPS3]))
      // 쓰기가 희생자면 s1 의 행 잠금은 롤백해야 풀린다 — 그 뒤에야 전환이 끝난다. 전환이 희생자면 쓰기가 곧 끝난다
      const w = await write
      if (w !== 'ok') await s1.query('rollback')
      const v = await conv
      const deadlocked = [w, v].filter((x) => x instanceof DatabaseError && x.code === '40P01')
      expect(deadlocked, '정확히 한쪽이 교착 희생자').toHaveLength(1)
      if (w === 'ok') { await s2.query('rollback'); await s1.query('commit') } else { await s2.query('commit') }
      const { rows } = await s1.query<{ own: number; common_refs: number }>(   // 하네스 풀은 연결 2개 — 두 연결 케이스 안에서 pool.query 를 쓰지 않는다
        `select (select count(*) from public.teams where project_id = $1)::int as own,
                (select count(*) from public.area_teams art join public.teams t on t.id = art.team_id
                  where art.area_id = $2 and t.project_id is null)::int as common_refs`, [P3, AREA3])
      // 전환이 남았으면 공용 참조 0, 쓰기가 남았으면 전환 없음(상속 그대로)
      expect(v === 'ok' ? rows[0].common_refs : rows[0].own).toBe(0)
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    await assertCleaned()
  })
  it('Z1 경합 ④ — 전환이 참조를 옮긴 뒤·커밋 전에 같은 키를 on conflict 로 다시 넣는 쓰기는 기다렸다가 TEAM_SCOPE_PROJECT_OWNED 로 거부된다(A1 최종 리뷰 보안 P2)', async () => {
    // 옛 판정은 "이미 있는 키면 통과"를 잠금 앞에 두어, 전환이 아직 커밋하지 않은 스냅숏의 옛 행을 보고 통과한 뒤 유일 검사에서 전환 커밋을
    // 기다렸다가 — 옛 행은 새 키로 옮겨 갔으므로 — 공용 팀 참조를 새로 넣었다(같은 영역에 공용 RES·전용 RES 의 D4 분열)
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await seedRace()
      await pool.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'primary')`, [AREA3, RES3])
      s1 = await pool.connect()
      s2 = await pool.connect()
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s2.query('begin')
      expect((await s1.query(CONVERT, [F.users.platform, P3])).rows[0].r)
        .toEqual({ status: 'converted', teams: 1, moved: { item_owners: 0, project_member_teams: 0, area_teams: 1, invites: 0 } })
      let settled = false
      // 영역·명단 RPC 의 재저장 꼴 — 같은 키 insert … on conflict do update
      const write = s2.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'support')
                              on conflict (area_id, team_id) do update set kind = excluded.kind`, [AREA3, RES3]).then(
        () => null as unknown, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      expect(await waitBlocked(s1, s2Pid, () => settled), '재저장이 전환의 커밋을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await write).toMatchObject({ code: '23514', message: 'TEAM_SCOPE_PROJECT_OWNED' })
      await s2.query('rollback')
      const { rows } = await s1.query<{ project_id: string | null }>(
        'select t.project_id from public.area_teams art join public.teams t on t.id = art.team_id where art.area_id = $1', [AREA3])
      expect(rows).toEqual([{ project_id: P3 }])   // 전환이 옮긴 전용 팀 참조 하나뿐 — 공용 팀 참조가 되살아나지 않았다
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    await assertCleaned()
  })
})

describe('카탈로그 불변식 — teams 를 가리키는 열 = 전환 RPC 가 옮기는 열', () => {
  // RPC 쪽 열은 RPC 본문(pg_proc.prosrc)의 `update public.<표> <별칭> set <열> =` 에서 읽는다 — 테스트에 목록을 두면 새 열이 생겨도 목록만 고쳐
  // 초록이 된다. 팀을 가리키는 열을 새로 만드는 SP 는 이 RPC 를 같이 고쳐야 초록이다 — 이름 규칙 안에서.
  // 한계(재검토 반영 T8): 이 검사는 FK 와 열 이름(team_ids)에 기댄다 — FK 없는 단일 uuid 열(예: 회의록 team_id 를 FK 없이 만든 경우), 이름이
  // 다른 uuid[] 열, jsonb 안의 팀 id 는 보지 못한다. 팀을 code 로 가리키는 열 다섯(minutes.team_code·minute_versions.team_code·
  // wiki_items.owner_team·wiki_topics.owner_team·ai_documents.team)은 전환이 같은 code 로 복사하므로 옮길 대상이 아니다.
  // 그런 열을 만드는 SP 는 이 RPC 와 이 테스트를 같은 커밋에서 고친다(스펙 §3.5·§9).
  it('FK 열 ∪ 이름이 team_ids 인 uuid[] 열 = RPC 본문이 옮기는 열', async () => {
    const catalog = (await pool.query<{ col: string }>(`
      select cl.relname || '.' || a.attname as col
        from pg_constraint k
        join pg_class cl on cl.oid = k.conrelid
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
       where k.contype = 'f' and k.confrelid = 'public.teams'::regclass and cl.relnamespace = 'public'::regnamespace
      union
      select cl.relname || '.' || a.attname
        from pg_attribute a join pg_class cl on cl.oid = a.attrelid
       where cl.relnamespace = 'public'::regnamespace and cl.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
         and a.attname = 'team_ids' and a.atttypid = 'uuid[]'::regtype`)).rows.map((r) => r.col).sort()
    const src = (await pool.query<{ src: string }>(
      `select prosrc as src from pg_proc where oid = 'public.convert_inherited_teams(uuid, uuid)'::regprocedure`)).rows[0].src
    const moved = [...new Set([...src.matchAll(/update public\.(\w+) \w+\s+set (\w+) =/g)].map((m) => `${m[1]}.${m[2]}`))].sort()
    expect(catalog.length, '팀을 가리키는 열').toBeGreaterThan(0)
    expect(moved).toEqual(catalog)
  })
})
