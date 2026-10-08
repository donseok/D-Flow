-- 0043 롤백 — create_weekly_report 를 0013 시점 정의(시드의 custom 을 받지 않는다)로 되돌린다. 이미 이월된 custom 값은 지우지 않는다.
-- 앱(actions/weekly.ts)은 시드에 custom 을 실어 보낸다 — 옛 정의는 모르는 키를 무시하므로 이월 값만 빠진 채 문서는 만들어진다.
begin;

create or replace function public.create_weekly_report(p_actor uuid, p_project_id uuid, p_week_start date, p_seed jsonb) returns jsonb
language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_space constant text := E'\t\n\x0B\f\r ' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_report uuid;
  v_rows int;
  v_more int;
begin
  -- 1. 입력(잠금보다 먼저). 시드 원소는 객체이고 area_id(uuid 문자열)와 네 칸(문자열, 20,000자 이하)이 모두 있다. area_id 중복 없음
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
  -- 6. 문서 → 활성 영역마다 1행 → 시드에만 있는 영역의 내용 있는 행(이 프로젝트의 주간 영역이 아니면 FK 23503)
  insert into public.weekly_reports (project_id, week_start) values (p_project_id, p_week_start) returning id into v_report;
  insert into public.weekly_report_rows (report_id, project_id, area_id, this_content, this_issue, next_content, next_issue)
  select v_report, p_project_id, a.id,
         coalesce(s.e ->> 'this_content', ''), coalesce(s.e ->> 'this_issue', ''),
         coalesce(s.e ->> 'next_content', ''), coalesce(s.e ->> 'next_issue', '')
    from public.project_areas a
    left join pg_catalog.jsonb_array_elements(coalesce(p_seed, '[]'::jsonb)) as s(e) on (s.e ->> 'area_id')::uuid = a.id
   where a.project_id = p_project_id and a.kind = 'weekly_section' and a.active;
  get diagnostics v_rows = row_count;
  insert into public.weekly_report_rows (report_id, project_id, area_id, this_content, this_issue, next_content, next_issue)
  select v_report, p_project_id, (s.e ->> 'area_id')::uuid,
         s.e ->> 'this_content', s.e ->> 'this_issue', s.e ->> 'next_content', s.e ->> 'next_issue'
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

revoke all on function public.create_weekly_report(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.create_weekly_report(uuid, uuid, date, jsonb) to service_role;

commit;
