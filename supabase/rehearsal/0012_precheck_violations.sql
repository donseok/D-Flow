-- 0012 사전검사 리허설 — 0012 ① 이 멈춰야 하는 위반 행을 경우마다 하나씩 심는다. 0011 스키마 위에 흘리고 **커밋**한다.
--   supabase db reset --version 0011
--   docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v case=<1..9> < supabase/rehearsal/0012_precheck_violations.sql
--   supabase migration up --local
--   → SP3A_0012_PRECHECK 메시지에 그 경우의 줄(1~9 차례로 [프로파일 모양]·[크레딧 모양]·[단계 라벨]·[트리 깊이]·[트리 깊이]·
--     [추가 축 이름]·[마일스톤 키워드]·[추가 축 이름]·[마일스톤 키워드])과 프로젝트 id 를 싣고 멈춘다.
--     0012 는 적용되지 않는다(CLI 가 파일 단위 트랜잭션으로 되돌린다). 경우를 바꾸려면 다시 db reset --version 0011 부터.
-- 0011 에서는 모든 경우의 행이 들어간다 — 그래서 0012 가 행을 조용히 보정하지 않고 멈추는지를 이 파일로 본다. uuid 넷째 묶음 0012.
-- case 4·5(트리 깊이)는 스펙 §9 #1 의 기본값(최대 깊이 = 단계 이름 수)일 때만 있다. 대안을 고르면 두 경우를 지운다.
-- case 5 는 설정 행이 없는 프로젝트다 — ③ 이 기본 라벨 3개로 백필하므로 4단 트리면 멈춰야 한다.
\if :{?case}
\else
  \echo '사용: -v case=<1..9>'
  \quit
\endif
select :case = 1 as c1, :case = 2 as c2, :case = 3 as c3, :case = 4 as c4, :case = 5 as c5, :case = 6 as c6, :case = 7 as c7,
       :case = 8 as c8, :case = 9 as c9 \gset
begin;
insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-0012-00000000aa01', 'pre12-a', 'Precheck12 A');
insert into public.projects (id, name, workspace_id) values
  ('00000000-0000-0000-0012-000000000c01', 'Precheck12 P', '00000000-0000-0000-0012-00000000aa01');
\if :c5
\else
insert into public.project_settings (project_id, level_labels) values
  ('00000000-0000-0000-0012-000000000c01', array['Phase', 'Task']);
\endif
\if :c1
  -- ① 프로파일 모양: 객체가 아니다
  update public.project_settings set excel_profile = '[]'::jsonb where project_id = '00000000-0000-0000-0012-000000000c01';
\endif
\if :c2
  -- ② 크레딧 모양: default 표가 없다
  update public.project_settings set stage_credits = '{"if": {"as": 0}}'::jsonb where project_id = '00000000-0000-0000-0012-000000000c01';
\endif
\if :c3
  -- ③ 단계 라벨: 공백만 다른 중복
  update public.project_settings set level_labels = array['Phase', ' Phase'] where project_id = '00000000-0000-0000-0012-000000000c01';
\endif
\if :c4
  -- ④ 트리 깊이: 라벨 2개에 3단 트리. SUB-ACT(is_owner_split)·스텁(stub_for)은 단계 이름이 없는 보조 행이라 세지 않는다 —
  --    그래서 아래 셋째 행은 일반 항목이다
  insert into public.wbs_items (id, project_id, parent_id, code, name) values
    ('00000000-0000-0000-0012-000000000f01', '00000000-0000-0000-0012-000000000c01', null, '1', '1단'),
    ('00000000-0000-0000-0012-000000000f02', '00000000-0000-0000-0012-000000000c01', '00000000-0000-0000-0012-000000000f01', '1.1', '2단'),
    ('00000000-0000-0000-0012-000000000f03', '00000000-0000-0000-0012-000000000c01', '00000000-0000-0000-0012-000000000f02', '1.1.1', '3단');
\endif
\if :c5
  -- ⑤ 트리 깊이(설정 행 없음): 백필될 기본 라벨 3개에 4단 트리
  insert into public.wbs_items (id, project_id, parent_id, code, name) values
    ('00000000-0000-0000-0012-000000000f01', '00000000-0000-0000-0012-000000000c01', null, '1', '1단'),
    ('00000000-0000-0000-0012-000000000f02', '00000000-0000-0000-0012-000000000c01', '00000000-0000-0000-0012-000000000f01', '1.1', '2단'),
    ('00000000-0000-0000-0012-000000000f03', '00000000-0000-0000-0012-000000000c01', '00000000-0000-0000-0012-000000000f02', '1.1.1', '3단'),
    ('00000000-0000-0000-0012-000000000f04', '00000000-0000-0000-0012-000000000c01', '00000000-0000-0000-0012-000000000f03', '1.1.1.1', '4단');
\endif
\if :c6
  -- ⑥ 추가 축 이름: 21자(레지스트리 parse 는 1~20자)
  update public.project_settings set extra_axis_label = repeat('x', 21) where project_id = '00000000-0000-0000-0012-000000000c01';
\endif
\if :c7
  -- ⑦ 마일스톤 키워드: 공백뿐인 항목(레지스트리 parse 는 앞뒤 공백을 뺀 1~40자)
  update public.project_settings set milestone_keywords = array['go-live', '  '] where project_id = '00000000-0000-0000-0012-000000000c01';
\endif
\if :c8
  -- ⑧ 추가 축 이름: 탭·줄바꿈·NBSP 뿐(btrim 기본값은 남기지만 JS trim 은 모두 떼어 빈 값이 된다)
  update public.project_settings set extra_axis_label = E'\t\n\u00a0' where project_id = '00000000-0000-0000-0012-000000000c01';
\endif
\if :c9
  -- ⑨ 마일스톤 키워드: U+FFFF 위 글자 21개 — 21자지만 JS length(UTF-16)는 42라 1~40자를 넘는다
  update public.project_settings set milestone_keywords = array['go-live', repeat(E'\U0001F680', 21)]
   where project_id = '00000000-0000-0000-0012-000000000c01';
\endif
commit;
