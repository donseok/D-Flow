// 0011 사후검증 블록의 민감도 — 마이그레이션 파일의 do 블록을 그대로 꺼내 지금 카탈로그에서 돌리고(통과), 그 블록이 막으려는 상태를
// 롤백하는 트랜잭션 안에서 만든 뒤 다시 돌린다(AUTHZ_0011_POSTCHECK). 블록은 읽기만 하므로 적용 뒤에 다시 돌려도 된다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool() })
afterAll(async () => { await pool?.end() })

const MIGRATION = readFileSync(fileURLToPath(new URL('../../supabase/migrations/0011_authz_hardening.sql', import.meta.url)), 'utf8')
const BLOCKS = MIGRATION.match(/^do \$\$\n[\s\S]*?^end \$\$;$/gm) ?? []
/** 오류 문구 조각으로 사후검증 블록 하나를 고른다(둘 이상이거나 없으면 실패) */
function block(marker: string): string {
  const found = BLOCKS.filter((b) => b.includes(marker))
  expect(found, marker).toHaveLength(1)
  return found[0]
}
const POSTCHECK = { message: expect.stringContaining('AUTHZ_0011_POSTCHECK') }
/** 롤백하는 트랜잭션에서 mutate 뒤 블록을 돌려 오류를 돌려준다 */
async function runAfter(sql: string, mutate: string[]) {
  return asService(pool, async (c: PoolClient) => {
    for (const m of mutate) await c.query(m)
    return pgError(c, sql)
  })
}

describe('0011 사후검증 블록', () => {
  it('② 기본 권한 — 스키마를 지정하지 않은(전역) 기본 권한의 TRUNCATE 도 잡는다', async () => {
    const sql = block('기본 권한이 남았다')
    expect(await runAfter(sql, [])).toBeNull()
    expect(await runAfter(sql, ['alter default privileges for role postgres in schema public grant truncate on tables to authenticated']))
      .toMatchObject(POSTCHECK)
    // 전역 항목(defaclnamespace 0)은 스키마 항목에 더해진다 — 뒤에 만드는 표가 TRUNCATE 를 다시 받는다
    expect(await runAfter(sql, ['alter default privileges for role postgres grant truncate on tables to authenticated']))
      .toMatchObject(POSTCHECK)
  })

  it('④ workspace_members — role 밖 열의 UPDATE(authenticated 직접 또는 PUBLIC)를 잡는다', async () => {
    const sql = block('workspace_members UPDATE 권한이 role 열만이 아니다')
    expect(await runAfter(sql, [])).toBeNull()
    expect(await runAfter(sql, ['grant update on public.workspace_members to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(sql, ['grant update (user_id, workspace_id) on public.workspace_members to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(sql, ['grant update (invited_by) on public.workspace_members to public'])).toMatchObject(POSTCHECK)
  })

  it('⑪ 트리거 — 꺼짐(D)뿐 아니라 복제 세션에서만 도는 것(R)도 잡는다. 항상(A)은 평소 세션에서 돌므로 통과', async () => {
    // SP5b(D11 — 의도적 수정 표): apply_workflow_event 가 9인자가 됐다 — 블록 안 옛 시그니처 리터럴을 지금 카탈로그의 시그니처로 바꿔 같은 검사를 돈다
    const { rows: [cur] } = await pool.query<{ sig: string }>(
      `select 'public.' || p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'apply_workflow_event'`)
    const sql = block('트리거가 없다: %').replaceAll('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', cur.sig)
    expect(await runAfter(sql, [])).toBeNull()
    expect(await runAfter(sql, ['alter table public.wbs_items disable trigger guard_workflow_actual'])).toMatchObject(POSTCHECK)
    expect(await runAfter(sql, ['alter table public.wbs_items enable replica trigger guard_workflow_actual'])).toMatchObject(POSTCHECK)
    expect(await runAfter(sql, ['alter table public.wbs_items enable always trigger guard_workflow_actual'])).toBeNull()
  })
})
