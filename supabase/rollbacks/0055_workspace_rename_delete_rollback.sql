-- 0055 롤백 — 워크스페이스 이름 변경·빈 워크스페이스 삭제 RPC 를 지운다.
-- 앱이 이 RPC 를 부르는 동안 지우면 플랫폼 관리 화면의 "이름 바꾸기"·"삭제"와 워크스페이스 설정의 이름 편집이 실패하므로 앱을 먼저 되돌린다.
-- 되돌리지 않는 데이터: 그 RPC 로 바꾼 이름(옛 이름은 어디에도 남지 않는다)과 지운 워크스페이스 — 삭제는 되돌릴 수 없다(백업에서만 복구).
begin;

drop function if exists public.delete_empty_workspace(uuid, uuid, text);
drop function if exists public.rename_workspace(uuid, uuid, text);

commit;
