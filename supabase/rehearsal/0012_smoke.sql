-- 0012_settings 리허설 스모크 — 0012_seed_wide.sql 을 심고 0012 를 적용한 DB 에서 돌린다(머리의 절차는 seed 파일).
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0012_smoke.sql
-- 카탈로그·이행 결과는 불리언(전부 t), 동작은 do 블록이 어긋나면 예외로 멈춘다. 전부 begin…rollback 이라 아무것도 남지 않는다.
-- 빈 DB 의 계약(권한·RPC·트리거)은 tests/rls/settings-*.test.ts·authz-events.test.ts 가 본다. 이 파일은 **데이터가 있는 업그레이드**만 본다.
begin;
select
  -- 가득 찬 프로젝트(…c11): 라벨은 btrim, 키워드는 소문자, 프로파일·크레딧·추가 축이 키로 옮겨졌다
  (select s."values" -> 'core.level_labels' = '["Phase", "Task"]'::jsonb
      and s."values" -> 'core.milestone_keywords' = '["kick-off", "오픈"]'::jsonb
      and s."values" -> 'core.extra_axis_label' = '"Track"'::jsonb
      and s."values" -> 'wbs.excel_profile' = '{"version": 1, "sheet": "WBS", "teamColumns": []}'::jsonb
      and s."values" -> 'workflow.stage_credits' = '{"default": {"as": 5, "ip": 25, "rw": 45, "im": 85, "xx": 100}}'::jsonb
      and s."values" -> 'modules.enabled' ? 'agents' and jsonb_array_length(s."values" -> 'modules.enabled') = 9
      and s.revision = 1 and s.schema_version = 1
     from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c11') as full_project,
  -- 기본 프로젝트(…c12): 빈 프로파일·null 크레딧·null 추가 축은 키 없음, 빈 키워드는 명시 [], 꺼진 에이전트는 빠진다
  (select not (s."values" ? 'wbs.excel_profile') and not (s."values" ? 'workflow.stage_credits') and not (s."values" ? 'core.extra_axis_label')
      and s."values" -> 'core.milestone_keywords' = '[]'::jsonb
      and not (s."values" -> 'modules.enabled' ? 'agents') and jsonb_array_length(s."values" -> 'modules.enabled') = 8
     from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c12') as default_project,
  -- 설정 행이 없던 프로젝트(…c13): 백필 행이 기준선 기본값(3단)을 받는다. agent_projects 행이 없으면 agents 는 빠진다
  (select s."values" -> 'core.level_labels' = '["Phase", "Task", "Activity"]'::jsonb
      and not (s."values" -> 'modules.enabled' ? 'agents') and s.revision = 1
     from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c13') as backfilled_project,
  -- 상한(…c14): 앞뒤의 탭·줄바꿈·NBSP·전각 공백을 JS trim 처럼 뗐고, 20자·40자·UTF-16 40 은 잘리지 않았다. 버린 열은 키가 되지 않는다
  (select s."values" -> 'core.level_labels' = '["Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6", "Level 7", "Level 8", "Level 9", "Level 10"]'::jsonb
      and s."values" -> 'core.extra_axis_label' = '"ABCDEFGHIJKLMNOPQRST"'::jsonb
      and s."values" -> 'core.milestone_keywords' = jsonb_build_array('go-live', repeat('k', 40), repeat('x', 38) || E'\U0001F680')
      and s."values" -> 'wbs.excel_profile' = '{"version": 1, "sheet": "Plan", "teamColumns": []}'::jsonb
      and s."values" -> 'workflow.stage_credits' = '{"default": {"as": 10, "ip": 30, "rw": 50, "im": 80, "xx": 100}}'::jsonb
      and not (s."values" -> 'modules.enabled' ? 'agents') and jsonb_array_length(s."values" -> 'modules.enabled') = 8
      and (select count(*) from jsonb_object_keys(s."values")) = 6
     from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c14') as upper_bound_project,
  -- 하한(…c15): 1개·1자, 켜진 에이전트는 들어간다
  (select s."values" -> 'core.level_labels' = '["Only"]'::jsonb
      and s."values" -> 'core.extra_axis_label' = '"X"'::jsonb
      and s."values" -> 'core.milestone_keywords' = '["q"]'::jsonb
      and not (s."values" ? 'wbs.excel_profile') and not (s."values" ? 'workflow.stage_credits')
      and s."values" -> 'modules.enabled' ? 'agents' and jsonb_array_length(s."values" -> 'modules.enabled') = 9
     from public.project_settings s where s.project_id = '00000000-0000-0000-0012-000000000c15') as lower_bound_project,
  (select s."values" -> 'invites.allowed_domains' = '["example.com", "acme.test"]'::jsonb
      and jsonb_array_length(s."values" -> 'modules.allowed') = 13 and s.revision = 1
     from public.workspace_settings s where s.workspace_id = '00000000-0000-0000-0012-00000000aa11') as workspace_with_domains,
  (select not (s."values" ? 'invites.allowed_domains') and s."values" ? 'modules.allowed'
     from public.workspace_settings s where s.workspace_id = '00000000-0000-0000-0012-00000000aa12') as workspace_empty_domains,
  (select s."values" ? 'modules.allowed' and s.revision = 1
     from public.workspace_settings s where s.workspace_id = '00000000-0000-0000-0012-00000000aa13') as backfilled_workspace,
  (select s."values" -> 'invites.allowed_domains' = '["sub.example.com", "b.test"]'::jsonb
     from public.workspace_settings s where s.workspace_id = '00000000-0000-0000-0012-00000000aa14') as workspace_trimmed_domains,
  -- 이행 이력: 키마다 1행, 프로젝트마다 명령 id 하나, 출처 migration, 바꾼 사람·요약 없음
  (select count(*) = 6 and count(distinct h.command_id) = 1 and bool_and(h.source = 'migration' and h.revision = 1
            and h.old_value is null and h.changed_by is null and h.command_digest is null)
     from public.project_settings_history h where h.project_id = '00000000-0000-0000-0012-000000000c11') as history_full,
  (select count(*) = 3 from public.project_settings_history h where h.project_id = '00000000-0000-0000-0012-000000000c12') as history_default,
  (select count(*) = 6 from public.project_settings_history h where h.project_id = '00000000-0000-0000-0012-000000000c14') as history_upper,
  (select count(*) = 4 from public.project_settings_history h where h.project_id = '00000000-0000-0000-0012-000000000c15') as history_lower,
  (select count(distinct h.command_id) = 5 from public.project_settings_history h
    where h.project_id::text like '00000000-0000-0000-0012-000000000c1_') as one_command_per_project,
  -- 이력의 새 값은 문서의 그 키와 같고, 문서의 키마다 이력이 있다(시드한 프로젝트·워크스페이스 전부)
  (select bool_and(h.new_value = s."values" -> h.key) and count(*) = (select sum((select count(*) from jsonb_object_keys(p."values")))
                                                                        from public.project_settings p
                                                                       where p.project_id::text like '00000000-0000-0000-0012-000000000c1_')
     from public.project_settings_history h join public.project_settings s on s.project_id = h.project_id
    where h.project_id::text like '00000000-0000-0000-0012-000000000c1_') as history_matches_values,
  (select count(*) = 2 from public.workspace_settings_history h where h.workspace_id = '00000000-0000-0000-0012-00000000aa11') as history_workspace,
  (select bool_and(h.new_value = s."values" -> h.key and h.source = 'migration' and h.revision = 1)
          and count(*) = 6 and count(distinct h.command_id) = 4
     from public.workspace_settings_history h join public.workspace_settings s on s.workspace_id = h.workspace_id
    where h.workspace_id::text like '00000000-0000-0000-0012-00000000aa1_') as history_workspace_all;

do $$
declare
  r jsonb;
begin
  -- 전이 RPC 가 옮겨진 크레딧을 읽는다(…c11 의 사용자 표: ip 25)
  update public.wbs_items set dev_workflow = true, stage = null, actual_pct = 40 where id = '00000000-0000-0000-0012-000000000f13';
  r := public.apply_workflow_event('set_stage', null, '00000000-0000-0000-0012-000000000f13', null, 'ip', null, null, null);
  if (r ->> 'actual_pct')::numeric <> 25 then
    raise exception '0012 smoke: 전이가 옮겨진 크레딧을 읽지 않는다: %', r;
  end if;
  -- 이행한 문서에 설정 RPC 가 이어 쓴다(revision 1 → 2)
  r := public.apply_project_settings('00000000-0000-0000-0012-000000000c11', 1, gen_random_uuid(),
         '{"core.extra_axis_label": "Stream"}'::jsonb, null, null, 1, 'internal');
  if r <> '{"status": "applied", "revision": 2}'::jsonb then
    raise exception '0012 smoke: 이행한 문서에 이어 쓰지 못한다: %', r;
  end if;
end $$;
rollback;
