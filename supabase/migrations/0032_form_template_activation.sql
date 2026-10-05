-- 0032_form_template_activation.sql — SP6 양식 활성화·활성 해제 (정본 §4.7.1)
--
-- 무엇:
--   activate_form_template · deactivate_form_template (security definer, search_path='')
--   한 트랜잭션에서 form_templates.active 와 project_settings 의 forms.<kind>.template_id 를 맞춘다.
--   이력은 apply_project_settings 가 넣는다. 그 호출에 필요한 명령 봉투
--   (p_expected_revision, p_command_id, p_actor, p_schema_version)를 정본의 (project, template) 에 더한다.
--   p_actor 는 세션이 없다(service_role). 함수가 actor_is_project_admin 으로 다시 판정한다.
--
-- 잠금: 그 form_kind 의 form_templates 를 id 순으로 잠근 뒤 project_settings 를 잠그고 병합한다.
-- 병합은 잠금 아래의 values 로만 한다. 없는 키는 §4.4.6 기본 options 와 빈 mapping 으로 만든다.
-- 활성 해제는 그 행이 활성이었을 때만 template_id 를 JSON null 로 돌린다.

create or replace function public.activate_form_template(
  p_project_id uuid,
  p_template_id uuid,
  p_expected_revision bigint,
  p_command_id uuid,
  p_actor uuid,
  p_schema_version int
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_kind text;
  v_key text;
  v_values jsonb;
  v_cur jsonb;
  v_next jsonb;
  v_options jsonb := pg_catalog.jsonb_build_object(
    'max_lines_per_cell', 15,
    'max_rows_per_slide', 5,
    'item_cap', 0,
    'empty_text', '',
    'continuation_label', '(계속)'
  );
  v_result jsonb;
begin
  if p_project_id is null or p_template_id is null or p_command_id is null
     or p_expected_revision is null or p_expected_revision < 0
     or p_actor is null or p_schema_version is null then
    raise exception using errcode = '22023', message = 'FORM_TEMPLATE_INPUT';
  end if;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'FORM_TEMPLATE_FORBIDDEN';
  end if;

  select ft.form_kind into v_kind
    from public.form_templates ft
   where ft.id = p_template_id and ft.project_id = p_project_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_TEMPLATE_NOT_FOUND';
  end if;

  perform 1
    from public.form_templates ft
   where ft.project_id = p_project_id and ft.form_kind = v_kind
   order by ft.id
     for update;

  update public.form_templates ft
     set active = false
   where ft.project_id = p_project_id and ft.form_kind = v_kind and ft.id <> p_template_id and ft.active;
  update public.form_templates ft
     set active = true
   where ft.id = p_template_id and ft.project_id = p_project_id;

  select s."values" into v_values
    from public.project_settings s
   where s.project_id = p_project_id
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;

  v_key := 'forms.' || v_kind;
  v_cur := v_values -> v_key;
  if pg_catalog.jsonb_typeof(v_cur) = 'object' then
    v_next := pg_catalog.jsonb_set(v_cur, '{template_id}', pg_catalog.to_jsonb(p_template_id::text), true);
  elsif v_cur is null then
    v_next := pg_catalog.jsonb_build_object(
      'template_id', p_template_id::text,
      'mapping', '{}'::jsonb,
      'options', v_options
    );
  else
    raise exception using errcode = '22023', message = 'FORM_TEMPLATE_SETTING';
  end if;

  v_result := public.apply_project_settings(
    p_project_id, p_expected_revision, p_command_id,
    pg_catalog.jsonb_build_object(v_key, v_next),
    '{}'::text[], p_actor, p_schema_version, 'edit'
  );
  return v_result || pg_catalog.jsonb_build_object('template_id', p_template_id, 'form_kind', v_kind);
end $$;

revoke all on function public.activate_form_template(uuid, uuid, bigint, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.activate_form_template(uuid, uuid, bigint, uuid, uuid, integer) to service_role;

create or replace function public.deactivate_form_template(
  p_project_id uuid,
  p_template_id uuid,
  p_expected_revision bigint,
  p_command_id uuid,
  p_actor uuid,
  p_schema_version int
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_kind text;
  v_was boolean;
  v_key text;
  v_values jsonb;
  v_rev bigint;
  v_cur jsonb;
  v_next jsonb;
  v_result jsonb;
begin
  if p_project_id is null or p_template_id is null or p_command_id is null
     or p_expected_revision is null or p_expected_revision < 0
     or p_actor is null or p_schema_version is null then
    raise exception using errcode = '22023', message = 'FORM_TEMPLATE_INPUT';
  end if;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'FORM_TEMPLATE_FORBIDDEN';
  end if;

  select ft.form_kind, ft.active into v_kind, v_was
    from public.form_templates ft
   where ft.id = p_template_id and ft.project_id = p_project_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORM_TEMPLATE_NOT_FOUND';
  end if;

  perform 1
    from public.form_templates ft
   where ft.project_id = p_project_id and ft.form_kind = v_kind
   order by ft.id
     for update;

  update public.form_templates ft
     set active = false
   where ft.id = p_template_id and ft.project_id = p_project_id;

  if not v_was then
    select s.revision into v_rev from public.project_settings s where s.project_id = p_project_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
    end if;
    return pg_catalog.jsonb_build_object('status', 'applied', 'revision', v_rev, 'changed', 0, 'form_kind', v_kind) || '{"template_id":null}'::jsonb;
  end if;

  select s."values" into v_values
    from public.project_settings s
   where s.project_id = p_project_id
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;

  v_key := 'forms.' || v_kind;
  v_cur := v_values -> v_key;
  if v_cur is null then
    select s.revision into v_rev from public.project_settings s where s.project_id = p_project_id;
    return pg_catalog.jsonb_build_object('status', 'applied', 'revision', v_rev, 'changed', 0, 'form_kind', v_kind) || '{"template_id":null}'::jsonb;
  elsif pg_catalog.jsonb_typeof(v_cur) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'FORM_TEMPLATE_SETTING';
  end if;

  v_next := pg_catalog.jsonb_set(v_cur, '{template_id}', 'null'::jsonb, true);
  v_result := public.apply_project_settings(
    p_project_id, p_expected_revision, p_command_id,
    pg_catalog.jsonb_build_object(v_key, v_next),
    '{}'::text[], p_actor, p_schema_version, 'edit'
  );
  return v_result || pg_catalog.jsonb_build_object('form_kind', v_kind) || '{"template_id":null}'::jsonb;
end $$;

revoke all on function public.deactivate_form_template(uuid, uuid, bigint, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.deactivate_form_template(uuid, uuid, bigint, uuid, uuid, integer) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc
     where oid = 'public.activate_form_template(uuid, uuid, bigint, uuid, uuid, integer)'::regprocedure
       and prosecdef
  ) then
    raise exception 'FORM_TEMPLATE_ACTIVATION_POSTCHECK: activate_form_template 가 DEFINER 가 아닙니다';
  end if;
  if not exists (
    select 1 from pg_proc
     where oid = 'public.deactivate_form_template(uuid, uuid, bigint, uuid, uuid, integer)'::regprocedure
       and prosecdef
  ) then
    raise exception 'FORM_TEMPLATE_ACTIVATION_POSTCHECK: deactivate_form_template 가 DEFINER 가 아닙니다';
  end if;
  if has_function_privilege('authenticated', 'public.activate_form_template(uuid, uuid, bigint, uuid, uuid, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.activate_form_template(uuid, uuid, bigint, uuid, uuid, integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.activate_form_template(uuid, uuid, bigint, uuid, uuid, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.deactivate_form_template(uuid, uuid, bigint, uuid, uuid, integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.deactivate_form_template(uuid, uuid, bigint, uuid, uuid, integer)', 'EXECUTE') then
    raise exception 'FORM_TEMPLATE_ACTIVATION_POSTCHECK: EXECUTE 가 service_role 만이 아닙니다';
  end if;
end $$;
