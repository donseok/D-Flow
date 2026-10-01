-- *_weekly_areas 새 경로 픽스처 — 이관이 아닌 RPC(upsert_project_area·create_weekly_report)로 만든 영역·문서가 롤백 → 재적용을 견디는지
-- 보는 재료다(명령은 SP4 Phase A1 계획 과제 14 Step 9). *_weekly_areas_seed_wide.sql 을 심고 마이그레이션을 적용한 DB 에서 한 번 돈다
-- (커밋한다 — 스모크·롤백 확인의 p4_new_path 가 이 결과를 본다). 행위자는 seed 의 W1 관리자 u1, 프로젝트 P4 는 seed 의 W1 에 새로 둔다.
-- 만드는 것: 영역 NEWC('새 영역', 순서 1)·NEWD('둘째 영역', 순서 0) — 둘 다 code ≠ name, 팀 없음 / 2026-09-28 주 문서 하나(시드 = NEWC 칸만
-- 내용, NEWD 는 빈 행) / NEWC 개명('바뀐 이름' — code 그대로, rows_added 0). 롤백이 section 을 code 로 되살리므로(Q33) 재적용은 이 둘을
-- 새로 만들지 않고 재사용해야 한다 — 이름으로 되살리면 '새 영역'·'둘째 영역' 영역이 새로 생겨 스모크의 p4_new_path 가 거짓이 된다.
-- 결과가 기대와 다르면 WEEKLY_AREAS_CREATED_FIXTURE 로 멈춘다. uuid 넷째 묶음 5b04.
begin;
insert into public.projects (id, name, workspace_id)
  values ('00000000-0000-0000-5b04-000000000c04', 'SP4 이관 P4 — 새 경로', '00000000-0000-0000-5b04-00000000aa01');
update public.project_settings set "values" = '{"core.level_labels": ["단계"], "modules.enabled": ["weekly"]}'::jsonb
 where project_id = '00000000-0000-0000-5b04-000000000c04';
do $$
declare
  c_actor constant uuid := '00000000-0000-0000-5b04-000000005001';
  c_p4 constant uuid := '00000000-0000-0000-5b04-000000000c04';
  c_week constant date := '2026-09-28';
  r_c jsonb;
  r_d jsonb;
  r_doc jsonb;
  r_ren jsonb;
  v_c uuid;
  v_d uuid;
begin
  r_c := public.upsert_project_area(c_actor, c_p4,
           '{"kind": "weekly_section", "code": "NEWC", "name": "새 영역", "sort_order": 1, "active": true}'::jsonb, '[]'::jsonb, c_week);
  r_d := public.upsert_project_area(c_actor, c_p4,
           '{"kind": "weekly_section", "code": "NEWD", "name": "둘째 영역", "sort_order": 0, "active": true}'::jsonb, '[]'::jsonb, c_week);
  v_c := (r_c ->> 'area_id')::uuid;
  v_d := (r_d ->> 'area_id')::uuid;
  if r_c ->> 'status' is distinct from 'created' or r_d ->> 'status' is distinct from 'created'
     or (r_c ->> 'rows_added')::int <> 0 or (r_d ->> 'rows_added')::int <> 0 then
    raise exception 'WEEKLY_AREAS_CREATED_FIXTURE: 영역 생성 결과가 다르다 — %, %', r_c, r_d;
  end if;
  r_doc := public.create_weekly_report(c_actor, c_p4, c_week, pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object('area_id', v_c, 'this_content', '새 경로 내용', 'this_issue', '',
                                           'next_content', '', 'next_issue', '')));
  if r_doc ->> 'status' is distinct from 'created' or (r_doc ->> 'rows')::int <> 2 then
    raise exception 'WEEKLY_AREAS_CREATED_FIXTURE: 문서 생성 결과가 다르다 — %', r_doc;
  end if;
  r_ren := public.upsert_project_area(c_actor, c_p4,
             pg_catalog.jsonb_build_object('id', v_c, 'kind', 'weekly_section', 'code', 'NEWC', 'name', '바뀐 이름',
                                           'sort_order', 1, 'active', true), '[]'::jsonb, c_week);
  if r_ren ->> 'status' is distinct from 'updated' or (r_ren ->> 'area_id')::uuid <> v_c or (r_ren ->> 'rows_added')::int <> 0 then
    raise exception 'WEEKLY_AREAS_CREATED_FIXTURE: 개명 결과가 다르다 — %', r_ren;
  end if;
  raise notice 'WEEKLY_AREAS_CREATED_FIXTURE: 영역 2, 문서 1, 행 %, 개명 1',
    (select pg_catalog.count(*) from public.weekly_report_rows w where w.project_id = c_p4);
end $$;
commit;
