-- NNNN_team_scope_lock_order — 공용 팀 참조 거부 트리거(*_command_receipts ⑤′ team_ref_owned_scope)의 판정 순서를 고친다(SP4 A1 최종 리뷰
-- 보안 P2 — A2 의 이월 수정 Z1). 정본: docs/superpowers/specs/2026-10-01-sp4-weekly-teams-design.md §3.3(D4·D54). 번호를 참조하지 않는다.
-- 왜: 옛 본문은 INSERT 의 "같은 키 행이 이미 있으면 통과"(명단·영역 RPC 의 on conflict 재저장 — A1-4 리뷰 P1)를 프로젝트 행 잠금(for key share)
--   **앞**에 두었다. 전환(convert_inherited_teams — 프로젝트 행 for update)이 참조를 UPDATE 로 옮긴 뒤·커밋 전에 같은 키를 다시 넣는 쓰기는
--   전환 전 스냅숏의 옛 행을 보고 통과하고, 잠금을 잡지 않은 채 유일 검사에서 전환 커밋을 기다렸다가 — 옛 행은 새 키(전용 팀)로 옮겨 갔으므로 —
--   공용 팀 참조를 새로 넣었다(같은 명단 행·영역에 공용·전용 같은 code 의 D4 분열). BEFORE ROW 트리거는 충돌 재검사 루프 밖이라 다시 돌지 않는다.
-- 무엇: 공용 팀을 가리키는 쓰기면 **먼저** 프로젝트 행을 for key share 로 잡고, 그다음 문장(read committed — 새 스냅숏)에서 "이미 있는 키" 면제를
--   본다. 전환이 커밋됐으면 옛 행이 없어 면제되지 않고 TEAM_SCOPE_PROJECT_OWNED 로 간다. 갈라진(D4) 프로젝트의 기존 참조 재저장은 잠금 뒤에도
--   행이 있어 그대로 통과한다. UPDATE 면제(팀·부모 열이 그대로)는 잠금 앞 그대로 둔다 — 행 잠금 대기 뒤 EPQ 로 OLD 가 전환된 행이 되어 면제가
--   깨지므로 같은 구멍이 없다. 나머지(오류 코드·토큰·대상 표 넷·초대 분기)는 원문 그대로다. 트리거 넷·ACL 은 create or replace 가 그대로 둔다.
-- 롤백: supabase/rollbacks/*_team_scope_lock_order_rollback.sql(옛 본문 원문). 이 파일은 함수 하나만 바꾸고 표·권한을 만들지 않는다.

-- ① team_ref_owned_scope — 잠금 먼저, 그다음 "이미 있는 키" 면제
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

-- ② 사후검사 — TEAM_SCOPE_LOCK_ORDER_POSTCHECK. 읽기만 한다(롤백 절 없음)
do $$
declare
  v_src text;
  v_lock int;
  v text;
begin
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.team_ref_owned_scope()'::regprocedure;
  v_lock := position('for key share' in v_src);
  if v_lock = 0 then raise exception 'TEAM_SCOPE_LOCK_ORDER_POSTCHECK: 프로젝트 행 잠금(for key share)이 없다'; end if;
  -- 잠금 순서 — 세 표의 "이미 있는 키" 면제가 모두 잠금 뒤에 있다
  select string_agg(n.needle, ', ') into v
    from unnest(array['from public.item_owners x', 'from public.project_member_teams x', 'from public.area_teams x']) as n(needle)
   where position(n.needle in v_src) = 0 or position(n.needle in v_src) < v_lock;
  if v is not null then raise exception 'TEAM_SCOPE_LOCK_ORDER_POSTCHECK: 잠금 앞에서 판정하는 면제가 있다: %', v; end if;
  if position('TEAM_SCOPE_PROJECT_OWNED' in v_src) < v_lock then
    raise exception 'TEAM_SCOPE_LOCK_ORDER_POSTCHECK: 거부 판정이 잠금 앞에 있다';
  end if;
  -- DEFINER·search_path·EXECUTE(트리거 함수 — public·anon·authenticated 회수 그대로)
  if not exists (select 1 from pg_proc p where p.oid = 'public.team_ref_owned_scope()'::regprocedure
                  and p.prosecdef and coalesce('search_path=""' = any (p.proconfig), false)) then
    raise exception 'TEAM_SCOPE_LOCK_ORDER_POSTCHECK: DEFINER·search_path 가 기대와 다르다';
  end if;
  if has_function_privilege('anon', 'public.team_ref_owned_scope()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.team_ref_owned_scope()', 'EXECUTE') then
    raise exception 'TEAM_SCOPE_LOCK_ORDER_POSTCHECK: 세션 역할이 트리거 함수를 실행한다';
  end if;
  -- 트리거 넷이 이 함수에 그대로 붙어 있다
  select string_agg(x.tbl || '.' || x.name, ', ') into v
    from (values ('item_owners', 'item_owners_owned_scope'), ('project_member_teams', 'project_member_teams_owned_scope'),
                 ('area_teams', 'area_teams_owned_scope'), ('project_invites', 'project_invites_owned_scope')) as x(tbl, name)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = ('public.' || x.tbl)::regclass and g.tgname = x.name and not g.tgisinternal
                        and g.tgenabled in ('O', 'A') and g.tgfoid = 'public.team_ref_owned_scope()'::regprocedure);
  if v is not null then raise exception 'TEAM_SCOPE_LOCK_ORDER_POSTCHECK: 트리거가 없다: %', v; end if;
end $$;
