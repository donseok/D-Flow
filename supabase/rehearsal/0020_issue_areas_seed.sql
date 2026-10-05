-- *_issue_areas 이관 리허설 시드(스펙 §3.8, SP5 B1 계획 과제 4 Step 1). **옛 스키마**(직전 마이그레이션까지 — 이슈 영역이 전역 issue_mega_areas)
-- 위에서 그 시점의 트리거·FK 를 지나는 정상 경로로 심는다. 그다음 supabase/migrations/*_issue_areas.sql 을 적용하고 확인한다.
-- 쓰는 법(전용 스택, 공유 잠금 안 — 명령 전문은 계획 과제 4 Step 8·과제 6 Step 7):
--   docker exec -i "$SUPABASE_DB_CONTAINER" psql -U postgres -d postgres -1 -v ON_ERROR_STOP=1 < supabase/rehearsal/*_issue_areas_seed.sql
--   (-1 이 한 트랜잭션으로 감싼다 — 이 파일에는 begin/commit 이 없다)
-- id 표지: 넷째 묶음 5c05, 다섯째 묶음 0000000b1NNN(계획 P18). 이름은 합성 — 고객 문자열 금지.
--
-- 경우(이관 기대값은 계획 과제 4 Step 8 — NOTICE 'ISSUE_AREAS: 영역 3 · 분류 4 · 레거시 2 · ISS 3 · 프로젝트 설정 4 · 워크스페이스 설정 1'):
--   W1 …b1001  워크스페이스. modules.allowed = B1 이전 비core 13(tests/fixtures/pre-b1-modules.ts 의 PRE_B1_NON_CORE_MODULES 와 같은 값)
--   P1 …b1011  PI 프로젝트 — 전역 영역 '00'(연구)·'03'(운영)·'05'(안전, 비활성 — 이관 영역의 active 복사), 대분류 '00' 둘·'03' 하나,
--              분류 이슈 '00' 셋(셋째를 지운다 — 카운터 last_no 3, 남은 max 2: 계획 X7 의 >= 경우)·'03' 하나,
--              미분류 이슈 둘(created_at 2일 전·1일 전 — 레거시 PI-U-001·PI-U-002), 카운터 '05' 만 있는 행(이슈·대분류 없이 last_no 4 —
--              카운터만으로 영역이 생기는지)
--   P2 …b1012  코드 없는 프로젝트 — 미분류 이슈 셋(ISS-001~003)
--   P3 …b1013  영역 0·이슈 0 프로젝트(이관 뒤 새 이슈 ISS-001)
--   P4 …b1014  같은 code 의 issue_area 가 이미 있는 PI 프로젝트 — project_areas(issue_area, '00', '기존 영역')을 먼저 넣고 대분류 하나·
--              분류 이슈 '00' 하나(이관이 새 영역을 만들지 않고 이 행을 재사용, 이름도 유지)
-- 설정 행은 프로젝트·워크스페이스 insert 트리거가 만든다(0012). 생성 RPC 를 거치지 않은 행이라 필수 키(core.level_labels·modules.enabled·
-- modules.allowed)를 실제 행처럼 직접 적는다 — 이관의 사전검사 ⑤ 가 두 모듈 목록이 배열이기를 요구한다(revision 무변경).

insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-5c05-0000000b1001', 'sp5-b1-rh', 'SP5 B1 이슈 영역 리허설');
update public.workspace_settings
   set "values" = "values" || '{"modules.allowed": ["kanban", "meetings", "weekly", "issues", "wiki", "announcements", "attendance", "agents",
                                                    "minutes", "minutes_integration", "chatbot", "portfolio", "usage"]}'::jsonb
 where workspace_id = '00000000-0000-0000-5c05-0000000b1001';

insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-5c05-0000000b1011', 'SP5 B1 P1 PI', '00000000-0000-0000-5c05-0000000b1001'),
  ('00000000-0000-0000-5c05-0000000b1012', 'SP5 B1 P2 코드 없음', '00000000-0000-0000-5c05-0000000b1001'),
  ('00000000-0000-0000-5c05-0000000b1013', 'SP5 B1 P3 영역 0', '00000000-0000-0000-5c05-0000000b1001'),
  ('00000000-0000-0000-5c05-0000000b1014', 'SP5 B1 P4 기존 영역', '00000000-0000-0000-5c05-0000000b1001');
-- B1 이전 프로젝트 토글 9(tests/fixtures/pre-b1-modules.ts 의 PRE_B1_PROJECT_TOGGLABLE 와 같은 값)
update public.project_settings
   set "values" = "values" || '{"core.level_labels": ["Phase", "Task"],
                                "modules.enabled": ["kanban", "meetings", "weekly", "issues", "announcements", "attendance", "agents", "wiki", "chatbot"]}'::jsonb
 where project_id::text like '00000000-0000-0000-5c05-0000000b10%';

-- 전역 영역(옛 스키마 — 배포 전역 표). '05' 는 비활성
insert into public.issue_mega_areas (code, name, sort_order, active) values
  ('00', '연구', 0, true), ('03', '운영', 3, true), ('05', '안전', 5, false);

-- P4 의 기존 이슈 영역(같은 code '00') — service_role(postgres) 경로로 먼저
insert into public.project_areas (id, project_id, kind, code, name) values
  ('00000000-0000-0000-5c05-0000000b1301', '00000000-0000-0000-5c05-0000000b1014', 'issue_area', '00', '기존 영역');

-- 대분류(트리거 assign_issue_major_seq 가 major_seq 를 매긴다)
insert into public.issue_major_processes (id, project_id, mega_code, name) values
  ('00000000-0000-0000-5c05-0000000b1201', '00000000-0000-0000-5c05-0000000b1011', '00', '대분류 가'),
  ('00000000-0000-0000-5c05-0000000b1202', '00000000-0000-0000-5c05-0000000b1011', '00', '대분류 나'),
  ('00000000-0000-0000-5c05-0000000b1203', '00000000-0000-0000-5c05-0000000b1011', '03', '대분류 다'),
  ('00000000-0000-0000-5c05-0000000b1204', '00000000-0000-0000-5c05-0000000b1014', '00', '대분류 라');

-- 분류 이슈(트리거 assign_issue_analysis_code 가 mega_seq·pi_issue_code 를 매긴다 — 0062 의 대분류·메타 필수를 함께 넣는다)
insert into public.issues (id, project_id, title, mega_code, major_id, sub_process, owner_department, source_type) values
  ('00000000-0000-0000-5c05-0000000b1101', '00000000-0000-0000-5c05-0000000b1011', 'P1 분류 00-1', '00', '00000000-0000-0000-5c05-0000000b1201', '하위 공정', '주관 부서', 'other');
insert into public.issues (id, project_id, title, mega_code, major_id, sub_process, owner_department, source_type) values
  ('00000000-0000-0000-5c05-0000000b1102', '00000000-0000-0000-5c05-0000000b1011', 'P1 분류 00-2', '00', '00000000-0000-0000-5c05-0000000b1202', '하위 공정', '주관 부서', 'other');
insert into public.issues (id, project_id, title, mega_code, major_id, sub_process, owner_department, source_type) values
  ('00000000-0000-0000-5c05-0000000b1103', '00000000-0000-0000-5c05-0000000b1011', 'P1 분류 00-3(지움)', '00', '00000000-0000-0000-5c05-0000000b1201', '하위 공정', '주관 부서', 'other');
insert into public.issues (id, project_id, title, mega_code, major_id, sub_process, owner_department, source_type) values
  ('00000000-0000-0000-5c05-0000000b1104', '00000000-0000-0000-5c05-0000000b1011', 'P1 분류 03-1', '03', '00000000-0000-0000-5c05-0000000b1203', '하위 공정', '주관 부서', 'other');
insert into public.issues (id, project_id, title, mega_code, major_id, sub_process, owner_department, source_type) values
  ('00000000-0000-0000-5c05-0000000b1105', '00000000-0000-0000-5c05-0000000b1014', 'P4 분류 00-1', '00', '00000000-0000-0000-5c05-0000000b1204', '하위 공정', '주관 부서', 'other');
-- 셋째 '00' 이슈를 지운다 — 카운터는 줄지 않는다(last_no 3, 남은 max 2)
delete from public.issues where id = '00000000-0000-0000-5c05-0000000b1103';

-- 미분류 이슈 — P1 둘(오래된 쪽이 PI-U-001), P2 셋
insert into public.issues (id, project_id, title, created_at) values
  ('00000000-0000-0000-5c05-0000000b1111', '00000000-0000-0000-5c05-0000000b1011', 'P1 미분류 1', now() - interval '2 day'),
  ('00000000-0000-0000-5c05-0000000b1112', '00000000-0000-0000-5c05-0000000b1011', 'P1 미분류 2', now() - interval '1 day'),
  ('00000000-0000-0000-5c05-0000000b1121', '00000000-0000-0000-5c05-0000000b1012', 'P2 미분류 1', now() - interval '3 day'),
  ('00000000-0000-0000-5c05-0000000b1122', '00000000-0000-0000-5c05-0000000b1012', 'P2 미분류 2', now() - interval '2 day'),
  ('00000000-0000-0000-5c05-0000000b1123', '00000000-0000-0000-5c05-0000000b1012', 'P2 미분류 3', now() - interval '1 day');

-- 카운터만 있는 영역 '05'(이슈·대분류 없이)
insert into public.issue_number_counters (project_id, mega_code, last_no) values ('00000000-0000-0000-5c05-0000000b1011', '05', 4);
