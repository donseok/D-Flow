-- NNNN_calendar 롤백 — 정방향(supabase/migrations/*_calendar.sql)의 역순. 한 트랜잭션.
-- 되돌리지 않는 데이터: 이관 ⑨⑩ 이 기록한 설정 값(calendar.timezone·calendar.week_start)과 그 이력(source='migration' — 이력은 WORM).
--   값은 레지스트리 키라 옛 코드의 해석기가 unknownKeys 로 견딘다. 메인 스택(사용자 DB)에 적용한 뒤에는 §8 #2(주 시작 전환)를
--   덤프 복원 외에는 되돌릴 수 없다(스펙 E35·§8 #2). 재적용은 키가 있는 행을 건드리지 않는다(정방향 ⑨⑩ — 멱등). 조건(L2): 롤백 기간에
--   주 키 트리거가 없어 옛 코드가 남은 규칙의 전환일(E) 이후에도 월요일 키 주간보고를 만든다 — 그런 문서가 생기면 재적용이 ① 사전검사에서
--   CALENDAR_PRECHECK(규칙 밖 키)로 멈춘다. 조치: 그 프로젝트의 project_settings."values" 에서 calendar.week_start 키를 지운다(이력은 남는다)
--   → 재적용의 ①·⑩ 이 키 없는 프로젝트로 다시 판정하고 새 E 를 쓴다.
-- 재생성하는 표 없음. 다시 쓴 함수는 이전 본문(바탕 = sp4-a2-done 시점)으로 되돌린다: 의존성 트리거 둘·사용현황 5종(0000_baseline 원문),
--   settings_ref_check(0012 골격), import_wbs·replace_wbs(SP4 *_command_receipts.sql ③ 원문). modules.* 를 건드리지 않는다.
-- holidays 에 kind = 'work' 행이 있으면 멈춘다 — 열을 지우면 그 행이 휴무로 오해된다(조치: 그 행을 지우고 다시).
-- 순서: 뒤 SP5 파일(*_issue_areas·*_attachments·*_vocab_settings·*_minutes_teams)이 적용돼 있으면 그 롤백이 먼저다.
-- 리허설: supabase/rehearsal/*_calendar_week_start.sql · *_calendar_smoke.sql.
begin;

-- ⑪ 없음(읽기만). ⑨⑩ 되돌리지 않는다(머리 주석).

-- ⑧ 역순 — 옛 가져오기 함수 둘을 SP4 원문 그대로(*_command_receipts.sql ③)
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
    insert into public.holidays (project_id, date, name)
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

    insert into public.wbs_items (
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
    insert into public.holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$function$;

-- ⑦ 역순 — settings_ref_check 를 0012 골격으로(시그니처·INVOKER·ACL 그대로 — create or replace)
create or replace function public.settings_ref_check(p_project_id uuid, p_key text, p_old jsonb, p_new jsonb)
returns void language plpgsql set search_path to '' as $$
begin
  return;   -- 분기 없음(SP3a). 참조형 키를 등록하는 SP 가 create or replace 로 분기를 더한다
end $$;

-- ⑥ 역순 — 주 키 트리거
drop trigger weekly_reports_week_key_guard on public.weekly_reports;
drop function public.weekly_reports_week_key_guard();

-- ⑤ 역순 — 사용현황 5종: 새 시그니처를 지우고 기준선 원문을 다시 만든 뒤 0006 이 남긴 ACL(authenticated·service_role)로
drop function public.usage_daily_actives(date, date, text);
drop function public.usage_menu_ranking(date, date, text);
drop function public.usage_sessions(date, date, text, integer);
drop function public.usage_summary(date, date, date, text);
drop function public.usage_user_rollup(date, date, text);

CREATE FUNCTION public.usage_daily_actives(p_from date, p_to date) RETURNS TABLE(d date, active_users integer, events integer)
    LANGUAGE sql STABLE
    AS $$
  select (occurred_at at time zone 'Asia/Seoul')::date,
         count(distinct user_id)::int,
         count(*)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by 1
  order by 1;
$$;

CREATE FUNCTION public.usage_menu_ranking(p_from date, p_to date) RETURNS TABLE(menu_key text, events integer, active_users integer)
    LANGUAGE sql STABLE
    AS $$
  select menu_key,
         count(*)::int,
         count(distinct user_id)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by menu_key
  order by 2 desc, 1;
$$;

CREATE FUNCTION public.usage_sessions(p_from date, p_to date, p_gap_minutes integer DEFAULT 30) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  with ordered as (
    select user_id,
           occurred_at,
           lag(occurred_at) over (partition by user_id order by occurred_at) as prev_at
    from public.usage_events
    where event_name = 'page_view'
      and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
      and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  )
  select count(*)::int
  from ordered
  where prev_at is null
     or occurred_at - prev_at > make_interval(mins => p_gap_minutes);
$$;

CREATE FUNCTION public.usage_summary(p_from date, p_to date, p_today date) RETURNS TABLE(total_events bigint, active_users bigint, today_users bigint, last_event_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  select
    (select count(*) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_today::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_today + 1)::timestamp at time zone 'Asia/Seoul')),
    (select max(occurred_at) from public.usage_events
       where event_name = 'page_view');
$$;

CREATE FUNCTION public.usage_user_rollup(p_from date, p_to date) RETURNS TABLE(user_id uuid, events integer, active_days integer, last_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  select user_id,
         count(*)::int,
         count(distinct (occurred_at at time zone 'Asia/Seoul')::date)::int,
         max(occurred_at)
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by user_id;
$$;

revoke all on function public.usage_daily_actives(date, date), public.usage_menu_ranking(date, date),
  public.usage_sessions(date, date, integer), public.usage_summary(date, date, date), public.usage_user_rollup(date, date) from public, anon;
grant all on function public.usage_daily_actives(date, date), public.usage_menu_ranking(date, date),
  public.usage_sessions(date, date, integer), public.usage_summary(date, date, date), public.usage_user_rollup(date, date)
  to authenticated, service_role;

-- ④ 역순 — 의존성 트리거 둘을 기준선 원문으로(근무일 판정 = isodow < 6 + 휴일 없음)
CREATE OR REPLACE FUNCTION public.guard_dependent_wbs_dates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.task_dependencies d
     where d.predecessor_id = new.id or d.successor_id = new.id
  ) then
    return new;
  end if;
  if new.planned_start is null or new.planned_end is null or new.planned_start > new.planned_end then
    raise exception '의존성이 연결된 작업의 계획일은 비우거나 역전할 수 없습니다' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from pg_catalog.generate_series(new.planned_start, new.planned_end, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.holidays h where h.project_id = new.project_id and h.date = d::date
       )
  ) then
    raise exception '의존성이 연결된 작업의 계획 기간에는 영업일이 있어야 합니다' using errcode = '23514';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.validate_task_dependency() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_pred_project uuid;
  v_succ_project uuid;
  v_pred_start date;
  v_pred_end date;
  v_succ_start date;
  v_succ_end date;
  v_cycle boolean;
begin
  -- 같은 프로젝트에 대한 동시 반대방향 삽입도 직렬화해 순환 검사 경쟁을 막는다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.project_id::text, 0));

  select project_id, planned_start, planned_end
    into v_pred_project, v_pred_start, v_pred_end
    from public.wbs_items where id = new.predecessor_id;
  select project_id, planned_start, planned_end
    into v_succ_project, v_succ_start, v_succ_end
    from public.wbs_items where id = new.successor_id;

  if v_pred_project is null or v_succ_project is null then
    raise exception '연결할 작업을 찾을 수 없습니다' using errcode = '23503';
  end if;
  if v_pred_project <> new.project_id or v_succ_project <> new.project_id then
    raise exception '같은 프로젝트의 작업끼리만 연결할 수 있습니다' using errcode = '23514';
  end if;
  if v_pred_start is null or v_pred_end is null or v_succ_start is null or v_succ_end is null then
    raise exception '계획 시작일과 종료일이 있는 작업만 연결할 수 있습니다' using errcode = '23514';
  end if;
  if v_pred_start > v_pred_end or v_succ_start > v_succ_end then
    raise exception '시작일이 종료일보다 늦은 작업은 연결할 수 없습니다' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from pg_catalog.generate_series(v_pred_start, v_pred_end, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.holidays h where h.project_id = new.project_id and h.date = d::date
       )
  ) or not exists (
    select 1
      from pg_catalog.generate_series(v_succ_start, v_succ_end, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.holidays h where h.project_id = new.project_id and h.date = d::date
       )
  ) then
    raise exception '계획 기간에 영업일이 없는 작업은 연결할 수 없습니다' using errcode = '23514';
  end if;

  with recursive reachable(id) as (
    select new.successor_id
    union
    select d.successor_id
      from public.task_dependencies d
      join reachable r on d.predecessor_id = r.id
     where d.id <> new.id
  )
  select exists(select 1 from reachable where id = new.predecessor_id) into v_cycle;
  if v_cycle then
    raise exception '순환 의존성은 등록할 수 없습니다' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ③ 역순 — 헬퍼 넷(부르는 쪽 — 트리거·settings_ref_check·의존성 트리거 — 이 위에서 먼저 되돌았다)
drop function public.is_workday(uuid, date);
drop function public.week_key_of(uuid, date);
drop function public.week_key_from_rules(jsonb, date);
drop function public.week_rules_of(jsonb);

-- ② 역순 — holidays.kind(work 행이 있으면 멈춘다)
do $$
declare
  v text;
begin
  select pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('%s:%s', h.project_id, h.date), ', ' order by h.project_id, h.date), 600)
    into v from public.holidays h where h.kind = 'work';
  if v is not null then
    raise exception 'CALENDAR_ROLLBACK: 특정일 근무(kind=work) 행이 있어 열을 지울 수 없다(지우면 휴무로 읽힌다) — %. 그 행을 지우고 다시 돌린다', v;
  end if;
end $$;
alter table public.holidays drop column kind;

-- ① 역순 없음(읽기만)
commit;
