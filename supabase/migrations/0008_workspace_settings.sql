-- 0008_workspace_settings — SP2 Phase B2. 정본: docs/superpowers/specs/2026-09-26-sp2-workspace-isolation-design.md §4.4.
-- 레지스트리 일반화(키-값 설정)는 SP3 — 여기서는 초대 허용 도메인 한 칸만 둔다(비어 있으면 앱이 env INVITE_ALLOWED_DOMAINS 로 폴백).
-- 순서: ① workspace_settings 표·RLS ② consume_project_invite — 비활성 인물·명단 행을 되살리지 않고 INVITE_INACTIVE
--       ③ project_invites_guard — created_by 불변 ④ workspace_members_keep_last_admin — 관리자 행 잠금 ⑤ 사후검증.
-- ②③④ 는 0007 까지의 pg_get_functiondef 원문을 글자 그대로 옮기고 표시한 곳만 바꿨다(create or replace 라 ACL·트리거는 그대로).
-- 롤백: supabase/rollbacks/0008_workspace_settings_rollback.sql. 스모크: supabase/rehearsal/0008_smoke.sql.

-- ① workspace_settings -------------------------------------------------------------------------------------------
create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  allowed_domains text[] not null default '{}'
    check (array_position(allowed_domains, null) is null),
  updated_at timestamptz not null default now()
);
alter table public.workspace_settings enable row level security;
-- 기본 권한(authenticated 에 truncate·trigger 등 ALL)을 걷고 필요한 넷만 준다. anon 은 없다.
revoke all on public.workspace_settings from anon, authenticated;
grant select, insert, update, delete on public.workspace_settings to authenticated, service_role;
create policy workspace_settings_read on public.workspace_settings for select to authenticated
  using (public.is_ws_member(workspace_id));
create policy workspace_settings_write on public.workspace_settings for all to authenticated
  using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));

-- ② consume_project_invite — 비활성 인물·명단 행이면 23514 INVITE_INACTIVE(되살리던 두 곳을 거부로), 표시 이름의 '@' 폴백 ------
CREATE OR REPLACE FUNCTION public.consume_project_invite(p_token_hash text, p_email text, p_user uuid)
 RETURNS TABLE(workspace_id uuid, project_id uuid, member_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_ws uuid;
  v_project uuid;
  v_access text;
  v_label text;
  v_team_ids uuid[];
  v_email text;
  v_created_by uuid;
  v_name text;
  v_person uuid;
  v_person_user uuid;
  v_member uuid;
  v_old_access text;
  v_new_access text;
  v_first_team uuid;
begin
  update public.project_invites pi
     set redeemed_by = p_user, redeemed_at = now()
   where pi.token_hash = p_token_hash
     and pi.redeemed_at is null
     and pi.revoked_at is null
     and pi.expires_at > now()
     and pi.email = lower(btrim(p_email))
  returning pi.workspace_id, pi.project_id, pi.access_role, pi.role_label, pi.team_ids, pi.email, pi.created_by
       into v_ws, v_project, v_access, v_label, v_team_ids, v_email, v_created_by;
  if not found then
    return;
  end if;

  -- ① profiles upsert — 기존 표시 이름을 유지하고(앞뒤 공백은 정리), 없으면 이메일 로컬 파트.
  -- profiles 는 btrim(display_name) <> '' 만 보지만 people 은 display_name = btrim(display_name) 을 요구하므로,
  -- 정리하지 않으면 공백 붙은 프로필의 계정은 ② 의 people insert 에서 23514 로 초대를 수락하지 못한다.
  insert into public.profiles as pr (user_id, email, display_name)
  values (p_user, v_email, coalesce(nullif(split_part(v_email, '@', 1), ''), v_email))
  on conflict (user_id) do update
     set display_name = coalesce(nullif(btrim(pr.display_name), ''), excluded.display_name), updated_at = now();
  select pr.display_name into v_name from public.profiles pr where pr.user_id = p_user;
  v_name := coalesce(nullif(btrim(v_name), ''), coalesce(nullif(split_part(v_email, '@', 1), ''), v_email));

  -- ② people 연결 — 이 계정의 인물이 이미 있으면 그것, 없으면 (workspace_id, email) 매치 → user_id 설정, 없으면 insert
  select pe.id into v_person
    from public.people pe where pe.workspace_id = v_ws and pe.user_id = p_user
     for update;
  if not found then
    select pe.id, pe.user_id into v_person, v_person_user
      from public.people pe where pe.workspace_id = v_ws and pe.email = v_email
       for update;
    if not found then
      insert into public.people as pe (workspace_id, display_name, email, user_id)
      values (v_ws, v_name, v_email, p_user)
      returning pe.id into v_person;
    elsif v_person_user is null then
      update public.people pe set user_id = p_user, updated_at = now() where pe.id = v_person;
    else
      raise exception using errcode = '23505', message = 'PROJECT_INVITE_PERSON_LINKED';
    end if;
  end if;
  -- 비활성 인물은 되살리지 않고 거부한다(0008) — 비활성화는 관리자의 결정이라 링크 하나로 뒤집히면 안 된다. 관리자가 인물을
  -- 명시적으로 재활성화한 뒤 다시 수락한다. 예외가 함수 전체를 되돌리므로 초대 소비·위의 계정 연결도 남지 않는다.
  if exists (select 1 from public.people pe where pe.id = v_person and not pe.active) then
    raise exception using errcode = '23514', message = 'INVITE_INACTIVE';
  end if;

  -- ③ 워크스페이스 소속
  insert into public.workspace_members as wm (workspace_id, user_id, role, invited_by)
  values (v_ws, p_user, 'member', v_created_by)
  on conflict (workspace_id, user_id) do nothing;

  -- ④ 명단 upsert — 초대가 기존 권한을 깎지 않는다(admin > member > null)
  select pm.id, pm.access_role into v_member, v_old_access
    from public.project_members pm
   where pm.project_id = v_project and pm.person_id = v_person
     for update;
  v_new_access := case
    when v_old_access = 'admin' or v_access = 'admin' then 'admin'
    when v_old_access = 'member' or v_access = 'member' then 'member'
    else null end;
  if v_member is null then
    insert into public.project_members as pm (project_id, person_id, access_role, role_label, access_granted_by)
    values (v_project, v_person, v_new_access, v_label, case when v_new_access is not null then v_created_by end)
    returning pm.id into v_member;
  else
    -- 비활성 명단 행도 같은 이유로 되살리지 않는다(0008) — 관리자가 명단에서 재활성화한다
    if exists (select 1 from public.project_members pm where pm.id = v_member and not pm.active) then
      raise exception using errcode = '23514', message = 'INVITE_INACTIVE';
    end if;
    update public.project_members pm
       set access_role = v_new_access,
           role_label = coalesce(v_label, pm.role_label),
           access_granted_by = case when v_new_access is distinct from v_old_access then v_created_by
                                    else pm.access_granted_by end
     where pm.id = v_member;
  end if;

  -- ⑤ 팀 전개 — 기존 팀 행은 그대로 두고 새 팀만 더한다. 대표 팀이 아직 없으면 초대의 첫 팀을 대표로 —
  -- 그 팀이 이미 대표 아닌 행으로 있던 경우도 포함(insert 의 on conflict do nothing 이 대표 지정을 삼키지 않게 따로 갱신).
  if v_team_ids is not null then
    select x.team_id into v_first_team
      from unnest(v_team_ids) with ordinality as x(team_id, ord)
     where x.team_id is not null
     order by x.ord limit 1;
    insert into public.project_member_teams as pmt (member_id, team_id, is_primary)
    select distinct v_member, x.team_id, false
      from unnest(v_team_ids) as x(team_id)
     where x.team_id is not null
    on conflict (member_id, team_id) do nothing;
    update public.project_member_teams pmt
       set is_primary = true
     where pmt.member_id = v_member and pmt.team_id = v_first_team
       and not exists (select 1 from public.project_member_teams p2 where p2.member_id = v_member and p2.is_primary);
  end if;

  return query select v_ws, v_project, v_member;
end
$function$;

-- ③ project_invites_guard — created_by 불변(발급자 계정 삭제의 FK set null 만 예외) ------------------------------------
CREATE OR REPLACE FUNCTION public.project_invites_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- 발급자는 관리자 초대 판정(아래 PROJECT_INVITE_ADMIN_FORBIDDEN)과 수락 시 access_granted_by 의 근거라 바꾸지 못한다(0008).
  -- 예외는 발급자 계정 삭제의 FK(on delete set null) 하나 — 계정 행이 이미 없을 때만 null 로 비우는 것을 받는다.
  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by
     and not (new.created_by is null and not exists (select 1 from auth.users u where u.id = old.created_by)) then
    raise exception using errcode = '23514', message = 'PROJECT_INVITE_CREATED_BY_IMMUTABLE';
  end if;
  if tg_op = 'INSERT' or new.project_id is distinct from old.project_id
     or new.workspace_id is distinct from old.workspace_id then
    if public.project_ws(new.project_id) is distinct from new.workspace_id then
      raise exception using errcode = '23514', message = 'PROJECT_INVITE_CROSS_WORKSPACE';
    end if;
  end if;
  if new.team_ids is not null and (tg_op = 'INSERT' or new.team_ids is distinct from old.team_ids
     or new.project_id is distinct from old.project_id) then
    if exists (
      select 1 from unnest(new.team_ids) as x(team_id)
       where not exists (
         select 1 from public.teams t
          where t.id = x.team_id
            and (t.project_id = new.project_id
                 or (t.project_id is null and t.workspace_id = new.workspace_id)))) then
      raise exception using errcode = '23514', message = 'PROJECT_INVITE_TEAM_SCOPE';
    end if;
  end if;
  if new.access_role = 'admin' and (tg_op = 'INSERT' or new.access_role is distinct from old.access_role) then
    if new.created_by is null or not (
         exists (select 1 from public.platform_admins a where a.user_id = new.created_by)
      or exists (select 1 from public.workspace_members m
                  where m.workspace_id = new.workspace_id and m.user_id = new.created_by and m.role = 'admin')) then
      raise exception using errcode = '42501', message = 'PROJECT_INVITE_ADMIN_FORBIDDEN';
    end if;
  end if;
  return new;
end
$function$;

-- ④ workspace_members_keep_last_admin — 같은 워크스페이스 관리자 행을 for update 로 잠근 뒤 센다 --------------------------
CREATE OR REPLACE FUNCTION public.workspace_members_keep_last_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.role <> 'admin' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' and new.workspace_id = old.workspace_id then
    return new;
  end if;
  if tg_op = 'DELETE' and (
       not exists (select 1 from public.workspaces w where w.id = old.workspace_id)
    or not exists (select 1 from auth.users u where u.id = old.user_id)) then
    return old;
  end if;
  -- 같은 워크스페이스의 관리자 행을 전부 잠근 뒤 센다(0008). 잠그지 않으면 남은 두 관리자를 두 세션이 동시에 강등·제거할 때
  -- 서로의 미커밋 변경을 못 보고 둘 다 통과해 관리자가 0명이 된다. 잠그면 뒤 세션이 기다렸다가 새 스냅샷으로 다시 센다.
  perform 1 from public.workspace_members m where m.workspace_id = old.workspace_id and m.role = 'admin' for update;
  if not exists (select 1 from public.workspace_members m
                  where m.workspace_id = old.workspace_id and m.role = 'admin'
                    and m.user_id <> old.user_id) then
    raise exception using errcode = '23514', message = 'WORKSPACE_LAST_ADMIN';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

-- ⑤ 사후검증 ------------------------------------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'workspace_settings') <> 2
     or not (select relrowsecurity from pg_class where oid = 'public.workspace_settings'::regclass) then
    raise exception 'SP2_0008_POSTCHECK: workspace_settings 의 RLS·정책 2개가 없다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.consume_project_invite(text, text, uuid)'::regprocedure) ~ 'active = true' then
    raise exception 'SP2_0008_POSTCHECK: consume_project_invite 가 아직 비활성 행을 되살린다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.workspace_members_keep_last_admin()'::regprocedure) !~ 'for update' then
    raise exception 'SP2_0008_POSTCHECK: workspace_members_keep_last_admin 에 잠금이 없다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.project_invites_guard()'::regprocedure) !~ 'PROJECT_INVITE_CREATED_BY_IMMUTABLE' then
    raise exception 'SP2_0008_POSTCHECK: project_invites_guard 에 created_by 불변 검사가 없다';
  end if;
end $$;
