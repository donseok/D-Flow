-- 0036_ai_scope_rollback.sql
-- SP8 롤백: AI·위키·챗봇·사용현황 워크스페이스 스코프를 0035 시점으로 되돌린다.

-- 1. claim_wiki_project_rebuild_step 복원 (wiki-v2 -> wiki-v1)
create or replace function public.claim_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_lease_seconds integer)
returns table(claimed_project_id uuid, rebuild_generation bigint, minute_id uuid, minute_version_id uuid, wiki_job_id bigint, wiki_apply_generation integer, body_md text, observed_sort timestamp without time zone, finished boolean)
language plpgsql
set search_path to 'public', 'extensions'
as $$
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
    (m.meeting_occurrence_date::text || ' ' || to_char(m.created_at, 'HH24:MI:SS.US'))::timestamp as observed_sort
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
        (m.meeting_occurrence_date::text || ' ' || to_char(m.created_at, 'HH24:MI:SS.US'))::timestamp,
        m.id
      ) > (v_rebuild.cursor_observed_sort, v_rebuild.cursor_minute_id)
    )
  order by (m.meeting_occurrence_date::text || ' ' || to_char(m.created_at, 'HH24:MI:SS.US'))::timestamp, m.id
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
      'wiki-v1',
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
$$;

-- 2. 사용현황 RPC 5종 복원 (p_workspace_id 제거 및 단일 시그니처)
drop function if exists public.usage_daily_actives(date, date, text, uuid);
drop function if exists public.usage_daily_actives(date, date, text);
drop function if exists public.usage_menu_ranking(date, date, text, uuid);
drop function if exists public.usage_menu_ranking(date, date, text);
drop function if exists public.usage_sessions(date, date, text, integer, uuid);
drop function if exists public.usage_sessions(date, date, text, integer);
drop function if exists public.usage_summary(date, date, date, text, uuid);
drop function if exists public.usage_summary(date, date, date, text);
drop function if exists public.usage_user_rollup(date, date, text, uuid);
drop function if exists public.usage_user_rollup(date, date, text);

create or replace function public.usage_daily_actives(p_from date, p_to date, p_timezone text)
returns table(d date, active_users integer, events integer)
language sql stable as $$
  select (occurred_at at time zone p_timezone)::date,
         count(distinct user_id)::int,
         count(*)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone p_timezone)
    and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)
    and (pg_catalog.now() at time zone p_timezone) is not null
  group by 1
  order by 1;
$$;

create or replace function public.usage_menu_ranking(p_from date, p_to date, p_timezone text)
returns table(menu_key text, events integer, active_users integer)
language sql stable as $$
  select menu_key,
         count(*)::int,
         count(distinct user_id)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone p_timezone)
    and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)
    and (pg_catalog.now() at time zone p_timezone) is not null
  group by menu_key
  order by 2 desc, 1;
$$;

create or replace function public.usage_sessions(p_from date, p_to date, p_timezone text, p_gap_minutes integer default 30)
returns integer
language sql stable as $$
  with ordered as (
    select user_id,
           occurred_at,
           lag(occurred_at) over (partition by user_id order by occurred_at) as prev_at
    from public.usage_events
    where event_name = 'page_view'
      and occurred_at >= (p_from::timestamp at time zone p_timezone)
      and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)
  )
  select count(*)::int
  from ordered
  where (prev_at is null
     or occurred_at - prev_at > make_interval(mins => p_gap_minutes))
    and (pg_catalog.now() at time zone p_timezone) is not null;
$$;

create or replace function public.usage_summary(p_from date, p_to date, p_today date, p_timezone text)
returns table(total_events bigint, active_users bigint, today_users bigint, last_event_at timestamp with time zone)
language sql stable as $$
  select
    (select count(*) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone p_timezone)
         and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone p_timezone)
         and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_today::timestamp at time zone p_timezone)
         and occurred_at <  ((p_today + 1)::timestamp at time zone p_timezone)),
    (select max(occurred_at) from public.usage_events
       where event_name = 'page_view')
  where (pg_catalog.now() at time zone p_timezone) is not null;
$$;

create or replace function public.usage_user_rollup(p_from date, p_to date, p_timezone text)
returns table(user_id uuid, events integer, active_days integer, last_at timestamp with time zone)
language sql stable as $$
  select user_id,
         count(*)::int,
         count(distinct (occurred_at at time zone p_timezone)::date)::int,
         max(occurred_at)
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone p_timezone)
    and occurred_at <  ((p_to + 1)::timestamp at time zone p_timezone)
    and (pg_catalog.now() at time zone p_timezone) is not null
  group by user_id;
$$;

revoke all on function public.usage_daily_actives(date, date, text),
  public.usage_menu_ranking(date, date, text),
  public.usage_sessions(date, date, text, integer),
  public.usage_summary(date, date, date, text),
  public.usage_user_rollup(date, date, text) from public, anon;

grant execute on function public.usage_daily_actives(date, date, text),
  public.usage_menu_ranking(date, date, text),
  public.usage_sessions(date, date, text, integer),
  public.usage_summary(date, date, date, text),
  public.usage_user_rollup(date, date, text) to authenticated, service_role;

-- 3. 검색 RPC 복원
drop function if exists public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer);

create or replace function public.match_ai_documents(
  query_embedding public.vector,
  match_count integer default 20,
  p_project_ids uuid[] default null::uuid[],
  p_include_global boolean default false,
  p_domains text[] default null::text[],
  p_entity_types text[] default null::text[],
  p_team text default null::text,
  p_date_from date default null::date,
  p_date_to date default null::date,
  p_index_version integer default 1
) returns table(
  id uuid,
  project_id uuid,
  domain text,
  entity_type text,
  entity_id text,
  chunk_no integer,
  index_version integer,
  title text,
  content text,
  content_hash text,
  href text,
  team text,
  occurred_on date,
  source_updated_at timestamp with time zone,
  embedding_model text,
  embedding_dimensions integer,
  chunker_version text,
  indexed_at timestamp with time zone,
  similarity double precision
)
language sql stable
set search_path to 'public', 'extensions'
as $$
  select
    d.id, d.project_id, d.domain, d.entity_type, d.entity_id, d.chunk_no,
    d.index_version, d.title, d.content, d.content_hash, d.href, d.team,
    d.occurred_on, d.source_updated_at, d.embedding_model, d.embedding_dimensions,
    d.chunker_version, d.indexed_at,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.ai_documents d
  where d.index_version = p_index_version
    and (
      (p_project_ids is not null and d.project_id = any(p_project_ids))
      or (p_include_global and d.project_id is null)
    )
    and (p_domains is null or d.domain = any(p_domains))
    and (p_entity_types is null or d.entity_type = any(p_entity_types))
    and (p_team is null or d.team = p_team)
    and (p_date_from is null or d.occurred_on >= p_date_from)
    and (p_date_to is null or d.occurred_on <= p_date_to)
  order by d.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

revoke all on function public.match_ai_documents(public.vector, integer, uuid[], boolean, text[], text[], text, date, date, integer) from public, anon;
grant execute on function public.match_ai_documents(public.vector, integer, uuid[], boolean, text[], text[], text, date, date, integer) to authenticated, service_role;

drop function if exists public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer);

create or replace function public.match_ai_documents_lexical(
  p_tokens text[],
  match_count integer default 20,
  p_project_ids uuid[] default null::uuid[],
  p_include_global boolean default false,
  p_domains text[] default null::text[],
  p_entity_types text[] default null::text[],
  p_index_version integer default 1
) returns table(
  id uuid,
  project_id uuid,
  domain text,
  entity_type text,
  entity_id text,
  chunk_no integer,
  index_version integer,
  title text,
  content text,
  content_hash text,
  href text,
  team text,
  occurred_on date,
  source_updated_at timestamp with time zone,
  embedding_model text,
  embedding_dimensions integer,
  chunker_version text,
  indexed_at timestamp with time zone,
  similarity double precision
)
language sql stable
set search_path to 'public', 'extensions'
as $$
  select
    s.id, s.project_id, s.domain, s.entity_type, s.entity_id, s.chunk_no,
    s.index_version, s.title, s.content, s.content_hash, s.href, s.team,
    s.occurred_on, s.source_updated_at, s.embedding_model, s.embedding_dimensions,
    s.chunker_version, s.indexed_at, s.similarity
  from (
    select distinct on (d.id)
      d.id, d.project_id, d.domain, d.entity_type, d.entity_id, d.chunk_no,
      d.index_version, d.title, d.content, d.content_hash, d.href, d.team,
      d.occurred_on, d.source_updated_at, d.embedding_model, d.embedding_dimensions,
      d.chunker_version, d.indexed_at,
      0.5::double precision as similarity
    from public.ai_documents d,
         unnest(p_tokens) as tok
    where d.index_version = p_index_version
      and (
        (p_project_ids is not null and d.project_id = any(p_project_ids))
        or (p_include_global and d.project_id is null)
      )
      and (p_domains is null or d.domain = any(p_domains))
      and (p_entity_types is null or d.entity_type = any(p_entity_types))
      and (d.content ilike ('%' || tok || '%') or d.title ilike ('%' || tok || '%'))
  ) s
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

revoke all on function public.match_ai_documents_lexical(text[], integer, uuid[], boolean, text[], text[], integer) from public, anon;
grant execute on function public.match_ai_documents_lexical(text[], integer, uuid[], boolean, text[], text[], integer) to authenticated, service_role;

-- 4. replace_ai_document_chunks 복원
create or replace function public.replace_ai_document_chunks(
  p_project_id uuid,
  p_domain text,
  p_entity_type text,
  p_entity_id text,
  p_index_version integer,
  p_source_updated_at timestamp with time zone,
  p_indexed_at timestamp with time zone,
  p_documents jsonb
) returns integer
language plpgsql
set search_path to 'public', 'extensions'
as $$
declare
  v_count integer;
  v_distinct_count integer;
  v_min_chunk integer;
  v_max_chunk integer;
  v_existing_source timestamptz;
  v_existing_indexed timestamptz;
begin
  if jsonb_typeof(p_documents) <> 'array' or jsonb_array_length(p_documents) = 0 then
    raise exception 'AI_DOCUMENT_CHUNKS_INVALID' using errcode = '22023';
  end if;

  select count(*), count(distinct x.chunk_no), min(x.chunk_no), max(x.chunk_no)
    into v_count, v_distinct_count, v_min_chunk, v_max_chunk
  from jsonb_to_recordset(p_documents) as x(chunk_no integer);
  if v_count <> v_distinct_count or v_min_chunk <> 0 or v_max_chunk <> v_count - 1 then
    raise exception 'AI_DOCUMENT_CHUNKS_NON_CONTIGUOUS' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_project_id::text, 'global') || '|' || p_domain || '|' ||
    p_entity_type || '|' || p_entity_id || '|' || p_index_version::text,
    0
  ));

  select max(source_updated_at), max(indexed_at)
    into v_existing_source, v_existing_indexed
  from public.ai_documents
  where project_id is not distinct from p_project_id
    and domain = p_domain
    and entity_type = p_entity_type
    and entity_id = p_entity_id
    and index_version = p_index_version;

  if v_existing_source is not null and (
    p_source_updated_at is null
    or v_existing_source > p_source_updated_at
    or (v_existing_source = p_source_updated_at and v_existing_indexed > p_indexed_at)
  ) then
    return 0;
  end if;
  if v_existing_source is null and v_existing_indexed > p_indexed_at then
    return 0;
  end if;

  insert into public.ai_documents (
    project_id, domain, entity_type, entity_id, chunk_no, index_version,
    title, content, content_hash, href, team, occurred_on, source_updated_at,
    embedding_model, embedding_dimensions, chunker_version, embedding, indexed_at
  )
  select
    p_project_id, p_domain, p_entity_type, p_entity_id, x.chunk_no, p_index_version,
    x.title, x.content, x.content_hash, x.href, x.team, x.occurred_on,
    p_source_updated_at, x.embedding_model, x.embedding_dimensions,
    x.chunker_version,
    case when x.embedding is null or x.embedding = 'null'::jsonb
      then null else (x.embedding::text)::vector(768) end,
    p_indexed_at
  from jsonb_to_recordset(p_documents) as x(
    chunk_no integer,
    title text,
    content text,
    content_hash text,
    href text,
    team text,
    occurred_on date,
    source_updated_at timestamptz,
    embedding_model text,
    embedding_dimensions integer,
    chunker_version text,
    embedding jsonb
  )
  on conflict (project_scope, domain, entity_type, entity_id, chunk_no, index_version)
  do update set
    project_id = excluded.project_id,
    title = excluded.title,
    content = excluded.content,
    content_hash = excluded.content_hash,
    href = excluded.href,
    team = excluded.team,
    occurred_on = excluded.occurred_on,
    source_updated_at = excluded.source_updated_at,
    embedding_model = excluded.embedding_model,
    embedding_dimensions = excluded.embedding_dimensions,
    chunker_version = excluded.chunker_version,
    embedding = case
      when excluded.embedding is null and ai_documents.content_hash = excluded.content_hash
        then ai_documents.embedding
      else excluded.embedding
    end,
    indexed_at = excluded.indexed_at;

  delete from public.ai_documents
  where project_id is not distinct from p_project_id
    and domain = p_domain
    and entity_type = p_entity_type
    and entity_id = p_entity_id
    and index_version = p_index_version
    and chunk_no >= v_count;

  return v_count;
end;
$$;

revoke all on function public.replace_ai_document_chunks(uuid, text, text, text, integer, timestamp with time zone, timestamp with time zone, jsonb) from public, anon;
grant execute on function public.replace_ai_document_chunks(uuid, text, text, text, integer, timestamp with time zone, timestamp with time zone, jsonb) to service_role;

-- 5. notification_events 인덱스 제거
drop index if exists public.notification_events_workspace_actor_idx;

-- 6. usage_events 인덱스 및 workspace_id 컬럼 제거
drop index if exists public.usage_events_workspace_id_idx;
alter table public.usage_events drop column if exists workspace_id;

-- 7. ai_index_jobs 인덱스 및 workspace_id 컬럼 제거
drop index if exists public.ai_index_jobs_workspace_id_idx;
alter table public.ai_index_jobs drop column if exists workspace_id;

-- 8. ai_documents 복원
drop index if exists public.ai_documents_workspace_id_idx;
drop index if exists public.ai_documents_ws_domain_idx;

drop policy if exists ai_documents_read on public.ai_documents;
create policy ai_documents_read on public.ai_documents
  for select to authenticated
  using (project_id in (select public.accessible_project_ids()));

alter table public.ai_documents drop constraint if exists ai_documents_stable_key;
alter table public.ai_documents drop column if exists project_scope;
alter table public.ai_documents add column project_scope text GENERATED ALWAYS AS (COALESCE((project_id)::text, 'global'::text)) STORED;
alter table public.ai_documents add constraint ai_documents_stable_key UNIQUE (project_scope, domain, entity_type, entity_id, chunk_no, index_version);

alter table public.ai_documents drop column if exists workspace_id;
