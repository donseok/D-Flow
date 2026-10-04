-- SP5b Phase W1(스펙 D11~D22·§3.3, 개정 §3.3): WBS 업무 흐름 설정화 — 승인 단계(1~3단·라운드·원장)·선행 충족 기준·크레딧 정책.
-- 단계 code(as/ip/im/xx)·주문 5상태·에이전트 프로토콜은 제품 고정이다. 설정 키가 없는 프로젝트는 현행과 같다(기본 1단계·reached·5/10).
-- 무엇: ⓪ 판독 헬퍼(workflow_value_of·유효 단계·선행 판정) ① 사전 검사 ② 라운드 열·이행 ③ 승인 원장 wbs_stage_approvals
--   ④ apply_workflow_event 재작성(9인자 — p_expected_step) ⑤ guard_workflow_columns(JWT 의 흐름 다섯 열 쓰기 차단 — 개정:3684 H2 이월)
--   ⑥ guard_workflow_actual 교체(im 대기 절 → dev_workflow → 잠금 절 → 단계 ≥2 절, INSERT 포함) ⑦ settings_ref_check 분기(모양·대기 라운드)
--   ⑧ set_dependency_waiver 삭제(죽은 RPC — 열·정리 트리거는 남긴다) ⑨ 사후검사.
-- 잠금 순서: 주문 → 항목(FOR UPDATE) → 설정 행(FOR SHARE). 설정 쓰기 RPC 는 설정 행 FOR UPDATE 뒤 항목을 잠그지 않고 읽기만 한다(교착 없음).
-- 데이터 변화: review_round·review_steps 이행(im·xx = 1·{review}, 나머지 0·null). 원장은 백필하지 않는다(과거 승인의 정본은 agent_work_reports).

-- ⓪ 판독 헬퍼 ----------------------------------------------------------------------------------------------------------------
-- workflow.* 여섯 키의 값(값 받는 판 — 행은 호출부가 한 번 읽는다, B-20). 키 없음·JSON null = 레지스트리 기본값 SQL 리터럴(TS 와 패리티 —
-- tests/rls/workflow-policy.test.ts), 모양이 틀리면 22023 CONFIG_INVALID:<key>(기본값으로 위장하지 않는다 — D20). 판정은 TS parse 와 같은 규칙이다
-- ("TS parse 통과 ⇔ SQL 모양 검사 통과" 쌍 — 골든 tests/fixtures/parity/workflow.json). 크레딧 표는 고정 불변식만 본다(정책과의 교차는 TS 저장 검사).
create function public.workflow_value_of(p_values jsonb, p_key text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v jsonb := coalesce(p_values, '{}'::jsonb) -> p_key;
  t jsonb;
  k text;
  bad boolean := false;
begin
  if p_key not in ('workflow.stage_credits', 'workflow.credit_policy', 'workflow.approval_steps',
                   'workflow.approval_distinct_approvers', 'workflow.predecessor_gate', 'workflow.wbs_stage_labels') then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || coalesce(p_key, 'null');
  end if;
  if v is null or pg_catalog.jsonb_typeof(v) = 'null' then
    return case p_key
      when 'workflow.stage_credits' then '{"default":{"as":0,"ip":30,"rw":50,"im":80,"xx":100}}'::jsonb
      when 'workflow.credit_policy' then '{"step":5,"min_gap":10}'::jsonb
      when 'workflow.approval_steps' then '[{"code":"review","label":null,"approver":"subtree_or_admin"}]'::jsonb
      when 'workflow.approval_distinct_approvers' then 'true'::jsonb
      when 'workflow.predecessor_gate' then '"reached"'::jsonb
      when 'workflow.wbs_stage_labels' then '{}'::jsonb
    end;
  end if;
  if p_key = 'workflow.stage_credits' then
    t := v -> 'default';
    bad := pg_catalog.jsonb_typeof(v) is distinct from 'object'
        or exists (select 1 from pg_catalog.jsonb_object_keys(v) x(k) where x.k <> 'default')
        or pg_catalog.jsonb_typeof(t) is distinct from 'object'
        or exists (select 1 from pg_catalog.jsonb_object_keys(t) x(k) where x.k not in ('as', 'ip', 'rw', 'im', 'xx'));
    if not bad then
      foreach k in array array['as', 'ip', 'rw', 'im', 'xx'] loop
        if pg_catalog.jsonb_typeof(t -> k) is distinct from 'number'
           or (t ->> k)::numeric <> pg_catalog.trunc((t ->> k)::numeric)
           or (t ->> k)::numeric not between 0 and 100 then
          bad := true;
        end if;
      end loop;
    end if;
    bad := bad or (t ->> 'xx')::numeric <> 100
       or not ((t ->> 'as')::numeric < (t ->> 'ip')::numeric and (t ->> 'ip')::numeric < (t ->> 'rw')::numeric
               and (t ->> 'rw')::numeric < (t ->> 'im')::numeric and (t ->> 'im')::numeric < (t ->> 'xx')::numeric);
  elsif p_key = 'workflow.credit_policy' then
    bad := pg_catalog.jsonb_typeof(v) is distinct from 'object'
        or exists (select 1 from pg_catalog.jsonb_object_keys(v) x(k) where x.k not in ('step', 'min_gap'))
        or pg_catalog.jsonb_typeof(v -> 'step') is distinct from 'number' or (v ->> 'step')::numeric not in (1, 5)
        or pg_catalog.jsonb_typeof(v -> 'min_gap') is distinct from 'number'
        or (v ->> 'min_gap')::numeric <> pg_catalog.trunc((v ->> 'min_gap')::numeric)
        or (v ->> 'min_gap')::numeric not between 1 and 10;
  elsif p_key = 'workflow.approval_steps' then
    bad := pg_catalog.jsonb_typeof(v) is distinct from 'array'
        or pg_catalog.jsonb_array_length(v) not between 1 and 3
        or exists (select 1 from pg_catalog.jsonb_array_elements(v) e
                    where pg_catalog.jsonb_typeof(e) is distinct from 'object'
                       or exists (select 1 from pg_catalog.jsonb_object_keys(e) x(k) where x.k not in ('code', 'label', 'approver'))
                       or pg_catalog.jsonb_typeof(e -> 'code') is distinct from 'string'
                       or (e ->> 'code') !~ '^[a-z][a-z0-9_]{0,19}$'
                       or (e ->> 'approver') is null or (e ->> 'approver') not in ('subtree_or_admin', 'admin')
                       or pg_catalog.jsonb_typeof(e -> 'approver') is distinct from 'string'
                       or not (case pg_catalog.jsonb_typeof(e -> 'label')
                                 when 'null' then (e ->> 'code') = 'review'
                                 when 'string' then pg_catalog.char_length(pg_catalog.btrim(e ->> 'label')) between 1 and 20
                                 else false end));
    bad := bad or (select pg_catalog.count(distinct e ->> 'code') from pg_catalog.jsonb_array_elements(v) e) <> pg_catalog.jsonb_array_length(v);
  elsif p_key = 'workflow.approval_distinct_approvers' then
    bad := pg_catalog.jsonb_typeof(v) is distinct from 'boolean';
  elsif p_key = 'workflow.predecessor_gate' then
    bad := pg_catalog.jsonb_typeof(v) is distinct from 'string' or (v #>> '{}') not in ('reached', 'final');
  else -- workflow.wbs_stage_labels
    bad := pg_catalog.jsonb_typeof(v) is distinct from 'object'
        or exists (select 1 from pg_catalog.jsonb_each(v) x(k, val)
                    where x.k not in ('none', 'as', 'ip', 'im', 'xx')
                       or pg_catalog.jsonb_typeof(x.val) is distinct from 'string'
                       or pg_catalog.char_length(pg_catalog.btrim(x.val #>> '{}')) not between 1 and 20);
  end if;
  if bad then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || p_key;
  end if;
  return v;
end
$$;
revoke all on function public.workflow_value_of(jsonb, text) from public, anon, authenticated;

-- 유효 단계 목록(D15 — 한 규칙, TS approvalSteps.effectiveSteps): stage ∈ {im, xx} 이고 스냅샷이 있으면 스냅샷, 그 밖은 현재 설정의 code 목록
create function public.wbs_effective_steps(p_stage text, p_review_steps text[], p_values jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select case when p_stage in ('im', 'xx') and p_review_steps is not null then p_review_steps
              else array(select e ->> 'code'
                           from pg_catalog.jsonb_array_elements(public.workflow_value_of(p_values, 'workflow.approval_steps')) with ordinality as x(e, i)
                          order by x.i) end
$$;
revoke all on function public.wbs_effective_steps(text, text[], jsonb) from public, anon, authenticated;

-- 선행 충족(개정 §3.3.3, TS predecessorReachedFor). reached = 현행, final = xx ∨ 승인 주문 ∨ (dev_workflow 아님 ∧ 실적 ≥100)
create function public.wbs_predecessor_reached(p_gate text, p_stage text, p_order_approved boolean, p_actual numeric, p_dev_workflow boolean)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_gate = 'reached' then
    return coalesce(p_stage in ('im', 'xx'), false) or coalesce(p_order_approved, false) or coalesce(p_actual >= 100, false);
  elsif p_gate = 'final' then
    return coalesce(p_stage = 'xx', false) or coalesce(p_order_approved, false)
        or (not coalesce(p_dev_workflow, false) and coalesce(p_actual >= 100, false));
  end if;
  raise exception using errcode = '22023', message = 'CONFIG_INVALID:workflow.predecessor_gate';
end
$$;
revoke all on function public.wbs_predecessor_reached(text, text, boolean, numeric, boolean) from public, anon, authenticated;

-- 첫 도달의 단계 축(TS stageReachesGate) — reached: im|xx, final: xx
create function public.wbs_stage_reaches_gate(p_stage text, p_gate text) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p_gate = 'reached' then return coalesce(p_stage in ('im', 'xx'), false);
  elsif p_gate = 'final' then return coalesce(p_stage = 'xx', false);
  end if;
  raise exception using errcode = '22023', message = 'CONFIG_INVALID:workflow.predecessor_gate';
end
$$;
revoke all on function public.wbs_stage_reaches_gate(text, text) from public, anon, authenticated;

-- ① 사전 검사(비평 반영 — S8) — workflow.* 키를 가진 프로젝트의 값이 모두 SQL 모양 검사를 통과해야 한다. 기존 손상 값(stage_credits 는
-- 0012 이래 조용히 c_default 로 폴백했다)을 적용 시점에 드러낸다 — 실패 목록과 함께 중단
do $$
declare
  v text;
  r record;
  k text;
begin
  for r in select s.project_id, s."values" from public.project_settings s loop
    foreach k in array array['workflow.stage_credits', 'workflow.credit_policy', 'workflow.approval_steps',
                             'workflow.approval_distinct_approvers', 'workflow.predecessor_gate', 'workflow.wbs_stage_labels'] loop
      begin
        perform public.workflow_value_of(r."values", k);
      exception when sqlstate '22023' then
        v := coalesce(v || ', ', '') || r.project_id::text || ':' || k;
      end;
    end loop;
  end loop;
  if v is not null then
    raise exception 'WORKFLOW_POLICY_PRECHECK: 손상된 workflow 설정: %', v;
  end if;
end $$;

-- ② 라운드 열 — RPC 만 쓴다(⑤ 가드). 스냅샷은 stage ∈ {im, xx} 동안 유지(unapprove 가 마지막 단계를 다시 대기로 돌린다), 그 밖에서 null
alter table public.wbs_items
  add column review_round integer not null default 0,
  add column review_steps text[],
  add constraint wbs_items_review_round_check check (review_round >= 0);
update public.wbs_items set review_round = 1, review_steps = array['review'] where stage in ('im', 'xx');

-- ③ 승인 원장(개정 §3.3.2 + 보강 — B-18). 쓰기 정책 없음(apply_workflow_event — service_role 만). 항목 삭제 cascade 는 수용(원장은 항목 수명),
-- approved_by·revoked_by 는 RESTRICT(agent_work_reports.reviewed_by 관례 — 승인한 계정을 지우려면 원장을 먼저 정리한다, 의도)
create table public.wbs_stage_approvals (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  wbs_item_id   uuid not null,
  round         integer not null check (round >= 1),
  step_code     text not null check (step_code ~ '^[a-z][a-z0-9_]{0,19}$'),
  via           text not null check (via in ('approve', 'approve_step', 'set_stage')),
  order_id      uuid references public.agent_work_orders(id) on delete set null,
  report_id     uuid references public.agent_work_reports(id) on delete set null,
  approved_by   uuid not null references auth.users(id),
  approved_at   timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  revoke_reason text check (revoke_reason in ('reject', 'rework', 'unapprove', 'stage_reset')),
  constraint wbs_stage_approvals_revoke_pair check ((revoked_at is null) = (revoke_reason is null)),
  constraint wbs_stage_approvals_item_fk foreign key (wbs_item_id, project_id) references public.wbs_items(id, project_id) on delete cascade
);
-- 동시 승인의 마지막 방어 — 같은 라운드·단계의 살아 있는 승인은 하나(23505 → RPC 가 approval_stale)
create unique index wbs_stage_approvals_live_uidx on public.wbs_stage_approvals (wbs_item_id, round, step_code) where revoked_at is null;
create index wbs_stage_approvals_project_idx on public.wbs_stage_approvals (project_id);
alter table public.wbs_stage_approvals enable row level security;
create policy wbs_stage_approvals_read on public.wbs_stage_approvals for select to authenticated
  using (project_id in (select public.accessible_project_ids()));
revoke all on table public.wbs_stage_approvals from anon, authenticated;
grant select on table public.wbs_stage_approvals to authenticated;

-- ④ apply_workflow_event 재작성(D11) — 출발점 0012:229-466 본문. 9번째 인자 p_expected_step 이 붙어 drop(8인자) + create + 권한(한 트랜잭션).
-- INVOKER·search_path 없음·c_default 상수는 그대로(service_role 만 실행). 잠금 순서: 주문 → 항목 → 설정(판정 사건이면 FOR SHARE) → 격리 검사 → 판정.
-- 사건 표 = 개정 §3.3.2 + D15(스냅샷 없으면 라운드 개시)·D16(xx→im 철회)·S3(admin 단계 재판정·via)·S6(p_expected_step null 은 유효 단계 1 일 때만).
drop function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid);
create function public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_agent_user_id uuid DEFAULT NULL::uuid, p_expected_report_id uuid DEFAULT NULL::uuid, p_expected_step text DEFAULT NULL::text) RETURNS jsonb
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
  -- SP5b W1: 라운드·승인 단계
  v_round integer;
  v_steps text[];
  v_new_round integer;
  v_new_steps text[];
  v_review_changed boolean := false;
  v_values jsonb;
  v_settings_found boolean := false;
  v_cfg_steps jsonb;
  v_cfg_codes text[];
  v_eff text[];
  v_pending text;
  v_approver text;
  v_remaining integer;
  v_approval jsonb;
  v_judge boolean := false;
  v_intermediate boolean := false;
  v_gate text;
begin
  if p_event is null or p_event not in ('assign','unassign','claim','report_completion','approve','approve_step','unapprove','reject','rework','release','set_stage') then
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
    select project_id, stage, actual_pct, dev_workflow, tags, review_round, review_steps
      into v_project_id, v_old_stage, v_old_pct, v_dev_workflow, v_tags, v_round, v_steps
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
  v_new_round := v_round;
  v_new_steps := v_steps;

  -- 스텁 잔존(스펙 F6·F13) — forceProgress.pendingStubs 와 같은 조건. 승인과 사람의 xx 지정을 주문 갱신 전에 거부한다.
  if v_item_found then
    v_stub_pending := exists (select 1 from public.wbs_items
      where parent_id = v_item_id and stub_for is not null and stage is distinct from 'xx');
  end if;
  if v_stub_pending and (p_event in ('approve','approve_step') or (p_event = 'set_stage' and p_stage = 'xx')) then
    return jsonb_build_object('ok', false, 'reason', 'stub_pending', 'order_status', v_order_status);
  end if;

  -- 설정 행(SP5b): 판정 사건은 FOR SHARE — 설정 저장(FOR UPDATE)의 대기 라운드 검사와 직렬화된다(§2.4.1). 값만 읽는 사건은 잠그지 않는다.
  -- 행이 없으면 비정상이다 — 값이 필요한 자리에서 SETTINGS_ROW_MISSING 으로 거절한다(기본값으로 풀지 않는다).
  if v_item_found then
    if p_event in ('report_completion','approve','approve_step','unapprove','reject','rework','set_stage') then
      select s."values" into v_values from public.project_settings s where s.project_id = v_project_id for share;
    else
      select s."values" into v_values from public.project_settings s where s.project_id = v_project_id;
    end if;
    v_settings_found := found;
    -- 격리 가드(S9): 잠금 아래 다른 행(설정·원장)을 읽어 판정하는 사건. approve·reject 는 위에서 봤다. claim·release·unapprove 는 값만 읽는다
    if p_event in ('report_completion','approve_step','rework')
       or (p_event = 'set_stage' and (p_stage in ('im','xx') or v_old_stage in ('im','xx'))) then
      if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
        raise exception using errcode = '25001', message = 'WORKFLOW_EVENT_ISOLATION';
      end if;
    end if;
  end if;

  -- 사람 사건의 전제(주문 갱신과 무관 — 승인 판정보다 먼저)
  if p_event in ('set_stage','approve_step') then
    if p_event = 'set_stage' and p_stage is not null and p_stage not in ('as','ip','im','xx') then
      return jsonb_build_object('ok', false, 'reason', 'bad_stage');
    end if;
    -- 잠금(위임됨 ∨ 에이전트가 주문을 쥠)이면 해제(null)도 거부 — 단계는 승인·반려로만 바뀐다(§3.5).
    -- ready 는 넣지 않는다: dev_workflow 리프마다 배정과 무관하게 상주한다. 조건은 agentWork.stageLockedForHuman 과 같다.
    if 'agent' = any(coalesce(v_tags, '{}'::text[]))
       or exists (select 1 from public.agent_work_orders
                   where wbs_item_id = v_item_id and status in ('claimed','reported')) then
      return jsonb_build_object('ok', false, 'reason', 'locked');
    end if;
    if p_event = 'approve_step' then
      -- 주문 없는 사람 경로(개정 §3.3.2) — im 리프만. dev_workflow 는 보지 않는다(서버 경로로 흐름을 꺼도 대기 라운드는 승인으로 끝낸다)
      if not v_is_leaf then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
      if v_old_stage is distinct from 'im' then return jsonb_build_object('ok', false, 'reason', 'not_in_review'); end if;
      v_judge := true;
    elsif p_stage is not null then
      if v_dev_workflow is not true then return jsonb_build_object('ok', false, 'reason', 'not_workflow'); end if;
      if not v_is_leaf then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
      -- 사람의 xx 지정은 승인 판정을 거친다(D18) — 이미 xx 면 판정 없이 현행(실적만 맞춘다)
      v_judge := p_stage = 'xx' and v_old_stage is distinct from 'xx';
    end if;
  elsif p_event = 'approve' then
    v_judge := v_item_found and v_is_leaf;
  end if;

  -- 승인 판정(개정 §3.3.2 + D15·S3·S6) — 쓰기 전에 전부 본다. 실패 반환은 아무것도 쓰지 않는다.
  if v_judge then
    if p_actor is null then
      return jsonb_build_object('ok', false, 'reason', 'approval_forbidden', 'order_status', v_order_status);
    end if;
    if not v_settings_found then
      raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
    end if;
    v_cfg_steps := public.workflow_value_of(v_values, 'workflow.approval_steps');
    v_cfg_codes := array(select x.e ->> 'code' from pg_catalog.jsonb_array_elements(v_cfg_steps) with ordinality as x(e, i) order by x.i);
    v_eff := public.wbs_effective_steps(v_old_stage, v_steps, v_values);
    -- 대기 단계 = 이번 라운드에서 유효 승인이 없는 첫 단계. 라운드가 없으면(스냅샷 없음 — D15) 또는 그 라운드가 이미 다 승인됐으면
    -- (서비스 경로로 단계만 되돌린 행) 새 라운드를 연다 — 승인은 늘 열린 라운드의 대기 단계에 기록된다.
    if v_old_stage in ('im','xx') and v_steps is not null then
      select s.code into v_pending
        from pg_catalog.unnest(v_steps) with ordinality as s(code, i)
       where not exists (select 1 from public.wbs_stage_approvals a
                          where a.wbs_item_id = v_item_id and a.round = v_round and a.step_code = s.code and a.revoked_at is null)
       order by s.i limit 1;
    end if;
    if v_pending is null then
      v_new_round := v_round + 1;
      v_new_steps := v_cfg_codes;
      v_eff := v_cfg_codes;
      v_pending := v_eff[1];
    end if;
    -- 사람의 xx 지정: 유효 단계 ≥2 면 현재 stage 와 무관하게 거부 — im 으로 올린 뒤 단계 승인으로만 xx 에 간다
    if p_event = 'set_stage' and pg_catalog.cardinality(v_eff) >= 2 then
      return jsonb_build_object('ok', false, 'reason', 'approval_required');
    end if;
    -- 대기 단계 CAS(S6) — 생략은 유효 단계가 하나일 때만
    if (p_expected_step is null and pg_catalog.cardinality(v_eff) <> 1)
       or (p_expected_step is not null and p_expected_step is distinct from v_pending) then
      return jsonb_build_object('ok', false, 'reason', 'approval_stale', 'order_status', v_order_status);
    end if;
    -- 승인자 재판정(S3) — 현재 설정의 승인자, 설정에서 사라진 단계는 admin(fail-closed). subtree_or_admin 은 액션 가드가 판정했다
    v_approver := coalesce((select x.e ->> 'approver' from pg_catalog.jsonb_array_elements(v_cfg_steps) as x(e)
                             where x.e ->> 'code' = v_pending limit 1), 'admin');
    if v_approver = 'admin' and not public.actor_is_project_admin(p_actor, v_project_id) then
      return jsonb_build_object('ok', false, 'reason', 'approval_forbidden', 'order_status', v_order_status);
    end if;
    if (public.workflow_value_of(v_values, 'workflow.approval_distinct_approvers'))::text = 'true'
       and exists (select 1 from public.wbs_stage_approvals a
                    where a.wbs_item_id = v_item_id and a.round = v_new_round and a.approved_by = p_actor and a.revoked_at is null) then
      return jsonb_build_object('ok', false, 'reason', 'approval_same_actor', 'order_status', v_order_status);
    end if;
    begin
      insert into public.wbs_stage_approvals (project_id, wbs_item_id, round, step_code, via, order_id, report_id, approved_by, approved_at)
        values (v_project_id, v_item_id, v_new_round, v_pending, p_event,
                case when p_event = 'approve' then p_order_id end,
                case when p_event = 'approve' then p_expected_report_id end, p_actor, v_now);
    exception when unique_violation then
      -- 같은 단계의 동시 승인 — 먼저 커밋한 쪽이 이겼다
      return jsonb_build_object('ok', false, 'reason', 'approval_stale', 'order_status', v_order_status);
    end;
    select pg_catalog.count(*) into v_remaining
      from pg_catalog.unnest(v_eff) as s(code)
     where not exists (select 1 from public.wbs_stage_approvals a
                        where a.wbs_item_id = v_item_id and a.round = v_new_round and a.step_code = s.code and a.revoked_at is null);
    v_approval := jsonb_build_object('round', v_new_round, 'step_code', v_pending, 'remaining', v_remaining);
    v_intermediate := v_remaining > 0;
  end if;

  -- 주문 갱신. 중간 단계 승인은 주문을 reported 에 둔다(다음 단계 대기)
  if v_is_order_event then
    if v_intermediate then
      v_next := 'reported';
    elsif p_event = 'claim' then
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
  if v_intermediate then
    null;   -- 중간 단계: stage im·실적 불변, 라운드만 기록(위에서 열었으면 아래에서 쓴다)
  elsif v_is_order_event then
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
  elsif p_event = 'approve_step' then
    v_apply := true; v_new_stage := 'xx'; v_credit_key := 'xx';
  else -- set_stage(전제는 위에서 봤다)
    if p_stage is null then
      -- 해제는 워크플로·리프와 무관하게 허용(잘못 찍힌 값을 지울 길). 실적 불변.
      v_apply := true; v_new_stage := null; v_credit_key := null;
    else
      v_apply := true; v_new_stage := p_stage; v_credit_key := p_stage;
    end if;
  end if;

  -- 라운드 수명(개정 §3.3.2): im 진입 = 새 라운드·설정 스냅샷, im·xx 이탈 = 스냅샷 null, 승인 철회는 사건별 사유로
  if v_apply and v_item_found then
    if v_new_stage = 'im' and v_old_stage is distinct from 'im' and p_event <> 'unapprove' then
      if not v_settings_found then
        raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
      end if;
      -- 사람의 xx → im 은 옛 라운드 승인을 철회한다(D16)
      if v_old_stage = 'xx' then
        update public.wbs_stage_approvals set revoked_at = v_now, revoked_by = p_actor, revoke_reason = 'stage_reset'
         where wbs_item_id = v_item_id and round = v_round and revoked_at is null;
      end if;
      v_new_round := v_round + 1;
      v_new_steps := array(select x.e ->> 'code'
                             from pg_catalog.jsonb_array_elements(public.workflow_value_of(v_values, 'workflow.approval_steps')) with ordinality as x(e, i)
                            order by x.i);
    elsif p_event = 'unapprove' then
      if v_steps is null then
        -- 스냅샷 없는 xx(서비스 가져오기) — 새 라운드를 연다(D15). 철회할 승인이 없다
        if not v_settings_found then
          raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
        end if;
        v_new_round := v_round + 1;
        v_new_steps := array(select x.e ->> 'code'
                               from pg_catalog.jsonb_array_elements(public.workflow_value_of(v_values, 'workflow.approval_steps')) with ordinality as x(e, i)
                              order by x.i);
      else
        -- 마지막 단계 승인만 철회 — 같은 라운드에서 마지막 단계가 다시 대기(스냅샷 유지)
        update public.wbs_stage_approvals set revoked_at = v_now, revoked_by = p_actor, revoke_reason = 'unapprove'
         where wbs_item_id = v_item_id and round = v_round and step_code = v_steps[pg_catalog.cardinality(v_steps)] and revoked_at is null;
      end if;
    elsif p_event in ('reject','rework')
       or (p_event = 'set_stage' and v_old_stage in ('im','xx') and (v_new_stage is null or v_new_stage not in ('im','xx'))) then
      -- im·xx 이탈(사람 set_stage 는 stage_reset). im → xx 는 승인 판정이 기록했다
      update public.wbs_stage_approvals
         set revoked_at = v_now, revoked_by = p_actor,
             revoke_reason = case p_event when 'reject' then 'reject' when 'rework' then 'rework' else 'stage_reset' end
       where wbs_item_id = v_item_id and round = v_round and revoked_at is null;
    end if;
    if v_new_stage is null or v_new_stage not in ('im','xx') then
      v_new_steps := null;
    end if;
  end if;
  v_review_changed := v_item_found and (v_new_round is distinct from v_round or v_new_steps is distinct from v_steps);

  if v_apply then
    if v_credit_key = 'xx' then
      v_new_pct := 100;
    elsif v_credit_key is not null then
      -- SP5b(D20): workflow_value_of 로 읽는다 — 키 없음·JSON null 은 레지스트리 기본값, 모양 손상은 22023 CONFIG_INVALID(조용히 c_default 로 풀지 않는다).
      -- 설정 행이 없으면 비정상이라 거절한다.
      if not v_settings_found then
        raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
      end if;
      v_credits := public.workflow_value_of(v_values, 'workflow.stage_credits');
      v_credits := coalesce(v_credits, c_default);
      -- 표는 하나다(2026-09-16) — 항목 credit_key 로 고르지 않는다.
      v_table := coalesce(v_credits -> 'default', c_default -> 'default');
      v_new_pct := coalesce((v_table ->> v_credit_key)::numeric, (c_default -> 'default' ->> v_credit_key)::numeric);
    end if;
    if v_new_stage is distinct from v_old_stage then
      v_stage_changed := true;
      -- 첫 도달 = 선행 충족 기준의 단계 축(개정 §3.3.3) — reached: im|xx, final: xx
      if not v_settings_found then
        raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
      end if;
      v_gate := public.workflow_value_of(v_values, 'workflow.predecessor_gate') #>> '{}';
      v_reached_first := public.wbs_stage_reaches_gate(v_new_stage, v_gate) and not public.wbs_stage_reaches_gate(v_old_stage, v_gate);
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'stage', v_old_stage, v_new_stage);
    end if;
    if v_new_pct is not null and v_new_pct is distinct from v_old_pct then
      v_actual_changed := true;
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'actual_pct', v_old_pct::text, v_new_pct::text);
    end if;
  end if;
  if v_stage_changed or v_actual_changed or v_review_changed then
    update public.wbs_items
       set stage = case when v_stage_changed then v_new_stage else stage end,
           actual_pct = case when v_actual_changed then v_new_pct else actual_pct end,
           review_round = v_new_round,
           review_steps = v_new_steps,
           updated_at = v_now
     where id = v_item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_status', case when v_is_order_event then v_next end,
    'stage', case when v_stage_changed then v_new_stage else v_old_stage end,
    'actual_pct', case when v_actual_changed then v_new_pct else v_old_pct end,
    'stage_changed', v_stage_changed,
    'actual_changed', v_actual_changed,
    'reached_first', v_reached_first,
    'skipped', v_skipped)
    || case when v_approval is not null then jsonb_build_object('approval', v_approval) else '{}'::jsonb end;
end;
$$;
revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid, text) to service_role;

-- ⑤ guard_workflow_columns(D13 — 개정:3684 H2 이월 이행) — JWT 세션의 흐름 다섯 열(stage·review_round·review_steps·dev_workflow·tags) 쓰기를
-- 막는다. 멤버는 guard_non_admin_column_scope 의 diff 로 막히지만 관리자는 그 가드를 통과해 PostgREST 직접 PATCH 가 됐다 — 다문장 우회
-- (dev_workflow·태그 끄기 → 실적 100 → 다시 켜기)와 승인 건너뛴 stage 조작을 닫는다. RPC·서버 경로(auth.uid() null — service_role)는 통과.
-- INSERT 는 흐름이 꺼진 빈 행만(S7 — 앱의 JWT insert 는 다섯 열을 쓰지 않는다, tags 기본은 null).
-- 트리거 이름 순: guard_workflow_actual → guard_workflow_columns → trg_guard_non_admin_column_scope(기존 LOCKED 기대 유지 — B-22)
create function public.guard_workflow_columns() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.stage is not null or new.review_round <> 0 or new.review_steps is not null
       or coalesce(new.dev_workflow, false) or coalesce(pg_catalog.cardinality(new.tags), 0) <> 0 then
      raise exception using errcode = '42501', message = 'WORKFLOW_COLUMNS_RPC_ONLY';
    end if;
  elsif (new.stage, new.review_round, new.review_steps, new.dev_workflow, new.tags)
        is distinct from (old.stage, old.review_round, old.review_steps, old.dev_workflow, old.tags) then
    raise exception using errcode = '42501', message = 'WORKFLOW_COLUMNS_RPC_ONLY';
  end if;
  return new;
end
$$;
revoke all on function public.guard_workflow_columns() from public, anon, authenticated;
create trigger guard_workflow_columns before insert or update of stage, review_round, review_steps, dev_workflow, tags on public.wbs_items
  for each row execute function public.guard_workflow_columns();

-- ⑥ guard_workflow_actual 교체(D14) — 순서: 값 불변·≤99 통과 → im ∧ 유효 단계 ≥2 → APPROVAL_REQUIRED(dev_workflow 무관 — 서버 경로로 흐름을 꺼도
-- 대기 라운드의 실적 100 은 막힌다) → dev_workflow 아니면 통과 → 0011 잠금 절(태그 → 격리 → 주문) → xx 아님 ∧ 유효 단계 ≥2 → APPROVAL_REQUIRED.
-- 유효 단계는 RPC 와 같은 규칙(im·xx 이고 스냅샷이 있으면 스냅샷, 그 밖은 현재 설정). 설정 판독은 격리 검사 뒤 FOR SHARE.
-- INSERT 갈래는 new.* 로 본다(B-22) — JWT INSERT 는 ⑤ 가 흐름이 꺼진 빈 행만 허용하므로 사실상 통과한다.
create or replace function public.guard_workflow_actual() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_project uuid;
  v_stage text;
  v_steps text[];
  v_dev boolean;
  v_tags text[];
  v_values jsonb;
  v_n integer;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and new.actual_pct is not distinct from old.actual_pct then return new; end if;
  if coalesce(new.actual_pct, 0) <= 99 then return new; end if;
  if tg_op = 'INSERT' then
    v_id := new.id; v_project := new.project_id; v_stage := new.stage; v_steps := new.review_steps; v_dev := new.dev_workflow; v_tags := new.tags;
  else
    v_id := old.id; v_project := old.project_id; v_stage := old.stage; v_steps := old.review_steps; v_dev := old.dev_workflow; v_tags := old.tags;
  end if;
  -- 격리 수준 규칙(0011 ①·⑧·⑨·⑩ 공통): 잠금 아래에서 다른 행(설정·주문)을 읽어 판정하는 가드는 read committed 가 아니면 거절한다(fail-closed, 25001).
  -- 스냅샷만으로 판정되는 im 행과 태그 판정은 이 행의 값이라 검사 앞에 둔다.
  if v_stage = 'im' then
    if v_steps is not null then
      v_n := pg_catalog.cardinality(v_steps);
    else
      if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
        raise exception using errcode = '25001', message = 'WORKFLOW_ACTUAL_ISOLATION';
      end if;
      select s."values" into v_values from public.project_settings s where s.project_id = v_project for share;
      if not found then
        raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
      end if;
      v_n := pg_catalog.jsonb_array_length(public.workflow_value_of(v_values, 'workflow.approval_steps'));
    end if;
    if v_n >= 2 then
      raise exception using errcode = '42501', message = 'WORKFLOW_APPROVAL_REQUIRED';
    end if;
  end if;
  if not coalesce(v_dev, false) then return new; end if;
  -- 위임 태그는 이 행의 값이다 — 다른 행을 읽지 않고 판정한다
  if 'agent' = any(coalesce(v_tags, '{}'::text[])) then
    raise exception using errcode = '42501', message = 'WORKFLOW_ACTUAL_LOCKED';
  end if;
  -- 여기부터는 다른 표(주문·설정)를 읽어 판정한다. 이 행은 트리거가 돌기 전에 UPDATE 가 잠갔고, 점유·보고 사건(apply_workflow_event)도 항목
  -- 행을 잠그므로 둘은 이 행 잠금으로 직렬화된다. 놓치는 것: 항목 행 잠금을 기다리는 사이 커밋된 점유 — 점유가 항목 행을 바꾸지 않았으면 직렬화 오류도 나지 않는다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'WORKFLOW_ACTUAL_ISOLATION';
  end if;
  if exists (select 1 from public.agent_work_orders o where o.wbs_item_id = v_id and o.status in ('claimed', 'reported')) then
    raise exception using errcode = '42501', message = 'WORKFLOW_ACTUAL_LOCKED';
  end if;
  if v_stage is distinct from 'xx' then
    if v_n is null then
      select s."values" into v_values from public.project_settings s where s.project_id = v_project for share;
      if not found then
        raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
      end if;
      v_n := pg_catalog.cardinality(public.wbs_effective_steps(v_stage, v_steps, v_values));
    end if;
    if v_n >= 2 then
      raise exception using errcode = '42501', message = 'WORKFLOW_APPROVAL_REQUIRED';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.guard_workflow_actual() from public, anon, authenticated;
drop trigger guard_workflow_actual on public.wbs_items;
create trigger guard_workflow_actual before insert or update of actual_pct on public.wbs_items
  for each row execute function public.guard_workflow_actual();

-- ⑦ settings_ref_check — SP5b I 본문(0025) 위에 workflow.* 분기를 더한다(롤백은 I 본문으로 — S10)
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
  -- SP5b W1(스펙 §3.3 ⑨, 비평 반영 — S8·B-21): workflow.* 여섯 키 — 새 값의 SQL 모양 검사를 먼저(TS 만 통과한 값이 저장되면 그 프로젝트의
  -- 흐름 사건이 22023 으로 멈춘다 — DB 쪽 마지막 방어). workflow.approval_steps 는 대기 라운드의 스냅샷 단계 삭제(pending_round)와 대기 단계의
  -- 승인자 넓히기(approver_widen — admin → subtree_or_admin)를 거부한다. 대기 라운드 = im 이고 스냅샷에 미승인 단계가 있음, 또는 xx 이고 스냅샷이
  -- 있음(unapprove 가 마지막 단계를 되살린다). 좁히기(→ admin)는 언제나 허용 — 권한을 넓히지 않는다. 옛 값이 손상이면 승인자를 모두 admin 으로 본다.
  if p_key in ('workflow.stage_credits', 'workflow.credit_policy', 'workflow.approval_steps',
               'workflow.approval_distinct_approvers', 'workflow.predecessor_gate', 'workflow.wbs_stage_labels') then
    v_new := public.workflow_value_of(case when p_new is null then '{}'::jsonb else pg_catalog.jsonb_build_object(p_key, p_new) end, p_key);
    if p_key = 'workflow.approval_steps' then
      begin
        v_old := public.workflow_value_of(case when p_old is null then '{}'::jsonb else pg_catalog.jsonb_build_object(p_key, p_old) end, p_key);
      exception when sqlstate '22023' then
        v_old := '[]'::jsonb;
      end;
      select s.code, pg_catalog.count(*) as cnt into v_hit
        from public.wbs_items w
        cross join lateral pg_catalog.unnest(w.review_steps) as s(code)
       where w.project_id = p_project_id and w.review_steps is not null
         and (w.stage = 'xx'
              or (w.stage = 'im' and exists (select 1 from pg_catalog.unnest(w.review_steps) as u(code)
                                              where not exists (select 1 from public.wbs_stage_approvals a
                                                                 where a.wbs_item_id = w.id and a.round = w.review_round
                                                                   and a.step_code = u.code and a.revoked_at is null))))
         and not exists (select 1 from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = s.code)
       group by s.code
       order by s.code
       limit 1;
      if found then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
          detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', 'pending_round', 'count', v_hit.cnt)::text;
      end if;
      select p.code, pg_catalog.count(*) as cnt into v_hit
        from (select case when w.stage = 'xx' then w.review_steps[pg_catalog.cardinality(w.review_steps)]
                          else (select s.code from pg_catalog.unnest(w.review_steps) with ordinality as s(code, i)
                                 where not exists (select 1 from public.wbs_stage_approvals a
                                                    where a.wbs_item_id = w.id and a.round = w.review_round
                                                      and a.step_code = s.code and a.revoked_at is null)
                                 order by s.i limit 1) end as code
                from public.wbs_items w
               where w.project_id = p_project_id and w.stage in ('im', 'xx') and w.review_steps is not null) p
       where p.code is not null
         and exists (select 1 from pg_catalog.jsonb_array_elements(v_new) e
                      where e ->> 'code' = p.code and e ->> 'approver' = 'subtree_or_admin')
         and coalesce((select o ->> 'approver' from pg_catalog.jsonb_array_elements(v_old) o where o ->> 'code' = p.code limit 1), 'admin') = 'admin'
       group by p.code
       order by p.code
       limit 1;
      if found then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
          detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', 'approver_widen', 'count', v_hit.cnt)::text;
      end if;
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

-- ⑧ set_dependency_waiver 삭제(개정 §3.3.3) — src·scripts·스킬 호출 0건인 죽은 RPC 라 선행 기준을 따라 재작성하지 않는다.
-- depends_waived 열과 정리 트리거(wbs_items_prune_waived)는 데이터 보존을 위해 남긴다. 롤백이 기준선 본문·권한으로 되살린다.
drop function public.set_dependency_waiver(uuid, text, boolean, text, uuid);

-- ⑨ 사후검사 WORKFLOW_POLICY_POSTCHECK — 읽기만 한다
do $$
declare
  v text;
begin
  if to_regprocedure('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid, text)') is null
     or to_regprocedure('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)') is not null
     or to_regprocedure('public.set_dependency_waiver(uuid, text, boolean, text, uuid)') is not null then
    raise exception 'WORKFLOW_POLICY_POSTCHECK: apply_workflow_event 시그니처(9인자 하나)·set_dependency_waiver 삭제가 기대와 다르다';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid, text)'::regprocedure
                    and not p.prosecdef and p.proconfig is null
                    and pg_catalog.strpos(p.prosrc, 'WORKFLOW_EVENT_ISOLATION') > 0
                    and pg_catalog.strpos(p.prosrc, 'c_default constant jsonb') > 0
                    and pg_catalog.strpos(p.prosrc, 'workflow_value_of(v_values, ''workflow.stage_credits'')') > 0) then
    raise exception 'WORKFLOW_POLICY_POSTCHECK: apply_workflow_event 의 INVOKER·격리 가드·c_default·크레딧 판독이 기대와 다르다';
  end if;
  -- EXECUTE: 새 함수·RPC 는 anon·authenticated 0, RPC 는 service_role 만
  select string_agg(f, ', ') into v
    from (values ('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid, text)'),
                 ('public.workflow_value_of(jsonb, text)'), ('public.wbs_effective_steps(text, text[], jsonb)'),
                 ('public.wbs_predecessor_reached(text, text, boolean, numeric, boolean)'), ('public.wbs_stage_reaches_gate(text, text)'),
                 ('public.guard_workflow_columns()'), ('public.guard_workflow_actual()')) as x(f)
   where has_function_privilege('anon', x.f, 'EXECUTE') or has_function_privilege('authenticated', x.f, 'EXECUTE');
  if v is not null then raise exception 'WORKFLOW_POLICY_POSTCHECK: anon·authenticated 가 실행할 수 있다: %', v; end if;
  if not has_function_privilege('service_role', 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'WORKFLOW_POLICY_POSTCHECK: service_role 이 apply_workflow_event 를 실행할 수 없다';
  end if;
  -- 트리거 셋(정의 문자열) — 흐름 열 가드·실적 가드(INSERT 포함)
  select string_agg(x.name, ', ') into v
    from (values ('guard_workflow_columns', 'CREATE TRIGGER guard_workflow_columns BEFORE INSERT OR UPDATE OF stage, review_round, review_steps, dev_workflow, tags ON public.wbs_items FOR EACH ROW EXECUTE FUNCTION guard_workflow_columns()'),
                 ('guard_workflow_actual', 'CREATE TRIGGER guard_workflow_actual BEFORE INSERT OR UPDATE OF actual_pct ON public.wbs_items FOR EACH ROW EXECUTE FUNCTION guard_workflow_actual()')) as x(name, def)
   where not exists (select 1 from pg_trigger g where g.tgrelid = 'public.wbs_items'::regclass and g.tgname = x.name and not g.tgisinternal
                        and g.tgenabled in ('O', 'A') and pg_get_triggerdef(g.oid) = x.def);
  if v is not null then raise exception 'WORKFLOW_POLICY_POSTCHECK: 트리거가 없거나 정의가 다르다: %', v; end if;
  if not exists (select 1 from pg_proc where oid = 'public.guard_workflow_columns()'::regprocedure and prosecdef and proconfig = array['search_path=""'])
     or not exists (select 1 from pg_proc where oid = 'public.guard_workflow_actual()'::regprocedure and prosecdef) then
    raise exception 'WORKFLOW_POLICY_POSTCHECK: 가드 함수가 DEFINER·search_path 고정이 아니다';
  end if;
  -- 기본값 리터럴 토큰(TS 레지스트리와 패리티는 tests/rls/workflow-policy.test.ts 가 값으로 본다)
  if public.workflow_value_of('{}'::jsonb, 'workflow.stage_credits') <> '{"default":{"as":0,"ip":30,"rw":50,"im":80,"xx":100}}'::jsonb
     or public.workflow_value_of('{}'::jsonb, 'workflow.predecessor_gate') <> '"reached"'::jsonb
     or public.workflow_value_of('{}'::jsonb, 'workflow.approval_steps') <> '[{"code":"review","label":null,"approver":"subtree_or_admin"}]'::jsonb then
    raise exception 'WORKFLOW_POLICY_POSTCHECK: workflow 기본값 리터럴이 기대와 다르다';
  end if;
  -- 이행: im·xx 는 라운드 1·{review}, 나머지 0·null
  if exists (select 1 from public.wbs_items where (stage in ('im', 'xx')) <> (review_steps is not null)) then
    raise exception 'WORKFLOW_POLICY_POSTCHECK: 라운드 이행이 기대와 다르다';
  end if;
  -- 원장 권한·RLS
  if not (select relrowsecurity from pg_class where oid = 'public.wbs_stage_approvals'::regclass)
     or has_table_privilege('anon', 'public.wbs_stage_approvals', 'SELECT')
     or has_table_privilege('authenticated', 'public.wbs_stage_approvals', 'INSERT')
     or has_table_privilege('authenticated', 'public.wbs_stage_approvals', 'UPDATE')
     or has_table_privilege('authenticated', 'public.wbs_stage_approvals', 'DELETE')
     or not has_table_privilege('authenticated', 'public.wbs_stage_approvals', 'SELECT') then
    raise exception 'WORKFLOW_POLICY_POSTCHECK: wbs_stage_approvals 권한·RLS 가 기대와 다르다';
  end if;
end $$;
