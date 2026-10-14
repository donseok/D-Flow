-- 0059_workspace_mail_settings.sql
-- 워크스페이스 발송 메일 설정 — 회의 안내·프로젝트 초대 메일을 워크스페이스 관리자가 화면에서 정한 계정으로 보낸다.
-- 왜:
--   · 두 메일(src/app/actions/meetingNotify.ts·projectInvites.ts)은 배포 환경변수(SMTP_*)만 읽는다. 운영에는 그 값이 없어 메일이 하나도
--     나가지 않고, 계정을 바꾸려면 Vercel 환경변수를 고쳐 다시 배포해야 한다.
--   · 설정은 워크스페이스마다 따로 두고 워크스페이스 관리자가 정한다. 우선순위는 워크스페이스 설정 → env(SMTP_*) → 미설정
--     (설계 docs/superpowers/specs/2026-10-15-workspace-mail-settings-design.md).
-- 무엇:
--   ① workspace_mail_settings — 워크스페이스당 한 행. 행이 없으면 미설정이고 "끄기"는 행 삭제다(enabled 열을 두지 않는다 — 꺼진 행과 없는 행이
--      같은 뜻이 된다). 계정 로그인만 받는다 — 무인증 릴레이는 발신 주소 위조의 통로라 env(SMTP_AUTH=none)로만 쓴다.
--      검사 제약: 공백(스페이스·탭·줄바꿈)뿐인 계정·비밀번호·보내는 주소 거부(앱이 trim 해서 읽으므로 행이 'unset' 으로 읽히는 일이 없게), 포트는 SMTP 표준 넷
--      (25·465·587·2525 — 임의 포트로 내부망을 두드리는 탐침을 막는다), 포트-보안 짝(465 는 SSL, 587·25 는 STARTTLS, 2525 는 어느 쪽이든),
--      Gmail 프리셋은 smtp.gmail.com:465 SSL 고정, 호스트는 정규형(소문자·끝 점 없음·1~253자 — IP 리터럴·단일 레이블은 앱이 거른다).
--      password 는 평문이다(암호화하지 않는다). 지키는 것은 권한(②)뿐이다.
--      password_set_by·password_set_at 은 새 비밀번호를 입력했을 때만 앱이 바꾼다. 계정이 지워지면 두 행위자 열은 set null —
--      설정은 그 사람의 것이 아니라 워크스페이스의 발송 설정이다(관리자가 빠져도 지우지 않는다. 화면이 경고한다).
--   ② 권한 — RLS 를 켜고 정책은 두지 않는다. anon·authenticated 의 표 권한을 전부 회수하고 service_role 에만 준다
--      (0035 integration_credentials 와 같은 꼴). 세션은 읽지도 쓰지도 못한다 — 서버 액션 가드(requireWorkspaceAdmin)가 유일한 관문이다.
--   ③ delete_empty_workspace(0055) 재정의 — 부속 표의 닫힌 목록(v_attached)에 'workspace_mail_settings' 하나를 더한다. 메일 설정은 자료가 아니라
--      설정이다 — 안 넣으면 메일 설정을 저장한 적 있는 워크스페이스는 비어 있어도 지울 수 없다. 본문은 0055 그대로다(0056 은 주석에서만 언급,
--      그 뒤 재정의 없음). 머리 전체(security definer·set search_path to '')와 실행권을 다시 적는다 — 둘은 본문이 아니라 함수 속성이라
--      create or replace 에서 빠뜨리면 INVOKER·빈 설정으로 바뀐다.
-- 데이터: 적용만으로 바뀌는 행은 없다(표 하나를 만들고 함수 하나를 다시 정의한다).
-- 롤백: supabase/rollbacks/*_workspace_mail_settings_rollback.sql — 함수를 0055 본문으로 되돌리고 표를 지운다(저장된 메일 설정은 사라진다).

begin;

-- ① 표 -------------------------------------------------------------------------------------------------------------
create table public.workspace_mail_settings (
  workspace_id     uuid primary key references public.workspaces(id) on delete cascade,
  preset           text not null check (preset in ('gmail', 'custom')),
  host             text not null,
  port             integer not null check (port in (25, 465, 587, 2525)),
  secure           boolean not null,
  username         text not null,
  password         text not null,
  from_address     text,
  password_set_by  uuid references auth.users(id) on delete set null,
  password_set_at  timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  -- resolveSmtpSettings 가 값을 trim 해서 본다 — DB 도 공백뿐인 값을 받지 않는다(행이 'unset' 으로 읽히는 일이 없게).
  -- 공백 아닌 글자가 하나는 있어야 한다(\S). btrim 은 스페이스만 걷어 탭·줄바꿈뿐인 값을 통과시키므로 쓰지 않는다
  constraint workspace_mail_settings_login check (username ~ '\S' and password ~ '\S'),
  constraint workspace_mail_settings_from check (from_address is null or from_address ~ '\S'),
  -- 포트와 보안 연결의 짝: 465 는 SSL, 587·25 는 STARTTLS(secure=false). 2525 는 어느 쪽이든
  constraint workspace_mail_settings_tls check (not (port = 465 and not secure) and not (port in (587, 25) and secure)),
  -- Gmail 프리셋은 서버 값을 고정한다(화면이 넣는 값 그대로)
  constraint workspace_mail_settings_gmail check (preset <> 'gmail' or (host = 'smtp.gmail.com' and port = 465 and secure)),
  -- 호스트는 정규화된 DNS 이름(소문자·끝 점 없음) — IP 리터럴·단일 레이블은 앱이 거른다
  constraint workspace_mail_settings_host check (length(host) between 1 and 253 and host = lower(host) and host !~ '\.$')
);

-- ② 권한 — service_role 전용(정책 없음). 기본 권한(pg_default_acl)이 새 표에 anon·authenticated 권한을 주므로 명시적으로 회수한다
alter table public.workspace_mail_settings enable row level security;
revoke all on table public.workspace_mail_settings from public, anon, authenticated;
grant all on table public.workspace_mail_settings to service_role;

-- ③ 빈 워크스페이스 삭제 — 0055 본문에 부속 표 하나(workspace_mail_settings)를 더한다. 머리·실행권을 그대로 다시 적는다 -----------------
create or replace function public.delete_empty_workspace(p_actor uuid, p_workspace_id uuid, p_expected_slug text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  -- 함께 지워지는 부속 표(닫힌 목록) — 빈 워크스페이스에도 저절로 생기는 행과 워크스페이스의 설정. 여기 없는 표는 0행이어야 한다.
  -- workspace_mail_settings(0059)는 자료가 아니라 발송 설정이다 — 메일만 설정한 빈 워크스페이스도 지울 수 있게 부속으로 센다
  v_attached constant text[] := array['workspace_settings', 'workspace_settings_history', 'user_preferences', 'usage_events', 'workspace_mail_settings'];
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

-- 사후검사 WORKSPACE_MAIL_SETTINGS_POSTCHECK — 공백 계정 탐침(서브트랜잭션 안에서 되돌린다) 말고는 읽기만 한다
do $$
declare
  v text;
begin
  -- 표: RLS 켜짐·정책 0
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.workspace_mail_settings'::regclass)
     or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'workspace_mail_settings') then
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: RLS 가 꺼졌거나 정책이 있다(정책 없는 service_role 전용이어야 한다)';
  end if;

  -- anon·authenticated 의 실효 권한 0(열 권한·PUBLIC·상속 포함)
  select string_agg(format('%s:%s', r.role, p.priv), ', ' order by r.role, p.priv) into v
    from unnest(array['anon', 'authenticated']) as r(role)
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p(priv)
   where has_table_privilege(r.role, 'public.workspace_mail_settings'::regclass, p.priv)
      or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
          and has_any_column_privilege(r.role, 'public.workspace_mail_settings'::regclass, p.priv));
  if v is not null then raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: 세션 롤에 표 권한이 남았다: %', v; end if;

  -- service_role 은 읽고 쓴다
  select string_agg(p.priv, ', ') into v
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
   where not has_table_privilege('service_role', 'public.workspace_mail_settings'::regclass, p.priv);
  if v is not null then raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: service_role 에 표 권한이 없다: %', v; end if;

  -- workspaces 참조는 캐스케이드 — 워크스페이스 삭제가 이 행에 막히지 않는다(부속 표)
  if not exists (select 1 from pg_constraint c
                  where c.contype = 'f' and c.conrelid = 'public.workspace_mail_settings'::regclass
                    and c.confrelid = 'public.workspaces'::regclass and c.confdeltype = 'c') then
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: workspaces 를 캐스케이드로 참조하지 않는다';
  end if;

  -- 공백 계정 행은 23514(workspace_mail_settings_login)로 거부된다 — 검사 제약은 FK(문장 끝 트리거)보다 먼저 평가된다
  begin
    insert into public.workspace_mail_settings (workspace_id, preset, host, port, secure, username, password)
      values (pg_catalog.gen_random_uuid(), 'custom', 'smtp.postcheck.invalid', 587, false, '   ', 'x');
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: 공백 계정 행이 들어갔다';
  exception when check_violation then
    get stacked diagnostics v = constraint_name;
    if v is distinct from 'workspace_mail_settings_login' then
      raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: 공백 계정 행이 다른 제약에 걸렸다: %', v;
    end if;
  end;

  -- 재정의한 삭제 RPC — 머리(DEFINER·search_path 빈 값)와 실행권(service_role 전용)이 0055 그대로다
  if not exists (select 1 from pg_proc p where p.oid = 'public.delete_empty_workspace(uuid, uuid, text)'::regprocedure
                    and p.prosecdef and coalesce('search_path=""' = any (p.proconfig), false)) then
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: delete_empty_workspace 가 SECURITY DEFINER·search_path 빈 값이 아니다';
  end if;
  if has_function_privilege('anon', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.delete_empty_workspace(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: delete_empty_workspace 실행권이 어긋났다(세션 불가·service_role 가능이어야 한다)';
  end if;
  -- 본문: 새 부속 표 + 0055 의 관문 토큰(등급 재판정·카탈로그 FK 순회·slug 대조·잠금)
  select string_agg(x.token, ', ') into v
    from (values ('workspace_mail_settings'), ('platform_admins'), ('AUTHZ_FORBIDDEN'), ('pg_catalog.pg_constraint'),
                 ('WORKSPACE_SLUG_MISMATCH'), ('for update')) as x(token)
   where position(x.token in (select p.prosrc from pg_proc p where p.oid = 'public.delete_empty_workspace(uuid, uuid, text)'::regprocedure)) = 0;
  if v is not null then raise exception 'WORKSPACE_MAIL_SETTINGS_POSTCHECK: 삭제 RPC 에 빠진 것이 있다: %', v; end if;
end $$;

commit;
