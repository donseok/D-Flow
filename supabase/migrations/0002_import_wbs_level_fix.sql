-- 0002_import_wbs_level_fix — 엑셀 임포트 RPC 두 개(import_wbs·replace_wbs)가 없는 열 wbs_items.level 에 쓰는 결함을 고친다.
--
-- 원본 리포에서 물려받은 결함이다. 원본 0063 이 두 함수의 insert 에서 level 을 뺐고 0064 가 열을 지웠는데, 그 뒤 0071(프로젝트 팀)이
-- 두 함수를 level 이 든 옛 본문으로 다시 만들었다. plpgsql 은 함수를 만들 때 열 존재를 검사하지 않아 적용은 통과했고, 실행하면
-- `column "level" of relation "wbs_items" does not exist` 로 실패한다 — 엑셀 임포트 마법사(/api/import/execute)의 append·replace 둘 다.
-- 0000_baseline 은 원본 운영을 그대로 옮긴 것이라 이 결함도 그대로 담는다(원본 운영에도 있다).
--
-- 본문은 0000 과 같고 insert 의 level 열과 v_item->>'level' 값만 뺀다(0063 과 같은 조치, 0071 의 프로젝트 팀 우선 조회는 유지).
-- 시그니처·LANGUAGE·보안 속성(invoker, search_path 미지정)은 0000 그대로다. create or replace 는 소유자·권한(anon·authenticated·
-- service_role GRANT)을 보존한다. N단 임포트 import_wbs_upsert 는 level_idx 를 써서 해당 없다.

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
$$;
