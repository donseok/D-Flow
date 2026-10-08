-- 0042 롤백 — match_ai_documents·match_ai_documents_lexical 을 0036 시점 정의로 되돌린다(language sql, p_include_global 없음).
-- **범위 강제가 풀린다**: p_workspace_id 가 다시 선택(null 이면 워크스페이스 필터 없음)이 되고, p_project_ids 가 null 이면 전 프로젝트를 본다.
-- 0042 에 맞춘 앱(호출부가 p_include_global 을 넘긴다)은 이 롤백 뒤 PGRST202 로 실패한다 — 앱을 먼저 되돌린 뒤 적용한다. 데이터 변화 없음.

begin;

drop function public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer, boolean);

create function public.match_ai_documents(
  query_embedding public.vector,
  match_count integer default 20,
  p_workspace_id uuid default null::uuid,
  p_project_ids uuid[] default null::uuid[],
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
    and (p_workspace_id is null or d.workspace_id = p_workspace_id)
    and (p_project_ids is null or d.project_id = any(p_project_ids))
    and (p_domains is null or d.domain = any(p_domains))
    and (p_entity_types is null or d.entity_type = any(p_entity_types))
    and (p_team is null or d.team = p_team)
    and (p_date_from is null or d.occurred_on >= p_date_from)
    and (p_date_to is null or d.occurred_on <= p_date_to)
  order by d.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

revoke all on function public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer) from public, anon;
grant execute on function public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer) to authenticated, service_role;

drop function public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer, boolean);

create function public.match_ai_documents_lexical(
  p_tokens text[],
  match_count integer default 20,
  p_workspace_id uuid default null::uuid,
  p_project_ids uuid[] default null::uuid[],
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
      and (p_workspace_id is null or d.workspace_id = p_workspace_id)
      and (p_project_ids is null or d.project_id = any(p_project_ids))
      and (p_domains is null or d.domain = any(p_domains))
      and (p_entity_types is null or d.entity_type = any(p_entity_types))
      and (d.content ilike ('%' || tok || '%') or d.title ilike ('%' || tok || '%'))
  ) s
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

revoke all on function public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer) from public, anon;
grant execute on function public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer) to authenticated, service_role;

-- 사후 검증 (AI_SEARCH_SCOPE_ROLLBACK_POSTCHECK)
do $$
declare
  v_sig text;
begin
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('match_ai_documents', 'match_ai_documents_lexical')) <> 2 then
    raise exception 'AI_SEARCH_SCOPE_ROLLBACK_POSTCHECK: 검색 RPC 의 overload 수가 0036 시점과 다르다' using errcode = 'P0001';
  end if;
  foreach v_sig in array array[
    'public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer)',
    'public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'AI_SEARCH_SCOPE_ROLLBACK_POSTCHECK: % 가 없다', v_sig using errcode = 'P0001';
    end if;
    if has_function_privilege('anon', v_sig, 'execute')
       or not has_function_privilege('authenticated', v_sig, 'execute')
       or not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception 'AI_SEARCH_SCOPE_ROLLBACK_POSTCHECK: % 의 실행 권한이 0036 시점과 다르다', v_sig using errcode = '42501';
    end if;
  end loop;
end $$;

-- match_minute_documents 를 0022 정의(p_workspace_id 가 null 이면 필터 없음)로 되돌린다
CREATE OR REPLACE FUNCTION public.match_minute_documents(query_embedding vector, match_count integer DEFAULT 8, p_team text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_folder_ids uuid[] DEFAULT NULL::uuid[], p_workspace_id uuid DEFAULT NULL::uuid, p_exclude_project_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(minute_id uuid, chunk_index integer, content text, minute_date date, team_code text, title text, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
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
    and (p_workspace_id is null or m.workspace_id = p_workspace_id)
    -- 무프로젝트 회의록은 제외 목록의 대상이 아니다(숨김은 프로젝트 단위). 빈 목록은 아무것도 빼지 않는다.
    and (p_exclude_project_ids is null or m.project_id is null or m.project_id <> all(p_exclude_project_ids))
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1)
$function$;

commit;
