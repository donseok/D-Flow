-- *_issue_status_vocab 롤백 — 이슈 표시 상태 트리거·헬퍼·열을 지우고 settings_ref_check·이관 RPC·어휘 헬퍼를 0023 본문으로 되돌린다.
-- 멈추는 경우(데이터 의미가 사라진다 — 스펙 §3.6, 비평 반영 — S10):
--   ① *_workflow_policy 가 적용돼 있다(그 마이그레이션이 settings_ref_check 를 이 본문 위에 다시 썼다 — 먼저 그 롤백)
--   ② 기본 4 code 밖 status_code 를 쓰는 이슈가 있다 ③ workflow.issue_statuses 를 설정한 프로젝트가 있다
-- 남기는 것: 이력 트리거가 쓴 issue_updates(kind='status') 행 — 본문 형식('from>to')이 롤백 뒤 앱과 같다.
do $$
declare
  v text;
begin
  if pg_catalog.to_regclass('public.wbs_stage_approvals') is not null then
    raise exception 'ISSUE_STATUS_ROLLBACK_BLOCKED: *_workflow_policy 가 적용돼 있다 — 그 롤백을 먼저 돈다';
  end if;
  select string_agg(x.what, ', ') into v from (
    select 'issues.status_code=' || i.status_code || '(' || pg_catalog.count(*) || ')' as what from public.issues i
     where i.status_code <> all (array['open', 'in_progress', 'resolved', 'on_hold']) group by i.status_code
    union all
    select 'project_settings=' || s.project_id::text from public.project_settings s where s."values" ? 'workflow.issue_statuses') x;
  if v is not null then
    raise exception using errcode = '23514',
      message = 'ISSUE_STATUS_ROLLBACK_BLOCKED: 사용자 정의 표시 상태가 쓰이고 있다 — migrate_setting_code 로 기본 code 로 옮기고 설정을 지운 뒤 다시: '
                || pg_catalog.left(v, 600);
  end if;
end $$;

drop trigger trg_issue_status_history on public.issues;
drop trigger trg_vocab_issue_status on public.issues;
drop function public.record_issue_status_change();
drop function public.enforce_issue_workflow();

-- settings_ref_check — 0023_vocab_settings 본문 그대로(이슈 표시 상태 분기 제거). issue_statuses_of 보다 먼저 되돌린다(분기가 그 헬퍼를 부른다)
create or replace function public.settings_ref_check(p_project_id uuid, p_key text, p_old jsonb, p_new jsonb)
returns void language plpgsql set search_path to '' as $$
declare
  v_rules jsonb;
  v_weeks jsonb;
  v_old jsonb;
  v_new jsonb;
  v_hit record;
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
  -- issues.id_policy(SP5 B1 — 계획 P7): TS(parseIdPolicy)만 통과한 값이 SQL 검증(issue_id_policy_of)에 걸리면 그 프로젝트의 모든 이슈 등록이 멈춘다.
  -- DB 쪽 마지막 방어. unset(p_new null) = 제품 기본값이라 통과
  if p_key = 'issues.id_policy' then
    if p_new is not null then
      perform public.issue_id_policy_of(pg_catalog.jsonb_build_object('issues.id_policy', p_new));
    end if;
    return;
  end if;
  -- 어휘 네 키(SP5 B4 — D29·D58, 개정 §2.4.2): 옛 목록에 있고 새 목록에서 빠진 code, 또는 의미 속성(attendance.types 의 counts_as)이
  -- 바뀐 code 의 참조 행이 있으면 거부한다. 비활성은 참조가 있어도 된다(새 행만 막힌다 — 트리거). unset·옛 키 없음 = 제품 기본값.
  -- 원인 분류는 분기가 없다(분석 실행 JSON 참조 — TS 가 삭제 금지).
  if p_key in ('attendance.types', 'meetings.categories', 'issues.severities', 'issues.sources') then
    v_old := coalesce(p_old, public.project_vocab_default(p_key));
    v_new := coalesce(p_new, public.project_vocab_default(p_key));
    if pg_catalog.jsonb_typeof(v_new) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || p_key;
    end if;
    select x.code, x.reason, x.cnt into v_hit
      from (select o ->> 'code' as code,
                   case when n is null then 'removed' else 'counts_as' end as reason,
                   public.project_vocab_ref_count(p_project_id, p_key, o ->> 'code') as cnt
              from pg_catalog.jsonb_array_elements(v_old) o
              left join lateral (select e from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = o ->> 'code' limit 1) nn(n) on true
             where n is null
                or (p_key = 'attendance.types' and (n ->> 'counts_as') is distinct from (o ->> 'counts_as'))) x
     where x.cnt > 0
     order by x.code
     limit 1;
    if found then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
        detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', v_hit.reason, 'count', v_hit.cnt)::text;
    end if;
    return;
  end if;
  return;
end $$;

-- 이관 RPC·참조 셈·기본값 — 0023 본문 그대로(create or replace 라 ACL 유지)
create or replace function public.migrate_setting_code(p_actor uuid, p_project_id uuid, p_key text, p_from text, p_to text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_values jsonb;
  v_count bigint;
begin
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'VOCAB_MIGRATE_FORBIDDEN';
  end if;
  if p_key not in ('attendance.types', 'meetings.categories', 'issues.severities', 'issues.sources')
     or p_from is null or p_to is null or p_from = p_to then
    raise exception using errcode = '22023', message = 'VOCAB_MIGRATE_INPUT';
  end if;
  select s."values" into v_values from public.project_settings s where s.project_id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'VOCAB_MIGRATE_ISOLATION';
  end if;
  if not exists (select 1 from pg_catalog.jsonb_array_elements(public.project_vocab_of(v_values, p_key)) e
                  where e ->> 'code' = p_to and (e ->> 'active')::boolean) then
    raise exception using errcode = '23514', message = pg_catalog.format('PROJECT_VOCAB_INACTIVE:%s:%s', p_key, p_to);
  end if;
  if p_key = 'attendance.types' then
    update public.attendance_records set type = p_to where project_id = p_project_id and type = p_from;
  elsif p_key = 'meetings.categories' then
    update public.meetings set category = p_to where project_id = p_project_id and category = p_from;
  elsif p_key = 'issues.severities' then
    update public.issues set severity = p_to where project_id = p_project_id and severity = p_from;
  else
    update public.issues set source_type = p_to where project_id = p_project_id and source_type = p_from;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.project_vocab_ref_count(p_project_id uuid, p_key text, p_code text) returns bigint
language sql stable set search_path = '' as $$
  select case p_key
    when 'attendance.types' then (select pg_catalog.count(*) from public.attendance_records r where r.project_id = p_project_id and r.type = p_code)
    when 'meetings.categories' then (select pg_catalog.count(*) from public.meetings m where m.project_id = p_project_id and m.category = p_code)
    when 'issues.severities' then (select pg_catalog.count(*) from public.issues i where i.project_id = p_project_id and i.severity = p_code)
    when 'issues.sources' then (select pg_catalog.count(*) from public.issues i where i.project_id = p_project_id and i.source_type = p_code)
  end
$$;

create or replace function public.project_vocab_default(p_key text) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_key
    when 'attendance.types' then '[
      {"code":"work","label":"정상근무","short":"근무","color":"done","counts_as":"work","selectable":true,"sort":1,"active":true},
      {"code":"remote","label":"재택","short":"재택","color":"brand","counts_as":"remote","selectable":false,"sort":2,"active":true},
      {"code":"annual","label":"연차","short":"연차","color":"progress","counts_as":"leave","selectable":true,"sort":3,"active":true},
      {"code":"half","label":"반차","short":"반차","color":"progress","counts_as":"leave","selectable":true,"sort":4,"active":true},
      {"code":"quarter","label":"반반차","short":"반반차","color":"progress","counts_as":"leave","selectable":true,"sort":5,"active":true},
      {"code":"sick","label":"병가","short":"병가","color":"delayed","counts_as":"leave","selectable":true,"sort":6,"active":true},
      {"code":"trip","label":"출장","short":"출장","color":"accent","counts_as":"trip","selectable":true,"sort":7,"active":true},
      {"code":"official","label":"공가","short":"공가","color":"pending","counts_as":"work","selectable":false,"sort":8,"active":true},
      {"code":"absent","label":"결근","short":"결근","color":"delayed","counts_as":"absent","selectable":false,"sort":9,"active":true}]'::jsonb
    when 'meetings.categories' then '[
      {"code":"routine","label":"정례","color":"progress","sort":1,"announce_default":false,"active":true},
      {"code":"general","label":"일반","color":"brand","sort":2,"announce_default":false,"active":true},
      {"code":"kickoff","label":"킥오프","color":"done","sort":3,"announce_default":false,"active":true},
      {"code":"review","label":"리뷰","color":"pending","sort":4,"announce_default":false,"active":true},
      {"code":"report","label":"보고","color":"accent","sort":5,"announce_default":false,"active":true},
      {"code":"external","label":"외부/고객","color":"delayed","sort":6,"announce_default":false,"active":true}]'::jsonb
    when 'issues.severities' then '[
      {"code":"high","label":"높음","rank":1,"color":"delayed","active":true},
      {"code":"medium","label":"보통","rank":2,"color":"pending","active":true},
      {"code":"low","label":"낮음","rank":3,"color":"neutral","active":true}]'::jsonb
    when 'issues.sources' then '[
      {"code":"minutes","label":"회의록","sort":1,"active":true},
      {"code":"interview","label":"인터뷰","sort":2,"active":true},
      {"code":"deliverable","label":"산출물","sort":3,"active":true},
      {"code":"as_is_analysis","label":"As-Is 분석","sort":4,"active":true},
      {"code":"data_analysis","label":"데이터 분석","sort":5,"active":true},
      {"code":"other","label":"기타","sort":6,"active":true}]'::jsonb
  end
$$;

drop function public.issue_category_transition_ok(text, text);
drop function public.issue_statuses_of(jsonb);
alter table public.issues drop constraint issues_status_code_shape;
alter table public.issues drop column status_code;
