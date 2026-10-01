-- *_weekly_areas 롤백의 데이터 복원 확인 — *_weekly_areas_seed_wide.sql 을 심고 적용하고(created_fixture 를 흘렸으면 그것까지) 롤백한 DB 에서
-- 돈다(명령은 SP4 Phase A1 계획 과제 12 Step 7·과제 14 Step 9). 읽기만 하고, 하나라도 거짓·null 이면 WEEKLY_AREAS_ROLLBACK_CHECK 로 멈춘다.
-- 본다: 표가 이전 열 순서로 돌아왔고, section = 영역 code(이름이 아니다 — Q33), module = '', sort_order = 그 문서 안 영역 순서(sort_order, code, id)의
-- 순위, 칸 내용·updated_at 은 이관 뒤 값 그대로(머리표 줄 포함 — 롤백은 지우지 않는다, 공백뿐인 칸 포함), 이관이 만든 영역은 남고, 쓰기 정책·
-- 권한·발행이 돌아왔고, 새 함수는 없다. P4(created_fixture)는 있을 때만 본다.
begin;
create temp table sp4_wa_check (name text primary key, ok boolean) on commit drop;
insert into sp4_wa_check (name, ok) values
  ('columns_back', (select string_agg(a.attname::text, ',' order by a.attnum)
                           = 'id,report_id,section,module,sort_order,this_content,this_issue,next_content,next_issue,updated_at'
                      from pg_attribute a where a.attrelid = 'public.weekly_report_rows'::regclass and a.attnum > 0 and not a.attisdropped)),
  ('p1_sections_ranks', (select string_agg(right(w.id::text, 4) || '=' || w.section || '#' || w.sort_order, ',' order by w.report_id, w.sort_order)
                                = '3102=개발#1,3108=보류#2,3101=설계#3,3104=시험#4,3105=운영#5,3106=지원#6,3107=기타#7,3109=자유 구분 메모#8,'
                                  || '3202=신규#1,3201=설계#2,3301=경계#1'
                           from public.weekly_report_rows w join public.weekly_reports r on r.id = w.report_id
                          where r.project_id = '00000000-0000-0000-5b04-000000000c01')),
  ('module_blank', (select bool_and(w.module = '') from public.weekly_report_rows w)),
  ('contents_kept', (select w.this_content = E'1. 모듈 A\n2. 모듈 B\n[화면]\n1. 목록\n2. 상세'
                            and w.next_content = E'통합 시험\n[화면]\n상세 보완' and w.updated_at = '2026-09-04 11:00+00'
                       from public.weekly_report_rows w where w.id = '00000000-0000-0000-5b04-000000003102')),
  ('blank_cells_kept', (select w.this_content = E'[자동화]\n1. 회귀\n2. 성능' and w.this_issue = '   ' and w.next_issue = E'\t '
                          from public.weekly_report_rows w where w.id = '00000000-0000-0000-5b04-000000003104')),
  ('boundary_kept', (select pg_catalog.char_length(w.this_content) = 20000 and w.updated_at = '2026-09-16 09:00+00'
                       from public.weekly_report_rows w where w.id = '00000000-0000-0000-5b04-000000003301')),
  ('areas_remain', (select count(*) = 10 from public.project_areas a
                     where a.project_id = '00000000-0000-0000-5b04-000000000c01' and a.kind = 'weekly_section')),
  ('p4_new_path', (select not exists (select 1 from public.projects p where p.id = '00000000-0000-0000-5b04-000000000c04')
                     or (select string_agg(w.section || '#' || w.sort_order || '#' || w.this_content, ',' order by w.sort_order)
                           = 'NEWD#1#,NEWC#2#새 경로 내용'
                           from public.weekly_report_rows w join public.weekly_reports r on r.id = w.report_id
                          where r.project_id = '00000000-0000-0000-5b04-000000000c04'))),
  ('write_paths_back', (select count(*) = 12 from pg_policies p
                         where p.schemaname = 'public' and p.tablename in ('weekly_report_rows', 'weekly_reports', 'project_areas', 'area_teams'))
                       and has_table_privilege('authenticated', 'public.weekly_reports', 'INSERT')
                       and has_table_privilege('authenticated', 'public.weekly_report_rows', 'DELETE')
                       and has_table_privilege('authenticated', 'public.project_areas', 'INSERT')
                       and has_table_privilege('authenticated', 'public.area_teams', 'DELETE')
                       and (select a.attacl is null from pg_attribute a
                             where a.attrelid = 'public.weekly_reports'::regclass and a.attname = 'title')),
  ('new_functions_gone', (select to_regprocedure('public.create_weekly_report(uuid,uuid,date,jsonb)') is null
                                 and to_regprocedure('public.upsert_project_area(uuid,uuid,jsonb,jsonb,date)') is null
                                 and to_regprocedure('public.actor_is_project_admin(uuid,uuid)') is null
                                 and to_regprocedure('public.weekly_touch_updated_at()') is null)),
  ('realtime_back', (select exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime'
                                      and t.schemaname = 'public' and t.tablename = 'weekly_report_rows')));
select name, ok from sp4_wa_check order by name;
do $$
declare
  v text;
begin
  select string_agg(s.name, ', ' order by s.name) into v from sp4_wa_check s where s.ok is not true;
  if v is not null then
    raise exception 'WEEKLY_AREAS_ROLLBACK_CHECK: 어긋난 확인 — %', v;
  end if;
  raise notice 'WEEKLY_AREAS_ROLLBACK_CHECK: 전부 통과(%개)', (select count(*) from sp4_wa_check);
end $$;
rollback;
