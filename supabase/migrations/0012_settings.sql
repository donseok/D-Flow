-- 0012_settings — 설정 저장소·쓰기 계약·권한 변경 이력(SP3a Phase A). 정본: docs/superpowers/specs/2026-09-27-sp3a-settings-engine-design.md §3·§6,
-- 개정 docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md §2.2~§2.4.
-- 절 순서: ① 사전검사 ② 열 추가·FK 교체 ③ 누락 행 백필 ④ 설정 이력 두 표 ⑤ 넓은 열 이행·이행 이력 ⑥ apply_workflow_event 판독 교체
--          ⑦ 넓은 열 drop ⑧ 함수(설정 RPC·생성·복사) ⑨ 설정 표의 권한·정책·트리거 ⑩ 권한 변경 이력 authz_events
--          ⑪ 브랜딩 버킷·잡 표 status ⑫ 종합 사후검사.
-- 값의 스키마는 DB 에 없다 — 키 이름·타입·검증은 코드 레지스트리(src/lib/settings/registry.ts)가 정하고 DB 는 values 에 결과만 둔다.
-- values 의 키는 점이 든 평면 문자열이다(values->'core.level_labels'). 중첩 경로가 아니다.
-- 새 함수는 revoke/grant 를 명시한다 — 새 함수는 PUBLIC(내장 기본값 — 따라서 anon)과 authenticated·service_role(postgres 의 public
-- 기본 권한)의 EXECUTE 를 받고 생긴다. 회수는 `revoke all … from public, anon, authenticated` 꼴이다. authenticated 가 실행하는 새 함수는 없다.
-- 새 표는 `revoke all … from anon, authenticated` 뒤 `grant select … to authenticated` 만 한다(기본 권한이 anon r · authenticated arwd 를 준다).
-- CLI 가 파일 하나를 한 트랜잭션으로 적용하므로 begin/commit 을 쓰지 않는다. 롤백: supabase/rollbacks/0012_settings_rollback.sql.
-- 리허설: supabase/rehearsal/0012_precheck_violations.sql · 0012_seed_wide.sql · 0012_smoke.sql.

-- ① 사전검사 --------------------------------------------------------------------------------------------------------
do $$
declare
  v_msgs text := '';
  v_n int;
  v_rows text;
  -- 앱의 String.prototype.trim 이 떼는 공백 전부(ECMAScript WhiteSpace·LineTerminator) — btrim 기본값은 공백 문자 하나뿐이다
  c_ws constant text := E' \t\n\u000b\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
begin
  select count(*), string_agg(s.project_id::text, ', ' order by s.project_id) into v_n, v_rows
    from public.project_settings s where jsonb_typeof(s.excel_profile) is distinct from 'object';
  if v_n > 0 then
    v_msgs := v_msgs || format(E'\n  [프로파일 모양] excel_profile 이 객체가 아닌 프로젝트 %s건: %s — 그 행을 ''{}'' 로 고친다'
      || E'(update public.project_settings set excel_profile = ''{}'' where project_id = …)', v_n, left(v_rows, 600));
  end if;

  select count(*), string_agg(s.project_id::text, ', ' order by s.project_id) into v_n, v_rows
    from public.project_settings s
   where s.stage_credits is not null
     and (jsonb_typeof(s.stage_credits) is distinct from 'object'
          or jsonb_typeof(s.stage_credits -> 'default') is distinct from 'object');
  if v_n > 0 then
    v_msgs := v_msgs || format(E'\n  [크레딧 모양] stage_credits 가 객체가 아니거나 default 표가 없는 프로젝트 %s건: %s — null 로 고친다'
      || E'(update public.project_settings set stage_credits = null where project_id = …)', v_n, left(v_rows, 600));
  end if;

  select count(*), string_agg(s.project_id::text, ', ' order by s.project_id) into v_n, v_rows
    from public.project_settings s
   where cardinality(s.level_labels) not between 1 and 10
      or exists (select 1 from unnest(s.level_labels) as l(v) where l.v is null or btrim(l.v, c_ws) = '')
      or (select count(distinct btrim(l.v, c_ws)) from unnest(s.level_labels) as l(v)) <> cardinality(s.level_labels);
  if v_n > 0 then
    v_msgs := v_msgs || format(E'\n  [단계 라벨] level_labels 가 1~10개가 아니거나 빈 이름·중복이 있는 프로젝트 %s건: %s — 라벨을 고친다', v_n, left(v_rows, 600));
  end if;

  -- ⑤ 가 옮기는 값 가운데 레지스트리 parse(src/lib/settings/defs/project.ts)가 거절할 것 — 옮긴 뒤에는 그 프로젝트를 읽지 못한다.
  -- 한도는 parse 와 같다 — trim 뒤 JS 의 length(UTF-16 단위: U+FFFF 위의 글자는 2). 도메인·크레딧 표의 세부 검증은
  -- settings:verify 몫이다(스펙).
  select count(*), string_agg(s.project_id::text, ', ' order by s.project_id) into v_n, v_rows
    from public.project_settings s
   where s.extra_axis_label is not null
     and (select char_length(t.v) + char_length(regexp_replace(t.v, '[^\U00010000-\U0010FFFF]', '', 'g'))
            from (select btrim(s.extra_axis_label, c_ws) as v) t) not between 1 and 20;
  if v_n > 0 then
    v_msgs := v_msgs || format(E'\n  [추가 축 이름] extra_axis_label 이 비었거나 20자를 넘는 프로젝트 %s건: %s — 1~20자로 고치거나 null 로 둔다', v_n, left(v_rows, 600));
  end if;

  select count(*), string_agg(s.project_id::text, ', ' order by s.project_id) into v_n, v_rows
    from public.project_settings s
   where exists (select 1 from unnest(s.milestone_keywords) as k(v)
                  cross join lateral (select btrim(k.v, c_ws) as v) t
                  where k.v is null
                     or char_length(t.v) + char_length(regexp_replace(t.v, '[^\U00010000-\U0010FFFF]', '', 'g')) not between 1 and 40);
  if v_n > 0 then
    v_msgs := v_msgs || format(E'\n  [마일스톤 키워드] milestone_keywords 에 비었거나 null 이거나 40자를 넘는 항목이 있는 프로젝트 %s건: %s — 그 항목을 고치거나 뺀다', v_n, left(v_rows, 600));
  end if;

  -- §9 #1 — 깊이 제한 = 단계 이름 수(기본값). 대안(깊이 제한 없음)이면 이 블록을 지운다 ---------------------------
  with recursive walk as (
    select w.id, w.project_id, 1 as levels, array[w.id] as path
      from public.wbs_items w
     where not w.is_owner_split and w.stub_for is null
       and (w.parent_id is null or not exists (select 1 from public.wbs_items p where p.id = w.parent_id))
    union all
    select c.id, c.project_id, walk.levels + 1, walk.path || c.id
      from public.wbs_items c join walk on c.parent_id = walk.id
     where not c.is_owner_split and c.stub_for is null and c.id <> all (walk.path)
  ), deep as (
    select walk.project_id, max(walk.levels) as levels from walk group by walk.project_id
  )
  -- 설정 행이 없는 프로젝트는 ③ 이 기본 라벨 3개로 백필하므로 그 수와 비교한다(내부 조인이면 조용히 빠진다)
  select count(*), string_agg(format('%s(트리 %s단 > 라벨 %s개)', d.project_id, d.levels,
                                     cardinality(coalesce(s.level_labels, array['Phase', 'Task', 'Activity']))), ', ' order by d.project_id)
    into v_n, v_rows
    from deep d left join public.project_settings s on s.project_id = d.project_id
   where d.levels > cardinality(coalesce(s.level_labels, array['Phase', 'Task', 'Activity']));
  if v_n > 0 then
    v_msgs := v_msgs || format(E'\n  [트리 깊이] WBS 가 단계 이름 수보다 깊은 프로젝트 %s건: %s — 단계 이름을 더한다', v_n, left(v_rows, 600));
  end if;
  -- §9 #1 끝 ---------------------------------------------------------------------------------------------------------

  if v_msgs <> '' then
    raise exception 'SP3A_0012_PRECHECK: 설정 이행을 멈춘다(보정하지 않는다). 아래를 고치고 그 SQL 을 기록으로 남긴 뒤 다시 적용한다:%', v_msgs
      using errcode = '23514';
  end if;
end $$;

-- ② 열 추가·FK 교체 -------------------------------------------------------------------------------------------------
alter table public.project_settings
  add column "values"       jsonb  not null default '{}'::jsonb
    constraint project_settings_values_check check (jsonb_typeof("values") = 'object'),
  add column schema_version int    not null default 1,
  add column revision       bigint not null default 0;
alter table public.project_settings drop constraint project_settings_updated_by_fkey;
alter table public.project_settings add constraint project_settings_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

alter table public.workspace_settings
  add column "values"       jsonb  not null default '{}'::jsonb
    constraint workspace_settings_values_check check (jsonb_typeof("values") = 'object'),
  add column schema_version int    not null default 1,
  add column revision       bigint not null default 0,
  add column updated_by     uuid
    constraint workspace_settings_updated_by_fkey references auth.users(id) on delete set null;

alter table public.agent_projects drop constraint agent_projects_created_by_fkey;
alter table public.agent_projects add constraint agent_projects_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- ③ 누락 행 백필 ------------------------------------------------------------------------------------------------------
insert into public.project_settings (project_id) select p.id from public.projects p
 where not exists (select 1 from public.project_settings s where s.project_id = p.id);
insert into public.workspace_settings (workspace_id) select w.id from public.workspaces w
 where not exists (select 1 from public.workspace_settings s where s.workspace_id = w.id);

-- ④ 설정 이력 두 표 ---------------------------------------------------------------------------------------------------
create table public.project_settings_history (
  id             bigint generated always as identity primary key,
  project_id     uuid   not null references public.projects(id) on delete cascade,
  revision       bigint not null,
  key            text   not null,
  old_value      jsonb,
  new_value      jsonb,
  source         text   not null check (source in ('edit', 'create', 'copy', 'migration', 'internal')),
  copied_from    uuid,
  command_id     uuid   not null,
  command_digest text,
  changed_by     uuid,
  changed_at     timestamptz not null default now(),
  constraint project_settings_history_rev_key_uq unique (project_id, revision, key)
);
create index project_settings_history_key_idx on public.project_settings_history (project_id, key, revision desc);
create index project_settings_history_command_idx on public.project_settings_history (project_id, command_id);
alter table public.project_settings_history enable row level security;
revoke all on public.project_settings_history from anon, authenticated;
grant select on public.project_settings_history to authenticated;
revoke all on sequence public.project_settings_history_id_seq from anon, authenticated;
create policy project_settings_history_read on public.project_settings_history for select to authenticated
  using (project_id in (select public.accessible_project_ids()));

create table public.workspace_settings_history (
  id             bigint generated always as identity primary key,
  workspace_id   uuid   not null references public.workspaces(id) on delete cascade,
  revision       bigint not null,
  key            text   not null,
  old_value      jsonb,
  new_value      jsonb,
  source         text   not null check (source in ('edit', 'create', 'copy', 'migration', 'internal')),
  command_id     uuid   not null,
  command_digest text,
  changed_by     uuid,
  changed_at     timestamptz not null default now(),
  constraint workspace_settings_history_rev_key_uq unique (workspace_id, revision, key)
);
create index workspace_settings_history_key_idx on public.workspace_settings_history (workspace_id, key, revision desc);
create index workspace_settings_history_command_idx on public.workspace_settings_history (workspace_id, command_id);
alter table public.workspace_settings_history enable row level security;
revoke all on public.workspace_settings_history from anon, authenticated;
grant select on public.workspace_settings_history to authenticated;
revoke all on sequence public.workspace_settings_history_id_seq from anon, authenticated;
create policy workspace_settings_history_read on public.workspace_settings_history for select to authenticated
  using ((select public.is_ws_member(workspace_id)));

-- ⑤ 넓은 열 이행 ------------------------------------------------------------------------------------------------------
update public.project_settings s
   set "values" = s."values"
       || jsonb_build_object('core.level_labels',
            (select jsonb_agg(btrim(u.v, k.ws) order by u.o) from unnest(s.level_labels) with ordinality as u(v, o)))
       || jsonb_build_object('core.milestone_keywords',
            coalesce((select jsonb_agg(lower(btrim(u.v, k.ws)) order by u.o) from unnest(s.milestone_keywords) with ordinality as u(v, o)), '[]'::jsonb))
       || case when s.extra_axis_label is null then '{}'::jsonb
               else jsonb_build_object('core.extra_axis_label', btrim(s.extra_axis_label, k.ws)) end
       || case when s.excel_profile = '{}'::jsonb then '{}'::jsonb
               else jsonb_build_object('wbs.excel_profile', s.excel_profile) end
       || case when s.stage_credits is null then '{}'::jsonb
               else jsonb_build_object('workflow.stage_credits', s.stage_credits) end
       || jsonb_build_object('modules.enabled',
            (select jsonb_agg(m.id order by m.o)
               from unnest(
                 -- 동결 목록(프로젝트 9) — tests/modules/registry.test.ts 가 이 줄을 읽는다
                 array['kanban','meetings','weekly','issues','announcements','attendance','agents','wiki','chatbot']
               ) with ordinality as m(id, o)
              where m.id <> 'agents'
                 or exists (select 1 from public.agent_projects a where a.project_id = s.project_id and a.enabled))),
       revision = 1, schema_version = 1
  -- k.ws: 앱 trim 의 공백 전부(① 의 c_ws 와 같다)
  from (select E' \t\n\u000b\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff' as ws) k;

update public.workspace_settings s
   set "values" = s."values"
       || case when cardinality(s.allowed_domains) = 0 then '{}'::jsonb
               else jsonb_build_object('invites.allowed_domains',
                 (select jsonb_agg(lower(btrim(u.v, k.ws)) order by u.o) from unnest(s.allowed_domains) with ordinality as u(v, o))) end
       || jsonb_build_object('modules.allowed', to_jsonb(
            -- 동결 목록(워크스페이스 13) — tests/modules/registry.test.ts 가 이 줄을 읽는다
            array['kanban','meetings','weekly','issues','announcements','attendance','agents','wiki','chatbot','minutes','minutes_integration','portfolio','usage']
          )),
       revision = 1, schema_version = 1
  from (select E' \t\n\u000b\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff' as ws) k;

insert into public.project_settings_history (project_id, revision, key, old_value, new_value, source, command_id)
select s.project_id, 1, e.key, null, e.value, 'migration', c.command_id
  from public.project_settings s
  join (select p.project_id, gen_random_uuid() as command_id from public.project_settings p) c on c.project_id = s.project_id
 cross join lateral jsonb_each(s."values") as e(key, value);
insert into public.workspace_settings_history (workspace_id, revision, key, old_value, new_value, source, command_id)
select s.workspace_id, 1, e.key, null, e.value, 'migration', c.command_id
  from public.workspace_settings s
  join (select w.workspace_id, gen_random_uuid() as command_id from public.workspace_settings w) c on c.workspace_id = s.workspace_id
 cross join lateral jsonb_each(s."values") as e(key, value);

-- ⑥ apply_workflow_event 판독 교체 -----------------------------------------------------------------------------------
-- 0011 원문(0011:676-909)에서 두 곳만 다르다: 머리의 create or replace, 크레딧 판독 한 줄 → values 의 키 + 행 부재 거절.
-- 8인자 시그니처·INVOKER·search_path 없음·c_default 선언·WORKFLOW_EVENT_ISOLATION 블록은 그대로다. create or replace 라
-- ACL(service_role 만)이 유지된다. plpgsql 은 열 의존성을 추적하지 않는다 — 이 절 없이 ⑦ 을 하면 적용은 되고 런타임에 깨진다.
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

-- ⑦ 넓은 열 drop --------------------------------------------------------------------------------------------------------
alter table public.project_settings
  drop constraint project_settings_force_bottleneck_positive,
  drop column level_labels, drop column max_depth, drop column extra_axis_label, drop column milestone_keywords,
  drop column excel_profile, drop column enabled_modules, drop column weekly_sections, drop column working_days,
  drop column timezone, drop column preset_applied, drop column stage_credits,
  drop column force_bottleneck_min_successors, drop column force_bottleneck_min_hours;
alter table public.workspace_settings
  drop constraint workspace_settings_allowed_domains_check,
  drop column allowed_domains;

-- ⑧ 함수 — 설정 RPC(⑧-1) -------------------------------------------------------------------------------------------
create function public.settings_ref_check(p_project_id uuid, p_key text, p_old jsonb, p_new jsonb)
returns void language plpgsql set search_path to '' as $$
begin
  return;   -- 분기 없음(SP3a). 참조형 키를 등록하는 SP 가 create or replace 로 분기를 더한다
end $$;
revoke all on function public.settings_ref_check(uuid, text, jsonb, jsonb) from public, anon, authenticated;

create function public.apply_project_settings(
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
revoke all on function public.apply_project_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text) from public, anon, authenticated;
grant execute on function public.apply_project_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text) to service_role;

create function public.apply_workspace_settings(
  p_workspace_id uuid, p_expected_revision bigint, p_command_id uuid,
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
  select s."values", s.revision, s.schema_version into v_values, v_rev, v_ver
    from public.workspace_settings s where s.workspace_id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  -- 격리 수준 규칙(0011 공통, 스펙 D1): 잠금 아래에서 이력을 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 행 잠금을 기다리는 사이 커밋된 같은 명령의 이력 — 재전송이 duplicate 가 아니라 conflict 로 보인다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  -- 요약은 jsonb 한 덩어리 — 구분자로 이어 붙이면 unset ['a,b'] 와 ['a','b'] 가 같은 요약이 된다
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'set', v_set,
    'unset', pg_catalog.to_jsonb(array(select distinct x.k from pg_catalog.unnest(v_unset) as x(k) order by x.k)))::text, 'UTF8')), 'hex');
  select max(h.revision), max(h.command_digest) into v_dup_rev, v_dup_digest
    from public.workspace_settings_history h
   where h.workspace_id = p_workspace_id and h.command_id = p_command_id and h.changed_by is not distinct from p_actor;
  if v_dup_rev is not null then
    if v_dup_digest is distinct from v_digest then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'revision', v_dup_rev);
  end if;
  if v_ver > p_schema_version then
    raise exception using errcode = 'P0001', message = 'SETTINGS_SCHEMA_AHEAD';
  end if;
  v_next := (v_values - v_unset) || v_set;
  if v_next = v_values then
    return pg_catalog.jsonb_build_object('status', 'applied', 'revision', v_rev, 'changed', 0);
  end if;
  if v_rev is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'SETTINGS_REVISION_CONFLICT', detail = v_rev::text;
  end if;
  if v_rev >= 9007199254740991 then
    raise exception using errcode = 'P0001', message = 'SETTINGS_REVISION_OVERFLOW';
  end if;
  update public.workspace_settings s
     set "values" = v_next, revision = v_rev + 1, schema_version = p_schema_version,
         updated_at = pg_catalog.now(), updated_by = p_actor
   where s.workspace_id = p_workspace_id;
  insert into public.workspace_settings_history
    (workspace_id, revision, key, old_value, new_value, source, command_id, command_digest, changed_by)
  select p_workspace_id, v_rev + 1, x.key, v_values -> x.key, v_next -> x.key, p_source, p_command_id, v_digest, p_actor
    from (select pg_catalog.jsonb_object_keys(v_set) as key union select pg_catalog.unnest(v_unset)) x
   where (v_values -> x.key) is distinct from (v_next -> x.key);
  return pg_catalog.jsonb_build_object('status', 'applied', 'revision', v_rev + 1);
end $$;
revoke all on function public.apply_workspace_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text) from public, anon, authenticated;
grant execute on function public.apply_workspace_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text) to service_role;

-- ⑧ 함수 — 생성·복사(⑧-2) ------------------------------------------------------------------------------------------
create function public.copy_project_config(p_src uuid, p_dst uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_src_ws uuid;
  v_dst_ws uuid;
begin
  select p.workspace_id into v_src_ws from public.projects p where p.id = p_src;
  select p.workspace_id into v_dst_ws from public.projects p where p.id = p_dst;
  if v_src_ws is null or v_dst_ws is null or v_src_ws <> v_dst_ws or p_src = p_dst then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  if exists (select 1 from public.project_areas a where a.project_id = p_dst)
     or exists (select 1 from public.teams t where t.project_id = p_dst) then
    raise exception using errcode = '23514', message = 'COPY_TARGET_NOT_EMPTY';
  end if;
  -- 복사는 생성 RPC 안에서만 — 생성 RPC 가 먼저 남긴 복사 이력(revision 1·copy·copied_from = 원본)이 있어야 한다.
  -- 없으면 service_role 의 단독 호출이 기존의 빈 프로젝트에 이력 없이 팀·영역을 덧붙일 수 있다
  if not exists (select 1 from public.project_settings_history h
                  where h.project_id = p_dst and h.revision = 1 and h.source = 'copy' and h.copied_from = p_src) then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  -- 프로젝트 전용 팀: 코드가 (workspace, project, code) 로 유일하므로 코드로 옛 팀 ↔ 새 팀을 잇는다
  insert into public.teams (code, name, sort_order, active, progress_visible, project_id, workspace_id, color)
  select t.code, t.name, t.sort_order, t.active, t.progress_visible, p_dst, t.workspace_id, t.color
    from public.teams t where t.project_id = p_src;
  -- 영역: (project, kind, code) 로 유일 — 같은 방법
  insert into public.project_areas (project_id, kind, code, name, sort_order, active, meta)
  select p_dst, a.kind, a.code, a.name, a.sort_order, a.active, a.meta
    from public.project_areas a where a.project_id = p_src;
  -- 영역-팀: 프로젝트 전용 팀은 복사된 팀으로, 워크스페이스 공용 팀(project_id null)은 같은 팀으로 잇는다
  insert into public.area_teams (area_id, team_id, kind)
  select na.id, coalesce(nt.id, ot.id), x.kind
    from public.area_teams x
    join public.project_areas oa on oa.id = x.area_id and oa.project_id = p_src
    join public.project_areas na on na.project_id = p_dst and na.kind = oa.kind and na.code = oa.code
    join public.teams ot on ot.id = x.team_id
    left join public.teams nt on nt.project_id = p_dst and nt.code = ot.code and ot.project_id = p_src;
end $$;
revoke all on function public.copy_project_config(uuid, uuid) from public, anon, authenticated;
grant execute on function public.copy_project_config(uuid, uuid) to service_role;

create function public.create_project_with_settings(
  p_workspace_id uuid, p_name text, p_start_date date, p_end_date date, p_description text,
  p_values jsonb, p_copy_from uuid, p_actor uuid, p_command_id uuid, p_schema_version int)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_digest text;
  v_dup_project uuid;
  v_dup_digest text;
  v_project uuid;
  k text;
begin
  -- 둘 다 잠금보다 먼저다 — null 키의 advisory 잠금은 잠그지 않고 중복 조회도 맞지 않아 멱등이 조용히 사라진다
  if p_actor is null then
    raise exception using errcode = '22023', message = 'SETTINGS_ACTOR_REQUIRED';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if pg_catalog.jsonb_typeof(v_values) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:p_values';
  end if;
  -- 같은 명령의 동시 재전송을 줄 세운다. 키는 접두 문자열로 기존 advisory 키와 겹치지 않는다
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('settings-create:' || p_actor::text || ':' || p_command_id::text, 0));
  -- 격리 수준 규칙(0011 공통, 스펙 D1): 잠금 뒤 이력을 읽어 중복을 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 명령 — 프로젝트가 둘 생긴다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('name', p_name, 'start_date', p_start_date, 'end_date', p_end_date,
      'description', p_description, 'values', v_values, 'copy_from', p_copy_from)::text, 'UTF8')), 'hex');
  select h.project_id, h.command_digest into v_dup_project, v_dup_digest
    from public.project_settings_history h
    join public.projects p on p.id = h.project_id
   where p.workspace_id = p_workspace_id and h.command_id = p_command_id and h.changed_by = p_actor
     and h.source in ('create', 'copy')
   limit 1;
  if v_dup_project is not null then
    if v_dup_digest is distinct from v_digest then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'project_id', v_dup_project, 'revision', 1);
  end if;
  foreach k in array array['core.level_labels', 'modules.enabled'] loop
    if not (v_values ? k) then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || k;
    end if;
  end loop;
  insert into public.projects (name, start_date, end_date, description, workspace_id)
  values (p_name, p_start_date, p_end_date, p_description, p_workspace_id)
  returning id into v_project;
  -- 행 생성 트리거(⑨-1)가 방금 빈 설정 행을 만들었다 — 그 행을 채운다
  update public.project_settings s
     set "values" = v_values, revision = 1, schema_version = p_schema_version,
         updated_at = pg_catalog.now(), updated_by = p_actor
   where s.project_id = v_project;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  insert into public.project_settings_history
    (project_id, revision, key, old_value, new_value, source, copied_from, command_id, command_digest, changed_by)
  select v_project, 1, e.key, null, e.value,
         case when p_copy_from is null then 'create' else 'copy' end, p_copy_from, p_command_id, v_digest, p_actor
    from pg_catalog.jsonb_each(v_values) as e(key, value);
  if p_copy_from is not null then
    perform public.copy_project_config(p_copy_from, v_project);
  end if;
  return pg_catalog.jsonb_build_object('status', 'applied', 'project_id', v_project, 'revision', 1);
end $$;
revoke all on function public.create_project_with_settings(uuid, text, date, date, text, jsonb, uuid, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.create_project_with_settings(uuid, text, date, date, text, jsonb, uuid, uuid, uuid, int) to service_role;

-- ⑨ 설정 표의 권한·정책·트리거 — 행 생성·행 유지(⑨-1) ---------------------------------------------------------------
create function public.ensure_project_settings_row() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.project_settings (project_id) values (new.id) on conflict do nothing;
  return null;
end $$;
revoke all on function public.ensure_project_settings_row() from public, anon, authenticated;
create trigger projects_settings_row after insert on public.projects
  for each row execute function public.ensure_project_settings_row();

create function public.ensure_workspace_settings_row() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.workspace_settings (workspace_id) values (new.id) on conflict do nothing;
  return null;
end $$;
revoke all on function public.ensure_workspace_settings_row() from public, anon, authenticated;
create trigger workspaces_settings_row after insert on public.workspaces
  for each row execute function public.ensure_workspace_settings_row();

-- 행 유지(스펙 D7): 설정 행의 직접 DELETE 를 막는다. 부모가 지워지는 캐스케이드만 통과한다(그 시점에 부모 행은 이미 없다)
create function public.settings_row_keep() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_table_name = 'project_settings' then
    if not exists (select 1 from public.projects p where p.id = old.project_id) then return old; end if;
  elsif tg_table_name = 'workspace_settings' then
    if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then return old; end if;
  end if;
  raise exception using errcode = '23514', message = 'SETTINGS_ROW_REQUIRED';
end $$;
revoke all on function public.settings_row_keep() from public, anon, authenticated;
create trigger project_settings_keep_row before delete on public.project_settings
  for each row execute function public.settings_row_keep();
create trigger workspace_settings_keep_row before delete on public.workspace_settings
  for each row execute function public.settings_row_keep();

-- ⑨ 설정 표의 권한·정책·이력 불변·세션 insert 폐쇄(⑨-2) ------------------------------------------------------------
drop policy workspace_settings_write on public.workspace_settings;
revoke all on public.project_settings, public.workspace_settings from anon, authenticated;
grant select on public.project_settings, public.workspace_settings to authenticated;

-- 설정 행의 TRUNCATE 도 막는다 — 행 유지 트리거(⑨-1)는 행 트리거라 TRUNCATE 에 불리지 않고, service_role 은 기본 권한으로
-- TRUNCATE 를 받는다(권한은 회수하지 않는다 — SP2 불변식 ⓘ). 행 유지와 같은 토큰이다
create function public.settings_row_reject_truncate() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode = '23514', message = 'SETTINGS_ROW_REQUIRED';
end $$;
revoke all on function public.settings_row_reject_truncate() from public, anon, authenticated;
create trigger project_settings_no_truncate before truncate on public.project_settings
  for each statement execute function public.settings_row_reject_truncate();
create trigger workspace_settings_no_truncate before truncate on public.workspace_settings
  for each statement execute function public.settings_row_reject_truncate();

-- 설정 이력 불변(스펙 D3): UPDATE 는 전부 거부, DELETE 는 부모가 없을 때(캐스케이드)만 통과
create function public.settings_history_reject_mutation() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  -- 표마다 old 의 열이 다르다 — 표 이름으로 먼저 가르고 그 안에서만 열을 읽는다(한 식에 섞으면 없는 열을 참조해 실패한다)
  if tg_op = 'DELETE' then
    if tg_table_name = 'project_settings_history' then
      if not exists (select 1 from public.projects p where p.id = old.project_id) then return old; end if;
    elsif tg_table_name = 'workspace_settings_history' then
      if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then return old; end if;
    end if;
  end if;
  raise exception using errcode = '55000', message = 'HISTORY_IMMUTABLE';
end $$;
revoke all on function public.settings_history_reject_mutation() from public, anon, authenticated;
create trigger project_settings_history_worm before update or delete on public.project_settings_history
  for each row execute function public.settings_history_reject_mutation();
create trigger workspace_settings_history_worm before update or delete on public.workspace_settings_history
  for each row execute function public.settings_history_reject_mutation();

-- TRUNCATE 는 행 트리거를 건너뛴다. 새 표는 기본 권한으로 service_role 에 TRUNCATE 를 받으므로 문장 트리거로 막는다.
-- authz_events(⑩)도 이 함수를 쓴다
create function public.history_reject_truncate() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode = '55000', message = 'HISTORY_IMMUTABLE';
end $$;
revoke all on function public.history_reject_truncate() from public, anon, authenticated;
create trigger project_settings_history_no_truncate before truncate on public.project_settings_history
  for each statement execute function public.history_reject_truncate();
create trigger workspace_settings_history_no_truncate before truncate on public.workspace_settings_history
  for each statement execute function public.history_reject_truncate();

-- 세션 경로의 프로젝트 insert 를 닫는다(스펙 D6) — 남기면 필수 키 없는 빈 설정 행이 생성 RPC 를 우회해 생긴다
drop policy wsadmin_insert_projects on public.projects;
revoke insert on public.projects from authenticated;

-- ⑩ 권한 변경 이력 authz_events(⑩-1: 표·보관 규칙·기록 트리거·초대자 도장) ------------------------------------------
-- 어느 열에도 FK 를 두지 않는다(스펙 D3) — 캐스케이드가 이력을 지우지 않고, 부모가 지워지는 도중의 기록 insert 가 23503 으로
-- 삭제를 막지 않는다. 이름·이메일은 저장하지 않고 id 만 남긴다.
create table public.authz_events (
  id               bigint generated always as identity primary key,
  kind             text not null check (kind in ('platform_admin', 'workspace_role', 'project_access')),
  workspace_id     uuid,
  project_id       uuid,
  target_user_id   uuid,
  target_person_id uuid,
  before           jsonb,
  after            jsonb,
  cause            text not null check (cause in ('direct', 'cascade', 'parent_deleted')),
  actor_user_id    uuid,
  command_id       uuid,
  command_digest   text,
  created_at       timestamptz not null default now(),
  constraint authz_events_scope_check check (
       (kind = 'platform_admin' and workspace_id is null and project_id is null)
    or (kind = 'workspace_role' and workspace_id is not null and project_id is null)
    or (kind = 'project_access' and project_id is not null and workspace_id is not null))
);
create unique index authz_events_command_uq on public.authz_events
  (actor_user_id, command_id, kind, target_user_id, target_person_id, workspace_id, project_id) nulls not distinct
  where command_id is not null;
create index authz_events_workspace_idx on public.authz_events (workspace_id, id desc);
alter table public.authz_events enable row level security;
revoke all on public.authz_events from anon, authenticated;
grant select on public.authz_events to authenticated;
revoke all on sequence public.authz_events_id_seq from anon, authenticated;
create policy authz_events_read on public.authz_events for select to authenticated
  using ((select public.is_superuser()) or (workspace_id is not null and (select public.is_ws_admin(workspace_id))));

-- 권한 명령 원장(D8) — 권한 RPC(⑩-2)가 성공한 호출마다 1행을 남긴다. 바뀐 것이 없는 호출도 남긴다: 중복 판정을 authz_events(변경 기록)로
-- 하면 아무것도 바꾸지 않은 명령의 재전송이 다시 실행되어, 그사이 다른 관리자가 한 변경을 되돌린다. 재전송은 여기 저장한 결과를 돌려준다.
-- scope_id 는 플랫폼이 0 uuid, 워크스페이스 등급이 그 워크스페이스, 명단이 그 프로젝트다. workspace_id 는 보관 규칙(정리)의 열이다 —
-- 플랫폼은 null. FK 없음(authz_events 와 같은 이유). 세션은 읽지도 쓰지 못한다(정책·grant 없음 — 읽는 곳은 RPC 뿐이다)
create table public.authz_commands (
  actor_user_id  uuid not null,
  kind           text not null check (kind in ('platform_admin', 'workspace_role', 'project_access')),
  scope_id       uuid not null,
  command_id     uuid not null,
  workspace_id   uuid,
  command_digest text not null,
  result         jsonb not null,
  created_at     timestamptz not null default now(),
  primary key (actor_user_id, kind, scope_id, command_id),
  constraint authz_commands_scope_check check ((kind = 'platform_admin') = (workspace_id is null))
);
create index authz_commands_workspace_idx on public.authz_commands (workspace_id);
alter table public.authz_commands enable row level security;
revoke all on public.authz_commands from anon, authenticated;

-- §9 #15 보관 규칙 ----------------------------------------------------------------------------------------------------
-- 기본값: 계정·프로젝트를 지워도 기록은 남는다. 워크스페이스를 지우면 그 워크스페이스의 기록도 같은 트랜잭션에서 지운다 —
-- 워크스페이스 삭제 트리거가 purge_authz_events 를 부른다. 지우는 길은 그 함수 하나다. 플랫폼 행(workspace_id null)은 지울 수 없다.
-- UPDATE·TRUNCATE 는 누구도 못 한다(service_role 포함 — 권한은 회수할 수 없어 트리거로 막는다).
-- 명령 원장 authz_commands 도 같은 규칙이다 — 두 표 모두 workspace_id 열로 판정하므로 불변 트리거 함수를 같이 쓴다.
create function public.authz_events_reject_mutation() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'DELETE'
     and old.workspace_id is not null
     and pg_catalog.current_setting('app.authz_purge', true) = 'on'
     and not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  raise exception using errcode = '55000', message = 'HISTORY_IMMUTABLE';
end $$;
revoke all on function public.authz_events_reject_mutation() from public, anon, authenticated;
create trigger authz_events_worm before update or delete on public.authz_events
  for each row execute function public.authz_events_reject_mutation();
create trigger authz_events_no_truncate before truncate on public.authz_events
  for each statement execute function public.history_reject_truncate();
create trigger authz_commands_worm before update or delete on public.authz_commands
  for each row execute function public.authz_events_reject_mutation();
create trigger authz_commands_no_truncate before truncate on public.authz_commands
  for each statement execute function public.history_reject_truncate();

create function public.purge_authz_events(p_workspace_id uuid) returns integer
language plpgsql security definer set search_path to '' as $$
declare
  v_n integer;
begin
  if p_workspace_id is null then
    raise exception using errcode = '22023', message = 'AUTHZ_PURGE_WORKSPACE_REQUIRED';
  end if;
  perform pg_catalog.set_config('app.authz_purge', 'on', true);
  delete from public.authz_events e where e.workspace_id = p_workspace_id;
  get diagnostics v_n = row_count;
  delete from public.authz_commands c where c.workspace_id = p_workspace_id;   -- 반환값은 기록(authz_events) 행 수만 센다
  perform pg_catalog.set_config('app.authz_purge', '', true);
  return v_n;
end $$;
revoke all on function public.purge_authz_events(uuid) from public, anon, authenticated;
grant execute on function public.purge_authz_events(uuid) to service_role;

-- 워크스페이스가 지워지면 그 워크스페이스의 권한 기록을 지운다. AFTER DELETE 라 워크스페이스 행은 이미 없다(불변 트리거의 조건).
-- FK 캐스케이드와의 순서는 결과를 바꾸지 않는다 — 기록 트리거의 원인 ① 이 그 워크스페이스의 새 기록을 막는다
create function public.purge_workspace_authz_events() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  perform public.purge_authz_events(old.id);
  return null;
end $$;
revoke all on function public.purge_workspace_authz_events() from public, anon, authenticated;
create trigger workspaces_purge_authz_events after delete on public.workspaces
  for each row execute function public.purge_workspace_authz_events();
-- §9 #15 끝 -----------------------------------------------------------------------------------------------------------

create function public.record_authz_event() returns trigger
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
revoke all on function public.record_authz_event() from public, anon, authenticated;
create trigger authz_events_record after insert or delete on public.platform_admins
  for each row execute function public.record_authz_event();
create trigger authz_events_record after insert or delete or update of role on public.workspace_members
  for each row execute function public.record_authz_event();
create trigger authz_events_record after insert or delete or update of access_role on public.project_members
  for each row execute function public.record_authz_event();

-- 권한 세 표의 TRUNCATE 를 막는다 — 기록 트리거와 0011 의 마지막 관리자 가드는 행 트리거라 TRUNCATE 에 불리지 않는다(service_role 은
-- 기본 권한으로 TRUNCATE 를 받는다). 행을 지우는 길은 DELETE 하나다
create function public.authz_tables_reject_truncate() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode = '55000', message = 'AUTHZ_TRUNCATE_FORBIDDEN';
end $$;
revoke all on function public.authz_tables_reject_truncate() from public, anon, authenticated;
create trigger platform_admins_no_truncate before truncate on public.platform_admins
  for each statement execute function public.authz_tables_reject_truncate();
create trigger workspace_members_no_truncate before truncate on public.workspace_members
  for each statement execute function public.authz_tables_reject_truncate();
create trigger project_members_no_truncate before truncate on public.project_members
  for each statement execute function public.authz_tables_reject_truncate();

-- 초대자 도장(H2-e 이월): 세션 경로의 invited_by 는 세션 사용자다. service_role 경로(auth.uid() null)는 넘어온 값을 둔다.
-- 세션 계정이 이 문장에서 지워지는 중이면 찍지 않는다(0011 project_members_guard 와 같은 규칙).
create function public.workspace_members_stamp_inviter() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is not null and exists (select 1 from auth.users u where u.id = auth.uid()) then
    new.invited_by := auth.uid();
  end if;
  return new;
end $$;
revoke all on function public.workspace_members_stamp_inviter() from public, anon, authenticated;
create trigger workspace_members_stamp_inviter before insert on public.workspace_members
  for each row execute function public.workspace_members_stamp_inviter();

-- ⑩ 권한 RPC(⑩-2) ----------------------------------------------------------------------------------------------------
-- 셋의 순서: 행위자·명령 id 확인 → 입력 확인 → advisory 잠금 → 격리 수준 → 행위자의 등급 → 명령 원장(authz_commands) 조회 →
-- 설정 셋을 켠다 → 쓰기 → 설정 셋을 비운다 → 원장에 결과를 남긴다. 원장은 바뀐 것이 없는 호출도 남긴다 — 재전송은 그 결과를
-- status 만 duplicate 로 바꿔 돌려주고, 같은 명령 id 에 다른 요약이면 COMMAND_REUSED 다(D8: 한 명령은 많아야 한 번 적용된다)
create function public.set_platform_admin(p_actor uuid, p_target uuid, p_grant boolean, p_command_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  c_platform constant uuid := '00000000-0000-0000-0000-000000000000';   -- 플랫폼 명령의 scope_id
  v_digest text;
  v_dup record;
  v_matched integer;
  v_result jsonb;
begin
  -- 잠금보다 먼저다 — null 키의 advisory 잠금은 잠그지 않고 중복 조회도 맞지 않아 멱등이 조용히 사라진다
  if p_actor is null or p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if p_target is null or p_grant is null then
    raise exception using errcode = '22023', message = 'AUTHZ_INVALID_INPUT';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('authz:' || p_actor::text || ':' || p_command_id::text, 0));
  -- 격리 수준 규칙(0011 공통, 스펙 D1): 잠금 뒤 등급·명령 원장을 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 명령 — 원장을 보지 못해 같은 명령이 두 번 적용된다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'AUTHZ_EVENT_ISOLATION';
  end if;
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('target', p_target, 'grant', p_grant)::text, 'UTF8')), 'hex');
  select c.command_digest, c.result into v_dup from public.authz_commands c
   where c.actor_user_id = p_actor and c.kind = 'platform_admin' and c.scope_id = c_platform and c.command_id = p_command_id;
  if found then
    if v_dup.command_digest is distinct from v_digest then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return v_dup.result || pg_catalog.jsonb_build_object('status', 'duplicate');
  end if;
  perform pg_catalog.set_config('app.authz_actor', p_actor::text, true);
  perform pg_catalog.set_config('app.command_id', p_command_id::text, true);
  perform pg_catalog.set_config('app.command_digest', v_digest, true);
  if p_grant then
    insert into public.platform_admins (user_id, granted_by) values (p_target, p_actor) on conflict (user_id) do nothing;
  else
    delete from public.platform_admins a where a.user_id = p_target;
  end if;
  get diagnostics v_matched = row_count;   -- 이미 관리자인 대상의 지정·관리자가 아닌 대상의 해제는 0
  perform pg_catalog.set_config('app.authz_actor', '', true);
  perform pg_catalog.set_config('app.command_id', '', true);
  perform pg_catalog.set_config('app.command_digest', '', true);
  v_result := pg_catalog.jsonb_build_object('status', 'applied', 'matched', v_matched);
  insert into public.authz_commands (actor_user_id, kind, scope_id, command_id, workspace_id, command_digest, result)
  values (p_actor, 'platform_admin', c_platform, p_command_id, null, v_digest, v_result);
  return v_result;
end $$;
revoke all on function public.set_platform_admin(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_platform_admin(uuid, uuid, boolean, uuid) to service_role;

create function public.set_workspace_role(p_actor uuid, p_workspace_id uuid, p_target uuid, p_role text, p_command_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_digest text;
  v_dup record;
  v_matched integer;
  v_result jsonb;
begin
  -- 잠금보다 먼저다 — null 키의 advisory 잠금은 잠그지 않고 중복 조회도 맞지 않아 멱등이 조용히 사라진다
  if p_actor is null or p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if p_workspace_id is null or p_target is null or p_role is null or p_role not in ('admin', 'member') then
    raise exception using errcode = '22023', message = 'AUTHZ_INVALID_INPUT';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('authz:' || p_actor::text || ':' || p_command_id::text, 0));
  -- 격리 수준 규칙(0011 공통, 스펙 D1): 잠금 뒤 등급·명령 원장을 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 명령 — 원장을 보지 못해 같은 명령이 두 번 적용된다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'AUTHZ_EVENT_ISOLATION';
  end if;
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor)
     and not exists (select 1 from public.workspace_members m
                      where m.workspace_id = p_workspace_id and m.user_id = p_actor and m.role = 'admin') then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('target', p_target, 'role', p_role)::text, 'UTF8')), 'hex');
  select c.command_digest, c.result into v_dup from public.authz_commands c
   where c.actor_user_id = p_actor and c.kind = 'workspace_role' and c.scope_id = p_workspace_id and c.command_id = p_command_id;
  if found then
    if v_dup.command_digest is distinct from v_digest then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return v_dup.result || pg_catalog.jsonb_build_object('status', 'duplicate');
  end if;
  perform pg_catalog.set_config('app.authz_actor', p_actor::text, true);
  perform pg_catalog.set_config('app.command_id', p_command_id::text, true);
  perform pg_catalog.set_config('app.command_digest', v_digest, true);
  update public.workspace_members m set role = p_role
   where m.workspace_id = p_workspace_id and m.user_id = p_target;
  get diagnostics v_matched = row_count;
  perform pg_catalog.set_config('app.authz_actor', '', true);
  perform pg_catalog.set_config('app.command_id', '', true);
  perform pg_catalog.set_config('app.command_digest', '', true);
  v_result := pg_catalog.jsonb_build_object('status', 'applied', 'matched', v_matched);
  insert into public.authz_commands (actor_user_id, kind, scope_id, command_id, workspace_id, command_digest, result)
  values (p_actor, 'workspace_role', p_workspace_id, p_command_id, p_workspace_id, v_digest, v_result);
  return v_result;
end $$;
revoke all on function public.set_workspace_role(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_workspace_role(uuid, uuid, uuid, text, uuid) to service_role;

create function public.upsert_project_member_cmd(
  p_actor uuid, p_project_id uuid, p_person jsonb, p_member jsonb, p_team_ids uuid[], p_command_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_ws uuid;
  v_digest text;
  v_dup record;
  v_member uuid;
  v_result jsonb;
begin
  -- 잠금보다 먼저다 — null 키의 advisory 잠금은 잠그지 않고 중복 조회도 맞지 않아 멱등이 조용히 사라진다
  if p_actor is null or p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if p_project_id is null or p_person is null then
    raise exception using errcode = '22023', message = 'AUTHZ_INVALID_INPUT';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('authz:' || p_actor::text || ':' || p_command_id::text, 0));
  -- 격리 수준 규칙(0011 공통, 스펙 D1): 잠금 뒤 등급·명령 원장을 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 명령 — 원장을 보지 못해 같은 명령이 두 번 적용된다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'AUTHZ_EVENT_ISOLATION';
  end if;
  -- 등급 — upsert_project_member ① 과 같은 식이다(안쪽 함수가 다시 검사한다. 여기서는 원장을 읽기 전에 거른다)
  select p.workspace_id into v_ws from public.projects p where p.id = p_project_id;
  if v_ws is null then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor)
     and not exists (select 1 from public.workspace_members m
                      where m.workspace_id = v_ws and m.user_id = p_actor and m.role = 'admin')
     and not (exists (select 1 from public.workspace_members m where m.workspace_id = v_ws and m.user_id = p_actor)
              and exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                           where pm.project_id = p_project_id and pe.user_id = p_actor
                             and pm.active and pe.active and pm.access_role = 'admin')) then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_FORBIDDEN';
  end if;
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('person', p_person, 'member', coalesce(p_member, '{}'::jsonb),
      'team_ids', pg_catalog.to_jsonb(p_team_ids))::text, 'UTF8')), 'hex');
  select c.command_digest, c.result into v_dup from public.authz_commands c
   where c.actor_user_id = p_actor and c.kind = 'project_access' and c.scope_id = p_project_id and c.command_id = p_command_id;
  if found then
    if v_dup.command_digest is distinct from v_digest then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return v_dup.result || pg_catalog.jsonb_build_object('status', 'duplicate');
  end if;
  perform pg_catalog.set_config('app.authz_actor', p_actor::text, true);
  perform pg_catalog.set_config('app.command_id', p_command_id::text, true);
  perform pg_catalog.set_config('app.command_digest', v_digest, true);
  v_member := public.upsert_project_member(p_actor, p_project_id, p_person, p_member, p_team_ids);
  perform pg_catalog.set_config('app.authz_actor', '', true);
  perform pg_catalog.set_config('app.command_id', '', true);
  perform pg_catalog.set_config('app.command_digest', '', true);
  v_result := pg_catalog.jsonb_build_object('status', 'applied', 'member_id', v_member);
  insert into public.authz_commands (actor_user_id, kind, scope_id, command_id, workspace_id, command_digest, result)
  values (p_actor, 'project_access', p_project_id, p_command_id, v_ws, v_digest, v_result);
  return v_result;
end $$;
revoke all on function public.upsert_project_member_cmd(uuid, uuid, jsonb, jsonb, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.upsert_project_member_cmd(uuid, uuid, jsonb, jsonb, uuid[], uuid) to service_role;

-- ⑪ 브랜딩 버킷·잡 표 status -------------------------------------------------------------------------------------------
-- 로고 버킷(스펙 D19): 비공개, 256KB, png·jpg·webp. 쓰기 정책은 두지 않는다(업로드는 service_role). 읽기 정책은 새 함수를 만들지
-- 않고 경로 검사를 직접 쓴다 — 둘째 조각은 uuid 꼴일 때만 캐스팅한다(아니면 22P02 로 목록 조회가 통째로 실패한다).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', false, 262144, array['image/png', 'image/jpeg', 'image/webp']);
create policy "branding read" on storage.objects for select to authenticated
  using (bucket_id = 'branding'
    and array_length(string_to_array(name, '/'), 1) = 4
    and split_part(name, '/', 1) = 'ws'
    and split_part(name, '/', 3) = 'branding'
    and split_part(name, '/', 4) ~ '^(full|full_dark|mark)-[0-9a-f]{16}\.(png|jpg|webp)$'
    and (select public.is_ws_member(
          case when split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then split_part(name, '/', 2)::uuid end)));

-- 워커가 건너뛴 잡의 상태(스펙 D16). 제약 이름은 그대로 둔다
alter table public.ai_index_jobs drop constraint ai_index_jobs_status_check;
alter table public.ai_index_jobs add constraint ai_index_jobs_status_check
  check (status = any (array['pending'::text, 'running'::text, 'done'::text, 'dead_letter'::text, 'skipped'::text]));
alter table public.wiki_processing_jobs drop constraint wiki_processing_jobs_status_check;
alter table public.wiki_processing_jobs add constraint wiki_processing_jobs_status_check
  check (status = any (array['pending'::text, 'running'::text, 'done'::text, 'dead_letter'::text, 'skipped'::text]));
alter table public.wiki_project_rebuild_jobs drop constraint wiki_project_rebuild_jobs_status_check;
alter table public.wiki_project_rebuild_jobs add constraint wiki_project_rebuild_jobs_status_check
  check (status = any (array['pending'::text, 'running'::text, 'done'::text, 'dead_letter'::text, 'skipped'::text]));

-- ⑫ 종합 사후검사 — 절마다 본 것 가운데 뒤 절이 바꿀 수 있는 것과, 파일 전체가 끝나야 참인 것을 마지막에 본다 --------------
do $$
declare
  v text;
begin
  -- 설정 행 1:1
  select string_agg(x.id, ', ') into v from (
    select 'project ' || p.id::text as id from public.projects p
     where (select count(*) from public.project_settings s where s.project_id = p.id) <> 1
    union all
    select 'workspace ' || w.id::text from public.workspaces w
     where (select count(*) from public.workspace_settings s where s.workspace_id = w.id) <> 1) x;
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 설정 행이 1개가 아니다: %', left(v, 600); end if;

  -- 넓은 열 0 — 두 설정 표의 열은 정확히 이 목록이다
  select string_agg(format('%s.%s', c.relname, a.attname), ', ' order by c.relname, a.attnum) into v
    from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where c.oid in ('public.project_settings'::regclass, 'public.workspace_settings'::regclass)
     and a.attname not in ('project_id', 'workspace_id', 'updated_at', 'updated_by', 'values', 'schema_version', 'revision');
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 넓은 열이 남았다: %', v; end if;

  -- 필수 키: 모든 프로젝트 행에 core.level_labels·modules.enabled, 모든 워크스페이스 행에 modules.allowed
  select string_agg(x.id, ', ') into v from (
    select 'project ' || s.project_id::text as id from public.project_settings s
     where not (s."values" ? 'core.level_labels' and s."values" ? 'modules.enabled')
    union all
    select 'workspace ' || s.workspace_id::text from public.workspace_settings s
     where not (s."values" ? 'modules.allowed')) x;
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 필수 키가 없는 설정 행: %', left(v, 600); end if;

  -- RLS 켜짐과 정책 수(표마다 읽기 정책 하나, 쓰기 정책 0)
  select string_agg(format('%s(rls %s, 정책 %s)', t.name, c.relrowsecurity,
           (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.name)), ', ') into v
    from unnest(array['project_settings', 'workspace_settings', 'project_settings_history',
                      'workspace_settings_history', 'authz_events']) as t(name)
    join pg_class c on c.oid = ('public.' || t.name)::regclass
   where not c.relrowsecurity
      or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.name) <> 1
      or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.name and p.cmd <> 'SELECT');
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: RLS·정책이 기대와 다르다: %', v; end if;
  -- 명령 원장은 RLS 가 켜져 있고 정책이 하나도 없다(세션은 읽지도 쓰지 못한다 — 읽는 곳은 권한 RPC 뿐)
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.authz_commands'::regclass)
     or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'authz_commands') then
    raise exception 'SP3A_0012_POSTCHECK: authz_commands 의 RLS·정책이 기대와 다르다';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and cmd in ('INSERT', 'ALL')) then
    raise exception 'SP3A_0012_POSTCHECK: projects 에 세션 insert 정책이 남았다';
  end if;

  -- 권한은 있는데 그 명령(또는 ALL)의 정책이 없는 DML — 0 이어야 한다(0011 ⑪ 과 같은 쿼리)
  select string_agg(format('%s:%s', t.relname, cmd.cmd), ', ') into v
    from pg_class t cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as cmd(cmd)
   where t.relnamespace = 'public'::regnamespace and t.relkind in ('r', 'p')
     and (case when cmd.cmd = 'DELETE' then has_table_privilege('authenticated', t.oid, 'DELETE')
               else has_any_column_privilege('authenticated', t.oid, cmd.cmd) end)
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                      and p.cmd in (cmd.cmd, 'ALL') and p.roles && array['authenticated', 'public']::name[]);
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 정책 없는 DML 권한: %', left(v, 800); end if;

  -- anon·authenticated 의 TRUNCATE·TRIGGER·REFERENCES·MAINTAIN 실효 0(PUBLIC·상속 포함)
  select string_agg(format('%s:%s:%s', c.relname, r.role, p.priv), ', ' order by c.relname, r.role, p.priv) into v
    from pg_class c
   cross join unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest(array['TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN']) as p(priv)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege(r.role, c.oid, p.priv)
          or (p.priv = 'REFERENCES' and has_any_column_privilege(r.role, c.oid, 'REFERENCES')));
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 표 권한이 남았다: %', left(v, 800); end if;

  -- 새 표: anon 은 아무 권한도 없고 authenticated 는 SELECT 뿐(명령 원장은 SELECT 도 없다), 시퀀스는 두 롤 모두 없음
  select string_agg(format('%s:%s:%s', t.name, r.role, p.priv), ', ') into v
    from unnest(array['project_settings', 'workspace_settings', 'project_settings_history',
                      'workspace_settings_history', 'authz_events', 'authz_commands']) as t(name)
   cross join unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
   where (has_table_privilege(r.role, ('public.' || t.name)::regclass, p.priv)
          or (p.priv <> 'DELETE' and has_any_column_privilege(r.role, ('public.' || t.name)::regclass, p.priv)))
     and not (r.role = 'authenticated' and p.priv = 'SELECT' and t.name <> 'authz_commands');
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 설정·이력 표 권한이 남았다: %', v; end if;
  select string_agg(format('%s:%s', s.name, r.role), ', ') into v
    from unnest(array['project_settings_history_id_seq', 'workspace_settings_history_id_seq', 'authz_events_id_seq']) as s(name)
   cross join unnest(array['anon', 'authenticated']) as r(role)
   where has_sequence_privilege(r.role, ('public.' || s.name)::regclass, 'USAGE')
      or has_sequence_privilege(r.role, ('public.' || s.name)::regclass, 'SELECT')
      or has_sequence_privilege(r.role, ('public.' || s.name)::regclass, 'UPDATE');
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 시퀀스 권한이 남았다: %', v; end if;
  if has_table_privilege('authenticated', 'public.projects', 'INSERT')
     or has_any_column_privilege('authenticated', 'public.projects', 'INSERT') then
    raise exception 'SP3A_0012_POSTCHECK: authenticated 가 projects 에 insert 한다';
  end if;

  -- 새 트리거 존재·활성(꺼짐 D, 복제 세션 전용 R 은 실패)
  select string_agg(x.name, ', ') into v
    from (values
      ('projects', 'projects_settings_row'), ('workspaces', 'workspaces_settings_row'),
      ('project_settings', 'project_settings_keep_row'), ('workspace_settings', 'workspace_settings_keep_row'),
      ('project_settings', 'project_settings_no_truncate'), ('workspace_settings', 'workspace_settings_no_truncate'),
      ('project_settings_history', 'project_settings_history_worm'), ('workspace_settings_history', 'workspace_settings_history_worm'),
      ('project_settings_history', 'project_settings_history_no_truncate'),
      ('workspace_settings_history', 'workspace_settings_history_no_truncate'),
      ('authz_events', 'authz_events_worm'), ('authz_events', 'authz_events_no_truncate'),
      ('authz_commands', 'authz_commands_worm'), ('authz_commands', 'authz_commands_no_truncate'),
      ('workspaces', 'workspaces_purge_authz_events'),
      ('platform_admins', 'authz_events_record'), ('workspace_members', 'authz_events_record'), ('project_members', 'authz_events_record'),
      ('platform_admins', 'platform_admins_no_truncate'), ('workspace_members', 'workspace_members_no_truncate'),
      ('project_members', 'project_members_no_truncate'),
      ('workspace_members', 'workspace_members_stamp_inviter')) as x(tbl, name)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = ('public.' || x.tbl)::regclass and g.tgname = x.name
                        and not g.tgisinternal and g.tgenabled in ('O', 'A'));
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 트리거가 없다: %', v; end if;

  -- 잠금 뒤 다른 행을 읽는 0012 함수 본문의 격리 검사 문자열
  select string_agg(x.fn, ', ') into v
    from (values
      ('public.apply_project_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text)', 'SETTINGS_ISOLATION'),
      ('public.apply_workspace_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text)', 'SETTINGS_ISOLATION'),
      ('public.create_project_with_settings(uuid, text, date, date, text, jsonb, uuid, uuid, uuid, int)', 'SETTINGS_ISOLATION'),
      ('public.set_platform_admin(uuid, uuid, boolean, uuid)', 'AUTHZ_EVENT_ISOLATION'),
      ('public.set_workspace_role(uuid, uuid, uuid, text, uuid)', 'AUTHZ_EVENT_ISOLATION'),
      ('public.upsert_project_member_cmd(uuid, uuid, jsonb, jsonb, uuid[], uuid)', 'AUTHZ_EVENT_ISOLATION'),
      ('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', 'WORKFLOW_EVENT_ISOLATION')) as x(fn, token)
    join pg_proc p on p.oid = x.fn::regprocedure
   where position('if pg_catalog.current_setting(''transaction_isolation'') is distinct from ''read committed'' then' in p.prosrc) = 0
      or position(x.token in p.prosrc) = 0;
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 격리 수준 검사가 없다: %', v; end if;

  -- apply_workflow_event 는 넓은 열을 읽지 않고 values 의 키를 읽는다
  select p.prosrc into v from pg_proc p
   where p.oid = 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)'::regprocedure;
  if position('select stage_credits' in v) > 0 or position('workflow.stage_credits' in v) = 0 then
    raise exception 'SP3A_0012_POSTCHECK: apply_workflow_event 가 옛 열을 읽는다';
  end if;

  -- 0012 가 만든 모든 함수의 EXECUTE 기대표(실효 권한) — anon·authenticated 는 전부 false
  select string_agg(format('%s:%s=%s', e.fn, e.role, not e.want), ', ') into v
    from (
      select f.fn, r.role, (r.role = 'service_role' and f.service) as want
        from (values
          ('public.settings_ref_check(uuid, text, jsonb, jsonb)', false),
          ('public.apply_project_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text)', true),
          ('public.apply_workspace_settings(uuid, bigint, uuid, jsonb, text[], uuid, int, text)', true),
          ('public.copy_project_config(uuid, uuid)', true),
          ('public.create_project_with_settings(uuid, text, date, date, text, jsonb, uuid, uuid, uuid, int)', true),
          ('public.purge_authz_events(uuid)', true),
          ('public.set_platform_admin(uuid, uuid, boolean, uuid)', true),
          ('public.set_workspace_role(uuid, uuid, uuid, text, uuid)', true),
          ('public.upsert_project_member_cmd(uuid, uuid, jsonb, jsonb, uuid[], uuid)', true),
          ('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', true),
          ('public.ensure_project_settings_row()', false), ('public.ensure_workspace_settings_row()', false),
          ('public.settings_row_keep()', false), ('public.settings_row_reject_truncate()', false),
          ('public.settings_history_reject_mutation()', false), ('public.history_reject_truncate()', false),
          ('public.purge_workspace_authz_events()', false), ('public.authz_events_reject_mutation()', false),
          ('public.record_authz_event()', false), ('public.authz_tables_reject_truncate()', false),
          ('public.workspace_members_stamp_inviter()', false)) as f(fn, service)
       cross join unnest(array['anon', 'authenticated', 'service_role']) as r(role)) e
   where has_function_privilege(e.role, e.fn::regprocedure, 'EXECUTE') is distinct from e.want
     and not (e.role = 'service_role' and not e.want);   -- 트리거 함수·settings_ref_check 의 service_role 은 기본 권한이 준 대로 둔다
  if v is not null then raise exception 'SP3A_0012_POSTCHECK: 함수 EXECUTE 가 기대와 다르다: %', v; end if;

  -- 브랜딩 버킷
  if not exists (select 1 from storage.buckets b where b.id = 'branding' and not b.public and b.file_size_limit = 262144
                   and b.allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']) then
    raise exception 'SP3A_0012_POSTCHECK: branding 버킷이 기대와 다르다';
  end if;
end $$;
