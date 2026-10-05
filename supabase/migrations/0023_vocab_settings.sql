-- SP5 B4(스펙 D29·D58, §3.6, 개정 §2.4.1·§2.4.2): 어휘 다섯을 프로젝트 설정으로 — 고정 check 를 걷고 설정 판정 트리거로 바꾼다.
-- 잠금 순서(§2.4.1): 참조 쓰기 트리거는 설정 행 FOR SHARE, 설정 쓰기 RPC(apply_project_settings)·이관 RPC 는 FOR UPDATE — 직렬화된다.
-- 데이터 변화 없음: 기존 행의 code 는 모두 제품 기본 어휘 안이다(①이 지우는 check 가 그것을 보장해 왔다). 설정값은 이관하지 않는다
-- — 키가 없는 프로젝트는 제품 기본값(현 목록, TS defaultVocab 과 같다 — tests/rls 패리티).

-- ⓪ 제품 기본 어휘 — TS src/lib/settings/vocab.ts DEFAULT_VOCAB 과 같은 code·속성. 원인 분류는 DB 가 참조를 세지 않으므로 없다.
create function public.project_vocab_default(p_key text) returns jsonb
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
revoke all on function public.project_vocab_default(text) from public, anon, authenticated;

-- 키의 어휘 목록 — 설정 문서(values)에 키가 없으면 제품 기본값, 모양이 손상이면 22023 CONFIG_INVALID:<key>(기본값으로 위장하지 않는다).
-- 판정에 필요한 칸(code 문자열·active 참거짓)만 본다 — 나머지 검증은 TS parseVocab 이 저장 때 한다.
create function public.project_vocab_of(p_values jsonb, p_key text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v jsonb;
begin
  if p_values is null or not (p_values ? p_key) then
    return public.project_vocab_default(p_key);
  end if;
  v := p_values -> p_key;
  if pg_catalog.jsonb_typeof(v) is distinct from 'array'
     or exists (select 1 from pg_catalog.jsonb_array_elements(v) e
                 where pg_catalog.jsonb_typeof(e) is distinct from 'object'
                    or pg_catalog.jsonb_typeof(e -> 'code') is distinct from 'string'
                    or pg_catalog.jsonb_typeof(e -> 'active') is distinct from 'boolean') then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || p_key;
  end if;
  return v;
end
$$;
revoke all on function public.project_vocab_of(jsonb, text) from public, anon, authenticated;

-- ① 고정 check 삭제 — 판정은 ② 트리거가 설정으로 한다. source_type 목록은 별도 check 가 아니라 분석 메타 check 에 섞여 있어
--    그 절만 뺀 꼴로 다시 건다(나머지 절은 0020 원문 그대로).
alter table public.attendance_records drop constraint attendance_records_type_check;
alter table public.meetings drop constraint meetings_category_check;
alter table public.issues drop constraint issues_severity_check;
alter table public.issues drop constraint issues_analysis_metadata_check;
alter table public.issues add constraint issues_analysis_metadata_check check (
  char_length(sub_process) <= 200 and char_length(owner_department) <= 100 and public.issue_related_systems_valid(related_systems)
  and char_length(source_detail) <= 1000
  and (major_id is null or (btrim(sub_process) <> '' and btrim(owner_department) <> '' and source_type is not null)));

-- ② 어휘 트리거 — tg_argv[0] = 설정 키, tg_argv[1] = 열. 새로 생기는 값만 판정한다(D58 ①): UPDATE 에서 값·프로젝트가 그대로면 잠금 없이 통과.
--    그 밖은 설정 행 FOR SHARE → 격리 가드 → 활성 code 가 아니면 23514 PROJECT_VOCAB_INACTIVE:<key>:<code>. null 은 열의 NOT NULL 이 판정한다
--    (source_type 만 null 허용 — 분석 모듈이 꺼진 이슈). DEFINER: 세션이 설정 행을 읽지 못해도 판정은 같아야 한다.
create function public.enforce_project_vocab() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := tg_argv[0];
  v_col text := tg_argv[1];
  v_code text := pg_catalog.to_jsonb(new) ->> tg_argv[1];
  v_values jsonb;
begin
  if tg_op = 'UPDATE' and v_code is not distinct from (pg_catalog.to_jsonb(old) ->> v_col)
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;
  if v_code is null then
    return new;
  end if;
  select s."values" into v_values from public.project_settings s where s.project_id = new.project_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  -- 격리 수준 규칙(H2 ③): 잠금 뒤 읽은 설정으로 판정하므로 read committed 가 아니면 거절한다(잠금을 기다린 사이 바뀐 설정을 못 본다)
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'PROJECT_VOCAB_ISOLATION';
  end if;
  if not exists (select 1 from pg_catalog.jsonb_array_elements(public.project_vocab_of(v_values, v_key)) e
                  where e ->> 'code' = v_code and (e ->> 'active')::boolean) then
    raise exception using errcode = '23514', message = pg_catalog.format('PROJECT_VOCAB_INACTIVE:%s:%s', v_key, v_code);
  end if;
  return new;
end
$$;
revoke all on function public.enforce_project_vocab() from public, anon, authenticated;
-- 이름은 trg_vocab_* — 같은 시점 트리거는 이름 순으로 돈다. 이슈의 채번 트리거(trg_assign_issue_code)가 먼저 돌아 그 오류 계약
-- (ISSUE_CODE_ISOLATION·SETTINGS_ROW_MISSING)이 그대로 보이게 뒤에 둔다(둘 다 같은 설정 행을 FOR SHARE — 순서와 무관하게 교착 없음).
create trigger trg_vocab_attendance_type before insert or update of type, project_id on public.attendance_records
  for each row execute function public.enforce_project_vocab('attendance.types', 'type');
create trigger trg_vocab_meeting_category before insert or update of category, project_id on public.meetings
  for each row execute function public.enforce_project_vocab('meetings.categories', 'category');
create trigger trg_vocab_issue_severity before insert or update of severity, project_id on public.issues
  for each row execute function public.enforce_project_vocab('issues.severities', 'severity');
create trigger trg_vocab_issue_source before insert or update of source_type, project_id on public.issues
  for each row execute function public.enforce_project_vocab('issues.sources', 'source_type');

-- 키별 참조 건수(정적 문장 — 동적 SQL 없음). 원인 분류는 분석 실행 JSON 참조라 세지 않는다(TS 가 삭제 금지).
create function public.project_vocab_ref_count(p_project_id uuid, p_key text, p_code text) returns bigint
language sql stable set search_path = '' as $$
  select case p_key
    when 'attendance.types' then (select pg_catalog.count(*) from public.attendance_records r where r.project_id = p_project_id and r.type = p_code)
    when 'meetings.categories' then (select pg_catalog.count(*) from public.meetings m where m.project_id = p_project_id and m.category = p_code)
    when 'issues.severities' then (select pg_catalog.count(*) from public.issues i where i.project_id = p_project_id and i.severity = p_code)
    when 'issues.sources' then (select pg_catalog.count(*) from public.issues i where i.project_id = p_project_id and i.source_type = p_code)
  end
$$;
revoke all on function public.project_vocab_ref_count(uuid, text, text) from public, anon, authenticated;

-- ③ settings_ref_check — 0020 본문(calendar.week_start·calendar.timezone·issues.id_policy) 위에 어휘 분기를 더한다.
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

-- ④ migrate_setting_code — 어휘 code 의 참조 행을 다른 code 로 옮긴다(삭제 = 이관 → 삭제의 두 명령, 개정 §2.4.2).
--    이력은 남기지 않는다(D58 ③ — 이력 표는 unique(project_id, revision, key) 라 같은 키 행이 23505). 건수는 반환값으로 화면에 보이고,
--    뒤따르는 code 삭제 명령이 이력을 남긴다. 행위자 등급은 액션 가드와 별개로 여기서 다시 판정한다(service_role 전용 DEFINER).
create function public.migrate_setting_code(p_actor uuid, p_project_id uuid, p_key text, p_from text, p_to text) returns bigint
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
revoke all on function public.migrate_setting_code(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.migrate_setting_code(uuid, uuid, text, text, text) to service_role;

-- ⑤ 사후검사 VOCAB_SETTINGS_POSTCHECK — 읽기만 한다.
do $$
declare
  v text;
begin
  if exists (select 1 from pg_constraint k
              where (k.conrelid, k.conname) in (('public.attendance_records'::regclass, 'attendance_records_type_check'),
                                                ('public.meetings'::regclass, 'meetings_category_check'),
                                                ('public.issues'::regclass, 'issues_severity_check'))) then
    raise exception 'VOCAB_SETTINGS_POSTCHECK: 고정 어휘 check 가 남았다';
  end if;
  if (select position('source_type = any' in pg_get_constraintdef(k.oid)) > 0 or position('source_type IS NOT NULL' in pg_get_constraintdef(k.oid)) = 0
        from pg_constraint k where k.conrelid = 'public.issues'::regclass and k.conname = 'issues_analysis_metadata_check') then
    raise exception 'VOCAB_SETTINGS_POSTCHECK: 분석 메타 check 에 출처 목록이 남았거나 나머지 절을 잃었다';
  end if;
  select string_agg(format('%s.%s', x.tbl, x.name), ', ') into v
    from (values ('attendance_records', 'trg_vocab_attendance_type'), ('meetings', 'trg_vocab_meeting_category'),
                 ('issues', 'trg_vocab_issue_severity'), ('issues', 'trg_vocab_issue_source')) as x(tbl, name)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = ('public.' || x.tbl)::regclass and g.tgname = x.name and not g.tgisinternal
                        and g.tgfoid = 'public.enforce_project_vocab()'::regprocedure and g.tgenabled in ('O', 'A') and g.tgtype & 20 = 20);
  if v is not null then raise exception 'VOCAB_SETTINGS_POSTCHECK: 어휘 트리거가 없거나 꺼졌다: %', v; end if;
  if (select position('''calendar.week_start''' in p.prosrc) = 0 or position('''issues.id_policy''' in p.prosrc) = 0
             or position('''attendance.types''' in p.prosrc) = 0 or position('project_vocab_ref_count' in p.prosrc) = 0 or p.prosecdef
        from pg_proc p where p.oid = 'public.settings_ref_check(uuid, text, jsonb, jsonb)'::regprocedure) then
    raise exception 'VOCAB_SETTINGS_POSTCHECK: settings_ref_check 의 분기(달력·이슈 정책·어휘)가 기대와 다르다';
  end if;
  -- EXECUTE 기대표: 헬퍼·트리거 함수는 PUBLIC·anon·authenticated 모두 없음, 이관 RPC 는 service_role 만
  select string_agg(x.fn, ', ') into v
    from (values ('public.project_vocab_default(text)'), ('public.project_vocab_of(jsonb, text)'), ('public.enforce_project_vocab()'),
                 ('public.project_vocab_ref_count(uuid, text, text)'), ('public.migrate_setting_code(uuid, uuid, text, text, text)')) as x(fn)
    join pg_proc p on p.oid = x.fn::regprocedure
   where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0);
  if v is not null then raise exception 'VOCAB_SETTINGS_POSTCHECK: EXECUTE 가 열려 있다: %', v; end if;
  if not has_function_privilege('service_role', 'public.migrate_setting_code(uuid, uuid, text, text, text)', 'EXECUTE')
     or not (select p.prosecdef from pg_proc p where p.oid = 'public.migrate_setting_code(uuid, uuid, text, text, text)'::regprocedure)
     or not (select p.prosecdef from pg_proc p where p.oid = 'public.enforce_project_vocab()'::regprocedure) then
    raise exception 'VOCAB_SETTINGS_POSTCHECK: 이관 RPC·트리거 함수의 보안 속성·service_role 실행권이 기대와 다르다';
  end if;
end $$;
