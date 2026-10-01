-- NNNN_authz_carry 롤백 — 정방향(supabase/migrations/*_authz_carry.sql)의 역순. 한 트랜잭션.
-- 되돌리지 않는 데이터: 그사이 남은 active·person_active 전환 기록(authz_events 는 고칠 수 없다 — 0012 의 불변 트리거).
-- 재생성하는 표 없음. 함수 셋은 원문 바이트 그대로 — apply_project_settings·record_authz_event 는 0012, project_members_guard 는 0011.
-- modules.* 를 건드리지 않는다 — CR-4 해당 없음(이월은 스펙 §9).
-- *_command_receipts·*_weekly_areas 의 객체를 쓰지 않는다 — 롤백은 뒤 파일부터라는 순서만 지킨다.
begin;

-- ③ 역순 — apply_project_settings 를 0012 원문 그대로(0012_settings.sql:487-578 — 첫 줄만 create or replace, ACL 은 그대로 남아 있다)
create or replace function public.apply_project_settings(
  p_project_id uuid, p_expected_revision bigint, p_command_id uuid,
  p_set jsonb, p_unset text[], p_actor uuid, p_schema_version int, p_source text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_set jsonb := coalesce(p_set, '{}'::jsonb);
  v_unset text[] := coalesce(p_unset, '{}'::text[]);
  v_values jsonb;
  v_rev bigint;
  v_ver int;
  v_next jsonb;
  v_digest text;
  v_dup_rev bigint;
  v_dup_digest text;
  k text;
begin
  if pg_catalog.jsonb_typeof(v_set) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:p_set';
  end if;
  if p_actor is null and p_source is distinct from 'migration' and p_source is distinct from 'internal' then
    raise exception using errcode = '22023', message = 'SETTINGS_ACTOR_REQUIRED';
  end if;
  -- 설정 RPC 의 출처는 셋뿐이다. create·copy 는 생성 RPC 의 몫이다(그 중복 조회가 create·copy 이력을 자기 명령으로 읽는다)
  if p_source is null or p_source not in ('edit', 'internal', 'migration') then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:p_source';
  end if;
  -- null 이면 세대 비교(v_ver > null)가 조용히 건너뛰어지고 update 가 날 23502 로 끝난다
  if p_schema_version is null then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:p_schema_version';
  end if;
  -- 명령 id 가 없으면 중복 조회가 맞지 않아 멱등이 조용히 사라진다 — 쓰기 전에 거절한다
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  -- ① 문서 잠금 — 같은 명령의 동시 재전송도 여기서 줄 선다. 뒤 SP 의 참조 쓰기 트리거(FOR SHARE)와도 직렬화된다
  select s."values", s.revision, s.schema_version into v_values, v_rev, v_ver
    from public.project_settings s where s.project_id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  -- 격리 수준 규칙(0011 공통, 스펙 D1): 잠금 아래에서 다른 행(이력·참조 건수)을 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 행 잠금을 기다리는 사이 커밋된 같은 명령의 이력 — 재전송이 duplicate 가 아니라 conflict 로 보인다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  -- ② 멱등(스펙 D8): 유일성은 (행위자, 범위, 명령 id). 내용 요약이 같으면 그 결과를, 다르면 거부
  -- 요약은 jsonb 한 덩어리 — 구분자로 이어 붙이면 unset ['a,b'] 와 ['a','b'] 가 같은 요약이 된다
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'set', v_set,
    'unset', pg_catalog.to_jsonb(array(select distinct x.k from pg_catalog.unnest(v_unset) as x(k) order by x.k)))::text, 'UTF8')), 'hex');
  select max(h.revision), max(h.command_digest) into v_dup_rev, v_dup_digest
    from public.project_settings_history h
   where h.project_id = p_project_id and h.command_id = p_command_id and h.changed_by is not distinct from p_actor;
  if v_dup_rev is not null then
    if v_dup_digest is distinct from v_digest then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'revision', v_dup_rev);
  end if;
  -- ③ 세대
  if v_ver > p_schema_version then
    raise exception using errcode = 'P0001', message = 'SETTINGS_SCHEMA_AHEAD';
  end if;
  -- ④ 값 불변 명령: revision 을 올리지 않고 이력도 없고 충돌도 내지 않는다
  v_next := (v_values - v_unset) || v_set;
  if v_next = v_values then
    return pg_catalog.jsonb_build_object('status', 'applied', 'revision', v_rev, 'changed', 0);
  end if;
  -- ⑤ CAS
  if v_rev is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'SETTINGS_REVISION_CONFLICT', detail = v_rev::text;
  end if;
  -- ⑥ 참조 무결성 — 디스패처(SP3a 는 분기 없음)
  for k in select pg_catalog.jsonb_object_keys(v_set) union select pg_catalog.unnest(v_unset) loop
    perform public.settings_ref_check(p_project_id, k, v_values -> k, v_set -> k);
  end loop;
  -- ⑦ 넘침 — TS·JSON 의 number 가 담을 수 없는 revision 을 만들지 않는다
  if v_rev >= 9007199254740991 then
    raise exception using errcode = 'P0001', message = 'SETTINGS_REVISION_OVERFLOW';
  end if;
  -- ⑧ 적용·이력(값이 같은 키는 이력을 남기지 않는다)
  update public.project_settings s
     set "values" = v_next, revision = v_rev + 1, schema_version = p_schema_version,
         updated_at = pg_catalog.now(), updated_by = p_actor
   where s.project_id = p_project_id;
  insert into public.project_settings_history
    (project_id, revision, key, old_value, new_value, source, command_id, command_digest, changed_by)
  select p_project_id, v_rev + 1, x.key, v_values -> x.key, v_next -> x.key, p_source, p_command_id, v_digest, p_actor
    from (select pg_catalog.jsonb_object_keys(v_set) as key union select pg_catalog.unnest(v_unset)) x
   where (v_values -> x.key) is distinct from (v_next -> x.key);
  return pg_catalog.jsonb_build_object('status', 'applied', 'revision', v_rev + 1);
end $$;

-- ②′ 역순 — project_members_guard 를 0011 원문 그대로(0011_authz_hardening.sql:391-441)
create or replace function public.project_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_person_ws uuid;
  v_person_user uuid;
  v_stamp boolean;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    -- 담당 FK 가 (id, project_id) 복합이라 바꾸면 FK 가 깨진다
    raise exception using errcode = '23514', message = 'PROJECT_MEMBER_PROJECT_IMMUTABLE';
  end if;

  select pe.workspace_id, pe.user_id into v_person_ws, v_person_user
    from public.people pe where pe.id = new.person_id;
  if found then
    -- 계정 없는 인물의 역할은 역할을 주거나 옮기는 문장(INSERT·역할 변경·인물 변경)에서만 거부한다. 계정 삭제 캐스케이드는
    -- people.user_id SET NULL 이 access_granted_by SET NULL(역할은 그대로인 UPDATE)보다 먼저 돌고 역할 회수(people_unlink_revokes_access)는
    -- 그 뒤라, 자기가 부여한 자기 명단 행(access_granted_by = 지워지는 계정)을 여기서 막으면 계정 삭제가 통째로 실패한다.
    if new.access_role is not null and v_person_user is null
       and (tg_op = 'INSERT' or new.access_role is distinct from old.access_role or new.person_id is distinct from old.person_id) then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT';
    end if;
    if v_person_ws is distinct from public.project_ws(new.project_id) then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_CROSS_WORKSPACE';
    end if;
  end if;
  -- 인물이 없으면 person_id FK 가 거부한다

  -- 세션 경로의 부여자는 세션 사용자다(0011 H2-e). service_role 경로(auth.uid() null)는 RPC 가 넣은 값을 둔다.
  -- 세션 사용자의 계정이 이 문장에서 지워지는 중이면(본인 claims 로 auth.users 삭제 → 캐스케이드가 역할 회수) 찍지 않는다 — 없는 계정을
  -- 찍으면 access_granted_by FK 가 23503 으로 삭제를 막는다. 그때는 문장이 준 값(캐스케이드면 FK 의 SET NULL)을 둔다.
  -- auth.users 는 이 함수가 DEFINER(소유자 postgres)라 읽힌다. 호출자에게 돌려주는 것은 없다(트리거 전용, 실행 권한 회수).
  v_stamp := auth.uid() is not null and exists (select 1 from auth.users u where u.id = auth.uid());

  if tg_op = 'INSERT' then
    new.access_granted_at := case when new.access_role is not null then now() end;
    if v_stamp then
      new.access_granted_by := case when new.access_role is not null then auth.uid() end;
    end if;
  else
    if new.access_role is distinct from old.access_role then
      new.access_granted_at := now();
      if v_stamp then
        new.access_granted_by := auth.uid();
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;

-- ② 역순 — 인물 트리거를 지우고 명단 트리거를 0012 정의로(0012_settings.sql:1082-1083), 기록 함수를 0012 원문 그대로(:984-1076)
drop trigger authz_events_record_people on public.people;
drop trigger authz_events_record on public.project_members;
create trigger authz_events_record after insert or delete or update of access_role on public.project_members
  for each row execute function public.record_authz_event();
create or replace function public.record_authz_event() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  -- §9 #3 — 'all': 관리 화면·초대·계정 생성·연쇄 회수까지 전부 기록(기본값). 'commands': 명령 id 가 실린 변경만
  c_scope constant text := 'all';
  v_kind text;
  v_ws uuid;
  v_project uuid;
  v_target_user uuid;
  v_target_person uuid;
  v_before jsonb;
  v_after jsonb;
  v_cause text;
  v_actor uuid;
  v_command uuid;
  v_digest text;
  v_parent_gone boolean;
begin
  -- 행위자 — 그 변경을 한 세션 사용자. 세션 사용자가 있으면 트랜잭션 설정을 하나도 읽지 않는다(명령 id·요약은 null 로 남는다).
  -- 세션 사용자가 없을 때(서버 경로)만 권한 RPC 가 넘긴 설정을 읽는다. 저장된 도장 열(처음 준 사람)은 행위자로 읽지 않는다
  v_actor := auth.uid();
  if v_actor is not null and not exists (select 1 from auth.users u where u.id = v_actor) then
    v_actor := null;   -- 그 계정이 이 문장에서 지워지는 중이다
  end if;
  if v_actor is null then
    v_actor := nullif(pg_catalog.current_setting('app.authz_actor', true), '')::uuid;
    v_command := nullif(pg_catalog.current_setting('app.command_id', true), '')::uuid;
    v_digest := nullif(pg_catalog.current_setting('app.command_digest', true), '');
  end if;
  if c_scope = 'commands' and v_command is null then
    return null;
  end if;

  if tg_table_name = 'platform_admins' then
    v_kind := 'platform_admin';
    v_target_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    if tg_op = 'INSERT' then
      v_after := pg_catalog.jsonb_build_object('granted', true, 'granted_by', new.granted_by);
    else
      v_before := pg_catalog.jsonb_build_object('granted', true);
    end if;
    v_parent_gone := not exists (select 1 from auth.users u where u.id = v_target_user);
  elsif tg_table_name = 'workspace_members' then
    v_kind := 'workspace_role';
    v_ws := case when tg_op = 'DELETE' then old.workspace_id else new.workspace_id end;
    v_target_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    if tg_op = 'INSERT' then
      v_after := pg_catalog.jsonb_build_object('role', new.role, 'invited_by', new.invited_by);
    elsif tg_op = 'UPDATE' then
      if new.role is not distinct from old.role then return null; end if;
      v_before := pg_catalog.jsonb_build_object('role', old.role);
      v_after := pg_catalog.jsonb_build_object('role', new.role);
    else
      v_before := pg_catalog.jsonb_build_object('role', old.role);
    end if;
    v_parent_gone := not exists (select 1 from auth.users u where u.id = v_target_user);
  else  -- project_members
    v_kind := 'project_access';
    v_project := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
    v_target_person := case when tg_op = 'DELETE' then old.person_id else new.person_id end;
    if tg_op = 'INSERT' then
      if new.access_role is null then return null; end if;
      v_after := pg_catalog.jsonb_build_object('access_role', new.access_role, 'access_granted_by', new.access_granted_by);
    elsif tg_op = 'UPDATE' then
      if new.access_role is not distinct from old.access_role then return null; end if;
      v_before := pg_catalog.jsonb_build_object('access_role', old.access_role);
      v_after := pg_catalog.jsonb_build_object('access_role', new.access_role);
    else
      if old.access_role is null then return null; end if;
      v_before := pg_catalog.jsonb_build_object('access_role', old.access_role);
    end if;
    -- 명단 행의 워크스페이스는 그 인물의 워크스페이스다(프로젝트가 지워지는 중이어도 인물 행은 남아 있다)
    select pe.workspace_id, pe.user_id into v_ws, v_target_user from public.people pe where pe.id = v_target_person;
    v_parent_gone := not exists (select 1 from public.projects p where p.id = v_project)
                  or (v_target_user is not null and not exists (select 1 from auth.users u where u.id = v_target_user));
  end if;

  -- 원인 — 순서대로. ① 워크스페이스를 가진 종류에서 그 워크스페이스가 지워지는 중이면 기록하지 않는다(정리 트리거가 그 워크스페이스의
  -- 기록을 함께 지운다). platform_admin 은 ① 을 건너뛴다
  if v_kind <> 'platform_admin' and (v_ws is null or not exists (select 1 from public.workspaces w where w.id = v_ws)) then
    return null;
  end if;
  v_cause := case
    when v_parent_gone then 'parent_deleted'                 -- ② 프로젝트 또는 대상 계정이 지워지는 중
    when pg_catalog.pg_trigger_depth() > 1 then 'cascade'    -- ③ 다른 트리거가 일으킨 변경(0011 소속 회수 → 명단 권한 null)
    else 'direct' end;                                       -- ④

  insert into public.authz_events
    (kind, workspace_id, project_id, target_user_id, target_person_id, before, after, cause, actor_user_id, command_id, command_digest)
  values (v_kind, case when v_kind = 'platform_admin' then null else v_ws end, v_project, v_target_user, v_target_person,
          v_before, v_after, v_cause, v_actor, v_command, v_digest);
  return null;
end $$;

-- ① 역순 — 세션의 people.email 열 권한(0003_org_core.sql:689-690 의 email 몫)
grant insert (email), update (email) on public.people to authenticated;

commit;
