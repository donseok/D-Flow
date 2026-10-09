-- 0050 롤백 — 팀 코드 변경 RPC 와 도우미를 지우고, 가드·메아리 트리거 함수를 옛 본문(0003·0024)으로 되돌린다.
-- 앱이 change_team_code 를 부르는 동안 지우면 "코드 바꾸기"가 실패하므로 앱을 먼저 되돌린다.
-- 되돌리지 않는 데이터: 이미 바꾼 팀 code 와 그에 맞춘 minutes.team_code(옛 code 는 어디에도 남기지 않았다 — minute_versions 의 스냅샷만 옛 값이다).
-- 뒤 번호(병합·팀 없는 회의록)가 적용돼 있으면 그쪽 롤백을 먼저 돌린다 — 그 마이그레이션들이 같은 메아리 함수를 다시 정의한다.
begin;

drop function if exists public.change_team_code(uuid, uuid, text);
drop function if exists public.team_referenced_in_project(uuid, uuid);

-- 0003 본문
create or replace function public.teams_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is not null and public.project_ws(new.project_id) is distinct from new.workspace_id then
    raise exception using errcode = '23514', message = 'TEAM_CROSS_WORKSPACE';
  end if;
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception using errcode = '23514', message = 'TEAM_CODE_IMMUTABLE';
  end if;
  return new;
end
$$;

-- 0024 본문
create or replace function public.minutes_team_code_echo() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_ws uuid;
  v_team uuid;
  v_active boolean;
  v_code text;
begin
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

commit;
