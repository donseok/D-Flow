// SP5 B1 이슈 영역(스펙 D17·D55·§3.7 B1, 계획 P3·P4) — 영역 code 규칙, 비활성, 교차 프로젝트, 비활성화 경합, 레거시 이슈의 나중 분류,
// 세션 위조(Review Focus 2), 프로젝트 삭제(Review Focus 3). 회의록 RPC 케이스는 과제 6 이 이 파일에 더한다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const P = '00000000-0000-0000-7e57-000000001b00'
const [AX, AY, AOFF] = ['00000000-0000-0000-7e57-000000001b01', '00000000-0000-0000-7e57-000000001b02', '00000000-0000-0000-7e57-000000001b03']
const PI = { prefix: 'PI', pattern: '{prefix}-I-{area}-{seq:2}', counter_scope: 'area', reset: 'never' }
const scene = async (c: PoolClient, policy: object | null) => {
  await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 이슈 영역', F.ws])
  if (policy) await c.query(`update public.project_settings set "values" = "values" || $2::jsonb where project_id = $1`, [P, JSON.stringify({ 'issues.id_policy': policy })])
  await c.query(`insert into public.project_areas (id, project_id, kind, code, name, active) values
    ($1, $4, 'issue_area', 'RND', '연구', true), ($2, $4, 'issue_area', 'OPS', '운영', true), ($3, $4, 'issue_area', 'OLD', '옛 영역', false)`, [AX, AY, AOFF, P])
}
const UPSERT = `select public.upsert_project_area($1, $2, $3::jsonb, '[]'::jsonb, null)`

describe('영역 code 규칙(D17)', () => {
  it('issue_area 는 ^[A-Z0-9]{1,8}$ — 트리거(insert)·RPC 둘 다, weekly_section 은 규칙 밖, code 불변', async () => {
    await asService(pool, async (c) => {
      await scene(c, null)
      for (const code of ['rnd', 'R&D', 'ABCDEFGHI', 'ㄱ'])
        expect(await pgError(c, `insert into public.project_areas (project_id, kind, code, name) values ($1, 'issue_area', $2, 'x')`, [P, code]), code)
          .toMatchObject({ code: '23514', message: 'PROJECT_AREA_CODE_INVALID' })
      expect(await pgError(c, `insert into public.project_areas (project_id, kind, code, name) values ($1, 'weekly_section', 'rnd', 'x')`, [P])).toBeNull()
      expect(await pgError(c, UPSERT, [F.users.platform, P, JSON.stringify({ kind: 'issue_area', code: 'qa1', name: '품질', sort_order: 1, active: true })]))
        .toMatchObject({ code: '22023', message: 'AREA_CODE_INVALID' })
      expect(await pgError(c, UPSERT, [F.users.platform, P, JSON.stringify({ kind: 'issue_area', code: 'QA1', name: '품질', sort_order: 1, active: true })])).toBeNull()
      expect(await pgError(c, `update public.project_areas set code = 'RND2' where id = $1`, [AX])).toMatchObject({ code: '23514', message: 'PROJECT_AREA_CODE_IMMUTABLE' })
    })
  })
})

describe('등록·분류 규칙(P4·D55)', () => {
  it('비활성 영역·다른 프로젝트 영역은 거부, 개명·비활성은 기존 코드를 바꾸지 않는다', async () => {
    await asService(pool, async (c) => {
      await scene(c, PI)
      expect(await pgError(c, `insert into public.issues (project_id, title, area_id) values ($1, 'x', $2)`, [P, AOFF])).toMatchObject({ message: 'ISSUE_AREA_INACTIVE' })
      expect(await pgError(c, `insert into public.issues (project_id, title, area_id) values ($1, 'x', $2)`, [F.projects.a, AX])).toMatchObject({ message: 'ISSUE_AREA_NOT_FOUND' })
      const { rows } = await c.query<{ id: string; code: string }>(`insert into public.issues (project_id, title, area_id) values ($1, 'x', $2) returning id, code`, [P, AX])
      expect(rows[0].code).toBe('PI-I-RND-01')
      await c.query(`update public.project_areas set name = '연구개발', active = false where id = $1`, [AX])
      expect((await c.query<{ code: string }>('select code from public.issues where id = $1', [rows[0].id])).rows[0].code).toBe(rows[0].code)
    })
  })
  it('weekly_section 영역은 이슈 영역이 아니다 — insert·update 모두 ISSUE_AREA_NOT_FOUND', async () => {
    await asService(pool, async (c) => {
      await scene(c, null)
      const ws = (await c.query<{ id: string }>(`insert into public.project_areas (project_id, kind, code, name) values ($1, 'weekly_section', 'WK', '주간') returning id`, [P])).rows[0].id
      expect(await pgError(c, `insert into public.issues (project_id, title, area_id) values ($1, 'x', $2)`, [P, ws])).toMatchObject({ code: '23514', message: 'ISSUE_AREA_NOT_FOUND' })
      const iss = (await c.query<{ id: string }>(`insert into public.issues (project_id, title) values ($1, 'x') returning id`, [P])).rows[0].id
      expect(await pgError(c, 'update public.issues set area_id = $2 where id = $1', [iss, ws])).toMatchObject({ code: '23514', message: 'ISSUE_AREA_NOT_FOUND' })
    })
  })
  it('레거시·ISS 코드 이슈(code_area_id null)는 나중에 영역을 붙인다, 영역 코드 이슈는 영역을 못 바꾼다(ISSUE_AREA_IMMUTABLE)', async () => {
    await asService(pool, async (c) => {
      await scene(c, null)                                        // ISS — 영역 불필요
      const iss = (await c.query<{ id: string }>(`insert into public.issues (project_id, title) values ($1, 'x') returning id`, [P])).rows[0].id
      expect(await pgError(c, 'update public.issues set area_id = $2 where id = $1', [iss, AX])).toBeNull()
      expect(await pgError(c, 'update public.issues set area_id = $2 where id = $1', [iss, AY])).toBeNull()   // code_area_id null 이면 자유
      await c.query(`update public.project_settings set "values" = "values" || $2::jsonb where project_id = $1`, [P, JSON.stringify({ 'issues.id_policy': PI })])
      const coded = (await c.query<{ id: string }>(`insert into public.issues (project_id, title, area_id) values ($1, 'y', $2) returning id`, [P, AX])).rows[0].id
      expect(await pgError(c, 'update public.issues set area_id = $2 where id = $1', [coded, AY])).toMatchObject({ code: '23514', message: 'ISSUE_AREA_IMMUTABLE' })
      expect(await pgError(c, 'update public.issues set area_id = null where id = $1', [coded])).toMatchObject({ message: 'ISSUE_AREA_IMMUTABLE' })
    })
  })
  it('코드 영역은 이슈 영역과 같다 — 트리거를 끄고 넣어도 CHECK issues_code_area_check(FK 는 area_id 하나 — PGRST201 방지)', async () => {
    await asService(pool, async (c) => {
      await scene(c, PI)
      await c.query(`set local session_replication_role = replica`)   // 트리거를 끄고 CHECK 만 본다(postgres 롤)
      // status_code 는 SP5b 부터 NOT NULL(DEFAULT 없음 — 트리거가 채운다). 트리거를 끈 이 케이스는 직접 준다(의도 — CHECK 만 본다 — 보존)
      const insert = `insert into public.issues (project_id, title, area_id, code, code_seq, code_scope, code_area_id, status_code) values ($1, 'chk', $2, $3, 1, $4, $5, 'open')`
      expect(await pgError(c, insert, [P, AX, 'PI-I-OPS-01', `a:${AY}`, AY])).toMatchObject({ code: '23514', constraint: 'issues_code_area_check' })
      expect(await pgError(c, insert, [P, null, 'PI-I-RND-01', `a:${AX}`, AX])).toMatchObject({ code: '23514', constraint: 'issues_code_area_check' })
      expect(await pgError(c, insert, [P, AX, 'PI-I-RND-01', `a:${AX}`, AX])).toBeNull()
    })
  })
  it('대분류는 그 프로젝트의 활성 이슈 영역 안에서만 — 분류 이슈의 대분류 연결을 끊지 못한다(0062 계약)', async () => {
    await asService(pool, async (c) => {
      await scene(c, PI)
      expect(await pgError(c, `insert into public.issue_major_processes (project_id, area_id, name) values ($1, $2, '대분류')`, [P, AOFF]))
        .toMatchObject({ code: '23514', message: 'ISSUE_AREA_INACTIVE' })
      expect(await pgError(c, `insert into public.issue_major_processes (project_id, area_id, name) values ($1, $2, '대분류')`, [F.projects.a, AX]))
        .toMatchObject({ code: '23514', message: 'ISSUE_AREA_NOT_FOUND' })
      const major = (await c.query<{ id: string; major_seq: string }>(
        `insert into public.issue_major_processes (project_id, area_id, name) values ($1, $2, ' 대분류 ') returning id, major_seq::text`, [P, AX])).rows[0]
      expect(major.major_seq).toBe('1')
      expect(await pgError(c, `update public.issue_major_processes set area_id = $2 where id = $1`, [major.id, AY])).toMatchObject({ message: 'ISSUE_MAJOR_IMMUTABLE' })
      const issue = (await c.query<{ id: string }>(`insert into public.issues (project_id, title, area_id, major_id, sub_process, owner_department, source_type)
        values ($1, 'x', $2, $3, 's', 'd', 'other') returning id`, [P, AX, major.id])).rows[0].id
      expect(await pgError(c, 'update public.issues set major_id = null where id = $1', [issue])).toMatchObject({ code: '23514', message: 'ISSUE_MAJOR_UNSET_FORBIDDEN' })
      // 다른 영역의 대분류는 FK(major_id, project_id, area_id)가 막는다
      const otherMajor = (await c.query<{ id: string }>(
        `insert into public.issue_major_processes (project_id, area_id, name) values ($1, $2, '다른 대분류') returning id`, [P, AY])).rows[0].id
      expect(await pgError(c, 'update public.issues set major_id = $2 where id = $1', [issue, otherMajor])).toMatchObject({ code: '23503' })
      // 대분류만 있고 영역이 없는 이슈 — CHECK
      expect(await pgError(c, `insert into public.issues (project_id, title, major_id, sub_process, owner_department, source_type)
        values ($1, 'x', $2, 's', 'd', 'other')`, [P, major.id])).toMatchObject({ code: '23514' })
    })
  })
})

describe('[RF2] 세션 위조 — 프로젝트 관리자(alice)가 PostgREST 꼴로 직접 쓴다(픽스처 c1·이슈 F.rows.issue·영역 1bf0/비활성 1bf1)', () => {
  const F_AREA = '00000000-0000-0000-7e57-000000001bf0', F_AREA_OFF = '00000000-0000-0000-7e57-000000001bf1'
  it('code 지정 insert·code/area_kind 변경·다른 프로젝트 영역·비활성 영역 지정 — 전부 거부, 행 불변', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, `insert into public.issues (project_id, title, created_by, code) values ($1, 'x', $2, 'ISS-500')`, [F.projects.a, F.users.member]))
        .toMatchObject({ code: '23514', message: 'ISSUE_CODE_MANAGED' })
      for (const set of [`code = 'X-1'`, `code_area_id = '${F_AREA}'`, 'code_seq = 999', `code_scope = 'legacy'`])
        expect(await pgError(c, `update public.issues set ${set} where id = $1`, [F.rows.issue]), set).toMatchObject({ code: '23514', message: 'ISSUE_CODE_IMMUTABLE' })
      expect(await pgError(c, `update public.issues set area_kind = 'weekly_section' where id = $1`, [F.rows.issue])).toMatchObject({ code: '23514' })
      expect(await pgError(c, `update public.issues set area_id = $2 where id = $1`, [F.rows.issue, AX])).toMatchObject({ message: 'ISSUE_AREA_NOT_FOUND' })
      expect(await pgError(c, `update public.issues set area_id = $2 where id = $1`, [F.rows.issue, F_AREA_OFF])).toMatchObject({ message: 'ISSUE_AREA_INACTIVE' })
      const { rows } = await c.query<{ area_id: string | null; code_scope: string }>('select area_id, code_scope from public.issues where id = $1', [F.rows.issue])
      expect(rows[0]).toEqual({ area_id: null, code_scope: '' })
      // 정상 경로: 코드 영역이 없는 이슈(ISS)는 활성 영역을 붙일 수 있다
      expect(await pgError(c, `update public.issues set area_id = $2 where id = $1`, [F.rows.issue, F_AREA])).toBeNull()
    })
  })
  it('다른 프로젝트의 실재 영역(B 워크스페이스 c2)을 지정해도 ISSUE_AREA_NOT_FOUND — 트리거가 FK 앞에서 판정', async () => {
    await asService(pool, async (c) => {
      const other = (await c.query<{ id: string }>(
        `insert into public.project_areas (project_id, kind, code, name) values ($1, 'issue_area', 'OTH', '다른 영역') returning id`, [F.projects.b])).rows[0].id
      expect(await pgError(c, `insert into public.issues (project_id, title, area_id) values ($1, 'x', $2)`, [F.projects.a, other]))
        .toMatchObject({ code: '23514', message: 'ISSUE_AREA_NOT_FOUND' })
      expect(await pgError(c, `update public.issues set area_id = $2 where id = $1`, [F.rows.issue, other]))
        .toMatchObject({ code: '23514', message: 'ISSUE_AREA_NOT_FOUND' })
    })
  })
})

describe('비활성화 경합(D15 — 영역 행 for key share ↔ upsert_project_area 의 for update)', () => {
  const WS = '00000000-0000-0000-7e57-00000000aa57'
  const PC = '00000000-0000-0000-7e57-000000001b20', AR = '00000000-0000-0000-7e57-000000001b21'
  it('비활성화가 먼저 잡으면 등록은 기다렸다가 ISSUE_AREA_INACTIVE — 비활성 영역에 이슈 0', async () => {
    const s = await pool.connect()
    try {
      await s.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-b1-area', 'RLS 영역 경합')`, [WS])
      await s.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [PC, 'RLS 영역 경합', WS])
      await s.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $2, 'issue_area', 'RND', '연구')`, [AR, PC])
    } finally { s.release() }
    const [c1, c2] = [await pool.connect(), await pool.connect()]
    try {
      await c2.query('begin')
      await c2.query(UPSERT, [F.users.platform, PC, JSON.stringify({ id: AR, kind: 'issue_area', code: 'RND', name: '연구', sort_order: 0, active: false })])
      const ins = c1.query(`insert into public.issues (project_id, title, area_id) values ($1, 'race', $2)`, [PC, AR]).then(() => null, (e) => e)
      await new Promise((r) => setTimeout(r, 300))
      await c2.query('commit')
      expect(await ins).toMatchObject({ code: '23514', message: 'ISSUE_AREA_INACTIVE' })
      expect((await c1.query('select 1 from public.issues where area_id = $1', [AR])).rowCount).toBe(0)
    } finally {
      c1.release(); c2.release()
      const t = await pool.connect()
      try {
        await t.query('delete from public.projects where workspace_id = $1', [WS]); await t.query('delete from public.workspaces where id = $1', [WS])
        expect((await t.query('select 1 from public.project_areas where project_id = $1', [PC])).rowCount).toBe(0)
      } finally { t.release() }
    }
  })
})

describe('[RF3] 영역·이슈·대분류·카운터가 있는 프로젝트 삭제(P3 — NO ACTION)', () => {
  it('삭제가 통과하고 남은 행 0', async () => {
    await asService(pool, async (c) => {
      await scene(c, PI)
      const { rows } = await c.query<{ id: string }>(`insert into public.issue_major_processes (project_id, area_id, name) values ($1, $2, '대분류') returning id`, [P, AX])
      await c.query(`insert into public.issues (project_id, title, area_id, major_id, sub_process, owner_department, source_type)
                     values ($1, 'x', $2, $3, 's', 'd', 'other')`, [P, AX, rows[0].id])
      await c.query(`insert into public.issues (project_id, title, area_id) values ($1, 'y', $2)`, [P, AY])
      expect(await pgError(c, 'delete from public.projects where id = $1', [P])).toBeNull()
      const left = await c.query(`select (select count(*) from public.issues where project_id = $1) + (select count(*) from public.project_areas where project_id = $1)
                                   + (select count(*) from public.issue_major_processes where project_id = $1) + (select count(*) from public.issue_number_counters where project_id = $1) as n`, [P])
      expect(Number(left.rows[0].n)).toBe(0)
    })
  })
})

describe('create_issue_from_minute_block — 새 시그니처·유효 모듈(D15)', () => {
  // 픽스처 c1(워크스페이스 F.ws)·회의록 F.rows.minute/minuteVersion(body_hash 'rls-h')·영역 1bf0(R99)·1bf1(OFF1, 비활성)
  const F_AREA = '00000000-0000-0000-7e57-000000001bf0', F_AREA_OFF = '00000000-0000-0000-7e57-000000001bf1'
  const CALL = `select * from public.create_issue_from_minute_block(
    p_project_id => $1, p_title => '회의록 이슈', p_body => '', p_severity => 'medium', p_assignee_member_ids => array[]::uuid[],
    p_start_date => null, p_due_date => null, p_area_id => $2, p_major_name => $3, p_sub_process => $4, p_owner_department => $5,
    p_related_systems => $6, p_source_type => $7, p_source_detail => $8, p_actor_id => $9, p_created_by_name => 'alice',
    p_minute_id => $10, p_minute_version_id => $11, p_body_hash => 'rls-h', p_block_index => $12, p_block_hash => 'rls-b2',
    p_excerpt_snapshot => '발췌', p_source_kind => 'manual', p_source_key => null)`
  const noAnalysis = (block: number, area: string | null = null) =>
    [F.projects.a, area, null, null, null, null, null, null, F.users.member, F.rows.minute, F.rows.minuteVersion, block]
  const analysis = (block: number) =>
    [F.projects.a, F_AREA, '대분류 하나', '하위', '주관', ['시스템'], 'minutes', '원문', F.users.member, F.rows.minute, F.rows.minuteVersion, block]
  const setModules = (c: PoolClient, wsAllowed: boolean, prjEnabled: boolean, setting?: 'optional' | 'required') => c.query(
    `with w as (
       update public.workspace_settings set "values" = jsonb_set("values", '{modules.allowed}',
         (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements("values"->'modules.allowed') x where x <> '"issue_analysis"')
         || case when $2 then '["issue_analysis"]'::jsonb else '[]'::jsonb end) where workspace_id = $1 returning 1)
     update public.project_settings set "values" = jsonb_set("values", '{modules.enabled}',
       (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements("values"->'modules.enabled') x where x <> '"issue_analysis"')
       || case when $3 then '["issue_analysis"]'::jsonb else '[]'::jsonb end)
       || case when $4::text is null then '{}'::jsonb else jsonb_build_object('issues.analysis', $4::text) end
     where project_id = $5`,
    [F.ws, wsAllowed, prjEnabled, setting ?? null, F.projects.a])

  it('모듈 꺼짐 — 분석 없이 등록되고 (issue_id, code) 를 돌려준다, 분석 인자가 오면 ISSUE_ANALYSIS_DISABLED', async () => {
    await asService(pool, async (c) => {
      await setModules(c, false, false)
      const { rows } = await c.query<{ issue_id: string; code: string }>(CALL, noAnalysis(10))
      expect(Object.keys(rows[0]).sort()).toEqual(['code', 'issue_id'])
      expect(rows[0].code).toMatch(/^ISS-\d{3,}$/)
      const { rows: r2 } = await c.query(`select sub_process, owner_department, source_type, source_detail, related_systems, major_id, area_id
                                             from public.issues where id = $1`, [rows[0].issue_id])
      expect(r2[0]).toEqual({ sub_process: '', owner_department: '', source_type: null, source_detail: '', related_systems: [], major_id: null, area_id: null })
      expect(await pgError(c, CALL, analysis(11))).toMatchObject({ code: '22023', message: 'ISSUE_ANALYSIS_DISABLED' })
    })
  })
  it('워크스페이스 허용과 프로젝트 켜짐 중 하나라도 없으면 유효 모듈이 아니다 — 분석 인자 거부', async () => {
    for (const [ws, prj] of [[false, true], [true, false]] as const) {
      await asService(pool, async (c) => {
        await setModules(c, ws, prj, 'optional')
        expect(await pgError(c, CALL, analysis(12)), `ws ${ws} prj ${prj}`).toMatchObject({ code: '22023', message: 'ISSUE_ANALYSIS_DISABLED' })
      })
    }
  })
  it("켜짐·'required' — 분석 없으면 ISSUE_ANALYSIS_REQUIRED, 있으면 그 영역 안에서 대분류를 만들고 등록", async () => {
    await asService(pool, async (c) => {
      await setModules(c, true, true, 'required')
      expect(await pgError(c, CALL, noAnalysis(13, F_AREA))).toMatchObject({ code: '22023', message: 'ISSUE_ANALYSIS_REQUIRED' })
      const { rows } = await c.query<{ issue_id: string }>(CALL, analysis(14))
      const { rows: r2 } = await c.query<{ area_id: string; major_area: string; source_type: string }>(
        `select i.area_id, m.area_id as major_area, i.source_type from public.issues i join public.issue_major_processes m on m.id = i.major_id where i.id = $1`, [rows[0].issue_id])
      expect(r2[0]).toEqual({ area_id: F_AREA, major_area: F_AREA, source_type: 'minutes' })
      // 같은 이름은 그 영역의 대분류를 재사용한다
      const again = await c.query<{ issue_id: string }>(CALL, [...analysis(18).slice(0, 11), 18])
      const { rows: r3 } = await c.query<{ n: number }>(`select count(distinct major_id)::int as n from public.issues where id = any($1::uuid[])`,
        [[rows[0].issue_id, again.rows[0].issue_id]])
      expect(r3[0].n).toBe(1)
    })
  })
  it("켜짐·'optional' — 분석 없이 통과, 분석이 있는데 영역이 없으면 ISSUE_AREA_REQUIRED, 비활성 영역은 ISSUE_AREA_INACTIVE, 다른 프로젝트 영역은 NOT_FOUND", async () => {
    await asService(pool, async (c) => {
      await setModules(c, true, true, 'optional')
      expect(await pgError(c, CALL, noAnalysis(15))).toBeNull()
      expect(await pgError(c, CALL, [...analysis(16).slice(0, 1), null, ...analysis(16).slice(2)])).toMatchObject({ code: '23514', message: 'ISSUE_AREA_REQUIRED' })
      expect(await pgError(c, CALL, noAnalysis(17, F_AREA_OFF))).toMatchObject({ code: '23514', message: 'ISSUE_AREA_INACTIVE' })
      const other = (await c.query<{ id: string }>(
        `insert into public.project_areas (project_id, kind, code, name) values ($1, 'issue_area', 'OTH', '다른 영역') returning id`, [F.projects.b])).rows[0].id
      expect(await pgError(c, CALL, noAnalysis(19, other))).toMatchObject({ code: '23514', message: 'ISSUE_AREA_NOT_FOUND' })
    })
  })
  it('{area} 정책 프로젝트 — 영역 없이 부르면 채번 트리거가 ISSUE_AREA_REQUIRED, 영역이 있으면 영역 코드로 발번', async () => {
    await asService(pool, async (c) => {
      await setModules(c, false, false)
      await c.query(`update public.project_settings set "values" = "values" || $2::jsonb where project_id = $1`,
        [F.projects.a, JSON.stringify({ 'issues.id_policy': { prefix: 'PI', pattern: '{prefix}-I-{area}-{seq:2}', counter_scope: 'area', reset: 'never' } })])
      expect(await pgError(c, CALL, noAnalysis(20))).toMatchObject({ code: '23514', message: 'ISSUE_AREA_REQUIRED' })
      const { rows } = await c.query<{ code: string }>(CALL, noAnalysis(21, F_AREA))
      expect(rows[0].code).toMatch(/^PI-I-R99-\d{2,}$/)
    })
  })
  it('EXECUTE — service_role 만, DEFINER, 옛 시그니처는 없다', async () => {
    await asService(pool, async (c) => {
      const sig = 'public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text)'
      const { rows } = await c.query<{ anon: boolean; auth: boolean; svc: boolean; secdef: boolean; old: string | null }>(
        `select has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon, has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as svc, (select prosecdef from pg_proc where oid = $1::regprocedure) as secdef,
                to_regprocedure('public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, text, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text)')::text as old`, [sig])
      expect(rows[0]).toEqual({ anon: false, auth: false, svc: true, secdef: true, old: null })
    })
  })
})
