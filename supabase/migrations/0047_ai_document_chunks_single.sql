-- 0047_ai_document_chunks_single.sql
-- 색인 문서 교체(replace_ai_document_chunks)가 두 정의로 남아 색인이 한 건도 쌓이지 않았다.
-- 0036 이 p_workspace_id(기본값 null)를 더한 9인자 정의를 만들면서 기준선의 8인자 정의를 지우지 않았다. 워커는 8개 인자로 부르는데
-- 그 호출은 두 정의에 모두 맞아(9인자는 기본값으로) "not unique" 로 거부된다 — 워커의 모든 upsert 가 INDEX_UPSERT_FAILED 였다.
-- 옛 8인자 정의는 workspace_id(NOT NULL)를 채우지도 않아 남겨 둘 이유가 없다 — 지운다.
-- 9인자 정의는 만들 때 public·anon 만 회수해 authenticated 실행권이 기본 권한으로 남아 있었다. 쓰는 쪽은 service_role 워커뿐이다 — 회수한다.

begin;

drop function if exists public.replace_ai_document_chunks(uuid, text, text, text, integer, timestamp with time zone, timestamp with time zone, jsonb);
revoke all on function public.replace_ai_document_chunks(uuid, text, text, text, integer, timestamp with time zone, timestamp with time zone, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.replace_ai_document_chunks(uuid, text, text, text, integer, timestamp with time zone, timestamp with time zone, jsonb, uuid) to service_role;

commit;
