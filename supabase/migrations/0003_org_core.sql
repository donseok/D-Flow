-- 0003_org_core — 조직 코어(SP1). 정본: docs/superpowers/specs/2026-09-23-generic-platform-design.md §2.3~2.4,
-- SP1 경계: docs/superpowers/specs/2026-09-24-sp1-org-core-design.md §2.
-- 순서: ① 새 표 ② 기존 표 재정의 ③ 헬퍼(새 표 위) ④ 트리거·정책·RPC 교체 ⑤ 폐기.
-- 표를 지우기 전에 그 표를 읽는 함수·정책이 전부 바뀐다.
-- (헬퍼가 재정의 뒤에 오는 이유: sql 함수 본문은 생성 시점에 검사되므로 project_members.person_id·access_role
--  같은 새 컬럼이 먼저 있어야 한다.)
-- 빈 DB 전제 — 기존 행을 새 모델로 옮기는 백필은 없다. 행이 있으면 not null 에서 실패해야 한다.
-- 롤백: supabase/rollbacks/0003_org_core_rollback.sql

-- ① 새 표 ---------------------------------------------------------------

-- 워크스페이스(고객사 1개) — §2.3.1
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- 플랫폼 관리자(배포 운영자) — memberships.is_superuser 대체. §2.3.1
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

-- 앱 소유 계정 표. auth.users 에 트리거를 걸지 않는다(가입 경로를 막지 않기 위해). §2.3.1
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(btrim(email))),
  display_name text not null check (btrim(display_name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 한 계정이 여러 워크스페이스. §2.3.1
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','member')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- 워크스페이스 인물 원장 — 계정 있는 사용자와 외부 인력이 한 표. §2.3.2
create table public.people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (display_name = btrim(display_name) and display_name <> ''),
  email text check (email is null or (email = lower(btrim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  user_id uuid references auth.users(id) on delete set null,
  kind text generated always as (case when user_id is null then 'external' else 'account' end) stored,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index people_ws_email_uidx on public.people (workspace_id, email) where email is not null;
create unique index people_ws_user_uidx on public.people (workspace_id, user_id) where user_id is not null;
create unique index people_id_ws_uidx on public.people (id, workspace_id);
create index people_user_idx on public.people (user_id) where user_id is not null;

-- 한 사람 여러 팀 — 명단 행(프로젝트별)마다. §2.3.4
-- member_id FK 의 대상 project_members(id) 는 기준선부터 있는 PK 라 여기서 바로 건다.
create table public.project_member_teams (
  member_id uuid not null references public.project_members(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  is_primary boolean not null default false,
  primary key (member_id, team_id)
);
create unique index project_member_teams_primary_uidx on public.project_member_teams (member_id) where is_primary;
create index project_member_teams_team_idx on public.project_member_teams (team_id);

-- 담당 영역 — 팀과 별개의 축(주간보고 구분·이슈 영역). §2.3.5
create table public.project_areas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('weekly_section','issue_area')),
  code text not null check (code = btrim(code) and code <> ''),
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create unique index project_areas_project_kind_code_uidx on public.project_areas (project_id, kind, code);
create unique index project_areas_id_project_uidx on public.project_areas (id, project_id);

create table public.area_teams (
  area_id uuid not null references public.project_areas(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  kind text not null check (kind in ('primary','support')),
  primary key (area_id, team_id)
);

-- ② 기존 표 재정의 ----------------------------------------------------------

-- projects — §2.3.3
alter table public.projects add column workspace_id uuid references public.workspaces(id) on delete restrict;
-- 빈 DB 전제(결정 1). 행이 있으면 여기서 실패해야 한다 — 조용히 임의 워크스페이스에 붙이지 않는다.
alter table public.projects alter column workspace_id set not null;
create unique index projects_id_ws_uidx on public.projects (id, workspace_id);
create index projects_ws_idx on public.projects (workspace_id);

-- teams — §2.3.4. color 의 default('#6b7280')는 컨트롤러 결정 — 스펙 표에는 default 가 없지만, color 를 넘기지 않는
-- 기존 팀 생성 경로가 not null 에 걸리지 않게 둔다(화면의 색 배정은 SP3/SP4). code 의 btrim 검사는 스펙 표의 제약이다.
-- 스펙의 teams_project_idx (project_id) 는 기준선의 idx_teams_project 가 같은 인덱스라 새로 만들지 않는다.
alter table public.teams add column workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.teams alter column workspace_id set not null;
alter table public.teams add column color text not null default '#6b7280' check (color ~ '^#[0-9a-fA-F]{6}$');
alter table public.teams add constraint teams_code_check check (code = btrim(code) and code <> '');
alter table public.teams drop constraint teams_project_code_key;
alter table public.teams add constraint teams_ws_project_code_key unique nulls not distinct (workspace_id, project_id, code);
create unique index teams_id_ws_uidx on public.teams (id, workspace_id);

-- project_members — 명단과 권한을 한 행으로. §2.3.3
-- 옛 컬럼 삭제 전에 그것을 읽는 트리거·FK·인덱스를 먼저 지운다
-- 정책 member_update_actual 이 project_members.team_id·user_id 를 읽는다 — 먼저 지우고 ④ 에서 my_team_ids 위로 다시 만든다
drop policy member_update_actual on public.wbs_items;
drop trigger if exists project_members_normalize_link_trg on public.project_members;
drop trigger if exists zz_project_member_email_identity_trg on public.project_members;
alter table public.project_members drop constraint project_members_email_name_fkey;
alter table public.project_members drop constraint project_members_team_id_fkey;
alter table public.project_members drop constraint project_members_user_id_fkey;
drop index public.project_members_email_idx; drop index public.project_members_project_email_uidx;
drop index public.project_members_project_user_uidx; drop index public.project_members_user_idx;
alter table public.project_members
  drop column name, drop column email, drop column team_id, drop column role, drop column user_id,
  add column person_id uuid references public.people(id) on delete restrict,
  add column access_role text check (access_role in ('admin','member')),
  add column active boolean not null default true,
  add column sort_order int not null default 0,
  add column access_granted_by uuid references auth.users(id) on delete set null,
  add column access_granted_at timestamptz,
  add column updated_at timestamptz not null default now();
alter table public.project_members alter column person_id set not null;
create unique index project_members_project_person_uidx on public.project_members (project_id, person_id);
create index project_members_person_idx on public.project_members (person_id);
-- project_members_id_project_uidx 는 유지(담당 FK 7건의 참조 대상)

-- 담당자 FK 승격 — §2.3.3 FK 표. 담당자와 행의 프로젝트 일치를 DB 가 예외 없이 보증한다.
-- attendance_records: 단일 FK 와 복합 FK(attendance_member_project_fk)가 병존 → 복합만 남긴다
alter table public.attendance_records drop constraint attendance_records_member_id_fkey;

-- meeting_attendees: project_id 추가 + 복합 FK 2건(issue_assignees 관례)
alter table public.meeting_attendees add column project_id uuid;
alter table public.meeting_attendees alter column project_id set not null;
create unique index meetings_id_project_uidx on public.meetings (id, project_id);
alter table public.meeting_attendees drop constraint meeting_attendees_member_id_fkey;
alter table public.meeting_attendees
  add constraint meeting_attendees_meeting_project_fk foreign key (meeting_id, project_id)
    references public.meetings(id, project_id) on delete cascade,
  add constraint meeting_attendees_member_project_fk foreign key (member_id, project_id)
    references public.project_members(id, project_id) on delete cascade;

-- notification_recipients: project_id(null 허용) + 복합 FK 2건. MATCH SIMPLE 은 한 컬럼이라도 null 이면
-- 검사를 건너뛰므로 (member, null) 조합을 CHECK 로 막는다. 프로젝트 없는 사건의 수신자는 둘 다 null.
alter table public.notification_recipients add column project_id uuid;
create unique index notification_events_id_project_uidx on public.notification_events (id, project_id);
alter table public.notification_recipients drop constraint notification_recipients_member_id_fkey;
alter table public.notification_recipients
  add constraint notification_recipients_member_project_fk foreign key (member_id, project_id)
    references public.project_members(id, project_id) on delete cascade,
  add constraint notification_recipients_event_project_fk foreign key (event_id, project_id)
    references public.notification_events(id, project_id) on delete cascade,
  add constraint notification_recipients_member_needs_project check (member_id is null or project_id is not null);

-- project_invites — §2.3.3. 평문 token → token_hash, 단일 team_id → team_ids[], 워크스페이스·권한·라벨 추가.
-- 부분 유니크(project_invites_active_email_uidx)·인덱스(project_invites_project_created_idx)는 기준선 것 유지.
alter table public.project_invites
  drop column token, drop column team_id,
  add column workspace_id uuid not null references public.workspaces(id) on delete cascade,
  add column access_role text check (access_role in ('admin','member')),
  add column role_label text,
  add column team_ids uuid[],
  add column token_hash text not null unique;

-- ③ 헬퍼(새 표 위) — §2.4.5 ---------------------------------------------------
-- 전부 language sql stable security definer set search_path = ''. security definer 라 정책 안에서
-- workspace_members·project_members 를 다시 읽어도 RLS 재귀가 없다.

-- 플랫폼
create or replace function public.is_superuser() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid())
$$;
revoke all on function public.is_superuser() from public;
grant execute on function public.is_superuser() to authenticated;

-- 워크스페이스
create or replace function public.my_workspace_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select w.id from public.workspaces w where public.is_superuser()
  union
  select m.workspace_id from public.workspace_members m where m.user_id = auth.uid()
$$;
revoke all on function public.my_workspace_ids() from public;
grant execute on function public.my_workspace_ids() to authenticated;

create or replace function public.is_ws_member(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_superuser()
      or exists (select 1 from public.workspace_members m
                  where m.workspace_id = wid and m.user_id = auth.uid())
$$;
revoke all on function public.is_ws_member(uuid) from public;
grant execute on function public.is_ws_member(uuid) to authenticated;

create or replace function public.is_ws_admin(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_superuser()
      or exists (select 1 from public.workspace_members m
                  where m.workspace_id = wid and m.user_id = auth.uid() and m.role = 'admin')
$$;
revoke all on function public.is_ws_admin(uuid) from public;
grant execute on function public.is_ws_admin(uuid) to authenticated;

-- 프로젝트 → 워크스페이스
create or replace function public.project_ws(pid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.workspace_id from public.projects p where p.id = pid
$$;
revoke all on function public.project_ws(uuid) from public;
grant execute on function public.project_ws(uuid) to authenticated;

-- SP2 의 읽기 정책이 쓸 함수. SP1 의 어떤 정책도 아직 부르지 않지만 buildActor 와 같은 정의를 DB 에 둔다.
create or replace function public.accessible_project_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.projects p
   where p.workspace_id in (select public.my_workspace_ids())
$$;
revoke all on function public.accessible_project_ids() from public;
grant execute on function public.accessible_project_ids() to authenticated;

-- 프로젝트 역할 — roleIn 과 같은 순서(플랫폼 → pid null 판정 → 워크스페이스 관리자 → 명단 행).
-- 플랫폼 관리자는 pid 가 null 이어도 true(roleIn ② 가 ③ 앞).
create or replace function public.is_project_admin(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_superuser()
      or (pid is not null and (
             public.is_ws_admin(public.project_ws(pid))
          or exists (select 1 from public.project_members pm
                       join public.people pe on pe.id = pm.person_id
                      where pm.project_id = pid and pm.active and pe.active
                        and pe.user_id = auth.uid() and pm.access_role = 'admin')))
$$;
revoke all on function public.is_project_admin(uuid) from public;
grant execute on function public.is_project_admin(uuid) to authenticated;

create or replace function public.is_project_member(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_project_admin(pid)
      or (pid is not null and exists (
            select 1 from public.project_members pm
              join public.people pe on pe.id = pm.person_id
             where pm.project_id = pid and pm.active and pe.active
               and pe.user_id = auth.uid() and pm.access_role is not null))
$$;
revoke all on function public.is_project_member(uuid) from public;
grant execute on function public.is_project_member(uuid) to authenticated;

create or replace function public.can_read_project(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_superuser()
      or (pid is not null and public.is_ws_member(public.project_ws(pid)))
$$;
revoke all on function public.can_read_project(uuid) from public;
grant execute on function public.can_read_project(uuid) to authenticated;

-- 명단 자기 행·내 팀
create or replace function public.my_member_id(pid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select pm.id from public.project_members pm
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pe.user_id = auth.uid() and pm.active
   limit 1
$$;
revoke all on function public.my_member_id(uuid) from public;
grant execute on function public.my_member_id(uuid) to authenticated;

create or replace function public.my_team_ids(pid uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select pmt.team_id from public.project_member_teams pmt
    join public.project_members pm on pm.id = pmt.member_id
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pm.active and pe.user_id = auth.uid()
$$;
revoke all on function public.my_team_ids(uuid) from public;
grant execute on function public.my_team_ids(uuid) to authenticated;

-- 워크스페이스 안 어느 프로젝트든 관리자(people insert 정책용)
create or replace function public.is_project_admin_anywhere_in_ws(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_ws_admin(wid)
      or exists (select 1 from public.project_members pm
                   join public.people pe on pe.id = pm.person_id
                   join public.projects p on p.id = pm.project_id
                  where p.workspace_id = wid and pe.user_id = auth.uid()
                    and pm.active and pm.access_role = 'admin')
$$;
revoke all on function public.is_project_admin_anywhere_in_ws(uuid) from public;
grant execute on function public.is_project_admin_anywhere_in_ws(uuid) to authenticated;

-- can_attach — memberships ∪ project_members 합집합 서브쿼리를 my_team_ids 로 교체
create or replace function public.can_attach(item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wbs_items w
     where w.id = item
       and (public.is_project_admin(w.project_id)
         or (public.is_project_member(w.project_id)
             and exists (select 1 from public.item_owners o
                          where o.wbs_item_id = item
                            and o.team_id in (select public.my_team_ids(w.project_id))))))
$$;
revoke all on function public.can_attach(uuid) from public;
grant execute on function public.can_attach(uuid) to authenticated;

-- app_role() — 본문만 새 표 위로. 반환 문자열은 회의록 정책 8개가 그대로 쓰므로 유지(삭제는 SP2).
create or replace function public.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when public.is_superuser() then 'pmo_admin'
    when exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                  where pe.user_id = auth.uid() and pm.active and pe.active and pm.access_role = 'admin') then 'pmo_admin'
    when exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                  where pe.user_id = auth.uid() and pm.active and pe.active and pm.access_role is not null) then 'team_editor'
    else null end
$$;

-- ④ 트리거 — §2.3.8 ---------------------------------------------------------
-- 트리거 함수는 security definer(세션 경로의 RLS 에 가려 판정이 틀리지 않게) + search_path = ''.
-- 트리거로만 불리므로 실행 권한은 아무에게도 주지 않는다.

-- 마지막 관리자 행의 삭제·강등 거부. 부모(워크스페이스·계정)가 지워져 cascade 로 오는 삭제는 통과시킨다 —
-- 그렇지 않으면 워크스페이스 삭제와 GoTrue 계정 삭제가 이 트리거에 막힌다.
create function public.workspace_members_keep_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role <> 'admin' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' and new.workspace_id = old.workspace_id then
    return new;
  end if;
  if tg_op = 'DELETE' and (
       not exists (select 1 from public.workspaces w where w.id = old.workspace_id)
    or not exists (select 1 from auth.users u where u.id = old.user_id)) then
    return old;
  end if;
  if not exists (select 1 from public.workspace_members m
                  where m.workspace_id = old.workspace_id and m.role = 'admin'
                    and m.user_id <> old.user_id) then
    raise exception using errcode = '23514', message = 'WORKSPACE_LAST_ADMIN';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function public.workspace_members_keep_last_admin() from public, anon, authenticated;
create trigger workspace_members_keep_last_admin before update or delete on public.workspace_members
  for each row execute function public.workspace_members_keep_last_admin();

-- 계정 연결이 끊기면(계정 삭제의 set null 포함) 그 인물의 모든 권한을 내린다. 명단 행과 담당 FK 는 남는다.
create function public.people_unlink_revokes_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.user_id is not null and new.user_id is null then
    update public.project_members pm
       set access_role = null
     where pm.person_id = new.id and pm.access_role is not null;
  end if;
  return null;
end
$$;
revoke all on function public.people_unlink_revokes_access() from public, anon, authenticated;
create trigger people_unlink_revokes_access after update of user_id on public.people
  for each row execute function public.people_unlink_revokes_access();

-- 명단 행 무결성: 권한 ⇒ 계정, 인물·프로젝트 같은 워크스페이스, project_id 불변, access_role 변경 시각.
-- access_granted_by 는 액션·RPC 가 넣는다(service_role 경로에서는 auth.uid() 가 null).
create function public.project_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_person_ws uuid;
  v_person_user uuid;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    -- 담당 FK 가 (id, project_id) 복합이라 바꾸면 FK 가 깨진다
    raise exception using errcode = '23514', message = 'PROJECT_MEMBER_PROJECT_IMMUTABLE';
  end if;

  select pe.workspace_id, pe.user_id into v_person_ws, v_person_user
    from public.people pe where pe.id = new.person_id;
  if found then
    if new.access_role is not null and v_person_user is null then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT';
    end if;
    if v_person_ws is distinct from public.project_ws(new.project_id) then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_CROSS_WORKSPACE';
    end if;
  end if;
  -- 인물이 없으면 person_id FK 가 거부한다

  if tg_op = 'INSERT' then
    new.access_granted_at := case when new.access_role is not null then now() end;
  else
    if new.access_role is distinct from old.access_role then
      new.access_granted_at := now();
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;
revoke all on function public.project_members_guard() from public, anon, authenticated;
create trigger project_members_guard before insert or update on public.project_members
  for each row execute function public.project_members_guard();

-- 세션 경로의 본인 행 권한 회수 금지(워크스페이스 관리자 예외). auth.uid() 가 null(service_role)이면 통과 —
-- 그 경로는 RPC upsert_project_member 본문이 같은 판정을 한다.
create function public.project_members_no_self_demote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or old.access_role is null then
    return new;
  end if;
  if (new.access_role is null
      or (old.access_role = 'admin' and new.access_role = 'member')
      or (old.active and not new.active))
     and exists (select 1 from public.people pe where pe.id = old.person_id and pe.user_id = auth.uid())
     and not public.is_ws_admin(public.project_ws(old.project_id)) then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_SELF_DEMOTE';
  end if;
  return new;
end
$$;
revoke all on function public.project_members_no_self_demote() from public, anon, authenticated;
create trigger project_members_no_self_demote before update on public.project_members
  for each row execute function public.project_members_no_self_demote();

-- 팀: 프로젝트 행의 워크스페이스 일치, code 불변(엑셀 프로파일·item_owners 임포트가 코드로 해석).
create function public.teams_guard() returns trigger
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
revoke all on function public.teams_guard() from public, anon, authenticated;
create trigger teams_guard before insert or update on public.teams
  for each row execute function public.teams_guard();

-- 명단 행의 팀: 그 프로젝트 전용 팀이거나 같은 워크스페이스 공용 팀. "전용 팀이 있으면 공용 제외" 는 앱 계층.
create function public.project_member_teams_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.project_members pm
      join public.projects p on p.id = pm.project_id
      join public.teams t on t.id = new.team_id
     where pm.id = new.member_id
       and (t.project_id = pm.project_id or (t.project_id is null and t.workspace_id = p.workspace_id))) then
    raise exception using errcode = '23514', message = 'PROJECT_MEMBER_TEAM_SCOPE';
  end if;
  return new;
end
$$;
revoke all on function public.project_member_teams_guard() from public, anon, authenticated;
create trigger project_member_teams_guard before insert or update on public.project_member_teams
  for each row execute function public.project_member_teams_guard();

-- 영역 담당 팀: 위와 동형.
create function public.area_teams_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.project_areas a
      join public.projects p on p.id = a.project_id
      join public.teams t on t.id = new.team_id
     where a.id = new.area_id
       and (t.project_id = a.project_id or (t.project_id is null and t.workspace_id = p.workspace_id))) then
    raise exception using errcode = '23514', message = 'AREA_TEAM_SCOPE';
  end if;
  return new;
end
$$;
revoke all on function public.area_teams_guard() from public, anon, authenticated;
create trigger area_teams_guard before insert or update on public.area_teams
  for each row execute function public.area_teams_guard();

-- 담당 영역: code 불변(이슈 ID 접두에 쓰인다).
create function public.project_areas_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.code is distinct from old.code then
    raise exception using errcode = '23514', message = 'PROJECT_AREA_CODE_IMMUTABLE';
  end if;
  return new;
end
$$;
revoke all on function public.project_areas_guard() from public, anon, authenticated;
create trigger project_areas_guard before update on public.project_areas
  for each row execute function public.project_areas_guard();

-- 초대: 워크스페이스 일치, team_ids 유효, admin 초대는 발급자(created_by)가 워크스페이스 관리자.
-- 이 표는 service_role 로만 쓰므로 auth.uid() 대신 행의 발급자 컬럼으로 판정한다(가드의 2차 방어선).
-- 수락(redeemed_* 갱신) 때 발급자의 현재 등급으로 다시 막지 않도록, 각 검사는 해당 컬럼이 바뀔 때만 돈다.
create function public.project_invites_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.project_id is distinct from old.project_id
     or new.workspace_id is distinct from old.workspace_id then
    if public.project_ws(new.project_id) is distinct from new.workspace_id then
      raise exception using errcode = '23514', message = 'PROJECT_INVITE_CROSS_WORKSPACE';
    end if;
  end if;
  if new.team_ids is not null and (tg_op = 'INSERT' or new.team_ids is distinct from old.team_ids
     or new.project_id is distinct from old.project_id) then
    if exists (
      select 1 from unnest(new.team_ids) as x(team_id)
       where not exists (
         select 1 from public.teams t
          where t.id = x.team_id
            and (t.project_id = new.project_id
                 or (t.project_id is null and t.workspace_id = new.workspace_id)))) then
      raise exception using errcode = '23514', message = 'PROJECT_INVITE_TEAM_SCOPE';
    end if;
  end if;
  if new.access_role = 'admin' and (tg_op = 'INSERT' or new.access_role is distinct from old.access_role
     or new.created_by is distinct from old.created_by) then
    if new.created_by is null or not (
         exists (select 1 from public.platform_admins a where a.user_id = new.created_by)
      or exists (select 1 from public.workspace_members m
                  where m.workspace_id = new.workspace_id and m.user_id = new.created_by and m.role = 'admin')) then
      raise exception using errcode = '42501', message = 'PROJECT_INVITE_ADMIN_FORBIDDEN';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.project_invites_guard() from public, anon, authenticated;
create trigger project_invites_guard before insert or update on public.project_invites
  for each row execute function public.project_invites_guard();

-- ④ 정책 --------------------------------------------------------------------
-- 기존 표: su_* 를 워크스페이스 관리자로 내리고, 명단 쓰기를 두 정책으로 가른다. 읽기 정책은 무변경(SP2).
drop policy su_insert_projects on public.projects;
create policy wsadmin_insert_projects on public.projects for insert to authenticated with check (public.is_ws_admin(workspace_id));
drop policy su_delete_projects on public.projects;
create policy wsadmin_delete_projects on public.projects for delete to authenticated using (public.is_ws_admin(workspace_id));
drop policy su_insert_teams on public.teams;
create policy wsadmin_insert_teams on public.teams for insert to authenticated with check (project_id is null and public.is_ws_admin(workspace_id));
drop policy su_update_teams on public.teams;
create policy wsadmin_update_teams on public.teams for update to authenticated using (project_id is null and public.is_ws_admin(workspace_id)) with check (project_id is null and public.is_ws_admin(workspace_id));
drop policy admin_write_members on public.project_members;
-- UPDATE 로 member→admin 승격을 시도하면 첫 정책의 with check 가 거부하고 둘째 정책만 통과시킨다.
create policy admin_write_member_rows on public.project_members to authenticated
  using (public.is_project_admin(project_id) and access_role is distinct from 'admin')
  with check (public.is_project_admin(project_id) and access_role is distinct from 'admin');
create policy wsadmin_write_admin_rows on public.project_members to authenticated
  using (public.is_ws_admin(public.project_ws(project_id))) with check (public.is_ws_admin(public.project_ws(project_id)));
-- (옛 member_update_actual 은 ② 에서 project_members.team_id 를 지우기 전에 이미 지웠다)
create policy member_update_actual on public.wbs_items for update to authenticated
  using (public.is_project_member(project_id) and public.wbs_is_leaf(id)
     and exists (select 1 from public.item_owners o where o.wbs_item_id = wbs_items.id
                   and o.team_id in (select public.my_team_ids(wbs_items.project_id))))
  with check (public.is_project_member(project_id) and public.wbs_is_leaf(id)
     and exists (select 1 from public.item_owners o where o.wbs_item_id = wbs_items.id
                   and o.team_id in (select public.my_team_ids(wbs_items.project_id))));

-- 새 표 RLS — §2.3.1~2.3.5 의 "RLS:" 줄. GRANT 는 기준선 project_members 와 같은 관례.
alter table public.workspaces enable row level security;
create policy workspaces_read on public.workspaces for select to authenticated
  using (id in (select public.my_workspace_ids()));
-- 쓰기 정책 없음(플랫폼 관리자 액션 + service_role)
grant all on table public.workspaces to anon;
grant all on table public.workspaces to authenticated;
grant all on table public.workspaces to service_role;

alter table public.platform_admins enable row level security;
create policy platform_admins_read on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or public.is_superuser());
-- 워크스페이스 관리자는 이 표를 쓰지 못한다 — 관리자가 관리자를 늘리면 안 된다는 규칙을 플랫폼 층에 둔다
create policy platform_admins_write on public.platform_admins to authenticated
  using (public.is_superuser()) with check (public.is_superuser());
grant all on table public.platform_admins to anon;
grant all on table public.platform_admins to authenticated;
grant all on table public.platform_admins to service_role;

alter table public.profiles enable row level security;
-- 같은 워크스페이스를 공유하는 계정끼리만 이메일·표시 이름을 본다
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_superuser() or exists (
    select 1 from public.workspace_members a join public.workspace_members b using (workspace_id)
     where a.user_id = auth.uid() and b.user_id = profiles.user_id));
-- 표시 이름 본인 수정 외 쓰기 정책 없음
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on table public.profiles to anon;
grant all on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

alter table public.workspace_members enable row level security;
create policy workspace_members_read on public.workspace_members for select to authenticated
  using (public.is_ws_member(workspace_id));
create policy workspace_members_write on public.workspace_members to authenticated
  using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
grant all on table public.workspace_members to anon;
grant all on table public.workspace_members to authenticated;
grant all on table public.workspace_members to service_role;

alter table public.people enable row level security;
create policy people_read on public.people for select to authenticated
  using (public.is_ws_member(workspace_id));
-- 외부 인력을 프로젝트 관리자가 명단에 넣을 때 people 행을 함께 만든다
create policy people_insert on public.people for insert to authenticated
  with check (public.is_ws_member(workspace_id) and public.is_project_admin_anywhere_in_ws(workspace_id));
create policy people_update on public.people for update to authenticated
  using (public.is_ws_admin(workspace_id) or exists (
    select 1 from public.project_members pm where pm.person_id = people.id and public.is_project_admin(pm.project_id)))
  with check (public.is_ws_admin(workspace_id) or exists (
    select 1 from public.project_members pm where pm.person_id = people.id and public.is_project_admin(pm.project_id)));
create policy people_delete on public.people for delete to authenticated
  using (public.is_ws_admin(workspace_id) or exists (
    select 1 from public.project_members pm where pm.person_id = people.id and public.is_project_admin(pm.project_id)));
grant all on table public.people to anon;
grant all on table public.people to authenticated;
grant all on table public.people to service_role;

alter table public.project_member_teams enable row level security;
create policy project_member_teams_read on public.project_member_teams for select to authenticated
  using (exists (select 1 from public.project_members pm
                  where pm.id = project_member_teams.member_id
                    and pm.project_id in (select public.accessible_project_ids())));
create policy project_member_teams_write on public.project_member_teams to authenticated
  using (exists (select 1 from public.project_members pm
                  where pm.id = project_member_teams.member_id and public.is_project_admin(pm.project_id)))
  with check (exists (select 1 from public.project_members pm
                  where pm.id = project_member_teams.member_id and public.is_project_admin(pm.project_id)));
grant all on table public.project_member_teams to anon;
grant all on table public.project_member_teams to authenticated;
grant all on table public.project_member_teams to service_role;

alter table public.project_areas enable row level security;
create policy project_areas_read on public.project_areas for select to authenticated
  using (project_id in (select public.accessible_project_ids()));
create policy project_areas_write on public.project_areas to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));
grant all on table public.project_areas to anon;
grant all on table public.project_areas to authenticated;
grant all on table public.project_areas to service_role;

alter table public.area_teams enable row level security;
create policy area_teams_read on public.area_teams for select to authenticated
  using (exists (select 1 from public.project_areas a
                  where a.id = area_teams.area_id
                    and a.project_id in (select public.accessible_project_ids())));
create policy area_teams_write on public.area_teams to authenticated
  using (exists (select 1 from public.project_areas a
                  where a.id = area_teams.area_id and public.is_project_admin(a.project_id)))
  with check (exists (select 1 from public.project_areas a
                  where a.id = area_teams.area_id and public.is_project_admin(a.project_id)));
grant all on table public.area_teams to anon;
grant all on table public.area_teams to authenticated;
grant all on table public.area_teams to service_role;

-- ④ RPC ---------------------------------------------------------------------

-- 명단 편집 — 서버 액션(requireProjectAdmin + service_role)이 부른다. service_role 경로에서는 트리거가
-- auth.uid() 를 못 보므로 p_actor(가드가 돌려준 actor.userId)로 세 규칙을 본문에서 판정한다.
--   p_person = {"id"?: uuid, "display_name": text, "email"?: text|null}
--   p_member = {"access_role"?: 'admin'|'member'|null, "role_label"?, "title"?, "active"?, "sort_order"?}
--              키가 없으면 기존 값 유지(새 행은 기본값). p_team_ids 가 null 이면 팀 무변경, 첫 원소가 대표 팀.
-- 계정 없는 인물의 권한은 트리거 project_members_guard 가 거부하고, 그 예외를 그대로 전파한다.
create function public.upsert_project_member(
  p_actor uuid, p_project_id uuid, p_person jsonb, p_member jsonb, p_team_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_ws_admin boolean;
  v_person_id uuid;
  v_person_ws uuid;
  v_person_user uuid;
  v_person_name text;
  v_name text := nullif(btrim(p_person->>'display_name'), '');
  v_email text := nullif(lower(btrim(p_person->>'email')), '');
  v_member_id uuid;
  v_old_access text;
  v_old_active boolean;
  v_new_access text;
  v_new_active boolean;
  v_primary uuid;
begin
  if p_actor is null or p_project_id is null or p_person is null then
    raise exception using errcode = '22023', message = 'PROJECT_MEMBER_INVALID_INPUT';
  end if;
  p_member := coalesce(p_member, '{}'::jsonb);

  -- ① 호출자 등급
  v_ws := public.project_ws(p_project_id);
  if v_ws is null then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  v_ws_admin := exists (select 1 from public.platform_admins a where a.user_id = p_actor)
             or exists (select 1 from public.workspace_members m
                         where m.workspace_id = v_ws and m.user_id = p_actor and m.role = 'admin');
  if not v_ws_admin and not exists (
       select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
        where pm.project_id = p_project_id and pe.user_id = p_actor
          and pm.active and pe.active and pm.access_role = 'admin') then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_FORBIDDEN';
  end if;

  -- ② 인물 확정: id 우선, 없으면 (workspace_id, email) 매치, 없으면 insert
  if nullif(p_person->>'id', '') is not null then
    select pe.id, pe.workspace_id, pe.user_id, pe.display_name
      into v_person_id, v_person_ws, v_person_user, v_person_name
      from public.people pe where pe.id = (p_person->>'id')::uuid
       for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'PERSON_NOT_FOUND';
    end if;
    if v_person_ws <> v_ws then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_CROSS_WORKSPACE';
    end if;
  else
    if v_name is null then
      raise exception using errcode = '22023', message = 'PERSON_NAME_REQUIRED';
    end if;
    if v_email is not null then
      insert into public.people (workspace_id, display_name, email)
      values (v_ws, v_name, v_email)
      on conflict (workspace_id, email) where email is not null do nothing;
      select pe.id, pe.user_id, pe.display_name into v_person_id, v_person_user, v_person_name
        from public.people pe where pe.workspace_id = v_ws and pe.email = v_email
         for update;
    else
      insert into public.people (workspace_id, display_name)
      values (v_ws, v_name)
      returning id, user_id, display_name into v_person_id, v_person_user, v_person_name;
    end if;
  end if;
  if v_name is not null and v_name is distinct from v_person_name then
    update public.people set display_name = v_name, updated_at = now() where id = v_person_id;
  end if;

  -- ③ 기존 명단 행
  select pm.id, pm.access_role, pm.active into v_member_id, v_old_access, v_old_active
    from public.project_members pm
   where pm.project_id = p_project_id and pm.person_id = v_person_id
     for update;

  v_new_access := case when p_member ? 'access_role' then p_member->>'access_role' else v_old_access end;
  v_new_active := case when p_member ? 'active' then coalesce((p_member->>'active')::boolean, true)
                       else coalesce(v_old_active, true) end;

  -- ④ 규칙
  -- 본인 행의 권한 회수 금지(마지막 관리자 소실 방지). 워크스페이스 관리자는 승계로 항상 관리자라 예외.
  -- 관리자 슬롯 검사보다 먼저 본다 — 비-워크스페이스 관리자인 호출자의 본인 행은 늘 admin 이라, 순서가 반대면
  -- 본인 강등이 언제나 ADMIN_SLOT 으로 보고되고 SELF_DEMOTE 는 도달하지 못한다.
  if v_member_id is not null and v_person_user = p_actor and v_old_access is not null
     and (v_new_access is null
          or (v_old_access = 'admin' and v_new_access = 'member')
          or (v_old_active and not v_new_active))
     and not v_ws_admin then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_SELF_DEMOTE';
  end if;
  -- 관리자 행(새 값 또는 기존 값이 admin)은 워크스페이스 관리자 이상만 — RLS admin_write_member_rows 와 같은 선
  -- (프로젝트 관리자는 admin 행의 표시 필드도 고치지 못한다. 세션 경로와 service_role 경로가 같은 답을 내게 한다).
  if (v_new_access = 'admin' or v_old_access = 'admin') and not v_ws_admin then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_ADMIN_SLOT';
  end if;

  -- ⑤ upsert
  if v_member_id is null then
    insert into public.project_members
      (project_id, person_id, access_role, role_label, title, active, sort_order, access_granted_by)
    values
      (p_project_id, v_person_id, v_new_access, p_member->>'role_label', p_member->>'title', v_new_active,
       coalesce((p_member->>'sort_order')::int, 0),
       case when v_new_access is not null then p_actor end)
    returning id into v_member_id;
  else
    update public.project_members pm
       set access_role = v_new_access,
           role_label = case when p_member ? 'role_label' then p_member->>'role_label' else pm.role_label end,
           title = case when p_member ? 'title' then p_member->>'title' else pm.title end,
           active = v_new_active,
           sort_order = case when p_member ? 'sort_order' then coalesce((p_member->>'sort_order')::int, 0)
                             else pm.sort_order end,
           access_granted_by = case when v_new_access is distinct from v_old_access then p_actor
                                    else pm.access_granted_by end
     where pm.id = v_member_id;
  end if;

  -- ⑥ 팀 동기화
  if p_team_ids is not null then
    select x.team_id into v_primary
      from unnest(p_team_ids) with ordinality as x(team_id, ord)
     where x.team_id is not null
     order by x.ord limit 1;
    delete from public.project_member_teams pmt
     where pmt.member_id = v_member_id
       and not (pmt.team_id = any (array_remove(p_team_ids, null)));
    update public.project_member_teams pmt
       set is_primary = false
     where pmt.member_id = v_member_id and pmt.is_primary and pmt.team_id is distinct from v_primary;
    insert into public.project_member_teams (member_id, team_id, is_primary)
    select distinct v_member_id, x.team_id, x.team_id = v_primary
      from unnest(p_team_ids) as x(team_id)
     where x.team_id is not null
    on conflict (member_id, team_id) do update set is_primary = excluded.is_primary;
  end if;

  -- ⑦
  return v_member_id;
end
$$;
revoke all on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]) to service_role;

-- 초대 수락 — 한 트랜잭션에서 소비·계정·인물·워크스페이스·명단·팀을 처리한다. 앱 계층에 다섯 쓰기를 흩뿌리면
-- 부분 실패가 "소비된 초대 + 소속 없음" 을 남긴다. 단일 UPDATE 술어(미사용·미취소·미만료·이메일 일치)는 유지.
-- 0행(무효 토큰)이면 빈 결과.
drop function public.consume_project_invite(uuid, text, uuid);
create function public.consume_project_invite(p_token_hash text, p_email text, p_user uuid)
returns table(workspace_id uuid, project_id uuid, member_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_ws uuid;
  v_project uuid;
  v_access text;
  v_label text;
  v_team_ids uuid[];
  v_email text;
  v_created_by uuid;
  v_name text;
  v_person uuid;
  v_person_user uuid;
  v_member uuid;
  v_old_access text;
  v_new_access text;
  v_first_team uuid;
begin
  update public.project_invites pi
     set redeemed_by = p_user, redeemed_at = now()
   where pi.token_hash = p_token_hash
     and pi.redeemed_at is null
     and pi.revoked_at is null
     and pi.expires_at > now()
     and pi.email = lower(btrim(p_email))
  returning pi.workspace_id, pi.project_id, pi.access_role, pi.role_label, pi.team_ids, pi.email, pi.created_by
       into v_ws, v_project, v_access, v_label, v_team_ids, v_email, v_created_by;
  if not found then
    return;
  end if;

  -- ① profiles upsert — 기존 표시 이름을 유지하고, 없으면 이메일 로컬 파트
  insert into public.profiles as pr (user_id, email, display_name)
  values (p_user, v_email, split_part(v_email, '@', 1))
  on conflict (user_id) do update
     set display_name = coalesce(pr.display_name, excluded.display_name), updated_at = now();
  select pr.display_name into v_name from public.profiles pr where pr.user_id = p_user;

  -- ② people 연결 — 이 계정의 인물이 이미 있으면 그것, 없으면 (workspace_id, email) 매치 → user_id 설정, 없으면 insert
  select pe.id into v_person
    from public.people pe where pe.workspace_id = v_ws and pe.user_id = p_user
     for update;
  if not found then
    select pe.id, pe.user_id into v_person, v_person_user
      from public.people pe where pe.workspace_id = v_ws and pe.email = v_email
       for update;
    if not found then
      insert into public.people as pe (workspace_id, display_name, email, user_id)
      values (v_ws, v_name, v_email, p_user)
      returning pe.id into v_person;
    elsif v_person_user is null then
      update public.people pe set user_id = p_user, updated_at = now() where pe.id = v_person;
    else
      raise exception using errcode = '23505', message = 'PROJECT_INVITE_PERSON_LINKED';
    end if;
  end if;
  -- 비활성 인물을 다시 초대했으면 되살린다 — 헬퍼가 pe.active 를 보므로, 그대로 두면 "소비된 초대 + 권한 없음" 이 남는다
  update public.people pe set active = true, updated_at = now() where pe.id = v_person and not pe.active;

  -- ③ 워크스페이스 소속
  insert into public.workspace_members as wm (workspace_id, user_id, role, invited_by)
  values (v_ws, p_user, 'member', v_created_by)
  on conflict (workspace_id, user_id) do nothing;

  -- ④ 명단 upsert — 초대가 기존 권한을 깎지 않는다(admin > member > null)
  select pm.id, pm.access_role into v_member, v_old_access
    from public.project_members pm
   where pm.project_id = v_project and pm.person_id = v_person
     for update;
  v_new_access := case
    when v_old_access = 'admin' or v_access = 'admin' then 'admin'
    when v_old_access = 'member' or v_access = 'member' then 'member'
    else null end;
  if v_member is null then
    insert into public.project_members as pm (project_id, person_id, access_role, role_label, access_granted_by)
    values (v_project, v_person, v_new_access, v_label, case when v_new_access is not null then v_created_by end)
    returning pm.id into v_member;
  else
    update public.project_members pm
       set access_role = v_new_access,
           role_label = coalesce(v_label, pm.role_label),
           active = true,
           access_granted_by = case when v_new_access is distinct from v_old_access then v_created_by
                                    else pm.access_granted_by end
     where pm.id = v_member;
  end if;

  -- ⑤ 팀 전개 — 대표 팀이 아직 없으면 초대의 첫 팀을 대표로
  if v_team_ids is not null then
    select x.team_id into v_first_team
      from unnest(v_team_ids) with ordinality as x(team_id, ord)
     where x.team_id is not null
     order by x.ord limit 1;
    insert into public.project_member_teams as pmt (member_id, team_id, is_primary)
    select distinct v_member, x.team_id,
           x.team_id = v_first_team
           and not exists (select 1 from public.project_member_teams p2 where p2.member_id = v_member and p2.is_primary)
      from unnest(v_team_ids) as x(team_id)
     where x.team_id is not null
    on conflict (member_id, team_id) do nothing;
  end if;

  return query select v_ws, v_project, v_member;
end
$$;
revoke all on function public.consume_project_invite(text, text, uuid) from public, anon, authenticated;
grant execute on function public.consume_project_invite(text, text, uuid) to service_role;

-- ⑤ 폐기 --------------------------------------------------------------------
-- cascade 금지 — 의존 객체가 남아 있으면 실패하게 둔다(실패하면 위의 교체가 빠진 것).
drop function public.update_project_member_with_identity(uuid, text, text, uuid, text, text, text);
drop function public.enforce_project_member_email_identity();
drop function public.project_members_normalize_link();
drop function public.current_team();
drop table public.project_member_identities;
drop table public.project_roles;
drop table public.memberships;
