// 픽스처 계정(auth.users)의 GoTrue 문자열 열 — NULL 이면 같은 DB 의 GoTrue `admin/users` 가 500("converting NULL to string is
// unsupported")이 되어, 그 목록을 읽는 화면(사용 현황 등)이 오류 경계로 간다. 기본값이 없는 네 열을 픽스처가 '' 로 넣고, 예전 픽스처가
// NULL 로 남긴 행도 loadFixture 가 '' 로 고친다(기본값 '' 인 나머지 네 열도 함께 본다).
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadFixture, openPool } from './harness'

const TOKEN_COLS = [
  'confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
  'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token',
] as const

let pool: Pool
beforeAll(async () => { pool = openPool() })
afterAll(async () => { await pool?.end() })

const nullRows = async () => (await pool.query<{ email: string }>(
  `select email from auth.users where email like 'rls-%@example.com' and (${TOKEN_COLS.map((c) => `${c} is null`).join(' or ')}) order by email`,
)).rows.map((r) => r.email)

describe('RLS 픽스처 계정의 GoTrue 문자열 열', () => {
  it('픽스처를 흘린 뒤 rls- 계정 일곱의 토큰 열에 NULL 이 없다', async () => {
    await loadFixture(pool)
    const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from auth.users where email like 'rls-%@example.com'`)
    expect(rows[0].n).toBe(7)
    expect(await nullRows()).toEqual([])
  })

  it('예전 픽스처가 NULL 로 남긴 행도 다시 흘리면 고쳐진다(다른 열은 건드리지 않는다)', async () => {
    const id = '00000000-0000-0000-7e57-0000000000a3'
    const before = (await pool.query(`select encrypted_password, email_confirmed_at, updated_at from auth.users where id = $1`, [id])).rows[0]
    await pool.query(`update auth.users set ${TOKEN_COLS.slice(0, 4).map((c) => `${c} = null`).join(', ')} where id = $1`, [id])
    expect(await nullRows()).toEqual(['rls-alice@example.com'])
    await loadFixture(pool)
    expect(await nullRows()).toEqual([])
    const after = (await pool.query(`select encrypted_password, email_confirmed_at, updated_at from auth.users where id = $1`, [id])).rows[0]
    expect(after).toEqual(before)
  })
})
