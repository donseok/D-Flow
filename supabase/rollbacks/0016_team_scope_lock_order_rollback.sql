-- NNNN_team_scope_lock_order 롤백 — team_ref_owned_scope 를 *_command_receipts 원문 그대로(0014_command_receipts.sql:361-412 — 첫 줄만
-- create or replace, 트리거 넷·ACL 은 그대로 남아 있다). 되돌리지 않는 데이터 없음(함수 하나). 롤백 뒤에는 A1 최종 리뷰 보안 P2 의 경합 창이
-- 다시 열린다 — 이 파일은 *_command_receipts 롤백보다 먼저 돈다(그 롤백이 함수를 지운다).
begin;

create or replace function public.team_ref_owned_scope() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_project uuid;
  v_teams uuid[];
begin
  -- 새로 생기는 참조만 본다 — 같은 키의 행이 이미 있는 INSERT(on conflict 재저장)·팀·부모 열이 그대로인 UPDATE 는 판정하지 않는다
  if tg_table_name = 'item_owners' then
    if (tg_op = 'UPDATE' and new.team_id = old.team_id and new.wbs_item_id = old.wbs_item_id)
       or (tg_op = 'INSERT' and exists (select 1 from public.item_owners x where x.wbs_item_id = new.wbs_item_id and x.team_id = new.team_id)) then
      return new;
    end if;
    select w.project_id into v_project from public.wbs_items w where w.id = new.wbs_item_id;
    v_teams := array[new.team_id];
  elsif tg_table_name = 'project_member_teams' then
    if (tg_op = 'UPDATE' and new.team_id = old.team_id and new.member_id = old.member_id)
       or (tg_op = 'INSERT' and exists (select 1 from public.project_member_teams x where x.member_id = new.member_id and x.team_id = new.team_id)) then
      return new;
    end if;
    select pm.project_id into v_project from public.project_members pm where pm.id = new.member_id;
    v_teams := array[new.team_id];
  elsif tg_table_name = 'area_teams' then
    if (tg_op = 'UPDATE' and new.team_id = old.team_id and new.area_id = old.area_id)
       or (tg_op = 'INSERT' and exists (select 1 from public.area_teams x where x.area_id = new.area_id and x.team_id = new.team_id)) then
      return new;
    end if;
    select a.project_id into v_project from public.project_areas a where a.id = new.area_id;
    v_teams := array[new.team_id];
  elsif tg_table_name = 'project_invites' then
    v_project := new.project_id;
    -- 같은 프로젝트의 초대 갱신이면 옛 team_ids 에 없던 id 만 새 참조다
    if tg_op = 'UPDATE' and new.project_id = old.project_id then
      v_teams := array(select x from pg_catalog.unnest(new.team_ids) as x where not (x = any (coalesce(old.team_ids, '{}'::uuid[]))));
    else
      v_teams := new.team_ids;
    end if;
  else
    raise exception using errcode = '55000', message = 'TEAM_SCOPE_TRIGGER_MISPLACED';
  end if;
  -- 공용 팀을 가리키지 않으면 볼 것이 없다(범위 자체 — 다른 프로젝트·워크스페이스 팀 — 는 기존 가드 넷이 본다)
  if v_project is null or v_teams is null
     or not exists (select 1 from public.teams t where t.id = any (v_teams) and t.project_id is null) then
    return new;
  end if;
  -- 전환이 진행 중이면 여기서 기다렸다가(read committed — 다음 문장은 새 스냅샷) 커밋된 전용 팀을 본다
  perform 1 from public.projects p where p.id = v_project for key share;
  if exists (select 1 from public.teams t join public.teams o on o.project_id = v_project and o.code = t.code
              where t.id = any (v_teams) and t.project_id is null) then
    raise exception using errcode = '23514', message = 'TEAM_SCOPE_PROJECT_OWNED';
  end if;
  return new;
end $$;

commit;
