-- 0054 롤백 — 워크스페이스 생성 RPC 를 지우고 workspace_members 의 세션 권한·정책을 0003·0011 꼴로 되돌린다.
-- 앱이 create_workspace_with_admin 을 부르는 동안 지우면 플랫폼 관리 화면의 "워크스페이스 만들기"가 실패하므로 앱을 먼저 되돌린다.
-- 되돌리는 것: authenticated 의 workspace_members DELETE 권한, FOR ALL 정책 workspace_members_write(나눈 INSERT·UPDATE 정책은 지운다).
--   UPDATE 는 0011 그대로 role 열만이다(이 롤백이 건드리지 않는다).
-- 되돌리지 않는 데이터: 그 RPC 로 만든 워크스페이스·소속·인물·설정과 그 이력 — 정상 데이터다.
-- 주의: 되돌리면 워크스페이스 관리자가 세션으로 소속을 직접 지울 수 있고, 그 길은 초대·토큰을 회수하지 않는다(0053 머리말).
begin;

drop function if exists public.create_workspace_with_admin(uuid, text, text, uuid, jsonb, uuid, int);

drop policy if exists workspace_members_insert on public.workspace_members;
drop policy if exists workspace_members_update on public.workspace_members;
drop policy if exists workspace_members_write on public.workspace_members;
create policy workspace_members_write on public.workspace_members to authenticated
  using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
grant delete on public.workspace_members to authenticated;

commit;
