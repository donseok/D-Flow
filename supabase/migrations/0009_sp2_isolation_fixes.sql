-- 0009_sp2_isolation_fixes — SP2 최종 리뷰 수정 웨이브(F1~F6). 정본: docs/superpowers/specs/2026-09-26-sp2-workspace-isolation-design.md §2·§7
-- (done_when: RLS·service_role 경로의 교차 워크스페이스 읽기·쓰기 0건).
-- 순서: ⓪ 사전검증(위반 행이 있으면 멈춘다 — 보정하지 않는다) ① 명단 분기의 워크스페이스 멤버십(F1)
--       ② wbs_items 부모 복합 FK(F2) ③ 임포트 RPC 공용 팀 워크스페이스 + item_owners 가드(F3) ④ 회의록 폴더 스코프(F4)
--       ⑤ issue_links 회의록 워크스페이스(F5) ⑥ wiki_item_has_live_source 실행 회수(F6) ⑦ 사후검증.
-- ①③④ 는 create or replace 라 ACL·트리거가 그대로다. 본문은 0008 적용 DB 의 pg_get_functiondef 원문에서 표시한 곳만 바꿨다.
-- 롤백: supabase/rollbacks/0009_sp2_isolation_fixes_rollback.sql. 리허설: supabase/rehearsal/0009_*.sql.

-- ⓪ 사전검증 — 아래 규칙을 이미 어긴 행이 있으면 무엇을 고쳐야 하는지 보여 주고 멈춘다(조용히 보정하지 않는다) ----------
do $$
declare
  v_msg text := '';
  v_n int;
  v_ids text;
begin
  -- ② 부모가 다른 프로젝트의 항목
  select count(*), string_agg(c.id::text, ', ' order by c.id)
    into v_n, v_ids
    from public.wbs_items c join public.wbs_items p on p.id = c.parent_id
   where p.project_id <> c.project_id;
  if v_n > 0 then v_msg := v_msg || format(' wbs_items 부모가 다른 프로젝트 %s건(%s);', v_n, left(v_ids, 400)); end if;

  -- ③ 담당 팀이 그 항목의 프로젝트 팀도, 그 프로젝트 워크스페이스의 공용 팀도 아닌 행
  select count(*), string_agg(o.wbs_item_id::text || '/' || o.team_id::text, ', ' order by o.wbs_item_id, o.team_id)
    into v_n, v_ids
    from public.item_owners o
    join public.wbs_items w on w.id = o.wbs_item_id
    join public.projects p on p.id = w.project_id
    join public.teams t on t.id = o.team_id
   where not (coalesce(t.project_id = w.project_id, false)   -- 공용 팀(project_id null)의 = 은 null 이다 — not null 로 빠지지 않게
              or (t.project_id is null and t.workspace_id = p.workspace_id));
  if v_n > 0 then v_msg := v_msg || format(' item_owners 팀 범위 밖 %s건(항목/팀 %s);', v_n, left(v_ids, 400)); end if;

  -- ④ 부모와 워크스페이스·프로젝트가 다른 회의록 폴더
  select count(*), string_agg(c.id::text, ', ' order by c.id)
    into v_n, v_ids
    from public.minute_folders c join public.minute_folders p on p.id = c.parent_id
   where p.workspace_id <> c.workspace_id or p.project_id is distinct from c.project_id;
  if v_n > 0 then v_msg := v_msg || format(' minute_folders 부모와 범위가 다름 %s건(%s);', v_n, left(v_ids, 400)); end if;

  -- ⑤ 이슈 프로젝트와 다른 워크스페이스의 회의록을 가리키는 원문 링크
  select count(*), string_agg(l.id::text, ', ' order by l.id)
    into v_n, v_ids
    from public.issue_links l
    join public.minutes m on m.id = l.minute_id
    join public.projects p on p.id = l.project_id
   where m.workspace_id <> p.workspace_id;
  if v_n > 0 then v_msg := v_msg || format(' issue_links 회의록 워크스페이스 불일치 %s건(%s);', v_n, left(v_ids, 400)); end if;

  if v_msg <> '' then
    raise exception 'SP2_0009_PRECHECK: 이 마이그레이션이 막을 위반 행이 이미 있다 — 행을 고친 뒤 다시 적용한다:%', v_msg;
  end if;
end $$;

-- ① F1 — 명단 분기는 그 프로젝트 워크스페이스의 멤버일 때만(앱 roleIn ④ 와 같은 순서). 워크스페이스에서 빠진 사람의 명단 행이
--    남아 있어도 RLS·위키 RPC·Storage 가 더는 그 행을 권한으로 읽지 않는다. 플랫폼 관리자·워크스페이스 관리자 분기는 그대로.
create or replace function public.is_project_admin(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_superuser()
      or (pid is not null and (
             public.is_ws_admin(public.project_ws(pid))
          or (exists (select 1 from public.project_members pm
                        join public.people pe on pe.id = pm.person_id
                       where pm.project_id = pid and pm.active and pe.active
                         and pe.user_id = auth.uid() and pm.access_role = 'admin')
              and public.is_ws_member(public.project_ws(pid)))))
$$;

create or replace function public.is_project_member(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_project_admin(pid)
      or (pid is not null and exists (
            select 1 from public.project_members pm
              join public.people pe on pe.id = pm.person_id
             where pm.project_id = pid and pm.active and pe.active
               and pe.user_id = auth.uid() and pm.access_role is not null)
          and public.is_ws_member(public.project_ws(pid)))
$$;

create or replace function public.my_member_id(pid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select pm.id from public.project_members pm
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pe.user_id = auth.uid() and pm.active and pe.active
     and public.is_ws_member(public.project_ws(pid))
   limit 1
$$;

create or replace function public.my_team_ids(pid uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select pmt.team_id from public.project_member_teams pmt
    join public.project_members pm on pm.id = pmt.member_id
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pm.active and pe.active and pe.user_id = auth.uid()
     and public.is_ws_member(public.project_ws(pid))
$$;

create or replace function public.is_project_admin_anywhere_in_ws(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_ws_admin(wid)
      or (public.is_ws_member(wid)
          and exists (select 1 from public.project_members pm
                        join public.people pe on pe.id = pm.person_id
                        join public.projects p on p.id = pm.project_id
                       where p.workspace_id = wid and pe.user_id = auth.uid()
                         and pm.active and pe.active and pm.access_role = 'admin'))
$$;

-- 작성자 분기도 같다 — 워크스페이스를 떠난 작성자는 자기 옛 이슈의 첨부(Storage·issue_attachments)를 더는 쓰지 못한다.
create or replace function public.can_edit_issue(iid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.issues i
    where i.id = iid
      and ((i.created_by = auth.uid() and public.is_ws_member(public.project_ws(i.project_id)))
           or public.is_project_admin(i.project_id))
  )
$$;

-- ② F2 — 부모는 같은 프로젝트의 항목. 단일 컬럼 FK 는 다른 워크스페이스 항목을 부모로 받아 그 항목의 리프 판정(wbs_is_leaf)과
--    좌석표 조상 조회를 오염시켰다. (id, project_id) 유일 제약(wbs_items_id_project_unique)이 이미 있다. 부모 삭제 cascade 는 그대로.
alter table public.wbs_items drop constraint wbs_items_parent_id_fkey,
  add constraint wbs_items_parent_id_fkey foreign key (parent_id, project_id)
    references public.wbs_items(id, project_id) on delete cascade;

-- ③ F3 — 공용 팀은 대상 프로젝트의 워크스페이스 것만. 같은 코드의 공용 팀이 여러 워크스페이스에 있으면(teams_ws_project_code_key 가
--    허용한다) 여러 워크스페이스를 보는 호출자(플랫폼 관리자·두 워크스페이스 사용자)의 임포트가 남의 팀을 담당으로 붙였다.
--    두 함수는 INVOKER 라 project_ws(실행 권한 회수됨) 대신 서브셀렉트로 읽는다. 표시한 조건 외 본문은 0002 그대로.
CREATE OR REPLACE FUNCTION public.import_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_item jsonb;
  v_owner jsonb;
  v_hol jsonb;
  v_id uuid;
  v_parent uuid;
  v_team uuid;
  v_map jsonb := '{}'::jsonb;   -- tempId -> 생성된 uuid(text)
  v_count integer := 0;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
  loop
    v_parent := null;
    if nullif(v_item->>'parentTempId', '') is not null then
      v_parent := nullif(v_map->>(v_item->>'parentTempId'), '')::uuid;
    end if;

    insert into wbs_items (
      project_id, parent_id, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from teams
       where code = v_owner->>'team'
         and (project_id = p_project_id
              or (project_id is null
                  and workspace_id = (select p.workspace_id from projects p where p.id = p_project_id)))
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_item jsonb;
  v_owner jsonb;
  v_hol jsonb;
  v_id uuid;
  v_parent uuid;
  v_team uuid;
  v_map jsonb := '{}'::jsonb;   -- tempId -> 생성된 uuid(text)
  v_count integer := 0;
begin
  delete from public.wbs_items where project_id = p_project_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
  loop
    v_parent := null;
    if nullif(v_item->>'parentTempId', '') is not null then
      v_parent := nullif(v_map->>(v_item->>'parentTempId'), '')::uuid;
    end if;

    insert into wbs_items (
      project_id, parent_id, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from teams
       where code = v_owner->>'team'
         and (project_id = p_project_id
              or (project_id is null
                  and workspace_id = (select p.workspace_id from projects p where p.id = p_project_id)))
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$function$;

-- 담당 팀: 그 항목의 프로젝트 팀이거나 그 프로젝트 워크스페이스의 공용 팀 — area_teams_guard(0003)와 같은 결. 모든 쓰기 경로
-- (세션 PostgREST·addSubAct·임포트 RPC)를 덮는다.
create function public.item_owners_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.wbs_items w
      join public.projects p on p.id = w.project_id
      join public.teams t on t.id = new.team_id
     where w.id = new.wbs_item_id
       and (t.project_id = w.project_id or (t.project_id is null and t.workspace_id = p.workspace_id))) then
    raise exception using errcode = '23514', message = 'ITEM_OWNER_TEAM_SCOPE';
  end if;
  return new;
end
$$;
revoke all on function public.item_owners_guard() from public, anon, authenticated;
create trigger item_owners_guard before insert or update on public.item_owners
  for each row execute function public.item_owners_guard();

-- ④ F4 — 부모가 있으면 프로젝트가 있어도 부모를 본다: 자식 = 부모 프로젝트(0076 불변식, resolveFolderDrop 의 cross-project 와 같다)이고
--    같은 워크스페이스. 종전엔 프로젝트가 있으면 부모를 보지 않아 B 프로젝트 폴더를 A 폴더 아래에 매달 수 있었다.
--    워크스페이스는 행이 생길 때 정해지고 바뀌지 않는다 — 프로젝트 없는 루트의 workspace_id 를 바꾸면 A 의 하위 폴더·회의록이
--    B 폴더에 매달렸다(그 폴더를 B 가 지우면 cascade 로 A 행이 지워진다).
create or replace function public.minute_folders_workspace_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_parent_ws uuid; v_parent_project uuid;
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception using errcode = '23514', message = 'WORKSPACE_SCOPE_MISMATCH';
  end if;
  if new.project_id is not null then
    select p.workspace_id into v_ws from public.projects p where p.id = new.project_id;
  end if;
  if new.parent_id is not null then
    select f.workspace_id, f.project_id into v_parent_ws, v_parent_project
      from public.minute_folders f where f.id = new.parent_id;
    if found then   -- 없는 부모는 FK 가 23503 으로 거부한다
      if new.project_id is distinct from v_parent_project or v_ws <> v_parent_ws then
        raise exception using errcode = '23514', message = 'WORKSPACE_SCOPE_MISMATCH';
      end if;
      v_ws := v_parent_ws;
    end if;
  end if;
  if v_ws is null then return new; end if;
  if new.workspace_id is null then
    new.workspace_id := v_ws;
  elsif new.workspace_id <> v_ws then
    raise exception using errcode = '23514', message = 'WORKSPACE_SCOPE_MISMATCH';
  end if;
  return new;
end $$;

-- ⑤ F5 — 이슈의 원문 링크는 이슈 프로젝트와 같은 워크스페이스의 회의록만. 프로젝트 없는 회의록은 워크스페이스로만 스코프되는데
--    create_issue_from_minute_block(service_role)은 프로젝트 불일치만 봐서, 두 워크스페이스 사용자가 A 의 회의록 발췌를 B 이슈에
--    옮겨 적을 수 있었다. RPC 본문을 복제하지 않고 모든 쓰기 경로를 표에서 막는다.
create function public.issue_links_minute_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.minutes m join public.projects p on p.id = new.project_id
              where m.id = new.minute_id and m.workspace_id <> p.workspace_id) then
    raise exception using errcode = '23514', message = 'MINUTE_WORKSPACE_MISMATCH';
  end if;
  return new;
end
$$;
revoke all on function public.issue_links_minute_scope() from public, anon, authenticated;
create trigger issue_links_minute_scope before insert or update of minute_id, project_id on public.issue_links
  for each row execute function public.issue_links_minute_scope();

-- ⑥ F6 — 정책은 이 함수를 부르지 않고 curate_wiki_item(SECURITY DEFINER) 본문만 부른다. authenticated 가 PostgREST 로 직접 부르면
--    다른 워크스페이스 위키 항목의 근거 유무를 답해 주는 오라클이었다. (wbs_is_leaf 는 member_update_actual 정책이 직접 불러 유지.)
revoke execute on function public.wiki_item_has_live_source(uuid) from authenticated;

-- ⑦ 사후검증 ------------------------------------------------------------------------------------------------------
do $$
declare v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v from pg_proc p
   where p.oid in ('public.is_project_admin(uuid)'::regprocedure, 'public.is_project_member(uuid)'::regprocedure,
                   'public.my_member_id(uuid)'::regprocedure, 'public.my_team_ids(uuid)'::regprocedure,
                   'public.is_project_admin_anywhere_in_ws(uuid)'::regprocedure, 'public.can_edit_issue(uuid)'::regprocedure)
     and p.prosrc not like '%is_ws_member(%';
  if v is not null then raise exception 'SP2_0009_POSTCHECK: 명단·작성자 분기에 워크스페이스 멤버십이 없다: %', v; end if;
  if has_function_privilege('authenticated', 'public.wiki_item_has_live_source(uuid)', 'EXECUTE') then
    raise exception 'SP2_0009_POSTCHECK: authenticated 가 wiki_item_has_live_source 를 실행할 수 있다';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wbs_items_parent_id_fkey'
                  and conrelid = 'public.wbs_items'::regclass and array_length(conkey, 1) = 2) then
    raise exception 'SP2_0009_POSTCHECK: wbs_items_parent_id_fkey 가 (parent_id, project_id) 복합 FK 가 아니다';
  end if;
end $$;
