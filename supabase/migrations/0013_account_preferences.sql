-- 0013_account_preferences — 계정 범위 개인 설정(SP3b D9·스펙 §5.6). 테마·언어·사이드바 등 계정 키가 워크스페이스마다 갈리지 않게
-- 자기 행 RLS 의 새 표로 옮긴다. profiles.ui_prefs(개정 권고)는 같은 워크스페이스 동료가 행 전체를 읽어(profiles_read) 쓰지 않는다(E32).
-- 절 순서: ① 표 ② 정책·권한 ③ 이행(계정 키 이동, lastProjectId → recentProjects, 계정 키·은퇴 키 삭제) ④ 사후검사.
-- 새 함수·트리거는 없다(updated_at 은 앱이 쓴다 — user_preferences 와 같다). CLI 가 파일 하나를 한 트랜잭션으로 적용한다.
-- 롤백: supabase/rollbacks/0013_account_preferences_rollback.sql. 리허설: supabase/rehearsal/0013_account_preferences_{seed,smoke}.sql.
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

-- 3-2 lastProjectId → 그 프로젝트의 워크스페이스 행 recentProjects(프로젝트가 있고 아직 그 워크스페이스 소속일 때만, uuid 형식 검사 뒤 캐스트)
with src as (
  select up.user_id, up.prefs ->> 'lastProjectId' as pid_text, up.updated_at
    from public.user_preferences up
   where jsonb_typeof(up.prefs -> 'lastProjectId') = 'string'
     and (up.prefs ->> 'lastProjectId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), tgt as (
  select distinct on (s.user_id, p.workspace_id) s.user_id, p.workspace_id, p.id as pid, s.updated_at
    from src s
    join public.projects p on p.id = s.pid_text::uuid
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

-- 3-3 모든 워크스페이스 행에서 계정 키·은퇴 키(heroCollapsed·lastProjectId)를 지운다
update public.user_preferences
   set prefs = prefs - array['theme', 'locale', 'sidebarCollapsed', 'dashSections', 'minutesView', 'minuteFontSize',
                             'minutesExplorerLayout', 'wbsHideDone', 'wbsOutline', 'wbsGanttScale', 'notif', 'heroCollapsed', 'lastProjectId']
 where prefs ?| array['theme', 'locale', 'sidebarCollapsed', 'dashSections', 'minutesView', 'minuteFontSize',
                      'minutesExplorerLayout', 'wbsHideDone', 'wbsOutline', 'wbsGanttScale', 'notif', 'heroCollapsed', 'lastProjectId'];

-- ④ 사후검사 ------------------------------------------------------------------------------------------------------------
do $$
declare v text; v_n int;
begin
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
