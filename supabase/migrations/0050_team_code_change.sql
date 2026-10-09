-- 0050_team_code_change.sql
-- 팀 코드를 바꿀 수 있게 한다(팀 유연화 2단계 ①).
-- 왜: 팀은 사용자가 정하는 값인데 code 는 만든 뒤 영영 바꿀 수 없었다(0003 teams_guard — TEAM_CODE_IMMUTABLE). 처음 적은 오타·옛 조직 이름이
--   엑셀 팀 열·가져오기·필터에 그대로 남았다. 불변의 이유는 "code 로 해석하는 곳이 따라오지 못한다"였으므로, 따라와야 하는 것을 한 트랜잭션에
--   같이 옮기는 길 하나(change_team_code)에서만 푼다. 그 밖의 UPDATE(세션·service_role 직접)는 지금처럼 TEAM_CODE_IMMUTABLE 이다.
-- 무엇:
--   ① teams_guard — 트랜잭션 로컬 설정값 app.team_code_change 가 그 팀 id 일 때만 code 변경을 통과시킨다(0012 app.authz_purge 와 같은 관용구).
--   ② minutes_team_code_echo — 같은 설정값 아래의 사본 갱신은 code 재해석·비활성 거부 없이 그 팀의 현재 code 를 적는다
--      (재해석에 맡기면 비활성 팀의 회의록에서 MINUTE_TEAM_INVALID 로 코드 변경 전체가 막힌다). 나머지 본문은 0024 그대로다.
--   ③ team_referenced_in_project — 한 프로젝트가 그 팀을 가리키는가(여섯 참조). M1 불변식 판정용 도우미.
--   ④ change_team_code(p_actor, p_team_id, p_code) — DEFINER·service_role 전용. 등급을 RPC 안에서 다시 판정한다
--      (공용 팀 = 워크스페이스 관리자, 전용 팀 = 프로젝트 관리자). 유일성은 유일 키가 최종 판정한다(TEAM_CODE_TAKEN).
--      M1 불변식(0014·0016 team_ref_owned_scope — 프로젝트는 자기 전용 팀과 같은 code 의 공용 팀을 가리키지 않는다)을 지킨다(TEAM_CODE_SCOPE_CONFLICT).
--      minutes.team_code(사본)는 team_id 가 그 팀인 행을 새 code 로 맞춘다.
-- 그대로 두는 것(스냅샷): minute_versions.team_code(작성 시점 기록 — 불변 트리거가 막는다), 세부업무 이름·변경 이력·색인 본문의 옛 code 글자
--   (색인은 앱이 재색인 큐에 넣는다). 엑셀로 내보낸 옛 파일의 팀 열은 옛 code 다 — 화면이 바꾸기 전에 알린다.
-- 버전 복원: 회의록에는 옛 버전의 team_code 를 되쓰는 길이 없다(버전은 내려받기·위키 근거뿐) — 손댈 함수가 없다.
-- 잠금: 전용 팀은 가져오기와 같은 프로젝트 잠금(wbs-import) + 프로젝트 행 FOR UPDATE(전환 RPC 와 같은 순서), 공용 팀은 같은 code 의 전용 팀을
--   가진 프로젝트 행들을 id 순으로 FOR UPDATE — 새 공용 팀 참조를 쓰는 M1 가드(FOR KEY SHARE)와 직렬화한다. 그 뒤 팀 행 FOR UPDATE.

begin;

-- ① code 불변 — 코드 변경 RPC 안에서만 푼다. 설정값이 "그 팀의 id" 여야 하므로 한 번의 허가가 다른 팀 행으로 번지지 않는다
create or replace function public.teams_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is not null and public.project_ws(new.project_id) is distinct from new.workspace_id then
    raise exception using errcode = '23514', message = 'TEAM_CROSS_WORKSPACE';
  end if;
  if tg_op = 'UPDATE' and new.code is distinct from old.code
     and pg_catalog.current_setting('app.team_code_change', true) is distinct from new.id::text then
    raise exception using errcode = '23514', message = 'TEAM_CODE_IMMUTABLE';
  end if;
  return new;
end
$$;

-- ② 메아리 — 맨 앞 분기 하나만 더한다. 그 아래는 0024 본문 그대로다
create or replace function public.minutes_team_code_echo() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_ws uuid;
  v_team uuid;
  v_active boolean;
  v_code text;
begin
  -- 코드 변경 RPC(0050)의 사본 갱신 — 팀은 그대로이고 그 팀의 code 만 바뀌었다. 재해석하지 않고 그 팀의 현재 code 를 적는다(비활성 팀도)
  if tg_op = 'UPDATE' and new.team_id is not null and new.team_id is not distinct from old.team_id
     and pg_catalog.current_setting('app.team_code_change', true) = new.team_id::text then
    select t.code into v_code from public.teams t where t.id = new.team_id;
    new.team_code := coalesce(v_code, new.team_code);
    return new;
  end if;
  v_ws := coalesce((select p.workspace_id from public.projects p where p.id = new.project_id), new.workspace_id);
  if tg_op = 'UPDATE' and new.team_id is distinct from old.team_id then
    if new.team_id is not null then
      select t.code into v_code from public.teams t where t.id = new.team_id;
      new.team_code := coalesce(v_code, new.team_code);
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' and new.team_id is not null then
    select t.code into v_code from public.teams t where t.id = new.team_id;
    new.team_code := coalesce(v_code, new.team_code);
    return new;
  end if;
  if tg_op = 'INSERT' or new.team_code is distinct from old.team_code then
    v_team := public.minute_team_for_code(v_ws, new.project_id, new.team_code);
    if v_team is not null then
      select t.active into v_active from public.teams t where t.id = v_team;
      if not v_active then
        raise exception using errcode = '23503', message = 'MINUTE_TEAM_INVALID';
      end if;
    end if;
    new.team_id := v_team;
  elsif new.project_id is distinct from old.project_id or new.workspace_id is distinct from old.workspace_id then
    new.team_id := public.minute_team_for_code(v_ws, new.project_id, new.team_code);
  end if;
  return new;
end $$;

-- ③ 한 프로젝트가 그 팀을 가리키는가 — 전환 RPC(0024)의 복사 대상 판정과 같은 여섯 참조(담당·명단·영역·수락 전 초대·회의록·폴더)
create function public.team_referenced_in_project(p_team_id uuid, p_project_id uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.item_owners io join public.wbs_items w on w.id = io.wbs_item_id
                  where io.team_id = p_team_id and w.project_id = p_project_id)
      or exists (select 1 from public.project_member_teams pmt join public.project_members pm on pm.id = pmt.member_id
                  where pmt.team_id = p_team_id and pm.project_id = p_project_id)
      or exists (select 1 from public.area_teams art join public.project_areas a on a.id = art.area_id
                  where art.team_id = p_team_id and a.project_id = p_project_id)
      or exists (select 1 from public.project_invites i
                  where i.project_id = p_project_id and i.redeemed_at is null and i.revoked_at is null
                    and p_team_id = any(i.team_ids))
      or exists (select 1 from public.minutes m where m.team_id = p_team_id and m.project_id = p_project_id)
      or exists (select 1 from public.minute_folders f where f.team_id = p_team_id and f.project_id = p_project_id)
$$;
revoke all on function public.team_referenced_in_project(uuid, uuid) from public, anon, authenticated;

-- ④ 코드 변경 한 길
create function public.change_team_code(p_actor uuid, p_team_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_code text := pg_catalog.btrim(p_code);
  v_ws uuid;
  v_project uuid;
  v_old text;
  v_minutes integer;
begin
  -- 형식은 표의 check(teams_code_check·teams_code_len_check)와 같은 규칙 — 제약 이름 대신 고정 토큰으로 먼저 거른다
  if p_actor is null or p_team_id is null or v_code is null or v_code = ''
     or pg_catalog.char_length(v_code) > 20 or v_code ~ '[\r\n\t]' then
    raise exception using errcode = '22023', message = 'TEAM_CODE_INVALID';
  end if;
  -- 격리 수준 규칙(H2 ③): 잠금 뒤 참조를 읽어 판정하므로 read committed 가 아니면 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'TEAM_CODE_CHANGE_ISOLATION';
  end if;
  -- 범위는 잠금 없이 먼저 읽는다(프로젝트 → 팀 순으로 잠그려면 프로젝트를 알아야 한다). 팀의 범위(project_id·workspace_id)는 바뀌지 않는다
  select t.workspace_id, t.project_id into v_ws, v_project from public.teams t where t.id = p_team_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'TEAM_NOT_FOUND';
  end if;
  if v_project is not null then
    -- 가져오기·전환과 같은 프로젝트 잠금 — 가져오기가 code 로 팀을 찾는 동안 code 가 바뀌지 않게, 새 공용 팀 참조(M1 가드)와 엇갈리지 않게
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wbs-import:' || v_project::text, 0));
    perform 1 from public.projects p where p.id = v_project for update;
  else
    -- 공용 팀: 새 code 와 같은 code 의 전용 팀을 가진 프로젝트만 M1 충돌이 날 수 있다 — 그 프로젝트 행들을 id 순으로 잡는다
    perform 1 from public.projects p
     where p.workspace_id = v_ws
       and exists (select 1 from public.teams o where o.project_id = p.id and o.code = v_code)
     order by p.id for update;
  end if;
  select t.code into v_old from public.teams t where t.id = p_team_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'TEAM_NOT_FOUND';
  end if;
  -- 등급 재판정(액션 가드와 두 관문) — 공용 팀은 워크스페이스 관리자, 전용 팀은 그 프로젝트의 관리자
  if not (case when v_project is null then public.actor_is_workspace_admin(p_actor, v_ws)
               else public.actor_is_project_admin(p_actor, v_project) end) then
    raise exception using errcode = '42501', message = 'TEAM_CODE_CHANGE_FORBIDDEN';
  end if;
  if v_old = v_code then
    return pg_catalog.jsonb_build_object('status', 'unchanged', 'code', v_old);
  end if;
  -- M1 불변식: 프로젝트는 자기 전용 팀과 같은 code 의 공용 팀을 가리키지 않는다(가리키면 담당·명단이 같은 code 의 두 팀으로 갈라진다)
  if v_project is not null then
    if exists (select 1 from public.teams c
                where c.workspace_id = v_ws and c.project_id is null and c.code = v_code
                  and public.team_referenced_in_project(c.id, v_project)) then
      raise exception using errcode = '23514', message = 'TEAM_CODE_SCOPE_CONFLICT';
    end if;
  else
    if exists (select 1 from public.teams o
                where o.workspace_id = v_ws and o.project_id is not null and o.code = v_code
                  and public.team_referenced_in_project(p_team_id, o.project_id)) then
      raise exception using errcode = '23514', message = 'TEAM_CODE_SCOPE_CONFLICT';
    end if;
  end if;
  -- 이 팀 행에 한해 불변을 푼다. 설정값은 트랜잭션 로컬이고 끝나면 비운다(같은 트랜잭션의 뒤 문장으로 번지지 않게)
  perform pg_catalog.set_config('app.team_code_change', p_team_id::text, true);
  begin
    update public.teams t set code = v_code where t.id = p_team_id;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'TEAM_CODE_TAKEN';
  end;
  -- 회의록의 사본 열 — team_id 가 이 팀인 행만. 메아리 트리거가 같은 설정값을 보고 재해석 없이 받는다.
  -- minute_versions.team_code 는 작성 시점 스냅샷이라 그대로 둔다(불변 표). updated_at 도 건드리지 않는다(사용자가 고친 것이 아니다)
  update public.minutes m set team_code = v_code where m.team_id = p_team_id and m.team_code is distinct from v_code;
  get diagnostics v_minutes = row_count;
  perform pg_catalog.set_config('app.team_code_change', '', true);
  return pg_catalog.jsonb_build_object('status', 'changed', 'old_code', v_old, 'code', v_code, 'minutes', v_minutes);
end $$;
revoke all on function public.change_team_code(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.change_team_code(uuid, uuid, text) to service_role;

-- 사후검사 TEAM_CODE_CHANGE_POSTCHECK — 읽기만 한다
do $$
declare
  v text;
begin
  select string_agg(f, ', ') into v from unnest(array[
    'public.change_team_code(uuid, uuid, text)', 'public.team_referenced_in_project(uuid, uuid)',
    'public.teams_guard()', 'public.minutes_team_code_echo()']) as f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE');
  if v is not null then raise exception 'TEAM_CODE_CHANGE_POSTCHECK: 세션 역할이 실행할 수 있다: %', v; end if;
  if not has_function_privilege('service_role', 'public.change_team_code(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'TEAM_CODE_CHANGE_POSTCHECK: service_role 이 RPC 를 실행하지 못한다';
  end if;
  -- 가드가 불변 토큰과 허가 설정값을 둘 다 지녔다(허가만 남고 거부가 빠지면 code 가 아무 길로나 바뀐다)
  select string_agg(n, ', ') into v from unnest(array['TEAM_CODE_IMMUTABLE', 'app.team_code_change', 'TEAM_CROSS_WORKSPACE'])
    as n where position(n in (select p.prosrc from pg_proc p where p.oid = 'public.teams_guard()'::regprocedure)) = 0;
  if v is not null then raise exception 'TEAM_CODE_CHANGE_POSTCHECK: teams_guard 에 없다: %', v; end if;
  select string_agg(n, ', ') into v from unnest(array['MINUTE_TEAM_INVALID', 'app.team_code_change', 'minute_team_for_code'])
    as n where position(n in (select p.prosrc from pg_proc p where p.oid = 'public.minutes_team_code_echo()'::regprocedure)) = 0;
  if v is not null then raise exception 'TEAM_CODE_CHANGE_POSTCHECK: 메아리 트리거에 없다: %', v; end if;
end $$;

commit;
