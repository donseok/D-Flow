-- tests/rls 2-워크스페이스 픽스처(SP2) — fixture.sql 뒤에 loadFixture 가 같은 트랜잭션으로 흘린다(postgres 롤, 멱등).
-- A = rls-acme(…aa01), B = rls-other(…aa02). A 의 모든 스코프 표에 행 1개 이상을 둔다 — 전수 교차 테스트가 "빈 표라 0행" 으로
-- 통과하지 않게. 새 id: 계정 …a6~a9 · 인물 …b6~ba · 프로젝트 …c3~c4 · 팀 …d0·d5 · 명단 …e4~e7 · 리프 …f4~f6 · A 엔터티 …11NN.
-- bigint identity 표는 7057001 을 명시 id 로 쓴다(시퀀스를 건드리지 않는다).

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
select v.id, v.email, '', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated',
       '00000000-0000-0000-0000-000000000000', now(), now()
  from (values
    ('00000000-0000-0000-7e57-0000000000a6'::uuid, 'rls-bea@example.com'),
    ('00000000-0000-0000-7e57-0000000000a7'::uuid, 'rls-ben@example.com'),
    ('00000000-0000-0000-7e57-0000000000a8'::uuid, 'rls-cy@example.com'),
    ('00000000-0000-0000-7e57-0000000000a9'::uuid, 'rls-dana@example.com')) as v(id, email)
on conflict do nothing;

insert into public.profiles (user_id, email, display_name) values
  ('00000000-0000-0000-7e57-0000000000a6', 'rls-bea@example.com', 'bea'),
  ('00000000-0000-0000-7e57-0000000000a7', 'rls-ben@example.com', 'ben'),
  ('00000000-0000-0000-7e57-0000000000a8', 'rls-cy@example.com', 'cy'),
  ('00000000-0000-0000-7e57-0000000000a9', 'rls-dana@example.com', 'dana')
on conflict do nothing;

-- B: bea 관리자, ben 멤버, dana 멤버. A: cy 멤버(명단 없음), dana 멤버. dana 는 A 에 먼저 가입(선호값 키 = A).
insert into public.workspace_members (workspace_id, user_id, role, created_at) values
  ('00000000-0000-0000-7e57-00000000aa02', '00000000-0000-0000-7e57-0000000000a6', 'admin',  now()),
  ('00000000-0000-0000-7e57-00000000aa02', '00000000-0000-0000-7e57-0000000000a7', 'member', now()),
  ('00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000a8', 'member', now()),
  ('00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000a9', 'member', now() - interval '1 day'),
  ('00000000-0000-0000-7e57-00000000aa02', '00000000-0000-0000-7e57-0000000000a9', 'member', now())
on conflict do nothing;

insert into public.people (id, workspace_id, display_name, email, user_id) values
  ('00000000-0000-0000-7e57-0000000000b6', '00000000-0000-0000-7e57-00000000aa02', 'bea',  'rls-bea@example.com',  '00000000-0000-0000-7e57-0000000000a6'),
  ('00000000-0000-0000-7e57-0000000000b7', '00000000-0000-0000-7e57-00000000aa02', 'ben',  'rls-ben@example.com',  '00000000-0000-0000-7e57-0000000000a7'),
  ('00000000-0000-0000-7e57-0000000000b8', '00000000-0000-0000-7e57-00000000aa01', 'cy',   'rls-cy@example.com',   '00000000-0000-0000-7e57-0000000000a8'),
  ('00000000-0000-0000-7e57-0000000000b9', '00000000-0000-0000-7e57-00000000aa01', 'dana', 'rls-dana@example.com', '00000000-0000-0000-7e57-0000000000a9'),
  ('00000000-0000-0000-7e57-0000000000ba', '00000000-0000-0000-7e57-00000000aa02', 'dana', 'rls-dana@example.com', '00000000-0000-0000-7e57-0000000000a9')
on conflict do nothing;

insert into public.projects (id, name, workspace_id, is_private) values
  ('00000000-0000-0000-7e57-0000000000c3', 'RLS A private', '00000000-0000-0000-7e57-00000000aa01', true),
  ('00000000-0000-0000-7e57-0000000000c4', 'RLS Other P',   '00000000-0000-0000-7e57-00000000aa02', false)
on conflict do nothing;
update public.project_settings
   set "values" = '{"core.level_labels": ["Phase", "Task", "Activity"], "core.milestone_keywords": [],
                    "modules.enabled": ["kanban", "meetings", "weekly", "issues", "announcements", "attendance", "wiki", "chatbot"]}'::jsonb,
       revision = 1
 where project_id in ('00000000-0000-0000-7e57-0000000000c3', '00000000-0000-0000-7e57-0000000000c4');
insert into public.teams (id, workspace_id, project_id, code, name) values
  ('00000000-0000-0000-7e57-0000000000d5', '00000000-0000-0000-7e57-00000000aa02', '00000000-0000-0000-7e57-0000000000c4', 'OPS', 'OPS')
on conflict do nothing;
-- A 워크스페이스 공용 팀(project_id null). 전수 교차는 PK 순 첫 행을 복사하므로 가장 작은 id(…d0)로 둬 teams 의
-- wsadmin_insert_teams·wsadmin_update_teams 분기를 태운다(프로젝트 팀 분기는 OWN_INSERT_PROBES 가 덮는다).
-- 코드 SHR 은 workspace-isolation-cases ⓚ 가 B 에 같은 코드의 공용 팀을 만들어 임포트의 팀 해석을 본다.
insert into public.teams (id, workspace_id, project_id, code, name) values
  ('00000000-0000-0000-7e57-0000000000d0', '00000000-0000-0000-7e57-00000000aa01', null, 'SHR', 'SHR')
on conflict do nothing;
insert into public.project_members (id, project_id, person_id, access_role) values
  ('00000000-0000-0000-7e57-0000000000e4', '00000000-0000-0000-7e57-0000000000c4', '00000000-0000-0000-7e57-0000000000b7', 'member'),
  ('00000000-0000-0000-7e57-0000000000e5', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-0000000000b9', 'member'),
  ('00000000-0000-0000-7e57-0000000000e6', '00000000-0000-0000-7e57-0000000000c4', '00000000-0000-0000-7e57-0000000000ba', 'member'),
  ('00000000-0000-0000-7e57-0000000000e7', '00000000-0000-0000-7e57-0000000000c3', '00000000-0000-0000-7e57-0000000000b3', 'member')
on conflict do nothing;
insert into public.project_member_teams (member_id, team_id, is_primary) values
  ('00000000-0000-0000-7e57-0000000000e4', '00000000-0000-0000-7e57-0000000000d5', true),
  ('00000000-0000-0000-7e57-0000000000e6', '00000000-0000-0000-7e57-0000000000d5', true)
on conflict do nothing;
insert into public.wbs_items (id, project_id, code, name, planned_start, planned_end) values
  ('00000000-0000-0000-7e57-0000000000f4', '00000000-0000-0000-7e57-0000000000c4', '1', 'OPS 리프', null, null),
  ('00000000-0000-0000-7e57-0000000000f5', '00000000-0000-0000-7e57-0000000000c1', '2', '선행', '2026-09-01', '2026-09-05'),
  ('00000000-0000-0000-7e57-0000000000f6', '00000000-0000-0000-7e57-0000000000c1', '3', '후행', '2026-09-08', '2026-09-12')
on conflict do nothing;
insert into public.item_owners (wbs_item_id, team_id, kind) values
  ('00000000-0000-0000-7e57-0000000000f4', '00000000-0000-0000-7e57-0000000000d5', 'primary')
on conflict do nothing;

-- 전역 참조(D2 예외) — 이슈 대분류·번호 카운터의 전제
insert into public.issue_mega_areas (code, name, sort_order, active) values ('99', 'RLS 영역', 999, true)
on conflict do nothing;

-- ── A(프로젝트 c1) 엔터티: 스코프 표마다 1행 ────────────────────────────────────────────
insert into public.meetings (id, project_id, title, meeting_date) values
  ('00000000-0000-0000-7e57-000000001101', '00000000-0000-0000-7e57-0000000000c1', 'RLS 회의', '2026-09-01') on conflict do nothing;
insert into public.issues (id, project_id, title) values
  ('00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000c1', 'RLS 이슈') on conflict do nothing;
insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by) values
  ('00000000-0000-0000-7e57-000000001103', '00000000-0000-0000-7e57-0000000000c1', '2026-09-01', 'ERP', 'RLS 회의록', '# RLS', '00000000-0000-0000-7e57-0000000000a3')
  on conflict do nothing;
insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code, project_id) values
  ('00000000-0000-0000-7e57-000000001104', '00000000-0000-0000-7e57-000000001103', 1, '# RLS', 'rls-h', 'RLS 회의록', '2026-09-01', 'ERP', '00000000-0000-0000-7e57-0000000000c1')
  on conflict do nothing;
insert into public.wiki_topics (id, project_id, title, normalized_title) values
  ('00000000-0000-0000-7e57-000000001105', '00000000-0000-0000-7e57-0000000000c1', 'RLS 토픽', 'rls 토픽') on conflict do nothing;
insert into public.wiki_items (id, project_id, topic_id, kind, statement, statement_hash, knowledge_key, certainty) values
  ('00000000-0000-0000-7e57-000000001106', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001105', 'fact', 'RLS 사실 1', 'rls-s1', 'rls-k1', 'explicit'),
  ('00000000-0000-0000-7e57-000000001107', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001105', 'fact', 'RLS 사실 2', 'rls-s2', 'rls-k2', 'explicit')
  on conflict do nothing;
-- SP5 A(스펙 D28) — 주간 문서가 있는 프로젝트는 월요일 주 시작 규칙을 문서보다 먼저 기록한다. 제품 기본값이 일요일이 되고(NNNN_calendar)
-- 주 키 트리거가 규칙 밖 키를 거부해도 이 픽스처의 월요일 키(2026-08-31)와 그 위의 테스트가 그대로 돈다(월요일 회귀를 계속 덮는다).
-- 마이그레이션 전에는 모르는 키라 무해하다(values 의 제약은 jsonb_typeof='object' 뿐, 해석기는 unknownKeys 로 견딘다). fixture.sql 이 values 를
-- 통째로 쓴 뒤라 매 적재에 다시 더한다(멱등 — || 는 같은 키를 덮는다). revision 은 올리지 않는다(이력 없는 픽스처 값)
update public.project_settings
   set "values" = "values" || '{"calendar.week_start": [{"day": "monday", "from": null}]}'::jsonb
 where project_id = '00000000-0000-0000-7e57-0000000000c1';
insert into public.weekly_reports (id, project_id, week_start) values
  ('00000000-0000-0000-7e57-000000001108', '00000000-0000-0000-7e57-0000000000c1', '2026-08-31') on conflict do nothing;
-- audience='global' — 0005 까지는 전원에게 열린 분기(§2.1). 0006 뒤에는 누구에게도 안 보여야 한다(수신자 행 없음)
insert into public.notification_events (id, type, category, audience, project_id, payload) values
  ('00000000-0000-0000-7e57-000000001109', 'rls_test', 'system', 'global', '00000000-0000-0000-7e57-0000000000c1', '{"title":"rls"}')
  on conflict do nothing;
insert into public.announcements (id, project_id, title) values
  ('00000000-0000-0000-7e57-00000000110a', '00000000-0000-0000-7e57-0000000000c1', 'RLS 공지') on conflict do nothing;
insert into public.agent_work_orders (id, project_id) values
  ('00000000-0000-0000-7e57-00000000110b', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.project_areas (id, project_id, kind, code, name) values
  ('00000000-0000-0000-7e57-00000000110c', '00000000-0000-0000-7e57-0000000000c1', 'weekly_section', 'RLSA', 'RLS 영역') on conflict do nothing;
insert into public.minute_folders (id, project_id, name, created_by) values
  ('00000000-0000-0000-7e57-00000000110d', '00000000-0000-0000-7e57-0000000000c1', 'RLS 폴더', '00000000-0000-0000-7e57-0000000000a3') on conflict do nothing;
insert into public.issue_major_processes (id, project_id, mega_code, name) values
  ('00000000-0000-0000-7e57-00000000110e', '00000000-0000-0000-7e57-0000000000c1', '99', 'RLS 대분류') on conflict do nothing;
insert into public.wiki_item_sources (id, wiki_item_id, minute_id, minute_version_id, body_hash, block_index, block_hash, relation) values
  ('00000000-0000-0000-7e57-00000000110f', '00000000-0000-0000-7e57-000000001106', '00000000-0000-0000-7e57-000000001103', '00000000-0000-0000-7e57-000000001104', 'rls-h', 0, 'rls-b', 'supports')
  on conflict do nothing;
insert into public.issue_links (id, issue_id, project_id, minute_id, minute_version_id, minute_version_no, minute_title_snapshot, minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot) values
  ('00000000-0000-0000-7e57-000000001110', '00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001103', '00000000-0000-0000-7e57-000000001104', 1, 'RLS 회의록', '2026-09-01', 'rls-h', 0, 'rls-b', 'rls 발췌')
  on conflict do nothing;
insert into public.issue_updates (id, issue_id, project_id, body, author_name) values
  ('00000000-0000-0000-7e57-000000001111', '00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000c1', 'RLS 경과', 'alice') on conflict do nothing;
insert into public.issue_attachments (id, issue_id, project_id, file_name, file_path) values
  ('00000000-0000-0000-7e57-000000001112', '00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000c1', 'a.txt', 'rls/a.txt') on conflict do nothing;
insert into public.issue_analysis_runs (id, project_id, input_hash, prompt_version, model) values
  ('00000000-0000-0000-7e57-000000001113', '00000000-0000-0000-7e57-0000000000c1', repeat('a', 64), 'v1', 'rls-model') on conflict do nothing;
insert into public.attendance_records (id, project_id, member_id, date, type) values
  ('00000000-0000-0000-7e57-000000001114', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-0000000000e1', '2026-09-01', 'work') on conflict do nothing;
insert into public.change_logs (id, wbs_item_id, field, user_id) values
  (7057001, '00000000-0000-0000-7e57-0000000000f1', 'actual_pct', '00000000-0000-0000-7e57-0000000000a3') on conflict do nothing;
insert into public.deliverable_attachments (id, wbs_item_id, file_name, file_path) values
  ('00000000-0000-0000-7e57-000000001116', '00000000-0000-0000-7e57-0000000000f1', 'd.txt', 'rls/d.txt') on conflict do nothing;
insert into public.minute_embeddings (id, minute_id, chunk_index, content, embedding) values
  ('00000000-0000-0000-7e57-000000001117', '00000000-0000-0000-7e57-000000001103', 0, 'rls', array_fill(0::real, array[768])::vector) on conflict do nothing;
insert into public.minute_files (id, minute_id, role, file_name, file_path, size, mime, uploaded_by) values
  ('00000000-0000-0000-7e57-000000001118', '00000000-0000-0000-7e57-000000001103', 'attachment', 'f.txt', 'rls/f.txt', 1, 'text/plain', '00000000-0000-0000-7e57-0000000000a3')
  on conflict do nothing;
insert into public.minute_highlights (id, minute_id, block_index, block_hash, created_by) values
  ('00000000-0000-0000-7e57-000000001119', '00000000-0000-0000-7e57-000000001103', 0, 'rls-b', '00000000-0000-0000-7e57-0000000000a3') on conflict do nothing;
insert into public.minute_insights (id, minute_id, body_hash, kind, block_index) values
  ('00000000-0000-0000-7e57-00000000111a', '00000000-0000-0000-7e57-000000001103', 'rls-h', 'decision', 0) on conflict do nothing;
insert into public.notification_recipients (id, event_id, user_id) values
  ('00000000-0000-0000-7e57-00000000111b', '00000000-0000-0000-7e57-000000001109', '00000000-0000-0000-7e57-0000000000a3') on conflict do nothing;
insert into public.project_ai_briefs (id, project_id, kind, input_hash, status) values
  ('00000000-0000-0000-7e57-00000000111c', '00000000-0000-0000-7e57-0000000000c1', 'weekly', 'rls-h', 'ready') on conflict do nothing;
insert into public.task_dependencies (id, project_id, predecessor_id, successor_id) values
  ('00000000-0000-0000-7e57-00000000111d', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-0000000000f5', '00000000-0000-0000-7e57-0000000000f6')
  on conflict do nothing;
insert into public.wbs_embeddings (id, project_id, kind, content) values
  ('00000000-0000-0000-7e57-00000000111e', '00000000-0000-0000-7e57-0000000000c1', 'project', 'rls') on conflict do nothing;
-- 주간 행은 영역 id·프로젝트를 갖는다(*_weekly_areas — 스펙 §3.5). 영역 …110c(RLSA)는 위(project_areas)에서 먼저 들어간다
insert into public.weekly_report_rows (id, report_id, project_id, area_id) values
  ('00000000-0000-0000-7e57-00000000111f', '00000000-0000-0000-7e57-000000001108', '00000000-0000-0000-7e57-0000000000c1',
   '00000000-0000-0000-7e57-00000000110c') on conflict do nothing;
insert into public.wiki_change_events (id, project_id, change_type, wiki_item_id) values
  ('00000000-0000-0000-7e57-000000001120', '00000000-0000-0000-7e57-0000000000c1', 'new', '00000000-0000-0000-7e57-000000001106') on conflict do nothing;
insert into public.wiki_feedback (id, project_id, topic_id, feedback_type, user_id) values
  ('00000000-0000-0000-7e57-000000001121', '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001105', 'helpful', '00000000-0000-0000-7e57-0000000000a3')
  on conflict do nothing;
insert into public.wiki_item_relations (id, from_item_id, to_item_id, relation) values
  ('00000000-0000-0000-7e57-000000001122', '00000000-0000-0000-7e57-000000001106', '00000000-0000-0000-7e57-000000001107', 'confirms') on conflict do nothing;
insert into public.wiki_questions (id, project_id, question) values
  ('00000000-0000-0000-7e57-000000001123', '00000000-0000-0000-7e57-0000000000c1', 'RLS?') on conflict do nothing;
insert into public.wiki_topic_revisions (id, topic_id, project_id, version_no, title, body_md, body_hash, document_kind) values
  ('00000000-0000-0000-7e57-000000001124', '00000000-0000-0000-7e57-000000001105', '00000000-0000-0000-7e57-0000000000c1', 1, 'RLS 토픽', '# RLS', 'rls-h', 'overview')
  on conflict do nothing;
insert into public.ai_documents (id, project_id, domain, entity_type, entity_id, chunk_no, content, content_hash, href, embedding_model, chunker_version) values
  ('00000000-0000-0000-7e57-000000001125', '00000000-0000-0000-7e57-0000000000c1', 'wbs', 'wbs_item', '00000000-0000-0000-7e57-0000000000f1', 0, 'rls', 'rls-c', '/p/x/wbs', 'rls-model', 'v1')
  on conflict do nothing;
insert into public.agent_runners (id, name, owner_user_id, token_prefix, token_hash, expires_at, project_id) values
  ('00000000-0000-0000-7e57-000000001126', 'rls', '00000000-0000-0000-7e57-0000000000a3', 'rls_a', 'rls-token-hash', now() + interval '1 year', '00000000-0000-0000-7e57-0000000000c1')
  on conflict do nothing;
insert into public.agent_watchers (id, user_id, agent, project_id) values
  ('00000000-0000-0000-7e57-000000001127', '00000000-0000-0000-7e57-0000000000a3', 'rls-agent', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.agent_work_reports (id, work_order_id, kind, percent, summary, agent) values
  ('00000000-0000-0000-7e57-000000001128', '00000000-0000-0000-7e57-00000000110b', 'progress', 10, 'rls', 'rls-agent') on conflict do nothing;
insert into public.project_invites (id, workspace_id, project_id, email, access_role, token_hash, created_by, expires_at) values
  ('00000000-0000-0000-7e57-000000001129', '00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000c1', 'rls-invitee@example.com', 'member', 'rls-invite-hash', '00000000-0000-0000-7e57-0000000000a2', now() + interval '1 year')
  on conflict do nothing;
insert into public.usage_events (id, user_id, menu_key, path, project_id) values
  (7057001, '00000000-0000-0000-7e57-0000000000a3', 'wbs', '/p/rls/wbs', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.ai_index_jobs (id, job_key, operation, domain, entity_type, entity_id, project_id) values
  (7057001, 'rls-a', 'upsert', 'wbs', 'wbs_item', 'rls', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.wiki_processing_jobs (id, project_id, minute_id, minute_version_id, body_hash) values
  (7057001, '00000000-0000-0000-7e57-0000000000c1', '00000000-0000-0000-7e57-000000001103', '00000000-0000-0000-7e57-000000001104', 'rls-h') on conflict do nothing;
insert into public.llm_profiles (id, name, preset_id, provider, model) values (7057001, 'rls', 'rls', 'openai', 'rls-model') on conflict do nothing;
insert into public.llm_config (id, mode) values (1, 'env') on conflict do nothing;
-- 복합 키 표
insert into public.agent_lead_leases (user_id, project_id) values ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.agent_projects (project_id) values ('00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.announcement_seen (user_id, project_id) values ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.holidays (project_id, date) values ('00000000-0000-0000-7e57-0000000000c1', '2026-01-01') on conflict do nothing;
insert into public.issue_assignees (issue_id, member_id, project_id) values
  ('00000000-0000-0000-7e57-000000001102', '00000000-0000-0000-7e57-0000000000e1', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.issue_number_counters (project_id, mega_code, last_no) values ('00000000-0000-0000-7e57-0000000000c1', '99', 1) on conflict do nothing;
insert into public.meeting_attendees (meeting_id, member_id, project_id) values
  ('00000000-0000-0000-7e57-000000001101', '00000000-0000-0000-7e57-0000000000e1', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.meeting_exceptions (meeting_id, occurrence_date) values ('00000000-0000-0000-7e57-000000001101', '2026-09-08') on conflict do nothing;
-- dana(두 워크스페이스)의 A 회의록 즐겨찾기 — Review Focus 2 의 전제
insert into public.minute_favorites (user_id, minute_id) values
  ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-000000001103'),
  ('00000000-0000-0000-7e57-0000000000a9', '00000000-0000-0000-7e57-000000001103') on conflict do nothing;
insert into public.user_preferences (user_id, workspace_id, prefs) values ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-00000000aa01', '{}') on conflict do nothing;
insert into public.user_wbs_state (user_id, project_id) values ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.wbs_progress_snapshots (project_id, snap_date, actual_pct, planned_pct) values ('00000000-0000-0000-7e57-0000000000c1', '2026-09-01', 10, 20) on conflict do nothing;
insert into public.wiki_project_rebuild_jobs (project_id) values ('00000000-0000-0000-7e57-0000000000c1') on conflict do nothing;
insert into public.area_teams (area_id, team_id, kind) values ('00000000-0000-0000-7e57-00000000110c', '00000000-0000-0000-7e57-0000000000d1', 'primary') on conflict do nothing;

-- 프로젝트 없는 회의록·폴더(Review Focus 3) — workspace_id 로만 스코프된다
insert into public.minute_folders (id, project_id, workspace_id, name, created_by) values
  ('00000000-0000-0000-7e57-00000000112c', null, '00000000-0000-0000-7e57-00000000aa01', 'RLS 전역 폴더', '00000000-0000-0000-7e57-0000000000a3')
  on conflict do nothing;
insert into public.minutes (id, project_id, workspace_id, minute_date, team_code, title, body_md, created_by) values
  ('00000000-0000-0000-7e57-00000000112b', null, '00000000-0000-0000-7e57-00000000aa01', '2026-09-02', 'ERP', 'RLS 전역 회의록', '# RLS', '00000000-0000-0000-7e57-0000000000a3')
  on conflict do nothing;

-- 워크스페이스 설정(0012) — 두 워크스페이스 모두 모듈을 전부 허용하고, A 만 초대 도메인을 둔다. 전수 교차 테스트의 A 행이자
-- workspace-settings.test.ts ① 의 읽기 대상.
update public.workspace_settings
   set "values" = '{"modules.allowed": ["kanban", "meetings", "weekly", "issues", "announcements", "attendance", "agents", "wiki", "chatbot",
                                        "minutes", "minutes_integration", "portfolio", "usage"],
                    "invites.allowed_domains": ["example.com"]}'::jsonb,
       revision = 1
 where workspace_id = '00000000-0000-0000-7e57-00000000aa01';
update public.workspace_settings
   set "values" = '{"modules.allowed": ["kanban", "meetings", "weekly", "issues", "announcements", "attendance", "agents", "wiki", "chatbot",
                                        "minutes", "minutes_integration", "portfolio", "usage"]}'::jsonb,
       revision = 1
 where workspace_id = '00000000-0000-0000-7e57-00000000aa02';

-- 설정 이력(0012) — A 행 하나씩. 전수 교차 테스트의 A 행이자 settings-write.test.ts 의 읽기 대상
insert into public.project_settings_history (id, project_id, revision, key, old_value, new_value, source, command_id)
  overriding system value
  values (7057001, '00000000-0000-0000-7e57-0000000000c1', 1, 'core.level_labels', null, '["Phase","Task","Activity"]', 'create',
          '00000000-0000-0000-7e57-000000001310')
  on conflict do nothing;
insert into public.workspace_settings_history (id, workspace_id, revision, key, old_value, new_value, source, command_id)
  overriding system value
  values (7057001, '00000000-0000-0000-7e57-00000000aa01', 1, 'invites.allowed_domains', null, '["example.com"]', 'create',
          '00000000-0000-0000-7e57-000000001311')
  on conflict do nothing;

-- 권한 변경 이력(0012) — A 행 하나. 전수 교차 테스트의 A 행이자 authz-events.test.ts 의 불변 탐침 대상
insert into public.authz_events (id, kind, workspace_id, target_user_id, before, after, cause, actor_user_id)
  overriding system value
  values (7057001, 'workspace_role', '00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000a8',
          null, '{"role": "member", "invited_by": null}', 'direct', '00000000-0000-0000-7e57-0000000000a2')
  on conflict do nothing;

-- 권한 명령 원장(0012) — A 행 하나. 전수 교차 테스트의 A 행이자 authz-events.test.ts 의 불변 탐침 대상
insert into public.authz_commands (actor_user_id, kind, scope_id, command_id, workspace_id, command_digest, result)
  values ('00000000-0000-0000-7e57-0000000000a2', 'workspace_role', '00000000-0000-0000-7e57-00000000aa01',
          '00000000-0000-0000-7e57-000000001312', '00000000-0000-0000-7e57-00000000aa01', 'fixture', '{"status": "applied", "matched": 1}')
  on conflict do nothing;

-- 명령 영수증(SP4 NNNN_command_receipts) — A 행 하나. 전수 교차 테스트의 A 행이자 command-receipts.test.ts 의 읽기·불변 탐침 대상
insert into public.command_receipts (actor, command_id, kind, workspace_id, project_id, command_digest, result)
  values ('00000000-0000-0000-7e57-0000000000a3', '00000000-0000-0000-7e57-0000000018f1', 'wbs_import',
          '00000000-0000-0000-7e57-00000000aa01', '00000000-0000-0000-7e57-0000000000c1', 'fixture',
          '{"status": "applied", "mode": "append", "count": 0, "command_id": "00000000-0000-0000-7e57-0000000018f1"}')
  on conflict do nothing;
-- SP5 A 월요일 규칙 선기록(위 c1 의 update)이 실제로 1행을 바꿨는지 — 설정 행은 projects_settings_row 트리거가 만든다. 그 트리거가 바뀌어
-- update 가 조용히 0행이 되면 여기서 멈춘다(A-1 리뷰 K7). 파일 끝에 둔다 — 다른 테스트가 이 파일의 줄 번호를 주석으로 가리킨다
do $$
begin
  if not exists (select 1 from public.project_settings
                  where project_id = '00000000-0000-0000-7e57-0000000000c1'
                    and "values" -> 'calendar.week_start' = '[{"day": "monday", "from": null}]'::jsonb) then
    raise exception 'fixture-ws: c1 의 월요일 주 시작 규칙 선기록이 0행이다(설정 행 없음 — projects_settings_row 트리거 확인)';
  end if;
end $$;
