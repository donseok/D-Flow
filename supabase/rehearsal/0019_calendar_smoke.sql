-- *_calendar 리허설 스모크(스펙 §3.8) — *_calendar_week_start.sql 의 mode=seed 를 심고 마이그레이션을 적용한 DB 에서 돈다(첫 적용 뒤, 롤백 →
-- 재적용 뒤 두 번 — 명령은 SP5 Phase A 계획 과제 11 Step 7·과제 12 Step 5). 확인은 불리언이고 하나라도 거짓·null 이면 CALENDAR_SMOKE 로
-- 멈춘다. begin…rollback 이라 아무것도 남기지 않는다. 덮는 것: tz 두 스코프 기록(D57 — revision+1 한 번·schema_version 불변 — 자세한 수는
-- week_start 파일의 check 가 본다), holidays.kind 기본값, 의존성 근무일 판정 불변(월~금 프로젝트에서 이관 전 식과 같은 결과),
-- 사용현황 5종 호출·EXECUTE 기대표, 주 키 트리거 존재(규칙 밖 insert 거부).
begin;
create temp table sp5_cal_smoke (name text primary key, ok boolean) on commit drop;
insert into sp5_cal_smoke (name, ok) values
  ('all_project_rows_tz', (select pg_catalog.bool_and(s."values" ? 'calendar.timezone') from public.project_settings s)),
  ('all_ws_rows_tz', (select pg_catalog.bool_and(s."values" ? 'calendar.timezone') from public.workspace_settings s)),
  ('holiday_kind_default_off', (select pg_catalog.bool_and(h.kind = 'off') from public.holidays h
                                 where h.project_id = '00000000-0000-0000-5c05-000000000c02')),
  ('holiday_kind_all_off', (select coalesce(pg_catalog.bool_and(h.kind = 'off'), true) from public.holidays h)),
  -- 이관 전 의존성 트리거의 식(isodow < 6 and 휴일 아님)과 is_workday 가 P2(근무 요일 키 없음 = [1..5])의 4주에서 같다
  ('workday_unchanged', (select pg_catalog.bool_and(
                                  public.is_workday('00000000-0000-0000-5c05-000000000c02', g.d::date)
                                  = (extract(isodow from g.d) < 6 and not exists (select 1 from public.holidays h
                                       where h.project_id = '00000000-0000-0000-5c05-000000000c02' and h.date = g.d::date)))
                           from pg_catalog.generate_series(current_date - 7, current_date + 20, interval '1 day') as g(d))),
  ('usage_callable', (select pg_catalog.count(*) = 1 from public.usage_summary(current_date - 1, current_date, current_date, 'UTC'))),
  ('usage_exec_table', (select pg_catalog.bool_and(not has_function_privilege('anon', x.fn::regprocedure, 'EXECUTE')
                                                   and has_function_privilege('authenticated', x.fn::regprocedure, 'EXECUTE')
                                                   and has_function_privilege('service_role', x.fn::regprocedure, 'EXECUTE'))
                          from unnest(array['public.usage_daily_actives(date, date, text)', 'public.usage_menu_ranking(date, date, text)',
                                            'public.usage_sessions(date, date, text, integer)', 'public.usage_summary(date, date, date, text)',
                                            'public.usage_user_rollup(date, date, text)']) as x(fn))),
  ('week_trigger_present', (select pg_catalog.count(*) = 1 from pg_trigger g
                             where g.tgrelid = 'public.weekly_reports'::regclass and g.tgname = 'weekly_reports_week_key_guard'
                               and not g.tgisinternal and g.tgenabled in ('O', 'A')));
do $$
declare v text;
begin
  -- 규칙 밖 키(P1 — 키 없음 = 일요일 — 의 월요일)는 트리거가 거부한다. savepoint 안에서 보고 되돌린다
  begin
    insert into public.weekly_reports (project_id, week_start)
    values ('00000000-0000-0000-5c05-000000000c01', current_date - (extract(isodow from current_date)::int - 1));
    insert into sp5_cal_smoke values ('week_trigger_rejects', false);      -- 여기까지 오면 트리거가 거부하지 않은 것이다
  exception when check_violation then
    insert into sp5_cal_smoke values ('week_trigger_rejects', sqlerrm = 'WEEK_KEY_INVALID');
  end;
  select string_agg(name, ', ' order by name) into v from sp5_cal_smoke where not coalesce(ok, false);
  if v is not null then raise exception 'CALENDAR_SMOKE: 거짓 — %', v; end if;
  raise notice 'CALENDAR_SMOKE: % 항목 통과', (select count(*) from sp5_cal_smoke);
end $$;
rollback;
