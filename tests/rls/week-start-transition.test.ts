// NNNN_calendar ⑥⑦ — weekly_reports 주 키 트리거(규칙 밖 키 23514, 설정 행 FOR SHARE 로 설정 RPC 와 직렬화)와 settings_ref_check 의
// calendar.week_start 정확 판정(D53 — 새 규칙에서 키가 바뀌는 문서가 하나라도 있으면 SETTINGS_CODE_IN_USE, unset = 제품 기본값 일요일)·
// calendar.timezone 분기(D54). 스펙 §3.7 A·§7 A. 케이스는 begin…rollback, 두 연결 케이스만 전용 워크스페이스(…aa50)를 커밋했다가 finally 에서
// 프로젝트 → 워크스페이스 순으로 지운다. 부트스트랩 계정·이관 기록 값에 기대지 않는다(H2 ⑤ — 규칙은 케이스가 설정 행에 직접 쓴다).
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { weekKeyOf, type WeekStartRule } from '@/lib/domain/calendar'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const id = (n: number) => `00000000-0000-0000-7e57-0000000019${n.toString(16).padStart(2, '0')}`
const P = id(0x20)                 // 케이스마다 롤백되는 프로젝트(A 워크스페이스)
const AREA = id(0x21)              // P 의 활성 주간 영역(create_weekly_report 가 요구한다)
const W = '00000000-0000-0000-7e57-00000000aa50'   // 두 연결 케이스의 전용 워크스페이스
const PC = id(0x30)                // 두 연결 케이스의 프로젝트
const AREA_C = id(0x31)
const CMD = (n: number) => `00000000-0000-4000-8000-0000000019${(0x40 + n).toString(16)}`   // apply_project_settings 의 명령 id
const MON: WeekStartRule[] = [{ day: 'monday', from: null }]
const CREATE = 'select public.create_weekly_report($1, $2, $3::date, null) as r'
const APPLY = 'select public.apply_project_settings($1, $2, $3, $4::jsonb, $5::text[], $6, 1, $7) as r'
const INVALID_KEY = { code: '23514', message: 'WEEK_KEY_INVALID' }
const IN_USE = { code: '23514', message: 'SETTINGS_CODE_IN_USE:calendar.week_start' }

async function scene(c: PoolClient, rules: WeekStartRule[] | null, p = P, area = AREA, ws = F.ws) {
  await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [p, 'RLS 주 시작 전환', ws])
  await c.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $2, 'weekly_section', 'WK', 'RLS 주간 영역')`, [area, p])
  if (rules) await setRules(c, rules, p)
}
/** 설정 행의 values 에 규칙을 직접 쓴다(RPC 를 거치지 않는다 — 선기록과 같은 꼴, settings_ref_check 가 돌지 않는다) */
async function setRules(c: PoolClient, rules: WeekStartRule[] | null, p = P) {
  await c.query(rules
    ? `update public.project_settings set "values" = "values" || jsonb_build_object('calendar.week_start', $2::jsonb) where project_id = $1`
    : `update public.project_settings set "values" = "values" - 'calendar.week_start' where project_id = $1`,
    rules ? [p, JSON.stringify(rules)] : [p])
}
const create = async (c: PoolClient, week: string, p = P) =>
  (await c.query<{ r: { status: string } }>(CREATE, [F.users.platform, p, week])).rows[0].r
const keysOf = async (c: PoolClient, p = P) =>
  (await c.query<{ w: string }>('select week_start::text as w from public.weekly_reports where project_id = $1 order by 1', [p])).rows.map((r) => r.w)
async function apply(c: PoolClient, args: { set?: Record<string, unknown>; unset?: string[]; cmd: number }, p = P) {
  const rev = (await c.query<{ r: string }>('select revision::text as r from public.project_settings where project_id = $1', [p])).rows[0].r
  return c.query(APPLY, [p, rev, CMD(args.cmd), JSON.stringify(args.set ?? {}), args.unset ?? null, F.users.wsAdmin, 'edit'])
}
async function applyError(c: PoolClient, args: { set?: Record<string, unknown>; unset?: string[]; cmd: number }, p = P) {
  await c.query('savepoint ap')
  try { await apply(c, args, p); await c.query('release savepoint ap'); return null } catch (e) {
    if (!(e instanceof DatabaseError)) throw e
    await c.query('rollback to savepoint ap'); return e
  }
}
const weeksOf = (e: DatabaseError | null) => (e?.detail ? (JSON.parse(e.detail) as { key: string; weeks: string[] }) : null)

describe('⑥ 주 키 트리거 — 규칙 밖 키는 어느 길로도 들어가지 못한다(D8 — RPC·service_role 의 마지막 방어)', () => {
  it('service_role 직접 insert·update: 규칙 밖 23514 WEEK_KEY_INVALID, 규칙 안은 통과, 제목만 바꾸는 update 는 판정하지 않는다', async () => {
    await asService(pool, async (c) => {
      await scene(c, MON)
      expect(await pgError(c, `insert into public.weekly_reports (project_id, week_start) values ($1, '2026-10-06')`, [P])).toMatchObject(INVALID_KEY)
      expect(await pgError(c, `insert into public.weekly_reports (project_id, week_start) values ($1, '2026-10-05')`, [P])).toBeNull()
      expect(await pgError(c, `update public.weekly_reports set week_start = '2026-10-04' where project_id = $1`, [P])).toMatchObject(INVALID_KEY)
      expect(await pgError(c, `update public.weekly_reports set title = '제목' where project_id = $1`, [P])).toBeNull()
      const e = await pgError(c, `insert into public.weekly_reports (project_id, week_start) values ($1, '2026-10-07')`, [P])
      expect(JSON.parse(e!.detail!)).toEqual({ week_start: '2026-10-07', expected: '2026-10-05' })
    })
  })

  it('규칙 키가 없으면 제품 기본값 일요일 — 월요일 키 거부, 일요일 키 통과', async () => {
    await asService(pool, async (c) => {
      await scene(c, null)
      expect(await pgError(c, `insert into public.weekly_reports (project_id, week_start) values ($1, '2026-10-05')`, [P])).toMatchObject(INVALID_KEY)
      expect(await pgError(c, `insert into public.weekly_reports (project_id, week_start) values ($1, '2026-10-04')`, [P])).toBeNull()
    })
  })

  it('create_weekly_report 도 같은 트리거를 지난다 — 규칙 밖 키는 RPC 안에서 WEEK_KEY_INVALID, 아무것도 남지 않는다', async () => {
    await asService(pool, async (c) => {
      await scene(c, MON)
      expect(await pgError(c, CREATE, [F.users.platform, P, '2026-10-06'])).toMatchObject(INVALID_KEY)
      expect(await keysOf(c)).toEqual([])
      expect(await create(c, '2026-10-05')).toMatchObject({ status: 'created' })
    })
  })

  it('세션은 week_start 를 직접 바꿀 수 없다(SP4 D27 — 열 권한) — 트리거 앞에서 42501', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, `update public.weekly_reports set week_start = '2026-09-07' where id = $1`, [F.rows.weeklyReport]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') })
    })
  })

  it('read committed 가 아니면 25001 WEEK_KEY_ISOLATION(repeatable read·serializable — read committed 는 위 케이스들이 통과)', async () => {
    for (const level of ['repeatable read', 'serializable']) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        // 영역은 넣지 않는다 — 다른 표의 트리거가 자기 격리 가드로 먼저 멈추면 이 토큰을 보지 못한다
        await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'RLS 격리', F.ws])
        await setRules(c, MON)
        expect(await pgError(c, `insert into public.weekly_reports (project_id, week_start) values ($1, '2026-10-05')`, [P]), level)
          .toMatchObject({ code: '25001', message: 'WEEK_KEY_ISOLATION' })
      } finally { await c.query('rollback'); c.release() }
    }
  })

  it('설정 행이 없으면 P0001 SETTINGS_ROW_MISSING(행 유지 트리거를 끈 롤백 트랜잭션에서만 만들 수 있다)', async () => {
    await asService(pool, async (c) => {
      await scene(c, MON)
      await c.query('alter table public.project_settings disable trigger project_settings_keep_row')
      await c.query('delete from public.project_settings where project_id = $1', [P])
      expect(await pgError(c, `insert into public.weekly_reports (project_id, week_start) values ($1, '2026-10-05')`, [P]))
        .toMatchObject({ code: 'P0001', message: 'SETTINGS_ROW_MISSING' })
    })
  })
})

describe('키 함수 — 과도기 주 6·8일, 겹침·틈 0, UNIQUE 위반 0, 이월 원본 = 직전 키', () => {
  const MON_TO_SUN: WeekStartRule[] = [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-09-27' }]
  const SUN_TO_MON: WeekStartRule[] = [{ day: 'sunday', from: null }, { day: 'monday', from: '2026-09-28' }]
  const periods = async (c: PoolClient, rules: WeekStartRule[], from: string, to: string) =>
    (await c.query<{ k: string; n: number }>(
      `select public.week_key_from_rules($1::jsonb, g.d::date)::text as k, count(*)::int as n
         from pg_catalog.generate_series($2::date, $3::date, interval '1 day') as g(d) group by 1 order by 1`,
      [JSON.stringify(rules), from, to])).rows

  it('월→일(E=09-27): [09-21, 09-27) 6일, 앞뒤는 7일 — 일→월(E=09-28): [09-20, 09-28) 8일', async () => {
    await asService(pool, async (c) => {
      expect(await periods(c, MON_TO_SUN, '2026-09-14', '2026-10-10'))
        .toEqual([{ k: '2026-09-14', n: 7 }, { k: '2026-09-21', n: 6 }, { k: '2026-09-27', n: 7 }, { k: '2026-10-04', n: 7 }])
      expect(await periods(c, SUN_TO_MON, '2026-09-13', '2026-10-11'))
        .toEqual([{ k: '2026-09-13', n: 7 }, { k: '2026-09-20', n: 8 }, { k: '2026-09-28', n: 7 }, { k: '2026-10-05', n: 7 }])
    })
  })

  it('월→일 프로젝트에 키마다 문서를 만들면 모두 created(UNIQUE 위반 0), 과도기 밖 날짜는 거부, 이월 원본은 직전 키 문서', async () => {
    await asService(pool, async (c) => {
      await scene(c, MON_TO_SUN)
      for (const w of ['2026-09-14', '2026-09-21', '2026-09-27', '2026-10-04']) expect(await create(c, w), w).toMatchObject({ status: 'created' })
      for (const w of ['2026-09-20', '2026-09-28', '2026-09-22']) expect(await pgError(c, CREATE, [F.users.platform, P, w]), w).toMatchObject(INVALID_KEY)
      expect(await keysOf(c)).toEqual(['2026-09-14', '2026-09-21', '2026-09-27', '2026-10-04'])
      // findCarryOverSource 의 규칙(해당 주 이전 가장 최근 키) — 과도기 다음 주의 원본은 과도기 키다
      const { rows } = await c.query<{ src: string }>(
        `select max(week_start)::text as src from public.weekly_reports where project_id = $1 and week_start < '2026-09-27'`, [P])
      expect(rows[0].src).toBe('2026-09-21')
      expect(weekKeyOf(MON_TO_SUN, '2026-09-26')).toBe('2026-09-21')
    })
  })
})

describe('⑦ settings_ref_check(calendar.week_start) — 정확 판정(D53)', () => {
  it('새 규칙에서도 키가 그대로인 문서뿐이면 저장한다 — 이월 전 월요일 문서 둘 + 10-04 부터 일요일', async () => {
    await asService(pool, async (c) => {
      await scene(c, MON)
      await create(c, '2026-09-21'); await create(c, '2026-09-28')
      const next = [...MON, { day: 'sunday', from: '2026-10-04' }]
      expect((await apply(c, { set: { 'calendar.week_start': next }, cmd: 1 })).rows[0].r).toMatchObject({ status: 'applied' })
      expect(await create(c, '2026-10-04')).toMatchObject({ status: 'created' })      // 새 규칙의 첫 일요일 키
    })
  })

  it('E 이후 날짜를 옛 규칙 키로 만든 문서가 있으면 SETTINGS_CODE_IN_USE — detail 에 그 주차, 저장 안 됨', async () => {
    await asService(pool, async (c) => {
      await scene(c, MON)
      await create(c, '2026-09-28'); await create(c, '2026-10-05')
      const e = await applyError(c, { set: { 'calendar.week_start': [...MON, { day: 'sunday', from: '2026-10-04' }] }, cmd: 2 })
      expect(e).toMatchObject(IN_USE)
      expect(weeksOf(e)).toEqual({ key: 'calendar.week_start', weeks: ['2026-10-05'] })
      expect((await c.query(`select "values" -> 'calendar.week_start' as r from public.project_settings where project_id = $1`, [P])).rows[0].r)
        .toEqual(MON)
    })
  })

  it('detail 의 주차는 오름차순 최대 20개', async () => {
    await asService(pool, async (c) => {
      await scene(c, MON)
      for (let i = 0; i < 25; i++) {
        const d = new Date(Date.UTC(2027, 0, 4 + 7 * i)).toISOString().slice(0, 10)
        await c.query('insert into public.weekly_reports (project_id, week_start) values ($1, $2)', [P, d])
      }
      const e = await applyError(c, { unset: ['calendar.week_start'], cmd: 3 })
      expect(e).toMatchObject(IN_USE)
      const w = weeksOf(e)!.weeks
      expect(w).toHaveLength(20)
      expect(w[0]).toBe('2027-01-04')
      expect([...w].sort()).toEqual(w)
    })
  })

  it('미적용 전환을 더 늦은 날로 교체 — 사이에 일요일 키 문서가 있으면 거부, 없으면 저장', async () => {
    await asService(pool, async (c) => {
      const e1: WeekStartRule[] = [...MON, { day: 'sunday', from: '2026-10-04' }]
      const e2: WeekStartRule[] = [...MON, { day: 'sunday', from: '2026-10-18' }]
      await scene(c, e1)
      await create(c, '2026-09-28'); await create(c, '2026-10-04'); await create(c, '2026-10-11')
      const e = await applyError(c, { set: { 'calendar.week_start': e2 }, cmd: 4 })
      expect(e).toMatchObject(IN_USE)
      expect(weeksOf(e)!.weeks).toEqual(['2026-10-04', '2026-10-11'])
      // 사이 문서를 지우면(과도기 키 09-28 만 남는다) 같은 교체가 통과한다 — 09-28 은 새 규칙에서도 월요일 키다
      await c.query(`delete from public.weekly_reports where project_id = $1 and week_start > '2026-09-28'`, [P])
      expect((await apply(c, { set: { 'calendar.week_start': e2 }, cmd: 5 })).rows[0].r).toMatchObject({ status: 'applied' })
    })
  })

  it('unset = 제품 기본값 일요일 — 월요일 문서가 있으면 거부, 문서가 없으면 키가 지워진다', async () => {
    await asService(pool, async (c) => {
      await scene(c, MON)
      await create(c, '2026-09-28')
      const e = await applyError(c, { unset: ['calendar.week_start'], cmd: 6 })
      expect(e).toMatchObject(IN_USE)
      expect(weeksOf(e)!.weeks).toEqual(['2026-09-28'])
      await c.query('delete from public.weekly_reports where project_id = $1', [P])
      expect((await apply(c, { unset: ['calendar.week_start'], cmd: 7 })).rows[0].r).toMatchObject({ status: 'applied' })
      expect((await c.query(`select "values" ? 'calendar.week_start' as has from public.project_settings where project_id = $1`, [P])).rows)
        .toEqual([{ has: false }])
    })
  })

  it('저장 값의 모양이 틀리면 22023 CONFIG_INVALID:calendar.week_start(TS 를 우회한 호출의 마지막 방어)', async () => {
    await asService(pool, async (c) => {
      await scene(c, MON)
      expect(await applyError(c, { set: { 'calendar.week_start': 'sunday' }, cmd: 8 }))
        .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:calendar.week_start' })
    })
  })
})

describe('⑦ settings_ref_check(calendar.timezone) — PG 가 모르는 이름은 저장 거부(D54)', () => {
  it('오타·숫자·빈 문자열 → 22023 CONFIG_INVALID:calendar.timezone, IANA 이름은 저장, unset 은 늘 통과', async () => {
    await asService(pool, async (c) => {
      await scene(c, null)
      // NST·GMT0·EST — '/' 없는 이름은 닫힌 허용 목록만(L1 — PG 가 약어 표로 다른 오프셋을 읽는다)
      for (const [i, bad] of (['Asia/Seol', 7, '', 'Mars/Olympus', 'NST', 'GMT0', 'EST', 'utc'] as unknown[]).entries()) {
        expect(await applyError(c, { set: { 'calendar.timezone': bad }, cmd: 10 + i }), JSON.stringify(bad))
          .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:calendar.timezone' })
      }
      expect((await apply(c, { set: { 'calendar.timezone': 'America/Los_Angeles' }, cmd: 20 })).rows[0].r).toMatchObject({ status: 'applied' })
      expect((await apply(c, { set: { 'calendar.timezone': 'EST5EDT' }, cmd: 22 })).rows[0].r).toMatchObject({ status: 'applied' })
      expect((await apply(c, { unset: ['calendar.timezone'], cmd: 21 })).rows[0].r).toMatchObject({ status: 'applied' })
    })
  })
})

describe('경합 — 전환 저장 대 옛 규칙의 E 이후 키 문서(독립 연결 2개, §2.4.1·W8)', () => {
  const E = '2030-01-06'                 // 일요일
  const LATE_MONDAY = '2030-01-07'       // 옛 규칙(월요일)으로는 유효, 새 규칙으로는 E 뒤라 일요일 키(01-06)여야 한다
  const NEXT: WeekStartRule[] = [...MON, { day: 'sunday', from: E }]
  async function prepare() {
    await cleanup()
    await pool.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-cal-race', 'RLS 주 시작 경합')`, [W])
    await pool.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [PC, 'RLS 경합', W])
    await pool.query(`insert into public.project_areas (id, project_id, kind, code, name) values ($1, $2, 'weekly_section', 'WK', '경합 영역')`, [AREA_C, PC])
    await pool.query(`update public.project_settings set "values" = "values" || jsonb_build_object('calendar.week_start', $2::jsonb) where project_id = $1`,
      [PC, JSON.stringify(MON)])
  }
  async function cleanup() {
    await pool.query('delete from public.projects where workspace_id = $1', [W])
    await pool.query('delete from public.workspaces where id = $1', [W])
  }
  const settle = (q: Promise<unknown>) => q.then((v) => v, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e })
  async function waitBlocked(watcher: PoolClient, pid: number) {
    for (let i = 0; i < 250; i++) {
      if ((await watcher.query<{ n: number }>('select cardinality(pg_blocking_pids($1)) as n', [pid])).rows[0].n > 0) return true
      await new Promise((r) => setTimeout(r, 20))
    }
    return false
  }
  async function state(c: PoolClient) {
    const s = (await c.query(`select "values" -> 'calendar.week_start' as r from public.project_settings where project_id = $1`, [PC])).rows[0].r
    const docs = (await c.query<{ w: string; ok: boolean }>(
      `select week_start::text as w, week_start = public.week_key_of(project_id, week_start) as ok
         from public.weekly_reports where project_id = $1 order by 1`, [PC])).rows
    return { rules: s, docs }
  }

  for (const order of ['설정 먼저', '문서 먼저'] as const) {
    it(`${order} — 정확히 하나만 커밋되고, 남은 문서는 모두 저장된 규칙의 키다(겹침 0)`, async () => {
      let s1: PoolClient | undefined
      let s2: PoolClient | undefined
      try {
        await prepare()
        s1 = await pool.connect()      // 설정 저장
        s2 = await pool.connect()      // 주간 생성
        const rev = (await s1.query<{ r: string }>('select revision::text as r from public.project_settings where project_id = $1', [PC])).rows[0].r
        const pid1 = (await s1.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
        const pid2 = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
        await s1.query('begin'); await s2.query('begin')
        const saveArgs = [PC, rev, CMD(30), JSON.stringify({ 'calendar.week_start': NEXT }), null, F.users.wsAdmin, 'edit']
        let save: unknown
        let doc: unknown
        if (order === '설정 먼저') {
          save = await settle(s1.query(APPLY, saveArgs))
          const pending = settle(s2.query(CREATE, [F.users.platform, PC, LATE_MONDAY]))
          expect(await waitBlocked(s1, pid2), '문서 생성이 설정 행 잠금을 기다린다').toBe(true)
          await s1.query('commit')
          doc = await pending
          await s2.query(doc instanceof DatabaseError ? 'rollback' : 'commit')
          expect(save).not.toBeInstanceOf(DatabaseError)
          expect(doc).toMatchObject(INVALID_KEY)
        } else {
          doc = await settle(s2.query(CREATE, [F.users.platform, PC, LATE_MONDAY]))
          const pending = settle(s1.query(APPLY, saveArgs))
          expect(await waitBlocked(s2, pid1), '설정 저장이 문서 쪽 FOR SHARE 를 기다린다').toBe(true)
          await s2.query('commit')
          save = await pending
          await s1.query(save instanceof DatabaseError ? 'rollback' : 'commit')
          expect(doc).not.toBeInstanceOf(DatabaseError)
          expect(save).toMatchObject(IN_USE)
        }
        const st = await state(s1)
        expect(st.docs.every((d) => d.ok), JSON.stringify(st)).toBe(true)
        expect(st).toEqual(order === '설정 먼저'
          ? { rules: NEXT, docs: [] }
          : { rules: MON, docs: [{ w: LATE_MONDAY, ok: true }] })
      } finally {
        await s1?.query('rollback').catch(() => undefined)
        await s2?.query('rollback').catch(() => undefined)
        s1?.release(); s2?.release()
        await cleanup()
      }
      expect((await pool.query(
        'select (select count(*) from public.projects where workspace_id = $1)::int + (select count(*) from public.workspaces where id = $1)::int as n',
        [W])).rows).toEqual([{ n: 0 }])
    })
  }
})

describe('⑪-a 사후검사 — 마이그레이션의 카탈로그 블록을 그대로 돌린다(민감도)', () => {
  // 번호를 쓰지 않는다 — 접미로 찾는다(D2). 블록은 읽기만 하므로 적용 뒤에 다시 돌려도 된다
  const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
  const files = readdirSync(dir).filter((f) => f.endsWith('_calendar.sql'))
  const blocks = () => (readFileSync(dir + files[0], 'utf8').match(/^do \$\$\n[\s\S]*?^end \$\$;$/gm) ?? [])
    .filter((b) => b.includes('CALENDAR_POSTCHECK') && b.includes('⑪-a 카탈로그 블록'))
  const POSTCHECK = { message: expect.stringContaining('CALENDAR_POSTCHECK') }
  // SP9(0039): 옛 가져오기 함수의 authenticated 실행권이 회수되었으므로(0039), 블록 안 옛 authenticated 실행권 검사 줄을 제외하고 사후검사를 실행한다 (h2-postchecks.test.ts 선례)
  const postcheckBlock = () => blocks()[0].replace(
    "or not has_function_privilege('authenticated', p.oid, 'EXECUTE')\n      or position('where public.holidays.kind",
    "or position('where public.holidays.kind",
  )
  const runAfter = (mutate: string[]) => asService(pool, async (c) => {
    for (const m of mutate) await c.query(m)
    return pgError(c, postcheckBlock())
  })

  it('파일 하나·블록 하나 — 지금 카탈로그에서는 통과한다', async () => {
    expect(files).toHaveLength(1)
    expect(blocks()).toHaveLength(1)
    expect(await runAfter([])).toBeNull()
  })

  it('트리거를 끄거나 헬퍼에 실행권을 주면 멈춘다', async () => {
    expect(await runAfter(['alter table public.weekly_reports disable trigger weekly_reports_week_key_guard'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter table public.task_dependencies disable trigger trg_validate_task_dependency'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['grant execute on function public.week_key_of(uuid, date) to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['grant execute on function public.is_workday(uuid, date) to public'])).toMatchObject(POSTCHECK)
  })

  it('사용현황 RPC 를 anon 에 열거나 DEFINER 로 바꾸거나 authenticated 실행권을 걷으면 멈춘다', async () => {
    expect(await runAfter(['grant execute on function public.usage_summary(date, date, date, text) to anon'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter function public.usage_summary(date, date, date, text) security definer'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['revoke execute on function public.usage_daily_actives(date, date, text) from authenticated'])).toMatchObject(POSTCHECK)
  })

  it('settings_ref_check 를 골격으로 되돌리거나 옛 가져오기 함수가 DEFINER 로 바뀌면 멈춘다', async () => {
    expect(await runAfter([`create or replace function public.settings_ref_check(p_project_id uuid, p_key text, p_old jsonb, p_new jsonb)
      returns void language plpgsql set search_path to '' as $f$ begin return; end $f$`])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter function public.import_wbs(uuid, jsonb, jsonb) security definer'])).toMatchObject(POSTCHECK)
  })
})

describe('마이그레이션 블록을 그대로 다시 돌린다 — ① 사전검사(키 있는 프로젝트, L2)·⑩ E 계산(오늘이 일요일 갈래)·⑩ 알림(L6)', () => {
  // 번호를 쓰지 않는다 — 접미로 찾는다(D2). 블록은 표를 바꾸지 않는다(① 은 읽기, E 계산은 pg_temp 함수, 알림은 NOTICE 만)
  const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
  const text = () => readFileSync(dir + readdirSync(dir).filter((f) => f.endsWith('_calendar.sql'))[0], 'utf8')
  const doBlock = (needle: string) => {
    const found = (text().match(/^do \$\$\n[\s\S]*?^end \$\$;$/gm) ?? []).filter((b) => b.includes(needle))
    expect(found, needle).toHaveLength(1)
    return found[0]
  }
  const eBlock = () => {
    const m = text().match(/-- ⑩ E 계산 블록 시작\n([\s\S]*?)-- ⑩ E 계산 블록 끝/)
    expect(m).not.toBeNull()
    return m![1]
  }

  it('① 키가 있는 프로젝트도 마지막 규칙 밖의 주 키를 조치 문구와 함께 막는다 — 롤백 기간에 E 뒤에 만든 월요일 문서(L2)', async () => {
    const block = doBlock('CALENDAR_PRECHECK')
    await asService(pool, async (c) => {
      await scene(c, null)
      expect(await pgError(c, block), '지금 데이터는 통과').toBeNull()
      // 롤백 상태 흉내 — 규칙 [{monday},{sunday@10-11}] 이 남았고 트리거가 없는 동안 옛 코드가 E 뒤에 월요일 키를 만들었다
      await c.query('alter table public.weekly_reports disable trigger weekly_reports_week_key_guard')
      await setRules(c, [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-11' }])
      await c.query('insert into public.weekly_reports (project_id, week_start) values ($1, $2), ($1, $3)', [P, '2026-10-05', '2026-10-12'])
      const e = await pgError(c, block)
      expect(e).toMatchObject({ code: '23514', message: expect.stringContaining('CALENDAR_PRECHECK') })
      expect(e?.message).toContain('2026-10-12')
      expect(e?.message).not.toContain('2026-10-05')                       // 과도기 키(Kp)는 마지막 원소 앞 — 걸지 않는다
      expect(e?.message).toContain('calendar.week_start 키를 지운')          // 조치
    })
  })

  it('⑩ E 계산 — 오늘이 일요일이면 다음 주 일요일, 그 밖에는 이번 주 일요일, 미래 문서가 있으면 그 뒤(사용자 결정 #2)', async () => {
    await asService(pool, async (c) => {
      await c.query(eBlock())
      const e = async (today: string, maxWeek: string | null) =>
        (await c.query<{ e: string }>('select pg_temp.calendar_migrate_e($1::date, $2::date)::text as e', [today, maxWeek])).rows[0].e
      expect(await e('2026-10-04', null)).toBe('2026-10-11')              // 일 — K = 09-28, K+6 = 10-04 ≤ T → K+13
      expect(await e('2026-10-04', '2026-09-28')).toBe('2026-10-11')
      expect(await e('2026-10-05', null)).toBe('2026-10-11')              // 월
      expect(await e('2026-10-10', '2026-10-05')).toBe('2026-10-11')      // 토 — 이번 주 문서는 E 앞
      expect(await e('2026-10-07', '2026-10-12')).toBe('2026-10-18')      // 미래 문서(10-12) ≥ E → max + 6
      expect(await e('2026-10-07', '2026-12-14')).toBe('2026-12-20')
    })
  })

  it('⑩ 알림 — 이 적용이 쓴 규칙의 E 가 오늘 + 8주를 넘으면 CALENDAR_MIGRATE NOTICE(동작은 바꾸지 않는다, L6)', async () => {
    const block = doBlock('CALENDAR_MIGRATE')
    await asService(pool, async (c) => {
      await scene(c, null)
      await c.query(`update public.project_settings set "values" = "values" || '{"calendar.timezone": "UTC"}'::jsonb where project_id = $1`, [P])
      const today = (await c.query<{ t: string }>(`select (now() at time zone 'UTC')::date::text as t`)).rows[0].t
      const hist = (n: number, from: string) => c.query(
        `insert into public.project_settings_history (project_id, revision, key, old_value, new_value, source, command_id)
         values ($1, $2, 'calendar.week_start', null, $3::jsonb, 'migration', gen_random_uuid())`,
        [P, 900 + n, JSON.stringify([{ day: 'monday', from: null }, { day: 'sunday', from }])])
      const notices: string[] = []
      const on = (m: { message?: string }) => { if (m.message?.includes('CALENDAR_MIGRATE')) notices.push(m.message) }
      c.on('notice', on)
      try {
        const sundayAfter = async (days: number) =>
          (await c.query<{ d: string }>(`select ($1::date + $2::int + (7 - extract(isodow from $1::date + $2::int)::int))::text as d`, [today, days])).rows[0].d
        await hist(1, await sundayAfter(14))
        expect(await pgError(c, block)).toBeNull()
        expect(notices).toEqual([])
        await hist(2, await sundayAfter(70))
        expect(await pgError(c, block)).toBeNull()
        expect(notices).toHaveLength(1)
        expect(notices[0]).toContain(P)
      } finally { c.off('notice', on) }
    })
  })
})
