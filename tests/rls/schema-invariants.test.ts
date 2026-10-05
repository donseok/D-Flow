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
import { isScopedQual } from '../../scripts/lib/rls-scope.mjs'
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

  // 개방 읽기 0(예외 2): SELECT·ALL 정책 중 본문이 true 이거나 스코프 헬퍼·auth.uid() 비교를 하나도 부르지 않는 것.
  // 0006 ⑧ 사후검증(정책 ilike '%app_role%')과 같은 판정을 CI·로컬 어디서든 vitest 로 다시 돈다. public 뿐 아니라
  // storage(버킷 읽기)·realtime(채널 join)도 본다(Task 4 리뷰 이월 — 이 두 스키마 정책도 헬퍼로 스코프를 건다).
  // 판정(isScopedQual) 은 scripts/lib/rls-scope.mjs 순수 모듈 — auth.uid() 단독 존재(`is not null`)는 스코프로
  // 치지 않는다(리뷰 라운드 1). tests/scripts/rls-scope.test.ts 가 그 경계를 DB 없이 고정한다.
  const OPEN_READ_EXCEPTIONS: Record<string, string> = {
    'realtime.messages.receive_own_notification_channel':
      "SP1 — topic = 'user-' || auth.uid() || '-notifications'(본인 채널만). auth.uid() 가 문자열 조합 안에 있어 판정기의 '= auth.uid()' 비교로 읽히지 않는다",
  }
  it('개방 읽기 정책 0건(public·storage·realtime, 예외 2)', async () => {
    const rows = await asService(pool, async (c) => (await c.query<{ k: string; qual: string | null }>(
      `select schemaname || '.' || tablename || '.' || policyname as k, qual from pg_policies
        where schemaname in ('public', 'storage', 'realtime') and cmd in ('SELECT', 'ALL')`)).rows)
    const open = rows.filter((r) => r.qual === 'true' || !isScopedQual(r.qual)).map((r) => r.k)
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
  // 수 있다(Task 2 리뷰 이월). 정책은 public·storage·realtime 셋을 본다(Task 4 리뷰 이월). 허용 목록은 표를 읽지 않는
  // immutable 순수 함수뿐이다 — 순환이 생길 쿼리가 없다. 아래 테스트가 그 전제(immutable·INVOKER)도 같이 고정한다.
  const POLICY_CALLED_INVOKER_ALLOWLIST: Record<string, string> = {
    form_template_path_project: 'SP6 — immutable form path parser, no table access',
    uuid_or_null: '0007 — immutable UUID parser, now directly used by the form bucket policy; no table access',
    storage_ws: '0007 — 객체 이름 세그먼트 파싱, 표 접근 없음',
    storage_project: '0007 — 객체 이름 세그먼트 파싱, 표 접근 없음',
    storage_entity_id: '0007 — 객체 이름 세그먼트 파싱, 표 접근 없음',
    presence_topic_project: '0007 — presence 토픽 정규식 파싱, 표 접근 없음',
  }
  it('정책(public·storage·realtime)이 부르는 public 함수는 전부 SECURITY DEFINER(허용 목록 밖 INVOKER 0건)', async () => {
    const rows = await asService(pool, async (c) => (await c.query<{ proname: string; prosecdef: boolean; provolatile: string }>(`
      with pol as (
        select coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
          from pg_policies where schemaname in ('public', 'storage', 'realtime')
      ), fn as (
        select proname, prosecdef, provolatile from pg_proc where pronamespace = 'public'::regnamespace
      )
      select distinct fn.proname, fn.prosecdef, fn.provolatile::text from pol join fn
        on pol.body ~ ('(^|[^A-Za-z0-9_])(public\\.)?' || fn.proname || '\\s*\\(')`)).rows)
    const invokerNotAllowed = rows.filter((r) => !r.prosecdef && !(r.proname in POLICY_CALLED_INVOKER_ALLOWLIST)).map((r) => r.proname)
    expect(invokerNotAllowed, `정책이 부르는 INVOKER 함수(허용 목록 밖):\n  ${invokerNotAllowed.join('\n  ')}`).toEqual([])
    const stale = Object.keys(POLICY_CALLED_INVOKER_ALLOWLIST).filter((n) => !rows.some((r) => r.proname === n))
    expect(stale, `죽은 허용 목록 항목: ${stale.join(', ')}`).toEqual([])
    const notPure = rows.filter((r) => r.proname in POLICY_CALLED_INVOKER_ALLOWLIST && (r.prosecdef || r.provolatile !== 'i')).map((r) => r.proname)
    expect(notPure, `허용 목록 함수가 immutable INVOKER 가 아니다(근거가 바뀌었다): ${notPure.join(', ')}`).toEqual([])
  })

  // 정책 헬퍼(SECURITY DEFINER) 의 EXECUTE — PostgREST 로 익명(anon)이 직접 부를 수 있으면 그 판정을 RLS 밖에서
  // 오라클처럼 굴려 정보를 캘 수 있다(0006 ⑦). anon·PUBLIC 은 항상 없어야 하고, 나머지는 authenticated 뿐이어야
  // 한다 — item_owned_by_my_team 은 Task 2 에서 새로 생긴 헬퍼(회귀 42P17 을 끊으려 추가)라 여기 목록에 이월됐다.
  // 0007 이 만든 헬퍼 일곱(Storage 경로 파싱 넷·회의록 본문 경로·presence 토픽·minute_files 술어)도 같은 규칙이다.
  const HELPER_FNS = [
    'public.is_superuser()', 'public.my_workspace_ids()', 'public.is_ws_member(uuid)', 'public.is_ws_admin(uuid)',
    'public.accessible_project_ids()', 'public.can_read_project(uuid)', 'public.is_project_admin(uuid)',
    'public.is_project_member(uuid)', 'public.is_project_admin_anywhere_in_ws(uuid)', 'public.my_member_id(uuid)',
    'public.my_team_ids(uuid)', 'public.can_attach(uuid)', 'public.can_edit_issue(uuid)', 'public.wbs_is_leaf(uuid)',
    'public.item_owned_by_my_team(uuid, uuid)',
    'public.uuid_or_null(text)', 'public.storage_ws(text)', 'public.storage_project(text)', 'public.storage_entity_id(text)',
    'public.minute_body_path_ok(text, uuid, uuid, uuid)', 'public.presence_topic_project(text)', 'public.can_manage_minute(uuid)',
    'public.has_project_role_in_ws(uuid)', 'public.minute_attachment_path_active(text)',
    // 정책 헬퍼는 아니지만 같은 관례(authenticated·service_role 만, 0011 ⑦)다 — anon·PUBLIC·그 밖의 롤에 열리면 여기서 빨개진다
    'public.attachment_object_exists(text, uuid)',
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
  // 허용 목록 밖 그란티는 전부 위반이다 — anon·PUBLIC 뿐 아니라, 실수로 만든 커스텀 롤(예 staging_reader)에
  // EXECUTE 가 붙어도 잡는다(리뷰 라운드 1 — 이전 판정은 anon·PUBLIC·"authenticated 있는가"만 봐서 그 사이의
  // 임의 그란티를 놓쳤다). postgres 는 소유자 기본 권한이라 항상 허용.
  const ALLOWED_HELPER_GRANTEES = ['authenticated', 'service_role', 'postgres']
  it('정책 헬퍼 EXECUTE 는 허용 목록(authenticated·service_role·postgres) 뿐(item_owned_by_my_team·0007 헬퍼 포함)', async () => {
    const rows = await asService(pool, (c) => executeGrantees(c, HELPER_FNS))
    expect(rows.map((r) => r.fn).sort()).toEqual([...HELPER_FNS].sort())
    const bad = rows.filter((r) => r.has_public || !r.named_grantees.includes('authenticated')
      || r.named_grantees.some((g) => !ALLOWED_HELPER_GRANTEES.includes(g)))
      .map((r) => `${r.fn}: public=${r.has_public} grantees=${r.named_grantees.join(',')}`)
    expect(bad, `정책 헬퍼 EXECUTE 위반:\n  ${bad.join('\n  ')}`).toEqual([])
  })
  // SECURITY DEFINER 함수는 RLS 를 건너뛴다 — authenticated 가 PostgREST(rpc/…)로 직접 부를 수 있는 것은 이 목록으로 고정하고 항목마다
  // 사유를 단다(F20). 새 함수는 PUBLIC(내장 기본값 — 따라서 anon)과 authenticated·service_role(기본 권한 pg_default_acl)의 EXECUTE 를
  // 받고 생기므로, 목록 밖 함수가 생기거나 서비스 RPC 를 drop + create 해 권한이 되살아나면 여기서 빨개진다. 회수는
  // `revoke all … from public, anon, authenticated` 꼴이다 — authenticated 만 회수하면 PUBLIC 으로 anon·authenticated 가 그대로 실행한다
  // (anon·PUBLIC 쪽은 아래 'anon·PUBLIC 이 실행하는 …' 케이스가 본다). 트리거 함수는 실행 권한과 무관하게 돈다 — 대상이 아니다.
  const HELPER = '정책 헬퍼 — RLS 정책(또는 정책이 부르는 헬퍼)이 부르므로 조회자에게 실행 권한이 있어야 한다. 호출자 자신의 권한만 답한다'
  const WIKI_RPC = '위키 쓰기 RPC — 위키 표에는 RLS 쓰기 정책이 없어 본문의 is_project_member·is_project_admin 판정이 유일한 관문이다(CLAUDE.md 권한)'
  const DEFINER_EXECUTABLE: Record<string, string> = {
    'accessible_project_ids()': HELPER, 'my_workspace_ids()': HELPER, 'is_superuser()': HELPER,
    'is_ws_member(uuid)': HELPER, 'is_ws_admin(uuid)': HELPER, 'can_read_project(uuid)': HELPER,
    'is_project_admin(uuid)': HELPER, 'is_project_member(uuid)': HELPER, 'is_project_admin_anywhere_in_ws(uuid)': HELPER,
    'minute_attachment_path_active(text)': '첨부 Storage 읽기 헬퍼 — 원래 호출자 Storage scope 안에서만 톰스톤 여부를 boolean으로 반환한다(B3)',
    'can_attach(uuid)': HELPER, 'can_edit_issue(uuid)': HELPER, 'can_manage_minute(uuid)': HELPER,
    'item_owned_by_my_team(uuid, uuid)': HELPER,
    'has_project_role_in_ws(uuid)': HELPER,
    'attachment_object_exists(text, uuid)': '첨부 삭제 도우미(src/lib/attachments/removeStoredAttachment.ts)가 Storage 삭제 0건일 때 부른다 — 그 첨부의 삭제 권한이 있는 호출자에게만 답하고(없으면 42501) 경로를 받지 않는다(첨부 행 id 로만)',
    'my_member_id(uuid)': '호출자 자신의 명단 행 id — 워크스페이스 멤버일 때만(0009). 정책 헬퍼 목록(HELPER_FNS)과 같은 규칙',
    'my_team_ids(uuid)': '호출자 자신의 팀 — 워크스페이스 멤버일 때만(0009). can_attach·item_owned_by_my_team 이 부른다',
    'wbs_is_leaf(uuid)': 'member_update_actual 정책이 직접 부른다(회수하면 멤버 실적 입력이 42501). 남의 항목에 답하는 1비트는 post-SP2 hardening',
    'answer_wiki_question(uuid, text, uuid)': WIKI_RPC, 'create_wiki_document(uuid, text, text, text, uuid)': WIKI_RPC,
    'create_wiki_question(uuid, uuid, text)': WIKI_RPC, 'curate_wiki_item(uuid, text, text)': WIKI_RPC,
    'merge_wiki_topics(uuid, uuid)': WIKI_RPC, 'move_wiki_document(uuid, uuid, integer, integer)': WIKI_RPC,
    'restore_wiki_document_revision(uuid, uuid, timestamp with time zone)': WIKI_RPC, 'review_wiki_item(uuid, text)': WIKI_RPC,
    'save_wiki_document(uuid, text, text, text, timestamp with time zone)': WIKI_RPC, 'submit_wiki_feedback(uuid, text, text)': WIKI_RPC,
    'verify_wiki_document(uuid, integer, timestamp with time zone)': WIKI_RPC,
  }
  it('authenticated 가 실행하는 비트리거 SECURITY DEFINER 함수 = 허용 목록(항목마다 사유) — 목록 밖 0건, 죽은 항목 0건', async () => {
    const got = await asService(pool, async (c) => (await c.query<{ fn: string }>(`
      select format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) as fn from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
         and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`)).rows.map((r) => r.fn))
    expect(got.filter((f) => !(f in DEFINER_EXECUTABLE)), 'authenticated 가 실행하는 SECURITY DEFINER 함수(허용 목록 밖)').toEqual([])
    expect(Object.keys(DEFINER_EXECUTABLE).filter((f) => !got.includes(f)), '죽은 허용 목록 항목').toEqual([])
  })
  // 위 케이스는 authenticated 만 묻는다 — 허용 목록 안의 함수(예 attachment_object_exists)가 anon·PUBLIC 에 열려도 목록은 그대로라 초록이다.
  // anon 은 PUBLIC 으로도 실행하므로 실효 권한(has_function_privilege)과 PUBLIC 항목(grantee 0)을 둘 다 본다. 0011 ⑪ 사후검증은 0011 을
  // 적용하는 순간 한 번뿐이라, 뒤 마이그레이션의 grant·drop + create(revoke 누락)는 이 케이스가 잡는다.
  const ANON_OR_PUBLIC_DEFINER = `
    select format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) as fn from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
     order by 1`
  it('anon·PUBLIC 이 실행하는 비트리거 SECURITY DEFINER 함수 0건(실효 권한 + PUBLIC 항목)', async () => {
    const got = await asService(pool, async (c) => (await c.query<{ fn: string }>(ANON_OR_PUBLIC_DEFINER)).rows.map((r) => r.fn))
    expect(got, 'anon 또는 PUBLIC 이 실행하는 SECURITY DEFINER 함수').toEqual([])
  })
  it('민감도 — anon·PUBLIC grant 와 revoke 없이 만든 새 DEFINER 함수를 잡는다(authenticated 허용 목록 케이스는 못 본다)', async () => {
    const FN = 'attachment_object_exists(text, uuid)'
    for (const grantee of ['anon', 'public']) {
      await asService(pool, async (c) => {
        await c.query(`grant execute on function public.${FN} to ${grantee}`)
        expect((await c.query<{ fn: string }>(ANON_OR_PUBLIC_DEFINER)).rows.map((r) => r.fn), grantee).toEqual([FN])
      })
    }
    await asService(pool, async (c) => {
      await c.query(`create function public.rls_h2_probe_fn() returns int language sql security definer set search_path = '' as 'select 1'`)
      expect((await c.query<{ fn: string }>(ANON_OR_PUBLIC_DEFINER)).rows.map((r) => r.fn)).toEqual(['rls_h2_probe_fn()'])
    })
  })
  it('p_actor* 인자를 받는 public 함수는 authenticated·anon 이 실행할 수 없다(호출자가 준 행위자를 믿는 서비스 RPC)', async () => {
    const rows = await asService(pool, async (c) => (await c.query<{ fn: string; auth: boolean; anon: boolean }>(`
      select format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) as fn,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth, has_function_privilege('anon', p.oid, 'EXECUTE') as anon
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and exists (select 1 from unnest(p.proargnames) a where a like 'p\\_actor%')
       order by 1`)).rows)
    expect(rows.length, 'p_actor 서비스 RPC 가 하나도 안 잡히면 판정이 빗나간 것').toBeGreaterThanOrEqual(3)
    expect(rows.filter((r) => r.auth || r.anon).map((r) => `${r.fn}: authenticated=${r.auth} anon=${r.anon}`)).toEqual([])
  })

  // project_ws 는 예외(R3 분기 A) — authenticated 는 없어야 하고, 나머지도 같은 허용 목록에서 authenticated 만 뺀 것.
  const ALLOWED_PROJECT_WS_GRANTEES = ALLOWED_HELPER_GRANTEES.filter((g) => g !== 'authenticated')
  it('project_ws EXECUTE 는 service_role·postgres 뿐(R3 분기 A) — authenticated·anon·PUBLIC 없음', async () => {
    const [row] = await asService(pool, (c) => executeGrantees(c, ['public.project_ws(uuid)']))
    expect(row.has_public).toBe(false)
    expect(row.named_grantees).not.toContain('authenticated')
    const bad = row.named_grantees.filter((g) => !ALLOWED_PROJECT_WS_GRANTEES.includes(g))
    expect(bad, `project_ws EXECUTE 위반(허용 목록 밖): ${bad.join(',')}`).toEqual([])
  })
})
