-- 0048 롤백 — 단계 값 대조 래퍼를 지운다. 앱이 이 함수를 부르는 동안 지우면 단계 지정이 실패하므로 앱을 먼저 되돌린다.
begin;
drop function if exists public.apply_workflow_event_stage_cas(uuid,uuid,uuid,text,text,text);
commit;
