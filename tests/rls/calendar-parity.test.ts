// NNNN_calendar ③ — SQL 헬퍼(week_key_from_rules·week_key_of·is_workday·week_rules_of)가 TS calendar.ts 와 **같은 골든 행렬**
// (tests/fixtures/calendar-golden.ts)에서 같은 답을 낸다(스펙 D37·D53·K5). tz 허용 집합은 TS ⊂ PG(D54 — TS 가 받는 이름은 PG at time zone 이
// 모두 받는다). 의존성 트리거의 근무 요일 판정은 과제 9 가 아래에 덧붙인다(④). 케이스는 begin…rollback 이고 부트스트랩 계정·이관 기록 값에
// 기대지 않는다(H2 ⑤ — 근무 요일·주 규칙은 케이스가 그 임시 프로젝트의 설정 행에 직접 쓴다).
import { type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_WEEK_RULES, calendarOf, isWorkingDay, parseTimezone, stampIn, weekKeyOf, type IsoDow, type WeekStartRule,
} from '@/lib/domain/calendar'
import { GOLDEN_TZ_NAMES, GOLDEN_TZ_REJECT, GOLDEN_WEEK_CASES, GOLDEN_WORKDAY_CASES } from '../fixtures/calendar-golden'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const id = (n: number) => `00000000-0000-0000-7e57-0000000019${n.toString(16).padStart(2, '0')}`
const P = id(0x00)                 // 케이스마다 롤백되는 임시 프로젝트(A 워크스페이스)
const MISSING = id(0x0f)           // 만들지 않는 프로젝트 — 설정 행이 없다
const INVALID_RULES = { code: '22023', message: 'CONFIG_INVALID:calendar.week_start' }
const INVALID_DAYS = { code: '22023', message: 'CONFIG_INVALID:calendar.working_days' }
const ROW_MISSING = { code: 'P0001', message: 'SETTINGS_ROW_MISSING' }

async function newProject(c: PoolClient, values: Record<string, unknown> = {}) {
  await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 달력 대조', F.ws])
  await setValues(c, values)
}
/** 설정 행의 values 를 통째로 바꾼다 — 행은 projects_settings_row 트리거가 만든다(0012 ⑨) */
async function setValues(c: PoolClient, values: Record<string, unknown>) {
  await c.query(`update public.project_settings set "values" = $2::jsonb where project_id = $1`, [P, JSON.stringify(values)])
}
const keyFromRules = async (c: PoolClient, rules: unknown, date: string) =>
  (await c.query<{ k: string }>('select public.week_key_from_rules($1::jsonb, $2::date)::text as k', [JSON.stringify(rules), date])).rows[0].k
/** 'YYYY-MM-DD' 의 [from, to] 날짜 목록(UTC 산술) */
function days(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}
/** 골든 행렬의 규칙 목록들(중복 제거) + 제품 기본값 + 월요일 한 원소 */
const RULE_SETS: WeekStartRule[][] = [...new Map(
  [...GOLDEN_WEEK_CASES.map((g) => g.rules), [...DEFAULT_WEEK_RULES], [{ day: 'monday', from: null }]]
    .map((r) => [JSON.stringify(r), r as WeekStartRule[]] as const),
).values()]

describe('③ week_key_from_rules — 골든 행렬·일 단위 전수에서 TS weekKeyOf 와 같다', () => {
  it('골든 행렬의 모든 행: SQL = 기대 키 = TS', async () => {
    expect(GOLDEN_WEEK_CASES.length).toBeGreaterThanOrEqual(12)
    await asService(pool, async (c) => {
      for (const g of GOLDEN_WEEK_CASES) {
        expect(weekKeyOf(g.rules, g.date), `TS ${g.name}`).toBe(g.key)
        expect(await keyFromRules(c, g.rules, g.date), `SQL ${g.name}`).toBe(g.key)
      }
    })
  })

  it('규칙 묶음마다 2026-08-01~2027-01-31 의 매일 — SQL 과 TS 가 같은 키(과도기 6·8일 창 포함)', async () => {
    const span = days('2026-08-01', '2027-01-31')
    await asService(pool, async (c) => {
      for (const rules of RULE_SETS) {
        const { rows } = await c.query<{ d: string; k: string }>(
          `select g.d::date::text as d, public.week_key_from_rules($1::jsonb, g.d::date)::text as k
             from pg_catalog.generate_series($2::date, $3::date, interval '1 day') as g(d) order by 1`,
          [JSON.stringify(rules), span[0], span[span.length - 1]])
        expect(rows.map((r) => [r.d, r.k]), JSON.stringify(rules)).toEqual(span.map((d) => [d, weekKeyOf(rules, d)]))
      }
    })
  })

  it('null 날짜는 null(트리거가 부르지 않는 값이지만 함수가 throw 하지 않는다)', async () => {
    await asService(pool, async (c) => {
      expect((await c.query('select public.week_key_from_rules($1::jsonb, null) as k', [JSON.stringify(DEFAULT_WEEK_RULES)])).rows)
        .toEqual([{ k: null }])
    })
  })
})

describe('③ week_rules_of — 설정 문서에서 규칙을 꺼내 모양을 검사한다(§2.4.1 — 키 없음 = 기본값, 손상 = 22023)', () => {
  it('키가 없으면 제품 기본값 일요일 한 원소, 있으면 그 목록 그대로', async () => {
    await asService(pool, async (c) => {
      const rulesOf = async (values: unknown) =>
        (await c.query('select public.week_rules_of($1::jsonb) as r', [JSON.stringify(values)])).rows[0].r
      expect(await rulesOf({})).toEqual([{ day: 'sunday', from: null }])
      expect(await rulesOf({ 'core.level_labels': ['A'] })).toEqual([{ day: 'sunday', from: null }])
      const two = [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-09-27' }]
      expect(await rulesOf({ 'calendar.week_start': two })).toEqual(two)
      const three = [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-09-27' }, { day: 'monday', from: '2027-03-01' }]
      expect(await rulesOf({ 'calendar.week_start': three })).toEqual(three)
    })
  })

  it('모양이 틀리면 22023 CONFIG_INVALID:calendar.week_start — 기본값으로 풀지 않는다', async () => {
    const bad: [string, unknown][] = [
      ['JSON null', null],
      ['배열이 아니다', { day: 'sunday', from: null }],
      ['빈 배열', []],
      ['원소가 객체가 아니다', ['sunday']],
      ['모르는 요일', [{ day: 'tuesday', from: null }]],
      ['요일이 없다', [{ from: null }]],
      ['from 이 없다', [{ day: 'sunday' }]],
      ['첫 원소의 from 이 null 이 아니다', [{ day: 'sunday', from: '2026-09-27' }]],
      ['둘째 원소의 from 이 null', [{ day: 'monday', from: null }, { day: 'sunday', from: null }]],
      ['날짜 꼴이 아니다', [{ day: 'monday', from: null }, { day: 'sunday', from: '2026/09/27' }]],
      ['없는 날짜', [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-02-30' }]],
      ['from 의 요일이 day 와 다르다', [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-09-28' }]],
      ['이웃 원소의 요일이 같다', [{ day: 'sunday', from: null }, { day: 'sunday', from: '2026-09-27' }]],
      ['from 이 오름차순이 아니다', [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-04' }, { day: 'monday', from: '2026-09-28' }]],
    ]
    await asService(pool, async (c) => {
      for (const [why, v] of bad) {
        expect(await pgError(c, 'select public.week_rules_of($1::jsonb)', [JSON.stringify({ 'calendar.week_start': v })]), why)
          .toMatchObject(INVALID_RULES)
      }
    })
  })
})

describe('③ week_key_of — 그 프로젝트 설정 행의 규칙으로 키를 낸다(판독형)', () => {
  it('규칙 묶음마다 골든 행렬의 날짜에서 TS 와 같다 — 키가 없으면 일요일', async () => {
    await asService(pool, async (c) => {
      await newProject(c)
      for (const rules of RULE_SETS) {
        // 제품 기본값 묶음은 키를 지운 문서로 — '키 없음 = 일요일' 경로를 같이 본다
        const isDefault = JSON.stringify(rules) === JSON.stringify(DEFAULT_WEEK_RULES)
        await setValues(c, isDefault ? {} : { 'calendar.week_start': rules })
        for (const g of GOLDEN_WEEK_CASES) {
          const { rows } = await c.query<{ k: string }>('select public.week_key_of($1, $2::date)::text as k', [P, g.date])
          expect(rows[0].k, `${JSON.stringify(rules)} @ ${g.date}`).toBe(weekKeyOf(rules, g.date))
        }
      }
    })
  })

  it('설정 행이 없으면 P0001 SETTINGS_ROW_MISSING, 규칙이 손상이면 22023 — 둘을 가른다(E24)', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, 'select public.week_key_of($1, $2::date)', [MISSING, '2026-10-01'])).toMatchObject(ROW_MISSING)
      await newProject(c, { 'calendar.week_start': 'monday' })
      expect(await pgError(c, 'select public.week_key_of($1, $2::date)', [P, '2026-10-01'])).toMatchObject(INVALID_RULES)
    })
  })
})

describe('③ is_workday — 골든 근무일 행렬에서 TS isWorkingDay 와 같다(workDates → offDates → 요일)', () => {
  it('골든 행렬의 모든 행: SQL = 기대 = TS', async () => {
    expect(GOLDEN_WORKDAY_CASES.length).toBeGreaterThanOrEqual(10)
    await asService(pool, async (c) => {
      await newProject(c)
      for (const g of GOLDEN_WORKDAY_CASES) {
        await setValues(c, { 'calendar.working_days': g.workingDays })
        await c.query('delete from public.holidays where project_id = $1', [P])
        for (const d of g.off) await c.query(`insert into public.holidays (project_id, date, name, kind) values ($1, $2, '휴무', 'off')`, [P, d])
        for (const d of g.work) await c.query(`insert into public.holidays (project_id, date, name, kind) values ($1, $2, '근무', 'work')`, [P, d])
        const cal = calendarOf({
          timezone: 'UTC', workingDays: g.workingDays as IsoDow[], weekStart: DEFAULT_WEEK_RULES,
          holidays: [...g.off.map((date) => ({ date, kind: 'off' as const })), ...g.work.map((date) => ({ date, kind: 'work' as const }))],
        })
        expect(isWorkingDay(g.date, cal), `TS ${g.name}`).toBe(g.working)
        const { rows } = await c.query<{ w: boolean }>('select public.is_workday($1, $2::date) as w', [P, g.date])
        expect(rows[0].w, `SQL ${g.name}`).toBe(g.working)
      }
    })
  })

  it('근무 요일 키가 없으면 [1..5] — 토·일 false, 월~금 true(기존 판정과 같다)', async () => {
    await asService(pool, async (c) => {
      await newProject(c)
      const { rows } = await c.query<{ d: string; w: boolean }>(
        `select g.d::date::text as d, public.is_workday($1, g.d::date) as w
           from pg_catalog.generate_series('2026-09-28'::date, '2026-10-04'::date, interval '1 day') as g(d) order by 1`, [P])
      expect(rows.map((r) => r.w)).toEqual([true, true, true, true, true, false, false])
    })
  })

  it('근무 요일이 손상이면 22023 CONFIG_INVALID:calendar.working_days — 휴일 행이 있는 날도 먼저 거부한다(fail-closed)', async () => {
    const bad: [string, unknown][] = [
      ['JSON null', null], ['배열이 아니다', '1,2,3'], ['빈 배열', []], ['0', [0, 1]], ['8', [1, 8]],
      ['중복', [1, 1, 2]], ['문자열 원소', ['1']], ['소수', [1.5]],
    ]
    await asService(pool, async (c) => {
      await newProject(c)
      await c.query(`insert into public.holidays (project_id, date, name, kind) values ($1, '2026-10-03', '근무', 'work')`, [P])
      for (const [why, v] of bad) {
        await setValues(c, { 'calendar.working_days': v })
        expect(await pgError(c, 'select public.is_workday($1, $2::date)', [P, '2026-10-03']), why).toMatchObject(INVALID_DAYS)
      }
      expect(await pgError(c, 'select public.is_workday($1, $2::date)', [MISSING, '2026-10-03'])).toMatchObject(ROW_MISSING)
    })
  })

  it('holidays.kind 는 off·work 만, 기본 off — 기존 insert(kind 생략)는 그대로 off 로 들어간다', async () => {
    await asService(pool, async (c) => {
      await newProject(c)
      await c.query(`insert into public.holidays (project_id, date, name) values ($1, '2026-10-09', '한 날')`, [P])
      expect((await c.query('select kind from public.holidays where project_id = $1', [P])).rows).toEqual([{ kind: 'off' }])
      expect(await pgError(c, `insert into public.holidays (project_id, date, name, kind) values ($1, '2026-10-10', 'x', 'half')`, [P]))
        .toMatchObject({ code: '23514', constraint: 'holidays_kind_check' })
      expect(await pgError(c, `insert into public.holidays (project_id, date, name, kind) values ($1, '2026-10-11', 'x', null)`, [P]))
        .toMatchObject({ code: '23502' })
    })
  })
})

describe('③ 실행 권한 — 헬퍼 넷은 누구에게도 EXECUTE 가 없다(호출자는 DEFINER 트리거·settings_ref_check 뿐 — §3.1)', () => {
  const FNS = ['public.week_rules_of(jsonb)', 'public.week_key_from_rules(jsonb, date)', 'public.week_key_of(uuid, date)', 'public.is_workday(uuid, date)']
  it('anon·authenticated 거짓, PUBLIC 항목 없음', async () => {
    const { rows } = await pool.query<{ fn: string; anon: boolean; auth: boolean; pub: boolean }>(
      `select x.fn,
              has_function_privilege('anon', x.fn::regprocedure, 'EXECUTE') as anon,
              has_function_privilege('authenticated', x.fn::regprocedure, 'EXECUTE') as auth,
              exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where p.oid = x.fn::regprocedure and a.grantee = 0) as pub
         from unnest($1::text[]) as x(fn)`, [FNS])
    expect(rows).toEqual(FNS.map((fn) => ({ fn, anon: false, auth: false, pub: false })))
  })
  it('세션이 부르면 42501', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, 'select public.is_workday($1, $2::date)', [F.projects.a, '2026-10-01']))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function is_workday') })
      expect(await pgError(c, 'select public.week_key_of($1, $2::date)', [F.projects.a, '2026-10-01'])).toMatchObject({ code: '42501' })
    })
  })
})

describe('tz 허용 집합 — TS ⊂ PG(D54·E29)', () => {
  it('TS parseTimezone 이 받는 이름은 PG at time zone 이 모두 받는다', async () => {
    const candidates = [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', 'Etc/UTC', ...GOLDEN_TZ_NAMES, 'EST', 'EST5EDT', 'PST8PDT', 'CST6CDT', 'GMT0'])]
    const accepted = [...new Set(candidates.flatMap((n) => { const r = parseTimezone(n); return r.ok ? [r.value] : [] }))]
    expect(accepted).toEqual(expect.arrayContaining(['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Europe/Berlin']))
    expect(accepted.length).toBeGreaterThan(400)
    await asService(pool, async (c) => {
      await c.query(`create function pg_temp.tz_ok(t text) returns boolean language plpgsql as $f$
        begin perform pg_catalog.now() at time zone t; return true; exception when invalid_parameter_value then return false; end $f$`)
      const { rows } = await c.query<{ n: string }>('select u.n from unnest($1::text[]) as u(n) where not pg_temp.tz_ok(u.n) order by 1', [accepted])
      expect(rows, 'PG 가 거부한 이름').toEqual([])
    })
  })

  it('골든 이름(과 TS 가 받는다면 EST)은 같은 instant 를 TS·PG 가 같은 현지 시각으로 바꾼다 — 같은 뜻(R5)', async () => {
    const names = [...GOLDEN_TZ_NAMES, ...(parseTimezone('EST').ok ? ['EST'] : [])]
    const instants = ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z', '2026-03-08T07:30:00Z', '2026-11-01T06:30:00Z']
    await asService(pool, async (c) => {
      for (const n of names) {
        const tz = (parseTimezone(n) as { ok: true; value: string }).value
        for (const at of instants) {
          const { rows } = await c.query<{ s: string }>(
            `select to_char($1::timestamptz at time zone $2, 'YYYY-MM-DD HH24:MI') as s`, [at, tz])
          expect(rows[0].s, `${n} @ ${at}`).toBe(stampIn(tz, at))
        }
      }
    })
  })

  it('IANA 별칭은 고른 이름 그대로 저장되고 PG 의 pg_timezone_names 가 그 이름을 안다(판정 J2 — ICU 의 옛 이름으로 바꾸지 않는다)', async () => {
    const ALIASES = [['Asia/Kolkata', 'Asia/Calcutta'], ['Europe/Kyiv', 'Europe/Kiev']] as const
    for (const [name] of ALIASES) expect(parseTimezone(name), name).toEqual({ ok: true, value: name })
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ name: string; utc_offset: string }>(
        'select name, utc_offset::text as utc_offset from pg_catalog.pg_timezone_names where name = any($1::text[]) order by 1',
        [ALIASES.flat()])
      expect(rows.map((r) => r.name)).toEqual([...ALIASES.flat()].sort())
      // 새 이름과 옛 이름은 같은 tz — 같은 오프셋
      const off = new Map(rows.map((r) => [r.name, r.utc_offset]))
      for (const [name, old] of ALIASES) expect(off.get(name), name).toBe(off.get(old))
    })
  })

  it('TS 는 GOLDEN_TZ_REJECT(오타·오프셋 꼴·빈 값)를 거부하고, 이름 꼴 오타는 PG 도 거부한다', async () => {
    for (const n of GOLDEN_TZ_REJECT) expect(parseTimezone(n).ok, JSON.stringify(n)).toBe(false)
    await asService(pool, async (c) => {
      expect(await pgError(c, `select pg_catalog.now() at time zone 'Asia/Seol'`)).toMatchObject({ code: '22023' })
    })
  })
})

describe('④ 의존성 트리거 — 프로젝트 근무 요일·날짜 예외로 판정한다(is_workday — 개정 §4.2.9 둘째 항목)', () => {
  const PRED = id(0x01)
  const SUCC = id(0x02)
  const DEP = 'insert into public.task_dependencies (project_id, predecessor_id, successor_id) values ($1, $2, $3)'
  const NO_WORKDAY = { code: '23514', message: '계획 기간에 영업일이 없는 작업은 연결할 수 없습니다' }
  async function items(c: PoolClient, pred: [string, string], succ: [string, string]) {
    await c.query(`insert into public.wbs_items (id, project_id, code, name, planned_start, planned_end) values
      ($1, $3, '1', '앞 작업', $4, $5), ($2, $3, '2', '뒤 작업', $6, $7)`, [PRED, SUCC, P, ...pred, ...succ])
  }

  it('[7,1,2,3,4](일~목): 토요일만 걸친 작업은 연결 거부, 일요일만 걸친 작업은 받는다', async () => {
    await asService(pool, async (c) => {
      await newProject(c, { 'calendar.working_days': [7, 1, 2, 3, 4] })
      await items(c, ['2026-10-01', '2026-10-01'], ['2026-10-03', '2026-10-03'])     // 목 → 토
      expect(await pgError(c, DEP, [P, PRED, SUCC])).toMatchObject(NO_WORKDAY)
      await c.query(`update public.wbs_items set planned_start = '2026-10-04', planned_end = '2026-10-04' where id = $1`, [SUCC])  // → 일
      expect(await pgError(c, DEP, [P, PRED, SUCC])).toBeNull()
    })
  })

  it('키 없음([1..5]): 일요일만 걸친 작업은 거부(기존 판정 그대로), work 예외가 있는 토요일은 받는다, off 예외만 걸친 평일은 거부', async () => {
    await asService(pool, async (c) => {
      await newProject(c)
      await items(c, ['2026-10-01', '2026-10-01'], ['2026-10-04', '2026-10-04'])     // 목 → 일
      expect(await pgError(c, DEP, [P, PRED, SUCC])).toMatchObject(NO_WORKDAY)
      await c.query(`insert into public.holidays (project_id, date, name, kind) values ($1, '2026-10-03', '토요 근무', 'work')`, [P])
      await c.query(`update public.wbs_items set planned_start = '2026-10-03', planned_end = '2026-10-03' where id = $1`, [SUCC])
      expect(await pgError(c, DEP, [P, PRED, SUCC])).toBeNull()
      await c.query('delete from public.task_dependencies where project_id = $1', [P])
      await c.query(`insert into public.holidays (project_id, date, name, kind) values ($1, '2026-10-05', '휴무', 'off')`, [P])
      await c.query(`update public.wbs_items set planned_start = '2026-10-05', planned_end = '2026-10-05' where id = $1`, [SUCC])
      expect(await pgError(c, DEP, [P, PRED, SUCC])).toMatchObject(NO_WORKDAY)
    })
  })

  it('guard_dependent_wbs_dates: 연결된 작업의 계획을 비근무일만으로 옮기면 거부, 근무일이 하나라도 있으면 통과', async () => {
    await asService(pool, async (c) => {
      await newProject(c, { 'calendar.working_days': [7, 1, 2, 3, 4] })
      await items(c, ['2026-10-01', '2026-10-01'], ['2026-10-04', '2026-10-05'])
      await c.query(DEP, [P, PRED, SUCC])
      expect(await pgError(c, `update public.wbs_items set planned_start = '2026-10-02', planned_end = '2026-10-03' where id = $1`, [SUCC]))
        .toMatchObject({ code: '23514', message: '의존성이 연결된 작업의 계획 기간에는 영업일이 있어야 합니다' })   // 금·토
      expect(await pgError(c, `update public.wbs_items set planned_start = '2026-10-03', planned_end = '2026-10-04' where id = $1`, [SUCC]))
        .toBeNull()                                                                                                  // 토·일
    })
  })
})
