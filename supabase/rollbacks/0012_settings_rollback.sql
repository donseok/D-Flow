-- 0012_settings 롤백 — 0011 적용 직후의 카탈로그로 돌아간다(카탈로그 0 mismatch: supabase/rehearsal/compare-catalog.mjs diff,
-- pg_default_acl 대조 — 계획 docs/superpowers/plans/2026-09-28-sp3a-phase-a.md 의 리허설 R). 절은 정방향의 역순이다.
-- 되돌리지 않는 데이터:
--   · 설정 이력 두 표와 authz_events·authz_commands(권한 명령 원장)의 행 — 표와 함께 사라진다
--   · 열이 없던 키(modules.*·branding.*·navigation.menu·ai.enabled) — 버린다
--   · ③ 이 백필한 설정 행 — 남는다(0011 규칙도 만족한다)
--   · 0012 가 버린 열(max_depth·enabled_modules·weekly_sections·working_days·timezone·preset_applied·force_bottleneck_*) —
--     값은 돌아오지 않는다. 열은 기준선 기본값(null, force_bottleneck 은 3·4)으로 다시 생긴다
--   · 이행이 정규화한 값 — 단계 이름의 앞뒤 공백, 키워드·도메인의 대문자는 정규화된 채 돌아간다
--   · 명시 invites.allowed_domains = [] — '{}'(env 폴백)로 돌아간다. 0011 에는 "명시적 빈 목록"이 없다
--   · 미설정 core.milestone_keywords(0012 의 생성은 키워드를 저장하지 않는다 — 복사 원본 미설정·'기본값으로' unset 도 같다) —
--     제품 기본값 6개로 채운다. 0011 에는 기본값 폴백이 없어 '{}' 로 두면 키워드 마일스톤이 로그 없이 사라진다.
--     명시 [] 는 '{}' 그대로(빈 값을 미설정으로 되돌리지 않는다), 손상된 비배열도 '{}'(0012 코드에서도 마커 0건이었다)
--   · status = 'skipped' 잡 — dead_letter 로 돌아간다
--   · branding 버킷의 파일 바이트 — Storage 에 남는다(객체 행과 버킷 행만 지운다)
-- 재생성하는 두 표의 0011 모양(2026-09-28 실측): project_settings 는 16열이고 stage_credits 가 updated_by 뒤다. updated_by FK 는
-- NO ACTION, 권한은 authenticated=r · service_role=arwdDxtm · anon 없음, 정책은 project_settings_ws_read 하나. workspace_settings 는
-- 3열, 권한은 authenticated=arwd · service_role=arwdDxtm · anon 없음, 정책은 workspace_settings_read·workspace_settings_write.

begin;
-- ⑪ 브랜딩 버킷·잡 표 status — skipped 잡은 dead_letter 로 돌아간다. 버킷의 객체 행과 버킷 행을 지운다(파일 바이트는 Storage 에 남는다)
update public.ai_index_jobs set status = 'dead_letter' where status = 'skipped';
update public.wiki_processing_jobs set status = 'dead_letter' where status = 'skipped';
update public.wiki_project_rebuild_jobs set status = 'dead_letter' where status = 'skipped';
alter table public.ai_index_jobs drop constraint ai_index_jobs_status_check;
alter table public.ai_index_jobs add constraint ai_index_jobs_status_check
  check (status = any (array['pending'::text, 'running'::text, 'done'::text, 'dead_letter'::text]));
alter table public.wiki_processing_jobs drop constraint wiki_processing_jobs_status_check;
alter table public.wiki_processing_jobs add constraint wiki_processing_jobs_status_check
  check (status = any (array['pending'::text, 'running'::text, 'done'::text, 'dead_letter'::text]));
alter table public.wiki_project_rebuild_jobs drop constraint wiki_project_rebuild_jobs_status_check;
alter table public.wiki_project_rebuild_jobs add constraint wiki_project_rebuild_jobs_status_check
  check (status = any (array['pending'::text, 'running'::text, 'done'::text, 'dead_letter'::text]));
drop policy "branding read" on storage.objects;
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'branding';
delete from storage.buckets where id = 'branding';
reset storage.allow_delete_query;

-- ⑩-2 권한 RPC
drop function public.upsert_project_member_cmd(uuid, uuid, jsonb, jsonb, uuid[], uuid);
drop function public.set_workspace_role(uuid, uuid, uuid, text, uuid);
drop function public.set_platform_admin(uuid, uuid, boolean, uuid);

-- ⑩-1 권한 변경 이력 — 초대자 도장, 권한 표 TRUNCATE 거부, 기록 트리거, 명령 원장·기록 표(행은 되돌리지 않는다 — 표와 함께 사라진다)
drop trigger workspace_members_stamp_inviter on public.workspace_members;
drop function public.workspace_members_stamp_inviter();
drop trigger project_members_no_truncate on public.project_members;
drop trigger workspace_members_no_truncate on public.workspace_members;
drop trigger platform_admins_no_truncate on public.platform_admins;
drop function public.authz_tables_reject_truncate();
drop trigger authz_events_record on public.project_members;
drop trigger authz_events_record on public.workspace_members;
drop trigger authz_events_record on public.platform_admins;
drop function public.record_authz_event();
drop trigger workspaces_purge_authz_events on public.workspaces;
drop function public.purge_workspace_authz_events();
drop function public.purge_authz_events(uuid);
drop table public.authz_commands;
drop table public.authz_events;
drop function public.authz_events_reject_mutation();

-- ⑨-2 세션 프로젝트 insert 복구, 이력 불변 트리거·설정 표 TRUNCATE 거부 트리거 제거. 설정 두 표의 권한·정책
-- (workspace_settings_write 포함)은 아래 ⑦⑤② 의 표 재생성이 되돌린다
grant insert on public.projects to authenticated;
create policy wsadmin_insert_projects on public.projects for insert to authenticated
  with check (public.is_ws_admin(workspace_id));
drop trigger workspace_settings_history_no_truncate on public.workspace_settings_history;
drop trigger project_settings_history_no_truncate on public.project_settings_history;
drop function public.history_reject_truncate();
drop trigger workspace_settings_history_worm on public.workspace_settings_history;
drop trigger project_settings_history_worm on public.project_settings_history;
drop function public.settings_history_reject_mutation();
drop trigger workspace_settings_no_truncate on public.workspace_settings;
drop trigger project_settings_no_truncate on public.project_settings;
drop function public.settings_row_reject_truncate();

-- ⑨-1 행 유지·행 생성 트리거
drop trigger workspace_settings_keep_row on public.workspace_settings;
drop trigger project_settings_keep_row on public.project_settings;
drop function public.settings_row_keep();
drop trigger workspaces_settings_row on public.workspaces;
drop function public.ensure_workspace_settings_row();
drop trigger projects_settings_row on public.projects;
drop function public.ensure_project_settings_row();

-- ⑧-2 생성·복사 함수
drop function public.create_project_with_settings(uuid, text, date, date, text, jsonb, uuid, uuid, uuid, int);
drop function public.copy_project_config(uuid, uuid);

-- ⑧-1 설정 RPC
drop function public.apply_workspace_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text);
drop function public.apply_project_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text);
drop function public.settings_ref_check(uuid, text, jsonb, jsonb);

-- ⑦⑤② 설정 두 표 — 0011 모양으로 재생성한다(열을 drop·add 하면 컬럼 순서가 달라 카탈로그 대조가 깨진다 — 0003 롤백 선례).
-- 열이 있던 키는 values 에서 되돌려 채운다. 열이 없던 키(modules.*·branding.*·navigation.menu·ai.enabled)는 버린다.
-- max_depth 는 null, 명시 invites.allowed_domains = [] 는 '{}'(env 폴백)로 돌아간다.
create temp table sp3a_ps_keep on commit drop as
  select s.project_id, s."values" as v, s.updated_at, s.updated_by from public.project_settings s;
drop table public.project_settings;
create table public.project_settings (
    project_id uuid not null,
    level_labels text[] default array['Phase'::text, 'Task'::text, 'Activity'::text] not null,
    max_depth integer,
    extra_axis_label text,
    milestone_keywords text[] default array[]::text[] not null,
    excel_profile jsonb default '{}'::jsonb not null,
    enabled_modules text[],
    weekly_sections text[],
    working_days integer[],
    timezone text,
    preset_applied text,
    updated_at timestamp with time zone default now() not null,
    updated_by uuid,
    stage_credits jsonb,
    force_bottleneck_min_successors integer default 3 not null,
    force_bottleneck_min_hours integer default 4 not null,
    constraint project_settings_force_bottleneck_positive check (((force_bottleneck_min_successors >= 1) and (force_bottleneck_min_hours >= 1)))
);
alter table only public.project_settings add constraint project_settings_pkey primary key (project_id);
alter table only public.project_settings
  add constraint project_settings_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade;
alter table only public.project_settings
  add constraint project_settings_updated_by_fkey foreign key (updated_by) references auth.users(id);
alter table public.project_settings enable row level security;
revoke all on public.project_settings from anon, authenticated;
grant select on public.project_settings to authenticated;
create policy project_settings_ws_read on public.project_settings for select to authenticated
  using (project_id in (select public.accessible_project_ids()));
insert into public.project_settings
  (project_id, level_labels, extra_axis_label, milestone_keywords, excel_profile, updated_at, updated_by, stage_credits)
select k.project_id,
       case when jsonb_typeof(k.v -> 'core.level_labels') = 'array'
            then array(select jsonb_array_elements_text(k.v -> 'core.level_labels'))
            else array['Phase', 'Task', 'Activity'] end,
       case when jsonb_typeof(k.v -> 'core.extra_axis_label') = 'string' then k.v ->> 'core.extra_axis_label' end,
       case when jsonb_typeof(k.v -> 'core.milestone_keywords') = 'array'
            then array(select jsonb_array_elements_text(k.v -> 'core.milestone_keywords'))
            -- 미설정 = 레지스트리 기본값(src/lib/settings/defs/project.ts DEFAULT_MILESTONE_KEYWORDS — 옛 createProject 의 여섯)
            when not (k.v ? 'core.milestone_keywords')
            then array['마일스톤', 'milestone', '킥오프', 'kick-off', '오픈', '완료보고']
            else array[]::text[] end,
       case when jsonb_typeof(k.v -> 'wbs.excel_profile') = 'object' then k.v -> 'wbs.excel_profile' else '{}'::jsonb end,
       k.updated_at, k.updated_by,
       case when jsonb_typeof(k.v -> 'workflow.stage_credits') = 'object' then k.v -> 'workflow.stage_credits' end
  from sp3a_ps_keep k;

create temp table sp3a_ws_keep on commit drop as
  select s.workspace_id, s."values" as v, s.updated_at from public.workspace_settings s;
drop table public.workspace_settings;
create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  allowed_domains text[] not null default '{}'
    check (array_position(allowed_domains, null) is null),
  updated_at timestamptz not null default now()
);
alter table public.workspace_settings enable row level security;
revoke all on public.workspace_settings from anon, authenticated;
grant select, insert, update, delete on public.workspace_settings to authenticated, service_role;
create policy workspace_settings_read on public.workspace_settings for select to authenticated
  using (public.is_ws_member(workspace_id));
create policy workspace_settings_write on public.workspace_settings for all to authenticated
  using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
insert into public.workspace_settings (workspace_id, allowed_domains, updated_at)
select k.workspace_id,
       case when jsonb_typeof(k.v -> 'invites.allowed_domains') = 'array'
            then array(select jsonb_array_elements_text(k.v -> 'invites.allowed_domains'))
            else '{}'::text[] end,
       k.updated_at
  from sp3a_ws_keep k;

-- ⑥ apply_workflow_event — 0011 원문(supabase/migrations/0011_authz_hardening.sql:676-909)을 바이트 그대로. create or replace 라 ACL 은 그대로다
create or replace function public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_agent_user_id uuid DEFAULT NULL::uuid, p_expected_report_id uuid DEFAULT NULL::uuid) RETURNS jsonb
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

-- ④ 설정 이력 두 표(이력은 되돌리지 않는다 — 표와 함께 사라진다)
drop table public.workspace_settings_history;
drop table public.project_settings_history;

-- ② agent_projects.created_by FK 를 NO ACTION 으로(설정 두 표의 열·FK 는 위 ⑦⑤② 의 재생성이 되돌렸다).
-- 백필(③)한 설정 행은 남는다(0011 규칙도 만족한다)
alter table public.agent_projects drop constraint agent_projects_created_by_fkey;
alter table public.agent_projects add constraint agent_projects_created_by_fkey
  foreign key (created_by) references auth.users(id);

commit;
