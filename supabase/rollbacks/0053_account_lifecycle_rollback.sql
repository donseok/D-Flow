-- 0053 롤백 — 멤버 제거·비밀번호 재설정 기록 RPC 를 지우고 authz_events 의 kind·scope check 를 0012 꼴로 되돌린다.
-- 앱이 두 RPC 를 부르는 동안 지우면 "워크스페이스에서 제거"·"비밀번호 재설정"이 실패하므로 앱을 먼저 되돌린다.
-- 되돌리지 않는 데이터: 이미 뺀 소속(다시 넣으려면 초대·계정 추가), 그때 null 이 된 명단 권한·회수된 초대·닫힌 토큰, 남긴 password_reset 기록.
-- 기록은 지울 수 없다(authz_events 는 UPDATE·DELETE 가 막힌 표다). password_reset 행이 남아 있으면 두 check 를 NOT VALID 로 되돌린다 —
-- 새 행에는 0012 규칙이 그대로 걸리고(password_reset 을 다시 쓰지 못한다) 남은 행은 검사하지 않는다. 옛 앱의 이력 화면은 그 행을
-- "변경 내용을 읽지 못했습니다" 로 보인다.
begin;

drop function if exists public.remove_workspace_member(uuid, uuid, uuid, uuid);
drop function if exists public.record_password_reset(uuid, uuid, uuid, uuid);

alter table public.authz_events drop constraint authz_events_kind_check;
alter table public.authz_events drop constraint authz_events_scope_check;
do $$
begin
  if exists (select 1 from public.authz_events e where e.kind = 'password_reset') then
    raise notice '0053 롤백: password_reset 기록이 남아 있어 두 check 를 NOT VALID 로 되돌린다';
    alter table public.authz_events add constraint authz_events_kind_check
      check (kind in ('platform_admin', 'workspace_role', 'project_access')) not valid;
    alter table public.authz_events add constraint authz_events_scope_check check (
         (kind = 'platform_admin' and workspace_id is null and project_id is null)
      or (kind = 'workspace_role' and workspace_id is not null and project_id is null)
      or (kind = 'project_access' and project_id is not null and workspace_id is not null)) not valid;
  else
    alter table public.authz_events add constraint authz_events_kind_check
      check (kind in ('platform_admin', 'workspace_role', 'project_access'));
    alter table public.authz_events add constraint authz_events_scope_check check (
         (kind = 'platform_admin' and workspace_id is null and project_id is null)
      or (kind = 'workspace_role' and workspace_id is not null and project_id is null)
      or (kind = 'project_access' and project_id is not null and workspace_id is not null));
  end if;
end $$;

commit;
