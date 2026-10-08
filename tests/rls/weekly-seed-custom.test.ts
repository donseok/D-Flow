// *_weekly_seed_custom — 주간 문서 생성 RPC 가 시드의 사용자 정의 필드 값을 행과 같은 트랜잭션에 싣는다(개정 스펙 §4.3.3, SP4 E28).
// 예전엔 액션이 RPC 뒤에 행마다 따로 UPDATE 했다 — 중간에 실패하면 이월 값 없는 문서가 남았다. 값의 판정은 행 트리거
// (enforce_custom_fields) 몫이고, 거부하면 문서도 만들어지지 않는다. 케이스마다 begin…rollback 이다(asService·asUser).
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'
import golden from '../fixtures/parity/custom-fields-cases.json'
import type { FieldDef } from '@/lib/domain/customFields'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

/** 마이그레이션은 번호가 아니라 접미로 찾는다(CLAUDE.md '데이터') */
function raw(dir: string, suffix: string): string {
  const base = fileURLToPath(new URL(`../../${dir}/`, import.meta.url))
  const hits = readdirSync(base).filter((f) => f.endsWith(suffix))
  if (hits.length !== 1) throw new Error(`${dir}/*${suffix} 가 ${hits.length}개다`)
  return readFileSync(`${base}${hits[0]}`, 'utf8')
}
/** 파일의 최상위 begin;/commit; 두 줄만 걷는다(함수 본문·do 블록의 begin 은 세미콜론이 없다) — 바깥 트랜잭션을 커밋하지 않게 */
const inTx = (sql: string) => sql.replace(/^begin;[ \t]*$/m, '').replace(/^commit;[ \t]*$/m, '')
const MIGRATION_RAW = raw('supabase/migrations', '_weekly_seed_custom.sql')
const ROLLBACK_RAW = raw('supabase/rollbacks', '_weekly_seed_custom_rollback.sql')

const P = F.projects.a
/** 픽스처(fixture-ws.sql)의 c1 주간 영역 RLSA — 활성 */
const AREA = '00000000-0000-0000-7e57-00000000110c'
/** 이 파일의 고정 id — …1c40~…1c4f */
const id = (n: number) => `00000000-0000-0000-7e57-000000001c${n.toString(16).padStart(2, '0')}`
const WEEK = '2026-09-07'   // c1 은 월요일 주 시작(fixture-ws.sql)
const CREATE = 'select public.create_weekly_report($1, $2, $3::date, $4::jsonb) as r'
const SIG = 'public.create_weekly_report(uuid, uuid, date, jsonb)'

const defs = golden.defs as Record<string, FieldDef>
/** 이월 텍스트 'keep', 필수 불리언 'done'(기본 false), 관리자 전용 숫자 'score', 비활성 텍스트 'old' */
const FIELDS = [
  { ...defs.text, key: 'keep', sort: 0, carry_over: true },
  { ...defs.boolean, key: 'done', required: true, default: false, sort: 1, carry_over: false },
  { ...defs.number, key: 'score', editable_by: 'admin', sort: 2, carry_over: true },
  { ...defs.text, key: 'old', active: false, sort: 3, carry_over: false },
]
const define = async (c: PoolClient, fields: unknown[] = FIELDS) => {
  const r = await c.query(`update public.project_settings set "values" = "values" || jsonb_build_object('fields.weekly_row', $2::jsonb) where project_id = $1`,
    [P, JSON.stringify(fields)])
  expect(r.rowCount).toBe(1)
}
const seedRow = (areaId: string, o: Record<string, unknown> = {}) =>
  ({ area_id: areaId, this_content: '', this_issue: '', next_content: '', next_issue: '', ...o })
const create = async (c: PoolClient, seed: unknown, week = WEEK) =>
  (await c.query<{ r: { status: string; report_id: string; rows: number } }>(CREATE, [F.users.member, P, week, seed === null ? null : JSON.stringify(seed)])).rows[0].r
const createError = (c: PoolClient, seed: unknown) => pgError(c, CREATE, [F.users.member, P, WEEK, JSON.stringify(seed)])
const rowsOf = async (c: PoolClient, reportId: string) =>
  (await c.query<{ area_id: string; this_content: string; custom: unknown }>(
    'select area_id::text, this_content, custom from public.weekly_report_rows where report_id = $1 order by area_id', [reportId])).rows
const docCount = async (c: PoolClient) =>
  (await c.query<{ n: number }>('select count(*)::int as n from public.weekly_reports where project_id = $1 and week_start = $2::date', [P, WEEK])).rows[0].n

describe('create_weekly_report — 시드의 custom 을 같은 트랜잭션에 쓴다', () => {
  it('시드의 custom 이 그 행에 실리고, 빠진 필수 키는 트리거가 기본값으로 채운다', async () => {
    await asService(pool, async (c) => {
      await define(c)
      const r = await create(c, [seedRow(AREA, { this_content: '이월', custom: { keep: '유지값', score: 0 } })])
      expect(r).toMatchObject({ status: 'created', rows: 1 })
      expect(await rowsOf(c, r.report_id)).toEqual([{ area_id: AREA, this_content: '이월', custom: { keep: '유지값', score: 0, done: false } }])
    })
  })

  it('custom 이 없는 시드·시드 없음(null)은 기본값만 — 정의가 없는 프로젝트는 빈 객체다', async () => {
    await asService(pool, async (c) => {
      const plain = await create(c, [seedRow(AREA)], '2026-09-14')
      expect((await rowsOf(c, plain.report_id)).map((r) => r.custom)).toEqual([{}])
      await define(c)
      const seeded = await create(c, [seedRow(AREA, { this_content: 'x' })])
      expect((await rowsOf(c, seeded.report_id)).map((r) => r.custom)).toEqual([{ done: false }])
      const empty = await create(c, null, '2026-09-21')
      expect((await rowsOf(c, empty.report_id)).map((r) => r.custom)).toEqual([{ done: false }])
    })
  })

  it('관리자 전용 필드의 이월 값도 실린다 — JWT 없는 service 경로이고 RPC 가 행위자 등급을 판정했다', async () => {
    await asService(pool, async (c) => {
      await define(c)
      const r = await create(c, [seedRow(AREA, { custom: { score: 7 } })])
      expect((await rowsOf(c, r.report_id))[0].custom).toEqual({ score: 7, done: false })
    })
  })

  it.each([
    ['유형 위반', { keep: 12 }, /^CUSTOM_FIELD_INVALID:keep:/],
    ['모르는 키', { ghost: 'x' }, /^CUSTOM_FIELD_UNKNOWN:ghost$/],
    ['비활성 필드의 새 값', { old: '옛값' }, /^CUSTOM_FIELD_INACTIVE:old$/],
    ['JSON null 값', { keep: null }, /^CUSTOM_FIELD_NULL:keep$/],
  ] as const)('행 트리거가 거부하면(%s) 문서도 만들어지지 않는다 — 이월 값 없는 문서가 남지 않는다', async (_why, custom, message) => {
    await asService(pool, async (c) => {
      await define(c)
      expect(await createError(c, [seedRow(AREA, { this_content: '이월', custom })])).toMatchObject({ code: '23514', message: expect.stringMatching(message) })
      expect(await docCount(c)).toBe(0)
      expect((await c.query(`select 1 from public.weekly_report_rows where project_id = $1 and this_content = '이월'`, [P])).rowCount).toBe(0)
    })
  })

  it('활성 영역이 여럿일 때 한 행만 거부돼도 전부 되돌린다(부분 적용 0)', async () => {
    await asService(pool, async (c) => {
      await define(c)
      await c.query(`insert into public.project_areas (id, project_id, kind, code, name, sort_order) values ($1, $2, 'weekly_section', 'SEED2', '둘째 영역', 9)`, [id(0x40), P])
      expect(await createError(c, [seedRow(AREA, { custom: { keep: '정상' } }), seedRow(id(0x40), { custom: { keep: 12 } })]))
        .toMatchObject({ code: '23514', message: expect.stringMatching(/^CUSTOM_FIELD_INVALID:keep:/) })
      expect(await docCount(c)).toBe(0)
      const ok = await create(c, [seedRow(AREA, { custom: { keep: '정상' } }), seedRow(id(0x40), { custom: { keep: '둘째' } })])
      expect((await rowsOf(c, ok.report_id)).map((r) => r.custom)).toEqual([{ keep: '정상', done: false }, { keep: '둘째', done: false }])
    })
  })

  it('시드에만 있는 비활성 영역의 내용 있는 행도 custom 을 같이 싣는다 — 내용이 없으면 행을 만들지 않는다(종전 규칙)', async () => {
    await asService(pool, async (c) => {
      await define(c)
      await c.query(`insert into public.project_areas (id, project_id, kind, code, name, sort_order, active) values
        ($1, $3, 'weekly_section', 'OFF1', '끈 영역 1', 8, false), ($2, $3, 'weekly_section', 'OFF2', '끈 영역 2', 9, false)`, [id(0x41), id(0x42), P])
      const r = await create(c, [
        seedRow(id(0x41), { this_content: '대기 내용', custom: { keep: '끈 영역 값' } }),
        seedRow(id(0x42), { custom: { keep: '내용 없는 행' } }),
      ])
      expect(r).toMatchObject({ status: 'created', rows: 2 })   // 활성 RLSA 1 + 내용 있는 비활성 1
      const rows = await rowsOf(c, r.report_id)
      expect(rows.find((x) => x.area_id === id(0x41))?.custom).toEqual({ keep: '끈 영역 값', done: false })
      expect(rows.some((x) => x.area_id === id(0x42))).toBe(false)
    })
  })

  it('시드 모양 — custom 은 선택이지만 있으면 객체여야 한다(22023 WEEKLY_SEED_INVALID). 그 밖의 시드 검증은 그대로다', async () => {
    await asService(pool, async (c) => {
      for (const custom of [null, [], 'x', 7, true]) {
        expect(await createError(c, [seedRow(AREA, { custom })]), JSON.stringify(custom)).toMatchObject({ code: '22023', message: 'WEEKLY_SEED_INVALID' })
      }
      expect(await createError(c, [{ ...seedRow(AREA, { custom: {} }), area_id: 'not-a-uuid' }])).toMatchObject({ code: '22023', message: 'WEEKLY_SEED_INVALID' })
      expect(await createError(c, [seedRow(AREA, { custom: {} }), seedRow(AREA)])).toMatchObject({ code: '22023', message: 'WEEKLY_SEED_INVALID' })
      expect(await docCount(c)).toBe(0)
      expect(await create(c, [seedRow(AREA, { custom: {} })])).toMatchObject({ status: 'created', rows: 1 })
    })
  })

  it('행위자 등급 재판정·같은 주 exists 는 그대로다 — 권한 없는 행위자의 시드 custom 은 쓰이지 않는다', async () => {
    await asService(pool, async (c) => {
      await define(c)
      const seed = JSON.stringify([seedRow(AREA, { custom: { keep: '몰래' } })])
      expect(await pgError(c, CREATE, [F.users.dual, P, WEEK, seed])).toMatchObject({ code: '42501', message: 'WEEKLY_FORBIDDEN' })
      expect(await docCount(c)).toBe(0)
      const first = await create(c, [seedRow(AREA, { custom: { keep: '처음' } })])
      expect((await c.query<{ r: unknown }>(CREATE, [F.users.member, P, WEEK, seed])).rows[0].r).toEqual({ status: 'exists', report_id: first.report_id })
      expect((await rowsOf(c, first.report_id))[0].custom).toEqual({ keep: '처음', done: false })
    })
  })

  it('함수 설정·실행권은 0013 그대로다 — DEFINER·search_path·lock_timeout, service_role 만 실행', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ secdef: boolean; config: string[]; anon: boolean; authed: boolean; service: boolean }>(
        `select p.prosecdef as secdef, p.proconfig as config,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as service
           from pg_proc p where p.oid = $1::regprocedure`, [SIG])
      expect(rows).toEqual([{ secdef: true, config: ['search_path=""', 'lock_timeout=15s'], anon: false, authed: false, service: true }])
    })
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, CREATE, [F.users.member, P, WEEK, null])).toMatchObject({ code: '42501' })
    })
  })
})

describe('*_weekly_seed_custom — 파일·롤백 왕복', () => {
  it('두 파일은 최상위 begin;/commit; 을 한 번씩 가진다 — 걷어 낸 본문에는 commit 이 없다', () => {
    for (const [name, sql] of [['migration', MIGRATION_RAW], ['rollback', ROLLBACK_RAW]] as const) {
      expect(sql.match(/^begin;[ \t]*$/gm), name).toHaveLength(1)
      expect(sql.match(/^commit;[ \t]*$/gm), name).toHaveLength(1)
      expect(inTx(sql), name).not.toMatch(/^commit;/m)
    }
  })

  it('롤백하면 0013 의 정의(시드의 custom 을 쓰지 않는다 — 문서는 만들어진다), 다시 올리면 custom 을 쓴다. 실행권은 왕복 내내 service_role 전용', async () => {
    await asService(pool, async (c) => {
      await define(c)
      const seed = (week: string) => create(c, [seedRow(AREA, { this_content: '이월', custom: { keep: '유지값' } })], week)
      const priv = async () => (await c.query<{ authed: boolean; service: boolean }>(
        `select has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as authed, has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as service`, [SIG])).rows[0]

      await c.query(inTx(ROLLBACK_RAW))
      const old = await seed('2026-09-07')
      expect(await rowsOf(c, old.report_id)).toEqual([{ area_id: AREA, this_content: '이월', custom: { done: false } }])
      expect(await priv()).toEqual({ authed: false, service: true })

      await c.query(inTx(MIGRATION_RAW))   // 사후 검증(do 블록)까지 통과해야 한다
      const now = await seed('2026-09-14')
      expect(await rowsOf(c, now.report_id)).toEqual([{ area_id: AREA, this_content: '이월', custom: { keep: '유지값', done: false } }])
      expect(await priv()).toEqual({ authed: false, service: true })
    })
  })
})
