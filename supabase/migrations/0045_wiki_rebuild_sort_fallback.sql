-- 0045_wiki_rebuild_sort_fallback.sql
-- 프로젝트 Wiki 재구성 선점(claim_wiki_project_rebuild_step)이 회의에 연결되지 않은 회의록을 만나면 통째 실패했다.
-- 정렬 키를 meeting_occurrence_date 만으로 만들어, 그 열이 null 인 회의록(직접 올린 회의록 — 흔한 경우)에서 키가 null 이 되고
-- 단계 묶음 제약(wiki_project_rebuild_step_bundle)에 걸렸다(23514). 워커는 그 프로젝트에서 매번 500 으로 끝난다.
-- 다른 자리(0000·0006·0007 의 시간순 판정)와 같이 회의 일자가 없으면 회의록 일자(minute_date, NOT NULL)로 정렬한다.
-- 바꾸는 것은 그 식 세 군데뿐이다 — 인자·반환·실행권·함수 설정·나머지 본문은 0036 그대로.

begin;

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

commit;
