-- 0057_import_append_order.sql
-- WBS 가져오기의 추가(append)가 새 항목을 기존 항목 **앞**에 넣던 결함을 고친다(사용자 테스트 BUG-03).
-- import_wbs 가 sort_order 에 파일 안 순번(0부터)을 그대로 써, 기존 항목(화면에서 만든 최상위는 1부터)과 겹치거나 앞섰다 — 형제 정렬은
-- sort_order 라 새 항목이 맨 앞에 오고 기존 WBS 번호(1 → 3)가 전부 밀렸다. 이제 그 프로젝트의 최댓값 다음부터 매긴다.
-- 바꾸는 것은 import_wbs 의 순번 한 줄뿐이다 — 인자·반환·실행권(0039: service_role 전용)·custom(0040)·import_wbs_cmd·replace_wbs 는 그대로다
-- (replace_wbs 는 먼저 다 지우므로 0부터가 맞다). 이미 앞에 끼어든 기존 데이터의 순서는 고치지 않는다(어느 쪽이 먼저였는지 DB 가 모른다 —
-- 화면의 위/아래 이동으로 고친다).

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
  v_base integer;               -- 이 프로젝트의 기존 항목 뒤 첫 순번
begin
  -- 추가(append)는 기존 트리 뒤에 붙는다 — 파일 안 순번(sortOrder, 0부터)을 그대로 쓰면 기존 항목(화면에서 만든 항목은 1부터)보다 앞서
  -- 기존 WBS 번호가 전부 밀린다. 프로젝트 전체의 최댓값 다음부터 매긴다: 새 최상위 항목은 기존 최상위 뒤에 오고, 새 항목끼리의 순서는
  -- 파일 순서 그대로다. 빈 프로젝트는 0 부터(지금과 같다). 같은 프로젝트의 가져오기는 import_wbs_cmd 의 프로젝트 잠금이 줄 세운다
  select coalesce(max(w.sort_order) + 1, 0) into v_base from public.wbs_items w where w.project_id = p_project_id;

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
      v_base + coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
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

-- 사후 검증 — 순번에 기준값을 더하고, custom(0040)과 0039 의 실행권 회수가 유지된다
do $$
begin
  if pg_get_functiondef('public.import_wbs(uuid, jsonb, jsonb)'::regprocedure) !~ 'v_base \+ coalesce' then
    raise exception 'IMPORT_APPEND_ORDER_POSTCHECK: import_wbs 가 기존 항목 뒤 순번을 쓰지 않는다' using errcode = 'P0001';
  end if;
  if pg_get_functiondef('public.import_wbs(uuid, jsonb, jsonb)'::regprocedure) !~ 'is_owner_split, custom' then
    raise exception 'IMPORT_APPEND_ORDER_POSTCHECK: import_wbs 가 custom 열을 쓰지 않는다(0040 회귀)' using errcode = 'P0001';
  end if;
  if has_function_privilege('authenticated', 'public.import_wbs(uuid, jsonb, jsonb)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.import_wbs(uuid, jsonb, jsonb)'::regprocedure, 'EXECUTE') then
    raise exception 'IMPORT_APPEND_ORDER_POSTCHECK: 세션 실행권이 되살아났다' using errcode = '42501';
  end if;
end $$;

commit;
