-- 0054_workspace_write_paths.sql
-- 워크스페이스 소속·생성의 쓰기 길 정리 — 세션의 소속 직접 삭제를 닫고, 워크스페이스 생성을 한 트랜잭션으로 묶는다.
-- 왜:
--   · 0053 이 멤버 제거의 정식 길(remove_workspace_member — 소속 삭제 + 수락 전 초대 회수 + 그 사람 소유 토큰 회수)을 만들었는데
--     authenticated 의 workspace_members DELETE 권한·정책(0003 workspace_members_write — FOR ALL)이 그대로 남아 있었다. 워크스페이스 관리자가
--     PostgREST 로 직접 지우면 소속만 빠지고 초대 링크로 다시 들어오거나 토큰으로 API 를 계속 쓴다. 앱은 세션 클라이언트로 이 표를 지우지 않는다
--     (src·scripts 전수 확인 — 삭제는 RPC 한 곳뿐) — 쓰이지 않는 길만 닫는다.
--   · 워크스페이스 생성(플랫폼 관리 화면)은 워크스페이스 행 → 관리자 멤버십 → 인물 → 설정을 네 번의 요청으로 쓰고, 중간에 실패하면 만든 행을
--     지우는 보상에 기댔다. 보상 삭제까지 실패하면 관리자 없는 워크스페이스가 남고 같은 slug 를 다시 쓸 수 없다. 네 쓰기를 한 함수에 넣으면
--     실패는 곧 전부 없던 일이다.
-- 무엇:
--   ① workspace_members — authenticated 의 DELETE 권한 회수. FOR ALL 정책(workspace_members_write)을 지우고 같은 식(is_ws_admin)의
--      INSERT 정책(workspace_members_insert)·UPDATE 정책(workspace_members_update)으로 나눈다. INSERT·UPDATE(role 열, 0011)의 판정은 그대로다.
--      FOR ALL 이 덮던 SELECT 는 읽기 정책(workspace_members_read — is_ws_member)이 이미 포함한다(is_ws_admin 이 참이면 is_ws_member 도 참).
--      service_role·DEFINER 함수(remove_workspace_member, 계정 삭제 캐스케이드)의 삭제는 그대로다.
--   ② create_workspace_with_admin(p_actor, p_slug, p_name, p_admin_user_id, p_values, p_command_id, p_schema_version) — DEFINER·service_role 전용.
--      플랫폼 관리자인지 함수 안에서 다시 판정한다(액션 가드 requireSuperuser 와 두 관문). 워크스페이스 행(설정 행은 기존 트리거가 만든다) →
--      첫 관리자 멤버십(권한 이력에 행위자·명령 id 가 남는다) → 그 관리자의 인물 행 → 설정 값. 설정 값은 표에 직접 쓰지 않고
--      apply_workspace_settings 를 그대로 부른다(설정 쓰기 한 길 — revision·이력·명시 키 규칙이 한 곳에 있다).
--      p_schema_version 은 그 설정 RPC 가 요구하는 값이다(앱의 레지스트리 세대 — DB 가 짐작하지 않는다).
--      같은 행위자·명령 id 의 재전송은 새로 만들지 않고 그때 만든 워크스페이스를 돌려준다(status duplicate). 같은 명령 id 를 다른 slug 로
--      다시 쓰면 COMMAND_REUSED.
-- 사유 코드(앱이 문구로 바꾼다): AUTHZ_FORBIDDEN(42501) · WORKSPACE_SLUG_TAKEN(23505) · WORKSPACE_ADMIN_NOT_FOUND(P0002) ·
--   WORKSPACE_CREATE_INVALID·CONFIG_INVALID:*(22023) · COMMAND_ID_REQUIRED(22023) · COMMAND_REUSED(23505).
-- 그대로 두는 것: workspace_members 의 INSERT·UPDATE(role) 세션 권한 — 앱의 소속 추가·등급 변경은 service_role 경로지만 이 권한의 회수는
--   이 마이그레이션의 범위가 아니다. 기존 워크스페이스·소속·설정 행.
-- 데이터: 적용만으로 바뀌는 행은 없다(권한 하나를 회수하고 정책을 나누고 함수 하나를 만든다).
-- 롤백: supabase/rollbacks/*_workspace_write_paths_rollback.sql.

begin;

-- ① 세션의 소속 직접 삭제를 닫는다 --------------------------------------------------------------------------------------
revoke delete on public.workspace_members from authenticated;
drop policy workspace_members_write on public.workspace_members;
create policy workspace_members_insert on public.workspace_members for insert to authenticated
  with check (public.is_ws_admin(workspace_id));
create policy workspace_members_update on public.workspace_members for update to authenticated
  using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));

-- ② 워크스페이스 생성 — 행·첫 관리자·인물·설정을 한 트랜잭션으로 -----------------------------------------------------------
create function public.create_workspace_with_admin(
  p_actor uuid, p_slug text, p_name text, p_admin_user_id uuid, p_values jsonb, p_command_id uuid, p_schema_version int)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_dup_ws uuid;
  v_dup_slug text;
  v_ws uuid;
  v_email text;
  v_display text;
  v_rev bigint;
  v_applied jsonb;
begin
  -- 둘 다 잠금보다 먼저다 — null 키의 advisory 잠금은 잠그지 않고 중복 조회도 맞지 않아 멱등이 조용히 사라진다
  if p_actor is null or p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if p_slug is null or p_name is null or p_admin_user_id is null then
    raise exception using errcode = '22023', message = 'WORKSPACE_CREATE_INVALID';
  end if;
  if pg_catalog.jsonb_typeof(v_values) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:p_values';
  end if;
  -- 허용 모듈은 늘 명시로 적는다(빈 배열 = core 만) — 빠지면 새 워크스페이스가 제품 기본값에 기대고, 설정 이력에 생성의 흔적이 남지 않는다
  if not (v_values ? 'modules.allowed') then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:modules.allowed';
  end if;
  -- 등급 재판정(액션 가드와 두 관문) — 워크스페이스를 만드는 것은 플랫폼 관리자뿐이다
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  -- 같은 명령의 동시 재전송을 줄 세운다. 키는 접두 문자열로 기존 advisory 키와 겹치지 않는다
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workspace-create:' || p_actor::text || ':' || p_command_id::text, 0));
  -- 격리 수준 규칙(0011 공통): 잠금 뒤 이력을 읽어 중복을 판정하므로 read committed 가 아니면 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  -- 중복 명령 — 첫 관리자 멤버십의 권한 이력이 명령 원장이다(행위자·명령 id 가 앞선 유일 인덱스 authz_events_command_uq)
  select e.workspace_id, w.slug into v_dup_ws, v_dup_slug
    from public.authz_events e join public.workspaces w on w.id = e.workspace_id
   where e.actor_user_id = p_actor and e.command_id = p_command_id and e.kind = 'workspace_role'
   order by e.id limit 1;
  if v_dup_ws is not null then
    if v_dup_slug is distinct from p_slug then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'workspace_id', v_dup_ws);
  end if;
  -- 첫 관리자 — 계정이 있어야 한다(여기서 계정을 만들지 않는다). 인물 행의 이름·주소는 그 계정의 프로필에서 온다
  select p.email, pg_catalog.btrim(p.display_name) into v_email, v_display
    from public.profiles p where p.user_id = p_admin_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORKSPACE_ADMIN_NOT_FOUND';
  end if;

  -- 워크스페이스 행 — 설정 행은 트리거가 만든다(0012 workspaces_settings_row). slug 경합의 최종 판정은 유니크 제약이다
  begin
    insert into public.workspaces (slug, name, created_by) values (p_slug, p_name, p_actor) returning id into v_ws;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'WORKSPACE_SLUG_TAKEN';
  end;

  -- 첫 관리자 멤버십 — 기록 트리거(record_authz_event)가 읽는 행위자·명령 id. service_role 경로라 auth.uid() 가 없다
  perform pg_catalog.set_config('app.authz_actor', p_actor::text, true);
  perform pg_catalog.set_config('app.command_id', p_command_id::text, true);
  insert into public.workspace_members (workspace_id, user_id, role, invited_by) values (v_ws, p_admin_user_id, 'admin', p_actor);
  perform pg_catalog.set_config('app.authz_actor', '', true);
  perform pg_catalog.set_config('app.command_id', '', true);

  -- 인물 원장 — 새 워크스페이스라 같은 주소의 기존 인물이 없다. 명단·담당자 지정이 이 행을 가리킨다
  insert into public.people (workspace_id, email, display_name, user_id) values (v_ws, v_email, v_display, p_admin_user_id);

  -- 설정 — 표에 직접 쓰지 않는다. 방금 생긴 설정 행의 revision 으로 설정 RPC 를 부른다(이력·명시 키 규칙은 그 함수의 것)
  select s.revision into v_rev from public.workspace_settings s where s.workspace_id = v_ws;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  v_applied := public.apply_workspace_settings(v_ws, v_rev, p_command_id, v_values, '{}'::text[], p_actor, p_schema_version, 'internal');

  return pg_catalog.jsonb_build_object('status', 'applied', 'workspace_id', v_ws, 'revision', v_applied -> 'revision');
end $$;
revoke all on function public.create_workspace_with_admin(uuid, text, text, uuid, jsonb, uuid, int) from public, anon, authenticated;
grant execute on function public.create_workspace_with_admin(uuid, text, text, uuid, jsonb, uuid, int) to service_role;

-- 사후검사 WORKSPACE_WRITE_PATHS_POSTCHECK — 읽기만 한다
do $$
declare
  v text;
begin
  -- 세션(과 anon·PUBLIC)에 소속 삭제 권한이 남지 않았다
  select string_agg(r, ', ') into v from unnest(array['authenticated', 'anon']) as r
   where has_table_privilege(r, 'public.workspace_members', 'DELETE');
  if v is not null then raise exception 'WORKSPACE_WRITE_PATHS_POSTCHECK: workspace_members DELETE 권한이 남았다: %', v; end if;
  -- 삭제를 덮는 정책(FOR DELETE·FOR ALL)이 없다 — 권한이 다시 열려도 정책이 없으면 0행이다
  select string_agg(p.polname, ', ') into v from pg_policy p
   where p.polrelid = 'public.workspace_members'::regclass and p.polcmd in ('d', '*');
  if v is not null then raise exception 'WORKSPACE_WRITE_PATHS_POSTCHECK: workspace_members 에 삭제를 덮는 정책이 있다: %', v; end if;
  -- 나눈 두 정책이 있다(빠지면 세션의 소속 추가·등급 변경이 조용히 0행이 된다)
  select string_agg(x.name, ', ') into v
    from (values ('workspace_members_read', 'r'), ('workspace_members_insert', 'a'), ('workspace_members_update', 'w')) as x(name, cmd)
   where not exists (select 1 from pg_policy p
                      where p.polrelid = 'public.workspace_members'::regclass and p.polname = x.name and p.polcmd = x.cmd::"char");
  if v is not null then raise exception 'WORKSPACE_WRITE_PATHS_POSTCHECK: workspace_members 정책이 없다: %', v; end if;
  -- 생성 RPC 는 service_role 전용
  select string_agg(f, ', ') into v from unnest(array[
    'public.create_workspace_with_admin(uuid, text, text, uuid, jsonb, uuid, int)']) as f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE');
  if v is not null then raise exception 'WORKSPACE_WRITE_PATHS_POSTCHECK: 실행권이 어긋났다: %', v; end if;
  -- 등급 재판정과 설정 한 길(설정 RPC 호출)을 지녔다
  select string_agg(x.token, ', ') into v
    from (values ('platform_admins'), ('AUTHZ_FORBIDDEN'), ('public.apply_workspace_settings('), ('WORKSPACE_SLUG_TAKEN')) as x(token)
   where position(x.token in (select p.prosrc from pg_proc p
                               where p.oid = 'public.create_workspace_with_admin(uuid, text, text, uuid, jsonb, uuid, int)'::regprocedure)) = 0;
  if v is not null then raise exception 'WORKSPACE_WRITE_PATHS_POSTCHECK: 생성 RPC 에 빠진 것이 있다: %', v; end if;
  -- 설정 표에 직접 쓰지 않는다(읽기 한 번뿐이다)
  if (select p.prosrc from pg_proc p
       where p.oid = 'public.create_workspace_with_admin(uuid, text, text, uuid, jsonb, uuid, int)'::regprocedure)
     ~* '(insert\s+into|update|delete\s+from)\s+public\.workspace_settings' then
    raise exception 'WORKSPACE_WRITE_PATHS_POSTCHECK: 생성 RPC 가 설정 표에 직접 쓴다';
  end if;
  -- 생성 RPC 가 기대는 기존 트리거 — 없으면 설정 행이 없어 SETTINGS_ROW_MISSING 으로 늘 실패한다
  if not exists (select 1 from pg_trigger g where g.tgrelid = 'public.workspaces'::regclass and g.tgname = 'workspaces_settings_row'
                    and not g.tgisinternal and g.tgenabled in ('O', 'A')) then
    raise exception 'WORKSPACE_WRITE_PATHS_POSTCHECK: workspaces_settings_row 트리거가 없다';
  end if;
end $$;

commit;
