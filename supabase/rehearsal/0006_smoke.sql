-- 0006_workspace_isolation 리허설 스모크. docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0006_smoke.sql
-- uuid 넷째 묶음 0006.
begin;
select to_regprocedure('public.app_role()') is null as app_role_dropped,
       not has_function_privilege('anon', 'public.can_read_project(uuid)', 'EXECUTE') as anon_no_helpers,
       not has_function_privilege('authenticated', 'public.project_ws(uuid)', 'EXECUTE') as project_ws_revoked,   -- R3 분기 B 면 이 줄을 has_… 로 바꾸고 주석
       not has_column_privilege('authenticated', 'public.project_members', 'person_id', 'UPDATE') as roster_person_locked,
       has_column_privilege('authenticated', 'public.project_members', 'access_role', 'UPDATE') as roster_role_open,
       not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'
                    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) as anon_no_writes;

insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-0006-00000000aa01', 'smoke6', 'Smoke 6');
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
values ('00000000-0000-0000-0006-000000000a01', 'smoke6-alice@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}',
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.profiles (user_id, email, display_name) values ('00000000-0000-0000-0006-000000000a01', 'smoke6-alice@example.com', 'alice');
insert into public.workspace_members (workspace_id, user_id, role) values ('00000000-0000-0000-0006-00000000aa01', '00000000-0000-0000-0006-000000000a01', 'admin');
insert into public.people (id, workspace_id, display_name, email, user_id) values
  ('00000000-0000-0000-0006-000000000b01', '00000000-0000-0000-0006-00000000aa01', 'alice', 'smoke6-alice@example.com', '00000000-0000-0000-0006-000000000a01');
insert into public.projects (id, name, workspace_id) values ('00000000-0000-0000-0006-000000000c01', 'P6', '00000000-0000-0000-0006-00000000aa01');
insert into public.teams (id, workspace_id, project_id, code, name) values
  ('00000000-0000-0000-0006-000000000d01', '00000000-0000-0000-0006-00000000aa01', null, 'SMK', 'SMK');
insert into public.project_members (id, project_id, person_id, access_role) values
  ('00000000-0000-0000-0006-000000000e01', '00000000-0000-0000-0006-000000000c01', '00000000-0000-0000-0006-000000000b01', 'admin');
insert into public.attendance_records (project_id, member_id, date, type) values
  ('00000000-0000-0000-0006-000000000c01', '00000000-0000-0000-0006-000000000e01', '2026-09-01', 'work');
insert into public.wbs_items (id, project_id, code, name, assignee_member_id) values
  ('00000000-0000-0000-0006-000000000f01', '00000000-0000-0000-0006-000000000c01', '1', 'L', '00000000-0000-0000-0006-000000000e01');
insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by) values
  ('00000000-0000-0000-0006-000000001101', '00000000-0000-0000-0006-000000000c01', '2026-09-01', 'SMK', 'M', '#', '00000000-0000-0000-0006-000000000a01');
select workspace_id = '00000000-0000-0000-0006-00000000aa01' as minute_ws_filled_from_project
  from public.minutes where id = '00000000-0000-0000-0006-000000001101';

-- 기록 있는 명단 행 직접 삭제 → 23503(NO ACTION; 분기 B 면 set constraints all immediate 로 즉시 검사)
do $$ begin
  set constraints all immediate;
  delete from public.project_members where id = '00000000-0000-0000-0006-000000000e01';
  raise exception 'expected 23503';
exception when foreign_key_violation then null; end $$;
-- 프로젝트 없는 회의록은 workspace_id 없이 못 넣는다
do $$ begin
  insert into public.minutes (minute_date, team_code, title, body_md) values ('2026-09-01', 'SMK', 'X', '#');
  raise exception 'expected 23502';
exception when not_null_violation then null; end $$;
-- 프로젝트와 다른 워크스페이스 → 23514
do $$ begin
  insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-0006-00000000aa02', 'smoke6b', 'Smoke 6b');
  insert into public.minutes (project_id, workspace_id, minute_date, team_code, title, body_md)
  values ('00000000-0000-0000-0006-000000000c01', '00000000-0000-0000-0006-00000000aa02', '2026-09-01', 'SMK', 'X', '#');
  raise exception 'expected WORKSPACE_SCOPE_MISMATCH';
exception when check_violation then null; end $$;
-- RPC: 프로젝트 없는 회의록은 p_workspace_id 필수. 22023 은 입력·외부 id·파일 검사도 쓰므로 메시지까지 본다.
do $$ begin
  perform * from public.create_minute_with_version(null, '2026-09-01', 'SMK', 'T', '#', public.wiki_fnv1a64('#'),
    null, null, null, null, null, '00000000-0000-0000-0006-000000000a01', 'alice');
  raise exception 'expected MINUTE_WORKSPACE_REQUIRED';
exception when invalid_parameter_value then
  if sqlerrm <> 'MINUTE_WORKSPACE_REQUIRED' then raise; end if;
end $$;
select count(*) = 1 as rpc_null_project_ok from public.create_minute_with_version(null, '2026-09-01', 'SMK', 'T', '#', public.wiki_fnv1a64('#'),
    null, null, null, null, null, '00000000-0000-0000-0006-000000000a01', 'alice', null, null, null, null, '00000000-0000-0000-0006-00000000aa01');

-- R4: 프로젝트 삭제는 명단·근태·WBS 를 한 문장으로 지운다(NO ACTION 이 cascade 순서에 막히지 않는가).
-- 위 DO 블록의 immediate 를 풀고(분기 B 의 deferrable FK 가 커밋 시점 검사로 돌아가게) 삭제한 뒤, immediate 로 밀린 검사를 지금 돌린다.
set constraints all deferred;
delete from public.projects where id = '00000000-0000-0000-0006-000000000c01';
set constraints all immediate;
select not exists (select 1 from public.project_members where id = '00000000-0000-0000-0006-000000000e01') as project_delete_cascaded,
       (select project_id is null and workspace_id = '00000000-0000-0000-0006-00000000aa01' from public.minutes
         where id = '00000000-0000-0000-0006-000000001101') as minute_keeps_ws_after_project_delete;
rollback;
