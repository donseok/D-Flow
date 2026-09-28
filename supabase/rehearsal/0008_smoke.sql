-- ⚠ 0012 이전 상태의 기록이다 — 0012_settings 가 workspace_settings 의 쓰기 정책과 authenticated 의 쓰기 권한을 걷고 allowed_domains 열을
-- 지웠으므로, 0012 가 적용된 DB 에서는 아래 two_policies·authenticated_crud 단언과 allowed_domains insert 가 거짓이다.
-- 이 파일은 0008 을 리허설할 때(supabase db reset --version 0008)만 돌린다. 0012 의 스모크는 supabase/rehearsal/0012_smoke.sql.
-- 0008_workspace_settings 리허설 스모크. docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0008_smoke.sql
-- 카탈로그는 불리언(전부 t), 동작은 아래 do 블록이 어긋나면 예외로 멈춘다. 전부 begin…rollback 이라 아무것도 남지 않는다.
-- 교차 계정 판정(A·B)은 tests/rls/workspace-settings.test.ts, 두 세션 동시 강등은 같은 파일의 ⑧ 과 보고서의 손 실측이 본다.
begin;
select (select relrowsecurity from pg_class where oid = 'public.workspace_settings'::regclass) as rls_on,
       (select count(*) = 2 from pg_policies where schemaname = 'public' and tablename = 'workspace_settings') as two_policies,
       has_table_privilege('authenticated', 'public.workspace_settings', 'SELECT, INSERT, UPDATE, DELETE') as authenticated_crud,
       not has_table_privilege('authenticated', 'public.workspace_settings', 'TRUNCATE') as authenticated_no_truncate,
       not has_table_privilege('anon', 'public.workspace_settings', 'SELECT') as anon_nothing,
       has_table_privilege('service_role', 'public.workspace_settings', 'SELECT, INSERT, UPDATE, DELETE') as service_crud,
       (select prosrc ~ 'INVITE_INACTIVE' and prosrc !~ 'active = true' from pg_proc
         where oid = 'public.consume_project_invite(text, text, uuid)'::regprocedure) as consume_rejects_inactive,
       (select prosrc ~ 'for update' from pg_proc where oid = 'public.workspace_members_keep_last_admin()'::regprocedure) as last_admin_locks;

do $$
declare
  v_ws uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_person uuid;
  v_hash text := 'smoke-0008-' || gen_random_uuid();
  v_msg text;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id, created_at, updated_at) values
    (v_user, 'smoke-0008-user@example.com', '', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin, 'smoke-0008-admin@example.com', '', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
  insert into public.workspaces (id, slug, name) values (v_ws, 'smoke-0008', 'smoke 0008');
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_admin, 'admin');
  insert into public.projects (id, name, workspace_id) values (v_project, 'smoke 0008', v_ws);
  insert into public.workspace_settings (workspace_id, allowed_domains) values (v_ws, array['example.com']);

  -- 비활성 인물 → INVITE_INACTIVE, 초대 미소비
  insert into public.people (workspace_id, display_name, email, active) values (v_ws, 'smoke', 'smoke-0008-user@example.com', false)
    returning id into v_person;
  insert into public.project_invites (workspace_id, project_id, email, token_hash, created_by, expires_at)
    values (v_ws, v_project, 'smoke-0008-user@example.com', v_hash, v_admin, now() + interval '1 day');
  begin
    perform public.consume_project_invite(v_hash, 'smoke-0008-user@example.com', v_user);
    raise exception 'SMOKE_0008: 비활성 인물 초대가 통과했다';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'INVITE_INACTIVE' then raise exception 'SMOKE_0008: 비활성 인물 — 기대 INVITE_INACTIVE, 실제 %', v_msg; end if;
  end;
  if exists (select 1 from public.project_invites where token_hash = v_hash and redeemed_at is not null) then
    raise exception 'SMOKE_0008: 거부된 초대가 소비됐다';
  end if;

  -- 활성 인물 + 비활성 명단 행 → 같은 거부
  update public.people set active = true where id = v_person;
  insert into public.project_members (project_id, person_id, active) values (v_project, v_person, false);
  begin
    perform public.consume_project_invite(v_hash, 'smoke-0008-user@example.com', v_user);
    raise exception 'SMOKE_0008: 비활성 명단 행 초대가 통과했다';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'INVITE_INACTIVE' then raise exception 'SMOKE_0008: 비활성 명단 — 기대 INVITE_INACTIVE, 실제 %', v_msg; end if;
  end;

  -- 명단 재활성화 뒤에는 수락된다(관리자가 명시적으로 되살리는 경로)
  update public.project_members set active = true where project_id = v_project and person_id = v_person;
  if (select count(*) from public.consume_project_invite(v_hash, 'smoke-0008-user@example.com', v_user)) <> 1 then
    raise exception 'SMOKE_0008: 재활성화 뒤 수락이 실패했다';
  end if;

  -- created_by 불변
  begin
    update public.project_invites set created_by = v_user where token_hash = v_hash;
    raise exception 'SMOKE_0008: created_by 변경이 통과했다';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'PROJECT_INVITE_CREATED_BY_IMMUTABLE' then raise exception 'SMOKE_0008: created_by — 실제 %', v_msg; end if;
  end;

  -- 마지막 관리자(단일 세션) — 잠금이 들어가도 기존 판정은 그대로
  begin
    update public.workspace_members set role = 'member' where workspace_id = v_ws and user_id = v_admin;
    raise exception 'SMOKE_0008: 마지막 관리자 강등이 통과했다';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg <> 'WORKSPACE_LAST_ADMIN' then raise exception 'SMOKE_0008: last admin — 실제 %', v_msg; end if;
  end;
  raise notice 'SMOKE_0008: 동작 검사 통과';
end $$;
rollback;
