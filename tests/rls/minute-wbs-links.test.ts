// 회의록 → WBS 등록(*_minute_wbs_links — 0061).
// wbs_item_links — issue_links 의 쌍둥이(작업 ↔ 회의록 문단). create_wbs_items_from_minute — service_role 전용 DEFINER, N 줄 = 트랜잭션 1개.
// ① 등록: 작업·원문 연결·변경 이력('created')이 함께 생기고 반환은 줄 번호·작업 id·코드다. 같은 부모로 가는 줄은 차례로 맨 뒤에 붙고,
//    말단이던 부모의 직접 실적%는 확인(confirm_parent_leaf)이 있을 때만 지운다(이력 1행).
// ② 거부: 등급(없는 프로젝트 포함)·격리 수준·회의록(다른 워크스페이스 포함)·버전·줄 모양·이름·부모 규칙(SUB-ACT·흐름·깊이·말단 확인)·날짜·
//    담당자·중복. 줄에 매인 거부는 detail 에 줄 번호(0부터)를 싣고, 한 줄이라도 거부되면 아무것도 남지 않는다. 부모는 id 순서로 잠근다(교착 없음).
// ③ 표: 워크스페이스가 다른 회의록 거부(트리거)·읽기 정책·실행권·세션 쓰기 불가·롤백 왕복.
// 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다. 마이그레이션은 번호가 아니라 접미로 찾는다(CLAUDE.md 데이터 규칙).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const A = F.projects.a
const ID = (nn: string) => `00000000-0000-4000-8000-0000000061${nn}`
const CALL = 'select public.create_wbs_items_from_minute($1,$2,$3,$4,$5,$6,$7::jsonb) r'
const SIG = 'public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb)'
/** fixture-ws.sql 의 A 연결(작업 aErp ↔ 회의록 …1103) */
const FIXTURE_LINK = '00000000-0000-0000-7e57-00000000112d'

/** 자체 begin;/commit; 을 걷어 이 연결의 트랜잭션 안에서 돈다(workspace-mail-settings.test.ts 와 같은 방식) */
const bySuffix = (dir: string, suffix: string) => {
  const hits = readdirSync(dir).filter((f) => f.endsWith(suffix))
  if (hits.length !== 1) throw new Error(`${dir} 에서 *${suffix} 가 ${hits.length}개다`)
  return readFileSync(join(dir, hits[0]), 'utf8').replace(/^begin;[ \t]*$/gm, '').replace(/^commit;[ \t]*$/gm, '')
}
const MIGRATION = bySuffix('supabase/migrations', '_minute_wbs_links.sql')
const ROLLBACK = bySuffix('supabase/rollbacks', '_minute_wbs_links_rollback.sql')

type Row = {
  name: string; parent_id: string | null; planned_start: string | null; planned_end: string | null; assignee_member_id: string | null
  block_index: number; block_hash: string; excerpt: string; source_kind: 'manual' | 'action'; source_key: string | null; confirm_parent_leaf: boolean
}
const BASE: Row = {
  name: '로그인 API 개발', parent_id: null, planned_start: null, planned_end: '2026-10-31', assignee_member_id: null,
  block_index: 0, block_hash: 'blk-1', excerpt: '발췌', source_kind: 'action', source_key: null, confirm_parent_leaf: false,
}
const row = (over: Partial<Row> = {}): Row => ({ ...BASE, ...over })
type Opts = { project?: string; actor?: string; minute?: string; version?: string; bodyHash?: string | null; maxDepth?: number | null }
/** 기본 인자 — 프로젝트 A·alice(A 관리자)·픽스처 회의록과 그 버전·'rls-h'·깊이 상한 없음 */
const args = (rows: unknown, o: Opts = {}) => [
  o.project ?? A, o.actor ?? F.users.member, o.minute ?? F.rows.minute, o.version ?? F.rows.minuteVersion,
  o.bodyHash === undefined ? 'rls-h' : o.bodyHash, o.maxDepth ?? null, JSON.stringify(rows),
]
type Created = { row: number; item_id: string; code: string }
const create = async (c: PoolClient, rows: unknown, o: Opts = {}) =>
  (await c.query<{ r: Created[] }>(CALL, args(rows, o))).rows[0].r
const num = async (c: PoolClient, sql: string, params: unknown[] = []) => Number((await c.query<{ n: unknown }>(sql, params)).rows[0].n)
/** 프로젝트의 작업·연결·변경 이력 수 — 거부된 호출이 아무것도 남기지 않았는지 */
const tally = async (c: PoolClient, project: string = A) => ({
  items: await num(c, 'select count(*) as n from public.wbs_items where project_id = $1', [project]),
  links: await num(c, 'select count(*) as n from public.wbs_item_links where project_id = $1', [project]),
  logs: await num(c, `select count(*) as n from public.change_logs l join public.wbs_items w on w.id = l.wbs_item_id
                       where w.project_id = $1`, [project]),
})
const actualOf = async (c: PoolClient, id: string) =>
  (await c.query<{ v: number | null }>('select actual_pct::float8 as v from public.wbs_items where id = $1', [id])).rows[0].v

describe('① 등록 — 한 트랜잭션', () => {
  it('관리자 2줄 등록 — wbs_items 2행·wbs_item_links 2행·change_logs created 2행이 한 번에 생기고 반환이 줄 번호·id·code 를 준다', async () => {
    await asService(pool, async (c) => {
      const top = await num(c, 'select coalesce(max(sort_order), 0) as n from public.wbs_items where project_id = $1 and parent_id is null', [A])
      const before = await tally(c)
      const r = await create(c, [
        row(),
        row({ name: '세션.만료 처리', planned_start: '2026-10-01', assignee_member_id: F.members.danaA, block_index: 2, block_hash: 'blk-2',
              source_kind: 'manual', source_key: 'key-2' }),
      ])
      expect(r).toHaveLength(2)
      expect(r.map((x) => [x.row, x.code])).toEqual([[0, '로그인'], [1, '세션']])
      const ids = r.map((x) => x.item_id)
      expect(await tally(c)).toEqual({ items: before.items + 2, links: before.links + 2, logs: before.logs + 2 })

      const { rows: items } = await c.query(
        `select id, parent_id, code, name, sort_order, planned_start::text as planned_start, planned_end::text as planned_end,
                assignee_member_id, actual_pct, dev_workflow, is_owner_split
           from public.wbs_items where id = any($1::uuid[]) order by array_position($1::uuid[], id)`, [ids])
      const fresh = { parent_id: null, planned_end: '2026-10-31', actual_pct: null, dev_workflow: false, is_owner_split: false }
      expect(items).toEqual([
        { ...fresh, id: ids[0], code: '로그인', name: '로그인 API 개발', sort_order: top + 1, planned_start: null, assignee_member_id: null },
        { ...fresh, id: ids[1], code: '세션', name: '세션.만료 처리', sort_order: top + 2, planned_start: '2026-10-01',
          assignee_member_id: F.members.danaA },
      ])

      const { rows: links } = await c.query(
        `select wbs_item_id, project_id, link_type, minute_id, minute_version_id, minute_version_no, source_project_id, minute_title_snapshot,
                minute_date_snapshot::text as minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot, source_kind, source_key
           from public.wbs_item_links where wbs_item_id = any($1::uuid[]) order by array_position($1::uuid[], wbs_item_id)`, [ids])
      const source = {
        project_id: A, link_type: 'minute_block', minute_id: F.rows.minute, minute_version_id: F.rows.minuteVersion, minute_version_no: 1,
        source_project_id: A, minute_title_snapshot: 'RLS 회의록', minute_date_snapshot: '2026-09-01', body_hash: 'rls-h', excerpt_snapshot: '발췌',
      }
      expect(links).toEqual([
        { ...source, wbs_item_id: ids[0], block_index: 0, block_hash: 'blk-1', source_kind: 'action', source_key: null },
        { ...source, wbs_item_id: ids[1], block_index: 2, block_hash: 'blk-2', source_kind: 'manual', source_key: 'key-2' },
      ])

      const { rows: logs } = await c.query(
        `select wbs_item_id, user_id, field, old_value, new_value from public.change_logs
          where wbs_item_id = any($1::uuid[]) order by array_position($1::uuid[], wbs_item_id)`, [ids])
      expect(logs).toEqual([
        { wbs_item_id: ids[0], user_id: F.users.member, field: 'created', old_value: null, new_value: '로그인 API 개발' },
        { wbs_item_id: ids[1], user_id: F.users.member, field: 'created', old_value: null, new_value: '세션.만료 처리' },
      ])
    })
  })

  it('confirm_parent_leaf=true 면 부모 실적%가 null 이 되고 change_logs actual_pct 행(old 40, new null)이 남는다', async () => {
    await asService(pool, async (c) => {
      await c.query('update public.wbs_items set actual_pct = 40 where id = $1', [F.leaf.aDep1])
      const under = { parent_id: F.leaf.aDep1, confirm_parent_leaf: true }
      // 같은 부모로 가는 두 줄 — 실적 정리는 첫 줄에서 한 번, 자리는 차례로 맨 뒤
      const r = await create(c, [row({ ...under, block_hash: 'blk-a' }), row({ ...under, name: '토큰 갱신', block_hash: 'blk-b' })])
      expect(await actualOf(c, F.leaf.aDep1)).toBeNull()
      const parentLogs = (id: string) => c.query(
        `select user_id, field, old_value, new_value from public.change_logs where wbs_item_id = $1 and field = 'actual_pct'`, [id])
      expect((await parentLogs(F.leaf.aDep1)).rows).toEqual([{ user_id: F.users.member, field: 'actual_pct', old_value: '40', new_value: null }])
      const kids = async (parent: string) => (await c.query(
        'select id, sort_order from public.wbs_items where parent_id = $1 order by sort_order', [parent])).rows
      expect(await kids(F.leaf.aDep1)).toEqual([{ id: r[0].item_id, sort_order: 1 }, { id: r[1].item_id, sort_order: 2 }])
      // 이제 하위가 있는 부모 — 확인 없이 넣고 맨 뒤(3)에 붙는다. 지울 실적이 없어 이력도 그대로다
      const [third] = await create(c, [row({ parent_id: F.leaf.aDep1, block_hash: 'blk-c' })])
      expect((await kids(F.leaf.aDep1)).at(-1)).toEqual({ id: third.item_id, sort_order: 3 })
      expect((await parentLogs(F.leaf.aDep1)).rows).toHaveLength(1)
      // 실적이 없던 말단 부모(aDep2)는 확인이 있어도 지울 것이 없다 — 실적 이력 0행
      await create(c, [row({ parent_id: F.leaf.aDep2, confirm_parent_leaf: true, block_hash: 'blk-d' })])
      expect((await parentLogs(F.leaf.aDep2)).rows).toEqual([])
    })
  })

  it('manual 은 같은 문단에 두 번 등록할 수 있다', async () => {
    await asService(pool, async (c) => {
      const manual = row({ source_kind: 'manual' })
      expect(await create(c, [manual])).toHaveLength(1)
      expect(await create(c, [manual, manual])).toHaveLength(2)   // 다시, 그리고 한 호출 안에서 두 번
      expect(await num(c, `select count(*) as n from public.wbs_item_links where project_id = $1 and minute_id = $2 and block_hash = 'blk-1'`,
        [A, F.rows.minute])).toBe(3)
    })
  })
})

describe('② 거부 — 아무것도 남지 않는다', () => {
  it('같은 문단의 action 재등록은 23505 MINUTE_BLOCK_ALREADY_LINKED 이고 한 줄도 남지 않는다', async () => {
    await asService(pool, async (c) => {
      await create(c, [row()])
      const before = await tally(c)
      // 2줄 중 둘째(줄 1)만 이미 등록된 문단이다 — 첫 줄(새 문단)도 들어가지 않는다
      expect(await pgError(c, CALL, args([row({ block_index: 3, block_hash: 'blk-3' }), row()])))
        .toMatchObject({ code: '23505', message: 'MINUTE_BLOCK_ALREADY_LINKED', detail: '1' })
      // 판정은 버전이 아니라 문단 내용(block_hash) — 회의록을 고친 새 버전에서 같은 문단을 다시 보내도 같다
      const v2 = ID('d2')
      await c.query(`insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code, project_id)
        values ($1, $2, 2, '# RLS 2', 'rls-h2', 'RLS 회의록', '2026-09-01', 'ERP', $3)`, [v2, F.rows.minute, A])
      expect(await pgError(c, CALL, args([row()], { version: v2, bodyHash: 'rls-h2' })))
        .toMatchObject({ code: '23505', message: 'MINUTE_BLOCK_ALREADY_LINKED', detail: '0' })
      // 한 호출 안에서 같은 문단을 두 번 보내도 둘째 줄이 같은 거부다
      expect(await pgError(c, CALL, args([row({ block_hash: 'blk-4' }), row({ block_hash: 'blk-4' })])))
        .toMatchObject({ code: '23505', message: 'MINUTE_BLOCK_ALREADY_LINKED', detail: '1' })
      expect(await tally(c)).toEqual(before)
    })
  })

  it('멤버(dana)는 42501 WBS_ACTOR_FORBIDDEN', async () => {
    await asService(pool, async (c) => {
      const before = await tally(c)
      const e = await pgError(c, CALL, args([row()], { actor: F.users.dual }))
      expect(e).toMatchObject({ code: '42501', message: 'WBS_ACTOR_FORBIDDEN' })
      expect(e?.detail).toBeUndefined()   // 줄과 무관한 거부 — 줄 번호가 없다
      expect(await tally(c)).toEqual(before)
    })
  })

  it('없는 프로젝트는 플랫폼 관리자에게도 42501 WBS_ACTOR_FORBIDDEN — 존재를 알려 주지 않고 쓰기까지 가지 않는다', async () => {
    await asService(pool, async (c) => {
      // 프로젝트 없는 회의록(A)과 그 버전 — 회의록·버전 검사를 지나는 회의록이라 거부가 프로젝트 존재 판정에서 나야 한다
      const VERSION = ID('c2')
      await c.query(`insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code)
        values ($1, $2, 1, '# RLS', 'rls-h', 'RLS 전역 회의록', '2026-09-02', 'ERP')`, [VERSION, F.rows.nullMinute])
      const e = await pgError(c, CALL, args([row()], { project: ID('f3'), actor: F.users.platform, minute: F.rows.nullMinute, version: VERSION }))
      expect(e).toMatchObject({ code: '42501', message: 'WBS_ACTOR_FORBIDDEN' })
      expect(e?.detail).toBeUndefined()
      // 대조: 있는 프로젝트에서는 플랫폼 관리자가 등록한다
      expect(await create(c, [row()], { actor: F.users.platform })).toHaveLength(1)
    })
  })

  it('read committed 가 아닌 트랜잭션은 잠금 뒤 25001 MINUTE_WBS_ISOLATION — repeatable read·serializable. read committed 는 통과', async () => {
    // 잠금 뒤 기존 연결·형제·부모의 하위를 읽어 판정한다 — 스냅샷이 고정된 수준에서는 잠금을 넘겨준 앞 등록의 커밋을 못 본다(H2 규칙 ③)
    const ISOLATION = { code: '25001', message: 'MINUTE_WBS_ISOLATION' }
    for (const [level, expected] of [['repeatable read', ISOLATION], ['serializable', ISOLATION], ['read committed', null]] as const) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        const e = await pgError(c, CALL, args([row()]))
        if (expected) {
          expect(e, level).toMatchObject(expected)
          expect(e?.detail, level).toBeUndefined()
        } else {
          expect(e, level).toBeNull()
        }
      } finally {
        await c.query('rollback').catch(() => undefined)
        c.release()
      }
    }
  })

  it('다른 워크스페이스의 회의록은 RPC 가 P0002 MINUTE_NOT_FOUND — 그 회의록의 상태(보관·버전·본문)를 드러내지 않고 작업도 남기지 않는다', async () => {
    await asService(pool, async (c) => {
      // B 워크스페이스의 프로젝트 없는 회의록과 그 버전(본문 hash 'rls-h' — 워크스페이스만 다르다)
      const [MINUTE_B, VERSION_B, VERSION_A] = [ID('e1'), ID('e2'), ID('e3')]
      await c.query(`insert into public.minutes (id, project_id, workspace_id, minute_date, team_code, title, body_md, created_by)
        values ($1, null, $2, '2026-09-03', 'ERP', 'RLS B 회의록', '# B', $3)`, [MINUTE_B, F.wsB, F.users.bAdmin])
      await c.query(`insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code)
        values ($1, $2, 1, '# B', 'rls-h', 'RLS B 회의록', '2026-09-03', 'ERP')`, [VERSION_B, MINUTE_B])
      const beforeA = await tally(c)
      const NOT_FOUND = { code: 'P0002', message: 'MINUTE_NOT_FOUND' }
      expect(await pgError(c, CALL, args([row()], { minute: MINUTE_B, version: VERSION_B }))).toMatchObject(NOT_FOUND)
      // 보관돼도, 낡은 본문이어도 같은 거부다 — 다른 워크스페이스 회의록의 상태가 응답으로 새지 않는다
      await c.query('update public.minutes set archived_at = now() where id = $1', [MINUTE_B])
      expect(await pgError(c, CALL, args([row()], { minute: MINUTE_B, version: VERSION_B, bodyHash: 'rls-old' }))).toMatchObject(NOT_FOUND)
      expect(await tally(c)).toEqual(beforeA)
      // 반대 방향 — B 관리자(bea)가 A 의 프로젝트 없는 회의록을 B 프로젝트에
      await c.query(`insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code)
        values ($1, $2, 1, '# RLS', 'rls-h', 'RLS 전역 회의록', '2026-09-02', 'ERP')`, [VERSION_A, F.rows.nullMinute])
      const beforeB = await tally(c, F.projects.bWs)
      expect(await pgError(c, CALL, args([row()], { project: F.projects.bWs, actor: F.users.bAdmin, minute: F.rows.nullMinute, version: VERSION_A })))
        .toMatchObject(NOT_FOUND)
      expect(await tally(c, F.projects.bWs)).toEqual(beforeB)
    })
  })

  it('부모는 줄 순서가 아니라 id 순서로 잠근다 — 작업 행을 id 순서로 잠그는 다른 쓰기와 교착(40P01)하지 않는다', async () => {
    // s1 이 id 가 작은 부모(aDep1)를 쥐고, s2 가 [큰 부모(aDep2) 밑, 작은 부모(aDep1) 밑] 순서의 줄로 등록을 부른다. 줄 순서대로 잠그면 s2 는
    // aDep2 를 쥔 채 aDep1 을 기다리고, 그때 s1 이 aDep2 를 잡으려 하면 교착이다(custom_field_command 처럼 id 순서로 잠그는 쓰기의 꼴).
    // id 순서로 잠그면 s2 는 아무것도 쥐지 않은 채 aDep1 을 기다린다 — s1 은 aDep2 를 곧바로 잡고, s1 이 놓으면 s2 가 끝난다
    const [lo, hi] = [F.leaf.aDep1, F.leaf.aDep2]   // …f5 < …f6
    const under = (parent: string, hash: string) => row({ parent_id: parent, confirm_parent_leaf: true, block_hash: hash })
    const pid = async (s: PoolClient) => (await s.query<{ pid: number }>('select pg_catalog.pg_backend_pid() as pid')).rows[0].pid
    const s1 = await pool.connect()
    const s2 = await pool.connect()
    try {
      await s1.query('begin')
      await s1.query('select 1 from public.wbs_items where id = $1 for update', [lo])
      await s2.query('begin')
      const [p1, p2] = [await pid(s1), await pid(s2)]
      const pending = s2.query<{ r: Created[] }>(CALL, args([under(hi, 'blk-hi'), under(lo, 'blk-lo')]))
        .then((res) => res.rows[0].r, (e: unknown) => e)
      // s2 가 s1 의 잠금을 기다릴 때까지(줄 순서로 잠그면 이 시점에 s2 는 aDep2 를 쥐고 있다)
      for (let i = 0; ; i++) {
        const { rows: [w] } = await s1.query<{ blocked: boolean }>(
          'select $1::int = any (pg_catalog.pg_blocking_pids($2::int)) as blocked', [p1, p2])
        if (w.blocked) break
        if (i >= 100) throw new Error('s2 가 s1 의 잠금을 기다리지 않는다')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(await pgError(s1, 'select 1 from public.wbs_items where id = $1 for update', [hi])).toBeNull()
      await s1.query('rollback')
      const done = await pending
      expect(Array.isArray(done) ? done.length : done).toBe(2)
    } finally {
      await s1.query('rollback').catch(() => undefined)
      await s2.query('rollback').catch(() => undefined)
      s1.release()
      s2.release()
    }
  })

  it('body_hash 가 다르면 22023 MINUTE_BODY_STALE', async () => {
    await asService(pool, async (c) => {
      const before = await tally(c)
      expect(await pgError(c, CALL, args([row()], { bodyHash: 'rls-old' }))).toMatchObject({ code: '22023', message: 'MINUTE_BODY_STALE' })
      expect(await pgError(c, CALL, args([row()], { bodyHash: null }))).toMatchObject({ code: '22023', message: 'MINUTE_BODY_STALE' })
      expect(await tally(c)).toEqual(before)
    })
  })

  it('회의록·버전 — 없음 P0002 MINUTE_NOT_FOUND · 다른 프로젝트 23514 MINUTE_PROJECT_MISMATCH · 버전 없음 P0002 · 보관 55000', async () => {
    await asService(pool, async (c) => {
      const before = await tally(c)
      const one = [row()]
      expect(await pgError(c, CALL, args(one, { minute: ID('f0') }))).toMatchObject({ code: 'P0002', message: 'MINUTE_NOT_FOUND' })
      // B(같은 워크스페이스)에 A 회의록을 — 워크스페이스 관리자는 B 의 관리자이기도 하다(등급이 아니라 회의록이 막는다)
      expect(await pgError(c, CALL, args(one, { project: F.projects.b, actor: F.users.wsAdmin })))
        .toMatchObject({ code: '23514', message: 'MINUTE_PROJECT_MISMATCH' })
      expect(await pgError(c, CALL, args(one, { version: ID('f1') }))).toMatchObject({ code: 'P0002', message: 'MINUTE_VERSION_NOT_FOUND' })
      await c.query('update public.minutes set archived_at = now() where id = $1', [F.rows.minute])
      expect(await pgError(c, CALL, args(one))).toMatchObject({ code: '55000', message: 'MINUTE_ARCHIVED' })
      expect(await tally(c)).toEqual(before)
    })
  })

  it('31줄은 22023 MINUTE_WBS_ROWS_INVALID', async () => {
    await asService(pool, async (c) => {
      const before = await tally(c)
      const rows31 = Array.from({ length: 31 }, (_, i) => row({ block_index: i, block_hash: `blk-${i}` }))
      const e = await pgError(c, CALL, args(rows31))
      expect(e).toMatchObject({ code: '22023', message: 'MINUTE_WBS_ROWS_INVALID' })
      expect(e?.detail).toBeUndefined()   // 배열 단위의 거부 — 줄 번호가 없다
      for (const bad of [[], {}, null]) {
        expect(await pgError(c, CALL, args(bad)), JSON.stringify(bad)).toMatchObject({ code: '22023', message: 'MINUTE_WBS_ROWS_INVALID' })
      }
      // 원소 모양 — 거부에 그 줄 번호를 싣는다(줄 0 은 멀쩡하다)
      const shapes: unknown[] = [
        '문자열', { ...row(), name: 7 }, { ...row(), parent_id: 'not-a-uuid' }, { ...row(), assignee_member_id: 12 },
        { ...row(), planned_end: '2026-02-30' }, { ...row(), planned_start: '2026/10/01' }, { ...row(), block_index: -1 },
        { ...row(), block_index: 1.5 }, { ...row(), block_hash: ' ' }, { ...row(), excerpt: '' }, { ...row(), source_kind: 'risk' },
        { ...row(), source_key: ' ' }, { ...row(), confirm_parent_leaf: 'yes' },
      ]
      for (const bad of shapes) {
        expect(await pgError(c, CALL, args([row({ block_hash: 'blk-ok' }), bad])), JSON.stringify(bad))
          .toMatchObject({ code: '22023', message: 'MINUTE_WBS_ROWS_INVALID', detail: '1' })
      }
      expect(await tally(c)).toEqual(before)
      // 경계 — 30줄은 된다
      expect(await create(c, rows31.slice(0, 30))).toHaveLength(30)
    })
  })

  it('줄 검사 — 이름·부모·SUB-ACT·날짜 거부는 detail 에 줄 번호를 싣는다', async () => {
    await asService(pool, async (c) => {
      const before = await tally(c)
      const atRow1 = (bad: Row) => pgError(c, CALL, args([row({ block_hash: 'blk-ok' }), bad]))
      expect(await atRow1(row({ name: ' \n\t ' }))).toMatchObject({ code: '22023', message: 'WBS_NAME_REQUIRED', detail: '1' })
      expect(await atRow1(row({ name: '가'.repeat(201) }))).toMatchObject({ code: '22023', message: 'WBS_NAME_TOO_LONG', detail: '1' })
      // 다른 프로젝트의 작업·없는 작업은 부모가 될 수 없다
      expect(await atRow1(row({ parent_id: F.leaf.bWs, confirm_parent_leaf: true })))
        .toMatchObject({ code: 'P0002', message: 'WBS_PARENT_NOT_FOUND', detail: '1' })
      expect(await atRow1(row({ parent_id: ID('f2') }))).toMatchObject({ code: 'P0002', message: 'WBS_PARENT_NOT_FOUND', detail: '1' })
      expect(await atRow1(row({ planned_start: '2026-11-01', planned_end: '2026-10-31' })))
        .toMatchObject({ code: '22023', message: 'WBS_DATE_RANGE_INVALID', detail: '1' })
      // SUB-ACT — 부모의 하위에 SUB-ACT 가 있거나 부모 자신이 SUB-ACT 면
      await c.query(`insert into public.wbs_items (id, project_id, parent_id, code, name, is_owner_split) values ($1, $2, $3, '3', '후행 (ERP 주관)', true)`,
        [ID('a1'), A, F.leaf.aDep2])
      expect(await atRow1(row({ parent_id: F.leaf.aDep2 }))).toMatchObject({ code: '23514', message: 'WBS_PARENT_SUB_ACT', detail: '1' })
      expect(await atRow1(row({ parent_id: ID('a1'), confirm_parent_leaf: true })))
        .toMatchObject({ code: '23514', message: 'WBS_PARENT_SUB_ACT', detail: '1' })
      expect(await tally(c)).toEqual({ ...before, items: before.items + 1 })   // 준비로 넣은 SUB-ACT 1행뿐
      // 경계 — 앞뒤 공백을 떼고 200자는 된다(코드는 구분자가 없으면 이름 전체)
      const long = '가'.repeat(200)
      const [made] = await create(c, [row({ name: ` ${long}\n` })])
      expect((await c.query('select name, code from public.wbs_items where id = $1', [made.item_id])).rows[0]).toEqual({ name: long, code: long })
    })
  })

  it('하위 없는 부모(F.leaf.aDep1)에 confirm_parent_leaf 없이 넣으면 23514 WBS_PARENT_LEAF_UNCONFIRMED 이고 실적이 그대로다', async () => {
    await asService(pool, async (c) => {
      await c.query('update public.wbs_items set actual_pct = 40 where id = $1', [F.leaf.aDep1])
      const before = await tally(c)
      expect(await pgError(c, CALL, args([row({ parent_id: F.leaf.aDep1 })])))
        .toMatchObject({ code: '23514', message: 'WBS_PARENT_LEAF_UNCONFIRMED', detail: '0' })
      expect(await actualOf(c, F.leaf.aDep1)).toBe(40)
      expect(await num(c, 'select count(*) as n from public.wbs_items where parent_id = $1', [F.leaf.aDep1])).toBe(0)
      expect(await tally(c)).toEqual(before)
    })
  })

  it('부모가 dev_workflow 면 23514 WBS_PARENT_WORKFLOW', async () => {
    await asService(pool, async (c) => {
      await c.query('update public.wbs_items set dev_workflow = true where id = $1', [F.leaf.aDep1])
      expect(await pgError(c, CALL, args([row({ parent_id: F.leaf.aDep1, confirm_parent_leaf: true })])))
        .toMatchObject({ code: '23514', message: 'WBS_PARENT_WORKFLOW', detail: '0' })
      // 진행 중인 에이전트 주문(ready·claimed·reported)도 같다 — 끝난 주문(approved)은 막지 않는다
      const under2 = row({ parent_id: F.leaf.aDep2, confirm_parent_leaf: true })
      await c.query(`insert into public.agent_work_orders (id, project_id, wbs_item_id, status) values ($1, $2, $3, 'claimed')`, [ID('b1'), A, F.leaf.aDep2])
      expect(await pgError(c, CALL, args([under2]))).toMatchObject({ code: '23514', message: 'WBS_PARENT_WORKFLOW', detail: '0' })
      await c.query(`update public.agent_work_orders set status = 'approved' where id = $1`, [ID('b1')])
      expect(await pgError(c, CALL, args([under2]))).toBeNull()
    })
  })

  it('p_max_depth=1 이면 부모 밑에 넣을 때 23514 WBS_PARENT_DEPTH', async () => {
    await asService(pool, async (c) => {
      const under1 = row({ parent_id: F.leaf.aDep1, confirm_parent_leaf: true })
      expect(await pgError(c, CALL, args([under1], { maxDepth: 1 }))).toMatchObject({ code: '23514', message: 'WBS_PARENT_DEPTH', detail: '0' })
      // 맨 위(부모 없음)는 상한 1 에서도 된다
      expect(await pgError(c, CALL, args([row({ block_hash: 'blk-top' })], { maxDepth: 1 }))).toBeNull()
      // 깊이 0 의 부모 밑(새 작업의 깊이 1)은 상한 2 에서 된다 — 그 밑(깊이 2)은 상한 2 에서 안 되고 3 에서 된다
      const [child] = await create(c, [{ ...under1, block_hash: 'blk-c' }], { maxDepth: 2 })
      const under2 = row({ parent_id: child.item_id, confirm_parent_leaf: true, block_hash: 'blk-g' })
      expect(await pgError(c, CALL, args([under2], { maxDepth: 2 }))).toMatchObject({ code: '23514', message: 'WBS_PARENT_DEPTH', detail: '0' })
      expect(await pgError(c, CALL, args([under2], { maxDepth: 3 }))).toBeNull()
    })
  })

  it('담당자가 B 명단이면 22023 WBS_ASSIGNEE_INVALID', async () => {
    await asService(pool, async (c) => {
      const assign = (member: string) => pgError(c, CALL, args([row({ assignee_member_id: member, source_kind: 'manual' })]))
      expect(await assign(F.members.benB)).toMatchObject({ code: '22023', message: 'WBS_ASSIGNEE_INVALID', detail: '0' })
      // 대조: A 의 활성 명단 행(dana)·계정 없는 외부 인력(bob)은 된다
      expect(await assign(F.members.danaA)).toBeNull()
      expect(await assign(F.members.bobA)).toBeNull()
      // 같은 프로젝트라도 비활성 명단 행·비활성 인물은 안 된다
      await c.query('update public.project_members set active = false where id = $1', [F.members.danaA])
      expect(await assign(F.members.danaA)).toMatchObject({ code: '22023', message: 'WBS_ASSIGNEE_INVALID', detail: '0' })
      await c.query('update public.people set active = false where id = $1', [F.people.external])
      expect(await assign(F.members.bobA)).toMatchObject({ code: '22023', message: 'WBS_ASSIGNEE_INVALID', detail: '0' })
    })
  })
})

describe('③ 표 — 트리거·정책·권한·롤백', () => {
  it('워크스페이스가 다른 회의록은 표 트리거가 23514 MINUTE_WORKSPACE_MISMATCH', async () => {
    const VERSION = ID('c1')
    const link = `insert into public.wbs_item_links (wbs_item_id, project_id, minute_id, minute_version_id, minute_version_no, minute_title_snapshot,
      minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot) values ($1, $2, $3, $4, 1, 'RLS 전역 회의록', '2026-09-02', 'rls-h', 0, 'rls-w', 'rls 발췌')`
    await asService(pool, async (c) => {
      await c.query(`insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code)
        values ($1, $2, 1, '# RLS', 'rls-h', 'RLS 전역 회의록', '2026-09-02', 'ERP')`, [VERSION, F.rows.nullMinute])
      // service_role 로 직접 넣어도 — A 의 프로젝트 없는 회의록 + B 작업. RPC 는 그 전에 MINUTE_NOT_FOUND 로 거부한다(② 의 다른 워크스페이스
      // 회의록 케이스) — 이 트리거는 RPC 밖의 모든 쓰기 경로를 막는 마지막 그물이다
      expect(await pgError(c, link, [F.leaf.bWs, F.projects.bWs, F.rows.nullMinute, VERSION]))
        .toMatchObject({ code: '23514', message: 'MINUTE_WORKSPACE_MISMATCH' })
      expect(await pgError(c, link, [F.leaf.aDep1, A, F.rows.nullMinute, VERSION])).toBeNull()   // 대조: 같은 워크스페이스
    })
  })

  it('읽기 정책 — B 멤버(ben)는 A 연결을 못 보고, A 멤버(dana)는 본다', async () => {
    // 정책은 범위 읽기 하나 — 이름은 0006 뒤의 범위 읽기 관례(<표>_ws_read, 쌍둥이 issue_links_ws_read)
    const { rows: policies } = await pool.query(
      `select policyname, cmd, roles::text[] as roles from pg_policies where schemaname = 'public' and tablename = 'wbs_item_links'`)
    expect(policies).toEqual([{ policyname: 'wbs_item_links_ws_read', cmd: 'SELECT', roles: ['authenticated'] }])
    const seen = (user: string) => asUser(pool, user, (c) =>
      num(c, 'select count(*) as n from public.wbs_item_links where id = $1', [FIXTURE_LINK]))
    expect(await seen(F.users.bMember)).toBe(0)
    expect(await seen(F.users.dual)).toBe(1)
  })

  it('실행권·DEFINER·search_path·authenticated 쓰기 불가', async () => {
    const { rows: [shape] } = await pool.query(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as svc, p.prosecdef as definer,
              coalesce(p.proconfig, '{}') @> array['search_path=""', 'lock_timeout=15s'] as config,
              has_table_privilege('authenticated', 'public.wbs_item_links', 'SELECT') as can_read,
              has_table_privilege('authenticated', 'public.wbs_item_links', 'INSERT') as can_insert,
              has_table_privilege('authenticated', 'public.wbs_item_links', 'UPDATE') as can_update,
              has_table_privilege('authenticated', 'public.wbs_item_links', 'DELETE') as can_delete,
              has_table_privilege('anon', 'public.wbs_item_links', 'SELECT') as anon_read
         from pg_proc p where p.oid = $1::regprocedure`, [SIG])
    expect(shape).toEqual({
      anon: false, auth: false, svc: true, definer: true, config: true,
      can_read: true, can_insert: false, can_update: false, can_delete: false, anon_read: false,
    })
    // JWT 세션(A 관리자 alice)은 RPC 도, 표 쓰기도 권한에서 막힌다
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, CALL, args([row()]))).toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') })
      expect(await pgError(c, `update public.wbs_item_links set excerpt_snapshot = 'x' where id = $1`, [FIXTURE_LINK]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') })
    })
  })

  it('롤백 적용 뒤 표·함수가 없고 다시 적용하면 돌아온다', async () => {
    await asService(pool, async (c) => {
      const state = async () => (await c.query(
        `select to_regclass('public.wbs_item_links') is not null as tbl, to_regprocedure($1) is not null as rpc,
                to_regprocedure('public.wbs_item_links_minute_scope()') is not null as trg`, [SIG])).rows[0]
      // 연결이 한 행이라도 있으면 거부한다 — 픽스처의 A 연결이 있다. 이 트랜잭션 안에서 비운 뒤 돈다(끝에 rollback 으로 돌아온다)
      expect(await pgError(c, ROLLBACK)).toMatchObject({ code: '23514', message: 'WBS_LINKS_ROLLBACK_BLOCKED' })
      await c.query('delete from public.wbs_item_links')
      await c.query(ROLLBACK)
      expect(await state()).toEqual({ tbl: false, rpc: false, trg: false })
      await c.query(MIGRATION)
      expect(await state()).toEqual({ tbl: true, rpc: true, trg: true })
      // 다시 적용한 RPC 가 그대로 돈다
      expect(await create(c, [row()])).toHaveLength(1)
    })
  })
})
