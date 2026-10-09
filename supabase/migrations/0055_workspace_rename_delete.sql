-- 0055_workspace_rename_delete.sql
-- 워크스페이스 이름 변경과 "빈 워크스페이스" 삭제 — 지금까지는 만들 수만 있었다(0054).
-- 왜:
--   · workspaces 는 세션에 SELECT 만 열려 있다(정책 workspaces_read). 이름을 고칠 길도, 잘못 만든 워크스페이스를 치울 길도 앱에 없었다.
--   · 삭제는 되돌릴 수 없고 workspaces 를 가리키는 FK 는 거의 다 ON DELETE CASCADE 다 — 행 하나를 지우면 회의록·팀·자격증명까지 따라 지워진다.
--     그래서 "비어 있음"의 판정과 삭제를 한 트랜잭션에 넣고, 판정은 표 이름을 손으로 적은 목록이 아니라 **카탈로그의 FK 전부**를 훑는다.
--     새 표가 workspaces 를 참조하게 되어도 그 표에 행이 있으면 거부된다(조용히 따라 지워지지 않는다).
-- 무엇:
--   ① rename_workspace(p_actor, p_workspace_id, p_name) — DEFINER·service_role 전용. 등급을 함수 안에서 다시 판정한다
--      (actor_is_workspace_admin — 플랫폼 관리자 또는 그 워크스페이스의 관리자. 액션 가드 requireWorkspaceAdmin 과 두 관문).
--      slug 는 건드리지 않는다(주소·연동이 slug 를 쓴다). 이름 규칙은 생성 폼과 같다(다듬은 1~80자, 줄바꿈·탭 없음).
--      같은 이름이면 쓰지 않고 status unchanged.
--   ② delete_empty_workspace(p_actor, p_workspace_id, p_expected_slug) — DEFINER·service_role 전용. 플랫폼 관리자만(함수 안에서 재판정).
--      p_expected_slug 는 화면에서 사람이 직접 적은 slug 다 — 그 id 의 slug 와 다르면 WORKSPACE_SLUG_MISMATCH(엉뚱한 행을 지우지 않는다).
--      워크스페이스 행을 FOR UPDATE 로 잠근 뒤(새 참조 행의 FK 검사가 이 잠금을 기다린다 — 세는 동안 새 행이 끼어들지 못한다)
--      workspaces 를 참조하는 모든 FK 표의 행 수를 센다. 남아 있으면 지우지 않고 status blocked 와 표별 건수(remaining)를 돌려준다.
--      함께 지워지는 것은 닫힌 목록뿐이다 — "빈 워크스페이스에도 저절로 생기는" 부속 행:
--        workspace_settings(생성 트리거)·workspace_settings_history(생성 때의 설정 이력)·user_preferences(개인 화면 설정)·usage_events(사용 기록),
--        그리고 실행자 본인의 소속 행(workspace_members)과 인물 행(people) 하나씩. 권한 이력(authz_events·authz_commands)은 기존 삭제 트리거가 치운다.
--      그 밖의 표(프로젝트·다른 멤버·다른 인물·팀·회의록·폴더·초대·자격증명·알림·색인 …, 그리고 앞으로 생길 표)는 0행이어야 한다.
--      FK 가 없는 간접 참조 하나도 본다: 저장소의 ws/<id>/ 아래 파일(로고). 있으면 거부한다(파일은 DB 삭제로 지워지지 않는다).
--      삭제 자체는 workspaces 행 하나의 DELETE 다 — 부속 행은 FK 캐스케이드가 지운다(설정 행·이력의 보호 트리거는 부모가 사라진 캐스케이드만 통과시킨다).
-- 사유 코드(앱이 문구로 바꾼다): AUTHZ_FORBIDDEN(42501) · WORKSPACE_NOT_FOUND(P0002) · WORKSPACE_NAME_INVALID·WORKSPACE_RENAME_INVALID·
--   WORKSPACE_DELETE_INVALID·WORKSPACE_SLUG_MISMATCH(22023) · WORKSPACE_DELETE_UNKNOWN_REFERENCE(0A000 — 한 열짜리가 아닌 FK. 셀 수 없으면 지우지 않는다) ·
--   WORKSPACE_DELETE_REFERENCED(23503 — 부속 행을 다른 곳이 붙들고 있다) · SETTINGS_ISOLATION(25001).
-- 하지 않는 것: 데이터가 있는 워크스페이스의 강제 삭제, 보관(비활성 플래그 — workspaces 에 그런 열이 없고 이 마이그레이션이 더하지 않는다), slug 변경.
-- 데이터: 적용만으로 바뀌는 행은 없다(함수 둘을 만든다).
-- 롤백: supabase/rollbacks/*_workspace_rename_delete_rollback.sql.

begin;

-- ① 이름 변경 ------------------------------------------------------------------------------------------------------
create function public.rename_workspace(p_actor uuid, p_workspace_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_name text := pg_catalog.btrim(p_name);
  v_old text;
begin
  if p_actor is null or p_workspace_id is null then
    raise exception using errcode = '22023', message = 'WORKSPACE_RENAME_INVALID';
  end if;
  -- 생성 폼(checkWorkspaceCreate)과 같은 규칙 — 다듬은 1~80자, 줄바꿈·탭 없음
  if v_name is null or v_name = '' or pg_catalog.char_length(v_name) > 80 or v_name ~ '[\n\r\t]' then
    raise exception using errcode = '22023', message = 'WORKSPACE_NAME_INVALID';
  end if;
  -- 등급 재판정(액션 가드와 두 관문). 없는 워크스페이스도 관리자가 아니면 여기서 같은 거부다(존재를 알려 주지 않는다)
  if not public.actor_is_workspace_admin(p_actor, p_workspace_id) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  select w.name into v_old from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORKSPACE_NOT_FOUND';
  end if;
  if v_old = v_name then
    return pg_catalog.jsonb_build_object('status', 'unchanged', 'name', v_name);
  end if;
  update public.workspaces set name = v_name where id = p_workspace_id;
  return pg_catalog.jsonb_build_object('status', 'applied', 'name', v_name, 'previous', v_old);
end $$;
revoke all on function public.rename_workspace(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rename_workspace(uuid, uuid, text) to service_role;

-- ② 빈 워크스페이스 삭제 ---------------------------------------------------------------------------------------------
create function public.delete_empty_workspace(p_actor uuid, p_workspace_id uuid, p_expected_slug text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  -- 함께 지워지는 부속 표(닫힌 목록) — 빈 워크스페이스에도 저절로 생기는 행. 여기 없는 표는 0행이어야 한다
  v_attached constant text[] := array['workspace_settings', 'workspace_settings_history', 'user_preferences', 'usage_events'];
  v_slug text;
  v_name text;
  v_key text;
  v_n bigint;
  v_remaining jsonb := '{}'::jsonb;
  v_removed jsonb := '{}'::jsonb;
  r record;
begin
  if p_actor is null or p_workspace_id is null or p_expected_slug is null then
    raise exception using errcode = '22023', message = 'WORKSPACE_DELETE_INVALID';
  end if;
  -- 등급 재판정(액션 가드 requireSuperuser 와 두 관문) — 워크스페이스를 지우는 것은 플랫폼 관리자뿐이다
  if not exists (select 1 from public.platform_admins a where a.user_id = p_actor) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  -- 격리 수준 규칙(0011 공통): 잠근 뒤 참조 행을 세므로 read committed 가 아니면 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  -- 잠금 — 이 행을 가리키는 새 행의 FK 검사(FOR KEY SHARE)가 여기서 기다린다. 아래에서 센 뒤 지울 때까지 새 참조가 끼어들지 못한다
  select w.slug, w.name into v_slug, v_name from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORKSPACE_NOT_FOUND';
  end if;
  if v_slug is distinct from p_expected_slug then
    raise exception using errcode = '22023', message = 'WORKSPACE_SLUG_MISMATCH';
  end if;

  -- workspaces 를 참조하는 FK 전부(카탈로그) — 표 이름을 손으로 적지 않는다. 새 참조 표가 생겨도 행이 있으면 여기서 걸린다
  for r in
    select c.conrelid::pg_catalog.regclass::text as ident, n.nspname, cl.relname,
           pg_catalog.cardinality(c.conkey) as ncols,
           (select a.attname from pg_catalog.pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as col
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class cl on cl.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
     where c.contype = 'f' and c.confrelid = 'public.workspaces'::pg_catalog.regclass
     order by 1
  loop
    v_key := case when r.nspname = 'public' then r.relname else r.nspname || '.' || r.relname end;
    -- 여러 열짜리 FK 는 이 함수가 셀 줄 모른다 — 모르면 지우지 않는다
    if r.ncols <> 1 then
      raise exception using errcode = '0A000', message = 'WORKSPACE_DELETE_UNKNOWN_REFERENCE', detail = v_key;
    end if;
    if v_key in ('workspace_members', 'people') then
      -- 실행자 본인의 소속·인물 행만 부속이다. 다른 사람의 소속, 다른 인물(계정 없는 외부 인력 포함)은 남은 자료다
      execute pg_catalog.format('select count(*) from %s t where t.%I = $1 and t.user_id is distinct from $2', r.ident, r.col)
        into v_n using p_workspace_id, p_actor;
    else
      execute pg_catalog.format('select count(*) from %s t where t.%I = $1', r.ident, r.col) into v_n using p_workspace_id;
    end if;
    if v_n = 0 then
      continue;
    end if;
    if v_key = any (v_attached) then
      v_removed := v_removed || pg_catalog.jsonb_build_object(v_key, coalesce((v_removed ->> v_key)::bigint, 0) + v_n);
    else
      v_remaining := v_remaining || pg_catalog.jsonb_build_object(v_key, coalesce((v_remaining ->> v_key)::bigint, 0) + v_n);
    end if;
  end loop;

  -- FK 없는 간접 참조 — 저장소의 ws/<id>/ 아래 파일(로고 등). 행을 지워도 파일은 남으므로 먼저 치우게 한다
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects o where o.name like $1' into v_n using 'ws/' || p_workspace_id::text || '/%';
    if v_n > 0 then
      v_remaining := v_remaining || pg_catalog.jsonb_build_object('storage.objects', v_n);
    end if;
  end if;

  if v_remaining <> '{}'::jsonb then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'slug', v_slug, 'name', v_name, 'remaining', v_remaining);
  end if;

  -- 삭제 — 행 하나. 부속 행은 FK 캐스케이드가 지우고, 권한 이력은 삭제 트리거(workspaces_purge_authz_events)가 치운다.
  -- 부속 행(실행자의 인물 행 등)을 다른 곳이 붙들고 있으면(다른 워크스페이스의 명단 등) FK 가 막는다 — 전부 없던 일로 하고 사유만 알린다
  begin
    delete from public.workspaces w where w.id = p_workspace_id;
  exception when foreign_key_violation then
    raise exception using errcode = '23503', message = 'WORKSPACE_DELETE_REFERENCED';
  end;
  return pg_catalog.jsonb_build_object('status', 'deleted', 'slug', v_slug, 'name', v_name, 'removed', v_removed);
end $$;
revoke all on function public.delete_empty_workspace(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_empty_workspace(uuid, uuid, text) to service_role;

-- 사후검사 WORKSPACE_RENAME_DELETE_POSTCHECK — 읽기만 한다
do $$
declare
  v text;
begin
  -- 두 RPC 는 service_role 전용
  select string_agg(f, ', ') into v from unnest(array[
    'public.rename_workspace(uuid, uuid, text)', 'public.delete_empty_workspace(uuid, uuid, text)']) as f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE');
  if v is not null then raise exception 'WORKSPACE_RENAME_DELETE_POSTCHECK: 실행권이 어긋났다(세션 불가·service_role 가능이어야 한다): %', v; end if;
  -- 등급 재판정을 지녔다
  select string_agg(x.token, ', ') into v
    from (values ('public.actor_is_workspace_admin('), ('AUTHZ_FORBIDDEN'), ('WORKSPACE_NAME_INVALID')) as x(token)
   where position(x.token in (select p.prosrc from pg_proc p where p.oid = 'public.rename_workspace(uuid, uuid, text)'::regprocedure)) = 0;
  if v is not null then raise exception 'WORKSPACE_RENAME_DELETE_POSTCHECK: 이름 변경 RPC 에 빠진 것이 있다: %', v; end if;
  select string_agg(x.token, ', ') into v
    from (values ('platform_admins'), ('AUTHZ_FORBIDDEN'), ('pg_catalog.pg_constraint'), ('WORKSPACE_SLUG_MISMATCH'), ('for update')) as x(token)
   where position(x.token in (select p.prosrc from pg_proc p where p.oid = 'public.delete_empty_workspace(uuid, uuid, text)'::regprocedure)) = 0;
  if v is not null then raise exception 'WORKSPACE_RENAME_DELETE_POSTCHECK: 삭제 RPC 에 빠진 것이 있다: %', v; end if;
  -- 부속 표(닫힌 목록)와 본인 행을 남기는 두 표는 workspaces 를 캐스케이드로 참조한다 — 아니면 "빈" 워크스페이스의 삭제가 FK 에 막힌다
  select string_agg(x.name, ', ') into v
    from (values ('workspace_settings'), ('workspace_settings_history'), ('user_preferences'), ('usage_events'), ('workspace_members'), ('people')) as x(name)
   where not exists (select 1 from pg_constraint c
                      where c.contype = 'f' and c.confrelid = 'public.workspaces'::regclass
                        and c.conrelid = ('public.' || x.name)::regclass and c.confdeltype = 'c');
  if v is not null then raise exception 'WORKSPACE_RENAME_DELETE_POSTCHECK: 부속 표가 workspaces 를 캐스케이드로 참조하지 않는다: %', v; end if;
  -- 본인 행을 가르는 열
  select string_agg(x.name, ', ') into v
    from (values ('workspace_members'), ('people')) as x(name)
   where not exists (select 1 from pg_attribute a
                      where a.attrelid = ('public.' || x.name)::regclass and a.attname = 'user_id' and not a.attisdropped);
  if v is not null then raise exception 'WORKSPACE_RENAME_DELETE_POSTCHECK: user_id 열이 없다: %', v; end if;
  -- 권한 이력을 치우는 삭제 트리거 — 없으면 지운 워크스페이스의 이력이 가리킬 곳 없이 남는다
  if not exists (select 1 from pg_trigger g where g.tgrelid = 'public.workspaces'::regclass and g.tgname = 'workspaces_purge_authz_events'
                    and not g.tgisinternal and g.tgenabled in ('O', 'A')) then
    raise exception 'WORKSPACE_RENAME_DELETE_POSTCHECK: workspaces_purge_authz_events 트리거가 없다';
  end if;
end $$;

commit;
