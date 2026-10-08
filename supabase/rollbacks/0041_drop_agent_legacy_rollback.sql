-- 0041 롤백 — public.agent_projects·public.agent_runners 를 0040 시점 구조(열·기본값·제약·인덱스·FK·RLS·정책·권한)로 되만든다.
-- **데이터는 복원하지 않는다**: 두 표는 빈 채로 돌아온다. 0041 이 지운 등록 행·옛 토큰 행은 백업에서만 되살릴 수 있다.
--   · 에이전트 사용 여부는 프로젝트 설정 modules.enabled 에 그대로 남아 있다(앱은 그것만 읽는다).
--   · 토큰은 integration_credentials 에 남아 있다. 그래서 이어서 0035 를 롤백하면(0041 → … → 0035 순서) 0035 롤백의 대조 검사가
--     자격증명이 하나라도 있는 한 INTEGRATION_CREDENTIALS_ROLLBACK_BLOCKED 로 거절한다 — 빈 agent_runners 로는 손실 없이 돌아갈 수 없다.
-- agent_projects.created_by 의 FK 는 0012 가 바꾼 on delete set null 이다(0012 롤백이 NO ACTION 으로 되돌린다).

begin;

create table public.agent_projects (
    project_id uuid not null,
    enabled boolean default true not null,
    note text,
    created_by uuid,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

create table public.agent_runners (
    id uuid default gen_random_uuid() not null,
    name text not null,
    kind text default 'user_pat'::text not null,
    owner_user_id uuid not null,
    token_prefix text not null,
    token_hash text not null,
    project_id uuid,
    scopes text[] default '{work:read}'::text[] not null,
    enabled boolean default true not null,
    revoked_at timestamp with time zone,
    expires_at timestamp with time zone not null,
    last_seen_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone default now() not null,
    constraint agent_runners_kind_check check ((kind = any (array['user_pat'::text, 'runner'::text])))
);

alter table only public.agent_projects
    add constraint agent_projects_pkey primary key (project_id);
alter table only public.agent_runners
    add constraint agent_runners_owner_user_id_name_key unique (owner_user_id, name);
alter table only public.agent_runners
    add constraint agent_runners_pkey primary key (id);
alter table only public.agent_runners
    add constraint agent_runners_token_prefix_key unique (token_prefix);

create index agent_runners_owner_idx on public.agent_runners using btree (owner_user_id);

alter table only public.agent_projects
    add constraint agent_projects_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table only public.agent_projects
    add constraint agent_projects_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade;
alter table only public.agent_runners
    add constraint agent_runners_created_by_fkey foreign key (created_by) references auth.users(id);
alter table only public.agent_runners
    add constraint agent_runners_owner_user_id_fkey foreign key (owner_user_id) references auth.users(id) on delete cascade;
alter table only public.agent_runners
    add constraint agent_runners_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade;

alter table public.agent_projects enable row level security;
alter table public.agent_runners enable row level security;

create policy read_agent_projects on public.agent_projects for select to authenticated using (public.is_project_member(project_id));

-- 권한 — 새 표는 스키마 기본 권한(anon·authenticated·service_role 전부)을 받는다. 전부 거둔 뒤 0040 시점 것만 다시 준다.
revoke all on table public.agent_projects from public, anon, authenticated, service_role;
revoke all on table public.agent_runners from public, anon, authenticated, service_role;
grant all on table public.agent_projects to service_role;
grant select on table public.agent_projects to authenticated;
grant all on table public.agent_runners to service_role;

-- 사후 검증 (AGENT_LEGACY_DROP_ROLLBACK_POSTCHECK)
do $$
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.agent_projects'::regclass)
     or not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.agent_runners'::regclass) then
    raise exception 'AGENT_LEGACY_DROP_ROLLBACK_POSTCHECK: RLS 가 꺼져 있다' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'agent_projects') <> 1
     or exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'agent_runners') then
    raise exception 'AGENT_LEGACY_DROP_ROLLBACK_POSTCHECK: 정책 수가 0040 시점과 다르다' using errcode = 'P0001';
  end if;
  if has_table_privilege('anon', 'public.agent_projects', 'select') or has_table_privilege('anon', 'public.agent_runners', 'select')
     or has_table_privilege('authenticated', 'public.agent_runners', 'select')
     or has_table_privilege('authenticated', 'public.agent_projects', 'insert, update, delete, truncate, references, trigger')
     or not has_table_privilege('authenticated', 'public.agent_projects', 'select') then
    raise exception 'AGENT_LEGACY_DROP_ROLLBACK_POSTCHECK: 표 권한이 0040 시점과 다르다' using errcode = '42501';
  end if;
end $$;

commit;
