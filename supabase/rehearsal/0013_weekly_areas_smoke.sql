-- *_weekly_areas 리허설 스모크 — *_weekly_areas_seed_wide.sql 을 심고 마이그레이션을 적용한 DB 에서 돈다(첫 적용 뒤, 롤백 → 재적용 뒤 두 번 —
-- 명령은 SP4 Phase A1 계획 과제 14 Step 9). 확인은 불리언이고 하나라도 거짓·null 이면 WEEKLY_AREAS_SMOKE 로 멈춘다. begin…rollback 이라
-- 아무것도 남기지 않는다. 두 번 다 참이어야 하는 절대값만 본다 — 재적용의 '영역 신설 0' 은 P1 영역 열 개의 목록과 P4 영역 둘의 목록이
-- 그대로인 것으로 본다(롤백이 section 을 이름으로 되살리면 재적용이 이름 영역을 새로 만들어 목록이 는다 — Q33). P4 는 created_fixture 뒤에만 있다.
-- 기대값의 근거(이관 규칙의 모의 — 계획 과제 11 의 표): 이관 전 비어 있지 않은 (문서, 라벨, 칸) 16 · 글자 수 20,097 · 병합 줄바꿈 4 ·
-- 머리표 4개 20자 → 이관 뒤 비어 있지 않은 칸 16 · 글자 수 20,121(W19). 행 16 → 11, 영역 신설 8 · 재사용 2.
begin;
create temp table sp4_wa_smoke (name text primary key, ok boolean) on commit drop;
insert into sp4_wa_smoke (name, ok) values
  -- 영역: P1 은 재사용 둘(이름·순서·활성 그대로) + 신설 여덟(code = name = 라벨, 순서 = 7 + 순위), P2·P3 는 그대로
  ('p1_areas', (select string_agg(format('%s|%s|%s|%s', a.code, a.name, a.sort_order, a.active::text), ', ' order by a.sort_order, a.code)
                       = '개발|개발 영역|5|true, 보류|보류 영역|7|false, 신규|신규|8|true, 경계|경계|9|true, 설계|설계|10|true, '
                         || '시험|시험|11|true, 운영|운영|12|true, 지원|지원|13|true, 기타|기타|14|true, 자유 구분 메모|자유 구분 메모|15|true'
                  from public.project_areas a where a.project_id = '00000000-0000-0000-5b04-000000000c01')),
  ('p2_p3_areas_untouched', (select string_agg(format('%s|%s|%s', a.project_id, a.code, a.name), ', ' order by a.project_id, a.code)
                                    = '00000000-0000-0000-5b04-000000000c02|운영|운영 영역, 00000000-0000-0000-5b04-000000000c03|P3A|상속 영역'
                               from public.project_areas a
                              where a.project_id in ('00000000-0000-0000-5b04-000000000c02', '00000000-0000-0000-5b04-000000000c03'))),
  -- 행: 남은 열하나와 그 영역, 재사용 영역의 id, 백필한 project_id, 모든 행의 area_id·project_id
  ('p1_rows_areas', (select string_agg(right(w.id::text, 4) || '=' || a.code, ',' order by w.id)
                            = '3101=설계,3102=개발,3104=시험,3105=운영,3106=지원,3107=기타,3108=보류,3109=자유 구분 메모,3201=설계,3202=신규,3301=경계'
                       from public.weekly_report_rows w join public.project_areas a on a.id = w.area_id
                      where w.report_id in ('00000000-0000-0000-5b04-000000001001', '00000000-0000-0000-5b04-000000001002',
                                            '00000000-0000-0000-5b04-000000001003'))),
  ('reused_area_ids', (select bool_and(w.area_id = case right(w.id::text, 4) when '3102' then '00000000-0000-0000-5b04-000000002001'::uuid
                                                                            else '00000000-0000-0000-5b04-000000002002'::uuid end)
                         from public.weekly_report_rows w
                        where w.id in ('00000000-0000-0000-5b04-000000003102', '00000000-0000-0000-5b04-000000003108'))),
  ('p1_rows_project', (select bool_and(w.project_id = '00000000-0000-0000-5b04-000000000c01') and count(*) = 11
                         from public.weekly_report_rows w join public.weekly_reports r on r.id = w.report_id
                        where r.project_id = '00000000-0000-0000-5b04-000000000c01')),
  ('all_rows_placed', (select not exists (select 1 from public.weekly_report_rows w where w.area_id is null or w.project_id is null))),
  -- 병합·머리표: 중복 행은 (sort_order, id) 순으로 줄바꿈 하나씩, 머리표는 '[모듈]' 단독 줄 + 줄바꿈(T4), updated_at 은 묶음의 최댓값
  ('r101_merged', (select w.this_content = E'설계 초안\n설계 검토' and w.next_content = '다음 설계' and w.this_issue = '' and w.next_issue = ''
                          and w.updated_at = '2026-09-03 10:00+00'
                     from public.weekly_report_rows w where w.id = '00000000-0000-0000-5b04-000000003101')),
  ('r102_marks_numbered', (select w.this_content = E'1. 모듈 A\n2. 모듈 B\n[화면]\n1. 목록\n2. 상세'
                                  and w.next_content = E'통합 시험\n[화면]\n상세 보완' and w.updated_at = '2026-09-04 11:00+00'
                             from public.weekly_report_rows w where w.id = '00000000-0000-0000-5b04-000000003102')),
  ('r104_single_mark_blank_cells', (select w.this_content = E'[자동화]\n1. 회귀\n2. 성능' and w.this_issue = '   '
                                           and w.next_content = '' and w.next_issue = E'\t ' and w.updated_at = '2026-09-01 13:00+00'
                                      from public.weekly_report_rows w where w.id = '00000000-0000-0000-5b04-000000003104')),
  ('r105_same_module', (select w.this_content = '배포' from public.weekly_report_rows w where w.id = '00000000-0000-0000-5b04-000000003105')),
  ('r106_rf1_merge', (select w.this_content = '문의 응대' and w.this_issue = '지원 이슈' and w.updated_at = '2026-09-05 12:00+00'
                        from public.weekly_report_rows w where w.id = '00000000-0000-0000-5b04-000000003106')),
  ('r301_boundary', (select pg_catalog.char_length(w.this_content) = 20000
                            and w.this_content = repeat('가', 14000) || E'\n[M]\n' || repeat('나', 5995)
                            and w.updated_at = '2026-09-16 09:00+00'
                       from public.weekly_report_rows w where w.id = '00000000-0000-0000-5b04-000000003301')),
  -- 전후 대조(W19): 이관 뒤 P1 의 비어 있지 않은 칸 16, 글자 수 20,121(= 이관 전 20,097 + 병합 줄바꿈 4 + 머리표 20)
  ('w19_after_totals', (select count(*) = 16 and sum(pg_catalog.char_length(c.val)) = 20121
                          from public.weekly_report_rows w
                         cross join lateral (values (w.this_content), (w.this_issue), (w.next_content), (w.next_issue)) as c(val)
                         where w.project_id = '00000000-0000-0000-5b04-000000000c01' and c.val <> '')),
  -- created_fixture 뒤(P4 가 있을 때만): 새 경로 영역 둘의 목록(개명한 이름 포함)과 행
  ('p4_new_path', (select not exists (select 1 from public.projects p where p.id = '00000000-0000-0000-5b04-000000000c04')
                     or ((select string_agg(format('%s|%s|%s|%s', a.code, a.name, a.sort_order, a.active::text), ', ' order by a.sort_order, a.code)
                            from public.project_areas a where a.project_id = '00000000-0000-0000-5b04-000000000c04')
                           = 'NEWD|둘째 영역|0|true, NEWC|바뀐 이름|1|true'
                         and (select string_agg(a.code || '=' || w.this_content, ', ' order by a.code)
                                from public.weekly_report_rows w join public.project_areas a on a.id = w.area_id
                               where w.project_id = '00000000-0000-0000-5b04-000000000c04')
                           = 'NEWC=새 경로 내용, NEWD=')));
select name, ok from sp4_wa_smoke order by name;
do $$
declare
  v text;
begin
  select string_agg(s.name, ', ' order by s.name) into v from sp4_wa_smoke s where s.ok is not true;
  if v is not null then
    raise exception 'WEEKLY_AREAS_SMOKE: 어긋난 확인 — %', v;
  end if;
  raise notice 'WEEKLY_AREAS_SMOKE: 전부 통과(%개)', (select count(*) from sp4_wa_smoke);
end $$;
rollback;
