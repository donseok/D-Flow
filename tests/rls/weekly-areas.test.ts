// *_weekly_areas — 주간 행을 구분 문자열에서 영역 id 로(스펙 §3.2). 과제 10(열·백필)·12(제약·세션 쓰기·삭제)·13(RPC·두 연결)이
// describe 를 쌓는다. 부트스트랩 계정·표 전체 행 수에 기대지 않는다(H2 규칙 ⑤) — 케이스마다 begin…rollback 이고, 두 연결 케이스만
// 전용 워크스페이스를 커밋한 뒤 finally 에서 그 워크스페이스의 프로젝트 → 워크스페이스 순으로 지운다.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

/** 픽스처(fixture-ws.sql)의 주간 문서·행·영역 — c1 의 2026-08-31 문서, 그 행 하나, 주간 영역 RLSA */
const REPORT = F.rows.weeklyReport
const ROW = '00000000-0000-0000-7e57-00000000111f'
const AREA = '00000000-0000-0000-7e57-00000000110c'
/** 이 파일의 고정 id — …1800~…183f */
const id = (n: number) => `00000000-0000-0000-7e57-0000000018${n.toString(16).padStart(2, '0')}`
/** SP5 A(스펙 D28) — 주간 문서를 넣는 임시 프로젝트는 월요일 주 시작 규칙을 먼저 기록한다(기본 일요일·주 키 트리거 뒤에도 월요일 키 케이스가 그대로).
 *  c1 은 fixture-ws.sql 이 기록한다. 마이그레이션 전에는 모르는 키라 무해하다 */
const MONDAY_RULE = JSON.stringify({ 'calendar.week_start': [{ day: 'monday', from: null }] })
const mondayRule = async (run: (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }>, projectId: string) => {
  const r = await run(`update public.project_settings set "values" = "values" || $2::jsonb where project_id = $1`, [projectId, MONDAY_RULE])
  // 설정 행은 projects_settings_row 트리거가 만든다 — 트리거가 바뀌어 조용히 0행이 되면 선기록이 빠진다(K7)
  expect(r.rowCount, `mondayRule ${projectId}`).toBe(1)
}
/** 표·열 권한 벽 — 정책이 아니라 권한에서 막힌다 */
const DENIED = { code: '42501', message: expect.stringContaining('permission denied') }
/** c2 의 주간 영역(픽스처 영역과 같은 code)과 c1 의 이슈 영역 — 케이스의 트랜잭션 안에서 만든다 */
const OTHER = id(0x00)
const ISSUE = id(0x01)
async function foreignAreas(c: PoolClient) {
  await c.query(`insert into public.project_areas (id, project_id, kind, code, name) values
    ($1, $3, 'weekly_section', 'RLSA', 'RLS 영역(c2)'), ($2, $4, 'issue_area', 'RLSI', 'RLS 이슈 영역')`,
    [OTHER, ISSUE, F.projects.b, F.projects.a])
}
const CREATE = 'select public.create_weekly_report($1, $2, $3::date, $4::jsonb) as r'
const UPSERT = 'select public.upsert_project_area($1, $2, $3::jsonb, $4::jsonb, $5::date) as r'
type Cells = Partial<Record<'this_content' | 'this_issue' | 'next_content' | 'next_issue', string>>
/** p_area — 기본은 활성 주간 영역 */
const areaArg = (o: Record<string, unknown>) => JSON.stringify({ kind: 'weekly_section', sort_order: 0, active: true, ...o })
/** p_seed 원소 — 네 칸을 다 둔다(없는 칸은 '') */
const seedRow = (areaId: string, cells: Cells = {}) =>
  ({ area_id: areaId, this_content: '', this_issue: '', next_content: '', next_issue: '', ...cells })
async function call(c: PoolClient, sql: string, params: unknown[]): Promise<Record<string, unknown>> {
  return (await c.query<{ r: Record<string, unknown> }>(sql, params)).rows[0].r
}

describe('weekly_areas ②③④ — 선행 유일 인덱스·열·백필', () => {
  it('② 복합 FK(⑧)의 대상이 될 유일 인덱스 둘이 있다', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
          where schemaname = 'public' and indexname in ('project_areas_id_project_kind_uidx', 'weekly_reports_id_project_uidx')
          order by indexname`)
      expect(rows).toEqual([
        { indexname: 'project_areas_id_project_kind_uidx',
          indexdef: 'CREATE UNIQUE INDEX project_areas_id_project_kind_uidx ON public.project_areas USING btree (id, project_id, kind)' },
        { indexname: 'weekly_reports_id_project_uidx',
          indexdef: 'CREATE UNIQUE INDEX weekly_reports_id_project_uidx ON public.weekly_reports USING btree (id, project_id)' },
      ])
    })
  })

  it('③ project_id·area_id 는 uuid, area_kind 는 기본 weekly_section 이고 그 값만 받는다', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ column_name: string; data_type: string; column_default: string | null }>(
        `select column_name, data_type, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'weekly_report_rows' and column_name in ('project_id', 'area_id', 'area_kind')
          order by column_name`)
      expect(rows).toEqual([
        { column_name: 'area_id', data_type: 'uuid', column_default: null },
        { column_name: 'area_kind', data_type: 'text', column_default: "'weekly_section'::text" },
        { column_name: 'project_id', data_type: 'uuid', column_default: null },
      ])
      expect(await pgError(c, `update public.weekly_report_rows set area_kind = 'issue_area' where id = $1`, [ROW]))
        .toMatchObject({ code: '23514', constraint: 'weekly_report_rows_area_kind_check' })
    })
  })

  it('④ 행의 project_id 는 부모 문서의 project_id 다 — 픽스처 행은 c1·영역 RLSA', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `select count(*)::int as n from public.weekly_report_rows w join public.weekly_reports r on r.id = w.report_id
          where w.project_id is distinct from r.project_id
            and r.project_id in (select p.id from public.projects p where p.workspace_id in ($1, $2))`, [F.ws, F.wsB])
      expect(rows).toEqual([{ n: 0 }])
      expect((await c.query('select report_id, project_id, area_id from public.weekly_report_rows where id = $1', [ROW])).rows)
        .toEqual([{ report_id: REPORT, project_id: F.projects.a, area_id: AREA }])
    })
  })
})

describe('weekly_areas ⑧ W15 — 행은 같은 프로젝트의 주간 영역·같은 프로젝트의 문서에만, (문서, 영역)당 하나', () => {
  it('다른 프로젝트의 동명 영역·이슈 영역은 area_fk, 다른 프로젝트 문서는 report_fk(23503), 같은 (문서, 영역) 두 번은 23505', async () => {
    await asService(pool, async (c) => {
      await foreignAreas(c)
      const ins = 'insert into public.weekly_report_rows (report_id, project_id, area_id) values ($1, $2, $3)'
      expect(await pgError(c, ins, [REPORT, F.projects.a, OTHER])).toMatchObject({ code: '23503', constraint: 'weekly_report_rows_area_fk' })
      expect(await pgError(c, ins, [REPORT, F.projects.a, ISSUE])).toMatchObject({ code: '23503', constraint: 'weekly_report_rows_area_fk' })
      expect(await pgError(c, ins, [REPORT, F.projects.b, OTHER])).toMatchObject({ code: '23503', constraint: 'weekly_report_rows_report_fk' })
      expect(await pgError(c, ins, [REPORT, F.projects.a, AREA]))
        .toMatchObject({ code: '23505', constraint: 'weekly_report_rows_report_area_uidx' })
    })
  })
})

describe('weekly_areas ⑩ 세션 쓰기 — 구조 쓰기는 닫히고 주간 행은 네 칸·주간 문서는 제목만 열린다(D27)', () => {
  it('주간 행 insert·delete, 구조 열·updated_at update 는 프로젝트 관리자도 42501', async () => {
    await asUser(pool, F.users.member, async (c) => {   // alice — c1 명단 관리자
      expect(await pgError(c, 'insert into public.weekly_report_rows (report_id, project_id, area_id) values ($1, $2, $3)',
        [REPORT, F.projects.a, AREA])).toMatchObject(DENIED)
      expect(await pgError(c, 'delete from public.weekly_report_rows where id = $1', [ROW])).toMatchObject(DENIED)
      for (const col of ['area_id', 'project_id', 'report_id', 'area_kind', 'updated_at']) {
        expect(await pgError(c, `update public.weekly_report_rows set ${col} = ${col} where id = $1`, [ROW]), col).toMatchObject(DENIED)
      }
    })
  })

  it('칸 update — 명단 멤버는 1행, 조회 전용(명단 없음)은 0행이고 내용 그대로, B 계정은 0행', async () => {
    await asUser(pool, F.users.dual, async (c) => {   // dana — c1 명단 member
      expect((await c.query('update public.weekly_report_rows set this_content = $2 where id = $1', [ROW, '멤버가 쓴 내용'])).rowCount)
        .toBe(1)
    })
    await asUser(pool, F.users.aLoose, async (c) => {   // cy — A 멤버, 명단 없음
      const before = (await c.query('select this_content from public.weekly_report_rows where id = $1', [ROW])).rows
      expect(before).toHaveLength(1)
      expect((await c.query('update public.weekly_report_rows set this_content = $2 where id = $1', [ROW, '조회 전용이 쓴 내용'])).rowCount)
        .toBe(0)
      expect((await c.query('select this_content from public.weekly_report_rows where id = $1', [ROW])).rows).toEqual(before)
    })
    await asUser(pool, F.users.bMember, async (c) => {   // ben — B 워크스페이스
      expect((await c.query('update public.weekly_report_rows set this_content = $2 where id = $1', [ROW, 'B 가 쓴 내용'])).rowCount)
        .toBe(0)
    })
  })

  it('주간 문서 insert·delete·week_start·updated_at update 는 42501, 제목 update 는 멤버 1행', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, `insert into public.weekly_reports (project_id, week_start) values ($1, '2026-09-07')`, [F.projects.a]))
        .toMatchObject(DENIED)
      expect(await pgError(c, 'delete from public.weekly_reports where id = $1', [REPORT])).toMatchObject(DENIED)
      expect(await pgError(c, `update public.weekly_reports set week_start = '2026-09-07' where id = $1`, [REPORT])).toMatchObject(DENIED)
      expect(await pgError(c, 'update public.weekly_reports set updated_at = now() where id = $1', [REPORT])).toMatchObject(DENIED)
    })
    await asUser(pool, F.users.dual, async (c) => {
      expect((await c.query('update public.weekly_reports set title = $2 where id = $1', [REPORT, '멤버가 고친 제목'])).rowCount).toBe(1)
    })
  })

  it('네 칸은 DB 에서도 20,000자까지다(weekly_report_rows_cells_len) — 세션의 직접 update 가 서버 액션의 상한을 건너뛰지 못한다', async () => {
    const LEN = { code: '23514', constraint: 'weekly_report_rows_cells_len' }
    await asUser(pool, F.users.dual, async (c) => {   // dana — c1 명단 member
      for (const col of ['this_content', 'this_issue', 'next_content', 'next_issue']) {
        expect(await pgError(c, `update public.weekly_report_rows set ${col} = $2 where id = $1`, [ROW, 'x'.repeat(20001)]), col)
          .toMatchObject(LEN)
      }
      expect((await c.query('update public.weekly_report_rows set next_issue = $2 where id = $1', [ROW, '가'.repeat(20000)])).rowCount).toBe(1)
    })
    await asService(pool, async (c) => {
      await c.query('delete from public.weekly_report_rows where id = $1', [ROW])
      expect(await pgError(c, 'insert into public.weekly_report_rows (report_id, project_id, area_id, this_content) values ($1, $2, $3, $4)',
        [REPORT, F.projects.a, AREA, 'x'.repeat(20001)])).toMatchObject(LEN)
    })
  })

  it('영역·영역-팀 쓰기는 프로젝트 관리자도 42501 — 쓰기는 upsert_project_area 뿐', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, `insert into public.project_areas (project_id, kind, code, name) values ($1, 'weekly_section', 'SESS', '세션 영역')`,
        [F.projects.a])).toMatchObject(DENIED)
      expect(await pgError(c, `update public.project_areas set name = '세션 개명' where id = $1`, [AREA])).toMatchObject(DENIED)
      expect(await pgError(c, 'delete from public.project_areas where id = $1', [AREA])).toMatchObject(DENIED)
      expect(await pgError(c, `insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'support')`, [AREA, F.teams.mes]))
        .toMatchObject(DENIED)
      expect(await pgError(c, `update public.area_teams set kind = 'support' where area_id = $1`, [AREA])).toMatchObject(DENIED)
      expect(await pgError(c, 'delete from public.area_teams where area_id = $1', [AREA])).toMatchObject(DENIED)
    })
  })
})

describe('weekly_areas ⑩ 읽기 — project_id 직접 술어(실시간 인가가 같은 정책을 쓴다 — D6)', () => {
  it('A 명단 멤버는 A 의 행을, B 계정은 0행. 정책 본문은 문서를 거치지 않는다', async () => {
    await asUser(pool, F.users.dual, async (c) => {
      expect((await c.query('select id from public.weekly_report_rows where id = $1', [ROW])).rows).toEqual([{ id: ROW }])
    })
    await asUser(pool, F.users.bMember, async (c) => {
      expect((await c.query('select id from public.weekly_report_rows where report_id = $1', [REPORT])).rowCount).toBe(0)
    })
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ qual: string }>(
        `select qual from pg_policies
          where schemaname = 'public' and tablename = 'weekly_report_rows' and policyname = 'weekly_report_rows_ws_read'`)
      expect(rows).toHaveLength(1)
      expect(rows[0].qual).toMatch(/^\(project_id IN \( SELECT /)
      expect(rows[0].qual).toContain('accessible_project_ids()')
      expect(rows[0].qual).not.toContain('weekly_reports')
    })
  })
})

describe('weekly_areas ⑩ 카탈로그 — 정책·열 권한', () => {
  it('정책 — 주간 행·문서는 select·update 하나씩, 영역·영역-팀은 select 하나(쓰기 정책 0)', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ t: string; p: string; cmd: string }>(
        `select tablename::text as t, policyname::text as p, cmd from pg_policies
          where schemaname = 'public' and tablename in ('weekly_report_rows', 'weekly_reports', 'project_areas', 'area_teams')
          order by tablename, policyname`)
      expect(rows).toEqual([
        { t: 'area_teams', p: 'area_teams_read', cmd: 'SELECT' },
        { t: 'project_areas', p: 'project_areas_read', cmd: 'SELECT' },
        { t: 'weekly_report_rows', p: 'weekly_report_rows_update', cmd: 'UPDATE' },
        { t: 'weekly_report_rows', p: 'weekly_report_rows_ws_read', cmd: 'SELECT' },
        { t: 'weekly_reports', p: 'weekly_reports_update', cmd: 'UPDATE' },
        { t: 'weekly_reports', p: 'weekly_reports_ws_read', cmd: 'SELECT' },
      ])
    })
  })

  it('authenticated 의 INSERT·UPDATE 열 권한은 주간 행 네 칸과 주간 문서 title 의 UPDATE 뿐, DELETE 는 넷 다 없다', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ t: string; col: string; priv: string }>(
        `select c.relname::text as t, a.attname::text as col, p.priv
           from pg_class c
           join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          cross join (values ('INSERT'), ('UPDATE')) as p(priv)
          where c.relnamespace = 'public'::regnamespace
            and c.relname in ('weekly_report_rows', 'weekly_reports', 'project_areas', 'area_teams')
            and has_column_privilege('authenticated', c.oid, a.attnum, p.priv)
          order by c.relname, a.attname, p.priv`)
      expect(rows).toEqual([
        { t: 'weekly_report_rows', col: 'next_content', priv: 'UPDATE' },
        { t: 'weekly_report_rows', col: 'next_issue', priv: 'UPDATE' },
        { t: 'weekly_report_rows', col: 'this_content', priv: 'UPDATE' },
        { t: 'weekly_report_rows', col: 'this_issue', priv: 'UPDATE' },
        { t: 'weekly_reports', col: 'title', priv: 'UPDATE' },
      ])
      const del = await c.query<{ t: string }>(
        `select c.relname::text as t from pg_class c
          where c.relnamespace = 'public'::regnamespace
            and c.relname in ('weekly_report_rows', 'weekly_reports', 'project_areas', 'area_teams')
            and has_table_privilege('authenticated', c.oid, 'DELETE')`)
      expect(del.rows).toEqual([])
    })
  })
})

describe('weekly_areas ⑩ 영역 불변(D46) — service_role 로도 code·kind·project_id 를 바꾸지 못한다', () => {
  const BARE = id(0x02)   // 행이 달리지 않은 c1 주간 영역 — 복합 FK 가 묶지 않으므로 트리거만 막는다
  it('행이 달린 영역·안 달린 영역 모두 23514, 이름은 바뀐다', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $2, 'weekly_section', 'RLSB', 'RLS 빈 영역')`,
        [BARE, F.projects.a])
      await c.query('set local role service_role')
      for (const area of [AREA, BARE]) {
        expect(await pgError(c, `update public.project_areas set kind = 'issue_area' where id = $1`, [area]), area)
          .toMatchObject({ code: '23514', message: 'PROJECT_AREA_KIND_IMMUTABLE' })
        expect(await pgError(c, 'update public.project_areas set project_id = $2 where id = $1', [area, F.projects.b]), area)
          .toMatchObject({ code: '23514', message: 'PROJECT_AREA_PROJECT_IMMUTABLE' })
        expect(await pgError(c, `update public.project_areas set code = 'RLSZ' where id = $1`, [area]), area)
          .toMatchObject({ code: '23514', message: 'PROJECT_AREA_CODE_IMMUTABLE' })
      }
      expect((await c.query(`update public.project_areas set name = '이름은 바뀐다' where id = $1`, [BARE])).rowCount).toBe(1)
    })
  })
})

describe('weekly_areas ⑧ 삭제(Q10·D23) — 프로젝트 삭제는 RI 트리거 순서와 무관하게 통과하고, 영역 직접 삭제는 즉시 막힌다', () => {
  // 전용 워크스페이스(aa40)에 주간 행이 달린 프로젝트 P 와 빈 프로젝트 P2. 영역에는 공용 팀만 붙인다 — 전용 팀은 프로젝트 삭제에서
  // area_teams_team_id_fkey(RESTRICT)가 이름 순서를 탄다(팀 선례). 케이스마다 begin…rollback 이라 아무것도 남지 않는다
  const DEL = {
    ws: '00000000-0000-0000-7e57-00000000aa40', p: id(0x10), p2: id(0x11), team: id(0x12), area: id(0x13), report: id(0x14), row: id(0x15),
  }
  async function scene(c: PoolClient) {
    await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-wa-del', 'RLS 주간 삭제')`, [DEL.ws])
    await c.query(`insert into public.projects (id, name, workspace_id) values ($1, 'RLS 삭제 P', $3), ($2, 'RLS 삭제 P2', $3)`,
      [DEL.p, DEL.p2, DEL.ws])
    await mondayRule((s, p) => c.query(s, p), DEL.p)
    await c.query(`insert into public.teams (id, workspace_id, project_id, code, name) values ($1, $2, null, 'RLSD', 'RLS 삭제 공용 팀')`,
      [DEL.team, DEL.ws])
    await c.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $2, 'weekly_section', 'DEL', 'RLS 삭제 영역')`,
      [DEL.area, DEL.p])
    await c.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'primary')`, [DEL.area, DEL.team])
    await c.query(`insert into public.weekly_reports (id, project_id, week_start) values ($1, $2, '2026-09-07')`, [DEL.report, DEL.p])
    await c.query(`insert into public.weekly_report_rows (id, report_id, project_id, area_id, this_content) values ($1, $2, $3, $4, '삭제될 내용')`,
      [DEL.row, DEL.report, DEL.p, DEL.area])
  }
  async function leftovers(c: PoolClient) {
    return (await c.query<{ rows: number; areas: number; reports: number; links: number }>(
      `select (select count(*) from public.weekly_report_rows where id = $1)::int as rows,
              (select count(*) from public.project_areas where id = $2)::int as areas,
              (select count(*) from public.weekly_reports where id = $3)::int as reports,
              (select count(*) from public.area_teams where area_id = $2)::int as links`, [DEL.row, DEL.area, DEL.report])).rows[0]
  }
  const NONE = { rows: 0, areas: 0, reports: 0, links: 0 }

  it('① 주간 행이 달린 프로젝트를 지우면 주간 행·영역·문서·영역-팀이 함께 사라진다', async () => {
    await asService(pool, async (c) => {
      await scene(c)
      expect(await leftovers(c)).toEqual({ rows: 1, areas: 1, reports: 1, links: 1 })
      expect(await pgError(c, 'delete from public.projects where id = $1', [DEL.p])).toBeNull()
      expect(await leftovers(c)).toEqual(NONE)
    })
  })

  it.each([
    ['weekly_reports', 'weekly_reports_project_id_fkey'],
    ['project_areas', 'project_areas_project_id_fkey'],
    ['weekly_report_rows', 'weekly_report_rows_project_id_fkey'],
  ])('② %s 의 projects FK(%s)를 다시 만들어 RI 트리거 이름 순서를 바꿔도 프로젝트 삭제가 통과한다', async (table, fk) => {
    // 다시 만든 FK 의 트리거 이름(새 OID)이 맨 앞·맨 뒤 어디로 가든 둘 중 하나는 영역 검사를 주간 캐스케이드보다 먼저 큐에 넣는다.
    // test:rls 는 파일 병렬이 꺼져 있어(vitest.config.rls.ts) 같은 트랜잭션의 alter table 이 다른 파일과 겹치지 않는다
    await asService(pool, async (c) => {
      await scene(c)
      await c.query(`alter table public.${table} drop constraint ${fk}`)
      await c.query(`alter table public.${table} add constraint ${fk} foreign key (project_id) references public.projects (id) on delete cascade`)
      expect(await pgError(c, 'delete from public.projects where id = $1', [DEL.p])).toBeNull()
      expect(await leftovers(c)).toEqual(NONE)
    })
  })

  it('③ FK 는 셋 — projects 직접 FK 는 정확히 하나(project_id, on delete cascade)이고 옛 단일 FK 는 없다', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ conname: string; target: string; cols: string; deltype: string }>(
        `select c.conname::text as conname, t.relname::text as target, c.confdeltype::text as deltype,
                (select string_agg(a.attname::text, ',' order by k.ord) from unnest(c.conkey) with ordinality as k(attnum, ord)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
           from pg_constraint c join pg_class t on t.oid = c.confrelid
          where c.conrelid = 'public.weekly_report_rows'::regclass and c.contype = 'f'
          order by c.conname`)
      expect(rows).toEqual([
        { conname: 'weekly_report_rows_area_fk', target: 'project_areas', deltype: 'r', cols: 'area_id,project_id,area_kind' },
        { conname: 'weekly_report_rows_project_id_fkey', target: 'projects', deltype: 'c', cols: 'project_id' },
        { conname: 'weekly_report_rows_report_fk', target: 'weekly_reports', deltype: 'c', cols: 'report_id,project_id' },
      ])
    })
  })

  it('④ 프로젝트가 남은 워크스페이스의 직접 삭제는 23503(projects_workspace_id_fkey), 프로젝트를 모두 지운 뒤에는 통과', async () => {
    await asService(pool, async (c) => {
      await scene(c)
      // 공용 팀의 RESTRICT(area_teams_team_id_fkey)를 비켜 projects 의 RESTRICT 하나만 남긴다 — 둘이면 어느 쪽이 먼저 걸릴지 이름 순서를 탄다
      await c.query('delete from public.area_teams where area_id = $1', [DEL.area])
      expect(await pgError(c, 'delete from public.workspaces where id = $1', [DEL.ws]))
        .toMatchObject({ code: '23503', constraint: 'projects_workspace_id_fkey' })
      expect(await pgError(c, 'delete from public.projects where workspace_id = $1', [DEL.ws])).toBeNull()
      expect(await pgError(c, 'delete from public.workspaces where id = $1', [DEL.ws])).toBeNull()
      expect((await c.query('select count(*)::int as n from public.teams where id = $1', [DEL.team])).rows).toEqual([{ n: 0 }])
    })
  })

  it('⑤ 행이 달린 영역의 직접 삭제는 service_role 로도 즉시 23503(weekly_report_rows_area_fk)', async () => {
    await asService(pool, async (c) => {
      await scene(c)
      await c.query('set local role service_role')
      expect(await pgError(c, 'delete from public.project_areas where id = $1', [DEL.area]))
        .toMatchObject({ code: '23503', constraint: 'weekly_report_rows_area_fk' })
    })
  })
})

describe('weekly_areas ⑪ RPC — 실행 권한·격리 수준', () => {
  it('세션(authenticated)은 RPC 둘과 도우미를 실행할 수 없다(42501), service_role 은 RPC 둘을 실행한다(read committed)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, CREATE, [F.users.member, F.projects.a, '2026-09-07', null]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function create_weekly_report') })
      expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, areaArg({ code: 'SES', name: '세션' }), '[]', '2026-09-07']))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function upsert_project_area') })
      expect(await pgError(c, 'select public.actor_is_project_admin($1, $2)', [F.users.member, F.projects.a]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function actor_is_project_admin') })
    })
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      expect(await call(c, CREATE, [F.users.member, F.projects.a, '2026-09-07', null])).toMatchObject({ status: 'created', rows: 1 })
      expect(await call(c, UPSERT, [F.users.member, F.projects.a, areaArg({ code: 'SVC', name: '서비스 영역' }), '[]', '2026-09-07']))
        .toMatchObject({ status: 'created', rows_added: 1 })   // 방금 만든 2026-09-07 문서 하나(픽스처 문서 2026-08-31 은 앞이다)
    })
  })

  it('read committed 가 아니면 두 RPC 모두 25001 WEEKLY_ISOLATION(세 수준) — 잠금 뒤 다른 행을 읽어 판정한다(H2 규칙 ③)', async () => {
    for (const level of ['repeatable read', 'serializable', 'read uncommitted']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        expect(await pgError(c, CREATE, [F.users.member, F.projects.a, '2026-09-07', null]), level)
          .toMatchObject({ code: '25001', message: 'WEEKLY_ISOLATION' })
        expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, areaArg({ code: 'ISO', name: '격리' }), '[]', '2026-09-07']), level)
          .toMatchObject({ code: '25001', message: 'WEEKLY_ISOLATION' })
      } finally {
        await c.query('rollback')
        c.release()
      }
    }
  })
})

describe('weekly_areas ⑪ actor_is_project_admin — DEFINER RPC 넷의 등급 판정(표 구동)', () => {
  // RLS 가 빠진 DEFINER RPC 넷(주간 둘·가져오기·전환)이 이 도우미 하나로 등급을 다시 본다(D28) — 경계 분기를 여기 한 곳에서 고정한다.
  // 넓이는 TS roleIn·SQL is_project_admin(0009 F1)과 같다: 플랫폼 ∨ 그 워크스페이스 관리자 ∨ (워크스페이스 멤버 ∧ 활성 명단·활성 인물의 admin)
  const NEW_P = id(0x20)   // A 워크스페이스의 새 프로젝트 — alice(c1 관리자)의 명단 행이 없다
  const ADMIN = 'select public.actor_is_project_admin($1, $2) as ok'
  it.each([
    ['플랫폼 관리자', F.users.platform, F.projects.a, [], true],
    ['A 워크스페이스 관리자(명단 없음)', F.users.wsAdmin, F.projects.a, [], true],
    ['명단 admin(alice)', F.users.member, F.projects.a, [], true],
    ['명단 member(dana)', F.users.dual, F.projects.a, [], false],
    ['조회 전용 — 워크스페이스 멤버, 명단 없음(cy)', F.users.aLoose, F.projects.a, [], false],
    ['다른 워크스페이스 관리자(bea)', F.users.bAdmin, F.projects.a, [], false],
    ['같은 워크스페이스의 다른 프로젝트 관리자(alice → 명단 없는 새 프로젝트)', F.users.member, NEW_P, [], false],
    ['같은 워크스페이스의 다른 프로젝트 관리자(alice → 명단 member 인 c2)', F.users.member, F.projects.b, [], false],
    ['워크스페이스를 떠난 명단 admin', F.users.member, F.projects.a,
      [`delete from public.workspace_members where workspace_id = '${F.ws}' and user_id = '${F.users.member}'`], false],
    ['비활성 명단 행의 admin', F.users.member, F.projects.a,
      [`update public.project_members set active = false where id = '${F.members.aliceA}'`], false],
    ['비활성 인물의 admin', F.users.member, F.projects.a, [`update public.people set active = false where id = '${F.people.member}'`], false],
    ['행위자 null', null, F.projects.a, [], false],
    ['프로젝트 null(플랫폼 관리자도)', F.users.platform, null, [], false],
  ] as const)('%s → %s', async (_label, actor, project, mutate, want) => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.projects (id, name, workspace_id) values ($1, 'RLS 등급 새 프로젝트', $2)`, [NEW_P, F.ws])
      for (const m of mutate) await c.query(m)
      expect((await c.query<{ ok: boolean }>(ADMIN, [actor, project])).rows[0].ok).toBe(want)
    })
  })

  it('도우미·RPC 둘은 DEFINER 이고 search_path 가 비어 있다(RPC 둘은 lock_timeout 15s 도) — §3.1 함수 규칙', async () => {
    const { rows } = await pool.query<{ name: string; secdef: boolean; config: string[] }>(
      `select p.proname::text as name, p.prosecdef as secdef, p.proconfig as config from pg_proc p
        where p.oid in ('public.actor_is_project_admin(uuid, uuid)'::regprocedure, 'public.create_weekly_report(uuid, uuid, date, jsonb)'::regprocedure,
                        'public.upsert_project_area(uuid, uuid, jsonb, jsonb, date)'::regprocedure)
        order by p.proname`)
    expect(rows).toEqual([
      { name: 'actor_is_project_admin', secdef: true, config: ['search_path=""'] },
      { name: 'create_weekly_report', secdef: true, config: ['search_path=""', 'lock_timeout=15s'] },
      { name: 'upsert_project_area', secdef: true, config: ['search_path=""', 'lock_timeout=15s'] },
    ])
  })
})

describe('weekly_areas ⑪ create_weekly_report', () => {
  it('입력 — 행위자·프로젝트·주가 null 이면 WEEKLY_INVALID_INPUT, 시드 모양이 틀리면 WEEKLY_SEED_INVALID(22023). 20,000자는 받는다', async () => {
    await asService(pool, async (c) => {
      for (const args of [[null, F.projects.a, '2026-09-07', null], [F.users.member, null, '2026-09-07', null], [F.users.member, F.projects.a, null, null]]) {
        expect(await pgError(c, CREATE, args), JSON.stringify(args)).toMatchObject({ code: '22023', message: 'WEEKLY_INVALID_INPUT' })
      }
      const bad: [string, unknown][] = [
        ['배열이 아니다', {}],
        ['원소가 객체가 아니다', [1]],
        ['area_id 가 uuid 가 아니다', [{ ...seedRow(AREA), area_id: 'not-a-uuid' }]],
        ['area_id 가 문자열이 아니다', [{ ...seedRow(AREA), area_id: 7 }]],
        ['칸이 빠졌다', [{ area_id: AREA, this_content: '', this_issue: '', next_content: '' }]],
        ['칸이 문자열이 아니다', [{ ...seedRow(AREA), next_issue: null }]],
        ['20,000자 초과', [seedRow(AREA, { this_content: 'x'.repeat(20001) })]],
        ['area_id 중복', [seedRow(AREA), seedRow(AREA)]],
      ]
      for (const [why, seed] of bad) {
        expect(await pgError(c, CREATE, [F.users.member, F.projects.a, '2026-09-07', JSON.stringify(seed)]), why)
          .toMatchObject({ code: '22023', message: 'WEEKLY_SEED_INVALID' })
      }
      expect(await call(c, CREATE, [F.users.member, F.projects.a, '2026-09-07',
        JSON.stringify([seedRow(AREA, { this_content: 'x'.repeat(20000) })])])).toMatchObject({ status: 'created', rows: 1 })
    })
  })

  it('등급 — 명단 member·조회 전용·다른 워크스페이스 관리자는 WEEKLY_FORBIDDEN(42501), 워크스페이스·플랫폼 관리자는 만든다. 없는 프로젝트는 PROJECT_NOT_FOUND', async () => {
    await asService(pool, async (c) => {
      for (const actor of [F.users.dual, F.users.aLoose, F.users.bAdmin]) {
        expect(await pgError(c, CREATE, [actor, F.projects.a, '2026-09-07', null]), actor)
          .toMatchObject({ code: '42501', message: 'WEEKLY_FORBIDDEN' })
      }
      expect(await call(c, CREATE, [F.users.wsAdmin, F.projects.a, '2026-09-07', null])).toMatchObject({ status: 'created' })
      expect(await call(c, CREATE, [F.users.platform, F.projects.a, '2026-09-14', null])).toMatchObject({ status: 'created' })
      expect(await pgError(c, CREATE, [F.users.platform, id(0x3e), '2026-09-07', null]))
        .toMatchObject({ code: 'P0002', message: 'PROJECT_NOT_FOUND' })
    })
  })

  it('같은 주 문서가 있으면 exists 를 돌려주고 아무것도 바꾸지 않는다(D33)', async () => {
    await asService(pool, async (c) => {
      const rows = 'select id, this_content from public.weekly_report_rows where report_id = $1 order by id'
      const before = (await c.query(rows, [REPORT])).rows
      expect(await call(c, CREATE, [F.users.member, F.projects.a, '2026-08-31', JSON.stringify([seedRow(AREA, { this_content: '덮지 않는다' })])]))
        .toEqual({ status: 'exists', report_id: REPORT })
      expect((await c.query(rows, [REPORT])).rows).toEqual(before)
    })
  })

  it('활성 주간 영역이 0개면 23514 WEEKLY_AREAS_REQUIRED — 임의 구분을 만들지 않고 문서도 남기지 않는다', async () => {
    await asService(pool, async (c) => {
      await c.query(`update public.project_areas set active = false where project_id = $1 and kind = 'weekly_section'`, [F.projects.a])
      expect(await pgError(c, CREATE, [F.users.member, F.projects.a, '2026-09-07', null]))
        .toMatchObject({ code: '23514', message: 'WEEKLY_AREAS_REQUIRED' })
      expect((await c.query(`select count(*)::int as n from public.weekly_reports where project_id = $1 and week_start = '2026-09-07'`,
        [F.projects.a])).rows).toEqual([{ n: 0 }])
    })
  })

  it('시드 — 활성 영역은 시드 칸으로, 시드에만 있는 비활성 영역은 내용이 있을 때만 그 내용과 함께, 공백뿐인 시드는 행을 만들지 않는다(D33·[RF1])', async () => {
    const X = id(0x03)
    const Y = id(0x04)
    await asService(pool, async (c) => {
      await c.query(`insert into public.project_areas (id, project_id, kind, code, name, active) values
        ($1, $3, 'weekly_section', 'RLSX', 'RLS 꺼진 영역 X', false), ($2, $3, 'weekly_section', 'RLSY', 'RLS 꺼진 영역 Y', false)`,
        [X, Y, F.projects.a])
      const seed = [
        seedRow(AREA, { this_content: '활성 내용' }),
        seedRow(X, { next_content: '비활성 내용' }),
        seedRow(Y, { this_content: '　', this_issue: '﻿', next_content: ' \t', next_issue: ' \n' }),   // JS trim() 이면 전부 빈 칸
      ]
      const out = await call(c, CREATE, [F.users.member, F.projects.a, '2026-09-07', JSON.stringify(seed)])
      expect(out).toMatchObject({ status: 'created', rows: 2 })
      const { rows } = await c.query(
        'select area_id, this_content, next_content from public.weekly_report_rows where report_id = $1 order by area_id', [out.report_id])
      expect(rows).toEqual([   // uuid 순: AREA(…110c) < X(…1803)
        { area_id: AREA, this_content: '활성 내용', next_content: '' },
        { area_id: X, this_content: '', next_content: '비활성 내용' },
      ])
    })
  })

  it('시드의 영역이 이 프로젝트의 주간 영역이 아니면 23503(weekly_report_rows_area_fk) — 다른 프로젝트 영역·이슈 영역', async () => {
    await asService(pool, async (c) => {
      await foreignAreas(c)
      for (const area of [OTHER, ISSUE]) {
        expect(await pgError(c, CREATE, [F.users.member, F.projects.a, '2026-09-07', JSON.stringify([seedRow(area, { this_content: '남의 영역' })])]),
          area).toMatchObject({ code: '23503', constraint: 'weekly_report_rows_area_fk' })
      }
    })
  })
})

describe('weekly_areas ⑪ upsert_project_area', () => {
  it('만들기 → 고치기 — 영역-팀을 목록으로 맞추고(그 영역의 행만), 활성 주간 영역은 p_from_week 이후 문서에 행을 더한다', async () => {
    await asService(pool, async (c) => {
      const made = await call(c, UPSERT, [F.users.member, F.projects.a, areaArg({ code: 'NEW', name: '새 영역', sort_order: 3 }),
        JSON.stringify([{ team_id: F.teams.erp, kind: 'primary' }]), '2026-08-31'])
      expect(made).toMatchObject({ status: 'created', rows_added: 1 })   // 픽스처 문서(2026-08-31) 하나
      const NEW = made.area_id as string
      const links = async (area: string) =>
        (await c.query('select team_id, kind from public.area_teams where area_id = $1 order by team_id', [area])).rows
      expect(await links(NEW)).toEqual([{ team_id: F.teams.erp, kind: 'primary' }])
      expect(await call(c, UPSERT, [F.users.member, F.projects.a, areaArg({ id: NEW, code: 'NEW', name: '새 이름', sort_order: 4 }),
        JSON.stringify([{ team_id: F.teams.mes, kind: 'support' }]), '2026-08-31'])).toEqual({ status: 'updated', area_id: NEW, rows_added: 0 })
      expect(await links(NEW)).toEqual([{ team_id: F.teams.mes, kind: 'support' }])
      expect((await c.query('select name, sort_order, active from public.project_areas where id = $1', [NEW])).rows)
        .toEqual([{ name: '새 이름', sort_order: 4, active: true }])
      expect(await links(AREA)).toEqual([{ team_id: F.teams.erp, kind: 'primary' }])   // 다른 영역의 영역-팀은 그대로
    })
  })

  it('입력 — 모양이 틀리면 AREA_INVALID_INPUT(22023). code·name 의 앞뒤 공백은 JS trim() 의 집합으로 본다([RF1])', async () => {
    await asService(pool, async (c) => {
      const base = { kind: 'weekly_section', code: 'BAD', name: '나쁜 입력', sort_order: 0, active: true }
      const cases: [string, unknown, unknown, string | null][] = [
        ['kind 가 둘 밖', { ...base, kind: 'team' }, [], '2026-09-07'],
        ['code 빈 값', { ...base, code: '' }, [], '2026-09-07'],
        ['code 앞 U+3000', { ...base, code: '　NEW2' }, [], '2026-09-07'],
        ['code 앞 BOM', { ...base, code: '﻿X' }, [], '2026-09-07'],
        ['code 뒤 공백', { ...base, code: 'X ' }, [], '2026-09-07'],
        ['name 뒤 NBSP', { ...base, name: '이름 ' }, [], '2026-09-07'],
        ['code 가 문자열이 아니다', { ...base, code: 5 }, [], '2026-09-07'],
        ['sort_order 소수', { ...base, sort_order: 1.5 }, [], '2026-09-07'],
        ['sort_order 문자열', { ...base, sort_order: '1' }, [], '2026-09-07'],
        ['active 문자열', { ...base, active: 'yes' }, [], '2026-09-07'],
        ['id 가 uuid 가 아니다', { ...base, id: 'x' }, [], '2026-09-07'],
        ['팀 kind 가 둘 밖', base, [{ team_id: F.teams.erp, kind: 'lead' }], '2026-09-07'],
        ['팀 중복', base, [{ team_id: F.teams.erp, kind: 'primary' }, { team_id: F.teams.erp, kind: 'support' }], '2026-09-07'],
        ['팀 id 가 uuid 가 아니다', base, [{ team_id: 'erp', kind: 'primary' }], '2026-09-07'],
        ['p_teams 가 null', base, null, '2026-09-07'],
        ['주간 영역인데 p_from_week 없음', base, [], null],
      ]
      for (const [why, area, teams, week] of cases) {
        expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, JSON.stringify(area), teams === null ? null : JSON.stringify(teams), week]), why)
          .toMatchObject({ code: '22023', message: 'AREA_INVALID_INPUT' })
      }
      for (const [actor, project] of [[null, F.projects.a], [F.users.member, null]]) {
        expect(await pgError(c, UPSERT, [actor, project, JSON.stringify(base), '[]', '2026-09-07']))
          .toMatchObject({ code: '22023', message: 'AREA_INVALID_INPUT' })
      }
      // 이슈 영역은 p_from_week 없이 만든다
      expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, JSON.stringify({ ...base, kind: 'issue_area' }), '[]', null])).toBeNull()
    })
  })

  it('등급 — 명단 member 는 AREA_FORBIDDEN(42501), 없는 프로젝트는 PROJECT_NOT_FOUND', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, UPSERT, [F.users.dual, F.projects.a, areaArg({ code: 'NOPE', name: '권한 없음' }), '[]', '2026-09-07']))
        .toMatchObject({ code: '42501', message: 'AREA_FORBIDDEN' })
      expect(await pgError(c, UPSERT, [F.users.platform, id(0x3e), areaArg({ code: 'NOPE', name: '없는 프로젝트' }), '[]', '2026-09-07']))
        .toMatchObject({ code: 'P0002', message: 'PROJECT_NOT_FOUND' })
    })
  })

  it('kind·code 는 RPC 로도 못 바꾼다(23514), 같은 (프로젝트, kind, code) 만들기는 23505, 범위 밖 팀은 AREA_TEAM_SCOPE', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, areaArg({ id: AREA, kind: 'issue_area', code: 'RLSA', name: 'RLS 영역' }),
        '[]', '2026-09-07'])).toMatchObject({ code: '23514', message: 'PROJECT_AREA_KIND_IMMUTABLE' })
      expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, areaArg({ id: AREA, code: 'RLSA2', name: 'RLS 영역' }), '[]', '2026-09-07']))
        .toMatchObject({ code: '23514', message: 'PROJECT_AREA_CODE_IMMUTABLE' })
      expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, areaArg({ code: 'RLSA', name: '같은 code' }), '[]', '2026-09-07']))
        .toMatchObject({ code: '23505', constraint: 'project_areas_project_kind_code_uidx' })
      expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, areaArg({ code: 'OPS9', name: '남의 팀' }),
        JSON.stringify([{ team_id: F.teams.ops, kind: 'primary' }]), '2026-09-07'])).toMatchObject({ code: '23514', message: 'AREA_TEAM_SCOPE' })
    })
  })
})

describe('weekly_areas ⑪ 교차 프로젝트(Q11) — 영역 id 는 p_project_id 의 영역일 때만 고친다', () => {
  const QAREA = id(0x05)   // c2 의 주간 영역 — c2 전용 팀 QA 가 담당
  it('① 같은 워크스페이스의 다른 프로젝트 영역 id 로 끄면 AREA_NOT_FOUND ② 공용 팀을 넘겨도 붙지 않는다 — 그 영역·영역-팀 그대로', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $2, 'weekly_section', 'QA1', 'Q 영역')`,
        [QAREA, F.projects.b])
      await c.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'primary')`, [QAREA, F.teams.qa])
      const snapshot = async () => (await c.query(
        `select a.name, a.active, (select array_agg(x.team_id::text order by x.team_id) from public.area_teams x where x.area_id = a.id) as teams
           from public.project_areas a where a.id = $1`, [QAREA])).rows
      const before = await snapshot()
      expect(before).toEqual([{ name: 'Q 영역', active: true, teams: [F.teams.qa] }])
      // alice 는 c1(P) 의 관리자 — c2(Q) 의 영역 id 를 c1 으로 부른다
      expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, areaArg({ id: QAREA, code: 'QA1', name: '가로챔', active: false }),
        '[]', '2026-09-07'])).toMatchObject({ code: 'P0002', message: 'AREA_NOT_FOUND' })
      expect(await pgError(c, UPSERT, [F.users.member, F.projects.a, areaArg({ id: QAREA, code: 'QA1', name: 'Q 영역' }),
        JSON.stringify([{ team_id: F.teams.aShared, kind: 'support' }]), '2026-09-07'])).toMatchObject({ code: 'P0002', message: 'AREA_NOT_FOUND' })
      expect(await snapshot()).toEqual(before)
    })
  })
})

describe('weekly_areas ⑪ W17 — 영역 추가·재활성은 p_from_week 이후 문서에만 행을 만든다', () => {
  it('지난 문서는 그대로, 끄면 행은 남고, 다시 켜면 빠진 문서에만 더한다', async () => {
    await asService(pool, async (c) => {
      for (const week of ['2026-09-07', '2026-09-14', '2026-09-21']) {
        expect(await call(c, CREATE, [F.users.member, F.projects.a, week, null])).toMatchObject({ status: 'created' })
      }
      const made = await call(c, UPSERT, [F.users.member, F.projects.a, areaArg({ code: 'W17', name: 'W17 영역', sort_order: 5 }), '[]', '2026-09-14'])
      expect(made).toMatchObject({ status: 'created', rows_added: 2 })
      const W17 = made.area_id as string
      const weeksWithRow = async () => (await c.query<{ week: string }>(
        `select to_char(r.week_start, 'YYYY-MM-DD') as week from public.weekly_report_rows w join public.weekly_reports r on r.id = w.report_id
          where w.area_id = $1 order by r.week_start`, [W17])).rows.map((x) => x.week)
      expect(await weeksWithRow()).toEqual(['2026-09-14', '2026-09-21'])
      expect(await call(c, UPSERT, [F.users.member, F.projects.a,
        areaArg({ id: W17, code: 'W17', name: 'W17 영역', sort_order: 5, active: false }), '[]', '2026-09-07']))
        .toEqual({ status: 'updated', area_id: W17, rows_added: 0 })
      expect(await weeksWithRow()).toEqual(['2026-09-14', '2026-09-21'])   // 끄기는 행을 지우지 않는다(D32 가 화면에서 숨긴다)
      expect(await call(c, UPSERT, [F.users.member, F.projects.a,
        areaArg({ id: W17, code: 'W17', name: 'W17 영역', sort_order: 5 }), '[]', '2026-09-07']))
        .toEqual({ status: 'updated', area_id: W17, rows_added: 1 })
      expect(await weeksWithRow()).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])   // 픽스처 문서(2026-08-31)는 그대로
    })
  })
})

describe('weekly_areas ⑪ updated_at 트리거(Q13) — 세션은 그 열을 고를 수 없고 트리거가 매긴다', () => {
  it('칸·제목 update 뒤 두 표의 updated_at 은 그 트랜잭션의 now() 다', async () => {
    await asUser(pool, F.users.dual, async (c) => {
      await c.query(`update public.weekly_report_rows set this_content = '트리거 시각' where id = $1`, [ROW])
      await c.query(`update public.weekly_reports set title = '트리거 제목' where id = $1`, [REPORT])
      const { rows } = await c.query(
        `select (select w.updated_at = now() from public.weekly_report_rows w where w.id = $1) as row_touched,
                (select r.updated_at = now() from public.weekly_reports r where r.id = $2) as report_touched`, [ROW, REPORT])
      expect(rows).toEqual([{ row_touched: true, report_touched: true }])
    })
  })
})

describe('weekly_areas ⑪ 두 연결 — 문서 생성과 영역 추가는 같은 잠금으로 직렬화된다', () => {
  // 두 연결 사이의 커밋이 필요해 데이터를 커밋한다 — 전용 워크스페이스(aa41)·프로젝트를 만들고 finally 에서 프로젝트 → 워크스페이스 순으로
  // 지운다(projects_workspace_id_fkey 는 RESTRICT). 영역에 팀을 붙이지 않는다. 하네스 풀은 연결 둘이라 s1·s2 를 쥔 동안 pool.query 를 부르지 않는다
  const W = '00000000-0000-0000-7e57-00000000aa41'
  const P = id(0x30)
  const BASE = id(0x31)
  const WEEK = '2026-09-28'
  const cleanup = async () => {
    await pool.query('delete from public.projects where workspace_id = $1', [W])
    await pool.query('delete from public.workspaces where id = $1', [W])
  }

  it.each(['문서 먼저', '영역 먼저'] as const)('%s — 둘째 호출은 첫째의 커밋을 기다리고, 어느 순서든 새 문서에 새 영역 행이 있다', async (order) => {
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await cleanup()
      await pool.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-wa-lock', 'RLS 주간 잠금')`, [W])
      await pool.query(`insert into public.projects (id, name, workspace_id) values ($1, 'RLS 주간 잠금 P', $2)`, [P, W])
      await mondayRule((s, p) => pool.query(s, p), P)
      await pool.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $2, 'weekly_section', 'BASE', '기본 영역')`,
        [BASE, P])
      s1 = await pool.connect()
      s2 = await pool.connect()
      const s2Pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin')
      await s2.query('begin')
      const create = (c: PoolClient) => c.query(CREATE, [F.users.platform, P, WEEK, null])
      const upsert = (c: PoolClient) => c.query(UPSERT, [F.users.platform, P, areaArg({ code: 'NEW', name: '새 영역', sort_order: 1 }), '[]', WEEK])
      const [first, second] = order === '문서 먼저' ? [create, upsert] : [upsert, create]
      const r1 = (await first(s1)).rows[0].r as Record<string, unknown>
      let settled = false
      const pending = second(s2).then(
        (res) => res.rows[0].r as Record<string, unknown>, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e },
      ).finally(() => { settled = true })
      let blocked = false
      for (let i = 0; i < 250 && !settled && !blocked; i++) {
        blocked = (await s1.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [s2Pid])).rows[0].n > 0
        if (!blocked) await new Promise((r) => setTimeout(r, 20))
      }
      expect(blocked, '둘째 호출이 weekly 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      const r2 = await pending
      expect(r2).not.toBeInstanceOf(DatabaseError)
      await s2.query('commit')
      if (order === '문서 먼저') {
        expect(r1).toMatchObject({ status: 'created', rows: 1 })
        expect(r2).toMatchObject({ status: 'created', rows_added: 1 })   // 커밋된 새 문서를 잠금 뒤에 본다
      } else {
        expect(r1).toMatchObject({ status: 'created', rows_added: 0 })
        expect(r2).toMatchObject({ status: 'created', rows: 2 })         // 커밋된 새 영역을 잠금 뒤에 본다
      }
      const { rows } = await s1.query(
        `select a.code from public.weekly_report_rows w join public.weekly_reports r on r.id = w.report_id
           join public.project_areas a on a.id = w.area_id
          where r.project_id = $1 and r.week_start = $2 order by a.code`, [P, WEEK])
      expect(rows).toEqual([{ code: 'BASE' }, { code: 'NEW' }])
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
    expect((await pool.query(
      'select (select count(*) from public.projects where workspace_id = $1)::int + (select count(*) from public.workspaces where id = $1)::int as n',
      [W])).rows).toEqual([{ n: 0 }])
  })
})

describe('⑫ 사후검사 — 마이그레이션의 블록을 그대로 돌린다(민감도)', () => {
  // 번호를 쓰지 않는다 — 접미로 찾는다(D12). 블록은 읽기만 하므로 적용 뒤에 다시 돌려도 된다
  const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
  const files = readdirSync(dir).filter((f) => f.endsWith('_weekly_areas.sql'))
  const blocks = () => (readFileSync(dir + files[0], 'utf8').match(/^do \$\$\n[\s\S]*?^end \$\$;$/gm) ?? [])
    .filter((b) => b.includes('WEEKLY_AREAS_POSTCHECK'))
  const POSTCHECK = { message: expect.stringContaining('WEEKLY_AREAS_POSTCHECK') }
  /** 롤백하는 트랜잭션에서 mutate 뒤 블록을 돌려 오류를 돌려준다(통과하면 null) */
  const runAfter = (mutate: string[]) => asService(pool, async (c) => {
    for (const m of mutate) await c.query(m)
    return pgError(c, blocks()[0])
  })

  it('파일 하나·블록 하나 — 지금 카탈로그에서는 통과한다', async () => {
    expect(files).toHaveLength(1)
    expect(blocks()).toHaveLength(1)
    expect(await runAfter([])).toBeNull()
  })

  it('세션 쓰기 길을 다시 열면 멈춘다 — 표 권한·열 권한·정책', async () => {
    expect(await runAfter(['grant insert on public.weekly_report_rows to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['grant update (area_id) on public.weekly_report_rows to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['grant update (week_start) on public.weekly_reports to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['grant delete on public.project_areas to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter([
      'create policy sp4_probe on public.area_teams for insert to authenticated with check (true)',
    ])).toMatchObject(POSTCHECK)
  })

  it('트리거·잠금 상한·실행 권한·격리 문자열·가드·발행이 어긋나면 멈춘다', async () => {
    expect(await runAfter(['alter table public.weekly_report_rows disable trigger weekly_report_rows_touch'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter table public.weekly_reports enable replica trigger weekly_reports_touch'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter function public.create_weekly_report(uuid, uuid, date, jsonb) reset lock_timeout'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter function public.upsert_project_area(uuid, uuid, jsonb, jsonb, date) set lock_timeout to \'30s\''])).toMatchObject(POSTCHECK)
    expect(await runAfter(['grant execute on function public.actor_is_project_admin(uuid, uuid) to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['revoke execute on function public.create_weekly_report(uuid, uuid, date, jsonb) from service_role'])).toMatchObject(POSTCHECK)
    expect(await runAfter([`create or replace function public.project_areas_guard() returns trigger
      language plpgsql security definer set search_path to '' as $f$ begin return new; end $f$`])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter publication supabase_realtime drop table public.weekly_report_rows'])).toMatchObject(POSTCHECK)
  })

  it('도우미·RPC 의 DEFINER·search_path 가 풀리면 멈춘다', async () => {
    expect(await runAfter(['alter function public.actor_is_project_admin(uuid, uuid) reset search_path'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter function public.create_weekly_report(uuid, uuid, date, jsonb) security invoker'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter function public.upsert_project_area(uuid, uuid, jsonb, jsonb, date) set search_path to public']))
      .toMatchObject(POSTCHECK)
  })

  it('FK 의 삭제 동작이 바뀌면 멈춘다(프로젝트 직접 FK 의 캐스케이드)', async () => {
    expect(await runAfter([
      'alter table public.weekly_report_rows drop constraint weekly_report_rows_project_id_fkey',
      `alter table public.weekly_report_rows add constraint weekly_report_rows_project_id_fkey foreign key (project_id)
         references public.projects (id) on delete restrict`,
    ])).toMatchObject(POSTCHECK)
  })
})
