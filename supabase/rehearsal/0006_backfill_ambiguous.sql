-- 0006 백필 리허설(D3) — 모호한 경우. 0005 스키마 위에 흘리고 **커밋**한다(이어지는 migration up 이 이 행에서 멈춰야 한다).
--   supabase db reset --version 0005
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0006_backfill_ambiguous.sql
--   supabase migration up --local
--   → SP2_0006_BACKFILL_AMBIGUOUS 로 멈춘다(u1 의 소속 2개, 전체 워크스페이스 2개 — 추정하지 않는다).
-- migration up 은 실패하고 0006 은 적용되지 않는다(CLI 가 파일 단위 트랜잭션으로 되돌린다).
-- uuid 넷째 묶음 0b0f. 쌍둥이: 0006_backfill_ok.sql(같은 구조, u1 은 smk-a 만).
begin;
insert into public.workspaces (id, slug, name) values
  ('00000000-0000-0000-0b0f-00000000aa01', 'smk-a', 'Smoke A'),
  ('00000000-0000-0000-0b0f-00000000aa02', 'smk-b', 'Smoke B');
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
values ('00000000-0000-0000-0b0f-000000000a01', 'smk-u1@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}',
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.profiles (user_id, email, display_name) values ('00000000-0000-0000-0b0f-000000000a01', 'smk-u1@example.com', 'u1');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('00000000-0000-0000-0b0f-00000000aa01', '00000000-0000-0000-0b0f-000000000a01', 'admin'),
  ('00000000-0000-0000-0b0f-00000000aa02', '00000000-0000-0000-0b0f-000000000a01', 'member');
insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by) values
  ('00000000-0000-0000-0b0f-000000001101', null, '2026-09-01', 'SMK', 'M', '#', '00000000-0000-0000-0b0f-000000000a01');
insert into public.minute_folders (id, project_id, parent_id, name, created_by) values
  ('00000000-0000-0000-0b0f-000000001201', null, null, 'SMK', '00000000-0000-0000-0b0f-000000000a01'),
  ('00000000-0000-0000-0b0f-000000001202', null, '00000000-0000-0000-0b0f-000000001201', 'child', '00000000-0000-0000-0b0f-000000000a01');
insert into public.user_preferences (user_id, prefs) values ('00000000-0000-0000-0b0f-000000000a01', '{}');
commit;
