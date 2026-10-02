-- *_calendar 주 시작 이관 리허설(스펙 §3.8 — 네 경우). 직전 마이그레이션까지 적용한 DB 에 흘린다. 모드 셋:
--   -v mode=seed  — 경우 ①②③(+ 키가 이미 있는 프로젝트 P5)을 심고 **커밋**한다. 그다음 supabase migration up --local → -v mode=check.
--   -v mode=bad   — 경우 ④(음성): 월요일이 아닌 주 키를 심고 커밋한다. 그다음 migration up 이 CALENDAR_PRECHECK 로 멈추고 max(version) = 직전 번호.
--   -v mode=check — 이관 뒤(그리고 롤백 → 재적용 뒤에도) 확인한다. 하나라도 거짓이면 CALENDAR_WEEK_START_REHEARSAL 로 멈춘다. begin…rollback.
-- 명령 전문: SP5 Phase A 계획 과제 11 Step 7·과제 12 Step 5(전용 스택, 공유 잠금 안). 날짜는 실행 시각의 서울 날짜에서 잰다(이관 ⑩ 의 T 와
-- 같은 식) — 서울 자정을 넘기며 seed 와 check 를 나눠 돌리면 거짓 실패가 날 수 있다(그때는 seed 부터 다시).
-- 경우: ① P1 주간 문서 없음 → 키 없음(일요일) ② P2 과거 문서만(K−14·K−7) → [monday, sunday@E], E = K+6(그 날이 오늘 이하면 K+13)
--       ③ P3 E 이후 미래 문서(K·K+7·K+21) → E = max(K+21) + 6 = K+27 ④ P4 화요일 키 → CALENDAR_PRECHECK
--       (+) P5 tz·주 규칙 키가 이미 있다(Europe/Berlin·[monday]) → 이관이 건드리지 않는다(revision 3 그대로, 이력 0).
-- uuid 넷째 묶음 5c05. 시간대 ⑨ 는 워크스페이스 W1 과 P1~P3 에 기록되는지를 같이 본다.
\if :{?mode}
\else
  \echo '사용: -v mode=<seed|bad|check>'
  \quit
\endif
select :'mode' = 'seed' as m_seed, :'mode' = 'bad' as m_bad, :'mode' = 'check' as m_check \gset
select t::text as t, (t - (extract(isodow from t)::int - 1))::text as k
  from (select (now() at time zone 'Asia/Seoul')::date as t) x \gset

\if :m_seed
begin;
insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-5c05-000000000a01', 'sp5-cal-rh', 'SP5 달력 리허설');
insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-5c05-000000000c01', 'SP5 P1 문서 없음', '00000000-0000-0000-5c05-000000000a01'),
  ('00000000-0000-0000-5c05-000000000c02', 'SP5 P2 과거 문서', '00000000-0000-0000-5c05-000000000a01'),
  ('00000000-0000-0000-5c05-000000000c03', 'SP5 P3 미래 문서', '00000000-0000-0000-5c05-000000000a01'),
  ('00000000-0000-0000-5c05-000000000c05', 'SP5 P5 키 있음', '00000000-0000-0000-5c05-000000000a01');
insert into public.weekly_reports (project_id, week_start) values
  ('00000000-0000-0000-5c05-000000000c02', :'k'::date - 14), ('00000000-0000-0000-5c05-000000000c02', :'k'::date - 7),
  ('00000000-0000-0000-5c05-000000000c03', :'k'::date), ('00000000-0000-0000-5c05-000000000c03', :'k'::date + 7),
  ('00000000-0000-0000-5c05-000000000c03', :'k'::date + 21),
  ('00000000-0000-0000-5c05-000000000c05', :'k'::date);
-- P2 의 휴일(경우 밖 — 스모크의 holidays.kind 기본값·근무일 판정 불변 대조용)과 계획 항목
insert into public.holidays (project_id, date, name) values ('00000000-0000-0000-5c05-000000000c02', :'k'::date + 2, '리허설 휴일');
-- 필수 키(core.level_labels) — 생성 RPC 를 거치지 않은 행이라 settings:verify 의 required_missing 이 이관 판정을 가리지 않게 한다(revision 무변경)
update public.project_settings set "values" = "values" || '{"core.level_labels": ["Phase", "Task"]}'::jsonb
 where project_id::text like '00000000-0000-0000-5c05-%';
update public.project_settings
   set "values" = "values" || '{"calendar.timezone": "Europe/Berlin", "calendar.week_start": [{"day": "monday", "from": null}]}'::jsonb,
       revision = 3
 where project_id = '00000000-0000-0000-5c05-000000000c05';
commit;
\endif

\if :m_bad
begin;
insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-5c05-000000000a04', 'sp5-cal-rh-bad', 'SP5 달력 리허설 음성');
insert into public.projects (id, name, workspace_id) values ('00000000-0000-0000-5c05-000000000c04', 'SP5 P4 화요일 키', '00000000-0000-0000-5c05-000000000a04');
insert into public.weekly_reports (project_id, week_start) values ('00000000-0000-0000-5c05-000000000c04', :'k'::date + 1);
commit;
\endif

\if :m_check
begin;
create temp table sp5_cal_rh (name text primary key, ok boolean) on commit drop;
insert into sp5_cal_rh (name, ok)
with t as (select :'t'::date as t, :'k'::date as k),
     e as (select case when k + 6 <= t then k + 13 else k + 6 end as e2, k + 27 as e3, t from t),
     s as (select s.project_id, s."values" as v, s.revision, s.schema_version from public.project_settings s
            where s.project_id::text like '00000000-0000-0000-5c05-%')
select x.name, coalesce(x.ok, false) from (values
  ('p1_tz_only', (select v ->> 'calendar.timezone' = 'Asia/Seoul' and not (v ? 'calendar.week_start')
                    from s where project_id = '00000000-0000-0000-5c05-000000000c01')),
  ('p2_rules', (select v -> 'calendar.week_start' = pg_catalog.jsonb_build_array(
                         pg_catalog.jsonb_build_object('day', 'monday', 'from', null),
                         pg_catalog.jsonb_build_object('day', 'sunday', 'from', to_char(e.e2, 'YYYY-MM-DD')))
                  from s, e where s.project_id = '00000000-0000-0000-5c05-000000000c02')),
  ('p2_e_is_next_sunday', (select extract(isodow from e2) = 7 and e2 > t and e2 - t between 1 and 7 from e)),
  ('p3_rules_after_future_docs', (select v -> 'calendar.week_start' -> 1 ->> 'from' = to_char(e.e3, 'YYYY-MM-DD')
                                    and extract(isodow from e.e3) = 7
                                    from s, e where s.project_id = '00000000-0000-0000-5c05-000000000c03')),
  ('p5_untouched', (select v ->> 'calendar.timezone' = 'Europe/Berlin' and v -> 'calendar.week_start' = '[{"day": "monday", "from": null}]'::jsonb
                           and revision = 3
                      from s where project_id = '00000000-0000-0000-5c05-000000000c05')),
  ('p5_no_history', (select pg_catalog.count(*) = 0 from public.project_settings_history h
                      where h.project_id = '00000000-0000-0000-5c05-000000000c05' and h.source = 'migration')),
  ('revision_once', (select pg_catalog.bool_and(revision = 1) from s where project_id <> '00000000-0000-0000-5c05-000000000c05')),
  ('schema_version_kept', (select pg_catalog.bool_and(schema_version = 1) from s)),
  ('history_shape', (select pg_catalog.count(*) = 5
                            and pg_catalog.bool_and(h.source = 'migration' and h.changed_by is null and h.revision = 1)
                            and pg_catalog.count(distinct (h.project_id, h.command_id)) = 3
                            and pg_catalog.count(distinct h.command_id) = 3
                       from public.project_settings_history h
                      where h.project_id::text like '00000000-0000-0000-5c05-%' and h.source = 'migration')),
  ('history_old_null', (select pg_catalog.bool_and(h.old_value is null) from public.project_settings_history h
                         where h.project_id::text like '00000000-0000-0000-5c05-%' and h.source = 'migration')),
  ('ws_tz', (select s.v ->> 'calendar.timezone' = 'Asia/Seoul' and s.revision = 1 and s.schema_version = 1
               from (select "values" as v, revision, schema_version from public.workspace_settings
                      where workspace_id = '00000000-0000-0000-5c05-000000000a01') s)),
  ('ws_history', (select pg_catalog.count(*) = 1 and pg_catalog.bool_and(h.key = 'calendar.timezone' and h.new_value = '"Asia/Seoul"'::jsonb)
                    from public.workspace_settings_history h
                   where h.workspace_id = '00000000-0000-0000-5c05-000000000a01' and h.source = 'migration')),
  ('docs_are_keys', (select pg_catalog.bool_and(r.week_start = public.week_key_of(r.project_id, r.week_start))
                       from public.weekly_reports r where r.project_id::text like '00000000-0000-0000-5c05-%')),
  ('p3_last_monday_is_transition', (select public.week_key_of('00000000-0000-0000-5c05-000000000c03', e.e3 - 1) = e.e3 - 6 from e))
) as x(name, ok);
do $$
declare v text;
begin
  select string_agg(name, ', ' order by name) into v from sp5_cal_rh where not ok;
  if v is not null then raise exception 'CALENDAR_WEEK_START_REHEARSAL: 거짓 — %', v; end if;
  raise notice 'CALENDAR_WEEK_START_REHEARSAL: % 항목 통과', (select count(*) from sp5_cal_rh);
end $$;
rollback;
\endif
