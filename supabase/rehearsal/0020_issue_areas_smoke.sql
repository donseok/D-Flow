-- *_issue_areas 리허설 스모크(스펙 §3.8) — *_issue_areas_seed.sql 을 심고 정방향을 적용한 DB 에서 돈다(첫 적용 뒤, 롤백 → 재적용 뒤 두 번 —
-- 명령은 SP5 B1 계획 과제 6 Step 7). 확인은 불리언이고 하나라도 거짓·null 이면 ISSUE_AREAS_SMOKE 로 멈춘다. begin…rollback 이라 아무것도
-- 남기지 않는다. 덮는 것: 시드 P1~P4 의 이관 코드·영역·카운터·설정(D55·D57), 이관 뒤 새 등록의 번호(카운터 다음 — 지운 번호를 다시 쓰지
-- 않는다), 비활성 영역 거부, EXECUTE 기대표. 이름은 합성 — 고객 문자열 금지.
begin;
create temp table sp5_b1_smoke (name text primary key, ok boolean) on commit drop;
insert into sp5_b1_smoke (name, ok)
with a as (select a.id, a.project_id, a.code, a.name, a.active, a.sort_order from public.project_areas a
            where a.kind = 'issue_area' and a.project_id::text like '00000000-0000-0000-5c05-0000000b10%'),
     i as (select i.id, i.project_id, i.code, i.code_seq, i.code_scope, i.code_area_id, i.area_id from public.issues i
            where i.project_id::text like '00000000-0000-0000-5c05-0000000b10%'),
     s as (select s.project_id, s."values" as v, s.revision from public.project_settings s
            where s.project_id::text like '00000000-0000-0000-5c05-0000000b10%')
select x.name, coalesce(x.ok, false) from (values
  -- P1: 레거시는 (created_at, issue_no) 순, 분류 이슈는 PI 코드 그대로·그 영역 범위
  ('p1_legacy', (select (select code from i where id = '00000000-0000-0000-5c05-0000000b1111') = 'PI-U-001'
                    and (select code from i where id = '00000000-0000-0000-5c05-0000000b1112') = 'PI-U-002'
                    and (select pg_catalog.bool_and(code_scope = 'legacy' and code_area_id is null and area_id is null) from i
                          where id in ('00000000-0000-0000-5c05-0000000b1111', '00000000-0000-0000-5c05-0000000b1112')))),
  ('p1_classified', (select pg_catalog.string_agg(i.code || '@' || a.code, ',' order by i.code) = 'PI-I-00-01@00,PI-I-00-02@00,PI-I-03-01@03'
                         and pg_catalog.bool_and(i.code_scope = 'a:' || a.id and i.code_area_id = a.id)
                       from i join a on a.id = i.area_id where i.project_id = '00000000-0000-0000-5c05-0000000b1011')),
  ('p1_areas', (select pg_catalog.string_agg(code || ':' || name || ':' || active, ',' order by code) = '00:연구:true,03:운영:true,05:안전:false'
                  from a where project_id = '00000000-0000-0000-5c05-0000000b1011')),
  ('p2_iss', (select (select code from i where id = '00000000-0000-0000-5c05-0000000b1121') = 'ISS-001'
                 and (select code from i where id = '00000000-0000-0000-5c05-0000000b1122') = 'ISS-002'
                 and (select code from i where id = '00000000-0000-0000-5c05-0000000b1123') = 'ISS-003'
                 and (select pg_catalog.bool_and(code_scope = '') from i where project_id = '00000000-0000-0000-5c05-0000000b1012'))),
  ('p3_empty', (select pg_catalog.count(*) = 0 from i where project_id = '00000000-0000-0000-5c05-0000000b1013')
                 and (select pg_catalog.count(*) = 0 from a where project_id = '00000000-0000-0000-5c05-0000000b1013')),
  ('p4_area_reused', (select i.area_id = '00000000-0000-0000-5c05-0000000b1301' and a.name = '기존 영역' and i.code = 'PI-I-00-01'
                        from i join a on a.id = i.area_id where i.id = '00000000-0000-0000-5c05-0000000b1105')
                      and (select pg_catalog.count(*) = 1 from a where project_id = '00000000-0000-0000-5c05-0000000b1014')),
  ('counters', (select pg_catalog.string_agg(coalesce(ar.code, c.scope_key) || '=' || c.last_no, ',' order by c.project_id, coalesce(ar.code, c.scope_key))
                       = '00=3,03=1,05=4,legacy=2,=3,00=1'
                  from public.issue_number_counters c
                  left join a ar on c.scope_key = 'a:' || ar.id
                 where c.project_id::text like '00000000-0000-0000-5c05-0000000b10%')),
  ('majors_mapped', (select pg_catalog.string_agg(p.name || '@' || a.code || '#' || p.major_seq, ',' order by p.name)
                            = '대분류 가@00#1,대분류 나@00#2,대분류 다@03#1,대분류 라@00#1'
                       from public.issue_major_processes p join a on a.id = p.area_id)),
  -- 설정(D57): 네 프로젝트 모두 issue_analysis 편입·issues.analysis required, PI 프로젝트(P1·P4)만 id_policy, 워크스페이스 허용 편입
  ('settings_modules', (select pg_catalog.bool_and((v -> 'modules.enabled') ? 'issue_analysis' and v ->> 'issues.analysis' = 'required') and pg_catalog.count(*) = 4 from s)),
  ('settings_policy', (select pg_catalog.bool_and(case when project_id in ('00000000-0000-0000-5c05-0000000b1011', '00000000-0000-0000-5c05-0000000b1014')
                                                      then v -> 'issues.id_policy' = '{"prefix": "PI", "pattern": "{prefix}-I-{area}-{seq:2}", "counter_scope": "area", "reset": "never"}'::jsonb
                                                      else not (v ? 'issues.id_policy') end) from s)),
  ('settings_ws', (select (w."values" -> 'modules.allowed') ? 'issue_analysis' from public.workspace_settings w
                    where w.workspace_id = '00000000-0000-0000-5c05-0000000b1001')),
  -- 이력: 마지막 revision 은 이관 한 번(한 command_id, source migration, modules.enabled 포함), issues.analysis 는 프로젝트마다 한 번만 기록
  ('history_last_revision', (select pg_catalog.bool_and(h.ok) from (
                               select pg_catalog.count(distinct x.command_id) = 1 and pg_catalog.bool_and(x.source = 'migration')
                                      and pg_catalog.bool_or(x.key = 'modules.enabled') and pg_catalog.max(x.revision) = max(s.revision) as ok
                                 from public.project_settings_history x join s on s.project_id = x.project_id
                                where x.revision = s.revision group by x.project_id) h)),
  ('history_analysis_once', (select pg_catalog.bool_and(n = 1) from (
                               select pg_catalog.count(*) as n from public.project_settings_history x
                                where x.project_id::text like '00000000-0000-0000-5c05-0000000b10%' and x.key = 'issues.analysis'
                                group by x.project_id) h)),
  -- EXECUTE 기대표
  ('exec_rpc', (select not has_function_privilege('anon', f.oid, 'EXECUTE') and not has_function_privilege('authenticated', f.oid, 'EXECUTE')
                       and has_function_privilege('service_role', f.oid, 'EXECUTE') and f.prosecdef
                  from pg_proc f where f.oid = 'public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text)'::regprocedure)),
  ('exec_helpers', (select pg_catalog.bool_and(not has_function_privilege('anon', x.fn::regprocedure, 'EXECUTE')
                                               and not has_function_privilege('authenticated', x.fn::regprocedure, 'EXECUTE'))
                      from unnest(array['public.assign_issue_code()', 'public.render_issue_code(jsonb, text, int, bigint)',
                                        'public.issue_id_policy_of(jsonb)', 'public.issue_code_year(text, timestamptz)']) as x(fn)))
) as x(name, ok);
do $$
declare
  v text;
  v_code text;
begin
  -- 이관 뒤 새 등록: P1 영역 00 은 카운터 3 다음(지운 03 을 다시 쓰지 않는다), P2 는 ISS 카운터를 잇고, P3 는 1번부터
  insert into public.issues (project_id, title, area_id)
  select '00000000-0000-0000-5c05-0000000b1011', '스모크 P1', a.id from public.project_areas a
   where a.project_id = '00000000-0000-0000-5c05-0000000b1011' and a.kind = 'issue_area' and a.code = '00'
  returning code into v_code;
  insert into sp5_b1_smoke values ('new_p1_00', v_code = 'PI-I-00-04');
  insert into public.issues (project_id, title) values ('00000000-0000-0000-5c05-0000000b1012', '스모크 P2') returning code into v_code;
  insert into sp5_b1_smoke values ('new_p2', v_code = 'ISS-004');
  insert into public.issues (project_id, title) values ('00000000-0000-0000-5c05-0000000b1013', '스모크 P3') returning code into v_code;
  insert into sp5_b1_smoke values ('new_p3', v_code = 'ISS-001');
  -- PI 프로젝트에서 영역 없이 등록하면 ISSUE_AREA_REQUIRED, 비활성 영역(05)은 ISSUE_AREA_INACTIVE
  begin
    insert into public.issues (project_id, title) values ('00000000-0000-0000-5c05-0000000b1011', '스모크 영역 없음');
    insert into sp5_b1_smoke values ('p1_area_required', false);
  exception when check_violation then
    insert into sp5_b1_smoke values ('p1_area_required', sqlerrm = 'ISSUE_AREA_REQUIRED');
  end;
  begin
    insert into public.issues (project_id, title, area_id)
    select '00000000-0000-0000-5c05-0000000b1011', '스모크 비활성', a.id from public.project_areas a
     where a.project_id = '00000000-0000-0000-5c05-0000000b1011' and a.kind = 'issue_area' and a.code = '05';
    insert into sp5_b1_smoke values ('p1_inactive_rejected', false);
  exception when check_violation then
    insert into sp5_b1_smoke values ('p1_inactive_rejected', sqlerrm = 'ISSUE_AREA_INACTIVE');
  end;
  select string_agg(name, ', ' order by name) into v from sp5_b1_smoke where not coalesce(ok, false);
  if v is not null then raise exception 'ISSUE_AREAS_SMOKE: 거짓 — %', v; end if;
  raise notice 'ISSUE_AREAS_SMOKE: % 항목 통과', (select count(*) from sp5_b1_smoke);
end $$;
rollback;
