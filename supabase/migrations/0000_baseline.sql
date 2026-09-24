-- 0000_baseline — wbs-web 운영 public 스키마(pg_dump 17 --schema-only), 출처 prod, 컷오프 wbs-web@77cf6785, 덤프 2026-09-23T14:43:43.824Z.
-- 생성: scripts/baseline-dump.mjs. 손으로 고치지 않는다 — 고칠 것은 scripts/lib/baseline.mjs 규칙으로.

create extension if not exists "pg_trgm" with schema public;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "vector" with schema public;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: answer_wiki_question(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.answer_wiki_question(p_question_id uuid, p_answer text, p_topic_id uuid DEFAULT NULL::uuid) RETURNS TABLE(question_id uuid, status text, topic_id uuid, answered_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_question public.wiki_questions%rowtype;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_topic_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_QUESTION_FORBIDDEN' using errcode = '42501';
  end if;

  select question.* into v_question
  from public.wiki_questions question
  where question.id = p_question_id
  for update;
  if not found then
    raise exception 'WIKI_QUESTION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_question.project_id) then
    raise exception 'WIKI_QUESTION_FORBIDDEN' using errcode = '42501';
  end if;
  if v_question.status <> 'open' then
    raise exception 'WIKI_QUESTION_NOT_OPEN' using errcode = '22023';
  end if;
  if v_answer = '' or char_length(v_answer) > 20000 then
    raise exception 'WIKI_ANSWER_INVALID' using errcode = '22023';
  end if;

  v_topic_id := coalesce(p_topic_id, v_question.topic_id);
  if v_topic_id is not null and not exists (
    select 1 from public.wiki_topics topic
    where topic.id = v_topic_id and topic.project_id = v_question.project_id
  ) then
    raise exception 'WIKI_QUESTION_TOPIC_MISMATCH' using errcode = '23514';
  end if;

  update public.wiki_questions question
  set answer = v_answer,
      status = 'answered',
      topic_id = v_topic_id,
      answered_by = v_actor,
      answered_at = v_now,
      updated_at = v_now
  where question.id = p_question_id;

  return query select p_question_id, 'answered'::text, v_topic_id, v_now;
end
$$;


--
-- Name: app_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case
    when public.is_superuser() then 'pmo_admin'
    when exists (select 1 from public.project_roles r
                  where r.user_id = auth.uid() and r.role = 'admin') then 'pmo_admin'
    when exists (select 1 from public.project_roles r
                  where r.user_id = auth.uid()) then 'team_editor'
    else null
  end
$$;


--
-- Name: apply_wiki_extracted_item_atomic(uuid, uuid, bigint, text, integer, uuid, uuid, integer, text, text, text, text, text, text, text, text, text, boolean, timestamp with time zone, timestamp with time zone, text, text, date, jsonb, uuid, text, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public."apply_wiki_extracted_item_atomic"(p_project_id uuid, p_topic_id uuid, p_wiki_job_id bigint, p_job_locked_by text, p_apply_generation integer, p_minute_id uuid, p_minute_version_id uuid, p_minute_version_no integer, p_body_hash text, p_kind text, p_statement text, p_statement_hash text, p_knowledge_key text, p_certainty text, p_decision_state text, p_source_relation text, p_requested_change text, p_can_auto_apply boolean, p_observed_at timestamp with time zone, p_valid_from timestamp with time zone, p_owner_team text, p_owner_name text, p_due_date date, p_sources jsonb, p_expected_current_id uuid, p_expected_current_hash text, p_expected_current_updated_at timestamp with time zone, p_idempotency_key text) RETURNS TABLE(outcome text, wiki_item_id uuid, source_id uuid, change_event_id uuid, applied_change_type text)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  v_now timestamptz := clock_timestamp();
  v_minute_project_id uuid;
  v_minute_archived_at timestamptz;
  v_version_body_hash text;
  v_latest_version_no integer;
  v_latest_body_hash text;
  v_rebuild public.wiki_project_rebuild_jobs%rowtype;
  v_job public.wiki_processing_jobs%rowtype;
  v_current public.wiki_items%rowtype;
  v_target public.wiki_items%rowtype;
  v_has_current boolean := false;
  v_can_auto boolean := coalesce(p_can_auto_apply, false);
  v_must_conflict boolean := false;
  v_is_replay boolean := false;
  v_close_at timestamptz := coalesce(p_valid_from, p_observed_at);
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_applied_change text;
  v_outcome text;
  v_reason text;
  v_relation_to_current text;
  v_event public.wiki_change_events%rowtype;
  v_source_record record;
  v_source_id uuid;
  v_first_source_id uuid;
begin
  -- RPC 경계에서도 열거값, 길이, 원본 version을 검증한다. service key 유출이나 앱 버그가
  -- 있어도 다른 프로젝트/버전의 provenance를 연결할 수 없어야 한다.
  if p_project_id is null
     or p_topic_id is null
     or p_wiki_job_id is null
     or nullif(btrim(p_job_locked_by), '') is null
     or p_apply_generation is null
     or p_apply_generation < 0
     or p_minute_id is null
     or p_minute_version_id is null
     or p_minute_version_no is null
     or p_minute_version_no < 1 then
    raise exception 'WIKI_APPLY_SCOPE_INVALID' using errcode = '22023';
  end if;
  if p_kind is null
     or p_kind not in ('decision','fact','action','question','risk','constraint','rationale') then
    raise exception 'WIKI_APPLY_KIND_INVALID' using errcode = '22023';
  end if;
  if p_certainty is null or p_certainty not in ('explicit','tentative') then
    raise exception 'WIKI_APPLY_CERTAINTY_INVALID' using errcode = '22023';
  end if;
  if p_decision_state is not null
     and p_decision_state not in ('proposed','tentative','confirmed','reversed') then
    raise exception 'WIKI_APPLY_DECISION_STATE_INVALID' using errcode = '22023';
  end if;
  if p_kind <> 'decision' and p_decision_state is not null then
    raise exception 'WIKI_APPLY_DECISION_STATE_KIND_MISMATCH' using errcode = '22023';
  end if;
  if p_source_relation is null
     or p_source_relation not in ('supports','contradicts','resolves') then
    raise exception 'WIKI_APPLY_SOURCE_RELATION_INVALID' using errcode = '22023';
  end if;
  if p_requested_change is null or p_requested_change not in (
    'new','reaffirm','refine','supersede','reverse','conflict','resolve'
  ) then
    raise exception 'WIKI_APPLY_CHANGE_INVALID' using errcode = '22023';
  end if;
  if nullif(btrim(p_statement), '') is null
     or char_length(p_statement) > 1000
     or nullif(btrim(p_knowledge_key), '') is null
     or char_length(p_knowledge_key) > 160
     or nullif(btrim(p_body_hash), '') is null
     or nullif(btrim(p_statement_hash), '') is null
     or char_length(coalesce(p_owner_name, '')) > 100
     -- statement_hash는 앱의 NFKC/space/dash/문장부호/lower 정규화 결과 해시다.
     -- PostgreSQL에서 그 정규화를 어설프게 재현하지 않고 wire format만 검증한다.
     or p_statement_hash !~ '^[0-9a-f]{16}$' then
    raise exception 'WIKI_APPLY_CONTENT_INVALID' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) > 1000 then
    raise exception 'WIKI_APPLY_IDEMPOTENCY_KEY_INVALID' using errcode = '22023';
  end if;
  if p_sources is null
     or jsonb_typeof(p_sources) <> 'array'
     or jsonb_array_length(p_sources) < 1
     or jsonb_array_length(p_sources) > 8 then
    raise exception 'WIKI_APPLY_SOURCES_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_sources) source(value)
    where jsonb_typeof(source.value) <> 'object'
       or jsonb_typeof(source.value -> 'block_index') is distinct from 'number'
       or (source.value ->> 'block_index') !~ '^[0-9]+$'
       or jsonb_typeof(source.value -> 'block_hash') is distinct from 'string'
       or nullif(source.value ->> 'block_hash', '') is null
       or jsonb_typeof(source.value -> 'evidence_excerpt') is distinct from 'string'
       or char_length(source.value ->> 'evidence_excerpt') > 1000
  ) then
    raise exception 'WIKI_APPLY_SOURCE_ENTRY_INVALID' using errcode = '22023';
  end if;
  if (
    select count(*) <> count(distinct (source.value ->> 'block_index')::integer)
    from jsonb_array_elements(p_sources) source(value)
  ) then
    raise exception 'WIKI_APPLY_SOURCE_DUPLICATE' using errcode = '22023';
  end if;

  if p_expected_current_id is not null
     and nullif(btrim(p_expected_current_hash), '') is null then
    raise exception 'WIKI_APPLY_EXPECTED_CURRENT_INVALID' using errcode = '22023';
  end if;

  select mi.project_id, mi.archived_at
  into v_minute_project_id, v_minute_archived_at
  from public.minutes mi
  where mi.id = p_minute_id
  for share;
  if not found then
    raise exception 'WIKI_APPLY_MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute_archived_at is not null or v_minute_project_id is distinct from p_project_id then
    raise exception 'WIKI_APPLY_MINUTE_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  -- minute → project rebuild → job 순서로 SHARE lock을 잡는다. rebuild generation이
  -- pending/running/dead-letter인 동안에는 그 generation의 exact bound step만 쓸 수
  -- 있다. reset 이전 구 worker와 순서 밖의 일반 job은 item mutation 전에 차단된다.
  select rebuild.* into v_rebuild
  from public.wiki_project_rebuild_jobs rebuild
  where rebuild.project_id = p_project_id
  for share;
  if found
     and v_rebuild.status <> 'done'
     and not (
       v_rebuild.status = 'running'
       and v_rebuild.generation = v_rebuild.step_rebuild_generation
       and v_rebuild.step_wiki_job_id = p_wiki_job_id
       and v_rebuild.step_wiki_apply_generation = p_apply_generation
     ) then
    raise exception 'WIKI_PROJECT_REBUILD_FENCE' using errcode = '40001';
  end if;

  -- lease 회수/force/새 worker 완료가 먼저였다면 stale worker는 mutation 없이 끝난다.
  select job.* into v_job
  from public.wiki_processing_jobs job
  where job.id = p_wiki_job_id
    and job.project_id = p_project_id
    and job.minute_id = p_minute_id
    and job.minute_version_id = p_minute_version_id
    and job.status = 'running'
    and job.locked_by = p_job_locked_by
    and job.apply_generation = p_apply_generation
  for share;
  if not found then
    raise exception 'WIKI_JOB_LEASE_LOST' using errcode = '40001';
  end if;

  select mv.body_hash
  into v_version_body_hash
  from public.minute_versions mv
  where mv.id = p_minute_version_id
    and mv.minute_id = p_minute_id
    and mv.version_no = p_minute_version_no;
  if not found then
    raise exception 'WIKI_APPLY_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_version_body_hash is distinct from p_body_hash then
    raise exception 'WIKI_APPLY_VERSION_HASH_MISMATCH' using errcode = '23514';
  end if;
  select latest.version_no, latest.body_hash
  into v_latest_version_no, v_latest_body_hash
  from public.minute_versions latest
  where latest.minute_id = p_minute_id
  order by latest.version_no desc
  limit 1;
  if v_latest_version_no > p_minute_version_no
     and v_latest_body_hash is distinct from p_body_hash then
    -- minutes 행의 SHARE lock을 잡은 상태에서 검사하므로, 이 판정과 item commit 사이에
    -- 내용이 다른 새 version을 만드는 minute commit RPC가 끼어들 수 없다. 파일 연결
    -- 등 동일 body의 새 version은 기존 immutable source를 그대로 사용해도 의미가 같다.
    raise exception 'WIKI_STALE_MINUTE_VERSION' using errcode = '55000';
  end if;

  perform 1
  from public.wiki_topics topic
  where topic.id = p_topic_id
    and topic.project_id = p_project_id;
  if not found then
    raise exception 'WIKI_APPLY_TOPIC_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if p_owner_team is not null and not exists (
    select 1 from public.teams team
    where team.code = p_owner_team and team.active
  ) then
    raise exception 'WIKI_APPLY_OWNER_TEAM_INVALID' using errcode = '23503';
  end if;

  -- project/topic/kind/knowledge-key가 같은 모든 자동 반영을 커밋까지 직렬화한다.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_project_id::text || ':' || p_topic_id::text || ':' || p_kind || ':' || p_knowledge_key,
      0
    )
  );

  -- 같은 추출 입력이 이미 커밋됐다면 item/event는 다시 만들지 않는다. 아래 공통 source
  -- upsert는 계속 실행하여 soft-retracted source도 안전하게 재활성화한다.
  select event.* into v_event
  from public.wiki_change_events event
  where event.idempotency_key = p_idempotency_key;
  if found then
    if v_event.project_id is distinct from p_project_id
       or v_event.minute_id is distinct from p_minute_id
       or v_event.minute_version_id is distinct from p_minute_version_id
       or coalesce(
         v_event.after_snapshot ->> 'knowledge_key',
         v_event.before_snapshot ->> 'knowledge_key'
       ) is distinct from p_knowledge_key then
      raise exception 'WIKI_APPLY_IDEMPOTENCY_COLLISION' using errcode = '23505';
    end if;
    if v_event.wiki_item_id is null then
      raise exception 'WIKI_APPLY_IDEMPOTENCY_TARGET_MISSING' using errcode = '55000';
    end if;

    select item.* into v_target
    from public.wiki_items item
    where item.id = v_event.wiki_item_id;
    if not found
       or v_target.project_id is distinct from p_project_id
       or v_target.topic_id is distinct from p_topic_id
       or v_target.kind is distinct from p_kind
       or v_target.knowledge_key is distinct from p_knowledge_key then
      raise exception 'WIKI_APPLY_IDEMPOTENCY_TARGET_MISMATCH' using errcode = '23514';
    end if;

    v_is_replay := true;
    v_applied_change := v_event.change_type;
    v_outcome := case
      when v_event.change_type = 'reaffirm' then 'reaffirmed'
      when v_event.change_type = 'conflict' then 'conflicted'
      when v_event.change_type = 'new'
        and v_event.after_snapshot ->> 'lifecycle_state' = 'conflicted' then 'conflicted'
      when v_event.change_type = 'new' then 'created'
      else 'changed'
    end;
  else
    select item.* into v_current
    from public.wiki_items item
    where item.project_id = p_project_id
      and item.topic_id = p_topic_id
      and item.kind = p_kind
      and item.knowledge_key = p_knowledge_key
      and item.lifecycle_state in ('active','open','conflicted')
    order by item.updated_at desc, item.id desc
    limit 1
    for update;
    v_has_current := found;

    -- 앱이 분류에 사용한 current와 잠금 안의 current가 다르면 stale 판정을 적용하지 않는다.
    -- SQLSTATE 40001은 호출자가 전체 판정/RPC를 안전하게 재시도할 수 있는 명시적 신호다.
    if p_expected_current_id is null and v_has_current then
      raise exception 'WIKI_CURRENT_RACE'
        using errcode = '40001', detail = 'expected no current item, but one now exists';
    elsif p_expected_current_id is not null and not v_has_current then
      raise exception 'WIKI_CURRENT_RACE'
        using errcode = '40001', detail = 'expected current item no longer exists';
    elsif p_expected_current_id is not null and (
      v_current.id is distinct from p_expected_current_id
      or v_current.statement_hash is distinct from p_expected_current_hash
      or (
        p_expected_current_updated_at is not null
        and v_current.updated_at is distinct from p_expected_current_updated_at
      )
    ) then
      raise exception 'WIKI_CURRENT_RACE'
        using errcode = '40001', detail = 'current item id/hash/version changed';
    end if;

    if v_has_current then
      v_before_snapshot := jsonb_build_object(
        'id', v_current.id,
        'project_id', v_current.project_id,
        'topic_id', v_current.topic_id,
        'kind', v_current.kind,
        'statement', v_current.statement,
        'statement_hash', v_current.statement_hash,
        'knowledge_key', v_current.knowledge_key,
        'lifecycle_state', v_current.lifecycle_state,
        'certainty', v_current.certainty,
        'decision_state', v_current.decision_state
      );

      -- 수동 항목은 잠금 플래그와 무관하게 AI가 변경하지 않는다. 동일 statement의
      -- reaffirm 근거만 아래 분기에서 추가할 수 있고, 다른 명시적 내용은 conflict로 보존한다.
      if v_current.origin = 'manual' then
        v_can_auto := false;
      end if;

      -- 앱의 결정형 gate 결과를 신뢰하되, 파괴적 변경의 핵심 조건은 DB에서도 다시
      -- 계산한다. manual/locked/tentative/과거 입력은 service 호출 버그가 있어도
      -- current를 못 바꾼다.
      if p_requested_change in ('refine','supersede','reverse','resolve')
         and (
           v_current.auto_update_locked
           or p_certainty <> 'explicit'
           or (
             coalesce(v_current.valid_from, v_current.observed_at) is not null
             and (
               v_close_at is null
               or v_close_at < coalesce(v_current.valid_from, v_current.observed_at)
             )
           )
         ) then
        v_can_auto := false;
      end if;

      -- 같은 회의록의 더 최신 immutable version이 이미 이 항목을 뒷받침하면, 오래된
      -- version의 파괴적 refine/supersede/reverse/resolve를 다시 허용하지 않는다.
      if exists (
        select 1
        from public.wiki_item_sources source
        join public.minute_versions version
          on version.id = source.minute_version_id
         and version.minute_id = source.minute_id
        where source.wiki_item_id = v_current.id
          and source.minute_id = p_minute_id
          and source.retracted_at is null
          and version.version_no > p_minute_version_no
      ) then
        v_can_auto := false;
      end if;
    end if;

    -- 동일 statement는 모델 분류보다 우선하여 항상 reaffirm으로 수렴한다.
    if v_has_current and (
      v_current.statement_hash = p_statement_hash
      or p_requested_change = 'reaffirm'
    ) then
      v_target := v_current;
      v_after_snapshot := v_before_snapshot;
      v_applied_change := 'reaffirm';
      v_outcome := 'reaffirmed';
      v_reason := '후속 회의록에서 동일한 명시적 근거를 확인했습니다.';

    elsif v_has_current
       and p_requested_change in ('resolve','reverse')
       and v_can_auto then
      update public.wiki_items item
      set lifecycle_state = case
            when p_requested_change = 'reverse' then 'superseded'
            else 'resolved'
          end,
          decision_state = case
            when p_requested_change = 'reverse' then 'reversed'
            else item.decision_state
          end,
          updated_at = v_now
      where item.id = v_current.id
      returning item.* into v_target;

      v_applied_change := p_requested_change;
      v_outcome := 'changed';
      v_reason := case
        when p_requested_change = 'reverse'
          then '회의록에 기존 결정의 철회가 명시되었습니다.'
        else '회의록에 완료 또는 해소가 명시되었습니다.'
      end;

    else
      v_must_conflict := v_has_current and (
        p_requested_change = 'conflict'
        or (not v_can_auto and p_certainty = 'explicit')
      );

      if v_has_current and (p_certainty = 'tentative' or v_must_conflict) then
        insert into public.wiki_items (
          project_id, topic_id, kind, statement, statement_hash, knowledge_key,
          lifecycle_state, certainty, decision_state, owner_team, due_date,
          observed_at, valid_from, origin, structured_data
        ) values (
          p_project_id, p_topic_id, p_kind, p_statement, p_statement_hash, p_knowledge_key,
          case when v_must_conflict then 'conflicted' else 'open' end,
          p_certainty, p_decision_state, p_owner_team, p_due_date,
          p_observed_at, p_valid_from, 'ai',
          case
            when nullif(btrim(p_owner_name), '') is null then '{}'::jsonb
            else jsonb_build_object('owner_name', p_owner_name)
          end
        )
        returning * into v_target;

        if v_must_conflict then
          v_relation_to_current := 'contradicts';
          v_applied_change := 'conflict';
          v_outcome := 'conflicted';
          v_reason := '기존 지식과 상충하거나 자동 갱신 잠금이 있어 별도 항목으로 보존했습니다.';
        else
          v_applied_change := 'new';
          v_outcome := 'created';
          v_reason := '잠정 표현이므로 현재 지식을 바꾸지 않고 열린 항목으로 추가했습니다.';
        end if;

      elsif v_has_current
         and p_requested_change = 'refine'
         and v_can_auto then
        update public.wiki_items item
        set statement = p_statement,
            statement_hash = p_statement_hash,
            certainty = p_certainty,
            decision_state = p_decision_state,
            owner_team = coalesce(p_owner_team, item.owner_team),
            due_date = p_due_date,
            observed_at = p_observed_at,
            valid_from = p_valid_from,
            updated_at = v_now
        where item.id = v_current.id
        returning item.* into v_target;

        v_applied_change := 'refine';
        v_outcome := 'changed';
        v_reason := '후속 회의록의 명시적 보완 내용으로 현재 지식을 정교화했습니다.';

      elsif v_has_current
         and p_requested_change = 'supersede'
         and v_can_auto then
        if v_close_at is null then
          raise exception 'WIKI_APPLY_SUPERSEDE_TIME_REQUIRED' using errcode = '22023';
        end if;
        if v_current.valid_from is not null and v_close_at < v_current.valid_from then
          raise exception 'WIKI_APPLY_SUPERSEDE_TIME_INVALID' using errcode = '22023';
        end if;

        insert into public.wiki_items (
          project_id, topic_id, kind, statement, statement_hash, knowledge_key,
          lifecycle_state, certainty, decision_state, owner_team, due_date,
          observed_at, valid_from, origin, structured_data
        ) values (
          p_project_id, p_topic_id, p_kind, p_statement, p_statement_hash, p_knowledge_key,
          case
            when p_source_relation = 'contradicts' then 'conflicted'
            when p_certainty = 'tentative' then 'open'
            when p_kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          p_certainty, p_decision_state, p_owner_team, p_due_date,
          p_observed_at, p_valid_from, 'ai',
          case
            when nullif(btrim(p_owner_name), '') is null then '{}'::jsonb
            else jsonb_build_object('owner_name', p_owner_name)
          end
        )
        returning * into v_target;

        update public.wiki_items item
        set lifecycle_state = 'superseded',
            -- 처리 시각이 아니라 회의록이 명시한 효력 시점(없으면 관찰 시점)으로 닫는다.
            valid_to = v_close_at,
            updated_at = v_now
        where item.id = v_current.id;

        v_relation_to_current := 'supersedes';
        v_applied_change := 'supersede';
        v_outcome := 'changed';
        v_reason := '후속 회의록의 명시적 변경 내용으로 현재 지식을 교체했습니다.';

      else
        -- current가 없거나 semantic relation이 unrelated/new인 독립 지식이다.
        insert into public.wiki_items (
          project_id, topic_id, kind, statement, statement_hash, knowledge_key,
          lifecycle_state, certainty, decision_state, owner_team, due_date,
          observed_at, valid_from, origin, structured_data
        ) values (
          p_project_id, p_topic_id, p_kind, p_statement, p_statement_hash, p_knowledge_key,
          case
            when p_source_relation = 'contradicts' then 'conflicted'
            when p_certainty = 'tentative' then 'open'
            when p_kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          p_certainty, p_decision_state, p_owner_team, p_due_date,
          p_observed_at, p_valid_from, 'ai',
          case
            when nullif(btrim(p_owner_name), '') is null then '{}'::jsonb
            else jsonb_build_object('owner_name', p_owner_name)
          end
        )
        returning * into v_target;

        -- 기존 코드의 unrelated/new 계약처럼 독립 항목 event에는 before를 싣지 않는다.
        v_before_snapshot := null;
        v_applied_change := 'new';
        v_outcome := case
          when v_target.lifecycle_state = 'conflicted' then 'conflicted'
          else 'created'
        end;
        v_reason := case
          when p_certainty = 'explicit'
            then '회의록에서 새로운 명시적 지식을 추출했습니다.'
          else '회의록에서 새로운 열린 논의 항목을 추출했습니다.'
        end;
      end if;
    end if;

    v_after_snapshot := coalesce(v_after_snapshot, jsonb_build_object(
      'id', v_target.id,
      'project_id', v_target.project_id,
      'topic_id', v_target.topic_id,
      'kind', v_target.kind,
      'statement', v_target.statement,
      'statement_hash', v_target.statement_hash,
      'knowledge_key', v_target.knowledge_key,
      'lifecycle_state', v_target.lifecycle_state,
      'certainty', v_target.certainty,
      'decision_state', v_target.decision_state
    ));

    if v_relation_to_current is not null and v_target.id <> v_current.id then
      insert into public.wiki_item_relations (
        from_item_id, to_item_id, relation
      ) values (
        v_target.id, v_current.id, v_relation_to_current
      )
      on conflict on constraint wiki_item_relations_edge_unique do nothing;
    end if;
  end if;

  -- target item에 모든 evidence source를 붙인다. unique source는 재사용하고, 철회된 동일
  -- source는 되살린다. 같은 키인데 immutable provenance가 다르면 조용히 덮지 않고 실패한다.
  for v_source_record in
    select source.value, source.ordinality
    from jsonb_array_elements(p_sources) with ordinality source(value, ordinality)
    order by source.ordinality
  loop
    v_source_id := null;
    insert into public.wiki_item_sources as existing_source (
      wiki_item_id, minute_id, minute_version_id, body_hash,
      block_index, block_hash, evidence_excerpt, relation
    ) values (
      v_target.id,
      p_minute_id,
      p_minute_version_id,
      p_body_hash,
      (v_source_record.value ->> 'block_index')::integer,
      v_source_record.value ->> 'block_hash',
      v_source_record.value ->> 'evidence_excerpt',
      p_source_relation
    )
    on conflict on constraint wiki_item_sources_source_unique
    do update set
      retracted_at = null,
      retraction_reason = null
    where existing_source.minute_id = excluded.minute_id
      and existing_source.body_hash = excluded.body_hash
      and existing_source.block_hash = excluded.block_hash
      and existing_source.evidence_excerpt = excluded.evidence_excerpt
    returning existing_source.id into v_source_id;

    if v_source_id is null then
      raise exception 'WIKI_APPLY_SOURCE_PROVENANCE_MISMATCH' using errcode = '23514';
    end if;
    v_first_source_id := coalesce(v_first_source_id, v_source_id);
  end loop;

  if not v_is_replay then
    insert into public.wiki_change_events (
      project_id, wiki_item_id, minute_id, source_id,
      change_type, before_snapshot, after_snapshot, reason, idempotency_key, created_at
    ) values (
      p_project_id, v_target.id, p_minute_id, v_first_source_id,
      v_applied_change, v_before_snapshot, v_after_snapshot, v_reason,
      p_idempotency_key, v_now
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing
    returning * into v_event;

    if not found then
      select event.* into v_event
      from public.wiki_change_events event
      where event.idempotency_key = p_idempotency_key;
      if not found
         or v_event.project_id is distinct from p_project_id
         or v_event.wiki_item_id is distinct from v_target.id then
        raise exception 'WIKI_APPLY_EVENT_IDEMPOTENCY_MISMATCH' using errcode = '23505';
      end if;
    end if;
  end if;

  update public.wiki_topics topic
  set last_changed_at = v_now,
      updated_at = v_now
  where topic.id = p_topic_id
    and topic.project_id = p_project_id;

  outcome := v_outcome;
  wiki_item_id := v_target.id;
  source_id := v_first_source_id;
  change_event_id := v_event.id;
  applied_change_type := v_applied_change;
  return next;
end
$_$;


--
-- Name: apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_agent_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
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


--
-- Name: archive_minute_with_wiki_retraction(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.archive_minute_with_wiki_retraction(p_minute_id uuid, p_reason text DEFAULT '회의록 보관 처리'::text) RETURNS TABLE(archived_at timestamp with time zone, retracted_source_count integer, archived_item_count integer, change_event_count integer)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_minute public.minutes%rowtype;
  v_now timestamptz := clock_timestamp();
  v_counts record;
  v_index_project_id uuid;
begin
  select mi.* into v_minute
  from public.minutes mi
  where mi.id = p_minute_id
  for update;
  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select r.* into v_counts
  from public.retract_minute_wiki_sources(
    p_minute_id,
    coalesce(nullif(btrim(p_reason), ''), '회의록 보관 처리')
  ) r;

  update public.minutes mi
  set archived_at = coalesce(mi.archived_at, v_now),
      share_enabled = false,
      updated_at = v_now
  where mi.id = p_minute_id
  returning mi.archived_at into archived_at;

  update public.wiki_processing_jobs job
  set status = 'done',
      locked_at = null,
      locked_by = null,
      last_error = null,
      payload = job.payload || jsonb_build_object('archived', true),
      updated_at = v_now
  where job.minute_id = p_minute_id
    and job.status <> 'done';

  -- 원본/버전/파일은 보존하되 검색·챗용 파생 벡터/문서는 즉시 제거한다.
  delete from public.minute_embeddings
  where minute_id = p_minute_id;

  delete from public.ai_documents
  where domain = 'minutes'
    and entity_type = 'minute'
    and entity_id = p_minute_id::text;

  -- 현재 scope뿐 아니라 과거 프로젝트 이동 흔적의 모든 scope에 CAS-safe tombstone을
  -- 남긴다. 실행 중인 구세대 upsert는 lease를 유지한 채 generation mismatch로
  -- 재실행되어 최종 delete로 수렴한다.
  for v_index_project_id in
    select distinct scope.project_id
    from (
      select job.project_id
      from public.ai_index_jobs job
      where job.domain = 'minutes'
        and job.entity_type = 'minute'
        and job.entity_id = p_minute_id::text
      union all
      select v_minute.project_id
    ) scope
  loop
    perform public.queue_minute_ai_index_scope_change(
      v_index_project_id,
      p_minute_id,
      'delete',
      v_now
    );
  end loop;

  retracted_source_count := coalesce(v_counts.retracted_source_count, 0);
  archived_item_count := coalesce(v_counts.archived_item_count, 0);
  change_event_count := coalesce(v_counts.change_event_count, 0);
  return next;
end
$$;


--
-- Name: assign_issue_analysis_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_issue_analysis_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_active boolean;
  v_seq bigint;
begin
  if tg_op = 'UPDATE' then
    if old.mega_code is not null
       or old.mega_seq is not null
       or old.pi_issue_code is not null then
      if old.mega_code is null
         or old.mega_seq is null
         or old.pi_issue_code is null then
        raise exception 'ISSUE_CODE_INCONSISTENT' using errcode = '23514';
      end if;
      if new.project_id is distinct from old.project_id
         or new.mega_code is distinct from old.mega_code
         or new.mega_seq is distinct from old.mega_seq
         or new.pi_issue_code is distinct from old.pi_issue_code then
        raise exception 'ISSUE_CODE_IMMUTABLE' using errcode = '23514';
      end if;
      -- 0062: 체번된 이슈의 major 연결을 도로 끊는 것은 금지한다(헤더 계약 4항).
      -- 백필(null→값)과 교정(값→값)은 그대로 허용된다.
      if old.major_id is not null and new.major_id is null then
        raise exception 'ISSUE_MAJOR_UNSET_FORBIDDEN' using errcode = '23514';
      end if;
      return new;
    end if;
  end if;

  if new.mega_code is null then
    if new.mega_seq is not null or new.pi_issue_code is not null then
      raise exception 'ISSUE_CODE_MANAGED' using errcode = '23514';
    end if;
    return new;
  end if;

  -- insert와 기존 미분류 이슈의 최초 분류 모두 seq/code 직접 주입을 허용하지 않는다.
  if new.mega_seq is not null or new.pi_issue_code is not null then
    raise exception 'ISSUE_CODE_MANAGED' using errcode = '23514';
  end if;

  -- 0062: pi 코드가 새로 체번되는 행은 Major Process 분류를 함께 갖춰야 한다.
  -- (레거시 분류 이슈의 기존 행 갱신은 위 UPDATE 불변 분기에서 이미 반환됐다.)
  if new.major_id is null then
    raise exception 'ISSUE_MAJOR_REQUIRED' using errcode = '23514';
  end if;

  select area.active
    into v_active
    from public.issue_mega_areas area
   where area.code = new.mega_code;
  if not found or not v_active then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '23514';
  end if;

  insert into public.issue_number_counters as counter (
    project_id, mega_code, last_no, updated_at
  ) values (
    new.project_id, new.mega_code, 1, now()
  )
  on conflict (project_id, mega_code) do update
    set last_no = counter.last_no + 1,
        updated_at = now()
  returning last_no into v_seq;

  new.mega_seq := v_seq;
  new.pi_issue_code :=
    'PI-I-' || new.mega_code || '-' || pg_catalog.lpad(v_seq::text, 2, '0');
  return new;
end
$$;


--
-- Name: assign_issue_major_seq(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_issue_major_seq() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_active boolean;
  v_seq bigint;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
       or new.mega_code is distinct from old.mega_code
       or new.major_seq is distinct from old.major_seq then
      raise exception 'ISSUE_MAJOR_IMMUTABLE' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.major_seq is not null then
    raise exception 'ISSUE_MAJOR_SEQ_MANAGED' using errcode = '23514';
  end if;

  select area.active
    into v_active
    from public.issue_mega_areas area
   where area.code = new.mega_code;
  if not found or not v_active then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '23514';
  end if;

  -- 유니크 키·dedupe 비교의 기준을 저장 전에 한 곳에서 고정한다.
  new.name := btrim(new.name);

  -- (project, mega) 단위 직렬화 후 MAX+1 — 트랜잭션 종료까지 잠금이 유지되어
  -- 동시 등록에도 안전하고, 유니크 충돌로 번호만 소모되는 결번이 없다(헤더 2항).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'issue_major:' || new.project_id::text || ':' || new.mega_code, 0
    )
  );
  select coalesce(max(mp.major_seq), 0) + 1
    into v_seq
    from public.issue_major_processes mp
   where mp.project_id = new.project_id
     and mp.mega_code = new.mega_code;

  new.major_seq := v_seq;
  return new;
end
$$;


--
-- Name: can_attach(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_attach(item uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.wbs_items w
     where w.id = item
       and (
         public.is_project_admin(w.project_id)
         or (
           public.is_project_member(w.project_id)
           and exists (select 1 from public.item_owners o
                        where o.wbs_item_id = item
                          and (o.team_id = (select m.team_id from public.memberships m
                                             where m.user_id = auth.uid())
                            or o.team_id in (select pm.team_id from public.project_members pm
                                              where pm.project_id = w.project_id
                                                and pm.user_id = auth.uid()
                                                and pm.team_id is not null)))
         )
       )
  )
$$;


--
-- Name: can_edit_issue(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_issue(iid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.issues i
    where i.id = iid
      and (i.created_by = auth.uid() or public.is_project_admin(i.project_id))
  )
$$;


--
-- Name: can_read_project(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_project(pid uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ select true $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_index_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_index_jobs (
    id bigint NOT NULL,
    job_key text NOT NULL,
    operation text NOT NULL,
    project_id uuid,
    domain text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    generation bigint DEFAULT 0 NOT NULL,
    CONSTRAINT ai_index_jobs_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT ai_index_jobs_operation_check CHECK ((operation = ANY (ARRAY['upsert'::text, 'delete'::text]))),
    CONSTRAINT ai_index_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'dead_letter'::text])))
);


--
-- Name: claim_ai_index_jobs(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_ai_index_jobs(p_limit integer, p_lease_seconds integer) RETURNS SETOF public.ai_index_jobs
    LANGUAGE sql
    SET search_path TO 'public', 'extensions'
    AS $$
  update public.ai_index_jobs j
  set status = 'running', locked_at = now(), updated_at = now()
  where j.id in (
    select c.id
    from public.ai_index_jobs c
    where (c.status = 'pending' and c.run_after <= now())
       or (
         c.status = 'running'
         and c.locked_at < now() - make_interval(secs => greatest(1, coalesce(p_lease_seconds, 300)))
       )
    order by c.run_after, c.id
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  returning j.*;
$$;


--
-- Name: wiki_processing_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_processing_jobs (
    id bigint NOT NULL,
    project_id uuid NOT NULL,
    minute_id uuid NOT NULL,
    minute_version_id uuid NOT NULL,
    body_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    model text DEFAULT ''::text NOT NULL,
    prompt_version text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    apply_generation integer DEFAULT 0 NOT NULL,
    rerun_requested boolean DEFAULT false NOT NULL,
    CONSTRAINT wiki_processing_jobs_apply_generation_check CHECK ((apply_generation >= 0)),
    CONSTRAINT wiki_processing_jobs_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT wiki_processing_jobs_body_hash_check CHECK ((body_hash <> ''::text)),
    CONSTRAINT wiki_processing_jobs_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT wiki_processing_jobs_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT wiki_processing_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'dead_letter'::text])))
);


--
-- Name: claim_wiki_processing_job(bigint, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_wiki_processing_job(p_job_id bigint, p_locked_by text, p_lease_seconds integer DEFAULT 900) RETURNS SETOF public.wiki_processing_jobs
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
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
$$;


--
-- Name: claim_wiki_project_rebuild_step(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_lease_seconds integer) RETURNS TABLE(claimed_project_id uuid, rebuild_generation bigint, minute_id uuid, minute_version_id uuid, wiki_job_id bigint, wiki_apply_generation integer, body_md text, observed_sort timestamp without time zone, finished boolean)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_rebuild public.wiki_project_rebuild_jobs%rowtype;
  v_candidate record;
  v_wiki_job public.wiki_processing_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(1, least(coalesce(p_lease_seconds, 900), 3600));
  v_existing_job boolean;
  v_version_body text;
begin
  if nullif(btrim(p_locked_by), '') is null or char_length(p_locked_by) > 200 then
    raise exception 'WIKI_PROJECT_REBUILD_WORKER_INVALID' using errcode = '22023';
  end if;

  select rebuild.* into v_rebuild
  from public.wiki_project_rebuild_jobs rebuild
  where (p_project_id is null or rebuild.project_id = p_project_id)
    and (
      (rebuild.status = 'pending' and rebuild.run_after <= v_now)
      or (
        rebuild.status = 'running'
        and rebuild.locked_at < v_now - make_interval(secs => v_lease_seconds)
      )
    )
  order by rebuild.run_after, rebuild.updated_at, rebuild.project_id
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;

  -- 실행 중 들어온 새 rebuild 요청은 과거 cursor/step보다 우선한다.
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

  -- 새 generation의 첫 claim은 기존 live 자동 지식을 soft-reset한다. 단순히 live 상태
  -- 위에서 과거→현재를 replay하면 과거 입력이 현재 항목과 거짓 충돌하고 중복 current가
  -- 남을 수 있다. project row UPDATE lock을 잡은 채 정확히 한 번 reset하며, apply RPC도
  -- 같은 row를 SHARE lock하므로 reset 전후에 구 worker mutation이 끼어들 수 없다.
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

  -- 이전 시도에서 minute job은 예약했지만 project cursor commit만 실패한 경우,
  -- 같은 binding을 그대로 돌려준다. finish가 minute job done을 DB에서 확인한다.
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

  select candidate.* into v_candidate
  from (
    select
      minute.id as minute_id,
      minute.title,
      minute.minute_date,
      minute.meeting_occurrence_date,
      minute.created_at as minute_created_at,
      version.id as minute_version_id,
      version.version_no,
      version.body_hash,
      version.body_md,
      version.created_at as version_created_at,
      (
        coalesce(minute.meeting_occurrence_date, minute.minute_date)::timestamp
        + (minute.created_at at time zone 'UTC')::time
      ) as observed_sort
    from public.minutes minute
    join lateral (
      select latest.id, latest.version_no, latest.body_hash, latest.body_md, latest.created_at
      from public.minute_versions latest
      where latest.minute_id = minute.id
      order by latest.version_no desc
      limit 1
    ) version on true
    where minute.project_id = v_rebuild.project_id
      and minute.archived_at is null
  ) candidate
  where v_rebuild.cursor_observed_sort is null
     or (candidate.observed_sort, candidate.minute_id)
        > (v_rebuild.cursor_observed_sort, v_rebuild.cursor_minute_id)
  order by candidate.observed_sort, candidate.minute_id
  limit 1;

  if not found then
    update public.wiki_project_rebuild_jobs rebuild
    set status = 'done',
        rerun_requested = false,
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
      v_existing_job := true;
    end if;
  end if;

  if v_existing_job then
    if v_wiki_job.apply_generation = 2147483647 then
      raise exception 'WIKI_JOB_GENERATION_EXHAUSTED' using errcode = '22003';
    end if;

    update public.wiki_processing_jobs job
    set apply_generation = v_wiki_job.apply_generation + 1,
        rerun_requested = case when v_wiki_job.status = 'running' then true else false end,
        status = case when v_wiki_job.status = 'running' then 'running' else 'pending' end,
        attempts = case when v_wiki_job.status = 'running' then v_wiki_job.attempts else 0 end,
        run_after = case when v_wiki_job.status = 'running' then v_wiki_job.run_after else v_now end,
        locked_at = case when v_wiki_job.status = 'running' then v_wiki_job.locked_at else null end,
        locked_by = case when v_wiki_job.status = 'running' then v_wiki_job.locked_by else null end,
        last_error = null,
        payload = (
          (v_wiki_job.payload - 'summary' - 'skipped')
          || jsonb_build_object(
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
            'projectRebuildGeneration', v_rebuild.generation,
            'applyGeneration', v_wiki_job.apply_generation + 1
          )
        ),
        updated_at = v_now
    where job.id = v_wiki_job.id
    returning job.* into v_wiki_job;
  end if;

  update public.wiki_project_rebuild_jobs rebuild
  set status = 'running',
      step_observed_sort = v_candidate.observed_sort,
      step_minute_id = v_candidate.minute_id,
      step_minute_version_id = v_candidate.minute_version_id,
      step_rebuild_generation = v_rebuild.generation,
      step_wiki_job_id = v_wiki_job.id,
      step_wiki_apply_generation = v_wiki_job.apply_generation,
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
end
$$;


--
-- Name: commit_minute_body_version(uuid, text, text, text, text, bigint, text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commit_minute_body_version(p_minute_id uuid, p_body_md text, p_body_hash text, p_file_name text, p_file_path text, p_file_size bigint, p_file_mime text, p_actor_id uuid, p_actor_name text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(version_id uuid, version_no integer, body_hash text, wiki_rebuild_required boolean)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  v_minute public.minutes%rowtype;
  v_original_minute public.minutes%rowtype;
  v_latest_hash text;
  v_current_hash text;
  v_body_changed boolean := false;
  v_next_version integer;
  v_metadata_rebuild_required boolean := false;
  v_snapshot_created_at timestamptz;
  v_has_file boolean := num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) > 0;
  v_has_complete_file boolean :=
    num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) = 4;
  v_current_file public.minute_files%rowtype;
begin
  if p_body_md is null
     or char_length(p_body_md) > 100000
     or p_body_hash is null
     or p_body_hash is distinct from public.wiki_fnv1a64(p_body_md) then
    raise exception 'MINUTE_VERSION_INPUT_INVALID' using errcode = '22023';
  end if;
  if v_has_file <> v_has_complete_file
     or (
       v_has_file and (
         nullif(btrim(p_file_name), '') is null
         or nullif(btrim(p_file_path), '') is null
         or p_file_size < 0
         or nullif(btrim(p_file_mime), '') is null
         or lower(p_file_name) !~ '\.(md|markdown)$'
         or p_file_path not like (p_minute_id::text || '/%')
         or strpos(p_file_path, '..') > 0
       )
     ) then
    raise exception 'MINUTE_FILE_INPUT_INVALID' using errcode = '22023';
  end if;

  select mi.* into v_minute
  from public.minutes mi
  where mi.id = p_minute_id
  for update;
  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute.archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  v_original_minute := v_minute;
  v_snapshot_created_at := v_minute.updated_at;

  -- 메타 갱신(프로젝트 변경 시 Wiki 철회 포함)은 같은 outer transaction 안에서 실행된다.
  if coalesce(p_metadata, '{}'::jsonb) <> '{}'::jsonb then
    select metadata_result.wiki_rebuild_required
    into v_metadata_rebuild_required
    from public.update_minute_metadata_with_wiki_retraction(
      p_minute_id,
      p_metadata
    ) metadata_result;
    select mi.* into v_minute
    from public.minutes mi
    where mi.id = p_minute_id;
  elsif p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'MINUTE_METADATA_INVALID' using errcode = '22023';
  end if;

  v_current_hash := public.wiki_fnv1a64(v_original_minute.body_md);
  v_body_changed := v_current_hash is distinct from p_body_hash;
  wiki_rebuild_required :=
    v_metadata_rebuild_required
    or v_body_changed;
  if v_body_changed then
    -- 새 본문에서 삭제된 문장이 과거 source 때문에 현재 지식으로 남지 않도록,
    -- 이전 버전의 활성 근거를 새 버전 append와 같은 트랜잭션에서 먼저 철회한다.
    -- 공유 근거/변경 관계를 섣불리 역산하지 않고 영향 항목을 보수적으로 archive한 뒤,
    -- 호출자가 프로젝트의 활성 최신 버전을 시간순으로 재처리해 current를 복원한다.
    perform 1
    from public.retract_minute_wiki_sources(
      p_minute_id,
      '회의록 본문 새 버전으로 이전 Wiki 근거를 철회했습니다.'
    );
  end if;

  select mv.body_hash
  into v_latest_hash
  from public.minute_versions mv
  where mv.minute_id = p_minute_id
  order by mv.version_no desc
  limit 1;

  select coalesce(max(mv.version_no), 0) + 1
  into v_next_version
  from public.minute_versions mv
  where mv.minute_id = p_minute_id;

  -- 버전이 있더라도 current body가 latest와 다르면 과거 직접 UPDATE/부분 실패 흔적이다.
  -- 새 본문을 쓰기 전에 현재 포인터의 파일 메타와 함께 별도 snapshot으로 먼저 보존한다.
  if v_latest_hash is null or v_latest_hash is distinct from v_current_hash then
    select mf.* into v_current_file
    from public.minute_files mf
    where mf.minute_id = p_minute_id and mf.role = 'body'
    order by mf.created_at desc, mf.id desc
    limit 1;

    insert into public.minute_versions (
      minute_id, version_no, body_md, body_hash,
      title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
      file_name, file_path, file_size, file_mime,
      created_by, created_by_name, created_at
    ) values (
      p_minute_id, v_next_version, v_original_minute.body_md, v_current_hash,
      v_original_minute.title, v_original_minute.minute_date, v_original_minute.team_code,
      v_original_minute.project_id, v_original_minute.meeting_id,
      v_original_minute.meeting_occurrence_date,
      v_current_file.file_name, v_current_file.file_path, v_current_file.size, v_current_file.mime,
      v_original_minute.created_by, v_original_minute.created_by_name,
      coalesce(v_snapshot_created_at, now())
    );
    v_next_version := v_next_version + 1;
  end if;

  insert into public.minute_versions as new_version (
    minute_id, version_no, body_md, body_hash,
    title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
    file_name, file_path, file_size, file_mime,
    created_by, created_by_name
  ) values (
    p_minute_id, v_next_version, p_body_md, p_body_hash,
    v_minute.title, v_minute.minute_date, v_minute.team_code,
    v_minute.project_id, v_minute.meeting_id, v_minute.meeting_occurrence_date,
    p_file_name, p_file_path, p_file_size, p_file_mime,
    p_actor_id, p_actor_name
  )
  returning new_version.id into version_id;

  -- minute_files.body는 current pointer다. 파일 없는 external replace도 이전 포인터를 명시적으로 뺀다.
  delete from public.minute_files
  where minute_id = p_minute_id and role = 'body';
  if v_has_file then
    insert into public.minute_files (
      minute_id, role, file_name, file_path, size, mime, uploaded_by
    ) values (
      p_minute_id, 'body', p_file_name, p_file_path, p_file_size, p_file_mime, p_actor_id
    );
  end if;

  update public.minutes
  set body_md = p_body_md, updated_at = clock_timestamp()
  where id = p_minute_id;

  version_no := v_next_version;
  body_hash := p_body_hash;
  return next;
end
$_$;


--
-- Name: complete_ai_index_job(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_ai_index_job(p_id bigint, p_generation bigint) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_applied boolean;
begin
  update public.ai_index_jobs
  set status = case when generation = p_generation then 'done' else 'pending' end,
      locked_at = null,
      updated_at = now()
  where id = p_id and status = 'running'
  returning (generation = p_generation) into v_applied;
  return coalesce(v_applied, false);
end;
$$;


--
-- Name: consume_project_invite(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_project_invite(p_token uuid, p_email text, p_user uuid) RETURNS TABLE(project_id uuid, team_id uuid, invite_email text, created_by uuid)
    LANGUAGE sql
    SET search_path TO 'public', 'extensions'
    AS $$
  update public.project_invites pi
     set redeemed_by = p_user, redeemed_at = now()
   where pi.token = p_token
     and pi.redeemed_at is null
     and pi.revoked_at is null
     and pi.expires_at > now()
     and pi.email = lower(btrim(p_email))
  returning pi.project_id, pi.team_id, pi.email, pi.created_by;
$$;


--
-- Name: create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, text, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_issue_from_minute_block(p_project_id uuid, p_title text, p_body text, p_severity text, p_assignee_member_ids uuid[], p_start_date date, p_due_date date, p_mega_code text, p_major_name text, p_sub_process text, p_owner_department text, p_related_systems text[], p_source_type text, p_source_detail text, p_actor_id uuid, p_created_by_name text, p_minute_id uuid, p_minute_version_id uuid, p_body_hash text, p_block_index integer, p_block_hash text, p_excerpt_snapshot text, p_source_kind text, p_source_key text) RETURNS TABLE(issue_id uuid, issue_no bigint, pi_issue_code text)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_issue_id uuid;
  v_issue_no bigint;
  v_pi_issue_code text;
  v_major_id uuid;
  v_major_name text;
  v_version_body_hash text;
  v_version_project_id uuid;
  v_current_project_id uuid;
  v_minute_archived_at timestamptz;
  v_minute_title text;
  v_minute_date date;
  v_minute_version_no integer;
  v_assignee_input_count integer;
  v_assignee_unique_count integer;
  v_valid_assignee_count integer;
  v_related_systems text[];
begin
  if p_project_id is null then
    raise exception 'ISSUE_PROJECT_REQUIRED' using errcode = '22023';
  end if;
  if p_actor_id is null then
    raise exception 'ISSUE_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ISSUE_TITLE_REQUIRED' using errcode = '22023';
  end if;
  if char_length(btrim(p_title)) > 200 then
    raise exception 'ISSUE_TITLE_TOO_LONG' using errcode = '22023';
  end if;
  if p_body is null then
    raise exception 'ISSUE_BODY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(p_body) > 20000 then
    raise exception 'ISSUE_BODY_TOO_LONG' using errcode = '22023';
  end if;
  if p_severity is null or p_severity not in ('high', 'medium', 'low') then
    raise exception 'ISSUE_SEVERITY_INVALID' using errcode = '22023';
  end if;
  if p_start_date is not null
     and p_due_date is not null
     and p_start_date > p_due_date then
    raise exception 'ISSUE_DATE_RANGE_INVALID' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.issue_mega_areas area
    where area.code = p_mega_code and area.active
  ) then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '22023';
  end if;
  if p_major_name is null
     or btrim(p_major_name) = ''
     or char_length(btrim(p_major_name)) > 100
     or btrim(p_major_name) ~ '^[[({（【]?[[:space:]]*[0-9]{2}(\.[0-9]{2})+' then
    raise exception 'ISSUE_MAJOR_NAME_INVALID' using errcode = '22023';
  end if;
  if p_sub_process is null
     or btrim(p_sub_process) = ''
     or char_length(btrim(p_sub_process)) > 200 then
    raise exception 'ISSUE_SUB_PROCESS_INVALID' using errcode = '22023';
  end if;
  if p_owner_department is null
     or btrim(p_owner_department) = ''
     or char_length(btrim(p_owner_department)) > 100 then
    raise exception 'ISSUE_OWNER_DEPARTMENT_INVALID' using errcode = '22023';
  end if;
  if p_related_systems is null
     or not public.issue_related_systems_valid(p_related_systems) then
    raise exception 'ISSUE_RELATED_SYSTEMS_INVALID' using errcode = '22023';
  end if;
  if p_source_type is distinct from 'minutes' then
    raise exception 'ISSUE_MINUTE_SOURCE_TYPE_REQUIRED' using errcode = '22023';
  end if;
  if p_source_detail is null or char_length(btrim(p_source_detail)) > 1000 then
    raise exception 'ISSUE_SOURCE_DETAIL_INVALID' using errcode = '22023';
  end if;

  select coalesce(array_agg(normalized.system_name order by normalized.first_ord), '{}'::text[])
    into v_related_systems
    from (
      select btrim(item.value) as system_name, min(item.ord) as first_ord
      from unnest(p_related_systems) with ordinality as item(value, ord)
      group by btrim(item.value)
    ) normalized;

  if p_assignee_member_ids is null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;
  v_assignee_input_count := cardinality(p_assignee_member_ids);
  if v_assignee_input_count > 20 then
    raise exception 'ISSUE_ASSIGNEES_TOO_MANY' using errcode = '22023';
  end if;
  if array_position(p_assignee_member_ids, null) is not null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;

  if p_minute_id is null or p_minute_version_id is null then
    raise exception 'MINUTE_VERSION_REQUIRED' using errcode = '22023';
  end if;
  if p_body_hash is null or btrim(p_body_hash) = '' then
    raise exception 'MINUTE_BODY_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_block_index is null or p_block_index < 0 then
    raise exception 'MINUTE_BLOCK_INDEX_INVALID' using errcode = '22023';
  end if;
  if p_block_hash is null or btrim(p_block_hash) = '' then
    raise exception 'MINUTE_BLOCK_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_excerpt_snapshot is null or btrim(p_excerpt_snapshot) = '' then
    raise exception 'MINUTE_BLOCK_EXCERPT_REQUIRED' using errcode = '22023';
  end if;
  if p_source_kind is null
     or p_source_kind not in ('manual', 'action', 'risk') then
    raise exception 'MINUTE_SOURCE_KIND_INVALID' using errcode = '22023';
  end if;
  if p_source_key is not null and btrim(p_source_key) = '' then
    raise exception 'MINUTE_SOURCE_KEY_INVALID' using errcode = '22023';
  end if;

  select minute.project_id, minute.archived_at
    into v_current_project_id, v_minute_archived_at
    from public.minutes minute
   where minute.id = p_minute_id
   for share;

  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute_archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  if v_current_project_id is not null
     and v_current_project_id <> p_project_id then
    raise exception 'MINUTE_PROJECT_MISMATCH' using errcode = '23514';
  end if;

  select
    mv.body_hash,
    mv.project_id,
    mv.title,
    mv.minute_date,
    mv.version_no
  into
    v_version_body_hash,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_minute_version_no
  from public.minute_versions mv
  where mv.id = p_minute_version_id
    and mv.minute_id = p_minute_id;

  if not found then
    raise exception 'MINUTE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_body_hash <> v_version_body_hash then
    raise exception 'MINUTE_BODY_STALE' using errcode = '22023';
  end if;

  select count(distinct member_id)
    into v_assignee_unique_count
    from unnest(p_assignee_member_ids) as assignee(member_id);

  select count(*)
    into v_valid_assignee_count
    from public.project_members pm
   where pm.project_id = p_project_id
     and pm.id in (
       select distinct member_id
       from unnest(p_assignee_member_ids) as assignee(member_id)
     );

  if v_valid_assignee_count <> v_assignee_unique_count then
    raise exception 'ISSUE_ASSIGNEE_PROJECT_MISMATCH' using errcode = '22023';
  end if;

  -- Major resolve-or-create — 같은 이름은 기존 체번 재사용, 새 이름은 트리거가
  -- advisory lock 아래 다음 번호를 발급한다. 경합으로 유니크 충돌이 나면 승자를 재조회.
  v_major_name := btrim(p_major_name);
  select mp.id
    into v_major_id
    from public.issue_major_processes mp
   where mp.project_id = p_project_id
     and mp.mega_code = p_mega_code
     and mp.name = v_major_name;
  if not found then
    begin
      insert into public.issue_major_processes (project_id, mega_code, name)
      values (p_project_id, p_mega_code, v_major_name)
      returning id into v_major_id;
    exception when unique_violation then
      select mp.id
        into v_major_id
        from public.issue_major_processes mp
       where mp.project_id = p_project_id
         and mp.mega_code = p_mega_code
         and mp.name = v_major_name;
      if not found then
        raise exception 'ISSUE_MAJOR_RESOLVE_FAILED' using errcode = '55000';
      end if;
    end;
  end if;

  insert into public.issues as created_issue (
    project_id,
    title,
    body,
    severity,
    start_date,
    due_date,
    mega_code,
    major_id,
    sub_process,
    owner_department,
    related_systems,
    source_type,
    source_detail,
    created_by,
    created_by_name
  ) values (
    p_project_id,
    btrim(p_title),
    p_body,
    p_severity,
    p_start_date,
    p_due_date,
    p_mega_code,
    v_major_id,
    btrim(p_sub_process),
    btrim(p_owner_department),
    v_related_systems,
    'minutes',
    btrim(p_source_detail),
    p_actor_id,
    nullif(btrim(p_created_by_name), '')
  )
  returning
    created_issue.id,
    created_issue.issue_no,
    created_issue.pi_issue_code
  into v_issue_id, v_issue_no, v_pi_issue_code;

  insert into public.issue_assignees (
    issue_id,
    member_id,
    project_id
  )
  select
    v_issue_id,
    assignee.member_id,
    p_project_id
  from (
    select distinct member_id
    from unnest(p_assignee_member_ids) as input(member_id)
  ) assignee;

  insert into public.issue_links (
    issue_id,
    project_id,
    link_type,
    minute_id,
    minute_version_id,
    minute_version_no,
    source_project_id,
    minute_title_snapshot,
    minute_date_snapshot,
    body_hash,
    block_index,
    block_hash,
    excerpt_snapshot,
    source_kind,
    source_key
  ) values (
    v_issue_id,
    p_project_id,
    'minute_block',
    p_minute_id,
    p_minute_version_id,
    v_minute_version_no,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_version_body_hash,
    p_block_index,
    p_block_hash,
    p_excerpt_snapshot,
    p_source_kind,
    p_source_key
  );

  issue_id := v_issue_id;
  issue_no := v_issue_no;
  pi_issue_code := v_pi_issue_code;
  return next;
end
$$;


--
-- Name: create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_minute_with_version(p_minute_id uuid, p_minute_date date, p_team_code text, p_title text, p_body_md text, p_body_hash text, p_meeting_id uuid, p_project_id uuid, p_meeting_occurrence_date date, p_folder_id uuid, p_external_id text, p_actor_id uuid, p_actor_name text, p_file_name text DEFAULT NULL::text, p_file_path text DEFAULT NULL::text, p_file_size bigint DEFAULT NULL::bigint, p_file_mime text DEFAULT NULL::text) RETURNS TABLE(minute_id uuid, version_id uuid, version_no integer, body_hash text, created_at timestamp with time zone, updated_at timestamp with time zone, wiki_rebuild_required boolean)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  v_minute_id uuid := coalesce(p_minute_id, gen_random_uuid());
  v_project_id uuid := p_project_id;
  v_occurrence_date date := p_meeting_occurrence_date;
  v_meeting_project_id uuid;
  v_created_at timestamptz;
  v_reset_required boolean := false;
  v_has_file boolean := num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) > 0;
  v_has_complete_file boolean :=
    num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) = 4;
begin
  if p_minute_date is null
     or nullif(btrim(p_team_code), '') is null
     or nullif(btrim(p_title), '') is null
     or char_length(btrim(p_title)) > 200
     or p_body_md is null
     or char_length(p_body_md) > 100000
     or p_body_hash is null
     or p_body_hash is distinct from public.wiki_fnv1a64(p_body_md) then
    raise exception 'MINUTE_CREATE_INPUT_INVALID' using errcode = '22023';
  end if;
  if p_external_id is not null
     and (p_external_id = '' or char_length(p_external_id) > 128) then
    raise exception 'MINUTE_EXTERNAL_ID_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.code = p_team_code and t.active
  ) then
    raise exception 'MINUTE_TEAM_INVALID' using errcode = '23503';
  end if;

  if v_has_file <> v_has_complete_file
     or (
       v_has_file and (
         nullif(btrim(p_file_name), '') is null
         or nullif(btrim(p_file_path), '') is null
         or p_file_size < 0
         or nullif(btrim(p_file_mime), '') is null
         or lower(p_file_name) !~ '\.(md|markdown)$'
         or p_file_path not like (v_minute_id::text || '/%')
         or strpos(p_file_path, '..') > 0
       )
     ) then
    raise exception 'MINUTE_FILE_INPUT_INVALID' using errcode = '22023';
  end if;

  if p_meeting_id is not null then
    select mt.project_id into v_meeting_project_id
    from public.meetings mt
    where mt.id = p_meeting_id;
    if not found then
      raise exception 'MEETING_NOT_FOUND' using errcode = '23503';
    end if;
    if v_project_id is null then
      v_project_id := v_meeting_project_id;
    elsif v_project_id <> v_meeting_project_id then
      raise exception 'MINUTE_MEETING_PROJECT_MISMATCH' using errcode = '23514';
    end if;
    v_occurrence_date := coalesce(v_occurrence_date, p_minute_date);
  else
    v_occurrence_date := null;
  end if;

  if v_project_id is not null then
    -- 같은 프로젝트의 동시 생성도 commit 순서와 시간축 판정을 일치시킨다.
    perform pg_advisory_xact_lock(
      pg_catalog.hashtextextended('wiki-project-chronology:' || v_project_id::text, 0)
    );
  end if;
  -- advisory lock을 얻은 뒤 시각을 고정해 같은 프로젝트 동시 생성의 observed_sort와
  -- commit 순서가 어긋나지 않게 한다.
  v_created_at := clock_timestamp();

  -- 프로젝트 회의록은 생성 순서와 after()/cron 실행 순서가 다를 수 있다. 개별 job을
  -- 즉시 적용하지 않고 durable project keyset queue로 보낸다. 기존 시간축 끝보다 앞에
  -- 삽입되는 경우만 full reset하고, 정상 forward append는 완료 cursor 뒤에 이어 붙인다.
  wiki_rebuild_required := v_project_id is not null;
  if v_project_id is not null then
    v_reset_required := exists (
      select 1
      from public.minutes existing
      where existing.project_id = v_project_id
        and existing.archived_at is null
        and (
          (
            coalesce(existing.meeting_occurrence_date, existing.minute_date)::timestamp
            + (existing.created_at at time zone 'UTC')::time
          ),
          existing.id
        ) > (
          (
            coalesce(v_occurrence_date, p_minute_date)::timestamp
            + (v_created_at at time zone 'UTC')::time
          ),
          v_minute_id
        )
    );
  end if;

  insert into public.minutes as new_minute (
    id, minute_date, team_code, title, body_md,
    meeting_id, project_id, meeting_occurrence_date, folder_id, external_id,
    created_by, created_by_name, created_at, updated_at
  ) values (
    v_minute_id, p_minute_date, p_team_code, btrim(p_title), p_body_md,
    p_meeting_id, v_project_id, v_occurrence_date, p_folder_id, p_external_id,
    p_actor_id, p_actor_name, v_created_at, v_created_at
  )
  returning new_minute.id, new_minute.created_at, new_minute.updated_at
  into minute_id, created_at, updated_at;

  insert into public.minute_versions as new_version (
    minute_id, version_no, body_md, body_hash,
    title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
    file_name, file_path, file_size, file_mime,
    created_by, created_by_name, created_at
  ) values (
    v_minute_id, 1, p_body_md, p_body_hash,
    btrim(p_title), p_minute_date, p_team_code, v_project_id, p_meeting_id, v_occurrence_date,
    p_file_name, p_file_path, p_file_size, p_file_mime,
    p_actor_id, p_actor_name, v_created_at
  )
  returning new_version.id into version_id;

  if v_has_file then
    insert into public.minute_files (
      minute_id, role, file_name, file_path, size, mime, uploaded_by
    ) values (
      v_minute_id, 'body', p_file_name, p_file_path, p_file_size, p_file_mime, p_actor_id
    );
  end if;

  if wiki_rebuild_required then
    if v_reset_required then
      perform public.request_wiki_project_rebuild(
        v_project_id,
        '과거 시점 회의록 추가 후 프로젝트 Wiki 전체 재구성'
      );
    else
      perform public.request_wiki_project_append(
        v_project_id,
        '새 회의록 프로젝트 Wiki 시간순 추가'
      );
    end if;
  end if;

  version_no := 1;
  body_hash := p_body_hash;
  return next;
end
$_$;


--
-- Name: create_wiki_document(uuid, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_wiki_document(p_project_id uuid, p_title text, p_body_md text, p_document_kind text, p_parent_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_topic_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := coalesce(p_body_md, '');
  v_normalized_title text;
  v_cursor uuid;
  v_parent uuid;
  v_depth integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not public.is_project_member(p_project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_title = '' or char_length(v_title) > 160 then
    raise exception 'WIKI_DOCUMENT_TITLE_INVALID' using errcode = '22023';
  end if;
  if p_document_kind is null or p_document_kind not in (
    'overview','decision','how_to','runbook','faq','glossary','reference'
  ) then
    raise exception 'WIKI_DOCUMENT_KIND_INVALID' using errcode = '22023';
  end if;
  if char_length(v_body) > 100000 then
    raise exception 'WIKI_DOCUMENT_BODY_TOO_LARGE' using errcode = '22023';
  end if;

  select coalesce(
    nullif(btrim(user_row.raw_user_meta_data ->> 'full_name'), ''),
    user_row.email
  ) into v_actor_name
  from auth.users user_row
  where user_row.id = v_actor;

  -- 같은 프로젝트의 트리 변경을 직렬화해 create/move 경합으로 깊이·순환 규칙이
  -- 검사 직후 뒤집히지 않게 한다. 트랜잭션 종료 시 자동 해제된다.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text, 79)
  );

  -- 새 문서도 이동 RPC와 같은 루트+2단 상한 및 "문서만 부모" 규칙을 적용한다.
  v_cursor := p_parent_id;
  while v_cursor is not null loop
    v_depth := v_depth + 1;
    if v_depth > 2 then
      raise exception 'WIKI_DOCUMENT_DEPTH_EXCEEDED' using errcode = '22023';
    end if;

    select parent.parent_id into v_parent
    from public.wiki_topics parent
    where parent.id = v_cursor
      and parent.project_id = p_project_id
      and nullif(btrim(coalesce(parent.body_md, '')), '') is not null;
    if not found then
      raise exception 'WIKI_DOCUMENT_PARENT_INVALID' using errcode = '23514';
    end if;
    v_cursor := v_parent;
  end loop;

  v_normalized_title := public.wiki_normalize_document_title(v_title);

  begin
    insert into public.wiki_topics (
      project_id, title, normalized_title, type, body_md,
      body_updated_at, body_updated_by, parent_id, origin, document_kind,
      last_changed_at, created_at, updated_at
    ) values (
      p_project_id,
      v_title,
      v_normalized_title,
      case p_document_kind
        when 'glossary' then 'glossary'
        when 'how_to' then 'process'
        when 'runbook' then 'process'
        when 'decision' then 'policy'
        else 'general'
      end,
      v_body,
      v_now,
      v_actor,
      p_parent_id,
      'manual',
      p_document_kind,
      v_now,
      v_now,
      v_now
    )
    returning id into v_topic_id;
  exception when unique_violation then
    raise exception 'WIKI_DOCUMENT_TITLE_TAKEN' using errcode = '23505';
  end;

  insert into public.wiki_topic_revisions (
    topic_id, project_id, version_no, title, body_md, body_hash,
    document_kind, edited_by, edited_by_name, created_at
  ) values (
    v_topic_id, p_project_id, 1, v_title, v_body,
    public.wiki_fnv1a64(v_body),
    p_document_kind, v_actor, v_actor_name, v_now
  );

  return v_topic_id;
end
$$;


--
-- Name: create_wiki_question(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_wiki_question(p_project_id uuid, p_topic_id uuid, p_question text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_question_id uuid;
  v_question text := btrim(coalesce(p_question, ''));
begin
  if v_actor is null or not public.is_project_member(p_project_id) then
    raise exception 'WIKI_QUESTION_FORBIDDEN' using errcode = '42501';
  end if;
  if v_question = '' or char_length(v_question) > 2000 then
    raise exception 'WIKI_QUESTION_INVALID' using errcode = '22023';
  end if;
  if p_topic_id is not null and not exists (
    select 1 from public.wiki_topics topic
    where topic.id = p_topic_id and topic.project_id = p_project_id
  ) then
    raise exception 'WIKI_QUESTION_TOPIC_MISMATCH' using errcode = '23514';
  end if;

  insert into public.wiki_questions (project_id, topic_id, question, asked_by)
  values (p_project_id, p_topic_id, v_question, v_actor)
  returning id into v_question_id;
  return v_question_id;
end
$$;


--
-- Name: curate_wiki_item(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.curate_wiki_item(p_item_id uuid, p_action text, p_reason text DEFAULT NULL::text) RETURNS TABLE(item_id uuid, lifecycle_state text, decision_state text, auto_update_locked boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_actor   uuid := auth.uid();
  v_item    public.wiki_items%rowtype;
  v_before  jsonb;
  v_after   jsonb;
  v_reason  text := left(coalesce(btrim(p_reason), ''), 500);
begin
  if v_actor is null then
    raise exception 'WIKI_CURATE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_action not in ('resolve','reopen','archive','restore','lock','unlock','confirm') then
    raise exception 'WIKI_CURATE_UNKNOWN_ACTION' using errcode = '22023';
  end if;

  select * into v_item from public.wiki_items where id = p_item_id for update;
  if not found then
    raise exception 'WIKI_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 권한 판정은 **대상 항목의 프로젝트** 기준이다(0053). 옛 검사(app_role() is not null)는
  -- 0052 shim 이후 '아무 프로젝트든 역할 보유'로 넓어져, 이 RPC 가 authenticated 에
  -- grant 돼 있는 탓에 멤버 누구나 PostgREST 로 남의 프로젝트 위키를 정리할 수 있었다.
  -- 위키는 RLS 쓰기 정책이 0개라 이 검사가 유일한 방어선이다(스펙 D11).
  if not public.is_project_admin(v_item.project_id) then
    raise exception 'WIKI_CURATE_FORBIDDEN' using errcode = '42501';
  end if;

  v_before := to_jsonb(v_item);

  if p_action = 'resolve' then
    if v_item.lifecycle_state not in ('active','open','conflicted') then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = 'resolved', updated_at = now()
      where id = p_item_id;

  elsif p_action = 'reopen' then
    if v_item.lifecycle_state not in ('resolved','archived') then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    if v_item.lifecycle_state = 'archived' and not public.wiki_item_has_live_source(p_item_id) then
      raise exception 'WIKI_CURATE_NO_LIVE_SOURCE' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = case
            when v_item.kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          updated_at = now()
      where id = p_item_id;

  elsif p_action = 'archive' then
    if v_item.lifecycle_state = 'archived' then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    -- 근거(wiki_item_sources)는 지우지 않는다. 숨긴 뒤에도 감사 추적이 남아야 한다.
    update public.wiki_items
      set lifecycle_state = 'archived', updated_at = now()
      where id = p_item_id;

  elsif p_action = 'restore' then
    if v_item.lifecycle_state <> 'archived' then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    -- archived는 사람의 '숨김'만이 아니라 시스템 철회(회의록 보관·프로젝트 이동으로 근거가
    -- 회수된 경우)로도 붙는다. 근거가 하나도 살아있지 않은 항목을 되살리면 원문으로 추적되지
    -- 않는 지식이 현재값이 된다 — Wiki의 근본 계약이 깨지므로 막는다.
    if not public.wiki_item_has_live_source(p_item_id) then
      raise exception 'WIKI_CURATE_NO_LIVE_SOURCE' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = case
            when v_item.kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          updated_at = now()
      where id = p_item_id;

  elsif p_action in ('lock','unlock') then
    update public.wiki_items
      set auto_update_locked = (p_action = 'lock'), updated_at = now()
      where id = p_item_id;

  elsif p_action = 'confirm' then
    -- 충돌·논의 중 항목을 사람이 현재 정본으로 확정한다. 이후 AI가 다시 덮지 못하도록
    -- 함께 고정한다(canAutoApplyWikiChange가 auto_update_locked에서 멈춘다).
    -- 이미 끝난 항목(대체·완료·숨김)에서는 확정할 수 없다. 그걸 허용하면 폐기된 문장이
    -- 현재값으로 되살아난 뒤 고정까지 돼 그 knowledge_key가 영구 동결된다.
    if v_item.lifecycle_state not in ('active','open','conflicted') then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = case
            when v_item.kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          certainty = 'explicit',
          decision_state = case
            when v_item.kind = 'decision' then 'confirmed' else v_item.decision_state
          end,
          auto_update_locked = true,
          updated_at = now()
      where id = p_item_id;
  end if;

  select to_jsonb(w) into v_after from public.wiki_items w where w.id = p_item_id;

  insert into public.wiki_change_events (
    project_id, wiki_item_id, change_type, before_snapshot, after_snapshot, reason, actor_id
  ) values (
    v_item.project_id,
    p_item_id,
    'curate',
    v_before,
    v_after,
    case when v_reason = '' then p_action else p_action || ': ' || v_reason end,
    v_actor
  );

  update public.wiki_topics
    set last_changed_at = now(), updated_at = now()
    where id = v_item.topic_id;

  return query
    select w.id, w.lifecycle_state, w.decision_state, w.auto_update_locked
    from public.wiki_items w where w.id = p_item_id;
end $$;


--
-- Name: current_team(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_team() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select team_id from memberships where user_id = auth.uid()
$$;


--
-- Name: enforce_project_member_email_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_project_member_email_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_canonical_name text;
begin
  -- 0019 normalize trigger가 이름순으로 먼저 실행되지만, 이 함수도 독립적으로
  -- 정규화해 trigger 이름/직접 호출에 계약이 흔들리지 않게 한다.
  new.name := pg_catalog.btrim(new.name);
  if new.name is null or new.name = '' then
    raise exception 'PROJECT_MEMBER_NAME_REQUIRED' using errcode = '23514';
  end if;

  if new.email is null then
    return new;
  end if;
  new.email := pg_catalog.lower(pg_catalog.btrim(new.email));
  if new.email = '' then
    new.email := null;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('project_member_identity:' || new.email, 0)
  );

  -- email PK의 INSERT/ON CONFLICT가 같은 이메일의 동시 최초 등록을 직렬화한다.
  -- SELECT 사전검사만으로는 두 트랜잭션이 서로를 못 보고 다른 이름을 넣을 수 있다.
  insert into public.project_member_identities (email, name)
  values (new.email, new.name)
  on conflict (email) do nothing;

  select identity.name
    into v_canonical_name
    from public.project_member_identities identity
   where identity.email = new.email;

  if v_canonical_name is distinct from new.name then
    -- 마지막 로스터가 삭제되거나 email이 바뀐 뒤 남은 orphan 정본은 다음 등록자가
    -- 재선점할 수 있다. 활성 로스터가 하나라도 있으면 다른 프로젝트를 덮지 않고 거부한다.
    if not exists (
      select 1
        from public.project_members pm
       where pm.email = new.email
    ) then
      update public.project_member_identities
         set name = new.name
       where email = new.email;
    else
      raise exception 'PROJECT_MEMBER_EMAIL_NAME_MISMATCH' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;


--
-- Name: fail_ai_index_job(bigint, bigint, integer, text, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_ai_index_job(p_id bigint, p_generation bigint, p_attempts integer, p_status text, p_run_after timestamp with time zone, p_last_error text) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_applied boolean;
begin
  if p_status not in ('pending', 'dead_letter') or p_attempts is null or p_attempts < 0 then
    raise exception 'AI_INDEX_JOB_FAILURE_INVALID' using errcode = '22023';
  end if;

  update public.ai_index_jobs
  set status = case when generation = p_generation then p_status else 'pending' end,
      attempts = case when generation = p_generation then p_attempts else attempts end,
      run_after = case when generation = p_generation then coalesce(p_run_after, now()) else now() end,
      locked_at = null,
      last_error = p_last_error,
      updated_at = now()
  where id = p_id and status = 'running'
  returning (generation = p_generation) into v_applied;
  return coalesce(v_applied, false);
end;
$$;


--
-- Name: finish_wiki_processing_job(bigint, text, boolean, jsonb, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_wiki_processing_job(p_job_id bigint, p_locked_by text, p_succeeded boolean, p_payload jsonb, p_last_error text, p_retry_at timestamp with time zone) RETURNS TABLE(job_id bigint, status text, apply_generation integer, rerun_requested boolean)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_job public.wiki_processing_jobs%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_now timestamptz := clock_timestamp();
  v_dead boolean;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'WIKI_JOB_FINISH_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  select job.* into v_job
  from public.wiki_processing_jobs job
  where job.id = p_job_id
    and job.status = 'running'
    and job.locked_by = p_locked_by
  for update;
  if not found then
    raise exception 'WIKI_JOB_LEASE_LOST' using errcode = '40001';
  end if;

  if v_job.rerun_requested then
    update public.wiki_processing_jobs job
    set status = 'pending',
        attempts = 0,
        run_after = v_now,
        locked_at = null,
        locked_by = null,
        last_error = null,
        rerun_requested = false,
        payload = (
          v_job.payload - 'summary' - 'skipped'
        ) || jsonb_build_object(
          'applyGeneration', v_job.apply_generation,
          'previousRun', v_payload
        ),
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;

  elsif coalesce(p_succeeded, false) then
    update public.wiki_processing_jobs job
    set status = 'done',
        locked_at = null,
        locked_by = null,
        last_error = null,
        rerun_requested = false,
        payload = (v_job.payload || v_payload)
          || jsonb_build_object('applyGeneration', v_job.apply_generation),
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;

  else
    v_dead := v_job.attempts >= v_job.max_attempts;
    update public.wiki_processing_jobs job
    set status = case when v_dead then 'dead_letter' else 'pending' end,
        run_after = case when v_dead then job.run_after else coalesce(p_retry_at, v_now) end,
        locked_at = null,
        locked_by = null,
        last_error = coalesce(nullif(btrim(p_last_error), ''), 'UNKNOWN'),
        rerun_requested = false,
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;
  end if;

  job_id := v_job.id;
  status := v_job.status;
  apply_generation := v_job.apply_generation;
  rerun_requested := v_job.rerun_requested;
  return next;
end
$$;


--
-- Name: finish_wiki_project_rebuild_step(uuid, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_last_error text, p_retry_at timestamp with time zone) RETURNS TABLE(rebuilt_project_id uuid, rebuild_status text, rebuild_generation bigint, cursor_advanced boolean)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_rebuild public.wiki_project_rebuild_jobs%rowtype;
  v_wiki_job public.wiki_processing_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_error text := coalesce(nullif(btrim(p_last_error), ''), 'MINUTE_JOB_NOT_DONE');
begin
  select rebuild.* into v_rebuild
  from public.wiki_project_rebuild_jobs rebuild
  where rebuild.project_id = p_project_id
    and rebuild.status = 'running'
    and rebuild.locked_by = p_locked_by
  for update;
  if not found then
    raise exception 'WIKI_PROJECT_REBUILD_LEASE_LOST' using errcode = '40001';
  end if;

  if v_rebuild.rerun_requested
     or v_rebuild.generation is distinct from v_rebuild.step_rebuild_generation then
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
    cursor_advanced := false;

  else
    select job.* into v_wiki_job
    from public.wiki_processing_jobs job
    where job.id = v_rebuild.step_wiki_job_id;

    if found
       and v_wiki_job.status = 'done'
       and v_wiki_job.apply_generation >= v_rebuild.step_wiki_apply_generation then
      update public.wiki_project_rebuild_jobs rebuild
      set status = 'pending',
          cursor_observed_sort = v_rebuild.step_observed_sort,
          cursor_minute_id = v_rebuild.step_minute_id,
          step_observed_sort = null,
          step_minute_id = null,
          step_minute_version_id = null,
          step_rebuild_generation = null,
          step_wiki_job_id = null,
          step_wiki_apply_generation = null,
          attempts = 0,
          run_after = v_now + interval '1 millisecond',
          locked_at = null,
          locked_by = null,
          last_error = null,
          updated_at = v_now
      where rebuild.project_id = v_rebuild.project_id
      returning rebuild.* into v_rebuild;
      cursor_advanced := true;

    elsif found and v_wiki_job.status in ('pending', 'running') then
      update public.wiki_project_rebuild_jobs rebuild
      set status = 'pending',
          step_wiki_apply_generation = greatest(
            rebuild.step_wiki_apply_generation,
            v_wiki_job.apply_generation
          ),
          run_after = coalesce(p_retry_at, v_now + interval '5 seconds'),
          locked_at = null,
          locked_by = null,
          last_error = v_error,
          updated_at = v_now
      where rebuild.project_id = v_rebuild.project_id
      returning rebuild.* into v_rebuild;
      cursor_advanced := false;

    else
      v_attempts := v_rebuild.attempts + 1;
      update public.wiki_project_rebuild_jobs rebuild
      set status = case
            when v_attempts >= rebuild.max_attempts then 'dead_letter'
            else 'pending'
          end,
          attempts = v_attempts,
          run_after = case
            when v_attempts >= rebuild.max_attempts then rebuild.run_after
            else coalesce(p_retry_at, v_now + interval '1 minute')
          end,
          locked_at = null,
          locked_by = null,
          last_error = v_error,
          updated_at = v_now
      where rebuild.project_id = v_rebuild.project_id
      returning rebuild.* into v_rebuild;
      cursor_advanced := false;
    end if;
  end if;

  rebuilt_project_id := v_rebuild.project_id;
  rebuild_status := v_rebuild.status;
  rebuild_generation := v_rebuild.generation;
  return next;
end
$$;


--
-- Name: guard_dependent_wbs_dates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_dependent_wbs_dates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.task_dependencies d
     where d.predecessor_id = new.id or d.successor_id = new.id
  ) then
    return new;
  end if;
  if new.planned_start is null or new.planned_end is null or new.planned_start > new.planned_end then
    raise exception '의존성이 연결된 작업의 계획일은 비우거나 역전할 수 없습니다' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from pg_catalog.generate_series(new.planned_start, new.planned_end, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.holidays h where h.project_id = new.project_id and h.date = d::date
       )
  ) then
    raise exception '의존성이 연결된 작업의 계획 기간에는 영업일이 있어야 합니다' using errcode = '23514';
  end if;
  return new;
end;
$$;


--
-- Name: guard_minute_ai_document_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_minute_ai_document_scope() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  v_minute_project_id uuid;
  v_archived_at timestamptz;
begin
  if new.domain <> 'minutes' or new.entity_type <> 'minute' then
    return new;
  end if;
  if new.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'AI_MINUTE_DOCUMENT_ENTITY_INVALID' using errcode = '22023';
  end if;

  select minute.project_id, minute.archived_at
  into v_minute_project_id, v_archived_at
  from public.minutes minute
  where minute.id = new.entity_id::uuid
  -- UPDATE/UPSERT가 ai_documents row를 먼저 잠근 상태에서 metadata/archive가 반대로
  -- minute→document를 잠글 수 있으므로 기다리지 않고 worker 재시도로 넘긴다.
  for share nowait;
  if not found
     or v_archived_at is not null
     or v_minute_project_id is distinct from new.project_id then
    raise exception 'AI_MINUTE_DOCUMENT_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  return new;
end
$_$;


--
-- Name: guard_non_admin_column_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_non_admin_column_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- 서버·임포트 경로(service_role: auth.uid() is null)는 그대로 통과
  if auth.uid() is null then return new; end if;
  -- 판정 기준은 **old.project_id** 다. new 로 보면 "A 의 멤버이자 B 의 관리자"가
  -- project_id 를 B 로 바꾸는 UPDATE 한 번으로 컬럼 제한을 통째로 건너뛰고
  -- 이름·일정·가중치까지 재작성할 수 있다(B 관리자로 판정되므로).
  -- old 기준이면 project_id 변경 자체가 아래 diff 검사에 걸려 막힌다.
  if public.is_project_admin(old.project_id) then return new; end if;

  -- 그 외 전원(멤버·조회 전용·미상): 실적%·산출물만 허용
  if (to_jsonb(new) - 'actual_pct' - 'deliverable' - 'updated_at')
     is distinct from (to_jsonb(old) - 'actual_pct' - 'deliverable' - 'updated_at') then
    raise exception '실적%%·산출물만 수정할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: import_wbs(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.import_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  v_item jsonb;
  v_owner jsonb;
  v_hol jsonb;
  v_id uuid;
  v_parent uuid;
  v_team uuid;
  v_map jsonb := '{}'::jsonb;   -- tempId -> 생성된 uuid(text)
  v_count integer := 0;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
  loop
    v_parent := null;
    if nullif(v_item->>'parentTempId', '') is not null then
      v_parent := nullif(v_map->>(v_item->>'parentTempId'), '')::uuid;
    end if;

    insert into wbs_items (
      project_id, parent_id, level, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'level', v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from teams
       where code = v_owner->>'team' and (project_id = p_project_id or project_id is null)
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$$;


--
-- Name: import_wbs_upsert(uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.import_wbs_upsert(p_project_id uuid, p_nodes jsonb, p_attach_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare
  v_node jsonb;
  v_ref text;
  v_parent_ref text;
  v_parent_id uuid;
  v_existing uuid;
  v_upserted int := 0;
  v_skipped int := 0;
  v_ids jsonb := '{}'::jsonb;  -- external_ref → wbs_items.id
  v_new jsonb := '[]'::jsonb;  -- 신규 삽입된 external_ref 목록(호출부의 배정·발행 대상)
  v_id uuid;
  v_start date;
  v_end date;
begin
  for v_node in select * from jsonb_array_elements(p_nodes) loop
    v_ref := v_node->>'external_ref';
    if v_ref is null or v_ref = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_parent_ref := nullif(v_node->>'parent_external_ref', '');
    v_parent_id := null;
    if v_parent_ref is not null then
      -- 같은 배치 앞 원소 우선, 없으면 기존 행에서 해석. 둘 다 없으면 루트로 들어가지 않고 skip.
      if v_ids ? v_parent_ref then
        v_parent_id := (v_ids->>v_parent_ref)::uuid;
      else
        select id into v_parent_id from public.wbs_items
          where project_id = p_project_id and external_ref = v_parent_ref;
        if v_parent_id is null then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;
    else
      -- v2.2: parent 없는 노드는 attach 노드 아래로 — PL 파일 최상위(SUB-*)가 골격 SYS-* 의
      -- 자식이 된다. p_attach_id 가 null(골격·레거시 업로드)이면 종전대로 루트.
      v_parent_id := p_attach_id;
    end if;
    v_start := nullif(v_node->>'planned_start', '')::date;
    v_end := nullif(v_node->>'planned_end', '')::date;

    select id into v_existing from public.wbs_items
      where project_id = p_project_id and external_ref = v_ref;

    insert into public.wbs_items
      (project_id, parent_id, code, sort_order, name, biz, deliverable,
       planned_start, planned_end, stage, external_ref,
       category, domain, priority, model, tags, depends,
       prd_ref, entry_point, acceptance, spec, dev_workflow,
       weight, level_idx, milestone, credit_key, if_id)
    values
      (p_project_id, v_parent_id, coalesce(nullif(v_node->>'code',''), v_ref),
       coalesce((v_node->>'sort_order')::int, 0), v_node->>'title',
       nullif(v_node->>'biz',''), nullif(v_node->>'deliverable',''),
       v_start, v_end,
       case when v_node->>'stage' in ('', 'todo') then null when v_node->>'stage' = 'fp' then 'ip' else v_node->>'stage' end,
       v_ref,
       nullif(v_node->>'category',''), nullif(v_node->>'domain',''),
       nullif(v_node->>'priority',''), nullif(v_node->>'model',''),
       array(select jsonb_array_elements_text(coalesce(v_node->'tags', '[]'::jsonb))),
       array(select jsonb_array_elements_text(coalesce(v_node->'depends', '[]'::jsonb))),
       nullif(v_node->>'prd_ref',''), nullif(v_node->>'entry_point',''),
       coalesce(v_node->'acceptance', '[]'::jsonb), nullif(v_node->>'spec',''),
       coalesce((v_node->>'dev_workflow')::boolean, false),
       nullif(v_node->>'weight','')::numeric,
       nullif(v_node->>'level_idx','')::smallint,
       coalesce((v_node->>'milestone')::boolean, false),
       nullif(v_node->>'credit_key',''), nullif(v_node->>'if_id',''))
    on conflict (project_id, external_ref) where external_ref is not null
    do update set
      parent_id = excluded.parent_id,
      code = excluded.code,
      sort_order = excluded.sort_order,
      name = excluded.name,
      biz = excluded.biz,
      deliverable = excluded.deliverable,
      planned_start = excluded.planned_start,
      planned_end = excluded.planned_end,
      -- 결정 B/E — 파일 소유 명세 필드는 재업로드가 갱신한다(⑫: stage·assignee·actual_pct 만 웹 보존).
      category = excluded.category,
      domain = excluded.domain,
      priority = excluded.priority,
      model = excluded.model,
      tags = excluded.tags,
      depends = excluded.depends,
      prd_ref = excluded.prd_ref,
      entry_point = excluded.entry_point,
      acceptance = excluded.acceptance,
      spec = excluded.spec,
      dev_workflow = excluded.dev_workflow,
      weight = excluded.weight,
      level_idx = excluded.level_idx,
      milestone = excluded.milestone,
      credit_key = excluded.credit_key,
      if_id = excluded.if_id,
      updated_at = now()
    returning id into v_id;

    v_ids := jsonb_set(v_ids, array[v_ref], to_jsonb(v_id::text));
    if v_existing is null then
      v_new := v_new || to_jsonb(v_ref);
    end if;
    v_upserted := v_upserted + 1;
  end loop;

  return jsonb_build_object(
    'upserted', v_upserted, 'skipped', v_skipped, 'ids', v_ids, 'new_refs', v_new);
end;
$$;


--
-- Name: is_project_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_project_admin(pid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.is_superuser()
      or exists (select 1 from public.project_roles r
                  where r.project_id = pid and r.user_id = auth.uid() and r.role = 'admin')
$$;


--
-- Name: is_project_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_project_member(pid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.is_project_admin(pid)
      or exists (select 1 from public.project_roles r
                  where r.project_id = pid and r.user_id = auth.uid())
$$;


--
-- Name: is_superuser(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_superuser() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((select m.is_superuser from public.memberships m
                    where m.user_id = auth.uid()), false)
$$;


--
-- Name: issue_related_systems_valid(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issue_related_systems_valid(systems text[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select systems is not null
     and cardinality(systems) <= 20
     and not exists (
       select 1
       from unnest(systems) as entry(value)
       where entry.value is null
          or btrim(entry.value) = ''
          or char_length(btrim(entry.value)) > 100
     )
$$;


--
-- Name: lead_lease_acquire(uuid, uuid[], text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lead_lease_acquire(p_user uuid, p_projects uuid[], p_holder text, p_host text, p_agent text, p_takeover boolean) RETURNS TABLE(project_id uuid, ok boolean, generation bigint, host text, agent text, expires_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
begin
  insert into public.agent_lead_leases (user_id, project_id)
    select p_user, x from unnest(p_projects) as x order by x
    on conflict do nothing;
  perform 1 from public.agent_lead_leases l
    where l.user_id = p_user and l.project_id = any(p_projects)
    order by l.project_id
    for update;
  if not p_takeover and exists (
    select 1 from public.agent_lead_leases l
    where l.user_id = p_user and l.project_id = any(p_projects)
      and l.holder is not null and l.holder <> p_holder and l.expires_at >= now()
  ) then
    return query
      select l.project_id, false, l.generation, l.host, l.agent, l.expires_at
      from public.agent_lead_leases l
      where l.user_id = p_user and l.project_id = any(p_projects)
        and l.holder is not null and l.holder <> p_holder and l.expires_at >= now()
      order by l.project_id;
    return;
  end if;
  return query
    update public.agent_lead_leases l
       set holder = p_holder, host = p_host, agent = p_agent,
           generation = l.generation + 1,
           acquired_at = now(), renewed_at = now(), expires_at = now() + public.lead_lease_ttl()
     where l.user_id = p_user and l.project_id = any(p_projects)
    returning l.project_id, true, l.generation, l.host, l.agent, l.expires_at;
end $$;


--
-- Name: lead_lease_force_release(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lead_lease_force_release(p_user uuid, p_project uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare n integer;
begin
  update public.agent_lead_leases l
     set holder = null, expires_at = now(), generation = l.generation + 1
   where l.user_id = p_user and l.project_id = p_project
     and l.holder is not null and l.expires_at >= now();
  get diagnostics n = row_count;
  return n;
end $$;


--
-- Name: lead_lease_release(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lead_lease_release(p_user uuid, p_holder text, p_leases jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare n integer;
begin
  with want as (
    select (e->>'project_id')::uuid as pid, (e->>'generation')::bigint as gen
    from jsonb_array_elements(p_leases) as e
  )
  update public.agent_lead_leases l
     set holder = null, expires_at = now(), generation = l.generation + 1
    from want w
   where l.user_id = p_user and l.project_id = w.pid
     and l.holder = p_holder and l.generation = w.gen;
  get diagnostics n = row_count;
  return n;
end $$;


--
-- Name: lead_lease_renew(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lead_lease_renew(p_user uuid, p_holder text, p_leases jsonb) RETURNS TABLE(project_id uuid, ok boolean, expires_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
begin
  return query
    with want as (
      select (e->>'project_id')::uuid as pid, (e->>'generation')::bigint as gen
      from jsonb_array_elements(p_leases) as e
    ), upd as (
      update public.agent_lead_leases l
         set renewed_at = now(), expires_at = now() + public.lead_lease_ttl()
        from want w
       where l.user_id = p_user and l.project_id = w.pid
         and l.holder = p_holder and l.generation = w.gen
      returning l.project_id, l.expires_at
    )
    select w.pid, (u.project_id is not null), u.expires_at
    from want w left join upd u on u.project_id = w.pid
    order by w.pid;
end $$;


--
-- Name: lead_lease_ttl(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lead_lease_ttl() RETURNS interval
    LANGUAGE sql IMMUTABLE
    AS $$ select interval '180 seconds' $$;


--
-- Name: match_ai_documents(public.vector, integer, uuid[], boolean, text[], text[], text, date, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_ai_documents(query_embedding public.vector, match_count integer DEFAULT 20, p_project_ids uuid[] DEFAULT NULL::uuid[], p_include_global boolean DEFAULT false, p_domains text[] DEFAULT NULL::text[], p_entity_types text[] DEFAULT NULL::text[], p_team text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_index_version integer DEFAULT 1) RETURNS TABLE(id uuid, project_id uuid, domain text, entity_type text, entity_id text, chunk_no integer, index_version integer, title text, content text, content_hash text, href text, team text, occurred_on date, source_updated_at timestamp with time zone, embedding_model text, embedding_dimensions integer, chunker_version text, indexed_at timestamp with time zone, similarity double precision)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  select
    d.id, d.project_id, d.domain, d.entity_type, d.entity_id, d.chunk_no,
    d.index_version, d.title, d.content, d.content_hash, d.href, d.team,
    d.occurred_on, d.source_updated_at, d.embedding_model, d.embedding_dimensions,
    d.chunker_version, d.indexed_at,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.ai_documents d
  where d.embedding is not null
    and d.index_version = p_index_version
    -- NULL/empty project scopes never mean "all projects". Global rows require
    -- their own explicit flag and remain independent of the project list.
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
  -- Explicit NULL from an RPC caller must not turn into PostgreSQL's
  -- unbounded `LIMIT NULL`; keep every retrieval bounded server-side.
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;


--
-- Name: match_ai_documents_lexical(text[], integer, uuid[], boolean, text[], text[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_ai_documents_lexical(p_tokens text[], match_count integer DEFAULT 20, p_project_ids uuid[] DEFAULT NULL::uuid[], p_include_global boolean DEFAULT false, p_domains text[] DEFAULT NULL::text[], p_entity_types text[] DEFAULT NULL::text[], p_index_version integer DEFAULT 1) RETURNS TABLE(id uuid, project_id uuid, domain text, entity_type text, entity_id text, chunk_no integer, index_version integer, title text, content text, content_hash text, href text, team text, occurred_on date, source_updated_at timestamp with time zone, embedding_model text, embedding_dimensions integer, chunker_version text, indexed_at timestamp with time zone, similarity double precision)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
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
      -- 매칭된 토큰마다 점수를 누적한다 — 다중 토큰 매칭이 단일 토큰 동점에 밀리지 않도록.
      sum(greatest(
        word_similarity(t, d.title),
        word_similarity(t, d.content)
      )) over (partition by d.id) as similarity
    from unnest(coalesce(p_tokens[1:8], array[]::text[])) as t
    join public.ai_documents d
      on (
        -- NULL/빈 스코프는 절대 "전 프로젝트" 를 뜻하지 않는다(0083 과 동일 계약).
        (
          (p_project_ids is not null and d.project_id = any(p_project_ids))
          or (p_include_global and d.project_id is null)
        )
        and d.index_version = p_index_version
        and (p_domains is null or d.domain = any(p_domains))
        and (p_entity_types is null or d.entity_type = any(p_entity_types))
        -- <%  는 gin_trgm_ops 인덱스를 탄다(각 토큰이 제목 또는 본문의 단어를 포함).
        and (t <% d.title or t <% d.content)
      )
    where array_length(p_tokens, 1) > 0
    order by d.id, similarity desc
  ) s
  order by s.similarity desc, s.occurred_on desc nulls last, s.entity_id, s.chunk_no
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;


--
-- Name: match_minute_documents(public.vector, integer, text, date, date, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_minute_documents(query_embedding public.vector, match_count integer DEFAULT 8, p_team text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_folder_ids uuid[] DEFAULT NULL::uuid[]) RETURNS TABLE(minute_id uuid, chunk_index integer, content text, minute_date date, team_code text, title text, similarity double precision)
    LANGUAGE sql STABLE
    AS $$
  select
    e.minute_id, e.chunk_index, e.content,
    m.minute_date, m.team_code, m.title,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.minute_embeddings e
  join public.minutes m on m.id = e.minute_id
  where (p_team is null or m.team_code = p_team)
    and (p_date_from is null or m.minute_date >= p_date_from)
    and (p_date_to   is null or m.minute_date <= p_date_to)
    and (p_folder_ids is null or m.folder_id = any(p_folder_ids))
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;


--
-- Name: match_wbs_documents(public.vector, integer, uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_wbs_documents(query_embedding public.vector, match_count integer DEFAULT 8, p_project_id uuid DEFAULT NULL::uuid, p_kinds text[] DEFAULT NULL::text[]) RETURNS TABLE(id uuid, project_id uuid, kind text, ref_id uuid, content text, similarity double precision)
    LANGUAGE sql STABLE
    AS $$
  select
    e.id, e.project_id, e.kind, e.ref_id, e.content,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.wbs_embeddings e
  where e.embedding is not null
    and (p_project_id is null or e.project_id = p_project_id)
    and (p_kinds is null or e.kind = any (p_kinds))
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;


--
-- Name: merge_wiki_topics(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_wiki_topics(p_source_topic_id uuid, p_target_topic_id uuid) RETURNS TABLE(moved_items integer, conflicted_items integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_source public.wiki_topics%rowtype;
  v_target public.wiki_topics%rowtype;
  v_slug text;
  v_moved integer := 0;
  v_conflicted integer := 0;
  v_moved_questions integer := 0;
  v_moved_feedback integer := 0;
  v_moved_children integer := 0;
begin
  if v_actor is null then
    raise exception 'WIKI_MERGE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_source_topic_id = p_target_topic_id then
    raise exception 'WIKI_MERGE_SAME_TOPIC' using errcode = '22023';
  end if;

  perform 1 from public.wiki_topics topic
  where topic.id in (p_source_topic_id, p_target_topic_id)
  order by topic.id
  for update;

  select topic.* into v_source
  from public.wiki_topics topic where topic.id = p_source_topic_id;
  if not found then raise exception 'WIKI_TOPIC_NOT_FOUND' using errcode = 'P0002'; end if;
  select topic.* into v_target
  from public.wiki_topics topic where topic.id = p_target_topic_id;
  if not found then raise exception 'WIKI_TOPIC_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.is_project_admin(v_source.project_id) then
    raise exception 'WIKI_MERGE_FORBIDDEN' using errcode = '42501';
  end if;
  if v_source.project_id <> v_target.project_id then
    raise exception 'WIKI_MERGE_CROSS_PROJECT' using errcode = '22023';
  end if;
  if v_source.origin = 'manual'
     or v_target.origin = 'manual'
     or exists (
       select 1 from public.wiki_topic_revisions revision
       where revision.topic_id in (p_source_topic_id, p_target_topic_id)
     ) then
    raise exception 'WIKI_MERGE_DOCUMENT_FORBIDDEN' using errcode = '22023';
  end if;

  v_slug := public.wiki_key_slug(v_target.normalized_title);

  with moved as (
    update public.wiki_items item
    set topic_id = p_target_topic_id,
        knowledge_key = left(
          v_slug || ':' || split_part(item.knowledge_key, ':', 2) || ':'
            || nullif(regexp_replace(item.knowledge_key, '^[^:]*:[^:]*:', ''), ''),
          160
        )
    where item.topic_id = p_source_topic_id
    returning item.id
  )
  select count(*) into v_moved from moved;

  with ranked as (
    select item.id,
           row_number() over (
             partition by item.kind, item.knowledge_key
             order by
               (item.auto_update_locked or item.origin = 'manual') desc,
               coalesce(item.valid_from, item.observed_at, item.updated_at) desc,
               item.updated_at desc,
               item.id desc
           ) as rn
    from public.wiki_items item
    where item.topic_id = p_target_topic_id
      and item.lifecycle_state in ('active','open')
  ), demoted as (
    update public.wiki_items item
    set lifecycle_state = 'conflicted', updated_at = now()
    from ranked
    where item.id = ranked.id
      and ranked.rn > 1
      and not (item.auto_update_locked or item.origin = 'manual')
    returning item.id, item.project_id, to_jsonb(item) as after_row
  ), logged as (
    insert into public.wiki_change_events (
      project_id, wiki_item_id, change_type, after_snapshot, reason, actor_id
    )
    select demoted.project_id, demoted.id, 'curate', demoted.after_row,
           format('merge_topic_demote: %s → %s', v_source.title, v_target.title), v_actor
    from demoted
    returning 1
  )
  select count(*) into v_conflicted from logged;

  update public.wiki_topics topic
  set aliases = (
        select array_agg(distinct alias)
        from unnest(v_target.aliases || v_source.aliases || array[v_source.normalized_title]) alias
      ),
      last_changed_at = now(),
      updated_at = now()
  where topic.id = p_target_topic_id;

  -- source 를 지우기 전에 딸린 것들을 target 으로 옮긴다. 옮기지 않으면 FK 부수효과가
  -- 조용히 파괴한다 — 피드백은 on delete cascade 로 흔적 없이 사라지고, 질문은
  -- topic_id = null 이 되어 어느 문서에 대한 질문이었는지 복구할 수 없으며, 하위 문서는
  -- parent_id = null 로 루트에 튀어나와 트리가 말없이 재배치된다. 아래 change event 는
  -- 주제 행만 남기므로 무엇이 있었는지 알 방법도 없다. 중복 AI 주제 정리라는 일상 작업
  -- 한 번에 이 셋이 동시에 일어난다.
  update public.wiki_questions question
  set topic_id = p_target_topic_id, updated_at = now()
  where question.topic_id = p_source_topic_id
    and question.project_id = v_source.project_id;
  get diagnostics v_moved_questions = row_count;

  -- (topic_id, user_id, feedback_type) 유니크와 충돌하면 target 에 이미 같은 사람의 같은
  -- 신호가 있다는 뜻이므로 그대로 두고 source 쪽만 사라지게 둔다.
  update public.wiki_feedback feedback
  set topic_id = p_target_topic_id, updated_at = now()
  where feedback.topic_id = p_source_topic_id
    and feedback.project_id = v_source.project_id
    and not exists (
      select 1 from public.wiki_feedback existing
      where existing.topic_id = p_target_topic_id
        and existing.user_id = feedback.user_id
        and existing.feedback_type = feedback.feedback_type
    );
  get diagnostics v_moved_feedback = row_count;

  update public.wiki_topics topic
  set parent_id = p_target_topic_id, updated_at = now()
  where topic.parent_id = p_source_topic_id
    and topic.project_id = v_source.project_id;
  get diagnostics v_moved_children = row_count;

  insert into public.wiki_change_events (
    project_id, change_type, before_snapshot, after_snapshot, reason, actor_id
  ) values (
    v_target.project_id, 'curate', to_jsonb(v_source), to_jsonb(v_target),
    format(
      'merge_topic: %s → %s (항목 %s건, 질문 %s건, 피드백 %s건, 하위문서 %s건)',
      v_source.title, v_target.title, v_moved,
      v_moved_questions, v_moved_feedback, v_moved_children
    ),
    v_actor
  );

  delete from public.wiki_topics topic where topic.id = p_source_topic_id;
  return query select v_moved, v_conflicted;
end
$$;


--
-- Name: minute_versions_reject_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.minute_versions_reject_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  -- auth.users 삭제의 기존 SET NULL 계약은 계정 정리를 막지 않도록 유일한 예외로 둔다.
  if tg_op = 'UPDATE'
     and old.created_by is not null
     and new.created_by is null
     and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;
  raise exception 'MINUTE_VERSION_IMMUTABLE' using errcode = '55000';
end
$$;


--
-- Name: minutes_protect_external_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.minutes_protect_external_id() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '');
begin
  if jwt_role in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.external_id is not null then
      raise exception 'external_id는 외부 연동 API로만 설정할 수 있습니다.';
    end if;
    if tg_op = 'UPDATE' and new.external_id is distinct from old.external_id then
      raise exception 'external_id는 외부 연동 API로만 변경할 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: move_wiki_document(uuid, uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_wiki_document(p_topic_id uuid, p_parent_id uuid, p_sort integer DEFAULT 0, p_pinned_order integer DEFAULT NULL::integer) RETURNS TABLE(topic_id uuid, parent_id uuid, sort integer, pinned_order integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_topic public.wiki_topics%rowtype;
  v_cursor uuid;
  v_parent uuid;
  v_depth integer := 0;
  v_descendant_depth integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;

  select topic.* into v_topic
  from public.wiki_topics topic
  where topic.id = p_topic_id
  for update;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if p_sort is null or p_sort < 0 or (p_pinned_order is not null and p_pinned_order < 0) then
    raise exception 'WIKI_DOCUMENT_POSITION_INVALID' using errcode = '22023';
  end if;
  if p_parent_id = p_topic_id then
    raise exception 'WIKI_DOCUMENT_PARENT_INVALID' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_topic.project_id::text, 79)
  );

  -- 부모 체인을 직접 확인해 타 프로젝트 결합, 순환, 3단 초과를 한 번에 차단한다.
  v_cursor := p_parent_id;
  while v_cursor is not null loop
    v_depth := v_depth + 1;
    if v_depth > 2 then
      raise exception 'WIKI_DOCUMENT_DEPTH_EXCEEDED' using errcode = '22023';
    end if;

    select topic.parent_id into v_parent
    from public.wiki_topics topic
    where topic.id = v_cursor
      and topic.project_id = v_topic.project_id
      and nullif(btrim(coalesce(topic.body_md, '')), '') is not null;
    if not found then
      raise exception 'WIKI_DOCUMENT_PARENT_INVALID' using errcode = '23514';
    end if;
    if v_parent = p_topic_id then
      raise exception 'WIKI_DOCUMENT_PARENT_INVALID' using errcode = '23514';
    end if;
    v_cursor := v_parent;
  end loop;

  -- 이동 대상의 하위 트리 높이까지 합쳐 루트+2단(간선 깊이 2)을 넘지 않게 한다.
  with recursive descendants as (
    select topic.id, 0 as depth, array[topic.id] as path
    from public.wiki_topics topic
    where topic.id = p_topic_id and topic.project_id = v_topic.project_id
    union all
    select child.id, descendants.depth + 1, descendants.path || child.id
    from public.wiki_topics child
    join descendants on child.parent_id = descendants.id
    where child.project_id = v_topic.project_id
      and not (child.id = any(descendants.path))
      and descendants.depth < 100
  )
  select coalesce(max(descendants.depth), 0) into v_descendant_depth
  from descendants;

  if v_depth + v_descendant_depth > 2 then
    raise exception 'WIKI_DOCUMENT_DEPTH_EXCEEDED' using errcode = '22023';
  end if;

  update public.wiki_topics topic
  set parent_id = p_parent_id,
      sort = p_sort,
      pinned_order = p_pinned_order,
      last_changed_at = v_now,
      updated_at = v_now
  where topic.id = p_topic_id;

  return query select p_topic_id, p_parent_id, p_sort, p_pinned_order;
end
$$;


--
-- Name: notify_recipient_broadcast(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_recipient_broadcast() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.user_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('recipient_id', new.id, 'event_id', new.event_id),
        'new_notification',
        'user-' || new.user_id::text || '-notifications',
        true  -- private 채널
      );
    exception when others then
      null;  -- 송신 실패는 삼킨다 — 본 INSERT 를 지키는 것이 우선
    end;
  end if;
  return new;
end;
$$;


--
-- Name: project_members_normalize_link(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.project_members_normalize_link() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.email is not null then
    new.email := lower(trim(new.email));
    if new.email = '' then new.email := null; end if;
  end if;

  -- 이메일이 바뀌면 기존 링크를 재해석한다. 그러지 않으면 퇴사자 계정이 후임자의
  -- 멤버 행에 남아 남의 '내 회의'를 보게 된다.
  -- 단, 호출자가 user_id 를 명시적으로 함께 지정했다면 그 의도를 존중한다.
  if tg_op = 'UPDATE'
     and new.email is distinct from old.email
     and new.user_id is not distinct from old.user_id then
    new.user_id := null;
  end if;

  if new.user_id is null and new.email is not null then
    select u.id into new.user_id
      from auth.users u
     where lower(u.email) = new.email and u.deleted_at is null
     order by u.created_at
     limit 1;
  end if;
  return new;
end;
$$;


--
-- Name: purge_read_notifications(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_read_notifications(retention_days integer DEFAULT 90) RETURNS TABLE(recipients_deleted bigint, events_deleted bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: queue_minute_ai_index_scope_change(uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_minute_ai_index_scope_change(p_project_id uuid, p_minute_id uuid, p_operation text, p_run_after timestamp with time zone DEFAULT now()) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_job_id bigint;
  v_job_key text :=
    'v1:' || coalesce(p_project_id::text, 'global')
      || ':minutes:minute:' || p_minute_id::text;
begin
  if p_minute_id is null or p_operation not in ('upsert', 'delete') then
    raise exception 'MINUTE_INDEX_SCOPE_CHANGE_INVALID' using errcode = '22023';
  end if;

  insert into public.ai_index_jobs as job (
    job_key, operation, project_id, domain, entity_type, entity_id,
    payload, status, attempts, run_after, locked_at, last_error, generation, updated_at
  ) values (
    v_job_key, p_operation, p_project_id, 'minutes', 'minute', p_minute_id::text,
    '{}'::jsonb, 'pending', 0, coalesce(p_run_after, now()), null, null, 0, now()
  )
  on conflict (job_key) do update set
    operation = excluded.operation,
    project_id = excluded.project_id,
    domain = excluded.domain,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    payload = excluded.payload,
    status = case when job.status = 'running' then 'running' else 'pending' end,
    attempts = case when job.status = 'running' then job.attempts else 0 end,
    run_after = case
      when job.status = 'running' then job.run_after
      else excluded.run_after
    end,
    locked_at = case when job.status = 'running' then job.locked_at else null end,
    last_error = null,
    generation = job.generation + 1,
    updated_at = now()
  returning job.id into v_job_id;

  return v_job_id;
end
$$;


--
-- Name: replace_ai_document_chunks(uuid, text, text, text, integer, timestamp with time zone, timestamp with time zone, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_ai_document_chunks(p_project_id uuid, p_domain text, p_entity_type text, p_entity_id text, p_index_version integer, p_source_updated_at timestamp with time zone, p_indexed_at timestamp with time zone, p_documents jsonb) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
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
    -- 클로버 방지: 새 임베딩이 null 인데 본문이 그대로면(content_hash 동일) 기존 값을 지키고,
    -- 본문이 달라졌으면(content_hash 변경) 옛 임베딩을 새 본문에 붙이지 않도록 null 로 둔다.
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


--
-- Name: replace_wbs(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  v_item jsonb;
  v_owner jsonb;
  v_hol jsonb;
  v_id uuid;
  v_parent uuid;
  v_team uuid;
  v_map jsonb := '{}'::jsonb;   -- tempId -> 생성된 uuid(text)
  v_count integer := 0;
begin
  delete from public.wbs_items where project_id = p_project_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
  loop
    v_parent := null;
    if nullif(v_item->>'parentTempId', '') is not null then
      v_parent := nullif(v_map->>(v_item->>'parentTempId'), '')::uuid;
    end if;

    insert into wbs_items (
      project_id, parent_id, level, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'level', v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from teams
       where code = v_owner->>'team' and (project_id = p_project_id or project_id is null)
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$$;


--
-- Name: request_wiki_processing_job_run(bigint, boolean, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_wiki_processing_job_run(p_job_id bigint, p_force boolean, p_payload jsonb) RETURNS TABLE(job_id bigint, status text, apply_generation integer, rerun_requested boolean)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_job public.wiki_processing_jobs%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_now timestamptz := clock_timestamp();
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'WIKI_JOB_REQUEST_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  select job.* into v_job
  from public.wiki_processing_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception 'WIKI_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(p_force, false) then
    if v_job.apply_generation = 2147483647 then
      raise exception 'WIKI_JOB_GENERATION_EXHAUSTED' using errcode = '22003';
    end if;

    update public.wiki_processing_jobs job
    set apply_generation = v_job.apply_generation + 1,
        rerun_requested = case when v_job.status = 'running' then true else false end,
        status = case when v_job.status = 'running' then 'running' else 'pending' end,
        attempts = case when v_job.status = 'running' then v_job.attempts else 0 end,
        run_after = case when v_job.status = 'running' then v_job.run_after else v_now end,
        locked_at = case when v_job.status = 'running' then v_job.locked_at else null end,
        locked_by = case when v_job.status = 'running' then v_job.locked_by else null end,
        last_error = null,
        payload = (
          (v_job.payload || v_payload) - 'summary' - 'skipped'
        ) || jsonb_build_object('applyGeneration', v_job.apply_generation + 1),
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;

  elsif v_job.status = 'dead_letter' then
    -- 운영 재시도는 이미 커밋된 item RPC를 재사용해야 하므로 generation을 유지한다.
    update public.wiki_processing_jobs job
    set status = 'pending',
        attempts = 0,
        run_after = v_now,
        locked_at = null,
        locked_by = null,
        last_error = null,
        rerun_requested = false,
        payload = (
          (v_job.payload || v_payload) - 'summary' - 'skipped'
        ) || jsonb_build_object('applyGeneration', v_job.apply_generation),
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;
  end if;

  job_id := v_job.id;
  status := v_job.status;
  apply_generation := v_job.apply_generation;
  rerun_requested := v_job.rerun_requested;
  return next;
end
$$;


--
-- Name: request_wiki_project_append(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_wiki_project_append(p_project_id uuid, p_reason text DEFAULT '프로젝트 Wiki 시간순 추가'::text) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_generation bigint;
  v_now timestamptz := clock_timestamp();
begin
  if p_project_id is null then
    return null;
  end if;

  insert into public.wiki_project_rebuild_jobs as append_job (
    project_id, status, generation, reset_generation, rerun_requested,
    cursor_observed_sort, cursor_minute_id,
    step_observed_sort, step_minute_id, step_minute_version_id,
    step_rebuild_generation, step_wiki_job_id, step_wiki_apply_generation,
    attempts, run_after, locked_at, locked_by, last_error, reason, updated_at
  ) values (
    p_project_id, 'pending', 1, 1, false,
    null, null, null, null, null, null, null, null,
    0, v_now, null, null, null,
    coalesce(nullif(btrim(p_reason), ''), '프로젝트 Wiki 시간순 추가'),
    v_now
  )
  on conflict (project_id) do update set
    status = case
      when append_job.status = 'running' then 'running' else 'pending'
    end,
    -- full rebuild 도중 들어온 forward append는 generation/rerun/cursor/step을 건드리지
    -- 않는다. 현재 세대의 keyset이 마지막에 새 회의록을 자연스럽게 선택한다.
    attempts = case when append_job.status = 'running' then append_job.attempts else 0 end,
    run_after = case when append_job.status = 'running' then append_job.run_after else v_now end,
    locked_at = case when append_job.status = 'running' then append_job.locked_at else null end,
    locked_by = case when append_job.status = 'running' then append_job.locked_by else null end,
    last_error = null,
    reason = excluded.reason,
    updated_at = v_now
  returning append_job.generation into v_generation;

  -- poison step 때문에 project와 bound minute job이 함께 dead-letter였던 경우, 새 forward
  -- append가 project row만 깨워 같은 죽은 step을 반복하지 않도록 bound job도 같은
  -- apply generation에서 재시도 가능하게 연다. 이미 커밋된 item은 idempotency key로 재사용된다.
  update public.wiki_processing_jobs job
  set status = 'pending',
      attempts = 0,
      run_after = v_now,
      locked_at = null,
      locked_by = null,
      last_error = null,
      updated_at = v_now
  where job.id = (
      select append_job.step_wiki_job_id
      from public.wiki_project_rebuild_jobs append_job
      where append_job.project_id = p_project_id
    )
    and job.status = 'dead_letter';

  return v_generation;
end
$$;


--
-- Name: request_wiki_project_rebuild(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_wiki_project_rebuild(p_project_id uuid, p_reason text DEFAULT '프로젝트 Wiki 재구성'::text) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_generation bigint;
  v_now timestamptz := clock_timestamp();
begin
  if p_project_id is null then
    return null;
  end if;

  insert into public.wiki_project_rebuild_jobs as rebuild (
    project_id, status, generation, rerun_requested,
    cursor_observed_sort, cursor_minute_id,
    step_observed_sort, step_minute_id, step_minute_version_id,
    step_rebuild_generation, step_wiki_job_id, step_wiki_apply_generation,
    attempts, run_after, locked_at, locked_by, last_error, reason, updated_at
  ) values (
    p_project_id, 'pending', 1, false,
    null, null, null, null, null, null, null, null,
    0, v_now, null, null, null,
    coalesce(nullif(btrim(p_reason), ''), '프로젝트 Wiki 재구성'),
    v_now
  )
  on conflict (project_id) do update set
    generation = rebuild.generation + 1,
    rerun_requested = case when rebuild.status = 'running' then true else false end,
    status = case when rebuild.status = 'running' then 'running' else 'pending' end,
    cursor_observed_sort = case
      when rebuild.status = 'running' then rebuild.cursor_observed_sort else null
    end,
    cursor_minute_id = case
      when rebuild.status = 'running' then rebuild.cursor_minute_id else null
    end,
    step_observed_sort = case
      when rebuild.status = 'running' then rebuild.step_observed_sort else null
    end,
    step_minute_id = case
      when rebuild.status = 'running' then rebuild.step_minute_id else null
    end,
    step_minute_version_id = case
      when rebuild.status = 'running' then rebuild.step_minute_version_id else null
    end,
    step_rebuild_generation = case
      when rebuild.status = 'running' then rebuild.step_rebuild_generation else null
    end,
    step_wiki_job_id = case
      when rebuild.status = 'running' then rebuild.step_wiki_job_id else null
    end,
    step_wiki_apply_generation = case
      when rebuild.status = 'running' then rebuild.step_wiki_apply_generation else null
    end,
    attempts = case when rebuild.status = 'running' then rebuild.attempts else 0 end,
    run_after = case when rebuild.status = 'running' then rebuild.run_after else v_now end,
    locked_at = case when rebuild.status = 'running' then rebuild.locked_at else null end,
    locked_by = case when rebuild.status = 'running' then rebuild.locked_by else null end,
    last_error = null,
    reason = excluded.reason,
    updated_at = v_now
  returning rebuild.generation into v_generation;

  return v_generation;
end
$$;


--
-- Name: restore_wiki_document_revision(uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_wiki_document_revision(p_topic_id uuid, p_revision_id uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(topic_id uuid, body_updated_at timestamp with time zone, version_no integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_topic public.wiki_topics%rowtype;
  v_revision public.wiki_topic_revisions%rowtype;
  v_version integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;

  select topic.* into v_topic
  from public.wiki_topics topic
  where topic.id = p_topic_id
  for update;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_topic.body_updated_at is distinct from p_expected_updated_at then
    raise exception 'WIKI_DOCUMENT_EDIT_CONFLICT' using errcode = '40001';
  end if;

  select revision.* into v_revision
  from public.wiki_topic_revisions revision
  where revision.id = p_revision_id
    and revision.topic_id = p_topic_id
    and revision.project_id = v_topic.project_id;
  if not found then
    raise exception 'WIKI_REVISION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if nullif(btrim(coalesce(v_topic.body_md, '')), '') is not null
     and nullif(btrim(v_revision.body_md), '') is null
     and not public.is_project_admin(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(
    nullif(btrim(user_row.raw_user_meta_data ->> 'full_name'), ''),
    user_row.email
  ) into v_actor_name
  from auth.users user_row
  where user_row.id = v_actor;

  select coalesce(max(revision.version_no), 0) + 1 into v_version
  from public.wiki_topic_revisions revision
  where revision.topic_id = p_topic_id;

  if v_topic.body_updated_at is not null and v_now <= v_topic.body_updated_at then
    v_now := v_topic.body_updated_at + interval '1 microsecond';
  end if;

  begin
    -- 과거 행은 수정하지 않는다. 복원 결과도 새 revision으로 append한다.
    insert into public.wiki_topic_revisions (
      topic_id, project_id, version_no, title, body_md, body_hash,
      document_kind, edited_by, edited_by_name, created_at
    ) values (
      p_topic_id, v_topic.project_id, v_version,
      v_revision.title, v_revision.body_md, v_revision.body_hash,
      v_revision.document_kind, v_actor, v_actor_name, v_now
    );

    update public.wiki_topics topic
    set title = v_revision.title,
        normalized_title = public.wiki_normalize_document_title(v_revision.title),
        type = case v_revision.document_kind
          when 'glossary' then 'glossary'
          when 'how_to' then 'process'
          when 'runbook' then 'process'
          when 'decision' then 'policy'
          else topic.type
        end,
        body_md = v_revision.body_md,
        body_updated_at = v_now,
        body_updated_by = v_actor,
        origin = 'manual',
        document_kind = v_revision.document_kind,
        verified_at = null,
        verified_by = null,
        review_due_at = null,
        last_changed_at = v_now,
        updated_at = v_now
    where topic.id = p_topic_id;
  exception when unique_violation then
    raise exception 'WIKI_DOCUMENT_TITLE_TAKEN' using errcode = '23505';
  end;

  return query select p_topic_id, v_now, v_version;
end
$$;


--
-- Name: retract_minute_wiki_sources(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retract_minute_wiki_sources(p_minute_id uuid, p_reason text DEFAULT '회의록 근거 철회'::text) RETURNS TABLE(retracted_source_count integer, archived_item_count integer, change_event_count integer)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_now timestamptz := clock_timestamp();
  v_reason text := coalesce(nullif(btrim(p_reason), ''), '회의록 근거 철회');
  v_item_ids uuid[];
  v_item_id uuid;
  v_before public.wiki_items%rowtype;
  v_after public.wiki_items%rowtype;
  v_source_id uuid;
  v_version_id uuid;
  v_body_hash text;
  v_block_index integer;
  v_block_hash text;
  v_project_id uuid;
begin
  select mi.project_id into v_project_id
  from public.minutes mi
  where mi.id = p_minute_id;
  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- project rebuild row를 Wiki item/source보다 먼저 잠근다. rebuild reset과 같은
  -- 순서를 사용하므로 철회가 item을 잡은 채 project claim을 기다리는 역순 deadlock을
  -- 만들지 않는다. 철회와 durable 복구 요청도 여전히 한 트랜잭션이다.
  perform public.request_wiki_project_rebuild(v_project_id, v_reason);

  select coalesce(array_agg(distinct wis.wiki_item_id), '{}'::uuid[])
  into v_item_ids
  from public.wiki_item_sources wis
  where wis.minute_id = p_minute_id
    and wis.retracted_at is null;

  update public.wiki_item_sources wis
  set retracted_at = v_now,
      retraction_reason = v_reason
  where wis.minute_id = p_minute_id
    and wis.retracted_at is null;
  get diagnostics retracted_source_count = row_count;

  archived_item_count := 0;
  change_event_count := 0;

  foreach v_item_id in array v_item_ids loop
    select wi.* into v_before
    from public.wiki_items wi
    where wi.id = v_item_id
    for update;

    if found
       and v_before.origin = 'ai'
       and v_before.lifecycle_state <> 'archived'
       and not v_before.auto_update_locked then
      -- 이 철회를 대표하는 정확한 source를 골라 event trigger가 provenance를 복제하게 한다.
      select wis.id, wis.minute_version_id, wis.body_hash, wis.block_index, wis.block_hash
      into v_source_id, v_version_id, v_body_hash, v_block_index, v_block_hash
      from public.wiki_item_sources wis
      where wis.wiki_item_id = v_item_id
        and wis.minute_id = p_minute_id
        and wis.retracted_at = v_now
      order by wis.created_at desc, wis.id desc
      limit 1;

      update public.wiki_items wi
      set lifecycle_state = 'archived',
          updated_at = v_now
      where wi.id = v_item_id
      returning wi.* into v_after;

      insert into public.wiki_change_events (
        project_id, wiki_item_id, minute_id, source_id,
        minute_version_id, source_body_hash, source_block_index, source_block_hash,
        change_type, before_snapshot, after_snapshot, reason, created_at
      ) values (
        v_before.project_id, v_item_id, p_minute_id, v_source_id,
        v_version_id, v_body_hash, v_block_index, v_block_hash,
        'retract', to_jsonb(v_before), to_jsonb(v_after), v_reason, v_now
      );

      archived_item_count := archived_item_count + 1;
      change_event_count := change_event_count + 1;

      update public.wiki_topics wt
      set last_changed_at = v_now,
          updated_at = v_now
      where wt.id = v_before.topic_id;
    end if;
  end loop;

  return next;
end
$$;


--
-- Name: review_wiki_item(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_wiki_item(p_item_id uuid, p_review_state text) RETURNS TABLE(item_id uuid, review_state text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_item public.wiki_items%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_REVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  if p_review_state is null or p_review_state not in ('pending','accepted','rejected') then
    raise exception 'WIKI_REVIEW_STATE_INVALID' using errcode = '22023';
  end if;

  select item.* into v_item
  from public.wiki_items item
  where item.id = p_item_id
  for update;
  if not found then
    raise exception 'WIKI_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_item.project_id) then
    raise exception 'WIKI_REVIEW_FORBIDDEN' using errcode = '42501';
  end if;

  if v_item.review_state = p_review_state then
    return query select p_item_id, v_item.review_state;
    return;
  end if;
  -- accepted 에서 나가는 전이가 반드시 있어야 한다. 기존 AI 지식 1,219건이 전부
  -- accepted 로 백필되므로(§4 review_state default), accepted 를 흡수 상태로 두면
  -- 지금 화면에 떠 있는 지식에서 오류·기밀 누출을 발견해도 관리자가 내릴 방법이 없고
  -- service_role 직접 UPDATE 만 남는다 — 그 경로에는 아래 wiki_change_events 감사
  -- 기록이 남지 않는다. 즉 '검토 상태'라는 통제가 신규 항목에만 걸리게 된다.
  if not (
    (v_item.review_state = 'pending' and p_review_state in ('accepted','rejected'))
    or (v_item.review_state = 'rejected' and p_review_state = 'pending')
    or (v_item.review_state = 'accepted' and p_review_state in ('rejected','pending'))
  ) then
    raise exception 'WIKI_REVIEW_INVALID_TRANSITION' using errcode = '22023';
  end if;

  v_before := to_jsonb(v_item);
  update public.wiki_items item
  set review_state = p_review_state,
      updated_at = v_now
  where item.id = p_item_id;
  select to_jsonb(item) into v_after
  from public.wiki_items item
  where item.id = p_item_id;

  insert into public.wiki_change_events (
    project_id, wiki_item_id, change_type, before_snapshot, after_snapshot, reason, actor_id
  ) values (
    v_item.project_id, p_item_id, 'curate', v_before, v_after,
    'review:' || p_review_state, v_actor
  );

  update public.wiki_topics topic
  set last_changed_at = v_now, updated_at = v_now
  where topic.id = v_item.topic_id and topic.project_id = v_item.project_id;

  return query select p_item_id, p_review_state;
end
$$;


--
-- Name: save_wiki_document(uuid, text, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_wiki_document(p_topic_id uuid, p_title text, p_body_md text, p_document_kind text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(topic_id uuid, body_updated_at timestamp with time zone, version_no integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_topic public.wiki_topics%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := coalesce(p_body_md, '');
  v_version integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;

  select topic.* into v_topic
  from public.wiki_topics topic
  where topic.id = p_topic_id
  for update;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_topic.body_updated_at is distinct from p_expected_updated_at then
    raise exception 'WIKI_DOCUMENT_EDIT_CONFLICT' using errcode = '40001';
  end if;
  if v_title = '' or char_length(v_title) > 160 then
    raise exception 'WIKI_DOCUMENT_TITLE_INVALID' using errcode = '22023';
  end if;
  if p_document_kind is null or p_document_kind not in (
    'overview','decision','how_to','runbook','faq','glossary','reference'
  ) then
    raise exception 'WIKI_DOCUMENT_KIND_INVALID' using errcode = '22023';
  end if;
  if char_length(v_body) > 100000 then
    raise exception 'WIKI_DOCUMENT_BODY_TOO_LARGE' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_topic.body_md, '')), '') is not null
     and nullif(btrim(v_body), '') is null
     and not public.is_project_admin(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(
    nullif(btrim(user_row.raw_user_meta_data ->> 'full_name'), ''),
    user_row.email
  ) into v_actor_name
  from auth.users user_row
  where user_row.id = v_actor;

  select coalesce(max(revision.version_no), 0) + 1 into v_version
  from public.wiki_topic_revisions revision
  where revision.topic_id = p_topic_id;

  -- clock_timestamp가 이전 토큰과 같아도 다음 저장 토큰은 반드시 달라야 한다.
  if v_topic.body_updated_at is not null and v_now <= v_topic.body_updated_at then
    v_now := v_topic.body_updated_at + interval '1 microsecond';
  end if;

  begin
    insert into public.wiki_topic_revisions (
      topic_id, project_id, version_no, title, body_md, body_hash,
      document_kind, edited_by, edited_by_name, created_at
    ) values (
      p_topic_id, v_topic.project_id, v_version, v_title, v_body,
      public.wiki_fnv1a64(v_body),
      p_document_kind, v_actor, v_actor_name, v_now
    );

    update public.wiki_topics topic
    set title = v_title,
        normalized_title = public.wiki_normalize_document_title(v_title),
        type = case p_document_kind
          when 'glossary' then 'glossary'
          when 'how_to' then 'process'
          when 'runbook' then 'process'
          when 'decision' then 'policy'
          else topic.type
        end,
        body_md = v_body,
        body_updated_at = v_now,
        body_updated_by = v_actor,
        origin = 'manual',
        document_kind = p_document_kind,
        verified_at = null,
        verified_by = null,
        review_due_at = null,
        last_changed_at = v_now,
        updated_at = v_now
    where topic.id = p_topic_id;
  exception when unique_violation then
    raise exception 'WIKI_DOCUMENT_TITLE_TAKEN' using errcode = '23505';
  end;

  return query select p_topic_id, v_now, v_version;
end
$$;


--
-- Name: set_dependency_waiver(uuid, text, boolean, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

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


--
-- Name: submit_wiki_feedback(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_wiki_feedback(p_topic_id uuid, p_kind text, p_comment text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_project_id uuid;
  v_feedback_id uuid;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_FEEDBACK_FORBIDDEN' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('helpful','outdated') then
    raise exception 'WIKI_FEEDBACK_KIND_INVALID' using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'WIKI_FEEDBACK_COMMENT_INVALID' using errcode = '22023';
  end if;

  -- 프로젝트 id를 클라이언트에서 받지 않는다. 대상 topic이 권한 판정의 단일 정본이다.
  select topic.project_id into v_project_id
  from public.wiki_topics topic
  where topic.id = p_topic_id;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'WIKI_FEEDBACK_FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.wiki_feedback (
    project_id, topic_id, feedback_type, user_id, comment, created_at, updated_at
  ) values (
    v_project_id, p_topic_id, p_kind, v_actor, v_comment, v_now, v_now
  )
  on conflict (topic_id, user_id, feedback_type) do update
  set comment = excluded.comment,
      -- 같은 사용자가 오래됨을 다시 누르면 이전 해결 상태를 재연다.
      resolution = null,
      resolved_by = null,
      resolved_at = null,
      updated_at = excluded.updated_at
  returning id into v_feedback_id;

  if p_kind = 'outdated' then
    update public.wiki_topics topic
    set review_due_at = least(coalesce(topic.review_due_at, v_now), v_now),
        updated_at = v_now
    where topic.id = p_topic_id and topic.project_id = v_project_id;
  end if;

  return v_feedback_id;
end
$$;


--
-- Name: update_minute_metadata_with_wiki_retraction(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_minute_metadata_with_wiki_retraction(p_minute_id uuid, p_metadata jsonb) RETURNS TABLE(old_project_id uuid, new_project_id uuid, updated_at timestamp with time zone, wiki_rebuild_required boolean)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_minute public.minutes%rowtype;
  v_original_minute public.minutes%rowtype;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_meeting_project_id uuid;
  v_index_project_id uuid;
  v_lock_project_id uuid;
  v_chronology_changed boolean := false;
  v_index_content_changed boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'MINUTE_METADATA_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_metadata) as metadata_key(key_name)
    where key_name not in (
      'minute_date', 'team_code', 'title', 'meeting_id',
      'project_id', 'meeting_occurrence_date', 'folder_id'
    )
  ) then
    raise exception 'MINUTE_METADATA_KEY_NOT_ALLOWED' using errcode = '22023';
  end if;

  select mi.* into v_minute
  from public.minutes mi
  where mi.id = p_minute_id
  for update;
  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute.archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  v_original_minute := v_minute;

  old_project_id := v_minute.project_id;

  if v_metadata ? 'minute_date' then
    v_minute.minute_date := nullif(v_metadata->>'minute_date', '')::date;
  end if;
  if v_metadata ? 'team_code' then
    v_minute.team_code := nullif(btrim(v_metadata->>'team_code'), '');
  end if;
  if v_metadata ? 'title' then
    v_minute.title := nullif(btrim(v_metadata->>'title'), '');
  end if;
  if v_metadata ? 'meeting_id' then
    v_minute.meeting_id := nullif(v_metadata->>'meeting_id', '')::uuid;
  end if;
  if v_metadata ? 'project_id' then
    v_minute.project_id := nullif(v_metadata->>'project_id', '')::uuid;
  end if;
  if v_metadata ? 'meeting_occurrence_date' then
    v_minute.meeting_occurrence_date :=
      nullif(v_metadata->>'meeting_occurrence_date', '')::date;
  end if;
  if v_metadata ? 'folder_id' then
    v_minute.folder_id := nullif(v_metadata->>'folder_id', '')::uuid;
  end if;

  if v_minute.minute_date is null
     or v_minute.team_code is null
     or v_minute.title is null
     or char_length(v_minute.title) > 200 then
    raise exception 'MINUTE_METADATA_REQUIRED' using errcode = '23502';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.code = v_minute.team_code and t.active
  ) then
    raise exception 'MINUTE_TEAM_INVALID' using errcode = '23503';
  end if;

  if v_minute.meeting_id is not null then
    select mt.project_id into v_meeting_project_id
    from public.meetings mt
    where mt.id = v_minute.meeting_id;
    if not found then
      raise exception 'MEETING_NOT_FOUND' using errcode = '23503';
    end if;
    if v_minute.project_id is null then
      v_minute.project_id := v_meeting_project_id;
    elsif v_minute.project_id <> v_meeting_project_id then
      raise exception 'MINUTE_MEETING_PROJECT_MISMATCH' using errcode = '23514';
    end if;
    if (v_metadata ? 'meeting_id') and not (v_metadata ? 'meeting_occurrence_date') then
      v_minute.meeting_occurrence_date := v_minute.minute_date;
    end if;
  else
    v_minute.meeting_occurrence_date := null;
  end if;

  new_project_id := v_minute.project_id;
  v_chronology_changed :=
    old_project_id is not distinct from new_project_id
    and (
      v_original_minute.minute_date is distinct from v_minute.minute_date
      or v_original_minute.meeting_occurrence_date
         is distinct from v_minute.meeting_occurrence_date
    );
  v_index_content_changed :=
    v_original_minute.title is distinct from v_minute.title
    or v_original_minute.team_code is distinct from v_minute.team_code
    or v_original_minute.minute_date is distinct from v_minute.minute_date
    or v_original_minute.meeting_occurrence_date
       is distinct from v_minute.meeting_occurrence_date
    or old_project_id is distinct from new_project_id;

  if old_project_id is distinct from new_project_id or v_chronology_changed then
    -- A→B와 B→A 이동이 동시에 실행돼도 두 project rebuild row를 항상 UUID 오름차순으로
    -- 먼저 확보한다. 이후 retract(old)→request(new)가 역순 row lock cycle을 만들지 않는다.
    for v_lock_project_id in
      select scope.project_id
      from (
        select old_project_id as project_id
        union
        select new_project_id as project_id
      ) scope
      where scope.project_id is not null
      order by scope.project_id
    loop
      insert into public.wiki_project_rebuild_jobs (
        project_id, status, generation, reason
      ) values (
        v_lock_project_id, 'pending', 1, '회의록 메타데이터 변경 준비'
      )
      on conflict (project_id) do nothing;

      perform 1
      from public.wiki_project_rebuild_jobs rebuild
      where rebuild.project_id = v_lock_project_id
      for update;
    end loop;

    perform 1
    from public.retract_minute_wiki_sources(
      p_minute_id,
      case
        when old_project_id is distinct from new_project_id
          then '회의록 프로젝트 재귀속으로 기존 Wiki 근거를 철회했습니다.'
        else '회의록 시간축 변경으로 기존 Wiki 근거를 철회했습니다.'
      end
    );
    update public.wiki_processing_jobs job
    set status = 'done',
        locked_at = null,
        locked_by = null,
        last_error = null,
        payload = job.payload || jsonb_build_object(
          'retracted',
          true,
          'reason',
          case
            when old_project_id is distinct from new_project_id
              then 'project_reassigned'
            else 'chronology_changed'
          end
        ),
        updated_at = v_now
    where job.minute_id = p_minute_id
      and job.project_id is not distinct from old_project_id
      and job.status <> 'done';
  end if;

  update public.minutes mi
  set minute_date = v_minute.minute_date,
      team_code = v_minute.team_code,
      title = v_minute.title,
      meeting_id = v_minute.meeting_id,
      project_id = v_minute.project_id,
      meeting_occurrence_date = v_minute.meeting_occurrence_date,
      folder_id = v_minute.folder_id,
      updated_at = v_now
  where mi.id = p_minute_id;

  if old_project_id is distinct from new_project_id then
    -- 검색 문서도 현재 scope와 함께 움직인다. 모든 기존 scope의 파생 문서를 먼저
    -- 제거하고, 과거 scope에는 CAS-safe delete tombstone을, 새 scope에는 upsert를
    -- 남겨 실행 중이던 구세대 worker가 뒤늦게 끝나도 최종 상태가 다시 수렴하게 한다.
    delete from public.ai_documents
    where domain = 'minutes'
      and entity_type = 'minute'
      and entity_id = p_minute_id::text;

    for v_index_project_id in
      select distinct scope.project_id
      from (
        select job.project_id
        from public.ai_index_jobs job
        where job.domain = 'minutes'
          and job.entity_type = 'minute'
          and job.entity_id = p_minute_id::text
        union all
        select old_project_id
      ) scope
    loop
      perform public.queue_minute_ai_index_scope_change(
        v_index_project_id,
        p_minute_id,
        'delete',
        v_now
      );
    end loop;

    -- project_id NULL도 검색 계층의 명시적 global scope다.
    perform public.queue_minute_ai_index_scope_change(
      new_project_id,
      p_minute_id,
      'upsert',
      v_now
    );

    -- old 프로젝트 요청은 위 retract가 이미 같은 트랜잭션에 남겼다. update 뒤에는
    -- 새 scope도 별도 generation으로 요청해 이동한 회의록을 최신 버전으로 포함한다.
    perform public.request_wiki_project_rebuild(
      new_project_id,
      '회의록 프로젝트 재귀속 후 새 프로젝트 Wiki 재구성'
    );
  elsif v_index_content_changed then
    -- 같은 scope의 제목/팀/일자 변경은 stable key를 유지한 채 검색 문서를 교체한다.
    perform public.queue_minute_ai_index_scope_change(
      new_project_id,
      p_minute_id,
      'upsert',
      v_now
    );
  end if;

  updated_at := v_now;
  wiki_rebuild_required :=
    old_project_id is distinct from new_project_id or v_chronology_changed;
  return next;
end
$$;


--
-- Name: update_project_member_with_identity(uuid, text, text, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_current public.project_members%rowtype;
  v_name text;
  v_email text;
  v_refs integer;
  v_identity_rename boolean;
  v_roster_write_locked boolean := false;
begin
  v_name := pg_catalog.btrim(p_name);
  if v_name is null or v_name = '' then
    raise exception 'PROJECT_MEMBER_NAME_REQUIRED' using errcode = '23514';
  end if;

  v_email := nullif(pg_catalog.lower(pg_catalog.btrim(p_email)), '');
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'PROJECT_MEMBER_EMAIL_INVALID' using errcode = '23514';
  end if;
  if p_role is null or p_role not in ('admin', 'contributor') then
    raise exception 'PROJECT_MEMBER_ROLE_INVALID' using errcode = '23514';
  end if;

  -- 전역 rename 여부를 판정하는 첫 조회에서는 행 잠금을 잡지 않는다.
  -- 대상 행을 먼저 잠그면, 다른 행을 잠근 요청과 FK cascade가 서로를
  -- 기다리는 교착(member row -> advisory <-> advisory -> cascade row)이 생긴다.
  select pm.*
    into v_current
    from public.project_members pm
   where pm.id = p_member_id;
  if not found then
    raise exception 'PROJECT_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_current.project_id) then
    raise exception 'PROJECT_MEMBER_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  v_identity_rename := v_current.email is not null
    and v_email is not distinct from v_current.email
    and v_name is distinct from v_current.name;

  if v_identity_rename then
    -- ON UPDATE CASCADE와 일반 행 UPDATE의 잠금 순서를 같게 맞추기 위해
    -- 아직 행/advisory 잠금이 없을 때 로스터 쓰기를 잠시 직렬화한다.
    -- 이름 교정은 드물고 행 수도 작아 안전성을 우선한다.
    -- EXCLUSIVE는 일반 SELECT는 허용하지만 다른 RPC의 SELECT ... FOR UPDATE
    -- (ROW SHARE)까지 막는다. SHARE ROW EXCLUSIVE는 ROW SHARE와 호환되어
    -- 다른 RPC가 child 행을 잠근 뒤 UPDATE에서 기다리는 교착이 남는다.
    lock table public.project_members in exclusive mode;
    v_roster_write_locked := true;
  end if;

  -- table lock을 기다리는 동안 대상이 바뀌었을 수 있으므로 행과 권한을
  -- 다시 확정한다. 초기에 rename이 아니었던 요청이 동시 변경으로 rename이
  -- 됐다면, 행을 잠근 채 table lock을 승격하지 말고 재시도로 돌린다.
  select pm.*
    into v_current
    from public.project_members pm
   where pm.id = p_member_id
   for update;
  if not found then
    raise exception 'PROJECT_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_current.project_id) then
    raise exception 'PROJECT_MEMBER_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  v_identity_rename := v_current.email is not null
    and v_email is not distinct from v_current.email
    and v_name is distinct from v_current.name;
  if v_identity_rename and not v_roster_write_locked then
    raise exception 'PROJECT_MEMBER_RETRY' using errcode = '40001';
  end if;

  -- 같은 email의 이름만 바꾸는 경우 정본을 먼저 갱신한다. FK cascade가 이 email을
  -- 쓰는 모든 프로젝트 로스터 이름을 한 트랜잭션에서 바꾼다.
  if v_identity_rename then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('project_member_identity:' || v_email, 0)
    );

    select count(*)
      into v_refs
      from public.project_members pm
     where pm.email = v_email;

    if v_refs > 1 and not public.is_superuser() then
      raise exception 'PROJECT_MEMBER_IDENTITY_RENAME_FORBIDDEN' using errcode = '42501';
    end if;

    update public.project_member_identities identity
       set name = v_name
     where identity.email = v_email;
    if not found then
      raise exception 'PROJECT_MEMBER_IDENTITY_NOT_FOUND' using errcode = '23503';
    end if;
  end if;

  update public.project_members
     set name = v_name,
         email = v_email,
         team_id = p_team_id,
         role = p_role,
         title = p_title,
         role_label = p_role_label
   where id = p_member_id;

  return true;
end
$_$;


--
-- Name: upsert_ai_index_jobs(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_ai_index_jobs(p_jobs jsonb) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_count integer;
begin
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'AI_INDEX_JOBS_INVALID' using errcode = '22023';
  end if;

  insert into public.ai_index_jobs (
    job_key, operation, project_id, domain, entity_type, entity_id,
    payload, status, attempts, run_after, locked_at, last_error, generation, updated_at
  )
  select
    x.job_key, x.operation, x.project_id, x.domain, x.entity_type, x.entity_id,
    coalesce(x.payload, '{}'::jsonb), 'pending', 0, coalesce(x.run_after, now()),
    null, null, 0, now()
  from jsonb_to_recordset(p_jobs) as x(
    job_key text,
    operation text,
    project_id uuid,
    domain text,
    entity_type text,
    entity_id text,
    payload jsonb,
    run_after timestamptz
  )
  on conflict (job_key) do update set
    operation = excluded.operation,
    payload = excluded.payload,
    status = 'pending',
    attempts = 0,
    run_after = excluded.run_after,
    locked_at = null,
    last_error = null,
    generation = public.ai_index_jobs.generation + 1,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: usage_daily_actives(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usage_daily_actives(p_from date, p_to date) RETURNS TABLE(d date, active_users integer, events integer)
    LANGUAGE sql STABLE
    AS $$
  select (occurred_at at time zone 'Asia/Seoul')::date,
         count(distinct user_id)::int,
         count(*)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by 1
  order by 1;
$$;


--
-- Name: usage_menu_ranking(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usage_menu_ranking(p_from date, p_to date) RETURNS TABLE(menu_key text, events integer, active_users integer)
    LANGUAGE sql STABLE
    AS $$
  select menu_key,
         count(*)::int,
         count(distinct user_id)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by menu_key
  order by 2 desc, 1;
$$;


--
-- Name: usage_sessions(date, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usage_sessions(p_from date, p_to date, p_gap_minutes integer DEFAULT 30) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  with ordered as (
    select user_id,
           occurred_at,
           lag(occurred_at) over (partition by user_id order by occurred_at) as prev_at
    from public.usage_events
    where event_name = 'page_view'
      and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
      and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  )
  select count(*)::int
  from ordered
  where prev_at is null
     or occurred_at - prev_at > make_interval(mins => p_gap_minutes);
$$;


--
-- Name: usage_summary(date, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usage_summary(p_from date, p_to date, p_today date) RETURNS TABLE(total_events bigint, active_users bigint, today_users bigint, last_event_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  select
    (select count(*) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_today::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_today + 1)::timestamp at time zone 'Asia/Seoul')),
    (select max(occurred_at) from public.usage_events
       where event_name = 'page_view');
$$;


--
-- Name: usage_user_rollup(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usage_user_rollup(p_from date, p_to date) RETURNS TABLE(user_id uuid, events integer, active_days integer, last_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  select user_id,
         count(*)::int,
         count(distinct (occurred_at at time zone 'Asia/Seoul')::date)::int,
         max(occurred_at)
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by user_id;
$$;


--
-- Name: validate_task_dependency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_task_dependency() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_pred_project uuid;
  v_succ_project uuid;
  v_pred_start date;
  v_pred_end date;
  v_succ_start date;
  v_succ_end date;
  v_cycle boolean;
begin
  -- 같은 프로젝트에 대한 동시 반대방향 삽입도 직렬화해 순환 검사 경쟁을 막는다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.project_id::text, 0));

  select project_id, planned_start, planned_end
    into v_pred_project, v_pred_start, v_pred_end
    from public.wbs_items where id = new.predecessor_id;
  select project_id, planned_start, planned_end
    into v_succ_project, v_succ_start, v_succ_end
    from public.wbs_items where id = new.successor_id;

  if v_pred_project is null or v_succ_project is null then
    raise exception '연결할 작업을 찾을 수 없습니다' using errcode = '23503';
  end if;
  if v_pred_project <> new.project_id or v_succ_project <> new.project_id then
    raise exception '같은 프로젝트의 작업끼리만 연결할 수 있습니다' using errcode = '23514';
  end if;
  if v_pred_start is null or v_pred_end is null or v_succ_start is null or v_succ_end is null then
    raise exception '계획 시작일과 종료일이 있는 작업만 연결할 수 있습니다' using errcode = '23514';
  end if;
  if v_pred_start > v_pred_end or v_succ_start > v_succ_end then
    raise exception '시작일이 종료일보다 늦은 작업은 연결할 수 없습니다' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from pg_catalog.generate_series(v_pred_start, v_pred_end, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.holidays h where h.project_id = new.project_id and h.date = d::date
       )
  ) or not exists (
    select 1
      from pg_catalog.generate_series(v_succ_start, v_succ_end, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.holidays h where h.project_id = new.project_id and h.date = d::date
       )
  ) then
    raise exception '계획 기간에 영업일이 없는 작업은 연결할 수 없습니다' using errcode = '23514';
  end if;

  with recursive reachable(id) as (
    select new.successor_id
    union
    select d.successor_id
      from public.task_dependencies d
      join reachable r on d.predecessor_id = r.id
     where d.id <> new.id
  )
  select exists(select 1 from reachable where id = new.predecessor_id) into v_cycle;
  if v_cycle then
    raise exception '순환 의존성은 등록할 수 없습니다' using errcode = '23514';
  end if;
  return new;
end;
$$;


--
-- Name: verify_wiki_document(uuid, integer, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_wiki_document(p_topic_id uuid, p_review_days integer DEFAULT 90, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(topic_id uuid, verified_at timestamp with time zone, review_due_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor uuid := auth.uid();
  v_topic public.wiki_topics%rowtype;
  v_now timestamptz := clock_timestamp();
  v_due timestamptz;
begin
  if v_actor is null then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;

  select topic.* into v_topic
  from public.wiki_topics topic
  where topic.id = p_topic_id
  for update;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_topic.body_updated_at is distinct from p_expected_updated_at then
    raise exception 'WIKI_DOCUMENT_EDIT_CONFLICT' using errcode = '40001';
  end if;
  if nullif(btrim(coalesce(v_topic.body_md, '')), '') is null then
    raise exception 'WIKI_DOCUMENT_EMPTY' using errcode = '22023';
  end if;
  if p_review_days is null or p_review_days < 1 or p_review_days > 365 then
    raise exception 'WIKI_DOCUMENT_REVIEW_DAYS_INVALID' using errcode = '22023';
  end if;

  v_due := v_now + make_interval(days => p_review_days);
  update public.wiki_topics topic
  set verified_at = v_now,
      verified_by = v_actor,
      review_due_at = v_due,
      updated_at = v_now
  where topic.id = p_topic_id;

  -- "오래됨" 신고는 이 검증이 대체한 유지관리 작업이다. 문서 검증과 같은 트랜잭션에서
  -- 열린 신고를 닫아 verified 배지와 피드백 큐가 서로 다른 상태가 되지 않게 한다.
  --
  -- 단, **남의 신고**를 닫는 것은 관리자만 할 수 있다. 검증은 멤버 권한인데(위 가드)
  -- 남의 이의제기까지 함께 지울 수 있으면, 멤버 한 명이 ① 문서를 자기 내용으로 덮어쓰고
  -- ② 곧바로 스스로 '검증됨' 배지와 최대 1년 유예를 찍고 ③ 다른 멤버들이 올려둔 '오래됨'
  -- 신고를 전부 닫는 자기검증 루프가 성립한다. 관리자 큐는 resolved_at is null 만 보므로
  -- (wiki_feedback_project_open_idx) 큐가 비어 아무도 알아채지 못한다. 본인 신고는 스스로
  -- 철회하는 것과 같으므로 멤버도 닫을 수 있다.
  update public.wiki_feedback feedback
  set resolution = 'verified',
      resolved_by = v_actor,
      resolved_at = v_now,
      updated_at = v_now
  where feedback.topic_id = p_topic_id
    and feedback.project_id = v_topic.project_id
    and feedback.feedback_type = 'outdated'
    and feedback.resolved_at is null
    and (feedback.user_id = v_actor or public.is_project_admin(v_topic.project_id));

  return query select p_topic_id, v_now, v_due;
end
$$;


--
-- Name: wbs_is_leaf(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wbs_is_leaf(p_item_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select not exists (select 1 from public.wbs_items c where c.parent_id = p_item_id and c.stub_for is null)
$$;


--
-- Name: wbs_items_broadcast(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wbs_items_broadcast() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'id',         new.id,
        'project_id', new.project_id,
        'stage',      new.stage,
        'actual_pct', new.actual_pct,
        'updated_at', new.updated_at
      ),
      'wbs_changed',
      'project-' || new.project_id::text || '-wbs',
      true  -- private 채널
    );
  exception when others then
    null;  -- 송신 실패는 삼킨다 — 본 UPDATE 를 지키는 것이 우선
  end;
  return new;
end;
$$;


--
-- Name: wbs_items_prune_waived(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wbs_items_prune_waived() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_kept text[];
begin
  if coalesce(array_length(new.depends_waived, 1), 0) = 0 then
    return new;
  end if;
  v_kept := array(select w from unnest(new.depends_waived) as w where w = any(coalesce(new.depends, '{}'::text[])));
  if v_kept is distinct from new.depends_waived then
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (null, new.id, 'depends_waived', array_to_string(new.depends_waived, ','),
              array_to_string(v_kept, ',') || ' (depends 에서 빠짐)');
    new.depends_waived := v_kept;
  end if;
  return new;
end;
$$;


--
-- Name: wiki_change_events_copy_source_provenance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wiki_change_events_copy_source_provenance() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_source public.wiki_item_sources%rowtype;
  v_item_project_id uuid;
begin
  if new.source_id is null then
    return new;
  end if;

  select wis.* into v_source
  from public.wiki_item_sources wis
  where wis.id = new.source_id;
  if not found then
    raise exception 'WIKI_CHANGE_SOURCE_NOT_FOUND' using errcode = '23503';
  end if;

  if new.wiki_item_id is not null and new.wiki_item_id <> v_source.wiki_item_id then
    raise exception 'WIKI_CHANGE_SOURCE_ITEM_MISMATCH' using errcode = '23514';
  end if;
  if new.minute_id is not null and new.minute_id <> v_source.minute_id then
    raise exception 'WIKI_CHANGE_SOURCE_MINUTE_MISMATCH' using errcode = '23514';
  end if;
  if new.minute_version_id is not null and new.minute_version_id <> v_source.minute_version_id then
    raise exception 'WIKI_CHANGE_SOURCE_VERSION_MISMATCH' using errcode = '23514';
  end if;
  if new.source_body_hash is not null and new.source_body_hash <> v_source.body_hash then
    raise exception 'WIKI_CHANGE_SOURCE_BODY_MISMATCH' using errcode = '23514';
  end if;
  if new.source_block_index is not null and new.source_block_index <> v_source.block_index then
    raise exception 'WIKI_CHANGE_SOURCE_BLOCK_MISMATCH' using errcode = '23514';
  end if;
  if new.source_block_hash is not null and new.source_block_hash <> v_source.block_hash then
    raise exception 'WIKI_CHANGE_SOURCE_BLOCK_HASH_MISMATCH' using errcode = '23514';
  end if;
  select wi.project_id into v_item_project_id
  from public.wiki_items wi
  where wi.id = v_source.wiki_item_id;
  if new.project_id <> v_item_project_id then
    raise exception 'WIKI_CHANGE_SOURCE_PROJECT_MISMATCH' using errcode = '23514';
  end if;

  new.wiki_item_id := coalesce(new.wiki_item_id, v_source.wiki_item_id);
  new.minute_id := coalesce(new.minute_id, v_source.minute_id);
  new.minute_version_id := v_source.minute_version_id;
  new.source_body_hash := v_source.body_hash;
  new.source_block_index := v_source.block_index;
  new.source_block_hash := v_source.block_hash;
  return new;
end
$$;


--
-- Name: wiki_fnv1a64(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wiki_fnv1a64(p_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO 'pg_catalog'
    AS $$
declare
  v_hash       bigint := -3750763034362895579; -- 0xcbf29ce484222325 의 signed bigint 표현
  v_prime      constant numeric := 1099511628211;
  v_modulus    constant numeric := 18446744073709551616; -- 2^64
  v_sign       constant numeric := 9223372036854775808;  -- 2^63
  v_product    numeric;
  v_codepoint  integer;
  v_unit       integer;
  v_low_unit   integer;
  v_ch         text;
begin
  if p_text = '' then
    return 'cbf29ce484222325';
  end if;

  foreach v_ch in array string_to_array(p_text, null) loop
    v_codepoint := ascii(v_ch);

    -- JavaScript charCodeAt 은 U+10000 이상 문자를 surrogate pair 두 단위로 순회한다.
    if v_codepoint > 65535 then
      v_unit := 55296 + ((v_codepoint - 65536) / 1024);
      v_low_unit := 56320 + mod(v_codepoint - 65536, 1024);
    else
      v_unit := v_codepoint;
      v_low_unit := null;
    end if;

    v_hash := v_hash # v_unit::bigint;
    v_product := mod(v_hash::numeric * v_prime, v_modulus);
    if v_product < 0 then v_product := v_product + v_modulus; end if;
    if v_product >= v_sign then
      v_hash := (v_product - v_modulus)::bigint;
    else
      v_hash := v_product::bigint;
    end if;

    if v_low_unit is not null then
      v_hash := v_hash # v_low_unit::bigint;
      v_product := mod(v_hash::numeric * v_prime, v_modulus);
      if v_product < 0 then v_product := v_product + v_modulus; end if;
      if v_product >= v_sign then
        v_hash := (v_product - v_modulus)::bigint;
      else
        v_hash := v_product::bigint;
      end if;
    end if;
  end loop;

  return lpad(to_hex(v_hash), 16, '0');
end
$$;


--
-- Name: wiki_item_has_live_source(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wiki_item_has_live_source(p_item_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.wiki_item_sources s
    where s.wiki_item_id = p_item_id and s.retracted_at is null
  ) or exists (
    select 1 from public.wiki_items w
    where w.id = p_item_id and w.origin = 'manual'
  )
$$;


--
-- Name: wiki_key_slug(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wiki_key_slug(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(normalize(coalesce(p_text, ''), NFKC)),
        '[‐‑‒–—―]', '-', 'g'
      ),
      '[^[:alnum:]]+', '-', 'g'
    ),
    '-'
  )
$$;


--
-- Name: wiki_normalize_document_title(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wiki_normalize_document_title(p_title text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO 'pg_catalog'
    AS $$
  select lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(normalize(p_title, NFKC), '[[:space:]]+', ' ', 'g'),
        '[‐‑‒–—―]', '-', 'g'
      ),
      '[[:space:]]*([/·:-])[[:space:]]*', E'\\1', 'g'
    )
  )::text
$$;


--
-- Name: wiki_topic_revisions_reject_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wiki_topic_revisions_reject_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  -- auth.users 삭제에 따른 FK SET NULL만 허용한다. 본문·제목·버전은 끝까지 불변이다.
  if tg_op = 'UPDATE'
     and old.edited_by is not null
     and new.edited_by is null
     and (to_jsonb(new) - 'edited_by') = (to_jsonb(old) - 'edited_by') then
    return new;
  end if;
  -- 명시적 파기 경로. 트리거는 RLS와 달리 소유자·service_role·postgres도 우회하지
  -- 못하므로, 이 스위치가 없으면 파기 수단이 `ALTER TABLE ... DISABLE TRIGGER` 라는
  -- 운영 중 DDL 뿐이다 — 사고 대응에서 가장 하고 싶지 않은 조작이다. 필요한 경우는 둘:
  --   ① 프로젝트 삭제(projects → wiki_topics → revision cascade)
  --   ② 본문에 자격증명·개인정보가 섞여 들어가 이력째 파기해야 할 때
  -- 사용법(트랜잭션 안에서만 유효하고 세션에 남지 않는다):
  --   begin; set local app.wiki_purge = 'on'; delete from public.projects where id = '...'; commit;
  if tg_op = 'DELETE'
     and pg_catalog.current_setting('app.wiki_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'WIKI_REVISION_IMMUTABLE' using errcode = '55000';
end
$$;


--
-- Name: agent_lead_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_lead_leases (
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    holder text,
    host text,
    agent text,
    generation bigint DEFAULT 0 NOT NULL,
    acquired_at timestamp with time zone,
    renewed_at timestamp with time zone,
    expires_at timestamp with time zone
);


--
-- Name: agent_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_projects (
    project_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_runners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_runners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'user_pat'::text NOT NULL,
    owner_user_id uuid NOT NULL,
    token_prefix text NOT NULL,
    token_hash text NOT NULL,
    project_id uuid,
    scopes text[] DEFAULT '{work:read}'::text[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    revoked_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_runners_kind_check CHECK ((kind = ANY (ARRAY['user_pat'::text, 'runner'::text])))
);


--
-- Name: agent_watchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_watchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid,
    agent text NOT NULL,
    host text,
    slots integer,
    busy integer,
    until_label text,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_work_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_work_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    wbs_item_id uuid,
    status text DEFAULT 'ready'::text NOT NULL,
    instructions text DEFAULT ''::text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    claimed_by text,
    claimed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_by_user_id uuid,
    last_heartbeat_at timestamp with time zone,
    heartbeat_phase text,
    heartbeat_agent text,
    heartbeat_note text,
    resume_requested_at timestamp with time zone,
    resume_requested_by uuid,
    resume_requested_host text,
    heartbeat_model text,
    CONSTRAINT agent_work_orders_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'claimed'::text, 'reported'::text, 'approved'::text, 'cancelled'::text])))
);


--
-- Name: agent_work_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_work_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_order_id uuid NOT NULL,
    kind text NOT NULL,
    percent integer NOT NULL,
    summary text NOT NULL,
    links jsonb DEFAULT '[]'::jsonb NOT NULL,
    agent text NOT NULL,
    actor_user_id uuid,
    applied_to_wbs boolean DEFAULT false NOT NULL,
    review_action text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    decisions jsonb,
    decision_count integer GENERATED ALWAYS AS (
CASE
    WHEN (jsonb_typeof(decisions) = 'array'::text) THEN jsonb_array_length(decisions)
    ELSE NULL::integer
END) STORED,
    CONSTRAINT agent_work_reports_decisions_shape CHECK (((decisions IS NULL) OR
CASE
    WHEN (jsonb_typeof(decisions) = 'array'::text) THEN ((jsonb_array_length(decisions) <= 20) AND (kind = 'completion'::text))
    ELSE false
END)),
    CONSTRAINT agent_work_reports_kind_check CHECK ((kind = ANY (ARRAY['progress'::text, 'completion'::text]))),
    CONSTRAINT agent_work_reports_percent_check CHECK (((percent >= 0) AND (percent <= 100))),
    CONSTRAINT agent_work_reports_review_action_check CHECK ((review_action = ANY (ARRAY['approve'::text, 'reject'::text])))
);


--
-- Name: ai_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid,
    project_scope text GENERATED ALWAYS AS (COALESCE((project_id)::text, 'global'::text)) STORED,
    domain text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    chunk_no integer NOT NULL,
    index_version integer DEFAULT 1 NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    content text NOT NULL,
    content_hash text NOT NULL,
    href text NOT NULL,
    team text,
    occurred_on date,
    source_updated_at timestamp with time zone,
    embedding_model text NOT NULL,
    embedding_dimensions integer DEFAULT 768 NOT NULL,
    chunker_version text NOT NULL,
    embedding public.vector(768),
    indexed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_documents_chunk_no_check CHECK ((chunk_no >= 0)),
    CONSTRAINT ai_documents_embedding_dimensions_check CHECK ((embedding_dimensions = 768)),
    CONSTRAINT ai_documents_index_version_check CHECK ((index_version > 0))
);


--
-- Name: ai_index_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ai_index_jobs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.ai_index_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: announcement_seen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_seen (
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    publish_from date,
    publish_to date,
    milestone_date date,
    CONSTRAINT announcements_category_check CHECK ((category = ANY (ARRAY['general'::text, 'important'::text, 'event'::text]))),
    CONSTRAINT announcements_publish_range_chk CHECK (((publish_from IS NULL) OR (publish_to IS NULL) OR (publish_from <= publish_to)))
);


--
-- Name: attendance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    member_id uuid NOT NULL,
    date date NOT NULL,
    type text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attendance_records_type_check CHECK ((type = ANY (ARRAY['work'::text, 'remote'::text, 'annual'::text, 'half'::text, 'quarter'::text, 'sick'::text, 'trip'::text, 'official'::text, 'absent'::text])))
);


--
-- Name: change_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_logs (
    id bigint NOT NULL,
    user_id uuid,
    wbs_item_id uuid,
    field text NOT NULL,
    old_value text,
    new_value text,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: change_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.change_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: change_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.change_logs_id_seq OWNED BY public.change_logs.id;


--
-- Name: deliverable_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliverable_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wbs_item_id uuid NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    size bigint,
    mime text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holidays (
    project_id uuid NOT NULL,
    date date NOT NULL,
    name text
);


--
-- Name: issue_analysis_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_analysis_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    input_hash text NOT NULL,
    prompt_version text NOT NULL,
    model text NOT NULL,
    status text DEFAULT 'ready'::text NOT NULL,
    analysis_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    input_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    issue_count integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT issue_analysis_runs_analysis_json_check CHECK ((jsonb_typeof(analysis_json) = 'object'::text)),
    CONSTRAINT issue_analysis_runs_input_hash_check CHECK ((input_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT issue_analysis_runs_input_snapshot_check CHECK ((jsonb_typeof(input_snapshot) = 'object'::text)),
    CONSTRAINT issue_analysis_runs_issue_count_check CHECK ((issue_count >= 0)),
    CONSTRAINT issue_analysis_runs_model_check CHECK (((length(TRIM(BOTH FROM model)) >= 1) AND (length(TRIM(BOTH FROM model)) <= 200))),
    CONSTRAINT issue_analysis_runs_prompt_version_check CHECK (((length(TRIM(BOTH FROM prompt_version)) >= 1) AND (length(TRIM(BOTH FROM prompt_version)) <= 100))),
    CONSTRAINT issue_analysis_runs_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'failed'::text])))
);


--
-- Name: issue_assignees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_assignees (
    issue_id uuid NOT NULL,
    member_id uuid NOT NULL,
    project_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: issue_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    issue_id uuid NOT NULL,
    project_id uuid NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    size bigint,
    mime text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: issue_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    issue_id uuid NOT NULL,
    project_id uuid NOT NULL,
    link_type text DEFAULT 'minute_block'::text NOT NULL,
    minute_id uuid NOT NULL,
    minute_version_id uuid NOT NULL,
    minute_version_no integer NOT NULL,
    source_project_id uuid,
    minute_title_snapshot text NOT NULL,
    minute_date_snapshot date NOT NULL,
    body_hash text NOT NULL,
    block_index integer NOT NULL,
    block_hash text NOT NULL,
    excerpt_snapshot text NOT NULL,
    source_kind text DEFAULT 'manual'::text NOT NULL,
    source_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT issue_links_block_hash_check CHECK ((btrim(block_hash) <> ''::text)),
    CONSTRAINT issue_links_block_index_check CHECK ((block_index >= 0)),
    CONSTRAINT issue_links_body_hash_check CHECK ((btrim(body_hash) <> ''::text)),
    CONSTRAINT issue_links_excerpt_check CHECK ((btrim(excerpt_snapshot) <> ''::text)),
    CONSTRAINT issue_links_link_type_check CHECK ((link_type = 'minute_block'::text)),
    CONSTRAINT issue_links_source_key_check CHECK (((source_key IS NULL) OR (btrim(source_key) <> ''::text))),
    CONSTRAINT issue_links_source_kind_check CHECK ((source_kind = ANY (ARRAY['manual'::text, 'action'::text, 'risk'::text]))),
    CONSTRAINT issue_links_version_no_check CHECK ((minute_version_no > 0))
);


--
-- Name: issue_major_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_major_processes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    mega_code text NOT NULL,
    major_seq bigint NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT issue_major_processes_name_check CHECK (((btrim(name) <> ''::text) AND (name = btrim(name)) AND (char_length(name) <= 100) AND (name !~ '^[[({（【]?[[:space:]]*[0-9]{2}(\.[0-9]{2})+'::text))),
    CONSTRAINT issue_major_processes_seq_check CHECK ((major_seq > 0))
);


--
-- Name: issue_mega_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_mega_areas (
    code text NOT NULL,
    name text NOT NULL,
    sort_order integer NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT issue_mega_areas_code_check CHECK ((code ~ '^[0-9]{2}$'::text)),
    CONSTRAINT issue_mega_areas_name_check CHECK ((btrim(name) <> ''::text))
);


--
-- Name: issue_number_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_number_counters (
    project_id uuid NOT NULL,
    mega_code text NOT NULL,
    last_no bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT issue_number_counters_last_no_check CHECK ((last_no > 0))
);


--
-- Name: issue_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    issue_id uuid NOT NULL,
    project_id uuid NOT NULL,
    kind text DEFAULT 'note'::text NOT NULL,
    category text,
    body text NOT NULL,
    mentioned_member_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    author_user_id uuid,
    author_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    archived_by_name text,
    CONSTRAINT issue_updates_archive_pair_ck CHECK ((num_nonnulls(archived_at, archived_by_name) = ANY (ARRAY[0, 2]))),
    CONSTRAINT issue_updates_body_len_ck CHECK (((length(body) >= 1) AND (length(body) <= 4000))),
    CONSTRAINT issue_updates_category_ck CHECK (((category IS NULL) OR (category = ANY (ARRAY['action'::text, 'discuss'::text, 'followup'::text, 'etc'::text])))),
    CONSTRAINT issue_updates_kind_ck CHECK ((kind = ANY (ARRAY['note'::text, 'status'::text])))
);


--
-- Name: issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    issue_no bigint NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    assignee_member_id uuid,
    due_date date,
    resolution_note text DEFAULT ''::text NOT NULL,
    resolved_at timestamp with time zone,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    start_date date,
    mega_code text,
    mega_seq bigint,
    pi_issue_code text,
    sub_process text DEFAULT ''::text NOT NULL,
    owner_department text DEFAULT ''::text NOT NULL,
    related_systems text[] DEFAULT '{}'::text[] NOT NULL,
    source_type text,
    source_detail text DEFAULT ''::text NOT NULL,
    major_id uuid,
    CONSTRAINT issues_analysis_code_consistency_check CHECK ((((mega_code IS NULL) AND (mega_seq IS NULL) AND (pi_issue_code IS NULL)) OR ((mega_code IS NOT NULL) AND (mega_seq IS NOT NULL) AND (mega_seq > 0) AND (pi_issue_code = ((('PI-I-'::text || mega_code) || '-'::text) || lpad((mega_seq)::text, 2, '0'::text)))))),
    CONSTRAINT issues_analysis_metadata_check CHECK (((char_length(sub_process) <= 200) AND (char_length(owner_department) <= 100) AND public.issue_related_systems_valid(related_systems) AND (char_length(source_detail) <= 1000) AND ((source_type IS NULL) OR (source_type = ANY (ARRAY['minutes'::text, 'interview'::text, 'deliverable'::text, 'as_is_analysis'::text, 'data_analysis'::text, 'other'::text]))) AND ((mega_code IS NULL) OR ((btrim(sub_process) <> ''::text) AND (btrim(owner_department) <> ''::text) AND (source_type IS NOT NULL))))),
    CONSTRAINT issues_date_range_check CHECK (((start_date IS NULL) OR (due_date IS NULL) OR (start_date <= due_date))),
    CONSTRAINT issues_major_requires_mega_check CHECK (((major_id IS NULL) OR (mega_code IS NOT NULL))),
    CONSTRAINT issues_severity_check CHECK ((severity = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT issues_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'on_hold'::text])))
);


--
-- Name: issues_issue_no_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.issues ALTER COLUMN issue_no ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.issues_issue_no_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: item_owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_owners (
    wbs_item_id uuid NOT NULL,
    team_id uuid NOT NULL,
    kind text NOT NULL,
    CONSTRAINT item_owners_kind_check CHECK ((kind = ANY (ARRAY['primary'::text, 'support'::text])))
);


--
-- Name: llm_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_config (
    id integer DEFAULT 1 NOT NULL,
    mode text DEFAULT 'env'::text NOT NULL,
    active_profile_id bigint,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT llm_config_id_check CHECK ((id = 1)),
    CONSTRAINT llm_config_mode_check CHECK ((mode = ANY (ARRAY['env'::text, 'profile'::text, 'none'::text])))
);


--
-- Name: llm_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_profiles (
    id bigint NOT NULL,
    name text NOT NULL,
    preset_id text NOT NULL,
    provider text NOT NULL,
    base_url text,
    model text NOT NULL,
    auth_token text,
    max_input_tokens integer,
    max_output_tokens integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT llm_profiles_provider_check CHECK ((provider = ANY (ARRAY['gemini'::text, 'openai'::text])))
);


--
-- Name: llm_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.llm_profiles ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.llm_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: meeting_attendees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_attendees (
    meeting_id uuid NOT NULL,
    member_id uuid NOT NULL
);


--
-- Name: meeting_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_exceptions (
    meeting_id uuid NOT NULL,
    occurrence_date date NOT NULL,
    kind text DEFAULT 'cancelled'::text NOT NULL,
    CONSTRAINT meeting_exceptions_kind_check CHECK ((kind = 'cancelled'::text))
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    meeting_date date NOT NULL,
    start_time text,
    end_time text,
    location text,
    category text DEFAULT 'general'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    recurrence text DEFAULT 'none'::text NOT NULL,
    recurrence_until date,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meetings_category_check CHECK ((category = ANY (ARRAY['general'::text, 'routine'::text, 'kickoff'::text, 'review'::text, 'report'::text, 'external'::text]))),
    CONSTRAINT meetings_end_time_fmt CHECK (((end_time IS NULL) OR (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text))),
    CONSTRAINT meetings_recur_none CHECK (((recurrence <> 'none'::text) OR (recurrence_until IS NULL))),
    CONSTRAINT meetings_recur_until CHECK (((recurrence_until IS NULL) OR (recurrence_until >= meeting_date))),
    CONSTRAINT meetings_recurrence_check CHECK ((recurrence = ANY (ARRAY['none'::text, 'daily'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text]))),
    CONSTRAINT meetings_start_time_fmt CHECK (((start_time IS NULL) OR (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text))),
    CONSTRAINT meetings_time_order CHECK (((end_time IS NULL) OR ((start_time IS NOT NULL) AND (end_time > start_time))))
);


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    role text NOT NULL,
    is_superuser boolean DEFAULT false NOT NULL,
    CONSTRAINT memberships_role_check CHECK ((role = ANY (ARRAY['pmo_admin'::text, 'team_editor'::text])))
);


--
-- Name: minute_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minute_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    minute_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    embedding public.vector(768) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: minute_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minute_favorites (
    user_id uuid NOT NULL,
    minute_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: minute_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minute_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    minute_id uuid NOT NULL,
    role text NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    size bigint NOT NULL,
    mime text NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT minute_files_role_check CHECK ((role = ANY (ARRAY['body'::text, 'attachment'::text])))
);


--
-- Name: minute_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minute_folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    sort integer DEFAULT 100 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid,
    CONSTRAINT minute_folders_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60)))
);


--
-- Name: minute_highlights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minute_highlights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    minute_id uuid NOT NULL,
    block_index integer NOT NULL,
    block_hash text NOT NULL,
    created_by uuid NOT NULL,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT minute_highlights_block_index_check CHECK ((block_index >= 0))
);


--
-- Name: minute_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minute_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    minute_id uuid NOT NULL,
    body_hash text NOT NULL,
    kind text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    block_index integer NOT NULL,
    block_hash text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT minute_insights_kind_check CHECK ((kind = ANY (ARRAY['decision'::text, 'action'::text, 'deadline'::text, 'risk'::text, 'none'::text])))
);


--
-- Name: minute_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minute_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    minute_id uuid NOT NULL,
    version_no integer NOT NULL,
    body_md text NOT NULL,
    body_hash text NOT NULL,
    title text NOT NULL,
    minute_date date NOT NULL,
    team_code text NOT NULL,
    project_id uuid,
    meeting_id uuid,
    meeting_occurrence_date date,
    file_name text,
    file_path text,
    file_size bigint,
    file_mime text,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT minute_versions_body_hash_check CHECK ((body_hash <> ''::text)),
    CONSTRAINT minute_versions_file_size_check CHECK (((file_size IS NULL) OR (file_size >= 0))),
    CONSTRAINT minute_versions_version_no_check CHECK ((version_no > 0))
);


--
-- Name: minutes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minutes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    minute_date date NOT NULL,
    team_code text NOT NULL,
    title text NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    meeting_id uuid,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    share_token uuid,
    share_enabled boolean DEFAULT false NOT NULL,
    external_id text,
    body_preview text GENERATED ALWAYS AS ("left"(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(body_md, '!?\[([^\]]*)\]\([^)]*\)'::text, '\1'::text, 'g'::text), '[#*_`~>|]+'::text, ''::text, 'g'::text), '(^|\n)\s*[-+]\s+'::text, '\1'::text, 'g'::text), '\s+'::text, ' '::text, 'g'::text)), 240)) STORED,
    folder_id uuid,
    project_id uuid,
    meeting_occurrence_date date,
    archived_at timestamp with time zone
);


--
-- Name: notification_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    category text NOT NULL,
    audience text DEFAULT 'direct'::text NOT NULL,
    project_id uuid,
    actor_user_id uuid,
    entity_type text,
    entity_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_events_audience_check CHECK ((audience = ANY (ARRAY['direct'::text, 'project'::text, 'global'::text]))),
    CONSTRAINT notification_events_category_check CHECK ((category = ANY (ARRAY['work'::text, 'issue'::text, 'meeting'::text, 'announce'::text, 'system'::text])))
);


--
-- Name: notification_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    member_id uuid,
    user_id uuid,
    seen_at timestamp with time zone,
    read_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_recipients_identity CHECK (((member_id IS NOT NULL) OR (user_id IS NOT NULL)))
);


--
-- Name: project_ai_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_ai_briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    kind text NOT NULL,
    cache_key text DEFAULT ''::text NOT NULL,
    input_hash text NOT NULL,
    headline text DEFAULT ''::text NOT NULL,
    body_md text DEFAULT ''::text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_ai_briefs_kind_check CHECK ((kind = ANY (ARRAY['weekly'::text, 'risk'::text]))),
    CONSTRAINT project_ai_briefs_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'none'::text])))
);


--
-- Name: project_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    token uuid NOT NULL,
    email text NOT NULL,
    team_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    redeemed_by uuid,
    redeemed_at timestamp with time zone,
    CONSTRAINT project_invites_email_normalized CHECK (((email = lower(btrim(email))) AND (email <> ''::text))),
    CONSTRAINT project_invites_redeem_pair CHECK (((redeemed_by IS NULL) OR (redeemed_at IS NOT NULL)))
);


--
-- Name: project_member_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_member_identities (
    email text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_member_identities_email_normalized CHECK (((email = lower(btrim(email))) AND (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'::text))),
    CONSTRAINT project_member_identities_name_normalized CHECK (((name = btrim(name)) AND (name <> ''::text)))
);


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    team_id uuid,
    role text DEFAULT 'contributor'::text NOT NULL,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    role_label text,
    CONSTRAINT project_members_email_format CHECK (((email IS NULL) OR (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'::text))),
    CONSTRAINT project_members_name_normalized CHECK (((name = btrim(name)) AND (name <> ''::text))),
    CONSTRAINT project_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'contributor'::text])))
);


--
-- Name: project_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_roles (
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_roles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: project_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_settings (
    project_id uuid NOT NULL,
    level_labels text[] DEFAULT ARRAY['Phase'::text, 'Task'::text, 'Activity'::text] NOT NULL,
    max_depth integer,
    extra_axis_label text,
    milestone_keywords text[] DEFAULT ARRAY[]::text[] NOT NULL,
    excel_profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled_modules text[],
    weekly_sections text[],
    working_days integer[],
    timezone text,
    preset_applied text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    stage_credits jsonb,
    force_bottleneck_min_successors integer DEFAULT 3 NOT NULL,
    force_bottleneck_min_hours integer DEFAULT 4 NOT NULL,
    CONSTRAINT project_settings_force_bottleneck_positive CHECK (((force_bottleneck_min_successors >= 1) AND (force_bottleneck_min_hours >= 1)))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    start_date date,
    end_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    base_date date,
    is_private boolean DEFAULT false NOT NULL
);


--
-- Name: task_dependencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_dependencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    predecessor_id uuid NOT NULL,
    successor_id uuid NOT NULL,
    dependency_type text DEFAULT 'FS'::text NOT NULL,
    lag_days integer DEFAULT 0 NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_dependencies_dependency_type_check CHECK ((dependency_type = ANY (ARRAY['FS'::text, 'SS'::text]))),
    CONSTRAINT task_dependencies_lag_days_check CHECK (((lag_days >= 0) AND (lag_days <= 365))),
    CONSTRAINT task_dependencies_not_self CHECK ((predecessor_id <> successor_id))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    progress_visible boolean DEFAULT true NOT NULL,
    project_id uuid
);


--
-- Name: usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_events (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    menu_key text NOT NULL,
    path text NOT NULL,
    project_id uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    event_name text DEFAULT 'page_view'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT usage_events_event_name_check CHECK (((btrim(event_name) <> ''::text) AND (char_length(event_name) <= 80))),
    CONSTRAINT usage_events_metadata_object_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);


--
-- Name: usage_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usage_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usage_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usage_events_id_seq OWNED BY public.usage_events.id;


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_wbs_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_wbs_state (
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    collapsed jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wbs_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wbs_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    kind text NOT NULL,
    ref_id uuid,
    content text NOT NULL,
    embedding public.vector(768),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wbs_embeddings_kind_check CHECK ((kind = ANY (ARRAY['wbs_item'::text, 'project'::text, 'member'::text])))
);


--
-- Name: wbs_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wbs_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    parent_id uuid,
    code text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    name text NOT NULL,
    biz text,
    deliverable text,
    planned_start date,
    planned_end date,
    weight numeric,
    actual_pct numeric,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_owner_split boolean DEFAULT false NOT NULL,
    assignee_member_id uuid,
    stage text,
    external_ref text,
    category text,
    domain text,
    priority text,
    model text,
    tags text[],
    depends text[],
    prd_ref text,
    entry_point text,
    acceptance jsonb DEFAULT '[]'::jsonb NOT NULL,
    spec text,
    dev_workflow boolean DEFAULT false NOT NULL,
    level_idx smallint,
    milestone boolean DEFAULT false NOT NULL,
    credit_key text,
    if_id text,
    agent_prompt text,
    depends_waived text[] DEFAULT '{}'::text[] NOT NULL,
    stub_for text,
    CONSTRAINT wbs_items_actual_pct_check CHECK (((actual_pct >= (0)::numeric) AND (actual_pct <= (100)::numeric))),
    CONSTRAINT wbs_items_depends_waived_subset CHECK ((depends_waived <@ COALESCE(depends, '{}'::text[]))),
    CONSTRAINT wbs_items_priority_check CHECK ((priority = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT wbs_items_stage_check CHECK ((stage = ANY (ARRAY['as'::text, 'ip'::text, 'im'::text, 'xx'::text]))),
    CONSTRAINT wbs_items_stub_for_parent CHECK (((stub_for IS NULL) OR (parent_id IS NOT NULL)))
);


--
-- Name: wbs_progress_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wbs_progress_snapshots (
    project_id uuid NOT NULL,
    snap_date date NOT NULL,
    actual_pct numeric(5,2) NOT NULL,
    planned_pct numeric(5,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wbs_progress_snapshots_actual_pct_check CHECK (((actual_pct >= (0)::numeric) AND (actual_pct <= (100)::numeric))),
    CONSTRAINT wbs_progress_snapshots_planned_pct_check CHECK (((planned_pct >= (0)::numeric) AND (planned_pct <= (100)::numeric)))
);


--
-- Name: weekly_report_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_report_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    section text DEFAULT ''::text NOT NULL,
    module text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 1 NOT NULL,
    this_content text DEFAULT ''::text NOT NULL,
    this_issue text DEFAULT ''::text NOT NULL,
    next_content text DEFAULT ''::text NOT NULL,
    next_issue text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: weekly_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    week_start date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    title text DEFAULT ''::text NOT NULL
);


--
-- Name: wiki_change_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_change_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    wiki_item_id uuid,
    minute_id uuid,
    source_id uuid,
    minute_version_id uuid,
    source_body_hash text,
    source_block_index integer,
    source_block_hash text,
    change_type text NOT NULL,
    before_snapshot jsonb,
    after_snapshot jsonb,
    reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key text,
    actor_id uuid,
    CONSTRAINT wiki_change_events_after_snapshot_check CHECK (((after_snapshot IS NULL) OR (jsonb_typeof(after_snapshot) = 'object'::text))),
    CONSTRAINT wiki_change_events_before_snapshot_check CHECK (((before_snapshot IS NULL) OR (jsonb_typeof(before_snapshot) = 'object'::text))),
    CONSTRAINT wiki_change_events_change_type_check CHECK ((change_type = ANY (ARRAY['new'::text, 'reaffirm'::text, 'refine'::text, 'supersede'::text, 'reverse'::text, 'conflict'::text, 'resolve'::text, 'retract'::text, 'curate'::text]))),
    CONSTRAINT wiki_change_events_source_block_check CHECK (((source_block_index IS NULL) OR (source_block_index >= 0))),
    CONSTRAINT wiki_change_events_source_provenance_check CHECK (((source_id IS NULL) OR ((minute_version_id IS NOT NULL) AND (source_body_hash IS NOT NULL) AND (source_block_index IS NOT NULL) AND (source_block_hash IS NOT NULL))))
);


--
-- Name: wiki_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    topic_id uuid NOT NULL,
    feedback_type text NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    comment text,
    resolution text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_feedback_comment_check CHECK (((comment IS NULL) OR (char_length(comment) <= 500))),
    CONSTRAINT wiki_feedback_feedback_type_check CHECK ((feedback_type = ANY (ARRAY['helpful'::text, 'outdated'::text]))),
    CONSTRAINT wiki_feedback_resolution_check CHECK (((resolution IS NULL) OR (char_length(resolution) <= 4000))),
    CONSTRAINT wiki_feedback_resolution_state_check CHECK ((((resolution IS NULL) AND (resolved_at IS NULL)) OR ((resolution IS NOT NULL) AND (btrim(resolution) <> ''::text) AND (resolved_at IS NOT NULL))))
);


--
-- Name: wiki_item_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_item_relations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_item_id uuid NOT NULL,
    to_item_id uuid NOT NULL,
    relation text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_item_relations_not_self CHECK ((from_item_id <> to_item_id)),
    CONSTRAINT wiki_item_relations_relation_check CHECK ((relation = ANY (ARRAY['confirms'::text, 'supersedes'::text, 'contradicts'::text, 'implements'::text, 'blocks'::text, 'depends_on'::text])))
);


--
-- Name: wiki_item_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_item_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wiki_item_id uuid NOT NULL,
    minute_id uuid NOT NULL,
    minute_version_id uuid NOT NULL,
    body_hash text NOT NULL,
    block_index integer NOT NULL,
    block_hash text NOT NULL,
    evidence_excerpt text DEFAULT ''::text NOT NULL,
    relation text NOT NULL,
    retracted_at timestamp with time zone,
    retraction_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_item_sources_block_hash_check CHECK ((block_hash <> ''::text)),
    CONSTRAINT wiki_item_sources_block_index_check CHECK ((block_index >= 0)),
    CONSTRAINT wiki_item_sources_body_hash_check CHECK ((body_hash <> ''::text)),
    CONSTRAINT wiki_item_sources_relation_check CHECK ((relation = ANY (ARRAY['supports'::text, 'contradicts'::text, 'resolves'::text])))
);


--
-- Name: wiki_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    topic_id uuid NOT NULL,
    kind text NOT NULL,
    statement text NOT NULL,
    statement_hash text NOT NULL,
    knowledge_key text NOT NULL,
    lifecycle_state text DEFAULT 'active'::text NOT NULL,
    certainty text NOT NULL,
    decision_state text,
    owner_team text,
    owner_member_id uuid,
    due_date date,
    observed_at timestamp with time zone,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    origin text DEFAULT 'ai'::text NOT NULL,
    auto_update_locked boolean DEFAULT false NOT NULL,
    structured_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    review_state text DEFAULT 'accepted'::text NOT NULL,
    CONSTRAINT wiki_items_certainty_check CHECK ((certainty = ANY (ARRAY['explicit'::text, 'tentative'::text]))),
    CONSTRAINT wiki_items_decision_state_check CHECK (((decision_state IS NULL) OR (decision_state = ANY (ARRAY['proposed'::text, 'tentative'::text, 'confirmed'::text, 'reversed'::text])))),
    CONSTRAINT wiki_items_kind_check CHECK ((kind = ANY (ARRAY['decision'::text, 'fact'::text, 'action'::text, 'question'::text, 'risk'::text, 'constraint'::text, 'rationale'::text]))),
    CONSTRAINT wiki_items_knowledge_key_check CHECK ((knowledge_key <> ''::text)),
    CONSTRAINT wiki_items_lifecycle_state_check CHECK ((lifecycle_state = ANY (ARRAY['active'::text, 'open'::text, 'resolved'::text, 'superseded'::text, 'conflicted'::text, 'archived'::text]))),
    CONSTRAINT wiki_items_origin_check CHECK ((origin = ANY (ARRAY['ai'::text, 'manual'::text]))),
    CONSTRAINT wiki_items_review_state_check CHECK ((review_state = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text]))),
    CONSTRAINT wiki_items_statement_check CHECK ((btrim(statement) <> ''::text)),
    CONSTRAINT wiki_items_statement_hash_check CHECK ((statement_hash <> ''::text)),
    CONSTRAINT wiki_items_structured_data_check CHECK ((jsonb_typeof(structured_data) = 'object'::text)),
    CONSTRAINT wiki_items_valid_range CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_to >= valid_from)))
);


--
-- Name: wiki_processing_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.wiki_processing_jobs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.wiki_processing_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: wiki_project_rebuild_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_project_rebuild_jobs (
    project_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    generation bigint DEFAULT 1 NOT NULL,
    reset_generation bigint,
    rerun_requested boolean DEFAULT false NOT NULL,
    cursor_observed_sort timestamp without time zone,
    cursor_minute_id uuid,
    step_observed_sort timestamp without time zone,
    step_minute_id uuid,
    step_minute_version_id uuid,
    step_rebuild_generation bigint,
    step_wiki_job_id bigint,
    step_wiki_apply_generation integer,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    reason text DEFAULT '프로젝트 Wiki 재구성'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_project_rebuild_cursor_pair CHECK ((((cursor_observed_sort IS NULL) AND (cursor_minute_id IS NULL)) OR ((cursor_observed_sort IS NOT NULL) AND (cursor_minute_id IS NOT NULL)))),
    CONSTRAINT wiki_project_rebuild_jobs_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT wiki_project_rebuild_jobs_generation_check CHECK ((generation > 0)),
    CONSTRAINT wiki_project_rebuild_jobs_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT wiki_project_rebuild_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'dead_letter'::text]))),
    CONSTRAINT wiki_project_rebuild_step_bundle CHECK ((((step_observed_sort IS NULL) AND (step_minute_id IS NULL) AND (step_minute_version_id IS NULL) AND (step_rebuild_generation IS NULL) AND (step_wiki_job_id IS NULL) AND (step_wiki_apply_generation IS NULL)) OR ((step_observed_sort IS NOT NULL) AND (step_minute_id IS NOT NULL) AND (step_minute_version_id IS NOT NULL) AND (step_rebuild_generation IS NOT NULL) AND (step_wiki_job_id IS NOT NULL) AND (step_wiki_apply_generation IS NOT NULL))))
);


--
-- Name: wiki_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    topic_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    question text NOT NULL,
    answer text,
    asked_by uuid DEFAULT auth.uid(),
    answered_by uuid,
    answered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_questions_answer_check CHECK (((answer IS NULL) OR (char_length(answer) <= 20000))),
    CONSTRAINT wiki_questions_answer_state_check CHECK (((status <> 'answered'::text) OR ((answer IS NOT NULL) AND (btrim(answer) <> ''::text) AND (answered_at IS NOT NULL)))),
    CONSTRAINT wiki_questions_question_check CHECK (((btrim(question) <> ''::text) AND (char_length(question) <= 2000))),
    CONSTRAINT wiki_questions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'answered'::text, 'closed'::text])))
);


--
-- Name: wiki_topic_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_topic_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic_id uuid NOT NULL,
    project_id uuid NOT NULL,
    version_no integer NOT NULL,
    title text NOT NULL,
    body_md text NOT NULL,
    body_hash text NOT NULL,
    document_kind text NOT NULL,
    edited_by uuid,
    edited_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_topic_revisions_body_hash_check CHECK ((body_hash <> ''::text)),
    CONSTRAINT wiki_topic_revisions_document_kind_check CHECK ((document_kind = ANY (ARRAY['overview'::text, 'decision'::text, 'how_to'::text, 'runbook'::text, 'faq'::text, 'glossary'::text, 'reference'::text]))),
    CONSTRAINT wiki_topic_revisions_title_check CHECK ((btrim(title) <> ''::text)),
    CONSTRAINT wiki_topic_revisions_version_no_check CHECK ((version_no > 0))
);


--
-- Name: wiki_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    normalized_title text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    type text DEFAULT 'general'::text NOT NULL,
    owner_team text,
    last_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    body_md text,
    body_updated_at timestamp with time zone,
    body_updated_by uuid,
    parent_id uuid,
    sort integer DEFAULT 0 NOT NULL,
    pinned_order integer,
    origin text DEFAULT 'ai'::text NOT NULL,
    document_kind text DEFAULT 'reference'::text NOT NULL,
    verified_at timestamp with time zone,
    verified_by uuid,
    review_due_at timestamp with time zone,
    CONSTRAINT wiki_topics_document_kind_check CHECK ((document_kind = ANY (ARRAY['overview'::text, 'decision'::text, 'how_to'::text, 'runbook'::text, 'faq'::text, 'glossary'::text, 'reference'::text]))),
    CONSTRAINT wiki_topics_normalized_title_check CHECK ((normalized_title <> ''::text)),
    CONSTRAINT wiki_topics_not_own_parent_check CHECK (((parent_id IS NULL) OR (parent_id <> id))),
    CONSTRAINT wiki_topics_origin_check CHECK ((origin = ANY (ARRAY['ai'::text, 'manual'::text]))),
    CONSTRAINT wiki_topics_pinned_order_check CHECK (((pinned_order IS NULL) OR (pinned_order >= 0))),
    CONSTRAINT wiki_topics_review_due_check CHECK (((review_due_at IS NULL) OR (verified_at IS NULL) OR (review_due_at >= verified_at))),
    CONSTRAINT wiki_topics_title_check CHECK ((btrim(title) <> ''::text)),
    CONSTRAINT wiki_topics_type_check CHECK ((type = ANY (ARRAY['process'::text, 'system'::text, 'interface'::text, 'data'::text, 'policy'::text, 'glossary'::text, 'general'::text])))
);


--
-- Name: change_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_logs ALTER COLUMN id SET DEFAULT nextval('public.change_logs_id_seq'::regclass);


--
-- Name: usage_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events ALTER COLUMN id SET DEFAULT nextval('public.usage_events_id_seq'::regclass);


--
-- Name: agent_lead_leases agent_lead_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_lead_leases
    ADD CONSTRAINT agent_lead_leases_pkey PRIMARY KEY (user_id, project_id);


--
-- Name: agent_projects agent_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_projects
    ADD CONSTRAINT agent_projects_pkey PRIMARY KEY (project_id);


--
-- Name: agent_runners agent_runners_owner_user_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runners
    ADD CONSTRAINT agent_runners_owner_user_id_name_key UNIQUE (owner_user_id, name);


--
-- Name: agent_runners agent_runners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runners
    ADD CONSTRAINT agent_runners_pkey PRIMARY KEY (id);


--
-- Name: agent_runners agent_runners_token_prefix_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runners
    ADD CONSTRAINT agent_runners_token_prefix_key UNIQUE (token_prefix);


--
-- Name: agent_watchers agent_watchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_watchers
    ADD CONSTRAINT agent_watchers_pkey PRIMARY KEY (id);


--
-- Name: agent_watchers agent_watchers_user_id_agent_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_watchers
    ADD CONSTRAINT agent_watchers_user_id_agent_key UNIQUE (user_id, agent);


--
-- Name: agent_work_orders agent_work_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_orders
    ADD CONSTRAINT agent_work_orders_pkey PRIMARY KEY (id);


--
-- Name: agent_work_reports agent_work_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_reports
    ADD CONSTRAINT agent_work_reports_pkey PRIMARY KEY (id);


--
-- Name: ai_documents ai_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_documents
    ADD CONSTRAINT ai_documents_pkey PRIMARY KEY (id);


--
-- Name: ai_documents ai_documents_stable_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_documents
    ADD CONSTRAINT ai_documents_stable_key UNIQUE (project_scope, domain, entity_type, entity_id, chunk_no, index_version);


--
-- Name: ai_index_jobs ai_index_jobs_job_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_index_jobs
    ADD CONSTRAINT ai_index_jobs_job_key_key UNIQUE (job_key);


--
-- Name: ai_index_jobs ai_index_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_index_jobs
    ADD CONSTRAINT ai_index_jobs_pkey PRIMARY KEY (id);


--
-- Name: announcement_seen announcement_seen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_seen
    ADD CONSTRAINT announcement_seen_pkey PRIMARY KEY (user_id, project_id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: attendance_records attendance_records_member_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_member_id_date_key UNIQUE (member_id, date);


--
-- Name: attendance_records attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);


--
-- Name: change_logs change_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_logs
    ADD CONSTRAINT change_logs_pkey PRIMARY KEY (id);


--
-- Name: deliverable_attachments deliverable_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverable_attachments
    ADD CONSTRAINT deliverable_attachments_pkey PRIMARY KEY (id);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (project_id, date);


--
-- Name: issue_analysis_runs issue_analysis_runs_input_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_analysis_runs
    ADD CONSTRAINT issue_analysis_runs_input_unique UNIQUE (project_id, input_hash, prompt_version);


--
-- Name: issue_analysis_runs issue_analysis_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_analysis_runs
    ADD CONSTRAINT issue_analysis_runs_pkey PRIMARY KEY (id);


--
-- Name: issue_assignees issue_assignees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_assignees
    ADD CONSTRAINT issue_assignees_pkey PRIMARY KEY (issue_id, member_id);


--
-- Name: issue_attachments issue_attachments_file_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_attachments
    ADD CONSTRAINT issue_attachments_file_path_key UNIQUE (file_path);


--
-- Name: issue_attachments issue_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_attachments
    ADD CONSTRAINT issue_attachments_pkey PRIMARY KEY (id);


--
-- Name: issue_links issue_links_issue_source_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_links
    ADD CONSTRAINT issue_links_issue_source_unique UNIQUE (issue_id, minute_version_id, block_index, block_hash, source_kind);


--
-- Name: issue_links issue_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_links
    ADD CONSTRAINT issue_links_pkey PRIMARY KEY (id);


--
-- Name: issue_major_processes issue_major_processes_identity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_identity_key UNIQUE (id, project_id, mega_code);


--
-- Name: issue_major_processes issue_major_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_pkey PRIMARY KEY (id);


--
-- Name: issue_major_processes issue_major_processes_project_mega_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_project_mega_name_key UNIQUE (project_id, mega_code, name);


--
-- Name: issue_major_processes issue_major_processes_project_mega_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_project_mega_seq_key UNIQUE (project_id, mega_code, major_seq);


--
-- Name: issue_mega_areas issue_mega_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_mega_areas
    ADD CONSTRAINT issue_mega_areas_pkey PRIMARY KEY (code);


--
-- Name: issue_mega_areas issue_mega_areas_sort_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_mega_areas
    ADD CONSTRAINT issue_mega_areas_sort_unique UNIQUE (sort_order);


--
-- Name: issue_number_counters issue_number_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_number_counters
    ADD CONSTRAINT issue_number_counters_pkey PRIMARY KEY (project_id, mega_code);


--
-- Name: issue_updates issue_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_updates
    ADD CONSTRAINT issue_updates_pkey PRIMARY KEY (id);


--
-- Name: issues issues_issue_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_issue_no_key UNIQUE (issue_no);


--
-- Name: issues issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_pkey PRIMARY KEY (id);


--
-- Name: item_owners item_owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_owners
    ADD CONSTRAINT item_owners_pkey PRIMARY KEY (wbs_item_id, team_id);


--
-- Name: llm_config llm_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_config
    ADD CONSTRAINT llm_config_pkey PRIMARY KEY (id);


--
-- Name: llm_profiles llm_profiles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_profiles
    ADD CONSTRAINT llm_profiles_name_key UNIQUE (name);


--
-- Name: llm_profiles llm_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_profiles
    ADD CONSTRAINT llm_profiles_pkey PRIMARY KEY (id);


--
-- Name: meeting_attendees meeting_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_pkey PRIMARY KEY (meeting_id, member_id);


--
-- Name: meeting_exceptions meeting_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_exceptions
    ADD CONSTRAINT meeting_exceptions_pkey PRIMARY KEY (meeting_id, occurrence_date);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (user_id);


--
-- Name: minute_embeddings minute_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_embeddings
    ADD CONSTRAINT minute_embeddings_pkey PRIMARY KEY (id);


--
-- Name: minute_favorites minute_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_favorites
    ADD CONSTRAINT minute_favorites_pkey PRIMARY KEY (user_id, minute_id);


--
-- Name: minute_files minute_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_files
    ADD CONSTRAINT minute_files_pkey PRIMARY KEY (id);


--
-- Name: minute_folders minute_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_folders
    ADD CONSTRAINT minute_folders_pkey PRIMARY KEY (id);


--
-- Name: minute_highlights minute_highlights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_highlights
    ADD CONSTRAINT minute_highlights_pkey PRIMARY KEY (id);


--
-- Name: minute_insights minute_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_insights
    ADD CONSTRAINT minute_insights_pkey PRIMARY KEY (id);


--
-- Name: minute_versions minute_versions_id_minute_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_versions
    ADD CONSTRAINT minute_versions_id_minute_unique UNIQUE (id, minute_id);


--
-- Name: minute_versions minute_versions_minute_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_versions
    ADD CONSTRAINT minute_versions_minute_version_unique UNIQUE (minute_id, version_no);


--
-- Name: minute_versions minute_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_versions
    ADD CONSTRAINT minute_versions_pkey PRIMARY KEY (id);


--
-- Name: minutes minutes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes
    ADD CONSTRAINT minutes_pkey PRIMARY KEY (id);


--
-- Name: notification_events notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_pkey PRIMARY KEY (id);


--
-- Name: notification_recipients notification_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_recipients
    ADD CONSTRAINT notification_recipients_pkey PRIMARY KEY (id);


--
-- Name: project_ai_briefs project_ai_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_ai_briefs
    ADD CONSTRAINT project_ai_briefs_pkey PRIMARY KEY (id);


--
-- Name: project_invites project_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_pkey PRIMARY KEY (id);


--
-- Name: project_invites project_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_token_key UNIQUE (token);


--
-- Name: project_member_identities project_member_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_member_identities
    ADD CONSTRAINT project_member_identities_pkey PRIMARY KEY (email);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (id);


--
-- Name: project_roles project_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_roles
    ADD CONSTRAINT project_roles_pkey PRIMARY KEY (project_id, user_id);


--
-- Name: project_settings project_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_settings
    ADD CONSTRAINT project_settings_pkey PRIMARY KEY (project_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: task_dependencies task_dependencies_pair_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT task_dependencies_pair_unique UNIQUE (predecessor_id, successor_id);


--
-- Name: task_dependencies task_dependencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT task_dependencies_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: teams teams_project_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_project_code_key UNIQUE NULLS NOT DISTINCT (project_id, code);


--
-- Name: usage_events usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: user_wbs_state user_wbs_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_wbs_state
    ADD CONSTRAINT user_wbs_state_pkey PRIMARY KEY (user_id, project_id);


--
-- Name: wbs_embeddings wbs_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wbs_embeddings
    ADD CONSTRAINT wbs_embeddings_pkey PRIMARY KEY (id);


--
-- Name: wbs_items wbs_items_id_project_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wbs_items
    ADD CONSTRAINT wbs_items_id_project_unique UNIQUE (id, project_id);


--
-- Name: wbs_items wbs_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wbs_items
    ADD CONSTRAINT wbs_items_pkey PRIMARY KEY (id);


--
-- Name: wbs_progress_snapshots wbs_progress_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wbs_progress_snapshots
    ADD CONSTRAINT wbs_progress_snapshots_pkey PRIMARY KEY (project_id, snap_date);


--
-- Name: weekly_report_rows weekly_report_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_report_rows
    ADD CONSTRAINT weekly_report_rows_pkey PRIMARY KEY (id);


--
-- Name: weekly_reports weekly_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_reports
    ADD CONSTRAINT weekly_reports_pkey PRIMARY KEY (id);


--
-- Name: weekly_reports weekly_reports_project_id_week_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_reports
    ADD CONSTRAINT weekly_reports_project_id_week_start_key UNIQUE (project_id, week_start);


--
-- Name: wiki_change_events wiki_change_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_change_events
    ADD CONSTRAINT wiki_change_events_pkey PRIMARY KEY (id);


--
-- Name: wiki_feedback wiki_feedback_id_project_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_feedback
    ADD CONSTRAINT wiki_feedback_id_project_unique UNIQUE (id, project_id);


--
-- Name: wiki_feedback wiki_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_feedback
    ADD CONSTRAINT wiki_feedback_pkey PRIMARY KEY (id);


--
-- Name: wiki_feedback wiki_feedback_user_topic_kind_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_feedback
    ADD CONSTRAINT wiki_feedback_user_topic_kind_unique UNIQUE (topic_id, user_id, feedback_type);


--
-- Name: wiki_item_relations wiki_item_relations_edge_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_item_relations
    ADD CONSTRAINT wiki_item_relations_edge_unique UNIQUE (from_item_id, to_item_id, relation);


--
-- Name: wiki_item_relations wiki_item_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_item_relations
    ADD CONSTRAINT wiki_item_relations_pkey PRIMARY KEY (id);


--
-- Name: wiki_item_sources wiki_item_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_item_sources
    ADD CONSTRAINT wiki_item_sources_pkey PRIMARY KEY (id);


--
-- Name: wiki_item_sources wiki_item_sources_source_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_item_sources
    ADD CONSTRAINT wiki_item_sources_source_unique UNIQUE (wiki_item_id, minute_version_id, block_index, relation);


--
-- Name: wiki_items wiki_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_items
    ADD CONSTRAINT wiki_items_pkey PRIMARY KEY (id);


--
-- Name: wiki_processing_jobs wiki_processing_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_processing_jobs
    ADD CONSTRAINT wiki_processing_jobs_pkey PRIMARY KEY (id);


--
-- Name: wiki_processing_jobs wiki_processing_jobs_project_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_processing_jobs
    ADD CONSTRAINT wiki_processing_jobs_project_version_unique UNIQUE (project_id, minute_version_id);


--
-- Name: wiki_project_rebuild_jobs wiki_project_rebuild_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_project_rebuild_jobs
    ADD CONSTRAINT wiki_project_rebuild_jobs_pkey PRIMARY KEY (project_id);


--
-- Name: wiki_questions wiki_questions_id_project_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_questions
    ADD CONSTRAINT wiki_questions_id_project_unique UNIQUE (id, project_id);


--
-- Name: wiki_questions wiki_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_questions
    ADD CONSTRAINT wiki_questions_pkey PRIMARY KEY (id);


--
-- Name: wiki_topic_revisions wiki_topic_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topic_revisions
    ADD CONSTRAINT wiki_topic_revisions_pkey PRIMARY KEY (id);


--
-- Name: wiki_topic_revisions wiki_topic_revisions_topic_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topic_revisions
    ADD CONSTRAINT wiki_topic_revisions_topic_version_unique UNIQUE (topic_id, version_no);


--
-- Name: wiki_topics wiki_topics_id_project_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topics
    ADD CONSTRAINT wiki_topics_id_project_unique UNIQUE (id, project_id);


--
-- Name: wiki_topics wiki_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topics
    ADD CONSTRAINT wiki_topics_pkey PRIMARY KEY (id);


--
-- Name: wiki_topics wiki_topics_project_title_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topics
    ADD CONSTRAINT wiki_topics_project_title_unique UNIQUE (project_id, normalized_title);


--
-- Name: agent_runners_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_runners_owner_idx ON public.agent_runners USING btree (owner_user_id);


--
-- Name: agent_watchers_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_watchers_last_seen_idx ON public.agent_watchers USING btree (last_seen_at);


--
-- Name: agent_work_orders_active_per_item_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_work_orders_active_per_item_uidx ON public.agent_work_orders USING btree (wbs_item_id) WHERE ((status = ANY (ARRAY['ready'::text, 'claimed'::text, 'reported'::text])) AND (wbs_item_id IS NOT NULL));


--
-- Name: agent_work_orders_claim_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_work_orders_claim_owner_idx ON public.agent_work_orders USING btree (claimed_by_user_id, status) WHERE (claimed_by_user_id IS NOT NULL);


--
-- Name: agent_work_orders_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_work_orders_item_idx ON public.agent_work_orders USING btree (wbs_item_id);


--
-- Name: agent_work_orders_project_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_work_orders_project_status_idx ON public.agent_work_orders USING btree (project_id, status);


--
-- Name: agent_work_orders_resume_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_work_orders_resume_idx ON public.agent_work_orders USING btree (claimed_by_user_id, resume_requested_at) WHERE (resume_requested_at IS NOT NULL);


--
-- Name: agent_work_reports_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_work_reports_order_idx ON public.agent_work_reports USING btree (work_order_id);


--
-- Name: ai_documents_content_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_documents_content_trgm_idx ON public.ai_documents USING gin (content public.gin_trgm_ops);


--
-- Name: ai_documents_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_documents_entity_idx ON public.ai_documents USING btree (domain, entity_type, entity_id, index_version);


--
-- Name: ai_documents_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_documents_occurred_idx ON public.ai_documents USING btree (occurred_on DESC) WHERE (occurred_on IS NOT NULL);


--
-- Name: ai_documents_project_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_documents_project_domain_idx ON public.ai_documents USING btree (project_id, domain, entity_type);


--
-- Name: ai_documents_title_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_documents_title_trgm_idx ON public.ai_documents USING gin (title public.gin_trgm_ops);


--
-- Name: ai_documents_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_documents_vector_idx ON public.ai_documents USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: ai_index_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_index_jobs_claim_idx ON public.ai_index_jobs USING btree (status, run_after, id);


--
-- Name: announcements_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_project_idx ON public.announcements USING btree (project_id, created_at DESC);


--
-- Name: announcements_publish_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_publish_window_idx ON public.announcements USING btree (project_id, publish_to);


--
-- Name: attendance_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_member_idx ON public.attendance_records USING btree (member_id);


--
-- Name: attendance_project_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_project_date_idx ON public.attendance_records USING btree (project_id, date);


--
-- Name: change_logs_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX change_logs_item_idx ON public.change_logs USING btree (wbs_item_id);


--
-- Name: deliverable_attachments_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deliverable_attachments_item_idx ON public.deliverable_attachments USING btree (wbs_item_id);


--
-- Name: idx_minutes_share_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_minutes_share_token ON public.minutes USING btree (share_token) WHERE (share_token IS NOT NULL);


--
-- Name: idx_teams_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_project ON public.teams USING btree (project_id);


--
-- Name: issue_analysis_runs_project_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_analysis_runs_project_created_idx ON public.issue_analysis_runs USING btree (project_id, created_at DESC);


--
-- Name: issue_assignees_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_assignees_member_idx ON public.issue_assignees USING btree (member_id);


--
-- Name: issue_assignees_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_assignees_project_idx ON public.issue_assignees USING btree (project_id);


--
-- Name: issue_attachments_issue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_attachments_issue_idx ON public.issue_attachments USING btree (issue_id, created_at DESC);


--
-- Name: issue_attachments_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_attachments_project_idx ON public.issue_attachments USING btree (project_id);


--
-- Name: issue_links_issue_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_links_issue_created_idx ON public.issue_links USING btree (issue_id, created_at);


--
-- Name: issue_links_minute_block_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_links_minute_block_idx ON public.issue_links USING btree (minute_id, minute_version_id, block_index, block_hash, created_at);


--
-- Name: issue_links_project_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_links_project_created_idx ON public.issue_links USING btree (project_id, created_at DESC);


--
-- Name: issue_links_source_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_links_source_key_idx ON public.issue_links USING btree (source_key) WHERE (source_key IS NOT NULL);


--
-- Name: issue_major_processes_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_major_processes_project_idx ON public.issue_major_processes USING btree (project_id, mega_code, major_seq);


--
-- Name: issue_updates_issue_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_updates_issue_created_idx ON public.issue_updates USING btree (issue_id, created_at DESC);


--
-- Name: issue_updates_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issue_updates_project_idx ON public.issue_updates USING btree (project_id);


--
-- Name: issues_id_project_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX issues_id_project_uidx ON public.issues USING btree (id, project_id);


--
-- Name: issues_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_project_idx ON public.issues USING btree (project_id, created_at DESC);


--
-- Name: issues_project_major_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_project_major_idx ON public.issues USING btree (project_id, major_id) WHERE (major_id IS NOT NULL);


--
-- Name: issues_project_mega_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_project_mega_idx ON public.issues USING btree (project_id, mega_code, mega_seq) WHERE (mega_code IS NOT NULL);


--
-- Name: issues_project_mega_seq_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX issues_project_mega_seq_uidx ON public.issues USING btree (project_id, mega_code, mega_seq) WHERE ((mega_code IS NOT NULL) AND (mega_seq IS NOT NULL));


--
-- Name: issues_project_pi_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX issues_project_pi_code_uidx ON public.issues USING btree (project_id, pi_issue_code) WHERE (pi_issue_code IS NOT NULL);


--
-- Name: meetings_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meetings_project_idx ON public.meetings USING btree (project_id, meeting_date);


--
-- Name: minute_embeddings_minute_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minute_embeddings_minute_idx ON public.minute_embeddings USING btree (minute_id);


--
-- Name: minute_embeddings_vec_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minute_embeddings_vec_idx ON public.minute_embeddings USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: minute_files_minute_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minute_files_minute_idx ON public.minute_files USING btree (minute_id);


--
-- Name: minute_files_one_body_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX minute_files_one_body_idx ON public.minute_files USING btree (minute_id) WHERE (role = 'body'::text);


--
-- Name: minute_folders_child_name_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX minute_folders_child_name_uniq ON public.minute_folders USING btree (parent_id, name) WHERE (parent_id IS NOT NULL);


--
-- Name: minute_folders_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minute_folders_project_idx ON public.minute_folders USING btree (project_id);


--
-- Name: minute_folders_root_name_null_proj_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX minute_folders_root_name_null_proj_uniq ON public.minute_folders USING btree (name) WHERE ((parent_id IS NULL) AND (project_id IS NULL));


--
-- Name: minute_folders_root_name_proj_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX minute_folders_root_name_proj_uniq ON public.minute_folders USING btree (project_id, name) WHERE ((parent_id IS NULL) AND (project_id IS NOT NULL));


--
-- Name: minute_highlights_minute_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minute_highlights_minute_idx ON public.minute_highlights USING btree (minute_id);


--
-- Name: minute_highlights_user_block_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX minute_highlights_user_block_idx ON public.minute_highlights USING btree (minute_id, created_by, block_index);


--
-- Name: minute_insights_block_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX minute_insights_block_kind_idx ON public.minute_insights USING btree (minute_id, block_index, kind);


--
-- Name: minute_insights_minute_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minute_insights_minute_idx ON public.minute_insights USING btree (minute_id);


--
-- Name: minute_versions_minute_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minute_versions_minute_created_idx ON public.minute_versions USING btree (minute_id, version_no DESC);


--
-- Name: minutes_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minutes_date_idx ON public.minutes USING btree (minute_date DESC);


--
-- Name: minutes_external_id_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX minutes_external_id_uidx ON public.minutes USING btree (external_id) WHERE (external_id IS NOT NULL);


--
-- Name: minutes_folder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minutes_folder_idx ON public.minutes USING btree (folder_id);


--
-- Name: minutes_project_archived_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minutes_project_archived_idx ON public.minutes USING btree (project_id, archived_at) WHERE (archived_at IS NOT NULL);


--
-- Name: minutes_project_occurrence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minutes_project_occurrence_idx ON public.minutes USING btree (project_id, meeting_occurrence_date DESC, minute_date DESC) WHERE (archived_at IS NULL);


--
-- Name: minutes_team_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX minutes_team_date_idx ON public.minutes USING btree (team_code, minute_date DESC);


--
-- Name: notification_events_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_events_dedupe ON public.notification_events USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: notification_events_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_events_project ON public.notification_events USING btree (project_id, created_at DESC);


--
-- Name: notification_recipients_badge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_recipients_badge ON public.notification_recipients USING btree (user_id) WHERE (seen_at IS NULL);


--
-- Name: notification_recipients_by_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_recipients_by_member ON public.notification_recipients USING btree (event_id, member_id) WHERE (member_id IS NOT NULL);


--
-- Name: notification_recipients_by_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_recipients_by_user ON public.notification_recipients USING btree (event_id, user_id) WHERE (member_id IS NULL);


--
-- Name: notification_recipients_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_recipients_feed ON public.notification_recipients USING btree (user_id, created_at DESC);


--
-- Name: project_ai_briefs_project_kind_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_ai_briefs_project_kind_key_idx ON public.project_ai_briefs USING btree (project_id, kind, cache_key);


--
-- Name: project_invites_active_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_invites_active_email_uidx ON public.project_invites USING btree (project_id, email) WHERE ((redeemed_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: project_invites_project_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_invites_project_created_idx ON public.project_invites USING btree (project_id, created_at DESC);


--
-- Name: project_member_identities_email_name_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_member_identities_email_name_uidx ON public.project_member_identities USING btree (email, name);


--
-- Name: project_members_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_members_email_idx ON public.project_members USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: project_members_id_project_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_members_id_project_uidx ON public.project_members USING btree (id, project_id);


--
-- Name: project_members_project_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_members_project_email_uidx ON public.project_members USING btree (project_id, email) WHERE (email IS NOT NULL);


--
-- Name: project_members_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_members_project_idx ON public.project_members USING btree (project_id);


--
-- Name: project_members_project_user_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_members_project_user_uidx ON public.project_members USING btree (project_id, user_id) WHERE (user_id IS NOT NULL);


--
-- Name: project_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_members_user_idx ON public.project_members USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: project_roles_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_roles_user_idx ON public.project_roles USING btree (user_id);


--
-- Name: task_dependencies_predecessor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_dependencies_predecessor_idx ON public.task_dependencies USING btree (predecessor_id);


--
-- Name: task_dependencies_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_dependencies_project_idx ON public.task_dependencies USING btree (project_id);


--
-- Name: task_dependencies_successor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_dependencies_successor_idx ON public.task_dependencies USING btree (successor_id);


--
-- Name: usage_events_event_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_event_name_idx ON public.usage_events USING btree (event_name, occurred_at DESC);


--
-- Name: usage_events_menu_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_menu_idx ON public.usage_events USING btree (menu_key, occurred_at DESC);


--
-- Name: usage_events_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_occurred_idx ON public.usage_events USING btree (occurred_at DESC);


--
-- Name: usage_events_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_user_idx ON public.usage_events USING btree (user_id, occurred_at DESC);


--
-- Name: wbs_embeddings_doc_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wbs_embeddings_doc_key ON public.wbs_embeddings USING btree (project_id, kind, ref_id) NULLS NOT DISTINCT;


--
-- Name: wbs_embeddings_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wbs_embeddings_project_idx ON public.wbs_embeddings USING btree (project_id);


--
-- Name: wbs_embeddings_vec_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wbs_embeddings_vec_idx ON public.wbs_embeddings USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: wbs_items_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wbs_items_parent_idx ON public.wbs_items USING btree (parent_id);


--
-- Name: wbs_items_project_external_ref_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wbs_items_project_external_ref_uidx ON public.wbs_items USING btree (project_id, external_ref) WHERE (external_ref IS NOT NULL);


--
-- Name: wbs_items_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wbs_items_project_idx ON public.wbs_items USING btree (project_id);


--
-- Name: wbs_items_stub_for_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wbs_items_stub_for_uidx ON public.wbs_items USING btree (parent_id, stub_for) WHERE (stub_for IS NOT NULL);


--
-- Name: weekly_report_rows_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX weekly_report_rows_report_idx ON public.weekly_report_rows USING btree (report_id, sort_order);


--
-- Name: wiki_change_events_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wiki_change_events_idempotency_uidx ON public.wiki_change_events USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: wiki_change_events_item_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_change_events_item_created_idx ON public.wiki_change_events USING btree (wiki_item_id, created_at DESC) WHERE (wiki_item_id IS NOT NULL);


--
-- Name: wiki_change_events_minute_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_change_events_minute_idx ON public.wiki_change_events USING btree (minute_id) WHERE (minute_id IS NOT NULL);


--
-- Name: wiki_change_events_project_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_change_events_project_created_idx ON public.wiki_change_events USING btree (project_id, created_at DESC);


--
-- Name: wiki_change_events_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_change_events_source_idx ON public.wiki_change_events USING btree (source_id) WHERE (source_id IS NOT NULL);


--
-- Name: wiki_feedback_project_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_feedback_project_open_idx ON public.wiki_feedback USING btree (project_id, feedback_type, created_at DESC) WHERE (resolved_at IS NULL);


--
-- Name: wiki_feedback_topic_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_feedback_topic_created_idx ON public.wiki_feedback USING btree (topic_id, created_at DESC);


--
-- Name: wiki_item_relations_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_item_relations_to_idx ON public.wiki_item_relations USING btree (to_item_id, relation);


--
-- Name: wiki_item_sources_active_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_item_sources_active_item_idx ON public.wiki_item_sources USING btree (wiki_item_id) WHERE (retracted_at IS NULL);


--
-- Name: wiki_item_sources_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_item_sources_item_idx ON public.wiki_item_sources USING btree (wiki_item_id, created_at);


--
-- Name: wiki_item_sources_minute_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_item_sources_minute_idx ON public.wiki_item_sources USING btree (minute_id, block_index);


--
-- Name: wiki_items_knowledge_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_items_knowledge_key_idx ON public.wiki_items USING btree (project_id, knowledge_key, observed_at DESC);


--
-- Name: wiki_items_open_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_items_open_due_idx ON public.wiki_items USING btree (project_id, due_date) WHERE ((due_date IS NOT NULL) AND (lifecycle_state = ANY (ARRAY['active'::text, 'open'::text, 'conflicted'::text])));


--
-- Name: wiki_items_owner_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_items_owner_member_idx ON public.wiki_items USING btree (owner_member_id, lifecycle_state) WHERE (owner_member_id IS NOT NULL);


--
-- Name: wiki_items_project_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_items_project_review_idx ON public.wiki_items USING btree (project_id, review_state, updated_at DESC);


--
-- Name: wiki_items_project_state_changed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_items_project_state_changed_idx ON public.wiki_items USING btree (project_id, lifecycle_state, updated_at DESC);


--
-- Name: wiki_items_statement_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_items_statement_hash_idx ON public.wiki_items USING btree (project_id, statement_hash);


--
-- Name: wiki_items_topic_kind_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_items_topic_kind_state_idx ON public.wiki_items USING btree (topic_id, kind, lifecycle_state);


--
-- Name: wiki_items_topic_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_items_topic_pending_idx ON public.wiki_items USING btree (topic_id, updated_at DESC) WHERE (review_state = 'pending'::text);


--
-- Name: wiki_processing_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_processing_jobs_claim_idx ON public.wiki_processing_jobs USING btree (status, run_after, id);


--
-- Name: wiki_processing_jobs_locked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_processing_jobs_locked_idx ON public.wiki_processing_jobs USING btree (locked_at) WHERE (status = 'running'::text);


--
-- Name: wiki_project_rebuild_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_project_rebuild_jobs_claim_idx ON public.wiki_project_rebuild_jobs USING btree (status, run_after, updated_at);


--
-- Name: wiki_questions_asked_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_questions_asked_by_idx ON public.wiki_questions USING btree (asked_by, created_at DESC);


--
-- Name: wiki_questions_project_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_questions_project_status_idx ON public.wiki_questions USING btree (project_id, status, updated_at DESC);


--
-- Name: wiki_questions_topic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_questions_topic_idx ON public.wiki_questions USING btree (topic_id, created_at DESC) WHERE (topic_id IS NOT NULL);


--
-- Name: wiki_topic_revisions_project_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_topic_revisions_project_created_idx ON public.wiki_topic_revisions USING btree (project_id, created_at DESC);


--
-- Name: wiki_topic_revisions_topic_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_topic_revisions_topic_created_idx ON public.wiki_topic_revisions USING btree (topic_id, version_no DESC);


--
-- Name: wiki_topics_project_changed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_topics_project_changed_idx ON public.wiki_topics USING btree (project_id, last_changed_at DESC);


--
-- Name: wiki_topics_project_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_topics_project_parent_idx ON public.wiki_topics USING btree (project_id, parent_id, sort, id);


--
-- Name: wiki_topics_project_pinned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_topics_project_pinned_idx ON public.wiki_topics USING btree (project_id, pinned_order) WHERE (pinned_order IS NOT NULL);


--
-- Name: wiki_topics_project_review_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_topics_project_review_due_idx ON public.wiki_topics USING btree (project_id, review_due_at) WHERE (review_due_at IS NOT NULL);


--
-- Name: ai_documents ai_documents_minute_scope_guard_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_documents_minute_scope_guard_trg BEFORE INSERT OR UPDATE ON public.ai_documents FOR EACH ROW EXECUTE FUNCTION public.guard_minute_ai_document_scope();


--
-- Name: minute_versions minute_versions_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER minute_versions_immutable_trg BEFORE DELETE OR UPDATE ON public.minute_versions FOR EACH ROW EXECUTE FUNCTION public.minute_versions_reject_mutation();


--
-- Name: minutes minutes_protect_external_id_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER minutes_protect_external_id_trg BEFORE INSERT OR UPDATE ON public.minutes FOR EACH ROW EXECUTE FUNCTION public.minutes_protect_external_id();


--
-- Name: notification_recipients notify_recipient_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notify_recipient_broadcast AFTER INSERT ON public.notification_recipients FOR EACH ROW EXECUTE FUNCTION public.notify_recipient_broadcast();


--
-- Name: project_members project_members_normalize_link_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_members_normalize_link_trg BEFORE INSERT OR UPDATE ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.project_members_normalize_link();


--
-- Name: issues trg_assign_issue_analysis_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_issue_analysis_code BEFORE INSERT OR UPDATE ON public.issues FOR EACH ROW EXECUTE FUNCTION public.assign_issue_analysis_code();


--
-- Name: issue_major_processes trg_assign_issue_major_seq; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_issue_major_seq BEFORE INSERT OR UPDATE ON public.issue_major_processes FOR EACH ROW EXECUTE FUNCTION public.assign_issue_major_seq();


--
-- Name: wbs_items trg_guard_dependent_wbs_dates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_dependent_wbs_dates BEFORE UPDATE OF planned_start, planned_end ON public.wbs_items FOR EACH ROW EXECUTE FUNCTION public.guard_dependent_wbs_dates();


--
-- Name: wbs_items trg_guard_non_admin_column_scope; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_non_admin_column_scope BEFORE UPDATE ON public.wbs_items FOR EACH ROW EXECUTE FUNCTION public.guard_non_admin_column_scope();


--
-- Name: task_dependencies trg_validate_task_dependency; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_task_dependency BEFORE INSERT OR UPDATE ON public.task_dependencies FOR EACH ROW EXECUTE FUNCTION public.validate_task_dependency();


--
-- Name: wbs_items wbs_items_broadcast; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wbs_items_broadcast AFTER UPDATE OF stage, actual_pct ON public.wbs_items FOR EACH ROW WHEN (((old.stage IS DISTINCT FROM new.stage) OR (old.actual_pct IS DISTINCT FROM new.actual_pct))) EXECUTE FUNCTION public.wbs_items_broadcast();


--
-- Name: wbs_items wbs_items_prune_waived; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wbs_items_prune_waived BEFORE UPDATE OF depends ON public.wbs_items FOR EACH ROW EXECUTE FUNCTION public.wbs_items_prune_waived();


--
-- Name: wiki_change_events wiki_change_events_source_provenance_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wiki_change_events_source_provenance_trg BEFORE INSERT OR UPDATE OF source_id ON public.wiki_change_events FOR EACH ROW EXECUTE FUNCTION public.wiki_change_events_copy_source_provenance();


--
-- Name: wiki_topic_revisions wiki_topic_revisions_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wiki_topic_revisions_immutable_trg BEFORE DELETE OR UPDATE ON public.wiki_topic_revisions FOR EACH ROW EXECUTE FUNCTION public.wiki_topic_revisions_reject_mutation();


--
-- Name: project_members zz_project_member_email_identity_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_project_member_email_identity_trg BEFORE INSERT OR UPDATE OF email, name ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.enforce_project_member_email_identity();


--
-- Name: agent_lead_leases agent_lead_leases_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_lead_leases
    ADD CONSTRAINT agent_lead_leases_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: agent_lead_leases agent_lead_leases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_lead_leases
    ADD CONSTRAINT agent_lead_leases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: agent_projects agent_projects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_projects
    ADD CONSTRAINT agent_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: agent_projects agent_projects_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_projects
    ADD CONSTRAINT agent_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: agent_runners agent_runners_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runners
    ADD CONSTRAINT agent_runners_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: agent_runners agent_runners_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runners
    ADD CONSTRAINT agent_runners_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: agent_runners agent_runners_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runners
    ADD CONSTRAINT agent_runners_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: agent_watchers agent_watchers_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_watchers
    ADD CONSTRAINT agent_watchers_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: agent_watchers agent_watchers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_watchers
    ADD CONSTRAINT agent_watchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: agent_work_orders agent_work_orders_claimed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_orders
    ADD CONSTRAINT agent_work_orders_claimed_by_user_id_fkey FOREIGN KEY (claimed_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: agent_work_orders agent_work_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_orders
    ADD CONSTRAINT agent_work_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: agent_work_orders agent_work_orders_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_orders
    ADD CONSTRAINT agent_work_orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: agent_work_orders agent_work_orders_resume_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_orders
    ADD CONSTRAINT agent_work_orders_resume_requested_by_fkey FOREIGN KEY (resume_requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: agent_work_orders agent_work_orders_wbs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_orders
    ADD CONSTRAINT agent_work_orders_wbs_item_id_fkey FOREIGN KEY (wbs_item_id) REFERENCES public.wbs_items(id) ON DELETE SET NULL;


--
-- Name: agent_work_reports agent_work_reports_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_reports
    ADD CONSTRAINT agent_work_reports_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);


--
-- Name: agent_work_reports agent_work_reports_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_reports
    ADD CONSTRAINT agent_work_reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);


--
-- Name: agent_work_reports agent_work_reports_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_work_reports
    ADD CONSTRAINT agent_work_reports_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.agent_work_orders(id) ON DELETE CASCADE;


--
-- Name: ai_documents ai_documents_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_documents
    ADD CONSTRAINT ai_documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: ai_index_jobs ai_index_jobs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_index_jobs
    ADD CONSTRAINT ai_index_jobs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: announcement_seen announcement_seen_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_seen
    ADD CONSTRAINT announcement_seen_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: announcement_seen announcement_seen_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_seen
    ADD CONSTRAINT announcement_seen_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: announcements announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: attendance_records attendance_member_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_member_project_fk FOREIGN KEY (member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE CASCADE;


--
-- Name: attendance_records attendance_records_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.project_members(id) ON DELETE CASCADE;


--
-- Name: attendance_records attendance_records_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: change_logs change_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_logs
    ADD CONSTRAINT change_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: change_logs change_logs_wbs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_logs
    ADD CONSTRAINT change_logs_wbs_item_id_fkey FOREIGN KEY (wbs_item_id) REFERENCES public.wbs_items(id) ON DELETE CASCADE;


--
-- Name: deliverable_attachments deliverable_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverable_attachments
    ADD CONSTRAINT deliverable_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);


--
-- Name: deliverable_attachments deliverable_attachments_wbs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverable_attachments
    ADD CONSTRAINT deliverable_attachments_wbs_item_id_fkey FOREIGN KEY (wbs_item_id) REFERENCES public.wbs_items(id) ON DELETE CASCADE;


--
-- Name: holidays holidays_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: issue_analysis_runs issue_analysis_runs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_analysis_runs
    ADD CONSTRAINT issue_analysis_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: issue_analysis_runs issue_analysis_runs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_analysis_runs
    ADD CONSTRAINT issue_analysis_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: issue_assignees issue_assignees_issue_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_assignees
    ADD CONSTRAINT issue_assignees_issue_project_fk FOREIGN KEY (issue_id, project_id) REFERENCES public.issues(id, project_id) ON DELETE CASCADE;


--
-- Name: issue_assignees issue_assignees_member_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_assignees
    ADD CONSTRAINT issue_assignees_member_project_fk FOREIGN KEY (member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE CASCADE;


--
-- Name: issue_attachments issue_attachments_issue_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_attachments
    ADD CONSTRAINT issue_attachments_issue_project_fk FOREIGN KEY (issue_id, project_id) REFERENCES public.issues(id, project_id) ON DELETE CASCADE;


--
-- Name: issue_attachments issue_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_attachments
    ADD CONSTRAINT issue_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: issue_links issue_links_issue_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_links
    ADD CONSTRAINT issue_links_issue_project_fk FOREIGN KEY (issue_id, project_id) REFERENCES public.issues(id, project_id) ON DELETE CASCADE;


--
-- Name: issue_links issue_links_version_minute_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_links
    ADD CONSTRAINT issue_links_version_minute_fk FOREIGN KEY (minute_version_id, minute_id) REFERENCES public.minute_versions(id, minute_id) ON DELETE RESTRICT;


--
-- Name: issue_major_processes issue_major_processes_mega_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_mega_code_fkey FOREIGN KEY (mega_code) REFERENCES public.issue_mega_areas(code) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: issue_major_processes issue_major_processes_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_major_processes
    ADD CONSTRAINT issue_major_processes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: issue_number_counters issue_number_counters_mega_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_number_counters
    ADD CONSTRAINT issue_number_counters_mega_code_fkey FOREIGN KEY (mega_code) REFERENCES public.issue_mega_areas(code) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: issue_number_counters issue_number_counters_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_number_counters
    ADD CONSTRAINT issue_number_counters_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: issue_updates issue_updates_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_updates
    ADD CONSTRAINT issue_updates_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: issue_updates issue_updates_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_updates
    ADD CONSTRAINT issue_updates_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: issue_updates issue_updates_issue_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_updates
    ADD CONSTRAINT issue_updates_issue_project_fk FOREIGN KEY (issue_id, project_id) REFERENCES public.issues(id, project_id) ON DELETE CASCADE;


--
-- Name: issues issues_assignee_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_assignee_project_fk FOREIGN KEY (assignee_member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE SET NULL (assignee_member_id);


--
-- Name: issues issues_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: issues issues_major_process_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_major_process_fk FOREIGN KEY (major_id, project_id, mega_code) REFERENCES public.issue_major_processes(id, project_id, mega_code) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: issues issues_mega_area_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_mega_area_fk FOREIGN KEY (mega_code) REFERENCES public.issue_mega_areas(code) ON UPDATE RESTRICT ON DELETE RESTRICT;


--
-- Name: issues issues_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: item_owners item_owners_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_owners
    ADD CONSTRAINT item_owners_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: item_owners item_owners_wbs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_owners
    ADD CONSTRAINT item_owners_wbs_item_id_fkey FOREIGN KEY (wbs_item_id) REFERENCES public.wbs_items(id) ON DELETE CASCADE;


--
-- Name: llm_config llm_config_active_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_config
    ADD CONSTRAINT llm_config_active_profile_id_fkey FOREIGN KEY (active_profile_id) REFERENCES public.llm_profiles(id) ON DELETE SET NULL;


--
-- Name: llm_config llm_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_config
    ADD CONSTRAINT llm_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meeting_attendees meeting_attendees_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_attendees meeting_attendees_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.project_members(id) ON DELETE CASCADE;


--
-- Name: meeting_exceptions meeting_exceptions_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_exceptions
    ADD CONSTRAINT meeting_exceptions_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meetings meetings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: minute_embeddings minute_embeddings_minute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_embeddings
    ADD CONSTRAINT minute_embeddings_minute_id_fkey FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE CASCADE;


--
-- Name: minute_favorites minute_favorites_minute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_favorites
    ADD CONSTRAINT minute_favorites_minute_id_fkey FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE CASCADE;


--
-- Name: minute_favorites minute_favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_favorites
    ADD CONSTRAINT minute_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: minute_files minute_files_minute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_files
    ADD CONSTRAINT minute_files_minute_id_fkey FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE CASCADE;


--
-- Name: minute_files minute_files_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_files
    ADD CONSTRAINT minute_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: minute_folders minute_folders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_folders
    ADD CONSTRAINT minute_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: minute_folders minute_folders_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_folders
    ADD CONSTRAINT minute_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.minute_folders(id) ON DELETE CASCADE;


--
-- Name: minute_folders minute_folders_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_folders
    ADD CONSTRAINT minute_folders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: minute_highlights minute_highlights_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_highlights
    ADD CONSTRAINT minute_highlights_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: minute_highlights minute_highlights_minute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_highlights
    ADD CONSTRAINT minute_highlights_minute_id_fkey FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE CASCADE;


--
-- Name: minute_insights minute_insights_minute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_insights
    ADD CONSTRAINT minute_insights_minute_id_fkey FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE CASCADE;


--
-- Name: minute_versions minute_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_versions
    ADD CONSTRAINT minute_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: minute_versions minute_versions_minute_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_versions
    ADD CONSTRAINT minute_versions_minute_fk FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE RESTRICT;


--
-- Name: minutes minutes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes
    ADD CONSTRAINT minutes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: minutes minutes_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes
    ADD CONSTRAINT minutes_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.minute_folders(id) ON DELETE SET NULL;


--
-- Name: minutes minutes_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes
    ADD CONSTRAINT minutes_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE SET NULL;


--
-- Name: minutes minutes_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes
    ADD CONSTRAINT minutes_project_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: notification_events notification_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: notification_recipients notification_recipients_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_recipients
    ADD CONSTRAINT notification_recipients_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.notification_events(id) ON DELETE CASCADE;


--
-- Name: notification_recipients notification_recipients_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_recipients
    ADD CONSTRAINT notification_recipients_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.project_members(id) ON DELETE CASCADE;


--
-- Name: notification_recipients notification_recipients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_recipients
    ADD CONSTRAINT notification_recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: project_ai_briefs project_ai_briefs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_ai_briefs
    ADD CONSTRAINT project_ai_briefs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_invites project_invites_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: project_invites project_invites_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_invites project_invites_redeemed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: project_invites project_invites_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;


--
-- Name: project_members project_members_email_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_email_name_fkey FOREIGN KEY (email, name) REFERENCES public.project_member_identities(email, name) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: project_members project_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: project_members project_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: project_roles project_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_roles
    ADD CONSTRAINT project_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: project_roles project_roles_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_roles
    ADD CONSTRAINT project_roles_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_roles project_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_roles
    ADD CONSTRAINT project_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: project_settings project_settings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_settings
    ADD CONSTRAINT project_settings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_settings project_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_settings
    ADD CONSTRAINT project_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: task_dependencies task_dependencies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT task_dependencies_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: task_dependencies task_dependencies_predecessor_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT task_dependencies_predecessor_fk FOREIGN KEY (predecessor_id, project_id) REFERENCES public.wbs_items(id, project_id) ON DELETE CASCADE;


--
-- Name: task_dependencies task_dependencies_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT task_dependencies_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: task_dependencies task_dependencies_successor_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT task_dependencies_successor_fk FOREIGN KEY (successor_id, project_id) REFERENCES public.wbs_items(id, project_id) ON DELETE CASCADE;


--
-- Name: teams teams_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: usage_events usage_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: usage_events usage_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_wbs_state user_wbs_state_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_wbs_state
    ADD CONSTRAINT user_wbs_state_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: user_wbs_state user_wbs_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_wbs_state
    ADD CONSTRAINT user_wbs_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: wbs_embeddings wbs_embeddings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wbs_embeddings
    ADD CONSTRAINT wbs_embeddings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wbs_items wbs_items_assignee_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wbs_items
    ADD CONSTRAINT wbs_items_assignee_member_fk FOREIGN KEY (assignee_member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE SET NULL (assignee_member_id);


--
-- Name: wbs_items wbs_items_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wbs_items
    ADD CONSTRAINT wbs_items_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.wbs_items(id) ON DELETE CASCADE;


--
-- Name: wbs_items wbs_items_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wbs_items
    ADD CONSTRAINT wbs_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wbs_progress_snapshots wbs_progress_snapshots_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wbs_progress_snapshots
    ADD CONSTRAINT wbs_progress_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: weekly_report_rows weekly_report_rows_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_report_rows
    ADD CONSTRAINT weekly_report_rows_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.weekly_reports(id) ON DELETE CASCADE;


--
-- Name: weekly_reports weekly_reports_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_reports
    ADD CONSTRAINT weekly_reports_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wiki_change_events wiki_change_events_actor_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_change_events
    ADD CONSTRAINT wiki_change_events_actor_fk FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: wiki_change_events wiki_change_events_minute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_change_events
    ADD CONSTRAINT wiki_change_events_minute_id_fkey FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE SET NULL;


--
-- Name: wiki_change_events wiki_change_events_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_change_events
    ADD CONSTRAINT wiki_change_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wiki_change_events wiki_change_events_source_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_change_events
    ADD CONSTRAINT wiki_change_events_source_fk FOREIGN KEY (source_id) REFERENCES public.wiki_item_sources(id) ON DELETE SET NULL;


--
-- Name: wiki_change_events wiki_change_events_wiki_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_change_events
    ADD CONSTRAINT wiki_change_events_wiki_item_id_fkey FOREIGN KEY (wiki_item_id) REFERENCES public.wiki_items(id) ON DELETE SET NULL;


--
-- Name: wiki_feedback wiki_feedback_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_feedback
    ADD CONSTRAINT wiki_feedback_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wiki_feedback wiki_feedback_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_feedback
    ADD CONSTRAINT wiki_feedback_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: wiki_feedback wiki_feedback_topic_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_feedback
    ADD CONSTRAINT wiki_feedback_topic_project_fk FOREIGN KEY (topic_id, project_id) REFERENCES public.wiki_topics(id, project_id) ON DELETE CASCADE;


--
-- Name: wiki_feedback wiki_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_feedback
    ADD CONSTRAINT wiki_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: wiki_item_relations wiki_item_relations_from_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_item_relations
    ADD CONSTRAINT wiki_item_relations_from_item_id_fkey FOREIGN KEY (from_item_id) REFERENCES public.wiki_items(id) ON DELETE CASCADE;


--
-- Name: wiki_item_relations wiki_item_relations_to_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_item_relations
    ADD CONSTRAINT wiki_item_relations_to_item_id_fkey FOREIGN KEY (to_item_id) REFERENCES public.wiki_items(id) ON DELETE CASCADE;


--
-- Name: wiki_item_sources wiki_item_sources_minute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_item_sources
    ADD CONSTRAINT wiki_item_sources_minute_id_fkey FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE CASCADE;


--
-- Name: wiki_item_sources wiki_item_sources_version_minute_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_item_sources
    ADD CONSTRAINT wiki_item_sources_version_minute_fk FOREIGN KEY (minute_version_id, minute_id) REFERENCES public.minute_versions(id, minute_id) ON DELETE CASCADE;


--
-- Name: wiki_item_sources wiki_item_sources_wiki_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_item_sources
    ADD CONSTRAINT wiki_item_sources_wiki_item_id_fkey FOREIGN KEY (wiki_item_id) REFERENCES public.wiki_items(id) ON DELETE CASCADE;


--
-- Name: wiki_items wiki_items_owner_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_items
    ADD CONSTRAINT wiki_items_owner_project_fk FOREIGN KEY (owner_member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE SET NULL (owner_member_id);


--
-- Name: wiki_items wiki_items_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_items
    ADD CONSTRAINT wiki_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wiki_items wiki_items_topic_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_items
    ADD CONSTRAINT wiki_items_topic_project_fk FOREIGN KEY (topic_id, project_id) REFERENCES public.wiki_topics(id, project_id);


--
-- Name: wiki_processing_jobs wiki_processing_jobs_minute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_processing_jobs
    ADD CONSTRAINT wiki_processing_jobs_minute_id_fkey FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE CASCADE;


--
-- Name: wiki_processing_jobs wiki_processing_jobs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_processing_jobs
    ADD CONSTRAINT wiki_processing_jobs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wiki_processing_jobs wiki_processing_jobs_version_minute_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_processing_jobs
    ADD CONSTRAINT wiki_processing_jobs_version_minute_fk FOREIGN KEY (minute_version_id, minute_id) REFERENCES public.minute_versions(id, minute_id) ON DELETE CASCADE;


--
-- Name: wiki_project_rebuild_jobs wiki_project_rebuild_jobs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_project_rebuild_jobs
    ADD CONSTRAINT wiki_project_rebuild_jobs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wiki_questions wiki_questions_answered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_questions
    ADD CONSTRAINT wiki_questions_answered_by_fkey FOREIGN KEY (answered_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: wiki_questions wiki_questions_asked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_questions
    ADD CONSTRAINT wiki_questions_asked_by_fkey FOREIGN KEY (asked_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: wiki_questions wiki_questions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_questions
    ADD CONSTRAINT wiki_questions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wiki_questions wiki_questions_topic_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_questions
    ADD CONSTRAINT wiki_questions_topic_project_fk FOREIGN KEY (topic_id, project_id) REFERENCES public.wiki_topics(id, project_id) ON DELETE SET NULL (topic_id);


--
-- Name: wiki_topic_revisions wiki_topic_revisions_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topic_revisions
    ADD CONSTRAINT wiki_topic_revisions_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: wiki_topic_revisions wiki_topic_revisions_topic_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topic_revisions
    ADD CONSTRAINT wiki_topic_revisions_topic_project_fk FOREIGN KEY (topic_id, project_id) REFERENCES public.wiki_topics(id, project_id) ON DELETE CASCADE;


--
-- Name: wiki_topics wiki_topics_body_updated_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topics
    ADD CONSTRAINT wiki_topics_body_updated_by_fk FOREIGN KEY (body_updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: wiki_topics wiki_topics_parent_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topics
    ADD CONSTRAINT wiki_topics_parent_project_fk FOREIGN KEY (parent_id, project_id) REFERENCES public.wiki_topics(id, project_id) ON DELETE SET NULL (parent_id);


--
-- Name: wiki_topics wiki_topics_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topics
    ADD CONSTRAINT wiki_topics_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: wiki_topics wiki_topics_verified_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_topics
    ADD CONSTRAINT wiki_topics_verified_by_fk FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: projects admin_update_projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update_projects ON public.projects FOR UPDATE TO authenticated USING (public.is_project_admin(id)) WITH CHECK (public.is_project_admin(id));


--
-- Name: announcements admin_write_announcements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_announcements ON public.announcements TO authenticated USING (public.is_project_admin(project_id)) WITH CHECK (public.is_project_admin(project_id));


--
-- Name: holidays admin_write_holidays; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_holidays ON public.holidays TO authenticated USING (public.is_project_admin(project_id)) WITH CHECK (public.is_project_admin(project_id));


--
-- Name: wbs_items admin_write_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_items ON public.wbs_items TO authenticated USING (public.is_project_admin(project_id)) WITH CHECK (public.is_project_admin(project_id));


--
-- Name: project_roles admin_write_member_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_member_roles ON public.project_roles TO authenticated USING (((role = 'member'::text) AND public.is_project_admin(project_id))) WITH CHECK (((role = 'member'::text) AND public.is_project_admin(project_id)));


--
-- Name: project_members admin_write_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_members ON public.project_members TO authenticated USING (public.is_project_admin(project_id)) WITH CHECK (public.is_project_admin(project_id));


--
-- Name: item_owners admin_write_owners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_owners ON public.item_owners TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.wbs_items w
  WHERE ((w.id = item_owners.wbs_item_id) AND public.is_project_admin(w.project_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.wbs_items w
  WHERE ((w.id = item_owners.wbs_item_id) AND public.is_project_admin(w.project_id)))));


--
-- Name: task_dependencies admin_write_task_dependencies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_task_dependencies ON public.task_dependencies TO authenticated USING (public.is_project_admin(project_id)) WITH CHECK (public.is_project_admin(project_id));


--
-- Name: agent_lead_leases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_lead_leases ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_projects ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_runners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_runners ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_watchers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_watchers ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_work_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_work_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_work_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_work_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_documents ai_documents_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_documents_read ON public.ai_documents FOR SELECT TO authenticated USING (true);


--
-- Name: ai_index_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_index_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: announcement_seen; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcement_seen ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: deliverable_attachments attach_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attach_delete ON public.deliverable_attachments FOR DELETE TO authenticated USING (public.can_attach(wbs_item_id));


--
-- Name: deliverable_attachments attach_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attach_insert ON public.deliverable_attachments FOR INSERT TO authenticated WITH CHECK (public.can_attach(wbs_item_id));


--
-- Name: minute_files attachment_delete_minute_files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attachment_delete_minute_files ON public.minute_files FOR DELETE TO authenticated USING (((role = 'attachment'::text) AND (EXISTS ( SELECT 1
   FROM public.minutes mi
  WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (public.app_role() = 'pmo_admin'::text)))))));


--
-- Name: minute_files attachment_insert_minute_files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attachment_insert_minute_files ON public.minute_files FOR INSERT TO authenticated WITH CHECK (((role = 'attachment'::text) AND (uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.minutes mi
  WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (public.app_role() = 'pmo_admin'::text)))))));


--
-- Name: minute_files attachment_update_minute_files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attachment_update_minute_files ON public.minute_files FOR UPDATE TO authenticated USING (((role = 'attachment'::text) AND (EXISTS ( SELECT 1
   FROM public.minutes mi
  WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (public.app_role() = 'pmo_admin'::text))))))) WITH CHECK (((role = 'attachment'::text) AND (EXISTS ( SELECT 1
   FROM public.minutes mi
  WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (public.app_role() = 'pmo_admin'::text)))))));


--
-- Name: attendance_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

--
-- Name: change_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.change_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_attachments delete_issue_attachments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delete_issue_attachments ON public.issue_attachments FOR DELETE TO authenticated USING (public.can_edit_issue(issue_id));


--
-- Name: issue_updates delete_issue_updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delete_issue_updates ON public.issue_updates FOR DELETE TO authenticated USING (public.is_project_admin(project_id));


--
-- Name: issues delete_own_issues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delete_own_issues ON public.issues FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR public.is_project_admin(project_id)));


--
-- Name: meetings delete_own_meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delete_own_meetings ON public.meetings FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR public.is_project_admin(project_id)));


--
-- Name: minute_folders delete_own_minute_folders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delete_own_minute_folders ON public.minute_folders FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR (public.app_role() = 'pmo_admin'::text)));


--
-- Name: minute_highlights delete_own_minute_highlights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delete_own_minute_highlights ON public.minute_highlights FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR (public.app_role() = 'pmo_admin'::text)));


--
-- Name: deliverable_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deliverable_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: holidays; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_attachments insert_issue_attachments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_issue_attachments ON public.issue_attachments FOR INSERT TO authenticated WITH CHECK (public.can_edit_issue(issue_id));


--
-- Name: issue_major_processes insert_issue_major_processes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_issue_major_processes ON public.issue_major_processes FOR INSERT TO authenticated WITH CHECK (public.is_project_member(project_id));


--
-- Name: issue_updates insert_issue_updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_issue_updates ON public.issue_updates FOR INSERT TO authenticated WITH CHECK ((public.is_project_member(project_id) AND (author_user_id = auth.uid()) AND (kind = 'note'::text) AND (archived_at IS NULL) AND (archived_by IS NULL) AND (archived_by_name IS NULL)));


--
-- Name: issues insert_own_issues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_own_issues ON public.issues FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) AND public.is_project_member(project_id)));


--
-- Name: change_logs insert_own_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_own_log ON public.change_logs FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: meetings insert_own_meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_own_meetings ON public.meetings FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) AND public.is_project_member(project_id)));


--
-- Name: minute_folders insert_own_minute_folders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_own_minute_folders ON public.minute_folders FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) AND (public.app_role() IS NOT NULL)));


--
-- Name: minute_highlights insert_own_minute_highlights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_own_minute_highlights ON public.minute_highlights FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) AND (public.app_role() IS NOT NULL)));


--
-- Name: issue_analysis_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_analysis_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_analysis_runs issue_analysis_runs_select_project_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY issue_analysis_runs_select_project_members ON public.issue_analysis_runs FOR SELECT TO authenticated USING (public.is_project_member(project_id));


--
-- Name: issue_assignees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_assignees ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_links ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_major_processes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_major_processes ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_mega_areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_mega_areas ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_number_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_number_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_updates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_updates ENABLE ROW LEVEL SECURITY;

--
-- Name: issues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;

--
-- Name: item_owners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_owners ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.llm_config ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.llm_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: meeting_attendees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meeting_attendees ENABLE ROW LEVEL SECURITY;

--
-- Name: meeting_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meeting_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_assignees member_delete_issue_assignees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_delete_issue_assignees ON public.issue_assignees FOR DELETE TO authenticated USING (public.is_project_member(project_id));


--
-- Name: issue_assignees member_insert_issue_assignees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_insert_issue_assignees ON public.issue_assignees FOR INSERT TO authenticated WITH CHECK (public.is_project_member(project_id));


--
-- Name: wbs_items member_update_actual; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_update_actual ON public.wbs_items FOR UPDATE TO authenticated USING ((public.is_project_member(project_id) AND public.wbs_is_leaf(id) AND (EXISTS ( SELECT 1
   FROM public.item_owners o
  WHERE ((o.wbs_item_id = wbs_items.id) AND ((o.team_id = ( SELECT m.team_id
           FROM public.memberships m
          WHERE (m.user_id = auth.uid()))) OR (o.team_id IN ( SELECT pm.team_id
           FROM public.project_members pm
          WHERE ((pm.project_id = wbs_items.project_id) AND (pm.user_id = auth.uid()) AND (pm.team_id IS NOT NULL)))))))))) WITH CHECK ((public.is_project_member(project_id) AND public.wbs_is_leaf(id) AND (EXISTS ( SELECT 1
   FROM public.item_owners o
  WHERE ((o.wbs_item_id = wbs_items.id) AND ((o.team_id = ( SELECT m.team_id
           FROM public.memberships m
          WHERE (m.user_id = auth.uid()))) OR (o.team_id IN ( SELECT pm.team_id
           FROM public.project_members pm
          WHERE ((pm.project_id = wbs_items.project_id) AND (pm.user_id = auth.uid()) AND (pm.team_id IS NOT NULL))))))))));


--
-- Name: issues member_update_issues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_update_issues ON public.issues FOR UPDATE TO authenticated USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));


--
-- Name: attendance_records member_write_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_write_attendance ON public.attendance_records TO authenticated USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));


--
-- Name: wbs_progress_snapshots member_write_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_write_snapshots ON public.wbs_progress_snapshots TO authenticated USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));


--
-- Name: memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_embeddings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minute_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_embeddings minute_embeddings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY minute_embeddings_read ON public.minute_embeddings FOR SELECT TO authenticated USING (true);


--
-- Name: minute_favorites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minute_favorites ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minute_files ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_folders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minute_folders ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_highlights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minute_highlights ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minute_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_insights minute_insights_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY minute_insights_read ON public.minute_insights FOR SELECT TO authenticated USING (true);


--
-- Name: minute_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minute_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_versions minute_versions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY minute_versions_read ON public.minute_versions FOR SELECT TO authenticated USING (true);


--
-- Name: minutes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minutes ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_favorites own_minute_favorites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_minute_favorites ON public.minute_favorites TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: announcement_seen own_seen_announcements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_seen_announcements ON public.announcement_seen TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_preferences own_user_preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_user_preferences ON public.user_preferences TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_wbs_state own_user_wbs_state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_user_wbs_state ON public.user_wbs_state TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: meeting_attendees own_write_meeting_attendees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_write_meeting_attendees ON public.meeting_attendees TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.meetings m
  WHERE ((m.id = meeting_attendees.meeting_id) AND ((m.created_by = auth.uid()) OR public.is_project_admin(m.project_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.meetings m
  WHERE ((m.id = meeting_attendees.meeting_id) AND ((m.created_by = auth.uid()) OR public.is_project_admin(m.project_id))))));


--
-- Name: meeting_exceptions own_write_meeting_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_write_meeting_exceptions ON public.meeting_exceptions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.meetings m
  WHERE ((m.id = meeting_exceptions.meeting_id) AND ((m.created_by = auth.uid()) OR public.is_project_admin(m.project_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.meetings m
  WHERE ((m.id = meeting_exceptions.meeting_id) AND ((m.created_by = auth.uid()) OR public.is_project_admin(m.project_id))))));


--
-- Name: teams pa_insert_project_teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pa_insert_project_teams ON public.teams FOR INSERT TO authenticated WITH CHECK (((project_id IS NOT NULL) AND public.is_project_admin(project_id)));


--
-- Name: teams pa_update_project_teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pa_update_project_teams ON public.teams FOR UPDATE TO authenticated USING (((project_id IS NOT NULL) AND public.is_project_admin(project_id))) WITH CHECK (((project_id IS NOT NULL) AND public.is_project_admin(project_id)));


--
-- Name: project_ai_briefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_ai_briefs ENABLE ROW LEVEL SECURITY;

--
-- Name: project_ai_briefs project_ai_briefs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_ai_briefs_read ON public.project_ai_briefs FOR SELECT TO authenticated USING (true);


--
-- Name: project_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: project_member_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_member_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: project_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

--
-- Name: project_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: project_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_projects read_agent_projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_agent_projects ON public.agent_projects FOR SELECT TO authenticated USING (public.is_project_member(project_id));


--
-- Name: agent_work_orders read_agent_work_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_agent_work_orders ON public.agent_work_orders FOR SELECT TO authenticated USING (public.is_project_member(project_id));


--
-- Name: agent_work_reports read_agent_work_reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_agent_work_reports ON public.agent_work_reports FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.agent_work_orders o
  WHERE ((o.id = agent_work_reports.work_order_id) AND public.is_project_member(o.project_id)))));


--
-- Name: announcements read_all_announcements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_announcements ON public.announcements FOR SELECT TO authenticated USING (true);


--
-- Name: deliverable_attachments read_all_attachments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_attachments ON public.deliverable_attachments FOR SELECT TO authenticated USING (true);


--
-- Name: attendance_records read_all_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_attendance ON public.attendance_records FOR SELECT TO authenticated USING (true);


--
-- Name: holidays read_all_holidays; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_holidays ON public.holidays FOR SELECT TO authenticated USING (true);


--
-- Name: issue_assignees read_all_issue_assignees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_issue_assignees ON public.issue_assignees FOR SELECT TO authenticated USING (true);


--
-- Name: issue_links read_all_issue_links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_issue_links ON public.issue_links FOR SELECT TO authenticated USING (true);


--
-- Name: issue_major_processes read_all_issue_major_processes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_issue_major_processes ON public.issue_major_processes FOR SELECT TO authenticated USING (true);


--
-- Name: issue_mega_areas read_all_issue_mega_areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_issue_mega_areas ON public.issue_mega_areas FOR SELECT TO authenticated USING (true);


--
-- Name: issues read_all_issues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_issues ON public.issues FOR SELECT TO authenticated USING (true);


--
-- Name: wbs_items read_all_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_items ON public.wbs_items FOR SELECT TO authenticated USING (true);


--
-- Name: change_logs read_all_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_logs ON public.change_logs FOR SELECT TO authenticated USING (true);


--
-- Name: meeting_attendees read_all_meeting_attendees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_meeting_attendees ON public.meeting_attendees FOR SELECT TO authenticated USING (true);


--
-- Name: meeting_exceptions read_all_meeting_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_meeting_exceptions ON public.meeting_exceptions FOR SELECT TO authenticated USING (true);


--
-- Name: meetings read_all_meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_meetings ON public.meetings FOR SELECT TO authenticated USING (true);


--
-- Name: project_members read_all_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_members ON public.project_members FOR SELECT TO authenticated USING (true);


--
-- Name: memberships read_all_memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_memberships ON public.memberships FOR SELECT TO authenticated USING (true);


--
-- Name: minute_files read_all_minute_files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_minute_files ON public.minute_files FOR SELECT TO authenticated USING (true);


--
-- Name: minute_folders read_all_minute_folders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_minute_folders ON public.minute_folders FOR SELECT TO authenticated USING (true);


--
-- Name: minute_highlights read_all_minute_highlights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_minute_highlights ON public.minute_highlights FOR SELECT TO authenticated USING (true);


--
-- Name: minutes read_all_minutes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_minutes ON public.minutes FOR SELECT TO authenticated USING (true);


--
-- Name: item_owners read_all_owners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_owners ON public.item_owners FOR SELECT TO authenticated USING (true);


--
-- Name: wbs_progress_snapshots read_all_progress_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_progress_snapshots ON public.wbs_progress_snapshots FOR SELECT TO authenticated USING (true);


--
-- Name: project_roles read_all_project_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_project_roles ON public.project_roles FOR SELECT TO authenticated USING (true);


--
-- Name: projects read_all_projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_projects ON public.projects FOR SELECT TO authenticated USING (true);


--
-- Name: teams read_all_teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_all_teams ON public.teams FOR SELECT TO authenticated USING (true);


--
-- Name: issue_attachments read_issue_attachments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_issue_attachments ON public.issue_attachments FOR SELECT TO authenticated USING (true);


--
-- Name: issue_updates read_issue_updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_issue_updates ON public.issue_updates FOR SELECT TO authenticated USING (true);


--
-- Name: notification_events read_notification_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_notification_events ON public.notification_events FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.notification_recipients r
  WHERE ((r.event_id = notification_events.id) AND (r.user_id = auth.uid())))) OR ((audience = 'project'::text) AND public.is_project_member(project_id)) OR (audience = 'global'::text)));


--
-- Name: notification_recipients read_notification_recipients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_notification_recipients ON public.notification_recipients FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: project_settings read_project_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_project_settings ON public.project_settings FOR SELECT TO authenticated USING (true);


--
-- Name: usage_events read_usage_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY read_usage_events ON public.usage_events FOR SELECT TO authenticated USING (public.is_superuser());


--
-- Name: llm_config su_all_llm_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY su_all_llm_config ON public.llm_config TO authenticated USING (public.is_superuser()) WITH CHECK (public.is_superuser());


--
-- Name: llm_profiles su_all_llm_profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY su_all_llm_profiles ON public.llm_profiles TO authenticated USING (public.is_superuser()) WITH CHECK (public.is_superuser());


--
-- Name: projects su_delete_projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY su_delete_projects ON public.projects FOR DELETE TO authenticated USING (public.is_superuser());


--
-- Name: projects su_insert_projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY su_insert_projects ON public.projects FOR INSERT TO authenticated WITH CHECK (public.is_superuser());


--
-- Name: teams su_insert_teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY su_insert_teams ON public.teams FOR INSERT TO authenticated WITH CHECK (public.is_superuser());


--
-- Name: teams su_update_teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY su_update_teams ON public.teams FOR UPDATE TO authenticated USING (public.is_superuser()) WITH CHECK (public.is_superuser());


--
-- Name: project_roles su_write_admin_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY su_write_admin_roles ON public.project_roles TO authenticated USING (((role = 'admin'::text) AND public.is_superuser())) WITH CHECK (((role = 'admin'::text) AND public.is_superuser()));


--
-- Name: memberships su_write_memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY su_write_memberships ON public.memberships TO authenticated USING (public.is_superuser()) WITH CHECK (public.is_superuser());


--
-- Name: task_dependencies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;

--
-- Name: task_dependencies task_dependencies_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_dependencies_select ON public.task_dependencies FOR SELECT TO authenticated USING (true);


--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_updates update_issue_updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY update_issue_updates ON public.issue_updates FOR UPDATE TO authenticated USING ((((author_user_id = auth.uid()) OR public.is_project_admin(project_id)) AND (kind = 'note'::text))) WITH CHECK (((num_nonnulls(archived_at, archived_by, archived_by_name) = 0) OR ((archived_at IS NOT NULL) AND (archived_by = auth.uid()))));


--
-- Name: meetings update_own_meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY update_own_meetings ON public.meetings FOR UPDATE TO authenticated USING (((created_by = auth.uid()) OR public.is_project_admin(project_id))) WITH CHECK (((created_by = auth.uid()) OR public.is_project_admin(project_id)));


--
-- Name: minute_folders update_own_minute_folders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY update_own_minute_folders ON public.minute_folders FOR UPDATE TO authenticated USING (((created_by = auth.uid()) OR (public.app_role() = 'pmo_admin'::text))) WITH CHECK (((created_by = auth.uid()) OR (public.app_role() = 'pmo_admin'::text)));


--
-- Name: usage_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

--
-- Name: user_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_wbs_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_wbs_state ENABLE ROW LEVEL SECURITY;

--
-- Name: wbs_embeddings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wbs_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: wbs_embeddings wbs_embeddings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wbs_embeddings_read ON public.wbs_embeddings FOR SELECT TO authenticated USING (true);


--
-- Name: wbs_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wbs_items ENABLE ROW LEVEL SECURITY;

--
-- Name: wbs_progress_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wbs_progress_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_report_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weekly_report_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_report_rows weekly_report_rows_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weekly_report_rows_delete ON public.weekly_report_rows FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.weekly_reports r
  WHERE ((r.id = weekly_report_rows.report_id) AND public.is_project_admin(r.project_id)))));


--
-- Name: weekly_report_rows weekly_report_rows_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weekly_report_rows_insert ON public.weekly_report_rows FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.weekly_reports r
  WHERE ((r.id = weekly_report_rows.report_id) AND public.is_project_member(r.project_id)))));


--
-- Name: weekly_report_rows weekly_report_rows_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weekly_report_rows_select ON public.weekly_report_rows FOR SELECT TO authenticated USING (true);


--
-- Name: weekly_report_rows weekly_report_rows_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weekly_report_rows_update ON public.weekly_report_rows FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.weekly_reports r
  WHERE ((r.id = weekly_report_rows.report_id) AND public.is_project_member(r.project_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.weekly_reports r
  WHERE ((r.id = weekly_report_rows.report_id) AND public.is_project_member(r.project_id)))));


--
-- Name: weekly_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_reports weekly_reports_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weekly_reports_delete ON public.weekly_reports FOR DELETE TO authenticated USING (public.is_project_admin(project_id));


--
-- Name: weekly_reports weekly_reports_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weekly_reports_insert ON public.weekly_reports FOR INSERT TO authenticated WITH CHECK (public.is_project_admin(project_id));


--
-- Name: weekly_reports weekly_reports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weekly_reports_select ON public.weekly_reports FOR SELECT TO authenticated USING (true);


--
-- Name: weekly_reports weekly_reports_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weekly_reports_update ON public.weekly_reports FOR UPDATE TO authenticated USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));


--
-- Name: wiki_change_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_change_events ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_change_events wiki_change_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_change_events_read ON public.wiki_change_events FOR SELECT TO authenticated USING (true);


--
-- Name: wiki_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_feedback wiki_feedback_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_feedback_member_insert ON public.wiki_feedback FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND public.is_project_member(project_id) AND (EXISTS ( SELECT 1
   FROM public.wiki_topics topic
  WHERE ((topic.id = wiki_feedback.topic_id) AND (topic.project_id = wiki_feedback.project_id))))));


--
-- Name: wiki_feedback wiki_feedback_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_feedback_read ON public.wiki_feedback FOR SELECT TO authenticated USING (public.can_read_project(project_id));


--
-- Name: wiki_item_relations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_item_relations ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_item_relations wiki_item_relations_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_item_relations_read ON public.wiki_item_relations FOR SELECT TO authenticated USING (true);


--
-- Name: wiki_item_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_item_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_item_sources wiki_item_sources_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_item_sources_read ON public.wiki_item_sources FOR SELECT TO authenticated USING (true);


--
-- Name: wiki_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_items ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_items wiki_items_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_items_read ON public.wiki_items FOR SELECT TO authenticated USING (true);


--
-- Name: wiki_processing_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_processing_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_project_rebuild_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_project_rebuild_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_questions wiki_questions_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_questions_member_insert ON public.wiki_questions FOR INSERT TO authenticated WITH CHECK (((asked_by = auth.uid()) AND public.is_project_member(project_id) AND ((topic_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.wiki_topics topic
  WHERE ((topic.id = wiki_questions.topic_id) AND (topic.project_id = wiki_questions.project_id)))))));


--
-- Name: wiki_questions wiki_questions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_questions_read ON public.wiki_questions FOR SELECT TO authenticated USING (public.can_read_project(project_id));


--
-- Name: wiki_topic_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_topic_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_topic_revisions wiki_topic_revisions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_topic_revisions_read ON public.wiki_topic_revisions FOR SELECT TO authenticated USING (public.can_read_project(project_id));


--
-- Name: wiki_topics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_topics ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_topics wiki_topics_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_topics_read ON public.wiki_topics FOR SELECT TO authenticated USING (true);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION answer_wiki_question(p_question_id uuid, p_answer text, p_topic_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.answer_wiki_question(p_question_id uuid, p_answer text, p_topic_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.answer_wiki_question(p_question_id uuid, p_answer text, p_topic_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.answer_wiki_question(p_question_id uuid, p_answer text, p_topic_id uuid) TO authenticated;


--
-- Name: FUNCTION app_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_role() TO anon;
GRANT ALL ON FUNCTION public.app_role() TO authenticated;
GRANT ALL ON FUNCTION public.app_role() TO service_role;


--
-- Name: FUNCTION apply_wiki_extracted_item_atomic(p_project_id uuid, p_topic_id uuid, p_wiki_job_id bigint, p_job_locked_by text, p_apply_generation integer, p_minute_id uuid, p_minute_version_id uuid, p_minute_version_no integer, p_body_hash text, p_kind text, p_statement text, p_statement_hash text, p_knowledge_key text, p_certainty text, p_decision_state text, p_source_relation text, p_requested_change text, p_can_auto_apply boolean, p_observed_at timestamp with time zone, p_valid_from timestamp with time zone, p_owner_team text, p_owner_name text, p_due_date date, p_sources jsonb, p_expected_current_id uuid, p_expected_current_hash text, p_expected_current_updated_at timestamp with time zone, p_idempotency_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public."apply_wiki_extracted_item_atomic"(p_project_id uuid, p_topic_id uuid, p_wiki_job_id bigint, p_job_locked_by text, p_apply_generation integer, p_minute_id uuid, p_minute_version_id uuid, p_minute_version_no integer, p_body_hash text, p_kind text, p_statement text, p_statement_hash text, p_knowledge_key text, p_certainty text, p_decision_state text, p_source_relation text, p_requested_change text, p_can_auto_apply boolean, p_observed_at timestamp with time zone, p_valid_from timestamp with time zone, p_owner_team text, p_owner_name text, p_due_date date, p_sources jsonb, p_expected_current_id uuid, p_expected_current_hash text, p_expected_current_updated_at timestamp with time zone, p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public."apply_wiki_extracted_item_atomic"(p_project_id uuid, p_topic_id uuid, p_wiki_job_id bigint, p_job_locked_by text, p_apply_generation integer, p_minute_id uuid, p_minute_version_id uuid, p_minute_version_no integer, p_body_hash text, p_kind text, p_statement text, p_statement_hash text, p_knowledge_key text, p_certainty text, p_decision_state text, p_source_relation text, p_requested_change text, p_can_auto_apply boolean, p_observed_at timestamp with time zone, p_valid_from timestamp with time zone, p_owner_team text, p_owner_name text, p_due_date date, p_sources jsonb, p_expected_current_id uuid, p_expected_current_hash text, p_expected_current_updated_at timestamp with time zone, p_idempotency_key text) TO service_role;


--
-- Name: FUNCTION apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid, p_order_id uuid, p_stage text, p_agent text, p_agent_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid, p_order_id uuid, p_stage text, p_agent text, p_agent_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid, p_order_id uuid, p_stage text, p_agent text, p_agent_user_id uuid) TO service_role;


--
-- Name: FUNCTION archive_minute_with_wiki_retraction(p_minute_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.archive_minute_with_wiki_retraction(p_minute_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.archive_minute_with_wiki_retraction(p_minute_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION assign_issue_analysis_code(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assign_issue_analysis_code() FROM PUBLIC;
GRANT ALL ON FUNCTION public.assign_issue_analysis_code() TO service_role;


--
-- Name: FUNCTION assign_issue_major_seq(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assign_issue_major_seq() FROM PUBLIC;
GRANT ALL ON FUNCTION public.assign_issue_major_seq() TO service_role;


--
-- Name: FUNCTION can_attach(item uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_attach(item uuid) TO anon;
GRANT ALL ON FUNCTION public.can_attach(item uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_attach(item uuid) TO service_role;


--
-- Name: FUNCTION can_edit_issue(iid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_edit_issue(iid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_edit_issue(iid uuid) TO service_role;
GRANT ALL ON FUNCTION public.can_edit_issue(iid uuid) TO authenticated;


--
-- Name: FUNCTION can_read_project(pid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_read_project(pid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_read_project(pid uuid) TO anon;
GRANT ALL ON FUNCTION public.can_read_project(pid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_read_project(pid uuid) TO service_role;


--
-- Name: TABLE ai_index_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_index_jobs TO service_role;


--
-- Name: FUNCTION claim_ai_index_jobs(p_limit integer, p_lease_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_ai_index_jobs(p_limit integer, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_ai_index_jobs(p_limit integer, p_lease_seconds integer) TO service_role;


--
-- Name: TABLE wiki_processing_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_processing_jobs TO service_role;


--
-- Name: FUNCTION claim_wiki_processing_job(p_job_id bigint, p_locked_by text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_wiki_processing_job(p_job_id bigint, p_locked_by text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_wiki_processing_job(p_job_id bigint, p_locked_by text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION claim_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION commit_minute_body_version(p_minute_id uuid, p_body_md text, p_body_hash text, p_file_name text, p_file_path text, p_file_size bigint, p_file_mime text, p_actor_id uuid, p_actor_name text, p_metadata jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.commit_minute_body_version(p_minute_id uuid, p_body_md text, p_body_hash text, p_file_name text, p_file_path text, p_file_size bigint, p_file_mime text, p_actor_id uuid, p_actor_name text, p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.commit_minute_body_version(p_minute_id uuid, p_body_md text, p_body_hash text, p_file_name text, p_file_path text, p_file_size bigint, p_file_mime text, p_actor_id uuid, p_actor_name text, p_metadata jsonb) TO service_role;


--
-- Name: FUNCTION complete_ai_index_job(p_id bigint, p_generation bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_ai_index_job(p_id bigint, p_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_ai_index_job(p_id bigint, p_generation bigint) TO service_role;


--
-- Name: FUNCTION consume_project_invite(p_token uuid, p_email text, p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.consume_project_invite(p_token uuid, p_email text, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.consume_project_invite(p_token uuid, p_email text, p_user uuid) TO service_role;


--
-- Name: FUNCTION create_issue_from_minute_block(p_project_id uuid, p_title text, p_body text, p_severity text, p_assignee_member_ids uuid[], p_start_date date, p_due_date date, p_mega_code text, p_major_name text, p_sub_process text, p_owner_department text, p_related_systems text[], p_source_type text, p_source_detail text, p_actor_id uuid, p_created_by_name text, p_minute_id uuid, p_minute_version_id uuid, p_body_hash text, p_block_index integer, p_block_hash text, p_excerpt_snapshot text, p_source_kind text, p_source_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_issue_from_minute_block(p_project_id uuid, p_title text, p_body text, p_severity text, p_assignee_member_ids uuid[], p_start_date date, p_due_date date, p_mega_code text, p_major_name text, p_sub_process text, p_owner_department text, p_related_systems text[], p_source_type text, p_source_detail text, p_actor_id uuid, p_created_by_name text, p_minute_id uuid, p_minute_version_id uuid, p_body_hash text, p_block_index integer, p_block_hash text, p_excerpt_snapshot text, p_source_kind text, p_source_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_issue_from_minute_block(p_project_id uuid, p_title text, p_body text, p_severity text, p_assignee_member_ids uuid[], p_start_date date, p_due_date date, p_mega_code text, p_major_name text, p_sub_process text, p_owner_department text, p_related_systems text[], p_source_type text, p_source_detail text, p_actor_id uuid, p_created_by_name text, p_minute_id uuid, p_minute_version_id uuid, p_body_hash text, p_block_index integer, p_block_hash text, p_excerpt_snapshot text, p_source_kind text, p_source_key text) TO service_role;


--
-- Name: FUNCTION create_minute_with_version(p_minute_id uuid, p_minute_date date, p_team_code text, p_title text, p_body_md text, p_body_hash text, p_meeting_id uuid, p_project_id uuid, p_meeting_occurrence_date date, p_folder_id uuid, p_external_id text, p_actor_id uuid, p_actor_name text, p_file_name text, p_file_path text, p_file_size bigint, p_file_mime text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_minute_with_version(p_minute_id uuid, p_minute_date date, p_team_code text, p_title text, p_body_md text, p_body_hash text, p_meeting_id uuid, p_project_id uuid, p_meeting_occurrence_date date, p_folder_id uuid, p_external_id text, p_actor_id uuid, p_actor_name text, p_file_name text, p_file_path text, p_file_size bigint, p_file_mime text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_minute_with_version(p_minute_id uuid, p_minute_date date, p_team_code text, p_title text, p_body_md text, p_body_hash text, p_meeting_id uuid, p_project_id uuid, p_meeting_occurrence_date date, p_folder_id uuid, p_external_id text, p_actor_id uuid, p_actor_name text, p_file_name text, p_file_path text, p_file_size bigint, p_file_mime text) TO service_role;


--
-- Name: FUNCTION create_wiki_document(p_project_id uuid, p_title text, p_body_md text, p_document_kind text, p_parent_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_wiki_document(p_project_id uuid, p_title text, p_body_md text, p_document_kind text, p_parent_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_wiki_document(p_project_id uuid, p_title text, p_body_md text, p_document_kind text, p_parent_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.create_wiki_document(p_project_id uuid, p_title text, p_body_md text, p_document_kind text, p_parent_id uuid) TO authenticated;


--
-- Name: FUNCTION create_wiki_question(p_project_id uuid, p_topic_id uuid, p_question text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_wiki_question(p_project_id uuid, p_topic_id uuid, p_question text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_wiki_question(p_project_id uuid, p_topic_id uuid, p_question text) TO service_role;
GRANT ALL ON FUNCTION public.create_wiki_question(p_project_id uuid, p_topic_id uuid, p_question text) TO authenticated;


--
-- Name: FUNCTION curate_wiki_item(p_item_id uuid, p_action text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.curate_wiki_item(p_item_id uuid, p_action text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.curate_wiki_item(p_item_id uuid, p_action text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.curate_wiki_item(p_item_id uuid, p_action text, p_reason text) TO service_role;


--
-- Name: FUNCTION current_team(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_team() TO anon;
GRANT ALL ON FUNCTION public.current_team() TO authenticated;
GRANT ALL ON FUNCTION public.current_team() TO service_role;


--
-- Name: FUNCTION enforce_project_member_email_identity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_project_member_email_identity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_project_member_email_identity() TO service_role;


--
-- Name: FUNCTION fail_ai_index_job(p_id bigint, p_generation bigint, p_attempts integer, p_status text, p_run_after timestamp with time zone, p_last_error text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fail_ai_index_job(p_id bigint, p_generation bigint, p_attempts integer, p_status text, p_run_after timestamp with time zone, p_last_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_ai_index_job(p_id bigint, p_generation bigint, p_attempts integer, p_status text, p_run_after timestamp with time zone, p_last_error text) TO service_role;


--
-- Name: FUNCTION finish_wiki_processing_job(p_job_id bigint, p_locked_by text, p_succeeded boolean, p_payload jsonb, p_last_error text, p_retry_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.finish_wiki_processing_job(p_job_id bigint, p_locked_by text, p_succeeded boolean, p_payload jsonb, p_last_error text, p_retry_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_wiki_processing_job(p_job_id bigint, p_locked_by text, p_succeeded boolean, p_payload jsonb, p_last_error text, p_retry_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION finish_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_last_error text, p_retry_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.finish_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_last_error text, p_retry_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_wiki_project_rebuild_step(p_project_id uuid, p_locked_by text, p_last_error text, p_retry_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION guard_dependent_wbs_dates(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_dependent_wbs_dates() TO anon;
GRANT ALL ON FUNCTION public.guard_dependent_wbs_dates() TO authenticated;
GRANT ALL ON FUNCTION public.guard_dependent_wbs_dates() TO service_role;


--
-- Name: FUNCTION guard_minute_ai_document_scope(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_minute_ai_document_scope() TO anon;
GRANT ALL ON FUNCTION public.guard_minute_ai_document_scope() TO authenticated;
GRANT ALL ON FUNCTION public.guard_minute_ai_document_scope() TO service_role;


--
-- Name: FUNCTION guard_non_admin_column_scope(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_non_admin_column_scope() TO anon;
GRANT ALL ON FUNCTION public.guard_non_admin_column_scope() TO authenticated;
GRANT ALL ON FUNCTION public.guard_non_admin_column_scope() TO service_role;


--
-- Name: FUNCTION import_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.import_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) TO anon;
GRANT ALL ON FUNCTION public.import_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.import_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) TO service_role;


--
-- Name: FUNCTION import_wbs_upsert(p_project_id uuid, p_nodes jsonb, p_attach_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.import_wbs_upsert(p_project_id uuid, p_nodes jsonb, p_attach_id uuid) TO anon;
GRANT ALL ON FUNCTION public.import_wbs_upsert(p_project_id uuid, p_nodes jsonb, p_attach_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.import_wbs_upsert(p_project_id uuid, p_nodes jsonb, p_attach_id uuid) TO service_role;


--
-- Name: FUNCTION is_project_admin(pid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_project_admin(pid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_project_admin(pid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_project_admin(pid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_project_admin(pid uuid) TO service_role;


--
-- Name: FUNCTION is_project_member(pid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_project_member(pid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_project_member(pid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_project_member(pid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_project_member(pid uuid) TO service_role;


--
-- Name: FUNCTION is_superuser(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_superuser() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_superuser() TO anon;
GRANT ALL ON FUNCTION public.is_superuser() TO authenticated;
GRANT ALL ON FUNCTION public.is_superuser() TO service_role;


--
-- Name: FUNCTION issue_related_systems_valid(systems text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.issue_related_systems_valid(systems text[]) TO anon;
GRANT ALL ON FUNCTION public.issue_related_systems_valid(systems text[]) TO authenticated;
GRANT ALL ON FUNCTION public.issue_related_systems_valid(systems text[]) TO service_role;


--
-- Name: FUNCTION lead_lease_acquire(p_user uuid, p_projects uuid[], p_holder text, p_host text, p_agent text, p_takeover boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lead_lease_acquire(p_user uuid, p_projects uuid[], p_holder text, p_host text, p_agent text, p_takeover boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lead_lease_acquire(p_user uuid, p_projects uuid[], p_holder text, p_host text, p_agent text, p_takeover boolean) TO service_role;


--
-- Name: FUNCTION lead_lease_force_release(p_user uuid, p_project uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lead_lease_force_release(p_user uuid, p_project uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lead_lease_force_release(p_user uuid, p_project uuid) TO service_role;


--
-- Name: FUNCTION lead_lease_release(p_user uuid, p_holder text, p_leases jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lead_lease_release(p_user uuid, p_holder text, p_leases jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lead_lease_release(p_user uuid, p_holder text, p_leases jsonb) TO service_role;


--
-- Name: FUNCTION lead_lease_renew(p_user uuid, p_holder text, p_leases jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lead_lease_renew(p_user uuid, p_holder text, p_leases jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lead_lease_renew(p_user uuid, p_holder text, p_leases jsonb) TO service_role;


--
-- Name: FUNCTION lead_lease_ttl(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.lead_lease_ttl() TO anon;
GRANT ALL ON FUNCTION public.lead_lease_ttl() TO authenticated;
GRANT ALL ON FUNCTION public.lead_lease_ttl() TO service_role;


--
-- Name: FUNCTION match_ai_documents(query_embedding public.vector, match_count integer, p_project_ids uuid[], p_include_global boolean, p_domains text[], p_entity_types text[], p_team text, p_date_from date, p_date_to date, p_index_version integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_ai_documents(query_embedding public.vector, match_count integer, p_project_ids uuid[], p_include_global boolean, p_domains text[], p_entity_types text[], p_team text, p_date_from date, p_date_to date, p_index_version integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_ai_documents(query_embedding public.vector, match_count integer, p_project_ids uuid[], p_include_global boolean, p_domains text[], p_entity_types text[], p_team text, p_date_from date, p_date_to date, p_index_version integer) TO authenticated;
GRANT ALL ON FUNCTION public.match_ai_documents(query_embedding public.vector, match_count integer, p_project_ids uuid[], p_include_global boolean, p_domains text[], p_entity_types text[], p_team text, p_date_from date, p_date_to date, p_index_version integer) TO service_role;


--
-- Name: FUNCTION match_ai_documents_lexical(p_tokens text[], match_count integer, p_project_ids uuid[], p_include_global boolean, p_domains text[], p_entity_types text[], p_index_version integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_ai_documents_lexical(p_tokens text[], match_count integer, p_project_ids uuid[], p_include_global boolean, p_domains text[], p_entity_types text[], p_index_version integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_ai_documents_lexical(p_tokens text[], match_count integer, p_project_ids uuid[], p_include_global boolean, p_domains text[], p_entity_types text[], p_index_version integer) TO authenticated;
GRANT ALL ON FUNCTION public.match_ai_documents_lexical(p_tokens text[], match_count integer, p_project_ids uuid[], p_include_global boolean, p_domains text[], p_entity_types text[], p_index_version integer) TO service_role;


--
-- Name: FUNCTION match_minute_documents(query_embedding public.vector, match_count integer, p_team text, p_date_from date, p_date_to date, p_folder_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.match_minute_documents(query_embedding public.vector, match_count integer, p_team text, p_date_from date, p_date_to date, p_folder_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.match_minute_documents(query_embedding public.vector, match_count integer, p_team text, p_date_from date, p_date_to date, p_folder_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.match_minute_documents(query_embedding public.vector, match_count integer, p_team text, p_date_from date, p_date_to date, p_folder_ids uuid[]) TO service_role;


--
-- Name: FUNCTION match_wbs_documents(query_embedding public.vector, match_count integer, p_project_id uuid, p_kinds text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.match_wbs_documents(query_embedding public.vector, match_count integer, p_project_id uuid, p_kinds text[]) TO anon;
GRANT ALL ON FUNCTION public.match_wbs_documents(query_embedding public.vector, match_count integer, p_project_id uuid, p_kinds text[]) TO authenticated;
GRANT ALL ON FUNCTION public.match_wbs_documents(query_embedding public.vector, match_count integer, p_project_id uuid, p_kinds text[]) TO service_role;


--
-- Name: FUNCTION merge_wiki_topics(p_source_topic_id uuid, p_target_topic_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.merge_wiki_topics(p_source_topic_id uuid, p_target_topic_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_wiki_topics(p_source_topic_id uuid, p_target_topic_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.merge_wiki_topics(p_source_topic_id uuid, p_target_topic_id uuid) TO authenticated;


--
-- Name: FUNCTION minute_versions_reject_mutation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.minute_versions_reject_mutation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.minute_versions_reject_mutation() TO service_role;


--
-- Name: FUNCTION minutes_protect_external_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.minutes_protect_external_id() TO anon;
GRANT ALL ON FUNCTION public.minutes_protect_external_id() TO authenticated;
GRANT ALL ON FUNCTION public.minutes_protect_external_id() TO service_role;


--
-- Name: FUNCTION move_wiki_document(p_topic_id uuid, p_parent_id uuid, p_sort integer, p_pinned_order integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_wiki_document(p_topic_id uuid, p_parent_id uuid, p_sort integer, p_pinned_order integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_wiki_document(p_topic_id uuid, p_parent_id uuid, p_sort integer, p_pinned_order integer) TO service_role;
GRANT ALL ON FUNCTION public.move_wiki_document(p_topic_id uuid, p_parent_id uuid, p_sort integer, p_pinned_order integer) TO authenticated;


--
-- Name: FUNCTION notify_recipient_broadcast(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_recipient_broadcast() TO anon;
GRANT ALL ON FUNCTION public.notify_recipient_broadcast() TO authenticated;
GRANT ALL ON FUNCTION public.notify_recipient_broadcast() TO service_role;


--
-- Name: FUNCTION project_members_normalize_link(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.project_members_normalize_link() TO anon;
GRANT ALL ON FUNCTION public.project_members_normalize_link() TO authenticated;
GRANT ALL ON FUNCTION public.project_members_normalize_link() TO service_role;


--
-- Name: FUNCTION purge_read_notifications(retention_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.purge_read_notifications(retention_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_read_notifications(retention_days integer) TO service_role;


--
-- Name: FUNCTION queue_minute_ai_index_scope_change(p_project_id uuid, p_minute_id uuid, p_operation text, p_run_after timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.queue_minute_ai_index_scope_change(p_project_id uuid, p_minute_id uuid, p_operation text, p_run_after timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.queue_minute_ai_index_scope_change(p_project_id uuid, p_minute_id uuid, p_operation text, p_run_after timestamp with time zone) TO service_role;


--
-- Name: FUNCTION replace_ai_document_chunks(p_project_id uuid, p_domain text, p_entity_type text, p_entity_id text, p_index_version integer, p_source_updated_at timestamp with time zone, p_indexed_at timestamp with time zone, p_documents jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.replace_ai_document_chunks(p_project_id uuid, p_domain text, p_entity_type text, p_entity_id text, p_index_version integer, p_source_updated_at timestamp with time zone, p_indexed_at timestamp with time zone, p_documents jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.replace_ai_document_chunks(p_project_id uuid, p_domain text, p_entity_type text, p_entity_id text, p_index_version integer, p_source_updated_at timestamp with time zone, p_indexed_at timestamp with time zone, p_documents jsonb) TO service_role;


--
-- Name: FUNCTION replace_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.replace_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) TO anon;
GRANT ALL ON FUNCTION public.replace_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.replace_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb) TO service_role;


--
-- Name: FUNCTION request_wiki_processing_job_run(p_job_id bigint, p_force boolean, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_wiki_processing_job_run(p_job_id bigint, p_force boolean, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_wiki_processing_job_run(p_job_id bigint, p_force boolean, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION request_wiki_project_append(p_project_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_wiki_project_append(p_project_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_wiki_project_append(p_project_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION request_wiki_project_rebuild(p_project_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_wiki_project_rebuild(p_project_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_wiki_project_rebuild(p_project_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION restore_wiki_document_revision(p_topic_id uuid, p_revision_id uuid, p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.restore_wiki_document_revision(p_topic_id uuid, p_revision_id uuid, p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.restore_wiki_document_revision(p_topic_id uuid, p_revision_id uuid, p_expected_updated_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.restore_wiki_document_revision(p_topic_id uuid, p_revision_id uuid, p_expected_updated_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION retract_minute_wiki_sources(p_minute_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.retract_minute_wiki_sources(p_minute_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retract_minute_wiki_sources(p_minute_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION review_wiki_item(p_item_id uuid, p_review_state text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.review_wiki_item(p_item_id uuid, p_review_state text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_wiki_item(p_item_id uuid, p_review_state text) TO service_role;
GRANT ALL ON FUNCTION public.review_wiki_item(p_item_id uuid, p_review_state text) TO authenticated;


--
-- Name: FUNCTION save_wiki_document(p_topic_id uuid, p_title text, p_body_md text, p_document_kind text, p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_wiki_document(p_topic_id uuid, p_title text, p_body_md text, p_document_kind text, p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_wiki_document(p_topic_id uuid, p_title text, p_body_md text, p_document_kind text, p_expected_updated_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.save_wiki_document(p_topic_id uuid, p_title text, p_body_md text, p_document_kind text, p_expected_updated_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION set_dependency_waiver(p_item_id uuid, p_pred_ref text, p_waive boolean, p_reason text, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_dependency_waiver(p_item_id uuid, p_pred_ref text, p_waive boolean, p_reason text, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_dependency_waiver(p_item_id uuid, p_pred_ref text, p_waive boolean, p_reason text, p_actor uuid) TO service_role;


--
-- Name: FUNCTION submit_wiki_feedback(p_topic_id uuid, p_kind text, p_comment text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_wiki_feedback(p_topic_id uuid, p_kind text, p_comment text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_wiki_feedback(p_topic_id uuid, p_kind text, p_comment text) TO service_role;
GRANT ALL ON FUNCTION public.submit_wiki_feedback(p_topic_id uuid, p_kind text, p_comment text) TO authenticated;


--
-- Name: FUNCTION update_minute_metadata_with_wiki_retraction(p_minute_id uuid, p_metadata jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_minute_metadata_with_wiki_retraction(p_minute_id uuid, p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_minute_metadata_with_wiki_retraction(p_minute_id uuid, p_metadata jsonb) TO service_role;


--
-- Name: FUNCTION update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text) TO service_role;
GRANT ALL ON FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text) TO authenticated;


--
-- Name: FUNCTION upsert_ai_index_jobs(p_jobs jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_ai_index_jobs(p_jobs jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_ai_index_jobs(p_jobs jsonb) TO service_role;


--
-- Name: FUNCTION usage_daily_actives(p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.usage_daily_actives(p_from date, p_to date) TO anon;
GRANT ALL ON FUNCTION public.usage_daily_actives(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.usage_daily_actives(p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION usage_menu_ranking(p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.usage_menu_ranking(p_from date, p_to date) TO anon;
GRANT ALL ON FUNCTION public.usage_menu_ranking(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.usage_menu_ranking(p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION usage_sessions(p_from date, p_to date, p_gap_minutes integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.usage_sessions(p_from date, p_to date, p_gap_minutes integer) TO anon;
GRANT ALL ON FUNCTION public.usage_sessions(p_from date, p_to date, p_gap_minutes integer) TO authenticated;
GRANT ALL ON FUNCTION public.usage_sessions(p_from date, p_to date, p_gap_minutes integer) TO service_role;


--
-- Name: FUNCTION usage_summary(p_from date, p_to date, p_today date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.usage_summary(p_from date, p_to date, p_today date) TO anon;
GRANT ALL ON FUNCTION public.usage_summary(p_from date, p_to date, p_today date) TO authenticated;
GRANT ALL ON FUNCTION public.usage_summary(p_from date, p_to date, p_today date) TO service_role;


--
-- Name: FUNCTION usage_user_rollup(p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.usage_user_rollup(p_from date, p_to date) TO anon;
GRANT ALL ON FUNCTION public.usage_user_rollup(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.usage_user_rollup(p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION validate_task_dependency(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_task_dependency() TO anon;
GRANT ALL ON FUNCTION public.validate_task_dependency() TO authenticated;
GRANT ALL ON FUNCTION public.validate_task_dependency() TO service_role;


--
-- Name: FUNCTION verify_wiki_document(p_topic_id uuid, p_review_days integer, p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.verify_wiki_document(p_topic_id uuid, p_review_days integer, p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_wiki_document(p_topic_id uuid, p_review_days integer, p_expected_updated_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.verify_wiki_document(p_topic_id uuid, p_review_days integer, p_expected_updated_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION wbs_is_leaf(p_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wbs_is_leaf(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wbs_is_leaf(p_item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.wbs_is_leaf(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.wbs_is_leaf(p_item_id uuid) TO service_role;


--
-- Name: FUNCTION wbs_items_broadcast(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.wbs_items_broadcast() TO anon;
GRANT ALL ON FUNCTION public.wbs_items_broadcast() TO authenticated;
GRANT ALL ON FUNCTION public.wbs_items_broadcast() TO service_role;


--
-- Name: FUNCTION wbs_items_prune_waived(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.wbs_items_prune_waived() TO anon;
GRANT ALL ON FUNCTION public.wbs_items_prune_waived() TO authenticated;
GRANT ALL ON FUNCTION public.wbs_items_prune_waived() TO service_role;


--
-- Name: FUNCTION wiki_change_events_copy_source_provenance(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wiki_change_events_copy_source_provenance() FROM PUBLIC;
GRANT ALL ON FUNCTION public.wiki_change_events_copy_source_provenance() TO service_role;


--
-- Name: FUNCTION wiki_fnv1a64(p_text text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wiki_fnv1a64(p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wiki_fnv1a64(p_text text) TO service_role;


--
-- Name: FUNCTION wiki_item_has_live_source(p_item_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wiki_item_has_live_source(p_item_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wiki_item_has_live_source(p_item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.wiki_item_has_live_source(p_item_id uuid) TO service_role;


--
-- Name: FUNCTION wiki_key_slug(p_text text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wiki_key_slug(p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wiki_key_slug(p_text text) TO authenticated;
GRANT ALL ON FUNCTION public.wiki_key_slug(p_text text) TO service_role;


--
-- Name: FUNCTION wiki_normalize_document_title(p_title text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wiki_normalize_document_title(p_title text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wiki_normalize_document_title(p_title text) TO service_role;


--
-- Name: FUNCTION wiki_topic_revisions_reject_mutation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wiki_topic_revisions_reject_mutation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.wiki_topic_revisions_reject_mutation() TO service_role;


--
-- Name: TABLE agent_lead_leases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_lead_leases TO anon;
GRANT ALL ON TABLE public.agent_lead_leases TO authenticated;
GRANT ALL ON TABLE public.agent_lead_leases TO service_role;


--
-- Name: TABLE agent_projects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_projects TO service_role;
GRANT SELECT ON TABLE public.agent_projects TO authenticated;


--
-- Name: TABLE agent_runners; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_runners TO service_role;


--
-- Name: TABLE agent_watchers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_watchers TO anon;
GRANT ALL ON TABLE public.agent_watchers TO authenticated;
GRANT ALL ON TABLE public.agent_watchers TO service_role;


--
-- Name: TABLE agent_work_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_work_orders TO service_role;
GRANT SELECT ON TABLE public.agent_work_orders TO authenticated;


--
-- Name: TABLE agent_work_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_work_reports TO service_role;
GRANT SELECT ON TABLE public.agent_work_reports TO authenticated;


--
-- Name: TABLE ai_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_documents TO service_role;
GRANT SELECT ON TABLE public.ai_documents TO authenticated;


--
-- Name: SEQUENCE ai_index_jobs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.ai_index_jobs_id_seq TO service_role;


--
-- Name: TABLE announcement_seen; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.announcement_seen TO anon;
GRANT ALL ON TABLE public.announcement_seen TO authenticated;
GRANT ALL ON TABLE public.announcement_seen TO service_role;


--
-- Name: TABLE announcements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.announcements TO anon;
GRANT ALL ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;


--
-- Name: TABLE attendance_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attendance_records TO anon;
GRANT ALL ON TABLE public.attendance_records TO authenticated;
GRANT ALL ON TABLE public.attendance_records TO service_role;


--
-- Name: TABLE change_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.change_logs TO anon;
GRANT ALL ON TABLE public.change_logs TO authenticated;
GRANT ALL ON TABLE public.change_logs TO service_role;


--
-- Name: SEQUENCE change_logs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.change_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.change_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.change_logs_id_seq TO service_role;


--
-- Name: TABLE deliverable_attachments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deliverable_attachments TO anon;
GRANT ALL ON TABLE public.deliverable_attachments TO authenticated;
GRANT ALL ON TABLE public.deliverable_attachments TO service_role;


--
-- Name: TABLE holidays; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.holidays TO anon;
GRANT ALL ON TABLE public.holidays TO authenticated;
GRANT ALL ON TABLE public.holidays TO service_role;


--
-- Name: TABLE issue_analysis_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issue_analysis_runs TO service_role;
GRANT SELECT ON TABLE public.issue_analysis_runs TO authenticated;


--
-- Name: TABLE issue_assignees; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issue_assignees TO anon;
GRANT ALL ON TABLE public.issue_assignees TO authenticated;
GRANT ALL ON TABLE public.issue_assignees TO service_role;


--
-- Name: TABLE issue_attachments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issue_attachments TO service_role;
GRANT SELECT,INSERT,DELETE ON TABLE public.issue_attachments TO authenticated;


--
-- Name: TABLE issue_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issue_links TO service_role;
GRANT SELECT ON TABLE public.issue_links TO authenticated;


--
-- Name: TABLE issue_major_processes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issue_major_processes TO service_role;
GRANT SELECT,INSERT ON TABLE public.issue_major_processes TO authenticated;


--
-- Name: TABLE issue_mega_areas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issue_mega_areas TO service_role;
GRANT SELECT ON TABLE public.issue_mega_areas TO authenticated;


--
-- Name: TABLE issue_number_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issue_number_counters TO service_role;


--
-- Name: TABLE issue_updates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issue_updates TO service_role;
GRANT SELECT,DELETE ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.issue_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(issue_id) ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.project_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(project_id) ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.category; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(category) ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.body; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(body) ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.mentioned_member_ids; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(mentioned_member_ids) ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.author_user_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(author_user_id) ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.author_name; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(author_name) ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.archived_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(archived_at) ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.archived_by; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(archived_by) ON TABLE public.issue_updates TO authenticated;


--
-- Name: COLUMN issue_updates.archived_by_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(archived_by_name) ON TABLE public.issue_updates TO authenticated;


--
-- Name: TABLE issues; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issues TO anon;
GRANT ALL ON TABLE public.issues TO authenticated;
GRANT ALL ON TABLE public.issues TO service_role;


--
-- Name: SEQUENCE issues_issue_no_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.issues_issue_no_seq TO anon;
GRANT ALL ON SEQUENCE public.issues_issue_no_seq TO authenticated;
GRANT ALL ON SEQUENCE public.issues_issue_no_seq TO service_role;


--
-- Name: TABLE item_owners; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.item_owners TO anon;
GRANT ALL ON TABLE public.item_owners TO authenticated;
GRANT ALL ON TABLE public.item_owners TO service_role;


--
-- Name: TABLE llm_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.llm_config TO anon;
GRANT ALL ON TABLE public.llm_config TO authenticated;
GRANT ALL ON TABLE public.llm_config TO service_role;


--
-- Name: TABLE llm_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.llm_profiles TO anon;
GRANT ALL ON TABLE public.llm_profiles TO authenticated;
GRANT ALL ON TABLE public.llm_profiles TO service_role;


--
-- Name: SEQUENCE llm_profiles_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.llm_profiles_id_seq TO anon;
GRANT ALL ON SEQUENCE public.llm_profiles_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.llm_profiles_id_seq TO service_role;


--
-- Name: TABLE meeting_attendees; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meeting_attendees TO anon;
GRANT ALL ON TABLE public.meeting_attendees TO authenticated;
GRANT ALL ON TABLE public.meeting_attendees TO service_role;


--
-- Name: TABLE meeting_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meeting_exceptions TO anon;
GRANT ALL ON TABLE public.meeting_exceptions TO authenticated;
GRANT ALL ON TABLE public.meeting_exceptions TO service_role;


--
-- Name: TABLE meetings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meetings TO anon;
GRANT ALL ON TABLE public.meetings TO authenticated;
GRANT ALL ON TABLE public.meetings TO service_role;


--
-- Name: TABLE memberships; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.memberships TO anon;
GRANT ALL ON TABLE public.memberships TO authenticated;
GRANT ALL ON TABLE public.memberships TO service_role;


--
-- Name: TABLE minute_embeddings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.minute_embeddings TO anon;
GRANT ALL ON TABLE public.minute_embeddings TO authenticated;
GRANT ALL ON TABLE public.minute_embeddings TO service_role;


--
-- Name: TABLE minute_favorites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.minute_favorites TO anon;
GRANT ALL ON TABLE public.minute_favorites TO authenticated;
GRANT ALL ON TABLE public.minute_favorites TO service_role;


--
-- Name: TABLE minute_files; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.minute_files TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.minute_files TO authenticated;


--
-- Name: TABLE minute_folders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.minute_folders TO anon;
GRANT ALL ON TABLE public.minute_folders TO authenticated;
GRANT ALL ON TABLE public.minute_folders TO service_role;


--
-- Name: TABLE minute_highlights; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.minute_highlights TO anon;
GRANT ALL ON TABLE public.minute_highlights TO authenticated;
GRANT ALL ON TABLE public.minute_highlights TO service_role;


--
-- Name: TABLE minute_insights; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.minute_insights TO anon;
GRANT ALL ON TABLE public.minute_insights TO authenticated;
GRANT ALL ON TABLE public.minute_insights TO service_role;


--
-- Name: TABLE minute_versions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.minute_versions TO service_role;
GRANT SELECT ON TABLE public.minute_versions TO authenticated;


--
-- Name: TABLE minutes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.minutes TO service_role;
GRANT SELECT ON TABLE public.minutes TO authenticated;


--
-- Name: TABLE notification_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_events TO service_role;
GRANT SELECT ON TABLE public.notification_events TO authenticated;


--
-- Name: TABLE notification_recipients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_recipients TO service_role;
GRANT SELECT ON TABLE public.notification_recipients TO authenticated;


--
-- Name: TABLE project_ai_briefs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_ai_briefs TO anon;
GRANT ALL ON TABLE public.project_ai_briefs TO authenticated;
GRANT ALL ON TABLE public.project_ai_briefs TO service_role;


--
-- Name: TABLE project_invites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_invites TO service_role;


--
-- Name: TABLE project_member_identities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_member_identities TO service_role;


--
-- Name: TABLE project_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_members TO anon;
GRANT ALL ON TABLE public.project_members TO authenticated;
GRANT ALL ON TABLE public.project_members TO service_role;


--
-- Name: TABLE project_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_roles TO anon;
GRANT ALL ON TABLE public.project_roles TO authenticated;
GRANT ALL ON TABLE public.project_roles TO service_role;


--
-- Name: TABLE project_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_settings TO service_role;
GRANT SELECT ON TABLE public.project_settings TO authenticated;


--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.projects TO anon;
GRANT ALL ON TABLE public.projects TO authenticated;
GRANT ALL ON TABLE public.projects TO service_role;


--
-- Name: TABLE task_dependencies; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_dependencies TO anon;
GRANT ALL ON TABLE public.task_dependencies TO authenticated;
GRANT ALL ON TABLE public.task_dependencies TO service_role;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teams TO anon;
GRANT ALL ON TABLE public.teams TO authenticated;
GRANT ALL ON TABLE public.teams TO service_role;


--
-- Name: TABLE usage_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usage_events TO service_role;
GRANT SELECT ON TABLE public.usage_events TO authenticated;


--
-- Name: SEQUENCE usage_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.usage_events_id_seq TO service_role;


--
-- Name: TABLE user_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_preferences TO anon;
GRANT ALL ON TABLE public.user_preferences TO authenticated;
GRANT ALL ON TABLE public.user_preferences TO service_role;


--
-- Name: TABLE user_wbs_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_wbs_state TO anon;
GRANT ALL ON TABLE public.user_wbs_state TO authenticated;
GRANT ALL ON TABLE public.user_wbs_state TO service_role;


--
-- Name: TABLE wbs_embeddings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wbs_embeddings TO anon;
GRANT ALL ON TABLE public.wbs_embeddings TO authenticated;
GRANT ALL ON TABLE public.wbs_embeddings TO service_role;


--
-- Name: TABLE wbs_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wbs_items TO anon;
GRANT ALL ON TABLE public.wbs_items TO authenticated;
GRANT ALL ON TABLE public.wbs_items TO service_role;


--
-- Name: TABLE wbs_progress_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wbs_progress_snapshots TO anon;
GRANT ALL ON TABLE public.wbs_progress_snapshots TO authenticated;
GRANT ALL ON TABLE public.wbs_progress_snapshots TO service_role;


--
-- Name: TABLE weekly_report_rows; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.weekly_report_rows TO anon;
GRANT ALL ON TABLE public.weekly_report_rows TO authenticated;
GRANT ALL ON TABLE public.weekly_report_rows TO service_role;


--
-- Name: TABLE weekly_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.weekly_reports TO anon;
GRANT ALL ON TABLE public.weekly_reports TO authenticated;
GRANT ALL ON TABLE public.weekly_reports TO service_role;


--
-- Name: TABLE wiki_change_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_change_events TO service_role;
GRANT SELECT ON TABLE public.wiki_change_events TO authenticated;


--
-- Name: TABLE wiki_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_feedback TO service_role;
GRANT SELECT ON TABLE public.wiki_feedback TO authenticated;


--
-- Name: COLUMN wiki_feedback.project_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(project_id) ON TABLE public.wiki_feedback TO authenticated;


--
-- Name: COLUMN wiki_feedback.topic_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(topic_id) ON TABLE public.wiki_feedback TO authenticated;


--
-- Name: COLUMN wiki_feedback.feedback_type; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(feedback_type) ON TABLE public.wiki_feedback TO authenticated;


--
-- Name: COLUMN wiki_feedback.comment; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(comment) ON TABLE public.wiki_feedback TO authenticated;


--
-- Name: TABLE wiki_item_relations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_item_relations TO service_role;
GRANT SELECT ON TABLE public.wiki_item_relations TO authenticated;


--
-- Name: TABLE wiki_item_sources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_item_sources TO service_role;
GRANT SELECT ON TABLE public.wiki_item_sources TO authenticated;


--
-- Name: TABLE wiki_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_items TO service_role;
GRANT SELECT ON TABLE public.wiki_items TO authenticated;


--
-- Name: SEQUENCE wiki_processing_jobs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.wiki_processing_jobs_id_seq TO service_role;


--
-- Name: TABLE wiki_project_rebuild_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_project_rebuild_jobs TO service_role;


--
-- Name: TABLE wiki_questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_questions TO service_role;
GRANT SELECT ON TABLE public.wiki_questions TO authenticated;


--
-- Name: COLUMN wiki_questions.project_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(project_id) ON TABLE public.wiki_questions TO authenticated;


--
-- Name: COLUMN wiki_questions.topic_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(topic_id) ON TABLE public.wiki_questions TO authenticated;


--
-- Name: COLUMN wiki_questions.question; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(question) ON TABLE public.wiki_questions TO authenticated;


--
-- Name: TABLE wiki_topic_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_topic_revisions TO service_role;
GRANT SELECT ON TABLE public.wiki_topic_revisions TO authenticated;


--
-- Name: TABLE wiki_topics; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_topics TO service_role;
GRANT SELECT ON TABLE public.wiki_topics TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--


