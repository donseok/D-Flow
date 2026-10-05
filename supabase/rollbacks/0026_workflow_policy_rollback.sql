-- *_workflow_policy 롤백(스펙 §3.6·D12, 비평 반영 — S10) — 승인 라운드·원장·흐름 열 가드를 지우고 apply_workflow_event 를 0012 본문(8인자·권한),
-- guard_workflow_actual 을 0011 본문 + 트리거 정의(before update of actual_pct), settings_ref_check 를 SP5b I 본문(0025), set_dependency_waiver 를
-- 기준선 본문·권한으로 되돌린다. 멈추는 경우(설정·감사 기록의 의미가 사라진다):
--   ① workflow.approval_steps·approval_distinct_approvers·predecessor_gate·credit_policy·wbs_stage_labels 를 설정한 프로젝트가 있다
--   ② 기본 스냅샷({review}) 밖 라운드가 있다(다단계 대기 라운드) ③ 승인 원장(wbs_stage_approvals)에 행이 있다 — 감사 기록을 지우지 않는다
do $$
declare
  v text;
begin
  select string_agg(x.what, ', ') into v from (
    select 'project_settings=' || s.project_id::text || ':' || k as what
      from public.project_settings s
      cross join lateral pg_catalog.unnest(array['workflow.approval_steps', 'workflow.approval_distinct_approvers', 'workflow.predecessor_gate',
                                                 'workflow.credit_policy', 'workflow.wbs_stage_labels']) as k
     where s."values" ? k
    union all
    select 'wbs_items.review_steps(' || pg_catalog.count(*) || ')' from public.wbs_items
     where review_steps is not null and review_steps <> array['review'] having pg_catalog.count(*) > 0
    union all
    select 'wbs_stage_approvals(' || pg_catalog.count(*) || ')' from public.wbs_stage_approvals having pg_catalog.count(*) > 0) x;
  if v is not null then
    raise exception using errcode = '23514',
      message = 'WORKFLOW_POLICY_ROLLBACK_BLOCKED: 흐름 설정·대기 라운드·승인 원장이 남아 있다 — 설정을 지우고 라운드를 끝낸 뒤(원장은 감사 기록이라 지우지 않는다) 다시: '
                || pg_catalog.left(v, 600);
  end if;
end $$;

drop trigger guard_workflow_columns on public.wbs_items;
drop function public.guard_workflow_columns();

-- guard_workflow_actual — 0011 본문 그대로, 트리거는 UPDATE 만
drop trigger guard_workflow_actual on public.wbs_items;
create or replace function public.guard_workflow_actual() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.actual_pct is not distinct from old.actual_pct or coalesce(new.actual_pct, 0) <= 99 then return new; end if;
  if not old.dev_workflow then return new; end if;
  -- 위임 태그는 이 행의 값이다 — 다른 행을 읽지 않고 판정한다
  if 'agent' = any(coalesce(old.tags, '{}'::text[])) then
    raise exception using errcode = '42501', message = 'WORKFLOW_ACTUAL_LOCKED';
  end if;
  -- 여기부터는 다른 표(주문)를 읽어 판정한다. 이 행은 트리거가 돌기 전에 UPDATE 가 잠갔고, 점유·보고 사건(apply_workflow_event)도 항목
  -- 행을 잠그므로 둘은 이 행 잠금으로 직렬화된다.
  -- 격리 수준 규칙(0011 ①·⑧·⑨·⑩ 공통): 잠금 아래에서 다른 행을 읽어 판정하는 가드는 read committed 가 아니면 거절한다(fail-closed, 25001).
  -- read committed 는 문장마다 새 스냅샷이라 잠금을 얻은 뒤의 조회가 앞 연결의 커밋을 본다. repeatable read·serializable 은 트랜잭션 스냅샷
  -- 하나로 읽어 잠금을 기다리는 사이(또는 스냅샷 뒤에) 커밋된 변경을 못 본다. serializable 의 SSI 는 두 트랜잭션이 모두 serializable 일 때만
  -- 한쪽을 중단하는데 상대(PostgREST·서버 경로)는 read committed 로 들어온다. 이름으로 판정하므로 read uncommitted 도 거절한다.
  -- 이 가드에서 놓치는 것: 항목 행 잠금을 기다리는 사이 커밋된 점유 — 점유가 항목 행을 바꾸지 않았으면(단계·실적이 이미 그 값) 직렬화 오류도 나지 않는다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'WORKFLOW_ACTUAL_ISOLATION';
  end if;
  if exists (select 1 from public.agent_work_orders o where o.wbs_item_id = old.id and o.status in ('claimed', 'reported')) then
    raise exception using errcode = '42501', message = 'WORKFLOW_ACTUAL_LOCKED';
  end if;
  return new;
end
$$;
revoke all on function public.guard_workflow_actual() from public, anon, authenticated;
create trigger guard_workflow_actual before update of actual_pct on public.wbs_items
  for each row execute function public.guard_workflow_actual();

-- apply_workflow_event — 0012 본문(8인자) 그대로·권한
drop function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid, text);
create function public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_agent_user_id uuid DEFAULT NULL::uuid, p_expected_report_id uuid DEFAULT NULL::uuid) RETURNS jsonb
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
    -- 사람이 본 completion 보고가 지금도 최신인가(0011 H2-i) — 주문 행 잠금 아래에서 본다. 앱의 checkReportFresh 와 이 전이 사이에
    -- 재보고가 끼면 여기서 막힌다. 순서는 앱(latestCompletionReportId)과 같다: created_at 내림차순, 같으면 id 가 큰 쪽. null = 보고 없음.
    if p_event in ('approve','reject') then
      -- 격리 수준 규칙(0011 ①·⑧·⑨·⑩ 공통): 잠금 아래에서 다른 행을 읽어 판정하는 가드는 read committed 가 아니면 거절한다(fail-closed, 25001).
      -- read committed 는 문장마다 새 스냅샷이라 잠금을 얻은 뒤의 조회가 앞 연결의 커밋을 본다. repeatable read·serializable 은 트랜잭션 스냅샷
      -- 하나로 읽어 잠금을 기다리는 사이(또는 스냅샷 뒤에) 커밋된 변경을 못 본다. serializable 의 SSI 는 두 트랜잭션이 모두 serializable 일 때만
      -- 한쪽을 중단하는데 상대(PostgREST·서버 경로)는 read committed 로 들어온다. 이름으로 판정하므로 read uncommitted 도 거절한다.
      -- 이 가드에서 놓치는 것: 주문 행 잠금을 기다리는 사이 커밋된 재보고 — 주문 행을 바꾸지 않는 재보고는 직렬화 오류도 내지 않는다.
      -- 위의 반환 셋(주문 없음·항목 불일치·CAS 충돌)은 잠근 주문 행의 값만 보고 아무것도 쓰지 않으므로 이 검사보다 앞에 둔다. 대조하지
      -- 않는 사건은 이 검사를 거치지 않는다.
      if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
        raise exception using errcode = '25001', message = 'WORKFLOW_EVENT_ISOLATION';
      end if;
      if p_expected_report_id is distinct from (
           select r.id from public.agent_work_reports r
            where r.work_order_id = p_order_id and r.kind = 'completion'
            order by r.created_at desc, r.id desc limit 1) then
        return jsonb_build_object('ok', false, 'reason', 'report_stale', 'stale', true, 'order_status', v_order_status);
      end if;
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
      -- 0012: 넓은 열 stage_credits 대신 values 의 키를 읽는다. 키가 없으면 c_default, 설정 행이 없으면 비정상이라 거절한다(잠금은 SP5b).
      select s."values" -> 'workflow.stage_credits' into v_credits from public.project_settings s where s.project_id = v_project_id;
      if not found then
        raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
      end if;
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
revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid) to service_role;

-- settings_ref_check — SP5b I(0025) 본문 그대로(workflow.* 분기 제거). workflow_value_of 보다 먼저 되돌린다(분기가 그 헬퍼를 부른다)
create or replace function public.settings_ref_check(p_project_id uuid, p_key text, p_old jsonb, p_new jsonb)
returns void language plpgsql set search_path to '' as $$
declare
  v_rules jsonb;
  v_weeks jsonb;
  v_old jsonb;
  v_new jsonb;
  v_hit record;
begin
  -- calendar.week_start — 정확 판정(D53, 비평 반영 — S2): 새 규칙에서 키가 바뀌는 문서가 하나라도 있으면 거부한다. "첫 차이 위치"만 세면
  -- 미적용 전환을 더 늦은 날로 교체할 때 [E1, E2) 의 일요일 키 문서를 놓친다. unset(p_new null) = 제품 기본값 일요일.
  -- 과거 원소 수정 금지(from ≤ T)는 TS toStored 가 판정한다 — 여기는 문서 키 유효성만 본다(미리보기 previewWeekStart 와 같은 정의).
  -- 주간 문서는 프로젝트당 연 52건 수준이라 전수가 싸다(K28).
  if p_key = 'calendar.week_start' then
    v_rules := public.week_rules_of(case when p_new is null then '{}'::jsonb
                                         else pg_catalog.jsonb_build_object('calendar.week_start', p_new) end);
    select pg_catalog.jsonb_agg(x.w order by x.w) into v_weeks
      from (select r.week_start as w
              from public.weekly_reports r
             where r.project_id = p_project_id
               and public.week_key_from_rules(v_rules, r.week_start) <> r.week_start
             order by r.week_start
             limit 20) x;
    if v_weeks is not null then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:calendar.week_start',
        detail = pg_catalog.jsonb_build_object('key', 'calendar.week_start', 'weeks', v_weeks)::text;
    end if;
    return;
  end if;
  -- calendar.timezone — TS(Intl)만 통과한 값이 PG 에 없으면 그 프로젝트의 SQL(이슈 코드 {yyyy} — B1)이 막힌다. DB 쪽 마지막 방어(D54).
  -- 워크스페이스 tz 를 읽는 SQL 은 없다(사용현황 RPC 는 TS 가 tz 를 넘긴다) — 프로젝트만 본다.
  if p_key = 'calendar.timezone' then
    if p_new is null then
      return;
    end if;
    if pg_catalog.jsonb_typeof(p_new) is distinct from 'string' or (p_new #>> '{}') = '' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end if;
    -- '/' 없는 이름은 닫힌 허용 목록만(L1 — TS NO_SLASH_TIMEZONES 와 같다): PG 는 IST·NST·PST·CET·EST 같은 이름을 약어 표에서 먼저 읽어
    -- ICU(TS)와 다른 오프셋이 된다 — 받으면 TS·SQL 이 다른 날짜를 낸다
    if pg_catalog.strpos(p_new #>> '{}', '/') = 0
       and (p_new #>> '{}') not in ('UTC', 'GMT', 'EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT') then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end if;
    begin
      perform pg_catalog.now() at time zone (p_new #>> '{}');
    exception when invalid_parameter_value then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end;
    return;
  end if;
  -- issues.id_policy(SP5 B1 — 계획 P7): TS(parseIdPolicy)만 통과한 값이 SQL 검증(issue_id_policy_of)에 걸리면 그 프로젝트의 모든 이슈 등록이 멈춘다.
  -- DB 쪽 마지막 방어. unset(p_new null) = 제품 기본값이라 통과
  if p_key = 'issues.id_policy' then
    if p_new is not null then
      perform public.issue_id_policy_of(pg_catalog.jsonb_build_object('issues.id_policy', p_new));
    end if;
    return;
  end if;
  -- SP5b(스펙 §3.2 ⑧, 비평 반영 — S8): 이슈 표시 상태 — 새 값의 SQL 모양 검사를 먼저(TS 만 통과한 값이 저장되면 그 프로젝트의 이슈 쓰기가
  -- 22023 으로 멈춘다 — DB 쪽 마지막 방어), 그다음 빠진 code(removed)·범주가 바뀐 code(category)의 참조 이슈 수. 비활성은 참조가 있어도 된다.
  if p_key = 'workflow.issue_statuses' then
    v_new := public.issue_statuses_of(case when p_new is null then '{}'::jsonb
                                           else pg_catalog.jsonb_build_object('workflow.issue_statuses', p_new) end);
    v_old := coalesce(p_old, public.project_vocab_default(p_key));
    select x.code, x.reason, x.cnt into v_hit
      from (select o ->> 'code' as code,
                   case when n is null then 'removed' else 'category' end as reason,
                   public.project_vocab_ref_count(p_project_id, p_key, o ->> 'code') as cnt
              from pg_catalog.jsonb_array_elements(v_old) o
              left join lateral (select e from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = o ->> 'code' limit 1) nn(n) on true
             where n is null or (n ->> 'category') is distinct from (o ->> 'category')) x
     where x.cnt > 0
     order by x.code
     limit 1;
    if found then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
        detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', v_hit.reason, 'count', v_hit.cnt)::text;
    end if;
    return;
  end if;
  -- 어휘 네 키(SP5 B4 — D29·D58, 개정 §2.4.2): 옛 목록에 있고 새 목록에서 빠진 code, 또는 의미 속성(attendance.types 의 counts_as)이
  -- 바뀐 code 의 참조 행이 있으면 거부한다. 비활성은 참조가 있어도 된다(새 행만 막힌다 — 트리거). unset·옛 키 없음 = 제품 기본값.
  -- 원인 분류는 분기가 없다(분석 실행 JSON 참조 — TS 가 삭제 금지).
  if p_key in ('attendance.types', 'meetings.categories', 'issues.severities', 'issues.sources') then
    v_old := coalesce(p_old, public.project_vocab_default(p_key));
    v_new := coalesce(p_new, public.project_vocab_default(p_key));
    if pg_catalog.jsonb_typeof(v_new) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || p_key;
    end if;
    select x.code, x.reason, x.cnt into v_hit
      from (select o ->> 'code' as code,
                   case when n is null then 'removed' else 'counts_as' end as reason,
                   public.project_vocab_ref_count(p_project_id, p_key, o ->> 'code') as cnt
              from pg_catalog.jsonb_array_elements(v_old) o
              left join lateral (select e from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = o ->> 'code' limit 1) nn(n) on true
             where n is null
                or (p_key = 'attendance.types' and (n ->> 'counts_as') is distinct from (o ->> 'counts_as'))) x
     where x.cnt > 0
     order by x.code
     limit 1;
    if found then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
        detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', v_hit.reason, 'count', v_hit.cnt)::text;
    end if;
    return;
  end if;
  return;
end $$;

-- set_dependency_waiver — 기준선(0000) 본문·권한
CREATE FUNCTION public.set_dependency_waiver(p_item_id uuid, p_pred_ref text, p_waive boolean, p_reason text, p_actor uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare
  v_project uuid; v_ref text; v_depends text[]; v_waived text[]; v_stub_for text;
  v_assignee uuid; v_tags text[]; v_category text; v_model text; v_priority text;
  v_ps date; v_pe date;
  v_pred_id uuid; v_pred_code text; v_pred_name text; v_pred_stage text; v_pred_pct numeric;
  v_pred_spec text; v_pred_acc jsonb; v_pred_approved boolean;
  v_sub_id uuid; v_sub_created boolean := false; v_sort int; v_sub_name text; v_pred_last text; v_pred_key text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select project_id, external_ref, coalesce(depends, '{}'::text[]), depends_waived, stub_for,
         assignee_member_id, tags, category, model, priority, planned_start, planned_end
    into v_project, v_ref, v_depends, v_waived, v_stub_for,
         v_assignee, v_tags, v_category, v_model, v_priority, v_ps, v_pe
    from public.wbs_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'item_not_found'); end if;
  if v_stub_for is not null then return jsonb_build_object('ok', false, 'reason', 'is_stub_task'); end if;
  if exists (select 1 from public.wbs_items where parent_id = p_item_id and stub_for is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_leaf');
  end if;
  if v_ref is null then return jsonb_build_object('ok', false, 'reason', 'no_ref'); end if;
  if not (p_pred_ref = any(v_depends)) then return jsonb_build_object('ok', false, 'reason', 'not_in_depends'); end if;

  if not p_waive then
    -- 해제: 목록에서만 뺀다. 하위 Task 는 유지(F12 — 스텁이 이미 개발 브랜치에 있을 수 있다).
    if not (p_pred_ref = any(v_waived)) then
      return jsonb_build_object('ok', true, 'changed', false, 'sub_task_id', null, 'sub_task_created', false);
    end if;
    update public.wbs_items set depends_waived = array_remove(depends_waived, p_pred_ref), updated_at = now()
     where id = p_item_id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (p_actor, p_item_id, 'depends_waived', p_pred_ref, '해제 | ' || btrim(p_reason));
    return jsonb_build_object('ok', true, 'changed', true, 'sub_task_id', null, 'sub_task_created', false);
  end if;

  select id, code, name, stage, actual_pct, spec, acceptance
    into v_pred_id, v_pred_code, v_pred_name, v_pred_stage, v_pred_pct, v_pred_spec, v_pred_acc
    from public.wbs_items where project_id = v_project and external_ref = p_pred_ref;
  if not found then return jsonb_build_object('ok', false, 'reason', 'pred_not_found'); end if;
  v_pred_approved := exists (select 1 from public.agent_work_orders where wbs_item_id = v_pred_id and status = 'approved');
  -- 선행 충족 세 축(agentWork.predecessorReached) — 이미 도달이면 면제할 이유가 없다.
  if v_pred_stage in ('im', 'xx') or v_pred_approved or coalesce(v_pred_pct, 0) >= 100 then
    return jsonb_build_object('ok', false, 'reason', 'already_reached');
  end if;
  -- F4 계약(forceProgress.hasContract): spec 본문 ∨ acceptance 1건 이상.
  if coalesce(btrim(v_pred_spec), '') = ''
     and (jsonb_typeof(v_pred_acc) is distinct from 'array' or jsonb_array_length(v_pred_acc) = 0) then
    return jsonb_build_object('ok', false, 'reason', 'no_contract');
  end if;

  if not (p_pred_ref = any(v_waived)) then
    update public.wbs_items set depends_waived = array_append(depends_waived, p_pred_ref), updated_at = now()
     where id = p_item_id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (p_actor, p_item_id, 'depends_waived', null, p_pred_ref || ' | ' || btrim(p_reason));
  end if;

  -- 하위 Task — 간선당 하나(wbs_items_stub_for_uidx). 재면제는 기존 하위를 다시 쓴다.
  select id into v_sub_id from public.wbs_items where parent_id = p_item_id and stub_for = p_pred_ref;
  if v_sub_id is null then
    v_pred_last := regexp_replace(p_pred_ref, '^.*/', '');
    -- 하위 ref·code 는 선행 ref **전체**를 안전 문자로 바꿔 만든다(forceProgress.stubRefKey). 마지막 칸만 쓰면
    -- 모듈이 다른 두 선행(a/TSK-01·b/TSK-01)이 같은 ref 를 만들어 부딪친다. [A-Za-z0-9._-] 라 dflow.sh 작업 폴더 규칙도 통과한다.
    v_pred_key := regexp_replace(p_pred_ref, '[^A-Za-z0-9._-]', '_', 'g');
    v_sub_name := '스텁 제거·실연결: ' || v_pred_code || ' ' || v_pred_name;
    select coalesce(max(sort_order), 0) + 1 into v_sort from public.wbs_items where parent_id = p_item_id;
    insert into public.wbs_items (
      project_id, parent_id, code, sort_order, name, external_ref, stub_for, depends,
      dev_workflow, tags, assignee_member_id, category, model, priority, planned_start, planned_end, weight, spec
    ) values (
      v_project, p_item_id, v_pred_key, v_sort, v_sub_name, v_ref || '.stub.' || v_pred_key, p_pred_ref,
      array[p_pred_ref, v_ref],
      true, v_tags, v_assignee, v_category, v_model, v_priority, v_ps, v_pe, null,
      '## 스텁 제거·실연결' || E'\n\n'
      || '선행 ' || v_pred_code || '(' || p_pred_ref || ') 을 대신한 강제 진행 스텁을 실구현으로 바꾼다.' || E'\n\n'
      || '1. 개발 브랜치에서 `git grep -n ''FORCE-STUB: ' || v_pred_last || '''` 로 표식을 모두 찾는다.' || E'\n'
      || '2. 주입 지점을 선행의 실구현으로 바꾸고 `src/__stubs__/' || v_pred_last || '/` 같은 스텁 파일을 지운다.' || E'\n'
      || '3. 후행 ' || v_ref || ' 의 테스트를 실구현 상대로 다시 돌린다. 실패하면 계약 어긋남으로 보고한다.' || E'\n'
      || '4. 완료 조건: 표식 0건 + 후행 테스트 통과.'
    ) returning id into v_sub_id;
    v_sub_created := true;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (p_actor, v_sub_id, 'created', null, v_sub_name);
  end if;

  return jsonb_build_object('ok', true, 'changed', true, 'sub_task_id', v_sub_id, 'sub_task_created', v_sub_created);
end;
$$;
REVOKE ALL ON FUNCTION public.set_dependency_waiver(p_item_id uuid, p_pred_ref text, p_waive boolean, p_reason text, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_dependency_waiver(p_item_id uuid, p_pred_ref text, p_waive boolean, p_reason text, p_actor uuid) TO service_role;

drop table public.wbs_stage_approvals;
alter table public.wbs_items drop column review_steps, drop column review_round;
drop function public.wbs_stage_reaches_gate(text, text);
drop function public.wbs_predecessor_reached(text, text, boolean, numeric, boolean);
drop function public.wbs_effective_steps(text, text[], jsonb);
drop function public.workflow_value_of(jsonb, text);
