-- NNNN_command_receipts 롤백 — 정방향(supabase/migrations/*_command_receipts.sql)의 역순. 한 트랜잭션.
-- 되돌리지 않는 데이터: 영수증(표째 사라진다 — 그 뒤의 재전송은 새 명령으로 적용된다), 전환(convert_inherited_teams)이 만든 전용 팀과
--   옮긴 참조(공용 팀 행은 그대로 남지만 참조를 되돌리는 길은 없다 — 프로젝트는 전용 팀을 쓰는 상태로 남는다).
-- 재생성하는 표 없음. 옛 import_wbs·replace_wbs 는 0009 원문 바이트 그대로 되돌린다(0002 가 아니다 — 0009 가 마지막 정의).
-- 재사용한 트리거 함수 둘(workspace_scope_from_project — 0006, history_reject_truncate — 0012)은 그 파일 소유라 지우지 않는다.
-- modules.* 를 건드리지 않는다 — CR-4 해당 없음(이월은 스펙 §9).
-- 순서: *_weekly_areas 의 롤백보다 먼저 돈다(그 롤백은 import_wbs_cmd 가 있으면 멈춘다). *_authz_carry 와는 서로 기대지 않는다.
begin;

-- ⑤′ 역순 — 공용 팀 참조 거부 트리거 넷과 함수(기존 범위 가드 넷은 고치지 않았다 — 되돌릴 본문 없음)
drop trigger project_invites_owned_scope on public.project_invites;
drop trigger area_teams_owned_scope on public.area_teams;
drop trigger project_member_teams_owned_scope on public.project_member_teams;
drop trigger item_owners_owned_scope on public.item_owners;
drop function public.team_ref_owned_scope();

-- ⑤ 역순 — 전환 RPC(그것이 만든 전용 팀과 옮긴 참조는 되돌리지 않는다 — 머리 주석)
drop function public.convert_inherited_teams(uuid, uuid);

-- ④ 역순 — ⑥ 의 실행권은 함수와 함께 사라진다
drop function public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid);

-- ③ 역순 — 옛 두 함수를 0009 원문 그대로(0009_sp2_isolation_fixes.sql:129-259)
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
       where code = v_owner->>'team'
         and (project_id = p_project_id
              or (project_id is null
                  and workspace_id = (select p.workspace_id from projects p where p.id = p_project_id)))
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
       where code = v_owner->>'team'
         and (project_id = p_project_id
              or (project_id is null
                  and workspace_id = (select p.workspace_id from projects p where p.id = p_project_id)))
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

-- ② 역순 — 트리거 셋과 불변 함수. 재사용 함수 둘은 남긴다
drop trigger command_receipts_no_truncate on public.command_receipts;
drop trigger command_receipts_worm on public.command_receipts;
drop trigger command_receipts_workspace_scope on public.command_receipts;
drop function public.command_receipts_reject_mutation();

-- ① 역순 — 표(인덱스·정책·권한이 함께 사라진다)
drop table public.command_receipts;

commit;
