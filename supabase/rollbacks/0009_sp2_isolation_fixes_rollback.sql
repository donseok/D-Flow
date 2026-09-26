-- 0009_sp2_isolation_fixes 롤백 — 0008 적용 직후로 정확히 돌아간다(카탈로그 0 mismatch: supabase/rehearsal/compare-catalog.mjs diff).
-- 되돌린 상태는 0008 의 동작 그대로다: 워크스페이스에서 빠진 사람의 명단 행이 RLS 권한으로 남고, wbs_items 부모·item_owners 담당 팀·
-- 회의록 폴더 부모·issue_links 회의록이 다른 워크스페이스 행을 가리킬 수 있으며, authenticated 가 wiki_item_has_live_source 를 부른다.
-- 데이터 전제: 없음. 0009 의 제약은 행을 바꾸지 않았고, 롤백은 제약을 풀기만 한다(0009 뒤에 생긴 행은 0008 규칙도 지킨다).
-- 본문 출처: 함수 9개 = 0008 적용 DB 의 pg_get_functiondef 원문(create or replace 라 ACL 은 그대로). 순서는 역순(⑥ → ①).

begin;

-- ⑥ wiki_item_has_live_source — authenticated 실행 권한 복구(기준선 GRANT ALL = EXECUTE)
grant execute on function public.wiki_item_has_live_source(uuid) to authenticated;

-- ⑤ issue_links 회의록 워크스페이스 트리거 제거
drop trigger issue_links_minute_scope on public.issue_links;
drop function public.issue_links_minute_scope();

-- ④ minute_folders_workspace_scope — 0006 원문(프로젝트가 있으면 부모를 보지 않고, workspace_id 변경을 막지 않는다)
CREATE OR REPLACE FUNCTION public.minute_folders_workspace_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ws uuid;
begin
  if new.project_id is not null then
    select p.workspace_id into v_ws from public.projects p where p.id = new.project_id;
  elsif new.parent_id is not null then
    select f.workspace_id into v_ws from public.minute_folders f where f.id = new.parent_id;
  end if;
  if v_ws is null then return new; end if;
  if new.workspace_id is null then
    new.workspace_id := v_ws;
  elsif new.workspace_id <> v_ws then
    raise exception using errcode = '23514', message = 'WORKSPACE_SCOPE_MISMATCH';
  end if;
  return new;
end $function$;

-- ③ item_owners 가드 제거, 임포트 RPC 두 개 — 0002 원문(공용 팀에 워크스페이스 조건 없음)
drop trigger item_owners_guard on public.item_owners;
drop function public.item_owners_guard();
CREATE OR REPLACE FUNCTION public.import_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_item jsonb;
  v_owner jsonb;
  v_hol jsonb;
  v_id uuid;
  v_parent uuid;
  v_team uuid;
  v_map jsonb := '{}'::jsonb;   -- tempId -> 생성된 uuid(text)
  v_count integer := 0;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
  loop
    v_parent := null;
    if nullif(v_item->>'parentTempId', '') is not null then
      v_parent := nullif(v_map->>(v_item->>'parentTempId'), '')::uuid;
    end if;

    insert into wbs_items (
      project_id, parent_id, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from teams
       where code = v_owner->>'team' and (project_id = p_project_id or project_id is null)
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_item jsonb;
  v_owner jsonb;
  v_hol jsonb;
  v_id uuid;
  v_parent uuid;
  v_team uuid;
  v_map jsonb := '{}'::jsonb;   -- tempId -> 생성된 uuid(text)
  v_count integer := 0;
begin
  delete from public.wbs_items where project_id = p_project_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
  loop
    v_parent := null;
    if nullif(v_item->>'parentTempId', '') is not null then
      v_parent := nullif(v_map->>(v_item->>'parentTempId'), '')::uuid;
    end if;

    insert into wbs_items (
      project_id, parent_id, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from teams
       where code = v_owner->>'team' and (project_id = p_project_id or project_id is null)
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$function$;

-- ② wbs_items 부모 FK — 단일 컬럼으로
alter table public.wbs_items drop constraint wbs_items_parent_id_fkey,
  add constraint wbs_items_parent_id_fkey foreign key (parent_id) references public.wbs_items(id) on delete cascade;

-- ① 명단·작성자 분기 — 워크스페이스 멤버십 조건 없는 원문(is_project_admin·is_project_member 는 0003, my_member_id·my_team_ids·
--    is_project_admin_anywhere_in_ws 는 0006, can_edit_issue 는 기준선)
CREATE OR REPLACE FUNCTION public.is_project_admin(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_superuser()
      or (pid is not null and (
             public.is_ws_admin(public.project_ws(pid))
          or exists (select 1 from public.project_members pm
                       join public.people pe on pe.id = pm.person_id
                      where pm.project_id = pid and pm.active and pe.active
                        and pe.user_id = auth.uid() and pm.access_role = 'admin')))
$function$;

CREATE OR REPLACE FUNCTION public.is_project_member(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_project_admin(pid)
      or (pid is not null and exists (
            select 1 from public.project_members pm
              join public.people pe on pe.id = pm.person_id
             where pm.project_id = pid and pm.active and pe.active
               and pe.user_id = auth.uid() and pm.access_role is not null))
$function$;

CREATE OR REPLACE FUNCTION public.my_member_id(pid uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pm.id from public.project_members pm
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pe.user_id = auth.uid() and pm.active and pe.active
   limit 1
$function$;

CREATE OR REPLACE FUNCTION public.my_team_ids(pid uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pmt.team_id from public.project_member_teams pmt
    join public.project_members pm on pm.id = pmt.member_id
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pm.active and pe.active and pe.user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.is_project_admin_anywhere_in_ws(wid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_ws_admin(wid)
      or exists (select 1 from public.project_members pm
                   join public.people pe on pe.id = pm.person_id
                   join public.projects p on p.id = pm.project_id
                  where p.workspace_id = wid and pe.user_id = auth.uid()
                    and pm.active and pe.active and pm.access_role = 'admin')
$function$;

CREATE OR REPLACE FUNCTION public.can_edit_issue(iid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.issues i
    where i.id = iid
      and (i.created_by = auth.uid() or public.is_project_admin(i.project_id))
  )
$function$;

commit;
