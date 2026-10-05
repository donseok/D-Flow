import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => {
  pool = openPool()
  await loadFixture(pool)
})
afterAll(async () => {
  await pool?.end()
})

describe('0039 authz_legacy_cleanup — 옛 가져오기 RPC 및 teams 쓰기 권한 회수', () => {
  it('옛 가져오기 RPC 3종은 authenticated 실행권이 없고 호출 시 42501 permission denied', async () => {
    await asUser(pool, F.users.member, async (c) => {
      const err1 = await pgError(c, 'select public.import_wbs($1, $2::jsonb, null)', [
        F.projects.a,
        JSON.stringify([{ tempId: 't1', code: '1', name: '테스트' }]),
      ])
      expect(err1?.code).toBe('42501')
      expect(err1?.message).toContain('permission denied for function import_wbs')

      const err2 = await pgError(c, 'select public.replace_wbs($1, $2::jsonb, null)', [
        F.projects.a,
        JSON.stringify([{ tempId: 't1', code: '1', name: '테스트' }]),
      ])
      expect(err2?.code).toBe('42501')
      expect(err2?.message).toContain('permission denied for function replace_wbs')

      const err3 = await pgError(c, 'select public.import_wbs_upsert($1, $2::jsonb, null)', [
        F.projects.a,
        JSON.stringify([{ tempId: 't1', code: '1', name: '테스트' }]),
      ])
      expect(err3?.code).toBe('42501')
      expect(err3?.message).toContain('permission denied for function import_wbs_upsert')
    })

    const { rows } = await pool.query<{ name: string; auth_ok: boolean; srv_ok: boolean }>(`
      select p.proname as name,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as srv_ok
        from pg_proc p
       where p.oid in (
         'public.import_wbs(uuid, jsonb, jsonb)'::regprocedure,
         'public.replace_wbs(uuid, jsonb, jsonb)'::regprocedure,
         'public.import_wbs_upsert(uuid, jsonb, uuid)'::regprocedure
       )
       order by p.proname
    `)

    expect(rows).toEqual([
      { name: 'import_wbs', auth_ok: false, srv_ok: true },
      { name: 'import_wbs_upsert', auth_ok: false, srv_ok: true },
      { name: 'replace_wbs', auth_ok: false, srv_ok: true },
    ])
  })

  it('teams 표는 authenticated 쓰기(INSERT/UPDATE/DELETE)가 차단되고 SELECT 만 허용된다', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      // SELECT 가능
      const sel = await c.query('select count(*)::int as cnt from public.teams')
      expect(sel.rows[0].cnt).toBeGreaterThanOrEqual(0)

      // INSERT 불가
      const insErr = await pgError(
        c,
        "insert into public.teams (workspace_id, code, name) values ($1, 'RLSX', 'RLSX')",
        [F.ws],
      )
      expect(insErr?.code).toBe('42501')
      expect(insErr?.message).toContain('permission denied for table teams')

      // UPDATE 불가
      const updErr = await pgError(
        c,
        "update public.teams set name = 'HACKED' where workspace_id = $1",
        [F.ws],
      )
      expect(updErr?.code).toBe('42501')
      expect(updErr?.message).toContain('permission denied for table teams')

      // DELETE 불가
      const delErr = await pgError(
        c,
        'delete from public.teams where workspace_id = $1',
        [F.ws],
      )
      expect(delErr?.code).toBe('42501')
      expect(delErr?.message).toContain('permission denied for table teams')
    })
  })

  it('teams 제약조건: code 길이(<=20), name 공백/제어문자 방어', async () => {
    await asService(pool, async (c) => {
      // code > 20자 거부
      const longCodeErr = await pgError(
        c,
        "insert into public.teams (workspace_id, code, name) values ($1, '123456789012345678901', '정상')",
        [F.ws],
      )
      expect(longCodeErr?.code).toBe('23514')
      expect(longCodeErr?.message).toContain('teams_code_len_check')

      // code 제어문자 포함 거부
      const ctrlCodeErr = await pgError(
        c,
        "insert into public.teams (workspace_id, code, name) values ($1, E'CODE\\nTEST', '정상')",
        [F.ws],
      )
      expect(ctrlCodeErr?.code).toBe('23514')
      expect(ctrlCodeErr?.message).toContain('teams_code_len_check')

      // name 제어문자 포함 거부
      const ctrlNameErr = await pgError(
        c,
        "insert into public.teams (workspace_id, code, name) values ($1, 'VALID', E'NAME\\nTEST')",
        [F.ws],
      )
      expect(ctrlNameErr?.code).toBe('23514')
      expect(ctrlNameErr?.message).toContain('teams_name_check')

      // name 앞뒤 공백 거부
      const trimNameErr = await pgError(
        c,
        "insert into public.teams (workspace_id, code, name) values ($1, 'VALID2', '  공백이름  ')",
        [F.ws],
      )
      expect(trimNameErr?.code).toBe('23514')
      expect(trimNameErr?.message).toContain('teams_name_check')

      // name 빈 문자열 거부
      const emptyNameErr = await pgError(
        c,
        "insert into public.teams (workspace_id, code, name) values ($1, 'VALID3', '')",
        [F.ws],
      )
      expect(emptyNameErr?.code).toBe('23514')
      expect(emptyNameErr?.message).toContain('teams_name_check')
    })
  })
})
