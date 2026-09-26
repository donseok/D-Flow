-- 0009_sp2_isolation_fixes 리허설 스모크. docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0009_smoke.sql
-- 카탈로그는 불리언(전부 t), 동작은 do 블록과 세션 판정 줄이 어긋나면 예외·f 로 드러난다. 전부 begin…rollback 이라 아무것도 남지 않는다.
-- 교차 계정 판정 전체는 tests/rls/workspace-isolation-cases.test.ts ⓐ·ⓐ′·ⓔ·ⓙ~ⓜ 가 본다. uuid 넷째 묶음 0909.
begin;
select (select array_length(conkey, 1) = 2 from pg_constraint
         where conname = 'wbs_items_parent_id_fkey' and conrelid = 'public.wbs_items'::regclass) as parent_fk_composite,
       exists (select 1 from pg_trigger where tgname = 'item_owners_guard' and tgrelid = 'public.item_owners'::regclass) as item_owners_guarded,
       exists (select 1 from pg_trigger where tgname = 'issue_links_minute_scope' and tgrelid = 'public.issue_links'::regclass) as issue_links_scoped,
       not has_function_privilege('authenticated', 'public.wiki_item_has_live_source(uuid)', 'EXECUTE') as live_source_revoked,
       has_function_privilege('service_role', 'public.wiki_item_has_live_source(uuid)', 'EXECUTE') as live_source_service,
       (select bool_and(prosrc like '%is_ws_member(%') from pg_proc where oid in (
          'public.is_project_admin(uuid)'::regprocedure, 'public.is_project_member(uuid)'::regprocedure,
          'public.my_member_id(uuid)'::regprocedure, 'public.my_team_ids(uuid)'::regprocedure,
          'public.is_project_admin_anywhere_in_ws(uuid)'::regprocedure, 'public.can_edit_issue(uuid)'::regprocedure)) as roster_needs_ws,
       (select bool_and(prosrc like '%and workspace_id = (select p.workspace_id from projects p where p.id = p_project_id)%') from pg_proc
         where oid in ('public.import_wbs(uuid, jsonb, jsonb)'::regprocedure, 'public.replace_wbs(uuid, jsonb, jsonb)'::regprocedure)) as import_team_ws;

-- 픽스처 — A·B 워크스페이스, 사용자 u 는 A 의 명단 member(팀 SMK) 이면서 A 워크스페이스 멤버
insert into public.workspaces (id, slug, name) values
  ('00000000-0000-0000-0909-00000000aa01', 'smoke9-a', 'Smoke9 A'), ('00000000-0000-0000-0909-00000000aa02', 'smoke9-b', 'Smoke9 B');
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
values ('00000000-0000-0000-0909-000000000a01', 'smoke9-u@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}',
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.profiles (user_id, email, display_name) values ('00000000-0000-0000-0909-000000000a01', 'smoke9-u@example.com', 'u');
insert into public.workspace_members (workspace_id, user_id, role) values ('00000000-0000-0000-0909-00000000aa01', '00000000-0000-0000-0909-000000000a01', 'member');
insert into public.people (id, workspace_id, display_name, email, user_id) values
  ('00000000-0000-0000-0909-000000000b01', '00000000-0000-0000-0909-00000000aa01', 'u', 'smoke9-u@example.com', '00000000-0000-0000-0909-000000000a01');
insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-0909-000000000c01', 'Smoke9 PA', '00000000-0000-0000-0909-00000000aa01'),
  ('00000000-0000-0000-0909-000000000c02', 'Smoke9 PB', '00000000-0000-0000-0909-00000000aa02');
insert into public.teams (id, workspace_id, project_id, code, name) values
  ('00000000-0000-0000-0909-000000000d01', '00000000-0000-0000-0909-00000000aa01', null, 'SMK', 'SMK'),
  ('00000000-0000-0000-0909-000000000d02', '00000000-0000-0000-0909-00000000aa02', null, 'SMK', 'SMK');
insert into public.project_members (id, project_id, person_id, access_role) values
  ('00000000-0000-0000-0909-000000000e01', '00000000-0000-0000-0909-000000000c01', '00000000-0000-0000-0909-000000000b01', 'member');
insert into public.project_member_teams (member_id, team_id, is_primary) values
  ('00000000-0000-0000-0909-000000000e01', '00000000-0000-0000-0909-000000000d01', true);
insert into public.wbs_items (id, project_id, code, name) values
  ('00000000-0000-0000-0909-000000000f01', '00000000-0000-0000-0909-000000000c01', '1', 'A 리프'),
  ('00000000-0000-0000-0909-000000000f02', '00000000-0000-0000-0909-000000000c02', '1', 'B 리프');
insert into public.minute_folders (id, project_id, parent_id, name) values
  ('00000000-0000-0000-0909-000000001201', '00000000-0000-0000-0909-000000000c01', null, 'SMK');

do $$
declare v_msg text; v_n int;
begin
  -- ② 다른 프로젝트 부모 → 23503
  begin
    insert into public.wbs_items (project_id, parent_id, code, name)
      values ('00000000-0000-0000-0909-000000000c02', '00000000-0000-0000-0909-000000000f01', '2', 'B 자식');
    raise exception 'SMOKE_0009: 다른 프로젝트 부모가 통과했다';
  exception when foreign_key_violation then null;
  end;
  -- ③ 다른 워크스페이스 공용 팀을 담당으로 → ITEM_OWNER_TEAM_SCOPE, 같은 워크스페이스 공용 팀은 된다
  begin
    insert into public.item_owners (wbs_item_id, team_id, kind) values ('00000000-0000-0000-0909-000000000f02', '00000000-0000-0000-0909-000000000d01', 'primary');
    raise exception 'SMOKE_0009: 다른 워크스페이스 팀 담당이 통과했다';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'ITEM_OWNER_TEAM_SCOPE' then raise exception 'SMOKE_0009: 담당 팀 — 기대 ITEM_OWNER_TEAM_SCOPE, 실제 %', v_msg; end if;
  end;
  insert into public.item_owners (wbs_item_id, team_id, kind) values ('00000000-0000-0000-0909-000000000f02', '00000000-0000-0000-0909-000000000d02', 'primary');
  -- ③ 임포트 — 같은 코드 SMK 가 두 워크스페이스에 있어도 대상 프로젝트(B) 워크스페이스 팀
  perform public.import_wbs('00000000-0000-0000-0909-000000000c02',
    '[{"tempId":"t1","code":"9","name":"임포트","owners":[{"team":"SMK","kind":"primary"}]}]'::jsonb, '[]'::jsonb);
  select count(*) into v_n from public.item_owners o join public.wbs_items w on w.id = o.wbs_item_id
   where w.project_id = '00000000-0000-0000-0909-000000000c02' and w.name = '임포트' and o.team_id = '00000000-0000-0000-0909-000000000d02';
  if v_n <> 1 then raise exception 'SMOKE_0009: 임포트 담당이 B 팀이 아니다(%건)', v_n; end if;
  -- ④ B 프로젝트 폴더를 A 폴더 아래에 → WORKSPACE_SCOPE_MISMATCH
  begin
    insert into public.minute_folders (project_id, parent_id, name)
      values ('00000000-0000-0000-0909-000000000c02', '00000000-0000-0000-0909-000000001201', 'B 폴더');
    raise exception 'SMOKE_0009: 다른 워크스페이스 부모 폴더가 통과했다';
  exception when check_violation then null;
  end;
  -- ⑤ B 이슈 + A 무프로젝트 회의록 → MINUTE_WORKSPACE_MISMATCH
  insert into public.minutes (id, project_id, workspace_id, minute_date, team_code, title, body_md) values
    ('00000000-0000-0000-0909-000000001101', null, '00000000-0000-0000-0909-00000000aa01', '2026-09-01', 'SMK', 'A 회의록', '# A');
  insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code) values
    ('00000000-0000-0000-0909-000000001102', '00000000-0000-0000-0909-000000001101', 1, '# A', 'smoke9-h', 'A 회의록', '2026-09-01', 'SMK');
  insert into public.issues (id, project_id, title) values ('00000000-0000-0000-0909-000000001103', '00000000-0000-0000-0909-000000000c02', 'B 이슈');
  begin
    insert into public.issue_links (issue_id, project_id, minute_id, minute_version_id, minute_version_no, minute_title_snapshot,
      minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot)
    values ('00000000-0000-0000-0909-000000001103', '00000000-0000-0000-0909-000000000c02', '00000000-0000-0000-0909-000000001101',
      '00000000-0000-0000-0909-000000001102', 1, 'A 회의록', '2026-09-01', 'smoke9-h', 0, 'smoke9-b', 'A 발췌');
    raise exception 'SMOKE_0009: 다른 워크스페이스 회의록 링크가 통과했다';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'MINUTE_WORKSPACE_MISMATCH' then raise exception 'SMOKE_0009: 원문 링크 — 기대 MINUTE_WORKSPACE_MISMATCH, 실제 %', v_msg; end if;
  end;
end $$;

-- ① 명단 행은 남기고 워크스페이스에서만 뺀다 — 헬퍼가 더는 명단을 권한으로 읽지 않는다(전부 t)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0909-000000000a01","role":"authenticated"}', true);
set local role authenticated;
select public.is_project_member('00000000-0000-0000-0909-000000000c01') as member_before;
reset role;
delete from public.workspace_members where user_id = '00000000-0000-0000-0909-000000000a01';
set local role authenticated;
select not public.is_project_member('00000000-0000-0000-0909-000000000c01') as member_revoked,
       public.my_member_id('00000000-0000-0000-0909-000000000c01') is null as member_id_gone,
       (select count(*) from public.my_team_ids('00000000-0000-0000-0909-000000000c01')) = 0 as teams_gone;
reset role;
rollback;
