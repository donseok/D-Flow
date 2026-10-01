-- NNNN_authz_carry — 레인 A 이월 셋(SP4 Phase A1): people.email 열 권한, 비활성 전환의 권한 이력(CR-1), 명단 인물 불변, 설정 RPC 의 명시 키
-- 거부(CR-6·FN-3). 정본: docs/superpowers/specs/2026-10-01-sp4-weekly-teams-design.md §3.4(D2). 번호를 참조하지 않는다 — 리허설·테스트는 접미로 찾는다.
-- 절: ① people.email 열 권한 회수 ② record_authz_event — 명단 행 {access_role, active}·인물 분기 {person_active}, 기록 트리거 둘
--     ②′ project_members_guard — person_id 불변 ③ apply_project_settings — 명시 키의 unset·JSON null 거부 ④ 사후검사(AUTHZ_CARRY_POSTCHECK)
-- 권한 원칙: 새 함수·새 grant 없음 — 기존 함수 셋을 create or replace(ACL·속성 그대로)하고 열 권한 하나를 회수한다. 세션의 people 쓰기는
--   workspace_id·display_name(insert)과 display_name·updated_at(update)만 남는다. 앱의 people 쓰기는 service_role(actions/accounts.ts)과
--   DEFINER RPC(upsert_project_member)뿐이다. 이 파일은 *_command_receipts·*_weekly_areas 의 객체를 쓰지 않는다.
-- 롤백: supabase/rollbacks/*_authz_carry_rollback.sql. 리허설 스모크: supabase/rehearsal/*_authz_carry_smoke.sql.

-- ① people.email 열 권한 — 세션이 정규형 밖 이메일(대소문자·공백)을 쓰는 유일한 길(0003_org_core.sql:689-690)을 닫는다. 다른 열은 그대로
revoke insert (email), update (email) on public.people from authenticated;

-- ② CR-1(Q15·Q30) — 권한 있는 명단 행의 active 전환과 인물의 people.active 전환을 권한 이력에 남긴다.
--    명단 행: INSERT·DELETE 는 지금처럼 access_role 이 있는 행만, 전·후에 active 를 더 싣는다. UPDATE 는 access_role 이 바뀌거나 access_role 이
--    있는 행의 active 가 바뀌면 전·후 {access_role, active}(권한 없는 행의 active 전환은 기록하지 않는다 — 지금도 기록 대상이 아니다).
--    인물: active 가 바뀌면 그 인물의 access_role 이 있는 명단 행마다 project_access 1행(전·후 {person_active}). 원인 판정(① 워크스페이스
--    삭제 중 → 기록 안 함, ② 부모 삭제, ③ 연쇄, ④ 직접)은 그대로. 표시는 src/lib/domain/authzEvents.ts(계획 과제 18). 나머지 본문은
--    0012_settings.sql:984-1076 그대로
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
  v_pm record;
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

  -- 인물의 활성 전환(SP4 CR-1) — 명령 id·요약은 비운다: 한 명령이 인물과 같은 프로젝트의 명단 행을 함께 바꾸면 두 기록이 명령 원장 유일
  -- 인덱스(authz_events_command_uq)에서 같은 튜플이 되어 23505 로 명령 전체가 실패한다. 그래서 'commands' 범위에서는 이 분기를 남기지 않는다
  if tg_table_name = 'people' then
    if new.active is not distinct from old.active or c_scope = 'commands' then
      return null;
    end if;
    -- 원인 ① — 그 워크스페이스가 지워지는 중이면 기록하지 않는다
    if not exists (select 1 from public.workspaces w where w.id = new.workspace_id) then
      return null;
    end if;
    for v_pm in
      select pm.project_id from public.project_members pm
       where pm.person_id = new.id and pm.access_role is not null
       order by pm.project_id, pm.id
    loop
      v_parent_gone := not exists (select 1 from public.projects p where p.id = v_pm.project_id)
                    or (new.user_id is not null and not exists (select 1 from auth.users u where u.id = new.user_id));
      v_cause := case
        when v_parent_gone then 'parent_deleted'
        when pg_catalog.pg_trigger_depth() > 1 then 'cascade'
        else 'direct' end;
      insert into public.authz_events
        (kind, workspace_id, project_id, target_user_id, target_person_id, before, after, cause, actor_user_id, command_id, command_digest)
      values ('project_access', new.workspace_id, v_pm.project_id, new.user_id, new.id,
              pg_catalog.jsonb_build_object('person_active', old.active), pg_catalog.jsonb_build_object('person_active', new.active),
              v_cause, v_actor, null, null);
    end loop;
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
      v_after := pg_catalog.jsonb_build_object('access_role', new.access_role, 'access_granted_by', new.access_granted_by,
                                               'active', new.active);
    elsif tg_op = 'UPDATE' then
      -- 권한이 바뀌었거나, 권한 있는 행의 활성이 바뀌었을 때만(SP4 CR-1)
      if new.access_role is not distinct from old.access_role
         and (new.active is not distinct from old.active or new.access_role is null) then
        return null;
      end if;
      v_before := pg_catalog.jsonb_build_object('access_role', old.access_role, 'active', old.active);
      v_after := pg_catalog.jsonb_build_object('access_role', new.access_role, 'active', new.active);
    else
      if old.access_role is null then return null; end if;
      v_before := pg_catalog.jsonb_build_object('access_role', old.access_role, 'active', old.active);
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
drop trigger authz_events_record on public.project_members;
create trigger authz_events_record after insert or delete or update of access_role, active on public.project_members
  for each row execute function public.record_authz_event();
create trigger authz_events_record_people after update of active on public.people
  for each row execute function public.record_authz_event();

-- ②′ project_members_guard — person_id 불변(Q15). 명단 행의 person_id 는 세션 열 권한 밖이고 바꾸는 서버 경로도 없지만 기록 트리거의 열 목록
--    (update of access_role, active)에도 없다 — 바꾸는 길이 생기면 권한이 기록 없이 다른 사람에게 옮겨 간다. project_id 불변 검사 바로 뒤에
--    둔다(계정 없는 인물로의 변경도 PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT 보다 먼저 이 토큰으로 멈춘다). 나머지 본문은
--    0011_authz_hardening.sql:391-441 그대로
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
  if tg_op = 'UPDATE' and new.person_id is distinct from old.person_id then
    raise exception using errcode = '23514', message = 'PROJECT_MEMBER_PERSON_IMMUTABLE';
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

-- ③ CR-6·FN-3(Q15) — 늘 명시(explicit) 키(core.level_labels·modules.enabled)의 p_unset 과 p_set 의 JSON null 을 22023 CONFIG_INVALID:<키>
--    로 거부한다. v_next := (v_values - v_unset) || v_set 은 JSON null 을 값으로 넣고, 해석기가 그것을 미설정으로 풀면 modules.enabled 가
--    "토글 전부 켜짐"이 된다. 입력 확인이라 잠금 앞(create_project_with_settings 와 같은 토큰 꼴). 워크스페이스 RPC(modules.allowed unset
--    허용)는 고치지 않는다. 키 목록은 레지스트리의 explicit 키와 같다 — tests/settings/registry.test.ts 가 이 파일의 루프를 읽어 대조한다.
--    나머지 본문(격리 문자열·SETTINGS_ISOLATION 포함)은 0012_settings.sql:487-578 그대로
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
  -- 늘 명시 키(SP4 CR-6·FN-3) — unset 하거나 JSON null 을 넣으면 해석기가 미설정으로 풀어 기본값이 된다. 입력 확인이라 잠금 앞이다
  foreach k in array array['core.level_labels', 'modules.enabled'] loop
    if k = any(v_unset) or pg_catalog.jsonb_typeof(v_set -> k) = 'null' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || k;
    end if;
  end loop;
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

-- ④ 사후검사 — AUTHZ_CARRY_POSTCHECK. 읽기만 한다(롤백 절 없음)
do $$
declare
  v text;
begin
  -- ① 세션은 people.email 을 쓰지 못하고, 다른 열의 권한은 남는다
  if has_column_privilege('authenticated', 'public.people', 'email', 'INSERT')
     or has_column_privilege('authenticated', 'public.people', 'email', 'UPDATE') then
    raise exception 'AUTHZ_CARRY_POSTCHECK: authenticated 가 people.email 을 쓴다';
  end if;
  if not (has_column_privilege('authenticated', 'public.people', 'display_name', 'INSERT')
          and has_column_privilege('authenticated', 'public.people', 'display_name', 'UPDATE')) then
    raise exception 'AUTHZ_CARRY_POSTCHECK: people.display_name 의 열 권한까지 사라졌다';
  end if;

  -- ② 기록 트리거 둘 — 행 단위 AFTER 의 이벤트(명단 = INSERT·DELETE·UPDATE = 29, 인물 = UPDATE = 17)·열 목록·함수·활성(D·R 은 실패)
  select string_agg(x.tbl || '.' || x.name, ', ') into v
    from (values ('project_members', 'authz_events_record', 29, array['access_role', 'active']),
                 ('people', 'authz_events_record_people', 17, array['active'])) as x(tbl, name, tgtype, cols)
   where not exists (
     select 1 from pg_trigger g
      where g.tgrelid = ('public.' || x.tbl)::regclass and g.tgname = x.name and not g.tgisinternal
        and g.tgenabled in ('O', 'A') and g.tgtype = x.tgtype
        and g.tgfoid = 'public.record_authz_event()'::regprocedure
        and array(select a.attname::text from pg_attribute a
                   where a.attrelid = g.tgrelid and a.attnum = any(g.tgattr::int2[]) order by a.attname) = x.cols);
  if v is not null then raise exception 'AUTHZ_CARRY_POSTCHECK: 기록 트리거가 기대와 다르다: %', v; end if;

  -- ②·②′·③ 함수 본문의 새 분기(인물 분기·person_id 불변·명시 키 거부)와 지켜야 할 옛 문자열
  select string_agg(x.fn, ', ') into v
    from (values
      ('public.record_authz_event()', array['tg_table_name = ''people''', 'person_active', 'c_scope constant text := ''all''']),
      ('public.project_members_guard()', array['PROJECT_MEMBER_PERSON_IMMUTABLE', 'PROJECT_MEMBER_PROJECT_IMMUTABLE']),
      ('public.apply_project_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text)',
       array['foreach k in array array[''core.level_labels'', ''modules.enabled''] loop',
             'pg_catalog.jsonb_typeof(v_set -> k) = ''null''', 'SETTINGS_ISOLATION'])) as x(fn, needles)
    join pg_proc p on p.oid = x.fn::regprocedure
   where exists (select 1 from unnest(x.needles) as n(needle) where position(n.needle in p.prosrc) = 0);
  if v is not null then raise exception 'AUTHZ_CARRY_POSTCHECK: 함수 본문에 새 분기가 없다: %', v; end if;

  -- EXECUTE 기대표 무변화(0012 ⑫ 꼴) — create or replace 는 ACL 을 그대로 둔다
  select string_agg(format('%s:%s=%s', e.fn, e.role, not e.want), ', ') into v
    from (
      select f.fn, r.role, (r.role = 'service_role' and f.service) as want
        from (values
          ('public.record_authz_event()', false),
          ('public.project_members_guard()', false),
          ('public.apply_project_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text)', true)) as f(fn, service)
       cross join unnest(array['anon', 'authenticated', 'service_role']) as r(role)) e
   where has_function_privilege(e.role, e.fn::regprocedure, 'EXECUTE') is distinct from e.want
     and not (e.role = 'service_role' and not e.want);   -- 트리거 함수의 service_role 은 기본 권한이 준 대로 둔다(§3.1)
  if v is not null then raise exception 'AUTHZ_CARRY_POSTCHECK: 함수 EXECUTE 가 기대와 다르다: %', v; end if;
end $$;
