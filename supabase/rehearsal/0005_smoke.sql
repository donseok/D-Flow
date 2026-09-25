-- 0005_profiles_email_readonly 리허설 스모크 — CLI 가 적용하지 않는 폴더(supabase/rehearsal/). 로컬 DB 에 postgres 로 흘린다:
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0005_smoke.sql
-- 한 트랜잭션 안에서 돌고 마지막에 rollback 한다(DB 에 흔적 없음). 기대 예외는 DO 블록이 SQLSTATE 로 확인하고,
-- 기대와 다르면 오류로 멈춘다. 결과 줄의 불리언이 전부 t 여야 한다(claims_* 는 세션 설정 줄이라 늘 t).
-- uuid 는 0003 스모크와 겹치지 않게 넷째 묶음 0005 를 쓴다.
begin;

-- 카탈로그: authenticated 는 display_name·updated_at 만 update, email·user_id·created_at 은 못 한다. select 는 그대로.
select has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
   and has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'UPDATE') as auth_updates_allowed_cols,
       not has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
   and not has_column_privilege('authenticated', 'public.profiles', 'user_id', 'UPDATE')
   and not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE') as auth_cannot_update_identity,
       not has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as auth_no_table_update,
       has_table_privilege('authenticated', 'public.profiles', 'SELECT') as auth_still_selects,
       has_table_privilege('service_role', 'public.profiles', 'UPDATE') as service_role_updates;

-- 픽스처 -------------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
values ('00000000-0000-0000-0005-000000000a01', 'smoke5-alice@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}',
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.profiles (user_id, email, display_name)
values ('00000000-0000-0000-0005-000000000a01', 'smoke5-alice@example.com', 'alice');
-- update 는 select 정책(profiles_read — 같은 워크스페이스)도 태운다. 워크스페이스가 없으면 자기 행도 안 보여 0행이 된다.
insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-0005-00000000aaaa', 'smoke5', 'Smoke5');
insert into public.workspace_members (workspace_id, user_id, role)
values ('00000000-0000-0000-0005-00000000aaaa', '00000000-0000-0000-0005-000000000a01', 'member');

-- 세션 경로 -----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0005-000000000a01","role":"authenticated"}', true) is not null
       as claims_alice;

do $$ begin
  update public.profiles set email = 'smoke5-newhire@example.com' where user_id = '00000000-0000-0000-0005-000000000a01';
  raise exception 'expected 42501 on profiles.email';
exception when insufficient_privilege then null;
end $$;

with u as (
  update public.profiles set display_name = 'alice k', updated_at = now()
   where user_id = '00000000-0000-0000-0005-000000000a01' returning 1)
select count(*) = 1 as session_updates_own_display_name from u;

reset role;
select email = 'smoke5-alice@example.com' and display_name = 'alice k' as email_kept_name_changed
  from public.profiles where user_id = '00000000-0000-0000-0005-000000000a01';

rollback;
