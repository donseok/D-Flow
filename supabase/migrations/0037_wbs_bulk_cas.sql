-- SPU3: 검토한 revision에서 항목별 원자 저장. 새 테이블 없이 기존 이력/팀을 사용한다.
begin;

create function public.apply_wbs_bulk_item(
  p_project_id uuid, p_actor uuid, p_item_id uuid,
  p_expected_updated_at timestamptz, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '15s' as $$
declare
  v_item public.wbs_items%rowtype;
  v_start date;
  v_end date;
  v_member uuid;
  v_team uuid;
  v_workspace uuid;
  v_key text;
  v_old text;
  v_new text;
  v_now timestamptz := clock_timestamp();
begin
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    return jsonb_build_object('ok', false, 'reason', 'permission');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('planned_start','planned_end','deliverable','biz','assignee_member_id','team_code'))
     or exists (select 1 from jsonb_each(p_patch) e where jsonb_typeof(e.value) not in ('string','null')) then
    return jsonb_build_object('ok', false, 'reason', 'validation');
  end if;
  select * into v_item from public.wbs_items where id = p_item_id and project_id = p_project_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'validation'); end if;
  if v_item.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;
  v_start := case when p_patch ? 'planned_start' then (p_patch->>'planned_start')::date else v_item.planned_start end;
  v_end := case when p_patch ? 'planned_end' then (p_patch->>'planned_end')::date else v_item.planned_end end;
  if v_start > v_end then return jsonb_build_object('ok', false, 'reason', 'validation'); end if;
  if (p_patch ? 'planned_start' or p_patch ? 'planned_end') and (v_start is null or v_end is null)
     and exists (select 1 from public.task_dependencies where predecessor_id = p_item_id or successor_id = p_item_id) then
    return jsonb_build_object('ok', false, 'reason', 'dependency');
  end if;
  v_member := case when p_patch ? 'assignee_member_id' then (p_patch->>'assignee_member_id')::uuid else v_item.assignee_member_id end;
  if p_patch ? 'assignee_member_id' and v_member is not null and not exists (
    select 1 from public.project_members m join public.people p on p.id = m.person_id
      where m.id = v_member and m.project_id = p_project_id and m.active and p.active
  ) then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if p_patch ? 'team_code' and p_patch->>'team_code' is not null then
    select workspace_id into v_workspace from public.projects where id = p_project_id;
    -- 공용/전용 팀의 허용 관계는 기존 item_owners scope 트리거가 다시 검증한다.
    select id into v_team from public.teams where workspace_id = v_workspace and code = p_patch->>'team_code'
      and active and (project_id = p_project_id or project_id is null)
      order by project_id nulls last limit 1 for share;
    if not found then return jsonb_build_object('ok', false, 'reason', 'team'); end if;
  end if;
  -- 팀·이력·본체 갱신 실패는 이 블록 전체를 되돌린다. 부분 성공을 반환하지 않는다.
  if p_patch ? 'team_code' then
    select string_agg(t.code, ', ' order by t.code) into v_old from public.item_owners o join public.teams t on t.id = o.team_id
      where o.wbs_item_id = p_item_id and o.kind = 'primary';
    delete from public.item_owners where wbs_item_id = p_item_id and kind = 'primary';
    if v_team is not null then
      insert into public.item_owners(wbs_item_id, team_id, kind) values(p_item_id, v_team, 'primary')
        on conflict(wbs_item_id, team_id) do update set kind = 'primary';
    end if;
    if v_old is distinct from p_patch->>'team_code' then
      insert into public.change_logs(user_id, wbs_item_id, field, old_value, new_value)
        values(p_actor, p_item_id, 'owners', v_old, p_patch->>'team_code');
    end if;
  end if;
  foreach v_key in array array['planned_start','planned_end','deliverable','biz','assignee_member_id'] loop
    if p_patch ? v_key then
      v_old := to_jsonb(v_item)->>v_key;
      v_new := p_patch->>v_key;
      if v_old is distinct from v_new then
        insert into public.change_logs(user_id, wbs_item_id, field, old_value, new_value)
          values(p_actor, p_item_id, v_key, v_old, v_new);
      end if;
    end if;
  end loop;
  if p_patch <> '{}'::jsonb then
    update public.wbs_items set planned_start = v_start, planned_end = v_end,
      deliverable = case when p_patch ? 'deliverable' then p_patch->>'deliverable' else deliverable end,
      biz = case when p_patch ? 'biz' then p_patch->>'biz' else biz end,
      assignee_member_id = v_member, updated_at = v_now
      where id = p_item_id;
  end if;
  return jsonb_build_object('ok', true, 'updated_at', v_now);
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or check_violation or foreign_key_violation then
    return jsonb_build_object('ok', false, 'reason', 'validation');
end $$;

-- 화면이 확인한 revision을 행 잠금 아래 대조한 다음 기존 승인/잠금/크레딧 판정을 그대로 실행한다.
create function public.apply_workflow_event_cas(
  p_project_id uuid, p_actor uuid, p_item_id uuid, p_expected_updated_at timestamptz,
  p_stage text, p_expected_step text default null
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '15s' as $$
declare v_updated_at timestamptz;
begin
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    return jsonb_build_object('ok', false, 'reason', 'approval_forbidden');
  end if;
  select updated_at into v_updated_at from public.wbs_items where id = p_item_id and project_id = p_project_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'item_not_found'); end if;
  if v_updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'conflict', true);
  end if;
  return public.apply_workflow_event(p_event => 'set_stage', p_actor => p_actor, p_item_id => p_item_id,
    p_stage => p_stage, p_expected_step => p_expected_step);
end $$;

revoke all on function public.apply_wbs_bulk_item(uuid,uuid,uuid,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.apply_wbs_bulk_item(uuid,uuid,uuid,timestamptz,jsonb) to service_role;
revoke all on function public.apply_workflow_event_cas(uuid,uuid,uuid,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.apply_workflow_event_cas(uuid,uuid,uuid,timestamptz,text,text) to service_role;
commit;
