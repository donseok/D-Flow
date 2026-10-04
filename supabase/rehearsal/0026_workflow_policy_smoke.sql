-- *_workflow_policy 적용 뒤(재적용 뒤에도) 실행한다. 어떤 DB 에서도 돈다(리프·사용자가 있으면 그 행으로 더 본다). 모든 변경은 rollback 된다.
-- ① 이행: im·xx 는 라운드 1·{review}, 나머지 0·null ② 키 없는 프로젝트는 현행 — 기본 1단계에서 사람 xx 지정이 라운드를 열고 원장 한 행(via=set_stage)
-- ③ 2단계 설정 — im 진입 스냅샷·첫 승인 뒤 im 유지(remaining 1)·둘째 뒤 xx·100 ④ 2단계에서 xx 직행 approval_required
-- ⑤ 대기 라운드의 단계 삭제는 SETTINGS_CODE_IN_USE(pending_round) ⑥ 크레딧 표 손상은 22023(c_default 로 풀지 않는다)
begin;
do $$
declare
  p uuid;
  leaf uuid;
  admin_user uuid;
  r jsonb;
begin
  if exists (select 1 from public.wbs_items where (stage in ('im', 'xx')) <> (review_steps is not null)) then
    raise exception 'WORKFLOW_POLICY_SMOKE: 라운드 이행이 stage 와 맞지 않다';
  end if;
  -- 리프 하나와 그 프로젝트의 관리자(플랫폼 관리자면 어디서나 관리자다)
  select w.id, w.project_id into leaf, p
    from public.wbs_items w
   where not exists (select 1 from public.wbs_items c where c.parent_id = w.id)
     and not exists (select 1 from public.agent_work_orders o where o.wbs_item_id = w.id and o.status in ('claimed', 'reported'))
   order by w.id limit 1;
  select a.user_id into admin_user from public.platform_admins a order by a.user_id limit 1;
  if leaf is null or admin_user is null then raise notice 'WORKFLOW_POLICY_SMOKE: 리프·관리자 없음 — 이행만 확인'; return; end if;
  update public.project_settings set "values" = "values" - 'workflow.approval_steps' - 'workflow.predecessor_gate' where project_id = p;
  update public.wbs_items set dev_workflow = true, tags = '{}', stage = 'ip', review_round = 0, review_steps = null where id = leaf;
  r := public.apply_workflow_event(p_event => 'set_stage', p_actor => admin_user, p_item_id => leaf, p_stage => 'xx');
  if r ->> 'ok' <> 'true' or r ->> 'stage' <> 'xx' then raise exception 'WORKFLOW_POLICY_SMOKE: 기본 1단계 xx 지정 실패: %', r; end if;
  if (select count(*) from public.wbs_stage_approvals where wbs_item_id = leaf and via = 'set_stage' and revoked_at is null) <> 1 then
    raise exception 'WORKFLOW_POLICY_SMOKE: 기본 1단계 xx 지정의 원장 행이 하나가 아니다';
  end if;
  -- 2단계
  update public.project_settings set "values" = "values" || '{"workflow.approval_steps":[{"code":"internal","label":"내부 검토","approver":"subtree_or_admin"},{"code":"client","label":"고객 승인","approver":"admin"}]}'::jsonb
   where project_id = p;
  update public.wbs_items set stage = 'ip', review_steps = null where id = leaf;
  r := public.apply_workflow_event(p_event => 'set_stage', p_actor => admin_user, p_item_id => leaf, p_stage => 'xx');
  if r ->> 'reason' is distinct from 'approval_required' then raise exception 'WORKFLOW_POLICY_SMOKE: 2단계 xx 직행이 막히지 않았다: %', r; end if;
  r := public.apply_workflow_event(p_event => 'set_stage', p_actor => admin_user, p_item_id => leaf, p_stage => 'im');
  if (select review_steps from public.wbs_items where id = leaf) <> array['internal', 'client'] then raise exception 'WORKFLOW_POLICY_SMOKE: im 진입 스냅샷이 다르다'; end if;
  begin
    perform public.settings_ref_check(p, 'workflow.approval_steps', null, '[{"code":"internal","label":"내부 검토","approver":"subtree_or_admin"}]'::jsonb);
    raise exception 'WORKFLOW_POLICY_SMOKE: 대기 라운드의 단계 삭제가 통과했다';
  exception when check_violation then
    if sqlerrm <> 'SETTINGS_CODE_IN_USE:workflow.approval_steps' then raise; end if;
  end;
  r := public.apply_workflow_event(p_event => 'approve_step', p_actor => admin_user, p_item_id => leaf, p_expected_step => 'internal');
  if (r -> 'approval' ->> 'remaining') <> '1' or r ->> 'stage' <> 'im' then raise exception 'WORKFLOW_POLICY_SMOKE: 첫 단계 승인 결과가 다르다: %', r; end if;
  update public.project_settings set "values" = "values" || '{"workflow.approval_distinct_approvers":false}'::jsonb where project_id = p;
  r := public.apply_workflow_event(p_event => 'approve_step', p_actor => admin_user, p_item_id => leaf, p_expected_step => 'client');
  if r ->> 'stage' <> 'xx' or (r ->> 'actual_pct')::numeric <> 100 then raise exception 'WORKFLOW_POLICY_SMOKE: 마지막 단계 승인 결과가 다르다: %', r; end if;
  -- 크레딧 손상
  update public.project_settings set "values" = "values" || '{"workflow.stage_credits":{"default":{"as":0,"ip":30,"rw":30,"im":80,"xx":100}}}'::jsonb where project_id = p;
  update public.wbs_items set stage = null, tags = '{}' where id = leaf;
  begin
    perform public.apply_workflow_event(p_event => 'set_stage', p_actor => admin_user, p_item_id => leaf, p_stage => 'ip');
    raise exception 'WORKFLOW_POLICY_SMOKE: 손상된 크레딧 표가 통과했다';
  exception when sqlstate '22023' then
    if sqlerrm <> 'CONFIG_INVALID:workflow.stage_credits' then raise; end if;
  end;
  raise notice 'WORKFLOW_POLICY_SMOKE: ok';
end $$;
rollback;
