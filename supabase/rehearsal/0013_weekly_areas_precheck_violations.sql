-- *_weekly_areas 사전검사 리허설 — ① 이 멈춰야 하는 위반을 경우마다 하나씩 심는다. 직전 마이그레이션까지 적용한 DB 에 흘리고 **커밋**한다.
-- 명령 전문은 SP4 Phase A1 계획 과제 10 Step 7(전용 스택, 공유 잠금 안):
--   supabase db reset --version <직전 번호>
--   docker exec -i "$SUPABASE_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v case=<1|2> < 이 파일
--   supabase migration up --local
--   → WEEKLY_AREAS_PRECHECK 메시지에 (문서, 라벨, 칸, 글자 수)를 싣고 멈춘다. 이 파일의 마이그레이션은 적용되지 않는다(CLI 가 파일 단위
--     트랜잭션으로 되돌린다 — max(version) 이 직전 번호). 경우를 바꾸려면 다시 db reset --version 부터.
-- 경우 1 = 병합 묶음: 같은 (문서, 라벨) 두 행 14,000 + 머리표 줄 '[M]'+줄바꿈 4 + 5,996 + 병합 줄바꿈 1 = 20,001자
--          (머리표 없이는 19,997 — 사전검사가 머리표를 세는지 본다).
-- 경우 2 = 행 하나짜리 묶음: 19,997 + 머리표 4 = 20,001자.
-- uuid 넷째 묶음 5b04, 다섯째 묶음 9xxx(데이터 업그레이드 시드와 겹치지 않는다).
\if :{?case}
\else
  \echo '사용: -v case=<1|2>'
  \quit
\endif
select :case = 1 as c1, :case = 2 as c2 \gset
begin;
insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-5b04-000000009a01', 'sp4-wa-pre', 'SP4 사전검사');
insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-5b04-000000009c01', 'SP4 사전검사 P', '00000000-0000-0000-5b04-000000009a01');
insert into public.weekly_reports (id, project_id, week_start) values
  ('00000000-0000-0000-5b04-000000009e01', '00000000-0000-0000-5b04-000000009c01', '2026-09-07');
\if :c1
  insert into public.weekly_report_rows (id, report_id, section, module, sort_order, this_content) values
    ('00000000-0000-0000-5b04-000000009f01', '00000000-0000-0000-5b04-000000009e01', '경계 초과', '', 1, repeat('가', 14000)),
    ('00000000-0000-0000-5b04-000000009f02', '00000000-0000-0000-5b04-000000009e01', '경계 초과', 'M', 2, repeat('나', 5996));
\endif
\if :c2
  insert into public.weekly_report_rows (id, report_id, section, module, sort_order, next_issue) values
    ('00000000-0000-0000-5b04-000000009f03', '00000000-0000-0000-5b04-000000009e01', '경계 초과', 'M', 1, repeat('다', 19997));
\endif
commit;
