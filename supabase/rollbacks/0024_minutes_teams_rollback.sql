-- *_minutes_teams 롤백(조건부 — 되돌릴 수 없는 데이터가 있으면 멈춘다). 회의록 team_id 이관 결과는 되돌리지 않는다(열을 지운다 — team_code 원문이 남는다).
-- 순서(D52 ③): ① 폴더 이름을 code 로 먼저 되돌린다 — 옛 코드는 parent_id null ∧ created_by null ∧ name = code 로 루트를 찾는다.
--   ② 트리거·함수 삭제 ③ 세션 공용 팀 INSERT 정책 복원 ④ 전환 RPC·M1 가드를 SP4 본문(0014·0016)으로 ⑤ 열·제약·인덱스 삭제.
-- 멈춤 MINUTES_TEAMS_ROLLBACK_BLOCKED: 이름을 되돌리면 같은 범위 루트끼리 겹치는 경우(조치: 겹치는 폴더 이름을 먼저 바꾼다),
--   또는 사용자가 만든 최상위 폴더(created_by 있음)가 code 이름을 이미 차지한 경우.

do $$
declare
  v text;
begin
  with target as (
    select f.id, f.workspace_id, f.project_id, case when f.kind = 'team_root' then t.code else f.name end as final_name
      from public.minute_folders f left join public.teams t on t.id = f.team_id
     where f.parent_id is null
  )
  select string_agg(pg_catalog.format('%s(%s)', a.final_name, coalesce(a.project_id::text, 'workspace')), ', ') into v
    from target a join target b on b.id <> a.id and a.id < b.id and b.workspace_id = a.workspace_id
     and b.project_id is not distinct from a.project_id and b.final_name = a.final_name;
  if v is not null then
    raise exception using errcode = '23514', message = 'MINUTES_TEAMS_ROLLBACK_BLOCKED', detail = left(v, 600),
      hint = '팀 루트 이름을 code 로 되돌리면 겹치는 최상위 폴더가 있습니다 — 그 폴더 이름을 바꾼 뒤 다시 롤백하세요.';
  end if;
end $$;

-- ① 이름을 code 로(트리거가 남아 있으니 종류 가드는 세션만 막는다 — 이 문장은 소유자로 돈다)
update public.minute_folders f set name = t.code from public.teams t where f.kind = 'team_root' and t.id = f.team_id;

-- ② 트리거·함수
drop trigger if exists minute_folders_kind_guard on public.minute_folders;
drop trigger if exists minute_folders_team_scope on public.minute_folders;
drop trigger if exists minute_folders_team_owned_scope on public.minute_folders;
drop trigger if exists minutes_team_code_echo on public.minutes;
drop trigger if exists minutes_team_scope on public.minutes;
drop trigger if exists minutes_team_owned_scope on public.minutes;
drop trigger if exists teams_name_sync_minute_roots on public.teams;
drop function if exists public.minute_folders_kind_guard();
drop function if exists public.minute_team_scope();
drop function if exists public.minutes_team_code_echo();
drop function if exists public.teams_name_sync_minute_roots();
drop function if exists public.create_team(uuid, uuid, text, text, text, integer);
drop function if exists public.ensure_team_roots(uuid, uuid);
drop function if exists public.minute_team_root_insert(uuid, uuid, uuid, text, integer);
drop function if exists public.actor_is_workspace_admin(uuid, uuid);

-- ③ 세션 공용 팀 INSERT 정책(0003 원문)
create policy wsadmin_insert_teams on public.teams for insert to authenticated with check (project_id is null and public.is_ws_admin(workspace_id));

-- ④ SP4 본문 — 전환 RPC(0014 원문)
create or replace function public.convert_inherited_teams(p_actor uuid, p_project_id uuid)
returns jsonb language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_ws uuid;
  v_team record;
  v_new uuid;
  v_map jsonb := '{}'::jsonb;   -- 옛 공용 팀 id(text) → 새 전용 팀 id(text)
  v_teams integer := 0;
  v_owners integer;
  v_member_teams integer;
  v_area_teams integer;
  v_invites integer;
begin
  if p_actor is null or p_project_id is null then
    raise exception using errcode = '22023', message = 'TEAM_CONVERT_INVALID_INPUT';
  end if;
  -- 가져오기의 프로젝트 잠금과 같은 키 — 전환과 가져오기가 엇갈려 공용 팀 참조가 다시 생기지 않게 한다. 전환은 이 잠금 하나만 잡는다(§3.1)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wbs-import:' || p_project_id::text, 0));
  -- 격리 수준 규칙(H2 ③): 잠금 뒤 전용 팀·참조를 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 프로젝트의 전환 — 스냅샷이 고정된 수준에서는 아래 전용 팀 판독이 그것을 못 봐 두 벌을 만든다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'TEAM_CONVERT_ISOLATION';
  end if;
  -- 프로젝트 행을 for update 로 잡는다 — 새 공용 팀 참조를 쓰는 트리거(⑤′ team_ref_owned_scope)는 같은 행을 for key share 로 잡으므로,
  -- 전환과 엇갈려 커밋되는 공용 팀 참조는 전환 앞에 끝나(아래 UPDATE 가 옮긴다) 전환 뒤에 오거나(트리거가 전용 팀을 보고 거부한다),
  -- 참조 행을 먼저 잠근 쓰기(영역·명단 RPC 의 delete → insert)와 엇갈리면 교착 탐지로 한쪽이 40P01 로 롤백된다(재시도 가능 — 호출부가 503)
  select p.workspace_id into v_ws from public.projects p where p.id = p_project_id for update;
  if v_ws is null then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'TEAM_CONVERT_FORBIDDEN';
  end if;
  -- 전제(전용 팀 0개)가 깨진 호출 — 동시 재전송·두 번 누른 버튼. 전용 팀이 하나라도(비활성 포함) 있으면 아무것도 바꾸지 않는다
  if exists (select 1 from public.teams t where t.project_id = p_project_id) then
    return pg_catalog.jsonb_build_object('status', 'already');
  end if;
  -- 복사 대상 = 그 워크스페이스의 활성 공용 팀 ∪ 그 프로젝트 안의 네 참조가 가리키는 공용 팀(비활성 포함)
  for v_team in
    select t.id, t.code, t.name, t.color, t.sort_order, t.progress_visible, t.active
      from public.teams t
     where t.workspace_id = v_ws and t.project_id is null
       and (t.active
            or exists (select 1 from public.item_owners io join public.wbs_items w on w.id = io.wbs_item_id
                        where io.team_id = t.id and w.project_id = p_project_id)
            or exists (select 1 from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
                        where pmt.team_id = t.id and pm.project_id = p_project_id)
            or exists (select 1 from public.area_teams art join public.project_areas a on a.id = art.area_id
                        where art.team_id = t.id and a.project_id = p_project_id)
            or exists (select 1 from public.project_invites i
                        where i.project_id = p_project_id and i.redeemed_at is null and i.revoked_at is null
                          and t.id = any(i.team_ids)))
     order by t.sort_order, t.code, t.id
  loop
    -- teams_guard 가 워크스페이스 일치를 본다. 전용 팀이 없던 프로젝트라 (워크스페이스, 프로젝트, code) 유일 키와 겹치지 않는다
    insert into public.teams (workspace_id, project_id, code, name, color, sort_order, progress_visible, active)
    values (v_ws, p_project_id, v_team.code, v_team.name, v_team.color, v_team.sort_order, v_team.progress_visible, v_team.active)
    returning id into v_new;
    v_map := v_map || pg_catalog.jsonb_build_object(v_team.id::text, v_new::text);
    v_teams := v_teams + 1;
  end loop;
  -- 네 참조를 새 id 로 — 그 프로젝트 안에서만. 범위 트리거 넷은 같은 프로젝트의 전용 팀이라 통과한다. 전용 팀이 없던 프로젝트라
  -- 새 id 와 겹치는 행이 없다(PK 충돌 없음)
  update public.item_owners io set team_id = (v_map ->> io.team_id::text)::uuid
    from public.wbs_items w
   where w.id = io.wbs_item_id and w.project_id = p_project_id and v_map ? io.team_id::text;
  get diagnostics v_owners = row_count;
  update public.project_member_teams pmt set team_id = (v_map ->> pmt.team_id::text)::uuid
    from public.project_members pm
   where pm.id = pmt.member_id and pm.project_id = p_project_id and v_map ? pmt.team_id::text;
  get diagnostics v_member_teams = row_count;
  update public.area_teams art set team_id = (v_map ->> art.team_id::text)::uuid
    from public.project_areas a
   where a.id = art.area_id and a.project_id = p_project_id and v_map ? art.team_id::text;
  get diagnostics v_area_teams = row_count;
  -- 수락 전 초대만 — 수락 때 그 id 로 명단 팀을 만든다(consume_project_invite). 배열 순서를 지킨다
  update public.project_invites i
     set team_ids = array(select coalesce((v_map ->> x.team_id::text)::uuid, x.team_id)
                            from pg_catalog.unnest(i.team_ids) with ordinality as x(team_id, ord) order by x.ord)
   where i.project_id = p_project_id and i.redeemed_at is null and i.revoked_at is null
     and exists (select 1 from pg_catalog.unnest(i.team_ids) as y(team_id) where v_map ? y.team_id::text);
  get diagnostics v_invites = row_count;
  return pg_catalog.jsonb_build_object('status', 'converted', 'teams', v_teams, 'moved', pg_catalog.jsonb_build_object(
    'item_owners', v_owners, 'project_member_teams', v_member_teams, 'area_teams', v_area_teams, 'invites', v_invites));
end $$;

-- ④′ M1 가드(0016 원문)
create or replace function public.team_ref_owned_scope() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_project uuid;
  v_teams uuid[];
begin
  -- 팀·부모 열이 그대로인 UPDATE 는 새 참조가 아니다(잠금 앞에서 끝낸다 — 행 잠금 대기 뒤 EPQ 가 전환된 OLD 를 본다)
  if tg_table_name = 'item_owners' then
    if tg_op = 'UPDATE' and new.team_id = old.team_id and new.wbs_item_id = old.wbs_item_id then
      return new;
    end if;
    select w.project_id into v_project from public.wbs_items w where w.id = new.wbs_item_id;
    v_teams := array[new.team_id];
  elsif tg_table_name = 'project_member_teams' then
    if tg_op = 'UPDATE' and new.team_id = old.team_id and new.member_id = old.member_id then
      return new;
    end if;
    select pm.project_id into v_project from public.project_members pm where pm.id = new.member_id;
    v_teams := array[new.team_id];
  elsif tg_table_name = 'area_teams' then
    if tg_op = 'UPDATE' and new.team_id = old.team_id and new.area_id = old.area_id then
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
  -- 격리 수준 규칙(H2 ③): 아래 잠금 뒤 판정은 새 스냅숏(read committed)에 기댄다 — 스냅숏이 고정된 수준이면 옛 행이 보여 면제되므로 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'TEAM_SCOPE_ISOLATION';
  end if;
  -- 잠금 먼저 — 전환이 진행 중이면 여기서 기다렸다가(read committed — 다음 문장은 새 스냅숏) 커밋된 상태를 본다
  perform 1 from public.projects p where p.id = v_project for key share;
  -- 잠금 뒤의 "이미 있는 키" 면제 — 같은 키 INSERT(on conflict 재저장)는 새 참조가 아니다. 전환이 그 행을 전용 팀으로 옮겼으면 행이 없어 면제되지 않는다.
  -- 표마다 갈래를 나눈다 — 한 식에 묶으면 PL/pgSQL 이 다른 표의 열(new.wbs_item_id 등)을 풀다가 멈춘다
  if tg_op = 'INSERT' then
    if tg_table_name = 'item_owners' then
      if exists (select 1 from public.item_owners x where x.wbs_item_id = new.wbs_item_id and x.team_id = new.team_id) then
        return new;
      end if;
    elsif tg_table_name = 'project_member_teams' then
      if exists (select 1 from public.project_member_teams x where x.member_id = new.member_id and x.team_id = new.team_id) then
        return new;
      end if;
    elsif tg_table_name = 'area_teams' then
      if exists (select 1 from public.area_teams x where x.area_id = new.area_id and x.team_id = new.team_id) then
        return new;
      end if;
    end if;
  end if;
  if exists (select 1 from public.teams t join public.teams o on o.project_id = v_project and o.code = t.code
              where t.id = any (v_teams) and t.project_id is null) then
    raise exception using errcode = '23514', message = 'TEAM_SCOPE_PROJECT_OWNED';
  end if;
  return new;
end $$;

-- ⑤ 열·제약·인덱스(회의록 team_id 는 지운다 — team_code 원문이 남는다)
drop index if exists public.minutes_workspace_team_idx;
alter table public.minutes drop column if exists team_id;
drop index if exists public.minute_folders_team_idx;
drop index if exists public.minute_folders_team_root_uidx;
alter table public.minute_folders drop constraint if exists minute_folders_root_parent_check;
alter table public.minute_folders drop constraint if exists minute_folders_team_root_check;
alter table public.minute_folders drop column if exists team_id;
alter table public.minute_folders drop column if exists kind;
drop function if exists public.minute_team_for_code(uuid, uuid, text);
