import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VOCAB_KEYS, defaultVocab } from '@/lib/settings/vocab'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

// SP5 B4(스펙 D29·D58, §3.6, 개정 §2.4.1·§2.4.2) — 어휘 트리거·참조 검사·이관 RPC 를 실제 DB 로 본다.
// 경합: 참조 insert 대 code 삭제 → 고아 0, 값 그대로인 UPDATE 는 잠금 없이 통과, 동시 편집 대 이관 → 한쪽 40P01 + 고아 0.
let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const P = F.projects.a
const MEMBER = '00000000-0000-0000-7e57-0000000000e1'   // alice 의 프로젝트 a 명단 행(admin)
const ATT = `insert into public.attendance_records (project_id, member_id, date, type) values ($1, $2, $3, $4) returning id`
const setVocab = (c: PoolClient, key: string, list: unknown) => c.query(
  `update public.project_settings set "values" = "values" || jsonb_build_object($2::text, $3::jsonb) where project_id = $1`, [P, key, JSON.stringify(list)])
const att = () => defaultVocab('attendance.types')
const sev = () => defaultVocab('issues.severities')

describe('TS/SQL 기본 어휘 패리티', () => {
  it.each(VOCAB_KEYS.filter(k => k !== 'issues.cause_categories'))('%s', async (key) => {
    await asService(pool, async c => {
      expect((await c.query('select public.project_vocab_default($1) as v', [key])).rows[0].v).toEqual(defaultVocab(key))
    })
  })
  it('원인 분류는 SQL 기본값이 없다(DB 가 참조를 세지 않는다)', async () => {
    await asService(pool, async c => {
      expect((await c.query(`select public.project_vocab_default('issues.cause_categories') as v`)).rows[0].v).toBeNull()
    })
  })
})

describe('어휘 트리거 — 새로 생기는 값만 판정', () => {
  it('키가 없으면 제품 기본값: 기본 code 는 통과, 목록 밖은 PROJECT_VOCAB_INACTIVE', async () => {
    await asService(pool, async c => {
      await c.query(`update public.project_settings set "values" = "values" - 'attendance.types' where project_id = $1`, [P])
      expect(await pgError(c, ATT, [P, MEMBER, '2026-10-05', 'work'])).toBeNull()
      expect(await pgError(c, ATT, [P, MEMBER, '2026-10-06', 'nope'])).toMatchObject({ code: '23514', message: 'PROJECT_VOCAB_INACTIVE:attendance.types:nope' })
    })
  })
  it('비활성 code 의 새 행은 거부, 기존 행의 다른 열 수정·같은 값 UPDATE 는 통과', async () => {
    await asService(pool, async c => {
      const id = (await c.query(ATT, [P, MEMBER, '2026-10-07', 'annual'])).rows[0].id
      await setVocab(c, 'attendance.types', att().map(e => e.code === 'annual' ? { ...e, active: false } : e))
      expect(await pgError(c, ATT, [P, MEMBER, '2026-10-08', 'annual'])).toMatchObject({ code: '23514', message: 'PROJECT_VOCAB_INACTIVE:attendance.types:annual' })
      expect(await pgError(c, 'update public.attendance_records set date = $2 where id = $1', [id, '2026-10-09'])).toBeNull()
      expect(await pgError(c, `update public.attendance_records set type = 'annual' where id = $1`, [id])).toBeNull()
      expect(await pgError(c, `update public.attendance_records set type = 'work' where id = $1`, [id])).toBeNull()
      expect(await pgError(c, `update public.attendance_records set type = 'annual' where id = $1`, [id])).toMatchObject({ message: 'PROJECT_VOCAB_INACTIVE:attendance.types:annual' })
    })
  })
  it('설정에 새로 넣은 code 는 쓸 수 있고, 출처는 null 을 허용한다', async () => {
    await asService(pool, async c => {
      await setVocab(c, 'issues.severities', [...sev(), { code: 'critical', label: '치명', rank: 0, color: 'delayed', active: true }])
      expect(await pgError(c, `insert into public.issues (project_id, title, severity) values ($1, 'B4 치명', 'critical')`, [P])).toBeNull()
      expect(await pgError(c, `insert into public.issues (project_id, title, severity, source_type) values ($1, 'B4 출처 없음', 'low', null)`, [P])).toBeNull()
      expect(await pgError(c, `insert into public.issues (project_id, title, source_type) values ($1, 'B4 출처', 'x_src')`, [P]))
        .toMatchObject({ message: 'PROJECT_VOCAB_INACTIVE:issues.sources:x_src' })
      expect(await pgError(c, `insert into public.meetings (project_id, title, meeting_date, category) values ($1, 'B4 회의', '2026-10-05', 'x_cat')`, [P]))
        .toMatchObject({ message: 'PROJECT_VOCAB_INACTIVE:meetings.categories:x_cat' })
    })
  })
  it('손상된 어휘 값은 기본값으로 위장하지 않는다(CONFIG_INVALID)', async () => {
    await asService(pool, async c => {
      await c.query(`update public.project_settings set "values" = "values" || '{"attendance.types": {"x": 1}}'::jsonb where project_id = $1`, [P])
      expect(await pgError(c, ATT, [P, MEMBER, '2026-10-10', 'work'])).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:attendance.types' })
    })
  })
  it('read committed 가 아니면 거절한다(25001)', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin isolation level repeatable read')
      expect(await pgError(c, ATT, [P, MEMBER, '2026-10-11', 'work'])).toMatchObject({ code: '25001', message: 'PROJECT_VOCAB_ISOLATION' })
    } finally { await c.query('rollback'); c.release() }
  })
})

describe('settings_ref_check 어휘 분기 — 참조 행이 있으면 삭제·의미 속성 변경 거부', () => {
  const REF = 'select public.settings_ref_check($1, $2, $3::jsonb, $4::jsonb)'
  it('참조 있는 code 삭제는 SETTINGS_CODE_IN_USE(키·code·건수), 비활성은 통과, 참조 없는 삭제도 통과', async () => {
    await asService(pool, async c => {
      await c.query(ATT, [P, MEMBER, '2026-10-12', 'trip'])
      const without = (code: string) => JSON.stringify(att().filter(e => e.code !== code))
      const err = await pgError(c, REF, [P, 'attendance.types', JSON.stringify(att()), without('trip')])
      expect(err).toMatchObject({ code: '23514', message: 'SETTINGS_CODE_IN_USE:attendance.types' })
      expect(JSON.parse(err!.detail!)).toMatchObject({ key: 'attendance.types', code: 'trip', reason: 'removed' })
      expect(JSON.parse(err!.detail!).count).toBeGreaterThanOrEqual(1)
      expect(await pgError(c, REF, [P, 'attendance.types', JSON.stringify(att()), JSON.stringify(att().map(e => e.code === 'trip' ? { ...e, active: false } : e))])).toBeNull()
      await c.query(`delete from public.attendance_records where project_id = $1 and type = 'quarter'`, [P])
      expect(await pgError(c, REF, [P, 'attendance.types', JSON.stringify(att()), without('quarter')])).toBeNull()
    })
  })
  it('counts_as 는 참조가 있으면 바꿀 수 없다(의미 속성), 참조가 없으면 된다 — 옛 키 없음은 제품 기본값과 비교', async () => {
    await asService(pool, async c => {
      await c.query(ATT, [P, MEMBER, '2026-10-13', 'sick'])
      const changed = (code: string) => JSON.stringify(att().map(e => e.code === code ? { ...e, counts_as: 'work' } : e))
      const err = await pgError(c, REF, [P, 'attendance.types', null, changed('sick')])
      expect(err).toMatchObject({ message: 'SETTINGS_CODE_IN_USE:attendance.types' })
      expect(JSON.parse(err!.detail!)).toMatchObject({ code: 'sick', reason: 'counts_as' })
      await c.query(`delete from public.attendance_records where project_id = $1 and type = 'official'`, [P])
      expect(await pgError(c, REF, [P, 'attendance.types', null, changed('official')])).toBeNull()
    })
  })
  it('설정 RPC 경로에서도 같은 거부(apply_project_settings → 디스패처)', async () => {
    await asService(pool, async c => {
      const rev = (await c.query('select revision from public.project_settings where project_id = $1', [P])).rows[0].revision
      const used = (await c.query(`select severity from public.issues where project_id = $1 limit 1`, [P])).rows[0].severity as string
      const err = await pgError(c, `select public.apply_project_settings($1, $2, gen_random_uuid(), $3::jsonb, null, $4, 1, 'edit')`,
        [P, rev, JSON.stringify({ 'issues.severities': sev().filter(e => e.code !== used) }), F.users.wsAdmin])
      expect(err).toMatchObject({ code: '23514', message: 'SETTINGS_CODE_IN_USE:issues.severities' })
    })
  })
})

describe('migrate_setting_code — 이관 → 삭제', () => {
  const MIG = 'select public.migrate_setting_code($1, $2, $3, $4, $5) as n'
  it('관리자 재판정·대상 활성·입력 검사, 성공하면 옮긴 건수를 돌려주고 그 뒤 삭제가 통과한다', async () => {
    await asService(pool, async c => {
      await c.query(ATT, [P, MEMBER, '2026-10-14', 'half'])
      await c.query(ATT, [P, MEMBER, '2026-10-15', 'half'])
      const before = Number((await c.query(`select count(*) from public.attendance_records where project_id = $1 and type = 'half'`, [P])).rows[0].count)
      expect(await pgError(c, MIG, [F.users.aLoose, P, 'attendance.types', 'half', 'annual'])).toMatchObject({ code: '42501', message: 'VOCAB_MIGRATE_FORBIDDEN' })
      expect(await pgError(c, MIG, [F.users.member, P, 'attendance.types', 'half', 'half'])).toMatchObject({ code: '22023', message: 'VOCAB_MIGRATE_INPUT' })
      expect(await pgError(c, MIG, [F.users.member, P, 'issues.cause_categories', 'it', 'process'])).toMatchObject({ message: 'VOCAB_MIGRATE_INPUT' })
      expect(await pgError(c, MIG, [F.users.member, P, 'attendance.types', 'half', 'ghost'])).toMatchObject({ code: '23514', message: 'PROJECT_VOCAB_INACTIVE:attendance.types:ghost' })
      expect(Number((await c.query(MIG, [F.users.member, P, 'attendance.types', 'half', 'annual'])).rows[0].n)).toBe(before)
      expect(Number((await c.query(`select count(*) from public.attendance_records where project_id = $1 and type = 'half'`, [P])).rows[0].count)).toBe(0)
      expect(await pgError(c, 'select public.settings_ref_check($1, $2, $3::jsonb, $4::jsonb)',
        [P, 'attendance.types', JSON.stringify(att()), JSON.stringify(att().filter(e => e.code !== 'half'))])).toBeNull()
    })
  })
  it('세션(authenticated)은 실행할 수 없다 — service_role 전용', async () => {
    await asUser(pool, F.users.member, async c => {
      expect(await pgError(c, MIG, [F.users.member, P, 'attendance.types', 'half', 'annual'])).toMatchObject({ code: '42501' })
    })
  })
})

describe('경합 — 두 연결(커밋된 상태로 보고 끝나면 되돌린다)', () => {
  async function waitBlocked(observer: PoolClient, pid: number): Promise<boolean> {
    for (let n = 0; n < 150; n++) {
      if ((await observer.query(`select wait_event_type = 'Lock' as b from pg_stat_activity where pid = $1`, [pid])).rows[0]?.b === true) return true
      await new Promise(r => setTimeout(r, 20))
    }
    return false
  }
  const outcome = (p: Promise<unknown>) => p.then(() => 'ok' as const, (e: unknown) => { if (e instanceof DatabaseError) return e; throw e })
  const orphanSql = `select count(*)::int as n from public.attendance_records r join public.project_settings s on s.project_id = r.project_id
    where r.project_id = $1 and not exists (select 1 from jsonb_array_elements(public.project_vocab_of(s."values", 'attendance.types')) e where e ->> 'code' = r.type)`
  let saved: unknown
  async function snapshot() { saved = (await pool.query('select "values" from public.project_settings where project_id = $1', [P])).rows[0].values }
  async function restore() {
    await pool.query('update public.project_settings set "values" = $2::jsonb where project_id = $1', [P, JSON.stringify(saved)])
    await pool.query(`delete from public.attendance_records where project_id = $1 and date between '2026-11-01' and '2026-11-30'`, [P])
    await pool.query(`delete from public.issues where project_id = $1 and title like 'B4 경합%'`, [P])
  }

  it('code 삭제가 먼저 잡으면 기다린 참조 insert 는 최신 설정으로 거부 — 고아 0', async () => {
    await snapshot()
    let s1: PoolClient | undefined, s2: PoolClient | undefined
    try {
      s1 = await pool.connect(); s2 = await pool.connect()
      const pid = (await s2.query('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin'); await s2.query('begin')
      await s1.query('select 1 from public.project_settings where project_id = $1 for update', [P])
      await setVocab(s1, 'attendance.types', att().filter(e => e.code !== 'trip'))
      const ins = outcome(s2.query(ATT, [P, MEMBER, '2026-11-02', 'trip']))
      expect(await waitBlocked(s1, pid), '참조 insert 가 설정 행 잠금을 기다린다').toBe(true)
      await s1.query('commit')
      expect(await ins).toMatchObject({ code: '23514', message: 'PROJECT_VOCAB_INACTIVE:attendance.types:trip' })
      await s2.query('rollback')
      expect((await s1.query(orphanSql, [P])).rows[0].n).toBe(0)
    } finally {
      await s1?.query('rollback').catch(() => undefined); await s2?.query('rollback').catch(() => undefined)
      s1?.release(); s2?.release(); await restore()
    }
  })

  it('참조 insert 가 먼저 잡으면 기다린 삭제는 그 참조를 세어 SETTINGS_CODE_IN_USE — 고아 0', async () => {
    await snapshot()
    let s1: PoolClient | undefined, s2: PoolClient | undefined
    try {
      s1 = await pool.connect(); s2 = await pool.connect()
      const pid = (await s2.query('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin'); await s2.query('begin')
      await s1.query(`delete from public.attendance_records where project_id = $1 and type = 'remote'`, [P])
      await s1.query('commit'); await s1.query('begin')
      await s1.query(ATT, [P, MEMBER, '2026-11-03', 'remote'])
      const rev = (await s2.query('select revision from public.project_settings where project_id = $1', [P])).rows[0].revision
      const apply = outcome(s2.query(`select public.apply_project_settings($1, $2, gen_random_uuid(), $3::jsonb, null, $4, 1, 'edit')`,
        [P, rev, JSON.stringify({ 'attendance.types': att().filter(e => e.code !== 'remote') }), F.users.wsAdmin]))
      expect(await waitBlocked(s1, pid), '설정 변경이 참조 쓰기의 FOR SHARE 를 기다린다').toBe(true)
      await s1.query('commit')
      expect(await apply).toMatchObject({ code: '23514', message: 'SETTINGS_CODE_IN_USE:attendance.types' })
      await s2.query('rollback')
      expect((await s1.query(orphanSql, [P])).rows[0].n).toBe(0)
    } finally {
      await s1?.query('rollback').catch(() => undefined); await s2?.query('rollback').catch(() => undefined)
      s1?.release(); s2?.release(); await restore()
    }
  })

  it('동시 편집 대 이관 — 교착은 한쪽만 40P01 이고 남은 쪽의 결과에 고아가 없다', async () => {
    await snapshot()
    let s1: PoolClient | undefined, s2: PoolClient | undefined
    try {
      const ids = (await pool.query(`insert into public.issues (project_id, title, severity) values ($1, 'B4 경합 1', 'medium'), ($1, 'B4 경합 2', 'low') returning id`, [P])).rows.map(r => r.id as string)
      s1 = await pool.connect(); s2 = await pool.connect()
      const pid = (await s2.query('select pg_backend_pid() as pid')).rows[0].pid
      await s1.query('begin'); await s2.query('begin')
      // s1: 이슈 1 의 제목만 고친다 — 행 잠금, 어휘 판정 없음(값 그대로)
      await s1.query(`update public.issues set title = 'B4 경합 1*' where id = $1`, [ids[0]])
      let settled = false
      // s2: medium → high 이관 — 설정 행 FOR UPDATE 뒤 이슈 1 행을 기다린다
      const mig = outcome(s2.query('select public.migrate_setting_code($1, $2, $3, $4, $5)', [F.users.member, P, 'issues.severities', 'medium', 'high'])).finally(() => { settled = true })
      expect(await waitBlocked(s1, pid), '이관이 이슈 행을 기다린다').toBe(true)
      expect(settled).toBe(false)
      // s1: 이슈 2 의 심각도를 바꾼다 — 트리거가 설정 행 FOR SHARE 를 기다린다 → 교착
      const edit = outcome(s1.query(`update public.issues set severity = 'medium' where id = $1`, [ids[1]]))
      const e = await edit
      if (e !== 'ok') await s1.query('rollback')
      const m = await mig
      const dead = [e, m].filter(x => x instanceof DatabaseError && x.code === '40P01')
      expect(dead, '정확히 한쪽이 교착 희생자').toHaveLength(1)
      if (e === 'ok') { await s2.query('rollback'); await s1.query('commit') } else { await s2.query('commit') }
      const { rows } = await s1.query(`select count(*)::int as n from public.issues i join public.project_settings s on s.project_id = i.project_id
        where i.project_id = $1 and not exists (select 1 from jsonb_array_elements(public.project_vocab_of(s."values", 'issues.severities')) x
          where x ->> 'code' = i.severity and (x ->> 'active')::boolean)`, [P])
      expect(rows[0].n).toBe(0)
    } finally {
      await s1?.query('rollback').catch(() => undefined); await s2?.query('rollback').catch(() => undefined)
      s1?.release(); s2?.release(); await restore()
    }
  })
})
