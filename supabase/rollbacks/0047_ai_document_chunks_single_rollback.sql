-- 0047 롤백 — 기준선의 8인자 replace_ai_document_chunks 를 되살리고 9인자 정의의 authenticated 실행권을 돌려놓는다.
-- 되돌리면 8개 인자 호출이 다시 모호해진다(앱은 0047 뒤로 p_workspace_id 를 함께 넘기므로 9인자로 해석된다).
begin;

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

revoke all on function public.replace_ai_document_chunks(uuid, text, text, text, integer, timestamp with time zone, timestamp with time zone, jsonb) from public, anon, authenticated;
grant execute on function public.replace_ai_document_chunks(uuid, text, text, text, integer, timestamp with time zone, timestamp with time zone, jsonb) to service_role;
grant execute on function public.replace_ai_document_chunks(uuid, text, text, text, integer, timestamp with time zone, timestamp with time zone, jsonb, uuid) to authenticated;

commit;
