-- 0006 백필 리허설(D3) — 정상 경우. 0005 스키마 위에 흘리고 **커밋**한다(이어지는 migration up 이 이 행을 백필해야 한다).
--   supabase db reset --version 0005
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0006_backfill_ok.sql
--   supabase migration up --local
--   → 프로젝트 없는 회의록·루트 폴더·자식 폴더·선호값이 u1 의 유일한 워크스페이스(smk-a)로 채워진다.
-- 워크스페이스가 둘이라 "전체 워크스페이스가 1개면 그것" 대체 경로가 아니라 "작성자의 유일한 소속" 경로를 탄다.
-- uuid 넷째 묶음 0b0f. 쌍둥이: 0006_backfill_ambiguous.sql(같은 구조, u1 이 두 워크스페이스 모두의 멤버).
begin;
insert into public.workspaces (id, slug, name) values
  ('00000000-0000-0000-0b0f-00000000aa01', 'smk-a', 'Smoke A'),
  ('00000000-0000-0000-0b0f-00000000aa02', 'smk-b', 'Smoke B');
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
values ('00000000-0000-0000-0b0f-000000000a01', 'smk-u1@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}',
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.profiles (user_id, email, display_name) values ('00000000-0000-0000-0b0f-000000000a01', 'smk-u1@example.com', 'u1');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('00000000-0000-0000-0b0f-00000000aa01', '00000000-0000-0000-0b0f-000000000a01', 'admin');
insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by) values
  ('00000000-0000-0000-0b0f-000000001101', null, '2026-09-01', 'SMK', 'M', '#', '00000000-0000-0000-0b0f-000000000a01');
insert into public.minute_folders (id, project_id, parent_id, name, created_by) values
  ('00000000-0000-0000-0b0f-000000001201', null, null, 'SMK', '00000000-0000-0000-0b0f-000000000a01'),
  ('00000000-0000-0000-0b0f-000000001202', null, '00000000-0000-0000-0b0f-000000001201', 'child', '00000000-0000-0000-0b0f-000000000a01');
insert into public.user_preferences (user_id, prefs) values ('00000000-0000-0000-0b0f-000000000a01', '{}');
commit;
