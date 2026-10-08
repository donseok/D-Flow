-- 0040_import_wbs_custom.sql
-- WBS 가져오기가 사용자 정의 필드 값을 싣는다(개정 스펙 §3.6.7 — "import_wbs·replace_wbs 는 노드 custom 객체를 받고 트리거가 검증한다").
-- SP5c 는 Excel 파서(parseWithProfile)가 행에 custom 을 싣게 했지만 두 함수의 INSERT 열에 custom 이 없어 값이 조용히 버려졌다.
-- 바꾸는 것은 INSERT 한 곳뿐이다 — 인자·반환·실행권(0039: service_role 전용)·import_wbs_cmd 는 그대로다.
-- 에이전트 경로 import_wbs_upsert 는 계약 동결이라 건드리지 않는다(custom 미지원).

begin;

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

    insert into public.wbs_items (
      project_id, parent_id, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split, custom
    ) values (
      p_project_id, v_parent, v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false),
      -- 노드의 custom 객체(없거나 JSON null 이면 빈 객체). 모양·키·값은 wbs_items_custom_fields_trg 가 판정한다
      coalesce(nullif(v_item->'custom', 'null'::jsonb), '{}'::jsonb)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from public.teams
       where code = v_owner->>'team'
         and (project_id = p_project_id
              or (project_id is null
                  and workspace_id = (select p.workspace_id from public.projects p where p.id = p_project_id)))
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into public.item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into public.holidays (project_id, date, name, kind)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''), 'off')
    on conflict (project_id, date) do update set name = excluded.name where public.holidays.kind = 'off';
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

    insert into public.wbs_items (
      project_id, parent_id, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split, custom
    ) values (
      p_project_id, v_parent, v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false),
      -- 노드의 custom 객체(없거나 JSON null 이면 빈 객체). 모양·키·값은 wbs_items_custom_fields_trg 가 판정한다
      coalesce(nullif(v_item->'custom', 'null'::jsonb), '{}'::jsonb)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from public.teams
       where code = v_owner->>'team'
         and (project_id = p_project_id
              or (project_id is null
                  and workspace_id = (select p.workspace_id from public.projects p where p.id = p_project_id)))
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into public.item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into public.holidays (project_id, date, name, kind)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''), 'off')
    on conflict (project_id, date) do update set name = excluded.name where public.holidays.kind = 'off';
  end loop;

  return v_count;
end;
$function$;

-- 사후 검증 — 두 함수가 custom 을 쓰고, 0039 의 실행권 회수가 유지된다
do $$
begin
  if pg_get_functiondef('public.import_wbs(uuid, jsonb, jsonb)'::regprocedure) !~ 'is_owner_split, custom'
     or pg_get_functiondef('public.replace_wbs(uuid, jsonb, jsonb)'::regprocedure) !~ 'is_owner_split, custom' then
    raise exception 'IMPORT_WBS_CUSTOM_POSTCHECK: 가져오기 함수가 custom 열을 쓰지 않는다' using errcode = 'P0001';
  end if;
  if has_function_privilege('authenticated', 'public.import_wbs(uuid, jsonb, jsonb)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.replace_wbs(uuid, jsonb, jsonb)'::regprocedure, 'EXECUTE') then
    raise exception 'IMPORT_WBS_CUSTOM_POSTCHECK: authenticated 실행권이 되살아났다' using errcode = '42501';
  end if;
end $$;

commit;
