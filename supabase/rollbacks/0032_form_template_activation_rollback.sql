-- 0032_form_template_activation_rollback.sql
-- 0032_form_template_activation.sql 의 역변환. 양식 행과 설정 값은 되돌리지 않는다.

drop function if exists public.deactivate_form_template(uuid, uuid, bigint, uuid, uuid, integer);
drop function if exists public.activate_form_template(uuid, uuid, bigint, uuid, uuid, integer);
