-- 0023_vocab_settings 롤백 — 어휘 트리거·이관 RPC·헬퍼를 지우고 settings_ref_check 를 0020 본문으로, 고정 check 넷을 되살린다.
-- 목록 밖 code 행이 하나라도 있으면 check 를 되살릴 수 없어 멈춘다(조치: 롤백 전 migrate_setting_code 로 옛 code 로 옮긴다).
-- 프로젝트 설정 문서의 어휘 값·이력은 지우지 않는다 — 롤백한 코드가 그 키를 모르면 손상이 아니라 미지 키로 보인다(설정 해석기 unknownKeys).
do $$
declare
  v text;
begin
  select string_agg(x.what, ', ') into v from (
    select 'attendance_records.type=' || r.type || '(' || pg_catalog.count(*) || ')' as what from public.attendance_records r
     where r.type <> all (array['work', 'remote', 'annual', 'half', 'quarter', 'sick', 'trip', 'official', 'absent']) group by r.type
    union all
    select 'meetings.category=' || m.category || '(' || pg_catalog.count(*) || ')' from public.meetings m
     where m.category <> all (array['general', 'routine', 'kickoff', 'review', 'report', 'external']) group by m.category
    union all
    select 'issues.severity=' || i.severity || '(' || pg_catalog.count(*) || ')' from public.issues i
     where i.severity <> all (array['high', 'medium', 'low']) group by i.severity
    union all
    select 'issues.source_type=' || i.source_type || '(' || pg_catalog.count(*) || ')' from public.issues i
     where i.source_type is not null
       and i.source_type <> all (array['minutes', 'interview', 'deliverable', 'as_is_analysis', 'data_analysis', 'other']) group by i.source_type) x;
  if v is not null then
    raise exception using errcode = '23514',
      message = 'VOCAB_ROLLBACK_BLOCKED: 제품 기본 어휘 밖 code 행이 있다 — migrate_setting_code 로 옛 code 로 옮긴 뒤 다시: ' || pg_catalog.left(v, 600);
  end if;
end $$;

drop trigger trg_vocab_issue_source on public.issues;
drop trigger trg_vocab_issue_severity on public.issues;
drop trigger trg_vocab_meeting_category on public.meetings;
drop trigger trg_vocab_attendance_type on public.attendance_records;
drop function public.migrate_setting_code(uuid, uuid, text, text, text);
drop function public.enforce_project_vocab();

-- settings_ref_check — 0020_issue_areas 본문 그대로(어휘 분기 제거). 헬퍼보다 먼저 되돌린다(어휘 분기가 헬퍼를 부른다).
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
  -- issues.id_policy(SP5 B1 — 계획 P7): TS(parseIdPolicy)만 통과한 값이 SQL 검증(issue_id_policy_of)에 걸리면 그 프로젝트의 모든 이슈 등록이 멈춘다.
  -- DB 쪽 마지막 방어. unset(p_new null) = 제품 기본값이라 통과
  if p_key = 'issues.id_policy' then
    if p_new is not null then
      perform public.issue_id_policy_of(pg_catalog.jsonb_build_object('issues.id_policy', p_new));
    end if;
    return;
  end if;
  return;
end $$;

drop function public.project_vocab_ref_count(uuid, text, text);
drop function public.project_vocab_of(jsonb, text);
drop function public.project_vocab_default(text);

alter table public.issues drop constraint issues_analysis_metadata_check;
alter table public.issues add constraint issues_analysis_metadata_check check (
  char_length(sub_process) <= 200 and char_length(owner_department) <= 100 and public.issue_related_systems_valid(related_systems)
  and char_length(source_detail) <= 1000
  and (source_type is null or source_type = any (array['minutes', 'interview', 'deliverable', 'as_is_analysis', 'data_analysis', 'other']))
  and (major_id is null or (btrim(sub_process) <> '' and btrim(owner_department) <> '' and source_type is not null)));
alter table public.issues add constraint issues_severity_check check (severity = any (array['high', 'medium', 'low']));
alter table public.meetings add constraint meetings_category_check
  check (category = any (array['general', 'routine', 'kickoff', 'review', 'report', 'external']));
alter table public.attendance_records add constraint attendance_records_type_check
  check (type = any (array['work', 'remote', 'annual', 'half', 'quarter', 'sick', 'trip', 'official', 'absent']));
