// 워크스페이스 격리(0006_workspace_isolation·0009_sp2_isolation_fixes) 핀 케이스 — 전수 교차(workspace-isolation.test.ts)가 못 보는
// 경계를 하나씩 고정한다: 두 워크스페이스 사용자·워크스페이스에서 빠진 명단 행·프로젝트 없는 회의록·명단 FK(NO ACTION)·workspace_id
// 트리거·project_ws 실행 권한·M1~M3·service_role grant·교차 워크스페이스 참조(부모·담당 팀·폴더 부모·이슈 원문 링크)·비공개 프로젝트.
// 로컬 DB 필요: npm run db:start 뒤 npm run test:rls. 각 케이스는 begin…rollback 안에서 돈다(harness.ts).
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const rlsDenied = { code: '42501', message: expect.stringContaining('row-level security') }

/**
 * done_when Q2(RLS 쪽) — A 워크스페이스 관리자(명단 행 없음)가 A 의 비공개 프로젝트 c3 를 읽고 쓰는가. 어긋난 항목을 돌려준다(빈 배열 = 정상).
 * 호출부 세션은 wsAdmin 이다. 민감도 케이스가 같은 판정을 헬퍼를 바꾼 트랜잭션에서 다시 돌린다.
 */
async function privateProjectAdminGaps(c: PoolClient): Promise<string[]> {
  const gaps: string[] = []
  if ((await c.query('select 1 from public.projects where id = $1', [F.projects.aPrivate])).rowCount !== 1) gaps.push('projects select')
  if (!(await c.query<{ ok: boolean }>('select public.is_project_admin($1) as ok', [F.projects.aPrivate])).rows[0].ok) gaps.push('is_project_admin')
  const upd = await c.query('update public.projects set name = name where id = $1', [F.projects.aPrivate])
  if (upd.rowCount !== 1) gaps.push(`projects update ${upd.rowCount}행`)
  const ins = await pgError(c, `insert into public.wbs_items (project_id, code, name) values ($1, '9', 'RLS 비공개 항목')`, [F.projects.aPrivate])
  if (ins) gaps.push(`wbs_items insert ${ins.code}`)
  return gaps
}

describe('워크스페이스 격리 핀 케이스(SP2 0006·0009)', () => {
  it('ⓐ 두 워크스페이스 사용자(dana)는 A·B 를 다 보고, A 에서 빠지면 A 만 사라진다 — 남은 A 명단 행으로도 읽지·쓰지 못한다(Review Focus 2·F1)', async () => {
    const ISSUE = '00000000-0000-0000-7e57-0000000011d0'
    await asUser(pool, F.users.dual, async (c) => {
      const count = async (sql: string, p: unknown[]) => Number((await c.query(sql, p)).rows[0].n)
      const projects = 'select count(*) as n from public.projects where id = any($1::uuid[])'
      const favs = 'select count(*) as n from public.minute_favorites where user_id = $1'
      const attendance = 'select count(*) as n from public.attendance_records where project_id = $1'
      const snapshots = 'select count(*) as n from public.wbs_progress_snapshots where project_id = $1'
      const helpers = 'select public.is_project_member($1) as member, public.my_member_id($1) as mid, public.can_edit_issue($2) as edit'
      await c.query('reset role')   // dana 가 작성한 A 이슈 — can_edit_issue 작성자 분기의 대상
      await c.query(`insert into public.issues (id, project_id, title, created_by) values ($1, $2, 'dana 이슈', $3)`, [ISSUE, F.projects.a, F.users.dual])
      await c.query('set local role authenticated')
      // 대조: 빠지기 전엔 명단 member(danaA)로 A 를 읽는다 — 아래 0행이 세션 흉내 실패가 아니다
      expect(await count(projects, [[F.projects.a, F.projects.bWs]])).toBe(2)
      expect(await count(favs, [F.users.dual])).toBe(1)
      expect(await count(attendance, [F.projects.a])).toBe(1)
      expect((await c.query(helpers, [F.projects.a, ISSUE])).rows[0]).toEqual({ member: true, mid: F.members.danaA, edit: true })
      await c.query('reset role')   // postgres 로 잠시 돌아가 A 소속만 지운다(같은 트랜잭션, 끝에 rollback. JWT claims 는 그대로)
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.dual])
      await c.query('set local role authenticated')
      expect(await count(projects, [[F.projects.a]])).toBe(0)
      expect(await count(projects, [[F.projects.bWs]])).toBe(1)
      expect(await count(favs, [F.users.dual])).toBe(0)
      expect(await count('select count(*) as n from public.minutes where id = $1', [F.rows.minute])).toBe(0)
      // 명단 행 danaA 는 그대로 남아 있다 — SQL 헬퍼가 워크스페이스 멤버십을 보지 않으면 FOR ALL 정책·위키 RPC 가 계속 열린다
      expect((await c.query(helpers, [F.projects.a, ISSUE])).rows[0]).toEqual({ member: false, mid: null, edit: false })
      expect(await count(attendance, [F.projects.a])).toBe(0)
      expect(await count(snapshots, [F.projects.a])).toBe(0)
      expect(await pgError(c, `insert into public.issues (project_id, title, created_by) values ($1, 'RLS 유령 이슈', $2)`, [F.projects.a, F.users.dual]))
        .toMatchObject(rlsDenied)
      expect(await pgError(c, `select public.create_wiki_document($1::uuid, 'RLS 유령 문서', '# x', 'overview')`, [F.projects.a]))
        .toMatchObject({ code: '42501', message: 'WIKI_DOCUMENT_FORBIDDEN' })
      // B 쪽은 그대로다(명단 danaB)
      expect((await c.query('select public.is_project_member($1) as m', [F.projects.bWs])).rows[0].m).toBe(true)
    })
  })

  it('ⓐ′ 명단 관리자(alice)도 A 에서 빠지면 A 의 wbs_items 를 읽지도 고치지도 못한다(F1 — admin 분기)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      const items = 'select count(*)::int as n from public.wbs_items where project_id = $1'
      expect((await c.query(items, [F.projects.a])).rows[0].n).toBeGreaterThan(0)   // 대조: 빠지기 전엔 본다
      await c.query('reset role')
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.member])
      await c.query('set local role authenticated')
      expect((await c.query('select public.is_project_admin($1) as a, public.is_project_admin_anywhere_in_ws($2) as w', [F.projects.a, F.ws])).rows[0])
        .toEqual({ a: false, w: false })
      expect((await c.query(items, [F.projects.a])).rows[0].n).toBe(0)
      expect((await c.query('update public.wbs_items set name = name where id = $1', [F.leaf.aErp])).rowCount).toBe(0)
      expect(await pgError(c, `insert into public.wbs_items (project_id, code, name) values ($1, '9', 'RLS 유령 항목')`, [F.projects.a]))
        .toMatchObject(rlsDenied)
    })
  })

  it('ⓑ 프로젝트 없는 회의록은 A 멤버만 보고, 프로젝트가 지워진 회의록도 워크스페이스를 유지한다(Review Focus 3)', async () => {
    await asUser(pool, F.users.aLoose, async (c) =>
      expect((await c.query('select 1 from public.minutes where id = $1', [F.rows.nullMinute])).rowCount).toBe(1))
    await asUser(pool, F.users.bAdmin, async (c) =>
      expect((await c.query('select 1 from public.minutes where id = $1', [F.rows.nullMinute])).rowCount).toBe(0))
    await asService(pool, async (c) => {
      const P = '00000000-0000-0000-7e57-0000000011c0', M = '00000000-0000-0000-7e57-0000000011c1'
      await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 임시', F.ws])
      await c.query(`insert into public.minutes (id, project_id, minute_date, team_code, title, body_md) values ($1, $2, '2026-09-03', 'ERP', 'T', '#')`, [M, P])
      await c.query('delete from public.projects where id = $1', [P])
      const { rows } = await c.query('select project_id, workspace_id from public.minutes where id = $1', [M])
      expect(rows[0]).toEqual({ project_id: null, workspace_id: F.ws })
    })
  })

  // 픽스처 프로젝트 A 가 아니라 이 케이스용 임시 프로젝트를 지운다 — A 의 팀은 project_member_teams·area_teams 가 RESTRICT 로
  // 붙잡고 있어 A 삭제는 R4 와 무관한 이유로 실패할 수 있다. 임시 프로젝트에는 프로젝트 팀이 없다.
  it('ⓒ 기록 있는 명단 행은 직접 못 지우고(23503), 프로젝트 삭제는 그 행까지 지운다(Review Focus 4)', async () => {
    await asService(pool, async (c) => {
      const P = '00000000-0000-0000-7e57-0000000011c2', M = '00000000-0000-0000-7e57-0000000011c3'
      const ATT = '00000000-0000-0000-7e57-0000000011c4', LEAF = '00000000-0000-0000-7e57-0000000011c5'
      await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 명단 임시', F.ws])
      await c.query(`insert into public.project_members (id, project_id, person_id, access_role) values ($1, $2, $3, 'member')`,
        [M, P, F.people.aLoose])
      await c.query(`insert into public.attendance_records (id, project_id, member_id, date, type) values ($1, $2, $3, '2026-09-01', 'work')`,
        [ATT, P, M])
      await c.query(`insert into public.wbs_items (id, project_id, code, name, assignee_member_id) values ($1, $2, '1', 'L', $3)`, [LEAF, P, M])
      await c.query('set constraints all immediate')   // R4 분기 B(deferrable)여도 직접 삭제는 이 문장에서 23503
      expect(await pgError(c, 'delete from public.project_members where id = $1', [M])).toMatchObject({ code: '23503' })
      await c.query('set constraints all deferred')
      await c.query('delete from public.projects where id = $1', [P])
      await c.query('set constraints all immediate')   // 밀린 검사를 지금 돌린다 — 실패하면 여기서 throw
      expect((await c.query('select 1 from public.project_members where id = $1', [M])).rowCount).toBe(0)
      expect((await c.query('select 1 from public.attendance_records where id = $1', [ATT])).rowCount).toBe(0)
      expect((await c.query('select 1 from public.wbs_items where id = $1', [LEAF])).rowCount).toBe(0)
    })
  })

  it('ⓓ workspace_id 없는 무프로젝트 회의록 23502, 프로젝트와 어긋난 workspace_id 23514', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, `insert into public.minutes (minute_date, team_code, title, body_md) values ('2026-09-01', 'ERP', 'X', '#')`))
        .toMatchObject({ code: '23502' })
      expect(await pgError(c, `insert into public.minutes (project_id, workspace_id, minute_date, team_code, title, body_md) values ($1, $2, '2026-09-01', 'ERP', 'X', '#')`,
        [F.projects.a, F.wsB])).toMatchObject({ code: '23514', message: 'WORKSPACE_SCOPE_MISMATCH' })
    })
  })

  it('ⓔ project_ws·wiki_item_has_live_source 는 세션이 PostgREST 로 부를 수 없다(R3 분기 A·F6 — 남의 행에 답하는 오라클)', async () => {
    await asUser(pool, F.users.bAdmin, async (c) => {
      expect(await pgError(c, 'select public.project_ws($1)', [F.projects.a])).toMatchObject({ code: '42501' })
      expect(await pgError(c, 'select public.wiki_item_has_live_source($1)', [F.rows.wikiItem])).toMatchObject({ code: '42501' })
    })
  })

  it('ⓕ 프로젝트 관리자는 관리자 명단 행의 팀을 못 바꾸고, 워크스페이스 관리자는 바꾼다(M2)', async () => {
    // dana 의 A 명단 행(member)을 같은 트랜잭션 안에서 admin 으로 올린 뒤 팀을 붙여 본다(끝에 rollback)
    const promote = `update public.project_members set access_role = 'admin' where id = $1`
    const add = 'insert into public.project_member_teams (member_id, team_id, is_primary) values ($1, $2, false)'
    await asUser(pool, F.users.member, async (c) => {   // alice — A 프로젝트 관리자, 워크스페이스 관리자 아님
      await c.query('reset role'); await c.query(promote, [F.members.danaA]); await c.query('set local role authenticated')
      expect(await pgError(c, add, [F.members.danaA, F.teams.erp])).toMatchObject({ code: '42501' })
      // 대조: 멤버 행(bob)의 팀은 alice 가 붙인다 — 거부가 "관리자 행" 때문이다
      expect((await c.query(add, [F.members.bobA, F.teams.mes])).rowCount).toBe(1)
    })
    await asUser(pool, F.users.wsAdmin, async (c) => {
      await c.query('reset role'); await c.query(promote, [F.members.danaA]); await c.query('set local role authenticated')
      expect((await c.query(add, [F.members.danaA, F.teams.erp])).rowCount).toBe(1)
    })
  })

  it('ⓖ 세션은 명단 행의 person_id·project_id 를 못 바꾼다(M1 컬럼 권한)', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, 'update public.project_members set person_id = $1 where id = $2', [F.people.aLoose, F.members.bobA]))
        .toMatchObject({ code: '42501' })
      expect(await pgError(c, 'update public.project_members set project_id = $1 where id = $2', [F.projects.b, F.members.bobA]))
        .toMatchObject({ code: '42501' })
      expect((await c.query('update public.project_members set role_label = $1 where id = $2', ['QA', F.members.bobA])).rowCount).toBe(1)
    })
  })

  it('ⓗ 비활성 인물의 명단 행은 my_member_id·my_team_ids 에서 빠진다(M3)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')
      await c.query('update public.people set active = false where id = $1', [F.people.member])
      await c.query('set local role authenticated')
      const { rows } = await c.query('select public.my_member_id($1) as m, (select count(*) from public.my_team_ids($1)) as t', [F.projects.a])
      expect(rows[0]).toEqual({ m: null, t: '0' })
    })
  })

  it('ⓘ service_role 은 public 표 전부에 SELECT·INSERT·UPDATE·DELETE 권한이 있고 실제로 읽으며, 서비스 RPC 를 실행한다(grant 누락 — T10 이월, §5.1·F22)', async () => {
    await asService(pool, async (c) => {
      expect(await serviceRoleGrantGaps(c)).toEqual([])
      const tables = (await c.query<{ name: string }>(`select c.relname::text as name from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1`)).rows
      await c.query('set local role service_role')
      const denied: string[] = []
      for (const { name } of tables) {
        const err = await pgError(c, `select 1 from public."${name}" limit 1`)
        if (err) denied.push(`${name}: ${err.code}`)
      }
      expect(denied).toEqual([])
      const { rows } = await c.query<{ ok: boolean }>(`select bool_and(has_function_privilege('service_role', f, 'EXECUTE')) as ok from unnest(array[
        'public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text, uuid)',
        'public.consume_project_invite(text, text, uuid)',
        'public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[])']) as f`)
      expect(rows[0].ok).toBe(true)
    })
  })

  it('ⓘ′ 민감도 — 한 표에서 service_role 의 INSERT 를 걷으면 ⓘ 의 권한 검사가 잡는다(SELECT 만 보면 놓친다)', async () => {
    await asService(pool, async (c) => {
      await c.query('revoke insert on public.announcements from service_role')
      expect(await serviceRoleGrantGaps(c)).toEqual(['announcements: INSERT'])
    })
  })

  it('ⓙ wbs_items 의 부모는 같은 프로젝트의 항목뿐 — B 관리자가 A 항목을 부모로 삼는 insert·update 는 23503(F2)', async () => {
    const insertChild = `insert into public.wbs_items (project_id, parent_id, code, name) values ($1, $2, '9', 'RLS 자식')`
    await asUser(pool, F.users.bAdmin, async (c) => {
      expect(await pgError(c, insertChild, [F.projects.bWs, F.leaf.aErp])).toMatchObject({ code: '23503' })
      expect(await pgError(c, 'update public.wbs_items set parent_id = $1 where id = $2', [F.leaf.aErp, F.leaf.bWs])).toMatchObject({ code: '23503' })
      // A 리프는 여전히 리프다(B 자식이 붙었다면 wbs_is_leaf 가 거짓이 돼 A 멤버의 실적 입력이 막혔다)
      expect((await c.query<{ leaf: boolean }>('select public.wbs_is_leaf($1) as leaf', [F.leaf.aErp])).rows[0].leaf).toBe(true)
      // 대조: 같은 프로젝트의 부모는 된다 — 거부가 권한이 아니라 부모의 프로젝트 때문이다
      expect(await pgError(c, insertChild, [F.projects.bWs, F.leaf.bWs])).toBeNull()
    })
  })

  it('ⓚ 같은 코드의 공용 팀이 두 워크스페이스에 있어도 임포트는 대상 프로젝트 워크스페이스의 팀을 담당으로 삼고, 다른 워크스페이스 팀은 23514(F3)', async () => {
    const B_SHARED = '00000000-0000-0000-7e57-0000000011d1'
    await asUser(pool, F.users.platform, async (c) => {   // 플랫폼 관리자 — 모든 워크스페이스의 공용 팀이 RLS 로 보인다
      await c.query('reset role')
      await c.query(`insert into public.teams (id, workspace_id, project_id, code, name) values ($1, $2, null, 'SHR', 'SHR')`, [B_SHARED, F.wsB])
      // SP9(0039): import_wbs 는 service_role 전용 RPC 이므로 reset role 상태로 실행한다
      const items = [{ tempId: 't1', code: '9', name: 'RLS 임포트', owners: [{ team: 'SHR', kind: 'primary' }] }]
      expect((await c.query('select public.import_wbs($1, $2::jsonb, $3::jsonb) as n', [F.projects.bWs, JSON.stringify(items), '[]'])).rows[0].n).toBe(1)
      const { rows } = await c.query<{ team_id: string }>(
        `select o.team_id from public.item_owners o join public.wbs_items w on w.id = o.wbs_item_id where w.project_id = $1 and w.name = 'RLS 임포트'`,
        [F.projects.bWs])
      expect(rows.map((r) => r.team_id)).toEqual([B_SHARED])
    })
    await asService(pool, async (c) => {
      expect(await pgError(c, `insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'support')`, [F.leaf.bWs, F.teams.erp]))
        .toMatchObject({ code: '23514', message: 'ITEM_OWNER_TEAM_SCOPE' })
      expect(await pgError(c, `insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'support')`, [F.leaf.bWs, F.teams.aShared]))
        .toMatchObject({ code: '23514', message: 'ITEM_OWNER_TEAM_SCOPE' })
      // 대조: 같은 프로젝트 팀·같은 워크스페이스 공용 팀은 된다
      expect(await pgError(c, `insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'support')`, [F.leaf.aDep1, F.teams.erp])).toBeNull()
      expect(await pgError(c, `insert into public.item_owners (wbs_item_id, team_id, kind) values ($1, $2, 'support')`, [F.leaf.aDep2, F.teams.aShared])).toBeNull()
    })
  })

  it('ⓛ 회의록 폴더는 부모와 같은 워크스페이스·프로젝트이고, workspace_id 는 바뀌지 않는다(F4)', async () => {
    await asUser(pool, F.users.bAdmin, async (c) =>   // B 프로젝트 폴더를 A 폴더 아래에 — 프로젝트가 있어도 부모를 본다
      expect(await pgError(c, `insert into public.minute_folders (name, parent_id, project_id, created_by) values ('RLS 침입', $1, $2, $3)`,
        [F.rows.folder, F.projects.bWs, F.users.bAdmin])).toMatchObject({ code: '23514', message: 'WORKSPACE_SCOPE_MISMATCH' }))
    const ROOT = '00000000-0000-0000-7e57-0000000011d2'
    await asUser(pool, F.users.dual, async (c) => {   // dana(A·B)가 만든 A 의 프로젝트 없는 루트 — 정책은 양쪽 워크스페이스에서 통과한다
      await c.query('reset role')
      await c.query(`insert into public.minute_folders (id, name, project_id, workspace_id, created_by) values ($1, 'RLS dana 루트', null, $2, $3)`,
        [ROOT, F.ws, F.users.dual])
      await c.query('set local role authenticated')
      expect(await pgError(c, 'update public.minute_folders set workspace_id = $1 where id = $2', [F.wsB, ROOT]))
        .toMatchObject({ code: '23514', message: 'WORKSPACE_SCOPE_MISMATCH' })
      // 대조: 이름 바꾸기는 된다 — 거부가 권한이 아니라 워크스페이스 변경 때문이다
      expect((await c.query(`update public.minute_folders set name = 'RLS dana 루트2' where id = $1`, [ROOT])).rowCount).toBe(1)
    })
    await asService(pool, async (c) =>   // 프로젝트 없는 자식을 프로젝트 폴더 아래에 — 자식 = 부모 프로젝트(0076)
      expect(await pgError(c, `insert into public.minute_folders (name, parent_id, project_id, workspace_id) values ('RLS 자식', $1, null, $2)`,
        [F.rows.folder, F.ws])).toMatchObject({ code: '23514', message: 'WORKSPACE_SCOPE_MISMATCH' }))
  })

  it('ⓜ issue_links 는 이슈 프로젝트와 같은 워크스페이스의 회의록만 — service_role 로도 A 무프로젝트 회의록 + B 이슈는 23514(F5)', async () => {
    const ISSUE_B = '00000000-0000-0000-7e57-0000000011d3', ISSUE_A = '00000000-0000-0000-7e57-0000000011d4'
    const VERSION = '00000000-0000-0000-7e57-0000000011d5'
    const link = `insert into public.issue_links (issue_id, project_id, minute_id, minute_version_id, minute_version_no, minute_title_snapshot,
      minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot) values ($1, $2, $3, $4, 1, 'RLS 전역 회의록', '2026-09-02', 'rls-h', 0, 'rls-b', 'rls 발췌')`
    await asService(pool, async (c) => {
      await c.query(`insert into public.issues (id, project_id, title) values ($1, $2, 'RLS B 이슈'), ($3, $4, 'RLS A 이슈')`,
        [ISSUE_B, F.projects.bWs, ISSUE_A, F.projects.a])
      await c.query(`insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code)
        values ($1, $2, 1, '# RLS', 'rls-h', 'RLS 전역 회의록', '2026-09-02', 'ERP')`, [VERSION, F.rows.nullMinute])
      expect(await pgError(c, link, [ISSUE_B, F.projects.bWs, F.rows.nullMinute, VERSION]))
        .toMatchObject({ code: '23514', message: 'MINUTE_WORKSPACE_MISMATCH' })
      expect(await pgError(c, link, [ISSUE_A, F.projects.a, F.rows.nullMinute, VERSION])).toBeNull()   // 대조: 같은 워크스페이스
    })
  })

  it('ⓝ A 워크스페이스 관리자(명단 없음)는 A 의 비공개 프로젝트를 읽고 쓰며, B 관리자는 못 본다(done_when Q2 RLS 쪽 — F18)', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => expect(await privateProjectAdminGaps(c)).toEqual([]))
    await asUser(pool, F.users.bAdmin, async (c) =>
      expect((await c.query('select public.can_read_project($1) as r, public.is_project_admin($1) as a', [F.projects.aPrivate])).rows[0])
        .toEqual({ r: false, a: false }))
  })

  it('ⓝ′ 민감도 — is_project_admin 에서 워크스페이스 관리자 분기를 빼면 ⓝ 의 판정이 깨진다', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      await c.query('reset role')
      await c.query(`create or replace function public.is_project_admin(pid uuid) returns boolean
        language sql stable security definer set search_path = '' as $$
          select public.is_superuser()
              or (pid is not null and exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                                               where pm.project_id = pid and pm.active and pe.active
                                                 and pe.user_id = auth.uid() and pm.access_role = 'admin'))
        $$`)
      await c.query('set local role authenticated')
      expect(await privateProjectAdminGaps(c)).toEqual(expect.arrayContaining(['is_project_admin', 'projects update 0행']))
    })
  })
})

/** service_role 이 SELECT·INSERT·UPDATE·DELETE 중 못 가진 권한 — '표: 권한'. has_table_privilege 에 권한을 쉼표로 여럿 주면
 *  "하나라도 있으면 참"이라 하나씩 본다. */
async function serviceRoleGrantGaps(c: PoolClient): Promise<string[]> {
  const { rows } = await c.query<{ gap: string }>(`
    select c.relname || ': ' || p.priv as gap
      from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       and not has_table_privilege('service_role', c.oid, p.priv)
     order by 1`)
  return rows.map((r) => r.gap)
}
