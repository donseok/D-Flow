-- 0011_authz_hardening — 권한 하드닝 H2. 정본: docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md §6.2.0
-- H2 a~i 와 §8.1 #4(실적 100 잠금 절). 원장: .superpowers/review-triage/parts-7-8-synthesis.md §3.
-- 절 순서: ① 마지막 슈퍼유저(a) ② 쓰지 않는 표 권한(b) ③ minutes.share_token 열 권한(c) ④ 소속 회수 = 권한 소멸(d)
--          ⑤ access_granted_* 열(e) ⑥ can_manage_minute = 앱 canEditMinute(f) ⑦ 회의록 버킷 entity 별 정책 + 첨부 객체 존재 확인 RPC(g)
--          ⑧ 첨부 insert 가드(h) ⑨ 승인·반려 보고 id 대조(i) ⑩ 실적 100 잠금 절(WF-GAP-1) ⑪ 사후검증.
-- 새 함수는 revoke/grant 를 명시한다 — 새 함수는 PUBLIC(내장 기본값 — 따라서 anon)과 authenticated·service_role(postgres 의 public
-- 기본 권한)의 EXECUTE 를 받고 생긴다. 회수는 `revoke all … from public, anon, authenticated` 꼴 — authenticated 만 회수하면 PUBLIC 으로 남는다.
-- CLI 가 파일 하나를 한 트랜잭션으로 적용하므로 begin/commit 을 쓰지 않는다. 롤백: supabase/rollbacks/0011_authz_hardening_rollback.sql.

-- ① 마지막 슈퍼유저(a, AUTH-04) ---------------------------------------------------------------------------------------
-- 정책 platform_admins_write(0003, ALL is_superuser)를 걷는다 — 플랫폼 관리자 변경은 서버 경로(service_role, accounts.ts)로만 한다.
-- 앱의 사전 count(accounts.ts)는 경합에 안전하지 않다: 두 슈퍼유저가 서로를 동시에 해제하면 둘 다 통과한다. 판정을 DB 로 옮긴다.
drop policy platform_admins_write on public.platform_admins;
revoke insert, update, delete, truncate on public.platform_admins from authenticated;

create function public.platform_admins_keep_last() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 같은 계정 행의 UPDATE(granted_by 의 SET NULL 캐스케이드, granted_at 정정)는 슈퍼유저 수를 바꾸지 않는다
  if tg_op = 'UPDATE' and new.user_id = old.user_id then
    return new;
  end if;
  -- auth.users 삭제의 캐스케이드는 면제한다(스펙 §8.2 ④) — dev-bootstrap 의 실패 롤백(방금 만든 계정 삭제)이 이 경로라 막으면
  -- 슈퍼유저 행만 남은 반쪽 상태로 끝난다. 캐스케이드 시점에는 부모 행이 이미 지워져 있다(0008 workspace_members_keep_last_admin 선례).
  -- 이 반환은 아래 격리 수준 검사보다 앞이다 — GoTrue deleteUser·부트스트랩 롤백은 트랜잭션의 격리 수준과 무관하게 통과한다.
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  -- 직렬화는 advisory 잠금으로 한다. 남은 행에 행 잠금을 걸면 두 연결이 서로를 해제할 때 서로의 행을 기다려 40P01 이 난다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.platform_admins_keep_last'));
  -- 격리 수준 규칙(0011 ①·⑧·⑨·⑩ 공통): 잠금 아래에서 다른 행을 읽어 판정하는 가드는 read committed 가 아니면 거절한다(fail-closed, 25001).
  -- read committed 는 문장마다 새 스냅샷이라 잠금을 얻은 뒤의 조회가 앞 연결의 커밋을 본다. repeatable read·serializable 은 트랜잭션 스냅샷
  -- 하나로 읽어 잠금을 기다리는 사이(또는 스냅샷 뒤에) 커밋된 변경을 못 본다. serializable 의 SSI 는 두 트랜잭션이 모두 serializable 일 때만
  -- 한쪽을 중단하는데 상대(PostgREST·서버 경로)는 read committed 로 들어온다. 이름으로 판정하므로 read uncommitted 도 거절한다.
  -- 이 가드에서 놓치는 것: 앞 연결이 커밋한 해제 — 두 연결이 남은 둘을 서로 지우면 0명이 된다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'PLATFORM_ADMIN_ISOLATION';
  end if;
  if not exists (select 1 from public.platform_admins a where a.user_id <> old.user_id) then
    raise exception using errcode = '23514', message = 'PLATFORM_LAST_ADMIN';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function public.platform_admins_keep_last() from public, anon, authenticated;
create trigger platform_admins_keep_last before update or delete on public.platform_admins
  for each row execute function public.platform_admins_keep_last();

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_admins' and cmd <> 'SELECT') then
    raise exception 'AUTHZ_0011_POSTCHECK: platform_admins 쓰기 정책이 남았다';
  end if;
  if has_table_privilege('authenticated', 'public.platform_admins', 'INSERT, UPDATE, DELETE, TRUNCATE') then
    raise exception 'AUTHZ_0011_POSTCHECK: authenticated 가 platform_admins 쓰기 권한을 가진다';
  end if;
end $$;

-- ② 쓰지 않는 표 권한(b, AUTH-12) -------------------------------------------------------------------------------------
-- anon·authenticated 는 표를 truncate·trigger·references·maintain 할 일이 없다. 0000~0003 의 grant all(예 0003:633·643·656…)과
-- postgres 기본 권한(arwdDxtm)이 준 것이다. 기본 권한에서도 빼 새 표가 다시 받지 않게 한다. supabase_admin 의 기본 권한은
-- postgres 가 바꿀 수 없다(그 롤의 구성원이 아니다) — 마이그레이션은 postgres 로 표를 만들므로 영향이 없다.
-- 함수의 PUBLIC EXECUTE 기본값은 이 마이그레이션의 범위 밖이다(스펙 §6.2.0 b) — 새 함수마다 revoke/grant 를 명시하는 것으로 대신한다.
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate, references, trigger, maintain on tables from anon, authenticated;

-- 권한은 있는데 그 명령의 정책이 없는 DML(RLS 가 늘 거부하는 명령)은 명령 단위로 회수한다. 쓰이는 명령은 정책이 있어 목록에 없다
-- (change_logs INSERT, issue_assignees INSERT·DELETE 등). SELECT 는 이 절의 대상이 아니다.
revoke insert, update, delete on public.agent_lead_leases from authenticated;
revoke insert, update, delete on public.agent_watchers from authenticated;
revoke update, delete on public.change_logs from authenticated;
revoke update on public.deliverable_attachments from authenticated;
revoke update on public.issue_assignees from authenticated;
revoke insert, update, delete on public.minute_embeddings from authenticated;
revoke update on public.minute_highlights from authenticated;
revoke insert, update, delete on public.minute_insights from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.project_ai_briefs from authenticated;
revoke delete on public.teams from authenticated;
revoke insert, update, delete on public.wbs_embeddings from authenticated;
revoke insert, update, delete on public.workspaces from authenticated;

-- 사후검증은 실효 권한으로 본다(has_*_privilege) — anon·authenticated 에 직접 준 것뿐 아니라 PUBLIC grant, 롤 상속, 열 단위
-- REFERENCES 까지 잡는다. 기본 권한은 has_* 함수가 없어 PUBLIC(grantee 0)과 두 롤이 상속받는 롤의 항목을 aclexplode 로 본다.
do $$
declare v text;
begin
  select string_agg(format('%s:%s:%s', c.relname, r.role, p.priv), ', ' order by c.relname, r.role, p.priv) into v
    from pg_class c
   cross join unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest(array['TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN']) as p(priv)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege(r.role, c.oid, p.priv)
          or (p.priv = 'REFERENCES' and has_any_column_privilege(r.role, c.oid, 'REFERENCES')));
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 표 권한이 남았다: %', left(v, 800); end if;
  select string_agg(format('%s:%s', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type), ', '
                    order by a.grantee, a.privilege_type) into v
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   -- 스키마 없는(전역, defaclnamespace 0) 항목도 본다 — 전역 기본 권한은 스키마 항목에 더해져 뒤에 만드는 표가 다시 받는다
   where d.defaclrole = 'postgres'::regrole and d.defaclnamespace in (0, 'public'::regnamespace) and d.defaclobjtype = 'r'
     and (case when a.grantee = 0 then true
               else pg_has_role('anon', a.grantee, 'USAGE') or pg_has_role('authenticated', a.grantee, 'USAGE') end)
     and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN');
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 기본 권한이 남았다: %', v; end if;
end $$;

-- ③ minutes.share_token 열 권한(c, AUTH-10a) --------------------------------------------------------------------------
-- minutes_ws_read 가 행 전체를 열어 회의록을 읽는 멤버가 공개 토큰을 읽었다(편집자 전용 공개 게이트 setMinuteShare 우회). 표 SELECT 를
-- 걷고 share_token 을 뺀 열에만 준다. 토큰은 서버 경로(readShareRow 의 service_role, 공개 페이지)만 읽는다.
-- minutes 에 열을 더하는 마이그레이션은 그 열의 grant select 를 함께 적는다(tests/rls/h2-share-token.test.ts 불변식이 잡는다).
revoke select on public.minutes from authenticated;
grant select (id, minute_date, team_code, title, body_md, meeting_id, created_by, created_by_name, created_at, updated_at,
              share_enabled, external_id, body_preview, folder_id, project_id, meeting_occurrence_date, archived_at, workspace_id)
  on public.minutes to authenticated;

do $$
declare v text;
begin
  if has_table_privilege('authenticated', 'public.minutes', 'SELECT')
     or has_column_privilege('authenticated', 'public.minutes', 'share_token', 'SELECT') then
    raise exception 'AUTHZ_0011_POSTCHECK: authenticated 가 minutes.share_token 을 읽는다';
  end if;
  select string_agg(a.attname, ', ') into v from pg_attribute a
   where a.attrelid = 'public.minutes'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'share_token'
     and not has_column_privilege('authenticated', 'public.minutes', a.attname, 'SELECT');
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: minutes 열 grant 누락: %', v; end if;
end $$;

-- ④ 소속 회수 = 권한 소멸(d, AUTH-01b) -------------------------------------------------------------------------------
-- ⓪ 사전 검사 — 소속이 없는데 권한이 남은 명단 행이 있으면 멈춘다(보정하지 않는다). 사람이 정리한 뒤 다시 적용한다.
-- 소속이 없는 사람의 명단 권한은 0009 부터 SQL 헬퍼·buildActor 에서 이미 무효라 access_role 을 null 로 하는 것이 권장 정리다.
do $$
declare
  v_n int;
  v_rows text;
begin
  select count(*), string_agg(format('(project %s, person %s)', pm.project_id, pm.person_id), ', '
                              order by pm.project_id, pm.person_id) into v_n, v_rows
    from public.project_members pm
    join public.people pe on pe.id = pm.person_id
    join public.projects p on p.id = pm.project_id
   where pm.access_role is not null and pe.user_id is not null
     and not exists (select 1 from public.workspace_members m where m.workspace_id = p.workspace_id and m.user_id = pe.user_id);
  if v_n > 0 then
    raise exception 'AUTHZ_0011_PRECHECK: 워크스페이스 소속이 없는 계정의 명단 권한 %건: % — 행마다 access_role 을 null 로 하거나'
                    ' (update public.project_members set access_role = null where project_id = … and person_id = …) 그 계정의'
                    ' 워크스페이스 소속을 되살린 뒤, 정리한 SQL 을 기록으로 남기고 다시 적용한다', v_n, left(v_rows, 600)
      using errcode = '23514';
  end if;
end $$;

-- 소속이 사라지면(삭제, 또는 user_id·workspace_id 변경) 그 워크스페이스 명단 행의 권한을 null 로 만든다. 행은 남긴다(이력·담당 FK).
-- 재초대(consume_project_invite)는 admin > member > null 의 최대값을 쓰므로 이것이 없으면 남은 admin 이 되살아났다(0008:96-110).
-- 인물은 워크스페이스 단위이고 명단 행의 인물·프로젝트는 같은 워크스페이스다(project_members_guard).
create function public.workspace_members_revoke_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id = old.user_id and new.workspace_id = old.workspace_id then
    return null;
  end if;
  update public.project_members pm
     set access_role = null
   where pm.access_role is not null
     and pm.person_id in (select pe.id from public.people pe
                           where pe.user_id = old.user_id and pe.workspace_id = old.workspace_id);
  return null;
end
$$;
revoke all on function public.workspace_members_revoke_access() from public, anon, authenticated;
create trigger workspace_members_revoke_access after delete or update of user_id, workspace_id on public.workspace_members
  for each row execute function public.workspace_members_revoke_access();

-- 본인 강등 금지는 소속이 있는 세션 사용자에게만 — 위 트리거의 갱신이 본인 claims 에서 일어나도(소속이 이미 지워진 뒤) 막지 않는다.
-- 이 조건이 없으면 tests/rls/workspace-isolation-cases.test.ts ⓐ·ⓐ′(소속 삭제)가 PROJECT_MEMBER_SELF_DEMOTE 로 깨진다.
create or replace function public.project_members_no_self_demote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or old.access_role is null then
    return new;
  end if;
  if (new.access_role is null
      or (old.access_role = 'admin' and new.access_role = 'member')
      or (old.active and not new.active))
     and exists (select 1 from public.people pe where pe.id = old.person_id and pe.user_id = auth.uid())
     and not public.is_ws_admin(public.project_ws(old.project_id))
     and public.is_ws_member(public.project_ws(old.project_id)) then
    raise exception using errcode = '42501', message = 'PROJECT_MEMBER_SELF_DEMOTE';
  end if;
  return new;
end
$$;

-- 세션은 UPDATE 로 소속의 등급만 바꾼다 — user_id·workspace_id 를 바꿔 소속을 옮기거나 invited_by 를 고치지 못한다.
-- 표 INSERT 는 남는다(workspace_members_write 정책의 워크스페이스 관리자) — INSERT 의 invited_by 는 SP3a(authz_events)로 넘긴다.
revoke update on public.workspace_members from authenticated;
grant update (role) on public.workspace_members to authenticated;

create or replace function public.upsert_project_member(
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
  -- 명단 admin 은 그 워크스페이스 소속일 때만 호출자 자격이다(0011 H2-d) — 소속 회수 뒤 남은 admin 행으로 명단을 쓰지 못한다
  if not v_ws_admin and not (
       exists (select 1 from public.workspace_members m where m.workspace_id = v_ws and m.user_id = p_actor)
       and exists (
       select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
        where pm.project_id = p_project_id and pe.user_id = p_actor
          and pm.active and pe.active and pm.access_role = 'admin')) then
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
    -- 개명은 id 로 행을 지목한 편집에서만, 그것도 people_update 정책과 같은 선에서만(0004): 워크스페이스 관리자 이상이거나
    -- 그 인물이 이번 upsert 전부터 호출자가 관리자인 프로젝트의 명단에 있을 때. 아니면 이름은 두고 명단 쓰기만 진행한다.
    if v_name is not null and v_name is distinct from v_person_name
       and (v_ws_admin or (exists (select 1 from public.workspace_members m where m.workspace_id = v_ws and m.user_id = p_actor)
            and exists (
             select 1 from public.project_members pm
              where pm.person_id = v_person_id
                and exists (select 1 from public.project_members apm join public.people ape on ape.id = apm.person_id
                             where apm.project_id = pm.project_id and ape.user_id = p_actor
                               and apm.active and ape.active and apm.access_role = 'admin')))) then
      update public.people set display_name = v_name, updated_at = now() where id = v_person_id;
    end if;
  else
    if v_name is null then
      raise exception using errcode = '22023', message = 'PERSON_NAME_REQUIRED';
    end if;
    if v_email is not null then
      insert into public.people (workspace_id, display_name, email)
      values (v_ws, v_name, v_email)
      on conflict (workspace_id, email) where email is not null do nothing
      returning id, user_id, display_name into v_person_id, v_person_user, v_person_name;
      -- 이미 있는 인물이면 가리키기만 한다 — 이름은 그 인물의 것이라 입력 이름으로 덮지 않는다(0004)
      if not found then
        select pe.id, pe.user_id, pe.display_name into v_person_id, v_person_user, v_person_name
          from public.people pe where pe.workspace_id = v_ws and pe.email = v_email
           for update;
      end if;
    else
      insert into public.people (workspace_id, display_name)
      values (v_ws, v_name)
      returning id, user_id, display_name into v_person_id, v_person_user, v_person_name;
    end if;
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

  -- ⑥ 팀 동기화 — 결과는 p_team_ids 와 같은 집합이고, 첫 비-null 원소만 대표(is_primary), 나머지는 기존 행이던 것까지
  -- 전부 대표 아님. 대표를 먼저 내리고(부분 유니크 project_member_teams_primary_uidx) upsert 가 모든 행의 is_primary 를 다시 쓴다.
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

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'workspace_members_revoke_access' and tgrelid = 'public.workspace_members'::regclass) then
    raise exception 'AUTHZ_0011_POSTCHECK: workspace_members_revoke_access 트리거가 없다';
  end if;
  -- 열 단위도 실효 권한으로 본다 — authenticated 나 PUBLIC 에 준 role 밖 열의 UPDATE 는 표 revoke 로 걷히지 않을 수 있다(PUBLIC)
  if has_table_privilege('authenticated', 'public.workspace_members', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.workspace_members', 'role', 'UPDATE')
     or exists (select 1 from pg_attribute a
                 where a.attrelid = 'public.workspace_members'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'role'
                   and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE')) then
    raise exception 'AUTHZ_0011_POSTCHECK: workspace_members UPDATE 권한이 role 열만이 아니다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.upsert_project_member(uuid, uuid, jsonb, jsonb, uuid[])'::regprocedure)
     !~ 'workspace_members m where m.workspace_id = v_ws and m.user_id = p_actor' then
    raise exception 'AUTHZ_0011_POSTCHECK: upsert_project_member 에 호출자 소속 조건이 없다';
  end if;
end $$;

-- ⑤ access_granted_* 열(e, AUTH-09a, 선택 동승) --------------------------------------------------------------------------
-- 세션이 부여자·부여 시각을 위조하지 못하게 열 권한을 걷고, 세션 경로의 부여자는 가드가 auth.uid() 로 찍는다(0008 ③ 이
-- project_invites.created_by 를 불변으로 만든 목적과 같다). service_role 경로(auth.uid() null)는 RPC 가 넘긴 p_actor 를 그대로 두고,
-- 발급자 계정 삭제의 FK SET NULL 은 역할이 바뀌지 않는 UPDATE 라 건드리지 않는다. invited_by 는 SP3a(authz_events)로 넘긴다.
revoke update (access_granted_by, access_granted_at) on public.project_members from authenticated;
revoke insert on public.project_members from authenticated;
grant insert (id, project_id, title, created_at, role_label, person_id, access_role, active, sort_order, updated_at)
  on public.project_members to authenticated;

create or replace function public.project_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_person_ws uuid;
  v_person_user uuid;
  v_stamp boolean;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    -- 담당 FK 가 (id, project_id) 복합이라 바꾸면 FK 가 깨진다
    raise exception using errcode = '23514', message = 'PROJECT_MEMBER_PROJECT_IMMUTABLE';
  end if;

  select pe.workspace_id, pe.user_id into v_person_ws, v_person_user
    from public.people pe where pe.id = new.person_id;
  if found then
    -- 계정 없는 인물의 역할은 역할을 주거나 옮기는 문장(INSERT·역할 변경·인물 변경)에서만 거부한다. 계정 삭제 캐스케이드는
    -- people.user_id SET NULL 이 access_granted_by SET NULL(역할은 그대로인 UPDATE)보다 먼저 돌고 역할 회수(people_unlink_revokes_access)는
    -- 그 뒤라, 자기가 부여한 자기 명단 행(access_granted_by = 지워지는 계정)을 여기서 막으면 계정 삭제가 통째로 실패한다.
    if new.access_role is not null and v_person_user is null
       and (tg_op = 'INSERT' or new.access_role is distinct from old.access_role or new.person_id is distinct from old.person_id) then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT';
    end if;
    if v_person_ws is distinct from public.project_ws(new.project_id) then
      raise exception using errcode = '23514', message = 'PROJECT_MEMBER_CROSS_WORKSPACE';
    end if;
  end if;
  -- 인물이 없으면 person_id FK 가 거부한다

  -- 세션 경로의 부여자는 세션 사용자다(0011 H2-e). service_role 경로(auth.uid() null)는 RPC 가 넣은 값을 둔다.
  -- 세션 사용자의 계정이 이 문장에서 지워지는 중이면(본인 claims 로 auth.users 삭제 → 캐스케이드가 역할 회수) 찍지 않는다 — 없는 계정을
  -- 찍으면 access_granted_by FK 가 23503 으로 삭제를 막는다. 그때는 문장이 준 값(캐스케이드면 FK 의 SET NULL)을 둔다.
  -- auth.users 는 이 함수가 DEFINER(소유자 postgres)라 읽힌다. 호출자에게 돌려주는 것은 없다(트리거 전용, 실행 권한 회수).
  v_stamp := auth.uid() is not null and exists (select 1 from auth.users u where u.id = auth.uid());

  if tg_op = 'INSERT' then
    new.access_granted_at := case when new.access_role is not null then now() end;
    if v_stamp then
      new.access_granted_by := case when new.access_role is not null then auth.uid() end;
    end if;
  else
    if new.access_role is distinct from old.access_role then
      new.access_granted_at := now();
      if v_stamp then
        new.access_granted_by := auth.uid();
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;

do $$
begin
  if has_table_privilege('authenticated', 'public.project_members', 'INSERT')
     or has_column_privilege('authenticated', 'public.project_members', 'access_granted_by', 'INSERT')
     or has_column_privilege('authenticated', 'public.project_members', 'access_granted_by', 'UPDATE')
     or has_column_privilege('authenticated', 'public.project_members', 'access_granted_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.project_members', 'access_granted_at', 'UPDATE') then
    raise exception 'AUTHZ_0011_POSTCHECK: authenticated 가 project_members.access_granted_* 를 쓸 수 있다(표 INSERT 또는 열 INSERT·UPDATE)';
  end if;
  if (select prosrc from pg_proc where oid = 'public.project_members_guard()'::regprocedure) !~ 'auth\.uid\(\)' then
    raise exception 'AUTHZ_0011_POSTCHECK: project_members_guard 가 세션 부여자(auth.uid())를 찍지 않는다';
  end if;
end $$;

-- ⑥ can_manage_minute = 앱 canEditMinute(f, P8-H2-3) ----------------------------------------------------------------
-- 앱 판정(authz.ts canEditMinute) = 범위 멤버 ∧ (작성자 ∨ 프로젝트 관리자 이상). SQL 은 작성자면 멤버 여부와 무관하게 참이었다
-- (AUTH-02 의 SQL 쪽 절반). 무프로젝트 회의록의 워크스페이스 관리자 칸은 유지한다 — 앱은 슈퍼유저만 여는 의도된 fail-closed
-- (SP1 §3.5)이고 SQL 이 더 넓다. 앱이 더 좁으므로 권한 확대가 없다(AUTH-11, 스펙 §8.2 ③ — 패리티 표의 유일한 예외).
-- has_project_role_in_ws = authz.ts hasProjectRoleInWorkspace: 워크스페이스 관리자(슈퍼유저 포함) 또는 그 워크스페이스 소속이면서
-- 그 워크스페이스 프로젝트의 활성 명단 행에 권한이 있음.
create function public.has_project_role_in_ws(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_ws_admin(wid)
      or (public.is_ws_member(wid)
          and exists (select 1 from public.project_members pm
                        join public.people pe on pe.id = pm.person_id
                        join public.projects p on p.id = pm.project_id
                       where p.workspace_id = wid and pe.user_id = auth.uid()
                         and pm.active and pe.active and pm.access_role is not null))
$$;
revoke all on function public.has_project_role_in_ws(uuid) from public, anon;
grant execute on function public.has_project_role_in_ws(uuid) to authenticated, service_role;

create or replace function public.can_manage_minute(p_minute uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.minutes mi
                  where mi.id = p_minute and mi.archived_at is null
                    and mi.workspace_id in (select public.my_workspace_ids())
                    and case when mi.project_id is not null
                             then public.is_project_admin(mi.project_id)
                                  or (mi.created_by = auth.uid() and public.is_project_member(mi.project_id))
                             else public.is_superuser()
                                  or (mi.created_by = auth.uid() and public.has_project_role_in_ws(mi.workspace_id))
                                  or public.is_ws_admin(mi.workspace_id) end)
$$;

-- ⑦ 회의록 버킷 entity 별 정책(g, P8-H2-2) + 첨부 객체 존재 확인 RPC(H1 이월) -------------------------------------------------
-- 0007 의 minutes 버킷 insert 는 entity 를 in ('minutes','minute-files') 로만 봐 멤버가 남의 회의록 경로에 고아 파일을 채웠고, delete 는
-- 소유자 ∨ ws 관리자라 행 삭제(can_manage_minute — 프로젝트 관리자 포함)보다 좁았다. 본문(minutes) entity 는 0007 술어 그대로 두고
-- (minute_versions WORM 가드 포함), 첨부(minute-files)에 회의록 관리 권한 정책을 따로 둔다.
drop policy "minutes bucket insert" on storage.objects;
create policy "minutes bucket insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'minutes' and split_part(name, '/', 5) = 'minutes'
  and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (public.storage_project(name) is null
       or exists (select 1 from public.projects p
                   where p.id = public.storage_project(objects.name) and p.workspace_id = public.storage_ws(objects.name)
                     and public.is_project_member(p.id))));
drop policy "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated using (
  bucket_id = 'minutes' and split_part(name, '/', 5) = 'minutes'
  and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (owner = auth.uid() or public.is_ws_admin(public.storage_ws(name)))
  and not exists (select 1 from public.minute_versions mv where mv.file_path = objects.name));
-- 첨부 삽입: 그 회의록을 관리할 수 있고 경로의 워크스페이스·프로젝트가 회의록 행과 같다(프로젝트는 is not distinct from — 무프로젝트 '_')
create policy "minute-files insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'minutes' and split_part(name, '/', 5) = 'minute-files'
  and public.storage_ws(name) is not null
  and public.can_manage_minute(public.storage_entity_id(name))
  and exists (select 1 from public.minutes mi
               where mi.id = public.storage_entity_id(objects.name) and mi.workspace_id = public.storage_ws(objects.name)
                 and mi.project_id is not distinct from public.storage_project(objects.name)));
-- 첨부 삭제: 관리 권한 ∧ 워크스페이스 일치, 또는 ws 관리자, 또는 (올린 사람 ∧ 소속 ∧ 어떤 첨부 행도 참조하지 않음 — 확정 실패·
-- 보관 뒤의 보상 삭제). 프로젝트 세그먼트는 보지 않는다 — 회의록을 다른 프로젝트로 옮겨도 파일 경로는 그대로다. 소속을 요구하는
-- 이유: 참조 행 서브쿼리는 호출자의 RLS 로 돈다 — 워크스페이스를 떠난 소유자에게는 참조 행이 가려져 '미참조'로 보인다.
create policy "minute-files delete" on storage.objects for delete to authenticated using (
  bucket_id = 'minutes' and split_part(name, '/', 5) = 'minute-files'
  and public.storage_ws(name) is not null
  and ((public.can_manage_minute(public.storage_entity_id(name))
        and exists (select 1 from public.minutes mi
                     where mi.id = public.storage_entity_id(objects.name) and mi.workspace_id = public.storage_ws(objects.name)))
       or public.is_ws_admin(public.storage_ws(name))
       or (owner = auth.uid() and public.is_ws_member(public.storage_ws(name))
           and not exists (select 1 from public.minute_files mf where mf.file_path = objects.name))));

-- 첨부 객체 존재 확인 — 세 첨부 삭제 경로(src/lib/attachments/removeStoredAttachment.ts)가 Storage 삭제 0건일 때 부른다. 세션의
-- exists() 는 '없음'과 '읽을 수 없음'을 가르지 못한다(옛 형식 경로·옮긴 회의록). 첨부 행 id 로만 묻고(경로를 받지 않는다) 그 첨부의
-- 삭제 권한(버킷 삭제 정책과 같은 판정)이 있는 호출자에게만 답한다 — 없거나 행이 없으면 42501(존재를 흘리지 않는다).
-- 행의 경로가 그 행의 범위일 때만 답한다: 경로의 워크스페이스 = 행의 항목·이슈·회의록의 워크스페이스, entity 세그먼트 = 그 종류,
-- entity id = 행의 wbs_item_id·issue_id·minute_id. 산출물·이슈 첨부 표의 insert 정책은 file_path 를 보지 않아(경로 검사는 SP5) 자기 항목에
-- 남의 워크스페이스 경로를 적은 행으로 존재를 캘 수 있었다(리뷰 I1). 범위 밖 경로(옛 형식 포함)는 권한 없음과 같은 42501 이다 — 가를 수
-- 없게. 회의록 첨부는 프로젝트 세그먼트를 보지 않는다(회의록을 옮겨도 경로는 그대로 — minute-files 삭제 정책과 같다).
-- service_role 은 세션 사용자가 없어(auth.uid() null) 세 판정이 모두 거짓이라 늘 ATTACHMENT_FORBIDDEN 이다. 앱은 세션 클라이언트로만
-- 부른다(removeStoredAttachment 가 받는 db) — service_role 부여는 정책 헬퍼 관례(authenticated·service_role)를 따른 것이다.
create function public.attachment_object_exists(p_kind text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bucket text;
  v_path text;
  v_allowed boolean;
begin
  if p_kind = 'deliverable' then
    select 'deliverables', a.file_path,
           public.can_attach(a.wbs_item_id)
           and public.storage_ws(a.file_path) = p.workspace_id
           and split_part(a.file_path, '/', 5) = 'deliverables'
           and public.storage_entity_id(a.file_path) = a.wbs_item_id
      into v_bucket, v_path, v_allowed
      from public.deliverable_attachments a
      join public.wbs_items w on w.id = a.wbs_item_id
      join public.projects p on p.id = w.project_id
     where a.id = p_id;
  elsif p_kind = 'issue' then
    select 'issue-attachments', a.file_path,
           public.can_edit_issue(a.issue_id)
           and public.storage_ws(a.file_path) = p.workspace_id
           and split_part(a.file_path, '/', 5) = 'issue-attachments'
           and public.storage_entity_id(a.file_path) = a.issue_id
      into v_bucket, v_path, v_allowed
      from public.issue_attachments a
      join public.issues i on i.id = a.issue_id
      join public.projects p on p.id = i.project_id
     where a.id = p_id;
  elsif p_kind = 'minute' then
    select 'minutes', f.file_path,
           public.can_manage_minute(f.minute_id)
           and public.storage_ws(f.file_path) = mi.workspace_id
           and split_part(f.file_path, '/', 5) = 'minute-files'
           and public.storage_entity_id(f.file_path) = f.minute_id
      into v_bucket, v_path, v_allowed
      from public.minute_files f
      join public.minutes mi on mi.id = f.minute_id
     where f.id = p_id and f.role = 'attachment';
  else
    raise exception using errcode = '22023', message = 'ATTACHMENT_KIND_INVALID';
  end if;
  if v_path is null or not coalesce(v_allowed, false) then
    raise exception using errcode = '42501', message = 'ATTACHMENT_FORBIDDEN';
  end if;
  return exists (select 1 from storage.objects o where o.bucket_id = v_bucket and o.name = v_path);
end
$$;
revoke all on function public.attachment_object_exists(text, uuid) from public, anon;
grant execute on function public.attachment_object_exists(text, uuid) to authenticated, service_role;

-- ⑧ 첨부 insert 가드(h, P8-H2-1 — WF-GAP-1 과 같은 PostgREST 직접 쓰기 차단) ----------------------------------------------
-- 사전 검사: 같은 경로의 첨부 행이 둘 이상이면 부분 유니크 인덱스를 만들 수 없다 — 멈추고 사람이 정리한다.
do $$
declare v text;
begin
  select string_agg(d.file_path, ', ') into v
    from (select file_path from public.minute_files where role = 'attachment' group by file_path having count(*) > 1) d;
  if v is not null then
    raise exception 'AUTHZ_0011_PRECHECK: 첨부 경로 중복(%) — 중복 행을 지운 뒤 다시 적용한다', left(v, 400) using errcode = '23505';
  end if;
end $$;

create unique index minute_files_attachment_path_uidx on public.minute_files (file_path) where role = 'attachment';

-- 첨부는 추가·삭제만 한다 — UPDATE 로 경로·크기를 바꾸면 아래 가드를 건너뛴다
drop policy attachment_update_minute_files on public.minute_files;
revoke update on public.minute_files from authenticated;

create function public.minute_files_attachment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_project uuid;
  v_archived timestamptz;
  v_owner uuid;
  v_meta jsonb;
begin
  -- ① 관리할 수 없는 세션은 RLS(attachment_insert_minute_files)가 42501 로 거부한다 — 가드가 먼저 다른 오류를 내면 격리 탐침
  --    (tests/rls/isolation-map.ts OWN_INSERT_PROBES minute_files)이 RLS 거부를 보지 못한다. service_role(auth.uid() null)도 여기서 통과.
  if not public.can_manage_minute(new.minute_id) then
    return new;
  end if;
  -- ② 회의록 행을 잠근다 — 같은 회의록의 첨부 확정을 직렬화하고(개수 경합) 그사이의 보관을 본다
  select mi.workspace_id, mi.project_id, mi.archived_at into v_ws, v_project, v_archived
    from public.minutes mi where mi.id = new.minute_id for no key update;
  -- 격리 수준 규칙(0011 ①·⑧·⑨·⑩ 공통): 잠금 아래에서 다른 행을 읽어 판정하는 가드는 read committed 가 아니면 거절한다(fail-closed, 25001).
  -- read committed 는 문장마다 새 스냅샷이라 잠금을 얻은 뒤의 조회가 앞 연결의 커밋을 본다. repeatable read·serializable 은 트랜잭션 스냅샷
  -- 하나로 읽어 잠금을 기다리는 사이(또는 스냅샷 뒤에) 커밋된 변경을 못 본다. serializable 의 SSI 는 두 트랜잭션이 모두 serializable 일 때만
  -- 한쪽을 중단하는데 상대(PostgREST·서버 경로)는 read committed 로 들어온다. 이름으로 판정하므로 read uncommitted 도 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 넘겨준 앞 연결이 커밋한 첨부 행·권한 회수 — 11개째가 들어가거나 회수된 권한으로 확정된다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'MINUTE_ATTACHMENT_ISOLATION';
  end if;
  if v_archived is not null then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_ARCHIVED';
  end if;
  -- 잠금을 기다리는 사이 커밋된 권한 회수(명단·소속·작성자)를 본다 — ① 과 RLS WITH CHECK 는 기다리기 전의 스냅샷으로 판정했다.
  -- 이 문장은 새 스냅샷이다(read committed). 앱이 사용자 문구로 옮기는 다섯 코드와 겹치지 않는 이름을 쓴다(모르는 코드 = 일반 문구 + 로그).
  if not public.can_manage_minute(new.minute_id) then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_FORBIDDEN';
  end if;
  -- ③ 경로 = ws/<회의록 ws>/p/<회의록 프로젝트|_>/minute-files/<회의록 id>/<파일>(프로젝트는 is not distinct from)
  if not coalesce(public.storage_ws(new.file_path) = v_ws
                  and public.storage_project(new.file_path) is not distinct from v_project
                  and split_part(new.file_path, '/', 5) = 'minute-files'
                  and public.storage_entity_id(new.file_path) = new.minute_id, false) then
    raise exception using errcode = '22023', message = 'MINUTE_ATTACHMENT_PATH';
  end if;
  -- ④ 객체는 이 세션이 올린 것이고, 크기·형식은 객체 메타데이터 값이다(클라이언트 선언값을 믿지 않는다)
  select o.owner, o.metadata into v_owner, v_meta
    from storage.objects o where o.bucket_id = 'minutes' and o.name = new.file_path;
  if not found or v_owner is distinct from auth.uid() or (v_meta ->> 'size') is null then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_OBJECT';
  end if;
  new.size := (v_meta ->> 'size')::bigint;
  new.mime := coalesce(nullif(v_meta ->> 'mimetype', ''), 'application/octet-stream');
  -- ⑤ 같은 경로 재전송은 중복 — 개수 검사보다 먼저(10개째 재전송이 '한도 초과'로 보이지 않게)
  if exists (select 1 from public.minute_files f where f.role = 'attachment' and f.file_path = new.file_path) then
    raise exception using errcode = '23505', message = 'MINUTE_ATTACHMENT_DUPLICATE';
  end if;
  -- ⑥ 운영 상한 10개(domain/minutes.ts MINUTE_ATTACHMENTS_MAX_COUNT, 스펙 §2.9.2). SP5 0017 이 minutes.attachments 설정을 읽게 바꾼다
  if (select count(*) from public.minute_files f where f.minute_id = new.minute_id and f.role = 'attachment') >= 10 then
    raise exception using errcode = '23514', message = 'MINUTE_ATTACHMENT_LIMIT';
  end if;
  return new;
end
$$;
revoke all on function public.minute_files_attachment_guard() from public, anon, authenticated;
create trigger minute_files_attachment_guard before insert on public.minute_files
  for each row when (new.role = 'attachment') execute function public.minute_files_attachment_guard();

-- ⑨ 승인·반려 보고 id 대조(i, H1 이월 과제 11) ---------------------------------------------------------------------------
-- 인자를 더하므로 drop + create 다(0000 원문, INVOKER·search_path 없음 유지 — 재작성은 SP5b 0020 이 이 인자를 잇는다).
-- 새 함수는 PUBLIC(내장 기본값 — anon 포함)과 authenticated·service_role(postgres 기본 권한)의 EXECUTE 를 받으므로
-- public, anon, authenticated 에서 모두 회수해 0000 의 ACL(service_role 만)로 되돌린다.
-- 0000 과 다른 곳은 둘이다: 머리의 여덟째 인자 p_expected_report_id, 주문 CAS 충돌 반환 바로 뒤의 '0011 H2-i' 블록.
-- 승인·반려는 늘 대조한다 — 인자를 생략하면 null = "보고 없음을 봤다" 라 보고가 있는 주문에서는 report_stale 이다.
drop function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid);
CREATE FUNCTION public.apply_workflow_event(p_event text, p_actor uuid, p_item_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_agent_user_id uuid DEFAULT NULL::uuid, p_expected_report_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
declare
  c_default constant jsonb := '{"default":{"as":0,"ip":30,"rw":50,"im":80,"xx":100}}'::jsonb;
  -- record 대신 스칼라를 쓴다: 항목이 지워진 주문처럼 SELECT INTO 를 건너뛴 경로에서 미할당 record 의
  -- 필드를 참조하면 CASE 의 안 타는 분기라도 "record is not assigned yet" 로 실패한다.
  v_is_order_event boolean;
  v_order_status text;
  v_order_claimed_by text;
  v_order_claimed_by_user uuid;
  v_order_item uuid;
  v_item_id uuid;
  v_item_found boolean := false;
  v_project_id uuid;
  v_old_stage text;
  v_old_pct numeric;
  v_dev_workflow boolean;
  v_tags text[];
  v_is_leaf boolean := false;
  v_expect text;
  v_next text;
  v_apply boolean := false;
  v_new_stage text;
  v_credit_key text;
  v_credits jsonb;
  v_table jsonb;
  v_new_pct numeric;
  v_skipped text;
  v_stage_changed boolean := false;
  v_actual_changed boolean := false;
  v_reached_first boolean := false;
  v_stub_pending boolean := false;
  v_now timestamptz := now();
begin
  if p_event is null or p_event not in ('assign','unassign','claim','report_completion','approve','unapprove','reject','rework','release','set_stage') then
    return jsonb_build_object('ok', false, 'reason', 'bad_event');
  end if;
  v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release');

  -- 주문 사건: 주문을 잠그고 사건이 정한 기대 status·점유자 조건으로 CAS
  if v_is_order_event then
    if p_order_id is null then
      return jsonb_build_object('ok', false, 'reason', 'order_required');
    end if;
    select status, claimed_by, claimed_by_user_id, wbs_item_id
      into v_order_status, v_order_claimed_by, v_order_claimed_by_user, v_order_item
      from public.agent_work_orders where id = p_order_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'order_not_found');
    end if;
    if p_item_id is not null and v_order_item is distinct from p_item_id then
      return jsonb_build_object('ok', false, 'reason', 'order_item_mismatch');
    end if;
    v_item_id := v_order_item;
    v_expect := case p_event
      when 'claim' then 'ready'
      when 'report_completion' then 'claimed'
      when 'release' then 'claimed'
      when 'approve' then 'reported'
      when 'reject' then 'reported'
      when 'unapprove' then 'approved'
      when 'rework' then 'approved' end;
    v_next := case p_event
      when 'claim' then 'claimed'
      when 'report_completion' then 'reported'
      when 'release' then 'ready'
      when 'approve' then 'approved'
      when 'reject' then 'claimed'
      when 'unapprove' then 'reported'
      when 'rework' then 'claimed' end;
    if v_order_status <> v_expect
       or (p_event in ('report_completion','release') and p_agent_user_id is not null and v_order_claimed_by_user is distinct from p_agent_user_id)
       or (p_event in ('report_completion','release') and p_agent is not null and v_order_claimed_by is distinct from p_agent)
    then
      return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
    end if;
    -- 사람이 본 completion 보고가 지금도 최신인가(0011 H2-i) — 주문 행 잠금 아래에서 본다. 앱의 checkReportFresh 와 이 전이 사이에
    -- 재보고가 끼면 여기서 막힌다. 순서는 앱(latestCompletionReportId)과 같다: created_at 내림차순, 같으면 id 가 큰 쪽. null = 보고 없음.
    if p_event in ('approve','reject') then
      -- 격리 수준 규칙(0011 ①·⑧·⑨·⑩ 공통): 잠금 아래에서 다른 행을 읽어 판정하는 가드는 read committed 가 아니면 거절한다(fail-closed, 25001).
      -- read committed 는 문장마다 새 스냅샷이라 잠금을 얻은 뒤의 조회가 앞 연결의 커밋을 본다. repeatable read·serializable 은 트랜잭션 스냅샷
      -- 하나로 읽어 잠금을 기다리는 사이(또는 스냅샷 뒤에) 커밋된 변경을 못 본다. serializable 의 SSI 는 두 트랜잭션이 모두 serializable 일 때만
      -- 한쪽을 중단하는데 상대(PostgREST·서버 경로)는 read committed 로 들어온다. 이름으로 판정하므로 read uncommitted 도 거절한다.
      -- 이 가드에서 놓치는 것: 주문 행 잠금을 기다리는 사이 커밋된 재보고 — 주문 행을 바꾸지 않는 재보고는 직렬화 오류도 내지 않는다.
      -- 위의 반환 셋(주문 없음·항목 불일치·CAS 충돌)은 잠근 주문 행의 값만 보고 아무것도 쓰지 않으므로 이 검사보다 앞에 둔다. 대조하지
      -- 않는 사건은 이 검사를 거치지 않는다.
      if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
        raise exception using errcode = '25001', message = 'WORKFLOW_EVENT_ISOLATION';
      end if;
      if p_expected_report_id is distinct from (
           select r.id from public.agent_work_reports r
            where r.work_order_id = p_order_id and r.kind = 'completion'
            order by r.created_at desc, r.id desc limit 1) then
        return jsonb_build_object('ok', false, 'reason', 'report_stale', 'stale', true, 'order_status', v_order_status);
      end if;
    end if;
  else
    if p_item_id is null then
      return jsonb_build_object('ok', false, 'reason', 'item_required');
    end if;
    v_item_id := p_item_id;
  end if;

  -- 항목 잠금. 주문 사건에서 항목이 지워진 주문이면 단계·실적만 건너뛴다(주문 전이는 한다).
  if v_item_id is not null then
    select project_id, stage, actual_pct, dev_workflow, tags
      into v_project_id, v_old_stage, v_old_pct, v_dev_workflow, v_tags
      from public.wbs_items where id = v_item_id for update;
    v_item_found := found;
    if v_item_found then
      -- stub_for 하위(스텁 제거 Task)는 구조에 투명하다(스펙 F9) — 후행은 계속 리프다.
      v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);
    elsif not v_is_order_event then
      return jsonb_build_object('ok', false, 'reason', 'item_not_found');
    end if;
  elsif not v_is_order_event then
    return jsonb_build_object('ok', false, 'reason', 'item_required');
  end if;

  -- 스텁 잔존(스펙 F6·F13) — forceProgress.pendingStubs 와 같은 조건. 승인과 사람의 xx 지정을 주문 갱신 전에 거부한다.
  if v_item_found then
    v_stub_pending := exists (select 1 from public.wbs_items
      where parent_id = v_item_id and stub_for is not null and stage is distinct from 'xx');
  end if;
  if v_stub_pending and (p_event = 'approve' or (p_event = 'set_stage' and p_stage = 'xx')) then
    return jsonb_build_object('ok', false, 'reason', 'stub_pending', 'order_status', v_order_status);
  end if;

  -- 주문 갱신
  if v_is_order_event then
    if p_event = 'claim' then
      update public.agent_work_orders
         set status = 'claimed', claimed_by = p_agent, claimed_by_user_id = p_agent_user_id,
             claimed_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'release' then
      update public.agent_work_orders
         set status = 'ready', claimed_by = null, claimed_by_user_id = null, claimed_at = null,
             last_heartbeat_at = null, heartbeat_phase = null, heartbeat_agent = null, heartbeat_note = null,
             updated_at = v_now
       where id = p_order_id;
    else
      update public.agent_work_orders set status = v_next, updated_at = v_now where id = p_order_id;
    end if;
  end if;

  -- 단계·실적 결정(스펙 §3.4·§4.2)
  if v_is_order_event then
    -- 주문의 존재가 워크플로 증거 — dev_workflow 를 보지 않는다(구 force 의 일반화). 리프에만.
    if not v_item_found then v_skipped := 'no_item';
    elsif not v_is_leaf then v_skipped := 'parent';
    else
      v_apply := true;
      v_new_stage := case p_event
        when 'claim' then 'ip' when 'report_completion' then 'im' when 'approve' then 'xx'
        when 'unapprove' then 'im' when 'reject' then 'ip' when 'rework' then 'ip' when 'release' then 'as' end;
      v_credit_key := case p_event
        when 'claim' then 'ip' when 'report_completion' then 'im' when 'approve' then 'xx'
        when 'unapprove' then 'im' when 'reject' then 'rw' when 'rework' then 'rw' when 'release' then 'as' end;
    end if;
  elsif p_event = 'assign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif not v_is_leaf then v_skipped := 'parent';
    elsif v_old_stage is not null then v_skipped := 'stage';
    else v_apply := true; v_new_stage := 'as'; v_credit_key := 'as';
    end if;
  elsif p_event = 'unassign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif v_old_stage is distinct from 'as' then v_skipped := 'stage';
    else v_apply := true; v_new_stage := null; v_credit_key := null;
    end if;
  else -- set_stage
    if p_stage is not null and p_stage not in ('as','ip','im','xx') then
      return jsonb_build_object('ok', false, 'reason', 'bad_stage');
    end if;
    -- 잠금(위임됨 ∨ 에이전트가 주문을 쥠)이면 해제(null)도 거부 — 단계는 승인·반려로만 바뀐다(§3.5).
    -- ready 는 넣지 않는다: dev_workflow 리프마다 배정과 무관하게 상주한다. 조건은 agentWork.stageLockedForHuman 과 같다.
    if 'agent' = any(coalesce(v_tags, '{}'::text[]))
       or exists (select 1 from public.agent_work_orders
                   where wbs_item_id = v_item_id and status in ('claimed','reported')) then
      return jsonb_build_object('ok', false, 'reason', 'locked');
    end if;
    if p_stage is null then
      -- 해제는 워크플로·리프와 무관하게 허용(잘못 찍힌 값을 지울 길). 실적 불변.
      v_apply := true; v_new_stage := null; v_credit_key := null;
    else
      if v_dev_workflow is not true then return jsonb_build_object('ok', false, 'reason', 'not_workflow'); end if;
      if not v_is_leaf then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
      v_apply := true; v_new_stage := p_stage; v_credit_key := p_stage;
    end if;
  end if;

  if v_apply then
    if v_credit_key = 'xx' then
      v_new_pct := 100;
    elsif v_credit_key is not null then
      select stage_credits into v_credits from public.project_settings where project_id = v_project_id;
      v_credits := coalesce(v_credits, c_default);
      -- 표는 하나다(2026-09-16) — 항목 credit_key 로 고르지 않는다.
      v_table := coalesce(v_credits -> 'default', c_default -> 'default');
      v_new_pct := coalesce((v_table ->> v_credit_key)::numeric, (c_default -> 'default' ->> v_credit_key)::numeric);
    end if;
    if v_new_stage is distinct from v_old_stage then
      v_stage_changed := true;
      v_reached_first := coalesce(v_new_stage in ('im','xx'), false) and not coalesce(v_old_stage in ('im','xx'), false);
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'stage', v_old_stage, v_new_stage);
    end if;
    if v_new_pct is not null and v_new_pct is distinct from v_old_pct then
      v_actual_changed := true;
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'actual_pct', v_old_pct::text, v_new_pct::text);
    end if;
    if v_stage_changed or v_actual_changed then
      update public.wbs_items
         set stage = case when v_stage_changed then v_new_stage else stage end,
             actual_pct = case when v_actual_changed then v_new_pct else actual_pct end,
             updated_at = v_now
       where id = v_item_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_status', case when v_is_order_event then v_next end,
    'stage', case when v_stage_changed then v_new_stage else v_old_stage end,
    'actual_pct', case when v_actual_changed then v_new_pct else v_old_pct end,
    'stage_changed', v_stage_changed,
    'actual_changed', v_actual_changed,
    'reached_first', v_reached_first,
    'skipped', v_skipped);
end;
$$;
revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid) to service_role;

-- ⑩ 실적 100 잠금 절(WF-GAP-1, 스펙 §3.3.5 첫 raise · §8.1 #4) ------------------------------------------------------------
-- 앱 updateActual(wbs.ts)의 잠금(위임됨 ∨ 에이전트 주문 claimed·reported → 100 은 승인 버튼으로만)이 DB 에 없어, 담당 팀 멤버가
-- PostgREST 직접 PATCH 로 100 을 쓸 수 있었다(member_update_actual·guard_non_admin_column_scope 는 열만 본다). RPC·서버 경로
-- (auth.uid() null)는 통과한다 — 승인 사건이 100 을 쓴다. 단계 ≥ 2 절(WORKFLOW_APPROVAL_REQUIRED)은 SP5b 가 이 함수를 바꿔 더한다.
-- 경계는 앱과 같은 '99 초과'다(스펙 §3.3.5 의 '< 100 통과' 에서 벗어남 — actual_pct 는 numeric 이라 99.5 를 앱은 막고 스펙 식은 통과시킨다).
create function public.guard_workflow_actual() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.actual_pct is not distinct from old.actual_pct or coalesce(new.actual_pct, 0) <= 99 then return new; end if;
  if not old.dev_workflow then return new; end if;
  -- 위임 태그는 이 행의 값이다 — 다른 행을 읽지 않고 판정한다
  if 'agent' = any(coalesce(old.tags, '{}'::text[])) then
    raise exception using errcode = '42501', message = 'WORKFLOW_ACTUAL_LOCKED';
  end if;
  -- 여기부터는 다른 표(주문)를 읽어 판정한다. 이 행은 트리거가 돌기 전에 UPDATE 가 잠갔고, 점유·보고 사건(apply_workflow_event)도 항목
  -- 행을 잠그므로 둘은 이 행 잠금으로 직렬화된다.
  -- 격리 수준 규칙(0011 ①·⑧·⑨·⑩ 공통): 잠금 아래에서 다른 행을 읽어 판정하는 가드는 read committed 가 아니면 거절한다(fail-closed, 25001).
  -- read committed 는 문장마다 새 스냅샷이라 잠금을 얻은 뒤의 조회가 앞 연결의 커밋을 본다. repeatable read·serializable 은 트랜잭션 스냅샷
  -- 하나로 읽어 잠금을 기다리는 사이(또는 스냅샷 뒤에) 커밋된 변경을 못 본다. serializable 의 SSI 는 두 트랜잭션이 모두 serializable 일 때만
  -- 한쪽을 중단하는데 상대(PostgREST·서버 경로)는 read committed 로 들어온다. 이름으로 판정하므로 read uncommitted 도 거절한다.
  -- 이 가드에서 놓치는 것: 항목 행 잠금을 기다리는 사이 커밋된 점유 — 점유가 항목 행을 바꾸지 않았으면(단계·실적이 이미 그 값) 직렬화 오류도 나지 않는다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'WORKFLOW_ACTUAL_ISOLATION';
  end if;
  if exists (select 1 from public.agent_work_orders o where o.wbs_item_id = old.id and o.status in ('claimed', 'reported')) then
    raise exception using errcode = '42501', message = 'WORKFLOW_ACTUAL_LOCKED';
  end if;
  return new;
end
$$;
revoke all on function public.guard_workflow_actual() from public, anon, authenticated;
create trigger guard_workflow_actual before update of actual_pct on public.wbs_items
  for each row execute function public.guard_workflow_actual();

-- ⑪ 사후검증 — 절마다 본 것 가운데 뒤 절이 바꿀 수 있는 표 권한·정책·실행 권한 불변식을 마지막에 다시 본다 ---------------------------
do $$
declare v text;
begin
  -- 권한은 있는데 그 명령(또는 ALL)의 정책이 없는 DML(INSERT·UPDATE 는 열 단위 포함) — 0 이어야 한다(②, ⑧)
  select string_agg(format('%s:%s', t.relname, cmd.cmd), ', ' order by t.relname, cmd.cmd) into v
    from pg_class t cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as cmd(cmd)
   where t.relnamespace = 'public'::regnamespace and t.relkind in ('r', 'p')
     and (case when cmd.cmd = 'DELETE' then has_table_privilege('authenticated', t.oid, 'DELETE')
               else has_any_column_privilege('authenticated', t.oid, cmd.cmd) end)
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                      and p.cmd in (cmd.cmd, 'ALL') and p.roles && array['authenticated', 'public']::name[]);
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 정책 없는 DML 권한: %', left(v, 800); end if;

  -- truncate·trigger·references·maintain 은 ② 와 같은 실효 권한으로 본다(has_*_privilege) — anon·authenticated 에 직접 준 것뿐 아니라
  -- PUBLIC grant, 롤 상속, 열 단위 REFERENCES 까지 잡는다. grantee 로 거르는 aclexplode 대조는 PUBLIC·상속을 놓친다.
  select string_agg(format('%s:%s:%s', c.relname, r.role, p.priv), ', ' order by c.relname, r.role, p.priv) into v
    from pg_class c
   cross join unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest(array['TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN']) as p(priv)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege(r.role, c.oid, p.priv)
          or (p.priv = 'REFERENCES' and has_any_column_privilege(r.role, c.oid, 'REFERENCES')));
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 표 권한이 되살아났다: %', left(v, 800); end if;

  if has_table_privilege('authenticated', 'public.minutes', 'SELECT')
     or has_column_privilege('authenticated', 'public.minutes', 'share_token', 'SELECT') then
    raise exception 'AUTHZ_0011_POSTCHECK: minutes.share_token 이 열렸다';
  end if;

  -- 트리거는 제 표에 걸려 있고 평소 세션에서 돈다(O·A) — 꺼짐(D)과 복제 세션 전용(R)은 앱 요청에서 돌지 않는다
  select string_agg(x.n, ', ' order by x.n) into v
    from (values ('platform_admins_keep_last', 'public.platform_admins'),
                 ('workspace_members_revoke_access', 'public.workspace_members'),
                 ('minute_files_attachment_guard', 'public.minute_files'),
                 ('guard_workflow_actual', 'public.wbs_items')) as x(n, rel)
   where not exists (select 1 from pg_trigger g
                      where g.tgname = x.n and g.tgrelid = x.rel::regclass and not g.tgisinternal and g.tgenabled in ('O', 'A'));
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 트리거가 없다: %', v; end if;

  -- 격리 수준 규칙(①·⑧·⑨·⑩)은 네 가드에 같은 식으로 들어 있다 — read committed 가 아니면 거절
  select string_agg(f.oid::regprocedure::text, ', ' order by f.oid::regprocedure::text) into v
    from pg_proc f
   where f.oid in ('public.platform_admins_keep_last()'::regprocedure,
                   'public.minute_files_attachment_guard()'::regprocedure,
                   'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)'::regprocedure,
                   'public.guard_workflow_actual()'::regprocedure)
     and position('current_setting(''transaction_isolation'') is distinct from ''read committed''' in f.prosrc) = 0;
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 격리 수준 검사(transaction_isolation)가 없다: %', v; end if;

  -- 실행 권한: apply_workflow_event 는 service_role 만(⑨), attachment_object_exists(⑦)·has_project_role_in_ws(⑥)는
  -- authenticated·service_role 만(정책 헬퍼 관례) — anon 이 실행하면 PUBLIC grant 가 남은 것이다.
  select string_agg(format('%s:%s:%s', x.fn, x.role, case when x.want then '없음' else '있음' end), ', ' order by x.fn, x.role) into v
    from (values
      ('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', 'anon', false),
      ('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', 'authenticated', false),
      ('public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, uuid)', 'service_role', true),
      ('public.attachment_object_exists(text, uuid)', 'anon', false),
      ('public.attachment_object_exists(text, uuid)', 'authenticated', true),
      ('public.attachment_object_exists(text, uuid)', 'service_role', true),
      ('public.has_project_role_in_ws(uuid)', 'anon', false),
      ('public.has_project_role_in_ws(uuid)', 'authenticated', true),
      ('public.has_project_role_in_ws(uuid)', 'service_role', true)) as x(fn, role, want)
   where has_function_privilege(x.role, x.fn::regprocedure, 'EXECUTE') is distinct from x.want;
  if v is not null then raise exception 'AUTHZ_0011_POSTCHECK: 함수 실행 권한이 다르다(함수:롤:지금 상태): %', v; end if;
end $$;
