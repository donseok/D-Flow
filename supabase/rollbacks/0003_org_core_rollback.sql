-- 0003_org_core 롤백 — 기준선(0002 적용 직후)으로 정확히 돌아간다. 데이터 보존 절차 없음(빈 DB 전제).
--
-- 되돌리는 순서는 0003 의 역순이다: 새 RPC·정책·트리거 → 기존 표를 참조하는 새 표 → 담당자 FK·project_invites·teams·projects
-- → 폐기했던 표 재생성 → project_members 재생성 → 폐기했던 함수·헬퍼 본문 복원 → 남은 새 표·헬퍼 drop.
-- 표·함수·정책·트리거·ACL 텍스트는 0000_baseline.sql 에서 한 글자도 바꾸지 않고 옮겼다(존재하는 함수는 CREATE OR REPLACE 로만).
-- project_members·project_invites 는 ALTER 로 되돌리면 컬럼 순서가 기준선과 달라지므로 표를 다시 만든다(빈 DB 전제).
-- 기준선 적용 뒤에는 기본 권한(ALTER DEFAULT PRIVILEGES, 0000 끝)이 살아 있어 새로 만든 표·함수가 anon·authenticated 권한을
-- 자동으로 받는다. 기준선에서 그 권한이 없던 객체는 REVOKE 로 기준선 ACL 에 맞춘다.
-- cascade 는 쓰지 않는다. 한 트랜잭션으로 돈다 — 중간에 실패하면 아무것도 바뀌지 않는다.

begin;

-- 1. 새 RPC ------------------------------------------------------------------
drop function public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[]);
drop function public.consume_project_invite(text, text, uuid);

-- 2. 기존 표에 건 새 정책 ------------------------------------------------------
drop policy wsadmin_insert_projects on public.projects;
drop policy wsadmin_delete_projects on public.projects;
drop policy wsadmin_insert_teams on public.teams;
drop policy wsadmin_update_teams on public.teams;
drop policy admin_write_member_rows on public.project_members;
drop policy wsadmin_write_admin_rows on public.project_members;
drop policy member_update_actual on public.wbs_items;

-- 3. 기존 표에 건 새 트리거 -----------------------------------------------------
drop trigger project_members_guard on public.project_members;
drop trigger project_members_no_self_demote on public.project_members;
drop trigger teams_guard on public.teams;
drop trigger project_invites_guard on public.project_invites;

-- 4. 기존 표(teams·projects·project_members)를 참조하는 새 표 ---------------------
drop table public.area_teams;
drop table public.project_areas;
drop table public.project_member_teams;

-- 5. 담당자 FK 승격 되돌리기 -----------------------------------------------------
-- (attendance_records·meeting_attendees·notification_recipients 의 단일 member FK 는 9 에서 project_members 와 함께 복원)
alter table public.notification_recipients
  drop constraint notification_recipients_member_needs_project,
  drop constraint notification_recipients_event_project_fk,
  drop constraint notification_recipients_member_project_fk;
alter table public.notification_recipients drop column project_id;
drop index public.notification_events_id_project_uidx;
alter table public.meeting_attendees
  drop constraint meeting_attendees_member_project_fk,
  drop constraint meeting_attendees_meeting_project_fk;
alter table public.meeting_attendees drop column project_id;
drop index public.meetings_id_project_uidx;

-- 6. project_invites — 0000 정의로 다시 만든다(정책 0개·service_role 전용) -----------
drop table public.project_invites;

CREATE TABLE public.project_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    token uuid NOT NULL,
    email text NOT NULL,
    team_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    redeemed_by uuid,
    redeemed_at timestamp with time zone,
    CONSTRAINT project_invites_email_normalized CHECK (((email = lower(btrim(email))) AND (email <> ''::text))),
    CONSTRAINT project_invites_redeem_pair CHECK (((redeemed_by IS NULL) OR (redeemed_at IS NOT NULL)))
);

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_token_key UNIQUE (token);

CREATE UNIQUE INDEX project_invites_active_email_uidx ON public.project_invites USING btree (project_id, email) WHERE ((redeemed_at IS NULL) AND (revoked_at IS NULL));

CREATE INDEX project_invites_project_created_idx ON public.project_invites USING btree (project_id, created_at DESC);

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.project_invites
    ADD CONSTRAINT project_invites_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;

ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.project_invites FROM anon;
REVOKE ALL ON TABLE public.project_invites FROM authenticated;
GRANT ALL ON TABLE public.project_invites TO service_role;

-- 7. teams·projects ----------------------------------------------------------
alter table public.teams drop constraint teams_ws_project_code_key;
drop index public.teams_id_ws_uidx;
alter table public.teams drop constraint teams_code_check;
alter table public.teams drop column color;
alter table public.teams drop column workspace_id;

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_project_code_key UNIQUE NULLS NOT DISTINCT (project_id, code);

CREATE POLICY su_insert_teams ON public.teams FOR INSERT TO authenticated WITH CHECK (public.is_superuser());

CREATE POLICY su_update_teams ON public.teams FOR UPDATE TO authenticated USING (public.is_superuser()) WITH CHECK (public.is_superuser());

drop index public.projects_id_ws_uidx;
drop index public.projects_ws_idx;
alter table public.projects drop column workspace_id;

CREATE POLICY su_delete_projects ON public.projects FOR DELETE TO authenticated USING (public.is_superuser());

CREATE POLICY su_insert_projects ON public.projects FOR INSERT TO authenticated WITH CHECK (public.is_superuser());

-- 8. 폐기했던 표 재생성 --------------------------------------------------------

CREATE TABLE public.memberships (
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    role text NOT NULL,
    is_superuser boolean DEFAULT false NOT NULL,
    CONSTRAINT memberships_role_check CHECK ((role = ANY (ARRAY['pmo_admin'::text, 'team_editor'::text])))
);

CREATE TABLE public.project_member_identities (
    email text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_member_identities_email_normalized CHECK (((email = lower(btrim(email))) AND (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'::text))),
    CONSTRAINT project_member_identities_name_normalized CHECK (((name = btrim(name)) AND (name <> ''::text)))
);

CREATE TABLE public.project_roles (
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_roles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.project_member_identities
    ADD CONSTRAINT project_member_identities_pkey PRIMARY KEY (email);

ALTER TABLE ONLY public.project_roles
    ADD CONSTRAINT project_roles_pkey PRIMARY KEY (project_id, user_id);

CREATE UNIQUE INDEX project_member_identities_email_name_uidx ON public.project_member_identities USING btree (email, name);

CREATE INDEX project_roles_user_idx ON public.project_roles USING btree (user_id);

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_roles
    ADD CONSTRAINT project_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.project_roles
    ADD CONSTRAINT project_roles_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_roles
    ADD CONSTRAINT project_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.project_member_identities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.project_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_write_member_roles ON public.project_roles TO authenticated USING (((role = 'member'::text) AND public.is_project_admin(project_id))) WITH CHECK (((role = 'member'::text) AND public.is_project_admin(project_id)));

CREATE POLICY read_all_memberships ON public.memberships FOR SELECT TO authenticated USING (true);

CREATE POLICY read_all_project_roles ON public.project_roles FOR SELECT TO authenticated USING (true);

CREATE POLICY su_write_admin_roles ON public.project_roles TO authenticated USING (((role = 'admin'::text) AND public.is_superuser())) WITH CHECK (((role = 'admin'::text) AND public.is_superuser()));

CREATE POLICY su_write_memberships ON public.memberships TO authenticated USING (public.is_superuser()) WITH CHECK (public.is_superuser());

GRANT ALL ON TABLE public.memberships TO anon;
GRANT ALL ON TABLE public.memberships TO authenticated;
GRANT ALL ON TABLE public.memberships TO service_role;

REVOKE ALL ON TABLE public.project_member_identities FROM anon;
REVOKE ALL ON TABLE public.project_member_identities FROM authenticated;
GRANT ALL ON TABLE public.project_member_identities TO service_role;

GRANT ALL ON TABLE public.project_roles TO anon;
GRANT ALL ON TABLE public.project_roles TO authenticated;
GRANT ALL ON TABLE public.project_roles TO service_role;

-- 9. project_members — 0000 정의로 다시 만든다 ----------------------------------------
-- 이 표를 가리키는 복합 FK 5건을 먼저 떼고(나머지 2건은 5 에서 뗐다), 다시 만든 뒤 0000 의 8건을 되붙인다.
alter table public.attendance_records drop constraint attendance_member_project_fk;
alter table public.issue_assignees drop constraint issue_assignees_member_project_fk;
alter table public.issues drop constraint issues_assignee_project_fk;
alter table public.wbs_items drop constraint wbs_items_assignee_member_fk;
alter table public.wiki_items drop constraint wiki_items_owner_project_fk;
-- people 의 쓰기 정책이 project_members 를 읽는다(표는 11 에서 지운다)
drop policy people_update on public.people;
drop policy people_delete on public.people;
drop table public.project_members;

-- 트리거 함수(표보다 먼저)

CREATE FUNCTION public.enforce_project_member_email_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_canonical_name text;
begin
  -- 0019 normalize trigger가 이름순으로 먼저 실행되지만, 이 함수도 독립적으로
  -- 정규화해 trigger 이름/직접 호출에 계약이 흔들리지 않게 한다.
  new.name := pg_catalog.btrim(new.name);
  if new.name is null or new.name = '' then
    raise exception 'PROJECT_MEMBER_NAME_REQUIRED' using errcode = '23514';
  end if;

  if new.email is null then
    return new;
  end if;
  new.email := pg_catalog.lower(pg_catalog.btrim(new.email));
  if new.email = '' then
    new.email := null;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('project_member_identity:' || new.email, 0)
  );

  -- email PK의 INSERT/ON CONFLICT가 같은 이메일의 동시 최초 등록을 직렬화한다.
  -- SELECT 사전검사만으로는 두 트랜잭션이 서로를 못 보고 다른 이름을 넣을 수 있다.
  insert into public.project_member_identities (email, name)
  values (new.email, new.name)
  on conflict (email) do nothing;

  select identity.name
    into v_canonical_name
    from public.project_member_identities identity
   where identity.email = new.email;

  if v_canonical_name is distinct from new.name then
    -- 마지막 로스터가 삭제되거나 email이 바뀐 뒤 남은 orphan 정본은 다음 등록자가
    -- 재선점할 수 있다. 활성 로스터가 하나라도 있으면 다른 프로젝트를 덮지 않고 거부한다.
    if not exists (
      select 1
        from public.project_members pm
       where pm.email = new.email
    ) then
      update public.project_member_identities
         set name = new.name
       where email = new.email;
    else
      raise exception 'PROJECT_MEMBER_EMAIL_NAME_MISMATCH' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

CREATE FUNCTION public.project_members_normalize_link() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.email is not null then
    new.email := lower(trim(new.email));
    if new.email = '' then new.email := null; end if;
  end if;

  -- 이메일이 바뀌면 기존 링크를 재해석한다. 그러지 않으면 퇴사자 계정이 후임자의
  -- 멤버 행에 남아 남의 '내 회의'를 보게 된다.
  -- 단, 호출자가 user_id 를 명시적으로 함께 지정했다면 그 의도를 존중한다.
  if tg_op = 'UPDATE'
     and new.email is distinct from old.email
     and new.user_id is not distinct from old.user_id then
    new.user_id := null;
  end if;

  if new.user_id is null and new.email is not null then
    select u.id into new.user_id
      from auth.users u
     where lower(u.email) = new.email and u.deleted_at is null
     order by u.created_at
     limit 1;
  end if;
  return new;
end;
$$;

CREATE TABLE public.project_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    team_id uuid,
    role text DEFAULT 'contributor'::text NOT NULL,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    role_label text,
    CONSTRAINT project_members_email_format CHECK (((email IS NULL) OR (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'::text))),
    CONSTRAINT project_members_name_normalized CHECK (((name = btrim(name)) AND (name <> ''::text))),
    CONSTRAINT project_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'contributor'::text])))
);

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (id);

CREATE INDEX project_members_email_idx ON public.project_members USING btree (email) WHERE (email IS NOT NULL);

CREATE UNIQUE INDEX project_members_id_project_uidx ON public.project_members USING btree (id, project_id);

CREATE UNIQUE INDEX project_members_project_email_uidx ON public.project_members USING btree (project_id, email) WHERE (email IS NOT NULL);

CREATE INDEX project_members_project_idx ON public.project_members USING btree (project_id);

CREATE UNIQUE INDEX project_members_project_user_uidx ON public.project_members USING btree (project_id, user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX project_members_user_idx ON public.project_members USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE TRIGGER project_members_normalize_link_trg BEFORE INSERT OR UPDATE ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.project_members_normalize_link();

CREATE TRIGGER zz_project_member_email_identity_trg BEFORE INSERT OR UPDATE OF email, name ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.enforce_project_member_email_identity();

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_email_name_fkey FOREIGN KEY (email, name) REFERENCES public.project_member_identities(email, name) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_member_project_fk FOREIGN KEY (member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.project_members(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.issue_assignees
    ADD CONSTRAINT issue_assignees_member_project_fk FOREIGN KEY (member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_assignee_project_fk FOREIGN KEY (assignee_member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE SET NULL (assignee_member_id);

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.project_members(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notification_recipients
    ADD CONSTRAINT notification_recipients_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.project_members(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wbs_items
    ADD CONSTRAINT wbs_items_assignee_member_fk FOREIGN KEY (assignee_member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE SET NULL (assignee_member_id);

ALTER TABLE ONLY public.wiki_items
    ADD CONSTRAINT wiki_items_owner_project_fk FOREIGN KEY (owner_member_id, project_id) REFERENCES public.project_members(id, project_id) ON DELETE SET NULL (owner_member_id);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_write_members ON public.project_members TO authenticated USING (public.is_project_admin(project_id)) WITH CHECK (public.is_project_admin(project_id));

CREATE POLICY read_all_members ON public.project_members FOR SELECT TO authenticated USING (true);

GRANT ALL ON TABLE public.project_members TO anon;
GRANT ALL ON TABLE public.project_members TO authenticated;
GRANT ALL ON TABLE public.project_members TO service_role;

-- 트리거 함수 ACL(재생성 시 기본 권한이 붙은 것을 기준선 ACL 로)
REVOKE ALL ON FUNCTION public.enforce_project_member_email_identity() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_project_member_email_identity() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_project_member_email_identity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_project_member_email_identity() TO service_role;

-- 10. 폐기했던 함수·헬퍼 본문 복원 -------------------------------------------------

CREATE FUNCTION public.current_team() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select team_id from memberships where user_id = auth.uid()
$$;

CREATE FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_current public.project_members%rowtype;
  v_name text;
  v_email text;
  v_refs integer;
  v_identity_rename boolean;
  v_roster_write_locked boolean := false;
begin
  v_name := pg_catalog.btrim(p_name);
  if v_name is null or v_name = '' then
    raise exception 'PROJECT_MEMBER_NAME_REQUIRED' using errcode = '23514';
  end if;

  v_email := nullif(pg_catalog.lower(pg_catalog.btrim(p_email)), '');
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'PROJECT_MEMBER_EMAIL_INVALID' using errcode = '23514';
  end if;
  if p_role is null or p_role not in ('admin', 'contributor') then
    raise exception 'PROJECT_MEMBER_ROLE_INVALID' using errcode = '23514';
  end if;

  -- 전역 rename 여부를 판정하는 첫 조회에서는 행 잠금을 잡지 않는다.
  -- 대상 행을 먼저 잠그면, 다른 행을 잠근 요청과 FK cascade가 서로를
  -- 기다리는 교착(member row -> advisory <-> advisory -> cascade row)이 생긴다.
  select pm.*
    into v_current
    from public.project_members pm
   where pm.id = p_member_id;
  if not found then
    raise exception 'PROJECT_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_current.project_id) then
    raise exception 'PROJECT_MEMBER_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  v_identity_rename := v_current.email is not null
    and v_email is not distinct from v_current.email
    and v_name is distinct from v_current.name;

  if v_identity_rename then
    -- ON UPDATE CASCADE와 일반 행 UPDATE의 잠금 순서를 같게 맞추기 위해
    -- 아직 행/advisory 잠금이 없을 때 로스터 쓰기를 잠시 직렬화한다.
    -- 이름 교정은 드물고 행 수도 작아 안전성을 우선한다.
    -- EXCLUSIVE는 일반 SELECT는 허용하지만 다른 RPC의 SELECT ... FOR UPDATE
    -- (ROW SHARE)까지 막는다. SHARE ROW EXCLUSIVE는 ROW SHARE와 호환되어
    -- 다른 RPC가 child 행을 잠근 뒤 UPDATE에서 기다리는 교착이 남는다.
    lock table public.project_members in exclusive mode;
    v_roster_write_locked := true;
  end if;

  -- table lock을 기다리는 동안 대상이 바뀌었을 수 있으므로 행과 권한을
  -- 다시 확정한다. 초기에 rename이 아니었던 요청이 동시 변경으로 rename이
  -- 됐다면, 행을 잠근 채 table lock을 승격하지 말고 재시도로 돌린다.
  select pm.*
    into v_current
    from public.project_members pm
   where pm.id = p_member_id
   for update;
  if not found then
    raise exception 'PROJECT_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_current.project_id) then
    raise exception 'PROJECT_MEMBER_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  v_identity_rename := v_current.email is not null
    and v_email is not distinct from v_current.email
    and v_name is distinct from v_current.name;
  if v_identity_rename and not v_roster_write_locked then
    raise exception 'PROJECT_MEMBER_RETRY' using errcode = '40001';
  end if;

  -- 같은 email의 이름만 바꾸는 경우 정본을 먼저 갱신한다. FK cascade가 이 email을
  -- 쓰는 모든 프로젝트 로스터 이름을 한 트랜잭션에서 바꾼다.
  if v_identity_rename then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('project_member_identity:' || v_email, 0)
    );

    select count(*)
      into v_refs
      from public.project_members pm
     where pm.email = v_email;

    if v_refs > 1 and not public.is_superuser() then
      raise exception 'PROJECT_MEMBER_IDENTITY_RENAME_FORBIDDEN' using errcode = '42501';
    end if;

    update public.project_member_identities identity
       set name = v_name
     where identity.email = v_email;
    if not found then
      raise exception 'PROJECT_MEMBER_IDENTITY_NOT_FOUND' using errcode = '23503';
    end if;
  end if;

  update public.project_members
     set name = v_name,
         email = v_email,
         team_id = p_team_id,
         role = p_role,
         title = p_title,
         role_label = p_role_label
   where id = p_member_id;

  return true;
end
$_$;

REVOKE ALL ON FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text) FROM anon;
REVOKE ALL ON FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text) FROM authenticated;
REVOKE ALL ON FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text) FROM service_role;
REVOKE ALL ON FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text) TO service_role;
GRANT ALL ON FUNCTION public.update_project_member_with_identity(p_member_id uuid, p_name text, p_email text, p_team_id uuid, p_role text, p_title text, p_role_label text) TO authenticated;

CREATE FUNCTION public.consume_project_invite(p_token uuid, p_email text, p_user uuid) RETURNS TABLE(project_id uuid, team_id uuid, invite_email text, created_by uuid)
    LANGUAGE sql
    SET search_path TO 'public', 'extensions'
    AS $$
  update public.project_invites pi
     set redeemed_by = p_user, redeemed_at = now()
   where pi.token = p_token
     and pi.redeemed_at is null
     and pi.revoked_at is null
     and pi.expires_at > now()
     and pi.email = lower(btrim(p_email))
  returning pi.project_id, pi.team_id, pi.email, pi.created_by;
$$;

REVOKE ALL ON FUNCTION public.consume_project_invite(p_token uuid, p_email text, p_user uuid) FROM anon;
REVOKE ALL ON FUNCTION public.consume_project_invite(p_token uuid, p_email text, p_user uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.consume_project_invite(p_token uuid, p_email text, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.consume_project_invite(p_token uuid, p_email text, p_user uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.is_superuser() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((select m.is_superuser from public.memberships m
                    where m.user_id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION public.is_project_admin(pid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.is_superuser()
      or exists (select 1 from public.project_roles r
                  where r.project_id = pid and r.user_id = auth.uid() and r.role = 'admin')
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(pid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.is_project_admin(pid)
      or exists (select 1 from public.project_roles r
                  where r.project_id = pid and r.user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_read_project(pid uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ select true $$;

CREATE OR REPLACE FUNCTION public.can_attach(item uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.wbs_items w
     where w.id = item
       and (
         public.is_project_admin(w.project_id)
         or (
           public.is_project_member(w.project_id)
           and exists (select 1 from public.item_owners o
                        where o.wbs_item_id = item
                          and (o.team_id = (select m.team_id from public.memberships m
                                             where m.user_id = auth.uid())
                            or o.team_id in (select pm.team_id from public.project_members pm
                                              where pm.project_id = w.project_id
                                                and pm.user_id = auth.uid()
                                                and pm.team_id is not null)))
         )
       )
  )
$$;

CREATE OR REPLACE FUNCTION public.app_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case
    when public.is_superuser() then 'pmo_admin'
    when exists (select 1 from public.project_roles r
                  where r.user_id = auth.uid() and r.role = 'admin') then 'pmo_admin'
    when exists (select 1 from public.project_roles r
                  where r.user_id = auth.uid()) then 'team_editor'
    else null
  end
$$;

-- 0003 이 can_attach 의 PUBLIC 실행 권한을 거뒀다 — 기준선 적용 직후에는 기본 권한으로 PUBLIC 에 있었다
GRANT ALL ON FUNCTION public.can_attach(item uuid) TO PUBLIC;

CREATE POLICY member_update_actual ON public.wbs_items FOR UPDATE TO authenticated USING ((public.is_project_member(project_id) AND public.wbs_is_leaf(id) AND (EXISTS ( SELECT 1
   FROM public.item_owners o
  WHERE ((o.wbs_item_id = wbs_items.id) AND ((o.team_id = ( SELECT m.team_id
           FROM public.memberships m
          WHERE (m.user_id = auth.uid()))) OR (o.team_id IN ( SELECT pm.team_id
           FROM public.project_members pm
          WHERE ((pm.project_id = wbs_items.project_id) AND (pm.user_id = auth.uid()) AND (pm.team_id IS NOT NULL)))))))))) WITH CHECK ((public.is_project_member(project_id) AND public.wbs_is_leaf(id) AND (EXISTS ( SELECT 1
   FROM public.item_owners o
  WHERE ((o.wbs_item_id = wbs_items.id) AND ((o.team_id = ( SELECT m.team_id
           FROM public.memberships m
          WHERE (m.user_id = auth.uid()))) OR (o.team_id IN ( SELECT pm.team_id
           FROM public.project_members pm
          WHERE ((pm.project_id = wbs_items.project_id) AND (pm.user_id = auth.uid()) AND (pm.team_id IS NOT NULL))))))))));

-- 11. 남은 새 표·헬퍼·트리거 함수 ---------------------------------------------------
drop table public.people;
drop table public.profiles;            -- 읽기 정책이 workspace_members 를 읽는다
drop table public.workspace_members;
drop table public.platform_admins;
drop table public.workspaces;

drop function public.workspace_members_keep_last_admin();
drop function public.people_unlink_revokes_access();
drop function public.project_members_guard();
drop function public.project_members_no_self_demote();
drop function public.teams_guard();
drop function public.project_member_teams_guard();
drop function public.area_teams_guard();
drop function public.project_areas_guard();
drop function public.project_invites_guard();

drop function public.is_project_admin_anywhere_in_ws(uuid);
drop function public.my_team_ids(uuid);
drop function public.my_member_id(uuid);
drop function public.accessible_project_ids();
drop function public.project_ws(uuid);
drop function public.is_ws_admin(uuid);
drop function public.is_ws_member(uuid);
drop function public.my_workspace_ids();

commit;
