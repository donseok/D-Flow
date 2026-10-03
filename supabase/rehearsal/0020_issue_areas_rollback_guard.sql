-- *_issue_areas 롤백 가드 리허설(스펙 §3.8·D55 ③) — 정방향을 적용한 DB 에 이 파일을 넣고(psql -1) 롤백(supabase/rollbacks/*_issue_areas_rollback.sql)을
-- 돌리면 ISSUE_AREAS_ROLLBACK_BLOCKED 로 멈춰야 한다 — 롤백 SQL 의 begin…commit 이 통째로 취소되고 DB 는 그대로다. 숫자 2자리가 아닌 이슈 영역
-- code(옛 전역 영역 code 규칙 ^[0-9]{2}$ 밖)가 하나 생긴 경우다. 시드 P3(…b1013 — 영역 0 프로젝트)에 넣는다. 이름은 합성.
insert into public.project_areas (project_id, kind, code, name) values ('00000000-0000-0000-5c05-0000000b1013', 'issue_area', 'RND', '연구');
