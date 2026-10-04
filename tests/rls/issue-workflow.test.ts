import { type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import golden from '../fixtures/parity/issue-workflow.json'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

// SP5b I(스펙 §3.2·D3~D5, 개정 §3.2) — 이슈 표시 상태 트리거·이력 트리거·참조 검사·이관 분기를 실제 DB 로 본다.
// 골든(tests/fixtures/parity/issue-workflow.json)은 tests/domain/issue-workflow.test.ts 가 TS 로 같은 결과를 확인한다.
let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const A = F.projects.a
const B = F.projects.b
const KEY = 'workflow.issue_statuses'
type Def = { code: string; category: string; active: boolean }
const defsOf = (name: string) => (golden.defs as Record<string, Def[]>)[name]
const setDefs = (c: PoolClient, p: string, defs: unknown) => c.query(
  `update public.project_settings set "values" = "values" || jsonb_build_object($2::text, $3::jsonb) where project_id = $1`, [p, KEY, JSON.stringify(defs)])
const newIssue = async (c: PoolClient, p: string, title = 'SP5b 상태') =>
  (await c.query<{ id: string }>(`insert into public.issues (project_id, title) values ($1, $2) returning id`, [p, title])).rows[0].id
/** 준비 — 트리거를 끄고(복제 역할) 행을 그 상태로 둔다. 판정은 다음 문장부터 트리거가 한다 */
async function placeAt(c: PoolClient, id: string, code: string, category: string) {
  await c.query(`set local session_replication_role = replica`)
  await c.query('update public.issues set status_code = $2, status = $3, resolved_at = case when $3 = \'resolved\' then now() end where id = $1', [id, code, category])
  await c.query(`set local session_replication_role = origin`)
}
const row = async (c: PoolClient, id: string) => (await c.query<{ status: string; status_code: string; resolved_at: Date | null }>(
  'select status, status_code, resolved_at from public.issues where id = $1', [id])).rows[0]

describe('골든 — 전이·첫 상태(TS 와 같은 판정)', () => {
  it.each(golden.transitions)('$defs: $from → $to = $ok', async ({ defs, from, to, ok }) => {
    await asService(pool, async c => {
      await setDefs(c, A, defsOf(defs))
      const id = await newIssue(c, A)
      const fromCat = defsOf(defs).find(d => d.code === from)!.category
      await placeAt(c, id, from, fromCat)
      const err = await pgError(c, 'update public.issues set status_code = $2 where id = $1', [id, to])
      // 같은 code 로의 UPDATE 는 DB 에서 변경 없음(통과·이력 0) — TS 는 선택지에서 뺀다(golden ok=false). 그 밖은 판정이 같다
      if (ok || from === to) expect(err).toBeNull()
      else expect(err?.code).toBe('23514')
    })
  })
  it.each(golden.inserts)('$defs: 등록 status_code=$statusCode → $ok', async ({ defs, statusCode, ok, initial }) => {
    await asService(pool, async c => {
      await setDefs(c, A, defsOf(defs))
      const err = await pgError(c, `insert into public.issues (project_id, title, status_code) values ($1, 'SP5b 등록', $2)`, [A, statusCode])
      if (!ok) { expect(err?.message).toMatch(/^ISSUE_STATUS_(NOT_INITIAL|UNKNOWN):/); return }
      expect(err).toBeNull()
      if (initial) {
        const r = (await c.query(`select status, status_code from public.issues where project_id = $1 and title = 'SP5b 등록'`, [A])).rows[0]
        expect(r).toEqual({ status: 'open', status_code: initial })
      }
    })
  })
})

describe('파생 열 — status·resolved_at 은 트리거만 정한다', () => {
  it('status 직접 변경은 거부, 명시 status 가 대상 범주와 다르면 거부', async () => {
    await asService(pool, async c => {
      await setDefs(c, A, defsOf('research'))
      const id = await newIssue(c, A)
      expect(await pgError(c, `update public.issues set status = 'resolved' where id = $1`, [id])).toMatchObject({ code: '23514', message: 'ISSUE_STATUS_DERIVED' })
      expect(await pgError(c, `update public.issues set status_code = 'done', status = 'on_hold' where id = $1`, [id])).toMatchObject({ message: 'ISSUE_STATUS_DERIVED' })
      expect(await pgError(c, `insert into public.issues (project_id, title, status) values ($1, 'x', 'resolved')`, [A])).toMatchObject({ message: 'ISSUE_STATUS_DERIVED' })
    })
  })
  it('resolved_at: 해결 진입 = now, 해결 안 이동 = 유지, 나가면 null. 직접 쓰기는 service_role 도 거부', async () => {
    await asService(pool, async c => {
      await setDefs(c, A, [...defsOf('research'), { code: 'archived', label: '보관', category: 'resolved', color: 'neutral', sort: 9, active: true }])
      const id = await newIssue(c, A)
      expect((await row(c, id)).resolved_at).toBeNull()
      await c.query(`update public.issues set status_code = 'done' where id = $1`, [id])
      const first = (await row(c, id)).resolved_at
      expect(first).not.toBeNull()
      await c.query(`update public.issues set status_code = 'archived' where id = $1`, [id])
      expect((await row(c, id))).toMatchObject({ status: 'resolved', resolved_at: first })
      expect(await pgError(c, `update public.issues set resolved_at = now() - interval '9 days' where id = $1`, [id])).toMatchObject({ message: 'ISSUE_RESOLVED_AT_DERIVED' })
      expect(await pgError(c, `insert into public.issues (project_id, title, resolved_at) values ($1, 'x', now())`, [A])).toMatchObject({ message: 'ISSUE_RESOLVED_AT_DERIVED' })
      await c.query(`update public.issues set status_code = 'execution' where id = $1`, [id])
      expect(await row(c, id)).toMatchObject({ status: 'in_progress', resolved_at: null })
    })
  })
  it('키가 없는 프로젝트는 기본 4상태 — 옛 동작과 같다(open→in_progress→resolved, resolved→on_hold 거부)', async () => {
    await asService(pool, async c => {
      await c.query(`update public.project_settings set "values" = "values" - $2 where project_id = $1`, [A, KEY])
      const id = await newIssue(c, A)
      expect(await row(c, id)).toMatchObject({ status: 'open', status_code: 'open' })
      await c.query(`update public.issues set status_code = 'resolved' where id = $1`, [id])
      expect(await pgError(c, `update public.issues set status_code = 'on_hold' where id = $1`, [id])).toMatchObject({ message: 'ISSUE_TRANSITION_DENIED:resolved>on_hold' })
    })
  })
  it('손상 정의는 기본값으로 위장하지 않는다(CONFIG_INVALID) · read committed 가 아니면 25001', async () => {
    await asService(pool, async c => {
      await setDefs(c, A, defsOf('research').filter(d => d.category !== 'resolved'))
      expect(await pgError(c, `insert into public.issues (project_id, title) values ($1, 'x')`, [A])).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:workflow.issue_statuses' })
    })
    const c = await pool.connect()
    try {
      await c.query('begin isolation level repeatable read')
      // 등록은 채번 트리거가 먼저 격리 수준을 거절한다(ISSUE_CODE_ISOLATION) — 상태 전이(UPDATE)로 본다
      const id = (await c.query(`select id from public.issues where project_id = $1 order by id limit 1`, [A])).rows[0].id
      expect(await pgError(c, `update public.issues set status_code = 'in_progress' where id = $1`, [id])).toMatchObject({ code: '25001', message: 'ISSUE_WORKFLOW_ISOLATION' })
    } finally { await c.query('rollback'); c.release() }
  })
})

describe('세션(PostgREST) 경로 — 멤버의 직접 PATCH 도 같은 판정·같은 이력', () => {
  it('alice(B 멤버 — 관리자 아님): 허용 전이는 통과하고 이력 1행(작성자 alice), 전이표 밖은 거부, status·resolved_at 직접 쓰기 거부', async () => {
    let id = ''
    await asService(pool, async c => {
      await setDefs(c, B, defsOf('research'))
      id = await newIssue(c, B, 'SP5b 세션')
      await c.query(`update public.issues set status_code = 'done' where id = $1`, [id])
      // 서비스 경로(JWT 없음·GUC 없음) 이력은 작성자 null
      expect((await c.query(`select author_user_id, author_name, body from public.issue_updates where issue_id = $1 and kind = 'status'`, [id])).rows)
        .toEqual([{ author_user_id: null, author_name: '(이름 없음)', body: 'intake>done' }])
    })
    // 위 트랜잭션은 롤백됐다 — 세션 케이스는 한 트랜잭션 안에서 준비(claims 비우고 postgres)부터 한다
    await asUser(pool, F.users.member, async c => {
      await c.query('reset role')
      await c.query(`select set_config('request.jwt.claims', '', true)`)
      await setDefs(c, B, defsOf('research'))
      const iid = await newIssue(c, B, 'SP5b 세션')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: F.users.member, role: 'authenticated' })])
      await c.query('set local role authenticated')
      expect(await pgError(c, `update public.issues set status_code = 'client_approval' where id = $1`, [iid])).toBeNull()
      expect(await pgError(c, `update public.issues set status_code = 'done' where id = $1`, [iid])).toBeNull()
      expect(await pgError(c, `update public.issues set status_code = 'client_approval' where id = $1`, [iid])).toMatchObject({ message: 'ISSUE_TRANSITION_DENIED:done>client_approval' })
      expect(await pgError(c, `update public.issues set status = 'open' where id = $1`, [iid])).toMatchObject({ message: 'ISSUE_STATUS_DERIVED' })
      expect(await pgError(c, `update public.issues set resolved_at = null where id = $1`, [iid])).toMatchObject({ message: 'ISSUE_RESOLVED_AT_DERIVED' })
      await c.query('reset role')
      const hist = (await c.query(`select author_user_id, body from public.issue_updates where issue_id = $1 and kind = 'status' order by created_at, body`, [iid])).rows
      expect(hist).toEqual([
        { author_user_id: F.users.member, body: 'client_approval>done' },
        { author_user_id: F.users.member, body: 'intake>client_approval' },
      ])
    })
    expect(id).not.toBe('')
  })
  it('트리거 함수는 DEFINER·search_path 고정·EXECUTE 없음', async () => {
    await asService(pool, async c => {
      const { rows } = await c.query(`select p.proname, p.prosecdef, p.proconfig,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
        from pg_proc p where p.proname in ('enforce_issue_workflow', 'record_issue_status_change') order by p.proname`)
      expect(rows).toEqual([
        { proname: 'enforce_issue_workflow', prosecdef: true, proconfig: ['search_path=""'], auth_exec: false, anon_exec: false },
        { proname: 'record_issue_status_change', prosecdef: true, proconfig: ['search_path=""'], auth_exec: false, anon_exec: false },
      ])
    })
  })
})

describe('settings_ref_check — 참조 있는 상태의 삭제·범주 변경 거부, 모양 검사 먼저', () => {
  const REF = 'select public.settings_ref_check($1, $2, $3::jsonb, $4::jsonb)'
  it('삭제 = removed, 범주 변경 = category(건수 동봉), 비활성은 통과, 손상 = CONFIG_INVALID', async () => {
    await asService(pool, async c => {
      const defs = defsOf('research')
      await setDefs(c, A, defs)
      const id = await newIssue(c, A)
      await c.query(`update public.issues set status_code = 'review' where id = $1`, [id])
      const removed = await pgError(c, REF, [A, KEY, JSON.stringify(defs), JSON.stringify(defs.filter(d => d.code !== 'review'))])
      expect(removed).toMatchObject({ code: '23514', message: `SETTINGS_CODE_IN_USE:${KEY}` })
      expect(JSON.parse(removed!.detail!)).toMatchObject({ key: KEY, code: 'review', reason: 'removed', count: 1 })
      const recat = await pgError(c, REF, [A, KEY, JSON.stringify(defs), JSON.stringify(defs.map(d => d.code === 'review' ? { ...d, category: 'on_hold' } : d))])
      expect(JSON.parse(recat!.detail!)).toMatchObject({ code: 'review', reason: 'category', count: 1 })
      expect(await pgError(c, REF, [A, KEY, JSON.stringify(defs), JSON.stringify(defs.map(d => d.code === 'review' ? { ...d, active: false } : d))])).toBeNull()
      expect(await pgError(c, REF, [A, KEY, JSON.stringify(defs), JSON.stringify(defs.map(d => ({ ...d, category: 'closed' })))]))
        .toMatchObject({ code: '22023', message: `CONFIG_INVALID:${KEY}` })
    })
  })
})

describe('migrate_setting_code — 같은 범주 안으로만, 이력은 행위자로', () => {
  const MIG = `select public.migrate_setting_code($1, $2, $3, $4, $5) as n`
  it('같은 범주 이관은 건수·이력(작성자 = 행위자, 이름 = 프로필), 다른 범주는 SETTINGS_CODE_CATEGORY_MISMATCH', async () => {
    await asService(pool, async c => {
      await setDefs(c, A, defsOf('research'))
      const id = await newIssue(c, A)
      await c.query(`update public.issues set status_code = 'review' where id = $1`, [id])
      expect((await c.query(MIG, [F.users.member, A, KEY, 'review', 'intake'])).rows[0].n).toBe('1')
      const name = (await c.query(`select display_name from public.profiles where user_id = $1`, [F.users.member])).rows[0].display_name
      expect((await c.query(`select author_user_id, author_name, body from public.issue_updates where issue_id = $1 and kind = 'status' and body = 'review>intake'`, [id])).rows)
        .toEqual([{ author_user_id: F.users.member, author_name: name, body: 'review>intake' }])
      expect(await pgError(c, MIG, [F.users.member, A, KEY, 'intake', 'done'])).toMatchObject({ code: '23514', message: 'SETTINGS_CODE_CATEGORY_MISMATCH:intake>done' })
    })
  })
})

describe('경합 — 상태 삭제 vs 그 상태로 생성 → 고아 0', () => {
  it('설정 행 잠금 아래에서 삭제가 커밋되면 대기하던 등록은 새 정의로 판정돼 거부된다', async () => {
    const c1 = await pool.connect()
    const c2 = await pool.connect()
    try {
      await c1.query('begin')
      await setDefs(c1, A, [...defsOf('research'), { code: 'triage', label: '분류', category: 'open', color: 'neutral', sort: 0, active: true }])
      await c1.query('commit')
      await c1.query('begin')
      await c1.query(`select 1 from public.project_settings where project_id = $1 for update`, [A])
      await setDefs(c1, A, defsOf('research'))
      await c2.query('begin')
      const pending = pgError(c2, `insert into public.issues (project_id, title, status_code) values ($1, 'SP5b 경합', 'triage')`, [A])
      await new Promise(r => setTimeout(r, 200))
      await c1.query('commit')
      expect(await pending).toMatchObject({ message: 'ISSUE_STATUS_UNKNOWN:triage' })
      await c2.query('rollback')
    } finally {
      await c1.query(`update public.project_settings set "values" = "values" - $2 where project_id = $1`, [A, KEY]).catch(() => {})
      c1.release(); c2.release()
    }
  })
})
