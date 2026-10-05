-- SP5 B3 과제11(스펙 §9 ⑦): 의미검색 RPC 에 범위 인자를 더한다. 여러 워크스페이스 소속자는 RLS 만으로는 다른 워크스페이스 회의록·
-- 숨김 프로젝트 청크가 top-k 를 차지해, 앱이 넉넉히 받아 거른 뒤에도 회수율이 떨어졌다. 범위를 SQL 안에서 거른 뒤 순위를 매긴다.
-- 두 함수는 계속 SECURITY INVOKER — 세션 RLS(minute_embeddings·wbs_embeddings 읽기 정책, 0006)가 그대로 먼저 적용된다. 새 인자는
-- 좁히기만 한다(넓히지 않는다). 옛 시그니처는 지운다 — 같은 이름 overload 가 남으면 이름 인자 호출이 모호해진다(PGRST203).
-- 새 인자는 끝에 default null 로 붙어 기존 호출부(이름 인자)가 그대로 돈다. 데이터 변화 없음.

drop function public.match_minute_documents(public.vector, integer, text, date, date, uuid[]);
create function public.match_minute_documents(
  query_embedding public.vector, match_count integer default 8, p_team text default null,
  p_date_from date default null, p_date_to date default null, p_folder_ids uuid[] default null,
  p_workspace_id uuid default null, p_exclude_project_ids uuid[] default null
) returns table(minute_id uuid, chunk_index integer, content text, minute_date date, team_code text, title text, similarity double precision)
language sql stable as $$
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
$$;
revoke all on function public.match_minute_documents(public.vector, integer, text, date, date, uuid[], uuid, uuid[]) from public, anon;
grant execute on function public.match_minute_documents(public.vector, integer, text, date, date, uuid[], uuid, uuid[]) to authenticated, service_role;

drop function public.match_wbs_documents(public.vector, integer, uuid, text[]);
create function public.match_wbs_documents(
  query_embedding public.vector, match_count integer default 8, p_project_id uuid default null, p_kinds text[] default null,
  p_project_ids uuid[] default null
) returns table(id uuid, project_id uuid, kind text, ref_id uuid, content text, similarity double precision)
language sql stable as $$
  select
    e.id, e.project_id, e.kind, e.ref_id, e.content,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.wbs_embeddings e
  where e.embedding is not null
    and (p_project_id is null or e.project_id = p_project_id)
    and (p_kinds is null or e.kind = any (p_kinds))
    -- 허용 목록(여러 프로젝트) — 빈 목록은 0건이다(허용된 프로젝트가 없다). null 만 제한 없음.
    and (p_project_ids is null or e.project_id = any (p_project_ids))
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
revoke all on function public.match_wbs_documents(public.vector, integer, uuid, text[], uuid[]) from public, anon;
grant execute on function public.match_wbs_documents(public.vector, integer, uuid, text[], uuid[]) to authenticated, service_role;

do $$
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('match_minute_documents', 'match_wbs_documents')) <> 2
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('match_minute_documents', 'match_wbs_documents') and prosecdef)
     or has_function_privilege('anon', 'public.match_minute_documents(public.vector, integer, text, date, date, uuid[], uuid, uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.match_wbs_documents(public.vector, integer, uuid, text[], uuid[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.match_minute_documents(public.vector, integer, text, date, date, uuid[], uuid, uuid[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.match_wbs_documents(public.vector, integer, uuid, text[], uuid[])', 'EXECUTE') then
    raise exception using errcode = '23514', message = 'SEMANTIC_SCOPE_POSTCHECK';
  end if;
end
$$;
