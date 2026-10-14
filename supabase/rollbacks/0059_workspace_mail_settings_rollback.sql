-- 0059 롤백 — 워크스페이스 발송 메일 설정 표를 지우고 delete_empty_workspace 를 0055 본문으로 되돌린다.
-- 앱을 먼저 되돌린다 — 앱이 이 표를 읽는 동안 지우면 메일 설정 화면과 회의 안내·초대 발송이 조회 실패(MAIL_SETTINGS_UNAVAILABLE)로 멈춘다.
-- 옛 앱은 배포 환경변수(SMTP_*)로 보낸다.
-- 되돌리지 않는 데이터: 저장된 메일 설정(계정·앱 비밀번호) — 표와 함께 사라진다. 다시 적용하면 빈 표다(관리자가 다시 넣는다).
-- 함수는 0055 본문·같은 머리(security definer·set search_path to '')·같은 실행권으로 되돌린다 — 머리를 빠뜨리면 INVOKER·빈 설정이 된다.
-- 순서: 함수 먼저(부속 목록에서 이 표를 뺀다) → 표.
begin;

create or replace function public.delete_empty_workspace(p_actor uuid, p_workspace_id uuid, p_expected_slug text)
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

drop table if exists public.workspace_mail_settings;

-- 사후검사 WORKSPACE_MAIL_SETTINGS_ROLLBACK_POSTCHECK — 읽기만 한다
do $$
begin
  if pg_catalog.to_regclass('public.workspace_mail_settings') is not null then
    raise exception 'WORKSPACE_MAIL_SETTINGS_ROLLBACK_POSTCHECK: workspace_mail_settings 가 남았다';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.delete_empty_workspace(uuid, uuid, text)'::regprocedure
                    and p.prosecdef and coalesce('search_path=""' = any (p.proconfig), false)
                    and position('workspace_mail_settings' in p.prosrc) = 0
                    and position('usage_events' in p.prosrc) > 0) then
    raise exception 'WORKSPACE_MAIL_SETTINGS_ROLLBACK_POSTCHECK: delete_empty_workspace 가 0055 꼴(DEFINER·search_path 빈 값·부속 넷)이 아니다';
  end if;
  if has_function_privilege('anon', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'WORKSPACE_MAIL_SETTINGS_ROLLBACK_POSTCHECK: delete_empty_workspace 실행권이 어긋났다';
  end if;
end $$;

commit;
