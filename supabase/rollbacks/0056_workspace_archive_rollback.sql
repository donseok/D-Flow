-- 0056 롤백 — 워크스페이스 보관·복원을 걷어 낸다.
-- 순서가 중요하다: 앱을 먼저 되돌린다(앱이 archived_at 열·두 RPC 를 읽는 동안 지우면 /admin/workspaces 목록과 권한 스냅샷 조회가 실패한다).
-- **되돌리면 보관 중이던 워크스페이스가 전부 활성으로 돌아온다** — 열을 지우므로 "보관"이라는 사실 자체가 사라진다(멤버에게 다시 보이고 쓰기가 열린다).
-- 보관된 워크스페이스가 남아 있으면 이 롤백은 멈춘다(아래 검사). 먼저 복원하거나, 그 결과를 받아들이기로 했다면 검사 블록을 지우고 돌린다.
-- 되돌리지 않는 데이터: 보관·복원 기록(시각·실행자·사유) — 열과 함께 사라진다.
-- 함수 열하나는 0056 적용 전 정의(pg_get_functiondef 그대로)로 되돌린다.
begin;

do $$
begin
  if exists (select 1 from public.workspaces w where w.archived_at is not null) then
    raise exception 'WORKSPACE_ARCHIVE_ROLLBACK: 보관된 워크스페이스가 있다 — 롤백하면 전부 활성으로 돌아온다. 먼저 복원(restore_workspace)한 뒤 다시 돌린다';
  end if;
end $$;

drop function if exists public.restore_workspace(uuid, uuid);
drop function if exists public.archive_workspace(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.my_workspace_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select w.id from public.workspaces w where public.is_superuser()
  union
  select m.workspace_id from public.workspace_members m where m.user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.is_ws_member(wid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_superuser()
      or exists (select 1 from public.workspace_members m
                  where m.workspace_id = wid and m.user_id = auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.is_ws_admin(wid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_superuser()
      or exists (select 1 from public.workspace_members m
                  where m.workspace_id = wid and m.user_id = auth.uid() and m.role = 'admin')
$function$;

CREATE OR REPLACE FUNCTION public.is_project_admin(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_superuser()
      or (pid is not null and (
             public.is_ws_admin(public.project_ws(pid))
          or (exists (select 1 from public.project_members pm
                        join public.people pe on pe.id = pm.person_id
                       where pm.project_id = pid and pm.active and pe.active
                         and pe.user_id = auth.uid() and pm.access_role = 'admin')
              and public.is_ws_member(public.project_ws(pid)))))
$function$;

CREATE OR REPLACE FUNCTION public.can_read_project(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_superuser()
      or (pid is not null and public.is_ws_member(public.project_ws(pid)))
$function$;

CREATE OR REPLACE FUNCTION public.actor_is_workspace_admin(p_actor uuid, p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_actor is not null and p_workspace_id is not null and (
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
  select p_actor is not null and p_project_id is not null and (
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
        where (e.status = 'pending' and e.run_after <= now())
       or (
         e.status = 'running'
         and e.locked_at < now() - make_interval(secs => greatest(1, coalesce(p_lease_seconds, 300)))
       )
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
    where read_at is not null and read_at < now() - make_interval(days => retention_days);
  get diagnostics rc = row_count;
  delete from public.notification_events e
    where e.audience = 'direct'
      and e.created_at < now() - make_interval(days => retention_days)
      and not exists (select 1 from public.notification_recipients r where r.event_id = e.id);
  get diagnostics ec = row_count;
  return query select rc, ec;
end;
$function$;

-- 판정 함수는 위에서 되돌린 정의가 더는 부르지 않는다
drop function if exists public.workspace_archived(uuid);

alter table public.workspaces
  drop constraint if exists workspaces_archive_shape_check,
  drop constraint if exists workspaces_archive_reason_check,
  drop column if exists restored_by,
  drop column if exists restored_at,
  drop column if exists archive_reason,
  drop column if exists archived_by,
  drop column if exists archived_at;

commit;
