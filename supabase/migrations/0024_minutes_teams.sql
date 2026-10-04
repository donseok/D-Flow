-- SP5 B2(스펙 §3.4·D18~D20·D49~D52, 개정 §4.7 DC-04): 회의록 폴더·회의록을 팀 이름·created_by 대신 팀 id 로 잇는다.
-- 왜: 팀 루트를 `parent_id null ∧ created_by null ∧ name = code` 로 판정·역해석해 왔다 — SP4 이후 팀은 개명되고(name ≠ code),
--   같은 code 의 공용·전용 팀이 생기며(전환 RPC), 세션이 created_by null 이 아닌 루트를 만들 수 없다는 사실에만 기대 루트를 지켰다.
-- 무엇: ⓪ 사전검사 ① 폴더 kind·team_id·이관(이름 = 팀 이름) ①′ 종류 가드(세션) ② minutes.team_id·메아리(code 단위 해석)
--   ②′ 팀 참조 범위 가드 ③ create_team·ensure_team_roots(공용 팀 생성 한 길 — 세션 공용 팀 INSERT 정책 삭제) ④ 개명 동기
--   ⑤ 전환 RPC 두 표 ⑥ M1 가드 두 표 ⑦ 수신 RPC — 본문은 그대로, team_id 해석·비활성 거부는 ②의 메아리 트리거가 모든 쓰기 길에서 한다
--   ⑧ 사후검사. 잠금: create_team 은 워크스페이스 설정 행 FOR SHARE, ensure_team_roots·설정 RPC 는 FOR UPDATE(§2.4.1 규약).
-- 되돌리지 않는 데이터: 회의록 team_id 이관 결과(롤백은 열을 지운다 — team_code 원문이 남는다). 롤백은 폴더 이름을 code 로 먼저 되돌린다.

-- 도우미 — code 단위 팀 해석(D18). 프로젝트 행은 그 프로젝트의 같은 code 전용 팀(활성 무관), 없으면 같은 워크스페이스의 같은 code 공용 팀.
-- 무프로젝트 행은 공용 팀만. **다른 프로젝트의 전용 팀은 고르지 않는다.**
create function public.minute_team_for_code(p_workspace_id uuid, p_project_id uuid, p_code text) returns uuid
language sql stable security definer set search_path to '' as $$
  select coalesce(
    (select t.id from public.teams t where p_project_id is not null and t.project_id = p_project_id and t.code = btrim(p_code)),
    (select t.id from public.teams t where t.workspace_id = p_workspace_id and t.project_id is null and t.code = btrim(p_code)))
$$;
revoke all on function public.minute_team_for_code(uuid, uuid, text) from public, anon, authenticated;

-- ⓪ 사전검사 MINUTES_TEAMS_PRECHECK — 이관 뒤 이름(팀 이름)이 같은 범위 루트와 겹치거나 60자를 넘으면 멈춘다(D52 ①)
do $$
declare
  v text;
begin
  with roots as (
    select f.id, f.workspace_id, f.project_id, f.name,
           public.minute_team_for_code(f.workspace_id, f.project_id, f.name) as team_id
      from public.minute_folders f where f.parent_id is null and f.created_by is null
  ), renamed as (
    select f.id, f.workspace_id, f.project_id,
           coalesce((select pg_catalog.btrim(t.name) from public.teams t where t.id = r.team_id), f.name) as final_name
      from public.minute_folders f left join roots r on r.id = f.id
     where f.parent_id is null
  )
  select string_agg(x.what, ', ') into v from (
    select pg_catalog.format('겹침(%s / %s)', a.final_name, coalesce(a.project_id::text, 'workspace')) as what
      from renamed a join renamed b on b.id <> a.id and b.workspace_id = a.workspace_id
       and b.project_id is not distinct from a.project_id and b.final_name = a.final_name
     where a.id < b.id
    union all
    select pg_catalog.format('이름 길이(%s)', t.name)
      from roots r join public.teams t on t.id = r.team_id
     where pg_catalog.length(pg_catalog.btrim(t.name)) not between 1 and 60) x;
  if v is not null then
    raise exception using errcode = '23514', message = 'MINUTES_TEAMS_PRECHECK',
      detail = left(v, 600),
      hint = '겹치는 폴더 이름을 바꾸거나 팀 이름을 1~60자로 바꾼 뒤 다시 적용하세요.';
  end if;
end $$;

-- ① 폴더 종류·팀(개정 §4.7 SQL — FK 동작만 no action, D51·E28)
alter table public.minute_folders
  add column kind text not null default 'user' check (kind in ('user', 'team_root', 'custom_root')),
  add column team_id uuid references public.teams (id) on delete no action;
alter table public.minute_folders
  add constraint minute_folders_team_root_check check ((kind = 'team_root') = (team_id is not null)),
  add constraint minute_folders_root_parent_check check (kind = 'user' or parent_id is null);
create unique index minute_folders_team_root_uidx on public.minute_folders
  (workspace_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), team_id) where kind = 'team_root';
create index minute_folders_team_idx on public.minute_folders (team_id) where team_id is not null;

-- 이관: 옛 시드 루트(parent_id null ∧ created_by null) → code 단위로 맞는 팀이 있으면 team_root(이름 = 팀 이름), 없으면 custom_root.
-- 탈퇴 사용자의 루트도 created_by 가 SET NULL 이라 여기에 든다(맞는 팀이 없으면 custom_root).
update public.minute_folders f
   set kind = 'team_root', team_id = x.team_id, name = pg_catalog.btrim(t.name)
  from (select r.id, public.minute_team_for_code(r.workspace_id, r.project_id, r.name) as team_id
          from public.minute_folders r where r.parent_id is null and r.created_by is null) x
  join public.teams t on t.id = x.team_id
 where f.id = x.id;
update public.minute_folders f set kind = 'custom_root'
 where f.parent_id is null and f.created_by is null and f.kind = 'user';

-- ①′ 종류 가드(D49) — INVOKER: 세션 문장만 판정한다(DEFINER 함수·service_role·FK 연쇄는 current_user 가 세션 역할이 아니다).
create function public.minute_folders_kind_guard() returns trigger
language plpgsql set search_path to '' as $$
declare
  v_cur uuid;
  v_parent uuid;
  v_kind text;
  v_team uuid;
  v_depth int := 0;
  v_ws uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    -- ③ 팀·사용자 지정 루트는 세션이 지우지 못한다(남이 편철한 하위 폴더가 cascade 로 같이 지워지는 길)
    if old.kind <> 'user' then
      raise exception using errcode = '42501', message = 'MINUTE_FOLDER_KIND_FORBIDDEN';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    -- ① 세션은 일반 폴더만 만든다
    if new.kind <> 'user' or new.team_id is not null then
      raise exception using errcode = '42501', message = 'MINUTE_FOLDER_KIND_FORBIDDEN';
    end if;
  else
    -- ② 종류·팀은 바꾸지 못하고, 루트의 이름·위치·범위도 못 바꾼다(이름은 개명 동기 트리거만)
    if new.kind is distinct from old.kind or new.team_id is distinct from old.team_id then
      raise exception using errcode = '42501', message = 'MINUTE_FOLDER_KIND_FORBIDDEN';
    end if;
    if old.kind <> 'user' and (new.name is distinct from old.name or new.parent_id is distinct from old.parent_id
        or new.project_id is distinct from old.project_id or new.workspace_id is distinct from old.workspace_id) then
      raise exception using errcode = '42501', message = 'MINUTE_FOLDER_KIND_FORBIDDEN';
    end if;
  end if;
  -- ④ 비활성 팀 루트 아래로 넣거나 옮기지 못한다 — 조상은 세션 RLS 로 읽는다
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    v_cur := new.parent_id;
    loop
      select f.parent_id, f.kind, f.team_id into v_parent, v_kind, v_team from public.minute_folders f where f.id = v_cur;
      -- 세션은 자기 워크스페이스 폴더를 모두 읽는다 — 안 보이는 조상은 다른 워크스페이스다. 그 거부는 뒤의 워크스페이스 가드
      -- (minute_folders_workspace_scope — MINUTE_FOLDER_WORKSPACE_MISMATCH)가 그 계약의 오류로 한다. 여기서는 판정하지 않고 넘긴다
      if not found then
        v_kind := null;
        exit;
      end if;
      exit when v_parent is null;
      v_cur := v_parent;
      v_depth := v_depth + 1;
      if v_depth > 32 then
        raise exception using errcode = '23514', message = 'MINUTE_FOLDER_ROOT_INACTIVE';
      end if;
    end loop;
    if v_kind = 'team_root' and not exists (select 1 from public.teams t where t.id = v_team and t.active) then
      raise exception using errcode = '23514', message = 'MINUTE_FOLDER_ROOT_INACTIVE';
    end if;
  end if;
  -- ⑤ 최상위 일반 폴더가 같은 범위 팀 이름을 선점하지 못한다(지연 생성되는 팀 루트의 이름 유일 인덱스 선점 — R9)
  if new.parent_id is null and (tg_op = 'INSERT' or new.name is distinct from old.name or old.parent_id is not null) then
    v_ws := coalesce((select p.workspace_id from public.projects p where p.id = new.project_id), new.workspace_id);
    if exists (select 1 from public.teams t
                where t.workspace_id = v_ws and pg_catalog.btrim(t.name) = pg_catalog.btrim(new.name)
                  and (t.project_id is null or (new.project_id is not null and t.project_id = new.project_id))) then
      raise exception using errcode = '23505', message = 'MINUTE_FOLDER_NAME_RESERVED';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.minute_folders_kind_guard() from public, anon, authenticated;
create trigger minute_folders_kind_guard before insert or update or delete on public.minute_folders
  for each row execute function public.minute_folders_kind_guard();

-- ② 회의록 팀 id(D18 — nullable, 팀 삭제는 SET NULL: team_code 원문이 남는다)
alter table public.minutes add column team_id uuid references public.teams (id) on delete set null;
create index minutes_workspace_team_idx on public.minutes (workspace_id, team_id);
-- minutes 는 열 단위 SELECT(0011 — share_token 만 뺀다). 새 열도 세션이 읽는다
grant select (team_id) on public.minutes to authenticated;
-- 이관: code 단위(D18)
update public.minutes m set team_id = public.minute_team_for_code(m.workspace_id, m.project_id, m.team_code);
do $$
declare
  v_set bigint;
  v_null bigint;
begin
  select count(*) filter (where team_id is not null), count(*) filter (where team_id is null) into v_set, v_null from public.minutes;
  raise notice 'MINUTES_TEAMS: 회의록 team_id 이관 % · 맞는 팀 없음(null) %', v_set, v_null;
end $$;

-- 메아리·해석 — 모든 쓰기 길(생성·메타·이동·외부 API·재편철·전환·FK 연쇄)이 같은 규칙을 지난다.
--   team_id 를 직접 바꾸면 team_code := 그 팀 code(null 이면 원문 유지). team_code 를 바꾸면 code 단위로 team_id 를 다시 해석하고,
--   고른 팀이 비활성이면 MINUTE_TEAM_INVALID(전용이 비활성이면 공용으로 내려가지 않는다 — 개정 Q6). 범위(프로젝트·워크스페이스)만
--   바뀌면 그 범위로 다시 해석한다(재편철의 team_id 재해석 — S13, 프로젝트 삭제의 SET NULL 연쇄 포함). INSERT 도 해석·비활성 거부.
create function public.minutes_team_code_echo() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_ws uuid;
  v_team uuid;
  v_active boolean;
  v_code text;
begin
  v_ws := coalesce((select p.workspace_id from public.projects p where p.id = new.project_id), new.workspace_id);
  if tg_op = 'UPDATE' and new.team_id is distinct from old.team_id then
    if new.team_id is not null then
      select t.code into v_code from public.teams t where t.id = new.team_id;
      new.team_code := coalesce(v_code, new.team_code);
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' and new.team_id is not null then
    select t.code into v_code from public.teams t where t.id = new.team_id;
    new.team_code := coalesce(v_code, new.team_code);
    return new;
  end if;
  if tg_op = 'INSERT' or new.team_code is distinct from old.team_code then
    v_team := public.minute_team_for_code(v_ws, new.project_id, new.team_code);
    if v_team is not null then
      select t.active into v_active from public.teams t where t.id = v_team;
      if not v_active then
        raise exception using errcode = '23503', message = 'MINUTE_TEAM_INVALID';
      end if;
    end if;
    new.team_id := v_team;
  elsif new.project_id is distinct from old.project_id or new.workspace_id is distinct from old.workspace_id then
    new.team_id := public.minute_team_for_code(v_ws, new.project_id, new.team_code);
  end if;
  return new;
end $$;
revoke all on function public.minutes_team_code_echo() from public, anon, authenticated;
create trigger minutes_team_code_echo before insert or update on public.minutes
  for each row execute function public.minutes_team_code_echo();

-- ②′ 팀 참조 범위 가드(D51) — 팀이 그 행의 워크스페이스이고 공용이거나 그 행 프로젝트의 전용 팀이어야 한다. 열 목록 없이 건다
--   (메아리 트리거가 바꾼 team_id 도 보게 — 열 목록 트리거는 SET 대상 열로만 발화한다). 프로젝트 삭제의 project_id → null 연쇄에서
--   team_id 가 그대로면 판정하지 않는다(R4 — 삭제되는 전용 팀은 팀 cascade 의 SET NULL 이 정리한다).
create function public.minute_team_scope() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_ws uuid;
begin
  if new.team_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.team_id = old.team_id and new.project_id is not distinct from old.project_id
     and new.workspace_id is not distinct from old.workspace_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.project_id is not null and new.project_id is null and new.team_id = old.team_id then
    return new;
  end if;
  v_ws := coalesce((select p.workspace_id from public.projects p where p.id = new.project_id), new.workspace_id);
  if not exists (select 1 from public.teams t
                  where t.id = new.team_id and t.workspace_id = v_ws
                    and (t.project_id is null or t.project_id = new.project_id)) then
    raise exception using errcode = '23514', message = 'MINUTE_TEAM_SCOPE';
  end if;
  return new;
end $$;
revoke all on function public.minute_team_scope() from public, anon, authenticated;
create trigger minutes_team_scope before insert or update on public.minutes
  for each row execute function public.minute_team_scope();
create trigger minute_folders_team_scope before insert or update on public.minute_folders
  for each row execute function public.minute_team_scope();

-- ③ 공용 팀 생성 한 길(D19 ①·D50) + 루트 보장
create function public.actor_is_workspace_admin(p_actor uuid, p_workspace_id uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select p_actor is not null and p_workspace_id is not null and (
    exists (select 1 from public.platform_admins a where a.user_id = p_actor)
    or exists (select 1 from public.workspace_members m
                where m.workspace_id = p_workspace_id and m.user_id = p_actor and m.role = 'admin'))
$$;
revoke all on function public.actor_is_workspace_admin(uuid, uuid) from public, anon, authenticated;

-- 팀 루트 한 행 — create_team·ensure_team_roots 가 같은 SQL 을 쓴다(이름 규칙·오류도 같다 — R9). 60자 초과는 절단하지 않고 거부
create function public.minute_team_root_insert(p_workspace_id uuid, p_project_id uuid, p_team_id uuid, p_name text, p_sort integer)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_name text := pg_catalog.btrim(p_name);
  v_id uuid;
begin
  if v_name is null or pg_catalog.length(v_name) not between 1 and 60 then
    raise exception using errcode = '23514', message = 'TEAM_ROOT_NAME_TOO_LONG';
  end if;
  begin
    insert into public.minute_folders (name, parent_id, sort, created_by, project_id, workspace_id, kind, team_id)
    values (v_name, null, p_sort, null, p_project_id, p_workspace_id, 'team_root', p_team_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'TEAM_ROOT_NAME_CONFLICT';
  end;
  return v_id;
end $$;
revoke all on function public.minute_team_root_insert(uuid, uuid, uuid, text, integer) from public, anon, authenticated;

create function public.create_team(p_actor uuid, p_workspace_id uuid, p_code text, p_name text, p_color text, p_sort_order integer)
returns uuid language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_values jsonb;
  v_id uuid;
begin
  if p_actor is null or p_workspace_id is null or nullif(pg_catalog.btrim(p_code), '') is null or nullif(pg_catalog.btrim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'TEAM_CREATE_INVALID_INPUT';
  end if;
  if not public.actor_is_workspace_admin(p_actor, p_workspace_id) then
    raise exception using errcode = '42501', message = 'TEAM_CREATE_FORBIDDEN';
  end if;
  -- 루트 모드는 설정 행을 FOR SHARE 로 잡고 읽는다(D50 ② — 모드 전환·ensure_team_roots 의 FOR UPDATE 와 직렬화)
  select s."values" into v_values from public.workspace_settings s where s.workspace_id = p_workspace_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'TEAM_CREATE_ISOLATION';
  end if;
  insert into public.teams (workspace_id, project_id, code, name, color, sort_order)
  values (p_workspace_id, null, pg_catalog.btrim(p_code), pg_catalog.btrim(p_name), coalesce(p_color, '#6b7280'), coalesce(p_sort_order, 0))
  returning id into v_id;
  if coalesce(v_values -> 'minutes.root_folders' ->> 'mode', 'teams') = 'teams' then
    perform public.minute_team_root_insert(p_workspace_id, null, v_id, p_name, 100 + coalesce(p_sort_order, 0));
  end if;
  return v_id;
end $$;
revoke all on function public.create_team(uuid, uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_team(uuid, uuid, text, text, text, integer) to service_role;

create function public.ensure_team_roots(p_actor uuid, p_workspace_id uuid) returns integer
language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_values jsonb;
  v_team record;
  v_n integer := 0;
begin
  if not public.actor_is_workspace_admin(p_actor, p_workspace_id) then
    raise exception using errcode = '42501', message = 'TEAM_ROOTS_FORBIDDEN';
  end if;
  select s."values" into v_values from public.workspace_settings s where s.workspace_id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'TEAM_ROOTS_ISOLATION';
  end if;
  if coalesce(v_values -> 'minutes.root_folders' ->> 'mode', 'teams') <> 'teams' then
    return 0;
  end if;
  for v_team in
    select t.id, t.name, t.sort_order from public.teams t
     where t.workspace_id = p_workspace_id and t.project_id is null and t.active
       and not exists (select 1 from public.minute_folders f
                        where f.kind = 'team_root' and f.team_id = t.id and f.project_id is null)
     order by t.sort_order, t.code
  loop
    perform public.minute_team_root_insert(p_workspace_id, null, v_team.id, v_team.name, 100 + v_team.sort_order);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.ensure_team_roots(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_team_roots(uuid, uuid) to service_role;

-- 세션의 공용 팀 직접 INSERT 를 닫는다 — 정책 하나만(표 단위 INSERT 권한은 프로젝트 팀 정책 pa_insert_project_teams 가 쓴다 — R1)
drop policy wsadmin_insert_teams on public.teams;

-- ④ 개명 동기(D20·D52) — 팀 루트 이름 = 팀 이름. 폴더 id 불변. 겹치면 23505, 60자 초과면 23514(절단하지 않는다)
create function public.teams_name_sync_minute_roots() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_name text := pg_catalog.btrim(new.name);
begin
  if new.name is not distinct from old.name
     or not exists (select 1 from public.minute_folders f where f.kind = 'team_root' and f.team_id = new.id) then
    return new;
  end if;
  if v_name is null or pg_catalog.length(v_name) not between 1 and 60 then
    raise exception using errcode = '23514', message = 'TEAM_ROOT_NAME_TOO_LONG';
  end if;
  begin
    update public.minute_folders f set name = v_name, updated_at = now() where f.kind = 'team_root' and f.team_id = new.id;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'TEAM_ROOT_NAME_CONFLICT';
  end;
  return new;
end $$;
revoke all on function public.teams_name_sync_minute_roots() from public, anon, authenticated;
create trigger teams_name_sync_minute_roots after update of name on public.teams
  for each row execute function public.teams_name_sync_minute_roots();

-- ⑤ 전환 RPC(SP4 D54) — 복사 대상 exists 와 UPDATE 목록 둘 다에 회의록·폴더(그 프로젝트)를 더한다. 나머지는 0014 원문 그대로
create or replace function public.convert_inherited_teams(p_actor uuid, p_project_id uuid)
returns jsonb language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_ws uuid;
  v_team record;
  v_new uuid;
  v_map jsonb := '{}'::jsonb;   -- 옛 공용 팀 id(text) → 새 전용 팀 id(text)
  v_teams integer := 0;
  v_owners integer;
  v_member_teams integer;
  v_area_teams integer;
  v_invites integer;
  v_minutes integer;
  v_folders integer;
begin
  if p_actor is null or p_project_id is null then
    raise exception using errcode = '22023', message = 'TEAM_CONVERT_INVALID_INPUT';
  end if;
  -- 가져오기의 프로젝트 잠금과 같은 키 — 전환과 가져오기가 엇갈려 공용 팀 참조가 다시 생기지 않게 한다. 전환은 이 잠금 하나만 잡는다(§3.1)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wbs-import:' || p_project_id::text, 0));
  -- 격리 수준 규칙(H2 ③): 잠금 뒤 전용 팀·참조를 읽어 판정하므로 read committed 가 아니면 거절한다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'TEAM_CONVERT_ISOLATION';
  end if;
  -- 프로젝트 행을 for update 로 잡는다 — 새 공용 팀 참조를 쓰는 트리거(team_ref_owned_scope)는 같은 행을 for key share 로 잡는다
  select p.workspace_id into v_ws from public.projects p where p.id = p_project_id for update;
  if v_ws is null then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'TEAM_CONVERT_FORBIDDEN';
  end if;
  if exists (select 1 from public.teams t where t.project_id = p_project_id) then
    return pg_catalog.jsonb_build_object('status', 'already');
  end if;
  -- 복사 대상 = 그 워크스페이스의 활성 공용 팀 ∪ 그 프로젝트 안의 여섯 참조가 가리키는 공용 팀(비활성 포함 — SP5 B2 가 회의록·폴더를 더했다)
  for v_team in
    select t.id, t.code, t.name, t.color, t.sort_order, t.progress_visible, t.active
      from public.teams t
     where t.workspace_id = v_ws and t.project_id is null
       and (t.active
            or exists (select 1 from public.item_owners io join public.wbs_items w on w.id = io.wbs_item_id
                        where io.team_id = t.id and w.project_id = p_project_id)
            or exists (select 1 from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
                        where pmt.team_id = t.id and pm.project_id = p_project_id)
            or exists (select 1 from public.area_teams art join public.project_areas a on a.id = art.area_id
                        where art.team_id = t.id and a.project_id = p_project_id)
            or exists (select 1 from public.project_invites i
                        where i.project_id = p_project_id and i.redeemed_at is null and i.revoked_at is null
                          and t.id = any(i.team_ids))
            or exists (select 1 from public.minutes m where m.team_id = t.id and m.project_id = p_project_id)
            or exists (select 1 from public.minute_folders f where f.team_id = t.id and f.project_id = p_project_id))
     order by t.sort_order, t.code, t.id
  loop
    insert into public.teams (workspace_id, project_id, code, name, color, sort_order, progress_visible, active)
    values (v_ws, p_project_id, v_team.code, v_team.name, v_team.color, v_team.sort_order, v_team.progress_visible, v_team.active)
    returning id into v_new;
    v_map := v_map || pg_catalog.jsonb_build_object(v_team.id::text, v_new::text);
    v_teams := v_teams + 1;
  end loop;
  update public.item_owners io set team_id = (v_map ->> io.team_id::text)::uuid
    from public.wbs_items w
   where w.id = io.wbs_item_id and w.project_id = p_project_id and v_map ? io.team_id::text;
  get diagnostics v_owners = row_count;
  update public.project_member_teams pmt set team_id = (v_map ->> pmt.team_id::text)::uuid
    from public.project_members pm
   where pm.id = pmt.member_id and pm.project_id = p_project_id and v_map ? pmt.team_id::text;
  get diagnostics v_member_teams = row_count;
  update public.area_teams art set team_id = (v_map ->> art.team_id::text)::uuid
    from public.project_areas a
   where a.id = art.area_id and a.project_id = p_project_id and v_map ? art.team_id::text;
  get diagnostics v_area_teams = row_count;
  update public.project_invites i
     set team_ids = array(select coalesce((v_map ->> x.team_id::text)::uuid, x.team_id)
                            from pg_catalog.unnest(i.team_ids) with ordinality as x(team_id, ord) order by x.ord)
   where i.project_id = p_project_id and i.redeemed_at is null and i.revoked_at is null
     and exists (select 1 from pg_catalog.unnest(i.team_ids) as y(team_id) where v_map ? y.team_id::text);
  get diagnostics v_invites = row_count;
  -- 회의록·폴더(SP5 B2) — 그 프로젝트 안에서만. 메아리 트리거가 team_code 를 새 팀 code(같은 code)로 다시 적는다
  update public.minutes m set team_id = (v_map ->> m.team_id::text)::uuid
   where m.project_id = p_project_id and m.team_id is not null and v_map ? m.team_id::text;
  get diagnostics v_minutes = row_count;
  update public.minute_folders f set team_id = (v_map ->> f.team_id::text)::uuid
   where f.project_id = p_project_id and f.team_id is not null and v_map ? f.team_id::text;
  get diagnostics v_folders = row_count;
  return pg_catalog.jsonb_build_object('status', 'converted', 'teams', v_teams, 'moved', pg_catalog.jsonb_build_object(
    'item_owners', v_owners, 'project_member_teams', v_member_teams, 'area_teams', v_area_teams, 'invites', v_invites,
    'minutes', v_minutes, 'minute_folders', v_folders));
end $$;

-- ⑥ M1 가드(team_ref_owned_scope — 0016 본문) 에 회의록·폴더 분기 둘. UPDATE 에서 team_id·project_id 가 그대로면 통과(새 참조만)
create or replace function public.team_ref_owned_scope() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_project uuid;
  v_teams uuid[];
begin
  if tg_table_name = 'item_owners' then
    if tg_op = 'UPDATE' and new.team_id = old.team_id and new.wbs_item_id = old.wbs_item_id then
      return new;
    end if;
    select w.project_id into v_project from public.wbs_items w where w.id = new.wbs_item_id;
    v_teams := array[new.team_id];
  elsif tg_table_name = 'project_member_teams' then
    if tg_op = 'UPDATE' and new.team_id = old.team_id and new.member_id = old.member_id then
      return new;
    end if;
    select pm.project_id into v_project from public.project_members pm where pm.id = new.member_id;
    v_teams := array[new.team_id];
  elsif tg_table_name = 'area_teams' then
    if tg_op = 'UPDATE' and new.team_id = old.team_id and new.area_id = old.area_id then
      return new;
    end if;
    select a.project_id into v_project from public.project_areas a where a.id = new.area_id;
    v_teams := array[new.team_id];
  elsif tg_table_name = 'project_invites' then
    v_project := new.project_id;
    if tg_op = 'UPDATE' and new.project_id = old.project_id then
      v_teams := array(select x from pg_catalog.unnest(new.team_ids) as x where not (x = any (coalesce(old.team_ids, '{}'::uuid[]))));
    else
      v_teams := new.team_ids;
    end if;
  elsif tg_table_name in ('minutes', 'minute_folders') then
    -- SP5 B2 — 회의록·폴더는 행 자체에 project_id 가 있다. 팀·프로젝트가 그대로인 UPDATE 는 새 참조가 아니다
    if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id and new.project_id is not distinct from old.project_id then
      return new;
    end if;
    v_project := new.project_id;
    v_teams := case when new.team_id is null then null else array[new.team_id] end;
  else
    raise exception using errcode = '55000', message = 'TEAM_SCOPE_TRIGGER_MISPLACED';
  end if;
  if v_project is null or v_teams is null
     or not exists (select 1 from public.teams t where t.id = any (v_teams) and t.project_id is null) then
    return new;
  end if;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'TEAM_SCOPE_ISOLATION';
  end if;
  perform 1 from public.projects p where p.id = v_project for key share;
  if tg_op = 'INSERT' then
    if tg_table_name = 'item_owners' then
      if exists (select 1 from public.item_owners x where x.wbs_item_id = new.wbs_item_id and x.team_id = new.team_id) then
        return new;
      end if;
    elsif tg_table_name = 'project_member_teams' then
      if exists (select 1 from public.project_member_teams x where x.member_id = new.member_id and x.team_id = new.team_id) then
        return new;
      end if;
    elsif tg_table_name = 'area_teams' then
      if exists (select 1 from public.area_teams x where x.area_id = new.area_id and x.team_id = new.team_id) then
        return new;
      end if;
    end if;
  end if;
  if exists (select 1 from public.teams t join public.teams o on o.project_id = v_project and o.code = t.code
              where t.id = any (v_teams) and t.project_id is null) then
    raise exception using errcode = '23514', message = 'TEAM_SCOPE_PROJECT_OWNED';
  end if;
  return new;
end $$;
create trigger minutes_team_owned_scope before insert or update on public.minutes
  for each row execute function public.team_ref_owned_scope();
create trigger minute_folders_team_owned_scope before insert or update on public.minute_folders
  for each row execute function public.team_ref_owned_scope();

-- ⑧ 사후검사 MINUTES_TEAMS_POSTCHECK — 읽기만 한다
do $$
declare
  v text;
begin
  if exists (select 1 from public.minute_folders f where f.parent_id is null and f.created_by is null and f.kind = 'user') then
    raise exception 'MINUTES_TEAMS_POSTCHECK: 이관되지 않은 옛 시드 루트(kind=user)가 남았다';
  end if;
  if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'teams' and p.policyname = 'wsadmin_insert_teams') then
    raise exception 'MINUTES_TEAMS_POSTCHECK: 세션 공용 팀 INSERT 정책이 남았다';
  end if;
  -- teams INSERT 정책 가운데 project_id is null 행을 허용할 수 있는 분기 0(남은 정책은 project_id is not null 에 묶인다)
  select string_agg(p.policyname, ', ') into v from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'teams' and p.cmd in ('INSERT', 'ALL')
     and coalesce(p.with_check, '') not like '%project_id IS NOT NULL%';
  if v is not null then raise exception 'MINUTES_TEAMS_POSTCHECK: 공용 팀 행을 허용할 수 있는 INSERT 정책: %', v; end if;
  select string_agg(x.tbl || '.' || x.name, ', ') into v
    from (values ('minute_folders', 'minute_folders_kind_guard'), ('minute_folders', 'minute_folders_team_scope'),
                 ('minute_folders', 'minute_folders_team_owned_scope'), ('minutes', 'minutes_team_code_echo'),
                 ('minutes', 'minutes_team_scope'), ('minutes', 'minutes_team_owned_scope'),
                 ('teams', 'teams_name_sync_minute_roots')) as x(tbl, name)
   where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || x.tbl)::regclass and g.tgname = x.name
                       and not g.tgisinternal and g.tgenabled in ('O', 'A'));
  if v is not null then raise exception 'MINUTES_TEAMS_POSTCHECK: 트리거가 없거나 꺼졌다: %', v; end if;
  -- 종류 가드는 INVOKER(세션 문장을 current_user 로 가르려면 — D49), 나머지 셋은 DEFINER
  if exists (select 1 from pg_proc p where p.oid = 'public.minute_folders_kind_guard()'::regprocedure and p.prosecdef) then
    raise exception 'MINUTES_TEAMS_POSTCHECK: 종류 가드가 DEFINER 다';
  end if;
  -- EXECUTE — RPC 둘은 service_role 만, 도우미·트리거 함수는 세션 역할 없음
  select string_agg(f, ', ') into v from unnest(array[
    'public.create_team(uuid, uuid, text, text, text, integer)', 'public.ensure_team_roots(uuid, uuid)',
    'public.minute_team_for_code(uuid, uuid, text)', 'public.actor_is_workspace_admin(uuid, uuid)',
    'public.minute_team_root_insert(uuid, uuid, uuid, text, integer)', 'public.minutes_team_code_echo()',
    'public.minute_team_scope()', 'public.minute_folders_kind_guard()', 'public.teams_name_sync_minute_roots()']) as f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE');
  if v is not null then raise exception 'MINUTES_TEAMS_POSTCHECK: 세션 역할이 실행할 수 있다: %', v; end if;
  if not has_function_privilege('service_role', 'public.create_team(uuid, uuid, text, text, text, integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ensure_team_roots(uuid, uuid)', 'EXECUTE') then
    raise exception 'MINUTES_TEAMS_POSTCHECK: service_role 이 RPC 를 실행하지 못한다';
  end if;
  -- 전환 RPC 가 두 표를 옮기고(SP4 K20 의 카탈로그 불변식은 tests 가 잡는다) SP4 토큰을 지켰다(D12)
  select string_agg(n, ', ') into v from unnest(array['public.minutes m', 'public.minute_folders f', 'TEAM_CONVERT_ISOLATION', 'for update'])
    as n where position(n in (select p.prosrc from pg_proc p where p.oid = 'public.convert_inherited_teams(uuid, uuid)'::regprocedure)) = 0;
  if v is not null then raise exception 'MINUTES_TEAMS_POSTCHECK: 전환 RPC 에 없다: %', v; end if;
  select string_agg(n, ', ') into v from unnest(array['minute_folders', 'TEAM_SCOPE_PROJECT_OWNED', 'for key share', 'TEAM_SCOPE_ISOLATION'])
    as n where position(n in (select p.prosrc from pg_proc p where p.oid = 'public.team_ref_owned_scope()'::regprocedure)) = 0;
  if v is not null then raise exception 'MINUTES_TEAMS_POSTCHECK: M1 가드에 없다: %', v; end if;
  -- 팀 루트 불변식 — 팀 루트는 팀과 같은 워크스페이스·범위
  if exists (select 1 from public.minute_folders f join public.teams t on t.id = f.team_id
              where f.workspace_id <> t.workspace_id or (t.project_id is not null and t.project_id is distinct from f.project_id)) then
    raise exception 'MINUTES_TEAMS_POSTCHECK: 범위 밖 팀을 가리키는 폴더가 있다';
  end if;
end $$;
