-- 0012 적용 뒤에 생긴 설정 문서 — 롤백 리허설의 픽스처(최종 리뷰 FN-9). seed_wide 는 0011 행만 심어 0012 의 생성 RPC 가 만드는 모양
-- (키워드 키 없음)을 덮지 못했다. seed_wide → migration up → 0012_smoke 뒤, 롤백 앞에 흘리고 **커밋**한다(절차는 seed 파일 머리).
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0012_created_fixture.sql
-- 프로젝트 셋(이름으로 찾는다 — 생성 RPC 가 id 를 정한다): 키워드 없이 생성, 명시 [] 로 생성, 키워드를 넣어 생성한 뒤 unset(기본값으로).
-- 롤백 뒤 0012_rollback_check.sql 이 첫째·셋째는 제품 기본값 6개, 둘째는 '{}' 인지 본다. uuid 넷째 묶음 0012, 다섯째 묶음 ee.
begin;
insert into auth.users (id, email, encrypted_password, aud, role, instance_id, created_at, updated_at) values
  ('00000000-0000-0000-0012-0000000000ee', 'seed12-alice@example.com', '', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
do $$
declare
  v_actor constant uuid := '00000000-0000-0000-0012-0000000000ee';
  v_ws constant uuid := '00000000-0000-0000-0012-00000000aa11';
  r jsonb;
begin
  r := public.create_project_with_settings(v_ws, 'Seed12 생성 기본', null, null, null,
         '{"core.level_labels": ["P1", "P2"], "modules.enabled": ["kanban"]}'::jsonb, null, v_actor, gen_random_uuid(), 1);
  if r ->> 'status' <> 'applied' then raise exception '0012 fixture: 생성(키워드 없음) 실패: %', r; end if;
  r := public.create_project_with_settings(v_ws, 'Seed12 생성 빈 키워드', null, null, null,
         '{"core.level_labels": ["P1"], "modules.enabled": [], "core.milestone_keywords": []}'::jsonb, null, v_actor, gen_random_uuid(), 1);
  if r ->> 'status' <> 'applied' then raise exception '0012 fixture: 생성(명시 []) 실패: %', r; end if;
  r := public.create_project_with_settings(v_ws, 'Seed12 생성 후 unset', null, null, null,
         '{"core.level_labels": ["P1"], "modules.enabled": [], "core.milestone_keywords": ["출시"]}'::jsonb, null, v_actor, gen_random_uuid(), 1);
  if r ->> 'status' <> 'applied' then raise exception '0012 fixture: 생성(키워드 있음) 실패: %', r; end if;
  r := public.apply_project_settings((r ->> 'project_id')::uuid, 1, gen_random_uuid(), '{}'::jsonb, array['core.milestone_keywords'],
         v_actor, 1, 'edit');
  if r <> '{"status": "applied", "revision": 2}'::jsonb then raise exception '0012 fixture: 키워드 unset 실패: %', r; end if;
end $$;
select
  (select not (s."values" ? 'core.milestone_keywords') from public.project_settings s join public.projects p on p.id = s.project_id
    where p.name = 'Seed12 생성 기본') as created_without_keywords,
  (select s."values" -> 'core.milestone_keywords' = '[]'::jsonb from public.project_settings s join public.projects p on p.id = s.project_id
    where p.name = 'Seed12 생성 빈 키워드') as created_with_empty_keywords,
  (select not (s."values" ? 'core.milestone_keywords') and s.revision = 2 from public.project_settings s join public.projects p on p.id = s.project_id
    where p.name = 'Seed12 생성 후 unset') as unset_keywords;
commit;
