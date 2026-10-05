-- SP7: 자격증명 저장소 및 결정적인 PAT 이관. 기존 표는 소비처 전환·롤백을 위해 보존한다.

-- 1. integration_credentials 테이블 생성
create table public.integration_credentials (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  kind               text not null check (kind in ('minutes_api','agent_runner')),
  name               text not null,
  token_prefix       text not null unique,
  token_hash         text not null,
  scopes             text[] not null default '{}',
  project_ids        uuid[],
  default_project_id uuid references public.projects(id) on delete set null,
  default_team_id    uuid references public.teams(id) on delete set null,
  team_map           jsonb not null default '{}',
  owner_user_id      uuid references auth.users(id) on delete cascade,
  enabled            boolean not null default true,
  revoked_at         timestamptz,
  expires_at         timestamptz not null,
  last_used_at       timestamptz,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint integration_credentials_kind_owner check ((kind = 'agent_runner') = (owner_user_id is not null)),
  constraint integration_credentials_minutes_scopes check (kind <> 'minutes_api' or scopes = '{}'),
  constraint integration_credentials_runner_scopes check (kind <> 'agent_runner' or (array_position(scopes, null) is null and scopes <@ array['work:read','work:claim','work:report']::text[])),
  constraint integration_credentials_hash check (token_hash ~ '^[0-9a-fA-F]{64}$'),
  constraint integration_credentials_prefix check (token_prefix ~ '^[A-Za-z0-9]{12}$'),
  constraint integration_credentials_name check (length(btrim(name)) between 1 and 64),
  constraint integration_credentials_project_array check (project_ids is null or (coalesce(array_ndims(project_ids),1) = 1 and array_position(project_ids, null) is null))
);

create unique index integration_credentials_runner_name_uq
  on public.integration_credentials (workspace_id, owner_user_id, name) where kind = 'agent_runner';
create unique index integration_credentials_minutes_name_uq
  on public.integration_credentials (workspace_id, name) where kind = 'minutes_api';
create index integration_credentials_owner_idx
  on public.integration_credentials (owner_user_id) where owner_user_id is not null;

-- 2. 워크스페이스 소속 일치 검증 트리거
create or replace function public.integration_credentials_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
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

create trigger integration_credentials_guard
  before insert or update on public.integration_credentials
  for each row execute function public.integration_credentials_guard();


-- 정책 0개, 세션의 SELECT를 포함한 모든 직접 접근을 닫는다.
alter table public.integration_credentials enable row level security;
revoke all on table public.integration_credentials from public, anon, authenticated;
grant all on table public.integration_credentials to service_role;

-- 활성·미회수·미만료 토큰은 범위를 임의로 고르지 않는다.
-- 프로젝트 없는 PAT 소유자가 여러 워크스페이스에 속하면 회전/범위 선택 후 다시 적용해야 한다.
do $$
begin
  if exists (
    select 1 from public.agent_runners r
    where r.enabled and r.revoked_at is null and r.expires_at > now()
      and ((r.project_id is null and (select count(*) from public.workspace_members m where m.user_id = r.owner_user_id) <> 1)
        or (r.project_id is not null and not exists (select 1 from public.workspace_members m
          where m.user_id = r.owner_user_id and m.workspace_id = public.project_ws(r.project_id))))
  ) then
    raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_WORKSPACE_SELECTION_REQUIRED';
  end if;
end $$;

-- 프로젝트 한정은 그 프로젝트의 WS, 미지정은 현재 소속이 정확히 하나인 경우만 이관한다.
-- 소속을 이미 잃은 토큰은 원래 표에 보존한다. 새 자격증명에는 현재 소속이 없는 소유자를 넣지 않는다.
insert into public.integration_credentials (
  id, workspace_id, kind, name, token_prefix, token_hash, scopes, project_ids, default_project_id,
  owner_user_id, enabled, revoked_at, expires_at, last_used_at, created_by, created_at
)
select r.id, w.workspace_id, 'agent_runner', r.name, r.token_prefix, r.token_hash, r.scopes,
       case when r.project_id is null then null else array[r.project_id] end, r.project_id,
       r.owner_user_id, r.enabled, r.revoked_at, r.expires_at, r.last_seen_at, r.created_by, r.created_at
from public.agent_runners r
join lateral (
  select m.workspace_id from public.workspace_members m
  where m.user_id = r.owner_user_id
    and (case when r.project_id is null then
      (select count(*) from public.workspace_members x where x.user_id = r.owner_user_id) = 1
      else m.workspace_id = public.project_ws(r.project_id) end)
) w on true;

-- 기존 agent_runners/agent_projects를 삭제·수정하지 않으므로 원본 토큰/등록 정보는 그대로 남는다.
do $$
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.integration_credentials'::regclass) then
    raise exception 'INTEGRATION_CREDENTIALS_POSTCHECK: RLS';
  end if;
  if exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'integration_credentials') then
    raise exception 'INTEGRATION_CREDENTIALS_POSTCHECK: policies';
  end if;
end $$;

-- 같은 사용자·감시자 이름이 다른 WS의 행을 덮어쓰지 않는다.
alter table public.agent_watchers drop constraint agent_watchers_user_id_agent_key;
alter table public.agent_watchers add constraint agent_watchers_workspace_user_agent_key unique (workspace_id, user_id, agent);
