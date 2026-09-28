-- 0012 롤백의 데이터 복원 확인 — 0012_seed_wide.sql 을 심고 0012 를 적용한 뒤 롤백한 DB 에서 돌린다(절차는 seed 파일 머리).
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0012_rollback_check.sql
-- 전부 t 여야 한다: 값이 넓은 열로 돌아왔고(정규화된 채 — 단계 이름의 앞뒤 공백은 떼고, 키워드·도메인은 소문자),
-- 0012 가 버린 열은 기준선 기본값이며(null, force_bottleneck 은 3·4), ③ 이 백필한 행은 남았다. 읽기만 한다.
select
  (select s.level_labels = array['Phase', 'Task'] and s.max_depth is null and s.extra_axis_label = 'Track'
      and s.milestone_keywords = array['kick-off', '오픈'] and s.excel_profile = '{"version": 1, "sheet": "WBS", "teamColumns": []}'::jsonb
      and s.stage_credits = '{"default": {"as": 5, "ip": 25, "rw": 45, "im": 85, "xx": 100}}'::jsonb
      and s.force_bottleneck_min_successors = 3 and s.force_bottleneck_min_hours = 4
     from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c11') as full_project_back,
  (select s.level_labels = array['Phase', 'Task', 'Activity'] and s.milestone_keywords = '{}' and s.excel_profile = '{}'::jsonb
      and s.stage_credits is null and s.extra_axis_label is null
     from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c12') as default_project_back,
  (select count(*) = 1 from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c13') as backfilled_row_kept,
  (select s.level_labels = array['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8', 'Level 9', 'Level 10']
      and s.extra_axis_label = 'ABCDEFGHIJKLMNOPQRST'
      and s.milestone_keywords = array['go-live', repeat('k', 40), repeat('x', 38) || E'\U0001F680']
      and s.excel_profile = '{"version": 1, "sheet": "Plan", "teamColumns": []}'::jsonb
      and s.stage_credits = '{"default": {"as": 10, "ip": 30, "rw": 50, "im": 80, "xx": 100}}'::jsonb
      and s.max_depth is null and s.enabled_modules is null and s.weekly_sections is null and s.working_days is null
      and s.timezone is null and s.preset_applied is null
      and s.force_bottleneck_min_successors = 3 and s.force_bottleneck_min_hours = 4
     from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c14') as upper_bound_back,
  (select s.level_labels = array['Only'] and s.extra_axis_label = 'X' and s.milestone_keywords = array['q']
      and s.excel_profile = '{}'::jsonb and s.stage_credits is null and s.max_depth is null
     from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c15') as lower_bound_back,
  (select s.allowed_domains = array['example.com', 'acme.test']
     from public.workspace_settings s where s.workspace_id = '00000000-0000-0000-0012-00000000aa11') as domains_back,
  (select s.allowed_domains = '{}' from public.workspace_settings s where s.workspace_id = '00000000-0000-0000-0012-00000000aa12') as empty_domains_back,
  (select s.allowed_domains = '{}' from public.workspace_settings s where s.workspace_id = '00000000-0000-0000-0012-00000000aa13') as backfilled_workspace_back,
  (select s.allowed_domains = array['sub.example.com', 'b.test']
     from public.workspace_settings s where s.workspace_id = '00000000-0000-0000-0012-00000000aa14') as trimmed_domains_back,
  (select count(*) = 3 from public.agent_projects a where a.project_id::text like '00000000-0000-0000-0012-000000000c1_') as agent_rows_back;
