-- 0048_workflow_stage_cas.sql
-- 사람의 단계 지정(set_stage)을 "화면이 본 단계"와 대조해 실행하는 래퍼(SPU1, 개정 §5.8 — 무통보 덮어쓰기 0건).
-- 상세 패널·보드의 단계 지정은 기대값 없이 나가, 그새 다른 사람이 옮긴 단계를 낡은 화면의 클릭이 조용히 되돌렸다.
-- 0037 의 apply_workflow_event_cas 는 updated_at 을 대조한다 — 실적·담당자 저장만으로도 바뀌어 단계 지정에는 거짓 충돌이 난다
-- (일괄 편집은 행 전체를 보므로 그쪽은 그대로 둔다). 여기서는 단계 값 하나만 본다.
-- 행을 잠근 채 stage 를 대조하고, 같으면 기존 apply_workflow_event 를 그대로 부른다 — 승인·점유·크레딧 판정과 행위자 등급 재판정은
-- 그 함수 몫이라 이 래퍼는 등급을 따로 보지 않는다(0037 래퍼의 관리자 전제는 일괄 편집용이다). 실행권은 service_role 뿐이다.

begin;

create function public.apply_workflow_event_stage_cas(
  p_project_id uuid, p_actor uuid, p_item_id uuid, p_expected_stage text,
  p_stage text, p_expected_step text default null
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '15s' as $$
declare v_stage text;
begin
  if p_project_id is null or p_actor is null or p_item_id is null then
    return jsonb_build_object('ok', false, 'reason', 'item_not_found');
  end if;
  select stage into v_stage from public.wbs_items where id = p_item_id and project_id = p_project_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'item_not_found'); end if;
  if v_stage is distinct from p_expected_stage then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'conflict', true, 'latest_stage', v_stage);
  end if;
  return public.apply_workflow_event(p_event => 'set_stage', p_actor => p_actor, p_item_id => p_item_id,
    p_stage => p_stage, p_expected_step => p_expected_step);
end $$;

revoke all on function public.apply_workflow_event_stage_cas(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.apply_workflow_event_stage_cas(uuid,uuid,uuid,text,text,text) to service_role;

commit;
