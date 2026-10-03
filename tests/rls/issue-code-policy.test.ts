// SP5 B1 채번(스펙 D15·§3.3 ③·§3.7 B1, 계획 P5·P6·P7) — 골든 표 패리티, 동시 100건, 연도, 정책 변경 뒤 불변, 겹침 건너뛰기, 1,000회 상한,
// 레거시 범위 미사용, 격리 가드, 설정 행 없음, 다른 범위의 같은 문자열(23505 — Review Focus 1).
// 패리티의 정본은 TS 골든 표(tests/fixtures/issue-id-policy-cases.ts)다 — 같은 표를 SQL(issue_id_policy_of·render_issue_code·issue_code_year)로
// 돌린다. JS 값은 JSON.stringify 로 넘긴다(JS null 을 SQL NULL 로 넘기면 "키 없음 = 제품 기본값" 이 되어 jsonb 'null' 판정과 달라진다).
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'
import { ID_POLICY_PARSE_CASES, ID_POLICY_RENDER_CASES, ISSUE_YEAR_BAD_TZ, ISSUE_YEAR_CASES } from '../fixtures/issue-id-policy-cases'
import { parseIdPolicy } from '@/lib/issues/idPolicy'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const P = '00000000-0000-0000-7e57-000000001b40'
const AREAS = ['00000000-0000-0000-7e57-000000001b50', '00000000-0000-0000-7e57-000000001b51', '00000000-0000-0000-7e57-000000001b52']
const AREA = (n: number) => AREAS[n]
const scene = async (c: PoolClient, policy: object | null, values: object = {}) => {
  await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 채번', F.ws])
  const v = { ...values, ...(policy ? { 'issues.id_policy': policy } : {}) }
  await c.query(`update public.project_settings set "values" = "values" || $2::jsonb where project_id = $1`, [P, JSON.stringify(v)])
}
const area = (c: PoolClient, id: string, code: string, active = true) =>
  c.query(`insert into public.project_areas (id, project_id, kind, code, name, active) values ($1, $2, 'issue_area', $3, $3, $4)`, [id, P, code, active])
type Coded = { code: string; code_seq: string; code_scope: string; code_area_id: string | null }
const add = async (c: PoolClient, areaId: string | null = null): Promise<Coded> =>
  (await c.query<Coded>(`insert into public.issues (project_id, title, area_id) values ($1, 'rls', $2)
                         returning code, code_seq::text, code_scope, code_area_id`, [P, areaId])).rows[0]

describe('TS·SQL 패리티 — 골든 표(과제 2)', () => {
  it.each(ID_POLICY_PARSE_CASES)('issue_id_policy_of: $name', async ({ raw, ok }) => {
    await asService(pool, async (c) => {
      const err = await pgError(c, `select public.issue_id_policy_of(jsonb_build_object('issues.id_policy', $1::jsonb))`, [JSON.stringify(raw)])
      expect(err === null).toBe(ok)
      expect(parseIdPolicy(raw).ok).toBe(ok)
      if (!ok) expect(err).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:issues.id_policy' })
    })
  })
  it.each(ID_POLICY_RENDER_CASES)('render_issue_code: $name', async ({ policy, areaCode, year, seq, code }) => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ v: string }>('select public.render_issue_code($1::jsonb, $2, $3, $4) as v',
        [JSON.stringify(policy), areaCode, year, seq])
      expect(rows[0].v).toBe(code)
    })
  })
  it.each(ISSUE_YEAR_CASES)('issue_code_year: $tz $at', async ({ tz, at, year }) => {
    await asService(pool, async (c) => {
      expect((await c.query<{ y: number }>('select public.issue_code_year($1, $2::timestamptz) as y', [tz, at])).rows[0].y).toBe(year)
    })
  })
  it.each(ISSUE_YEAR_BAD_TZ)('issue_code_year 거부: %s', async (tz) => {
    await asService(pool, async (c) => {
      expect(await pgError(c, `select public.issue_code_year($1, now())`, [tz])).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:calendar.timezone' })
    })
  })
  it('키 없음(SQL NULL) = 제품 기본값, JSON null·객체 아님은 손상', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ p: object }>(`select public.issue_id_policy_of('{}'::jsonb) as p`)
      expect(rows[0].p).toEqual({ prefix: 'ISS', pattern: '{prefix}-{seq:3}', counter_scope: 'project', reset: 'never' })
      expect(await pgError(c, `select public.issue_id_policy_of('{"issues.id_policy": null}'::jsonb)`))
        .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:issues.id_policy' })
    })
  })
  it('settings_ref_check(issues.id_policy) — unset 은 통과, 유효 값 통과, SQL 검증 밖 값(중첩 토큰)은 22023 — DB 쪽 마지막 방어(P7)', async () => {
    await asService(pool, async (c) => {
      const ref = `select public.settings_ref_check($1, 'issues.id_policy', null, $2::jsonb)`
      expect(await pgError(c, ref, [F.projects.a, null])).toBeNull()
      expect(await pgError(c, ref, [F.projects.a, JSON.stringify({ prefix: 'ISS', pattern: '{prefix}-{seq:3}', counter_scope: 'project', reset: 'never' })])).toBeNull()
      expect(await pgError(c, ref, [F.projects.a, JSON.stringify({ prefix: 'ISS', pattern: '{{prefix}yy}-{seq:3}', counter_scope: 'project', reset: 'never' })]))
        .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:issues.id_policy' })
      expect(await pgError(c, ref, [F.projects.a, 'null'])).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:issues.id_policy' })
    })
  })
})

describe('채번 트리거', () => {
  it('영역 0·정책 없음 → ISS-001, ISS-002 … 영역 없이 등록(분석 없음)', async () => {
    await asService(pool, async (c) => {
      await scene(c, null)
      expect(await add(c)).toEqual({ code: 'ISS-001', code_seq: '1', code_scope: '', code_area_id: null })
      expect((await add(c)).code).toBe('ISS-002')
    })
  })
  it('영역별 템플릿이 현 동작을 재현하고 영역마다 따로 센다, seq 100 무절단', async () => {
    await asService(pool, async (c) => {
      await scene(c, { prefix: 'PI', pattern: '{prefix}-I-{area}-{seq:2}', counter_scope: 'area', reset: 'never' })
      const [a0, a7] = [AREA(0), AREA(1)]
      await area(c, a0, '00'); await area(c, a7, '07')
      expect(await add(c, a0)).toEqual({ code: 'PI-I-00-01', code_seq: '1', code_scope: `a:${a0}`, code_area_id: a0 })
      expect((await add(c, a7)).code).toBe('PI-I-07-01')
      await c.query(`update public.issue_number_counters set last_no = 99 where project_id = $1 and scope_key = $2`, [P, `a:${a0}`])
      expect((await add(c, a0)).code).toBe('PI-I-00-100')
      expect(await pgError(c, `insert into public.issues (project_id, title) values ($1, 'x')`, [P]))
        .toMatchObject({ code: '23514', message: 'ISSUE_AREA_REQUIRED' })
    })
  })
  it('{yyyy} = 프로젝트 tz 의 연도 — 트리거 결과가 issue_code_year(tz, now()) 와 같다(LA 12/31 경계는 헬퍼 패리티가 본다)', async () => {
    await asService(pool, async (c) => {
      await scene(c, { prefix: 'RND', pattern: '{prefix}-{yyyy}-{seq:4}', counter_scope: 'project', reset: 'yearly' },
        { 'calendar.timezone': 'America/Los_Angeles' })
      const y = (await c.query<{ y: number }>(`select public.issue_code_year('America/Los_Angeles', now()) as y`)).rows[0].y
      expect(await add(c)).toMatchObject({ code: `RND-${y}-0001`, code_scope: `y:${y}` })
    })
  })
  it('프로젝트 tz 가 손상이면 연도 패턴의 등록이 22023 CONFIG_INVALID:calendar.timezone(키 없음 = UTC)', async () => {
    await asService(pool, async (c) => {
      await scene(c, { prefix: 'RND', pattern: '{prefix}-{yy}-{seq:4}', counter_scope: 'project', reset: 'yearly' }, { 'calendar.timezone': 'IST' })
      expect(await pgError(c, `insert into public.issues (project_id, title) values ($1, 'x')`, [P]))
        .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:calendar.timezone' })
      await c.query(`update public.project_settings set "values" = "values" - 'calendar.timezone' where project_id = $1`, [P])
      const y = (await c.query<{ y: number }>(`select public.issue_code_year('UTC', now()) as y`)).rows[0].y
      expect((await add(c)).code).toBe(`RND-${String(y % 100).padStart(2, '0')}-0001`)
    })
  })
  it('정책 손상이면 등록이 22023 CONFIG_INVALID:issues.id_policy(fail-closed — 기본값으로 풀지 않는다)', async () => {
    await asService(pool, async (c) => {
      await scene(c, null)
      await c.query(`update public.project_settings set "values" = "values" || '{"issues.id_policy": "ISS"}'::jsonb where project_id = $1`, [P])
      expect(await pgError(c, `insert into public.issues (project_id, title) values ($1, 'x')`, [P]))
        .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:issues.id_policy' })
    })
  })
  it('정책을 바꿔도 기존 코드는 그대로, 범위가 바뀌어 겹치면 건너뛴다, 레거시 범위는 쓰지 않는다', async () => {
    await asService(pool, async (c) => {
      const X = AREA(2)
      await scene(c, { prefix: 'ISS', pattern: '{prefix}{area}-{seq:3}', counter_scope: 'area', reset: 'never' })
      await area(c, X, 'X')
      for (let i = 0; i < 3; i++) await add(c, X)                                  // ISSX-001..003 (a:X)
      await c.query(`update public.project_settings set "values" = "values" || $2::jsonb where project_id = $1`,
        [P, JSON.stringify({ 'issues.id_policy': { prefix: 'ISS', pattern: '{prefix}X-{seq:3}', counter_scope: 'project', reset: 'never' } })])
      expect(await add(c)).toMatchObject({ code: 'ISSX-004', code_seq: '4', code_scope: '' })   // 1~3 은 a:X 의 코드와 겹쳐 건너뜀
      const { rows } = await c.query<{ codes: string[]; legacy: number }>(
        `select array_agg(code order by code) as codes, count(*) filter (where code_scope = 'legacy')::int as legacy from public.issues where project_id = $1`, [P])
      expect(rows[0]).toEqual({ codes: ['ISSX-001', 'ISSX-002', 'ISSX-003', 'ISSX-004'], legacy: 0 })
    })
  })
  it('겹침이 1,000번이면 ISSUE_CODE_EXHAUSTED', async () => {
    await asService(pool, async (c) => {
      await scene(c, { prefix: 'T', pattern: '{prefix}{seq:3}', counter_scope: 'project', reset: 'never' })
      await c.query(`insert into public.issues (project_id, title) select $1, 'bulk ' || g from generate_series(1, 1000) g`, [P])
      await c.query(`delete from public.issue_number_counters where project_id = $1 and scope_key = ''`, [P])
      expect(await pgError(c, `insert into public.issues (project_id, title) values ($1, 'x')`, [P]))
        .toMatchObject({ code: '23514', message: 'ISSUE_CODE_EXHAUSTED' })
    })
  })
  it('세션·service_role 이 코드를 직접 넣으면 ISSUE_CODE_MANAGED, 고치면 ISSUE_CODE_IMMUTABLE', async () => {
    await asService(pool, async (c) => {
      await scene(c, null)
      expect(await pgError(c, `insert into public.issues (project_id, title, code) values ($1, 'x', 'ISS-999')`, [P]))
        .toMatchObject({ code: '23514', message: 'ISSUE_CODE_MANAGED' })
      await add(c)
      for (const set of [`code = 'ISS-777'`, 'code_seq = 9', `code_scope = 'legacy'`, `project_id = '${F.projects.a}'`])
        expect(await pgError(c, `update public.issues set ${set} where project_id = $1`, [P]), set).toMatchObject({ code: '23514', message: 'ISSUE_CODE_IMMUTABLE' })
    })
  })
  it('read committed 가 아니면 25001 ISSUE_CODE_ISOLATION, 설정 행이 없으면 SETTINGS_ROW_MISSING', async () => {
    for (const level of ['repeatable read', 'serializable']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 격리', F.ws])
        expect(await pgError(c, `insert into public.issues (project_id, title) values ($1, 'x')`, [P]), level)
          .toMatchObject({ code: '25001', message: 'ISSUE_CODE_ISOLATION' })
      } finally { await c.query('rollback'); c.release() }
    }
    await asService(pool, async (c) => {
      await scene(c, null)
      await c.query('alter table public.project_settings disable trigger project_settings_keep_row')
      await c.query('delete from public.project_settings where project_id = $1', [P])
      expect(await pgError(c, `insert into public.issues (project_id, title) values ($1, 'x')`, [P])).toMatchObject({ code: 'P0001', message: 'SETTINGS_ROW_MISSING' })
    })
  })
})

describe('두 연결(커밋하는 전용 워크스페이스 aa56)', () => {
  const WS = '00000000-0000-0000-7e57-00000000aa56'
  const PC = '00000000-0000-0000-7e57-000000001b90'
  const setup = async (policy: object | null) => {
    const c = await pool.connect()
    try {
      await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-b1-code', 'RLS 채번 경합')`, [WS])
      await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [PC, 'RLS 경합', WS])
      if (policy) await c.query(`update public.project_settings set "values" = "values" || $2::jsonb where project_id = $1`,
        [PC, JSON.stringify({ 'issues.id_policy': policy })])
    } finally { c.release() }
  }
  const teardown = async () => {
    const c = await pool.connect()
    try {
      await c.query('delete from public.projects where workspace_id = $1', [WS])
      await c.query('delete from public.workspaces where id = $1', [WS])
      expect((await c.query('select 1 from public.issues where project_id = $1', [PC])).rowCount).toBe(0)
      expect((await c.query('select 1 from public.issue_number_counters where project_id = $1', [PC])).rowCount).toBe(0)
      expect((await c.query('select 1 from public.project_areas where project_id = $1', [PC])).rowCount).toBe(0)
    } finally { c.release() }
  }

  it('같은 범위에 동시 100건 — code 유일, 1..100 빈 번호 없음(K8)', async () => {
    await setup(null)
    try {
      const [c1, c2] = [await pool.connect(), await pool.connect()]
      try {
        const run = (c: PoolClient, tag: string) => (async () => {
          for (let i = 0; i < 50; i++) await c.query(`insert into public.issues (project_id, title) values ($1, $2)`, [PC, `${tag}${i}`])
        })()
        await Promise.all([run(c1, 'a'), run(c2, 'b')])
        const { rows } = await c1.query<{ seqs: string[]; codes: number }>(
          `select array_agg(code_seq::text order by code_seq) as seqs, count(distinct code)::int as codes from public.issues where project_id = $1`, [PC])
        expect(rows[0].codes).toBe(100)
        expect(rows[0].seqs).toEqual(Array.from({ length: 100 }, (_, i) => String(i + 1)))
      } finally { c1.release(); c2.release() }
    } finally { await teardown() }
  })

  it('[RF1] 다른 범위가 같은 문자열을 렌더(영역 1 의 101번 = 영역 11 의 1번 = Q-1101) — 뒤쪽은 23505, 다시 하면 다음 번호', async () => {
    await setup({ prefix: 'Q', pattern: '{prefix}-{area}{seq:2}', counter_scope: 'area', reset: 'never' })
    const [A1, A11] = ['00000000-0000-0000-7e57-000000001b91', '00000000-0000-0000-7e57-000000001b92']
    try {
      const c = await pool.connect()
      try {
        await c.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $3, 'issue_area', '1', '일'), ($2, $3, 'issue_area', '11', '십일')`, [A1, A11, PC])
        await c.query(`insert into public.issue_number_counters (project_id, scope_key, last_no) values ($1, $2, 100)`, [PC, `a:${A1}`])
      } finally { c.release() }
      const [c1, c2] = [await pool.connect(), await pool.connect()]
      try {
        await c1.query('begin')
        expect((await c1.query<{ code: string }>(`insert into public.issues (project_id, title, area_id) values ($1, 'a', $2) returning code`, [PC, A1])).rows[0].code).toBe('Q-1101')
        const second = c2.query(`insert into public.issues (project_id, title, area_id) values ($1, 'b', $2) returning code`, [PC, A11])
          .then(() => null, (e: { code?: string; constraint?: string }) => e)
        await new Promise((r) => setTimeout(r, 300))     // c2 가 유일 인덱스에서 c1 을 기다리게
        await c1.query('commit')
        expect(await second).toMatchObject({ code: '23505', constraint: 'issues_project_code_uidx' })
        expect((await c2.query<{ code: string }>(`insert into public.issues (project_id, title, area_id) values ($1, 'b2', $2) returning code`, [PC, A11])).rows[0].code)
          .toBe('Q-1102')
      } finally { c1.release(); c2.release() }
    } finally { await teardown() }
  })
})
