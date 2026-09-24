-- 0002_import_wbs_level_fix 롤백 — 두 함수를 0000_baseline 본문으로 되돌린다.
--
-- 되돌린 상태는 결함 그대로다: 없는 열 wbs_items.level 에 쓰므로 엑셀 임포트(append·replace)가 다시 실패한다.
-- 기준선(원본 운영과 같은 상태)으로 정확히 돌아가는 것이 롤백의 목적이라 본문은 0000 에서 한 글자도 바꾸지 않는다.

CREATE OR REPLACE FUNCTION public.import_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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
      project_id, parent_id, level, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'level', v_item->>'code',
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
$$;


CREATE OR REPLACE FUNCTION public.replace_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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
      project_id, parent_id, level, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'level', v_item->>'code',
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
$$;
