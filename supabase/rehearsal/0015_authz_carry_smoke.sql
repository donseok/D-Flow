-- NNNN_authz_carry 리허설 스모크 — 열 권한·기록 트리거 둘·세 함수의 새 분기가 있고, 권한 있는 명단 행의 active 전환이 이력 1행을, 인물의
-- active 전환이 명령 id 없는 1행을 남기며, person_id 변경과 명시 키 unset 이 거부되는지 본다. 빈 DB 와 seed_wide 위(데이터 업그레이드)에서
-- 같은 답이다 — 볼 행은 이 파일이 만든다. 경로는 접미로 적는다(supabase/rehearsal/*_authz_carry_smoke.sql).
--   docker exec -i "$SUPABASE_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rehearsal/<이 파일>
-- 어긋나면 do 블록이 'AUTHZ_CARRY_SMOKE:' 예외로 멈춘다. 2) 는 begin…rollback 이라 아무것도 남지 않는다. 민감도는 이 파일 밖 — 리허설
-- 명령이 마이그레이션의 ④ 블록을 떠서 흘린다. uuid 는 넷째 묶음 5b04, 다섯째 묶음 0000000b4… — B2 의 seed 와 겹치지 않는다.

-- 1) 구조
do $$
begin
  if has_column_privilege('authenticated', 'public.people', 'email', 'INSERT')
     or has_column_privilege('authenticated', 'public.people', 'email', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.people', 'display_name', 'UPDATE')
     or not exists (select 1 from pg_trigger g where g.tgrelid = 'public.people'::regclass and g.tgname = 'authz_events_record_people'
                     and not g.tgisinternal and g.tgenabled in ('O', 'A'))
     or not exists (select 1 from pg_trigger g where g.tgrelid = 'public.project_members'::regclass and g.tgname = 'authz_events_record'
                     and not g.tgisinternal and g.tgenabled in ('O', 'A')
                     and pg_get_triggerdef(g.oid) like '%UPDATE OF access_role, active ON public.project_members%')
     or position('PROJECT_MEMBER_PERSON_IMMUTABLE' in
                 (select p.prosrc from pg_proc p where p.oid = 'public.project_members_guard()'::regprocedure)) = 0 then
    raise exception 'AUTHZ_CARRY_SMOKE: 열 권한·트리거·함수가 기대와 다르다';
  end if;
end $$;

-- 2) 동작 — 계정·워크스페이스·프로젝트·인물·권한 있는 명단 행을 이 트랜잭션에서 만들고 rollback
begin;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        aud, role, instance_id, created_at, updated_at)
values ('00000000-0000-0000-5b04-0000000b4001', 'rehearsal-5b04-b4@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-5b04-0000000b4a01', 'rehearsal-b4', 'Rehearsal 권한 이월');
insert into public.workspace_members (workspace_id, user_id, role)
values ('00000000-0000-0000-5b04-0000000b4a01', '00000000-0000-0000-5b04-0000000b4001', 'member');
insert into public.projects (id, name, workspace_id)
values ('00000000-0000-0000-5b04-0000000b4c01', 'Rehearsal 권한 이월', '00000000-0000-0000-5b04-0000000b4a01');
insert into public.people (id, workspace_id, display_name, email, user_id)
values ('00000000-0000-0000-5b04-0000000b4b01', '00000000-0000-0000-5b04-0000000b4a01', 'rehearsal', 'rehearsal-5b04-b4@example.com',
        '00000000-0000-0000-5b04-0000000b4001');
insert into public.project_members (id, project_id, person_id, access_role)
values ('00000000-0000-0000-5b04-0000000b4e01', '00000000-0000-0000-5b04-0000000b4c01', '00000000-0000-0000-5b04-0000000b4b01', 'member');
update public.project_members set active = false where id = '00000000-0000-0000-5b04-0000000b4e01';
update public.people set active = false where id = '00000000-0000-0000-5b04-0000000b4b01';
do $$
declare
  c_person constant uuid := '00000000-0000-0000-5b04-0000000b4b01';
  v jsonb;
begin
  -- 부여(insert) → 명단 행 비활성(권한 있는 행의 active 전환 1행) → 인물 비활성(명령 id 없는 1행)
  select jsonb_agg(jsonb_build_object('before', e.before, 'after', e.after, 'command_id', e.command_id) order by e.id) into v
    from public.authz_events e where e.kind = 'project_access' and e.target_person_id = c_person;
  if v is distinct from '[
       {"before": null, "after": {"access_role": "member", "access_granted_by": null, "active": true}, "command_id": null},
       {"before": {"access_role": "member", "active": true}, "after": {"access_role": "member", "active": false}, "command_id": null},
       {"before": {"person_active": true}, "after": {"person_active": false}, "command_id": null}]'::jsonb then
    raise exception 'AUTHZ_CARRY_SMOKE: 명단·인물 활성 전환의 기록이 기대와 다르다: %', v;
  end if;
  begin
    update public.project_members set person_id = '00000000-0000-0000-5b04-0000000b4b02'
     where id = '00000000-0000-0000-5b04-0000000b4e01';
    raise exception 'AUTHZ_CARRY_SMOKE: 명단 행의 person_id 가 바뀌었다';
  exception when check_violation then
    if sqlerrm is distinct from 'PROJECT_MEMBER_PERSON_IMMUTABLE' then raise; end if;
  end;
  begin
    perform public.apply_project_settings('00000000-0000-0000-5b04-0000000b4c01', 0, gen_random_uuid(), '{}'::jsonb,
      array['modules.enabled'], null, 1, 'internal');
    raise exception 'AUTHZ_CARRY_SMOKE: modules.enabled 의 unset 이 통과했다';
  exception when invalid_parameter_value then
    if sqlerrm is distinct from 'CONFIG_INVALID:modules.enabled' then raise; end if;
  end;
end $$;
rollback;
