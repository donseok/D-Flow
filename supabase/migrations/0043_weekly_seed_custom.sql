-- 0043_weekly_seed_custom.sql
-- 주간 문서 생성이 시드의 사용자 정의 필드 값을 같은 트랜잭션에 싣는다(개정 스펙 §4.3.3 "`create_weekly_report` 의 `p_seed` 행은 `custom` 을
-- 그대로 넘기고, required 필드의 기본값은 트리거가 채운다", §6 SP5c 블록 "SP4 E28 — create_weekly_report 를 다시 만들어 시드 행의 custom 을 통과시킨다").
-- 지금까지는 액션이 RPC 뒤에 행마다 별도 UPDATE 로 이월 값을 썼다 — 중간에 실패하면 이월 값 없는 문서가 남고 그 실패는 보이지도 않았다.
-- 바꾸는 것은 시드 검증 한 줄(custom 은 선택·객체)과 두 INSERT 의 custom 열뿐이다 — 인자·반환·잠금·격리 가드·행위자 등급 재판정·
-- 실행권(service_role 전용)·함수 설정(DEFINER, search_path '', lock_timeout 15s)은 0013 그대로다. 값의 판정은 행 트리거
-- weekly_report_rows_custom_fields_trg(enforce_custom_fields) 몫이고, 거부하면 문서도 만들어지지 않는다.

begin;

create or replace function public.create_weekly_report(p_actor uuid, p_project_id uuid, p_week_start date, p_seed jsonb) returns jsonb
language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_space constant text := E'\t\n\x0B\f\r ' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_report uuid;
  v_rows int;
  v_more int;
begin
  -- 1. 입력(잠금보다 먼저). 시드 원소는 객체이고 area_id(uuid 문자열)와 네 칸(문자열, 20,000자 이하)이 모두 있다. area_id 중복 없음.
  --    custom 은 선택 — 있으면 객체여야 한다(JSON null 도 거부). 키·값의 뜻은 행 트리거(enforce_custom_fields)가 판정한다
  if p_actor is null or p_project_id is null or p_week_start is null then
    raise exception using errcode = '22023', message = 'WEEKLY_INVALID_INPUT';
  end if;
  if p_seed is not null and pg_catalog.jsonb_typeof(p_seed) <> 'array' then
    raise exception using errcode = '22023', message = 'WEEKLY_SEED_INVALID';
  end if;
  if p_seed is not null and exists (
       select 1 from pg_catalog.jsonb_array_elements(p_seed) as s(e)
        where pg_catalog.jsonb_typeof(s.e) <> 'object'
           or pg_catalog.jsonb_typeof(s.e -> 'area_id') is distinct from 'string'
           or (s.e ->> 'area_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or (s.e ? 'custom' and pg_catalog.jsonb_typeof(s.e -> 'custom') is distinct from 'object')
           or exists (select 1 from pg_catalog.unnest(array['this_content', 'this_issue', 'next_content', 'next_issue']) as k(cell)
                       where pg_catalog.jsonb_typeof(s.e -> k.cell) is distinct from 'string'
                          or pg_catalog.char_length(s.e ->> k.cell) > 20000)) then
    raise exception using errcode = '22023', message = 'WEEKLY_SEED_INVALID';
  end if;
  if p_seed is not null and (select pg_catalog.count(*) <> pg_catalog.count(distinct (s.e ->> 'area_id')::uuid)
                               from pg_catalog.jsonb_array_elements(p_seed) as s(e)) then
    raise exception using errcode = '22023', message = 'WEEKLY_SEED_INVALID';
  end if;
  -- 2. 잠금(영역 쓰기와 같은 키) → 격리 가드
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('weekly:' || p_project_id, 0));
  -- 격리 수준 규칙(H2 규칙 ③): 잠금 뒤 같은 주 문서·활성 영역을 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 주 문서·영역 변경 — 스냅샷이 고정된 수준에서는 보지 못해 아래 4 를 지나 23505 가 나거나 새 영역의 행이 빠진다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'WEEKLY_ISOLATION';
  end if;
  -- 3. 등급(DEFINER 라 RLS 가 빠진 자리 — D28) → 프로젝트
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'WEEKLY_FORBIDDEN';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  -- 4. 같은 주 문서(D33 — (project_id, week_start) 유일이 자연 멱등이다)
  select r.id into v_report from public.weekly_reports r where r.project_id = p_project_id and r.week_start = p_week_start;
  if v_report is not null then
    return pg_catalog.jsonb_build_object('status', 'exists', 'report_id', v_report);
  end if;
  -- 5. 활성 주간 영역이 없으면 거절(임의 구분을 만들지 않는다)
  if not exists (select 1 from public.project_areas a
                  where a.project_id = p_project_id and a.kind = 'weekly_section' and a.active) then
    raise exception using errcode = '23514', message = 'WEEKLY_AREAS_REQUIRED';
  end if;
  -- 6. 문서 → 활성 영역마다 1행 → 시드에만 있는 영역의 내용 있는 행(이 프로젝트의 주간 영역이 아니면 FK 23503).
  --    시드의 custom 은 같은 INSERT 에 싣는다 — 행 트리거가 정의와 대조하고(거부하면 문서째 되돌린다) 빠진 필수 키를 기본값으로 채운다
  insert into public.weekly_reports (project_id, week_start) values (p_project_id, p_week_start) returning id into v_report;
  insert into public.weekly_report_rows (report_id, project_id, area_id, this_content, this_issue, next_content, next_issue, custom)
  select v_report, p_project_id, a.id,
         coalesce(s.e ->> 'this_content', ''), coalesce(s.e ->> 'this_issue', ''),
         coalesce(s.e ->> 'next_content', ''), coalesce(s.e ->> 'next_issue', ''),
         coalesce(s.e -> 'custom', '{}'::jsonb)
    from public.project_areas a
    left join pg_catalog.jsonb_array_elements(coalesce(p_seed, '[]'::jsonb)) as s(e) on (s.e ->> 'area_id')::uuid = a.id
   where a.project_id = p_project_id and a.kind = 'weekly_section' and a.active;
  get diagnostics v_rows = row_count;
  insert into public.weekly_report_rows (report_id, project_id, area_id, this_content, this_issue, next_content, next_issue, custom)
  select v_report, p_project_id, (s.e ->> 'area_id')::uuid,
         s.e ->> 'this_content', s.e ->> 'this_issue', s.e ->> 'next_content', s.e ->> 'next_issue',
         coalesce(s.e -> 'custom', '{}'::jsonb)
    from pg_catalog.jsonb_array_elements(coalesce(p_seed, '[]'::jsonb)) as s(e)
   where not exists (select 1 from public.project_areas a
                      where a.id = (s.e ->> 'area_id')::uuid and a.project_id = p_project_id
                        and a.kind = 'weekly_section' and a.active)
     and (pg_catalog.btrim(s.e ->> 'this_content', v_space) <> '' or pg_catalog.btrim(s.e ->> 'this_issue', v_space) <> ''
          or pg_catalog.btrim(s.e ->> 'next_content', v_space) <> '' or pg_catalog.btrim(s.e ->> 'next_issue', v_space) <> '');
  get diagnostics v_more = row_count;
  -- 7. 결과
  return pg_catalog.jsonb_build_object('status', 'created', 'report_id', v_report, 'rows', v_rows + v_more);
end
$$;

-- create or replace 는 실행권을 건드리지 않지만, 규칙(H2 ①)대로 다시 못 박는다
revoke all on function public.create_weekly_report(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.create_weekly_report(uuid, uuid, date, jsonb) to service_role;

-- 사후 검증 — 두 INSERT 가 custom 을 쓰고, 0013 의 함수 설정·실행권이 유지된다
do $$
declare
  v_def text := pg_get_functiondef('public.create_weekly_report(uuid, uuid, date, jsonb)'::regprocedure);
begin
  if (select count(*) from regexp_matches(v_def, 'next_content, next_issue, custom\)', 'g')) <> 2
     or v_def !~ 'jsonb_typeof\(s\.e -> ''custom''\)' then
    raise exception 'WEEKLY_SEED_CUSTOM_POSTCHECK: 주간 문서 생성이 시드의 custom 을 쓰지 않는다' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.create_weekly_report(uuid, uuid, date, jsonb)'::regprocedure and p.prosecdef
                   and p.proconfig @> array['search_path=""', 'lock_timeout=15s']) then
    raise exception 'WEEKLY_SEED_CUSTOM_POSTCHECK: 함수 설정(DEFINER·search_path·lock_timeout)이 바뀌었다' using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', 'public.create_weekly_report(uuid, uuid, date, jsonb)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_weekly_report(uuid, uuid, date, jsonb)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('service_role', 'public.create_weekly_report(uuid, uuid, date, jsonb)'::regprocedure, 'EXECUTE') then
    raise exception 'WEEKLY_SEED_CUSTOM_POSTCHECK: 실행권이 service_role 전용이 아니다' using errcode = '42501';
  end if;
end $$;

commit;
