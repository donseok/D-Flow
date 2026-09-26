-- 0009 사전검증 리허설 — 0009 가 막을 위반 행 네 종류. 0008 스키마 위에 흘리고 **커밋**한다(이어지는 migration up 이 멈춰야 한다).
--   supabase db reset --version 0008
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/0009_precheck_violations.sql
--   supabase migration up --local
--   → SP2_0009_PRECHECK 한 메시지에 네 줄(wbs_items 부모·item_owners 팀·minute_folders 부모·issue_links 회의록)을 싣고 멈춘다.
--     0009 는 적용되지 않는다(CLI 가 파일 단위 트랜잭션으로 되돌린다). 확인 뒤 npm run db:reset.
-- 0008 에서는 네 행 모두 들어간다 — 그래서 0009 가 행을 조용히 보정하지 않고 멈추는지를 이 파일로 본다. uuid 넷째 묶음 0009.
begin;
insert into public.workspaces (id, slug, name) values
  ('00000000-0000-0000-0009-00000000aa01', 'smk9-a', 'Smoke9 A'),
  ('00000000-0000-0000-0009-00000000aa02', 'smk9-b', 'Smoke9 B');
insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-0009-000000000c01', 'Smoke9 PA', '00000000-0000-0000-0009-00000000aa01'),
  ('00000000-0000-0000-0009-000000000c02', 'Smoke9 PB', '00000000-0000-0000-0009-00000000aa02');
-- ② B 프로젝트 항목의 부모가 A 프로젝트 항목
insert into public.wbs_items (id, project_id, parent_id, code, name) values
  ('00000000-0000-0000-0009-000000000f01', '00000000-0000-0000-0009-000000000c01', null, '1', 'A 부모'),
  ('00000000-0000-0000-0009-000000000f02', '00000000-0000-0000-0009-000000000c02', '00000000-0000-0000-0009-000000000f01', '1', 'B 자식');
-- ③ A 프로젝트 항목의 담당이 B 워크스페이스 공용 팀
insert into public.teams (id, workspace_id, project_id, code, name) values
  ('00000000-0000-0000-0009-000000000d01', '00000000-0000-0000-0009-00000000aa02', null, 'SMK9', 'SMK9');
insert into public.item_owners (wbs_item_id, team_id, kind) values
  ('00000000-0000-0000-0009-000000000f01', '00000000-0000-0000-0009-000000000d01', 'primary');
-- ④ B 프로젝트 폴더가 A 프로젝트 폴더 아래(0008 트리거는 프로젝트가 있으면 부모를 보지 않는다)
insert into public.minute_folders (id, project_id, parent_id, name) values
  ('00000000-0000-0000-0009-000000001201', '00000000-0000-0000-0009-000000000c01', null, 'SMK9'),
  ('00000000-0000-0000-0009-000000001202', '00000000-0000-0000-0009-000000000c02', '00000000-0000-0000-0009-000000001201', 'B 폴더');
-- ⑤ B 이슈의 원문 링크가 A 의 프로젝트 없는 회의록
insert into public.minutes (id, project_id, workspace_id, minute_date, team_code, title, body_md) values
  ('00000000-0000-0000-0009-000000001101', null, '00000000-0000-0000-0009-00000000aa01', '2026-09-01', 'SMK9', 'A 회의록', '# A');
insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code) values
  ('00000000-0000-0000-0009-000000001102', '00000000-0000-0000-0009-000000001101', 1, '# A', 'smk9-h', 'A 회의록', '2026-09-01', 'SMK9');
insert into public.issues (id, project_id, title) values
  ('00000000-0000-0000-0009-000000001103', '00000000-0000-0000-0009-000000000c02', 'B 이슈');
insert into public.issue_links (id, issue_id, project_id, minute_id, minute_version_id, minute_version_no, minute_title_snapshot,
  minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot) values
  ('00000000-0000-0000-0009-000000001104', '00000000-0000-0000-0009-000000001103', '00000000-0000-0000-0009-000000000c02',
   '00000000-0000-0000-0009-000000001101', '00000000-0000-0000-0009-000000001102', 1, 'A 회의록', '2026-09-01', 'smk9-h', 0, 'smk9-b', 'A 발췌');
commit;
