-- 0057 롤백 — import_wbs 를 0040 시점 정의(순번 = 파일 안 순번 그대로)로 되돌린다. 이미 가져온 항목의 순번은 바꾸지 않는다.
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

commit;
