-- 0056_workspace_archive.sql
-- 워크스페이스 보관(비활성)과 복원 — 지금까지는 "빈 워크스페이스 삭제"(0055)뿐이라, 자료가 있는 워크스페이스를 접을 길이 없었다.
-- 정책: 보관 = 숨김 + 동결. 자료는 한 줄도 지우지 않는다. 플랫폼 관리자가 복원하면 그대로 돌아온다.
--   · 숨김: 보관된 워크스페이스는 세션에게 "없는 것"이다 — 멤버·관리자뿐 아니라 플랫폼 관리자의 세션에게도(들어가 읽는 길은 복원이다).
--   · 동결: 그 워크스페이스 범위의 쓰기는 거부된다. 큐의 잡·토큰·초대는 지우지 않는다(복원하면 이어진다).
-- 왜 함수 몇 개만 고치나: RLS 정책 135개 가운데 워크스페이스 판정을 하는 것은 전부 아래 다섯 뿌리로 내려간다(정책 → 중간 함수 → 뿌리).
--   my_workspace_ids() ← 정책 13 + accessible_project_ids(정책 38)·can_manage_minute
--   is_ws_member(wid)  ← 정책 14 + is_project_member·my_member_id·my_team_ids·has_project_role_in_ws·is_project_admin_anywhere_in_ws·can_edit_issue·can_read_project
--   is_ws_admin(wid)   ← 정책 15 + is_project_admin·has_project_role_in_ws·is_project_admin_anywhere_in_ws
--   is_project_admin(pid)·can_read_project(pid) ← is_superuser() 지름길이 있어 위 셋으로는 플랫폼 관리자가 닫히지 않는다 → 이 둘도 뿌리다
--   정책을 하나하나 고치지 않는다 — 새 정책이 이 함수들을 쓰는 한 보관은 저절로 따라온다.
--   뿌리에 기대지 않는 정책(그대로 둔다): 본인 행(notification_recipients·account_preferences·profiles_update_own), 플랫폼 전용(usage_events·llm_*·
--   platform_admins·authz_events 의 플랫폼 갈래), profiles_read(같은 워크스페이스 동료의 프로필 — 보관 뒤에도 동료 이름은 읽힌다. 워크스페이스 자료가 아니다).
-- 무엇:
--   ① workspaces 에 열 다섯 — archived_at(null = 보관 아님)·archived_by·archive_reason(다듬은 1~500자 또는 null)·restored_at·restored_by(마지막 복원의 시각·실행자).
--      기본값이 전부 null 이라 적용만으로 기존 행의 의미가 바뀌지 않는다.
--   ② workspace_archived(wid) — 판정 하나(DEFINER, service_role·postgres 만 실행. 세션은 뿌리 함수 안에서만 닿는다).
--   ③ 뿌리 다섯과 RPC 안 재판정 둘을 다시 정의한다. 아래 "바뀐 줄" 밖의 본문·인자·반환·실행권·DEFINER·search_path 는 그대로다
--      (적용 전 DB 의 pg_get_functiondef 에서 그 줄만 치환해 만들었다 — 0044~0052 의 방식):
--      · my_workspace_ids()            2줄: `where public.is_superuser()` 뒤에 `and w.archived_at is null`,
--                                           `where m.user_id = auth.uid()` 뒤에 `and not public.workspace_archived(m.workspace_id)`
--      · is_ws_member(wid)             2줄: `select public.is_superuser()` → `select not public.workspace_archived(wid) and (public.is_superuser()`, 마지막 줄 끝에 `)`
--      · is_ws_admin(wid)              2줄: 같은 꼴
--      · is_project_admin(pid)         2줄: `select public.is_superuser()` → `select not public.workspace_archived(public.project_ws(pid)) and (public.is_superuser()`, 끝에 `)`
--      · can_read_project(pid)         2줄: 같은 꼴
--        (pid·wid 가 null 이면 workspace_archived 는 거짓 — 프로젝트 없는 판정(is_project_admin(null) = 플랫폼 관리자)은 그대로다)
--      · actor_is_workspace_admin      1줄: `… p_workspace_id is not null and (` → `… p_workspace_id is not null and not public.workspace_archived(p_workspace_id) and (`
--      · actor_is_project_admin        1줄: `… p_project_id is not null and (` → `… p_project_id is not null and not public.workspace_archived(public.project_ws(p_project_id)) and (`
--        → 이 둘로 등급을 다시 보는 쓰기 RPC(프로젝트 생성·영역·주간 문서·팀·WBS 가져오기·흐름·사용자 정의 필드·양식 …)는 보관된 워크스페이스에서
--          플랫폼 관리자에게도 AUTHZ_FORBIDDEN 이다. rename_workspace(0055)도 같이 닫힌다(보관 중에는 이름을 바꾸지 않는다).
--          delete_empty_workspace(0055)는 platform_admins 를 직접 보므로 그대로다 — 보관된 워크스페이스도 비어 있으면 지울 수 있다.
--   ④ 큐 선점 셋 — 보관된 워크스페이스의 잡을 집지 않는다. 행은 건드리지 않으므로(상태·시도 횟수 그대로) 복원하면 다음 실행이 집는다.
--      · claim_ai_index_jobs(0046 본문)             후보 고르기에 `not exists (… e.workspace_id … archived_at is not null) and (` 를 더하고 그 조건을 `)` 로 닫는다(3줄)
--      · claim_wiki_processing_job(0000 본문)       `where job.id = p_job_id` 뒤에 그 잡의 프로젝트가 보관된 워크스페이스가 아닐 것(2줄 추가)
--      · claim_wiki_project_rebuild_step(0045 본문) 후보 고르기의 첫 where 뒤에 같은 조건(2줄 추가)
--      이미 선점돼 돌고 있는 잡은 끝까지 간다(lease 가 끝난 running 행은 보관 중에는 다시 집히지 않고, 복원 뒤에 집힌다).
--      · purge_read_notifications(0000 본문)        읽은 알림 보존 기한 정리가 보관된 워크스페이스의 수신 행·이벤트를 지우지 않는다(delete 둘에 조건 2줄씩 추가 —
--        보관은 자료를 한 줄도 지우지 않는다. 복원 뒤의 실행이 기한 지난 것을 치운다)
--   ⑤ archive_workspace(p_actor, p_workspace_id, p_expected_slug, p_reason)·restore_workspace(p_actor, p_workspace_id) — DEFINER·service_role 전용,
--      플랫폼 관리자만(함수 안에서 재판정 — 액션 가드 requireSuperuser 와 두 관문). 멱등: 이미 보관/이미 활성이면 쓰지 않고 status unchanged.
--      보관은 사람이 적은 slug 를 대조한다(엉뚱한 행을 보관하지 않는다). 복원은 보관 기록 셋을 비우고 restored_at·restored_by 를 적는다.
-- 사유 코드: AUTHZ_FORBIDDEN(42501) · WORKSPACE_NOT_FOUND(P0002) · WORKSPACE_ARCHIVE_INVALID·WORKSPACE_RESTORE_INVALID·WORKSPACE_SLUG_MISMATCH·
--   WORKSPACE_ARCHIVE_REASON_INVALID(22023).
-- 닫지 않는 것(앱 계층이 닫는다 — service_role 은 RLS 를 타지 않는다): actor_is_* 를 거치지 않는 쓰기 RPC(설정 쓰기·회의록·위키 워커·초대 수락·
--   멤버 관리 …). 앱의 가드(buildActor 스냅샷)·모듈 관문(워크스페이스 설정 해석기)·자격증명 해석이 보관을 "없음"으로 판정한다.
-- 데이터: 적용만으로 바뀌는 행은 없다(열은 전부 null 로 생긴다). 사후검사의 보관 시늉은 하위 트랜잭션에서 하고 되돌린다.
-- 롤백: supabase/rollbacks/*_workspace_archive_rollback.sql — 열을 지우므로 보관 중이던 워크스페이스가 전부 활성으로 돌아온다(먼저 복원·확인할 것).

begin;

-- ① 열 ---------------------------------------------------------------------------------------------------------------
alter table public.workspaces
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_reason text,
  add column restored_at timestamptz,
  add column restored_by uuid references auth.users(id) on delete set null,
  add constraint workspaces_archive_reason_check
    check (archive_reason is null or (archive_reason = btrim(archive_reason) and char_length(archive_reason) between 1 and 500)),
  -- 보관이 아니면 보관 기록도 없다 — "보관 아님인데 사유만 남은 행"을 만들지 않는다
  add constraint workspaces_archive_shape_check
    check (archived_at is not null or (archived_by is null and archive_reason is null));

-- ② 판정 하나 ---------------------------------------------------------------------------------------------------------
-- 없는 id·null 은 거짓이다(보관이 아니다) — "없음"의 판정은 부르는 쪽 몫이다(뿌리 함수는 소속·프로젝트 조회가 따로 닫는다).
create function public.workspace_archived(wid uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.workspaces w where w.id = wid and w.archived_at is not null)
$$;
revoke all on function public.workspace_archived(uuid) from public, anon, authenticated;
grant execute on function public.workspace_archived(uuid) to service_role;

-- ③④ 다시 정의하는 함수 열하나 — 바뀐 줄은 머리 주석에 적었다. 나머지는 적용 전 정의 그대로다 ---------------------------------------
CREATE OR REPLACE FUNCTION public.my_workspace_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select w.id from public.workspaces w where public.is_superuser() and w.archived_at is null
  union
  select m.workspace_id from public.workspace_members m where m.user_id = auth.uid() and not public.workspace_archived(m.workspace_id)
$function$;

CREATE OR REPLACE FUNCTION public.is_ws_member(wid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not public.workspace_archived(wid) and (public.is_superuser()
      or exists (select 1 from public.workspace_members m
                  where m.workspace_id = wid and m.user_id = auth.uid()))
$function$;

CREATE OR REPLACE FUNCTION public.is_ws_admin(wid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not public.workspace_archived(wid) and (public.is_superuser()
      or exists (select 1 from public.workspace_members m
                  where m.workspace_id = wid and m.user_id = auth.uid() and m.role = 'admin'))
$function$;

CREATE OR REPLACE FUNCTION public.is_project_admin(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not public.workspace_archived(public.project_ws(pid)) and (public.is_superuser()
      or (pid is not null and (
             public.is_ws_admin(public.project_ws(pid))
          or (exists (select 1 from public.project_members pm
                        join public.people pe on pe.id = pm.person_id
                       where pm.project_id = pid and pm.active and pe.active
                         and pe.user_id = auth.uid() and pm.access_role = 'admin')
              and public.is_ws_member(public.project_ws(pid))))))
$function$;

CREATE OR REPLACE FUNCTION public.can_read_project(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not public.workspace_archived(public.project_ws(pid)) and (public.is_superuser()
      or (pid is not null and public.is_ws_member(public.project_ws(pid))))
$function$;

CREATE OR REPLACE FUNCTION public.actor_is_workspace_admin(p_actor uuid, p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_actor is not null and p_workspace_id is not null and not public.workspace_archived(p_workspace_id) and (
    exists (select 1 from public.platform_admins a where a.user_id = p_actor)
    or exists (select 1 from public.workspace_members m
                where m.workspace_id = p_workspace_id and m.user_id = p_actor and m.role = 'admin'))
$function$;

CREATE OR REPLACE FUNCTION public.actor_is_project_admin(p_actor uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_actor is not null and p_project_id is not null and not public.workspace_archived(public.project_ws(p_project_id)) and (
    exists (select 1 from public.platform_admins a where a.user_id = p_actor)
    or exists (select 1 from public.projects p
                 join public.workspace_members m on m.workspace_id = p.workspace_id
                where p.id = p_project_id and m.user_id = p_actor and m.role = 'admin')
    or (exists (select 1 from public.projects p
                  join public.workspace_members m on m.workspace_id = p.workspace_id
                 where p.id = p_project_id and m.user_id = p_actor)
        and exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                     where pm.project_id = p_project_id and pe.user_id = p_actor
                       and pm.active and pe.active and pm.access_role = 'admin')))
$function$;

CREATE OR REPLACE FUNCTION public.claim_ai_index_jobs(p_limit integer, p_lease_seconds integer)
 RETURNS SETOF public.ai_index_jobs
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  update public.ai_index_jobs j
  set status = 'running', locked_at = now(), updated_at = now()
  where j.id in (
    select c.id
    from public.ai_index_jobs c
    where c.id in (
      select r.id
      from (
        select e.id, e.run_after,
               row_number() over (partition by e.workspace_id order by e.run_after, e.id) as turn
        from public.ai_index_jobs e
        where not exists (select 1 from public.workspaces aw where aw.id = e.workspace_id and aw.archived_at is not null)
          and ((e.status = 'pending' and e.run_after <= now())
       or (
         e.status = 'running'
         and e.locked_at < now() - make_interval(secs => greatest(1, coalesce(p_lease_seconds, 300)))
       ))
      ) r
      order by r.turn, r.run_after, r.id
      limit greatest(1, least(coalesce(p_limit, 10), 50))
    )
      -- 고른 뒤 잠그는 사이 다른 워커가 집어 갔을 수 있다 — 조건을 다시 보고, 잠긴 행은 건너뛴다(이번 실행이 덜 받을 뿐 잃지 않는다)
      and ((c.status = 'pending' and c.run_after <= now())
       or (
         c.status = 'running'
         and c.locked_at < now() - make_interval(secs => greatest(1, coalesce(p_lease_seconds, 300)))
       ))
    for update skip locked
  )
  returning j.*;
$function$;

CREATE OR REPLACE FUNCTION public.claim_wiki_processing_job(p_job_id bigint, p_locked_by text, p_lease_seconds integer DEFAULT 900)
 RETURNS SETOF public.wiki_processing_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_job public.wiki_processing_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  -- 0046 의 rebuild claim 과 같은 범위로 묶는다(최소 1초, 최대 1시간).
  v_lease_seconds integer := greatest(1, least(coalesce(p_lease_seconds, 900), 3600));
begin
  if nullif(btrim(p_locked_by), '') is null or char_length(p_locked_by) > 200 then
    raise exception 'WIKI_JOB_WORKER_INVALID' using errcode = '22023';
  end if;

  update public.wiki_processing_jobs job
  set status = 'running',
      attempts = job.attempts + 1,
      locked_at = v_now,
      locked_by = p_locked_by,
      rerun_requested = false,
      updated_at = v_now
  where job.id = p_job_id
    and not exists (select 1 from public.projects ap join public.workspaces aw on aw.id = ap.workspace_id
                     where ap.id = job.project_id and aw.archived_at is not null)
    and (
      -- 정상 경로 — 대기 중이고 due 가 된 job
      (job.status = 'pending' and job.run_after <= v_now)
      -- 회수 경로 — running 인데 lease 가 만료된 job(워커가 죽은 것으로 본다).
      -- locked_at is null 은 회수 대상에서 제외한다: 언제부터 붙잡혔는지 알 수 없는데
      -- 회수하면 방금 시작한 job 을 빼앗을 수 있다. 모르면 건드리지 않는다.
      or (
        job.status = 'running'
        and job.locked_at is not null
        and job.locked_at < v_now - make_interval(secs => v_lease_seconds)
      )
    )
  returning job.* into v_job;

  if found then
    return next v_job;
  end if;
  return;
end
$function$;

CREATE OR REPLACE FUNCTION public.claim_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_lease_seconds integer)
 RETURNS TABLE(claimed_project_id uuid, rebuild_generation bigint, minute_id uuid, minute_version_id uuid, wiki_job_id bigint, wiki_apply_generation integer, body_md text, observed_sort timestamp without time zone, finished boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_rebuild public.wiki_project_rebuild_jobs%rowtype;
  v_candidate record;
  v_wiki_job public.wiki_processing_jobs%rowtype;
  v_version_body text;
  v_lease_seconds integer := greatest(coalesce(p_lease_seconds, 120), 10);
  v_now timestamp with time zone := clock_timestamp();
  v_lease_expires timestamp with time zone := v_now + make_interval(secs => v_lease_seconds);
  v_existing_job boolean := false;
begin
  select rebuild.* into v_rebuild
  from public.wiki_project_rebuild_jobs rebuild
  where (p_project_id is null or rebuild.project_id = p_project_id)
    and not exists (select 1 from public.projects ap join public.workspaces aw on aw.id = ap.workspace_id
                     where ap.id = rebuild.project_id and aw.archived_at is not null)
    and rebuild.run_after <= v_now
    and (
      rebuild.status = 'pending'
      or (rebuild.status = 'running' and rebuild.locked_at < v_now - make_interval(secs => v_lease_seconds))
    )
  order by rebuild.run_after, rebuild.updated_at, rebuild.project_id
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;

  if v_rebuild.rerun_requested then
    update public.wiki_project_rebuild_jobs rebuild
    set status = 'pending',
        rerun_requested = false,
        cursor_observed_sort = null,
        cursor_minute_id = null,
        step_observed_sort = null,
        step_minute_id = null,
        step_minute_version_id = null,
        step_rebuild_generation = null,
        step_wiki_job_id = null,
        step_wiki_apply_generation = null,
        attempts = 0,
        run_after = v_now,
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = v_now
    where rebuild.project_id = v_rebuild.project_id
    returning rebuild.* into v_rebuild;
  end if;

  if v_rebuild.reset_generation is distinct from v_rebuild.generation then
    insert into public.wiki_change_events (
      project_id, wiki_item_id, minute_id, source_id,
      change_type, before_snapshot, after_snapshot, reason,
      idempotency_key, created_at
    )
    select
      item.project_id,
      item.id,
      null,
      null,
      'retract',
      to_jsonb(item),
      to_jsonb(item) || jsonb_build_object(
        'lifecycle_state', 'archived',
        'updated_at', v_now
      ),
      '프로젝트 Wiki 시간순 재구성 전 자동 지식을 초기화했습니다.',
      'wiki-project-reset-v1:' || v_rebuild.project_id::text
        || ':' || v_rebuild.generation::text || ':' || item.id::text,
      v_now
    from public.wiki_items item
    where item.project_id = v_rebuild.project_id
      and item.origin = 'ai'
      and not item.auto_update_locked
      and item.lifecycle_state in ('active', 'open', 'conflicted')
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing;

    update public.wiki_item_sources source
    set retracted_at = v_now,
        retraction_reason = '프로젝트 Wiki 시간순 재구성 전 자동 지식 초기화'
    where source.retracted_at is null
      and exists (
        select 1
        from public.wiki_items item
        where item.id = source.wiki_item_id
          and item.project_id = v_rebuild.project_id
          and item.origin = 'ai'
          and not item.auto_update_locked
          and item.lifecycle_state in ('active', 'open', 'conflicted')
      );

    update public.wiki_items item
    set lifecycle_state = 'archived',
        updated_at = v_now
    where item.project_id = v_rebuild.project_id
      and item.origin = 'ai'
      and not item.auto_update_locked
      and item.lifecycle_state in ('active', 'open', 'conflicted');

    update public.wiki_topics topic
    set last_changed_at = v_now,
        updated_at = v_now
    where topic.project_id = v_rebuild.project_id;

    update public.wiki_project_rebuild_jobs rebuild
    set status = 'pending',
        reset_generation = rebuild.generation,
        cursor_observed_sort = null,
        cursor_minute_id = null,
        step_observed_sort = null,
        step_minute_id = null,
        step_minute_version_id = null,
        step_rebuild_generation = null,
        step_wiki_job_id = null,
        step_wiki_apply_generation = null,
        attempts = 0,
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = v_now
    where rebuild.project_id = v_rebuild.project_id
    returning rebuild.* into v_rebuild;
  end if;

  if v_rebuild.step_wiki_job_id is not null then
    select version.body_md into v_version_body
    from public.minute_versions version
    where version.id = v_rebuild.step_minute_version_id
      and version.minute_id = v_rebuild.step_minute_id;
    if not found then
      raise exception 'WIKI_PROJECT_REBUILD_BOUND_VERSION_MISSING' using errcode = 'P0002';
    end if;

    update public.wiki_project_rebuild_jobs rebuild
    set status = 'running',
        locked_at = v_now,
        locked_by = p_locked_by,
        updated_at = v_now
    where rebuild.project_id = v_rebuild.project_id;

    claimed_project_id := v_rebuild.project_id;
    rebuild_generation := v_rebuild.step_rebuild_generation;
    minute_id := v_rebuild.step_minute_id;
    minute_version_id := v_rebuild.step_minute_version_id;
    wiki_job_id := v_rebuild.step_wiki_job_id;
    wiki_apply_generation := v_rebuild.step_wiki_apply_generation;
    body_md := v_version_body;
    observed_sort := v_rebuild.step_observed_sort;
    finished := false;
    return next;
    return;
  end if;

  select
    m.id as minute_id,
    mv.id as minute_version_id,
    mv.body_md,
    mv.body_hash,
    mv.version_no,
    mv.created_at as version_created_at,
    m.title,
    m.minute_date,
    m.meeting_occurrence_date,
    m.created_at as minute_created_at,
    (coalesce(m.meeting_occurrence_date, m.minute_date)::text || ' ' || to_char(m.created_at, 'HH24:MI:SS.US'))::timestamp as observed_sort
  into v_candidate
  from public.minutes m
  join lateral (
    select v.*
    from public.minute_versions v
    where v.minute_id = m.id
    order by v.version_no desc
    limit 1
  ) mv on true
  where m.project_id = v_rebuild.project_id
    and (
      v_rebuild.cursor_observed_sort is null
      or (
        (coalesce(m.meeting_occurrence_date, m.minute_date)::text || ' ' || to_char(m.created_at, 'HH24:MI:SS.US'))::timestamp,
        m.id
      ) > (v_rebuild.cursor_observed_sort, v_rebuild.cursor_minute_id)
    )
  order by (coalesce(m.meeting_occurrence_date, m.minute_date)::text || ' ' || to_char(m.created_at, 'HH24:MI:SS.US'))::timestamp, m.id
  limit 1;

  if not found then
    update public.wiki_project_rebuild_jobs rebuild
    set status = 'done',
        step_observed_sort = null,
        step_minute_id = null,
        step_minute_version_id = null,
        step_rebuild_generation = null,
        step_wiki_job_id = null,
        step_wiki_apply_generation = null,
        attempts = 0,
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = v_now
    where rebuild.project_id = v_rebuild.project_id;

    claimed_project_id := v_rebuild.project_id;
    rebuild_generation := v_rebuild.generation;
    minute_id := null;
    minute_version_id := null;
    wiki_job_id := null;
    wiki_apply_generation := null;
    body_md := null;
    observed_sort := null;
    finished := true;
    return next;
    return;
  end if;

  select job.* into v_wiki_job
  from public.wiki_processing_jobs job
  where job.project_id = v_rebuild.project_id
    and job.minute_version_id = v_candidate.minute_version_id
  for update;
  v_existing_job := found;

  if not v_existing_job then
    insert into public.wiki_processing_jobs as job (
      project_id, minute_id, minute_version_id, body_hash,
      status, attempts, run_after, locked_at, locked_by, last_error,
      prompt_version, apply_generation, rerun_requested, payload, updated_at
    ) values (
      v_rebuild.project_id,
      v_candidate.minute_id,
      v_candidate.minute_version_id,
      v_candidate.body_hash,
      'pending',
      0,
      v_now,
      null,
      null,
      null,
      'wiki-v2',
      0,
      false,
      jsonb_build_object(
        'applyGeneration', 0,
        'minute', jsonb_build_object(
          'projectId', v_rebuild.project_id,
          'title', v_candidate.title,
          'minuteDate', v_candidate.minute_date,
          'meetingOccurrenceDate', v_candidate.meeting_occurrence_date,
          'createdAt', v_candidate.minute_created_at
        ),
        'version', jsonb_build_object(
          'id', v_candidate.minute_version_id,
          'versionNo', v_candidate.version_no,
          'createdAt', v_candidate.version_created_at
        ),
        'projectRebuildGeneration', v_rebuild.generation
      ),
      v_now
    )
    on conflict on constraint wiki_processing_jobs_project_version_unique do nothing
    returning job.* into v_wiki_job;

    if not found then
      select job.* into v_wiki_job
      from public.wiki_processing_jobs job
      where job.project_id = v_rebuild.project_id
        and job.minute_version_id = v_candidate.minute_version_id
      for update;
      if not found then
        raise exception 'WIKI_PROJECT_REBUILD_MINUTE_JOB_RACE' using errcode = '40001';
      end if;
    end if;
  end if;

  update public.wiki_project_rebuild_jobs rebuild
  set status = 'running',
      step_observed_sort = v_candidate.observed_sort,
      step_minute_id = v_candidate.minute_id,
      step_minute_version_id = v_candidate.minute_version_id,
      step_rebuild_generation = v_rebuild.generation,
      step_wiki_job_id = v_wiki_job.id,
      step_wiki_apply_generation = v_wiki_job.apply_generation,
      attempts = 0,
      locked_at = v_now,
      locked_by = p_locked_by,
      last_error = null,
      updated_at = v_now
  where rebuild.project_id = v_rebuild.project_id;

  claimed_project_id := v_rebuild.project_id;
  rebuild_generation := v_rebuild.generation;
  minute_id := v_candidate.minute_id;
  minute_version_id := v_candidate.minute_version_id;
  wiki_job_id := v_wiki_job.id;
  wiki_apply_generation := v_wiki_job.apply_generation;
  body_md := v_candidate.body_md;
  observed_sort := v_candidate.observed_sort;
  finished := false;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.purge_read_notifications(retention_days integer DEFAULT 90)
 RETURNS TABLE(recipients_deleted bigint, events_deleted bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rc bigint; ec bigint;
begin
  delete from public.notification_recipients
    where read_at is not null and read_at < now() - make_interval(days => retention_days)
      and not exists (select 1 from public.notification_events ae join public.workspaces aw on aw.id = ae.workspace_id
                       where ae.id = notification_recipients.event_id and aw.archived_at is not null);
  get diagnostics rc = row_count;
  delete from public.notification_events e
    where e.audience = 'direct'
      and e.created_at < now() - make_interval(days => retention_days)
      and not exists (select 1 from public.notification_recipients r where r.event_id = e.id)
      and not exists (select 1 from public.workspaces aw where aw.id = e.workspace_id and aw.archived_at is not null);
  get diagnostics ec = row_count;
  return query select rc, ec;
end;
$function$;

-- ⑤ 보관·복원 ---------------------------------------------------------------------------------------------------------
create function public.archive_workspace(p_actor uuid, p_workspace_id uuid, p_expected_slug text, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_slug text;
  v_name text;
  v_at timestamptz;
  v_by uuid;
  v_old_reason text;
begin
  if p_actor is null or p_workspace_id is null or p_expected_slug is null then
    raise exception using errcode = '22023', message = 'WORKSPACE_ARCHIVE_INVALID';
  end if;
  -- 등급 재판정(액션 가드 requireSuperuser 와 두 관문) — 보관은 플랫폼 관리자뿐이다
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  if v_reason is not null and pg_catalog.char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'WORKSPACE_ARCHIVE_REASON_INVALID';
  end if;
  select w.slug, w.name, w.archived_at, w.archived_by, w.archive_reason
    into v_slug, v_name, v_at, v_by, v_old_reason
    from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORKSPACE_NOT_FOUND';
  end if;
  -- 사람이 적은 주소와 다르면 아무것도 하지 않는다(이미 보관된 행이어도 — 엉뚱한 행의 상태를 알려 주지 않는다)
  if v_slug is distinct from p_expected_slug then
    raise exception using errcode = '22023', message = 'WORKSPACE_SLUG_MISMATCH';
  end if;
  if v_at is not null then
    -- 멱등 — 이미 보관이다. 처음 보관한 기록(시각·실행자·사유)을 덮지 않는다
    return pg_catalog.jsonb_build_object('status', 'unchanged', 'slug', v_slug, 'name', v_name,
      'archived_at', v_at, 'archived_by', v_by, 'reason', v_old_reason);
  end if;
  update public.workspaces
     set archived_at = pg_catalog.now(), archived_by = p_actor, archive_reason = v_reason
   where id = p_workspace_id
  returning archived_at into v_at;
  return pg_catalog.jsonb_build_object('status', 'archived', 'slug', v_slug, 'name', v_name,
    'archived_at', v_at, 'archived_by', p_actor, 'reason', v_reason);
end $$;
revoke all on function public.archive_workspace(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.archive_workspace(uuid, uuid, text, text) to service_role;

create function public.restore_workspace(p_actor uuid, p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_slug text;
  v_name text;
  v_at timestamptz;
  v_by uuid;
  v_reason text;
  v_restored timestamptz;
begin
  if p_actor is null or p_workspace_id is null then
    raise exception using errcode = '22023', message = 'WORKSPACE_RESTORE_INVALID';
  end if;
  -- 등급 재판정 — 복원도 플랫폼 관리자뿐이다(보관된 워크스페이스의 관리자는 그 워크스페이스를 보지 못한다)
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  select w.slug, w.name, w.archived_at, w.archived_by, w.archive_reason
    into v_slug, v_name, v_at, v_by, v_reason
    from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORKSPACE_NOT_FOUND';
  end if;
  if v_at is null then
    -- 멱등 — 이미 활성이다
    return pg_catalog.jsonb_build_object('status', 'unchanged', 'slug', v_slug, 'name', v_name);
  end if;
  update public.workspaces
     set archived_at = null, archived_by = null, archive_reason = null,
         restored_at = pg_catalog.now(), restored_by = p_actor
   where id = p_workspace_id
  returning restored_at into v_restored;
  -- 지운 보관 기록은 응답으로 돌려준다(앱이 서버 로그에 남긴다 — 행에는 마지막 복원의 시각·실행자만 남는다)
  return pg_catalog.jsonb_build_object('status', 'restored', 'slug', v_slug, 'name', v_name, 'restored_at', v_restored,
    'previous', pg_catalog.jsonb_build_object('archived_at', v_at, 'archived_by', v_by, 'reason', v_reason));
end $$;
revoke all on function public.restore_workspace(uuid, uuid) from public, anon, authenticated;
grant execute on function public.restore_workspace(uuid, uuid) to service_role;

-- 사후검사 WORKSPACE_ARCHIVE_POSTCHECK — 읽기만 한다(보관 시늉은 하위 트랜잭션에서 하고 되돌린다)
do $$
declare
  v text;
  v_ws uuid;
  v_other uuid;
  v_project uuid;
  v_member uuid;
  v_platform uuid;
  v_who uuid;
  v_before text;
  v_during text;
  v_other_before text;
  v_other_during text;
begin
  -- 기존 행은 전부 "보관 아님"으로 남았다
  if exists (select 1 from public.workspaces w where w.archived_at is not null or w.archived_by is not null or w.archive_reason is not null
                                                   or w.restored_at is not null or w.restored_by is not null) then
    raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 적용 직후인데 보관·복원 기록이 있는 워크스페이스가 있다';
  end if;
  -- 실행권: 판정·RPC 둘은 service_role 전용
  select string_agg(f, ', ') into v from unnest(array[
    'public.workspace_archived(uuid)', 'public.archive_workspace(uuid, uuid, text, text)', 'public.restore_workspace(uuid, uuid)']) as f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE');
  if v is not null then raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 실행권이 어긋났다(세션 불가·service_role 가능이어야 한다): %', v; end if;
  -- 다시 정의한 함수의 실행권·DEFINER 는 그대로다(create or replace 가 지키지만, 누가 drop·create 로 바꿔 적으면 여기서 걸린다)
  select string_agg(f, ', ') into v from unnest(array[
    'public.my_workspace_ids()', 'public.is_ws_member(uuid)', 'public.is_ws_admin(uuid)', 'public.is_project_admin(uuid)', 'public.can_read_project(uuid)']) as f
   where not has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or not (select p.prosecdef from pg_proc p where p.oid = f::regprocedure);
  if v is not null then raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 뿌리 함수의 실행권·DEFINER 가 어긋났다: %', v; end if;
  select string_agg(f, ', ') into v from unnest(array[
    'public.actor_is_workspace_admin(uuid, uuid)', 'public.actor_is_project_admin(uuid, uuid)',
    'public.claim_ai_index_jobs(integer, integer)', 'public.claim_wiki_processing_job(bigint, text, integer)',
    'public.claim_wiki_project_rebuild_step(uuid, text, integer)', 'public.purge_read_notifications(integer)']) as f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE');
  if v is not null then raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 재판정·선점 함수의 실행권이 어긋났다: %', v; end if;
  -- 보관 판정을 지녔다(본문 토큰)
  select string_agg(x.fn, ', ') into v
    from (values ('public.my_workspace_ids()', 'archived_at is null'), ('public.my_workspace_ids()', 'public.workspace_archived('),
                 ('public.is_ws_member(uuid)', 'public.workspace_archived(wid)'), ('public.is_ws_admin(uuid)', 'public.workspace_archived(wid)'),
                 ('public.is_project_admin(uuid)', 'public.workspace_archived(public.project_ws(pid))'),
                 ('public.can_read_project(uuid)', 'public.workspace_archived(public.project_ws(pid))'),
                 ('public.actor_is_workspace_admin(uuid, uuid)', 'public.workspace_archived(p_workspace_id)'),
                 ('public.actor_is_project_admin(uuid, uuid)', 'public.workspace_archived(public.project_ws(p_project_id))'),
                 ('public.claim_ai_index_jobs(integer, integer)', 'archived_at is not null'),
                 ('public.claim_wiki_processing_job(bigint, text, integer)', 'archived_at is not null'),
                 ('public.claim_wiki_project_rebuild_step(uuid, text, integer)', 'archived_at is not null'),
                 ('public.purge_read_notifications(integer)', 'archived_at is not null'),
                 ('public.archive_workspace(uuid, uuid, text, text)', 'platform_admins'), ('public.archive_workspace(uuid, uuid, text, text)', 'WORKSPACE_SLUG_MISMATCH'),
                 ('public.archive_workspace(uuid, uuid, text, text)', 'for update'), ('public.restore_workspace(uuid, uuid)', 'platform_admins'),
                 ('public.restore_workspace(uuid, uuid)', 'for update')) as x(fn, token)
   where position(x.token in (select p.prosrc from pg_proc p where p.oid = x.fn::regprocedure)) = 0;
  if v is not null then raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 보관 판정이 빠진 함수가 있다: %', v; end if;
  -- 정책이 기대는 중간 함수들이 여전히 뿌리를 지난다 — 뿌리만 닫아도 되는 근거다
  select string_agg(x.fn, ', ') into v
    from (values ('public.accessible_project_ids()', 'public.my_workspace_ids()'), ('public.is_project_member(uuid)', 'public.is_project_admin(pid)'),
                 ('public.is_project_member(uuid)', 'public.is_ws_member('), ('public.my_member_id(uuid)', 'public.is_ws_member('),
                 ('public.my_team_ids(uuid)', 'public.is_ws_member('), ('public.has_project_role_in_ws(uuid)', 'public.is_ws_admin(wid)'),
                 ('public.has_project_role_in_ws(uuid)', 'public.is_ws_member(wid)'), ('public.is_project_admin_anywhere_in_ws(uuid)', 'public.is_ws_member(wid)'),
                 ('public.can_manage_minute(uuid)', 'public.my_workspace_ids()'), ('public.can_edit_issue(uuid)', 'public.is_project_admin('),
                 ('public.can_edit_issue(uuid)', 'public.is_ws_member('), ('public.can_attach(uuid)', 'public.is_project_admin('),
                 ('public.can_attach(uuid)', 'public.is_project_member(')) as x(fn, token)
   where position(x.token in (select p.prosrc from pg_proc p where p.oid = x.fn::regprocedure)) = 0;
  if v is not null then raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 중간 함수가 뿌리를 지나지 않는다(이 함수도 닫아야 한다): %', v; end if;
  -- 정책이 부르는 public 함수 가운데 워크스페이스·프로젝트 판정을 하는 것은 알려진 목록 안이어야 한다 — 새 판정 함수가 뿌리를 건너뛰면 여기서 걸린다
  select string_agg(distinct p.proname, ', ') into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and exists (select 1 from pg_policies pl where pl.schemaname in ('public', 'storage', 'realtime')
                  and position(p.proname || '(' in coalesce(pl.qual, '') || ' ' || coalesce(pl.with_check, '')) > 0)
     and (p.prosrc ~ 'workspace_members|platform_admins')
     and p.proname not in ('my_workspace_ids', 'is_ws_member', 'is_ws_admin', 'is_superuser');
  if v is not null then raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 소속을 직접 읽는 정책 함수가 뿌리 밖에 있다(보관 판정을 넣을 것): %', v; end if;
  -- 기존(보관 아님) 워크스페이스의 재판정은 그대로다 — 관리자 소속 행은 전부 참, 멤버 행은 플랫폼 관리자일 때만 참
  select string_agg(m.workspace_id::text || '/' || m.user_id::text, ', ') into v
    from public.workspace_members m
   where public.actor_is_workspace_admin(m.user_id, m.workspace_id)
         is distinct from (m.role = 'admin' or exists (select 1 from public.platform_admins a where a.user_id = m.user_id));
  if v is not null then raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 보관 아닌 워크스페이스의 actor_is_workspace_admin 이 달라졌다: %', v; end if;

  -- 보관 시늉 — 워크스페이스가 있을 때만(빈 DB 의 db reset 은 건너뛴다). 하위 트랜잭션에서 보관하고 판정을 읽은 뒤 예외로 되돌린다
  select w.id into v_ws from public.workspaces w
   where exists (select 1 from public.workspace_members m where m.workspace_id = w.id)
   order by (select count(*) from public.projects p where p.workspace_id = w.id) desc, w.id limit 1;
  if v_ws is null then
    return;
  end if;
  select w.id into v_other from public.workspaces w where w.id <> v_ws order by w.id limit 1;
  select p.id into v_project from public.projects p where p.workspace_id = v_ws order by p.id limit 1;
  select m.user_id into v_member from public.workspace_members m where m.workspace_id = v_ws order by (m.role = 'admin') desc, m.user_id limit 1;
  select a.user_id into v_platform from public.platform_admins a order by a.user_id limit 1;
  foreach v_who in array array[v_member, v_platform] loop
    continue when v_who is null;
    begin
      perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
      if auth.uid() is distinct from v_who then
        raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 세션 시늉이 먹지 않았다';
      end if;
      v_before := pg_catalog.concat_ws(',', public.is_ws_member(v_ws), v_ws in (select public.my_workspace_ids()));
      v_other_before := pg_catalog.concat_ws(',', public.is_ws_member(v_other), public.is_ws_admin(v_other), v_other in (select public.my_workspace_ids()));
      update public.workspaces set archived_at = pg_catalog.now() where id = v_ws;
      v_during := pg_catalog.concat_ws(',', public.is_ws_member(v_ws), public.is_ws_admin(v_ws), v_ws in (select public.my_workspace_ids()),
        public.actor_is_workspace_admin(v_who, v_ws),
        (v_project is not null and public.is_project_admin(v_project)), (v_project is not null and public.is_project_member(v_project)),
        (v_project is not null and public.can_read_project(v_project)), (v_project is not null and public.actor_is_project_admin(v_who, v_project)),
        (v_project is not null and v_project in (select public.accessible_project_ids())));
      v_other_during := pg_catalog.concat_ws(',', public.is_ws_member(v_other), public.is_ws_admin(v_other), v_other in (select public.my_workspace_ids()));
      raise exception using errcode = 'ARCH1', message = pg_catalog.concat_ws('|', v_before, v_during, v_other_before, v_other_during);
    exception when sqlstate 'ARCH1' then
      v := sqlerrm;   -- 하위 트랜잭션이 되돌려졌다 — 보관도, 세션 시늉도 남지 않는다
    end;
    -- 보관 전: 멤버(또는 플랫폼 관리자)는 그 워크스페이스를 본다 — 시늉이 실제 판정을 탔다는 증거다
    if pg_catalog.split_part(v, '|', 1) <> 't,t' then
      raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 보관 전 판정이 참이 아니다(%) — 보관 아닌 워크스페이스의 판정이 달라졌다', pg_catalog.split_part(v, '|', 1);
    end if;
    -- 보관 중: 뿌리·중간·재판정이 전부 거짓
    if pg_catalog.split_part(v, '|', 2) <> 'f,f,f,f,f,f,f,f,f' then
      raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 보관된 워크스페이스에서 닫히지 않은 판정이 있다(%)', pg_catalog.split_part(v, '|', 2);
    end if;
    -- 다른 워크스페이스는 그대로
    if pg_catalog.split_part(v, '|', 3) is distinct from pg_catalog.split_part(v, '|', 4) then
      raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 다른 워크스페이스의 판정이 함께 바뀌었다(% → %)', pg_catalog.split_part(v, '|', 3), pg_catalog.split_part(v, '|', 4);
    end if;
  end loop;
  if exists (select 1 from public.workspaces w where w.archived_at is not null) then
    raise exception 'WORKSPACE_ARCHIVE_POSTCHECK: 보관 시늉이 되돌려지지 않았다';
  end if;
end $$;

commit;
