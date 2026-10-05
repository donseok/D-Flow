-- 0039_authz_legacy_cleanup_rollback.sql
-- 0039 롤백: 옛 가져오기 RPC 세션 실행권 복구 및 teams 세션 쓰기 복원
begin;

-- 1. 옛 가져오기 RPC 실행권 복원
grant execute on function public.import_wbs(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.replace_wbs(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.import_wbs_upsert(uuid, jsonb, uuid) to authenticated;

-- 2. teams 세션 쓰기 권한 및 정책 복원
grant insert, update on public.teams to authenticated;

create policy pa_insert_project_teams on public.teams
  for insert to authenticated
  with check (((project_id is not null) and public.is_project_admin(project_id)));

create policy pa_update_project_teams on public.teams
  for update to authenticated
  using (((project_id is not null) and public.is_project_admin(project_id)))
  with check (((project_id is not null) and public.is_project_admin(project_id)));

create policy wsadmin_update_teams on public.teams
  for update to authenticated
  using (project_id is null and public.is_ws_admin(workspace_id))
  with check (project_id is null and public.is_ws_admin(workspace_id));

-- 3. 추가된 제약조건 삭제
alter table public.teams drop constraint if exists teams_code_len_check;
alter table public.teams drop constraint if exists teams_name_check;

commit;
