// 워크스페이스 격리(0006_workspace_isolation) 핀 케이스 — 전수 교차(workspace-isolation.test.ts)가 못 보는 경계를 하나씩 고정한다:
// 두 워크스페이스 사용자·프로젝트 없는 회의록·명단 FK(NO ACTION)·workspace_id 트리거·project_ws 실행 권한·M1~M3·service_role grant.
// 로컬 DB 필요: npm run db:start 뒤 npm run test:rls. 각 케이스는 begin…rollback 안에서 돈다(harness.ts).
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

describe('워크스페이스 격리 핀 케이스(SP2 0006)', () => {
  it('ⓐ 두 워크스페이스 사용자(dana)는 A·B 를 다 보고, A 에서 빠지면 A 만 사라진다(Review Focus 2)', async () => {
    await asUser(pool, F.users.dual, async (c) => {
      const count = async (sql: string, p: unknown[]) => Number((await c.query(sql, p)).rows[0].n)
      const projects = 'select count(*) as n from public.projects where id = any($1::uuid[])'
      const favs = 'select count(*) as n from public.minute_favorites where user_id = $1'
      expect(await count(projects, [[F.projects.a, F.projects.bWs]])).toBe(2)
      expect(await count(favs, [F.users.dual])).toBe(1)
      await c.query('reset role')   // postgres 로 잠시 돌아가 A 소속만 지운다(같은 트랜잭션, 끝에 rollback. JWT claims 는 그대로)
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.dual])
      await c.query('set local role authenticated')
      expect(await count(projects, [[F.projects.a]])).toBe(0)
      expect(await count(projects, [[F.projects.bWs]])).toBe(1)
      expect(await count(favs, [F.users.dual])).toBe(0)
      expect(await count('select count(*) as n from public.minutes where id = $1', [F.rows.minute])).toBe(0)
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

  it('ⓔ project_ws 는 세션이 PostgREST 로 부를 수 없다(R3 분기 A)', async () => {
    await asUser(pool, F.users.bAdmin, async (c) => {
      const err = await pgError(c, 'select public.project_ws($1)', [F.projects.a])
      expect(err).toMatchObject({ code: '42501' })
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

  it('ⓘ service_role 은 72 RLS 표 전부를 읽고 서비스 RPC 를 실행한다(grant 누락 — T10 이월, §5.1)', async () => {
    await asService(pool, async (c) => {
      const tables = (await c.query<{ name: string }>(`select c.relname::text as name from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity order by 1`)).rows
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
})
