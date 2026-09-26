// 스키마 불변식 — 로컬 DB 카탈로그(pg_constraint)에서 본다. npm run test:rls 로 돈다(DB 가 떠 있어야 한다).
//
// 같은 public 표 쌍(자식 → 부모) 사이의 FK 는 하나다. 둘 이상이면 PostgREST 가 그 쌍의 임베드(`select('…, meetings(…)')`)를
// PGRST201("more than one relationship was found")로 거부해 조회가 통째로 실패한다 — 0003 이 단일 FK 를 남긴 채 복합 FK 를
// 더해 회의 목록·알림함이 빈 값이 된 결함(SP1 Task 11 E2E 실측, Task 3d 에서 수정)이 다시 들어오지 않게 막는다.
//
// 허용 목록은 기준선(0000)부터 있던 두 쌍뿐이다. 둘 다 서로 다른 컬럼(선행·후행, from·to)이 같은 부모를 가리키는 정당한
// 이중 관계이고, src 는 이 쌍을 임베드하지 않는다(2026-09-25 grep — task_dependencies 조회는 평면 컬럼만, wiki_item_relations
// 는 src 에서 읽지 않는다). 임베드가 필요해지면 `wbs_items!task_dependencies_predecessor_fk(…)` 처럼 FK 이름 힌트를 쓴다.
// 허용 쌍도 FK 이름 목록까지 고정한다 — 같은 쌍에 세 번째 FK 가 붙으면 실패한다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, openPool } from './harness'

let pool: Pool

beforeAll(() => {
  pool = openPool()
})

afterAll(async () => {
  await pool?.end()
})

const ALLOWED_MULTI_FK_PAIRS: Record<string, string[]> = {
  'task_dependencies → wbs_items': ['task_dependencies_predecessor_fk', 'task_dependencies_successor_fk'],
  'wiki_item_relations → wiki_items': ['wiki_item_relations_from_item_id_fkey', 'wiki_item_relations_to_item_id_fkey'],
}

const MULTI_FK_PAIRS_SQL = `
  select ch.relname as child, pa.relname as parent, array_agg(c.conname::text order by c.conname) as fks
    from pg_constraint c
    join pg_class ch on ch.oid = c.conrelid
    join pg_class pa on pa.oid = c.confrelid
   where c.contype = 'f'
     and ch.relnamespace = 'public'::regnamespace
     and pa.relnamespace = 'public'::regnamespace
   group by ch.relname, pa.relname
  having count(*) >= 2
   order by ch.relname, pa.relname`

describe('스키마 불변식', () => {
  it('같은 public 표 쌍 사이 FK 는 하나(기준선 허용 2쌍 제외) — PostgREST 임베드 모호성(PGRST201) 방지', async () => {
    const rows = await asService(pool, async (c) =>
      (await c.query<{ child: string; parent: string; fks: string[] }>(MULTI_FK_PAIRS_SQL)).rows)

    const found = new Map(rows.map((r) => [`${r.child} → ${r.parent}`, r.fks]))
    const violations = [...found]
      .filter(([pair, fks]) => JSON.stringify(ALLOWED_MULTI_FK_PAIRS[pair]) !== JSON.stringify(fks))
      .map(([pair, fks]) => `${pair}: ${fks.join(', ')}`)
    expect(violations, `같은 표 쌍에 FK 가 2개 이상(허용 목록 밖):\n  ${violations.join('\n  ')}`).toEqual([])

    // 허용 목록이 낡으면(쌍이 사라지거나 FK 가 하나로 줄면) 목록도 줄인다 — 죽은 예외를 남기지 않는다
    const stale = Object.keys(ALLOWED_MULTI_FK_PAIRS).filter((pair) => !found.has(pair))
    expect(stale, `허용 목록의 쌍이 더는 FK 2개 이상이 아니다 — 목록에서 뺀다: ${stale.join(', ')}`).toEqual([])
  })

  // 개방 읽기 0(D2 예외 1): SELECT·ALL 정책 중 본문이 true 이거나 스코프 헬퍼·auth.uid() 를 하나도 부르지 않는 것.
  // 0006 ⑧ 사후검증(정책 ilike '%app_role%')과 같은 판정을 CI·로컬 어디서든 vitest 로 다시 돈다.
  const SCOPE_MARKERS = ['accessible_project_ids', 'my_workspace_ids', 'is_ws_member', 'is_ws_admin', 'can_read_project',
    'is_project_member', 'is_project_admin', 'is_superuser', 'auth.uid()', 'can_attach', 'can_edit_issue']
  const OPEN_READ_EXCEPTIONS: Record<string, string> = {
    'issue_mega_areas.read_all_issue_mega_areas': 'D2 — 전역 참조 데이터(테넌트 행 없음). 만료: SP5 에서 표가 프로젝트 영역으로 대체',
  }
  it('개방 읽기 정책 0건(D2 예외 1)', async () => {
    const rows = await asService(pool, async (c) => (await c.query<{ k: string; qual: string | null }>(
      `select tablename || '.' || policyname as k, qual from pg_policies where schemaname = 'public' and cmd in ('SELECT', 'ALL')`)).rows)
    const open = rows.filter((r) => r.qual === 'true' || !SCOPE_MARKERS.some((m) => (r.qual ?? '').includes(m))).map((r) => r.k)
    expect(open.filter((k) => !(k in OPEN_READ_EXCEPTIONS))).toEqual([])
    expect(Object.keys(OPEN_READ_EXCEPTIONS).filter((k) => !open.includes(k)), '죽은 예외').toEqual([])
  })

  it('app_role 참조 0건(함수·정책, storage·realtime 포함)', async () => {
    const { rows } = await pool.query<{ what: string }>(
      `select 'fn ' || proname as what from pg_proc where prosrc ilike '%app_role%'
       union all select 'policy ' || schemaname || '.' || tablename || '.' || policyname from pg_policies
        where coalesce(qual, '') || coalesce(with_check, '') ilike '%app_role%'`)
    expect(rows.map((r) => r.what)).toEqual([])
  })

  // 정책이 부르는 함수는 전부 SECURITY DEFINER 여야 한다 — INVOKER 면 그 함수 자신의 쿼리가 호출부 세션의 RLS 를
  // 받으므로, 0006 ⑧ 의 표-쌍 순환 검사(정책이 직접 참조하는 표만 본다)가 보지 못하는 순환이 그 함수를 거쳐 생길
  // 수 있다(Task 2 리뷰 이월). 허용 목록은 지금 비어 있다 — INVOKER 로도 안전하다고 확인된 함수가 생기면 근거와
  // 함께 여기 추가한다.
  const POLICY_CALLED_INVOKER_ALLOWLIST: string[] = []
  it('정책이 부르는 public 함수는 전부 SECURITY DEFINER(허용 목록 밖 INVOKER 0건)', async () => {
    const rows = await asService(pool, async (c) => (await c.query<{ proname: string; prosecdef: boolean }>(`
      with pol as (
        select coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
          from pg_policies where schemaname = 'public'
      ), fn as (
        select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace
      )
      select distinct fn.proname, fn.prosecdef from pol join fn
        on pol.body ~ ('(^|[^A-Za-z0-9_])(public\\.)?' || fn.proname || '\\s*\\(')`)).rows)
    const invokerNotAllowed = rows.filter((r) => !r.prosecdef && !POLICY_CALLED_INVOKER_ALLOWLIST.includes(r.proname)).map((r) => r.proname)
    expect(invokerNotAllowed, `정책이 부르는 INVOKER 함수(허용 목록 밖):\n  ${invokerNotAllowed.join('\n  ')}`).toEqual([])
    const stale = POLICY_CALLED_INVOKER_ALLOWLIST.filter((n) => !rows.some((r) => r.proname === n))
    expect(stale, `죽은 허용 목록 항목: ${stale.join(', ')}`).toEqual([])
  })

  // 정책 헬퍼(SECURITY DEFINER) 의 EXECUTE — PostgREST 로 익명(anon)이 직접 부를 수 있으면 그 판정을 RLS 밖에서
  // 오라클처럼 굴려 정보를 캘 수 있다(0006 ⑦). anon·PUBLIC 은 항상 없어야 하고, 나머지는 authenticated 뿐이어야
  // 한다 — item_owned_by_my_team 은 Task 2 에서 새로 생긴 헬퍼(회귀 42P17 을 끊으려 추가)라 여기 목록에 이월됐다.
  const HELPER_FNS = [
    'public.is_superuser()', 'public.my_workspace_ids()', 'public.is_ws_member(uuid)', 'public.is_ws_admin(uuid)',
    'public.accessible_project_ids()', 'public.can_read_project(uuid)', 'public.is_project_admin(uuid)',
    'public.is_project_member(uuid)', 'public.is_project_admin_anywhere_in_ws(uuid)', 'public.my_member_id(uuid)',
    'public.my_team_ids(uuid)', 'public.can_attach(uuid)', 'public.can_edit_issue(uuid)', 'public.wbs_is_leaf(uuid)',
    'public.item_owned_by_my_team(uuid, uuid)',
  ]
  async function executeGrantees(c: PoolClient, fns: string[]) {
    return (await c.query<{ fn: string; named_grantees: string[]; has_public: boolean }>(`
      select f.fn,
        coalesce(array_agg(distinct a.grantee::regrole::text) filter (where a.privilege_type = 'EXECUTE' and a.grantee <> 0), '{}') as named_grantees,
        bool_or(a.privilege_type = 'EXECUTE' and a.grantee = 0) as has_public
      from unnest($1::text[]) as f(fn)
      join pg_proc p on p.oid = f.fn::regprocedure
      left join lateral aclexplode(p.proacl) a on true
      group by f.fn`, [fns])).rows
  }
  it('정책 헬퍼 EXECUTE 는 authenticated 뿐, anon·PUBLIC 없음(item_owned_by_my_team 포함)', async () => {
    const rows = await asService(pool, (c) => executeGrantees(c, HELPER_FNS))
    expect(rows.map((r) => r.fn).sort()).toEqual([...HELPER_FNS].sort())
    const bad = rows.filter((r) => r.has_public || r.named_grantees.includes('anon') || !r.named_grantees.includes('authenticated'))
      .map((r) => `${r.fn}: public=${r.has_public} grantees=${r.named_grantees.join(',')}`)
    expect(bad, `정책 헬퍼 EXECUTE 위반:\n  ${bad.join('\n  ')}`).toEqual([])
  })
  it('project_ws EXECUTE 는 service_role 뿐(R3 분기 A) — authenticated·anon·PUBLIC 없음', async () => {
    const [row] = await asService(pool, (c) => executeGrantees(c, ['public.project_ws(uuid)']))
    expect(row.has_public).toBe(false)
    expect(row.named_grantees).not.toContain('anon')
    expect(row.named_grantees).not.toContain('authenticated')
  })
})
