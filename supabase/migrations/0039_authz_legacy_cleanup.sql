-- 0039_authz_legacy_cleanup.sql
-- SP9: 옛 가져오기 RPC 세션(authenticated) 실행권 회수 및 teams 직접 쓰기 경로 정리
-- 1. 옛 가져오기 RPC (import_wbs, replace_wbs, import_wbs_upsert)의 authenticated 실행권 회수 (service_role 전용)
-- 2. teams 테이블의 세션 직접 INSERT/UPDATE 정책 제거 및 권한 회수 (Server Action / service_role 전용)
-- 3. teams code/name 제약조건 보강 (길이 및 공백/제어문자 방어)

begin;

-- 1. 옛 가져오기 RPC 실행권 회수
revoke execute on function public.import_wbs(uuid, jsonb, jsonb) from authenticated;
revoke execute on function public.replace_wbs(uuid, jsonb, jsonb) from authenticated;
revoke execute on function public.import_wbs_upsert(uuid, jsonb, uuid) from authenticated;

grant execute on function public.import_wbs(uuid, jsonb, jsonb) to service_role;
grant execute on function public.replace_wbs(uuid, jsonb, jsonb) to service_role;
grant execute on function public.import_wbs_upsert(uuid, jsonb, uuid) to service_role;

-- 2. teams 세션 직접 쓰기 정책 제거 및 쓰기 권한 회수
drop policy if exists pa_insert_project_teams on public.teams;
drop policy if exists pa_update_project_teams on public.teams;
drop policy if exists wsadmin_update_teams on public.teams;

revoke insert, update, delete on public.teams from authenticated;
grant select on public.teams to authenticated;
grant all on public.teams to service_role;

-- 3. teams 제약조건 보강 (code 길이 <= 20, name 길이 <= 40, 제어문자 방지)
alter table public.teams drop constraint if exists teams_code_len_check;
alter table public.teams add constraint teams_code_len_check
  check (char_length(code) <= 20 and code !~ '[\r\n\t]');

alter table public.teams drop constraint if exists teams_name_check;
alter table public.teams add constraint teams_name_check
  check (name = btrim(name) and name <> '' and name !~ '[\r\n\t]');

-- 4. 사후 검증 (AUTHZ_LEGACY_CLEANUP_POSTCHECK)
do $$
begin
  if has_function_privilege('authenticated', 'public.import_wbs(uuid, jsonb, jsonb)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.replace_wbs(uuid, jsonb, jsonb)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.import_wbs_upsert(uuid, jsonb, uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'AUTHZ_LEGACY_CLEANUP_POSTCHECK: 옛 가져오기 RPC 의 authenticated 실행권이 남아 있다' using errcode = '42501';
  end if;

  if has_table_privilege('authenticated', 'public.teams', 'INSERT')
     or has_table_privilege('authenticated', 'public.teams', 'UPDATE')
     or has_table_privilege('authenticated', 'public.teams', 'DELETE') then
    raise exception 'AUTHZ_LEGACY_CLEANUP_POSTCHECK: teams 표의 authenticated 쓰기 권한이 남아 있다' using errcode = '42501';
  end if;

  if not has_table_privilege('authenticated', 'public.teams', 'SELECT') then
    raise exception 'AUTHZ_LEGACY_CLEANUP_POSTCHECK: teams 표의 authenticated 읽기 권한이 없다' using errcode = '42501';
  end if;
end $$;

commit;
