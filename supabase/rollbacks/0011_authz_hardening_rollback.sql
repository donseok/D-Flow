-- 0011_authz_hardening 롤백 — 0010 적용 직후로 정확히 돌아간다(카탈로그 0 mismatch: supabase/rehearsal/compare-catalog.mjs diff,
-- pg_default_acl 대조 — 계획 docs/superpowers/plans/2026-09-27-h2-authz-hardening.md 의 리허설 R).
-- 절은 정방향의 역순이다(각 과제가 begin; 바로 아래에 자기 절을 끼웠다).
-- 데이터는 되돌리지 않는다: ④ 트리거가 null 로 만든 access_role, ⑤ 가드가 찍은 access_granted_by, ⑧ 가드가 덮어쓴 size·mime 은
-- 그대로 남는다(0010 규칙도 만족하는 값이다).
-- 적용 전: 앱이 apply_workflow_event 에 p_expected_report_id 를 넘기는 커밋(H2 과제 17)이 배포돼 있으면 그 커밋을 먼저 되돌린다 —
-- 이 롤백 뒤에는 7-인자 함수만 남아 여덟째 인자를 넘기는 승인·반려 호출이 모두 '함수 없음'으로 실패한다.
-- 적용 뒤: supabase_migrations.schema_migrations 의 0011 행은 남는다(이 파일은 건드리지 않는다) — 행이 남은 채로는
-- supabase migration up 이 0011 을 다시 적용하지 않는다. 로컬은 이어서 npm run db:reset 을 돌린다(docs/runbook-rollback.md §1 의 3).

begin;

-- ⑩ 실적 100 잠금 절 — 트리거 제거
drop trigger guard_workflow_actual on public.wbs_items;
drop function public.guard_workflow_actual();

-- ⑨ 보고 id 대조(i) — 새 시그니처를 지우고 0000 원문과 ACL 을 되돌린다
drop function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid);
CREATE FUNCTION public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_agent_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare
  c_default constant jsonb := '{"default":{"as":0,"ip":30,"rw":50,"im":80,"xx":100}}'::jsonb;
  -- record 대신 스칼라를 쓴다: 항목이 지워진 주문처럼 SELECT INTO 를 건너뛴 경로에서 미할당 record 의
  -- 필드를 참조하면 CASE 의 안 타는 분기라도 "record is not assigned yet" 로 실패한다.
  v_is_order_event boolean;
  v_order_status text;
  v_order_claimed_by text;
  v_order_claimed_by_user uuid;
  v_order_item uuid;
  v_item_id uuid;
  v_item_found boolean := false;
  v_project_id uuid;
  v_old_stage text;
  v_old_pct numeric;
  v_dev_workflow boolean;
  v_tags text[];
  v_is_leaf boolean := false;
  v_expect text;
  v_next text;
  v_apply boolean := false;
  v_new_stage text;
  v_credit_key text;
  v_credits jsonb;
  v_table jsonb;
  v_new_pct numeric;
  v_skipped text;
  v_stage_changed boolean := false;
  v_actual_changed boolean := false;
  v_reached_first boolean := false;
  v_stub_pending boolean := false;
  v_now timestamptz := now();
begin
  if p_event is null or p_event not in ('assign','unassign','claim','report_completion','approve','unapprove','reject','rework','release','set_stage') then
    return jsonb_build_object('ok', false, 'reason', 'bad_event');
  end if;
  v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release');

  -- 주문 사건: 주문을 잠그고 사건이 정한 기대 status·점유자 조건으로 CAS
  if v_is_order_event then
    if p_order_id is null then
      return jsonb_build_object('ok', false, 'reason', 'order_required');
    end if;
    select status, claimed_by, claimed_by_user_id, wbs_item_id
      into v_order_status, v_order_claimed_by, v_order_claimed_by_user, v_order_item
      from public.agent_work_orders where id = p_order_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'order_not_found');
    end if;
    if p_item_id is not null and v_order_item is distinct from p_item_id then
      return jsonb_build_object('ok', false, 'reason', 'order_item_mismatch');
    end if;
    v_item_id := v_order_item;
    v_expect := case p_event
      when 'claim' then 'ready'
      when 'report_completion' then 'claimed'
      when 'release' then 'claimed'
      when 'approve' then 'reported'
      when 'reject' then 'reported'
      when 'unapprove' then 'approved'
      when 'rework' then 'approved' end;
    v_next := case p_event
      when 'claim' then 'claimed'
      when 'report_completion' then 'reported'
      when 'release' then 'ready'
      when 'approve' then 'approved'
      when 'reject' then 'claimed'
      when 'unapprove' then 'reported'
      when 'rework' then 'claimed' end;
    if v_order_status <> v_expect
       or (p_event in ('report_completion','release') and p_agent_user_id is not null and v_order_claimed_by_user is distinct from p_agent_user_id)
       or (p_event in ('report_completion','release') and p_agent is not null and v_order_claimed_by is distinct from p_agent)
    then
      return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
    end if;
  else
    if p_item_id is null then
      return jsonb_build_object('ok', false, 'reason', 'item_required');
    end if;
    v_item_id := p_item_id;
  end if;

  -- 항목 잠금. 주문 사건에서 항목이 지워진 주문이면 단계·실적만 건너뛴다(주문 전이는 한다).
  if v_item_id is not null then
    select project_id, stage, actual_pct, dev_workflow, tags
      into v_project_id, v_old_stage, v_old_pct, v_dev_workflow, v_tags
      from public.wbs_items where id = v_item_id for update;
    v_item_found := found;
    if v_item_found then
      -- stub_for 하위(스텁 제거 Task)는 구조에 투명하다(스펙 F9) — 후행은 계속 리프다.
      v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);
    elsif not v_is_order_event then
      return jsonb_build_object('ok', false, 'reason', 'item_not_found');
    end if;
  elsif not v_is_order_event then
    return jsonb_build_object('ok', false, 'reason', 'item_required');
  end if;

  -- 스텁 잔존(스펙 F6·F13) — forceProgress.pendingStubs 와 같은 조건. 승인과 사람의 xx 지정을 주문 갱신 전에 거부한다.
  if v_item_found then
    v_stub_pending := exists (select 1 from public.wbs_items
      where parent_id = v_item_id and stub_for is not null and stage is distinct from 'xx');
  end if;
  if v_stub_pending and (p_event = 'approve' or (p_event = 'set_stage' and p_stage = 'xx')) then
    return jsonb_build_object('ok', false, 'reason', 'stub_pending', 'order_status', v_order_status);
  end if;

  -- 주문 갱신
  if v_is_order_event then
    if p_event = 'claim' then
      update public.agent_work_orders
         set status = 'claimed', claimed_by = p_agent, claimed_by_user_id = p_agent_user_id,
             claimed_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'release' then
      update public.agent_work_orders
         set status = 'ready', claimed_by = null, claimed_by_user_id = null, claimed_at = null,
             last_heartbeat_at = null, heartbeat_phase = null, heartbeat_agent = null, heartbeat_note = null,
             updated_at = v_now
       where id = p_order_id;
    else
      update public.agent_work_orders set status = v_next, updated_at = v_now where id = p_order_id;
    end if;
  end if;

  -- 단계·실적 결정(스펙 §3.4·§4.2)
  if v_is_order_event then
    -- 주문의 존재가 워크플로 증거 — dev_workflow 를 보지 않는다(구 force 의 일반화). 리프에만.
    if not v_item_found then v_skipped := 'no_item';
    elsif not v_is_leaf then v_skipped := 'parent';
    else
      v_apply := true;
      v_new_stage := case p_event
        when 'claim' then 'ip' when 'report_completion' then 'im' when 'approve' then 'xx'
        when 'unapprove' then 'im' when 'reject' then 'ip' when 'rework' then 'ip' when 'release' then 'as' end;
      v_credit_key := case p_event
        when 'claim' then 'ip' when 'report_completion' then 'im' when 'approve' then 'xx'
        when 'unapprove' then 'im' when 'reject' then 'rw' when 'rework' then 'rw' when 'release' then 'as' end;
    end if;
  elsif p_event = 'assign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif not v_is_leaf then v_skipped := 'parent';
    elsif v_old_stage is not null then v_skipped := 'stage';
    else v_apply := true; v_new_stage := 'as'; v_credit_key := 'as';
    end if;
  elsif p_event = 'unassign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif v_old_stage is distinct from 'as' then v_skipped := 'stage';
    else v_apply := true; v_new_stage := null; v_credit_key := null;
    end if;
  else -- set_stage
    if p_stage is not null and p_stage not in ('as','ip','im','xx') then
      return jsonb_build_object('ok', false, 'reason', 'bad_stage');
    end if;
    -- 잠금(위임됨 ∨ 에이전트가 주문을 쥠)이면 해제(null)도 거부 — 단계는 승인·반려로만 바뀐다(§3.5).
    -- ready 는 넣지 않는다: dev_workflow 리프마다 배정과 무관하게 상주한다. 조건은 agentWork.stageLockedForHuman 과 같다.
    if 'agent' = any(coalesce(v_tags, '{}'::text[]))
       or exists (select 1 from public.agent_work_orders
                   where wbs_item_id = v_item_id and status in ('claimed','reported')) then
      return jsonb_build_object('ok', false, 'reason', 'locked');
    end if;
    if p_stage is null then
      -- 해제는 워크플로·리프와 무관하게 허용(잘못 찍힌 값을 지울 길). 실적 불변.
      v_apply := true; v_new_stage := null; v_credit_key := null;
    else
      if v_dev_workflow is not true then return jsonb_build_object('ok', false, 'reason', 'not_workflow'); end if;
      if not v_is_leaf then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
      v_apply := true; v_new_stage := p_stage; v_credit_key := p_stage;
    end if;
  end if;

  if v_apply then
    if v_credit_key = 'xx' then
      v_new_pct := 100;
    elsif v_credit_key is not null then
      select stage_credits into v_credits from public.project_settings where project_id = v_project_id;
      v_credits := coalesce(v_credits, c_default);
      -- 표는 하나다(2026-09-16) — 항목 credit_key 로 고르지 않는다.
      v_table := coalesce(v_credits -> 'default', c_default -> 'default');
      v_new_pct := coalesce((v_table ->> v_credit_key)::numeric, (c_default -> 'default' ->> v_credit_key)::numeric);
    end if;
    if v_new_stage is distinct from v_old_stage then
      v_stage_changed := true;
      v_reached_first := coalesce(v_new_stage in ('im','xx'), false) and not coalesce(v_old_stage in ('im','xx'), false);
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'stage', v_old_stage, v_new_stage);
    end if;
    if v_new_pct is not null and v_new_pct is distinct from v_old_pct then
      v_actual_changed := true;
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'actual_pct', v_old_pct::text, v_new_pct::text);
    end if;
    if v_stage_changed or v_actual_changed then
      update public.wbs_items
         set stage = case when v_stage_changed then v_new_stage else stage end,
             actual_pct = case when v_actual_changed then v_new_pct else actual_pct end,
             updated_at = v_now
       where id = v_item_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_status', case when v_is_order_event then v_next end,
    'stage', case when v_stage_changed then v_new_stage else v_old_stage end,
    'actual_pct', case when v_actual_changed then v_new_pct else v_old_pct end,
    'stage_changed', v_stage_changed,
    'actual_changed', v_actual_changed,
    'reached_first', v_reached_first,
    'skipped', v_skipped);
end;
$$;
revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role;

-- ⑧ 첨부 가드(h) — 트리거·인덱스 제거, UPDATE 권한·정책 복구(0007:127-130)
drop trigger minute_files_attachment_guard on public.minute_files;
drop function public.minute_files_attachment_guard();
drop index public.minute_files_attachment_path_uidx;
grant update on public.minute_files to authenticated;
create policy attachment_update_minute_files on public.minute_files for update to authenticated
  using (role = 'attachment' and public.can_manage_minute(minute_id))
  with check (role = 'attachment' and public.can_manage_minute(minute_id));

-- ⑦ 회의록 버킷(g) — 새 정책·RPC 제거, 두 정책을 0007 원문으로
drop function public.attachment_object_exists(text, uuid);
drop policy "minute-files delete" on storage.objects;
drop policy "minute-files insert" on storage.objects;
drop policy "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated using (
  bucket_id = 'minutes' and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (owner = auth.uid() or public.is_ws_admin(public.storage_ws(name)))
  and not exists (select 1 from public.minute_versions mv where mv.file_path = objects.name));
drop policy "minutes bucket insert" on storage.objects;
create policy "minutes bucket insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'minutes' and split_part(name, '/', 5) in ('minutes', 'minute-files')
  and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (public.storage_project(name) is null
       or exists (select 1 from public.projects p
                   where p.id = public.storage_project(objects.name) and p.workspace_id = public.storage_ws(objects.name)
                     and public.is_project_member(p.id))));

-- ⑥ can_manage_minute(f) — 0007 원문으로, 새 헬퍼 제거(can_manage_minute 를 먼저 되돌려야 의존이 풀린다)
create or replace function public.can_manage_minute(p_minute uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.minutes mi
                  where mi.id = p_minute and mi.archived_at is null
                    and mi.workspace_id in (select public.my_workspace_ids())
                    and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
                         or (mi.project_id is not null and public.is_project_admin(mi.project_id))))
$$;
drop function public.has_project_role_in_ws(uuid);

-- ⑤ access_granted_*(e) — 열 INSERT 를 걷고 표 INSERT·열 UPDATE 를 되돌린다, 가드를 0010 원문으로
revoke insert (id, project_id, title, created_at, role_label, person_id, access_role, active, sort_order, updated_at)
  on public.project_members from authenticated;
grant insert on public.project_members to authenticated;
grant update (access_granted_by, access_granted_at) on public.project_members to authenticated;
create or replace function public.project_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_person_ws uuid;
  v_person_user uuid;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    -- 담당 FK 가 (id, project_id) 복합이라 바꾸면 FK 가 깨진다
    raise exception using errcode = '23514', message = 'PROJECT_MEMBER_PROJECT_IMMUTABLE';
  end if;

  select pe.workspace_id, pe.user_id into v_person_ws, v_person_user
    from public.people pe where pe.id = new.person_id;
  if found then
    if new.access_role is not null and v_person_user is null then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT';
    end if;
    if v_person_ws is distinct from public.project_ws(new.project_id) then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_CROSS_WORKSPACE';
    end if;
  end if;
  -- 인물이 없으면 person_id FK 가 거부한다

  if tg_op = 'INSERT' then
    new.access_granted_at := case when new.access_role is not null then now() end;
  else
    if new.access_role is distinct from old.access_role then
      new.access_granted_at := now();
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;

-- ④ 소속 회수(d) — 트리거 제거, workspace_members UPDATE 복구(열 grant 를 먼저 걷는다), 두 함수를 0010 원문으로
drop trigger workspace_members_revoke_access on public.workspace_members;
drop function public.workspace_members_revoke_access();
revoke update (role) on public.workspace_members from authenticated;
grant update on public.workspace_members to authenticated;
create or replace function public.project_members_no_self_demote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or old.access_role is null then
    return new;
  end if;
  if (new.access_role is null
      or (old.access_role = 'admin' and new.access_role = 'member')
      or (old.active and not new.active))
     and exists (select 1 from public.people pe where pe.id = old.person_id and pe.user_id = auth.uid())
     and not public.is_ws_admin(public.project_ws(old.project_id)) then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_SELF_DEMOTE';
  end if;
  return new;
end
$$;
create or replace function public.upsert_project_member(
  p_actor uuid, p_project_id uuid, p_person jsonb, p_member jsonb, p_team_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_ws_admin boolean;
  v_person_id uuid;
  v_person_ws uuid;
  v_person_user uuid;
  v_person_name text;
  v_name text := nullif(btrim(p_person->>'display_name'), '');
  v_email text := nullif(lower(btrim(p_person->>'email')), '');
  v_member_id uuid;
  v_old_access text;
  v_old_active boolean;
  v_new_access text;
  v_new_active boolean;
  v_primary uuid;
begin
  if p_actor is null or p_project_id is null or p_person is null then
    raise exception using errcode = '22023', message = 'PROJECT_MEMBER_INVALID_INPUT';
  end if;
  p_member := coalesce(p_member, '{}'::jsonb);

  -- ① 호출자 등급
  v_ws := public.project_ws(p_project_id);
  if v_ws is null then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  v_ws_admin := exists (select 1 from public.platform_admins a where a.user_id = p_actor)
             or exists (select 1 from public.workspace_members m
                         where m.workspace_id = v_ws and m.user_id = p_actor and m.role = 'admin');
  if not v_ws_admin and not exists (
       select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
        where pm.project_id = p_project_id and pe.user_id = p_actor
          and pm.active and pe.active and pm.access_role = 'admin') then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_FORBIDDEN';
  end if;

  -- ② 인물 확정: id 우선, 없으면 (workspace_id, email) 매치, 없으면 insert
  if nullif(p_person->>'id', '') is not null then
    select pe.id, pe.workspace_id, pe.user_id, pe.display_name
      into v_person_id, v_person_ws, v_person_user, v_person_name
      from public.people pe where pe.id = (p_person->>'id')::uuid
       for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'PERSON_NOT_FOUND';
    end if;
    if v_person_ws <> v_ws then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_CROSS_WORKSPACE';
    end if;
    -- 개명은 id 로 행을 지목한 편집에서만, 그것도 people_update 정책과 같은 선에서만(0004): 워크스페이스 관리자 이상이거나
    -- 그 인물이 이번 upsert 전부터 호출자가 관리자인 프로젝트의 명단에 있을 때. 아니면 이름은 두고 명단 쓰기만 진행한다.
    if v_name is not null and v_name is distinct from v_person_name
       and (v_ws_admin or exists (
             select 1 from public.project_members pm
              where pm.person_id = v_person_id
                and exists (select 1 from public.project_members apm join public.people ape on ape.id = apm.person_id
                             where apm.project_id = pm.project_id and ape.user_id = p_actor
                               and apm.active and ape.active and apm.access_role = 'admin'))) then
      update public.people set display_name = v_name, updated_at = now() where id = v_person_id;
    end if;
  else
    if v_name is null then
      raise exception using errcode = '22023', message = 'PERSON_NAME_REQUIRED';
    end if;
    if v_email is not null then
      insert into public.people (workspace_id, display_name, email)
      values (v_ws, v_name, v_email)
      on conflict (workspace_id, email) where email is not null do nothing
      returning id, user_id, display_name into v_person_id, v_person_user, v_person_name;
      -- 이미 있는 인물이면 가리키기만 한다 — 이름은 그 인물의 것이라 입력 이름으로 덮지 않는다(0004)
      if not found then
        select pe.id, pe.user_id, pe.display_name into v_person_id, v_person_user, v_person_name
          from public.people pe where pe.workspace_id = v_ws and pe.email = v_email
           for update;
      end if;
    else
      insert into public.people (workspace_id, display_name)
      values (v_ws, v_name)
      returning id, user_id, display_name into v_person_id, v_person_user, v_person_name;
    end if;
  end if;

  -- ③ 기존 명단 행
  select pm.id, pm.access_role, pm.active into v_member_id, v_old_access, v_old_active
    from public.project_members pm
   where pm.project_id = p_project_id and pm.person_id = v_person_id
     for update;

  v_new_access := case when p_member ? 'access_role' then p_member->>'access_role' else v_old_access end;
  v_new_active := case when p_member ? 'active' then coalesce((p_member->>'active')::boolean, true)
                       else coalesce(v_old_active, true) end;

  -- ④ 규칙
  -- 본인 행의 권한 회수 금지(마지막 관리자 소실 방지). 워크스페이스 관리자는 승계로 항상 관리자라 예외.
  -- 관리자 슬롯 검사보다 먼저 본다 — 비-워크스페이스 관리자인 호출자의 본인 행은 늘 admin 이라, 순서가 반대면
  -- 본인 강등이 언제나 ADMIN_SLOT 으로 보고되고 SELF_DEMOTE 는 도달하지 못한다.
  if v_member_id is not null and v_person_user = p_actor and v_old_access is not null
     and (v_new_access is null
          or (v_old_access = 'admin' and v_new_access = 'member')
          or (v_old_active and not v_new_active))
     and not v_ws_admin then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_SELF_DEMOTE';
  end if;
  -- 관리자 행(새 값 또는 기존 값이 admin)은 워크스페이스 관리자 이상만 — RLS admin_write_member_rows 와 같은 선
  -- (프로젝트 관리자는 admin 행의 표시 필드도 고치지 못한다. 세션 경로와 service_role 경로가 같은 답을 내게 한다).
  if (v_new_access = 'admin' or v_old_access = 'admin') and not v_ws_admin then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_ADMIN_SLOT';
  end if;

  -- ⑤ upsert
  if v_member_id is null then
    insert into public.project_members
      (project_id, person_id, access_role, role_label, title, active, sort_order, access_granted_by)
    values
      (p_project_id, v_person_id, v_new_access, p_member->>'role_label', p_member->>'title', v_new_active,
       coalesce((p_member->>'sort_order')::int, 0),
       case when v_new_access is not null then p_actor end)
    returning id into v_member_id;
  else
    update public.project_members pm
       set access_role = v_new_access,
           role_label = case when p_member ? 'role_label' then p_member->>'role_label' else pm.role_label end,
           title = case when p_member ? 'title' then p_member->>'title' else pm.title end,
           active = v_new_active,
           sort_order = case when p_member ? 'sort_order' then coalesce((p_member->>'sort_order')::int, 0)
                             else pm.sort_order end,
           access_granted_by = case when v_new_access is distinct from v_old_access then p_actor
                                    else pm.access_granted_by end
     where pm.id = v_member_id;
  end if;

  -- ⑥ 팀 동기화 — 결과는 p_team_ids 와 같은 집합이고, 첫 비-null 원소만 대표(is_primary), 나머지는 기존 행이던 것까지
  -- 전부 대표 아님. 대표를 먼저 내리고(부분 유니크 project_member_teams_primary_uidx) upsert 가 모든 행의 is_primary 를 다시 쓴다.
  if p_team_ids is not null then
    select x.team_id into v_primary
      from unnest(p_team_ids) with ordinality as x(team_id, ord)
     where x.team_id is not null
     order by x.ord limit 1;
    delete from public.project_member_teams pmt
     where pmt.member_id = v_member_id
       and not (pmt.team_id = any (array_remove(p_team_ids, null)));
    update public.project_member_teams pmt
       set is_primary = false
     where pmt.member_id = v_member_id and pmt.is_primary and pmt.team_id is distinct from v_primary;
    insert into public.project_member_teams (member_id, team_id, is_primary)
    select distinct v_member_id, x.team_id, x.team_id = v_primary
      from unnest(p_team_ids) as x(team_id)
     where x.team_id is not null
    on conflict (member_id, team_id) do update set is_primary = excluded.is_primary;
  end if;

  -- ⑦
  return v_member_id;
end
$$;
revoke all on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) to service_role;

-- ③ minutes 열 권한(c) — 열 단위 grant 를 걷고 표 SELECT 를 되돌린다(열 grant 가 남으면 카탈로그가 다르다)
revoke select (id, minute_date, team_code, title, body_md, meeting_id, created_by, created_by_name, created_at, updated_at,
               share_enabled, external_id, body_preview, folder_id, project_id, meeting_occurrence_date, archived_at, workspace_id)
  on public.minutes from authenticated;
grant select on public.minutes to authenticated;

-- ② 쓰지 않는 표 권한(b) — 0010 의 권한 목록으로 복구(anon 41표 x·t·m, authenticated 40표 D·x·t·m, 명령 단위 DML 13표, 기본 권한)
grant insert, update, delete on public.agent_lead_leases to authenticated;
grant insert, update, delete on public.agent_watchers to authenticated;
grant update, delete on public.change_logs to authenticated;
grant update on public.deliverable_attachments to authenticated;
grant update on public.issue_assignees to authenticated;
grant insert, update, delete on public.minute_embeddings to authenticated;
grant update on public.minute_highlights to authenticated;
grant insert, update, delete on public.minute_insights to authenticated;
grant insert, delete on public.profiles to authenticated;
grant insert, update, delete on public.project_ai_briefs to authenticated;
grant delete on public.teams to authenticated;
grant insert, update, delete on public.wbs_embeddings to authenticated;
grant insert, update, delete on public.workspaces to authenticated;
grant truncate, references, trigger, maintain on
  public.agent_lead_leases, public.agent_watchers, public.announcement_seen, public.announcements, public.area_teams,
  public.attendance_records, public.change_logs, public.deliverable_attachments, public.holidays, public.issue_assignees,
  public.issues, public.item_owners, public.llm_config, public.llm_profiles, public.meeting_attendees, public.meeting_exceptions,
  public.meetings, public.minute_embeddings, public.minute_favorites, public.minute_folders, public.minute_highlights,
  public.minute_insights, public.platform_admins, public.profiles, public.project_ai_briefs, public.project_areas,
  public.project_member_teams, public.project_members, public.projects, public.task_dependencies, public.teams,
  public.user_preferences, public.user_wbs_state, public.wbs_embeddings, public.wbs_items, public.wbs_progress_snapshots,
  public.weekly_report_rows, public.weekly_reports, public.workspace_members, public.workspaces
  to authenticated;
grant references, trigger, maintain on
  public.agent_lead_leases, public.agent_watchers, public.announcement_seen, public.announcements, public.area_teams,
  public.attendance_records, public.change_logs, public.deliverable_attachments, public.holidays, public.issue_assignees,
  public.issues, public.item_owners, public.llm_config, public.llm_profiles, public.meeting_attendees, public.meeting_exceptions,
  public.meetings, public.minute_embeddings, public.minute_favorites, public.minute_folders, public.minute_highlights,
  public.minute_insights, public.people, public.platform_admins, public.profiles, public.project_ai_briefs, public.project_areas,
  public.project_member_teams, public.project_members, public.projects, public.task_dependencies, public.teams,
  public.user_preferences, public.user_wbs_state, public.wbs_embeddings, public.wbs_items, public.wbs_progress_snapshots,
  public.weekly_report_rows, public.weekly_reports, public.workspace_members, public.workspaces
  to anon;
alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to authenticated;
alter default privileges for role postgres in schema public grant references, trigger, maintain on tables to anon;

-- ① 마지막 슈퍼유저(a) — 트리거 제거, 세션 쓰기 권한·정책 복구(0003:641-645)
drop trigger platform_admins_keep_last on public.platform_admins;
drop function public.platform_admins_keep_last();
grant insert, update, delete, truncate on public.platform_admins to authenticated;
create policy platform_admins_write on public.platform_admins to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

commit;
