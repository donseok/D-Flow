// H2-h(P8-H2-1) — 첨부 insert 가드. 제8부 탐침 P1(개수)·P2(중복)·P3(보관)·P4(크기·mime 위조)와 경로·객체 소유, 검사 순서(관리 불가
// 세션은 RLS 가 거부 — 가드가 다른 오류를 먼저 내지 않는다), UPDATE 금지, 두 연결 직렬화(Review Focus 2)를 본다.
import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeStoragePath } from '@/lib/domain/storagePath'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const M = '00000000-0000-0000-7e57-000000001260'   // 프로젝트 a, 작성자 alice, 첨부 0
const pathOf = (i: number | string, minuteId = M, projectId: string | null = F.projects.a) =>
  makeStoragePath({ workspaceId: F.ws, projectId, entity: 'minute-files', entityId: minuteId, fileName: `f${i}.pdf` })
const INSERT = `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime, uploaded_by)
  values ($1, 'attachment', 'f.pdf', $2, 1, 'text/plain', $3) returning size, mime`
const put = (c: PoolClient, name: string, owner: string, meta = { size: 12345, mimetype: 'application/pdf' }) =>
  c.query('insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4::jsonb)', ['minutes', name, owner, JSON.stringify(meta)])
/** alice 세션에서 회의록 M 과 객체들을 postgres 로 만들고 authenticated 로 돌아온다 */
async function seed(c: PoolClient, objects: Array<number | string>, owner: string = F.users.member) {
  await c.query('reset role')
  await c.query(`insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by)
    values ($1, $2, '2026-09-27', 'ERP', 'H2 가드', '# h2', $3)`, [M, F.projects.a, F.users.member])
  for (const i of objects) await put(c, pathOf(i), owner)
  await c.query('set local role authenticated')
}

describe('H2-h minute_files_attachment_guard', () => {
  it('P1 — 10개까지 확정되고 11번째는 MINUTE_ATTACHMENT_LIMIT', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      for (let i = 1; i <= 10; i++) expect(await pgError(c, INSERT, [M, pathOf(i), F.users.member]), `#${i}`).toBeNull()
      expect(await pgError(c, INSERT, [M, pathOf(11), F.users.member])).toMatchObject({ code: '23514', message: 'MINUTE_ATTACHMENT_LIMIT' })
    })
  })

  it('P2 — 같은 경로 재전송은 MINUTE_ATTACHMENT_DUPLICATE(23505), 10개째 상태에서도 개수보다 먼저', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      expect(await pgError(c, INSERT, [M, pathOf(1), F.users.member])).toBeNull()
      expect(await pgError(c, INSERT, [M, pathOf(1), F.users.member])).toMatchObject({ code: '23505', message: 'MINUTE_ATTACHMENT_DUPLICATE' })
      for (let i = 2; i <= 10; i++) await c.query(INSERT, [M, pathOf(i), F.users.member])
      expect(await pgError(c, INSERT, [M, pathOf(10), F.users.member])).toMatchObject({ code: '23505', message: 'MINUTE_ATTACHMENT_DUPLICATE' })
    })
  })

  it('P3 — 보관된 회의록은 RLS 가 거부한다(42501 row-level security)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [1])
      await c.query('reset role'); await c.query('update public.minutes set archived_at = now() where id = $1', [M]); await c.query('set local role authenticated')
      expect(await pgError(c, INSERT, [M, pathOf(1), F.users.member])).toMatchObject({ code: '42501', message: expect.stringContaining('row-level security') })
    })
  })

  it('P4 — 선언한 크기·형식(1, text/plain) 대신 객체 메타데이터(12345, application/pdf)가 저장된다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [1])
      const { rows } = await c.query<{ size: string; mime: string }>(INSERT, [M, pathOf(1), F.users.member])
      expect(rows[0]).toEqual({ size: '12345', mime: 'application/pdf' })
    })
  })

  it('객체가 없거나 남의 객체면 MINUTE_ATTACHMENT_OBJECT', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [])
      expect(await pgError(c, INSERT, [M, pathOf('none'), F.users.member])).toMatchObject({ code: '42501', message: 'MINUTE_ATTACHMENT_OBJECT' })
      await c.query('reset role'); await put(c, pathOf('other'), F.users.dual); await c.query('set local role authenticated')
      expect(await pgError(c, INSERT, [M, pathOf('other'), F.users.member])).toMatchObject({ code: '42501', message: 'MINUTE_ATTACHMENT_OBJECT' })
    })
  })

  it('경로가 회의록 범위와 다르면 MINUTE_ATTACHMENT_PATH — 다른 회의록 id·프로젝트·본문 entity·옛 형식', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await seed(c, [])
      for (const bad of [
        pathOf('x', F.rows.minute), pathOf('y', M, F.projects.b), pathOf('z', M, null),
        makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: M, fileName: 'b.pdf' }),
        `${M}/old.pdf`,
      ]) {
        expect(await pgError(c, INSERT, [M, bad, F.users.member]), bad).toMatchObject({ code: '22023', message: 'MINUTE_ATTACHMENT_PATH' })
      }
    })
  })

  it('관리할 수 없는 세션(cy)은 가드가 아니라 RLS 가 거부한다 — isolation-map.ts OWN_INSERT_PROBES 의 전제', async () => {
    await asUser(pool, F.users.aLoose, async (c) => {
      await seed(c, [1], F.users.aLoose)
      expect(await pgError(c, INSERT, [M, pathOf(1), F.users.aLoose])).toMatchObject({ code: '42501', message: expect.stringContaining('row-level security') })
    })
  })

  it('service_role 경로(auth.uid() null)는 가드를 타지 않는다 — 픽스처·서버 경로(현재 첨부를 서버가 넣는 곳은 없다)', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime)
        values ($1, 'attachment', 'x.txt', 'rls/h2-service.txt', 1, 'text/plain')`, [F.rows.minute])).toBeNull()
    })
  })

  it('첨부는 추가·삭제만 — UPDATE 는 권한 42501, UPDATE 정책 없음, 부분 유니크 인덱스 있음', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, `update public.minute_files set file_name = 'x' where minute_id = $1`, [F.rows.minute]))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') })
    })
    const { rows: [r] } = await pool.query(`select
      (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'minute_files' and cmd = 'UPDATE') as upd,
      (select indexdef from pg_indexes where indexname = 'minute_files_attachment_path_uidx') as idx`)
    expect(r.upd).toBe(0)
    expect(r.idx).toMatch(/UNIQUE INDEX .* \(file_path\) WHERE \(role = 'attachment'::text\)/)
  })

  it('read committed 가 아닌 트랜잭션은 회의록 행을 잠근 뒤 MINUTE_ATTACHMENT_ISOLATION(25001) — repeatable read·serializable·read uncommitted. read committed 는 통과', async () => {
    // 가드는 회의록 행 잠금 뒤에 첨부 행(개수·중복)과 권한을 읽어 판정한다. repeatable read·serializable 은 트랜잭션 스냅샷 하나로 읽어 잠금을
    // 넘겨준 앞 연결의 커밋을 못 본다. serializable 의 SSI 는 상대도 serializable 일 때만 한쪽을 중단하는데 상대(PostgREST)는 read committed 다
    // — 격리 수준 자체를 거절한다(fail-closed, 0011 ①·⑧·⑨·⑩ 공통 규칙). 이름으로 판정하므로 read uncommitted 도 거절된다.
    const claims = JSON.stringify({ sub: F.users.member, role: 'authenticated' })
    const ISOLATION = { code: '25001', message: 'MINUTE_ATTACHMENT_ISOLATION' }
    for (const [level, expected] of [
      ['repeatable read', ISOLATION], ['serializable', ISOLATION], ['read uncommitted', ISOLATION], ['read committed', null],
    ] as const) {
      const c = await pool.connect()
      try {
        await c.query(`begin isolation level ${level}`)
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
        await seed(c, [1])
        const err = await pgError(c, INSERT, [M, pathOf(1), F.users.member])
        if (expected) expect(err, level).toMatchObject(expected)
        else expect(err, level).toBeNull()
      } finally {
        await c.query('rollback').catch(() => undefined)
        c.release()
      }
    }
  })

  it('Review Focus 2 — 같은 회의록에 두 연결이 동시에 확정하면 뒤 연결은 회의록 행 잠금을 기다린다(개수 경합 직렬화)', async () => {
    const s1 = await pool.connect()
    const s2 = await pool.connect()
    const claims = JSON.stringify({ sub: F.users.member, role: 'authenticated' })
    try {
      await s1.query('begin')
      await put(s1, pathOf('s1', F.rows.minute), F.users.member)
      await s1.query('set local role authenticated')
      await s1.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
      await s1.query(INSERT, [F.rows.minute, pathOf('s1', F.rows.minute), F.users.member])   // 회의록 행 잠금을 쥔 채 멈춘다
      await s2.query('begin')
      await s2.query(`set local lock_timeout = '300ms'`)
      await s2.query('set local role authenticated')
      await s2.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
      const err = await s2.query(INSERT, [F.rows.minute, pathOf('s2', F.rows.minute), F.users.member]).then(
        () => null, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e })
      expect(err).toMatchObject({ code: '55P03' })   // lock_not_available — 가드 ② 에서 기다렸다
    } finally {
      await s1.query('rollback').catch(() => undefined)
      await s2.query('rollback').catch(() => undefined)
      s1.release()
      s2.release()
    }
  })

  /**
   * 두 연결 경합 — dana 세션(s2)이 전용 회의록 minuteId 에 첨부를 확정하다 가드 ② 의 행 잠금에서 기다리는 동안 s1 이 change 를 커밋한다.
   * 두 연결 사이의 커밋이 필요해 이 케이스들만 데이터를 커밋한다 — 전용 회의록·객체(픽스처 행은 건드리지 않는다)를 먼저 지우고(죽은 앞
   * 실행의 잔재) try 안에서 만들며 finally 에서 지운다. 돌려주는 값은 s2 의 오류다.
   */
  async function raceWithCommit(minuteId: string, change: string, changeParams: unknown[]): Promise<DatabaseError | null> {
    const path = pathOf('mb', minuteId)
    const cleanup = async () => {
      const c = await pool.connect()
      try {
        await c.query('begin')
        await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
        await c.query('delete from storage.objects where bucket_id = $1 and name = $2', ['minutes', path])
        await c.query('delete from public.minutes where id = $1', [minuteId])
        await c.query('commit')
      } finally {
        c.release()
      }
    }
    const claims = JSON.stringify({ sub: F.users.dual, role: 'authenticated' })
    await cleanup()
    let s1: PoolClient | undefined
    let s2: PoolClient | undefined
    try {
      await pool.query(`insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by)
        values ($1, $2, '2026-09-27', 'ERP', 'H2 재확인', '# h2', $3)`, [minuteId, F.projects.a, F.users.dual])
      await pool.query('insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4::jsonb)',
        ['minutes', path, F.users.dual, JSON.stringify({ size: 5, mimetype: 'application/pdf' })])
      s1 = await pool.connect()
      s2 = await pool.connect()
      await s1.query('begin')
      await s1.query(change, changeParams)   // 회의록 행 잠금을 쥔다
      const pid = (await s2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid
      await s2.query('begin')
      await s2.query('set local role authenticated')
      await s2.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
      const pending = s2.query(INSERT, [minuteId, path, F.users.dual]).then(
        () => null, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e })
      // s2 가 가드 ①(커밋 전 상태라 통과)을 지나 ② 의 행 잠금에서 기다리는 것을 확인한 뒤 커밋한다
      let waiting = false
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (await s1.query<{ w: string | null }>('select wait_event_type as w from pg_stat_activity where pid = $1', [pid])).rows[0]?.w === 'Lock'
        if (!waiting) await new Promise((r) => setTimeout(r, 50))
      }
      expect(waiting, 's2 가 회의록 행 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      return await pending
    } finally {
      await s1?.query('rollback').catch(() => undefined)
      await s2?.query('rollback').catch(() => undefined)
      s1?.release()
      s2?.release()
      await cleanup()
    }
  }

  it('잠금을 기다리는 사이 관리 권한을 잃으면(작성자 변경이 커밋됨) 잠금 뒤 재확인이 MINUTE_ATTACHMENT_FORBIDDEN 으로 거절한다', async () => {
    const MB = '00000000-0000-0000-7e57-0000000012d0'   // 프로젝트 a, 작성자 dana(a 멤버, 관리자 아님)
    expect(await raceWithCommit(MB, 'update public.minutes set created_by = $2 where id = $1', [MB, F.users.member]))
      .toMatchObject({ code: '42501', message: 'MINUTE_ATTACHMENT_FORBIDDEN' })
  })

  it('잠금을 기다리는 사이 회의록 보관이 커밋되면 잠금 뒤 MINUTE_ATTACHMENT_ARCHIVED — 권한 재확인(FORBIDDEN)보다 먼저 본다', async () => {
    // P3(미리 보관)은 가드 ① 이 돌려보내 RLS 가 거부한다 — 가드의 보관 분기는 잠금 대기 중 커밋된 보관에서만 닿는다(앱이 사용자 문구로 옮긴다).
    // 보관되면 can_manage_minute 도 거짓이 되므로, 보관 검사가 재확인 뒤로 가면 여기서 FORBIDDEN 이 나와 빨개진다.
    const MA = '00000000-0000-0000-7e57-0000000012d1'   // 프로젝트 a, 작성자 dana
    expect(await raceWithCommit(MA, 'update public.minutes set archived_at = now() where id = $1', [MA]))
      .toMatchObject({ code: '42501', message: 'MINUTE_ATTACHMENT_ARCHIVED' })
  })
})
