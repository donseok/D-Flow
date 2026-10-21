-- 0061 롤백 — 회의록 문단 ↔ WBS 작업 연결 표(wbs_item_links)와 등록 RPC(create_wbs_items_from_minute)를 지운다.
-- 앱을 먼저 되돌린다 — 앱이 이 표·RPC 를 쓰는 동안 지우면 회의록의 「WBS로 등록」과 WBS 상세의 「회의록 원문」이 조회 실패로 멈춘다.
-- 멈춤 WBS_LINKS_ROLLBACK_BLOCKED(23514): 연결이 한 행이라도 있으면 아무것도 바꾸지 않는다 — 연결은 이 표에만 있어서, 지우면 어느 작업이 어느
--   회의록 문단에서 왔는지가 사라지고 다시 적용해도 돌아오지 않는다. 조치: 덤프를 떠 두고, 연결을 버려도 되는지 확인한 뒤 표를 비우고 다시 돈다.
-- 되돌리지 않는 데이터: RPC 가 만든 작업(wbs_items)·변경 이력(change_logs) — 손으로 추가한 작업과 같은 행이라 그대로 남는다.
-- 순서: RPC → 트리거 → 트리거 함수 → 표(정책·인덱스·제약은 표와 함께 사라진다).
begin;

do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.wbs_item_links;
  if v_n > 0 then
    raise exception using errcode = '23514', message = 'WBS_LINKS_ROLLBACK_BLOCKED',
      detail = pg_catalog.format('회의록 문단 연결 %s행이 남아 있다 — 지우면 어느 문단에서 온 작업인지가 사라진다', v_n);
  end if;
end $$;

drop function public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb);
drop trigger wbs_item_links_minute_scope on public.wbs_item_links;
drop function public.wbs_item_links_minute_scope();
drop table public.wbs_item_links;

commit;
