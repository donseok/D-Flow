-- NNNN_command_receipts 리허설 스모크 — 표·트리거·권한·함수가 있고 가져오기 명령이 멱등인지 본다. 데이터 업그레이드에서는 B2 seed_wide 의
-- 상속 프로젝트를 한 번 전환하고(커밋) 그 프로젝트의 공용 팀 참조가 0 인지 본다. 경로는 접미로 적는다(supabase/rehearsal/*_command_receipts_smoke.sql).
--   docker exec -i "$SUPABASE_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 [변수] < supabase/rehearsal/<이 파일>
-- 변수: -v find=1       상속 프로젝트 후보 id 를 한 줄씩 내고 끝낸다(-At 로 부른다 — 리허설 명령이 정확히 한 줄인지 본다)
--       -v project=<id>  그 프로젝트의 네 곳(담당·명단 팀·영역 팀·수락 전 초대)에 공용 팀 참조가 0 이고 전용 팀이 있는지 본다
--       -v convert=1     project 와 함께 — 그 확인 전에 전환 RPC 를 한 번 부르고 **커밋**한다(데이터 업그레이드의 첫 스모크만)
-- 어긋나면 do 블록이 'COMMAND_RECEIPTS_SMOKE:' 예외로 멈춘다(ON_ERROR_STOP). 1)·2) 는 begin…rollback 이거나 읽기만 한다.
-- 민감도(트리거를 끄거나 금지 grant 를 준 상태에서 사후검사가 멈추는지)는 이 파일 밖 — 리허설 명령이 마이그레이션의 ⑦ 블록을 떠서 롤백
-- 트랜잭션에 흘린다(컨테이너 안 psql 은 마이그레이션 원문을 읽지 못한다). uuid 는 넷째 묶음 5b04, 다섯째 묶음 0000000b3… — B2 의 seed 와
-- 겹치지 않는다.
\if :{?find}
select p.id from public.projects p
 where p.id::text like '00000000-0000-0000-5b04-%'
   and not exists (select 1 from public.teams t where t.project_id = p.id)
   and exists (select 1 from public.item_owners io join public.wbs_items w on w.id = io.wbs_item_id
                 join public.teams t on t.id = io.team_id where w.project_id = p.id and t.project_id is null)
   and exists (select 1 from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
                 join public.teams t on t.id = pmt.team_id where pm.project_id = p.id and t.project_id is null)
   and exists (select 1 from public.area_teams art join public.project_areas a on a.id = art.area_id
                 join public.teams t on t.id = art.team_id where a.project_id = p.id and t.project_id is null)
   and exists (select 1 from public.project_invites i join public.teams t on t.id = any(i.team_ids)
                where i.project_id = p.id and i.redeemed_at is null and i.revoked_at is null and t.project_id is null)
 order by p.id;
\quit
\endif

-- 1) 구조 — 표·RLS·정책·트리거·권한·함수(빈 DB 에서도 참)
do $$
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.command_receipts'::regclass)
     or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'command_receipts' and p.cmd = 'SELECT') <> 1
     or (select count(*) from pg_trigger g where g.tgrelid = 'public.command_receipts'::regclass and not g.tgisinternal
          and g.tgenabled in ('O', 'A')) <> 3
     or has_table_privilege('authenticated', 'public.command_receipts', 'INSERT')
     or not has_table_privilege('authenticated', 'public.command_receipts', 'SELECT')
     or has_table_privilege('anon', 'public.command_receipts', 'SELECT')
     or not has_function_privilege('service_role', 'public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.convert_inherited_teams(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.convert_inherited_teams(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.import_wbs(uuid, jsonb, jsonb)', 'EXECUTE')
     -- ⑤′ 공용 팀 참조 거부 트리거 넷(A1-3 리뷰 M1)
     or (select count(*) from pg_trigger g where g.tgfoid = 'public.team_ref_owned_scope()'::regprocedure
          and not g.tgisinternal and g.tgenabled in ('O', 'A')) <> 4 then
    raise exception 'COMMAND_RECEIPTS_SMOKE: 표·트리거·권한이 기대와 다르다';
  end if;
end $$;

-- 2) 동작 — 같은 명령 두 번 = 한 벌. 행위자(플랫폼 관리자)·워크스페이스·프로젝트를 이 트랜잭션에서 만들고 rollback
begin;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        aud, role, instance_id, created_at, updated_at)
values ('00000000-0000-0000-5b04-0000000b3001', 'rehearsal-5b04-b3@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())
on conflict do nothing;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-5b04-0000000b3001') on conflict do nothing;
insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-5b04-0000000b3a01', 'rehearsal-b3', 'Rehearsal 영수증');
insert into public.projects (id, name, workspace_id)
values ('00000000-0000-0000-5b04-0000000b3c01', 'Rehearsal 가져오기', '00000000-0000-0000-5b04-0000000b3a01');
do $$
declare
  c_actor constant uuid := '00000000-0000-0000-5b04-0000000b3001';
  c_project constant uuid := '00000000-0000-0000-5b04-0000000b3c01';
  c_cmd constant uuid := '00000000-0000-0000-5b04-0000000b3e01';
  c_items constant jsonb := '[{"tempId": "t0", "code": "1", "name": "리허설 항목", "sortOrder": 0}]';
  r1 jsonb;
  r2 jsonb;
begin
  r1 := public.import_wbs_cmd(c_actor, c_project, 'append', c_items, null, c_cmd);
  r2 := public.import_wbs_cmd(c_actor, c_project, 'append', c_items, null, c_cmd);
  if r1 is distinct from jsonb_build_object('status', 'applied', 'mode', 'append', 'count', 1, 'command_id', c_cmd)
     or r2 is distinct from r1 || '{"status": "duplicate"}'::jsonb
     or (select count(*) from public.wbs_items w where w.project_id = c_project) <> 1
     or (select count(*) from public.command_receipts r where r.actor = c_actor and r.command_id = c_cmd) <> 1 then
    raise exception 'COMMAND_RECEIPTS_SMOKE: 같은 명령 두 번이 한 벌이 아니다: % / %', r1, r2;
  end if;
end $$;
rollback;

-- 3) 데이터 업그레이드 — 상속 프로젝트의 전환(convert 일 때만, 커밋)과 전환 뒤 상태(project 일 때마다)
\if :{?project}
select pg_catalog.set_config('rehearsal.project', :'project', false);
\if :{?convert}
begin;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        aud, role, instance_id, created_at, updated_at)
values ('00000000-0000-0000-5b04-0000000b3001', 'rehearsal-5b04-b3@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now())
on conflict do nothing;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-5b04-0000000b3001') on conflict do nothing;
do $$
declare
  c_actor constant uuid := '00000000-0000-0000-5b04-0000000b3001';
  v_p uuid := pg_catalog.current_setting('rehearsal.project')::uuid;
  v_refs jsonb;
  r jsonb;
begin
  if exists (select 1 from public.teams t where t.project_id = v_p) then
    raise exception 'COMMAND_RECEIPTS_SMOKE: 전환 전인데 전용 팀이 있다: %', v_p;
  end if;
  v_refs := jsonb_build_object(
    'item_owners', (select count(*) from public.item_owners io join public.wbs_items w on w.id = io.wbs_item_id
                     join public.teams t on t.id = io.team_id where w.project_id = v_p and t.project_id is null),
    'project_member_teams', (select count(*) from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
                     join public.teams t on t.id = pmt.team_id where pm.project_id = v_p and t.project_id is null),
    'area_teams', (select count(*) from public.area_teams art join public.project_areas a on a.id = art.area_id
                     join public.teams t on t.id = art.team_id where a.project_id = v_p and t.project_id is null),
    'invites', (select count(*) from public.project_invites i
                 where i.project_id = v_p and i.redeemed_at is null and i.revoked_at is null
                   and exists (select 1 from public.teams t where t.id = any(i.team_ids) and t.project_id is null)));
  r := public.convert_inherited_teams(c_actor, v_p);
  if r ->> 'status' is distinct from 'converted' or (r ->> 'teams')::int < 1 or r -> 'moved' is distinct from v_refs then
    raise exception 'COMMAND_RECEIPTS_SMOKE: 전환이 공용 팀 참조를 모두 옮기지 않았다: % / 전환 전 %', r, v_refs;
  end if;
  raise notice 'COMMAND_RECEIPTS_SMOKE: 전환 %', r;
end $$;
commit;
\endif
do $$
declare
  v_p uuid := pg_catalog.current_setting('rehearsal.project')::uuid;
  v_left jsonb;
begin
  v_left := jsonb_build_object(
    'item_owners', (select count(*) from public.item_owners io join public.wbs_items w on w.id = io.wbs_item_id
                     join public.teams t on t.id = io.team_id where w.project_id = v_p and t.project_id is null),
    'project_member_teams', (select count(*) from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
                     join public.teams t on t.id = pmt.team_id where pm.project_id = v_p and t.project_id is null),
    'area_teams', (select count(*) from public.area_teams art join public.project_areas a on a.id = art.area_id
                     join public.teams t on t.id = art.team_id where a.project_id = v_p and t.project_id is null),
    'invites', (select count(*) from public.project_invites i
                 where i.project_id = v_p and i.redeemed_at is null and i.revoked_at is null
                   and exists (select 1 from public.teams t where t.id = any(i.team_ids) and t.project_id is null)));
  if v_left is distinct from '{"item_owners": 0, "project_member_teams": 0, "area_teams": 0, "invites": 0}'::jsonb
     or not exists (select 1 from public.teams t where t.project_id = v_p) then
    raise exception 'COMMAND_RECEIPTS_SMOKE: 전환한 프로젝트에 공용 팀 참조가 남았거나 전용 팀이 없다: %', v_left;
  end if;
end $$;
-- 전환 뒤 공용 팀 참조 쓰기는 거부된다(⑤′ — A1-3 리뷰 M1). 같은 code 의 전용 팀이 있는 공용 팀 하나를 그 프로젝트 영역에 붙여 본다(rollback)
begin;
do $$
declare
  v_p uuid := pg_catalog.current_setting('rehearsal.project')::uuid;
  v_area uuid;
  v_common uuid;
begin
  select a.id into v_area from public.project_areas a where a.project_id = v_p order by a.id limit 1;
  select t.id into v_common from public.teams t join public.teams o on o.code = t.code and o.project_id = v_p
   where t.project_id is null and t.workspace_id = (select p.workspace_id from public.projects p where p.id = v_p)
     and not exists (select 1 from public.area_teams x where x.area_id = v_area and x.team_id = t.id)
   order by t.id limit 1;
  if v_area is null or v_common is null then
    raise exception 'COMMAND_RECEIPTS_SMOKE: 전환 뒤 거부를 볼 영역·공용 팀이 없다: % / %', v_area, v_common;
  end if;
  begin
    insert into public.area_teams (area_id, team_id, kind) values (v_area, v_common, 'support');
    raise exception 'COMMAND_RECEIPTS_SMOKE: 전환한 프로젝트에 공용 팀 참조가 다시 붙었다';
  exception when check_violation then
    if sqlerrm is distinct from 'TEAM_SCOPE_PROJECT_OWNED' then
      raise exception 'COMMAND_RECEIPTS_SMOKE: 거부 토큰이 다르다: %', sqlerrm;
    end if;
  end;
end $$;
rollback;
\endif
