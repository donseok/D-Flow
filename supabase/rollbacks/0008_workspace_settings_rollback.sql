-- 0008_workspace_settings 롤백 — 0007 적용 직후로 정확히 돌아간다(카탈로그 0 mismatch: compare-catalog.mjs diff).
-- 되돌린 상태는 0007 의 동작 그대로다: 초대 수락이 비활성 인물·명단 행을 조용히 되살리고, project_invites.created_by 를
-- 바꿀 수 있고, 마지막 관리자 검사가 잠금 없이 세어 동시 강등 두 건이 둘 다 통과할 수 있다.
-- workspace_settings 의 허용 도메인은 사라진다 — 앱은 env INVITE_ALLOWED_DOMAINS 만 보는 판으로 함께 되돌린다.
-- 본문 출처: 세 함수 = 0007 적용 DB 의 pg_get_functiondef 원문(0003·0006 에서 정해진 뒤 0007 까지 바뀐 적 없음). 순서는 역순(④ → ①).

begin;

-- ④ workspace_members_keep_last_admin — 잠금 없는 원문
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
  if not exists (select 1 from public.workspace_members m
                  where m.workspace_id = old.workspace_id and m.role = 'admin'
                    and m.user_id <> old.user_id) then
    raise exception using errcode = '23514', message = 'WORKSPACE_LAST_ADMIN';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

-- ③ project_invites_guard — created_by 검사 없는 원문
CREATE OR REPLACE FUNCTION public.project_invites_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
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

-- ② consume_project_invite — 비활성 인물·명단 행을 되살리던 원문
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
  values (p_user, v_email, split_part(v_email, '@', 1))
  on conflict (user_id) do update
     set display_name = coalesce(nullif(btrim(pr.display_name), ''), excluded.display_name), updated_at = now();
  select pr.display_name into v_name from public.profiles pr where pr.user_id = p_user;
  v_name := coalesce(nullif(btrim(v_name), ''), split_part(v_email, '@', 1));

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
  -- 비활성 인물을 다시 초대했으면 되살린다 — 헬퍼가 pe.active 를 보므로, 그대로 두면 "소비된 초대 + 권한 없음" 이 남는다
  update public.people pe set active = true, updated_at = now() where pe.id = v_person and not pe.active;

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
    update public.project_members pm
       set access_role = v_new_access,
           role_label = coalesce(v_label, pm.role_label),
           active = true,
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

-- ① workspace_settings(정책·권한은 표와 함께 사라진다)
drop table public.workspace_settings;

commit;
