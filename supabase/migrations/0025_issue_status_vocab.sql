-- SP5b Phase I(스펙 D1~D10·§3.2, 개정 §3.2): 이슈 표시 상태 — 행은 범주(status, 제품 고정 4종)와 표시 상태(status_code)를 둘 다 가진다(W1).
-- 정의는 프로젝트 설정 workflow.issue_statuses(B4 어휘 계열의 여섯째 키, 키 없음 = 기본 4행 = 범주 code). 판정은 DB 트리거가 최종으로 한다 —
-- PostgREST 직접 PATCH 가 범주 전이표·resolved_at 규칙을 건너뛰던 구멍(member_update_issues 는 열 제한이 없다)을 닫는다.
-- 무엇: ⓪ 판정 헬퍼(기본값·모양·범주 전이표) ① 사전 검사 ② status_code 열·백필 ③ 판정 트리거 ④ 이력 트리거 ⑤ settings_ref_check 분기
--   ⑥ 참조 셈·이관 RPC 분기(같은 범주만 — D3) ⑦ 사후검사. 잠금: 트리거는 설정 행 FOR SHARE, 설정 쓰기·이관은 FOR UPDATE(§2.4.1, B4 와 같다).
-- 데이터 변화: status_code = status 백필뿐(기본 4행 code = 범주 code). 과거 issue_updates 의 'from>to' 본문은 그대로 유효하다.

-- ⓪ 제품 기본 어휘에 이슈 표시 상태 기본 4행을 더한다(0023 본문 + 분기)
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
    -- SP5b: 이슈 표시 상태 기본 4행 — TS DEFAULT_ISSUE_STATUSES 와 같다(code = 범주 code, 현 칩 색)
    when 'workflow.issue_statuses' then '[
      {"code":"open","label":"열림","category":"open","color":"delayed","sort":1,"active":true},
      {"code":"in_progress","label":"진행중","category":"in_progress","color":"progress","sort":2,"active":true},
      {"code":"resolved","label":"해결","category":"resolved","color":"done","sort":3,"active":true},
      {"code":"on_hold","label":"보류","category":"on_hold","color":"neutral","sort":4,"active":true}]'::jsonb
  end
$$;

-- 이슈 표시 상태 정의(값 받는 판 — 행은 호출부가 한 번 읽는다, 비평 반영 — S26 B-20). 판정에 필요한 칸(code·active·category·sort)과
-- 불변식(code 형식·유일, 범주 4값, open·resolved 범주 활성 ≥1, 20개 이하)을 본다. 손상 = 22023 CONFIG_INVALID(기본값으로 위장하지 않는다)
create function public.issue_statuses_of(p_values jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v jsonb := public.project_vocab_of(p_values, 'workflow.issue_statuses');
begin
  if pg_catalog.jsonb_array_length(v) not between 1 and 20
     or exists (select 1 from pg_catalog.jsonb_array_elements(v) e
                 where (e ->> 'code') !~ '^[a-z][a-z0-9_]{0,19}$'
                    or (e ->> 'category') is null or (e ->> 'category') not in ('open', 'in_progress', 'resolved', 'on_hold')
                    or pg_catalog.jsonb_typeof(e -> 'sort') is distinct from 'number')
     or (select pg_catalog.count(distinct e ->> 'code') from pg_catalog.jsonb_array_elements(v) e) <> pg_catalog.jsonb_array_length(v)
     or not exists (select 1 from pg_catalog.jsonb_array_elements(v) e where e ->> 'category' = 'open' and (e ->> 'active')::boolean)
     or not exists (select 1 from pg_catalog.jsonb_array_elements(v) e where e ->> 'category' = 'resolved' and (e ->> 'active')::boolean) then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:workflow.issue_statuses';
  end if;
  return v;
end
$$;
revoke all on function public.issue_statuses_of(jsonb) from public, anon, authenticated;

-- 범주 전이표(제품 고정 — TS STATUS_TRANSITIONS 11간선, resolved→on_hold 만 없다). 같은 범주는 여기 오지 않는다(호출부가 거른다)
create function public.issue_category_transition_ok(p_from text, p_to text) returns boolean
language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (('open','in_progress'), ('open','on_hold'), ('open','resolved'),
                            ('in_progress','open'), ('in_progress','on_hold'), ('in_progress','resolved'),
                            ('on_hold','open'), ('on_hold','in_progress'), ('on_hold','resolved'),
                            ('resolved','open'), ('resolved','in_progress'))
$$;
revoke all on function public.issue_category_transition_ok(text, text) from public, anon, authenticated;

-- ① 사전 검사 — 이미 workflow.issue_statuses 를 가진 프로젝트(지금은 0 — 키 미등록이었다)의 값이 SQL 모양 검사를 통과해야 한다
do $$
declare
  v text;
begin
  select string_agg(s.project_id::text, ', ') into v
    from public.project_settings s
   where s."values" ? 'workflow.issue_statuses'
     and not (select pg_catalog.jsonb_typeof(s."values" -> 'workflow.issue_statuses') = 'array');
  if v is not null then
    raise exception 'ISSUE_STATUS_PRECHECK: 손상된 workflow.issue_statuses: %', v;
  end if;
  perform public.issue_statuses_of(s."values") from public.project_settings s where s."values" ? 'workflow.issue_statuses';
end $$;

-- ② status_code — 백필 뒤 NOT NULL·형식. DEFAULT 는 두지 않는다(트리거가 첫 상태를 채운다). issues_status_check(범주 4값)는 그대로
alter table public.issues add column status_code text;
update public.issues set status_code = status;
alter table public.issues
  alter column status_code set not null,
  add constraint issues_status_code_shape check (status_code ~ '^[a-z][a-z0-9_]{0,19}$');

-- ③ 판정 트리거(스펙 §3.2 표·D4). 같은 시점 트리거 이름 순: trg_assign_issue_code → trg_vocab_issue_severity → trg_vocab_issue_source →
--    trg_vocab_issue_status(마지막 — 파생 status 가 최종값, CHECK 는 그 뒤). project_id 변경은 채번 트리거가 먼저 거부한다.
--    명시값이 파생값과 다르면 거부한다 — 조용히 덮지 않는다(D4 ③). DEFAULT 'open' 이 트리거 전에 채워지므로 "생략"과 "명시 open" 은 같은 뜻.
--    resolved_at 은 이 트리거만 정한다 — service_role 직접 쓰기도 거부(과거 해결일 시드 불가, 비평 반영 — S26 B-26).
create function public.enforce_issue_workflow() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_values jsonb;
  v_defs jsonb;
  v_to jsonb;
  v_to_cat text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.status_code is not distinct from old.status_code
     and new.resolved_at is not distinct from old.resolved_at then
    return new;
  end if;
  select s."values" into v_values from public.project_settings s where s.project_id = new.project_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  -- 격리 수준 규칙(H2 A6): 잠금 뒤 읽은 설정으로 판정하므로 read committed 가 아니면 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'ISSUE_WORKFLOW_ISOLATION';
  end if;
  v_defs := public.issue_statuses_of(v_values);

  if tg_op = 'INSERT' then
    if new.resolved_at is not null then
      raise exception using errcode = '23514', message = 'ISSUE_RESOLVED_AT_DERIVED';
    end if;
    if new.status is distinct from 'open' then
      raise exception using errcode = '23514', message = 'ISSUE_STATUS_DERIVED';
    end if;
    if new.status_code is null then
      select e ->> 'code' into new.status_code
        from pg_catalog.jsonb_array_elements(v_defs) e
       where e ->> 'category' = 'open' and (e ->> 'active')::boolean
       order by (e ->> 'sort')::numeric, e ->> 'code'
       limit 1;
    else
      select e into v_to from pg_catalog.jsonb_array_elements(v_defs) e where e ->> 'code' = new.status_code limit 1;
      if v_to is null then
        raise exception using errcode = '23514', message = 'ISSUE_STATUS_UNKNOWN:' || new.status_code;
      end if;
      if not (v_to ->> 'active')::boolean or (v_to ->> 'category') <> 'open' then
        raise exception using errcode = '23514', message = 'ISSUE_STATUS_NOT_INITIAL:' || new.status_code;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.status_code is not distinct from old.status_code then
    if new.status is distinct from old.status then
      raise exception using errcode = '23514', message = 'ISSUE_STATUS_DERIVED';
    end if;
    raise exception using errcode = '23514', message = 'ISSUE_RESOLVED_AT_DERIVED';   -- 남은 변경은 resolved_at 뿐(맨 위 통과 조건)
  end if;
  select e into v_to from pg_catalog.jsonb_array_elements(v_defs) e where e ->> 'code' = new.status_code limit 1;
  if v_to is null then
    raise exception using errcode = '23514', message = 'ISSUE_STATUS_UNKNOWN:' || coalesce(new.status_code, '');
  end if;
  if not (v_to ->> 'active')::boolean then
    raise exception using errcode = '23514', message = 'ISSUE_STATUS_INACTIVE:' || new.status_code;
  end if;
  v_to_cat := v_to ->> 'category';
  -- from 범주는 정의가 아니라 old.status(트리거가 유지하는 파생값 — 정의가 손상·변경돼도 흔들리지 않는다, 비평 반영 — S26 B-15)
  if v_to_cat <> old.status and not public.issue_category_transition_ok(old.status, v_to_cat) then
    raise exception using errcode = '23514', message = pg_catalog.format('ISSUE_TRANSITION_DENIED:%s>%s', old.status_code, new.status_code);
  end if;
  if new.status is distinct from old.status and new.status is distinct from v_to_cat then
    raise exception using errcode = '23514', message = 'ISSUE_STATUS_DERIVED';
  end if;
  if new.resolved_at is distinct from old.resolved_at then
    raise exception using errcode = '23514', message = 'ISSUE_RESOLVED_AT_DERIVED';
  end if;
  new.status := v_to_cat;
  new.resolved_at := case when v_to_cat <> 'resolved' then null
                          when old.status = 'resolved' then old.resolved_at
                          else pg_catalog.now() end;
  return new;
end
$$;
revoke all on function public.enforce_issue_workflow() from public, anon, authenticated;
create trigger trg_vocab_issue_status before insert or update of status, status_code, resolved_at on public.issues
  for each row execute function public.enforce_issue_workflow();

-- ④ 이력 트리거(D5, 비평 반영 — S5): 표시 상태가 바뀌면 같은 트랜잭션에서 issue_updates(kind='status', 'from>to') 한 행. 액션·PostgREST 직접
--    PATCH·이관 세 경로가 같은 이력을 남긴다. DEFINER — 세션은 kind 열 INSERT 권한이 없다(issue_updates 의 열 GRANT·insert 정책은 note 만).
--    작성자: auth.uid() → GUC dflow.actor(이관 RPC 가 트랜잭션 한정으로 설정, 풀링 연결의 빈 문자열은 null) → null.
--    이름: GUC dflow.actor_name → profiles.display_name → '(이름 없음)'. 계정이 없는 uuid 는 null(FK 위반으로 상태 변경을 깨지 않는다)
create function public.record_issue_status_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_raw text;
  v_name text;
begin
  if v_actor is null then
    v_raw := nullif(pg_catalog.current_setting('dflow.actor', true), '');
    if v_raw ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_actor := v_raw::uuid;
    end if;
  end if;
  if v_actor is not null and not exists (select 1 from auth.users u where u.id = v_actor) then
    v_actor := null;
  end if;
  v_name := nullif(pg_catalog.btrim(coalesce(pg_catalog.current_setting('dflow.actor_name', true), '')), '');
  if v_name is null and v_actor is not null then
    select p.display_name into v_name from public.profiles p where p.user_id = v_actor;
  end if;
  insert into public.issue_updates (issue_id, project_id, kind, body, author_user_id, author_name)
    values (new.id, new.project_id, 'status', old.status_code || '>' || new.status_code, v_actor, coalesce(v_name, '(이름 없음)'));
  return null;
end
$$;
revoke all on function public.record_issue_status_change() from public, anon, authenticated;
create trigger trg_issue_status_history after update of status_code on public.issues
  for each row when (old.status_code is distinct from new.status_code)
  execute function public.record_issue_status_change();

-- ⑤ settings_ref_check — 0023 본문 위에 이슈 표시 상태 분기를 더한다(나머지 분기는 0023 원문 그대로)
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
  -- SP5b(스펙 §3.2 ⑧, 비평 반영 — S8): 이슈 표시 상태 — 새 값의 SQL 모양 검사를 먼저(TS 만 통과한 값이 저장되면 그 프로젝트의 이슈 쓰기가
  -- 22023 으로 멈춘다 — DB 쪽 마지막 방어), 그다음 빠진 code(removed)·범주가 바뀐 code(category)의 참조 이슈 수. 비활성은 참조가 있어도 된다.
  if p_key = 'workflow.issue_statuses' then
    v_new := public.issue_statuses_of(case when p_new is null then '{}'::jsonb
                                           else pg_catalog.jsonb_build_object('workflow.issue_statuses', p_new) end);
    v_old := coalesce(p_old, public.project_vocab_default(p_key));
    select x.code, x.reason, x.cnt into v_hit
      from (select o ->> 'code' as code,
                   case when n is null then 'removed' else 'category' end as reason,
                   public.project_vocab_ref_count(p_project_id, p_key, o ->> 'code') as cnt
              from pg_catalog.jsonb_array_elements(v_old) o
              left join lateral (select e from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = o ->> 'code' limit 1) nn(n) on true
             where n is null or (n ->> 'category') is distinct from (o ->> 'category')) x
     where x.cnt > 0
     order by x.code
     limit 1;
    if found then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
        detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', v_hit.reason, 'count', v_hit.cnt)::text;
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

-- ⑥ 참조 셈·이관 RPC — 0023 본문 위에 이슈 표시 상태 분기(이관은 같은 범주 안으로만, 작성자 GUC)
create or replace function public.project_vocab_ref_count(p_project_id uuid, p_key text, p_code text) returns bigint
language sql stable set search_path = '' as $$
  select case p_key
    when 'attendance.types' then (select pg_catalog.count(*) from public.attendance_records r where r.project_id = p_project_id and r.type = p_code)
    when 'meetings.categories' then (select pg_catalog.count(*) from public.meetings m where m.project_id = p_project_id and m.category = p_code)
    when 'issues.severities' then (select pg_catalog.count(*) from public.issues i where i.project_id = p_project_id and i.severity = p_code)
    when 'issues.sources' then (select pg_catalog.count(*) from public.issues i where i.project_id = p_project_id and i.source_type = p_code)
    when 'workflow.issue_statuses' then (select pg_catalog.count(*) from public.issues i where i.project_id = p_project_id and i.status_code = p_code)
  end
$$;

create or replace function public.migrate_setting_code(p_actor uuid, p_project_id uuid, p_key text, p_from text, p_to text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_values jsonb;
  v_count bigint;
  v_from_cat text;
  v_to_cat text;
  v_name text;
begin
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'VOCAB_MIGRATE_FORBIDDEN';
  end if;
  if p_key not in ('attendance.types', 'meetings.categories', 'issues.severities', 'issues.sources', 'workflow.issue_statuses')
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
  if p_key = 'workflow.issue_statuses' then
    -- SP5b D3: 같은 범주 안으로만 옮긴다 — 범주 전이표를 우회하는 DB 경로를 두지 않고, resolved_at 진입·이탈을 대량 경로에 재구현하지 않는다.
    -- 대상 범주는 새 정의, 출발 범주는 옛 정의(지금 정의에 없으면 그 code 를 쓰는 이슈의 status — 트리거가 old.status 를 쓰는 것과 같다)
    select e ->> 'category' into v_to_cat from pg_catalog.jsonb_array_elements(public.issue_statuses_of(v_values)) e where e ->> 'code' = p_to;
    select e ->> 'category' into v_from_cat from pg_catalog.jsonb_array_elements(public.issue_statuses_of(v_values)) e where e ->> 'code' = p_from;
    if v_from_cat is null then
      select i.status into v_from_cat from public.issues i where i.project_id = p_project_id and i.status_code = p_from limit 1;
    end if;
    if v_from_cat is not null and v_from_cat is distinct from v_to_cat then
      raise exception using errcode = '23514', message = pg_catalog.format('SETTINGS_CODE_CATEGORY_MISMATCH:%s>%s', p_from, p_to);
    end if;
    -- 이력 트리거(record_issue_status_change)가 작성자를 읽는다 — JWT 가 없는 service_role 경로라 GUC 로 넘긴다(트랜잭션 한정)
    select p.display_name into v_name from public.profiles p where p.user_id = p_actor;
    perform pg_catalog.set_config('dflow.actor', p_actor::text, true);
    perform pg_catalog.set_config('dflow.actor_name', coalesce(v_name, ''), true);
    update public.issues set status_code = p_to where project_id = p_project_id and status_code = p_from;
  elsif p_key = 'attendance.types' then
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

-- ⑦ 사후검사 ISSUE_STATUS_POSTCHECK — 읽기만 한다
do $$
declare
  v text;
begin
  if exists (select 1 from public.issues where status_code is null or status_code <> status) then
    raise exception 'ISSUE_STATUS_POSTCHECK: 백필이 범주 code 와 다르다';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.issues'::regclass and conname = 'issues_status_code_shape')
     or not exists (select 1 from pg_constraint where conrelid = 'public.issues'::regclass and conname = 'issues_status_check') then
    raise exception 'ISSUE_STATUS_POSTCHECK: 형식·범주 check 가 기대와 다르다';
  end if;
  select string_agg(x.name, ', ') into v
    from (values ('trg_vocab_issue_status', 'public.enforce_issue_workflow()'), ('trg_issue_status_history', 'public.record_issue_status_change()')) as x(name, fn)
   where not exists (select 1 from pg_trigger g where g.tgrelid = 'public.issues'::regclass and g.tgname = x.name and not g.tgisinternal
                        and g.tgfoid = x.fn::regprocedure and g.tgenabled in ('O', 'A'));
  if v is not null then raise exception 'ISSUE_STATUS_POSTCHECK: 트리거가 없거나 꺼졌다: %', v; end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.enforce_issue_workflow()'::regprocedure)
     or not (select p.prosecdef from pg_proc p where p.oid = 'public.record_issue_status_change()'::regprocedure) then
    raise exception 'ISSUE_STATUS_POSTCHECK: 트리거 함수가 DEFINER 가 아니다';
  end if;
  if public.project_vocab_default('workflow.issue_statuses') is null
     or (select position('''workflow.issue_statuses''' in p.prosrc) = 0 or position('''attendance.types''' in p.prosrc) = 0
               or position('''issues.id_policy''' in p.prosrc) = 0
          from pg_proc p where p.oid = 'public.settings_ref_check(uuid, text, jsonb, jsonb)'::regprocedure) then
    raise exception 'ISSUE_STATUS_POSTCHECK: 기본값·settings_ref_check 분기가 기대와 다르다';
  end if;
  select string_agg(x.fn, ', ') into v
    from (values ('public.issue_statuses_of(jsonb)'), ('public.issue_category_transition_ok(text, text)'), ('public.enforce_issue_workflow()'),
                 ('public.record_issue_status_change()'), ('public.migrate_setting_code(uuid, uuid, text, text, text)')) as x(fn)
    join pg_proc p on p.oid = x.fn::regprocedure
   where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0);
  if v is not null then raise exception 'ISSUE_STATUS_POSTCHECK: EXECUTE 가 열려 있다: %', v; end if;
  if not has_function_privilege('service_role', 'public.migrate_setting_code(uuid, uuid, text, text, text)', 'EXECUTE') then
    raise exception 'ISSUE_STATUS_POSTCHECK: 이관 RPC 의 service_role 실행권이 없다';
  end if;
end $$;
