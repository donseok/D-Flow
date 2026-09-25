-- 0004_upsert_member_keep_name — 명단 RPC upsert_project_member 가 이메일로 찾은 기존 인물의 이름을 덮어쓰지 않게 한다.
--
-- 0003 의 이메일 분기는 `insert … on conflict do nothing` 뒤 기존 인물을 읽고, 분기와 무관하게 display_name 을 입력 이름으로
-- update 했다. 함수가 security definer 라 people_update RLS(워크스페이스 관리자 또는 그 인물이 든 프로젝트의 관리자)를 우회해,
-- 프로젝트 A 관리자가 다른 프로젝트 명단의 인물 이메일을 넣는 것만으로 그 인물의 이름을 조용히 바꿀 수 있었다(SP1 Task 12 리뷰).
--
-- 바꾼 것: 이메일 분기는 insert … returning 으로 새로 만든 경우에만 입력 이름을 쓰고, 기존 인물이면 가리키기만 한다.
-- 개명은 p_person.id 로 행을 지목한 편집(id 분기)에서만 하고, 그것도 people_update 정책과 같은 선(워크스페이스 관리자 이상,
-- 또는 그 인물이 이번 upsert 전부터 호출자가 관리자인 프로젝트 명단에 있음)을 넘을 때만 한다 — 0003 은 id 로 명단 밖 인물을
-- 지목해도 개명했다. 선을 넘지 못하면 오류 없이 이름만 두고 명단 추가·수정은 진행한다.
-- 나머지 본문·시그니처·security definer·search_path 는 0003 과 같다. create or replace 는 소유자·권한을 보존하지만
-- 0003 과 같은 revoke/grant 를 다시 적어 둔다(멱등).
-- 롤백: supabase/rollbacks/0004_upsert_member_keep_name_rollback.sql(0003 본문 복원).

create or replace function public.upsert_project_member(
  p_actor uuid, p_project_id uuid, p_person jsonb, p_member jsonb, p_team_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_ws_admin boolean;
  v_person_id uuid;
  v_person_ws uuid;
  v_person_user uuid;
  v_person_name text;
  v_name text := nullif(btrim(p_person->>'display_name'), '');
  v_email text := nullif(lower(btrim(p_person->>'email')), '');
  v_member_id uuid;
  v_old_access text;
  v_old_active boolean;
  v_new_access text;
  v_new_active boolean;
  v_primary uuid;
begin
  if p_actor is null or p_project_id is null or p_person is null then
    raise exception using errcode = '22023', message = 'PROJECT_MEMBER_INVALID_INPUT';
  end if;
  p_member := coalesce(p_member, '{}'::jsonb);

  -- ① 호출자 등급
  v_ws := public.project_ws(p_project_id);
  if v_ws is null then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  v_ws_admin := exists (select 1 from public.platform_admins a where a.user_id = p_actor)
             or exists (select 1 from public.workspace_members m
                         where m.workspace_id = v_ws and m.user_id = p_actor and m.role = 'admin');
  if not v_ws_admin and not exists (
       select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
        where pm.project_id = p_project_id and pe.user_id = p_actor
          and pm.active and pe.active and pm.access_role = 'admin') then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_FORBIDDEN';
  end if;

  -- ② 인물 확정: id 우선, 없으면 (workspace_id, email) 매치, 없으면 insert
  if nullif(p_person->>'id', '') is not null then
    select pe.id, pe.workspace_id, pe.user_id, pe.display_name
      into v_person_id, v_person_ws, v_person_user, v_person_name
      from public.people pe where pe.id = (p_person->>'id')::uuid
       for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'PERSON_NOT_FOUND';
    end if;
    if v_person_ws <> v_ws then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_CROSS_WORKSPACE';
    end if;
    -- 개명은 id 로 행을 지목한 편집에서만, 그것도 people_update 정책과 같은 선에서만(0004): 워크스페이스 관리자 이상이거나
    -- 그 인물이 이번 upsert 전부터 호출자가 관리자인 프로젝트의 명단에 있을 때. 아니면 이름은 두고 명단 쓰기만 진행한다.
    if v_name is not null and v_name is distinct from v_person_name
       and (v_ws_admin or exists (
             select 1 from public.project_members pm
              where pm.person_id = v_person_id
                and exists (select 1 from public.project_members apm join public.people ape on ape.id = apm.person_id
                             where apm.project_id = pm.project_id and ape.user_id = p_actor
                               and apm.active and ape.active and apm.access_role = 'admin'))) then
      update public.people set display_name = v_name, updated_at = now() where id = v_person_id;
    end if;
  else
    if v_name is null then
      raise exception using errcode = '22023', message = 'PERSON_NAME_REQUIRED';
    end if;
    if v_email is not null then
      insert into public.people (workspace_id, display_name, email)
      values (v_ws, v_name, v_email)
      on conflict (workspace_id, email) where email is not null do nothing
      returning id, user_id, display_name into v_person_id, v_person_user, v_person_name;
      -- 이미 있는 인물이면 가리키기만 한다 — 이름은 그 인물의 것이라 입력 이름으로 덮지 않는다(0004)
      if not found then
        select pe.id, pe.user_id, pe.display_name into v_person_id, v_person_user, v_person_name
          from public.people pe where pe.workspace_id = v_ws and pe.email = v_email
           for update;
      end if;
    else
      insert into public.people (workspace_id, display_name)
      values (v_ws, v_name)
      returning id, user_id, display_name into v_person_id, v_person_user, v_person_name;
    end if;
  end if;

  -- ③ 기존 명단 행
  select pm.id, pm.access_role, pm.active into v_member_id, v_old_access, v_old_active
    from public.project_members pm
   where pm.project_id = p_project_id and pm.person_id = v_person_id
     for update;

  v_new_access := case when p_member ? 'access_role' then p_member->>'access_role' else v_old_access end;
  v_new_active := case when p_member ? 'active' then coalesce((p_member->>'active')::boolean, true)
                       else coalesce(v_old_active, true) end;

  -- ④ 규칙
  -- 본인 행의 권한 회수 금지(마지막 관리자 소실 방지). 워크스페이스 관리자는 승계로 항상 관리자라 예외.
  -- 관리자 슬롯 검사보다 먼저 본다 — 비-워크스페이스 관리자인 호출자의 본인 행은 늘 admin 이라, 순서가 반대면
  -- 본인 강등이 언제나 ADMIN_SLOT 으로 보고되고 SELF_DEMOTE 는 도달하지 못한다.
  if v_member_id is not null and v_person_user = p_actor and v_old_access is not null
     and (v_new_access is null
          or (v_old_access = 'admin' and v_new_access = 'member')
          or (v_old_active and not v_new_active))
     and not v_ws_admin then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_SELF_DEMOTE';
  end if;
  -- 관리자 행(새 값 또는 기존 값이 admin)은 워크스페이스 관리자 이상만 — RLS admin_write_member_rows 와 같은 선
  -- (프로젝트 관리자는 admin 행의 표시 필드도 고치지 못한다. 세션 경로와 service_role 경로가 같은 답을 내게 한다).
  if (v_new_access = 'admin' or v_old_access = 'admin') and not v_ws_admin then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_ADMIN_SLOT';
  end if;

  -- ⑤ upsert
  if v_member_id is null then
    insert into public.project_members
      (project_id, person_id, access_role, role_label, title, active, sort_order, access_granted_by)
    values
      (p_project_id, v_person_id, v_new_access, p_member->>'role_label', p_member->>'title', v_new_active,
       coalesce((p_member->>'sort_order')::int, 0),
       case when v_new_access is not null then p_actor end)
    returning id into v_member_id;
  else
    update public.project_members pm
       set access_role = v_new_access,
           role_label = case when p_member ? 'role_label' then p_member->>'role_label' else pm.role_label end,
           title = case when p_member ? 'title' then p_member->>'title' else pm.title end,
           active = v_new_active,
           sort_order = case when p_member ? 'sort_order' then coalesce((p_member->>'sort_order')::int, 0)
                             else pm.sort_order end,
           access_granted_by = case when v_new_access is distinct from v_old_access then p_actor
                                    else pm.access_granted_by end
     where pm.id = v_member_id;
  end if;

  -- ⑥ 팀 동기화 — 결과는 p_team_ids 와 같은 집합이고, 첫 비-null 원소만 대표(is_primary), 나머지는 기존 행이던 것까지
  -- 전부 대표 아님. 대표를 먼저 내리고(부분 유니크 project_member_teams_primary_uidx) upsert 가 모든 행의 is_primary 를 다시 쓴다.
  if p_team_ids is not null then
    select x.team_id into v_primary
      from unnest(p_team_ids) with ordinality as x(team_id, ord)
     where x.team_id is not null
     order by x.ord limit 1;
    delete from public.project_member_teams pmt
     where pmt.member_id = v_member_id
       and not (pmt.team_id = any (array_remove(p_team_ids, null)));
    update public.project_member_teams pmt
       set is_primary = false
     where pmt.member_id = v_member_id and pmt.is_primary and pmt.team_id is distinct from v_primary;
    insert into public.project_member_teams (member_id, team_id, is_primary)
    select distinct v_member_id, x.team_id, x.team_id = v_primary
      from unnest(p_team_ids) as x(team_id)
     where x.team_id is not null
    on conflict (member_id, team_id) do update set is_primary = excluded.is_primary;
  end if;

  -- ⑦
  return v_member_id;
end
$$;
revoke all on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) to service_role;
