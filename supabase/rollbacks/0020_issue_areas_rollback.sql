-- NNNN_issue_areas 롤백 — 정방향(supabase/migrations/*_issue_areas.sql)의 역순. 한 트랜잭션. 카탈로그는 직전 마이그레이션(*_calendar) 적용 직후와
-- 같아진다(리허설 R — supabase/rehearsal/compare-catalog.mjs diff 불일치 0·pg_default_acl 대조). 함수 본문은 원문 바이트 그대로 붙인다(sed —
-- 손으로 옮기지 않는다): settings_ref_check = *_calendar ⑦, project_areas_guard·upsert_project_area = *_weekly_areas, assign_issue_analysis_code =
-- 0010, assign_issue_major_seq·create_issue_from_minute_block = 0000, storage 정책 "issue-attachments insert" = 0007.
-- 조건(계획 P12·D55 ③): 모든 issue_area code 가 숫자 2자리(옛 전역 영역 code 규칙 ^[0-9]{2}$)여야 한다 — 아니면
--   ISSUE_AREAS_ROLLBACK_BLOCKED 로 멈추고 아무것도 바꾸지 않는다(그 DB 는 덤프로 복원한다).
-- 되돌리는 데이터: PI 템플릿(PI-I-<영역 code>-<seq 최소 2자리>, 범위 a:<그 영역>)과 일치하고 분석 메타(하위 공정·주관 부서·원천 유형)가 있는
--   이슈만 mega_code·mega_seq·pi_issue_code·major_id 를 되살린다(옛 메타 CHECK 가 mega 있는 행에 셋을 요구한다). 대분류는 mega_code = 영역 code,
--   카운터는 a:<영역> 범위만 mega_code = 영역 code 로. 전역 영역 issue_mega_areas 는 이슈 영역 code 의 합집합(이름 = 그 code 영역 이름의 min,
--   sort_order = code 의 정수, active = bool_or)으로 다시 만든다.
-- 되돌리지 않는 데이터:
--   · ISS-…·레거시(PI-U-…)·PI 템플릿 밖 코드 문자열 — 옛 모양 표에 code 열이 없어 사라진다(재적용이 다시 매긴다 — 번호가 같다는 보장은 없다)
--   · 새 영역 분류(그 이슈의 area_id — 레거시·ISS 이슈에 나중에 붙인 영역), mega 를 잃는 이슈의 major_id(옛 CHECK 가 mega 없는 major 를 막는다)
--   · 카운터의 a: 밖 범위('' · legacy · y:… · a:…|y:…) — 지운다
--   · 이관이 만든 project_areas 행(이전 스키마도 받아들인다 — 재적용이 같은 행을 재사용한다)
--   · issues.analysis·issues.id_policy 설정 값과 그 이력(source='migration' — 이력은 WORM. 옛 앱은 unknownKeys 로 견딘다)
-- 되돌리는 설정: modules.enabled·modules.allowed 에서 'issue_analysis' 를 뺀다(계획 X8 — 옛 앱의 parseModuleList 는 모르는 모듈 id 를 거부해
--   그 프로젝트 전체가 fail-closed 가 된다). 바뀐 행만 revision + 1, 이력 source='migration'.
-- 재생성하는 표의 이전 모양(*_calendar 적용 뒤 — 2026-10-03 sp5/b1 실측 pg_dump): 세 표(issues·issue_major_processes·issue_number_counters)는
--   열을 다시 붙이지 않고 옛 열 순서로 다시 만든다(카탈로그 대조가 공개 스키마 덤프의 열 순서를 본다 — 계획 X16, 선례 *_weekly_areas 롤백의
--   weekly_report_rows). issues 25열(issue_no identity issues_issue_no_seq — 현재 값을 옮긴다), 권한 anon=r·authenticated=arwd·service_role=all,
--   정책 넷(issues_ws_read 는 0006 본문), 트리거 trg_assign_issue_analysis_code. issue_major_processes 7열·authenticated=ar·정책 둘·트리거
--   trg_assign_issue_major_seq. issue_number_counters 4열·service_role 만. issue_mega_areas 6열·authenticated=r·정책 read_all_issue_mega_areas.
--   발행 표 소속 없음. issues 에 매달린 것: FK 넷(issue_assignees·issue_attachments·issue_links·issue_updates 의 *_issue_project_fk)과 storage 정책
--   "issue-attachments insert"(0007 — public.issues 를 참조해 표를 지우기 전에 떼고 뒤에 다시 만든다).
-- 순서: 뒤 SP5 파일(*_attachments·*_vocab_settings·*_minutes_teams)이 적용돼 있으면 그 롤백이 먼저다.
-- 리허설: supabase/rehearsal/*_issue_areas_seed.sql → 정방향 → *_issue_areas_smoke.sql → 이 파일 → 정방향 → 스모크 →
--   *_issue_areas_rollback_guard.sql → 이 파일이 ISSUE_AREAS_ROLLBACK_BLOCKED 로 멈춘다(계획 과제 6 Step 7).

begin;

-- 조건 — 카탈로그·데이터를 바꾸기 전에 본다
do $$
declare
  v text;
begin
  select pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('%s:%s', a.project_id, a.code), ', ' order by a.project_id, a.code), 600) into v
    from public.project_areas a where a.kind = 'issue_area' and a.code !~ '^[0-9]{2}$';
  if v is not null then
    raise exception using errcode = '23514',
      message = pg_catalog.format('ISSUE_AREAS_ROLLBACK_BLOCKED: 숫자 2자리가 아닌 이슈 영역 code %s — 덤프로 복원한다', v);
  end if;
end $$;

-- S11 없음(읽기만). S10 역순 — settings_ref_check 를 *_calendar ⑦ 원문으로
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

-- S9 역순 — 새 회의록 RPC 를 지운다(옛 시그니처는 표를 되돌린 뒤 0000 원문으로 다시 만든다 — 아래 S9′)
drop function public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text);

-- S8·S7·S6·S4·S2 역순 — 표 셋 재생성. (a) 옮길 행을 옛 모양으로 먼저 계산한다(영역 code·PI 템플릿 판정에 project_areas 가 필요하다)
create temp table sp5_rb_issues on commit drop as
select i.id, i.issue_no, i.project_id, i.title, i.body, i.status, i.severity, i.assignee_member_id, i.due_date, i.resolution_note,
       i.resolved_at, i.created_by, i.created_by_name, i.created_at, i.updated_at, i.start_date,
       case when k.keep then a.code end as mega_code, case when k.keep then i.code_seq end as mega_seq,
       case when k.keep then i.code end as pi_issue_code,
       i.sub_process, i.owner_department, i.related_systems, i.source_type, i.source_detail,
       case when k.keep then i.major_id end as major_id
  from public.issues i
  left join public.project_areas a on a.id = i.code_area_id and a.project_id = i.project_id and a.kind = 'issue_area'
 cross join lateral (select a.id is not null and i.code_scope = 'a:' || a.id
                            and i.code = 'PI-I-' || a.code || '-' || pg_catalog.lpad(i.code_seq::text, greatest(2, pg_catalog.length(i.code_seq::text)), '0')
                            and pg_catalog.btrim(i.sub_process) <> '' and pg_catalog.btrim(i.owner_department) <> '' and i.source_type is not null
                            as keep) k;
create temp table sp5_rb_majors on commit drop as
select p.id, p.project_id, a.code as mega_code, p.major_seq, p.name, p.created_at, p.updated_at
  from public.issue_major_processes p join public.project_areas a on a.id = p.area_id;
create temp table sp5_rb_counters on commit drop as
select c.project_id, a.code as mega_code, c.last_no, c.updated_at
  from public.issue_number_counters c
  join public.project_areas a on a.project_id = c.project_id and a.kind = 'issue_area' and c.scope_key = 'a:' || a.id;
create temp table sp5_rb_mega on commit drop as
select a.code, pg_catalog.min(a.name) as name, a.code::int as sort_order, pg_catalog.bool_or(a.active) as active
  from public.project_areas a where a.kind = 'issue_area' group by a.code;
create temp table sp5_rb_seq on commit drop as select s.last_value, s.is_called from public.issues_issue_no_seq s;

-- (b) issues 에 매달린 것(FK 넷·storage 정책)을 떼고 새 모양 표 셋을 지운다(cascade 금지 — 남은 의존이 있으면 실패해야 한다)
drop policy "issue-attachments insert" on storage.objects;
alter table public.issue_assignees drop constraint issue_assignees_issue_project_fk;
alter table public.issue_attachments drop constraint issue_attachments_issue_project_fk;
alter table public.issue_links drop constraint issue_links_issue_project_fk;
alter table public.issue_updates drop constraint issue_updates_issue_project_fk;
drop table public.issues;
drop table public.issue_number_counters;
drop table public.issue_major_processes;

-- (c) S7 — 채번 함수 넷(트리거는 표와 함께 사라졌다)
drop function public.assign_issue_code();
drop function public.issue_code_year(text, timestamptz);
drop function public.issue_id_policy_of(jsonb);
drop function public.render_issue_code(jsonb, text, int, bigint);

-- (d) S2 — project_areas_guard·upsert_project_area 를 *_weekly_areas 원문으로, 트리거는 update 만
create or replace function public.project_areas_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.code is distinct from old.code then
    raise exception using errcode = '23514', message = 'PROJECT_AREA_CODE_IMMUTABLE';
  end if;
  if new.kind is distinct from old.kind then
    raise exception using errcode = '23514', message = 'PROJECT_AREA_KIND_IMMUTABLE';
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception using errcode = '23514', message = 'PROJECT_AREA_PROJECT_IMMUTABLE';
  end if;
  return new;
end
$$;
drop trigger project_areas_guard on public.project_areas;
create trigger project_areas_guard before update on public.project_areas
  for each row execute function public.project_areas_guard();
create or replace function public.upsert_project_area(p_actor uuid, p_project_id uuid, p_area jsonb, p_teams jsonb, p_from_week date) returns jsonb
language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  -- code·name 은 이 집합(JS trim())의 앞뒤 공백이 없어야 한다 — 롤백·재적용 왕복에서 code 가 이관 라벨과 같게(①′)
  v_space constant text := E'\t\n\x0B\f\r ' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_kind text;
  v_code text;
  v_name text;
  v_id uuid;
  v_area uuid;
  v_old_kind text;
  v_old_code text;
  v_status text;
  v_added int := 0;
begin
  -- 1. null·모양(잠금보다 먼저)
  if p_actor is null or p_project_id is null or p_area is null or pg_catalog.jsonb_typeof(p_area) <> 'object'
     or p_teams is null or pg_catalog.jsonb_typeof(p_teams) <> 'array' then
    raise exception using errcode = '22023', message = 'AREA_INVALID_INPUT';
  end if;
  v_kind := p_area ->> 'kind';
  v_code := p_area ->> 'code';
  v_name := p_area ->> 'name';
  if coalesce(
       v_kind is null or v_kind not in ('weekly_section', 'issue_area')
       or pg_catalog.jsonb_typeof(p_area -> 'code') is distinct from 'string'
       or pg_catalog.jsonb_typeof(p_area -> 'name') is distinct from 'string'
       or v_code = '' or v_code <> pg_catalog.btrim(v_code, v_space)
       or v_name = '' or v_name <> pg_catalog.btrim(v_name, v_space)
       or pg_catalog.jsonb_typeof(p_area -> 'sort_order') is distinct from 'number'
       or (p_area ->> 'sort_order') !~ '^-?[0-9]{1,9}$'
       or pg_catalog.jsonb_typeof(p_area -> 'active') is distinct from 'boolean'
       or coalesce(pg_catalog.jsonb_typeof(p_area -> 'id'), 'null') not in ('string', 'null')
       or (coalesce(pg_catalog.jsonb_typeof(p_area -> 'id'), 'null') = 'string' and (p_area ->> 'id') !~* v_uuid)
       or (v_kind = 'weekly_section' and p_from_week is null), true) then
    raise exception using errcode = '22023', message = 'AREA_INVALID_INPUT';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_teams) as t(e)
              where pg_catalog.jsonb_typeof(t.e) <> 'object'
                 or pg_catalog.jsonb_typeof(t.e -> 'team_id') is distinct from 'string'
                 or (t.e ->> 'team_id') !~* v_uuid
                 or pg_catalog.jsonb_typeof(t.e -> 'kind') is distinct from 'string'
                 or (t.e ->> 'kind') not in ('primary', 'support')) then
    raise exception using errcode = '22023', message = 'AREA_INVALID_INPUT';
  end if;
  if (select pg_catalog.count(*) <> pg_catalog.count(distinct (t.e ->> 'team_id')::uuid)
        from pg_catalog.jsonb_array_elements(p_teams) as t(e)) then
    raise exception using errcode = '22023', message = 'AREA_INVALID_INPUT';
  end if;
  v_id := case when pg_catalog.jsonb_typeof(p_area -> 'id') = 'string' then (p_area ->> 'id')::uuid end;
  -- 2. 잠금(문서 생성과 같은 키) → 격리 가드
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('weekly:' || p_project_id, 0));
  -- 격리 수준 규칙(H2 규칙 ③): 잠금 뒤 영역·문서를 읽어 판정·백필하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 새 문서 — 스냅샷이 고정된 수준에서는 아래 6 이 그 문서를 못 봐 이 영역의 행이 빠진다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'WEEKLY_ISOLATION';
  end if;
  -- 3. 등급 → 프로젝트
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'AREA_FORBIDDEN';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  -- 4. 고치기는 그 프로젝트의 영역만(다른 프로젝트의 영역 id 도 여기서 끝나고 아무것도 바꾸지 않는다), id 가 없으면 만들기
  if v_id is not null then
    select a.id, a.kind, a.code into v_area, v_old_kind, v_old_code
      from public.project_areas a where a.id = v_id and a.project_id = p_project_id for update;
    if v_area is null then
      raise exception using errcode = 'P0002', message = 'AREA_NOT_FOUND';
    end if;
    if v_old_kind is distinct from v_kind then
      raise exception using errcode = '23514', message = 'PROJECT_AREA_KIND_IMMUTABLE';
    end if;
    if v_old_code is distinct from v_code then
      raise exception using errcode = '23514', message = 'PROJECT_AREA_CODE_IMMUTABLE';
    end if;
    update public.project_areas
       set name = v_name, sort_order = (p_area ->> 'sort_order')::int, active = (p_area ->> 'active')::boolean
     where id = v_area and project_id = p_project_id;
    v_status := 'updated';
  else
    insert into public.project_areas (project_id, kind, code, name, sort_order, active)
    values (p_project_id, v_kind, v_code, v_name, (p_area ->> 'sort_order')::int, (p_area ->> 'active')::boolean)
    returning id into v_area;
    v_status := 'created';
  end if;
  -- 5. 영역-팀을 목록으로 — v_area 의 행만(범위 위반은 area_teams_guard 의 23514 AREA_TEAM_SCOPE). 한 트랜잭션이라 지금 액션의 두 문장 비원자가 사라진다
  delete from public.area_teams x
   where x.area_id = v_area
     and x.team_id not in (select (t.e ->> 'team_id')::uuid from pg_catalog.jsonb_array_elements(p_teams) as t(e));
  insert into public.area_teams (area_id, team_id, kind)
  select v_area, (t.e ->> 'team_id')::uuid, t.e ->> 'kind' from pg_catalog.jsonb_array_elements(p_teams) as t(e)
  on conflict (area_id, team_id) do update set kind = excluded.kind;
  -- 6. 활성 주간 영역 — p_from_week 이후 문서에 빈 행(과거 주차는 그대로 — W17)
  if v_kind = 'weekly_section' and (p_area ->> 'active')::boolean then
    insert into public.weekly_report_rows (report_id, project_id, area_id)
    select r.id, r.project_id, v_area from public.weekly_reports r
     where r.project_id = p_project_id and r.week_start >= p_from_week
    on conflict (report_id, area_id) do nothing;
    get diagnostics v_added = row_count;
  end if;
  -- 7. 결과
  return pg_catalog.jsonb_build_object('status', v_status, 'area_id', v_area, 'rows_added', v_added);
end
$$;

-- (e) 전역 영역 issue_mega_areas(0000 모양) — 행은 이슈 영역 code 의 합집합
CREATE TABLE public.issue_mega_areas (
    code text NOT NULL,
    name text NOT NULL,
    sort_order integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT issue_mega_areas_code_check CHECK ((code ~ '^[0-9]{2}$'::text)),
    CONSTRAINT issue_mega_areas_name_check CHECK ((btrim(name) <> ''::text))
);
insert into public.issue_mega_areas (code, name, sort_order, active)
select m.code, m.name, m.sort_order, m.active from pg_temp.sp5_rb_mega m;
ALTER TABLE ONLY public.issue_mega_areas
    ADD CONSTRAINT issue_mega_areas_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.issue_mega_areas
    ADD CONSTRAINT issue_mega_areas_sort_unique UNIQUE (sort_order);
ALTER TABLE public.issue_mega_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_all_issue_mega_areas ON public.issue_mega_areas FOR SELECT TO authenticated USING (true);
revoke all on table public.issue_mega_areas from anon, authenticated;
GRANT SELECT ON TABLE public.issue_mega_areas TO authenticated;
GRANT ALL ON TABLE public.issue_mega_areas TO service_role;

-- (f) 트리거 함수 둘 — assign_issue_analysis_code 는 0010 원문(새로 만든다 — ACL 을 0000 의 REVOKE PUBLIC·service_role 로),
--     assign_issue_major_seq 는 0000 원문(create or replace — ACL 그대로)
CREATE OR REPLACE FUNCTION public.assign_issue_analysis_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_active boolean;
  v_seq bigint;
begin
  if tg_op = 'UPDATE' then
    if old.mega_code is not null
       or old.mega_seq is not null
       or old.pi_issue_code is not null then
      if old.mega_code is null
         or old.mega_seq is null
         or old.pi_issue_code is null then
        raise exception 'ISSUE_CODE_INCONSISTENT' using errcode = '23514';
      end if;
      if new.project_id is distinct from old.project_id
         or new.mega_code is distinct from old.mega_code
         or new.mega_seq is distinct from old.mega_seq
         or new.pi_issue_code is distinct from old.pi_issue_code then
        raise exception 'ISSUE_CODE_IMMUTABLE' using errcode = '23514';
      end if;
      -- 0062: 체번된 이슈의 major 연결을 도로 끊는 것은 금지한다(헤더 계약 4항).
      -- 백필(null→값)과 교정(값→값)은 그대로 허용된다.
      if old.major_id is not null and new.major_id is null then
        raise exception 'ISSUE_MAJOR_UNSET_FORBIDDEN' using errcode = '23514';
      end if;
      return new;
    end if;
  end if;

  if new.mega_code is null then
    if new.mega_seq is not null or new.pi_issue_code is not null then
      raise exception 'ISSUE_CODE_MANAGED' using errcode = '23514';
    end if;
    return new;
  end if;

  -- insert와 기존 미분류 이슈의 최초 분류 모두 seq/code 직접 주입을 허용하지 않는다.
  if new.mega_seq is not null or new.pi_issue_code is not null then
    raise exception 'ISSUE_CODE_MANAGED' using errcode = '23514';
  end if;

  -- 0062: pi 코드가 새로 체번되는 행은 Major Process 분류를 함께 갖춰야 한다.
  -- (레거시 분류 이슈의 기존 행 갱신은 위 UPDATE 불변 분기에서 이미 반환됐다.)
  if new.major_id is null then
    raise exception 'ISSUE_MAJOR_REQUIRED' using errcode = '23514';
  end if;

  select area.active
    into v_active
    from public.issue_mega_areas area
   where area.code = new.mega_code;
  if not found or not v_active then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '23514';
  end if;

  insert into public.issue_number_counters as counter (
    project_id, mega_code, last_no, updated_at
  ) values (
    new.project_id, new.mega_code, 1, now()
  )
  on conflict (project_id, mega_code) do update
    set last_no = counter.last_no + 1,
        updated_at = now()
  returning last_no into v_seq;

  new.mega_seq := v_seq;
  new.pi_issue_code :=
    'PI-I-' || new.mega_code || '-' || pg_catalog.lpad(v_seq::text, greatest(2, pg_catalog.length(v_seq::text)), '0');
  return new;
end
$$;
revoke all on function public.assign_issue_analysis_code() from public, anon, authenticated;
grant execute on function public.assign_issue_analysis_code() to service_role;
CREATE OR REPLACE FUNCTION public.assign_issue_major_seq() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_active boolean;
  v_seq bigint;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
       or new.mega_code is distinct from old.mega_code
       or new.major_seq is distinct from old.major_seq then
      raise exception 'ISSUE_MAJOR_IMMUTABLE' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.major_seq is not null then
    raise exception 'ISSUE_MAJOR_SEQ_MANAGED' using errcode = '23514';
  end if;

  select area.active
    into v_active
    from public.issue_mega_areas area
   where area.code = new.mega_code;
  if not found or not v_active then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '23514';
  end if;

  -- 유니크 키·dedupe 비교의 기준을 저장 전에 한 곳에서 고정한다.
  new.name := btrim(new.name);

  -- (project, mega) 단위 직렬화 후 MAX+1 — 트랜잭션 종료까지 잠금이 유지되어
  -- 동시 등록에도 안전하고, 유니크 충돌로 번호만 소모되는 결번이 없다(헤더 2항).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'issue_major:' || new.project_id::text || ':' || new.mega_code, 0
    )
  );
  select coalesce(max(mp.major_seq), 0) + 1
    into v_seq
    from public.issue_major_processes mp
   where mp.project_id = new.project_id
     and mp.mega_code = new.mega_code;

  new.major_seq := v_seq;
  return new;
end
$$;

-- (g) issue_major_processes(옛 모양) — 행을 먼저 옮기고(트리거가 major_seq 주입을 막는다) 제약·트리거·정책·권한을 건다
CREATE TABLE public.issue_major_processes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    mega_code text NOT NULL,
    major_seq bigint NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT issue_major_processes_name_check CHECK (((btrim(name) <> ''::text) AND (name = btrim(name)) AND (char_length(name) <= 100) AND (name !~ '^[[({（【]?[[:space:]]*[0-9]{2}(\.[0-9]{2})+'::text))),
    CONSTRAINT issue_major_processes_seq_check CHECK ((major_seq > 0))
);
insert into public.issue_major_processes (id, project_id, mega_code, major_seq, name, created_at, updated_at)
select m.id, m.project_id, m.mega_code, m.major_seq, m.name, m.created_at, m.updated_at from pg_temp.sp5_rb_majors m;
ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_identity_key UNIQUE (id, project_id, mega_code);
ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_project_mega_name_key UNIQUE (project_id, mega_code, name);
ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_project_mega_seq_key UNIQUE (project_id, mega_code, major_seq);
CREATE INDEX issue_major_processes_project_idx ON public.issue_major_processes USING btree (project_id, mega_code, major_seq);
CREATE TRIGGER trg_assign_issue_major_seq BEFORE INSERT OR UPDATE ON public.issue_major_processes FOR EACH ROW EXECUTE FUNCTION public.assign_issue_major_seq();
ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_mega_code_fkey FOREIGN KEY (mega_code) REFERENCES public.issue_mega_areas(code) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.issue_major_processes ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_issue_major_processes ON public.issue_major_processes FOR INSERT TO authenticated WITH CHECK (public.is_project_member(project_id));
CREATE POLICY issue_major_processes_ws_read ON public.issue_major_processes FOR SELECT TO authenticated USING ((project_id IN ( SELECT public.accessible_project_ids() AS accessible_project_ids)));
revoke all on table public.issue_major_processes from anon, authenticated;
GRANT SELECT,INSERT ON TABLE public.issue_major_processes TO authenticated;
GRANT ALL ON TABLE public.issue_major_processes TO service_role;

-- (h) issues(옛 모양 25열) — identity 를 같은 이름으로 다시 걸고 행을 옮긴 뒤(트리거가 코드 주입을 막는다) 시퀀스 값을 되돌린다
CREATE TABLE public.issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    issue_no bigint NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    assignee_member_id uuid,
    due_date date,
    resolution_note text DEFAULT ''::text NOT NULL,
    resolved_at timestamp with time zone,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    start_date date,
    mega_code text,
    mega_seq bigint,
    pi_issue_code text,
    sub_process text DEFAULT ''::text NOT NULL,
    owner_department text DEFAULT ''::text NOT NULL,
    related_systems text[] DEFAULT '{}'::text[] NOT NULL,
    source_type text,
    source_detail text DEFAULT ''::text NOT NULL,
    major_id uuid,
    CONSTRAINT issues_analysis_code_consistency_check CHECK ((((mega_code IS NULL) AND (mega_seq IS NULL) AND (pi_issue_code IS NULL)) OR ((mega_code IS NOT NULL) AND (mega_seq IS NOT NULL) AND (mega_seq > 0) AND (pi_issue_code = ((('PI-I-'::text || mega_code) || '-'::text) || lpad((mega_seq)::text, GREATEST(2, length((mega_seq)::text)), '0'::text)))))),
    CONSTRAINT issues_analysis_metadata_check CHECK (((char_length(sub_process) <= 200) AND (char_length(owner_department) <= 100) AND public.issue_related_systems_valid(related_systems) AND (char_length(source_detail) <= 1000) AND ((source_type IS NULL) OR (source_type = ANY (ARRAY['minutes'::text, 'interview'::text, 'deliverable'::text, 'as_is_analysis'::text, 'data_analysis'::text, 'other'::text]))) AND ((mega_code IS NULL) OR ((btrim(sub_process) <> ''::text) AND (btrim(owner_department) <> ''::text) AND (source_type IS NOT NULL))))),
    CONSTRAINT issues_date_range_check CHECK (((start_date IS NULL) OR (due_date IS NULL) OR (start_date <= due_date))),
    CONSTRAINT issues_major_requires_mega_check CHECK (((major_id IS NULL) OR (mega_code IS NOT NULL))),
    CONSTRAINT issues_severity_check CHECK ((severity = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT issues_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'on_hold'::text])))
);
ALTER TABLE public.issues ALTER COLUMN issue_no ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.issues_issue_no_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
insert into public.issues (id, issue_no, project_id, title, body, status, severity, assignee_member_id, due_date, resolution_note, resolved_at,
                           created_by, created_by_name, created_at, updated_at, start_date, mega_code, mega_seq, pi_issue_code,
                           sub_process, owner_department, related_systems, source_type, source_detail, major_id)
select k.id, k.issue_no, k.project_id, k.title, k.body, k.status, k.severity, k.assignee_member_id, k.due_date, k.resolution_note, k.resolved_at,
       k.created_by, k.created_by_name, k.created_at, k.updated_at, k.start_date, k.mega_code, k.mega_seq, k.pi_issue_code,
       k.sub_process, k.owner_department, k.related_systems, k.source_type, k.source_detail, k.major_id
  from pg_temp.sp5_rb_issues k;
select pg_catalog.setval('public.issues_issue_no_seq', s.last_value, s.is_called) from pg_temp.sp5_rb_seq s;
ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_issue_no_key UNIQUE (issue_no);
ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX issues_id_project_uidx ON public.issues USING btree (id, project_id);
CREATE INDEX issues_project_idx ON public.issues USING btree (project_id, created_at DESC);
CREATE INDEX issues_project_major_idx ON public.issues USING btree (project_id, major_id) WHERE (major_id IS NOT NULL);
CREATE INDEX issues_project_mega_idx ON public.issues USING btree (project_id, mega_code, mega_seq) WHERE (mega_code IS NOT NULL);
CREATE UNIQUE INDEX issues_project_mega_seq_uidx ON public.issues USING btree (project_id, mega_code, mega_seq) WHERE ((mega_code IS NOT NULL) AND (mega_seq IS NOT NULL));
CREATE UNIQUE INDEX issues_project_pi_code_uidx ON public.issues USING btree (project_id, pi_issue_code) WHERE (pi_issue_code IS NOT NULL);
CREATE TRIGGER trg_assign_issue_analysis_code BEFORE INSERT OR UPDATE ON public.issues FOR EACH ROW EXECUTE FUNCTION public.assign_issue_analysis_code();
ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_assignee_project_fk FOREIGN KEY (assignee_member_id, project_id) REFERENCES public.project_members(id, project_id);
ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_major_process_fk FOREIGN KEY (major_id, project_id, mega_code) REFERENCES public.issue_major_processes(id, project_id, mega_code) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_mega_area_fk FOREIGN KEY (mega_code) REFERENCES public.issue_mega_areas(code) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY delete_own_issues ON public.issues FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR public.is_project_admin(project_id)));
CREATE POLICY insert_own_issues ON public.issues FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) AND public.is_project_member(project_id)));
CREATE POLICY issues_ws_read ON public.issues FOR SELECT TO authenticated USING ((project_id IN ( SELECT public.accessible_project_ids() AS accessible_project_ids)));
CREATE POLICY member_update_issues ON public.issues FOR UPDATE TO authenticated USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));
revoke all on table public.issues from anon, authenticated;
GRANT SELECT ON TABLE public.issues TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.issues TO authenticated;
GRANT ALL ON TABLE public.issues TO service_role;
GRANT ALL ON SEQUENCE public.issues_issue_no_seq TO anon;
GRANT ALL ON SEQUENCE public.issues_issue_no_seq TO authenticated;
GRANT ALL ON SEQUENCE public.issues_issue_no_seq TO service_role;

-- (i) issue_number_counters(옛 모양) — a: 범위만 mega_code = 영역 code 로(나머지 범위는 옮기지 않는다)
CREATE TABLE public.issue_number_counters (
    project_id uuid NOT NULL,
    mega_code text NOT NULL,
    last_no bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT issue_number_counters_last_no_check CHECK ((last_no > 0))
);
insert into public.issue_number_counters (project_id, mega_code, last_no, updated_at)
select c.project_id, c.mega_code, c.last_no, c.updated_at from pg_temp.sp5_rb_counters c;
ALTER TABLE ONLY public.issue_number_counters
    ADD CONSTRAINT issue_number_counters_pkey PRIMARY KEY (project_id, mega_code);
ALTER TABLE ONLY public.issue_number_counters
    ADD CONSTRAINT issue_number_counters_mega_code_fkey FOREIGN KEY (mega_code) REFERENCES public.issue_mega_areas(code) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE ONLY public.issue_number_counters
    ADD CONSTRAINT issue_number_counters_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.issue_number_counters ENABLE ROW LEVEL SECURITY;
revoke all on table public.issue_number_counters from anon, authenticated;
GRANT ALL ON TABLE public.issue_number_counters TO service_role;

-- (j) issues 에 매달린 것을 원문으로 다시 건다 — FK 넷(0000)·storage 정책(0007)
ALTER TABLE ONLY public.issue_assignees
    ADD CONSTRAINT issue_assignees_issue_project_fk FOREIGN KEY (issue_id, project_id) REFERENCES public.issues(id, project_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.issue_attachments
    ADD CONSTRAINT issue_attachments_issue_project_fk FOREIGN KEY (issue_id, project_id) REFERENCES public.issues(id, project_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.issue_links
    ADD CONSTRAINT issue_links_issue_project_fk FOREIGN KEY (issue_id, project_id) REFERENCES public.issues(id, project_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.issue_updates
    ADD CONSTRAINT issue_updates_issue_project_fk FOREIGN KEY (issue_id, project_id) REFERENCES public.issues(id, project_id) ON DELETE CASCADE;
create policy "issue-attachments insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'issue-attachments' and split_part(name, '/', 5) = 'issue-attachments'
  and public.can_edit_issue(public.storage_entity_id(name))
  and exists (select 1 from public.issues i join public.projects p on p.id = i.project_id
               where i.id = public.storage_entity_id(objects.name) and i.project_id = public.storage_project(objects.name)
                 and p.workspace_id = public.storage_ws(objects.name)));

-- (k) S9′ — 옛 회의록 RPC(0000 원문 — INVOKER·search_path 'public','extensions')와 ACL(REVOKE PUBLIC·service_role)
CREATE FUNCTION public.create_issue_from_minute_block(p_project_id uuid, p_title text, p_body text, p_severity text, p_assignee_member_ids uuid[], p_start_date date, p_due_date date, p_mega_code text, p_major_name text, p_sub_process text, p_owner_department text, p_related_systems text[], p_source_type text, p_source_detail text, p_actor_id uuid, p_created_by_name text, p_minute_id uuid, p_minute_version_id uuid, p_body_hash text, p_block_index integer, p_block_hash text, p_excerpt_snapshot text, p_source_kind text, p_source_key text) RETURNS TABLE(issue_id uuid, issue_no bigint, pi_issue_code text)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_issue_id uuid;
  v_issue_no bigint;
  v_pi_issue_code text;
  v_major_id uuid;
  v_major_name text;
  v_version_body_hash text;
  v_version_project_id uuid;
  v_current_project_id uuid;
  v_minute_archived_at timestamptz;
  v_minute_title text;
  v_minute_date date;
  v_minute_version_no integer;
  v_assignee_input_count integer;
  v_assignee_unique_count integer;
  v_valid_assignee_count integer;
  v_related_systems text[];
begin
  if p_project_id is null then
    raise exception 'ISSUE_PROJECT_REQUIRED' using errcode = '22023';
  end if;
  if p_actor_id is null then
    raise exception 'ISSUE_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ISSUE_TITLE_REQUIRED' using errcode = '22023';
  end if;
  if char_length(btrim(p_title)) > 200 then
    raise exception 'ISSUE_TITLE_TOO_LONG' using errcode = '22023';
  end if;
  if p_body is null then
    raise exception 'ISSUE_BODY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(p_body) > 20000 then
    raise exception 'ISSUE_BODY_TOO_LONG' using errcode = '22023';
  end if;
  if p_severity is null or p_severity not in ('high', 'medium', 'low') then
    raise exception 'ISSUE_SEVERITY_INVALID' using errcode = '22023';
  end if;
  if p_start_date is not null
     and p_due_date is not null
     and p_start_date > p_due_date then
    raise exception 'ISSUE_DATE_RANGE_INVALID' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.issue_mega_areas area
    where area.code = p_mega_code and area.active
  ) then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '22023';
  end if;
  if p_major_name is null
     or btrim(p_major_name) = ''
     or char_length(btrim(p_major_name)) > 100
     or btrim(p_major_name) ~ '^[[({（【]?[[:space:]]*[0-9]{2}(\.[0-9]{2})+' then
    raise exception 'ISSUE_MAJOR_NAME_INVALID' using errcode = '22023';
  end if;
  if p_sub_process is null
     or btrim(p_sub_process) = ''
     or char_length(btrim(p_sub_process)) > 200 then
    raise exception 'ISSUE_SUB_PROCESS_INVALID' using errcode = '22023';
  end if;
  if p_owner_department is null
     or btrim(p_owner_department) = ''
     or char_length(btrim(p_owner_department)) > 100 then
    raise exception 'ISSUE_OWNER_DEPARTMENT_INVALID' using errcode = '22023';
  end if;
  if p_related_systems is null
     or not public.issue_related_systems_valid(p_related_systems) then
    raise exception 'ISSUE_RELATED_SYSTEMS_INVALID' using errcode = '22023';
  end if;
  if p_source_type is distinct from 'minutes' then
    raise exception 'ISSUE_MINUTE_SOURCE_TYPE_REQUIRED' using errcode = '22023';
  end if;
  if p_source_detail is null or char_length(btrim(p_source_detail)) > 1000 then
    raise exception 'ISSUE_SOURCE_DETAIL_INVALID' using errcode = '22023';
  end if;

  select coalesce(array_agg(normalized.system_name order by normalized.first_ord), '{}'::text[])
    into v_related_systems
    from (
      select btrim(item.value) as system_name, min(item.ord) as first_ord
      from unnest(p_related_systems) with ordinality as item(value, ord)
      group by btrim(item.value)
    ) normalized;

  if p_assignee_member_ids is null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;
  v_assignee_input_count := cardinality(p_assignee_member_ids);
  if v_assignee_input_count > 20 then
    raise exception 'ISSUE_ASSIGNEES_TOO_MANY' using errcode = '22023';
  end if;
  if array_position(p_assignee_member_ids, null) is not null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;

  if p_minute_id is null or p_minute_version_id is null then
    raise exception 'MINUTE_VERSION_REQUIRED' using errcode = '22023';
  end if;
  if p_body_hash is null or btrim(p_body_hash) = '' then
    raise exception 'MINUTE_BODY_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_block_index is null or p_block_index < 0 then
    raise exception 'MINUTE_BLOCK_INDEX_INVALID' using errcode = '22023';
  end if;
  if p_block_hash is null or btrim(p_block_hash) = '' then
    raise exception 'MINUTE_BLOCK_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_excerpt_snapshot is null or btrim(p_excerpt_snapshot) = '' then
    raise exception 'MINUTE_BLOCK_EXCERPT_REQUIRED' using errcode = '22023';
  end if;
  if p_source_kind is null
     or p_source_kind not in ('manual', 'action', 'risk') then
    raise exception 'MINUTE_SOURCE_KIND_INVALID' using errcode = '22023';
  end if;
  if p_source_key is not null and btrim(p_source_key) = '' then
    raise exception 'MINUTE_SOURCE_KEY_INVALID' using errcode = '22023';
  end if;

  select minute.project_id, minute.archived_at
    into v_current_project_id, v_minute_archived_at
    from public.minutes minute
   where minute.id = p_minute_id
   for share;

  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute_archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  if v_current_project_id is not null
     and v_current_project_id <> p_project_id then
    raise exception 'MINUTE_PROJECT_MISMATCH' using errcode = '23514';
  end if;

  select
    mv.body_hash,
    mv.project_id,
    mv.title,
    mv.minute_date,
    mv.version_no
  into
    v_version_body_hash,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_minute_version_no
  from public.minute_versions mv
  where mv.id = p_minute_version_id
    and mv.minute_id = p_minute_id;

  if not found then
    raise exception 'MINUTE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_body_hash <> v_version_body_hash then
    raise exception 'MINUTE_BODY_STALE' using errcode = '22023';
  end if;

  select count(distinct member_id)
    into v_assignee_unique_count
    from unnest(p_assignee_member_ids) as assignee(member_id);

  select count(*)
    into v_valid_assignee_count
    from public.project_members pm
   where pm.project_id = p_project_id
     and pm.id in (
       select distinct member_id
       from unnest(p_assignee_member_ids) as assignee(member_id)
     );

  if v_valid_assignee_count <> v_assignee_unique_count then
    raise exception 'ISSUE_ASSIGNEE_PROJECT_MISMATCH' using errcode = '22023';
  end if;

  -- Major resolve-or-create — 같은 이름은 기존 체번 재사용, 새 이름은 트리거가
  -- advisory lock 아래 다음 번호를 발급한다. 경합으로 유니크 충돌이 나면 승자를 재조회.
  v_major_name := btrim(p_major_name);
  select mp.id
    into v_major_id
    from public.issue_major_processes mp
   where mp.project_id = p_project_id
     and mp.mega_code = p_mega_code
     and mp.name = v_major_name;
  if not found then
    begin
      insert into public.issue_major_processes (project_id, mega_code, name)
      values (p_project_id, p_mega_code, v_major_name)
      returning id into v_major_id;
    exception when unique_violation then
      select mp.id
        into v_major_id
        from public.issue_major_processes mp
       where mp.project_id = p_project_id
         and mp.mega_code = p_mega_code
         and mp.name = v_major_name;
      if not found then
        raise exception 'ISSUE_MAJOR_RESOLVE_FAILED' using errcode = '55000';
      end if;
    end;
  end if;

  insert into public.issues as created_issue (
    project_id,
    title,
    body,
    severity,
    start_date,
    due_date,
    mega_code,
    major_id,
    sub_process,
    owner_department,
    related_systems,
    source_type,
    source_detail,
    created_by,
    created_by_name
  ) values (
    p_project_id,
    btrim(p_title),
    p_body,
    p_severity,
    p_start_date,
    p_due_date,
    p_mega_code,
    v_major_id,
    btrim(p_sub_process),
    btrim(p_owner_department),
    v_related_systems,
    'minutes',
    btrim(p_source_detail),
    p_actor_id,
    nullif(btrim(p_created_by_name), '')
  )
  returning
    created_issue.id,
    created_issue.issue_no,
    created_issue.pi_issue_code
  into v_issue_id, v_issue_no, v_pi_issue_code;

  insert into public.issue_assignees (
    issue_id,
    member_id,
    project_id
  )
  select
    v_issue_id,
    assignee.member_id,
    p_project_id
  from (
    select distinct member_id
    from unnest(p_assignee_member_ids) as input(member_id)
  ) assignee;

  insert into public.issue_links (
    issue_id,
    project_id,
    link_type,
    minute_id,
    minute_version_id,
    minute_version_no,
    source_project_id,
    minute_title_snapshot,
    minute_date_snapshot,
    body_hash,
    block_index,
    block_hash,
    excerpt_snapshot,
    source_kind,
    source_key
  ) values (
    v_issue_id,
    p_project_id,
    'minute_block',
    p_minute_id,
    p_minute_version_id,
    v_minute_version_no,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_version_body_hash,
    p_block_index,
    p_block_hash,
    p_excerpt_snapshot,
    p_source_kind,
    p_source_key
  );

  issue_id := v_issue_id;
  issue_no := v_issue_no;
  pi_issue_code := v_pi_issue_code;
  return next;
end
$$;
revoke all on function public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, text, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, text, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text) to service_role;

-- (l) S4 ⑤ 역순 — modules.enabled·modules.allowed 에서 'issue_analysis' 를 뺀다(계획 X8·Review Focus 5). 기록 꼴은 정방향과 같다(바뀐 행만
--     revision + 1, 이력 source='migration'). issues.analysis·issues.id_policy 는 남긴다(머리 주석 — 옛 앱은 unknownKeys 로 무시한다)
with proj_new as (
  select s.project_id, s."values" as v0,
         pg_catalog.jsonb_set(s."values", '{modules.enabled}',
           (select coalesce(pg_catalog.jsonb_agg(e.x order by e.o), '[]'::jsonb)
              from pg_catalog.jsonb_array_elements(s."values" -> 'modules.enabled') with ordinality as e(x, o)
             where e.x <> '"issue_analysis"'::jsonb)) as v1
    from public.project_settings s
   where pg_catalog.jsonb_typeof(s."values" -> 'modules.enabled') = 'array'
     and (s."values" -> 'modules.enabled') @> '["issue_analysis"]'::jsonb
), upd as (
  update public.project_settings s
     set "values" = n.v1, revision = s.revision + 1, updated_at = pg_catalog.now(), updated_by = null
    from proj_new n
   where s.project_id = n.project_id
  returning s.project_id, s.revision as new_rev
), cmd as (
  select u.project_id, u.new_rev, pg_catalog.gen_random_uuid() as command_id from upd u
)
insert into public.project_settings_history (project_id, revision, key, old_value, new_value, source, command_id, changed_by)
select c.project_id, c.new_rev, 'modules.enabled', n.v0 -> 'modules.enabled', n.v1 -> 'modules.enabled', 'migration', c.command_id, null
  from cmd c join proj_new n on n.project_id = c.project_id;

with ws_new as (
  select s.workspace_id, s."values" as v0,
         pg_catalog.jsonb_set(s."values", '{modules.allowed}',
           (select coalesce(pg_catalog.jsonb_agg(e.x order by e.o), '[]'::jsonb)
              from pg_catalog.jsonb_array_elements(s."values" -> 'modules.allowed') with ordinality as e(x, o)
             where e.x <> '"issue_analysis"'::jsonb)) as v1
    from public.workspace_settings s
   where pg_catalog.jsonb_typeof(s."values" -> 'modules.allowed') = 'array'
     and (s."values" -> 'modules.allowed') @> '["issue_analysis"]'::jsonb
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
select c.workspace_id, c.new_rev, 'modules.allowed', n.v0 -> 'modules.allowed', n.v1 -> 'modules.allowed', 'migration', c.command_id, null
  from cmd c join ws_new n on n.workspace_id = c.workspace_id;

commit;
