-- 0042_search_scope_required.sql
-- SP8(정본 §5.4.2, 개정 스펙 "SP8" done_when "p_workspace_id 필수") — AI 색인 검색 RPC 둘의 워크스페이스 범위를 강제한다.
--   · public.match_ai_documents          (벡터)
--   · public.match_ai_documents_lexical  (어휘)
-- 0036 은 두 함수에 p_workspace_id 를 더했지만 default null 이고 null 이면 필터가 없었다 — 호출부가 빠뜨리면 전 워크스페이스를 검색했다
-- (service_role 호출은 RLS 도 없다). 또 0036 은 p_include_global 을 없애면서 프로젝트 없는(전역) 문서를 회수할 길을 지웠다.
-- 바꾸는 것:
--   ① p_workspace_id 가 null 이면 AI_SEARCH_WORKSPACE_REQUIRED(22023)로 멈춘다. 본문은 항상 d.workspace_id = p_workspace_id.
--      (앞쪽 인자에 default 가 있어 문법상 default null 은 남는다 — 빠뜨린 호출도 같은 오류로 멈춘다.)
--   ② p_include_global boolean default false 를 끝에 더한다 — 참이면 그 워크스페이스의 project_id is null 문서도 포함한다.
--   ③ 프로젝트 조건은 (project_id = any(p_project_ids)) or (p_include_global and project_id is null).
--      p_project_ids 가 null·빈 배열이고 p_include_global 도 거짓이면 0행이다 — 전 프로젝트로 넓히지 않는다(fail-closed).
-- 두 함수는 계속 SECURITY INVOKER 다 — authenticated 호출에는 ai_documents_read(0036, 내 워크스페이스) RLS 가 먼저 적용된다.
-- 판정을 넣느라 sql → plpgsql 로 바꾼다(반환 열·stable·search_path 는 그대로). 시그니처가 바뀌므로 옛 것을 지운다 —
-- 같은 이름 overload 가 남으면 이름 인자 호출이 모호해진다(PGRST203). 권한은 0036 과 같다(authenticated·service_role). 데이터 변화 없음.

begin;

-- 1. match_ai_documents
drop function public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer);

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
  p_index_version integer default 1,
  p_include_global boolean default false
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
language plpgsql stable
set search_path to 'public', 'extensions'
as $$
#variable_conflict use_column
begin
  if p_workspace_id is null then
    raise exception 'AI_SEARCH_WORKSPACE_REQUIRED' using errcode = '22023';
  end if;

  return query
  select
    d.id, d.project_id, d.domain, d.entity_type, d.entity_id, d.chunk_no,
    d.index_version, d.title, d.content, d.content_hash, d.href, d.team,
    d.occurred_on, d.source_updated_at, d.embedding_model, d.embedding_dimensions,
    d.chunker_version, d.indexed_at,
    (1 - (d.embedding <=> query_embedding))::double precision as similarity
  from public.ai_documents d
  where d.index_version = p_index_version
    and d.workspace_id = p_workspace_id
    and (
      d.project_id = any(coalesce(p_project_ids, '{}'::uuid[]))
      or (coalesce(p_include_global, false) and d.project_id is null)
    )
    and (p_domains is null or d.domain = any(p_domains))
    and (p_entity_types is null or d.entity_type = any(p_entity_types))
    and (p_team is null or d.team = p_team)
    and (p_date_from is null or d.occurred_on >= p_date_from)
    and (p_date_to is null or d.occurred_on <= p_date_to)
  order by d.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 20), 100));
end;
$$;

revoke all on function public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer, boolean) from public, anon;
grant execute on function public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer, boolean) to authenticated, service_role;

-- 2. match_ai_documents_lexical
drop function public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer);

create function public.match_ai_documents_lexical(
  p_tokens text[],
  match_count integer default 20,
  p_workspace_id uuid default null::uuid,
  p_project_ids uuid[] default null::uuid[],
  p_domains text[] default null::text[],
  p_entity_types text[] default null::text[],
  p_index_version integer default 1,
  p_include_global boolean default false
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
language plpgsql stable
set search_path to 'public', 'extensions'
as $$
#variable_conflict use_column
begin
  if p_workspace_id is null then
    raise exception 'AI_SEARCH_WORKSPACE_REQUIRED' using errcode = '22023';
  end if;

  return query
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
      and d.workspace_id = p_workspace_id
      and (
        d.project_id = any(coalesce(p_project_ids, '{}'::uuid[]))
        or (coalesce(p_include_global, false) and d.project_id is null)
      )
      and (p_domains is null or d.domain = any(p_domains))
      and (p_entity_types is null or d.entity_type = any(p_entity_types))
      and (d.content ilike ('%' || tok || '%') or d.title ilike ('%' || tok || '%'))
  ) s
  limit greatest(1, least(coalesce(match_count, 20), 100));
end;
$$;

revoke all on function public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer, boolean) from public, anon;
grant execute on function public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer, boolean) to authenticated, service_role;

-- 2b. match_minute_documents — 회의록 의미검색도 워크스페이스 없이는 돌지 않는다(0022 는 p_workspace_id 가 null 이면 필터가 없었다).
--     시그니처·반환·권한은 그대로다(create or replace). 호출부(src/lib/ai/minutes-answer.ts)는 이미 워크스페이스를 넘긴다.
create or replace function public.match_minute_documents(
  query_embedding public.vector,
  match_count integer default 8,
  p_team text default null::text,
  p_date_from date default null::date,
  p_date_to date default null::date,
  p_folder_ids uuid[] default null::uuid[],
  p_workspace_id uuid default null::uuid,
  p_exclude_project_ids uuid[] default null::uuid[]
) returns table(minute_id uuid, chunk_index integer, content text, minute_date date, team_code text, title text, similarity double precision)
language plpgsql stable
as $$
begin
  if p_workspace_id is null then
    raise exception 'AI_SEARCH_WORKSPACE_REQUIRED' using errcode = '22023';
  end if;
  return query
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
    and m.workspace_id = p_workspace_id
    -- 무프로젝트 회의록은 제외 목록의 대상이 아니다(숨김은 프로젝트 단위). 빈 목록은 아무것도 빼지 않는다.
    and (p_exclude_project_ids is null or m.project_id is null or m.project_id <> all(p_exclude_project_ids))
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1);
end
$$;

-- 3. 사후 검증 (AI_SEARCH_SCOPE_POSTCHECK)
do $$
declare
  v_vec constant text := 'public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer, boolean)';
  v_lex constant text := 'public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer, boolean)';
  v_sig text;
begin
  -- 이름마다 정의가 하나뿐이다(옛 overload 가 남으면 이름 인자 호출이 모호해진다)
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'match_ai_documents') <> 1
     or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'match_ai_documents_lexical') <> 1 then
    raise exception 'AI_SEARCH_SCOPE_POSTCHECK: 검색 RPC 의 overload 가 하나가 아니다' using errcode = 'P0001';
  end if;

  foreach v_sig in array array[v_vec, v_lex] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'AI_SEARCH_SCOPE_POSTCHECK: % 가 없다', v_sig using errcode = 'P0001';
    end if;
    -- SECURITY INVOKER 유지 — definer 가 되면 authenticated 호출이 RLS 를 건너뛴다
    if (select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure(v_sig)) then
      raise exception 'AI_SEARCH_SCOPE_POSTCHECK: % 가 security definer 다', v_sig using errcode = 'P0001';
    end if;
    if has_function_privilege('anon', v_sig, 'execute')
       or not has_function_privilege('authenticated', v_sig, 'execute')
       or not has_function_privilege('service_role', v_sig, 'execute')
       or exists (
         select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
          where p.oid = to_regprocedure(v_sig) and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'AI_SEARCH_SCOPE_POSTCHECK: % 의 실행 권한이 0036 과 다르다', v_sig using errcode = '42501';
    end if;
  end loop;

  -- 워크스페이스 없는 호출은 멈춘다(두 함수 모두)
  begin
    perform 1 from public.match_ai_documents(null::public.vector, 1, null::uuid);
    raise exception 'AI_SEARCH_SCOPE_POSTCHECK: match_ai_documents 가 워크스페이스 없이 돌았다' using errcode = 'P0001';
  exception when invalid_parameter_value then
    if sqlerrm <> 'AI_SEARCH_WORKSPACE_REQUIRED' then raise; end if;
  end;
  begin
    perform 1 from public.match_ai_documents_lexical(array['x'], 1, null::uuid);
    raise exception 'AI_SEARCH_SCOPE_POSTCHECK: match_ai_documents_lexical 가 워크스페이스 없이 돌았다' using errcode = 'P0001';
  exception when invalid_parameter_value then
    if sqlerrm <> 'AI_SEARCH_WORKSPACE_REQUIRED' then raise; end if;
  end;
end $$;

commit;
