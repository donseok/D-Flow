-- NNNN_calendar — 달력(주 시작·시간대·근무일·날짜 예외)의 DB 계약(SP5 Phase A). 스펙:
-- docs/superpowers/specs/2026-10-02-sp5-calendar-issues-minutes-design.md §3.1·§3.2, 상위 정본 docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md §2.4.1·§2.8.7·§4.2.3·§4.2.4.
-- 절 순서: ① 사전검사 ② holidays.kind ③ 헬퍼(week_rules_of·week_key_from_rules·week_key_of·is_workday) ④ 의존성 트리거 둘의 근무일 판정
--          ⑤ 사용현황 RPC 5종 p_timezone ⑥ weekly_reports 주 키 트리거 ⑦ settings_ref_check 분기(calendar.week_start 정확 판정·calendar.timezone)
--          ⑧ 가져오기 RPC 둘의 휴일 갱신절 ⑨ 이관 1 — 시간대 ⑩ 이관 2 — 주 시작 ⑪ 사후검사.
-- 권한: 새 헬퍼·트리거 함수는 EXECUTE 를 누구에게도 주지 않는다(revoke all … from public, anon, authenticated — 호출자는 DEFINER 트리거와
--   settings_ref_check 뿐). 사용현황 5종은 시그니처가 바뀌어 drop+create 하고 INVOKER·language sql 을 유지하며 authenticated·service_role 의
--   실행권을 다시 준다(D14 — DEFINER 로 바꾸면 usage_events 의 RLS 가 빠진다). create or replace 로 다시 쓰는 기존 함수는 ACL·보안 속성 그대로.
-- 잠금 순서(D8 — 순환 없음): 주간 생성 = advisory 'weekly:'‖project(create_weekly_report) → insert → ⑥ 트리거의 설정 행 FOR SHARE.
--   설정 저장 = apply_project_settings 의 설정 행 FOR UPDATE → ⑦ settings_ref_check 의 주간 문서 판독(advisory 를 잡지 않는다).
-- 이관 리터럴 'Asia/Seoul' 은 이 파일에만 있다(⑨⑩ — 런타임 코드 0, 스펙 D13 ①). 이관 기록은 0012 꼴(D57).
-- CLI 가 파일 하나를 한 트랜잭션으로 적용하므로 begin/commit 을 쓰지 않는다. 롤백: supabase/rollbacks/*_calendar_rollback.sql.
-- 리허설: supabase/rehearsal/*_calendar_week_start.sql · *_calendar_smoke.sql.

-- ① 사전검사 --------------------------------------------------------------------------------------------------------
-- 주 규칙 키가 아직 없는 프로젝트의 주차 문서는 모두 월요일 키여야 한다(옛 mondayIso 정규화 — 개정 §4.2.4 이관 3 의 raise).
-- 키가 이미 있는 프로젝트(SP5 A 의 픽스처 선기록·롤백 뒤 재적용 등)는 마지막 규칙 원소만 본다(L2 — 헬퍼가 아직 없다): 그 원소의 from
-- (첫 원소면 처음부터) 이후 문서의 요일이 그 원소의 day 가 아니면 멈추고 조치를 적는다. 롤백 기간에 옛 코드가 전환일 뒤에 만든 월요일
-- 문서가 이것이다(롤백 머리 주석). 과도기·앞 원소 구간의 정확 대조는 ⑪-b 가 week_key_of 로 본다.
do $$
declare
  v_n int;
  v_list text;
begin
  select pg_catalog.count(*)::int,
         pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('(프로젝트 %s, %s, isodow %s)', x.project_id, x.week_start, x.dow), ', '
                                               order by x.project_id, x.week_start), 600)
    into v_n, v_list
    from (select r.project_id, r.week_start, extract(isodow from r.week_start)::int as dow,
                 s."values" -> 'calendar.week_start' -> (pg_catalog.jsonb_array_length(s."values" -> 'calendar.week_start') - 1) as last_rule
            from public.weekly_reports r
            join public.project_settings s on s.project_id = r.project_id
           where pg_catalog.jsonb_typeof(s."values" -> 'calendar.week_start') = 'array'
             and pg_catalog.jsonb_array_length(s."values" -> 'calendar.week_start') > 0) x
   where pg_catalog.jsonb_typeof(x.last_rule) = 'object'
     and (x.last_rule ->> 'from' is null
          or pg_catalog.to_char(x.week_start, 'YYYY-MM-DD') >= (x.last_rule ->> 'from'))   -- ISO 꼴 문자열 비교(손상 값에 캐스트하지 않는다)
     and x.dow <> case x.last_rule ->> 'day' when 'sunday' then 7 when 'monday' then 1 else x.dow end;
  if v_n > 0 then
    raise exception using errcode = '23514',
      message = pg_catalog.format('CALENDAR_PRECHECK: 주 규칙 키가 있는데 마지막 규칙 밖의 주 키 %s건 — %s. 롤백 기간에 만든 문서면 그 프로젝트 설정의 '
                                  'calendar.week_start 키를 지운 뒤 다시 적용한다(이관이 다시 판정한다 — 롤백 머리 주석)', v_n, v_list);
  end if;

  select pg_catalog.count(*)::int,
         pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('(프로젝트 %s, %s, isodow %s)', r.project_id, r.week_start,
                                                                   extract(isodow from r.week_start)::int), ', '
                                               order by r.project_id, r.week_start), 600)
    into v_n, v_list
    from public.weekly_reports r
    join public.project_settings s on s.project_id = r.project_id
   where not (s."values" ? 'calendar.week_start')
     and extract(isodow from r.week_start) <> 1;
  if v_n > 0 then
    raise exception using errcode = '23514',
      message = pg_catalog.format('CALENDAR_PRECHECK: 월요일이 아닌 주 키 %s건 — %s. 그 문서의 주 키를 월요일로 고친 뒤 다시 적용한다', v_n, v_list);
  end if;
end $$;

-- ② holidays.kind -----------------------------------------------------------------------------------------------------
-- 날짜 예외의 종류(D7) — off = 휴무(Holiday 시트·기존 행), work = 특정일 근무(일정 화면에서만). 기존 행은 전부 off.
-- 세션 쓰기 길은 그대로다: admin_write_holidays(관리자) + 이 check 가 DB 를 지킨다(관리자가 work 를 쓰는 것이 정상 경로 — §3.1 "세션 쓰기 표의 새 열").
alter table public.holidays add column kind text not null default 'off'
  constraint holidays_kind_check check (kind in ('off', 'work'));

-- ③ 헬퍼 ---------------------------------------------------------------------------------------------------------------
-- week_rules_of: 설정 문서(values 객체)에서 calendar.week_start 를 꺼내 모양을 검사한다. 키 없음(SQL NULL) = 제품 기본값 일요일 한 원소,
-- 손상(JSON null 포함) = 22023 CONFIG_INVALID:calendar.week_start(§2.4.1 — 기본값으로 풀지 않는다). TS parseWeekRules 와 같은 규칙:
-- 원소는 day·from 두 필드만, 첫 원소 from null, 이후 from 은 'YYYY-MM-DD' 오름차순이고 그 날짜의 요일 = day, 이웃 원소의 day 는 다르다,
-- 셋째 원소부터는 그 전환의 Kp(직전 요일의 [from−10, from−4] 날짜)가 앞 전환의 from 이상(전환끼리 겹치지 않는다 — L3).
create function public.week_rules_of(p_values jsonb) returns jsonb
language plpgsql immutable set search_path to '' as $$
declare
  v jsonb := p_values -> 'calendar.week_start';
  v_n int;
  v_e jsonb;
  v_from date;
  v_prev_from date;
  v_prev_day text;
  v_kp date;
begin
  if v is null then
    return '[{"day": "sunday", "from": null}]'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(v) is distinct from 'array' or pg_catalog.jsonb_array_length(v) = 0 then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.week_start';
  end if;
  v_n := pg_catalog.jsonb_array_length(v);
  for i in 0 .. v_n - 1 loop
    v_e := v -> i;
    if pg_catalog.jsonb_typeof(v_e) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_e -> 'day') is distinct from 'string'
       or (v_e ->> 'day') not in ('sunday', 'monday')
       or not (v_e ? 'from')
       or exists (select 1 from pg_catalog.jsonb_object_keys(v_e) as k(k) where k.k not in ('day', 'from'))
       or (v_e ->> 'day') = v_prev_day then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.week_start';
    end if;
    if i = 0 then
      if pg_catalog.jsonb_typeof(v_e -> 'from') is distinct from 'null' then
        raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.week_start';
      end if;
    else
      if pg_catalog.jsonb_typeof(v_e -> 'from') is distinct from 'string'
         or (v_e ->> 'from') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.week_start';
      end if;
      begin
        v_from := (v_e ->> 'from')::date;
      exception when others then
        raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.week_start';
      end;
      if pg_catalog.to_char(v_from, 'YYYY-MM-DD') <> (v_e ->> 'from')
         or (v_prev_from is not null and v_from <= v_prev_from)
         or extract(isodow from v_from)::int <> (case v_e ->> 'day' when 'sunday' then 7 else 1 end) then
        raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.week_start';
      end if;
      if v_prev_from is not null then
        -- Kp = 직전 요일로 시작하는 주 가운데 from−4 가 든 주의 첫날(TS transitionKey)
        v_kp := (v_from - 4) - ((extract(isodow from v_from - 4)::int - (case v_prev_day when 'sunday' then 7 else 1 end) + 7) % 7);
        if v_kp < v_prev_from then
          raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.week_start';
        end if;
      end if;
      v_prev_from := v_from;
    end if;
    v_prev_day := v_e ->> 'day';
  end loop;
  return v;
end $$;

-- week_key_from_rules: 개정 §4.2.4 의 키 함수 — 규칙 인자형 순수 헬퍼(D53). 입력은 week_rules_of 를 지난 목록이다.
--   뒤 원소부터: 날짜 ≥ E(그 원소의 from)면 그 원소 요일의 주 시작. 아니면 직전 원소 요일인 [E-10, E-4] 안의 날짜 Kp(직전 규칙의 마지막
--   주 키 — 창이 7일이라 유일)가 날짜 이하면 Kp(과도기 주 [Kp, E) — 6일 또는 8일). 다 아니면 첫 원소 요일의 주 시작.
--   요일 → isodow: sunday 7, monday 1. 주 시작 = 날짜 − ((isodow(날짜) − 목표 + 7) % 7).
create function public.week_key_from_rules(p_rules jsonb, p_date date) returns date
language plpgsql immutable set search_path to '' as $$
declare
  v_n int := pg_catalog.jsonb_array_length(p_rules);
  v_from date;
  v_kp date;
  v_dow int;
begin
  if p_date is null then
    return null;
  end if;
  for i in reverse v_n - 1 .. 1 loop
    v_from := (p_rules -> i ->> 'from')::date;
    if p_date >= v_from then
      v_dow := case p_rules -> i ->> 'day' when 'sunday' then 7 else 1 end;
      return p_date - ((extract(isodow from p_date)::int - v_dow + 7) % 7);
    end if;
    v_dow := case p_rules -> (i - 1) ->> 'day' when 'sunday' then 7 else 1 end;
    v_kp := (v_from - 10) + ((v_dow - extract(isodow from v_from - 10)::int + 7) % 7);
    if p_date >= v_kp then
      return v_kp;
    end if;
  end loop;
  v_dow := case p_rules -> 0 ->> 'day' when 'sunday' then 7 else 1 end;
  return p_date - ((extract(isodow from p_date)::int - v_dow + 7) % 7);
end $$;

-- week_key_of: 판독형 — 그 프로젝트 설정 행의 규칙으로 키를 낸다. stable 이라 잠그지 않는다(FOR SHARE 는 호출 트리거가 먼저 잡는다 — §2.4.1).
-- 설정 행 없음 = P0001 SETTINGS_ROW_MISSING(행 생성 트리거가 있어 비정상), 키 없음 = 일요일 기본값(E24 — 둘을 가른다).
create function public.week_key_of(p_project_id uuid, p_date date) returns date
language plpgsql stable security definer set search_path to '' as $$
declare
  v_values jsonb;
begin
  select s."values" into v_values from public.project_settings s where s.project_id = p_project_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  return public.week_key_from_rules(public.week_rules_of(v_values), p_date);
end $$;

-- is_workday: TS isWorkingDay 와 같은 판정 — 근무 요일 키를 먼저 검증(손상이면 22023, fail-closed), 그다음 날짜 예외(holidays 행 —
-- PK 라 날짜마다 하나: work 면 근무, off 면 휴무), 없으면 isodow ∈ 근무 요일(키 없음 = [1..5]). stable·잠금 없음(호출 트리거가 잡지 않는다 —
-- 의존성 트리거는 §3.1 의 의도된 예외: 근무 요일을 바꿔도 기존 일정을 다시 검증하지 않는다).
create function public.is_workday(p_project_id uuid, p_date date) returns boolean
language plpgsql stable security definer set search_path to '' as $$
declare
  v_values jsonb;
  v_days jsonb;
  v_kind text;
begin
  select s."values" into v_values from public.project_settings s where s.project_id = p_project_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  v_days := v_values -> 'calendar.working_days';
  if v_days is not null and (
       pg_catalog.jsonb_typeof(v_days) is distinct from 'array'
       or pg_catalog.jsonb_array_length(v_days) = 0
       or exists (select 1 from pg_catalog.jsonb_array_elements(v_days) as x(e)
                   -- 숫자 값으로 판정한다(L4 — 1.0 도 1: TS 는 JSON 파싱 뒤 같은 정수다). case 로 순서를 고정한다(문자열에 numeric 캐스트를 하지 않게)
                   where case when pg_catalog.jsonb_typeof(x.e) = 'number' then (x.e)::numeric not in (1, 2, 3, 4, 5, 6, 7) else true end)
       or (select pg_catalog.count(*) <> pg_catalog.count(distinct x.e) from pg_catalog.jsonb_array_elements(v_days) as x(e))) then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.working_days';
  end if;
  select h.kind into v_kind from public.holidays h where h.project_id = p_project_id and h.date = p_date;
  if v_kind is not null then
    return v_kind = 'work';
  end if;
  if v_days is null then
    return extract(isodow from p_date)::int between 1 and 5;
  end if;
  return v_days @> pg_catalog.to_jsonb(extract(isodow from p_date)::int);
end $$;

revoke all on function public.week_rules_of(jsonb), public.week_key_from_rules(jsonb, date),
  public.week_key_of(uuid, date), public.is_workday(uuid, date) from public, anon, authenticated;

-- ④ 의존성 트리거 둘의 근무일 판정 -----------------------------------------------------------------------------------
-- 기준선(0000_baseline.sql) 본문에서 `extract(isodow from d) < 6 and not exists (holidays …)` 세 곳만 public.is_workday 로 바꾼다.
-- 설정 행을 잠그지 않고 격리 가드도 넣지 않는다 — §3.1 "설정 행 잠금"의 의도된 예외: 근무 요일·휴일을 바꿔도 기존 일정을 다시 검증하지
-- 않으므로(사용자 결정 3) 직렬화가 지킬 불변식이 없다. 성능 게이트(D59)를 넘으면 규칙을 한 번 읽는 집합형 헬퍼로 바꾼다(과제 31b).
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
     where public.is_workday(new.project_id, d::date)
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
     where public.is_workday(new.project_id, d::date)
  ) or not exists (
    select 1
      from pg_catalog.generate_series(v_succ_start, v_succ_end, interval '1 day') d
     where public.is_workday(new.project_id, d::date)
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

-- ⑤ 사용현황 RPC 5종 p_timezone ------------------------------------------------------------------------------------------
-- 기준선 본문의 'Asia/Seoul' 16곳을 p_timezone 으로 바꾼다(D14). 기본값 없음 — 빠뜨린 호출은 함수를 찾지 못한다(42883). usage_sessions 는
-- 기본값 있는 p_gap_minutes 앞에 둔다(기본값 있는 인자 뒤에 없는 인자를 둘 수 없다 — 42P13). 호출부는 이름 인자라 순서와 무관하다.
-- language sql STABLE·INVOKER 를 유지한다 — DEFINER 면 usage_events 의 RLS(read_usage_events — 슈퍼유저)가 빠져 비슈퍼유저에게 열린다.
-- 잘못된 tz 는 행이 0이어도 22023 이어야 한다(fail-closed): 각 본문 맨 바깥 WHERE 에 Var 가 없는 한정식
-- `(pg_catalog.now() at time zone p_timezone) is not null` 을 둔다 — 플래너가 Var 없는 stable 한정식을 게이팅 Result 의 one-time filter 로
-- 올려 스캔 전에 평가한다(계획 P5 — tests/rls/usage-timezone.test.ts 의 빈 표 케이스가 판정한다).
-- drop + create 는 ACL 을 기본값으로 되돌린다 — 아래에서 public·anon 회수 + authenticated·service_role 부여를 명시한다(§3.1 예외 ①).
drop function public.usage_daily_actives(date, date);
drop function public.usage_menu_ranking(date, date);
drop function public.usage_sessions(date, date, integer);
drop function public.usage_summary(date, date, date);
drop function public.usage_user_rollup(date, date);

create function public.usage_daily_actives(p_from date, p_to date, p_timezone text)
returns table(d date, active_users integer, events integer)
language sql stable as $$
  select (occurred_at at time zone p_timezone)::date,
         count(distinct user_id)::int,
         count(*)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone p_timezone)
    and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)
    and (pg_catalog.now() at time zone p_timezone) is not null
  group by 1
  order by 1;
$$;

create function public.usage_menu_ranking(p_from date, p_to date, p_timezone text)
returns table(menu_key text, events integer, active_users integer)
language sql stable as $$
  select menu_key,
         count(*)::int,
         count(distinct user_id)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone p_timezone)
    and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)
    and (pg_catalog.now() at time zone p_timezone) is not null
  group by menu_key
  order by 2 desc, 1;
$$;

create function public.usage_sessions(p_from date, p_to date, p_timezone text, p_gap_minutes integer default 30)
returns integer
language sql stable as $$
  with ordered as (
    select user_id,
           occurred_at,
           lag(occurred_at) over (partition by user_id order by occurred_at) as prev_at
    from public.usage_events
    where event_name = 'page_view'
      and occurred_at >= (p_from::timestamp at time zone p_timezone)
      and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)
  )
  select count(*)::int
  from ordered
  where (prev_at is null
     or occurred_at - prev_at > make_interval(mins => p_gap_minutes))
    and (pg_catalog.now() at time zone p_timezone) is not null;
$$;

create function public.usage_summary(p_from date, p_to date, p_today date, p_timezone text)
returns table(total_events bigint, active_users bigint, today_users bigint, last_event_at timestamp with time zone)
language sql stable as $$
  select
    (select count(*) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone p_timezone)
         and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone p_timezone)
         and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_today::timestamp at time zone p_timezone)
         and occurred_at <  ((p_today + 1)::timestamp at time zone p_timezone)),
    (select max(occurred_at) from public.usage_events
       where event_name = 'page_view')
  where (pg_catalog.now() at time zone p_timezone) is not null;
$$;

create function public.usage_user_rollup(p_from date, p_to date, p_timezone text)
returns table(user_id uuid, events integer, active_days integer, last_at timestamp with time zone)
language sql stable as $$
  select user_id,
         count(*)::int,
         count(distinct (occurred_at at time zone p_timezone)::date)::int,
         max(occurred_at)
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone p_timezone)
    and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)
    and (pg_catalog.now() at time zone p_timezone) is not null
  group by user_id;
$$;

revoke all on function public.usage_daily_actives(date, date, text), public.usage_menu_ranking(date, date, text),
  public.usage_sessions(date, date, text, integer), public.usage_summary(date, date, date, text),
  public.usage_user_rollup(date, date, text) from public, anon;
grant execute on function public.usage_daily_actives(date, date, text), public.usage_menu_ranking(date, date, text),
  public.usage_sessions(date, date, text, integer), public.usage_summary(date, date, date, text),
  public.usage_user_rollup(date, date, text) to authenticated, service_role;

-- ⑥ weekly_reports 주 키 트리거 ----------------------------------------------------------------------------------------
-- 근거(D8·E2): SP4 D27 뒤 세션은 week_start 를 쓸 수 없고 생성은 create_weekly_report 한 길이다 — 이 트리거는 "RLS 직접 쓰기 방어"가 아니라
-- RPC·service_role 경로의 마지막 방어이고, 설정 RPC 와의 직렬화 지점이다(설정 행 FOR SHARE ↔ apply_project_settings 의 FOR UPDATE).
-- 설정을 두 번 읽지 않는다 — 잠근 values 를 변수로 받아 규칙 인자형 순수 헬퍼에 넘긴다(D53, 비평 반영 — S2).
-- 잠금 순서(순환 없음): 생성 = advisory 'weekly:'‖project(RPC) → insert → 이 트리거의 설정 행 FOR SHARE.
--                     설정 저장 = 설정 행 FOR UPDATE → settings_ref_check 의 문서 판독(advisory 를 잡지 않는다).
-- DEFINER — FOR SHARE 에는 UPDATE 권한이 필요하다(§2.4.1 — authenticated 에서 회수됐다).
create function public.weekly_reports_week_key_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_values jsonb;
  v_key date;
begin
  select s."values" into v_values from public.project_settings s where s.project_id = new.project_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  -- 격리 수준 규칙(H2 ③): 잠금 뒤 그 행의 커밋된 최신 값으로 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 규칙 변경 — 스냅샷이 고정된 수준에서는 옛 규칙으로 판정해 E 이후 옛 키가 들어간다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'WEEK_KEY_ISOLATION';
  end if;
  v_key := public.week_key_from_rules(public.week_rules_of(v_values), new.week_start);
  if new.week_start is distinct from v_key then
    raise exception using errcode = '23514', message = 'WEEK_KEY_INVALID',
      detail = pg_catalog.jsonb_build_object('week_start', new.week_start, 'expected', v_key)::text;
  end if;
  return new;
end $$;
revoke all on function public.weekly_reports_week_key_guard() from public, anon, authenticated;
create trigger weekly_reports_week_key_guard before insert or update of week_start on public.weekly_reports
  for each row execute function public.weekly_reports_week_key_guard();

-- ⑦ settings_ref_check 분기 ------------------------------------------------------------------------------------------
-- 0012 의 빈 골격(분기 없음)에 SP5 의 첫 분기 둘을 더한다. 시그니처·INVOKER·search_path·ACL 은 0012 그대로(create or replace 는 ACL 을 유지한다).
-- 부르는 쪽은 apply_project_settings ⑥(설정 행 FOR UPDATE 아래) — set 키는 p_new = 새 값, unset 키는 p_new = SQL NULL 이다.
-- 뒤 SP 는 이 본문 위에 분기를 더한다(_vocab_settings — 앞 분기를 지우지 않음을 그 사후검사가 'calendar.week_start' 문자열로 본다).
create or replace function public.settings_ref_check(p_project_id uuid, p_key text, p_old jsonb, p_new jsonb)
returns void language plpgsql set search_path to '' as $$
declare
  v_rules jsonb;
  v_weeks jsonb;
begin
  -- calendar.week_start — 정확 판정(D53, 비평 반영 — S2): 새 규칙에서 키가 바뀌는 문서가 하나라도 있으면 거부한다. "첫 차이 위치"만 세면
  -- 미적용 전환을 더 늦은 날로 교체할 때 [E1, E2) 의 일요일 키 문서를 놓친다. unset(p_new null) = 제품 기본값 일요일.
  -- 과거 원소 수정 금지(from ≤ T)는 TS toStored 가 판정한다 — 여기는 문서 키 유효성만 본다(미리보기 previewWeekStart 와 같은 정의).
  -- 주간 문서는 프로젝트당 연 52건 수준이라 전수가 싸다(K28).
  if p_key = 'calendar.week_start' then
    v_rules := public.week_rules_of(case when p_new is null then '{}'::jsonb
                                         else pg_catalog.jsonb_build_object('calendar.week_start', p_new) end);
    select pg_catalog.jsonb_agg(x.w order by x.w) into v_weeks
      from (select r.week_start as w
              from public.weekly_reports r
             where r.project_id = p_project_id
               and public.week_key_from_rules(v_rules, r.week_start) <> r.week_start
             order by r.week_start
             limit 20) x;
    if v_weeks is not null then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:calendar.week_start',
        detail = pg_catalog.jsonb_build_object('key', 'calendar.week_start', 'weeks', v_weeks)::text;
    end if;
    return;
  end if;
  -- calendar.timezone — TS(Intl)만 통과한 값이 PG 에 없으면 그 프로젝트의 SQL(이슈 코드 {yyyy} — B1)이 막힌다. DB 쪽 마지막 방어(D54).
  -- 워크스페이스 tz 를 읽는 SQL 은 없다(사용현황 RPC 는 TS 가 tz 를 넘긴다) — 프로젝트만 본다.
  if p_key = 'calendar.timezone' then
    if p_new is null then
      return;
    end if;
    if pg_catalog.jsonb_typeof(p_new) is distinct from 'string' or (p_new #>> '{}') = '' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end if;
    -- '/' 없는 이름은 닫힌 허용 목록만(L1 — TS NO_SLASH_TIMEZONES 와 같다): PG 는 IST·NST·PST·CET·EST 같은 이름을 약어 표에서 먼저 읽어
    -- ICU(TS)와 다른 오프셋이 된다 — 받으면 TS·SQL 이 다른 날짜를 낸다
    if pg_catalog.strpos(p_new #>> '{}', '/') = 0
       and (p_new #>> '{}') not in ('UTC', 'GMT', 'EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT') then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end if;
    begin
      perform pg_catalog.now() at time zone (p_new #>> '{}');
    exception when invalid_parameter_value then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end;
    return;
  end if;
  return;
end $$;

-- ⑧ 가져오기 RPC 둘의 휴일 갱신절 ------------------------------------------------------------------------------------
-- SP4 *_command_receipts.sql ③ 의 본문(바탕 = sp4-a2-done 시점 — D12 승계)을 그대로 쓰고 휴일 upsert 만 바꾼다(D7):
-- Holiday 시트·/api/v1/wbs/import 는 휴무(off)만 쓴다. 같은 날짜에 특정일 근무(work) 행이 있으면 갱신절의 where 가 그 행을 건너뛴다
-- (work 를 off 로 덮거나 지우지 않는다 — 개정 §4.2.3 충돌 규칙). 반환 형태 불변 — 건너뛴 날짜는 가져오기 라우트가 실행 전에 조회해
-- 미리보기·결과에 보인다(과제 27). INVOKER·search_path 미지정·ACL(authenticated 실행권 — ⓚ)은 create or replace 라 그대로다.
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
    insert into public.holidays (project_id, date, name, kind)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''), 'off')
    on conflict (project_id, date) do update set name = excluded.name where public.holidays.kind = 'off';
  end loop;

  return v_count;
end;
$function$;


-- ⑨ 이관 1 — 시간대 / ⑩ 이관 2 — 주 시작 ---------------------------------------------------------------------------------
-- 기록 형식은 0012 ⑤ 꼴(D57): RPC 를 거치지 않고 직접 쓴다 — 범위 행마다 바뀐 키가 있을 때만 revision + 1·updated_at = now()·
-- updated_by = null, schema_version 은 건드리지 않는다, 이력은 바뀐 키마다 (revision+1, key, old_value = 이전 값(없으면 null), new_value,
-- source = 'migration', command_id = 범위 행마다 gen_random_uuid(), changed_by null). ⑨·⑩ 은 한 revision 으로 묶는다(이력 표의 unique
-- (project_id, revision, key)). RPC 를 거치지 않으므로 settings_ref_check 가 돌지 않는다 — ⑩ 의 키 유효성은 ① 의 사전검사가 대신한다.
-- 키가 이미 있는 행은 두 절 모두 건드리지 않는다(R2 — 기존 값 보존. 재적용이 revision 을 더 올리지 않는다).
--
-- ⑨: 기존 워크스페이스·프로젝트 **둘 다**에 calendar.timezone = "Asia/Seoul"(R2 — 런타임 상속이 없어 프로젝트 키가 없으면 곧바로 UTC 가 된다.
--     이 리터럴은 이 파일에만 있다 — D13 ①). calendar.working_days(두 스코프)·워크스페이스 calendar.week_start 는 기록하지 않는다
--     (R1 — 기본값 [1..5] 가 현행, 워크스페이스 sunday 는 사용자 결정 4).
-- ⑩(§8 #2 기본값 — 주간보고가 있는 프로젝트도 다음 주부터 일요일, D5): weekly_reports 가 1건 이상이고 키가 없는 프로젝트마다
--     T = 그 프로젝트 tz(⑨ 의 값)의 오늘, K = T 의 월요일(옛 규칙), E = K + 6(일요일), E <= T 면 E += 7(다음 주부터 보장),
--     max(week_start) >= E 면 E = max(week_start) + 6(미리 만든 미래 주차 뒤로 미룬다 — 그 마지막 월요일 주가 6일 과도기 주가 된다).
--     기록 = [{"day":"monday","from":null},{"day":"sunday","from":E}]. 문서 0건 프로젝트는 키 없음(= 제품 기본값 일요일 — 즉시).
--     **§8 #2 의 대안이 채택되면**(주간보고가 있는 프로젝트는 월요일 유지) 아래 proj_new 의 week_start 식 한 줄을 이것으로 바꾼다:
--       || case when p.v0 ? 'calendar.week_start' or p.max_week is null then '{}'::jsonb
--               else pg_catalog.jsonb_build_object('calendar.week_start', '[{"day": "monday", "from": null}]'::jsonb) end
-- ⑩ 의 E 계산은 날짜 인자형 함수 하나다 — '오늘이 일요일'(E = K+6 ≤ T → K+13) 갈래를 단위 수준에서 밟게(A-2 리뷰 — tests/rls/
-- week-start-transition.test.ts 가 이 블록을 그대로 다시 만들어 부른다). pg_temp — 이 적용 세션에만 있고 카탈로그에 남지 않는다(롤백·사후검사 대상 아님).
-- ⑩ E 계산 블록 시작
create function pg_temp.calendar_migrate_e(p_today date, p_max_week date) returns date
language sql immutable as $$
  select case when p_max_week >= y.e0 then p_max_week + 6 else y.e0 end
    from (select case when x.k + 6 <= p_today then x.k + 13 else x.k + 6 end as e0
            from (select p_today - (extract(isodow from p_today)::int - 1) as k) x) y
$$;
-- ⑩ E 계산 블록 끝
with proj as (
  select s.project_id, s."values" as v0,
         coalesce(s."values" ->> 'calendar.timezone', 'Asia/Seoul') as tz,
         (select pg_catalog.max(r.week_start) from public.weekly_reports r where r.project_id = s.project_id) as max_week
    from public.project_settings s
), proj_e as (
  select p.*, pg_temp.calendar_migrate_e((pg_catalog.now() at time zone p.tz)::date, p.max_week) as e
    from proj p
), proj_new as (
  select p.project_id, p.v0,
         p.v0
         || case when p.v0 ? 'calendar.timezone' then '{}'::jsonb
                 else pg_catalog.jsonb_build_object('calendar.timezone', 'Asia/Seoul') end
         || case when p.v0 ? 'calendar.week_start' or p.max_week is null then '{}'::jsonb
                 else pg_catalog.jsonb_build_object('calendar.week_start', pg_catalog.jsonb_build_array(
                        pg_catalog.jsonb_build_object('day', 'monday', 'from', null),
                        pg_catalog.jsonb_build_object('day', 'sunday', 'from', pg_catalog.to_char(p.e, 'YYYY-MM-DD')))) end
           as v1
    from proj_e p
), upd as (
  update public.project_settings s
     set "values" = n.v1, revision = s.revision + 1, updated_at = pg_catalog.now(), updated_by = null
    from proj_new n
   where s.project_id = n.project_id and n.v1 <> n.v0
  returning s.project_id, s.revision as new_rev
), cmd as (
  select u.project_id, u.new_rev, pg_catalog.gen_random_uuid() as command_id from upd u
)
insert into public.project_settings_history (project_id, revision, key, old_value, new_value, source, command_id, changed_by)
select c.project_id, c.new_rev, e.key, n.v0 -> e.key, e.value, 'migration', c.command_id, null
  from cmd c
  join proj_new n on n.project_id = c.project_id
 cross join lateral pg_catalog.jsonb_each(n.v1) as e(key, value)
 where (n.v0 -> e.key) is distinct from e.value;

-- ⑩ 알림(L6 — A-2 리뷰): 아주 먼 미래 주차 문서(오타 등) 하나가 E 를 그만큼 미루면 사용자 결정 #2(다음 주부터 일요일)가 조용히 무효가 된다.
-- 이 적용이 쓴 규칙(이력의 changed_at = 이 트랜잭션의 now())의 E 가 그 프로젝트 오늘 + 8주를 넘으면 프로젝트·E·오늘을 알린다. 동작은 바꾸지 않는다.
do $$
declare
  r record;
begin
  for r in
    select h.project_id, (h.new_value -> 1 ->> 'from')::date as e,
           (pg_catalog.now() at time zone (s."values" ->> 'calendar.timezone'))::date as t
      from public.project_settings_history h
      join public.project_settings s on s.project_id = h.project_id
     where h.source = 'migration' and h.key = 'calendar.week_start' and h.changed_at = pg_catalog.now()
     order by h.project_id
  loop
    if r.e > r.t + 56 then
      raise notice 'CALENDAR_MIGRATE: 일요일 전환이 8주 넘게 미뤄진 프로젝트 % — E %, 오늘 % (먼 미래 주차 문서를 확인한다)', r.project_id, r.e, r.t;
    end if;
  end loop;
end $$;

with ws_new as (
  select s.workspace_id, s."values" as v0,
         s."values" || pg_catalog.jsonb_build_object('calendar.timezone', 'Asia/Seoul') as v1
    from public.workspace_settings s
   where not (s."values" ? 'calendar.timezone')
), upd as (
  update public.workspace_settings s
     set "values" = n.v1, revision = s.revision + 1, updated_at = pg_catalog.now(), updated_by = null
    from ws_new n
   where s.workspace_id = n.workspace_id
  returning s.workspace_id, s.revision as new_rev
), cmd as (
  select u.workspace_id, u.new_rev, pg_catalog.gen_random_uuid() as command_id from upd u
)
insert into public.workspace_settings_history (workspace_id, revision, key, old_value, new_value, source, command_id, changed_by)
select c.workspace_id, c.new_rev, 'calendar.timezone', null, '"Asia/Seoul"'::jsonb, 'migration', c.command_id, null
  from cmd c;

-- ⑪ 사후검사 — CALENDAR_POSTCHECK. 읽기만 한다. ⑪-a 는 카탈로그(테스트가 민감도를 다시 돌린다), ⑪-b 는 이 적용 시점의 데이터(픽스처가 심긴
-- 테스트 DB 에서는 참이 아닐 수 있어 리허설만 본다).
do $$
-- ⑪-a 카탈로그 블록 — tests/rls/week-start-transition.test.ts 가 이 블록을 그대로 다시 돌린다(민감도)
declare
  v text;
begin
  -- 헬퍼 넷·트리거 함수: 누구에게도 EXECUTE 없음(service_role 은 보지 않는다 — SP4 Q40), 변동성·보안 속성
  select string_agg(x.fn, ', ') into v
    from (values ('public.week_rules_of(jsonb)', 'i', false), ('public.week_key_from_rules(jsonb, date)', 'i', false),
                 ('public.week_key_of(uuid, date)', 's', true), ('public.is_workday(uuid, date)', 's', true),
                 ('public.weekly_reports_week_key_guard()', 'v', true)) as x(fn, vol, secdef)
    join pg_proc p on p.oid = x.fn::regprocedure
   where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
      or p.provolatile <> x.vol or p.prosecdef <> x.secdef
      or not coalesce('search_path=""' = any(p.proconfig), false);
  if v is not null then raise exception 'CALENDAR_POSTCHECK: 헬퍼·트리거 함수의 권한·속성이 기대와 다르다: %', v; end if;

  -- 사용현황 5종: public·anon 거짓, authenticated·service_role 참, INVOKER·stable·언어(P5), 옛 시그니처 0
  select string_agg(x.fn, ', ') into v
    from (values ('public.usage_daily_actives(date, date, text)'), ('public.usage_menu_ranking(date, date, text)'),
                 ('public.usage_sessions(date, date, text, integer)'), ('public.usage_summary(date, date, date, text)'),
                 ('public.usage_user_rollup(date, date, text)')) as x(fn)
    left join pg_proc p on p.oid = to_regprocedure(x.fn)
    left join pg_language l on l.oid = p.prolang
   where p.oid is null
      or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
      or has_function_privilege('anon', p.oid, 'EXECUTE')
      or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or not has_function_privilege('service_role', p.oid, 'EXECUTE')
      or p.prosecdef or p.provolatile <> 's' or l.lanname <> 'sql';
  if v is not null then raise exception 'CALENDAR_POSTCHECK: 사용현황 RPC 의 권한·속성이 기대와 다르다: %', v; end if;
  select string_agg(x.fn, ', ') into v
    from (values ('public.usage_daily_actives(date, date)'), ('public.usage_menu_ranking(date, date)'), ('public.usage_sessions(date, date, integer)'),
                 ('public.usage_summary(date, date, date)'), ('public.usage_user_rollup(date, date)')) as x(fn)
   where to_regprocedure(x.fn) is not null;
  if v is not null then raise exception 'CALENDAR_POSTCHECK: 옛 사용현황 시그니처가 남았다: %', v; end if;

  -- 의존성 트리거 둘: isodow 0, is_workday 사용, 트리거 연결·활성 그대로
  select string_agg(x.fn, ', ') into v
    from (values ('public.guard_dependent_wbs_dates()', 1), ('public.validate_task_dependency()', 2)) as x(fn, n)
    join pg_proc p on p.oid = x.fn::regprocedure
   where position('isodow' in p.prosrc) > 0
      or (length(p.prosrc) - length(replace(p.prosrc, 'public.is_workday(new.project_id, d::date)', '')))
         / length('public.is_workday(new.project_id, d::date)') <> x.n
      or not p.prosecdef;
  if v is not null then raise exception 'CALENDAR_POSTCHECK: 의존성 트리거의 근무일 판정이 기대와 다르다: %', v; end if;
  select string_agg(format('%s.%s', x.tbl, x.name), ', ') into v
    from (values ('wbs_items', 'trg_guard_dependent_wbs_dates', 'public.guard_dependent_wbs_dates()'),
                 ('task_dependencies', 'trg_validate_task_dependency', 'public.validate_task_dependency()'),
                 ('weekly_reports', 'weekly_reports_week_key_guard', 'public.weekly_reports_week_key_guard()')) as x(tbl, name, fn)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = ('public.' || x.tbl)::regclass and g.tgname = x.name and g.tgfoid = x.fn::regprocedure
                        and not g.tgisinternal and g.tgenabled in ('O', 'A'));
  if v is not null then raise exception 'CALENDAR_POSTCHECK: 트리거가 없거나 꺼졌다: %', v; end if;

  -- 주 키 트리거: 설정 행 FOR SHARE·격리 가드·순수 헬퍼(D8·D53). settings_ref_check: 두 분기·정확 판정·INVOKER(0012 그대로)
  if (select position('for share' in p.prosrc) = 0 or position('WEEK_KEY_ISOLATION' in p.prosrc) = 0
             or position('public.week_key_from_rules(public.week_rules_of(v_values)' in p.prosrc) = 0
        from pg_proc p where p.oid = 'public.weekly_reports_week_key_guard()'::regprocedure) then
    raise exception 'CALENDAR_POSTCHECK: 주 키 트리거의 잠금·가드·판정이 기대와 다르다';
  end if;
  if (select position('''calendar.week_start''' in p.prosrc) = 0 or position('''calendar.timezone''' in p.prosrc) = 0
             or position('week_key_from_rules' in p.prosrc) = 0 or position('SETTINGS_CODE_IN_USE:calendar.week_start' in p.prosrc) = 0
             or p.prosecdef
        from pg_proc p where p.oid = 'public.settings_ref_check(uuid, text, jsonb, jsonb)'::regprocedure) then
    raise exception 'CALENDAR_POSTCHECK: settings_ref_check 의 분기가 기대와 다르다';
  end if;

  -- holidays.kind: not null·기본 off·check
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'holidays' and c.column_name = 'kind'
                    and c.is_nullable = 'NO' and c.column_default like '''off''%')
     or not exists (select 1 from pg_constraint k where k.conrelid = 'public.holidays'::regclass and k.conname = 'holidays_kind_check') then
    raise exception 'CALENDAR_POSTCHECK: holidays.kind 의 모양이 기대와 다르다';
  end if;

  -- SP4 본문 승계(D12·K25): 옛 가져오기 함수 둘 — 표 이름 public. 한정(SP4 ③), INVOKER·search_path 미지정·authenticated 실행권(ⓚ),
  -- 휴일 갱신절의 kind 조건. 가져오기 명령 RPC 는 SP4 의 잠금·호출·원장 문장을 그대로 갖는다
  select string_agg(x.fn, ', ') into v
    from (values ('public.import_wbs(uuid, jsonb, jsonb)'), ('public.replace_wbs(uuid, jsonb, jsonb)')) as x(fn)
    join pg_proc p on p.oid = x.fn::regprocedure
   where p.prosrc ~ '(^|[^.[:alnum:]_])(wbs_items|teams|projects|item_owners|holidays)([^[:alnum:]_]|$)'
      or p.prosecdef or p.proconfig is not null
      or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or position('where public.holidays.kind = ''off''' in p.prosrc) = 0
      or position('nullif(v_hol->>''name'', ''''), ''off'')' in p.prosrc) = 0;
  if v is not null then raise exception 'CALENDAR_POSTCHECK: 옛 가져오기 함수가 기대와 다르다: %', v; end if;
  if (select position('''wbs-import:''' in p.prosrc) = 0 or position('public.import_wbs(' in p.prosrc) = 0
             or position('public.replace_wbs(' in p.prosrc) = 0 or position('insert into public.command_receipts' in p.prosrc) = 0
        from pg_proc p where p.oid = 'public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid)'::regprocedure) then
    raise exception 'CALENDAR_POSTCHECK: import_wbs_cmd 의 SP4 문장(wbs-import 잠금·호출·원장)이 사라졌다';
  end if;
end $$;

do $$
-- ⑪-b 데이터 블록 — 이 적용 시점에만 참이어야 하는 것(리허설이 본다)
declare
  v text;
begin
  select pg_catalog.left(string_agg(s.project_id::text, ', '), 600) into v
    from public.project_settings s where not (s."values" ? 'calendar.timezone');
  if v is not null then raise exception 'CALENDAR_POSTCHECK: calendar.timezone 이 없는 프로젝트 설정 행: %', v; end if;
  select pg_catalog.left(string_agg(s.workspace_id::text, ', '), 600) into v
    from public.workspace_settings s where not (s."values" ? 'calendar.timezone');
  if v is not null then raise exception 'CALENDAR_POSTCHECK: calendar.timezone 이 없는 워크스페이스 설정 행: %', v; end if;
  select pg_catalog.left(string_agg(distinct r.project_id::text, ', '), 600) into v
    from public.weekly_reports r join public.project_settings s on s.project_id = r.project_id
   where not (s."values" ? 'calendar.week_start');
  if v is not null then raise exception 'CALENDAR_POSTCHECK: 주간 문서가 있는데 주 규칙이 없는 프로젝트: %', v; end if;
  -- §8 #2 기본값: 이관이 쓴 규칙은 두 원소이고 둘째가 일요일(대안이면 이 검사를 한 원소 monday 로 바꾼다)
  select pg_catalog.left(string_agg(h.project_id::text, ', '), 600) into v
    from public.project_settings_history h
   where h.source = 'migration' and h.key = 'calendar.week_start'
     and not (pg_catalog.jsonb_array_length(h.new_value) = 2 and h.new_value -> 1 ->> 'day' = 'sunday');
  if v is not null then raise exception 'CALENDAR_POSTCHECK: 이관한 주 규칙의 모양이 기대와 다르다: %', v; end if;
  if exists (select 1 from public.holidays h where h.kind <> 'off') then
    raise exception 'CALENDAR_POSTCHECK: 이관 직후 holidays.kind 가 off 가 아닌 행이 있다';
  end if;
  -- 기존 주차 문서 전부가 새 규칙의 키다 — 트리거가 이관 뒤의 update 를 막지 않는다(§3.2 ⑪)
  select pg_catalog.left(string_agg(format('%s:%s', r.project_id, r.week_start), ', '), 600) into v
    from public.weekly_reports r where r.week_start <> public.week_key_of(r.project_id, r.week_start);
  if v is not null then raise exception 'CALENDAR_POSTCHECK: 규칙의 키가 아닌 주차 문서: %', v; end if;
end $$;
