-- 0053_account_lifecycle.sql
-- 계정 수명주기 — 워크스페이스에서 멤버를 빼는 길과, 관리자가 한 비밀번호 재설정의 기록.
-- 왜:
--   · workspace_members 의 앱 쓰기는 insert 와 등급 변경(set_workspace_role)뿐이라 한 번 들어온 사람을 뺄 수 없었다. 빼는 일은 소속 행
--     삭제 하나가 아니다 — 수락 전 초대가 남으면 그 링크로 다시 들어오고, 그 사람 소유의 에이전트 토큰이 남으면 소속 없이 API 를 계속 쓴다.
--     여러 표를 한 트랜잭션으로 바꿔야 하므로 RPC 한 길로 한다.
--   · 비밀번호 재설정은 "그 계정으로 로그인할 수 있게 만드는" 조작인데 누가 누구에게 했는지 남지 않았다. 워크스페이스 관리자에게 여는 김에
--     권한 변경 이력(authz_events)에 남긴다.
-- 무엇:
--   ① authz_events 의 kind 에 'password_reset' 을 더한다(kind·scope 두 check 를 같은 이름으로 다시 만든다). 범위는 workspace_role 과 같다
--      (workspace_id 있음·project_id 없음) — 재설정은 늘 어느 워크스페이스의 멤버 화면에서 한다. 읽기 정책(authz_events_read)은 그대로라
--      그 워크스페이스의 관리자와 플랫폼 관리자만 본다. 비밀번호 값은 어디에도 적지 않는다.
--   ② remove_workspace_member(p_actor, p_workspace_id, p_target, p_command_id) — DEFINER·service_role 전용. 등급을 RPC 안에서 다시 판정한다.
--      소속 행 삭제 → (기존 트리거) 그 워크스페이스 명단 행의 access_role 이 null(0011 workspace_members_revoke_access — 명단 행·담당·이력은 남는다)
--      → 수락 전 초대 회수(revoked_at) → 그 사람 소유의 그 워크스페이스 에이전트 토큰 회수(enabled false·revoked_at).
--      마지막 관리자 보호는 기존 트리거(0008 workspace_members_keep_last_admin — WORKSPACE_LAST_ADMIN)가 한다.
--   ③ record_password_reset(p_actor, p_workspace_id, p_target, p_command_id) — DEFINER·service_role 전용. 경계를 다시 판정하고 기록 1행을 남긴다.
--      앱은 이 RPC 가 성공한 뒤에만 GoTrue 로 비밀번호를 바꾼다(두 저장소라 한 트랜잭션이 될 수 없다 — 기록 없는 재설정보다 재설정 없는 기록이 낫다).
-- 경계(앱의 순수 판정 src/lib/domain/authz.ts 와 같은 규칙 — 두 관문):
--   · 제거: 행위자는 그 워크스페이스의 관리자(플랫폼 관리자 포함). 자기 자신은 못 뺀다(나가기는 따로). 대상이 그 워크스페이스의 관리자면
--     플랫폼 관리자만 뺀다 — 워크스페이스 관리자는 먼저 멤버로 강등(set_workspace_role — 그 변경도 이력에 남는다)한 뒤 뺀다.
--   · 재설정: 플랫폼 관리자는 자기 자신 말고 누구든. 워크스페이스 관리자는 대상이 ⓐ 그 워크스페이스의 멤버이고 ⓑ 플랫폼 관리자가 아니고
--     ⓒ 어느 워크스페이스의 관리자도 아니며 ⓓ 대상의 소속이 전부 행위자가 관리자인 워크스페이스일 때만(다른 워크스페이스에도 속한 계정의
--     비밀번호를 바꾸면 그 워크스페이스의 자료까지 열린다).
-- 그대로 두는 것: 계정 자체(auth.users·profiles)와 다른 워크스페이스의 소속·명단, 인물 행의 계정 연결(people.user_id — 과거 담당·작성 기록의 이름),
--   워크스페이스 공용 자격증명(minutes_api — 소유자가 없다). 세션의 workspace_members DELETE 권한·정책(0003)도 손대지 않는다.
-- 데이터: 적용만으로 바뀌는 행은 없다(제약 둘을 넓히고 함수 둘을 만든다). 기존 authz_events 행은 새 check 를 그대로 통과한다.

begin;

-- ① 기록 종류 — 같은 이름으로 다시 만든다(넓히기만 한다)
alter table public.authz_events drop constraint authz_events_kind_check;
alter table public.authz_events add constraint authz_events_kind_check
  check (kind in ('platform_admin', 'workspace_role', 'project_access', 'password_reset'));
alter table public.authz_events drop constraint authz_events_scope_check;
alter table public.authz_events add constraint authz_events_scope_check check (
     (kind = 'platform_admin' and workspace_id is null and project_id is null)
  or (kind = 'workspace_role' and workspace_id is not null and project_id is null)
  or (kind = 'project_access' and project_id is not null and workspace_id is not null)
  or (kind = 'password_reset' and workspace_id is not null and project_id is null and target_user_id is not null));

-- ② 워크스페이스에서 멤버 제거
create function public.remove_workspace_member(p_actor uuid, p_workspace_id uuid, p_target uuid, p_command_id uuid)
returns jsonb language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_role text;
  v_matched integer;
  v_projects integer;
  v_invites integer;
  v_credentials integer;
begin
  if p_actor is null or p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if p_workspace_id is null or p_target is null then
    raise exception using errcode = '22023', message = 'AUTHZ_INVALID_INPUT';
  end if;
  -- 격리 수준 규칙(0011 공통): 잠금 뒤 등급을 읽어 판정하므로 read committed 가 아니면 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'AUTHZ_EVENT_ISOLATION';
  end if;
  -- 등급 재판정(액션 가드와 두 관문)
  if not public.actor_is_workspace_admin(p_actor, p_workspace_id) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  -- 자기 자신 — 한 번의 클릭으로 자기 워크스페이스에서 잠기는 사고를 막는다(나가기는 이 길이 아니다)
  if p_target = p_actor then
    raise exception using errcode = '23514', message = 'WORKSPACE_MEMBER_SELF_REMOVE';
  end if;
  -- 대상 행을 잠그고 등급을 읽는다 — 판정과 삭제 사이에 등급이 바뀌지 않게(강등 직후 승격과 엇갈리지 않는다)
  select m.role into v_role from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_target for update;
  if not found then
    -- 소속이 아니다 — 아무것도 바꾸지 않는다(초대·토큰도 손대지 않는다: 소속이 없는 사람의 초대는 초대 화면의 일이다)
    return pg_catalog.jsonb_build_object('status', 'applied', 'matched', 0);
  end if;
  -- 등급 경계 — 다른 관리자를 빼는 것은 플랫폼 관리자만
  if v_role = 'admin' and not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception using errcode = '42501', message = 'WORKSPACE_MEMBER_ADMIN_FORBIDDEN';
  end if;
  -- 회수될 권한 수 — 삭제 전에 센다(삭제 뒤에는 트리거가 이미 null 로 바꿨다)
  select pg_catalog.count(*) into v_projects
    from public.project_members pm join public.people pe on pe.id = pm.person_id
   where pe.user_id = p_target and pe.workspace_id = p_workspace_id and pm.access_role is not null;

  -- 기록 트리거(record_authz_event)가 읽는 행위자·명령 id. service_role 경로라 auth.uid() 가 없다
  perform pg_catalog.set_config('app.authz_actor', p_actor::text, true);
  perform pg_catalog.set_config('app.command_id', p_command_id::text, true);
  -- 소속 삭제 — 트리거가 잇는다: 마지막 관리자면 WORKSPACE_LAST_ADMIN(0008), 명단 권한 null(0011), 소속 제거·권한 회수 기록(0012)
  delete from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_target;
  get diagnostics v_matched = row_count;
  perform pg_catalog.set_config('app.authz_actor', '', true);
  perform pg_catalog.set_config('app.command_id', '', true);

  -- 수락 전 초대 — 남기면 그 링크로 다시 합류한다(consume_project_invite 가 소속을 되살린다). 주소는 계정·그 워크스페이스 인물의 것
  update public.project_invites i set revoked_at = pg_catalog.now()
   where i.workspace_id = p_workspace_id and i.redeemed_at is null and i.revoked_at is null
     and i.email in (select pg_catalog.lower(pg_catalog.btrim(u.email)) from auth.users u where u.id = p_target and u.email is not null
                     union
                     select pe.email from public.people pe
                      where pe.user_id = p_target and pe.workspace_id = p_workspace_id and pe.email is not null);
  get diagnostics v_invites = row_count;

  -- 그 사람 소유의 그 워크스페이스 자격증명(agent_runner — 소유자가 있는 종류는 이것뿐이다)을 닫는다. 지우지 않는다(누가 무엇을 썼는지의 기록).
  -- 가드(integration_credentials_guard)의 첫 분기가 "닫기만 하는 UPDATE" 를 소속 검사 없이 받는다. 소유자 없는 워크스페이스 공용
  -- 자격증명(minutes_api)은 사람의 것이 아니므로 그대로 둔다 — 그 사람이 만들었더라도(created_by) 워크스페이스의 것이다
  update public.integration_credentials k set enabled = false, revoked_at = pg_catalog.now()
   where k.workspace_id = p_workspace_id and k.owner_user_id = p_target and k.revoked_at is null;
  get diagnostics v_credentials = row_count;

  return pg_catalog.jsonb_build_object('status', 'applied', 'matched', v_matched,
    'revoked_projects', v_projects, 'revoked_invites', v_invites, 'revoked_credentials', v_credentials);
end $$;
revoke all on function public.remove_workspace_member(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid, uuid, uuid) to service_role;

-- ③ 비밀번호 재설정 기록 — 경계를 다시 판정하고 1행을 남긴다. 비밀번호 자체는 이 함수가 만지지 않는다(GoTrue 의 일)
create function public.record_password_reset(p_actor uuid, p_workspace_id uuid, p_target uuid, p_command_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_platform boolean;
begin
  if p_actor is null or p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if p_workspace_id is null or p_target is null then
    raise exception using errcode = '22023', message = 'AUTHZ_INVALID_INPUT';
  end if;
  -- 없는 워크스페이스의 기록은 정리 규칙(워크스페이스 삭제 때 함께 지운다)에 걸리지 않고 영영 남는다
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id)
     or not exists (select 1 from auth.users u where u.id = p_target) then
    raise exception using errcode = 'P0002', message = 'PASSWORD_RESET_TARGET_NOT_FOUND';
  end if;
  -- 자기 자신은 "내 비밀번호 변경"(기존 비밀번호 재확인)으로 한다 — 플랫폼 관리자도
  if p_target = p_actor then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  v_platform := exists (select 1 from public.platform_admins a where a.user_id = p_actor);
  if not v_platform then
    -- 행위자는 그 워크스페이스의 관리자, 대상은 그 워크스페이스의 멤버
    if not exists (select 1 from public.workspace_members m
                    where m.workspace_id = p_workspace_id and m.user_id = p_actor and m.role = 'admin')
       or not exists (select 1 from public.workspace_members m
                       where m.workspace_id = p_workspace_id and m.user_id = p_target) then
      raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
    end if;
    -- 대상이 플랫폼 관리자이거나, 어느 워크스페이스든 관리자이거나, 행위자가 관리자가 아닌 워크스페이스에도 속해 있으면 플랫폼 관리자만
    if exists (select 1 from public.platform_admins a where a.user_id = p_target)
       or exists (select 1 from public.workspace_members m where m.user_id = p_target and m.role = 'admin')
       or exists (select 1 from public.workspace_members m
                   where m.user_id = p_target
                     and not exists (select 1 from public.workspace_members am
                                      where am.workspace_id = m.workspace_id and am.user_id = p_actor and am.role = 'admin')) then
      raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
    end if;
  end if;
  insert into public.authz_events (kind, workspace_id, target_user_id, after, cause, actor_user_id, command_id)
  values ('password_reset', p_workspace_id, p_target, pg_catalog.jsonb_build_object('reset', true), 'direct', p_actor, p_command_id);
  return pg_catalog.jsonb_build_object('status', 'applied', 'matched', 1);
end $$;
revoke all on function public.record_password_reset(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_password_reset(uuid, uuid, uuid, uuid) to service_role;

-- 사후검사 ACCOUNT_LIFECYCLE_POSTCHECK — 읽기만 한다
do $$
declare
  v text;
begin
  select string_agg(f, ', ') into v from unnest(array[
    'public.remove_workspace_member(uuid, uuid, uuid, uuid)', 'public.record_password_reset(uuid, uuid, uuid, uuid)']) as f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE');
  if v is not null then raise exception 'ACCOUNT_LIFECYCLE_POSTCHECK: 실행권이 어긋났다: %', v; end if;
  -- 제거 RPC 가 기대는 기존 트리거 셋 — 하나라도 없으면 마지막 관리자가 빠지거나 명단 권한이 남는다
  select string_agg(x.name, ', ') into v
    from (values ('workspace_members_keep_last_admin'), ('workspace_members_revoke_access'), ('authz_events_record')) as x(name)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = 'public.workspace_members'::regclass and g.tgname = x.name
                        and not g.tgisinternal and g.tgenabled in ('O', 'A'));
  if v is not null then raise exception 'ACCOUNT_LIFECYCLE_POSTCHECK: workspace_members 트리거가 없다: %', v; end if;
  -- 두 함수가 등급 재판정을 지녔다(빠지면 액션 가드 하나만 남는다)
  select string_agg(x.fn, ', ') into v
    from (values ('public.remove_workspace_member(uuid, uuid, uuid, uuid)', 'actor_is_workspace_admin'),
                 ('public.remove_workspace_member(uuid, uuid, uuid, uuid)', 'WORKSPACE_MEMBER_ADMIN_FORBIDDEN'),
                 ('public.remove_workspace_member(uuid, uuid, uuid, uuid)', 'WORKSPACE_MEMBER_SELF_REMOVE'),
                 ('public.record_password_reset(uuid, uuid, uuid, uuid)', 'AUTHZ_FORBIDDEN')) as x(fn, token)
    join pg_proc p on p.oid = x.fn::regprocedure
   where position(x.token in p.prosrc) = 0;
  if v is not null then raise exception 'ACCOUNT_LIFECYCLE_POSTCHECK: 등급 재판정이 없다: %', v; end if;
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = 'public.authz_events'::regclass and c.conname = 'authz_events_kind_check') !~ 'password_reset' then
    raise exception 'ACCOUNT_LIFECYCLE_POSTCHECK: authz_events 가 password_reset 을 받지 않는다';
  end if;
end $$;

commit;
