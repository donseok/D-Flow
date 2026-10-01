-- 0013_account_preferences 이행 리허설 — 0012 스키마 위에 계정 키·lastProjectId·두 소속을 가진 사용자 셋을 **커밋**한다.
--   lane-b-run.sh supabase db reset --version 0012 --local
--   lane-b-run.sh bash -c "docker exec -i supabase_db_d-flow-lane-b psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0013_account_preferences_seed.sql"
--   lane-b-run.sh supabase migration up --local
--   lane-b-run.sh bash -c "docker exec -i supabase_db_d-flow-lane-b psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0013_account_preferences_smoke.sql"
-- 사용자 셋(uuid …7e57-0000000016a1..a3): u1 = A 먼저·B 나중(A 행에 계정 키, B 행에 다른 테마 — A 가 이긴다, lastProjectId = B 프로젝트),
--   u2 = B 만(lastProjectId = 없는 프로젝트 → 버림, heroCollapsed), u3 = A 에서 탈퇴(B 만 남음, A 행에 lastProjectId = A 프로젝트 → 버림).
-- 번호는 개발 번호다(정방향 파일 머리 참고).
begin;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at) values
  ('00000000-0000-0000-7e57-0000000016a1', 'rehearsal-u1@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('00000000-0000-0000-7e57-0000000016a2', 'rehearsal-u2@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('00000000-0000-0000-7e57-0000000016a3', 'rehearsal-u3@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.workspaces (id, slug, name) values
  ('00000000-0000-0000-7e57-0000000016b1', 'reh-a', 'Rehearsal A'),
  ('00000000-0000-0000-7e57-0000000016b2', 'reh-b', 'Rehearsal B');
insert into public.workspace_members (workspace_id, user_id, role, created_at) values
  ('00000000-0000-0000-7e57-0000000016b1', '00000000-0000-0000-7e57-0000000016a1', 'member', '2026-01-01T00:00:00Z'),
  ('00000000-0000-0000-7e57-0000000016b2', '00000000-0000-0000-7e57-0000000016a1', 'member', '2026-02-01T00:00:00Z'),
  ('00000000-0000-0000-7e57-0000000016b2', '00000000-0000-0000-7e57-0000000016a2', 'admin',  '2026-01-15T00:00:00Z'),
  ('00000000-0000-0000-7e57-0000000016b2', '00000000-0000-0000-7e57-0000000016a3', 'member', '2026-03-01T00:00:00Z');
insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-7e57-0000000016c1', 'Rehearsal A1', '00000000-0000-0000-7e57-0000000016b1'),
  ('00000000-0000-0000-7e57-0000000016c2', 'Rehearsal B1', '00000000-0000-0000-7e57-0000000016b2');
insert into public.user_preferences (user_id, workspace_id, prefs, updated_at) values
  ('00000000-0000-0000-7e57-0000000016a1', '00000000-0000-0000-7e57-0000000016b1',
   '{"theme":"dark","locale":"en","sidebarCollapsed":true,"notif":{"x":false},"notifRead":{"p":["n1"]},"heroCollapsed":true}', '2026-09-01T00:00:00Z'),
  ('00000000-0000-0000-7e57-0000000016a1', '00000000-0000-0000-7e57-0000000016b2',
   '{"theme":"light","lastProjectId":"00000000-0000-0000-7e57-0000000016c2"}', '2026-09-02T00:00:00Z'),
  ('00000000-0000-0000-7e57-0000000016a2', '00000000-0000-0000-7e57-0000000016b2',
   '{"wbsGanttScale":24,"lastProjectId":"00000000-0000-0000-7e57-0000000016ff","heroCollapsed":false}', '2026-09-03T00:00:00Z'),
  ('00000000-0000-0000-7e57-0000000016a3', '00000000-0000-0000-7e57-0000000016b1',
   '{"theme":"dark","lastProjectId":"00000000-0000-0000-7e57-0000000016c1"}', '2026-09-04T00:00:00Z');
commit;
