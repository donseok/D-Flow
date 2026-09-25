-- tests/rls 픽스처 — harness.ts 의 loadFixture 가 postgres 롤로 한 트랜잭션에 흘린다(RLS·실행 권한 우회).
-- 멱등: 전부 고정 uuid + on conflict do nothing. 케이스는 asUser/asService 의 begin…rollback 안에서만 쓰므로
-- 이 행들은 바뀌지 않고 DB 에 남는다(개발 DB 의 부트스트랩 행과 공존 — 워크스페이스 slug·이메일이 겹치지 않게 rls- 접두).
-- 이메일에 rls- 접두를 붙인 이유: auth.users.email 과 profiles.email 은 전역 유일이고, supabase/rehearsal/0003_smoke.sql 이
-- alice@example.com 등을 자기 id 로 넣는다 — 같은 이메일을 여기 남기면 그 스모크가 이 DB 에서 유일 위반으로 멈춘다.
-- uuid 는 16진수만, 넷째 묶음 7e57 로 픽스처임을 표시한다:
--   워크스페이스 …aa0N · 계정 …a0N · 인물 …b0N · 프로젝트 …c0N · 팀 …d0N · 명단 행 …e0N · WBS 리프 …f0N
-- 이 id 들은 harness.ts 의 F 와 짝이다 — 한쪽을 바꾸면 다른 쪽도 바꾼다.

-- 워크스페이스: 본(rls-acme) + 케이스 ⑨ 의 이동 대상(rls-other)
insert into public.workspaces (id, slug, name) values
  ('00000000-0000-0000-7e57-00000000aa01', 'rls-acme', 'Acme RLS'),
  ('00000000-0000-0000-7e57-00000000aa02', 'rls-other', 'Other RLS')
on conflict do nothing;

-- 계정 3: 플랫폼 관리자 · 워크스페이스 관리자 · alice(프로젝트 A 관리자, B 멤버). 열 목록은 0003_smoke.sql 과 같다.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
select v.id, v.email, '', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated',
       '00000000-0000-0000-0000-000000000000', now(), now()
  from (values
    ('00000000-0000-0000-7e57-0000000000a1'::uuid, 'rls-platform@example.com'),
    ('00000000-0000-0000-7e57-0000000000a2'::uuid, 'rls-wsadmin@example.com'),
    ('00000000-0000-0000-7e57-0000000000a3'::uuid, 'rls-alice@example.com')) as v(id, email)
on conflict do nothing;

insert into public.profiles (user_id, email, display_name) values
  ('00000000-0000-0000-7e57-0000000000a1', 'rls-platform@example.com', 'platform'),
  ('00000000-0000-0000-7e57-0000000000a2', 'rls-wsadmin@example.com', 'wsadmin'),
  ('00000000-0000-0000-7e57-0000000000a3', 'rls-alice@example.com', 'alice')
on conflict do nothing;

insert into public.platform_admins (user_id) values
  ('00000000-0000-0000-7e57-0000000000a1')
on conflict do nothing;

-- 워크스페이스 관리자는 이 워크스페이스의 유일한 admin 이다(케이스 ⑥ 의 전제)
insert into public.workspace_members (workspace_id, user_id, role) values
  ('00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000a2', 'admin'),
  ('00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000a3', 'member')
on conflict do nothing;

-- 인물 4: 계정 3 + 외부 인력 bob(user_id 없음)
insert into public.people (id, workspace_id, display_name, email, user_id) values
  ('00000000-0000-0000-7e57-0000000000b1', '00000000-0000-0000-7e57-00000000aa01', 'platform', 'rls-platform@example.com', '00000000-0000-0000-7e57-0000000000a1'),
  ('00000000-0000-0000-7e57-0000000000b2', '00000000-0000-0000-7e57-00000000aa01', 'wsadmin', 'rls-wsadmin@example.com', '00000000-0000-0000-7e57-0000000000a2'),
  ('00000000-0000-0000-7e57-0000000000b3', '00000000-0000-0000-7e57-00000000aa01', 'alice', 'rls-alice@example.com', '00000000-0000-0000-7e57-0000000000a3'),
  ('00000000-0000-0000-7e57-0000000000b4', '00000000-0000-0000-7e57-00000000aa01', 'bob', null, null)
on conflict do nothing;

insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-7e57-0000000000c1', 'RLS A', '00000000-0000-0000-7e57-00000000aa01'),
  ('00000000-0000-0000-7e57-0000000000c2', 'RLS B', '00000000-0000-0000-7e57-00000000aa01')
on conflict do nothing;

insert into public.project_settings (project_id, level_labels) values
  ('00000000-0000-0000-7e57-0000000000c1', array['Phase','Task','Activity']),
  ('00000000-0000-0000-7e57-0000000000c2', array['Phase','Task','Activity'])
on conflict do nothing;

-- 팀: ERP·MES 는 A 전용, QA·QA2 는 B 전용
insert into public.teams (id, workspace_id, project_id, code, name) values
  ('00000000-0000-0000-7e57-0000000000d1', '00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000c1', 'ERP', 'ERP'),
  ('00000000-0000-0000-7e57-0000000000d2', '00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000c1', 'MES', 'MES'),
  ('00000000-0000-0000-7e57-0000000000d3', '00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000c2', 'QA', 'QA'),
  ('00000000-0000-0000-7e57-0000000000d4', '00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000c2', 'QA2', 'QA2')
on conflict do nothing;

-- 명단: alice@A admin, alice@B member, bob@A 권한 없음(외부 인력)
insert into public.project_members (id, project_id, person_id, access_role) values
  ('00000000-0000-0000-7e57-0000000000e1', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-0000000000b3', 'admin'),
  ('00000000-0000-0000-7e57-0000000000e2', '00000000-0000-0000-7e57-0000000000c2', '00000000-0000-0000-7e57-0000000000b3', 'member'),
  ('00000000-0000-0000-7e57-0000000000e3', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-0000000000b4', null)
on conflict do nothing;

-- alice 의 팀: A 에서 ERP(대표)·MES, B 에서 QA(대표)
insert into public.project_member_teams (member_id, team_id, is_primary) values
  ('00000000-0000-0000-7e57-0000000000e1', '00000000-0000-0000-7e57-0000000000d1', true),
  ('00000000-0000-0000-7e57-0000000000e1', '00000000-0000-0000-7e57-0000000000d2', false),
  ('00000000-0000-0000-7e57-0000000000e2', '00000000-0000-0000-7e57-0000000000d3', true)
on conflict do nothing;

-- WBS 리프(자식 없음 — wbs_is_leaf): A 의 ERP 리프, B 의 QA2 리프(alice 의 팀 아님), B 의 QA 리프(alice 의 팀)
insert into public.wbs_items (id, project_id, code, name) values
  ('00000000-0000-0000-7e57-0000000000f1', '00000000-0000-0000-7e57-0000000000c1', '1', 'ERP 리프'),
  ('00000000-0000-0000-7e57-0000000000f2', '00000000-0000-0000-7e57-0000000000c2', '1', 'QA2 리프'),
  ('00000000-0000-0000-7e57-0000000000f3', '00000000-0000-0000-7e57-0000000000c2', '2', 'QA 리프')
on conflict do nothing;

insert into public.item_owners (wbs_item_id, team_id, kind) values
  ('00000000-0000-0000-7e57-0000000000f1', '00000000-0000-0000-7e57-0000000000d1', 'primary'),
  ('00000000-0000-0000-7e57-0000000000f2', '00000000-0000-0000-7e57-0000000000d4', 'primary'),
  ('00000000-0000-0000-7e57-0000000000f3', '00000000-0000-0000-7e57-0000000000d3', 'primary')
on conflict do nothing;
