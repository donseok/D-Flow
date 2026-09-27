// H2-c(AUTH-10a) — 회의록을 읽는 멤버도 share_token 은 읽지 못한다(42501). 나머지 열은 그대로 읽고, 다른 표의 정책이 minutes 를
// 서브쿼리로 읽어도 깨지지 않는다. 새 열을 더하고 grant 를 잊으면 불변식이 잡는다. 토큰은 서버 경로(service_role)만 읽고 쓴다.
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

describe('H2-c minutes.share_token 열 권한', () => {
  it('회의록을 읽는 멤버(alice)도 share_token·* 는 42501, 나머지 열은 읽는다', async () => {
    await asUser(pool, F.users.member, async (c) => {
      expect(await pgError(c, 'select share_token from public.minutes where id = $1', [F.rows.minute])).toMatchObject({ code: '42501' })
      expect(await pgError(c, 'select * from public.minutes where id = $1', [F.rows.minute])).toMatchObject({ code: '42501' })
      const { rows } = await c.query(
        'select id, title, body_md, share_enabled, archived_at, project_id, workspace_id, created_by from public.minutes where id = $1',
        [F.rows.minute])
      expect(rows).toHaveLength(1)
    })
  })

  it('share_token 외 모든 열은 authenticated SELECT 가 있다 — 표 SELECT 는 없다', async () => {
    const { rows } = await pool.query<{ col: string; ok: boolean }>(
      `select a.attname::text as col, has_column_privilege('authenticated', 'public.minutes'::regclass, a.attname, 'SELECT') as ok
         from pg_attribute a where a.attrelid = 'public.minutes'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`)
    expect(rows.length).toBeGreaterThanOrEqual(19)
    expect(rows.filter((r) => r.col !== 'share_token' && !r.ok).map((r) => r.col)).toEqual([])
    expect(rows.find((r) => r.col === 'share_token')?.ok).toBe(false)
    const { rows: [t] } = await pool.query(
      `select has_table_privilege('authenticated', 'public.minutes', 'SELECT') as auth, has_table_privilege('anon', 'public.minutes', 'SELECT') as anon`)
    expect(t).toEqual({ auth: false, anon: false })
  })

  it('다른 표의 정책이 minutes 를 읽어도 42501 이 나지 않는다(첨부·하이라이트·인사이트·즐겨찾기 읽기)', async () => {
    await asUser(pool, F.users.member, async (c) => {
      for (const t of ['minute_files', 'minute_highlights', 'minute_insights', 'minute_favorites']) {
        expect(await pgError(c, `select 1 from public.${t} where minute_id = $1`, [F.rows.minute]), t).toBeNull()
      }
    })
  })

  it('서버 경로(service_role)는 share_token 을 읽고 쓴다 — 편집자의 공개 설정 경로', async () => {
    // asService 는 postgres(minutes 소유자)라 service_role 의 grant 를 보지 못한다 — 롤을 실제로 바꿔 readShareRow·setMinuteShare 의 권한을 탄다
    await asService(pool, async (c) => {
      await c.query('set local role service_role')
      expect((await c.query<{ r: string }>('select current_user::text as r')).rows[0].r).toBe('service_role')
      const TOKEN = '00000000-0000-0000-7e57-000000001210'
      await c.query('update public.minutes set share_token = $2, share_enabled = true where id = $1', [F.rows.minute, TOKEN])
      expect((await c.query('select share_token from public.minutes where id = $1', [F.rows.minute])).rows[0].share_token).toBe(TOKEN)
    })
  })
})
