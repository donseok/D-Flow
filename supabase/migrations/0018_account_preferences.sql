-- *_account_preferences — 계정 범위 개인 설정(SP3b D9·스펙 §5.6). 테마·언어·사이드바 등 계정 키가 워크스페이스마다 갈리지 않게
-- 자기 행 RLS 의 새 표로 옮긴다. profiles.ui_prefs(개정 권고)는 같은 워크스페이스 동료가 행 전체를 읽어(profiles_read) 쓰지 않는다(E32).
-- 절 순서: ① 표 ② 정책·권한 ③ 이행(계정 키 이동, lastProjectId → recentProjects, notifRead 재배치, 계정 키·은퇴 키 삭제) ④ 사후검사.
-- 배포·롤백 순서: 이 파일은 확장(표·이행)과 계약(3-3 삭제)을 한 번에 한다 — 새 코드(account_preferences 를 읽는 판)와 같은 창에서
-- 적용한다(옛 코드만 도는 동안 적용하면 옛 코드가 계정 키를 못 읽어 첫 소속 행에 다시 백필한다). 되돌릴 때는 롤백 SQL 을 **먼저**,
-- 옛 코드를 바로 이어서 — 반대 순서면 그 사이 옛 코드가 첫 소속 행에 쓴 계정 키를 롤백이 account_preferences 의 옛 값으로 덮는다.
-- 새 함수·트리거는 없다(updated_at 은 앱이 쓴다 — user_preferences 와 같다). CLI 가 파일 하나를 한 트랜잭션으로 적용한다.
-- 수동 적용은 `psql -1`(--single-transaction)만 — 자동커밋(문장 단위) 적용 금지: 3-0 의 set_config(…, true)·3-2b 의 temp 표(on commit drop)가
-- 트랜잭션 범위라, 문장마다 커밋하면 notifRead 를 지운 뒤 재배치가 실패해 읽음 기록이 사라지고 부분 적용으로 남는다.
-- 롤백: supabase/rollbacks/*_account_preferences_rollback.sql. 리허설: supabase/rehearsal/*_account_preferences_{seed,smoke}.sql.
-- 번호는 개발 번호다 — main 반영 때 SP4 와 겹치면 접미를 지키며 rename 한다(테스트·코드는 접미로 찾는다).
-- ACCOUNT_KEYS: theme, locale, sidebarCollapsed, dashSections, minutesView, minuteFontSize, minutesExplorerLayout, wbsHideDone, wbsOutline, wbsGanttScale, notif

-- ① 표 ----------------------------------------------------------------------------------------------------------------
create table public.account_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.account_preferences enable row level security;

-- ② 정책·권한 — 자기 행만(select·insert·update). delete·anon 없음(H2 규칙 2: 정책 없는 DML 권한 0) ---------------------------
create policy account_preferences_select_own on public.account_preferences for select to authenticated
  using (user_id = auth.uid());
create policy account_preferences_insert_own on public.account_preferences for insert to authenticated
  with check (user_id = auth.uid());
create policy account_preferences_update_own on public.account_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.account_preferences from public, anon, authenticated;
grant select, insert, update on public.account_preferences to authenticated;

-- ③ 이행 ---------------------------------------------------------------------------------------------------------------
-- 3-0 사후검사 기준값 — 첫 소속 행 중 계정 키를 가진 행 수(④ 가 비어 있지 않은 계정 행 수와 대조한다. 3-1 의 조인이 어긋나면
--     3-3 이 계정 키를 지우고도 잔여 키 검사는 통과하므로 — 이동이 실제로 일어났는지를 본다). 이 트랜잭션 안에서만 산다
select pg_catalog.set_config('sp3b.account_rows_expected', (
  select count(*)::text from public.user_preferences up
    join lateral (select wm.workspace_id from public.workspace_members wm where wm.user_id = up.user_id
                   order by wm.created_at, wm.workspace_id limit 1) fw on fw.workspace_id = up.workspace_id
   where up.prefs ?| array['theme', 'locale', 'sidebarCollapsed', 'dashSections', 'minutesView', 'minuteFontSize',
                           'minutesExplorerLayout', 'wbsHideDone', 'wbsOutline', 'wbsGanttScale', 'notif']), true);

-- 3-1 가장 먼저 가입한 워크스페이스(created_at → workspace_id — prefsWorkspaceId 와 같은 규칙) 행의 계정 키만 옮긴다
insert into public.account_preferences (user_id, prefs, updated_at)
select up.user_id,
       coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(up.prefs) e
                  where e.key = any (array['theme', 'locale', 'sidebarCollapsed', 'dashSections', 'minutesView', 'minuteFontSize',
                                           'minutesExplorerLayout', 'wbsHideDone', 'wbsOutline', 'wbsGanttScale', 'notif'])), '{}'::jsonb),
       up.updated_at
  from public.user_preferences up
  join lateral (select wm.workspace_id from public.workspace_members wm where wm.user_id = up.user_id
                 order by wm.created_at, wm.workspace_id limit 1) fw on fw.workspace_id = up.workspace_id;

-- 3-2 lastProjectId → 그 프로젝트의 워크스페이스 행 recentProjects(프로젝트가 있고 아직 그 워크스페이스 소속일 때만).
--     형식 검사는 캐스트를 감싼 CASE 안에서 한다 — 술어 평가 순서는 보장되지 않아 CTE 의 WHERE 만으로는 22P02 를 막지 못한다
--     (옛 lastProjectId 는 라우트 조각을 그대로 보낸 값이라 형식 밖 값이 있을 수 있다)
with src as (
  select up.user_id, up.prefs ->> 'lastProjectId' as pid_text, up.updated_at
    from public.user_preferences up
   where jsonb_typeof(up.prefs -> 'lastProjectId') = 'string'
     and (up.prefs ->> 'lastProjectId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), tgt as (
  select distinct on (s.user_id, p.workspace_id) s.user_id, p.workspace_id, p.id as pid, s.updated_at
    from src s
    join public.projects p on p.id = (case when s.pid_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then s.pid_text::uuid end)
    join public.workspace_members wm on wm.user_id = s.user_id and wm.workspace_id = p.workspace_id
   order by s.user_id, p.workspace_id, s.updated_at desc
)
insert into public.user_preferences (user_id, workspace_id, prefs, updated_at)
select t.user_id, t.workspace_id,
       jsonb_build_object('recentProjects', jsonb_build_array(jsonb_build_object(
         'id', t.pid, 'at', to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))),
       now()
  from tgt t
on conflict (user_id, workspace_id) do update
  set prefs = public.user_preferences.prefs || jsonb_build_object('recentProjects', excluded.prefs -> 'recentProjects');

-- 3-2b notifRead({프로젝트 id: 알림 id[]}) → 그 프로젝트의 워크스페이스 행으로. 옛 코드는 모든 프로젝트의 읽음을 첫 소속 행에 썼고
--      새 코드는 그 프로젝트의 워크스페이스 행에서 읽는다 — 옮기지 않으면 다른 워크스페이스 프로젝트의 알림이 다시 안 읽음이 된다.
--      없는 프로젝트·소속 밖 워크스페이스의 키는 버린다(새 코드가 읽지 않는 고아). 같은 프로젝트 키가 여러 행에 있으면 그 워크스페이스
--      자기 행 → 최신 행 순. 형식 밖 키는 CASE 안에서 거른다(3-2 와 같은 이유)
create temp table sp3b_notif_read on commit drop as
with ent as (
  select up.user_id, up.workspace_id as src_ws, e.key as pid_text, e.value, up.updated_at
    from public.user_preferences up
   cross join lateral jsonb_each(case when jsonb_typeof(up.prefs -> 'notifRead') = 'object' then up.prefs -> 'notifRead' else '{}'::jsonb end) e
), placed as (
  select distinct on (en.user_id, p.id) en.user_id, p.workspace_id, p.id::text as pid_text, en.value
    from ent en
    join public.projects p on p.id = (case when en.pid_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then en.pid_text::uuid end)
    join public.workspace_members wm on wm.user_id = en.user_id and wm.workspace_id = p.workspace_id
   order by en.user_id, p.id, (en.src_ws = p.workspace_id) desc, en.updated_at desc
)
select user_id, workspace_id, jsonb_object_agg(pid_text, value) as nr from placed group by user_id, workspace_id;

update public.user_preferences set prefs = prefs - 'notifRead' where prefs ? 'notifRead';

insert into public.user_preferences (user_id, workspace_id, prefs, updated_at)
select n.user_id, n.workspace_id, jsonb_build_object('notifRead', n.nr), now()
  from sp3b_notif_read n
on conflict (user_id, workspace_id) do update
  set prefs = public.user_preferences.prefs || jsonb_build_object('notifRead', excluded.prefs -> 'notifRead');

-- 3-3 모든 워크스페이스 행에서 계정 키·은퇴 키(heroCollapsed·lastProjectId)를 지운다
update public.user_preferences
   set prefs = prefs - array['theme', 'locale', 'sidebarCollapsed', 'dashSections', 'minutesView', 'minuteFontSize',
                             'minutesExplorerLayout', 'wbsHideDone', 'wbsOutline', 'wbsGanttScale', 'notif', 'heroCollapsed', 'lastProjectId']
 where prefs ?| array['theme', 'locale', 'sidebarCollapsed', 'dashSections', 'minutesView', 'minuteFontSize',
                      'minutesExplorerLayout', 'wbsHideDone', 'wbsOutline', 'wbsGanttScale', 'notif', 'heroCollapsed', 'lastProjectId'];

-- ④ 사후검사 ------------------------------------------------------------------------------------------------------------
do $$
declare v text; v_n int; v_expected int;
begin
  -- 계정 키가 실제로 옮겨졌다 — 3-0 의 기준값 = 비어 있지 않은 계정 행 수
  v_expected := nullif(pg_catalog.current_setting('sp3b.account_rows_expected', true), '')::int;
  select count(*) into v_n from public.account_preferences where prefs <> '{}'::jsonb;
  if v_expected is null or v_n <> v_expected then
    raise exception 'SP3B_ACCOUNT_PREFS_POSTCHECK: 계정 행 % 개 ≠ 계정 키를 가진 첫 소속 행 % 개', v_n, coalesce(v_expected::text, '(기준값 없음)');
  end if;
  -- notifRead 의 키는 그 행 워크스페이스의 프로젝트뿐이다(3-2b)
  select string_agg(up.user_id::text || '/' || up.workspace_id::text || ':' || e.key, ', ') into v
    from public.user_preferences up
   cross join lateral jsonb_each(case when jsonb_typeof(up.prefs -> 'notifRead') = 'object' then up.prefs -> 'notifRead' else '{}'::jsonb end) e
    left join public.projects p on p.id::text = e.key
   where p.workspace_id is distinct from up.workspace_id;
  if v is not null then raise exception 'SP3B_ACCOUNT_PREFS_POSTCHECK: 다른 워크스페이스(또는 없는) 프로젝트의 notifRead 가 남았다: %', left(v, 600); end if;
  select string_agg(user_id::text || '/' || workspace_id::text, ', ') into v from public.user_preferences
   where prefs ?| array['theme', 'locale', 'sidebarCollapsed', 'dashSections', 'minutesView', 'minuteFontSize',
                        'minutesExplorerLayout', 'wbsHideDone', 'wbsOutline', 'wbsGanttScale', 'notif', 'heroCollapsed', 'lastProjectId'];
  if v is not null then raise exception 'SP3B_ACCOUNT_PREFS_POSTCHECK: user_preferences 에 계정 키·은퇴 키가 남았다: %', left(v, 600); end if;
  if not (has_table_privilege('authenticated', 'public.account_preferences', 'SELECT')
      and has_table_privilege('authenticated', 'public.account_preferences', 'INSERT')
      and has_table_privilege('authenticated', 'public.account_preferences', 'UPDATE')) then
    raise exception 'SP3B_ACCOUNT_PREFS_POSTCHECK: authenticated 의 SELECT·INSERT·UPDATE 가 없다';
  end if;
  if has_table_privilege('authenticated', 'public.account_preferences', 'DELETE')
     or has_table_privilege('authenticated', 'public.account_preferences', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.account_preferences', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.account_preferences', 'TRIGGER') then
    raise exception 'SP3B_ACCOUNT_PREFS_POSTCHECK: authenticated 에 정책 없는 권한이 남았다';
  end if;
  if has_table_privilege('anon', 'public.account_preferences', 'SELECT') or has_table_privilege('anon', 'public.account_preferences', 'INSERT')
     or has_table_privilege('anon', 'public.account_preferences', 'UPDATE') or has_table_privilege('anon', 'public.account_preferences', 'DELETE') then
    raise exception 'SP3B_ACCOUNT_PREFS_POSTCHECK: anon 에 권한이 있다';
  end if;
  select count(*) into v_n from pg_policies where schemaname = 'public' and tablename = 'account_preferences';
  if v_n <> 3 then raise exception 'SP3B_ACCOUNT_PREFS_POSTCHECK: 정책이 셋이 아니다(%)', v_n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'account_preferences'
              and (coalesce(qual, '') || coalesce(with_check, '')) not like '%auth.uid()%') then
    raise exception 'SP3B_ACCOUNT_PREFS_POSTCHECK: 자기 행이 아닌 정책이 있다';
  end if;
end $$;
