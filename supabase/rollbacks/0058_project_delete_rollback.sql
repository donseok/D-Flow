-- 0058 롤백 — 프로젝트 삭제 RPC 와 그 도우미 둘을 지우고, 연동 토큰 가드를 0035 본문으로, authz_events 의 kind·scope check 를 0053 꼴로 되돌린다.
-- 앱이 delete_project·project_delete_summary 를 부르는 동안 지우면 프로젝트 설정의 "위험 구역"이 실패하므로 앱을 먼저 되돌린다.
-- 되돌리지 않는 데이터: 이미 지운 프로젝트와 딸린 행(되돌릴 수 없다 — 백업에서만 복원한다), 그때 토큰에서 뗀 프로젝트·팀 참조, 남긴 project_deleted 기록.
-- 기록은 지울 수 없다(authz_events 는 UPDATE·DELETE 가 막힌 표다). project_deleted 행이 남아 있으면 두 check 를 NOT VALID 로 되돌린다 —
-- 새 행에는 0053 규칙이 그대로 걸리고(project_deleted 를 다시 쓰지 못한다) 남은 행은 검사하지 않는다. 옛 앱의 이력 화면은 그 행을
-- "변경 내용을 읽지 못했습니다" 로 보인다.
-- 세션의 projects DELETE 권한과 정책 wsadmin_delete_projects(0003)도 되돌린다 — 워크스페이스 관리자의 세션이 다시 직접 지울 수 있게 된다
-- (이름 대조·기록·회의록 보호 없음. 앱은 그 길을 쓰지 않는다).
-- 가드를 되돌리면 닫힌 토큰의 참조 좁히기 갈래가 사라진다 — 소유자가 떠난 닫힌 토큰은 다시 어떤 갱신도 못 한다(0035 의 동작).
begin;

drop function if exists public.delete_project(uuid, uuid, text);
drop function if exists public.project_delete_summary(uuid);
drop function if exists public.project_delete_unknown_references();

drop policy if exists wsadmin_delete_projects on public.projects;
create policy wsadmin_delete_projects on public.projects for delete to authenticated using (public.is_ws_admin(workspace_id));
grant delete on public.projects to authenticated;

create or replace function public.integration_credentials_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_pid uuid;
  v_t_ws uuid;
  v_t_pid uuid;
  v_team_id_txt text;
  v_team_id uuid;
begin
  -- 소속 회수 후에도 자기 토큰을 닫을 수 있다. 구조/해시/만료를 바꾸는 우회는 허용하지 않는다.
  if tg_op = 'UPDATE' and new.enabled = false and new.revoked_at is not null
     and (to_jsonb(new) - 'enabled' - 'revoked_at') = (to_jsonb(old) - 'enabled' - 'revoked_at') then
    return new;
  end if;
  -- 1. kind='agent_runner' 면 default_team_id is null and team_map = '{}'
  if new.kind = 'agent_runner' then
    if new.default_team_id is not null or (new.team_map is distinct from '{}'::jsonb and new.team_map is not null) then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_RUNNER_TEAM_FORBIDDEN';
    end if;
  end if;

  -- 2. owner_user_id is not null 면 workspace_members 소속이어야 한다
  if new.owner_user_id is not null then
    if not exists (
      select 1 from public.workspace_members m
       where m.workspace_id = new.workspace_id
         and m.user_id = new.owner_user_id
    ) then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_OWNER_NOT_MEMBER';
    end if;
  end if;

  -- 3. project_ids 원소들이 모두 workspace_id 의 프로젝트여야 한다
  if new.project_ids is not null then
    foreach v_pid in array new.project_ids loop
      if public.project_ws(v_pid) is distinct from new.workspace_id then
        raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_PROJECT_NOT_IN_WORKSPACE';
      end if;
    end loop;
  end if;

  -- 4. default_project_id 검증: workspace_id 의 프로젝트여야 하고, project_ids 가 null 이거나 그 안에 있어야 한다
  if new.default_project_id is not null then
    if public.project_ws(new.default_project_id) is distinct from new.workspace_id then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_DEFAULT_PROJECT_NOT_IN_WORKSPACE';
    end if;
    if new.project_ids is not null and not (new.default_project_id = any(new.project_ids)) then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_DEFAULT_PROJECT_NOT_IN_ALLOWED';
    end if;
  end if;

  -- 5. default_team_id 검증: teams.workspace_id = workspace_id 이어야 하고, 프로젝트 전용 팀이면 project_ids 범위 안이어야 한다
  if new.default_team_id is not null then
    select t.workspace_id, t.project_id into v_t_ws, v_t_pid
      from public.teams t where t.id = new.default_team_id;
    if v_t_ws is null or v_t_ws is distinct from new.workspace_id then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_DEFAULT_TEAM_NOT_IN_WORKSPACE';
    end if;
    if v_t_pid is not null and (new.project_ids is not null and not (v_t_pid = any(new.project_ids))) then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_DEFAULT_TEAM_PROJECT_NOT_IN_ALLOWED';
    end if;
  end if;

  -- 객체/문자열만 허용한다. JSON null/배열을 문자열로 변환해 해석하지 않는다.
  if pg_catalog.jsonb_typeof(new.team_map) is distinct from 'object' then
    raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_OBJECT_REQUIRED';
  end if;
  if exists (select 1 from pg_catalog.jsonb_each(new.team_map) e where pg_catalog.jsonb_typeof(e.value) is distinct from 'string') then
    raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_STRING_REQUIRED';
  end if;
  -- 6. team_map 검증: jsonb_each_text 로 전개, uuid 형식 검사 후 teams 조회
  if new.team_map is not null and new.team_map is distinct from '{}'::jsonb then
    for v_team_id_txt in select value from pg_catalog.jsonb_each_text(new.team_map) loop
      begin
        v_team_id := v_team_id_txt::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_INVALID_UUID';
      end;
      select t.workspace_id, t.project_id into v_t_ws, v_t_pid
        from public.teams t where t.id = v_team_id;
      if v_t_ws is null or v_t_ws is distinct from new.workspace_id then
        raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_NOT_IN_WORKSPACE';
      end if;
      if v_t_pid is not null and (new.project_ids is not null and not (v_t_pid = any(new.project_ids))) then
        raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_PROJECT_NOT_IN_ALLOWED';
      end if;
    end loop;
  end if;

  return new;
end;
$$;
revoke all on function public.integration_credentials_guard() from public, anon, authenticated;

alter table public.authz_events drop constraint authz_events_kind_check;
alter table public.authz_events drop constraint authz_events_scope_check;
do $$
begin
  if exists (select 1 from public.authz_events e where e.kind = 'project_deleted') then
    raise notice '0058 롤백: project_deleted 기록이 남아 있어 두 check 를 NOT VALID 로 되돌린다';
    alter table public.authz_events add constraint authz_events_kind_check
      check (kind in ('platform_admin', 'workspace_role', 'project_access', 'password_reset')) not valid;
    alter table public.authz_events add constraint authz_events_scope_check check (
         (kind = 'platform_admin' and workspace_id is null and project_id is null)
      or (kind = 'workspace_role' and workspace_id is not null and project_id is null)
      or (kind = 'project_access' and project_id is not null and workspace_id is not null)
      or (kind = 'password_reset' and workspace_id is not null and project_id is null and target_user_id is not null)) not valid;
  else
    alter table public.authz_events add constraint authz_events_kind_check
      check (kind in ('platform_admin', 'workspace_role', 'project_access', 'password_reset'));
    alter table public.authz_events add constraint authz_events_scope_check check (
         (kind = 'platform_admin' and workspace_id is null and project_id is null)
      or (kind = 'workspace_role' and workspace_id is not null and project_id is null)
      or (kind = 'project_access' and project_id is not null and workspace_id is not null)
      or (kind = 'password_reset' and workspace_id is not null and project_id is null and target_user_id is not null));
  end if;
end $$;

commit;
