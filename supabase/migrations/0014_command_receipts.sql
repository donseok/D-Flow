-- NNNN_command_receipts — 가져오기 명령 영수증과 명령 RPC(SP4 Phase A1)
-- 정본: docs/superpowers/specs/2026-10-01-sp4-weekly-teams-design.md §3.3(D5·D17·D34·D35·D54). 번호를 참조하지 않는다 — 리허설·테스트는 접미로 찾는다.
-- 절: ① 영수증 표·인덱스·RLS ② 트리거 셋(워크스페이스 일치·고칠 수 없음·비우지 못함) ③ 옛 import_wbs·replace_wbs 의 표 이름 한정
--     ④ import_wbs_cmd ⑤ convert_inherited_teams ⑤′ 전용 팀 프로젝트의 공용 팀 참조 거부 ⑥ 권한 ⑦ 사후검사(COMMAND_RECEIPTS_POSTCHECK)
-- 권한 원칙: 세션은 자기 영수증을 읽기만 한다(쓰기 정책·쓰기 grant 없음 — 남의 command_id 로 결과를 재생하지 못한다). 쓰기는 service_role 이
--   부르는 DEFINER RPC 둘(④⑤)뿐이고, RPC 가 행위자(p_actor — 라우트 가드 결과의 actor.userId, D51)의 프로젝트 관리자 등급을 다시
--   판정한다(*_weekly_areas 의 actor_is_project_admin). DEFINER 라 RLS admin_write_items 가 빠진 자리의 2차 방어선이다(D17).
--   advisory 잠금을 잡는 두 RPC 는 lock_timeout 15s — 대기가 넘치면 55P03(화면은 503 재시도).
-- 보존·정리 규칙 없음 — 영수증은 워크스페이스·프로젝트 삭제 때 FK 캐스케이드로만 지워진다. 보존 정책의 거처는 SP8(스펙 D5·§9).
-- 롤백: supabase/rollbacks/*_command_receipts_rollback.sql. 리허설 스모크: supabase/rehearsal/*_command_receipts_smoke.sql.
-- *_weekly_areas 뒤에 온다 — 두 RPC 가 그 파일의 actor_is_project_admin 을 부른다(그 파일의 롤백은 이 파일이 적용돼 있으면 멈춘다).

-- ① 영수증 표 — PK·조회·정책 모두 actor 를 쓴다. wbs_import 영수증은 늘 프로젝트를 가진다(check — DELETE 면제의 "부모 없음" 판독이
--    null project_id 에서 늘 참이 되지 않게, D35·Q14). FK 둘은 캐스케이드 — 동작 없는 FK 는 프로젝트 삭제를 23503 으로 막는다
create table public.command_receipts (
  actor          uuid not null,
  command_id     uuid not null,
  kind           text not null check (kind in ('wbs_import')),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  project_id     uuid references public.projects (id) on delete cascade,
  command_digest text not null,
  result         jsonb not null,
  created_at     timestamptz not null default now(),
  primary key (actor, command_id, kind),
  constraint command_receipts_project_required check (kind <> 'wbs_import' or project_id is not null)  -- Q14
);
create index command_receipts_project_idx on public.command_receipts (project_id);
create index command_receipts_workspace_idx on public.command_receipts (workspace_id);
alter table public.command_receipts enable row level security;
revoke all on public.command_receipts from anon, authenticated;
grant select on public.command_receipts to authenticated;
create policy command_receipts_own_read on public.command_receipts for select to authenticated
  using (actor = auth.uid() and public.is_ws_member(workspace_id));   -- 0006 own_user_preferences 와 같은 꼴

-- ② 트리거 셋 — 워크스페이스는 프로젝트의 것(0006 함수 재사용 — 비면 채우고 다르면 23514 WORKSPACE_SCOPE_MISMATCH), 고칠 수 없음
--    (UPDATE 는 늘 55000, DELETE 는 부모가 이미 없을 때만 — FK 캐스케이드), TRUNCATE 거부(0012 함수 재사용 — 행 트리거를 건너뛰고
--    service_role 은 기본 권한으로 TRUNCATE 를 받는다). 같은 시점의 행 트리거는 이름순이다 — workspace_scope 가 worm 보다 먼저 돈다
create trigger command_receipts_workspace_scope before insert or update of project_id, workspace_id on public.command_receipts
  for each row execute function public.workspace_scope_from_project();
create function public.command_receipts_reject_mutation() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  -- 프로젝트(또는 워크스페이스)를 지우는 문장의 캐스케이드에서는 그 부모가 이미 보이지 않는다. project_id 는 wbs_import 에서 늘 있지만(check)
  -- 프로젝트 없는 종류가 생기면 null 이다 — null 을 먼저 거른다(선례 authz_events_reject_mutation)
  if tg_op = 'DELETE'
     and (not exists (select 1 from public.workspaces w where w.id = old.workspace_id)
          or (old.project_id is not null and not exists (select 1 from public.projects p where p.id = old.project_id))) then
    return old;
  end if;
  raise exception using errcode = '55000', message = 'HISTORY_IMMUTABLE';
end $$;
create trigger command_receipts_worm before update or delete on public.command_receipts
  for each row execute function public.command_receipts_reject_mutation();
create trigger command_receipts_no_truncate before truncate on public.command_receipts
  for each statement execute function public.history_reject_truncate();

-- ③ 옛 가져오기 함수 둘 — 0009 본문(0009_sp2_isolation_fixes.sql:129-259)에서 표 이름 다섯(wbs_items·teams·projects·item_owners·holidays)만
--    public. 으로 한정한다(D34). search_path '' 인 DEFINER(④)가 부르면 안쪽 INVOKER 함수도 그 search_path 로 돌아 한정 안 된 이름이 42P01 이다.
--    INVOKER·search_path 미지정·ACL(authenticated 실행권 — workspace-isolation-cases ⓚ)은 그대로. 본문의 나머지는 0009 바이트 그대로
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

    insert into public.wbs_items (
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
      select id into v_team from public.teams
       where code = v_owner->>'team'
         and (project_id = p_project_id
              or (project_id is null
                  and workspace_id = (select p.workspace_id from public.projects p where p.id = p_project_id)))
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into public.item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into public.holidays (project_id, date, name)
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

    insert into public.wbs_items (
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
      select id into v_team from public.teams
       where code = v_owner->>'team'
         and (project_id = p_project_id
              or (project_id is null
                  and workspace_id = (select p.workspace_id from public.projects p where p.id = p_project_id)))
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into public.item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into public.holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$function$;

-- ④ 가져오기 명령 RPC(D17·D34) — 가져오기와 원장 기록이 한 트랜잭션이다(원장을 따로 쓰면 커밋과 기록 사이의 끊김에서 재시도가 두 벌을
--    만든다). 순서(스펙 §3.1): null 확인(잠금보다 먼저 — null 키는 잠그지 않는다) → 입력 모양 → 명령 잠금 → 격리 가드 → 등급 → 원장 조회 →
--    프로젝트 잠금(같은 프로젝트의 가져오기·전환 직렬화) → 쓰기 → 원장 기록. 요약은 RPC 가 인자에서 만든다 — 호출자가 넘긴 요약을 믿지
--    않는다. jsonb 텍스트는 키 순서가 정규화되고 tempId 는 결정적이라 같은 파일·양식이면 같은 요약이다. 휴일 null 과 [] 는 같은 요약
create function public.import_wbs_cmd(
  p_actor uuid, p_project_id uuid, p_mode text, p_items jsonb, p_holidays jsonb, p_command_id uuid)
returns jsonb language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_ws uuid;
  v_digest text;
  v_dup record;
  v_count integer;
  v_result jsonb;
begin
  if p_actor is null or p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if p_project_id is null or p_mode is null or p_mode not in ('append', 'replace')
     or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
     or (p_holidays is not null and pg_catalog.jsonb_typeof(p_holidays) is distinct from 'array') then
    raise exception using errcode = '22023', message = 'IMPORT_INVALID_INPUT';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('import-receipt:' || p_actor::text || ':' || p_command_id::text, 0));
  -- 격리 수준 규칙(H2 ③): 잠금 뒤 원장을 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 명령의 영수증 — 못 보면 한 번 더 적용된다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'IMPORT_RECEIPT_ISOLATION';
  end if;
  select p.workspace_id into v_ws from public.projects p where p.id = p_project_id;
  if v_ws is null then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'IMPORT_FORBIDDEN';
  end if;
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'project', p_project_id, 'mode', p_mode, 'items', p_items, 'holidays', coalesce(p_holidays, '[]'::jsonb))::text, 'UTF8')), 'hex');
  -- 같은 (행위자, 명령 id) — 요약이 같으면 저장한 결과, 다르면 거부(다른 프로젝트에 같은 id 를 쓴 경우 포함 — 요약에 프로젝트가 든다, D5)
  select r.command_digest, r.result into v_dup from public.command_receipts r
   where r.actor = p_actor and r.command_id = p_command_id and r.kind = 'wbs_import';
  if found then
    if v_dup.command_digest is distinct from v_digest then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return v_dup.result || pg_catalog.jsonb_build_object('status', 'duplicate');
  end if;
  -- 같은 프로젝트의 가져오기(서로 다른 명령)·전환(⑤)을 줄 세운다 — 두 replace 가 엇갈려 트리가 두 벌이 되지 않게. 명령 → 프로젝트 한 방향
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wbs-import:' || p_project_id::text, 0));
  if p_mode = 'replace' then
    v_count := public.replace_wbs(p_project_id, p_items, p_holidays);
  else
    v_count := public.import_wbs(p_project_id, p_items, p_holidays);
  end if;
  v_result := pg_catalog.jsonb_build_object('status', 'applied', 'mode', p_mode, 'count', v_count, 'command_id', p_command_id);
  insert into public.command_receipts (actor, command_id, kind, workspace_id, project_id, command_digest, result)
  values (p_actor, p_command_id, 'wbs_import', v_ws, p_project_id, v_digest, v_result);
  return v_result;
end $$;

-- ⑤ 상속 공용 팀 전환 RPC(D54) — 전용 팀이 0개인(공용 팀을 상속하는) 프로젝트의 공용 팀을 code·이름·색·순서·progress_visible·활성
--    그대로 전용 팀으로 복사하고, 그 프로젝트 안에서 공용 팀을 가리키던 네 참조를 새 id 로 옮긴다. 복사만 하면 같은 code·다른 id 로
--    갈라져 담당 팀 멤버의 실적 편집이 서버에서 거부된다(D4). 가져오기(409 확인 뒤)가 부른다 — copyGlobalTeams 의 연결은 Phase B(T14).
--    팀을 가리키는 열을 새로 만드는 SP 는 아래 네 갱신과 tests/rls/team-convert.test.ts 의 카탈로그 불변식을 같은 커밋에서 고친다
--    (FK·열 이름 규칙 안에서만 잡힌다 — 스펙 §3.5 T8)
create function public.convert_inherited_teams(p_actor uuid, p_project_id uuid)
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

-- ⑤′ 전용 팀을 가진 프로젝트의 공용 팀 참조 거부(D4·D54 — A1-3 리뷰 M1). 전환 RPC 의 "그 프로젝트 안 공용 팀 참조 0" 은 커밋하는
--    순간에만 맞았다 — 같은 잠금을 잡지 않는 쓰기(영역 RPC 의 'weekly:' 잠금·명단 RPC 의 'authz:' 잠금·세션 RLS 의 item_owners·명단 팀 쓰기·
--    초대 발급)가 전환 뒤에도 공용 팀 id 를 다시 붙여 같은 code·다른 id 분열(D4)을 되살렸다. 기존 범위 가드 넷(0003·0009 — "전용 팀이거나
--    같은 워크스페이스 공용 팀")은 그대로 두고, 이 트리거가 "그 프로젝트에 같은 code 의 전용 팀(비활성 포함)이 있는 공용 팀 거부"를 더한다
--    (23514 TEAM_SCOPE_PROJECT_OWNED — 오래된 폼이 닫힌다). 분열(D4)은 같은 code·다른 id 이고, 전환은 쓰이는 공용 팀을 전부 같은 code 로
--    복사하므로 전환 뒤 공용 팀 참조는 모두 여기 걸린다. "전용 팀이 하나라도 있으면 모든 공용 팀 거부"로 넓히지 않은 것은 전용 팀과 다른
--    code 의 공용 팀을 함께 쓰는 프로젝트를 DB 가 지금 허용하고 그 계약을 무수정 불변식(workspace-isolation-cases ⓚ 의 대조 — A 프로젝트
--    항목에 공용 SHR 담당)이 고정하기 때문이다("전용 팀이 있으면 공용 제외"의 표시 규칙은 앱 계층 그대로 — 0003).
--    새로 생기는 참조만 본다(A1-4 리뷰 P1): INSERT 는 같은 키의 행이 이미 있으면(명단·영역 RPC 의 on conflict 재저장 — PostgreSQL 은
--    충돌로 갈 행에도 BEFORE INSERT 트리거를 돌린다), UPDATE 는 팀·부모 열이 그대로면, 초대는 옛 team_ids 에 있던 id 는 통과한다 —
--    갈라진(D4) 프로젝트의 기존 참조를 다시 저장하는 쓰기(명단 권한 회수·비활성화, 영역 이름 바꾸기)가 막히면 권한이 남는다.
--    기존 분열은 지금보다 나빠지지 않고(전환이 옮기지 않은 것과 같은 상태), 전환 뒤 공용 팀을 "다시 붙이기"는 여전히 닫힌다.
--    동시 실행 창: 이 트리거는 새 공용 팀 참조를 쓸 때만 프로젝트 행을 for key share 로, 전환은 for update 로 읽는다(⑤). key share 는
--    for update 와만 충돌하고 프로젝트 행의 일반 갱신(이름·기준일 — no key update)과는 서로 막지 않는다(A1-4 리뷰 P2).
--    교착: 참조 행을 먼저 잠근 쓰기(delete → insert)가 전환과 엇갈리면 한쪽이 40P01(⑤ 머리 주석).
--    기존 가드 본문을 고치지 않고 트리거를 따로 둔 것은 롤백이 drop 만으로 끝나게 하려는 것이다.
--    열이 바뀔 때만 돈다 — 팀·부모 열을 건드리지 않는 갱신(초대 수락의 redeemed_* 등)은 옛 행을 다시 판정하지 않는다.
--    한계: 전용 팀을 새로 만드는 쓰기(팀 추가 액션)는 이 잠금을 잡지 않는다 — 전환의 전제 판독과 엇갈리면 23505(같은 code)가 날 수 있다
create function public.team_ref_owned_scope() returns trigger
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
create trigger item_owners_owned_scope before insert or update of team_id, wbs_item_id on public.item_owners
  for each row execute function public.team_ref_owned_scope();
create trigger project_member_teams_owned_scope before insert or update of team_id, member_id on public.project_member_teams
  for each row execute function public.team_ref_owned_scope();
create trigger area_teams_owned_scope before insert or update of team_id, area_id on public.area_teams
  for each row execute function public.team_ref_owned_scope();
create trigger project_invites_owned_scope before insert or update of team_ids, project_id on public.project_invites
  for each row execute function public.team_ref_owned_scope();

-- ⑥ 권한 — 새 함수는 public·anon·authenticated 에서 회수하고 서버 RPC 만 service_role 에 실행권을 준다. 트리거 함수는 revoke 만
--    (service_role 은 기본 권한이 준 대로 둔다 — 스펙 §3.1). authenticated 가 실행하는 새 함수 0 — DEFINER_EXECUTABLE 무수정
revoke all on function public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid), public.convert_inherited_teams(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid), public.convert_inherited_teams(uuid, uuid)
  to service_role;
revoke all on function public.command_receipts_reject_mutation(), public.team_ref_owned_scope() from public, anon, authenticated;

-- ⑦ 사후검사 — COMMAND_RECEIPTS_POSTCHECK. 읽기만 한다(롤백 절 없음)
do $$
declare
  v text;
begin
  -- RLS 켜짐, 정책은 읽기(SELECT) 하나
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.command_receipts'::regclass)
     or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'command_receipts') <> 1
     or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'command_receipts' and p.cmd <> 'SELECT') then
    raise exception 'COMMAND_RECEIPTS_POSTCHECK: RLS·정책이 기대와 다르다';
  end if;

  -- anon 은 아무 권한도 없고 authenticated 는 SELECT 뿐(열 권한 포함 — PUBLIC·상속도 실효 권한으로 잡힌다)
  select string_agg(format('%s:%s', r.role, p.priv), ', ' order by r.role, p.priv) into v
    from unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p(priv)
   where (has_table_privilege(r.role, 'public.command_receipts'::regclass, p.priv)
          or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
              and has_any_column_privilege(r.role, 'public.command_receipts'::regclass, p.priv)))
     and not (r.role = 'authenticated' and p.priv = 'SELECT');
  if v is not null then raise exception 'COMMAND_RECEIPTS_POSTCHECK: 표 권한이 남았다: %', v; end if;

  -- 권한은 있는데 그 명령(또는 ALL)의 정책이 없는 DML — 0 이어야 한다(0011 ⑪ 과 같은 쿼리)
  select string_agg(format('%s:%s', t.relname, cmd.cmd), ', ') into v
    from pg_class t cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as cmd(cmd)
   where t.relnamespace = 'public'::regnamespace and t.relkind in ('r', 'p')
     and (case when cmd.cmd = 'DELETE' then has_table_privilege('authenticated', t.oid, 'DELETE')
               else has_any_column_privilege('authenticated', t.oid, cmd.cmd) end)
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                      and p.cmd in (cmd.cmd, 'ALL') and p.roles && array['authenticated', 'public']::name[]);
  if v is not null then raise exception 'COMMAND_RECEIPTS_POSTCHECK: 정책 없는 DML 권한: %', left(v, 800); end if;

  -- 트리거 셋 존재·활성(꺼짐 D, 복제 세션 전용 R 은 실패)
  select string_agg(x.name, ', ') into v
    from (values ('command_receipts_workspace_scope'), ('command_receipts_worm'), ('command_receipts_no_truncate')) as x(name)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = 'public.command_receipts'::regclass and g.tgname = x.name
                        and not g.tgisinternal and g.tgenabled in ('O', 'A'));
  if v is not null then raise exception 'COMMAND_RECEIPTS_POSTCHECK: 트리거가 없다: %', v; end if;

  -- wbs_import 영수증은 늘 프로젝트를 가진다(Q14), FK 둘은 캐스케이드
  if not exists (select 1 from pg_constraint k where k.conrelid = 'public.command_receipts'::regclass
                  and k.conname = 'command_receipts_project_required' and k.contype = 'c') then
    raise exception 'COMMAND_RECEIPTS_POSTCHECK: check command_receipts_project_required 가 없다';
  end if;
  if (select count(*) from pg_constraint k where k.conrelid = 'public.command_receipts'::regclass and k.contype = 'f'
        and k.confdeltype = 'c' and k.confrelid in ('public.workspaces'::regclass, 'public.projects'::regclass)) <> 2 then
    raise exception 'COMMAND_RECEIPTS_POSTCHECK: FK 둘이 on delete cascade 가 아니다';
  end if;

  -- 이 파일이 만든 함수의 EXECUTE 기대표(실효 권한, 0012 ⑫ 꼴) — anon·authenticated 는 전부 false, service_role 은 서버 RPC 만 본다
  select string_agg(format('%s:%s=%s', e.fn, e.role, not e.want), ', ') into v
    from (
      select f.fn, r.role, (r.role = 'service_role' and f.service) as want
        from (values
          ('public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid)', true),
          ('public.convert_inherited_teams(uuid, uuid)', true),
          ('public.command_receipts_reject_mutation()', false),
          ('public.team_ref_owned_scope()', false)) as f(fn, service)
       cross join unnest(array['anon', 'authenticated', 'service_role']) as r(role)) e
   where has_function_privilege(e.role, e.fn::regprocedure, 'EXECUTE') is distinct from e.want
     and not (e.role = 'service_role' and not e.want);   -- 트리거 함수의 service_role 은 기본 권한이 준 대로 둔다(§3.1)
  if v is not null then raise exception 'COMMAND_RECEIPTS_POSTCHECK: 함수 EXECUTE 가 기대와 다르다: %', v; end if;

  -- 잠금 뒤 다른 행을 읽는 두 RPC — 격리 검사 문자열·토큰, DEFINER, 잠금 대기 상한
  select string_agg(x.fn, ', ') into v
    from (values
      ('public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid)', 'IMPORT_RECEIPT_ISOLATION'),
      ('public.convert_inherited_teams(uuid, uuid)', 'TEAM_CONVERT_ISOLATION')) as x(fn, token)
    join pg_proc p on p.oid = x.fn::regprocedure
   where position('if pg_catalog.current_setting(''transaction_isolation'') is distinct from ''read committed'' then' in p.prosrc) = 0
      or position(x.token in p.prosrc) = 0
      or not p.prosecdef
      or not coalesce('lock_timeout=15s' = any(p.proconfig), false);
  if v is not null then raise exception 'COMMAND_RECEIPTS_POSTCHECK: 격리 검사·DEFINER·잠금 대기 상한이 없다: %', v; end if;

  -- ⑤′ 공용 팀 참조 거부 트리거 넷 존재·활성, 함수는 DEFINER·search_path '', 전환은 프로젝트 행을 for update 로 잡는다(동시 실행 창)
  select string_agg(format('%s.%s', x.tbl, x.name), ', ') into v
    from (values ('item_owners', 'item_owners_owned_scope'), ('project_member_teams', 'project_member_teams_owned_scope'),
                 ('area_teams', 'area_teams_owned_scope'), ('project_invites', 'project_invites_owned_scope')) as x(tbl, name)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = ('public.' || x.tbl)::regclass and g.tgname = x.name
                        and g.tgfoid = 'public.team_ref_owned_scope()'::regprocedure
                        and not g.tgisinternal and g.tgenabled in ('O', 'A'));
  if v is not null then raise exception 'COMMAND_RECEIPTS_POSTCHECK: 공용 팀 참조 거부 트리거가 없다: %', v; end if;
  if not (select p.prosecdef and coalesce('search_path=""' = any(p.proconfig), false)
            and position('TEAM_SCOPE_PROJECT_OWNED' in p.prosrc) > 0 and position('for key share' in p.prosrc) > 0
            from pg_proc p where p.oid = 'public.team_ref_owned_scope()'::regprocedure)
     or position('where p.id = p_project_id for update' in
          (select p.prosrc from pg_proc p where p.oid = 'public.convert_inherited_teams(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'COMMAND_RECEIPTS_POSTCHECK: 공용 팀 참조 거부의 잠금 짝(for key share / for update)이 기대와 다르다';
  end if;

  -- ③ 옛 두 함수 — 표 이름이 전부 public. 한정, INVOKER·search_path 미지정, authenticated 실행권 유지(ⓚ)
  select string_agg(x.fn, ', ') into v
    from (values ('public.import_wbs(uuid, jsonb, jsonb)'), ('public.replace_wbs(uuid, jsonb, jsonb)')) as x(fn)
    join pg_proc p on p.oid = x.fn::regprocedure
   where p.prosrc ~ '(^|[^.[:alnum:]_])(wbs_items|teams|projects|item_owners|holidays)([^[:alnum:]_]|$)'
      or p.prosecdef or p.proconfig is not null
      or not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v is not null then raise exception 'COMMAND_RECEIPTS_POSTCHECK: 옛 가져오기 함수가 기대와 다르다: %', v; end if;
end $$;
