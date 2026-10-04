-- 0022_semantic_scope 롤백 — 두 의미검색 RPC 를 기준선(0000)의 시그니처·본문과 0006 의 실행권(authenticated·service_role)으로 되돌린다.
-- 데이터 변화 없음. 롤백 전 앱 코드가 새 인자(p_workspace_id·p_exclude_project_ids·p_project_ids)를 보내지 않는 판으로 먼저 돌아가 있어야 한다
-- — 아니면 PostgREST 가 함수를 찾지 못해(PGRST202) 의미검색이 빈 결과로 강등된다(retrieve.ts·minutes-answer.ts 는 오류를 로그로 남긴다).

drop function public.match_minute_documents(public.vector, integer, text, date, date, uuid[], uuid, uuid[]);
create function public.match_minute_documents(
  query_embedding public.vector, match_count integer default 8, p_team text default null,
  p_date_from date default null, p_date_to date default null, p_folder_ids uuid[] default null
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
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
revoke all on function public.match_minute_documents(public.vector, integer, text, date, date, uuid[]) from public, anon;
grant execute on function public.match_minute_documents(public.vector, integer, text, date, date, uuid[]) to authenticated, service_role;

drop function public.match_wbs_documents(public.vector, integer, uuid, text[], uuid[]);
create function public.match_wbs_documents(
  query_embedding public.vector, match_count integer default 8, p_project_id uuid default null, p_kinds text[] default null
) returns table(id uuid, project_id uuid, kind text, ref_id uuid, content text, similarity double precision)
language sql stable as $$
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
revoke all on function public.match_wbs_documents(public.vector, integer, uuid, text[]) from public, anon;
grant execute on function public.match_wbs_documents(public.vector, integer, uuid, text[]) to authenticated, service_role;
