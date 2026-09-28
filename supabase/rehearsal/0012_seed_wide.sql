-- 0012 데이터 업그레이드 리허설 — 넓은 열에 값이 든 0011 DB 를 만든다. 0011 스키마 위에 흘리고 **커밋**한다.
--   supabase db reset --version 0011
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0012_seed_wide.sql
--   supabase migration up --local
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0012_smoke.sql
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0012_created_fixture.sql
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/0012_settings_rollback.sql
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0012_rollback_check.sql
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 < supabase/migrations/0012_settings.sql
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0012_smoke.sql
-- 덮는 경우: 프로파일 있음·없음, 크레딧 있음·null, 추가 축 있음·null, 키워드 대문자·빈 배열, agent_projects 켜짐·꺼짐·행 없음,
-- 도메인 목록 있음(대문자 섞임)·빈 목록, 설정 행이 없는 프로젝트와 워크스페이스, 단계 이름보다 한 단 깊은 SUB-ACT 행(사전검사가 세지 않는다),
-- 경계값(…c14·…c15): 단계 이름 10개·1개, 추가 축 20자·1자, 키워드 40자·1자·U+FFFF 위 글자로 40(UTF-16), 앞뒤의 탭·줄바꿈·NBSP·
-- 전각 공백(btrim 기본값은 남기고 JS trim 은 떼는 것), 0012 가 버리는 열(max_depth·enabled_modules·…·force_bottleneck_*)의 기본값 아닌 값.
-- uuid 넷째 묶음 0012, 다섯째 묶음의 둘째 자리가 1(사전검사 리허설 파일은 0).
begin;
insert into public.workspaces (id, slug, name) values
  ('00000000-0000-0000-0012-00000000aa11', 'seed12-a', 'Seed12 A'),   -- 설정 행 있음, 도메인 목록 있음
  ('00000000-0000-0000-0012-00000000aa12', 'seed12-b', 'Seed12 B'),   -- 설정 행 있음, 빈 목록
  ('00000000-0000-0000-0012-00000000aa13', 'seed12-c', 'Seed12 C'),   -- 설정 행 없음
  ('00000000-0000-0000-0012-00000000aa14', 'seed12-d', 'Seed12 D');   -- 설정 행 있음, 전각 공백·대문자 도메인
insert into public.workspace_settings (workspace_id, allowed_domains) values
  ('00000000-0000-0000-0012-00000000aa11', array['Example.com', ' acme.test ']),
  ('00000000-0000-0000-0012-00000000aa12', '{}'),
  ('00000000-0000-0000-0012-00000000aa14', array[E'　Sub.Example.COM\t', 'B.test']);
insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-0012-000000000c11', 'Seed12 가득', '00000000-0000-0000-0012-00000000aa11'),
  ('00000000-0000-0000-0012-000000000c12', 'Seed12 기본', '00000000-0000-0000-0012-00000000aa11'),
  ('00000000-0000-0000-0012-000000000c13', 'Seed12 행 없음', '00000000-0000-0000-0012-00000000aa12'),
  ('00000000-0000-0000-0012-000000000c14', 'Seed12 상한', '00000000-0000-0000-0012-00000000aa14'),
  ('00000000-0000-0000-0012-000000000c15', 'Seed12 하한', '00000000-0000-0000-0012-00000000aa14');
insert into public.project_settings
  (project_id, level_labels, max_depth, extra_axis_label, milestone_keywords, excel_profile, stage_credits, force_bottleneck_min_hours) values
  ('00000000-0000-0000-0012-000000000c11', array['Phase', ' Task'], 2, 'Track', array['Kick-Off', '오픈'],
   '{"version": 1, "sheet": "WBS", "teamColumns": []}'::jsonb,
   '{"default": {"as": 5, "ip": 25, "rw": 45, "im": 85, "xx": 100}}'::jsonb, 8),
  ('00000000-0000-0000-0012-000000000c12', array['Phase', 'Task', 'Activity'], null, null, '{}', '{}'::jsonb, null, 4);
-- …c13 에는 설정 행을 넣지 않는다(③ 백필 대상)
-- 상한: 단계 이름 10개(앞뒤 공백 여러 종류), 추가 축 20자(탭·전각 공백으로 감쌈), 키워드 40자·U+FFFF 위 글자 포함 UTF-16 40, 버리는 열 전부 값
insert into public.project_settings
  (project_id, level_labels, max_depth, extra_axis_label, milestone_keywords, excel_profile, enabled_modules, weekly_sections,
   working_days, timezone, preset_applied, stage_credits, force_bottleneck_min_successors, force_bottleneck_min_hours) values
  ('00000000-0000-0000-0012-000000000c14',
   array[E' Level 1', E'Level 2\t', E'\nLevel 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8', 'Level 9', E'　Level 10　'],
   10, E'\tABCDEFGHIJKLMNOPQRST　',
   array[E' GO-LIVE\n', repeat('K', 40), repeat('x', 38) || E'\U0001F680'],
   '{"version": 1, "sheet": "Plan", "teamColumns": []}'::jsonb, array['kanban'], array['summary'], array[1, 2, 3], 'Asia/Seoul', 'it',
   '{"default": {"as": 10, "ip": 30, "rw": 50, "im": 80, "xx": 100}}'::jsonb, 5, 6),
-- 하한: 단계 이름 1개, 추가 축 1자, 키워드 1자
  ('00000000-0000-0000-0012-000000000c15', array['  Only  '], 1, ' X ', array['Q'], '{}'::jsonb, null, null, null, null, null, null, 3, 4);
insert into public.agent_projects (project_id, enabled) values
  ('00000000-0000-0000-0012-000000000c11', true),
  ('00000000-0000-0000-0012-000000000c12', false),
  ('00000000-0000-0000-0012-000000000c15', true);
-- 라벨 2개 프로젝트에 2단 트리 + 그 리프 아래 SUB-ACT 한 행(3번째 단이지만 단계 이름이 없는 보조 행)
insert into public.wbs_items (id, project_id, parent_id, code, name, is_owner_split) values
  ('00000000-0000-0000-0012-000000000f11', '00000000-0000-0000-0012-000000000c11', null, '1', '1단', false),
  ('00000000-0000-0000-0012-000000000f12', '00000000-0000-0000-0012-000000000c11', '00000000-0000-0000-0012-000000000f11', '1.1', '2단', false),
  ('00000000-0000-0000-0012-000000000f13', '00000000-0000-0000-0012-000000000c11', '00000000-0000-0000-0012-000000000f12', '1.1', '2단 (A 주관)', true),
-- 라벨 1개 프로젝트에 1단 트리(깊이 = 단계 이름 수 — 경계에서 사전검사를 통과한다)
  ('00000000-0000-0000-0012-000000000f15', '00000000-0000-0000-0012-000000000c15', null, '1', '1단', false);
commit;
