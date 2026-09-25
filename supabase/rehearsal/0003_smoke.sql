-- 0003_org_core 리허설 스모크 — CLI 가 적용하지 않는 폴더(supabase/rehearsal/). 로컬 DB 에 postgres 로 흘린다:
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0003_smoke.sql
-- 한 트랜잭션 안에서 돌고 마지막에 rollback 한다(DB 에 흔적 없음). 기대 예외는 DO 블록이 SQLSTATE·메시지로 확인하고,
-- 기대와 다르면 오류로 멈춘다. 결과 줄의 불리언이 전부 t 여야 한다(claims_* 일곱은 세션 설정 줄이라 늘 t).
-- 롤: 대부분 postgres(= service_role 경로처럼 RLS·실행 권한을 우회)로 돈다. "세션 경로" 절만 set local role authenticated +
-- JWT sub 로 RLS·컬럼 권한·RPC 실행 권한(service_role 전용)을 실제로 태운다.
-- uuid 는 16진수만: 워크스페이스 …aaaa/…bbbb, 계정 …0a0N, 인물 …0b0N, 프로젝트 …0c0N, 팀 …0d0N,
-- 회의록·버전 …0e0N, 회의 …0f01, 회의록 폴더 …0f1N, 알림 사건 …1e01.
begin;

-- 픽스처 -------------------------------------------------------------------------
insert into public.workspaces (id, slug, name) values
  ('00000000-0000-0000-0000-00000000aaaa', 'acme', 'Acme'),
  ('00000000-0000-0000-0000-00000000bbbb', 'other', 'Other');
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
select v.id, v.email, '', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated',
       '00000000-0000-0000-0000-000000000000', now(), now()
  from (values
    ('00000000-0000-0000-0000-000000000a01'::uuid, 'alice@example.com'),
    ('00000000-0000-0000-0000-000000000a02'::uuid, 'carol@example.com'),
    ('00000000-0000-0000-0000-000000000a03'::uuid, 'dave@example.com'),
    ('00000000-0000-0000-0000-000000000a04'::uuid, 'erin@example.com'),
    ('00000000-0000-0000-0000-000000000a05'::uuid, 'frank@example.com'),
    ('00000000-0000-0000-0000-000000000a06'::uuid, 'grace@example.com'),
    ('00000000-0000-0000-0000-000000000a07'::uuid, 'gina@example.com')) as v(id, email);
insert into public.profiles (user_id, email, display_name) values
  ('00000000-0000-0000-0000-000000000a01', 'alice@example.com', 'alice');
insert into public.workspace_members values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000a01', 'admin', null, now()),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000a02', 'member', null, now()),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000a03', 'member', null, now()),
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000a06', 'admin', null, now()),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-000000000a05', 'admin', null, now());
insert into public.people (id, workspace_id, display_name, email, user_id) values
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000aaaa', 'alice', 'alice@example.com', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-00000000aaaa', 'carol', 'carol@example.com', '00000000-0000-0000-0000-000000000a02'),
  ('00000000-0000-0000-0000-000000000b04', '00000000-0000-0000-0000-00000000aaaa', 'dave', 'dave@example.com', '00000000-0000-0000-0000-000000000a03'),
  ('00000000-0000-0000-0000-000000000b05', '00000000-0000-0000-0000-00000000bbbb', 'frank', 'frank@example.com', '00000000-0000-0000-0000-000000000a05');
insert into public.people (id, workspace_id, display_name) values
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-00000000aaaa', 'bob(external)');
insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-0000-000000000c01', 'P1', '00000000-0000-0000-0000-00000000aaaa'),
  ('00000000-0000-0000-0000-000000000c02', 'P2', '00000000-0000-0000-0000-00000000aaaa');
insert into public.teams (id, workspace_id, project_id, code, name) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000c01', 'QA', 'QA'),
  ('00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-00000000aaaa', null, 'OPS', 'Ops'),
  ('00000000-0000-0000-0000-000000000d03', '00000000-0000-0000-0000-00000000bbbb', null, 'OPS', 'Ops');

-- 브리프 핵심 ---------------------------------------------------------------------
-- 계정 없는 인물에게 권한 → 23514
do $$ begin
  insert into public.project_members (project_id, person_id, access_role) values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000b02', 'member');
  raise exception 'expected PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT';
exception when check_violation then
  if sqlerrm <> 'PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT' then raise; end if;
end $$;
-- RPC 로 관리자 등록(호출자 = 워크스페이스 관리자)
select public.upsert_project_member('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000c01',
  '{"id":"00000000-0000-0000-0000-000000000b01"}'::jsonb, '{"access_role":"admin"}'::jsonb, null) is not null as admin_registered;
-- 외부 인력은 권한 없이 명단만
select public.upsert_project_member('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000c01',
  '{"id":"00000000-0000-0000-0000-000000000b02"}'::jsonb, '{"access_role":null,"role_label":"외주 QA"}'::jsonb, null) is not null as external_registered;
select count(*) = 2 as roster_ok from public.project_members where project_id = '00000000-0000-0000-0000-000000000c01';
-- 회의록 정책이 app_role() 로 여전히 평가되는지(함수 호출 자체가 성공)
select public.app_role() is null as app_role_callable;

-- 추가 확인 -----------------------------------------------------------------------
-- app_role() 가 새 표 위에서 반환 문자열을 유지한다(alice = 명단 admin → 'pmo_admin')
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true) is not null as claims_alice;
select public.app_role() = 'pmo_admin' as app_role_admin,
       public.is_project_admin('00000000-0000-0000-0000-000000000c01') as alice_project_admin,
       public.is_superuser() = false as alice_not_superuser,
       (select count(*) from public.my_workspace_ids()) = 1 as alice_one_workspace,
       (select count(*) from public.accessible_project_ids()) = 2 as alice_ws_projects;
select set_config('request.jwt.claims', '', true) = '' as claims_cleared;

-- 워크스페이스가 다른 인물은 명단에 못 들어간다
do $$ begin
  insert into public.project_members (project_id, person_id) values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000b05');
  raise exception 'expected PROJECT_MEMBER_CROSS_WORKSPACE';
exception when check_violation then
  if sqlerrm <> 'PROJECT_MEMBER_CROSS_WORKSPACE' then raise; end if;
end $$;

-- carol 을 프로젝트 관리자로(워크스페이스 관리자 alice 가), 팀 2개(첫 원소가 대표)
select public.upsert_project_member('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000c01',
  '{"id":"00000000-0000-0000-0000-000000000b03"}'::jsonb, '{"access_role":"admin"}'::jsonb,
  array['00000000-0000-0000-0000-000000000d01','00000000-0000-0000-0000-000000000d02']::uuid[]) is not null as carol_admin;
select count(*) = 2 and count(*) filter (where is_primary and team_id = '00000000-0000-0000-0000-000000000d01') = 1 as carol_teams_ok
  from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
 where pm.person_id = '00000000-0000-0000-0000-000000000b03';
-- 팀 순서를 바꾸면 첫 원소만 대표 — 대표 아니던 기존 행(d02)이 대표가 되고 d01 은 대표에서 내려간다
select public.upsert_project_member('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000c01',
  '{"id":"00000000-0000-0000-0000-000000000b03"}'::jsonb, '{}'::jsonb,
  array['00000000-0000-0000-0000-000000000d02','00000000-0000-0000-0000-000000000d01']::uuid[]) is not null as carol_teams_reordered;
select count(*) = 2 and count(*) filter (where is_primary) = 1
       and count(*) filter (where is_primary and team_id = '00000000-0000-0000-0000-000000000d02') = 1 as carol_primary_is_first
  from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
 where pm.person_id = '00000000-0000-0000-0000-000000000b03';

-- 프로젝트 관리자(carol)는 member 는 줄 수 있고 admin 은 못 준다
select public.upsert_project_member('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000c01',
  '{"id":"00000000-0000-0000-0000-000000000b04"}'::jsonb, '{"access_role":"member","title":"엔지니어"}'::jsonb,
  array['00000000-0000-0000-0000-000000000d02']::uuid[]) is not null as dave_member_by_project_admin;
do $$ begin
  perform public.upsert_project_member('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000c01',
    '{"id":"00000000-0000-0000-0000-000000000b04"}'::jsonb, '{"access_role":"admin"}'::jsonb, null);
  raise exception 'expected PROJECT_MEMBER_ADMIN_SLOT';
exception when insufficient_privilege then
  if sqlerrm <> 'PROJECT_MEMBER_ADMIN_SLOT' then raise; end if;
end $$;
-- member(dave)는 명단을 못 쓴다
do $$ begin
  perform public.upsert_project_member('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000c01',
    '{"display_name":"gina","email":"gina@example.com"}'::jsonb, '{}'::jsonb, null);
  raise exception 'expected PROJECT_MEMBER_FORBIDDEN';
exception when insufficient_privilege then
  if sqlerrm <> 'PROJECT_MEMBER_FORBIDDEN' then raise; end if;
end $$;
-- 새 인물은 (workspace, email) 로 만들어지고 두 번째 호출은 같은 인물을 쓴다
select public.upsert_project_member('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000c01',
  '{"display_name":"gina","email":"Gina@Example.com "}'::jsonb, '{"role_label":"외주"}'::jsonb, null)
     = public.upsert_project_member('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000c01',
  '{"display_name":"gina","email":"gina@example.com"}'::jsonb, '{}'::jsonb, null) as person_matched_by_email;
-- 다른 워크스페이스 팀은 붙일 수 없다
do $$ begin
  perform public.upsert_project_member('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000c01',
    '{"id":"00000000-0000-0000-0000-000000000b04"}'::jsonb, '{}'::jsonb, array['00000000-0000-0000-0000-000000000d03']::uuid[]);
  raise exception 'expected PROJECT_MEMBER_TEAM_SCOPE';
exception when check_violation then
  if sqlerrm <> 'PROJECT_MEMBER_TEAM_SCOPE' then raise; end if;
end $$;

-- 프로젝트 관리자(carol)는 RPC 로 본인 권한을 내릴 수 없다(SELF_DEMOTE 가 ADMIN_SLOT 보다 먼저)
do $$ begin
  perform public.upsert_project_member('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000c01',
    '{"id":"00000000-0000-0000-0000-000000000b03"}'::jsonb, '{"access_role":"member"}'::jsonb, null);
  raise exception 'expected PROJECT_MEMBER_SELF_DEMOTE';
exception when insufficient_privilege then
  if sqlerrm <> 'PROJECT_MEMBER_SELF_DEMOTE' then raise; end if;
end $$;
-- dave 를 P2 에도 member 로(다른 프로젝트의 명단 행 — 아래 복합 FK 거부 케이스용)
select public.upsert_project_member('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000c02',
  '{"id":"00000000-0000-0000-0000-000000000b04"}'::jsonb, '{"access_role":"member"}'::jsonb, null) is not null as dave_on_p2;

-- 세션 경로: 프로젝트 관리자(carol)가 UPDATE 로 member→admin 승격 → RLS with check 가 거부
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a02","role":"authenticated"}', true) is not null as claims_carol;
do $$ begin
  update public.project_members set access_role = 'admin'
   where person_id = '00000000-0000-0000-0000-000000000b04';
  raise exception 'expected RLS rejection';
exception when insufficient_privilege then
  -- 트리거가 낸 42501(PROJECT_MEMBER_*)이 아니라 정책의 with check 가 거부했는지까지 본다
  if sqlerrm not like 'new row violates row-level security policy%' then raise; end if;
end $$;
-- 프로젝트를 다른 워크스페이스로 옮길 수 없다(admin_update_projects 는 행 전체를 연다 → projects_guard)
do $$ begin
  update public.projects set workspace_id = '00000000-0000-0000-0000-00000000bbbb'
   where id = '00000000-0000-0000-0000-000000000c01';
  raise exception 'expected PROJECT_WORKSPACE_IMMUTABLE';
exception when check_violation then
  if sqlerrm <> 'PROJECT_WORKSPACE_IMMUTABLE' then raise; end if;
end $$;
-- people 컬럼 권한: 세션은 user_id·active·workspace_id 를 쓸 수 없다(연결·비활성화는 service_role 만)
do $$ begin
  update public.people set user_id = '00000000-0000-0000-0000-000000000a06' where id = '00000000-0000-0000-0000-000000000b04';
  raise exception 'expected column privilege rejection (update user_id)';
exception when insufficient_privilege then
  if sqlerrm not like 'permission denied for table people%' then raise; end if;
end $$;
do $$ begin
  update public.people set active = false where id = '00000000-0000-0000-0000-000000000b04';
  raise exception 'expected column privilege rejection (update active)';
exception when insufficient_privilege then
  if sqlerrm not like 'permission denied for table people%' then raise; end if;
end $$;
do $$ begin
  update public.people set workspace_id = '00000000-0000-0000-0000-00000000bbbb' where id = '00000000-0000-0000-0000-000000000b04';
  raise exception 'expected column privilege rejection (update workspace_id)';
exception when insufficient_privilege then
  if sqlerrm not like 'permission denied for table people%' then raise; end if;
end $$;
do $$ begin
  insert into public.people (workspace_id, display_name, user_id)
  values ('00000000-0000-0000-0000-00000000aaaa', 'mallory', '00000000-0000-0000-0000-000000000a06');
  raise exception 'expected column privilege rejection (insert user_id)';
exception when insufficient_privilege then
  if sqlerrm not like 'permission denied for table people%' then raise; end if;
end $$;
-- 개명과 외부 인력 추가는 그대로 된다
with u as (update public.people set display_name = 'dave k' where id = '00000000-0000-0000-0000-000000000b04' returning 1)
select count(*) = 1 as project_admin_renames_person from u;
with i as (insert into public.people (workspace_id, display_name, email)
           values ('00000000-0000-0000-0000-00000000aaaa', 'ivan', 'ivan@example.com') returning 1)
select count(*) = 1 as project_admin_adds_external_person from i;
-- RPC 두 개는 service_role 전용 — 세션은 실행 권한이 없다
do $$ begin
  perform public.upsert_project_member('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000c01',
    '{"id":"00000000-0000-0000-0000-000000000b04"}'::jsonb, '{}'::jsonb, null);
  raise exception 'expected execute denial (upsert_project_member)';
exception when insufficient_privilege then
  if sqlerrm not like 'permission denied for function upsert_project_member%' then raise; end if;
end $$;
do $$ begin
  perform public.consume_project_invite('h-none', 'carol@example.com', '00000000-0000-0000-0000-000000000a02');
  raise exception 'expected execute denial (consume_project_invite)';
exception when insufficient_privilege then
  if sqlerrm not like 'permission denied for function consume_project_invite%' then raise; end if;
end $$;
-- 같은 세션에서 member 행의 표시 필드는 고칠 수 있다
with u as (update public.project_members set role_label = '개발'
            where person_id = '00000000-0000-0000-0000-000000000b04' returning 1)
select count(*) = 1 as project_admin_edits_member_row from u;
-- 본인 admin 행은 admin_write_member_rows 의 using 에 걸려 보이지 않는다 — 오류가 아니라 0행(세션 경로의 본인 강등)
with u as (update public.project_members set access_role = null
            where person_id = '00000000-0000-0000-0000-000000000b03' returning 1)
select count(*) = 0 as session_self_demote_filtered from u;
-- my_team_ids·can_attach 경로가 새 표 위에서 평가된다(dave 가 아니라 carol 기준: 팀 2개)
select (select count(*) from public.my_team_ids('00000000-0000-0000-0000-000000000c01')) = 2 as my_team_ids_ok;
reset role;
select set_config('request.jwt.claims', '', true) = '' as claims_cleared2;

-- 세션 경로: 워크스페이스 관리자(명단 행 없음) grace 의 app_role() 은 'pmo_admin' — 앱 isAnyProjectAdmin 과 동형(Task 3c).
-- 회의록 폴더 정책(0000): insert 는 created_by = auth.uid() and app_role() is not null, 남의 폴더 update·delete 는
-- created_by = auth.uid() or app_role() = 'pmo_admin'.
insert into public.minute_folders (id, name, created_by)
values ('00000000-0000-0000-0000-000000000f11', '팀 회의', '00000000-0000-0000-0000-000000000a02');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a06","role":"authenticated"}', true) is not null as claims_grace;
select public.app_role() = 'pmo_admin' as wsadmin_app_role_pmo_admin,
       not exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                    where pe.user_id = auth.uid()) as wsadmin_has_no_roster_row;
with i as (insert into public.minute_folders (id, name, created_by)
           values ('00000000-0000-0000-0000-000000000f12', '운영 회의', '00000000-0000-0000-0000-000000000a06') returning 1)
select count(*) = 1 as wsadmin_inserts_root_folder from i;
with u as (update public.minute_folders set name = '팀 회의(정리)' where id = '00000000-0000-0000-0000-000000000f11' returning 1)
select count(*) = 1 as wsadmin_updates_others_folder from u;
with d as (delete from public.minute_folders where id = '00000000-0000-0000-0000-000000000f11' returning 1)
select count(*) = 1 as wsadmin_deletes_others_folder from d;
-- 대조: 명단 member(dave)는 'team_editor' — 남의 폴더는 지울 수 없다(정책 using 에 걸려 0행)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a03","role":"authenticated"}', true) is not null as claims_dave;
select public.app_role() = 'team_editor' as member_app_role_team_editor;
with d as (delete from public.minute_folders where id = '00000000-0000-0000-0000-000000000f12' returning 1)
select count(*) = 0 as member_cannot_delete_others_folder from d;
reset role;
select set_config('request.jwt.claims', '', true) = '' as claims_cleared3;

-- create_issue_from_minute_block(텍스트 무변경)이 새 명단 위에서 돈다 — 담당자 검증(project_members(id, project_id))과
-- issue_assignees 복합 FK. 다른 프로젝트의 명단 행을 담당자로 넘기면 ISSUE_ASSIGNEE_PROJECT_MISMATCH.
insert into public.issue_mega_areas (code, name, sort_order) values ('01', 'Mega', 1);
insert into public.minutes (id, minute_date, team_code, title, project_id)
values ('00000000-0000-0000-0000-000000000e01', current_date, 'OPS', '주간 회의', '00000000-0000-0000-0000-000000000c01');
insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code, project_id)
values ('00000000-0000-0000-0000-000000000e02', '00000000-0000-0000-0000-000000000e01', 1, '본문', 'h1', '주간 회의', current_date, 'OPS',
        '00000000-0000-0000-0000-000000000c01');
select count(*) = 1 as issue_from_minute_ok
  from public.create_issue_from_minute_block(
    '00000000-0000-0000-0000-000000000c01', '회의 이슈', '본문', 'medium',
    array(select pm.id from public.project_members pm
           where pm.project_id = '00000000-0000-0000-0000-000000000c01'
             and pm.person_id in ('00000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-000000000b04')),
    null, null, '01', '대공정', '세부 공정', '운영', '{}'::text[], 'minutes', '회의록',
    '00000000-0000-0000-0000-000000000a01', 'alice', '00000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000e02',
    'h1', 0, 'bh', '발췌', 'manual', null);
select count(*) = 2 as issue_assignees_ok
  from public.issue_assignees ia join public.issues i on i.id = ia.issue_id
 where i.project_id = '00000000-0000-0000-0000-000000000c01';
do $$ begin
  perform public.create_issue_from_minute_block(
    '00000000-0000-0000-0000-000000000c01', '회의 이슈 2', '본문', 'medium',
    array(select pm.id from public.project_members pm
           where pm.project_id = '00000000-0000-0000-0000-000000000c02'
             and pm.person_id = '00000000-0000-0000-0000-000000000b04'),
    null, null, '01', '대공정', '세부 공정', '운영', '{}'::text[], 'minutes', '회의록',
    '00000000-0000-0000-0000-000000000a01', 'alice', '00000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000e02',
    'h1', 1, 'bh2', '발췌', 'manual', null);
  raise exception 'expected ISSUE_ASSIGNEE_PROJECT_MISMATCH';
exception when invalid_parameter_value then
  if sqlerrm <> 'ISSUE_ASSIGNEE_PROJECT_MISMATCH' then raise; end if;
end $$;

-- 담당자 FK 승격: meeting_attendees 는 (meeting_id, project_id)·(member_id, project_id) 복합 FK 둘 다 건다
insert into public.meetings (id, project_id, title, meeting_date)
values ('00000000-0000-0000-0000-000000000f01', '00000000-0000-0000-0000-000000000c01', '정기 회의', current_date);
with i as (
  insert into public.meeting_attendees (meeting_id, member_id, project_id)
  select '00000000-0000-0000-0000-000000000f01', pm.id, pm.project_id from public.project_members pm
   where pm.project_id = '00000000-0000-0000-0000-000000000c01' and pm.person_id = '00000000-0000-0000-0000-000000000b02'
  returning 1)
select count(*) = 1 as external_attendee_ok from i;
do $$ begin   -- P2 의 명단 행을 P1 회의 참석자로
  insert into public.meeting_attendees (meeting_id, member_id, project_id)
  select '00000000-0000-0000-0000-000000000f01', pm.id, '00000000-0000-0000-0000-000000000c01' from public.project_members pm
   where pm.project_id = '00000000-0000-0000-0000-000000000c02' and pm.person_id = '00000000-0000-0000-0000-000000000b04';
  raise exception 'expected meeting_attendees_member_project_fk';
exception when foreign_key_violation then
  if sqlerrm not like '%meeting_attendees_member_project_fk%' then raise; end if;
end $$;
do $$ begin   -- 회의와 다른 project_id
  insert into public.meeting_attendees (meeting_id, member_id, project_id)
  select '00000000-0000-0000-0000-000000000f01', pm.id, pm.project_id from public.project_members pm
   where pm.project_id = '00000000-0000-0000-0000-000000000c02' and pm.person_id = '00000000-0000-0000-0000-000000000b04';
  raise exception 'expected meeting_attendees_meeting_project_fk';
exception when foreign_key_violation then
  if sqlerrm not like '%meeting_attendees_meeting_project_fk%' then raise; end if;
end $$;
-- notification_recipients: member_id 가 있으면 project_id 도 있어야 한다(MATCH SIMPLE 의 null 우회를 CHECK 로 막음)
insert into public.notification_events (id, type, category, project_id)
values ('00000000-0000-0000-0000-000000001e01', 'test', 'system', '00000000-0000-0000-0000-000000000c01');
do $$ begin
  insert into public.notification_recipients (event_id, user_id, member_id)
  select '00000000-0000-0000-0000-000000001e01', '00000000-0000-0000-0000-000000000a02', pm.id from public.project_members pm
   where pm.project_id = '00000000-0000-0000-0000-000000000c01' and pm.person_id = '00000000-0000-0000-0000-000000000b03';
  raise exception 'expected notification_recipients_member_needs_project';
exception when check_violation then
  if sqlerrm not like '%notification_recipients_member_needs_project%' then raise; end if;
end $$;
with i as (
  insert into public.notification_recipients (event_id, user_id, member_id, project_id)
  select '00000000-0000-0000-0000-000000001e01', '00000000-0000-0000-0000-000000000a02', pm.id, pm.project_id from public.project_members pm
   where pm.project_id = '00000000-0000-0000-0000-000000000c01' and pm.person_id = '00000000-0000-0000-0000-000000000b03'
  returning 1)
select count(*) = 1 as recipient_with_project_ok from i;

-- 초대: admin 초대는 발급자가 워크스페이스 관리자여야 한다
do $$ begin
  insert into public.project_invites (workspace_id, project_id, email, access_role, token_hash, created_by, expires_at)
  values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000c01', 'erin@example.com', 'admin',
          'h-admin', '00000000-0000-0000-0000-000000000a02', now() + interval '1 day');
  raise exception 'expected PROJECT_INVITE_ADMIN_FORBIDDEN';
exception when insufficient_privilege then
  if sqlerrm <> 'PROJECT_INVITE_ADMIN_FORBIDDEN' then raise; end if;
end $$;
-- 초대 수락: 소비 → profiles → people → workspace_members → project_members → project_member_teams.
-- erin 의 프로필 표시 이름에 앞뒤 공백이 있어도(profiles 는 허용, people 은 거부) 수락되고 정리된 이름이 쓰인다.
insert into public.profiles (user_id, email, display_name)
values ('00000000-0000-0000-0000-000000000a04', 'erin@example.com', ' Erin Kim ');
insert into public.project_invites (workspace_id, project_id, email, access_role, role_label, team_ids, token_hash, created_by, expires_at)
values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000c01', 'erin@example.com', 'member', '분석',
        array['00000000-0000-0000-0000-000000000d01']::uuid[], 'h-erin', '00000000-0000-0000-0000-000000000a02', now() + interval '1 day');
select workspace_id = '00000000-0000-0000-0000-00000000aaaa' and project_id = '00000000-0000-0000-0000-000000000c01'
       and member_id is not null as invite_consumed
  from public.consume_project_invite('h-erin', ' Erin@example.com', '00000000-0000-0000-0000-000000000a04');
select (select count(*) from public.consume_project_invite('h-erin', 'erin@example.com', '00000000-0000-0000-0000-000000000a04')) = 0 as invite_single_use,
       exists (select 1 from public.profiles where user_id = '00000000-0000-0000-0000-000000000a04' and display_name = 'Erin Kim') as invite_profile_trimmed,
       exists (select 1 from public.people where user_id = '00000000-0000-0000-0000-000000000a04' and display_name = 'Erin Kim') as invite_person_name_trimmed,
       exists (select 1 from public.workspace_members where user_id = '00000000-0000-0000-0000-000000000a04' and role = 'member') as invite_ws_member,
       exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                 join public.project_member_teams pmt on pmt.member_id = pm.id
                where pe.user_id = '00000000-0000-0000-0000-000000000a04' and pm.access_role = 'member'
                  and pm.role_label = '분석' and pmt.is_primary) as invite_roster;

-- 초대의 첫 팀이 이미 대표 아닌 행으로 있고 대표가 없으면, 수락이 그 행을 대표로 올린다(gina: 외부 인력으로 명단에 있다가 초대 수락)
insert into public.project_member_teams (member_id, team_id, is_primary)
select pm.id, '00000000-0000-0000-0000-000000000d01', false
  from public.project_members pm join public.people pe on pe.id = pm.person_id
 where pm.project_id = '00000000-0000-0000-0000-000000000c01' and pe.email = 'gina@example.com';
insert into public.project_invites (workspace_id, project_id, email, access_role, team_ids, token_hash, created_by, expires_at)
values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000c01', 'gina@example.com', 'member',
        array['00000000-0000-0000-0000-000000000d01','00000000-0000-0000-0000-000000000d02']::uuid[], 'h-gina',
        '00000000-0000-0000-0000-000000000a02', now() + interval '1 day');
select count(*) = 1 as gina_invite_consumed
  from public.consume_project_invite('h-gina', 'gina@example.com', '00000000-0000-0000-0000-000000000a07');
select count(*) = 2 and count(*) filter (where pmt.is_primary) = 1
       and count(*) filter (where pmt.is_primary and pmt.team_id = '00000000-0000-0000-0000-000000000d01') = 1
       and bool_and(pe.user_id = '00000000-0000-0000-0000-000000000a07') as invite_primary_on_existing_team
  from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
  join public.people pe on pe.id = pm.person_id
 where pm.project_id = '00000000-0000-0000-0000-000000000c01' and pe.email = 'gina@example.com';

-- admin 초대 발급자의 계정을 지워도(created_by 의 RI set null) project_invites_guard 가 막지 않는다
insert into public.project_invites (workspace_id, project_id, email, access_role, token_hash, created_by, expires_at)
values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000c01', 'henry@example.com', 'admin',
        'h-henry', '00000000-0000-0000-0000-000000000a06', now() + interval '1 day');
with d as (delete from auth.users where id = '00000000-0000-0000-0000-000000000a06' returning 1)
select count(*) = 1 as admin_issuer_account_deleted from d;
select created_by is null as admin_invite_issuer_nulled from public.project_invites where token_hash = 'h-henry';

-- 계정 연결을 끊으면 권한이 내려가고 명단 행은 남는다
update public.people set user_id = null where user_id = '00000000-0000-0000-0000-000000000a04';
select exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                where pe.email = 'erin@example.com' and pm.access_role is null) as unlink_revokes_access;

-- 마지막 워크스페이스 관리자는 지울 수 없다
do $$ begin
  delete from public.workspace_members where user_id = '00000000-0000-0000-0000-000000000a01';
  raise exception 'expected WORKSPACE_LAST_ADMIN';
exception when check_violation then
  if sqlerrm <> 'WORKSPACE_LAST_ADMIN' then raise; end if;
end $$;
-- 워크스페이스 삭제의 cascade 는 막지 않는다(다른 워크스페이스 — 프로젝트가 없어 restrict 에 걸리지 않음)
with d as (delete from public.workspaces where id = '00000000-0000-0000-0000-00000000bbbb' returning 1)
select count(*) = 1 as ws_delete_cascades from d;

-- 팀 code 불변
do $$ begin
  update public.teams set code = 'QA2' where id = '00000000-0000-0000-0000-000000000d01';
  raise exception 'expected TEAM_CODE_IMMUTABLE';
exception when check_violation then
  if sqlerrm <> 'TEAM_CODE_IMMUTABLE' then raise; end if;
end $$;

-- 폐기 표·함수가 없다
select to_regclass('public.memberships') is null and to_regclass('public.project_roles') is null
       and to_regclass('public.project_member_identities') is null
       and to_regprocedure('public.current_team()') is null as legacy_dropped;

rollback;
