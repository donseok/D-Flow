// 워크스페이스 발송 메일 설정(*_workspace_mail_settings — 0059).
// ① 표는 service_role 전용 — RLS 켜짐·정책 0, anon·authenticated 의 표 권한 0. 세션은 읽지도 쓰지도 못한다(워크스페이스 관리자·플랫폼 관리자여도).
// ② 검사 제약 — 공백 계정·비밀번호(23514 workspace_mail_settings_login), 포트 넷, 포트-보안 짝, Gmail 고정값, 정규형 호스트, 빈 보내는 주소.
// ③ delete_empty_workspace 재정의 — 메일 설정 행은 부속 표다(함께 지워지고 removed 에 센다). 머리(DEFINER·search_path='')와 실행권은 0055 그대로.
// ④ 롤백 왕복 — 롤백이 함수를 0055 본문으로 되돌리고 표를 지우며, 다시 적용하면 같은 상태다.
// 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다. 마이그레이션은 번호가 아니라 접미로 찾는다(CLAUDE.md 데이터 규칙).
import { readFileSync, readdirSync } from 'node:fs'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const U = F.users
const ID = (nn: string) => `00000000-0000-4000-8000-0000000059${nn}`
const SLUG = 'rls-0059-empty'
const TABLE = 'public.workspace_mail_settings'
const FN = 'public.delete_empty_workspace(uuid, uuid, text)'
const DELETE = 'select public.delete_empty_workspace($1, $2, $3) as r'
const CREATE = 'select public.create_workspace_with_admin($1, $2, $3, $4, $5::jsonb, $6, $7) as r'
const INSERT = `insert into public.workspace_mail_settings (workspace_id, preset, host, port, secure, username, password, from_address)
                values ($1, $2, $3, $4, $5, $6, $7, $8)`

const sqlBySuffix = (dir: string, suffix: string) => {
  const hits = readdirSync(dir).filter((f) => f.endsWith(suffix))
  if (hits.length !== 1) throw new Error(`${dir} 에서 *${suffix} 가 ${hits.length}개다`)
  return readFileSync(`${dir}/${hits[0]}`, 'utf8')
}
/** 자체 begin;/commit; 을 걷어 이 연결의 트랜잭션 안에서 돈다(drop-agent-legacy.test.ts 와 같은 방식) */
const inTx = (sql: string) => sql.replace(/^begin;[ \t]*$/m, '').replace(/^commit;[ \t]*$/m, '')
const MIGRATION = inTx(sqlBySuffix('supabase/migrations', '_workspace_mail_settings.sql'))
const ROLLBACK = inTx(sqlBySuffix('supabase/rollbacks', '_workspace_mail_settings_rollback.sql'))

type Row = { preset: string; host: string; port: number; secure: boolean; username: string; password: string; from_address: string | null }
/** 검사 제약을 통과하는 기본 행(직접 입력·STARTTLS) — 케이스마다 한 칸씩 바꿔 넣는다 */
const BASE: Row = { preset: 'custom', host: 'smtp.example.com', port: 587, secure: false, username: 'mailer@example.com', password: 'app-pass', from_address: null }
const values = (ws: string, over: Partial<Row>) => {
  const r = { ...BASE, ...over }
  return [ws, r.preset, r.host, r.port, r.secure, r.username, r.password, r.from_address]
}
const mailCount = async (c: PoolClient, ws: string) =>
  (await c.query<{ n: number }>('select count(*)::int as n from public.workspace_mail_settings where workspace_id = $1', [ws])).rows[0].n
/** 빈 워크스페이스 하나 — 첫 관리자를 정해 만든다(0054 의 생성 RPC 그대로 — workspace-rename-delete.test.ts 와 같은 꼴) */
async function createEmpty(c: PoolClient, admin: string): Promise<string> {
  const { rows: [{ r }] } = await c.query<{ r: { workspace_id: string } }>(
    CREATE, [U.platform, SLUG, '빈 조직', admin, JSON.stringify({ 'modules.allowed': [] }), ID('c1'), 1])
  return r.workspace_id
}
type Deleted = { status: string; slug: string; name: string; removed?: Record<string, number>; remaining?: Record<string, number> }
const del = async (c: PoolClient, actor: string, ws: string, slug: string) =>
  (await c.query<{ r: Deleted }>(DELETE, [actor, ws, slug])).rows[0].r
/** 함수 머리·실행권 — 재정의·롤백이 DEFINER·search_path 를 잃지 않았는지 */
const fnShape = async (c: PoolClient) => (await c.query<{ definer: boolean; path: boolean; anon: boolean; auth: boolean; svc: boolean; mail: boolean }>(
  `select p.prosecdef as definer, coalesce('search_path=""' = any (p.proconfig), false) as path,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as svc, position('workspace_mail_settings' in p.prosrc) > 0 as mail
     from pg_proc p where p.oid = $1::regprocedure`, [FN])).rows[0]

describe('① 권한 — service_role 전용', () => {
  it('RLS 켜짐·정책 0 · FK 는 workspaces 캐스케이드, 두 행위자 열(auth.users)은 set null', async () => {
    const { rows: [rel] } = await pool.query<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'workspace_mail_settings') as policies
         from pg_class c where c.oid = $1::regclass`, [TABLE])
    expect(rel).toEqual({ rls: true, policies: 0 })
    const { rows: fks } = await pool.query<{ col: string; target: string; deltype: string }>(
      `select a.attname::text as col, n.nspname || '.' || t.relname as target, c.confdeltype::text as deltype
         from pg_constraint c
         join pg_class t on t.oid = c.confrelid
         join pg_namespace n on n.oid = t.relnamespace
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.conrelid = $1::regclass and c.contype = 'f' order by 1`, [TABLE])
    expect(fks).toEqual([
      { col: 'password_set_by', target: 'auth.users', deltype: 'n' },
      { col: 'updated_by', target: 'auth.users', deltype: 'n' },
      { col: 'workspace_id', target: 'public.workspaces', deltype: 'c' },
    ])
  })

  it('anon·authenticated 의 실효 권한 0(열 권한 포함), service_role 은 읽기·쓰기 넷', async () => {
    const { rows } = await pool.query<{ role: string; priv: string }>(
      `select r.role, p.priv
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p(priv)
        where has_table_privilege(r.role, $1::regclass, p.priv)
           or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') and has_any_column_privilege(r.role, $1::regclass, p.priv))
        order by 1, 2`, [TABLE])
    expect(rows.filter((r) => r.role !== 'service_role')).toEqual([])
    expect(rows.filter((r) => r.role === 'service_role').map((r) => r.priv)).toEqual(expect.arrayContaining(['DELETE', 'INSERT', 'SELECT', 'UPDATE']))
  })

  it('세션은 읽지도 쓰지도 못한다(42501 permission denied) — 그 워크스페이스의 관리자·플랫폼 관리자여도', async () => {
    for (const uid of [U.wsAdmin, U.platform]) {
      await asUser(pool, uid, async (c) => {
        const denied = { code: '42501', message: expect.stringContaining('permission denied for table workspace_mail_settings') }
        expect(await pgError(c, 'select * from public.workspace_mail_settings where workspace_id = $1', [F.ws]), `${uid}:select`).toMatchObject(denied)
        expect(await pgError(c, INSERT, values(F.wsB, {})), `${uid}:insert`).toMatchObject(denied)
        expect(await pgError(c, `update public.workspace_mail_settings set host = 'evil.example.com' where workspace_id = $1`, [F.ws]), `${uid}:update`)
          .toMatchObject(denied)
        expect(await pgError(c, 'delete from public.workspace_mail_settings where workspace_id = $1', [F.ws]), `${uid}:delete`).toMatchObject(denied)
      })
    }
  })

  it('anon 도 읽지 못한다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role anon')
      expect(await pgError(c, 'select * from public.workspace_mail_settings'))
        .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for table workspace_mail_settings') })
    })
  })

  it('service_role 은 읽고 쓴다 — 픽스처의 A 행이 보이고, B 에 새 행을 넣고 지운다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      const { rows } = await c.query<{ host: string; port: number }>('select host, port from public.workspace_mail_settings where workspace_id = $1', [F.ws])
      expect(rows).toEqual([{ host: 'smtp.rls.invalid', port: 2525 }])
      expect(await pgError(c, INSERT, values(F.wsB, {}))).toBeNull()
      expect((await c.query('delete from public.workspace_mail_settings where workspace_id = $1', [F.wsB])).rowCount).toBe(1)
    })
  })
})

describe('② 검사 제약', () => {
  it('공백뿐인 계정·비밀번호는 23514 workspace_mail_settings_login — 행이 미설정으로 읽히는 일이 없다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      for (const over of [{ username: '   ' }, { username: '' }, { password: ' \t ' }, { password: '' }] as Partial<Row>[]) {
        expect(await pgError(c, INSERT, values(F.wsB, over)), JSON.stringify(over))
          .toMatchObject({ code: '23514', constraint: 'workspace_mail_settings_login' })
      }
      expect(await mailCount(c, F.wsB)).toBe(0)
    })
  })

  it('포트 넷 밖·포트-보안 짝·Gmail 고정값·정규형 아닌 호스트·빈 보내는 주소·모르는 방식은 23514 — 제약 이름까지', async () => {
    const cases: [Partial<Row>, string][] = [
      [{ port: 2526 }, 'workspace_mail_settings_port_check'],
      [{ port: 8025 }, 'workspace_mail_settings_port_check'],
      [{ port: 465, secure: false }, 'workspace_mail_settings_tls'],
      [{ port: 587, secure: true }, 'workspace_mail_settings_tls'],
      [{ port: 25, secure: true }, 'workspace_mail_settings_tls'],
      [{ preset: 'gmail', host: 'smtp.gmail.com', port: 587, secure: false }, 'workspace_mail_settings_gmail'],
      [{ preset: 'gmail', host: 'smtp.example.com', port: 465, secure: true }, 'workspace_mail_settings_gmail'],
      [{ host: 'SMTP.example.com' }, 'workspace_mail_settings_host'],
      [{ host: 'smtp.example.com.' }, 'workspace_mail_settings_host'],
      [{ host: '' }, 'workspace_mail_settings_host'],
      [{ host: `${'a'.repeat(250)}.com` }, 'workspace_mail_settings_host'],
      [{ from_address: '  ' }, 'workspace_mail_settings_from'],
      [{ preset: 'outlook' }, 'workspace_mail_settings_preset_check'],
    ]
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      for (const [over, constraint] of cases) {
        expect(await pgError(c, INSERT, values(F.wsB, over)), JSON.stringify(over)).toMatchObject({ code: '23514', constraint })
      }
      expect(await mailCount(c, F.wsB)).toBe(0)
    })
  })

  it('통과 — Gmail 고정값, 465 SSL, 25 STARTTLS, 2525 는 어느 쪽이든, 보내는 주소 지정', async () => {
    const ok: Partial<Row>[] = [
      { preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'sender@gmail.com' },
      { port: 465, secure: true },
      { port: 25, secure: false },
      { port: 2525, secure: true },
      { port: 2525, secure: false },
      { from_address: 'noreply@example.com' },
    ]
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      for (const over of ok) {
        expect(await pgError(c, INSERT, values(F.wsB, over)), JSON.stringify(over)).toBeNull()
        await c.query('delete from public.workspace_mail_settings where workspace_id = $1', [F.wsB])
      }
      // 기본값: 비밀번호 설정 시각·갱신 시각은 now(), 행위자 열은 null
      await c.query(INSERT, values(F.wsB, {}))
      const { rows: [row] } = await c.query<{ set_at: boolean; upd_at: boolean; set_by: string | null; updated_by: string | null }>(
        `select password_set_at = now() as set_at, updated_at = now() as upd_at, password_set_by as set_by, updated_by
           from public.workspace_mail_settings where workspace_id = $1`, [F.wsB])
      expect(row).toEqual({ set_at: true, upd_at: true, set_by: null, updated_by: null })
    })
  })

  it('워크스페이스당 한 행 — 같은 워크스페이스에 둘째 행은 23505', async () => {
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      expect(await pgError(c, INSERT, values(F.ws, {}))).toMatchObject({ code: '23505' })
    })
  })
})

describe('③ delete_empty_workspace — 메일 설정은 부속 표', () => {
  it('재정의가 머리를 잃지 않았다 — SECURITY DEFINER·search_path 빈 값·service_role 전용, 본문에 새 부속 표', async () => {
    expect(await asService(pool, fnShape)).toEqual({ definer: true, path: true, anon: false, auth: false, svc: true, mail: true })
  })

  it('메일 설정만 저장한 빈 워크스페이스도 지운다 — 메일 설정 행이 함께 사라지고 removed 에 센다', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.platform)
      await c.query(INSERT, values(ws, { preset: 'gmail', host: 'smtp.gmail.com', port: 465, secure: true }))
      expect(await mailCount(c, ws)).toBe(1)
      const others = [await mailCount(c, F.ws), await mailCount(c, F.wsB)]
      await c.query('set local role service_role')
      const r = await del(c, U.platform, ws, SLUG)
      await c.query('reset role')
      expect(r).toEqual({
        status: 'deleted', slug: SLUG, name: '빈 조직',
        removed: { workspace_settings: 1, workspace_settings_history: 1, workspace_mail_settings: 1 },
      })
      expect(await mailCount(c, ws)).toBe(0)
      expect([await mailCount(c, F.ws), await mailCount(c, F.wsB)]).toEqual(others)
    })
  })

  it('자료가 있는 워크스페이스(A)는 거부한다 — 메일 설정 행은 남은 것으로 세지 않고 지워지지도 않는다', async () => {
    await asService(pool, async (c) => {
      expect(await mailCount(c, F.ws), '픽스처 A 행').toBe(1)
      const { rows: [{ slug }] } = await c.query<{ slug: string }>('select slug from public.workspaces where id = $1', [F.ws])
      const r = await del(c, U.platform, F.ws, slug)
      expect(r.status).toBe('blocked')
      expect(r.remaining).not.toHaveProperty('workspace_mail_settings')
      expect(await mailCount(c, F.ws)).toBe(1)
    })
  })

  it('메일 설정 행이 있어도 등급 재판정은 그대로 — 그 워크스페이스의 관리자는 지우지 못한다(AUTHZ_FORBIDDEN)', async () => {
    await asService(pool, async (c) => {
      const ws = await createEmpty(c, U.aLoose)
      await c.query(INSERT, values(ws, {}))
      expect(await pgError(c, DELETE, [U.aLoose, ws, SLUG])).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      expect(await mailCount(c, ws)).toBe(1)
    })
  })
})

describe('④ 롤백 왕복', () => {
  it('롤백은 함수를 0055 꼴(부속 넷·같은 머리·같은 실행권)로 되돌리고 표를 지운다 — 다시 적용하면 같은 상태다', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query(ROLLBACK)
      expect((await c.query<{ t: string | null }>(`select to_regclass('public.workspace_mail_settings')::text as t`)).rows[0].t).toBeNull()
      expect(await fnShape(c)).toEqual({ definer: true, path: true, anon: false, auth: false, svc: true, mail: false })
      await c.query(MIGRATION)
      expect((await c.query<{ t: string | null }>(`select to_regclass('public.workspace_mail_settings')::text as t`)).rows[0].t).toBe('workspace_mail_settings')
      expect(await fnShape(c)).toEqual({ definer: true, path: true, anon: false, auth: false, svc: true, mail: true })
    } finally {
      await c.query('rollback')
      c.release()
    }
  })
})
