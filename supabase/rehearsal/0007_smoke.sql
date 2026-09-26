-- 0007_storage_realtime 리허설 스모크(불리언 전부 t). docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0007_smoke.sql
-- 정책 자체의 교차 판정(A·B 계정)은 tests/rls/storage-realtime.test.ts 가 본다 — 여기는 헬퍼·카탈로그만.
begin;
select public.uuid_or_null('garbage') is null as bad_is_null,
       public.uuid_or_null('11111111-1111-4111-8111-111111111111') is not null as good_parses,
       public.storage_ws('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/22222222-2222-4222-8222-222222222222/f')
         = '11111111-1111-4111-8111-111111111111' as ws_segment,
       public.storage_project('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/22222222-2222-4222-8222-222222222222/f') is null as underscore_is_null,
       public.storage_project('ws/11111111-1111-4111-8111-111111111111/p/33333333-3333-4333-8333-333333333333/minutes/22222222-2222-4222-8222-222222222222/f')
         = '33333333-3333-4333-8333-333333333333' as project_segment,
       public.storage_entity_id('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/not-uuid/f') is null as bad_entity_is_null,
       public.storage_ws('a/b/c') is null as short_path_is_null,
       public.storage_ws('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/22222222-2222-4222-8222-222222222222/a/b') is null as eight_segments_is_null,
       public.storage_ws('ws/11111111-1111-4111-8111-111111111111/p/zz/minutes/22222222-2222-4222-8222-222222222222/f') is null as junk_project_is_null,
       public.storage_ws('ws/11111111-1111-4111-8111-111111111111/p/_/other/22222222-2222-4222-8222-222222222222/f') is null as unknown_entity_is_null,
       public.storage_ws('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/22222222-2222-4222-8222-222222222222/' || repeat('x', 201)) is null as long_file_is_null,
       public.minute_body_path_ok('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/22222222-2222-4222-8222-222222222222/f.md',
         '11111111-1111-4111-8111-111111111111', null, '22222222-2222-4222-8222-222222222222') as body_path_null_project_ok,
       not public.minute_body_path_ok('22222222-2222-4222-8222-222222222222/f.md',
         '11111111-1111-4111-8111-111111111111', null, '22222222-2222-4222-8222-222222222222') as body_path_legacy_rejected,
       not public.minute_body_path_ok('ws/11111111-1111-4111-8111-111111111111/p/_/minutes/22222222-2222-4222-8222-222222222222/f.md',
         '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222') as body_path_project_mismatch_rejected,
       public.presence_topic_project('project-33333333-3333-4333-8333-333333333333-presence-wbs') = '33333333-3333-4333-8333-333333333333' as presence_page_pid,
       public.presence_topic_project('project-33333333-3333-4333-8333-333333333333-weekly-22222222-2222-4222-8222-222222222222-presence')
         = '33333333-3333-4333-8333-333333333333' as presence_weekly_pid,
       public.presence_topic_project('project-not-a-uuid-presence-wbs') is null as presence_bad_is_null,
       (select count(*) = 3 from pg_policies where schemaname = 'realtime' and policyname in ('join_project_presence', 'read_project_presence', 'track_project_presence')) as presence_policies,
       (select count(*) = 9 from pg_policies where schemaname = 'storage' and tablename = 'objects') as storage_policies,
       not has_function_privilege('anon', 'public.storage_ws(text)', 'EXECUTE') as anon_no_storage_helpers,
       has_function_privilege('authenticated', 'public.presence_topic_project(text)', 'EXECUTE') as authenticated_presence_helper;
rollback;
